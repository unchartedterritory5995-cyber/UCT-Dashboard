"""MD-1 kind `earnings.reactions` (owner: terminal-data, data wave 3) — one day's earnings reporters and how they moved.

The companies that reported on one day, each with its result against what was expected and the stock's move: the Agent
half of the EMOV terminal panel (app/src/pages/terminal/panels/earningsReactionsModel.js), which pairs two reads of
api/routers/calendar.py: `GET /api/calendar?week=` (who was on the calendar, with EPS and revenue, reported and
expected) and `GET /api/calendar/reactions?date=` (`{SYM: move_pct}`).

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The logic of both reads lives in the router, and each
can start work that does not fit a turn:
  * `get_reactions` for a past day not in its cache works the moves out from daily bars: ONE Massive request PER
    REPORTER, up to 250 of them (`_PAST_REACTIONS_MAX_SYMS`); for today, one Massive batch snapshot;
  * `_days_for_date` for any week but the current one builds that week on a cache miss (a multi-provider fan-out).
No small pure helper exists for either, so this adapter calls neither. It reads the two cache entries the routes
themselves serve from, exactly as the router's own `cached_report_session` reads a day ("never builds a week and never
calls a provider"):
  * the day: `calendar_weekly` (the current week) or `calendar_week_<monday>`; not held → `unavailable`;
  * the moves: `calendar_reactions_<date>`; not held → the reporters and their results are given WITHOUT moves, the
    read is `partial`, and a note says the moves are not held (never that nothing moved).
provider_calls is always 0.
⚠️ COUPLING, stated: those three cache keys and the router's week helpers (`_monday_of`, `_week_dates`), private to
api/routers/calendar.py. Rails fill the caches through the router's own functions (`get_reactions`, and the day through
the same entry `cached_report_session` reads) and read them back, so a rename fails by name.

WHO IS A REPORTER: an entry of the day whose reported EPS (`eps_act`) is set, the same test the reactions route and the
EMOV panel apply. A symbol listed under two sessions is counted once (the panel's rule).

WHAT A MOVE IS (the route's own rule, restated in a note, never re-derived here):
  * a past day: a report before the open, or with no confirmed time → that day's close against the prior close;
    a report after the close → the NEXT session's close against that day's close;
  * today: the change on the day in one market snapshot (the vendor's own figure), which the route keeps 30 seconds.
A move the route could not work out (no bar for the day, or the session it is measured to has not closed) is absent
from its answer: that reporter's `move` is null, counted in `no_move`, never 0.
AN EMPTY MOVES ANSWER IS NOT "NOTHING MOVED": the route caches `{}` both when the price source did not answer and when
no move could be worked out yet. With reporters on the day that is `moves: "none_worked_out"` and the read is `partial`.

THE CUT IS STATED: at most `limit` reporters, biggest move first by size (up or down), a reporter with no move last
(the EMOV panel's order), the whole count beside them and a note naming both.

TIME (MD-1 §3): neither read carries a data time, only the day it is for, so `as_of` is null with a note. Today's read
is `periodic`; a past day's is `historical`. The kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the day's list is UCT's own calendar (its universe filter over
third-party calendar vendors' results and estimates, whose AI-processing right is not on record), and the move is
worked out by UCT under its own session rule. The Agent's existing calendar answer (`calendar.day`) deliberately gives
"tickers only, never a figure: estimates stay on the page"; this kind carries the figures, so it is shown to the member
only and its capability is local-only.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.reactions"
SOURCE = "uct-earnings-calendar"
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
#: the calendar's session buckets, in the route's own order
SESSIONS = ("bmo", "amc", "tbd")
MOVES = ("held", "none_worked_out", "not_cached")
DAY_KINDS = ("past", "today", "future")
#: a reporter's fields: the calendar entry's own names, then its session bucket and its move
ROW_FIELDS = ("sym", "name", "session", "eps_act", "eps_est", "rev_act", "rev_est", "move")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_WHAT = ("the companies on UCT's earnings calendar for {date} that have a reported result on record, each with its "
             "earnings per share and revenue against what was expected, and the stock's move; results and estimates "
             "are third-party calendar data as UCT holds it")
NOTE_MOVE_PAST = ("a move is the stock's close-to-close change around the report: for a report before the open or with "
                  "no confirmed time, that day's close against the prior close; for a report after the close, the next "
                  "session's close against that day's close")
NOTE_MOVE_TODAY = ("for today a move is the stock's change on the day in one market snapshot, kept {seconds} seconds; "
                   "it is not the settled close-to-close move, which is worked out once the sessions have closed")
NOTE_NO_AS_OF = ("the calendar and the moves carry no data time, only the day they are for, so as_of is not given: not "
                 "a live feed")
NOTE_MOVES_NOT_CACHED = ("the moves for {date} are not held in the server's cache (a past day's are kept up to {hours} "
                         "hours after a member opens it, today's {seconds} seconds), and this read never starts price "
                         "reads; the results are given without them, which is not the same as no move")
NOTE_NO_MOVES = ("no move is held for any of the {n} reporters: the price source did not answer, or the session a move "
                 "is measured to has not closed; that is not the same as no move")
NOTE_SOME_NO_MOVE = ("{n} of the {total} reporters have no move on record (no price bar for the day, or the session it "
                     "is measured to has not closed)")
NOTE_NONE_REPORTED = ("{scheduled} companies are on the calendar for {date} and none has a reported result on record; "
                      "that is a healthy answer, not a failed read")
NOTE_CUT = "showing the first {n} of {total} reporters, biggest move first by size, a reporter with no move last"
NOTE_DAY_NOT_CACHED = ("the earnings calendar for {date} is not held in the server's cache, and this read never builds "
                       "a calendar week; that is not the same as nobody reporting")
NOTE_FAILED = "the earnings reactions could not be read for {date}"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    day = params.get("date")
    if day is not None:
        if not isinstance(day, str) or not _ISO_DAY.match(day):
            return "`date` must be a date as YYYY-MM-DD"
        try:
            parsed = datetime.strptime(day, "%Y-%m-%d").date()
        except ValueError:
            return "`date` must be a real calendar date"
        if parsed.weekday() >= 5:
            return "`date` must be a weekday: the earnings calendar has no weekend days"
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def today_et() -> str:
    from api.routers import calendar as route
    return route._today_et().isoformat()


def default_day() -> str:
    """The day read when none is given: the newest completed session (the EMOV panel's own default)."""
    from api.services.uct_agent.marketdata import sessions
    s = str(sessions.last_completed_session())
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def cached_day(ds: str) -> Optional[dict]:
    """One day's calendar dict from the week cache that owns it, WITHOUT building a week (the same two entries the
    router's own `cached_report_session` reads). None when the week, or the day in it, is not held."""
    from api.routers import calendar as route
    from api.services.calendar_week_contract import week_days
    monday = route._monday_of(date.fromisoformat(ds))
    if monday == route._week_dates()[0]:
        week = route.cache.get("calendar_weekly")
    else:
        week = route.cache.get(f"calendar_week_{monday.isoformat()}")
    # TERM-030: the shared shape check. A malformed week raises (the kind answers unavailable), never "no reporters".
    days = week_days(week, reader="api.services.uct_agent.marketdata.earnings_reactions.cached_day") or {}
    day = days.get(ds)
    return day if isinstance(day, dict) else None


def cached_moves(ds: str) -> Optional[dict]:
    """The reactions answer the route already holds for this day, WITHOUT working one out. None when it holds none."""
    from api.routers import calendar as route
    hit = route.cache.get(f"calendar_reactions_{ds}")
    return hit if isinstance(hit, dict) else None


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def read_earnings_reactions(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("limit", DEFAULT_LIMIT)
    ds = params.get("date")
    try:
        ds = ds or default_day()
        today = today_et()
        day = cached_day(ds)                               # a cache entry or nothing: never a week build
    except Exception:  # noqa: BLE001 — a failing calendar is an honest unavailable, never "nobody reported"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=ds or "that day"))
    if day is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_DAY_NOT_CACHED.format(date=ds))

    seen: set[str] = set()
    reporters: list[dict] = []
    scheduled = 0
    for session in SESSIONS:
        for e in day.get(session) or []:
            sym = str((e or {}).get("sym") or "").strip().upper() if isinstance(e, dict) else ""
            if not sym or sym in seen:
                continue
            seen.add(sym)
            scheduled += 1
            if _num(e.get("eps_act")) is None:
                continue
            reporters.append({"sym": sym, "name": str(e.get("name") or "").strip() or None, "session": session,
                              "eps_act": _num(e.get("eps_act")), "eps_est": _num(e.get("eps_est")),
                              "rev_act": _num(e.get("rev_act")), "rev_est": _num(e.get("rev_est")), "move": None})

    day_kind = "today" if ds == today else "past" if ds < today else "future"
    try:
        from api.routers import calendar as route
        held = cached_moves(ds) if reporters else {}
        live_seconds = int(route._REACTIONS_TTL)
        past_hours = int(route._PAST_REACTIONS_TTL // 3600)
    except Exception:  # noqa: BLE001 — the day was read; the moves were not
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=ds))
    moves_state = "not_cached" if held is None else "held"
    if held:
        by_sym = {str(k).strip().upper(): _num(v) for k, v in held.items()}
        for r in reporters:
            r["move"] = by_sym.get(r["sym"])
    moved = [r for r in reporters if r["move"] is not None]
    if reporters and held is not None and not moved:
        moves_state = "none_worked_out"

    # the EMOV panel's order (earningsReactionsModel.js `reactionRows`): biggest move first by size, no move last
    reporters.sort(key=lambda r: (r["move"] is None, -abs(r["move"]) if r["move"] is not None else 0.0, r["sym"]))
    shown = reporters[:limit]
    notes = [NOTE_WHAT.format(date=ds),
             NOTE_MOVE_TODAY.format(seconds=live_seconds) if day_kind == "today" else NOTE_MOVE_PAST, NOTE_NO_AS_OF]
    if not reporters:
        notes.append(NOTE_NONE_REPORTED.format(scheduled=scheduled, date=ds))
    elif moves_state == "not_cached":
        notes.append(NOTE_MOVES_NOT_CACHED.format(date=ds, hours=past_hours, seconds=live_seconds))
    elif moves_state == "none_worked_out":
        notes.append(NOTE_NO_MOVES.format(n=len(reporters)))
    elif len(moved) < len(reporters):
        notes.append(NOTE_SOME_NO_MOVE.format(n=len(reporters) - len(moved), total=len(reporters)))
    if len(reporters) > limit:
        notes.append(NOTE_CUT.format(n=limit, total=len(reporters)))
    data = {"date": ds, "day_kind": day_kind, "scheduled": scheduled, "reporters": shown, "count": len(reporters),
            "moves": moves_state if reporters else None, "moved": len(moved),
            "up": sum(1 for r in moved if r["move"] > 0), "down": sum(1 for r in moved if r["move"] < 0),
            "flat": sum(1 for r in moved if r["move"] == 0), "no_move": len(reporters) - len(moved)}
    coverage = {"evaluated": len(reporters), "answered": len(shown), "dropped": len(reporters) - len(shown),
                "not_computable": len(reporters) - len(moved)}
    partial = bool(reporters) and moves_state != "held"
    return env.make_envelope(KIND, params, status="partial" if partial else "ok",
                             freshness="periodic" if day_kind != "past" else "historical", as_of=None, source=SOURCE,
                             data=data, stale=False, coverage=coverage, notes=notes, provider_calls=0)
