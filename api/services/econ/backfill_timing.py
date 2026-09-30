"""Backfill placement: WHEN a backfilled observation became public, and its PIT class.

A backfilled row was not seen by UCT when it was released, so its `available_at` is
an ESTIMATE. The contract (PHASE1-DESIGN "Time + PIT rules") is that the estimate is
on the LATE side -- a chart / as-of query must never see a value before the agency
published it. Late is safe but inaccurate; early is a look-ahead leak. Full audit,
evidence and per-series table: docs/economic-data/BACKFILL-TIMING.md.

    place(spec, period_start, period_end, *, now, events=(), periods=()) -> Placement

ORDER (each step can only move the time LATER, except step 5, which replaces it
with the agency's own stated release time):
  1. registry rule      `release.lag_rule` (period_end + N days at T, business days, ...)
  2. family bounds      holiday/closure-aware release-day rules per calendar key (H.15 /
                        NY Fed / DTS next PUBLICATION day incl. executive-order closures and
                        the provider's own next observation date; H.4.1 Thursday->next
                        business day; WPSR / gasoline / DOL holiday weeks; ...) and ERA
                        margins for periods whose release practice is not evidenced
  3. PIT class          `pit.backfill_class`, downgraded U -> L for periods whose value was
                        NOT published at the time in this form (BACKCAST_BEFORE)
  4. funding lapse      calendars/funding_lapses.json: a row of an affected family whose
                        step-2 time falls in [lapse start, window end] is placed at
                        max(time, window end 23:59 ET) with window end =
                        max(lapse end + 60 d, the family's last catch-up release), and its
                        PIT class is downgraded to L (never U/V)
  5. snap               the AUTHORITATIVE release time of THIS period replaces the estimate:
                          a. calendars/release_history.json (agency archives: BLS, EIA WPSR,
                             Fed G.17, Census) -- a date-only row is the END of that ET day
                          b. an active calendar_event (authoritative_feed / authoritative_page /
                             configured; precision exact | time_configured; a NEW-period label
                             equal to the row's period). Labels UCT INFERS (BEA, MTS) must pass
                             a lag-plausibility check and are never used inside a lapse window.
                        The PIT class is unchanged by a snap.
  6. clamp              an un-snapped time is capped at `now` (first sighting); the result is
                        never earlier than any matched NEW event's schedule.
"""
from __future__ import annotations

import bisect
import json
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

from . import timeutil
from .model import AvailableAtMethod as M, PitClass, SchedulePrecision as P, ScheduleSource as S

CAL_DIR = Path(__file__).with_name("calendars")
LAPSE_FILE = "funding_lapses.json"
CLOSURE_FILE = "federal_closures.json"
HISTORY_FILE = "release_history.json"

POST_LAPSE_DAYS = 60
END_OF_DAY = "23:59"


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


@dataclass(frozen=True)
class Placement:
    available_at: int
    pit_class: str
    method: str                 # 'rule' | 'rule:lapse' | 'scheduled:history' | 'scheduled:calendar' | ...
    basis: str = ""             # human-readable why (audit / docs)
    lapse: Optional[str] = None


# ─────────────────────────────── data files ──────────────────────────────────

