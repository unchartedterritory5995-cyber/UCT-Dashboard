"""VFP, the volume footprint and gaps (api/services/volume_footprint_calc.py, api/services/volume_footprint.py,
api/routers/volume_footprint.py). Every price, volume, date, report date and symbol here is INVENTED.

  * accumulation and distribution: the 0.2% line judged before rounding, more volume than the session
    before, a missing volume not judged, the 25 and 50 windows, the days listed newest first; up/down
    volume (an unchanged close counts in neither, a missing volume means no ratio);
  * the biggest volume days: the last year only, largest first, a tie to the newer, the multiple over the
    50 sessions BEFORE the day, the change, where it closed in its range, the earnings mark;
  * pocket pivots: more volume than every down day of the 10 before, above the 10-day line, no down day
    is no pivot, a missing volume is not judged, the last year, newest first;
  * gaps: 3% judged before rounding, up and down, filled the same session / later / never, the shares
    within 5 and 20 sessions over the gaps old enough to say, the cut list, the mark over 40%, the block
    search equal to a plain scan;
  * earnings: the run of consecutive quarters, the scheduled report and the day the page was built, the
    marks (on the day, the day after, a weekend report, inside and outside the span);
  * the reads and the held answers: settled sessions only, per symbol per session, a lagging stock, a
    failed read never held, the cap, one build per symbol, the slot bound, the earnings dates looked at
    again and only a change rebuilds, the earnings read never builds;
  * the route: one paid GET, 401 / 402 / 400, its own gate, a plain def, mounted.
"""
from __future__ import annotations

import pathlib
import random
import threading
import time
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import volume_footprint as vfp_route
from api.services import volume_footprint as V
from api.services import volume_footprint_calc as C

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE = {"id": "vfp-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID = {"id": "vfp-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}


def vfp_weekdays(start: str, n: int) -> list[str]:
    d, out = date.fromisoformat(start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def vfp_weekdays_ending(end: str, n: int) -> list[str]:
    d, out = date.fromisoformat(end), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out[::-1]


def flat_bars(days, close=100.0, vol=1000.0):
    """Unchanged closes on even volume: nothing accumulates, nothing gaps."""
    return [(d, close, close * 1.01, close * 0.99, close, vol) for d in days]


def with_close(bars, i, close, vol=None, open_=None, hi=None, lo=None):
    d, o, h, l, c, v = bars[i]
    o = open_ if open_ is not None else o
    h = hi if hi is not None else max(h, close, o)
    l = lo if lo is not None else min(l, close, o)
    bars[i] = (d, o, h, l, close, vol if vol is not None else v)


def never(i):
    return None


@pytest.fixture(autouse=True)
def _vfp_fresh():
    V.reset_for_tests()
    yield
    V.reset_for_tests()


# ── 1. accumulation and distribution ───────────────────────────────────────────────────────────

def test_an_accumulation_day_is_0_2_percent_up_on_more_volume_and_exactly_0_2_counts():
    b = flat_bars(vfp_weekdays("2031-01-06", 3))
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 100.2, 1500.0)              # +0.2% exactly, more volume
    assert C.ad_kind(b, 1) == "accumulation"
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 100.19, 1500.0)             # +0.19%: neither
    assert C.ad_kind(b, 1) == "neither"
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 99.8, 1500.0)               # -0.2% exactly, more volume
    assert C.ad_kind(b, 1) == "distribution"
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 103.0, 1000.0)              # +3% on the SAME volume: neither
    assert C.ad_kind(b, 1) == "neither"
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 103.0, None)                # no volume held: not judged
    assert C.ad_kind(b, 1) is None
    b[1] = (b[1][0], 100.0, 101.0, 99.0, 103.0, 1500.0)
    b[0] = b[0][:5] + (None,)                                        # nor when the session before has none
    assert C.ad_kind(b, 1) is None


