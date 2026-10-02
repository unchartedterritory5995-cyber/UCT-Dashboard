"""Member-visible AI meters (TERM-078, FB-I1-04): what a member has spent today
(or this month) at each AI door that can refuse them, and what remains.

⭐ "NEVER SHIP A HARD CAP WITHOUT A METER" (F-01 PROD-C1, Bloomberg's own rule).
With one paid tier there is no tier to explain a refusal (CARD 17, PROD-C2), so
the number has to be readable BEFORE it runs out, at one place.

⛔ EVERY METER READS THE COUNTER ITS DOOR SPENDS -- the same scope constant,
the same subject, the same day key, through the same module -- never a copy of
it. `tests/test_ai_meters.py` spends through each door's own reservation and
requires the meter to move; a meter that read a neighbouring counter stays
still and the rail goes red by name.

⛔ UNREADABLE IS NOT ZERO. A counter store that cannot be read answers
`readable: False` here, never `used: 0`: the doors fail OPEN in that state
(`daily_counters`' rule), and the member is told so rather than shown a full
allowance that is not really being counted.

Read-only: nothing here charges, refunds or writes.
"""
from __future__ import annotations

import logging
from typing import Callable

log = logging.getLogger(__name__)

RESETS_DAY = "midnight ET"
RESETS_MONTH = "the 1st of the month (UTC)"


def _meter(key: str, label: str, door: str, unit: str, period: str, counter: str,
           used, limit, *, uncapped: bool = False) -> dict:
    """One row. `used is None` means the counter could not be read."""
    row = {"key": key, "label": label, "door": door, "unit": unit, "period": period,
           "resets": RESETS_DAY if period == "day" else RESETS_MONTH,
           "counter": counter, "uncapped": bool(uncapped)}
    if used is None:
        row.update(readable=False, used=None, limit=limit, remaining=None)
        return row
    used = max(0, int(round(float(used))))
    if uncapped or limit is None:
        row.update(readable=True, used=used, limit=None, remaining=None)
    else:
        row.update(readable=True, used=used, limit=int(limit),
                   remaining=max(0, int(limit) - used))
    return row


# ── AI Search (research answers) ─────────────────────────────────────────────

def _ai_search(user: dict) -> dict | None:
    from api.routers import ai_search
    try:
        snap = ai_search._quota_snapshot(user.get("id"))   # the door's own snapshot
        used, limit = snap.get("used"), snap.get("limit")
    except Exception as e:  # noqa: BLE001 -- a meter never raises
        log.warning("[ai-meters] ai_search read failed (%s)", type(e).__name__)
        used, limit = None, None
    return _meter("ai_search", "AI Search answers", "api/routers/ai_search.py",
                  "answers", "day", "ai_search usage ledger (per member, per ET day)",
                  used, limit)


def _ai_search_personal(user: dict) -> dict | None:
    from api.routers import ai_search
    from api.services import ai_search_personal as asp
    if not ai_search._personal_enabled():
        return None
    try:
        used = asp.synth_used(ai_search._personal_uid(user))
    except Exception as e:  # noqa: BLE001
        log.warning("[ai-meters] ai_search_personal read failed (%s)", type(e).__name__)
        used = None
    return _meter("ai_search_personal", "Personalized AI Search answers",
                  "api/services/ai_search_personal.py", "answers", "day",
                  "ai_search_personal synth count (in-process)", used, asp._SYNTH_PERUSER_CAP)


# ── Notebook: Ask and writing help (durable daily_counters) ─────────────────

def _notebook_counter(scope: str, user: dict):
    from api.services import daily_counters, note_ask
    note_ask.drain_background()        # read-your-writes, as note_ask's own readers do
    return daily_counters.read(note_ask.charge_day(), scope, str(user.get("id")))


def _notebook_ask(user: dict) -> dict | None:
    from api.services import note_ask
    return _meter("notebook_ask", "Ask Notebook questions", "api/services/journal_two/ask_service.py",
                  "questions", "day", note_ask.SCOPE_ASK,
                  _notebook_counter(note_ask.SCOPE_ASK, user), note_ask._SYNTH_PERUSER_CAP)


def _notebook_writing_help(user: dict) -> dict | None:
    from api.services import note_ask
    from api.services.journal_two import writing_help
    if not writing_help.writing_help_enabled():
        return None
    return _meter("notebook_writing_help", "Notebook writing help drafts",
                  "api/services/journal_two/writing_help.py", "drafts", "day",
                  note_ask.SCOPE_WRITING_HELP,
                  _notebook_counter(note_ask.SCOPE_WRITING_HELP, user),
                  note_ask.writing_help_peruser_cap())


def _notebook_voice_notes(user: dict) -> dict | None:
    """Wave 11 lane 11A: voice-note summaries (their own durable daily count)."""
    from api.services import note_ask
    from api.services.journal_two import voice_notes
    if not voice_notes.enabled():
        return None
    return _meter("notebook_voice_notes", "Notebook voice-note summaries",
                  "api/services/journal_two/voice_notes.py", "summaries", "day",
                  note_ask.SCOPE_VOICE_NOTE,
                  _notebook_counter(note_ask.SCOPE_VOICE_NOTE, user),
                  note_ask.voice_note_peruser_cap())


# ── Options Flow "explain this print" (flow_explain.db, per ET day) ─────────

def _flow_explain(user: dict) -> dict | None:
    from api import flow_explain as fe
    key = str(user.get("id") or user.get("email") or "anon")    # the door's own key
    try:
        used = fe.user_count(key, fe._today_et())
    except Exception as e:  # noqa: BLE001
        log.warning("[ai-meters] flow_explain read failed (%s)", type(e).__name__)
        used = None
    return _meter("flow_explain", "Options Flow print explanations", "api/flow_explain.py",
                  "explanations", "day", "flow_explain_user_requests", used, fe._user_daily_cap())


