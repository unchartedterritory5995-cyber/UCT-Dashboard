"""
Journal 2.0 — Accounts (multi-portfolio model).

Each account is a self-contained trading book with its own settings
(accountSize, defaultStop, breakevenRange, setups, shareJournalData)
and its own balance baseline. j2_positions and j2_trades are stamped
with an `account_id` foreign key.

Migration: on first call to get_or_migrate_default_account() for a user,
creates a "Default" account from their existing j2_settings row + bulk-
assigns all their existing positions and trades to that account.
Idempotent — safe to call repeatedly.

Spec: docs/superpowers/specs/2026-04-18-accounts-design.md
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.filters import FilterSpec, trades_where


# 12-color curated palette — keys map to hex client-side.
COLOR_PALETTE = {
    "blue", "purple", "teal", "magenta", "orange", "lime",
    "cyan", "pink", "slate", "sky", "emerald", "amber",
}
_PALETTE_ROTATION = [
    "blue", "purple", "teal", "magenta", "orange", "lime",
    "cyan", "pink", "slate", "sky", "emerald", "amber",
]


class AccountValidationError(ValueError):
    """Raised when account-CRUD payload is malformed."""


class AccountConflictError(Exception):
    """409: account name collision OR has dependent rows when deleting."""

    def __init__(self, message: str, *, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.payload = payload or {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Settings defaults (mirrors single-row j2_settings shape) ──────────────────


_DEFAULT_ACCOUNT_SIZE = 100_000.0


def _default_settings_block() -> dict[str, Any]:
    """Settings dict used when creating a new account from scratch
    (no copy-source). Matches the system defaults that single-row
    j2_settings used pre-migration."""
    return {
        "accountSize": _DEFAULT_ACCOUNT_SIZE,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        # P5-A2: per-setup rule labels {setupName: [{id, label}]}
        "setupRules": {},
        "shareJournalData": False,
        "tradingMode": "both",
        "defaultSizePct": None,
        "defaultRMultipleTarget": None,
        "maxRiskPerTradePct": None,
        # Phase B — Session Discipline
        "dailyLossLimitPct": None,
        "coolingOffMinutesAfterLoss": None,
        "noTradeWindowsET": [],
        "aPlusSetups": [],
        "aPlusRiskMultiplier": None,
        "regimeSizeMultipliers": {},
        "mistakeTags": [],
        "emotionTags": [],
        "lossStreakThreshold": None,
        "winStreakThreshold": None,
        "staleHoldDaysThreshold": None,
        "traderProfile": "",
        "compassEnabled": True,
    }


# ── Migration ─────────────────────────────────────────────────────────────────


def _next_default_color(conn: sqlite3.Connection, user_id: str) -> str:
    """Pick the next color in rotation that isn't already in use by this
    user. Falls back to slate if all 12 are taken."""
    used = {
        r["color"]
        for r in conn.execute(
            "SELECT color FROM j2_accounts WHERE user_id = ?", (user_id,)
        ).fetchall()
    }
    for c in _PALETTE_ROTATION:
        if c not in used:
            return c
    return "slate"


def get_or_migrate_default_account(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Return the user's "Default" account, creating it (and migrating
    legacy data) on first call. Idempotent.

    Migration steps:
      1. If user has any j2_accounts row, return their first one (or
         "Default" if it exists). NO migration runs.
      2. Else: create "Default" from j2_settings (or system defaults if
         no settings row exists), bulk-assign all j2_positions and
         j2_trades for this user to it. Single transaction.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            """
            SELECT * FROM j2_accounts
             WHERE user_id = ?
             ORDER BY (CASE WHEN name='Default' THEN 0 ELSE 1 END), created_at ASC
             LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if existing:
            return _row_to_account(existing)

        # First-time migration. Read existing j2_settings (if any) to
        # carry over user's accountSize / defaultStop / breakevenRange /
        # setups / shareJournalData.
        settings_row = conn.execute(
            "SELECT data FROM j2_settings WHERE user_id = ?", (user_id,),
        ).fetchone()
        if settings_row:
            try:
                settings = json.loads(settings_row["data"]) or {}
            except json.JSONDecodeError:
                settings = {}
        else:
            settings = {}
        block = _default_settings_block()
        block.update({k: settings.get(k, v) for k, v in block.items()})

        new_id = str(uuid.uuid4())
        now = _now_iso()
        try:
            conn.execute("BEGIN")
            conn.execute(
                """
                INSERT INTO j2_accounts (
                    id, user_id, name, color, broker, starting_balance,
                    account_size, default_stop, position_closing,
                    breakeven_range, setups, share_journal_data,
                    trading_mode,
                    created_at, updated_at
                ) VALUES (?, ?, 'Default', 'blue', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id, user_id,
                    float(block["accountSize"]),  # starting_balance = current accountSize as a sane default
                    float(block["accountSize"]),
                    json.dumps(block["defaultStop"]),
                    block["positionClosing"],
                    json.dumps(block["breakevenRange"]),
                    json.dumps(block["setups"]),
                    1 if block.get("shareJournalData") else 0,
                    block.get("tradingMode", "both"),
                    now, now,
                ),
            )
            # Bulk-assign legacy rows
            conn.execute(
                "UPDATE j2_positions SET account_id = ? "
                "WHERE user_id = ? AND account_id IS NULL",
                (new_id, user_id),
            )
            conn.execute(
                "UPDATE j2_trades SET account_id = ? "
                "WHERE user_id = ? AND account_id IS NULL",
                (new_id, user_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_account(row)
    finally:
        if owned:
            conn.close()


# ── CRUD ──────────────────────────────────────────────────────────────────────


def list_accounts(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All accounts for a user, ordered by created_at."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_accounts WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_account(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_account(
    user_id: str,
    account_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """One account, or None if missing / belongs to another user."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        return _row_to_account(row) if row else None
    finally:
        if owned:
            conn.close()


def _validate_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise AccountValidationError("payload must be an object")
    name = payload.get("name", "")
    if not isinstance(name, str):
        raise AccountValidationError("name must be a string")
    name = name.strip()
    if not name or len(name) > 60:
        raise AccountValidationError("name must be 1-60 chars")
    color = payload.get("color")
    if color not in COLOR_PALETTE:
        raise AccountValidationError(f"color must be one of {sorted(COLOR_PALETTE)}")
    broker = payload.get("broker")
    if broker is not None and not isinstance(broker, str):
        raise AccountValidationError("broker must be string or null")
    if isinstance(broker, str):
        broker = broker.strip() or None
    starting = payload.get("startingBalance")
    if not isinstance(starting, (int, float)) or starting <= 0:
        raise AccountValidationError("startingBalance must be > 0")
    return {
        "name": name,
        "color": color,
        "broker": broker,
        "starting_balance": float(starting),
    }


def create_account(
    user_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Create a new account. Optional `copySettingsFrom` (existing
    account_id) clones that account's settings; otherwise system defaults."""
    validated = _validate_create_payload(payload)
    copy_from = payload.get("copySettingsFrom")

    owned = conn is None
    conn = conn or get_connection()
    try:
        # Name uniqueness check
        existing = conn.execute(
            "SELECT id FROM j2_accounts WHERE user_id = ? AND name = ?",
            (user_id, validated["name"]),
        ).fetchone()
        if existing:
            raise AccountConflictError(
                f"An account named '{validated['name']}' already exists"
            )

        # Settings to seed. Carry every Phase A–G column from the source
        # account so a copied account doesn't silently lose user-configured
        # guards, taxonomies, and multipliers. share_journal_data and
        # trader_profile are intentionally NOT copied (privacy + per-account
        # coach memory).
        def _src(src_row, col, default):
            if src_row is None:
                return default
            return src_row[col] if col in src_keys else default

        if copy_from:
            src = conn.execute(
                "SELECT * FROM j2_accounts WHERE id = ? AND user_id = ?",
                (copy_from, user_id),
            ).fetchone()
            if src is None:
                raise AccountValidationError("copySettingsFrom: account not found")
            src_keys = src.keys() if hasattr(src, "keys") else []
            settings = {
                "account_size": float(src["account_size"]),
                "default_stop": src["default_stop"],
                "position_closing": src["position_closing"],
                "breakeven_range": src["breakeven_range"],
                "setups": src["setups"],
                # P5-A2: carry per-setup rules alongside setups (consistent clone)
                "setup_rules": _src(src, "setup_rules", "{}"),
                "trading_mode": _src(src, "trading_mode", "both"),
                # Phase A
                "default_size_pct": _src(src, "default_size_pct", None),
                "default_r_multiple_target": _src(src, "default_r_multiple_target", None),
                "max_risk_per_trade_pct": _src(src, "max_risk_per_trade_pct", None),
                # Phase B
                "daily_loss_limit_pct": _src(src, "daily_loss_limit_pct", None),
                "cooling_off_minutes_after_loss": _src(src, "cooling_off_minutes_after_loss", None),
                "no_trade_windows_et": _src(src, "no_trade_windows_et", "[]"),
                # Phase C
                "a_plus_setups": _src(src, "a_plus_setups", "[]"),
                "a_plus_risk_multiplier": _src(src, "a_plus_risk_multiplier", None),
                # Phase D
                "regime_size_multipliers": _src(src, "regime_size_multipliers", "{}"),
                # Phase E
                "mistake_tags": _src(src, "mistake_tags", "[]"),
                "emotion_tags": _src(src, "emotion_tags", "[]"),
                # Phase F
                "loss_streak_threshold": _src(src, "loss_streak_threshold", None),
                "win_streak_threshold": _src(src, "win_streak_threshold", None),
                "stale_hold_days_threshold": _src(src, "stale_hold_days_threshold", None),
                # share_journal_data, trader_profile: intentionally NOT copied
            }
        else:
            block = _default_settings_block()
            settings = {
                "account_size": float(block["accountSize"]),
                "default_stop": json.dumps(block["defaultStop"]),
                "position_closing": block["positionClosing"],
                "breakeven_range": json.dumps(block["breakevenRange"]),
                "setups": json.dumps(block["setups"]),
                "setup_rules": json.dumps(block["setupRules"]),
                "trading_mode": block.get("tradingMode", "both"),
                # All Phase A–F defaults are None/empty in _default_settings_block
                "default_size_pct": None,
                "default_r_multiple_target": None,
                "max_risk_per_trade_pct": None,
                "daily_loss_limit_pct": None,
                "cooling_off_minutes_after_loss": None,
                "no_trade_windows_et": "[]",
                "a_plus_setups": "[]",
                "a_plus_risk_multiplier": None,
                "regime_size_multipliers": "{}",
                "mistake_tags": "[]",
                "emotion_tags": "[]",
                "loss_streak_threshold": None,
                "win_streak_threshold": None,
                "stale_hold_days_threshold": None,
            }

        new_id = str(uuid.uuid4())
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO j2_accounts (
                id, user_id, name, color, broker, starting_balance,
                account_size, default_stop, position_closing,
                breakeven_range, setups, setup_rules, share_journal_data,
                trading_mode,
                default_size_pct, default_r_multiple_target, max_risk_per_trade_pct,
                daily_loss_limit_pct, cooling_off_minutes_after_loss, no_trade_windows_et,
                a_plus_setups, a_plus_risk_multiplier,
                regime_size_multipliers,
                mistake_tags, emotion_tags,
                loss_streak_threshold, win_streak_threshold, stale_hold_days_threshold,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?,
                      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?)
            """,
            (
                new_id, user_id, validated["name"], validated["color"],
                validated["broker"], validated["starting_balance"],
                settings["account_size"], settings["default_stop"],
                settings["position_closing"], settings["breakeven_range"],
                settings["setups"], settings["setup_rules"],
                settings["trading_mode"],
                settings["default_size_pct"], settings["default_r_multiple_target"], settings["max_risk_per_trade_pct"],
                settings["daily_loss_limit_pct"], settings["cooling_off_minutes_after_loss"], settings["no_trade_windows_et"],
                settings["a_plus_setups"], settings["a_plus_risk_multiplier"],
                settings["regime_size_multipliers"],
                settings["mistake_tags"], settings["emotion_tags"],
                settings["loss_streak_threshold"], settings["win_streak_threshold"], settings["stale_hold_days_threshold"],
                now, now,
            ),
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_account(row)
    finally:
        if owned:
            conn.close()


def update_account(
    user_id: str,
    account_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Update name / color / broker / starting_balance. Settings are
    updated via the per-account settings endpoint (separate concern)."""
    if not isinstance(patch, dict):
        raise AccountValidationError("patch must be an object")

    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            return None

        sets = []
        params: list[Any] = []
        if "name" in patch:
            n = patch["name"]
            if not isinstance(n, str) or not n.strip() or len(n.strip()) > 60:
                raise AccountValidationError("name must be 1-60 chars")
            n = n.strip()
            # Uniqueness when renaming
            if n != row["name"]:
                clash = conn.execute(
                    "SELECT id FROM j2_accounts WHERE user_id = ? AND name = ?",
                    (user_id, n),
                ).fetchone()
                if clash:
                    raise AccountConflictError(
                        f"An account named '{n}' already exists"
                    )
            sets.append("name = ?"); params.append(n)
        if "color" in patch:
            c = patch["color"]
            if c not in COLOR_PALETTE:
                raise AccountValidationError(f"color must be one of {sorted(COLOR_PALETTE)}")
            sets.append("color = ?"); params.append(c)
        if "broker" in patch:
            b = patch["broker"]
            if b is not None and not isinstance(b, str):
                raise AccountValidationError("broker must be string or null")
            if isinstance(b, str):
                b = b.strip() or None
            sets.append("broker = ?"); params.append(b)
        if "startingBalance" in patch:
            s = patch["startingBalance"]
            if not isinstance(s, (int, float)) or s <= 0:
                raise AccountValidationError("startingBalance must be > 0")
            sets.append("starting_balance = ?"); params.append(float(s))

        if not sets:
            return _row_to_account(row)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([account_id, user_id])
        conn.execute(
            f"UPDATE j2_accounts SET {', '.join(sets)} "
            f"WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        new_row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ?", (account_id,)
        ).fetchone()
        return _row_to_account(new_row)
    finally:
        if owned:
            conn.close()


# Every table that stamps rows with (user_id, account_id). When an account is
# purged, all of its data is removed from each of these. j2_option_legs is not
# listed — it cascades from j2_option_strategies (PRAGMA foreign_keys=ON).
_ACCOUNT_SCOPED_TABLES = (
    "j2_positions",
    "j2_trades",
    "j2_option_strategies",
    "j2_notes",
    "j2_coach_outputs",
    "j2_chat_messages",
    "j2_onboarding_responses",
    "j2_verdicts",
    "j2_trade_reviews",
    "j2_interventions",
    "j2_profile_suggestions",
)


def _purge_account_scoped_data(
    conn: sqlite3.Connection, user_id: str, account_id: str
) -> dict[str, int]:
    """Delete every (user_id, account_id) row across all account-scoped
    tables. Caller owns the transaction. Tolerates schema drift: a table
    missing entirely (or lacking an account_id column) is skipped."""
    deleted: dict[str, int] = {}
    for table in _ACCOUNT_SCOPED_TABLES:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table,),
        ).fetchone()
        if not exists:
            continue
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if "account_id" not in cols or "user_id" not in cols:
            continue
        n = conn.execute(
            f"DELETE FROM {table} WHERE user_id = ? AND account_id = ?",
            (user_id, account_id),
        ).rowcount
        if n:
            deleted[table] = n
    return deleted


