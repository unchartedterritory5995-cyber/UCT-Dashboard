"""The regular session's own values -- the Python lane.

``regularhours`` / ``regularfirst`` (the clock's two leaves) and the five readers built on them:
``sessionOpen()``, ``sessionHigh()``, ``sessionLow()``, ``openingRangeHigh(minutes)``,
``openingRangeLow(minutes)``. The JS twin is
``app/src/components/chart/engine/ast/sessionRegular.test.js``.

Every expectation is computed INDEPENDENTLY from the committed bars (a New York wall clock from
``zoneinfo``, the half-day named by its date), never read back from the code under test, and it is
the SAME independent calculation the JS file makes over the SAME fixtures: two lanes held to one
truth, so they cannot agree with each other on a wrong answer.

  1. the two leaves on bars that hold extended hours, an early close and a cut window;
  2. the readers against that calculation, bar by bar, directly and through the interpreter;
  3. what a bar outside regular hours reads (the last regular session's value);
  4. a window cut anywhere never changes a number it answers;
  5. the opening range refuses by name on bars it cannot be read from;
  6. a date-keyed daily chart answers the bar's own values; a key that is not an instant is blank.
"""
from __future__ import annotations

import json
import math
import pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import ast_interpret, ast_table
from api.services import indicator_compute as ic

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPLAY = json.loads((ROOT / "tests" / "fixtures" / "alerts" / "replay_bars.json").read_text(encoding="utf-8"))
NVDA = REPLAY["fixtures"]["nvda_5m_extended"]["bars"]      # 5-minute, extended hours, first session cut at 07:15
HALF = REPLAY["fixtures"]["halfday_30m"]["bars"]           # 30-minute, extended hours, 2025-11-28 closes at 13:00
HOURLY = REPLAY["fixtures"]["hourly_open_60m"]["bars"]     # 60-minute, its first bar opens mid-session

NY = ZoneInfo("America/New_York")
EARLY_CLOSES = {"2025-11-28": 13 * 60}                     # the one half-day these fixtures hold
READERS = ("sessionOpen", "sessionHigh", "sessionLow", "openingRangeHigh", "openingRangeLow")


def wall(t):
    dt = datetime.fromtimestamp(t, NY)
    return dt.strftime("%Y-%m-%d"), dt.hour * 60 + dt.minute, dt.isoweekday()


def regular(t) -> bool:
    day, minute, weekday = wall(t)
    return weekday <= 5 and 570 <= minute < EARLY_CLOSES.get(day, 16 * 60)


def expected(bars, kind, minutes=None):
    """The independent reading of one reader over ``bars``: None where it is unknown."""
    field = {"open": "o", "high": "h", "low": "l"}[kind]
    out, value, known, open_t, day = [], None, False, 0, None
    for i, b in enumerate(bars):
        d, minute, _ = wall(b["t"])
        in_reg = regular(b["t"])
        first_of_day = in_reg and day != d
        if first_of_day and minute != 570 and i == 0:
            known, day = False, d                          # a cut window
        elif first_of_day:
            known, day, open_t, value = True, d, b["t"], b[field]
        elif known and in_reg and (minutes is None or b["t"] < open_t + minutes * 60):
            if kind == "high":
                value = max(value, b[field])
            elif kind == "low":
                value = min(value, b[field])
        out.append(value if known else None)
    return out


call = lambda name, *args: {"type": "call", "name": name, "args": list(args)}   # noqa: E731
num = lambda v: {"type": "num", "value": v}                                      # noqa: E731


def run(tree, bars, tf, sink=None):
    opts = {"tf": tf}
    if sink is not None:
        opts["chartClockSink"] = sink
    col = ast_interpret.interpret(tree, bars, None, None, None, opts)
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in col]


# ── the clock ────────────────────────────────────────────────────────────────

