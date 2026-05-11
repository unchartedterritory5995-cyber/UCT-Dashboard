"""
Voice write tools — two-phase preview/confirm for journal writes.

Each preview function:
  - validates args (sanity checks on numbers)
  - resolves user-facing aliases where possible
  - returns {action_id, narration, tool} — the model speaks the narration,
    waits for the user to confirm, then calls confirm_action(action_id)

Each confirm function:
  - executes the real journal write via existing services
  - returns {ok, summary|error}
"""

import logging

from api.services.voice_action_signer import sign_action

_log = logging.getLogger(__name__)


# ── Shared sanity checks ───────────────────────────────────────────────────

MAX_SHARES = 100_000
MIN_PRICE = 0.01
MAX_PRICE = 1_000_000


def _check_shares(shares) -> int:
    try:
        s = int(shares)
    except (TypeError, ValueError):
        raise ValueError("shares must be an integer")
    if not (1 <= s <= MAX_SHARES):
        raise ValueError(f"shares must be between 1 and {MAX_SHARES}")
    return s


def _check_price(value, name: str) -> float:
    try:
        p = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")
    if not (MIN_PRICE <= p <= MAX_PRICE):
        raise ValueError(f"{name} must be between {MIN_PRICE} and {MAX_PRICE}")
    return p


def _calc_risk(shares: int, entry: float, stop: float) -> float:
    return round(abs(entry - stop) * shares, 2)


# ── create_position ────────────────────────────────────────────────────────

def preview_create_position(
    *, user_id: str, account: str, symbol: str,
    shares, entry, stop, target=None, setup: str = "", notes: str = "",
) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    s = _check_shares(shares)
    e = _check_price(entry, "entry")
    st = _check_price(stop, "stop")
    tg = _check_price(target, "target") if target is not None else None
    acct = (account or "default").strip()
    risk = _calc_risk(s, e, st)

    narration = (
        f"Logging {sym} long, {s} shares at {e:.2f}, stop {st:.2f}, "
        f"risk {risk} dollars, in {acct}. Confirm?"
    )

    action_id = sign_action(
        tool="create_position",
        args={"user_id": user_id, "account": acct, "symbol": sym,
              "shares": s, "entry": e, "stop": st, "target": tg,
              "setup": setup or "", "notes": notes or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "create_position"}


def confirm_create_position(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import create_entry
    except ImportError:
        return {"ok": False, "error": "journal service not available"}

    try:
        entry_id = create_entry(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            direction="long",
            setup=payload_args.get("setup") or "",
            entry_price=payload_args["entry"],
            stop_price=payload_args["stop"],
            target_price=payload_args.get("target"),
            status="open",
            notes=payload_args.get("notes") or "",
        )
        return {"ok": True, "entry_id": entry_id, "summary": "Position logged."}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_create_position failed")
        return {"ok": False, "error": str(e)}


# ── close_position ─────────────────────────────────────────────────────────

def preview_close_position(*, user_id: str, symbol: str, exit, partial: bool = False,
                           account: str = "") -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    ex = _check_price(exit, "exit")

    narration = (
        f"Closing {sym} at {ex:.2f}{', partial' if partial else ''}. Confirm?"
    )
    action_id = sign_action(
        tool="close_position",
        args={"user_id": user_id, "symbol": sym, "exit": ex,
              "partial": bool(partial), "account": account or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "close_position"}


def confirm_close_position(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import close_entry_by_symbol
    except (ImportError, AttributeError):
        return {"ok": False, "error": "close API not available"}
    try:
        result = close_entry_by_symbol(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            exit_price=payload_args["exit"],
            partial=payload_args.get("partial", False),
        )
        return {"ok": True, "summary": "Closed.", "result": result}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── update_position ────────────────────────────────────────────────────────

ALLOWED_UPDATE_FIELDS = {"stop_price", "target_price", "notes"}


def preview_update_position(*, user_id: str, symbol: str, field: str, value) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    field = (field or "").lower().strip()
    if field in {"stop", "target"}:
        field = field + "_price"
    if field not in ALLOWED_UPDATE_FIELDS:
        raise ValueError(f"field must be one of {sorted(ALLOWED_UPDATE_FIELDS)}")
    if field in {"stop_price", "target_price"}:
        v = _check_price(value, field)
    else:
        v = str(value)[:1000]

    narration = f"Updating {sym} {field} to {v}. Confirm?"
    action_id = sign_action(
        tool="update_position",
        args={"user_id": user_id, "symbol": sym, "field": field, "value": v},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "update_position"}


def confirm_update_position(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import update_entry_field_by_symbol
    except (ImportError, AttributeError):
        return {"ok": False, "error": "update API not available"}
    try:
        update_entry_field_by_symbol(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            field=payload_args["field"],
            value=payload_args["value"],
        )
        return {"ok": True, "summary": "Updated."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── add_daily_note ─────────────────────────────────────────────────────────

def preview_add_daily_note(*, user_id: str, text: str, emotion: str = "",
                           date: str = "") -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("note text is required")
    text = text[:2000]

    narration = f"Adding daily note: {text[:100]}{'...' if len(text) > 100 else ''}. Confirm?"
    action_id = sign_action(
        tool="add_daily_note",
        args={"user_id": user_id, "text": text, "emotion": emotion or "", "date": date or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "add_daily_note"}


def confirm_add_daily_note(payload_args: dict) -> dict:
    try:
        from api.services.daily_journal_service import add_daily_note
    except (ImportError, AttributeError):
        return {"ok": False, "error": "daily journal API not available"}
    try:
        add_daily_note(
            user_id=payload_args["user_id"],
            text=payload_args["text"],
            emotion=payload_args.get("emotion") or None,
            date=payload_args.get("date") or None,
        )
        return {"ok": True, "summary": "Note added."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── log_mistake ────────────────────────────────────────────────────────────

def preview_log_mistake(*, user_id: str, mistake_type: str, text: str,
                        symbol: str = "") -> dict:
    text = (text or "").strip()[:2000]
    mt = (mistake_type or "").strip().lower()
    if not mt:
        raise ValueError("mistake_type is required")
    sym = (symbol or "").upper().strip()

    narration = (
        f"Logging mistake: {mt}. {text[:80]}{'...' if len(text) > 80 else ''}. Confirm?"
    )
    action_id = sign_action(
        tool="log_mistake",
        args={"user_id": user_id, "mistake_type": mt, "text": text, "symbol": sym},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "log_mistake"}


def confirm_log_mistake(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import log_mistake_entry
    except (ImportError, AttributeError):
        return {"ok": False, "error": "mistake-logging API not available"}
    try:
        log_mistake_entry(
            user_id=payload_args["user_id"],
            mistake_type=payload_args["mistake_type"],
            text=payload_args["text"],
            symbol=payload_args.get("symbol") or "",
        )
        return {"ok": True, "summary": "Mistake logged."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── Confirm dispatcher ─────────────────────────────────────────────────────

CONFIRMERS = {
    "create_position": confirm_create_position,
    "close_position": confirm_close_position,
    "update_position": confirm_update_position,
    "add_daily_note": confirm_add_daily_note,
    "log_mistake": confirm_log_mistake,
}


def run_confirm(tool: str, payload_args: dict) -> dict:
    fn = CONFIRMERS.get(tool)
    if fn is None:
        return {"ok": False, "error": f"unknown tool for confirm: {tool}"}
    return fn(payload_args)