def delete_account(
    user_id: str,
    account_id: str,
    conn: sqlite3.Connection | None = None,
    *,
    purge: bool = False,
) -> bool:
    """Delete an account.

    By default, deletes ONLY if it has zero positions and zero trades —
    raises AccountConflictError with counts otherwise (the caller is
    expected to move trades elsewhere first).

    When ``purge=True``, the account's positions, trades, option
    strategies and all coach artifacts are deleted along with it — no
    move required. Either way, the user's last remaining account cannot
    be deleted.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            return False

        # Block deleting the user's last remaining account (checked before
        # any destructive purge so we never wipe data then refuse).
        remaining = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_accounts WHERE user_id = ?",
            (user_id,),
        ).fetchone()["n"]
        if remaining <= 1:
            raise AccountConflictError(
                "Cannot delete your only account. Create another first."
            )

        if not purge:
            pos_count = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_positions "
                "WHERE user_id = ? AND account_id = ?",
                (user_id, account_id),
            ).fetchone()["n"]
            trade_count = conn.execute(
                "SELECT COUNT(*) AS n FROM j2_trades "
                "WHERE user_id = ? AND account_id = ?",
                (user_id, account_id),
            ).fetchone()["n"]
            if pos_count > 0 or trade_count > 0:
                raise AccountConflictError(
                    "Account has positions or trades — move them first.",
                    payload={
                        "openPositionCount": pos_count,
                        "tradeCount": trade_count,
                    },
                )

        try:
            conn.execute("BEGIN")
            if purge:
                _purge_account_scoped_data(conn, user_id, account_id)
            conn.execute(
                "DELETE FROM j2_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return True
    finally:
        if owned:
            conn.close()


def move_all_to(
    user_id: str,
    source_id: str,
    target_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, int]:
    """Atomically reassign every position + trade from source to target."""
    if source_id == target_id:
        raise AccountValidationError("source and target must differ")

    owned = conn is None
    conn = conn or get_connection()
    try:
        # Both must belong to the user
        for acc_id in (source_id, target_id):
            row = conn.execute(
                "SELECT id FROM j2_accounts WHERE id = ? AND user_id = ?",
                (acc_id, user_id),
            ).fetchone()
            if row is None:
                raise AccountValidationError(f"account {acc_id} not found")

        try:
            conn.execute("BEGIN")
            pos = conn.execute(
                "UPDATE j2_positions SET account_id = ? "
                "WHERE user_id = ? AND account_id = ?",
                (target_id, user_id, source_id),
            ).rowcount
            tr = conn.execute(
                "UPDATE j2_trades SET account_id = ? "
                "WHERE user_id = ? AND account_id = ?",
                (target_id, user_id, source_id),
            ).rowcount
            conn.commit()
            return {"movedPositions": pos, "movedTrades": tr}
        except Exception:
            conn.rollback()
            raise
    finally:
        if owned:
            conn.close()


# ── Comparison aggregation ────────────────────────────────────────────────────


def comparison(
    user_id: str,
    conn: sqlite3.Connection | None = None,
    *,
    spec: FilterSpec | None = None,
) -> dict[str, Any]:
    """Per-account aggregate metrics for the Comparison view.

    Scope (Task A4): a passed ``spec`` scopes each account's trade-derived
    metrics (via ``trades_where`` in ``_account_metrics``) — the full non-date +
    date facets. Broker equity/return resolution is unchanged (account-row based,
    not trade-derived). Absent ``spec`` → behavior identical to before."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        from api.services.journal_two.broker.balance_resolver import resolve_equity
        accounts = list_accounts(user_id, conn=conn)
        out = []
        for a in accounts:
            metrics = _account_metrics(
                user_id, a["id"], a["startingBalance"], conn, spec=spec,
            )
            # Balance resolver chokepoint: broker-linked accounts report real
            # broker equity; manual accounts keep startingBalance + realized P&L
            # (identical to the prior currentBalance math → no regression).
            eq = resolve_equity(a, realized_pnl=metrics["totalPnl"])
            # Broker accounts report the cash-flow-adjusted TWR (deposit/
            # withdrawal-neutral); manual accounts keep the realized-P&L return.
            total_return = metrics["totalReturn"]
            if eq["source"] == "broker":
                try:
                    from api.services.journal_two.broker.performance_service import (
                        account_performance,
                    )
                    perf = account_performance(user_id, a["id"], "ALL", conn=conn)
                    if perf.get("timeWeighted") is not None:
                        total_return = perf["timeWeighted"]
                except Exception:
                    pass  # fall back to realized-P&L return on any hiccup
            out.append({
                "id": a["id"],
                "name": a["name"],
                "color": a["color"],
                "currentBalance": eq["equity"],
                "balanceSource": eq["source"],
                "brokerCash": eq["cash"],
                "brokerBuyingPower": eq["buyingPower"],
                "brokerMarketValue": eq["marketValue"],
                "balanceSyncedAt": eq["syncedAt"],
                "startingBalance": a["startingBalance"],
                "totalReturn": total_return,
                "totalPnl": metrics["totalPnl"],
                "tradeCount": metrics["tradeCount"],
                "winRate": metrics["winRate"],
                "profitFactor": metrics["profitFactor"],
                "maxDrawdown": metrics["maxDrawdown"],
                "maxDrawdownPct": metrics["maxDrawdownPct"],
                "avgWin": metrics["avgWin"],
                "avgLoss": metrics["avgLoss"],
                "expectancy": metrics["expectancy"],
            })
        return {"accounts": out}
    finally:
        if owned:
            conn.close()


