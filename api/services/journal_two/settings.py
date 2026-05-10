"""
Journal 2.0 — settings service.

Spec §5. One `j2_settings` row per user, stored as a JSON blob in the
`data` column for cheap schema evolution. Validation happens at the
service boundary; the DB doesn't constrain shape.

BE-range invariant (§4): `enabled` is computed server-side as
(value != 0) on every write. We never trust the client's `enabled`
flag.

Setups rule (§5.5): deleting a setup does NOT retroactively unset it
on existing Positions or Trades — that contract is enforced in
positions.py / trades.py at read/write time, not here.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection


# ── Defaults (spec §5) ───────────────────────────────────────────────────────

def default_settings_data() -> dict[str, Any]:
    """The seed values every new user starts with on first read."""
    return {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        # Community sharing — opt-in. When true, this user's CLOSED
        # trades (stripped of shares and pnlDollar) become visible in
        # the Journal 2.0 Community tab alongside every other user who
        # also opted in. Default off.
        "shareJournalData": False,
        "tradingMode": "both",
        # Phase A — Entry Guards (nullable = disabled)
        "defaultSizePct": None,
        "defaultRMultipleTarget": None,
        "maxRiskPerTradePct": None,
        # Phase B — Session Discipline (null/empty = disabled)
        "dailyLossLimitPct": None,
        "coolingOffMinutesAfterLoss": None,
        "noTradeWindowsET": [],
        # Phase C — Setup-Aware Coaching
        "aPlusSetups": [],
        "aPlusRiskMultiplier": None,
    }


# ── Validation ───────────────────────────────────────────────────────────────

_VALID_STOP_MODES = {"custom", "bar_low_high", "fixed_dollar_risk", "fixed_percent_distance"}
_VALID_CLOSING = {"FIFO", "LIFO"}
_VALID_BE_UNITS = {"$", "%"}
_VALID_BUFFER_UNITS = {"$", "%"}
_VALID_TRADING_MODES = {"shares", "options", "both"}


class SettingsValidationError(ValueError):
    """Raised when client-supplied settings don't match the §4 shape."""


def _validate_default_stop(stop: Any) -> dict[str, Any]:
    if not isinstance(stop, dict):
        raise SettingsValidationError("defaultStop must be an object")
    mode = stop.get("mode")
    if mode not in _VALID_STOP_MODES:
        raise SettingsValidationError(f"defaultStop.mode must be one of {sorted(_VALID_STOP_MODES)}")
    if mode == "custom":
        return {"mode": "custom"}
    if mode == "bar_low_high":
        buffer = stop.get("buffer")
        unit = stop.get("bufferUnit")
        if not isinstance(buffer, (int, float)) or buffer < 0:
            raise SettingsValidationError("bar_low_high.buffer must be a non-negative number")
        if unit not in _VALID_BUFFER_UNITS:
            raise SettingsValidationError("bar_low_high.bufferUnit must be '$' or '%'")
        return {"mode": "bar_low_high", "buffer": float(buffer), "bufferUnit": unit}
    if mode == "fixed_dollar_risk":
        amount = stop.get("amount")
        if not isinstance(amount, (int, float)) or amount <= 0:
            raise SettingsValidationError("fixed_dollar_risk.amount must be > 0")
        return {"mode": "fixed_dollar_risk", "amount": float(amount)}
    # fixed_percent_distance
    percent = stop.get("percent")
    if not isinstance(percent, (int, float)) or percent <= 0 or percent >= 100:
        raise SettingsValidationError("fixed_percent_distance.percent must be in (0, 100)")
    return {"mode": "fixed_percent_distance", "percent": float(percent)}


