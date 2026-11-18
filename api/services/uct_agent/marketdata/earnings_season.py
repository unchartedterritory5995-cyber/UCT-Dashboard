"""MD-1 kind `earnings.season` (owner: terminal-data, data wave 4) — one day's earnings reporters, in one read.

Who reports on one day (before the open, after the close, time not confirmed), biggest company first, and for each one
the move options priced before the report, how the stock moved on its past reports, and the result and the stock's move
once it lands: the Agent half of the ERNS terminal panel (app/src/pages/terminal/panels/earningsSeasonModel.js), over
the answer behind `GET /api/calendar/earnings-season` (api/services/earnings_season.py).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The member route's `get_day` never builds on the
request, but with nothing held it STARTS the service's one background build for the day and waits on it: a calendar
week read (a multi-provider build for any week but the current one) and, for today, one Massive batch snapshot. A turn
must not start that, so this adapter never calls `get_day`. It reads `earnings_season.held_day`, the service's own
read-only accessor:
  * the held answer, inside its freshness                                   → `held: "fresh"`;
  * else the last good answer, past its freshness and still servable        → `held: "last_good"`, and the read is `stale`;
  * else nothing is held                                                     → `unavailable`, with the reason.
provider_calls is always 0. A rail holds `held_day` to `get_day` (the same answer whenever `get_day` would not build),
and counts builds through the real service state with nothing held.

WHAT A HELD ANSWER CAN SAY, each kept apart:
  * `ok`            the day, as below;
  * `no_day`        the calendar week was read and carries no such day (a market holiday): a healthy answer, `ok` with
                    no company and a note, never a failed read. A weekend is refused before any read;
  * `unavailable`   the calendar could not be read when the answer was built: `unavailable`, never "nobody reports";
  * `out_of_range`  the day is outside the days the service reaches (the Calendar's week and one either side):
                    `unavailable`, with the reach named.

EVERY NUMBER IS THE SERVICE'S OWN. Nothing is re-derived here. A priced move is what the at-the-money straddle priced
before the report, stored by UCT's weekday capture from UCT's own Massive option chain (a row from any other chain is
withheld by the service and counted). Past moves are each past report's close-to-close move from UCT daily bars, only
where the server already holds them (`past_state` says which). A move is the service's: for today the regular
session's change so far for a report before the open, for a past day the Calendar's own settled answer when the server
holds it. A number that does not exist is null, never 0: no priced move, no past move and no move are each null with
the state that explains it.

THE CUT IS STATED: at most `limit` companies of the session asked for, the biggest by market cap (a company with no
market cap on file last, the service's own order), each kept under its own session, with the whole count beside them
and a note naming both.

TIME (MD-1 §3): the answer carries when UCT put it together (`built_at`) and when the calendar week it read was built
(`calendar_as_of`). Both are computation times, so neither is `as_of`: `as_of` is null with a note, and both ride in
`data`. Each priced move carries its own capture time. Today's and a coming day's read is `periodic`; a past day's is
`historical`. The kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate), for the reasons the three kinds it overlaps are isolated: the day's
list is UCT's own calendar over third-party calendar vendors' results and estimates, whose AI-processing right is not
on record (`earnings.reactions`); the priced move is worked out by UCT from an option chain (`earnings.expectedMove`);
the past moves are UCT's own arithmetic on daily bars. No licensing record clears any of them for a model provider
(api/services/provider_licensing_class.py: every Massive and FMP row is display-only). Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.season"
SOURCE = "uct-earnings-season"
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
#: the calendar's session buckets, in the service's own order
SESSIONS = ("bmo", "amc", "tbd")
#: which part of the day a member may ask for: the ERNS panel's own keys (earningsSeasonModel.js EARNINGS_SESSIONS)
SESSION_CHOICES = ("all", "bmo", "amc")
SESSION_WORDS = {"bmo": "before the open", "amc": "after the close"}
HELD = ("fresh", "last_good")
DAY_KINDS = ("today", "past", "future")
#: a company's fields, by the service's own names (`priced` and `past` are cut to the two lists below)
ROW_FIELDS = ("sym", "name", "session", "mc_b", "eps_est", "eps_act", "rev_est", "rev_act", "reported", "verdict", "priced",
              "past", "past_state", "move", "move_state")
PRICED_FIELDS = ("pct", "dollar", "captured_at", "expiry")
PAST_FIELDS = ("moves", "avg_abs", "n")
COUNT_FIELDS = ("scheduled", "reported", "priced", "priced_withheld", "with_past", "past_not_held", "moved")
MOVES_STATES = ("live", "held", "not_held", "failed")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NEXT_DAY_WORDS = "the next day with a reporter"

NOTE_WHAT = ("the companies on UCT's earnings calendar for {date}, by when they report, biggest company first, each with "
             "the move options priced before the report, how the stock moved on its past reports, and the result and the "
             "stock's move once it lands; results and estimates are third-party calendar data as UCT holds it")
NOTE_PRICED = ("a priced move is what the at-the-money straddle priced before the report, as a percent of the stock "
               "price, stored once by UCT's weekday capture from UCT's own Massive option chain; a company with none "
               "stored has none here, never 0")
NOTE_PAST = ("a past move is the close-to-close move of the session that first traded each past result, from UCT daily "
             "bars, given only where the server already holds it")
NOTE_MOVE_TODAY = ("for today a move is the regular session's change so far, for a report that came before the open or "
                   "with no confirmed time; a report after the close has no move until the next close")
NOTE_MOVE_PAST = ("for a past day a move is the Calendar's own settled close-to-close move, given only when the server "
                  "already holds it")
NOTE_TIME = ("put together by UCT at {at} (UCT's own time; the calendar carries only the day it is for), so as_of is not "
             "given: not a live feed")
NOTE_NO_TIME = "the held answer carries no build time, so its age is unknown and as_of is not given"
NOTE_DEFAULT = "no day was asked for, so this is the next day with a reporter, as the server last worked it out"
NOTE_LAST_GOOD = ("this is the last good answer for {date}, older than the {minutes} minutes it is normally kept, so a "
                  "result or a move that landed since is missing")
NOTE_PAST_NOT_HELD = ("{n} of the {total} companies have no past moves held on the server; that is not the same as no "
                      "past report")
NOTE_PRICED_WITHHELD = ("{n} stored priced moves are left out: they did not come from UCT's own Massive option chain, or "
                        "they carry no usable percent")
NOTE_PRICED_FAILED = ("the stored priced moves could not be read when this answer was built, so none is given; that is "
                      "not the same as none priced")
NOTE_MOVES_NOT_HELD = ("the moves for {date} are not held on the server, and this read never starts price reads; the "
                       "results are given without them, which is not the same as no move")
NOTE_MOVES_FAILED = ("the price read for the moves failed when this answer was built, so no move is given; that is not "
                     "the same as no move")
NOTE_NOBODY = "no company is on UCT's earnings calendar for {date}; that is a healthy answer, not a failed read"
NOTE_NO_DAY = ("UCT's earnings calendar carries no {date} in the week it holds (a market holiday); that is a healthy "
               "answer, not a failed read")
NOTE_WEEKEND = "{date} is a weekend day, so no company reports; that is a healthy answer, not a failed read"
NOTE_NO_MATCH = "{total} companies are on the calendar for {date}, none of them reporting {when}"
NOTE_CUT = ("showing the {n} biggest of {total} companies by market cap, a company with no market cap on file last, each "
            "under its own session")
NOTE_NOT_HELD = ("no earnings season answer for {date} is held on the server (one is kept up to {minutes} minutes after "
                 "the Earnings season panel reads that day, and a last good copy {extra} minutes more), and this read "
                 "never starts that build; that is not the same as nobody reporting")
NOTE_OUT_OF_RANGE = ("{date} is outside the days the earnings season answer reaches ({first} to {last}: the calendar's "
                     "own week and one week either side)")
NOTE_CALENDAR = ("the earnings calendar could not be read when the answer for {date} was built; that is not the same as "
                 "nobody reporting")
NOTE_FAILED = "the earnings season answer could not be read for {date}"


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
            return "`date` must be a weekday: no company reports on a weekend"
    if params.get("session", "all") not in SESSION_CHOICES:
        return "`session` must be one of " + ", ".join(SESSION_CHOICES)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def held_answer(ds: Optional[str]) -> tuple[Optional[dict], str]:
    """(the answer the service already holds for this day, how it is held), WITHOUT starting or waiting on a build."""
    from api.services import earnings_season as svc
    return svc.held_day(ds)


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def _row(r: Any, session: str) -> Optional[dict]:
    if not isinstance(r, dict) or not str(r.get("sym") or "").strip():
        return None
    priced = r.get("priced") if isinstance(r.get("priced"), dict) else None
    past = r.get("past") if isinstance(r.get("past"), dict) else None
    moves = [{"date": m.get("date"), "pct": _num(m.get("pct"))} for m in (past or {}).get("moves") or []
             if isinstance(m, dict) and m.get("date") and _num(m.get("pct")) is not None]
    out = {k: r.get(k) for k in ROW_FIELDS}
    out["sym"] = str(r["sym"]).strip().upper()
    out["session"] = session
    for k in ("mc_b", "eps_est", "eps_act", "rev_est", "rev_act", "move"):
        out[k] = _num(r.get(k))                             # a number that does not exist is null, never 0
    out["reported"] = out["eps_act"] is not None
    out["priced"] = {k: (_num(priced.get(k)) if k in ("pct", "dollar") else priced.get(k)) for k in PRICED_FIELDS} \
        if priced and _num(priced.get("pct")) is not None else None
    out["past"] = {"moves": moves, "avg_abs": _num(past.get("avg_abs")), "n": len(moves)} if past and moves else None
    return out


def _built(v: Any) -> Optional[str]:
    """The service's build stamp as an MD-1 time, or None when it is not one."""
    try:
        at = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(at if at.tzinfo else at.replace(tzinfo=timezone.utc))