def _account_metrics(
    user_id: str,
    account_id: str,
    starting_balance: float,
    conn: sqlite3.Connection,
    *,
    spec: FilterSpec | None = None,
) -> dict[str, Any]:
    sql = (
        "SELECT pnl_dollar, result, exit_date "
        "  FROM j2_trades "
        " WHERE user_id = ? AND account_id = ? "
        # FIX-C: account stat aggregate — skip trades the reconstruction can't
        # vouch for (phantom short / user opt-out). The list still shows them.
        "   AND (analytics_excluded IS NULL OR analytics_excluded = 0)"
    )
    params: list[Any] = [user_id, account_id]
    if spec is not None:
        frag, filter_params = trades_where(spec)
        if frag:
            sql += " " + frag
            params.extend(filter_params)
    sql += " ORDER BY exit_date ASC"
    rows = conn.execute(sql, params).fetchall()

    if not rows:
        return {
            "currentBalance": starting_balance,
            "totalReturn": 0.0,
            "totalPnl": 0.0,
            "tradeCount": 0,
            "winRate": None,
            "profitFactor": None,
            "maxDrawdown": 0.0,
            "maxDrawdownPct": 0.0,
            "avgWin": None,
            "avgLoss": None,
            "expectancy": None,
        }

    pnls = [float(r["pnl_dollar"] or 0) for r in rows]
    wins = [p for p, r in zip(pnls, rows) if r["result"] == "Win"]
    losses = [p for p, r in zip(pnls, rows) if r["result"] == "Loss"]
    bes = [p for p, r in zip(pnls, rows) if r["result"] == "BE"]

    total_pnl = sum(pnls)
    current_balance = starting_balance + total_pnl
    total_return = total_pnl / starting_balance if starting_balance > 0 else 0.0

    win_loss_total = len(wins) + len(losses)
    win_rate = len(wins) / win_loss_total if win_loss_total > 0 else None

    avg_win = sum(wins) / len(wins) if wins else None
    avg_loss = sum(losses) / len(losses) if losses else None

    sum_wins = sum(wins)
    sum_losses = abs(sum(losses)) if losses else 0
    if sum_losses == 0:
        profit_factor = None if sum_wins == 0 else None  # ∞ → null
    else:
        profit_factor = sum_wins / sum_losses

    expectancy = total_pnl / len(pnls) if pnls else None

    # Drawdown — running peak vs current
    peak = starting_balance
    max_dd = 0.0
    max_dd_pct = 0.0
    running = starting_balance
    for p in pnls:
        running += p
        if running > peak:
            peak = running
        dd = running - peak
        dd_pct = (dd / peak) if peak > 0 else 0.0
        if dd < max_dd:
            max_dd = dd
            max_dd_pct = dd_pct

    return {
        "currentBalance": current_balance,
        "totalReturn": total_return,
        "totalPnl": total_pnl,
        "tradeCount": len(pnls),
        "winRate": win_rate,
        "profitFactor": profit_factor,
        "maxDrawdown": max_dd,
        "maxDrawdownPct": max_dd_pct,
        "avgWin": avg_win,
        "avgLoss": avg_loss,
        "expectancy": expectancy,
    }