def _validate_breakeven_range(be: Any) -> dict[str, Any]:
    if not isinstance(be, dict):
        raise SettingsValidationError("breakevenRange must be an object")
    unit = be.get("unit")
    value = be.get("value", 0)
    if unit not in _VALID_BE_UNITS:
        raise SettingsValidationError("breakevenRange.unit must be '$' or '%'")
    if not isinstance(value, (int, float)) or value < 0:
        raise SettingsValidationError("breakevenRange.value must be a non-negative number")
    # `enabled` invariant: true iff value != 0 (computed server-side; never trust client)
    return {
        "enabled": float(value) != 0.0,
        "unit": unit,
        "value": float(value),
    }


def _validate_setups(setups: Any) -> list[str]:
    if not isinstance(setups, list):
        raise SettingsValidationError("setups must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for s in setups:
        if not isinstance(s, str):
            raise SettingsValidationError("setups entries must be strings")
        stripped = s.strip()
        if not stripped:
            continue
        if stripped in seen:
            continue
        seen.add(stripped)
        out.append(stripped)
    return out


def _validate_optional_pct(value: Any, field_name: str, *, max_exclusive: float = 100.0) -> float | None:
    """Optional 0 < x < max_exclusive percent. None/'' = disabled."""
    if value is None or value == "":
        return None
    if not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= 0 or f >= max_exclusive:
        raise SettingsValidationError(f"{field_name} must be in (0, {max_exclusive})")
    return f


def _validate_optional_positive(value: Any, field_name: str) -> float | None:
    """Optional positive number. None/'' = disabled."""
    if value is None or value == "":
        return None
    if not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= 0:
        raise SettingsValidationError(f"{field_name} must be > 0")
    return f


_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_optional_positive_int(value: Any, field_name: str) -> int | None:
    """Optional positive integer. None/'' = disabled. Rejects bool subclass and floats."""
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise SettingsValidationError(f"{field_name} must be a positive integer or null")
    if value <= 0:
        raise SettingsValidationError(f"{field_name} must be > 0")
    return value


def _validate_no_trade_windows(value: Any) -> list[dict[str, str]]:
    """List of {start: 'HH:MM', end: 'HH:MM', label?}. Empty list = disabled.
    No overnight windows allowed in v1 (end must be strictly after start)."""
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise SettingsValidationError("noTradeWindowsET must be a list")
    out: list[dict[str, str]] = []
    for i, w in enumerate(value):
        if not isinstance(w, dict):
            raise SettingsValidationError(f"noTradeWindowsET[{i}] must be an object")
        start = w.get("start")
        end = w.get("end")
        label = w.get("label", "")
        if not isinstance(start, str) or not _HHMM_RE.match(start):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].start must be HH:MM (24-hour)")
        if not isinstance(end, str) or not _HHMM_RE.match(end):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].end must be HH:MM (24-hour)")
        if not isinstance(label, str):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].label must be a string")
        if start >= end:
            raise SettingsValidationError(
                f"noTradeWindowsET[{i}]: end must be after start (overnight windows not supported in v1)"
            )
        out.append({"start": start, "end": end, "label": label.strip()})
    return out