def test_the_25_and_50_windows_count_net_and_list_the_days_newest_first():
    days = vfp_weekdays("2031-01-06", 60)
    b = flat_bars(days)
    # session index 59 (newest): distribution; 50: accumulation; 30: distribution (outside 25, inside 50)
    with_close(b, 59, 98.0, vol=2000.0)
    with_close(b, 50, 101.0, vol=2000.0)
    with_close(b, 51, 101.0, vol=1000.0)                             # the day after: unchanged close
    for i in range(52, 59):
        with_close(b, i, 101.0)
    for i in range(30, 50):
        with_close(b, i, 100.0)
    with_close(b, 30, 99.0, vol=1800.0)
    for i in range(31, 50):
        with_close(b, i, 99.0)
    with_close(b, 50, 101.0, vol=2000.0)
    got = C.accumulation(b)
    w25, w50 = got["windows"]
    assert w25 == {"state": "ok", "sessions": 25, "from": days[35], "accumulation": 1, "distribution": 1, "net": 0, "not_judged": 0}
    assert (w50["accumulation"], w50["distribution"], w50["net"], w50["from"]) == (1, 2, -1, days[10])
    assert [(d["date"], d["kind"]) for d in got["days"]] == [(days[59], "distribution"), (days[50], "accumulation"),
                                                             (days[30], "distribution")]
    assert got["days"][0]["change_pct"] == round((98.0 / 101.0 - 1) * 100, 2) and got["days"][0]["vs_prior"] == 2.0
    assert got["days"][0]["session"] == 1 and got["days"][1]["session"] == 10
    assert got["min_move_pct"] == 0.2 and got["as_of"] == days[59]


def test_too_few_sessions_for_a_window_is_words_and_a_missing_volume_is_counted_not_judged():
    b = flat_bars(vfp_weekdays("2031-01-06", 30))
    b[-3] = b[-3][:5] + (None,)
    got = C.accumulation(b)
    assert got["windows"][0]["not_judged"] == 2                      # that session and the one after it
    assert got["windows"][1] == {"state": "short", "needed": 51, "held": 30, "unit": "sessions", "sessions": 50}
    assert got["updown"]["state"] == "short"


def test_up_down_volume_is_up_closes_volume_over_down_closes_and_a_flat_close_is_neither():
    days = vfp_weekdays("2031-01-06", 51)
    b = flat_bars(days)
    with_close(b, 49, 101.0, vol=3000.0)                             # up on 3000
    with_close(b, 50, 100.0, vol=1500.0)                             # down on 1500; 48 unchanged closes
    got = C.updown(b)
    assert got == {"state": "ok", "sessions": 50, "from": days[1], "up_volume": 3000, "down_volume": 1500,
                   "up_sessions": 1, "down_sessions": 1, "flat_sessions": 48, "no_volume": 0, "ratio": 2.0}
    b[49] = b[49][:5] + (None,)                                      # the up day's volume is not held
    got = C.updown(b)
    assert got["ratio"] is None and got["no_volume"] == 1            # a missing volume: no ratio (never 0 / 1500)
    assert got["down_volume"] == 1500 and got["up_volume"] == 0
    only_up = flat_bars(days)
    with_close(only_up, 50, 101.0)
    assert C.updown(only_up)["ratio"] is None                        # nothing closed down: no ratio, never infinity


# ── 2. the biggest volume days ─────────────────────────────────────────────────────────────────

def test_the_biggest_volume_days_are_the_last_years_largest_first_and_a_tie_goes_to_the_newer():
    days = vfp_weekdays_ending("2031-06-02", 320)
    b = [(d, 100.0, 101.0, 99.0, 100.0, 1000.0 + i) for i, d in enumerate(days)]
    start = "2030-06-02"
    old = max(i for i, d in enumerate(days) if d <= start)
    b[old] = b[old][:5] + (900000.0,)                                # the biggest ever, but before the year
    b[300] = b[300][:5] + (50000.0,)
    b[310] = b[310][:5] + (50000.0,)                                 # a tie with 300: the newer first
    b[290] = b[290][:5] + (40000.0,)
    got = C.big_days(b, never)
    assert got["from"] == start and got["full_year"] is True and len(got["rows"]) == 10
    assert [r["date"] for r in got["rows"][:3]] == [days[310], days[300], days[290]]
    assert days[old] not in [r["date"] for r in got["rows"]]
    assert all(r["date"] > start for r in got["rows"])
    vols = [r["volume"] for r in got["rows"]]
    assert vols == sorted(vols, reverse=True)