def test_the_two_leaves_are_declared_and_are_session_clock_leaves():
    clock = ast_table.TABLE[ast_table.CLOCK_SECTION]
    assert clock["regularhours"]["lookback"] == 0 and clock["regularhours"]["yields"] == "bool"
    assert clock["regularfirst"]["lookback"] == 1 and clock["regularfirst"]["yields"] == "bool"
    assert {"regularhours", "regularfirst"} <= set(ast_interpret.SESSION_CLOCK_LEAVES)
    assert {"regularhours", "regularfirst"} <= set(ic.CLOCK_TIME_DERIVED)


@pytest.mark.parametrize("bars,tf", [(NVDA, "5"), (HALF, "30"), (HOURLY, "60")], ids=["5m", "30m-halfday", "60m"])
def test_regularhours_is_the_calendars_regular_session_on_every_bar(bars, tf):
    got = ic.compute_clock(bars, tf)["regularhours"]
    assert got == [1.0 if regular(b["t"]) else 0.0 for b in bars]


def test_the_half_day_by_name():
    at = lambda hhmm: next(i for i, b in enumerate(HALF) if wall(b["t"])[:2] == ("2025-11-28", hhmm))   # noqa: E731
    col = ic.compute_clock(HALF, "30")["regularhours"]
    assert [col[at(750)], col[at(780)], col[at(960)]] == [1.0, 0.0, 0.0]      # 12:30 in; 13:00 and 16:00 out


@pytest.mark.parametrize("bars,tf", [(NVDA, "5"), (HALF, "30")], ids=["5m", "30m-halfday"])
def test_regularfirst_is_1_on_the_first_regular_bar_of_each_day_and_nowhere_else(bars, tf):
    got = ic.compute_clock(bars, tf)["regularfirst"]
    seen, want = set(), []
    for b in bars:
        day = wall(b["t"])[0]
        if not regular(b["t"]) or day in seen:
            want.append(0.0)
        else:
            seen.add(day)
            want.append(1.0)
    assert got == want
    assert sum(1 for v in got if v == 1.0) == len(seen)


def test_regularfirst_is_BLANK_on_an_oldest_bar_that_opens_mid_session():
    assert wall(HOURLY[0]["t"])[1] > 570 and regular(HOURLY[0]["t"])           # the fixture's own first bar
    col = ic.compute_clock(HOURLY, "60")["regularfirst"]
    assert col[0] is None
    same_day = [i for i in range(1, len(HOURLY))
                if wall(HOURLY[i]["t"])[0] == wall(HOURLY[0]["t"])[0] and regular(HOURLY[i]["t"])]
    assert same_day and all(col[i] == 0.0 for i in same_day)
    at930 = next(i for i, b in enumerate(NVDA) if wall(b["t"])[1] == 570)
    assert ic.compute_clock(NVDA[at930:], "5")["regularfirst"][0] == 1.0       # cut AT the open: known


def test_a_date_keyed_daily_chart_every_bar_is_a_regular_session_of_its_own():
    daily = [{"t": "2025-11-26", "o": 1, "h": 3, "l": 0.5, "c": 2, "v": 10},
             {"t": "2025-11-28", "o": 2, "h": 4, "l": 1, "c": 3, "v": 10}]
    clock = ic.compute_clock(daily, "D")
    assert clock["regularhours"] == [1.0, 1.0] and clock["regularfirst"] == [1.0, 1.0]


# ── the readers ──────────────────────────────────────────────────────────────

def test_the_five_are_bar_readers_bound_in_this_lane_session_anchored_and_live():
    fns = ast_table.TABLE["functions"]
    for name in READERS:
        assert name in ast_table.bar_readers() and name in ast_interpret._BAR_FN
        assert fns[name]["reads"] == "bars" and fns[name]["lookback"] == "session"
        assert fns[name]["cadence"] == "live" and fns[name]["yields"] == "num"
    assert ast_interpret.OPENING_RANGE_CALLS == ("openingRangeHigh", "openingRangeLow")
    assert set(ast_interpret._BAR_FN_TF) == set(READERS)


