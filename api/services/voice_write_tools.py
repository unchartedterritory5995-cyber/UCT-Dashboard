"""
Voice write tools — two-phase preview/confirm for Journal 2.0 writes.

All confirm functions write to Journal 2.0 (j2_positions, j2_trades,
j2_day_notes). The original Journal is NOT touched.

Each preview function:
  - validates args (sanity checks on numbers)
  - resolves user-facing aliases where possible
  - returns {action_id, narration, tool} — the model speaks the narration,
    waits for the user to confirm, then calls confirm_action(action_id)

Each confirm function:
  - executes the real J2 write via journal_two services
  - returns {ok, summary|error}
"""

import logging
from datetime import date as _date

from api.services.voice_action_signer import sign_action

_log = logging.getLogger(__name__)


def _today_iso() -> str:
    return _date.today().isoformat()


def _find_open_j2_position_by_symbol(user_id: str, sym: str) -> dict | None:
    """Find the most recent open Journal 2.0 position for a given symbol."""
    try:
        from api.services.journal_two import positions as j2_positions
    except ImportError:
        return None
    try:
        positions = j2_positions.list_open_positions(user_id) or []
    except Exception:  # noqa: BLE001
        return None
    sym_upper = (sym or "").upper()
    for pos in positions:
        if (pos.get("symbol") or "").upper() == sym_upper:
            return pos
    return None


# Backward-compat alias — kept in case anything else imports the old name.
_find_open_entry_by_symbol = _find_open_j2_position_by_symbol