def test_a_big_days_multiple_is_over_the_50_sessions_before_it_with_its_change_and_close_in_range():
    days = vfp_weekdays_ending("2031-06-02", 300)
    b = [(d, 100.0, 101.0, 99.0, 100.0, 1000.0 + (i % 7) * 10) for i, d in enumerate(days)]
    b[280] = (days[280], 100.0, 110.0, 100.0, 107.5, 9000.0)         # +7.5%, closed 75% up its range
    row = C.big_days(b, never)["rows"][0]
    before = [b[j][5] for j in range(230, 280)]
    assert row["date"] == days[280] and row["volume"] == 9000
    assert row["avg_volume"] == round(sum(before) / 50)
    assert row["vs_avg"] == round(9000.0 / (sum(before) / 50), 2)
    assert row["vs_avg"] != round(9000.0 / (sum(b[j][5] for j in range(231, 281)) / 50), 2)   # the day itself is left out
    assert row["change_pct"] == 7.5 and row["close_in_range_pct"] == 75.0
    b[250] = b[250][:5] + (None,)
    row = C.big_days(b, never)["rows"][0]
    assert row["avg_volume"] is None and row["vs_avg"] is None       # a missing volume is no average


def test_a_young_stock_says_its_year_is_short_and_a_day_with_no_range_has_no_close_in_range():
    days = vfp_weekdays("2031-01-06", 40)
    b = [(d, 10.0, 10.0, 10.0, 10.0, 100.0 + i) for i, d in enumerate(days)]
    got = C.big_days(b, lambda i: True if i == 39 else None)
    assert got["full_year"] is False and got["held_from"] == days[0]
    top = got["rows"][0]
    assert top["date"] == days[39] and top["close_in_range_pct"] is None and top["avg_volume"] is None
    assert top["earnings"] is True and got["summary"]["earnings"] == 1 and got["summary"]["earnings_unknown"] == 9


# ── 3. pocket pivots ───────────────────────────────────────────────────────────────────────────

def _pivot_series():
    """30 sessions: a down day on 5000 at index 15, small days after, then index 25 up on 6000 above the line."""
    days = vfp_weekdays_ending("2031-06-02", 30)
    b = flat_bars(days, 100.0, 1000.0)
    with_close(b, 15, 99.0, vol=5000.0)                              # a down day: the largest down volume
    for i in range(16, 25):
        with_close(b, i, 99.0, vol=1000.0)
    with_close(b, 25, 101.0, vol=6000.0)                             # up, above the largest down day, above the line
    for i in range(26, 30):
        with_close(b, i, 101.0, vol=1000.0)
    return days, b


def test_a_pocket_pivot_beats_every_down_days_volume_of_the_10_before_and_closes_above_the_10_day_line():
    days, b = _pivot_series()
    got = C.pocket_pivots(b, lambda i: False)
    assert got["state"] == "ok" and got["count"] == 1
    row = got["rows"][0]
    ma = sum(x[4] for x in b[16:26]) / 10
    assert row == {"date": days[25], "change_pct": round((101 / 99 - 1) * 100, 2), "volume": 6000, "down_max": 5000,
                   "vs_down_max": 1.2, "ma": round(ma, 4), "above_ma_pct": round((101 / ma - 1) * 100, 2), "earnings": False}


def test_equal_volume_below_the_line_or_no_down_day_is_no_pivot_and_a_missing_volume_is_not_judged():
    days, b = _pivot_series()
    with_close(b, 25, 101.0, vol=5000.0)                             # equal to the largest down day: not more
    assert C.pocket_pivots(b, never)["count"] == 0
    days, b = _pivot_series()
    for i in range(16, 20):
        with_close(b, i, 104.0, vol=1000.0)                          # higher closes before it lift the line
    with_close(b, 20, 99.0, vol=1000.0)
    assert sum(x[4] for x in b[16:26]) / 10 == pytest.approx(101.2)  # 101 is up on the day, but under the 10-day line
    assert C.pocket_pivots(b, never)["count"] == 0
    days, b = _pivot_series()
    with_close(b, 15, 100.0, vol=5000.0)                             # no down day in the 10 before
    for i in range(16, 25):
        with_close(b, i, 100.0 + (i - 15) * 0.01, vol=1000.0)
    assert C.pocket_pivots(b, never)["count"] == 0
    days, b = _pivot_series()
    b[15] = b[15][:5] + (None,)
    got = C.pocket_pivots(b, never)
    assert got["count"] == 0 and got["not_judged"] >= 1


