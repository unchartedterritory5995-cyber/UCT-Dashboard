"""MD-1 kind `options.straddleHistory` (owner: terminal-data, data wave 14) — one stock's options history.

Two parts, each with its own state: the front at-the-money straddle at each logged session (in dollars and as a percent of
the stock), and each logged session's implied one-day move against the move that followed to the next session. The Agent
half of the OHIS terminal function, over the answers of `GET /api/research/options-history/{sym}/straddle` and
`/daily-move` (`api/services/options_analytics/log_history.py`), with the service's own field names.

⛔ ONLY THE SESSIONS ALREADY ON THIS SERVER'S DISK, NEVER A DOWNLOAD (MD-1 §5). The routes read through the options log's
production store, which lists the log in remote storage and downloads any session file it does not have. A turn must
not, so this adapter gives the service's own functions a plain local store over the same directory
(`LocalStore(get_store().root)`, exactly as `options.ivHistory` does): the files a member's visit already mirrored, and
nothing else. provider_calls is always 0. The IV crush part of OHIS is not read: it needs the stock's earnings dates,
which the service reads from a vendor on a miss.

THE SWITCHES ARE THE ROUTES': while a part's route switch (`OPTIONS_STRADDLE_HISTORY_ENABLED`,
`OPTIONS_DAILY_MOVE_ENABLED`) is off, that part is `off` and nothing of it is read; both off is `unavailable`. No session
on this server's disk is `unavailable` too, and so is a stock no session holds: neither is "no options history".

A NUMBER THAT DOES NOT EXIST IS NULL, NEVER 0: a session with no straddle is left out and counted; a pair whose next session
was not logged is broken, never bridged, and counted. The summary of the daily moves is the service's own and is null below
its minimum, with the service's own sentence.

THE CUT IS STATED: at most `rows` sessions per part, newest first; a longer history is cut from the OLD end.

TIME (MD-1 §3): `as_of` is the newest session with a row for the stock, as the start of that Eastern day; never the time
of the read. The read is `stale`, with a note, when that session is older than the newest completed session. Every read
is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-28 covers the vendor's options chain,
Greeks and IV for display to members, restricted, and row T-14 is the vendor's numbers into a model, restricted. Neither
clears these figures for a model provider, and no other row does. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import sessions
from api.services.uct_agent.marketdata.iv_history_read import _clean
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of

KIND = "options.straddleHistory"
SOURCE = "uct-options-log"
DEFAULT_ROWS = 20
MAX_ROWS = 60
SWITCHES = {"straddle": "OPTIONS_STRADDLE_HISTORY_ENABLED", "daily_move": "OPTIONS_DAILY_MOVE_ENABLED"}
STATES = ("held", "off", "not_in_log")

NOTE_WHAT = ("{symbol}'s options history from UCT's own options log as held on this server: the front at-the-money "
             "straddle at each logged session (the first expiry after the session, call mid plus put mid, recorded at "
             "16:30 ET) and each session's implied one-day move (the at-the-money IV over the square root of 252) against "
             "the move to the next logged session. A record, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest logged session with a row for {symbol} ({day}); it is never the time of the read. The "
              "log began on {began} and {sessions} of its sessions are on this server")
NOTE_OFF = "the {part} is switched off on this server ({switch} is not on), so it is not read"
NOTE_NONE_IN_PART = "no logged session on this server has a {part} for {symbol}; that is not the same as none"
NOTE_CUT = ("{part}: {total} sessions are held for {symbol} and the newest {shown} are returned, newest first: the "
            "history is cut from the OLD end")
NOTE_ABSENT = "{n} logged sessions have no straddle for {symbol}; they are left out, never drawn as 0"
NOTE_BROKEN = ("{n} daily-move pairs are broken (the next session was not logged, or a side had no price or IV); a missed "
               "day is never bridged")
NOTE_SUMMARY = "the summary of the daily moves is not stated: {why}"
NOTE_STALE = ("the newest session held for {symbol} is {day}, older than the newest completed session ({expected}). A "
              "newer session may be logged and not mirrored on this server: this read never downloads one. Open OHIS in "
              "UCT, then ask again")
NOTE_BOTH_OFF = ("the options history is switched off on this server (neither OPTIONS_STRADDLE_HISTORY_ENABLED nor "
                 "OPTIONS_DAILY_MOVE_ENABLED is on), so nothing is read. That is not the same as no options history")
NOTE_NOT_HELD = ("no session of UCT's options log is on this server's disk, and this read never downloads one. That is not "
                 "the same as no options history. Open OHIS in UCT, then ask again")
NOTE_NOT_IN_LOG = ("the {sessions} sessions of UCT's options log on this server hold no straddle and no daily move for "
                   "{symbol}. That is not the same as no options history: the stock may have no listed options, or its "
                   "sessions may not be mirrored here")
NOTE_FAILED = "the options history read failed; nothing is stated. That is not the same as no options history"

PART_WORDS = {"straddle": "straddle history", "daily_move": "implied against actual daily moves"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> dict:
    """READ ONLY: `{"straddle": answer | None, "daily_move": answer | None, "sessions": int}` over the sessions on this
    server's disk (a plain local store over the service's own directory: nothing is listed in or downloaded from remote
    storage). A part whose route switch is off is None and is never read."""
    from api.services.options_analytics import flags, log_history
    from api.services.research import iv_history as ivh
    local = ivh.LocalStore(ivh.get_store().root)
    out: dict = {"sessions": len(local.sessions())}
    out["straddle"] = log_history.straddle_history(sym, store=local) if flags.is_on(SWITCHES["straddle"]) else None
    out["daily_move"] = log_history.daily_move(sym, store=local) if flags.is_on(SWITCHES["daily_move"]) else None
    return out


def _straddle_row(p: Any) -> Optional[dict]:
    if not isinstance(p, dict) or _day(p.get("date")) is None:
        return None
    return {"date": _day(p["date"]), "straddle": _num(p.get("straddle")), "straddle_pct": _num(p.get("straddle_pct")),
            "underlying_price": _num(p.get("underlying_price")), "front_expiration": _day(p.get("front_expiration")),
            "front_dte": _whole(p.get("front_dte")), "front_strike": _num(p.get("front_strike"))}


def _pair_row(p: Any) -> Optional[dict]:
    if not isinstance(p, dict) or _day(p.get("date")) is None:
        return None
    return {"date": _day(p["date"]), "next": _day(p.get("next")), "atm_iv": _num(p.get("atm_iv")),
            "implied_move_pct": _num(p.get("implied_move_pct")), "actual_move_pct": _num(p.get("actual_move_pct")),
            "ratio": _num(p.get("ratio")), "inside": p.get("inside") if isinstance(p.get("inside"), bool) else None}


def read_straddle_history(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(sym)
        expected = sessions.last_completed_session()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no options history"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    st, dm, logged = got.get("straddle"), got.get("daily_move"), got.get("sessions")
    if st is None and dm is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_BOTH_OFF)
    if not logged:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    notes: list = []
    parts: dict = {}
    days: list = []
    meta = st if isinstance(st, dict) else dm
    for key, ans, rows_key, shape in (("straddle", st, "points", _straddle_row), ("daily_move", dm, "pairs", _pair_row)):
        if ans is None:
            parts[key] = {"state": "off", "rows": [], "count": 0, "total": 0, "cut": False}
            notes.append(NOTE_OFF.format(part=PART_WORDS[key], switch=SWITCHES[key]))
            continue
        if not isinstance(ans, dict):
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
        rows = sorted((r for r in (shape(p) for p in ans.get(rows_key) or []) if r), key=lambda r: r["date"], reverse=True)
        shown = rows[:limit]
        part = {"state": "held" if rows else "not_in_log", "rows": shown, "count": len(shown), "total": len(rows),
                "cut": len(rows) > len(shown), "method": ans.get("method") if isinstance(ans.get("method"), str) else None}
        if rows:
            days.append(rows[0]["date"])
        else:
            notes.append(NOTE_NONE_IN_PART.format(part=PART_WORDS[key], symbol=sym))
        if part["cut"]:
            notes.append(NOTE_CUT.format(part=PART_WORDS[key], total=len(rows), symbol=sym, shown=len(shown)))
        if key == "straddle":
            part["sessions_without"] = len(ans.get("sessions_without_straddle") or [])
            if rows and part["sessions_without"]:
                notes.append(NOTE_ABSENT.format(n=part["sessions_without"], symbol=sym))
        else:
            summary = ans.get("summary") if isinstance(ans.get("summary"), dict) else None
            part["summary"] = ({"pairs": _whole(summary.get("pairs")), "inside_share": _num(summary.get("inside_share")),
                                "mean_ratio": _num(summary.get("mean_ratio"))} if summary else None)
            part["summary_note"] = ans.get("summary_note") if isinstance(ans.get("summary_note"), str) else None
            part["min_pairs"] = _whole(ans.get("min_pairs"))
            part["broken"] = len(ans.get("broken_pairs") or [])
            if rows and part["summary"] is None:
                notes.append(NOTE_SUMMARY.format(why=part["summary_note"] or "the service gave no summary."))
            if rows and part["broken"]:
                notes.append(NOTE_BROKEN.format(n=part["broken"]))
        parts[key] = part
    if not days:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_IN_LOG.format(sessions=logged, symbol=sym))
    day = max(days)
    expected_day = f"{expected // 10000:04d}-{expected // 100 % 100:02d}-{expected % 100:02d}"
    stale = day < expected_day
    began = _day(meta.get("logging_began")) if isinstance(meta, dict) else None
    notes = [NOTE_WHAT.format(symbol=sym),
             NOTE_AS_OF.format(symbol=sym, day=day, began=began or "a day it did not record", sessions=logged), *notes]
    if stale:
        notes.append(NOTE_STALE.format(symbol=sym, day=day, expected=expected_day))
    data = {"symbol": sym, "straddle": parts["straddle"], "daily_move": parts["daily_move"], "as_of": day,
            "logging_began": began, "sessions_logged": logged, "expected_session": expected_day,
            "missing_sessions": len((meta or {}).get("missing_sessions") or []) if isinstance(meta, dict) else None,
            "source": meta.get("source") if isinstance(meta, dict) and isinstance(meta.get("source"), str) else None}
    total = parts["straddle"]["total"] + parts["daily_move"]["total"]
    shown = parts["straddle"]["count"] + parts["daily_move"]["count"]
    coverage = {"evaluated": total, "answered": shown, "dropped": total - shown, "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