def read_earnings_season(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    asked = params.get("date")
    session = params.get("session", "all")
    limit = params.get("limit", DEFAULT_LIMIT)
    named = asked or NEXT_DAY_WORDS
    try:
        from api.services import earnings_season as svc
        got, how = held_answer(asked)                       # what the service holds, or nothing: never a build
        fresh_minutes = int(svc.FRESH_OTHER_S // 60)
        extra_minutes = int(svc.STALE_EXTRA_S // 60)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "nobody reports"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=named))
    if got is None:
        return env.unavailable(KIND, params, SOURCE,
                               NOTE_NOT_HELD.format(date=named, minutes=fresh_minutes, extra=extra_minutes))
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=named))
    status = got.get("status")
    ds = str(got.get("date") or asked or "")
    if status == "out_of_range":
        reach = got.get("range") if isinstance(got.get("range"), dict) else {}
        return env.unavailable(KIND, params, SOURCE, NOTE_OUT_OF_RANGE.format(
            date=ds or named, first=reach.get("from") or "a day not given", last=reach.get("to") or "a day not given"))
    if status == "unavailable":
        return env.unavailable(KIND, params, SOURCE, NOTE_CALENDAR.format(date=ds or named))
    no_day = status == "no_day"
    if not no_day and (status != "ok" or not isinstance(got.get("sessions"), dict)):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=ds or named))
    if not _ISO_DAY.match(ds):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(date=named))

    today = str(got.get("today") or "")
    day_kind = got.get("day_kind") if got.get("day_kind") in DAY_KINDS else (
        "today" if ds == today else "past" if today and ds < today else "future")
    groups: dict[str, list] = {s: [] for s in SESSIONS}
    seen: set[str] = set()
    for s in SESSIONS:
        for r in ((got.get("sessions") or {}).get(s) or []) if not no_day else []:
            row = _row(r, s)
            if row and row["sym"] not in seen:
                seen.add(row["sym"])
                groups[s].append(row)
    every = [r for s in SESSIONS for r in groups[s]]
    want = SESSIONS if session == "all" else (session,)
    kept = [r for s in want for r in groups[s]]
    # the cut: the biggest companies of what was asked for, by the service's own order (market cap, none on file last)
    chosen = sorted(kept, key=lambda r: (r["mc_b"] is None, -(r["mc_b"] or 0.0), r["sym"]))[:limit]
    keep = {r["sym"] for r in chosen}
    shown = {s: [r for r in groups[s] if s in want and r["sym"] in keep] for s in SESSIONS}

    counts_in = got.get("counts") if isinstance(got.get("counts"), dict) else {}
    counts = {k: int(counts_in[k]) if isinstance(counts_in.get(k), int) and not isinstance(counts_in.get(k), bool) else None
              for k in COUNT_FIELDS}
    priced_state = "failed" if got.get("priced_state") == "failed" else "read"
    moves_state = got.get("moves_state") if got.get("moves_state") in MOVES_STATES else None
    built_at = _built(got.get("built_at"))
    reported = sum(1 for r in every if r["reported"])

    notes = [(NOTE_WEEKEND if got.get("weekend") is True else NOTE_NO_DAY).format(date=ds)] if no_day else [
        NOTE_WHAT.format(date=ds), NOTE_PRICED, NOTE_PAST]
    if reported:
        notes.append(NOTE_MOVE_TODAY if day_kind == "today" else NOTE_MOVE_PAST)
    if not no_day:
        notes.append(NOTE_TIME.format(at=built_at) if built_at else NOTE_NO_TIME)
    if got.get("default") is True and not asked:
        notes.append(NOTE_DEFAULT)
    # unknown is never claimed fresh: a day's answer with no build time is stale (a day the calendar does not carry
    # has no build time and nothing that ages)
    stale = how == "last_good" or (built_at is None and not no_day)
    if how == "last_good":
        notes.append(NOTE_LAST_GOOD.format(date=ds, minutes=fresh_minutes))
    if not no_day and not every:
        notes.append(NOTE_NOBODY.format(date=ds))
    elif not no_day and not kept:
        notes.append(NOTE_NO_MATCH.format(total=len(every), date=ds, when=SESSION_WORDS[session]))
    if priced_state == "failed":
        notes.append(NOTE_PRICED_FAILED)
    elif counts["priced_withheld"]:
        notes.append(NOTE_PRICED_WITHHELD.format(n=counts["priced_withheld"]))
    not_held = sum(1 for r in every if r["past"] is None and r["past_state"] == "not_held")
    if not_held:
        notes.append(NOTE_PAST_NOT_HELD.format(n=not_held, total=len(every)))
    if reported and moves_state == "not_held":
        notes.append(NOTE_MOVES_NOT_HELD.format(date=ds))
    elif reported and moves_state == "failed":
        notes.append(NOTE_MOVES_FAILED)
    if len(kept) > len(chosen):
        notes.append(NOTE_CUT.format(n=len(chosen), total=len(kept)))

    reach = got.get("range") if isinstance(got.get("range"), dict) else {}
    capture = got.get("capture") if isinstance(got.get("capture"), dict) else {}
    # `date` / `today` / `day_kind` / `sessions` / `counts` / `priced_state` / `moves_state` / `calendar_as_of` /
    # `built_at` / `capture` / `range` / `default` keep the route's own names (the ERNS panel's model reads them)
    data = {"date": ds, "today": today or None, "day_kind": day_kind, "default": got.get("default") is True and not asked,
            "session": session, "sessions": shown, "count": len(kept), "shown": len(chosen), "scheduled": len(every),
            "counts": counts, "priced_state": priced_state, "moves_state": moves_state if reported else None,
            "calendar_as_of": _built(got.get("calendar_as_of")), "built_at": built_at,
            "capture": {"hour_et": capture.get("hour_et"), "minute_et": capture.get("minute_et")},
            "range": {"from": reach.get("from"), "to": reach.get("to")}, "held": how, "no_day": no_day}
    coverage = {"evaluated": len(kept), "answered": len(chosen), "dropped": len(kept) - len(chosen),
                "not_computable": sum(1 for r in kept if r["reported"] and r["move"] is None)}
    partial = priced_state == "failed" or (bool(reported) and moves_state in ("not_held", "failed"))
    return env.make_envelope(KIND, params, status="partial" if partial else "ok",
                             freshness="historical" if day_kind == "past" else "periodic", as_of=None, source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