def test_pivots_are_the_last_years_newest_first_and_too_little_history_is_words():
    days = vfp_weekdays_ending("2031-06-02", 300)
    b = flat_bars(days)
    assert days[20] < "2030-06-02" < days[200]
    for k in (20, 200, 280):                                         # three pivots; the one at 20 is before the year
        with_close(b, k - 3, 99.0, vol=4000.0)
        for i in range(k - 2, k):
            with_close(b, i, 99.0)
        with_close(b, k, 100.5, vol=5000.0)
        for i in range(k + 1, min(k + 15, 300)):
            with_close(b, i, 100.5)
    got = C.pocket_pivots(b, never)
    assert [r["date"] for r in got["rows"]] == [days[280], days[200]]
    assert got["full_year"] is True and got["judged_from"] > got["from"]
    short = C.pocket_pivots(flat_bars(vfp_weekdays("2031-01-06", 11)), never)
    assert short["state"] == "short" and short["needed"] == 12 and short["held"] == 11


# ── 4. gaps ────────────────────────────────────────────────────────────────────────────────────

def test_a_gap_is_3_percent_open_to_prior_close_either_way_and_exactly_3_counts():
    days = vfp_weekdays("2031-01-06", 12)
    b = flat_bars(days)
    b[3] = (days[3], 103.0, 104.0, 102.0, 103.5, 1000.0)             # +3.0% exactly
    b[4] = (days[4], 103.5, 104.0, 103.0, 103.5, 1000.0)
    b[6] = (days[6], 106.6, 107.0, 106.0, 106.5, 1000.0)             # +2.995% from 103.5: not a gap
    b[7] = (days[7], 101.0, 101.5, 100.0, 100.5, 1000.0)             # -5.2% from 106.5: a gap down
    for i in (5,):
        b[i] = (days[i], 103.5, 104.0, 103.0, 103.5, 1000.0)
    for i in range(8, 12):
        b[i] = (days[i], 100.5, 101.0, 100.0, 100.5, 1000.0)
    got = C.gaps(b, never, [])
    assert got["total"] == 2 and [r["date"] for r in got["rows"]] == [days[7], days[3]]
    down, up = got["rows"]
    assert up["up"] is True and up["gap_pct"] == 3.0 and up["prior_close"] == 100.0 and up["open"] == 103.0
    assert up["close_vs_open_pct"] == round((103.5 / 103 - 1) * 100, 2)
    assert down["up"] is False and down["gap_pct"] == round((101 / 106.5 - 1) * 100, 2)


def test_a_3_percent_gap_that_is_a_hair_under_in_floating_point_still_counts():
    days = vfp_weekdays("2031-01-06", 4)
    b = [(d, 15.0, 15.2, 14.9, 15.0, 1000.0) for d in days]
    b[2] = (days[2], 14.55, 14.7, 14.5, 14.6, 1000.0)                # exactly -3% (14.55 / 15), 0.0299999... in floats
    assert abs(14.55 / 15.0 - 1) < C.GAP_MIN                         # the control: the float is under the line
    got = C.gaps(b, never, [])
    assert got["total"] == 1 and got["rows"][0]["gap_pct"] == -3.0 and got["rows"][0]["up"] is False


def test_a_gap_fills_the_same_session_later_or_never_and_sessions_count_after_the_gap_session():
    days = vfp_weekdays("2031-01-06", 10)
    b = flat_bars(days)
    b[2] = (days[2], 105.0, 106.0, 99.5, 104.0, 1000.0)              # up gap whose own low trades back to 100: same session
    for i in range(3, 10):
        b[i] = (days[i], 104.0, 105.0, 103.0, 104.0, 1000.0)
    b[5] = (days[5], 99.0, 99.5, 98.0, 99.0, 1000.0)                 # down gap from 104 (-4.8%)
    b[6] = (days[6], 99.0, 101.0, 98.5, 100.0, 1000.0)
    b[7] = (days[7], 100.0, 104.0, 99.0, 103.0, 1000.0)              # high 104: fills the down gap, 2 sessions after
    got = C.gaps(b, never, [])
    by = {r["date"]: r for r in got["rows"]}
    assert by[days[2]]["filled"] == days[2] and by[days[2]]["sessions_to_fill"] == 0
    assert by[days[5]]["filled"] == days[7] and by[days[5]]["sessions_to_fill"] == 2
    b2 = flat_bars(days)
    for i in range(4, 10):
        b2[i] = (days[i], 110.0, 111.0, 108.0, 110.0, 1000.0)        # gap up at 4, never back to 100
    open_gap = C.gaps(b2, never, [])["rows"][0]
    assert open_gap["filled"] is None and open_gap["sessions_to_fill"] is None and open_gap["sessions_since"] == 5