# ── Goal progress (current-period P&L vs target) ────────────────────────────


def goal_progress(
    user_id: str,
    account_id: str,
    conn: sqlite3.Connection | None = None,
    *,
    spec: FilterSpec | None = None,
) -> dict[str, Any] | None:
    """Return current Daily/Weekly/Monthly/Yearly P&L totals + each
    goal's percentage. Buckets each trade on its ET trading-session day via
    the shared calendar._row_et_day spine (stamped trading_day_et when present,
    else to_et_date(exit_date)) so Goals agree with Calendar/Analytics.

    Scope (Task A4): a passed ``spec`` splices the full FilterSpec WHERE fragment
    (date spine + symbol/sides/setups/tags via ``trades_where``) after the base
    predicate — this surface is date-bucketed on the spine, so the full facets
    apply. Absent ``spec`` → behavior identical to before.
    """
    from datetime import date as Date, timedelta
    from api.services.journal_two.calendar import _row_et_day, ET

    owned = conn is None
    conn = conn or get_connection()
    try:
        acc = get_account(user_id, account_id, conn=conn)
        if not acc:
            return None

        now_et = datetime.now(ET)
        today_et = now_et.date()
        # Week starts Monday
        monday = today_et - timedelta(days=today_et.weekday())
        month_start = today_et.replace(day=1)
        year_start = today_et.replace(month=1, day=1)

        sql = (
            "SELECT exit_date, trading_day_et, pnl_dollar "
            "  FROM j2_trades "
            " WHERE user_id = ? AND account_id = ? "
            "   AND exit_date >= ? "
            # FIX-C: goal P&L aggregate excludes unvouched trades.
            "   AND (analytics_excluded IS NULL OR analytics_excluded = 0)"
        )
        params: list[Any] = [
            user_id, account_id, year_start.isoformat() + "T00:00:00Z",
        ]
        if spec is not None:
            frag, filter_params = trades_where(spec)
            if frag:
                sql += " " + frag
                params.extend(filter_params)
        rows = conn.execute(sql, params).fetchall()

        daily_pnl = 0.0
        weekly_pnl = 0.0
        monthly_pnl = 0.0
        yearly_pnl = 0.0
        for r in rows:
            d_str = _row_et_day(r, "exit_date")
            d = Date.fromisoformat(d_str)
            pnl = float(r["pnl_dollar"] or 0)
            if d >= year_start:
                yearly_pnl += pnl
            if d >= month_start:
                monthly_pnl += pnl
            if d >= monday:
                weekly_pnl += pnl
            if d == today_et:
                daily_pnl += pnl

        goals = acc.get("goals") or {}

        def pct(pnl, target):
            if not target or target <= 0:
                return None
            return round(pnl / target, 4)

        return {
            "accountId": account_id,
            "periods": {
                "daily":   {"pnl": round(daily_pnl, 2),   "target": goals.get("daily"),   "progress": pct(daily_pnl, goals.get("daily"))},
                "weekly":  {"pnl": round(weekly_pnl, 2),  "target": goals.get("weekly"),  "progress": pct(weekly_pnl, goals.get("weekly"))},
                "monthly": {"pnl": round(monthly_pnl, 2), "target": goals.get("monthly"), "progress": pct(monthly_pnl, goals.get("monthly"))},
                "yearly":  {"pnl": round(yearly_pnl, 2),  "target": goals.get("yearly"),  "progress": pct(yearly_pnl, goals.get("yearly"))},
            },
        }
    finally:
        if owned:
            conn.close()


