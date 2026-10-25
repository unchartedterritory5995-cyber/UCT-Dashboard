"""Notebook widgets wave 9 (Task 9.3): routine day states, consistency and runs.

Everything here is derived over the trading-days spine (`trading_days`), never stored. A routine
is a list of items, each valid over a span of days, and a list of schedule versions, each in force
from its own day. A day's state is computed from the items and the schedule valid ON THAT DAY, so
a rename, a removal or a schedule change months later never rewrites a past day: a rename keeps
the item's id (and so its ticks), a removal sets the item's exclusive `to`, and a new schedule
starts at its own `effective_from`.

Day states, member copy (`STATE_LABELS`): Done, Not done, Skipped, Off day. `open` is a scheduled
day that is today or later and not yet done; it is never counted and never breaks a run.

Nothing counts as done without a member's tick (ruling W9-R5): a negative item ("No revenge
trades") is ticked like any other.

Pure: no I/O, and no clock except the `today` the caller passes.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Literal

from api.services.journal_two import trading_days
from api.services.journal_two.measures import DEFAULT_MIN_N, Measure, MeasureValue
from api.services.journal_two.notebook_widgets import _num

#: The write window reaches this many trading sessions back (ruling W9-R1).
WINDOW_SESSIONS = 7
#: Consistency reads the newest this-many scheduled, finished days.
CONSISTENCY_WINDOW = 20
#: A run is shown only from this length.
RUN_SHOWN_FROM = 3
#: Run lengths that read as a milestone (one line, nothing else).
MILESTONES = (7, 21, 50, 100)
#: The share of a day's items that makes the day done.
DONE_SHARES = (1.0, 0.75, 0.5)
#: History reads at most this many sessions back. R-8 parity: the same bound as the trading-days
#: widget (`widget_engine.sources.MAX_SESSIONS`), restated here because that module will import
#: this one; `tests/test_routine_days.py` pins the two together.
MAX_HISTORY_SESSIONS = 3700
SCHEDULE_KINDS = ("every", "weekdays", "traded")
STATE_LABELS = {"done": "Done", "not_done": "Not done", "skipped": "Skipped", "off": "Off day",
                "open": ""}
S_WINDOW = "Ticks can be added up to 7 trading days back."

State = Literal["done", "not_done", "skipped", "off", "open"]
_COUNTED = ("done", "not_done", "skipped")


# ── items ──────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Item:
    id: str
    text: str
    negative: bool
    suggest: dict | None
    valid_from: date
    valid_to: date | None   # exclusive


def _day(v, what: str) -> date:
    try:
        return date.fromisoformat(str(v))
    except (TypeError, ValueError):
        raise ValueError(f"{what} needs to look like 2026-10-24.") from None


def parse_items(raw: list) -> list[Item]:
    """The stored item JSON as `Item`s. A malformed date raises ValueError."""
    out: list[Item] = []
    for r in raw or []:
        to = r.get("to")
        suggest = r.get("suggest")
        out.append(Item(
            id=str(r["id"]),
            text=str(r.get("text") or ""),
            negative=bool(r.get("negative")),
            suggest=dict(suggest) if isinstance(suggest, dict) else None,
            valid_from=_day(r.get("from"), "An item's start date"),
            valid_to=_day(to, "An item's end date") if to else None,
        ))
    return out


def items_on(items: Iterable[Item], day: date) -> list[Item]:
    """The items valid on `day`: `valid_from <= day < valid_to`."""
    return [it for it in items
            if it.valid_from <= day and (it.valid_to is None or day < it.valid_to)]


# ── schedules ──────────────────────────────────────────────────────────────────────────────────

def schedule_on(schedules: list[tuple[str, dict]], day: date) -> dict | None:
    """The schedule in force on `day`: the row with the greatest `effective_from <= day`."""
    key = day.isoformat()
    best: tuple[str, dict] | None = None
    for eff, sched in schedules or []:
        eff = str(eff)[:10]
        if eff <= key and (best is None or eff > best[0]):
            best = (eff, sched)
    return best[1] if best else None


def is_scheduled(schedule: dict | None, day: date, traded: frozenset[str], *,
                 today: date | None = None) -> bool:
    """`every`: a session. `weekdays`: a session on a chosen weekday (Monday = 0). `traded`: a day
    with trades, and (ruling W9-R8) a session on or after `today`, so a pre-market routine can be
    ticked before the first trade; a past session with no trade is not scheduled. Past the
    calendar's horizon a session is a weekday (`trading_days.is_session`). No schedule, or an
    unknown kind, is never scheduled."""
    if not schedule:
        return False
    kind = schedule.get("kind")
    if kind == "every":
        return trading_days.is_session(day)
    if kind == "weekdays":
        days = schedule.get("days") or ()
        return trading_days.is_session(day) and day.weekday() in days
    if kind == "traded":
        if day.isoformat() in traded:
            return True
        return today is not None and day >= today and trading_days.is_session(day)
    return False


# ── one day ────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DayState:
    day: str
    state: State
    ticked: int
    of: int


def partial_label(ds: DayState) -> str | None:
    """"4 of 6"; None when no item applies (never "0 of 0")."""
    if ds.of == 0:
        return None
    return f"{ds.ticked} of {ds.of}"


def _needed(done_share: float, n: int) -> int:
    # `done_share` is one of DONE_SHARES (checked by the caller), all exact binary fractions, so
    # the product is exact and ceil needs no tolerance.
    return math.ceil(done_share * n)


def _is_tick(v) -> bool:
    """Ruling W9-R6: a tick counts when it is True or the integer 1 (the schema stores INTEGER).
    0 and False are unticked; anything else is ignored and reads unticked."""
    return v is True or (type(v) is int and v == 1)


def day_state(*, items: list[Item], schedule: dict | None, ticks: dict[str, bool], skipped: bool,
              day: date, today: date, created: date, traded: frozenset[str],
              done_share: float, archived: date | None = None) -> DayState:
    """The state of one day. Only ticks of items valid that day count.

    `off`: before the routine was created, after the day it was archived (ruling W9-R20: an
    archived routine is history only), not scheduled that day, or no item applies that day.
    `skipped`: the member skipped it. `done`: at least `ceil(done_share * items)` ticks.
    `open`: today or later and not done. Else `not_done`."""
    if done_share not in DONE_SHARES:
        raise ValueError("Pick how much of the routine counts as done.")
    applicable = items_on(items, day)
    ticks = ticks or {}
    ticked = sum(1 for it in applicable if _is_tick(ticks.get(it.id)))
    of = len(applicable)
    iso = day.isoformat()
    if (day < created or (archived is not None and day > archived)
            or not is_scheduled(schedule, day, traded, today=today) or of == 0):
        return DayState(iso, "off", ticked, of)
    if skipped:
        return DayState(iso, "skipped", ticked, of)
    if ticked >= _needed(done_share, of):
        return DayState(iso, "done", ticked, of)
    if day >= today:
        return DayState(iso, "open", ticked, of)
    return DayState(iso, "not_done", ticked, of)


# ── history ────────────────────────────────────────────────────────────────────────────────────

def history(*, items: list[Item], schedules: list[tuple[str, dict]],
            ticks_by_day: dict[str, dict[str, bool]], skipped_days: frozenset[str],
            created: date, upto: date, today: date, traded: frozenset[str],
            done_share: float, archived: date | None = None) -> list[DayState]:
    """Every session (every weekday past the horizon) from the later of `created` and the
    `MAX_HISTORY_SESSIONS`-th session on or before `upto`, to `upto`, oldest first; plus, under a
    `traded` schedule, each traded day that is not a session. An archived routine's history ends
    on the day it was archived (ruling W9-R20): no day after it exists, so none reads Not done."""
    if archived is not None:
        upto = min(upto, archived)
    if upto < created:
        return []
    lo = created
    # Calendar days bound sessions, so the session floor can only bind on a long history.
    if (upto - created).days >= MAX_HISTORY_SESSIONS:
        floor = trading_days.nth_session_before(upto + timedelta(days=1), MAX_HISTORY_SESSIONS)
        lo = max(lo, floor)
    days = set(trading_days.sessions(lo, upto).days)
    for t in traded or ():
        try:
            d = date.fromisoformat(t)
        except (TypeError, ValueError):
            continue
        if lo <= d <= upto and d not in days:
            sched = schedule_on(schedules, d)
            if sched and sched.get("kind") == "traded":
                days.add(d)
    out: list[DayState] = []
    for d in sorted(days):
        iso = d.isoformat()
        out.append(day_state(items=items, schedule=schedule_on(schedules, d),
                             ticks=ticks_by_day.get(iso) or {}, skipped=iso in skipped_days,
                             day=d, today=today, created=created, traded=traded,
                             done_share=done_share))
    return out


def window_floor(*, items: list[Item], schedules: list[tuple[str, dict]], created: date,
                 archived: date | None, traded: frozenset[str], before: date, today: date,
                 n: int | None = None) -> date:
    """The day history must start from so the consistency window is whole for every day from
    `before` on (ruling W9-R25): the `n`-th counted (scheduled, finished) day strictly before
    `before`, walking back over sessions (and, under a traded schedule, traded non-session days);
    `created` when there are fewer; never more than `MAX_HISTORY_SESSIONS` sessions back.

    Whether a day counts never depends on ticks (a scheduled past day is done, not done or
    skipped): only `created`, `archived`, the schedule in force, the traded set and the items
    valid that day. One backward pass per routine, so a sparse routine costs only itself.
    `n` defaults to `CONSISTENCY_WINDOW`, read at call time (never bound at import)."""
    if n is None:
        n = CONSISTENCY_WINDOW
    d = before - timedelta(days=1)
    if archived is not None and d > archived:
        d = archived
    seen = sessions_walked = 0
    while d >= created:
        session = trading_days.is_session(d)
        if session:
            sessions_walked += 1
            if sessions_walked > MAX_HISTORY_SESSIONS:
                return d + timedelta(days=1)
        if session or d.isoformat() in (traded or ()):
            sched = schedule_on(schedules, d)
            if (sched is not None and (session or sched.get("kind") == "traded")
                    and d < today and is_scheduled(sched, d, traded, today=today)
                    and items_on(items, d)):
                seen += 1
                if seen >= n:
                    return d
        d -= timedelta(days=1)
    return created


def _next_item_day(items: list[Item], d: date) -> date | None:
    """The first day on or after `d` on which some item is valid; None when there is none."""
    best: date | None = None
    for it in items:
        if it.valid_to is not None and it.valid_to <= d:
            continue
        cand = max(d, it.valid_from)
        if best is None or cand < best:
            best = cand
    return best


def has_scheduled_day(*, items: list[Item], schedules: list[tuple[str, dict]], created: date,
                      archived: date | None, traded: frozenset[str], lo: date, hi: date,
                      today: date) -> bool:
    """Whether the routine has a scheduled day in `[lo, hi]` (ruling W9-R36): a day on or after
    `created`, on or before `archived`, that its schedule in force runs on (`is_scheduled`, so a
    traded schedule needs the traded set) and on which some item is valid. A routine without one
    has no row in that span, so nothing of it needs reading or building.

    Decided from the schedules, created, archived, the traded set and the items alone, never from
    ticks. Cheap: traded days and today are checked one by one; an `every` or `weekdays` stretch
    stops at its first session that holds an item, and skips spans where no item is valid."""
    lo = max(lo, created)
    if archived is not None:
        hi = min(hi, archived)
    if hi < lo or not items:
        return False

    def runs_on(d: date) -> bool:
        sched = schedule_on(schedules, d)
        return (sched is not None and is_scheduled(sched, d, traded, today=today)
                and bool(items_on(items, d)))

    lo_s, hi_s = lo.isoformat(), hi.isoformat()
    for t in traded or ():
        if isinstance(t, str) and lo_s <= t <= hi_s:
            try:
                d = date.fromisoformat(t)
            except ValueError:
                continue
            if runs_on(d):
                return True
    if lo <= today <= hi and runs_on(today):
        return True
    # The schedule in force on a day is the first-listed row with the greatest effective_from on
    # or before it (`schedule_on`), so the rows cut the span into stretches of one schedule each.
    effs: dict[str, dict] = {}
    for eff, sched in schedules or []:
        effs.setdefault(str(eff)[:10], sched)
    keys = sorted(effs)
    for i, key in enumerate(keys):
        kind = (effs[key] or {}).get("kind")
        if kind not in ("every", "weekdays"):
            continue                    # a traded stretch runs only on the days checked above
        if kind == "weekdays" and not any(w in (0, 1, 2, 3, 4)
                                          for w in effs[key].get("days") or ()):
            continue                    # no weekday a session can fall on
        try:
            start = max(lo, date.fromisoformat(key))
            end = hi if i + 1 == len(keys) else min(
                hi, date.fromisoformat(keys[i + 1]) - timedelta(days=1))
        except ValueError:
            # an unreadable effective day: walk the whole span, day by day, with the exact rule
            d = lo
            while d <= hi:
                if runs_on(d):
                    return True
                d += timedelta(days=1)
            return False
        d = start
        while d <= end:
            nxt = _next_item_day(items, d)
            if nxt is None or nxt > end:
                break
            if runs_on(nxt):
                return True
            d = nxt + timedelta(days=1)
    return False


# ── consistency ────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Consistency:
    done: int
    scheduled: int
    skipped: int


def consistency(states: list[DayState], *, strict: bool,
                window: int = CONSISTENCY_WINDOW) -> Consistency | None:
    """Over the newest `window` scheduled, non-open days. None when there are none. The counts are
    the same in strict mode; `consistency_rate` decides what a skip means."""
    counted = [s for s in states if s.state in _COUNTED][-window:] if window > 0 else []
    if not counted:
        return None
    return Consistency(done=sum(1 for s in counted if s.state == "done"),
                       scheduled=len(counted),
                       skipped=sum(1 for s in counted if s.state == "skipped"))


def consistency_rate(c: Consistency | None, *, strict: bool) -> float | None:
    """`done / (scheduled - skipped)`; strict: `done / scheduled`. None on a zero denominator."""
    if c is None:
        return None
    denom = c.scheduled if strict else c.scheduled - c.skipped
    return c.done / denom if denom > 0 else None


def consistency_sentence(c: Consistency | None,
                         unit: Literal["trading days", "days you traded"]) -> str | None:
    """"18 of the last 20 trading days (2 skipped)". None for None, and None when nothing was done:
    no surface shows a consistency of 0."""
    if c is None or c.done <= 0:
        return None
    if c.scheduled == 1:
        unit = "trading day" if unit == "trading days" else "day you traded"
    text = f"{c.done} of the last {c.scheduled} {unit}"
    if c.skipped:
        text += f" ({c.skipped} skipped)"
    return text


# ── runs ───────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Runs:
    current: int
    best: int


def runs(states: Iterable[DayState], *, strict: bool) -> Runs:
    """`done` extends a run; `not_done` breaks it; `skipped` neither extends nor breaks it unless
    `strict`, where it breaks it; `off` and `open` are ignored. States are oldest first."""
    cur = best = 0
    for s in states:
        if s.state == "done":
            cur += 1
            best = max(best, cur)
        elif s.state == "not_done" or (s.state == "skipped" and strict):
            cur = 0
    return Runs(current=cur, best=best)


def run_line(current: int) -> str | None:
    """"7 sessions in a row" from `RUN_SHOWN_FROM`; None under it (never "0 sessions")."""
    if current < RUN_SHOWN_FROM:
        return None
    return f"{current} sessions in a row"


def is_milestone(current: int) -> bool:
    return current in MILESTONES


def best_line(r: Runs) -> str | None:
    """"Best run: 9 sessions", only once a run worth naming has ended and none is showing."""
    if r.current < RUN_SHOWN_FROM <= r.best:
        return f"Best run: {r.best} sessions"
    return None


# ── write window ───────────────────────────────────────────────────────────────────────────────

def write_window(today: date) -> tuple[date, date]:
    """Earliest: the 7th session strictly before `today`. Latest: the next session after it
    (ruling W9-R1: a night-before routine ticks the next trading day)."""
    return (trading_days.nth_session_before(today, WINDOW_SESSIONS),
            trading_days.next_session_after(today))


def in_window(day: date, today: date) -> bool:
    lo, hi = write_window(today)
    return lo <= day <= hi


# ── measures over routine-history rows ─────────────────────────────────────────────────────────
# Rows: {routine, day, state, ticked, of, strict, consistency}, one per routine per history day.

_SOURCES = frozenset({"routine_history"})


def _scheduled_rows(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("state") in _COUNTED]


def _routine_consistency(rows):
    done = denom = 0
    for r in _scheduled_rows(rows):
        if r["state"] == "skipped" and not r.get("strict"):
            continue
        denom += 1
        done += r["state"] == "done"
    # Ruling W9-R7: no surface shows a consistency of 0, so none done reads "no data".
    return MeasureValue(_num(done / denom) if denom and done else None, denom, None)


def _routine_completion_pct(rows):
    sched = _scheduled_rows(rows)
    done = sum(1 for r in sched if r["state"] == "done")
    # Ruling W9-R7: a completion of 0 is never shown.
    return MeasureValue(_num(done / len(sched)) if done else None, len(sched), None)


def _routine_days_done(rows):
    sched = _scheduled_rows(rows)
    done = sum(1 for r in sched if r["state"] == "done")
    # Ruling W9-R7: a count of 0 is never shown.
    return MeasureValue(_num(float(done)) if done else None, len(sched), None)


def _routine_best_run(rows):
    by: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by[str(r.get("routine") or "")].append(r)
    best = 0
    for rs in by.values():
        rs.sort(key=lambda r: str(r.get("day") or "")[:10])
        strict = any(r.get("strict") for r in rs)
        states = [DayState(str(r.get("day") or ""), r.get("state"), 0, 0) for r in rs]
        best = max(best, runs(states, strict=strict).best)
    n = len(_scheduled_rows(rows))
    return MeasureValue(_num(float(best)) if best > 0 else None, n, None)


def _m(key, label, meaning, kind, fn):
    return Measure(key, label, "process", meaning, "days", kind, DEFAULT_MIN_N, (), _SOURCES, fn)


ROUTINE_MEASURES: dict[str, Measure] = {m.key: m for m in [
    _m("routine_consistency", "Consistency",
       "Share of scheduled days you finished. Skipped days are left out unless the routine is "
       "strict.", "rate", _routine_consistency),
    _m("routine_completion_pct", "Completion %",
       "Share of scheduled days you finished, skipped days included.", "rate",
       _routine_completion_pct),
    _m("routine_days_done", "Days done", "Scheduled days you finished.", "count",
       _routine_days_done),
    _m("routine_best_run", "Best run", "Most finished days in a row.", "extreme",
       _routine_best_run),
]}