@pytest.mark.parametrize("bars,tf,m", [(NVDA, "5", 30), (HALF, "30", 60)], ids=["5m", "30m-halfday"])
def test_the_readers_equal_an_independent_calculation_on_every_bar(bars, tf, m):
    for kind in ("open", "high", "low"):
        assert ic.compute_session_regular_raw(bars, tf, kind) == expected(bars, kind), kind
    assert ic.compute_session_regular_raw(bars, tf, "high", m) == expected(bars, "high", m)
    assert ic.compute_session_regular_raw(bars, tf, "low", m) == expected(bars, "low", m)


def test_through_the_interpreter_by_name_the_same_columns():
    assert run(call("sessionHigh"), NVDA, "5") == expected(NVDA, "high")
    assert run(call("sessionOpen"), NVDA, "5") == expected(NVDA, "open")
    assert run(call("openingRangeLow", num(30)), NVDA, "5") == expected(NVDA, "low", 30)
    above = run({"type": "op", "name": ">", "args": [{"type": "series", "name": "close"},
                                                    call("openingRangeHigh", num(30))]}, NVDA, "5")
    want = expected(NVDA, "high", 30)
    hits = sum(1 for b, w in zip(NVDA, want) if w is not None and b["c"] > w)
    assert hits > 0 and sum(1 for v in above if v == 1.0) == hits


def test_a_bar_outside_regular_hours_reads_the_last_regular_sessions_value():
    hi = ic.compute_session_regular_raw(NVDA, "5", "high")
    assert wall(NVDA[0]["t"])[1] < 570 and hi[0] is None                       # nothing before the first open
    days = sorted({wall(b["t"])[0] for b in NVDA})
    last_of = lambda d: max(i for i, b in enumerate(NVDA) if wall(b["t"])[0] == d)       # noqa: E731
    first_of = lambda d: min(i for i, b in enumerate(NVDA) if wall(b["t"])[0] == d)      # noqa: E731
    own_high = lambda d: max(b["h"] for b in NVDA if wall(b["t"])[0] == d and regular(b["t"]))   # noqa: E731
    assert hi[last_of(days[0])] == own_high(days[0])                           # after-hours: today's
    assert wall(NVDA[first_of(days[1])]["t"])[1] < 570
    assert hi[first_of(days[1])] == own_high(days[0])                          # next pre-market: still yesterday's
    half_hi = ic.compute_session_regular_raw(HALF, "30", "high")
    day_bars = [i for i, b in enumerate(HALF) if wall(b["t"])[0] == "2025-11-28"]
    assert half_hi[day_bars[-1]] == max(HALF[i]["h"] for i in day_bars if regular(HALF[i]["t"]))


def test_a_window_cut_anywhere_never_changes_a_number():
    full = ic.compute_session_regular_raw(NVDA, "5", "high", 30)
    for cut in (1, 37, 120, 153, 200, 421):
        part = ic.compute_session_regular_raw(NVDA[cut:], "5", "high", 30)
        answered = [(i, v) for i, v in enumerate(part) if v is not None]
        assert answered, cut
        assert all(v == full[cut + i] for i, v in answered), cut
    mid = next(i for i, b in enumerate(NVDA) if wall(b["t"])[1] == 600)        # a 10:00 bar
    part = ic.compute_session_regular_raw(NVDA[mid:], "5", "high")
    next_open = next(i for i in range(1, len(NVDA) - mid) if wall(NVDA[mid + i]["t"])[1] == 570)
    assert all(v is None for v in part[:next_open])                            # never the partial session's high
    assert part[next_open] == NVDA[mid + next_open]["h"]