def test_the_fill_shares_count_only_gaps_old_enough_to_say_and_split_up_and_down():
    days = vfp_weekdays("2031-01-06", 40)
    b = flat_bars(days)
    # gap up at 5, filled at 8 (3 sessions); gap down at 15, filled at 30 (15 sessions); gap up at 37, open
    for i in range(5, 8):
        b[i] = (days[i], 104.0, 105.0, 103.0, 104.0, 1000.0)
    b[8] = (days[8], 104.0, 104.5, 99.9, 100.0, 1000.0)
    for i in range(9, 15):
        b[i] = (days[i], 100.0, 101.0, 99.5, 100.0, 1000.0)
    for i in range(15, 30):
        b[i] = (days[i], 95.0, 96.0, 94.0, 95.0, 1000.0)
    b[30] = (days[30], 95.0, 100.0, 94.0, 99.0, 1000.0)
    for i in range(31, 37):
        b[i] = (days[i], 99.0, 99.5, 98.5, 99.0, 1000.0)
    for i in range(37, 40):
        b[i] = (days[i], 104.0, 105.0, 103.5, 104.0, 1000.0)
    s = C.gaps(b, never, [])["summary"]
    assert (s["all"]["count"], s["up"]["count"], s["down"]["count"], s["all"]["open"]) == (3, 2, 1, 1)
    # within 5: the gap at 37 has 2 sessions after it and is open: not judged
    assert s["all"]["within_5"] == {"filled": 1, "judged": 2, "pct": 50.0}
    assert s["all"]["within_20"] == {"filled": 2, "judged": 2, "pct": 100.0}
    assert s["up"]["within_5"] == {"filled": 1, "judged": 1, "pct": 100.0}
    assert s["down"]["within_5"] == {"filled": 0, "judged": 1, "pct": 0.0}


def test_the_list_is_cut_to_the_newest_and_a_gap_over_40_percent_is_marked(monkeypatch):
    monkeypatch.setattr(C, "GAPS_SHOWN", 2)
    days = vfp_weekdays("2031-01-06", 12)
    b, px = [], 100.0
    for i, d in enumerate(days):
        o = px * (1.05 if i % 2 else 1.0)
        b.append((d, o, o * 1.01, o * 0.99, o, 1000.0))
        px = o
    got = C.gaps(b, never, [])
    assert got["total"] == 6 and got["shown"] == 2 and [r["date"] for r in got["rows"]] == [days[11], days[9]]
    assert all(r["check"] is False for r in got["rows"])
    b[11] = (days[11], b[10][4] * 1.45, b[10][4] * 1.5, b[10][4] * 1.4, b[10][4] * 1.45, 1000.0)
    assert C.gaps(b, never, [])["rows"][0]["check"] is True
    assert C.gaps(b[:1], never, [])["state"] == "short"


def test_the_block_fill_search_equals_a_plain_scan_across_block_edges():
    rng = random.Random(7)
    n = 1000                                                         # not a multiple of the block: the last block is partial
    lows = [rng.uniform(50, 150) for _ in range(n)]
    highs = [x + rng.uniform(0, 5) for x in lows]
    mins, maxes = C._blocks(lows, min), C._blocks(highs, max)
    starts = [rng.randrange(n) for _ in range(400)] + list(range(n - 45, n))   # every start in the last block too
    for start in starts:
        for target in (rng.uniform(40, 160), lows[start] - 1, highs[start] + 1):
            plain_lo = next((j for j in range(start, n) if lows[j] <= target), None)
            plain_hi = next((j for j in range(start, n) if highs[j] >= target), None)
            assert C.first_at_or_below(lows, mins, start, target) == plain_lo, (start, target)
            assert C.first_at_or_above(highs, maxes, start, target) == plain_hi, (start, target)


# ── earnings ───────────────────────────────────────────────────────────────────────────────────

def _quarter(fy, fq, report_date, reported=True):
    return {"fiscal_year": fy, "fiscal_quarter": fq, "report_date": report_date, "reported": reported}


def _page(quarters, nxt=None, built="2031-05-20T16:00:00-04:00"):
    ts = datetime.fromisoformat(built).timestamp() if built else None
    return {"quarters": quarters, "summary": {"next_report_date": nxt}, "next_report_date": nxt,
            "meta": {"retrieved_at": ts} if ts else {}}