def _validate_string_list(value: Any, field_name: str) -> list[str]:
    """Optional list of unique non-empty strings. None/'' = empty list. Trims whitespace."""
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise SettingsValidationError(f"{field_name} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for s in value:
        if not isinstance(s, str):
            raise SettingsValidationError(f"{field_name} entries must be strings")
        stripped = s.strip()
        if not stripped or stripped in seen:
            continue
        seen.add(stripped)
        out.append(stripped)
    return out


def _validate_optional_multiplier(
    value: Any,
    field_name: str,
    *,
    min_exclusive: float = 1.0,
    max_inclusive: float = 10.0,
) -> float | None:
    """Optional multiplier > min_exclusive and <= max_inclusive. None/'' = disabled.
    Rejects bool subclass."""
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= min_exclusive or f > max_inclusive:
        raise SettingsValidationError(
            f"{field_name} must be in ({min_exclusive}, {max_inclusive}]"
        )
    return f


def validate_settings_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Reduce a client payload to the canonical shape. Rejects unknown fields
    by ignoring them; required fields must be present and valid."""
    if not isinstance(payload, dict):
        raise SettingsValidationError("settings payload must be an object")

    account_size = payload.get("accountSize")
    if not isinstance(account_size, (int, float)) or account_size < 1:
        raise SettingsValidationError("accountSize must be >= 1")

    closing = payload.get("positionClosing")
    if closing not in _VALID_CLOSING:
        raise SettingsValidationError("positionClosing must be 'FIFO' or 'LIFO'")

    trading_mode = payload.get("tradingMode", "both")
    if trading_mode not in _VALID_TRADING_MODES:
        raise SettingsValidationError(
            f"tradingMode must be one of {sorted(_VALID_TRADING_MODES)}"
        )

    return {
        "accountSize": float(account_size),
        "defaultStop": _validate_default_stop(payload.get("defaultStop")),
        "positionClosing": closing,
        "breakevenRange": _validate_breakeven_range(payload.get("breakevenRange")),
        "setups": _validate_setups(payload.get("setups", [])),
        "shareJournalData": bool(payload.get("shareJournalData", False)),
        "tradingMode": trading_mode,
        # Phase A
        "defaultSizePct": _validate_optional_pct(payload.get("defaultSizePct"), "defaultSizePct"),
        "defaultRMultipleTarget": _validate_optional_positive(payload.get("defaultRMultipleTarget"), "defaultRMultipleTarget"),
        "maxRiskPerTradePct": _validate_optional_pct(payload.get("maxRiskPerTradePct"), "maxRiskPerTradePct"),
        # Phase B
        "dailyLossLimitPct": _validate_optional_pct(payload.get("dailyLossLimitPct"), "dailyLossLimitPct"),
        "coolingOffMinutesAfterLoss": _validate_optional_positive_int(
            payload.get("coolingOffMinutesAfterLoss"), "coolingOffMinutesAfterLoss",
        ),
        "noTradeWindowsET": _validate_no_trade_windows(payload.get("noTradeWindowsET", [])),
        # Phase C
        "aPlusSetups": _validate_string_list(payload.get("aPlusSetups", []), "aPlusSetups"),
        "aPlusRiskMultiplier": _validate_optional_multiplier(
            payload.get("aPlusRiskMultiplier"), "aPlusRiskMultiplier",
        ),
    }


# ── Persistence ──────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_settings(row: sqlite3.Row) -> dict[str, Any]:
    data = json.loads(row["data"])
    return {
        "id": row["id"],
        "userId": row["user_id"],
        **data,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_settings(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Return the user's settings, seeding defaults on first read."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id, user_id, data, created_at, updated_at FROM j2_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is not None:
            return _row_to_settings(row)

        # First read: seed defaults and return.
        now = _now_iso()
        new_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO j2_settings (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (new_id, user_id, json.dumps(default_settings_data()), now, now),
        )
        conn.commit()
        return {
            "id": new_id,
            "userId": user_id,
            **default_settings_data(),
            "createdAt": now,
            "updatedAt": now,
        }
    finally:
        if owned_conn:
            conn.close()


def upsert_settings(
    user_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Validate + persist the user's settings. Creates the row if missing."""
    validated = validate_settings_payload(payload)

    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        row = conn.execute(
            "SELECT id, created_at FROM j2_settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            new_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO j2_settings (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (new_id, user_id, json.dumps(validated), now, now),
            )
            conn.commit()
            return {
                "id": new_id,
                "userId": user_id,
                **validated,
                "createdAt": now,
                "updatedAt": now,
            }

        conn.execute(
            "UPDATE j2_settings SET data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(validated), now, row["id"]),
        )
        conn.commit()
        return {
            "id": row["id"],
            "userId": user_id,
            **validated,
            "createdAt": row["created_at"],
            "updatedAt": now,
        }
    finally:
        if owned_conn:
            conn.close()
