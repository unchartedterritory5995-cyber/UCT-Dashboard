"""WHEN A COT REPORT BECAME PUBLIC — the knowledge time of a CFTC Commitments of Traders row.

⛔⛔ AS-OF IS NOT AVAILABLE. A COT report describes positions at the close of an AS-OF
Tuesday and CFTC publishes it the following Friday at 15:30 ET — later around federal
holidays, and weeks later after a funding lapse or a data outage. `cot_records` keeps
only the as-of date, so a series dated by it hands every consumer — chart, formula,
condition, alert — positions that were not yet public. This module answers the other
question: at what instant could anyone have known this report?

ORDER (each answer is LATE-side; a report may be seen late, never early):
  1. an explicit CFTC schedule for that as-of date (`cot_release_schedule.json`
     `overrides`: the 2025 lapse table, the 2018-19 catch-up)
  2. a late-side bound covering that as-of date (`bounds`: the 2023 ION outage)
  3. the normal rule: the Friday of the as-of week at 15:30 ET; a federal holiday or
     closure on that Wednesday, Thursday or Friday moves it to the next federal
     publication day (the econ package's federal calendar, read-only)
  4. a federal funding lapse (the econ package's lapse table, read-only) covering the
     rule's release date, with no CFTC schedule above: the end of the lapse's late-side
     window (lapse end + 60 days)

The Breadth page's COT tab is untouched: it still LABELS a report by its as-of date,
which is the right label for a table of reports. This is the date a machine may USE it.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

from api.services.econ import backfill_timing as _fed
from api.services.econ import timeutil as _tu

SCHEDULE_FILE = Path(__file__).with_name("cot_release_schedule.json")

#: The regular session's close, ET. A report public by then is part of that day's bar.
SESSION_CLOSE_ET = "16:00"


@lru_cache(maxsize=1)
def schedule() -> dict:
    return json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))


def _release_time() -> str:
    return schedule().get("release_time_et") or "15:30"


def rule_release_date(asof) -> date:
    """The normal release DATE for an as-of date: that week's Friday, pushed to the next
    federal publication day when the Wednesday, Thursday or Friday is not one."""
    d = _tu.as_date(asof)
    friday = d + timedelta(days=(4 - d.weekday()) % 7)
    wednesday = friday - timedelta(days=2)
    days = [wednesday + timedelta(days=i) for i in range(3)]
    if all(_fed.is_pub_day(x) for x in days):
        return friday
    return _fed.next_pub_day(friday)


def available_at(asof) -> tuple[int, str]:
    """`(unix seconds UTC, method)` — the first instant this report was public."""
    d = _tu.as_date(asof)
    iso = d.isoformat()
    doc = schedule()
    for ov in doc.get("overrides") or []:
        rel = (ov.get("releases") or {}).get(iso)
        if rel:
            return _tu.et_to_utc(rel, _release_time()), f"schedule:{ov['id']}"
    for b in doc.get("bounds") or []:
        if b["asof_from"] <= iso <= b["asof_through"]:
            return (_tu.et_to_utc(b["available_date"], b.get("available_time_et") or "23:59"),
                    f"bound:{b['id']}")
    rel = rule_release_date(d)
    for lp in _fed.lapses():
        if lp.start <= rel <= lp.end:
            # ⚠️ NOT IN ANY CFTC TABLE ABOVE, SO NOTHING SAYS WHEN IT CAME OUT — the
            # lapse's late-side window end, never the rule date inside a shutdown.
            end = lp.end + timedelta(days=_fed.POST_LAPSE_DAYS)
            return _tu.et_to_utc(end, "23:59"), f"lapse:{lp.id}"
    return _tu.et_to_utc(rel, _release_time()), "rule"


def available_day(asof) -> str:
    """The first DAILY bar whose close could know this report, ISO.

    A report public by the session close belongs to that day's bar (the bar IS the
    close); one published later belongs to the next weekday.
    """
    ts, _ = available_at(asof)
    et = _tu.utc_to_et(ts)
    day = et.date()
    close = _tu.et_to_utc(day, SESSION_CLOSE_ET)
    if ts > close or day.weekday() >= 5:
        day += timedelta(days=1)
        while day.weekday() >= 5:
            day += timedelta(days=1)
    return day.isoformat()


def is_public(asof, at_ts: int) -> bool:
    """Was the report for `asof` public at unix time `at_ts`?"""
    return at_ts >= available_at(asof)[0]


def latest_public(asofs, at_ts: int) -> Optional[str]:
    """The newest as-of date among `asofs` that was public at `at_ts`, or None."""
    best = None
    for a in asofs:
        iso = _tu.as_date(a).isoformat()
        if is_public(iso, at_ts) and (best is None or iso > best):
            best = iso
    return best