# ── Compass chat (j2_chat_messages, per account, per UTC day) ───────────────

_MAX_CHAT_ACCOUNTS = 10


def _compass_chat(user: dict) -> list[dict]:
    """One meter per journal account: the door's limit is per (member, account)
    and counts the member's own messages from `j2_chat_messages` for the UTC
    day -- read here through the door's OWN `get_rate_limit_info`."""
    from api.services.journal_two import coach_chat
    uid = str(user.get("id"))
    try:
        conn, close = coach_chat._get_conn()
        try:
            accounts = conn.execute(
                "SELECT id, name FROM j2_accounts WHERE user_id = ? ORDER BY name LIMIT ?",
                (uid, _MAX_CHAT_ACCOUNTS)).fetchall()
        finally:
            if close:
                conn.close()
    except Exception as e:  # noqa: BLE001 -- no journal store: no chat meters
        log.warning("[ai-meters] compass_chat accounts read failed (%s)", type(e).__name__)
        return []
    rows = []
    for acct in accounts:
        try:
            info = coach_chat.get_rate_limit_info(user_id=uid, account_id=acct["id"])
            used, limit = info["used"], info["limit"]
        except Exception as e:  # noqa: BLE001
            log.warning("[ai-meters] compass_chat read failed (%s)", type(e).__name__)
            used, limit = None, coach_chat.RATE_LIMIT_PER_DAY
        row = _meter(f"compass_chat:{acct['id']}", f"Compass chat messages ({acct['name']})",
                     "api/services/journal_two/coach_chat.py", "messages", "day",
                     "j2_chat_messages (member's own, per account)", used, limit)
        row["resets"] = "midnight UTC"     # the door counts by UTC date
        rows.append(row)
    return rows


# ── Compass voice (voice_usage_monthly, per calendar month) ─────────────────

_VOICE_MODES = (
    # key, label, usage column, cap constant name, unit, seconds->minutes
    ("voice_read_aloud", "Compass read-aloud", "mode_a_seconds", "MODE_A_DEFAULT_CAP_SECONDS", "minutes", True),
    ("voice_one_shot", "Compass one-shot questions", "mode_b_calls", "MODE_B_DEFAULT_CAP_CALLS", "questions", False),
    ("voice_conversation", "Compass voice conversation", "mode_c_seconds", "MODE_C_DEFAULT_CAP_SECONDS", "minutes", True),
    ("voice_dictation", "Compass dictation", "mode_d_seconds", "MODE_D_DEFAULT_CAP_SECONDS", "minutes", True),
)


def _voice(user: dict) -> list[dict]:
    from api.services import voice_usage
    try:
        usage = voice_usage.get_monthly_usage(user.get("id"))
    except Exception as e:  # noqa: BLE001
        log.warning("[ai-meters] voice_usage read failed (%s)", type(e).__name__)
        usage = None
    uncapped = user.get("role") == "admin"      # the doors' own bypass
    rows = []
    for key, label, col, cap_name, unit, secs in _VOICE_MODES:
        cap = getattr(voice_usage, cap_name)
        used = None if usage is None else usage.get(col, 0)
        if secs:
            cap = cap / 60.0
            used = None if used is None else used / 60.0
        rows.append(_meter(key, label, "api/routers/voice.py", unit, "month",
                           f"voice_usage_monthly.{col}", used, round(cap), uncapped=uncapped))
    return rows


def _has_voice_access(user: dict) -> bool:
    try:
        from api.middleware.auth_middleware import requires_voice_access
        requires_voice_access(user)
        return True
    except Exception:  # noqa: BLE001 -- no access: no voice meters, never an error
        return False


# The registry: every member-visible meter, in display order. A key here is
# what `api/services/ai_doors.py` names in a door's `meter` field.
METERS: dict[str, Callable[[dict], dict | list | None]] = {
    "ai_search": _ai_search,
    "ai_search_personal": _ai_search_personal,
    "notebook_ask": _notebook_ask,
    "notebook_writing_help": _notebook_writing_help,
    "notebook_voice_notes": _notebook_voice_notes,
    "flow_explain": _flow_explain,
    "compass_chat": _compass_chat,
    "voice": _voice,
}


def meters_for(user: dict) -> dict:
    """The member's meters, plus the population cap's state when it is being
    ENFORCED (a cap that can refuse them is a cap they must be able to read)."""
    from api.services import ai_population_cap as pop
    rows: list[dict] = []
    for key, fn in METERS.items():
        if key == "voice" and not _has_voice_access(user):
            continue
        try:
            got = fn(user)
        except Exception as e:  # noqa: BLE001 -- one broken meter never hides the rest
            log.warning("[ai-meters] %s failed (%s)", key, type(e).__name__)
            continue
        if got is None:
            continue
        rows.extend(got if isinstance(got, list) else [got])
    out = {"meters": rows, "all_readable": all(r["readable"] for r in rows)}
    snap = pop.snapshot()
    if snap.get("mode") == pop.MODE_ENFORCE:
        pop_row = {"enforced": True, "readable": snap.get("readable", False),
                   "resets": RESETS_DAY}
        if snap.get("readable"):
            limit = max(1, int(snap["limit"]))
            pop_row["pct_used"] = min(100, int(round(100.0 * snap["used"] / limit)))
            pop_row["reached"] = bool(snap["reached"])
            if pop_row["reached"]:
                pop_row["message"] = pop.REFUSAL_SENTENCE    # the refusal, verbatim
        out["population"] = pop_row
    else:
        out["population"] = {"enforced": False}
    return out
