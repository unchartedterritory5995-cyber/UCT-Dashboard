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
from datetime import date as _date

from api.services.voice_action_signer import sign_action

_log = logging.getLogger(__name__)


def _today_iso() -> str:
    return _date.today().isoformat()


def _find_open_entry_by_symbol(user_id: str, sym: str) -> dict | None:
    """Find the most recent open journal entry for a given symbol."""
    try:
        from api.services.journal_service import list_entries
    except ImportError:
        return None
    result = list_entries(
        user_id,
        filters={"sym": sym.upper(), "status": "open"},
        limit=10,
    ) or {}
    trades = result.get("trades") or []
    return trades[0] if trades else None


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
        data = {
            "sym": payload_args["symbol"],
            "direction": "long",
            "status": "open",
            "setup": payload_args.get("setup") or "",
            "entry_price": payload_args["entry"],
            "stop_price": payload_args["stop"],
            "target_price": payload_args.get("target"),
            "notes": payload_args.get("notes") or "",
            "account": payload_args.get("account") or "default",
            "entry_date": _today_iso(),
            "asset_class": "equity",
        }
        entry = create_entry(payload_args["user_id"], data)
        return {
            "ok": True,
            "entry_id": entry.get("id") if entry else None,
            "summary": "Position logged.",
        }
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
        from api.services.journal_service import update_entry
    except ImportError:
        return {"ok": False, "error": "journal service not available"}

    sym = payload_args["symbol"]
    entry = _find_open_entry_by_symbol(payload_args["user_id"], sym)
    if not entry:
        return {"ok": False, "error": f"no open position found for {sym}"}

    try:
        update_entry(payload_args["user_id"], entry["id"], {
            "status": "closed",
            "exit_price": payload_args["exit"],
            "exit_date": _today_iso(),
        })
        return {"ok": True, "summary": f"{sym} closed at {payload_args['exit']}.",
                "entry_id": entry["id"]}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_close_position failed")
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
        from api.services.journal_service import update_entry
    except ImportError:
        return {"ok": False, "error": "journal service not available"}

    sym = payload_args["symbol"]
    entry = _find_open_entry_by_symbol(payload_args["user_id"], sym)
    if not entry:
        return {"ok": False, "error": f"no open position found for {sym}"}

    try:
        update_entry(payload_args["user_id"], entry["id"], {
            payload_args["field"]: payload_args["value"],
        })
        return {"ok": True, "summary": f"{sym} {payload_args['field']} updated.",
                "entry_id": entry["id"]}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_update_position failed")
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
    """Append a voice-captured note to today's daily journal (midday_notes field)."""
    try:
        from api.services.daily_journal_service import get_or_create_daily, update_daily
    except ImportError:
        return {"ok": False, "error": "daily journal service not available"}

    user_id = payload_args["user_id"]
    date_iso = payload_args.get("date") or _today_iso()
    new_text = payload_args["text"]
    emotion = (payload_args.get("emotion") or "").strip()

    try:
        # Append rather than overwrite — preserve any existing notes
        existing = get_or_create_daily(user_id, date_iso) or {}
        prev = (existing.get("midday_notes") or "").strip()
        appended = f"{prev}\n\n{new_text}".strip() if prev else new_text
        if emotion:
            appended = f"{appended}  [feeling: {emotion}]"
        update_data = {"midday_notes": appended}
        if emotion:
            # Also stash emotion separately if the field exists
            update_data["emotional_state"] = emotion
        update_daily(user_id, date_iso, update_data)
        return {"ok": True, "summary": f"Note added to {date_iso} journal."}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_add_daily_note failed")
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
    """
    Log a mistake. Strategy:
    1. If a symbol is given AND an open journal entry for it exists, append
       the mistake to that entry's mistake_tags + notes.
    2. Otherwise, write the mistake to today's daily journal `did_poorly` field
       (the natural home for self-coaching mistake notes).
    """
    user_id = payload_args["user_id"]
    mt = payload_args["mistake_type"]
    text = payload_args.get("text") or ""
    sym = (payload_args.get("symbol") or "").upper().strip()
    mistake_line = f"{mt}: {text}" if text else mt

    # Strategy 1: attach to an existing open entry if user named a symbol
    if sym:
        entry = _find_open_entry_by_symbol(user_id, sym)
        if entry:
            try:
                from api.services.journal_service import update_entry
                prev_tags = (entry.get("mistake_tags") or "").strip()
                new_tags = ",".join(t for t in [prev_tags, mt] if t)
                prev_notes = (entry.get("notes") or "").strip()
                new_notes = f"{prev_notes}\n\nMistake: {mistake_line}".strip() if prev_notes else f"Mistake: {mistake_line}"
                update_entry(user_id, entry["id"], {
                    "mistake_tags": new_tags,
                    "notes": new_notes,
                })
                return {"ok": True, "summary": f"Mistake tagged on {sym} entry.",
                        "entry_id": entry["id"]}
            except Exception as e:  # noqa: BLE001
                _log.exception("confirm_log_mistake: update_entry failed; falling through to daily")

    # Strategy 2: write to today's daily journal "did_poorly"
    try:
        from api.services.daily_journal_service import get_or_create_daily, update_daily
        date_iso = _today_iso()
        existing = get_or_create_daily(user_id, date_iso) or {}
        prev = (existing.get("did_poorly") or "").strip()
        appended = f"{prev}\n{mistake_line}".strip() if prev else mistake_line
        update_daily(user_id, date_iso, {"did_poorly": appended})
        return {"ok": True, "summary": "Mistake logged in today's journal."}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_log_mistake: daily fallback failed")
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