def test_a_price_that_is_not_a_number_makes_the_rest_of_that_session_unknown():
    start = next(i for i, b in enumerate(NVDA) if wall(b["t"])[1] == 570)
    bars = [dict(b, h=float("nan")) if i == start + 3 else b for i, b in enumerate(NVDA)]
    hi = ic.compute_session_regular_raw(bars, "5", "high")
    assert hi[start + 2] is not None
    next_open = next(i for i in range(start + 1, len(bars)) if wall(bars[i]["t"])[1] == 570)
    assert all(v is None for v in hi[start + 3:next_open])
    assert hi[next_open] == bars[next_open]["h"]                               # the next session starts clean


# ── an opening range on bars it cannot be read from ──────────────────────────

def test_the_rule_bars_longer_than_the_range_or_that_do_not_divide_it():
    r = ic.opening_range_refusal
    assert r(300, 30) is None and r(1800, 30) is None and r(900, 45) is None
    assert r(3600, 30) == ic.OPENING_RANGE_BARS_LONGER == "opening-range:bars-longer"
    assert r(86400, 30) == ic.OPENING_RANGE_BARS_LONGER
    assert r(1800, 45) == ic.OPENING_RANGE_BARS_DO_NOT_DIVIDE == "opening-range:bars-do-not-divide"
    assert r(None, 30) == ic.OPENING_RANGE_BARS_LONGER and r(float("nan"), 30) == ic.OPENING_RANGE_BARS_LONGER


def test_the_reader_itself_answers_nothing_there():
    assert all(v is None for v in ic.compute_session_regular_raw(HOURLY, "60", "high", 30))
    assert all(v is None for v in ic.compute_session_regular_raw(HALF, "30", "low", 45))
    assert all(v is None for v in ic.compute_session_regular_raw(NVDA, None, "high", 30))     # no timeframe stated
    assert any(v is not None for v in ic.compute_session_regular_raw(NVDA, None, "high"))     # the session needs none


@pytest.mark.parametrize("bars,tf,minutes,code", [
    (HOURLY, "60", 30, "opening-range:bars-longer"), (HALF, "30", 45, "opening-range:bars-do-not-divide")])
def test_it_is_withheld_whole_and_named_with_the_code_the_browser_owns_the_sentence_for(bars, tf, minutes, code):
    sink: dict = {}
    assert all(v is None for v in run(call("openingRangeHigh", num(minutes)), bars, tf, sink))
    assert list(sink) == [code] and code in ast_interpret.CHART_CLOCK_WHOLE


def test_the_same_call_on_bars_that_divide_the_range_says_nothing_and_answers():
    sink: dict = {}
    assert run(call("openingRangeHigh", num(60)), HALF, "30", sink) == expected(HALF, "high", 60)
    assert sink == {}


def test_a_daily_chart_the_range_is_withheld_and_the_sessions_own_values_are_the_bars():
    daily = [{"t": "2025-11-25", "o": 10, "h": 13, "l": 9, "c": 12, "v": 100},
             {"t": "2025-11-26", "o": 12, "h": 15, "l": 11, "c": 14, "v": 100},
             {"t": "2025-11-28", "o": 14, "h": 16, "l": 13, "c": 15, "v": 100}]
    sink: dict = {}
    assert run(call("openingRangeHigh", num(30)), daily, "D", sink) == [None, None, None]
    assert list(sink) == ["opening-range:bars-longer"]
    assert run(call("sessionHigh"), daily, "D") == [13.0, 15.0, 16.0]
    assert run(call("sessionLow"), daily, "D") == [9.0, 11.0, 13.0]
    assert run(call("sessionOpen"), daily, "D") == [10.0, 12.0, 14.0]


@pytest.mark.parametrize("tf", ["D", "5", None])
def test_a_key_that_is_not_an_instant_is_blank_whatever_the_timeframe_says(tf):
    swept = [{"t": 20251125, "o": 10, "h": 13, "l": 9, "c": 12, "v": 100},
             {"t": 20251126, "o": 12, "h": 15, "l": 11, "c": 14, "v": 100}]
    assert ic.compute_session_regular_raw(swept, tf, "high") == [None, None]
    assert ic.compute_session_regular_raw(swept, tf, "high", 30) == [None, None]