# ── Per-account settings ─────────────────────────────────────────────────────


def get_account_settings(
    user_id: str,
    account_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Return the settings block for one account. If account_id is None,
    returns the user's Default account (auto-creates via migration)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if account_id:
            acc = get_account(user_id, account_id, conn=conn)
            if not acc:
                return None
        else:
            acc = get_or_migrate_default_account(user_id, conn=conn)
        return _account_to_settings(acc, conn=conn)
    finally:
        if owned:
            conn.close()


def upsert_account_settings(
    user_id: str,
    account_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Update one account's settings. Reuses validators from the legacy
    settings service so the existing canonical shape rules apply."""
    from api.services.journal_two import settings as legacy_settings

    # Reuse legacy validators (per-stop, per-breakeven, per-setups)
    full_validated = legacy_settings.validate_settings_payload(payload)

    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            raise AccountValidationError("Account not found")

        now = _now_iso()
        conn.execute(
            """
            UPDATE j2_accounts
               SET account_size = ?, default_stop = ?, position_closing = ?,
                   breakeven_range = ?, setups = ?, setup_rules = ?,
                   share_journal_data = ?,
                   trading_mode = ?,
                   default_size_pct = ?,
                   default_r_multiple_target = ?,
                   max_risk_per_trade_pct = ?,
                   daily_loss_limit_pct = ?,
                   cooling_off_minutes_after_loss = ?,
                   no_trade_windows_et = ?,
                   a_plus_setups = ?,
                   a_plus_risk_multiplier = ?,
                   regime_size_multipliers = ?,
                   mistake_tags = ?,
                   emotion_tags = ?,
                   loss_streak_threshold = ?,
                   win_streak_threshold = ?,
                   stale_hold_days_threshold = ?,
                   compass_enabled = ?,
                   updated_at = ?
             WHERE id = ? AND user_id = ?
            """,
            (
                float(full_validated["accountSize"]),
                json.dumps(full_validated["defaultStop"]),
                full_validated["positionClosing"],
                json.dumps(full_validated["breakevenRange"]),
                json.dumps(full_validated["setups"]),
                json.dumps(full_validated.get("setupRules", {})),
                1 if full_validated.get("shareJournalData") else 0,
                full_validated.get("tradingMode", "both"),
                full_validated.get("defaultSizePct"),
                full_validated.get("defaultRMultipleTarget"),
                full_validated.get("maxRiskPerTradePct"),
                full_validated.get("dailyLossLimitPct"),
                full_validated.get("coolingOffMinutesAfterLoss"),
                json.dumps(full_validated.get("noTradeWindowsET", [])),
                json.dumps(full_validated.get("aPlusSetups", [])),
                full_validated.get("aPlusRiskMultiplier"),
                json.dumps(full_validated.get("regimeSizeMultipliers", {})),
                json.dumps(full_validated.get("mistakeTags", [])),
                json.dumps(full_validated.get("emotionTags", [])),
                full_validated.get("lossStreakThreshold"),
                full_validated.get("winStreakThreshold"),
                full_validated.get("staleHoldDaysThreshold"),
                1 if full_validated.get("compassEnabled", True) else 0,
                now, account_id, user_id,
            ),
        )
        conn.commit()
        acc = get_account(user_id, account_id, conn=conn)
        return _account_to_settings(acc, conn=conn)
    finally:
        if owned:
            conn.close()


# ── Row → dict ───────────────────────────────────────────────────────────────


def _row_to_account(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys() if hasattr(row, "keys") else []
    goals_raw = row["goals"] if "goals" in keys else None
    try:
        goals = json.loads(goals_raw) if goals_raw else {}
    except (TypeError, json.JSONDecodeError):
        goals = {}
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "color": row["color"],
        "broker": row["broker"],
        "startingBalance": float(row["starting_balance"]),
        "goals": goals,
        "compassEnabled": (
            bool(row["compass_enabled"]) if "compass_enabled" in keys else True
        ),
        # Broker-sync balance fields (null on manual accounts; populated by the
        # broker balances sync). Consumed by balance_resolver.
        "balanceSource": row["balance_source"] if "balance_source" in keys else "manual",
        "brokerTotalEquity": row["broker_total_equity"] if "broker_total_equity" in keys else None,
        "brokerCash": row["broker_cash"] if "broker_cash" in keys else None,
        "brokerBuyingPower": row["broker_buying_power"] if "broker_buying_power" in keys else None,
        "brokerMarketValue": row["broker_market_value"] if "broker_market_value" in keys else None,
        "brokerBalanceSyncedAt": row["broker_balance_synced_at"] if "broker_balance_synced_at" in keys else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ── Goals (Phase 4) ──────────────────────────────────────────────────────────


_GOAL_KEYS = {"daily", "weekly", "monthly", "yearly"}


def update_goals(
    user_id: str,
    account_id: str,
    goals: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Set this account's Daily/Weekly/Monthly/Yearly target $ values.
    Unrecognized keys are dropped; non-numeric values raise."""
    if not isinstance(goals, dict):
        raise AccountValidationError("goals must be an object")
    cleaned: dict[str, float] = {}
    for k, v in goals.items():
        if k not in _GOAL_KEYS:
            continue
        if v is None or v == "":
            continue
        if not isinstance(v, (int, float)):
            raise AccountValidationError(f"goals.{k} must be a number")
        if v < 0:
            raise AccountValidationError(f"goals.{k} must be >= 0")
        cleaned[k] = float(v)

    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE j2_accounts SET goals = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (json.dumps(cleaned), _now_iso(), account_id, user_id),
        )
        conn.commit()
        return get_account(user_id, account_id, conn=conn)
    finally:
        if owned:
            conn.close()


def _account_to_settings(acc: dict[str, Any], *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Translate a j2_accounts row to the canonical settings shape that
    PortfolioSettingsModal + downstream services expect.

    Accepts an optional `conn` to reuse the caller's transaction context.
    When called without `conn`, opens its own connection."""
    if acc is None:
        return None
    # Re-fetch the full row to get the settings columns (acc was built from
    # _row_to_account which strips them — separation of concerns).
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_accounts WHERE id = ?", (acc["id"],)
        ).fetchone()
        if row is None:
            return None
        keys = row.keys() if hasattr(row, "keys") else []
        return {
            "id": row["id"],
            "userId": row["user_id"],
            "accountId": row["id"],
            "accountName": row["name"],
            "accountSize": float(row["account_size"]),
            "defaultStop": json.loads(row["default_stop"]),
            "positionClosing": row["position_closing"],
            "breakevenRange": json.loads(row["breakeven_range"]),
            "setups": json.loads(row["setups"]),
            "setupRules": json.loads(row["setup_rules"]) if "setup_rules" in keys else {},
            "shareJournalData": bool(row["share_journal_data"]),
            "tradingMode": row["trading_mode"] if "trading_mode" in keys else "both",
            "defaultSizePct": row["default_size_pct"] if "default_size_pct" in keys else None,
            "defaultRMultipleTarget": row["default_r_multiple_target"] if "default_r_multiple_target" in keys else None,
            "maxRiskPerTradePct": row["max_risk_per_trade_pct"] if "max_risk_per_trade_pct" in keys else None,
            "dailyLossLimitPct": row["daily_loss_limit_pct"] if "daily_loss_limit_pct" in keys else None,
            "coolingOffMinutesAfterLoss": row["cooling_off_minutes_after_loss"] if "cooling_off_minutes_after_loss" in keys else None,
            "noTradeWindowsET": json.loads(row["no_trade_windows_et"]) if "no_trade_windows_et" in keys else [],
            "aPlusSetups": json.loads(row["a_plus_setups"]) if "a_plus_setups" in keys else [],
            "aPlusRiskMultiplier": row["a_plus_risk_multiplier"] if "a_plus_risk_multiplier" in keys else None,
            "regimeSizeMultipliers": json.loads(row["regime_size_multipliers"]) if "regime_size_multipliers" in keys else {},
            "mistakeTags": json.loads(row["mistake_tags"]) if "mistake_tags" in keys else [],
            "emotionTags": json.loads(row["emotion_tags"]) if "emotion_tags" in keys else [],
            "lossStreakThreshold": row["loss_streak_threshold"] if "loss_streak_threshold" in keys else None,
            "winStreakThreshold": row["win_streak_threshold"] if "win_streak_threshold" in keys else None,
            "staleHoldDaysThreshold": row["stale_hold_days_threshold"] if "stale_hold_days_threshold" in keys else None,
            "traderProfile": row["trader_profile"] if "trader_profile" in keys else "",
            "compassEnabled": bool(row["compass_enabled"]) if "compass_enabled" in keys else True,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
    finally:
        if owned:
            conn.close()
