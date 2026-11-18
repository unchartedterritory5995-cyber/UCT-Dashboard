"""U-HTF-CALENDAR: the year TradingView's exchange calendar begins, read off TradingView's own columns.

Roadmap entry U-HTF-CALENDAR (docs/pine/PARITY-ROADMAP-2026-11-18.md). With look-ahead off, a completed week or
month is shown on the daily chart on its LAST session. The exception is a SHORT period (its last session is not the
period's last weekday) before the calendar begins: that one is shown on the NEXT bar. The probe
`vw-request-htf-alignment` plots the weekly close (A02) and the monthly close (A05) with look-ahead off. Its two
Q-HTF-CAL-1 captures (AMEX:SPY 1D and NASDAQ:QQQ 1D, from the listing, packet 39001cc9653b, licence probe) say:

  * every short period whose last session is before 2000 is shown on the NEXT bar;
  * every one from 2000 is shown on its LAST bar;
  * except the week of 10 September 2001 (its other sessions, 11-14 September, closed without notice),
    which is shown on the NEXT bar.

These rails re-read that from the committed captures. The controls check that the reader can tell the two readings
apart, so the rails cannot pass by answering the same thing everywhere.
"""
from __future__ import annotations

import collections
import copy
import datetime
import json
import pathlib
import sys

import pytest

HARNESS = pathlib.Path(__file__).resolve().parent / "fixtures" / "vendor" / "harness"
SPY = HARNESS / "vw-request-htf-alignment-spy-1d-2026-11-18.json"
QQQ = HARNESS / "vw-request-htf-alignment-qqq-1d-2026-11-18.json"
CALENDAR_START = datetime.date(2000, 1, 1)
UNSCHEDULED = {datetime.date(2001, 9, 10)}  # the last session of a week the calendar does not hold
PLOT = {"W": "A02_close_W_lookahead_OFF", "M": "A05_close_M_lookahead_OFF"}


def _load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _short(kind: str, last: datetime.date) -> bool:
    if kind == "W":
        return last.weekday() != 4
    d = last + datetime.timedelta(days=1)
    while d.month == last.month:
        if d.weekday() < 5:
            return True
        d += datetime.timedelta(days=1)
    return False


def read_periods(cap: dict, kind: str) -> list[tuple[datetime.date, bool, str]]:
    """(last session, short?, where the vendor showed the completed value) for every period with a neighbour on
    both sides: `last`, `next`, `unchanged` (its close equals the period before, so the bar cannot be read) or
    `other`."""
    rows = cap["bars"]["rows"]
    fields = cap["plotValues"]["fields"]
    titles = {p["id"]: p["title"] for p in cap["study"]["plots"]}
    k = next(i for i, f in enumerate(fields) if titles.get(f) == PLOT[kind])
    by_t = {r[0]: r for r in cap["plotValues"]["rows"]}
    days = [datetime.datetime.fromtimestamp(r[0], datetime.timezone.utc).date() for r in rows]
    key = (lambda d: d.isocalendar()[:2]) if kind == "W" else (lambda d: (d.year, d.month))
    groups: dict = collections.OrderedDict()
    for i, d in enumerate(days):
        groups.setdefault(key(d), []).append(i)
    periods = list(groups.values())

    def val(i):
        r = by_t.get(rows[i][0])
        return None if r is None else r[k]

    def eq(a, b):
        return a is not None and b is not None and abs(a - b) < 1e-6

    out = []
    for p in range(1, len(periods) - 1):
        last, nxt = periods[p][-1], periods[p + 1][0]
        cw, cp = rows[last][4], rows[periods[p - 1][-1]][4]
        if eq(cw, cp):
            where = "unchanged"
        elif eq(val(last), cw):
            where = "last"
        elif eq(val(last), cp) and eq(val(nxt), cw):
            where = "next"
        else:
            where = "other"
        out.append((days[last], _short(kind, days[last]), where))
    return out


def rule_breaks(periods) -> list[str]:
    """Every period the calendar rule does not explain, by name."""
    bad = []
    for day, short, where in periods:
        if where == "unchanged":
            continue
        want = "next" if short and (day < CALENDAR_START or day in UNSCHEDULED) else "last"
        if where != want:
            bad.append(f"{day} ({'short' if short else 'full'}): shown on the {where} bar, the rule says {want}")
    return bad


@pytest.fixture(scope="module")
def caps():
    return {"SPY": _load(SPY), "QQQ": _load(QQQ)}


@pytest.mark.parametrize("sym", ["SPY", "QQQ"])
@pytest.mark.parametrize("kind", ["W", "M"])
def test_the_calendar_begins_in_2000(caps, sym, kind):
    assert rule_breaks(read_periods(caps[sym], kind)) == []


def test_the_counts_the_roadmap_states(caps):
    def count(sym, kind):
        c = collections.Counter()
        for day, short, where in read_periods(caps[sym], kind):
            if short:
                c[(where, day < CALENDAR_START)] += 1
        return dict(c)
    # (where, before 2000) -> short periods; the one `next` from 2000 is the week of 10 September 2001
    assert count("SPY", "W") == {("next", True): 13, ("next", False): 1, ("last", False): 46}
    assert count("SPY", "M") == {("next", True): 2, ("last", False): 7}
    assert count("QQQ", "W") == {("next", True): 2, ("next", False): 1, ("last", False): 46}
    assert count("QQQ", "M") == {("next", True): 1, ("last", False): 7}


def test_control_the_reader_tells_last_from_next(caps):
    """Doctor ONE short week (20 April 2000, read `last`) to the next-bar reading: the rule must name it."""
    cap = copy.deepcopy(caps["SPY"])
    rows = cap["bars"]["rows"]
    days = [datetime.datetime.fromtimestamp(r[0], datetime.timezone.utc).date() for r in rows]
    i = days.index(datetime.date(2000, 4, 20))
    prev_close = rows[days.index(datetime.date(2000, 4, 14))][4]
    fields = cap["plotValues"]["fields"]
    titles = {p["id"]: p["title"] for p in cap["study"]["plots"]}
    k = next(j for j, f in enumerate(fields) if titles.get(f) == PLOT["W"])
    by_t = {r[0]: r for r in cap["plotValues"]["rows"]}
    by_t[rows[i][0]][k] = prev_close          # the short week's last session still shows the week before
    by_t[rows[i + 1][0]][k] = rows[i][4]      # and its close appears on the next bar
    bad = rule_breaks(read_periods(cap, "W"))
    assert bad == ["2000-04-20 (short): shown on the next bar, the rule says last"]


def test_control_a_later_calendar_start_is_refused(caps, monkeypatch):
    """The year is the evidence's, not a free parameter: moving the start to 2001 or 1999 must break the rule."""
    for year in (1999, 2001):
        monkeypatch.setattr(sys.modules[__name__], "CALENDAR_START", datetime.date(year, 1, 1))
        assert rule_breaks(read_periods(caps["SPY"], "W")), year