def _load(name: str) -> dict:
    return json.loads((CAL_DIR / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def closures() -> frozenset:
    """One-off federal closures (executive orders, days of mourning, OPM emergency
    closures). A closure is treated as a NON-publication day (late side)."""
    doc = _load(CLOSURE_FILE)
    return frozenset(timeutil.as_date(r[0]) for r in doc["closures"])


@dataclass(frozen=True)
class Lapse:
    id: str
    start: date
    end: date
    affected: tuple            # calendar-key patterns: 'bls:*' or 'fed:g17'
    catch_up: dict             # pattern -> last catch-up release date (ISO)
    confidence: str

    def matches(self, key: str) -> Optional[str]:
        for pat in self.affected:
            if pat == key or (pat.endswith(":*") and key.startswith(pat[:-1])):
                return pat
        return None

    def window_end(self, key: str) -> date:
        """max(lapse end + 60 d, every catch-up end whose pattern matches `key`) -- a
        key-specific catch-up ('bea:profits') can extend its family's ('bea:*')."""
        end = self.end + timedelta(days=POST_LAPSE_DAYS)
        for pat, cu in self.catch_up.items():
            if pat == key or (pat.endswith(":*") and key.startswith(pat[:-1])):
                end = max(end, timeutil.as_date(cu))
        return end


@lru_cache(maxsize=1)
def lapses() -> tuple:
    doc = _load(LAPSE_FILE)
    return tuple(Lapse(r["id"], timeutil.as_date(r["start"]), timeutil.as_date(r["end"]), tuple(r["affected"]),
                       dict(r.get("catch_up_end") or {}), r.get("confidence", "")) for r in doc["lapses"])


@lru_cache(maxsize=1)
def history() -> dict:
    return _load(HISTORY_FILE)["families"]


def clear_caches() -> None:
    closures.cache_clear()
    lapses.cache_clear()
    history.cache_clear()


# ─────────────────────────────── publication calendar ────────────────────────

def is_pub_day(d) -> bool:
    d = timeutil.as_date(d)
    return timeutil.is_business_day(d) and d not in closures()


def next_pub_day(d) -> date:
    d = timeutil.as_date(d) + timedelta(days=1)
    while not is_pub_day(d):
        d += timedelta(days=1)
    return d


def on_or_after_pub_day(d) -> date:
    d = timeutil.as_date(d)
    while not is_pub_day(d):
        d += timedelta(days=1)
    return d


def nth_pub_day_after(d, n: int) -> date:
    for _ in range(n):
        d = next_pub_day(d)
    return d


def _at(d, hhmm: str) -> int:
    return timeutil.et_to_utc(d, hhmm)


def _eod(d) -> int:
    return timeutil.et_to_utc(d, END_OF_DAY)


# ─────────────────────────────── 1. registry rule ────────────────────────────

def registry_rule(spec, period_start, period_end) -> Optional[int]:
    lag = (_g(spec, "release") or {}).get("lag_rule") or {}
    kind, days, t = lag.get("kind"), lag.get("days"), lag.get("time_et") or END_OF_DAY
    if kind == "period_end_plus_days":
        d = timeutil.as_date(period_end) + timedelta(days=int(days))
    elif kind == "period_start_plus_days":
        d = timeutil.as_date(period_start) + timedelta(days=int(days))
    elif kind == "business_days_after":
        d = timeutil.add_business_days(period_end, int(days))
    else:
        return None
    return _at(d, t)


def _rule_time(spec) -> str:
    return ((_g(spec, "release") or {}).get("lag_rule") or {}).get("time_et") or END_OF_DAY


# ─────────────────────────────── 2. family bounds ────────────────────────────

# Next-observation guard: the provider publishes observation d on its NEXT publication
# day, which is the next day it has an observation (SOFR skips SIFMA full closes such as
# Good Friday; H.15 skips days with no Treasury market). A gap longer than this is a data
# gap, not a closure, and is not used.
NEXT_OBS_MAX_GAP_DAYS = 7
DAILY_NEXT_KEYS = frozenset({"fed:h15", "nyfed:effr", "nyfed:obfr", "nyfed:sofr", "fiscal:dts", "fiscal:dtp"})

# Periods whose release practice is NOT evidenced get an extra late margin: (key,
# period_end strictly before, days after period_end, time ET, why). BACKFILL-TIMING.md.
ERA = {
    "bls:cpi": [("1953-01-01", 60, "08:30", "pre-1953: no release-date evidence (BLS table starts 1953)")],
    "bls:empsit": [("1957-06-01", 42, "08:30", "pre-Jun-1957: BLS release-date table says 'unknown'")],
    "bls:jolts": [("2004-02-01", 60, "10:00", "pre-2004 JOLTS: first published 2002 as a back-series; "
                                              "Feb-2004 data came 46 d after the month")],
    "bea:gdp": [("1985-01-01", 60, "08:30", "pre-1985: first-estimate lag not evidenced")],
    "bea:pio": [("1985-01-01", 60, "08:30", "pre-1985: release lag not evidenced")],
    "bea:profits": [("1985-01-01", 120, "08:30", "pre-1985: corporate-profits first-release lag not evidenced")],
    "fed:g17": [("1954-01-01", 40, "09:15", "1919-1953: IP released ~26th-31st (ALFRED rid=13)"),
                ("1997-11-01", 31, "09:15", "pre-Dec-1997: releases up to the 27th-31st seen (ALFRED); "
                                            "Fed archive (the evidence table) starts Dec 1997")],
    "census:resconst": [("2013-11-01", 29, "08:30", "pre-2014: no Census calendar evidence (+7 d)")],
    "census:m3adv": [("2013-11-01", 37, "08:30", "pre-2014: no Census calendar evidence (+7 d)")],
    "census:ft900": [("2013-11-01", 49, "08:30", "pre-2014: no Census calendar evidence (+7 d)")],
    "eia:wpsr": [("2011-08-05", 13, "11:00", "pre-Aug-2011: EIA archive starts 2011; ad-hoc delays "
                                             "(2022-06, 2023-11) are only evidenced after")],
    "eia:gasdiesel": [("2000-01-01", 3, "17:00", "pre-2000: release practice not evidenced")],
    "dol:claims": [("2000-01-01", 13, "08:30", "pre-2000: release practice not evidenced")],
    "fhfa:hpi_monthly": [("2012-01-01", 70, "09:00", "pre-2012: monthly HPI introduced 2008, release "
                                                     "day/time (10:00 era) not evidenced")],
    "nyfed:esms": [("2005-01-01", 24, "08:30", "pre-2005: release practice not evidenced (+7 d)")],
    "fed:h8": [("1996-05-29", 21, END_OF_DAY, "pre-1996-06: the Board's H.8 release-date archive starts 1996-06-14")],
    "fed:g19": [("1996-04-01", 50, END_OF_DAY, "pre-1996-06: the Board's G.19 release-date archive starts 1996-06-11")],
}

# U -> L: the stored value was NOT what was published at the time (back-cast, rebased,
# or not published daily). (symbol, period_start strictly before, why)
BACKCAST_BEFORE = {
    "USCPINSA": ("1988-01-01", "CPI rebased to 1982-84=100 in Jan 1988; earlier levels were published on "
                               "1967=100 (pre-1921 back-cast, 1921-1940 not published monthly)"),
    "USCORECPINSA": ("1988-01-01", "same rebase; 'all items less food and energy' introduced Apr 1977 with a "
                                   "back-series to 1957"),
    "UST10Y": ("1977-06-01", "10-year CMT not evidenced in the weekly H.15 before Jun 1977 (1966-69 issues "
                             "show only 'bonds due or callable in 10 years or more')"),
    "UST2Y": ("1977-06-01", "2-year CMT in the weekly H.15 evidenced from Jun 1977"),
    "USDEBT": ("2005-04-04", "Debt to the Penny: 'daily figures only from April 4, 2005 forward'"),
    "USDEBTPUB": ("2005-04-04", "Debt to the Penny: 'daily figures only from April 4, 2005 forward'"),
}

H15_WEEKLY_BEFORE = date(1999, 1, 1)      # daily web update evidenced by 1999-05 (ALFRED: weekly to 1996-12)
H15_DAILY_4PM_FROM = date(2016, 10, 11)   # 'published at 4:15pm every business day' from 2016-10-11


def _next_obs(periods, pe: date) -> Optional[date]:
    if not periods:
        return None
    i = bisect.bisect_right(periods, pe)
    return periods[i] if i < len(periods) else None


def family_bounds(spec, ps: date, pe: date, periods=()) -> list[tuple[int, str]]:
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    out: list[tuple[int, str]] = []
    t = _rule_time(spec)
    if key in DAILY_NEXT_KEYS:
        pub = next_pub_day(pe)
        nxt = _next_obs(periods, pe)
        if nxt is not None and pub < nxt <= pub + timedelta(days=NEXT_OBS_MAX_GAP_DAYS):
            pub = on_or_after_pub_day(nxt)
        if key == "fed:h15" and pe < H15_WEEKLY_BEFORE:
            monday = pe + timedelta(days=7 - pe.weekday())
            out.append((_eod(on_or_after_pub_day(monday)), "H.15 weekly era: the Monday release after the week"))
        elif key == "fed:h15" and pe < H15_DAILY_4PM_FROM:
            out.append((_eod(pub), "H.15 daily-update era (time not evidenced): end of the next publication day"))
        else:
            out.append((_at(pub, t), "next publication day (closures + provider's next observation)"))
    elif key == "fed:h41":
        out.append((_at(on_or_after_pub_day(pe + timedelta(days=1)), "16:30"),
                    "H.4.1 Thursday 16:30, next publication day after a holiday/closure"))
    elif key == "fed:h8":
        fri = pe + timedelta(days=9)
        if not is_pub_day(fri) and not timeutil.is_federal_holiday(fri):
            out.append((_eod(next_pub_day(fri)), "H.8 Friday is a closure (not a holiday): end of the next "
                                                 "publication day (2025-12-26 closure -> Monday 12-29)"))
    elif key == "fed:h6" and pe >= date(2021, 1, 31):
        nm = timeutil.add_months(pe.replace(day=1), 1)
        tue4 = timeutil._nth_weekday(nm.year, nm.month, 1, 4)
        out.append((_at(on_or_after_pub_day(tue4), "13:00"), "H.6 4th Tuesday 13:00 (monthly since 2021-02-23)"))
    elif key == "eia:wpsr":
        mon, wed = pe + timedelta(days=3), pe + timedelta(days=5)
        if not all(is_pub_day(mon + timedelta(days=k)) for k in range(3)):
            out.append((_eod(nth_pub_day_after(wed, 2)),
                        "holiday/closure Mon-Wed: end of the 2nd publication day after Wednesday"))
    elif key == "eia:gasdiesel":
        mon = pe
        if not (is_pub_day(mon) and is_pub_day(mon + timedelta(days=1))):
            out.append((_eod(nth_pub_day_after(mon, 2)),
                        "holiday/closure Mon/Tue: end of the 2nd publication day after the survey Monday"))
    elif key == "dol:claims":
        thu, fri = pe + timedelta(days=5), pe + timedelta(days=6)
        if not is_pub_day(thu) and not is_pub_day(fri):
            out.append((_eod(next_pub_day(fri)), "Thursday AND Friday closed: end of the next publication day"))
    elif key == "fhfa:hpi_monthly":
        out.append((_eod(pe + timedelta(days=62)), "FHFA m+2 (a 10:00 release era existed): end of day"))
    for before, days, hhmm, why in ERA.get(key, ()):
        if pe < timeutil.as_date(before):
            out.append((_at(pe + timedelta(days=days), hhmm), f"era: {why}"))
            break
    return out


# ─────────────────────────────── 5. snap sources ─────────────────────────────

INFERRED_LABEL_KEYS = {"bea:gdp": 25, "bea:pio": 25, "bea:profits": 45, "fiscal:mts": 5}   # key -> min plausible lag (days)
SNAP_SOURCES = frozenset({S.AUTHORITATIVE_FEED.value, S.AUTHORITATIVE_PAGE.value, S.CONFIGURED.value})
SNAP_PRECISION = frozenset({P.EXACT.value, P.TIME_CONFIGURED.value})


def label_for(spec, ps: date) -> str:
    f = str(_g(spec, "frequency") or "").upper()
    if f == "M":
        return f"{ps.year:04d}-{ps.month:02d}"
    if f == "Q":
        return f"{ps.year:04d}Q{(ps.month - 1) // 3 + 1}"
    if f == "A":
        return f"{ps.year:04d}"
    return ""


def history_snap(spec, ps: date, pe: date) -> Optional[tuple[int, str]]:
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    fam = history().get(key)
    if not fam:
        return None
    f = str(_g(spec, "frequency") or "").upper()
    lab = pe.isoformat() if f in ("W", "D") else label_for(spec, ps)
    row = fam.get(lab)
    if not row:
        return None
    d, hhmm, prec, src = row[0], row[1], row[2], row[3]
    if hhmm:
        return _at(d, hhmm), f"history {src} {d} {hhmm} ({prec})"
    return _eod(d), f"history {src} {d} (date only -> end of day)"


def calendar_snap(spec, ps: date, pe: date, events, in_lapse: bool) -> Optional[tuple[int, str]]:
    from . import calendar as cal
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    best = None
    for ev in events or ():
        if ev.source not in SNAP_SOURCES or ev.precision not in SNAP_PRECISION or not ev.has_time:
            continue
        exp = cal.expected_period(spec, ev)
        if exp is None or exp.kind != "new" or exp.period_start != ps.isoformat():
            continue
        if key in INFERRED_LABEL_KEYS:
            if in_lapse:
                continue
            if (timeutil.as_date(ev.sched_date) - pe).days < INFERRED_LABEL_KEYS[key]:
                continue
        if best is None or ev.scheduled_at < best.scheduled_at:
            best = ev
    if best is None:
        return None
    return best.scheduled_at, f"calendar {best.calendar_key}:{best.period_label} {best.sched_date} " \
                              f"{best.sched_time} ({best.source}/{best.precision})"


def matched_new_events(spec, ps: date, events) -> list:
    from . import calendar as cal
    out = []
    for ev in events or ():
        exp = cal.expected_period(spec, ev)
        if exp and exp.kind == "new" and exp.period_start == ps.isoformat():
            out.append(ev)
    return out


# ─────────────────────────────── the placement ───────────────────────────────

def lapse_for(key: str, t: int) -> Optional[tuple[Lapse, date]]:
    d = timeutil.et_date(t)
    for lp in lapses():
        if lp.matches(key) and lp.start <= d <= lp.window_end(key):
            return lp, lp.window_end(key)
    return None


def place(spec, period_start, period_end, *, now: int, events: Iterable = (), periods=()) -> Optional[Placement]:
    """The conservative placement of one backfilled observation (module doc). None when
    the registry has no lag rule (the caller refuses to place history then)."""
    ps, pe = timeutil.as_date(period_start), timeutil.as_date(period_end)
    t0 = registry_rule(spec, ps, pe)
    if t0 is None:
        return None
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    t, why = t0, ["registry rule"]
    for tb, w in family_bounds(spec, ps, pe, periods):
        if tb > t:
            t, why = tb, [w]
    pit = str((_g(spec, "pit") or {}).get("backfill_class") or PitClass.LATEST_BACKFILL.value)
    bc = BACKCAST_BEFORE.get(str(_g(spec, "symbol") or ""))
    if bc and pit in (PitClass.UNREVISED_HISTORY.value, PitClass.TRUE_VINTAGE.value) and \
            ps < timeutil.as_date(bc[0]):
        pit = PitClass.LATEST_BACKFILL.value
        why.append(f"PIT L: {bc[1]}")
    method = M.RULE.value
    lp = lapse_for(key, t)
    lapse_id = None
    if lp is not None:
        lapse, wend = lp
        lapse_id = lapse.id
        t = max(t, _eod(wend))
        method = f"{M.RULE.value}:lapse"
        why.append(f"funding lapse {lapse.id}: >= {wend} 23:59 ET")
        if pit in (PitClass.UNREVISED_HISTORY.value, PitClass.TRUE_VINTAGE.value):
            pit = PitClass.LATEST_BACKFILL.value
    snap = history_snap(spec, ps, pe)
    how = "history"
    if snap is None:
        snap = calendar_snap(spec, ps, pe, events, in_lapse=lp is not None)
        how = "calendar"
    if snap is not None:
        t = snap[0]
        method = f"{M.SCHEDULED.value}:{how}"
        why.append(snap[1])
    else:
        t = min(t, int(now))
    for ev in matched_new_events(spec, ps, events):
        if ev.scheduled_at > t:
            t = ev.scheduled_at
            why.append(f"never before the known schedule {ev.calendar_key}:{ev.period_label}")
    return Placement(int(t), pit, method, "; ".join(why), lapse_id)