def test_the_span_runs_over_consecutive_quarters_with_dates_and_stops_at_a_gap_in_either():
    page = _page([_quarter(2031, 2, "2031-04-24"), _quarter(2031, 1, "2031-01-29"), _quarter(2030, 4, "2030-10-23"),
                  _quarter(2030, 2, "2030-04-25")], nxt="2031-07-23")
    got = C.earnings_index(page)
    assert got["dates"] == ["2030-04-25", "2030-10-23", "2031-01-29", "2031-04-24"]
    # 2030 Q3 is missing: the span starts at 2030 Q4; it runs to the day before the page was built
    assert got["cover"] == {"from": "2030-10-23", "through": "2031-05-19", "quarters": 3}
    undated = _page([_quarter(2031, 2, "2031-04-24"), _quarter(2031, 1, None), _quarter(2030, 4, "2030-10-23")], nxt="2031-07-23")
    assert C.earnings_index(undated)["cover"]["from"] == "2031-04-24"
    soon = _page([_quarter(2031, 2, "2031-04-24")], nxt="2031-05-10", built="2031-05-20T16:00:00-04:00")
    assert C.earnings_index(soon)["cover"]["through"] == "2031-05-09"       # the day before the scheduled report
    no_next = _page([_quarter(2031, 2, "2031-04-24")])
    assert C.earnings_index(no_next)["cover"]["through"] == "2031-04-24"
    assert C.earnings_index(_page([_quarter(2031, 2, None)])) is None
    assert C.earnings_index(None) is None
    odd = _page([{"fiscal_year": "2031", "fiscal_quarter": 2, "report_date": "2031-04-24", "reported": True}])
    assert C.earnings_index(odd)["cover"] is None and C.earnings_index(odd)["dates"] == ["2031-04-24"]


def test_the_mark_is_the_report_day_and_the_session_after_and_false_only_inside_the_span():
    days = vfp_weekdays("2031-04-14", 15)                            # Apr 14 2031 is a Monday
    bars = flat_bars(days)
    index = {"dates": ["2031-04-17", "2031-04-26"], "cover": {"from": "2031-04-15", "through": "2031-04-29"}}
    flag = C.earnings_flagger(bars, index)
    at = {d: flag(i) for i, d in enumerate(days)}
    assert at["2031-04-17"] is True and at["2031-04-18"] is True     # the report day and the session after
    assert at["2031-04-16"] is False                                 # inside the span, nothing beside it
    assert at["2031-04-28"] is True and at["2031-04-25"] is False    # a Saturday report marks the Monday only
    assert at["2031-04-14"] is None                                  # its window starts before the span
    assert at["2031-04-30"] is None and at["2031-05-02"] is None     # after the span: not known
    assert C.earnings_flagger(bars, None)(3) is None


# ── the reads and the held answers ─────────────────────────────────────────────────────────────

def _vfp_world(monkeypatch, *, key="2031-06-02", earnings=None, reads=None, earn_reads=None):
    days = vfp_weekdays_ending("2031-06-03", 300)
    rng = random.Random(3)
    bars, px = [], 50.0
    for d in days:
        o = px * (1 + rng.uniform(-0.04, 0.04))
        c = o * (1 + rng.uniform(-0.02, 0.02))
        bars.append((d, round(o, 4), round(max(o, c) * 1.01, 4), round(min(o, c) * 0.99, 4), round(c, 4), float(rng.randint(5, 50) * 1000)))
        px = c
    reads = reads if reads is not None else []
    earn_reads = earn_reads if earn_reads is not None else []
    state = {"earnings": earnings}

    def read_bars(sym):
        reads.append(sym)
        return {"status": "ok", "symbol": sym, "bars": list(bars)}

    def read_earnings(sym):
        earn_reads.append(sym)
        return state["earnings"]

    monkeypatch.setattr(V, "_read_bars", read_bars)
    monkeypatch.setattr(V, "_read_earnings", read_earnings)
    monkeypatch.setattr(V, "session_key", lambda now: key)
    monkeypatch.setattr(V, "now_et", lambda: datetime(2031, 6, 3, 12, 0))
    return {"reads": reads, "earn_reads": earn_reads, "days": days, "state": state}