def _resolve_account_id(user_id: str, account_name: str | None) -> str:
    """Resolve a voice-supplied account name to a J2 account_id.

    Strategy:
    - If account_name is None / empty / "default" → default account.
    - Else look for an account whose displayName (case-insensitive) matches; if not, default.
    """
    from api.services.journal_two import accounts as j2_accounts

    name = (account_name or "").strip().lower()
    if not name or name == "default":
        return j2_accounts.get_or_migrate_default_account(user_id)["id"]
    accs = j2_accounts.list_accounts(user_id) or []
    for acc in accs:
        if (acc.get("displayName") or "").lower() == name or (acc.get("name") or "").lower() == name:
            return acc["id"]
    # Fall back to default if no match
    return j2_accounts.get_or_migrate_default_account(user_id)["id"]


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
    # target is accepted at preview-time for backwards compat with the
    # voice tool surface, but J2 positions have no target column — we
    # silently drop it at confirm time.
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
        from api.services.journal_two import positions as j2_positions
    except ImportError:
        return {"ok": False, "error": "Journal 2.0 not available"}

    try:
        user_id = payload_args["user_id"]
        account_id = _resolve_account_id(user_id, payload_args.get("account"))
        position = j2_positions.create_position(
            user_id=user_id,
            payload={
                "symbol": payload_args["symbol"],
                "side": "Long",                         # voice tool defaults to long; keep
                "entryDate": _today_iso(),
                "shares": payload_args["shares"],
                "entryPrice": payload_args["entry"],
                "stopPrice": payload_args["stop"],
                "setup": payload_args.get("setup") or None,
                "notes": payload_args.get("notes") or None,
            },
            context_at_entry={},
            account_id=account_id,
        )
        return {
            "ok": True,
            "position_id": position.get("id") if position else None,
            "summary": "Position logged in Journal 2.0.",
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
        from api.services.journal_two import trades as j2_trades
        from api.services.journal_two import accounts as j2_accounts
    except ImportError:
        return {"ok": False, "error": "Journal 2.0 not available"}

    sym = payload_args["symbol"]
    user_id = payload_args["user_id"]
    pos = _find_open_j2_position_by_symbol(user_id, sym)
    if not pos:
        return {"ok": False, "error": f"no open position found for {sym}"}

    try:
        user_settings = j2_accounts.get_account_settings(user_id) or {}
        if "breakevenRange" not in user_settings:
            user_settings["breakevenRange"] = 0.001   # 0.1% default — matches J2 default
        result = j2_trades.close_position(
            user_id=user_id,
            position_id=pos["id"],
            payload={
                "shares": pos["shares"],
                "exitPrice": payload_args["exit"],
                "exitDate": _today_iso(),
                "notes": payload_args.get("notes") or None,
                "fees": 0,
            },
            settings=user_settings,
        )
        return {
            "ok": True,
            "summary": f"{sym} closed at {payload_args['exit']:.2f} in Journal 2.0.",
            "position_id": pos["id"],
            "trade_id": (result.get("trade") or {}).get("id") if isinstance(result, dict) else None,
        }
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_close_position failed")
        return {"ok": False, "error": str(e)}


# ── update_position ────────────────────────────────────────────────────────

# J2 positions have no target_price column — only stop_price + notes are editable
# via the voice surface.
ALLOWED_UPDATE_FIELDS = {"stop_price", "notes"}


def preview_update_position(*, user_id: str, symbol: str, field: str, value) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    field = (field or "").lower().strip()
    if field == "stop":
        field = "stop_price"
    if field not in ALLOWED_UPDATE_FIELDS:
        raise ValueError(f"field must be one of {sorted(ALLOWED_UPDATE_FIELDS)}")
    if field == "stop_price":
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
        from api.services.journal_two import positions as j2_positions
    except ImportError:
        return {"ok": False, "error": "Journal 2.0 not available"}

    sym = payload_args["symbol"]
    user_id = payload_args["user_id"]
    pos = _find_open_j2_position_by_symbol(user_id, sym)
    if not pos:
        return {"ok": False, "error": f"no open position found for {sym}"}

    # Map snake_case field → camelCase payload key for j2_positions.update_position
    field_map = {"stop_price": "stopPrice", "notes": "notes"}
    field_camel = field_map.get(payload_args["field"], payload_args["field"])

    try:
        j2_positions.update_position(
            user_id=user_id,
            position_id=pos["id"],
            patch={field_camel: payload_args["value"]},
        )
        return {
            "ok": True,
            "summary": f"{sym} {payload_args['field']} updated in Journal 2.0.",
            "position_id": pos["id"],
        }
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
    """Append a voice-captured note to today's J2 day-notes (midDayNotes field)."""
    try:
        from api.services.journal_two import calendar as j2_calendar
    except ImportError:
        return {"ok": False, "error": "Journal 2.0 not available"}

    user_id = payload_args["user_id"]
    date_iso = payload_args.get("date") or _today_iso()
    new_text = payload_args["text"]
    emotion = (payload_args.get("emotion") or "").strip()

    try:
        existing = j2_calendar.get_day_notes(user_id, date_iso) or {}
        prev = (existing.get("midDayNotes") or "").strip()
        appended = f"{prev}\n\n{new_text}".strip() if prev else new_text
        if emotion:
            appended = f"{appended}  [feeling: {emotion}]"

        j2_calendar.upsert_day_notes(user_id, date_iso, {
            "notes": existing.get("notes", ""),
            "prepNotes": existing.get("prepNotes", ""),
            "midDayNotes": appended,
            "recapNotes": existing.get("recapNotes", ""),
            "attachments": existing.get("attachments", []),
            "rules": existing.get("rules", []),
        })
        return {"ok": True, "summary": f"Note added to {date_iso} J2 journal."}
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
    Log a mistake in Journal 2.0.
    1. If symbol given AND an open J2 position for it exists, append the
       mistake to that position's notes field.
    2. Otherwise, write the mistake to today's midDayNotes via upsert_day_notes.
    """
    user_id = payload_args["user_id"]
    mt = payload_args["mistake_type"]
    text = payload_args.get("text") or ""
    sym = (payload_args.get("symbol") or "").upper().strip()
    mistake_line = f"{mt}: {text}" if text else mt

    # Strategy 1: append to open J2 position's notes
    if sym:
        pos = _find_open_j2_position_by_symbol(user_id, sym)
        if pos:
            try:
                from api.services.journal_two import positions as j2_positions
                prev_notes = (pos.get("notes") or "").strip()
                new_notes = (
                    f"{prev_notes}\n\nMistake: {mistake_line}".strip()
                    if prev_notes else f"Mistake: {mistake_line}"
                )
                j2_positions.update_position(
                    user_id=user_id,
                    position_id=pos["id"],
                    patch={"notes": new_notes},
                )
                return {
                    "ok": True,
                    "summary": f"Mistake noted on {sym} J2 position.",
                    "position_id": pos["id"],
                }
            except Exception:  # noqa: BLE001
                _log.exception("confirm_log_mistake: J2 position update failed; falling through to day-notes")

    # Strategy 2: write to today's midDayNotes
    try:
        from api.services.journal_two import calendar as j2_calendar
        date_iso = _today_iso()
        existing = j2_calendar.get_day_notes(user_id, date_iso) or {}
        prev = (existing.get("midDayNotes") or "").strip()
        appended = f"{prev}\nMistake: {mistake_line}".strip() if prev else f"Mistake: {mistake_line}"
        j2_calendar.upsert_day_notes(user_id, date_iso, {
            "notes": existing.get("notes", ""),
            "prepNotes": existing.get("prepNotes", ""),
            "midDayNotes": appended,
            "recapNotes": existing.get("recapNotes", ""),
            "attachments": existing.get("attachments", []),
            "rules": existing.get("rules", []),
        })
        return {"ok": True, "summary": "Mistake logged in today's J2 journal."}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_log_mistake: J2 fallback failed")
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