def test_only_bars_up_to_the_session_are_read_so_todays_unfinished_bar_never_counts(monkeypatch):
    w = _vfp_world(monkeypatch)
    ans = V.get_volume_footprint("ZZQA")
    assert w["days"][-1] == "2031-06-03"                             # the store held a bar for the next day
    assert ans["status"] == "ok" and ans["data_through"] == "2031-06-02" and ans["session"] == "2031-06-02"
    for sec in ("accumulation", "big_days", "pivots", "gaps"):
        assert ans[sec]["as_of"] == "2031-06-02", sec
    assert ans["earnings"] == {"state": "not_held", "source": V.EARNINGS_SOURCE}
    assert all(r["earnings"] is None for r in ans["big_days"]["rows"])
    assert "split-adjusted" in ans["basis"]


def test_the_answer_is_held_per_symbol_per_session_and_a_new_session_reads_again(monkeypatch):
    w = _vfp_world(monkeypatch)
    a1 = V.get_volume_footprint("ZZQA")
    assert V.get_volume_footprint("ZZQA") is a1 and w["reads"] == ["ZZQA"]
    V.get_volume_footprint("ZZQB")
    assert w["reads"] == ["ZZQA", "ZZQB"]
    monkeypatch.setattr(V, "session_key", lambda now: "2031-06-03")
    assert V.get_volume_footprint("ZZQA")["data_through"] == "2031-06-03"
    assert w["reads"] == ["ZZQA", "ZZQB", "ZZQA"]


def test_the_earnings_dates_are_looked_at_again_and_only_a_change_works_the_stock_out_again(monkeypatch):
    w = _vfp_world(monkeypatch)
    a1 = V.get_volume_footprint("ZZQA")
    assert a1["earnings"]["state"] == "not_held" and w["earn_reads"] == ["ZZQA"]
    V.get_volume_footprint("ZZQA")
    assert w["earn_reads"] == ["ZZQA"]                               # not due yet: not even looked at
    V._cache["ZZQA"]["earn_check_at"] = time.time() - 1
    assert V.get_volume_footprint("ZZQA") is a1                      # looked at, unchanged: the same answer
    assert w["earn_reads"] == ["ZZQA", "ZZQA"] and w["reads"] == ["ZZQA"]
    days = w["days"]
    w["state"]["earnings"] = _page([_quarter(2031, 1, days[-30]), _quarter(2030, 4, days[-90])], nxt="2031-07-29",
                                   built="2031-06-01T10:00:00-04:00")
    V._cache["ZZQA"]["earn_check_at"] = time.time() - 1
    a3 = V.get_volume_footprint("ZZQA")
    assert w["reads"] == ["ZZQA", "ZZQA"] and a3["earnings"]["state"] == "ok"
    assert a3["earnings"]["cover"] == {"from": days[-90], "through": "2031-05-31", "quarters": 2}
    assert a3["earnings"]["reports"] == 2 and a3["earnings"]["next_report"] == "2031-07-29"


def test_a_stock_whose_bars_stop_short_is_read_again_only_after_the_recheck(monkeypatch):
    w = _vfp_world(monkeypatch, key="2031-06-10")
    assert V.get_volume_footprint("ZZQA")["data_through"] == "2031-06-03"
    V.get_volume_footprint("ZZQA")
    assert w["reads"] == ["ZZQA"]
    entry = V._cache["ZZQA"]
    assert abs(entry["recheck_at"] - (entry["at"] + V.LAG_RECHECK_S)) < 1e-6
    entry["recheck_at"] = time.time() - 1
    V.get_volume_footprint("ZZQA")
    assert w["reads"] == ["ZZQA", "ZZQA"]


def test_a_failed_read_is_never_held_and_nothing_stored_is_not_held_in_words(monkeypatch):
    calls = []
    monkeypatch.setattr(V, "_read_bars", lambda s: calls.append(s) or {"status": "unavailable", "reason": "read_failed"})
    monkeypatch.setattr(V, "_read_earnings", lambda s: None)
    assert V.get_volume_footprint("ZZQA")["status"] == "unavailable"
    assert V.get_volume_footprint("ZZQA")["status"] == "unavailable"
    assert calls == ["ZZQA", "ZZQA"]
    monkeypatch.setattr(V, "_read_bars", lambda s: {"status": "unavailable", "reason": "no_price_history"})
    assert V.get_volume_footprint("ZZQB") == {"status": "not_held", "symbol": "ZZQB", "detail": "UCT holds no daily prices for ZZQB."}
    monkeypatch.setattr(V, "_read_bars", lambda s: (_ for _ in ()).throw(RuntimeError("boom")))
    got = V.get_volume_footprint("ZZQC")
    assert got["status"] == "unavailable" and got["reason"] == "failed" and "ZZQC" not in V._cache


def test_the_held_answers_are_capped_least_recently_asked_first(monkeypatch):
    w = _vfp_world(monkeypatch)
    monkeypatch.setattr(V, "CACHE_MAX", 2)
    for s in ("ZZQA", "ZZQB", "ZZQA", "ZZQC", "ZZQA", "ZZQB"):
        V.get_volume_footprint(s)
    assert w["reads"] == ["ZZQA", "ZZQB", "ZZQC", "ZZQB"]


def test_one_build_per_symbol_at_a_time_and_a_bounded_number_of_symbols(monkeypatch):
    w = _vfp_world(monkeypatch)
    gate, started = threading.Event(), threading.Event()
    slow_reads = []
    real = V._read_bars

    def slow(sym):
        slow_reads.append(sym)
        started.set()
        gate.wait(5)
        return real(sym)

    monkeypatch.setattr(V, "_read_bars", slow)
    out = []
    t1 = threading.Thread(target=lambda: out.append(V.get_volume_footprint("ZZQA")))
    t1.start()
    started.wait(5)
    t2 = threading.Thread(target=lambda: out.append(V.get_volume_footprint("ZZQA")))
    t2.start()
    time.sleep(0.2)
    gate.set()
    t1.join(5)
    t2.join(5)
    assert slow_reads == ["ZZQA"] and len(out) == 2 and out[0] is out[1]
    monkeypatch.setattr(V, "BUILD_WAIT_S", 0.05)
    for _ in range(V.BUILD_SLOTS):
        V._slots.acquire()
    try:
        assert V.get_volume_footprint("ZZQZ")["status"] == "busy"
    finally:
        for _ in range(V.BUILD_SLOTS):
            V._slots.release()
    assert "ZZQZ" not in w["reads"]


def test_the_earnings_read_is_the_held_one_and_never_builds_or_refreshes(monkeypatch):
    from api.services import earnings_intel as ei
    monkeypatch.setattr(ei, "get_earnings", lambda *a, **k: pytest.fail("the building earnings read"))
    monkeypatch.setattr(ei, "_build", lambda *a, **k: pytest.fail("an earnings build"))
    monkeypatch.setattr(ei, "_schedule_refresh", lambda *a, **k: pytest.fail("an earnings refresh"))
    seen = []
    monkeypatch.setattr(ei, "get_earnings_held", lambda s: seen.append(s) or None)
    assert V._read_earnings("ZZQA") is None and seen == ["ZZQA"]
    index, block, stamp = V.earnings("ZZQA")
    assert index is None and block["state"] == "not_held" and stamp == ("not_held",)
    monkeypatch.setattr(ei, "get_earnings_held", lambda s: (_ for _ in ()).throw(RuntimeError("x")))
    assert V.earnings("ZZQA")[1]["state"] == "not_held"
    monkeypatch.setattr(ei, "get_earnings_held", lambda s: {"quarters": [_quarter(2031, 1, None)]})
    assert V.earnings("ZZQA")[1]["state"] == "no_dates"


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _vfp_client(user):
    app = FastAPI()
    app.include_router(vfp_route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_vfp_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(V, "get_volume_footprint", lambda sym: asked.append(sym) or {"status": "ok", "symbol": sym})
    (r,) = vfp_route.router.routes
    assert r.path == "/api/research/volume-footprint/{ticker}" and r.methods == {"GET"}
    assert vfp_route.require_paid in {d.call for d in r.dependant.dependencies}
    assert vfp_route.require_paid.__module__ == "api.routers.volume_footprint"
    assert _vfp_client(None).get("/api/research/volume-footprint/NVDA").status_code == 401
    refused = _vfp_client(FREE).get("/api/research/volume-footprint/NVDA")
    assert refused.status_code == 402 and refused.json() == {"detail": "The volume footprint requires a paid plan"}
    assert asked == []
    assert _vfp_client(PAID).get("/api/research/volume-footprint/nvda").json() == {"status": "ok", "symbol": "NVDA"}
    assert _vfp_client(PAID).get("/api/research/volume-footprint/$$$").status_code == 400
    assert asked == ["NVDA"]


def test_the_vfp_handler_is_a_plain_def_and_the_route_is_mounted():
    import inspect
    assert not inspect.iscoroutinefunction(vfp_route.get_volume_footprint)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import volume_footprint as volume_footprint_router" in main
    assert "app.include_router(volume_footprint_router.router)" in main
