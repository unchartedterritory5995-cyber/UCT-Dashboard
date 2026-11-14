"""Rails for the RS screens' last-bar measures (unit U2a, part 1):
`rs_columns.screen_fields(bars, spy_bars)` and the helpers it reads in
`relative_strength`.

Every expected value below is derived BY HAND from the scripted closes, in the
comment beside it. Nothing here is the function's own output written back.

The scripted series (all on weekday sessions, SPY 100 unless scripted):

  LINE  the stock closes at 200 - 0.01 x index: strictly falling, so its RS line
        (close / 100) never equals or beats an earlier bar, and its price always
        sits within 2% of its own 252-session high (a fall of 2.52 in a year).
        An RS new high exists only where a test scripts a spike.
  FLAT  the stock closes at 100 on every bar except index 200, where it closes
        at 120: the price high. From index 252 to 452 that 120 is inside every
        bar's prior 252 sessions, so 100 is below 0.98 x 120 = 117.6 and price is
        NOT at its high. The RS line is 1.0 against a prior high of 1.2 until a
        test drops SPY.
"""
from __future__ import annotations

import ast as pyast
import datetime as dt
import pathlib

import pytest

from api.services import relative_strength as rs
from api.services.screener import rs_columns

ROOT = pathlib.Path(__file__).resolve().parents[1]

KEYS = ("rs_nh_count_20", "rs_nh_quiet", "rs_nh_red_bars_ago",
        "px_below_high_pct", "rs_nhbp_age", "rs_nh_span")
INT_KEYS = tuple(k for k in KEYS if k != "px_below_high_pct")


# ───────────────────────────── the fixtures ─────────────────────────────────

def _weekdays(n, start=dt.date(2023, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.year * 10000 + d.month * 100 + d.day)
        d += dt.timedelta(days=1)
    return out


TIMES = _weekdays(700)


def _bars(closes):
    return [{"t": t, "o": float(c), "h": float(c), "l": float(c), "c": float(c), "v": 1000}
            for t, c in zip(TIMES, closes)]


def _line(n, spikes=None):
    closes = [200.0 - 0.01 * i for i in range(n)]
    for i, v in (spikes or {}).items():
        closes[i] = v
    return closes


def _flat(n, edits=None):
    closes = [100.0] * n
    closes[200] = 120.0
    for i, v in (edits or {}).items():
        closes[i] = v
    return closes


def _spy(n, edits=None):
    closes = [100.0] * n
    for i, v in (edits or {}).items():
        closes[i] = v
    return closes


def _fields(stock, spy):
    return rs_columns.screen_fields(_bars(stock), _bars(spy))


# Three RS highs on LINE (330 bars, last index 329):
#   309  close 210, SPY 100 -> RS 2.10    (above every earlier ~2.0)
#   310  close 211, SPY  99 -> RS 2.1313  (SPY 100 -> 99 is -1.0%: a market down day)
#   322  close 214, SPY 100 -> RS 2.14
# SPY is back at 100 on 311 (+1.01%, not a down day). No other bar reaches 2.10.
SPIKED = _line(330, {309: 210.0, 310: 211.0, 322: 214.0})
SPIKED_SPY = _spy(330, {310: 99.0})

# FLAT with SPY falling at the end (330 bars). The RS line must beat 1.2:
#   320  SPY 80   -> RS 1.25     new high; SPY -20%: down day
#   321  SPY 81   -> RS 1.2346   not a high
#   322  SPY 79   -> RS 1.2658   new high; SPY -2.47%: down day
#   323-326 SPY 80 -> RS 1.25    not a high
#   327  SPY 80, close 102 -> RS 1.275  new high; SPY unchanged: NOT a down day
#   328-329 SPY 80, close 100 -> RS 1.25  not a high
# Price never reaches 117.6, so it is below its high on every bar from 252 on.
AHEAD = _flat(330, {327: 102.0})
AHEAD_SPY = _spy(330, {320: 80.0, 321: 81.0, 322: 79.0, **{i: 80.0 for i in range(323, 330)}})


# ─────────────────── every row of the table, hand-derived ───────────────────

def test_the_function_returns_exactly_the_six_keys_and_exports_them():
    assert rs_columns.SCREEN_COLUMNS == KEYS
    got = _fields(SPIKED, SPIKED_SPY)
    assert tuple(got) == KEYS


def test_count_quiet_and_red_age_on_three_scripted_highs():
    got = _fields(SPIKED, SPIKED_SPY)
    # The last 20 sessions are indices 310..329: the highs at 310 and 322 are in,
    # the one at 309 is the 21st session back and is out.
    assert got["rs_nh_count_20"] == 2
    # Newest high 322, the one before it 310: 322 - 310.
    assert got["rs_nh_quiet"] == 12
    # The only high on a market down day is 310: 329 - 310.
    assert got["rs_nh_red_bars_ago"] == 19
    # Today (329) is not a high, so it has no span.
    assert got["rs_nh_span"] is None


def test_the_count_window_is_twenty_sessions_not_nineteen_or_twenty_one():
    # One high only, placed on the oldest session of the window (310) and then
    # one session outside it (309).
    inside = _fields(_line(330, {310: 210.0}), _spy(330))
    outside = _fields(_line(330, {309: 210.0}), _spy(330))
    assert inside["rs_nh_count_20"] == 1
    assert outside["rs_nh_count_20"] == 0


def test_price_below_its_high_is_a_closing_percent_over_252_sessions():
    # Last close 200 - 3.29 = 196.71; highest close of indices 78..329 is 214.
    # (196.71 / 214 - 1) x 100 = -8.0794..., two places.
    assert _fields(SPIKED, SPIKED_SPY)["px_below_high_pct"] == -8.08
    # FLAT: 100 against 120 -> (100 / 120 - 1) x 100 = -16.666...
    assert _fields(AHEAD, AHEAD_SPY)["px_below_high_pct"] == -16.67


def test_the_price_high_window_is_252_sessions_including_today():
    # The 120 sits at index 200. With 452 bars the last 252 are 200..451: the
    # 120 is the oldest session of the window. With 453 it has left the window
    # and the highest close is 100 itself.
    assert _fields(_flat(452), _spy(452))["px_below_high_pct"] == -16.67
    assert _fields(_flat(453), _spy(453))["px_below_high_pct"] == 0.0
    # A close AT the high reads zero, and never a negative zero.
    at_high = _fields(_flat(330, {329: 120.0}), _spy(330))["px_below_high_pct"]
    assert at_high == 0.0 and str(at_high) == "0.0"
    # 119.9999 against 120 is -0.00008%: it rounds to zero, and is stored as a
    # plain 0.0, not the "-0.0" the rounding leaves behind.
    hair = _fields(_flat(330, {329: 119.9999}), _spy(330))["px_below_high_pct"]
    assert hair == 0.0 and str(hair) == "0.0"


def test_rs_high_before_price_age_counts_back_to_the_newest_high():
    got = _fields(AHEAD, AHEAD_SPY)
    # Highs at 320, 322, 327; price below its high on every bar since: 329 - 327.
    assert got["rs_nhbp_age"] == 2
    assert got["rs_nh_count_20"] == 3          # all three inside 310..329
    assert got["rs_nh_quiet"] == 5             # 327 - 322
    assert got["rs_nh_red_bars_ago"] == 7      # 322 is the newest down-day high


def test_price_reaching_its_high_after_the_rs_high_ends_the_before_price_state():
    # Index 328: the stock closes 118 (above 117.6: price is at its high) while
    # SPY closes 95, so RS is 118 / 95 = 1.2421, below 1.275: no RS high there.
    # The newest RS high (327) is two sessions back, but price has reached its
    # high since, so there is no "before price" age.
    stock = dict(enumerate(AHEAD))
    stock[328] = 118.0
    spy = dict(enumerate(AHEAD_SPY))
    spy[328] = 95.0
    got = _fields([stock[i] for i in range(330)], [spy[i] for i in range(330)])
    assert got["rs_nhbp_age"] is None
    assert got["rs_nh_quiet"] == 5             # the RS highs themselves are unchanged


def test_an_rs_high_made_with_price_at_its_high_has_no_before_price_age():
    # SPIKED: every RS high is a price high too (SPY is flat), and after 322 the
    # close (196.7) is below 0.98 x 214 = 209.72. The scan back from today meets
    # the price high at 322 on the same bar as the RS high: no age.
    assert _fields(SPIKED, SPIKED_SPY)["rs_nhbp_age"] is None


@pytest.mark.parametrize("n, expected", [(393, 62), (394, None)])
def test_the_before_price_age_stops_at_63_sessions(n, expected):
    # One RS high at index 330 (SPY 80 -> RS 1.25), SPY 81 on every later bar
    # (RS 1.2346: never another high). The 120 at index 200 stays inside the
    # prior 252 sessions through index 452, so price is below its high throughout.
    #   393 bars: last index 392, age 62: the 63rd session counting today. Kept.
    #   394 bars: last index 393, age 63: outside the 63 sessions. Blank.
    spy = _spy(n, {330: 80.0, **{i: 81.0 for i in range(331, n)}})
    assert _fields(_flat(n), spy)["rs_nhbp_age"] == expected


def test_span_says_how_long_since_the_rs_line_was_this_high():
    # 652 bars on LINE. Index 241 closed 200 - 2.41 = 197.59 and index 242 closed
    # 197.58. Today (651) closes 197.585: the newest earlier bar at or above it is
    # 241, which is 651 - 241 = 410 sessions back. Today is an RS high: the prior
    # 252 sessions (399..650) top out at 196.01.
    got = _fields(_line(652, {651: 197.585}), _spy(652))
    assert got["rs_nh_span"] == 410
    assert got["rs_nh_count_20"] == 1
    # The only high in the window: nothing earlier to measure a quiet spell from.
    assert got["rs_nh_quiet"] is None


def test_span_counts_a_tie_as_at_or_above_and_is_capped_at_the_window():
    # A tie: index 600 closed 210, today closes 210 again. Ties count as an RS
    # new high (the existing rule), and the line was last AT today's value 51
    # sessions back.
    assert _fields(_line(652, {600: 210.0, 651: 210.0}), _spy(652))["rs_nh_span"] == 51
    # Nothing in the window is as high as today: the answer is the window itself.
    assert _fields(_line(652, {651: 250.0}), _spy(652))["rs_nh_span"] == 652
    assert _fields(_line(400, {399: 250.0}), _spy(400))["rs_nh_span"] == 400
    # 210 yesterday, 205 today: today is not an RS high, so it has no span.
    assert _fields(_line(652, {650: 210.0, 651: 205.0}), _spy(652))["rs_nh_span"] is None


# ───────────────────────── short series, per measure ────────────────────────

def test_under_252_bars_every_measure_is_blank():
    got = _fields(_line(251), _spy(251))
    assert got == {k: None for k in KEYS}


def test_exactly_252_bars_has_a_price_distance_and_nothing_else():
    got = _fields(_line(252, {0: 250.0}), _spy(252))
    # Last close 200 - 2.51 = 197.49 against the 250 on the window's oldest
    # session: 197.49 / 250 = 0.78996 -> -21.004 -> -21.0.
    assert got["px_below_high_pct"] == -21.0
    assert all(got[k] is None for k in INT_KEYS)


def test_the_count_needs_twenty_sessions_the_rs_high_rule_can_judge():
    # An RS high can be judged from index 252 on. 271 bars hold 19 such sessions,
    # 272 hold 20.
    assert _fields(_line(271, {270: 250.0}), _spy(271))["rs_nh_count_20"] is None
    full = _fields(_line(272, {270: 250.0}), _spy(272))
    assert full["rs_nh_count_20"] == 1
    # The other measures do not wait for the count's window.
    short = _fields(_line(271, {268: 250.0, 270: 251.0}), _spy(271))
    assert short["rs_nh_count_20"] is None
    assert short["rs_nh_quiet"] == 2
    assert short["rs_nh_span"] == 271          # today (270) is the window's highest


def test_empty_inputs_and_a_missing_benchmark():
    assert rs_columns.screen_fields([], _bars(_spy(330))) == {k: None for k in KEYS}
    assert rs_columns.screen_fields(None, None) == {k: None for k in KEYS}
    # No SPY: the price measure reads the stock alone; the RS measures are blank.
    no_spy = rs_columns.screen_fields(_bars(SPIKED), [])
    assert no_spy["px_below_high_pct"] == -8.08
    assert all(no_spy[k] is None for k in INT_KEYS)
    # SPY has no bar at the stock's newest time: no RS reading for today.
    late = rs_columns.screen_fields(_bars(SPIKED), _bars(SPIKED_SPY)[:-1])
    assert late["px_below_high_pct"] == -8.08
    assert all(late[k] is None for k in INT_KEYS)


def test_a_hole_in_the_rs_line_is_blank_never_a_guess():
    # SPY loses its bar at index 300, so the RS line has a hole there and the
    # 252-session rule cannot judge any bar until 300 + 252. The highs at 309,
    # 310 and 322 are not seen, and nothing is claimed about them.
    spy = [b for i, b in enumerate(_bars(SPIKED_SPY)) if i != 300]
    got = rs_columns.screen_fields(_bars(SPIKED), spy)
    assert all(got[k] is None for k in INT_KEYS)
    assert got["px_below_high_pct"] == -8.08


def test_types_ints_are_ints_and_the_percent_is_a_float():
    for got in (_fields(SPIKED, SPIKED_SPY), _fields(AHEAD, AHEAD_SPY),
                _fields(_line(652, {651: 197.585}), _spy(652))):
        for k in INT_KEYS:
            v = got[k]
            assert v is None or (type(v) is int), (k, v)
        assert type(got["px_below_high_pct"]) is float


# ───────────────── agreement with the columns already shipped ───────────────

@pytest.mark.parametrize("stock, spy", [
    (SPIKED, SPIKED_SPY), (AHEAD, AHEAD_SPY),
    (AHEAD[:328], AHEAD_SPY[:328]),                    # today (327) IS a before-price high
    (SPIKED[:311], SPIKED_SPY[:311]),                  # today (310) IS a down-day high
    (_line(652, {651: 197.585}), _spy(652)),
])
def test_the_new_measures_agree_with_the_existing_columns(stock, spy):
    bars, bench = _bars(stock), _bars(spy)
    old = rs_columns.collect_one(bars, bench)
    new = rs_columns.screen_fields(bars, bench)
    assert (new["rs_nhbp_age"] == 0) == (old["rs_nh_before_price"] == 1)
    assert (new["rs_nh_red_bars_ago"] == 0) == (old["rs_nh_red_day"] == 1)
    assert (new["rs_nh_span"] is not None) == (old["rs_new_high"] == 1)
    if old["rs_nh_bars_ago"] is not None and new["rs_nh_red_bars_ago"] is not None:
        assert new["rs_nh_red_bars_ago"] >= old["rs_nh_bars_ago"]


def test_today_as_the_event_reads_age_zero():
    today_ahead = _fields(AHEAD[:328], AHEAD_SPY[:328])      # last index 327
    assert today_ahead["rs_nhbp_age"] == 0
    assert today_ahead["rs_nh_span"] == 328                   # RS 1.275 tops the window
    today_red = _fields(SPIKED[:311], SPIKED_SPY[:311])       # last index 310
    assert today_red["rs_nh_red_bars_ago"] == 0
    assert today_red["rs_nh_quiet"] == 1                      # 310 - 309


def test_handing_in_the_phase_one_columns_gives_the_same_answer():
    for stock, spy in ((SPIKED, SPIKED_SPY), (AHEAD, AHEAD_SPY)):
        bars, bench = _bars(stock), _bars(spy)
        p1 = rs.compute_phase1_columns(bars, bench)
        assert rs_columns.screen_fields(bars, bench, phase1=p1) == rs_columns.screen_fields(bars, bench)
    # Columns of another length are ignored and recomputed, never read misaligned.
    bars, bench = _bars(SPIKED), _bars(SPIKED_SPY)
    wrong = rs.compute_phase1_columns(bars[:-5], bench)
    assert rs_columns.screen_fields(bars, bench, phase1=wrong) == rs_columns.screen_fields(bars, bench)


def test_session_clips_bars_after_it():
    bars, bench = _bars(SPIKED), _bars(SPIKED_SPY)
    clipped = rs_columns.screen_fields(bars, bench, session=TIMES[310])
    assert clipped == rs_columns.screen_fields(bars[:311], bench[:311])
    assert clipped["rs_nh_red_bars_ago"] == 0


# ─────────────────────────── the helpers, directly ──────────────────────────

def test_event_gap_last_reads_the_two_newest_events():
    assert rs.event_gap_last([None, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0]) == 3
    assert rs.event_gap_last([None, 1.0, 1.0]) == 1
    # One event only, then the warm-up: no earlier one to measure from.
    assert rs.event_gap_last([None, None, 0.0, 1.0, 0.0]) is None
    # An unknown bar between the two could hide an event: blank, not a longer gap.
    assert rs.event_gap_last([1.0, None, 0.0, 1.0]) is None
    # An unknown bar after the newest could hide a newer one: blank.
    assert rs.event_gap_last([1.0, 0.0, 1.0, None]) is None
    assert rs.event_gap_last([]) is None
    assert rs.event_gap_last([0.0, 0.0]) is None


def test_event_age_unbroken_last_needs_every_bar_since_clear():
    ev = [0.0, 1.0, 0.0, 0.0]
    assert rs.event_age_unbroken_last(ev, [0.0, 0.0, 0.0, 0.0], 63) == 2
    assert rs.event_age_unbroken_last(ev, [1.0, 0.0, 0.0, 0.0], 63) == 2    # before the event: not read
    assert rs.event_age_unbroken_last(ev, [0.0, 1.0, 0.0, 0.0], 63) is None  # on the event bar
    assert rs.event_age_unbroken_last(ev, [0.0, 0.0, 1.0, 0.0], 63) is None  # between
    assert rs.event_age_unbroken_last(ev, [0.0, 0.0, 0.0, 1.0], 63) is None  # today
    assert rs.event_age_unbroken_last(ev, [0.0, 0.0, None, 0.0], 63) is None  # unknown is not clear
    assert rs.event_age_unbroken_last([0.0, 1.0, None, 0.0], [0.0] * 4, 63) is None
    # The window counts today: 3 sessions reach age 2, 2 sessions do not.
    assert rs.event_age_unbroken_last(ev, [0.0] * 4, 3) == 2
    assert rs.event_age_unbroken_last(ev, [0.0] * 4, 2) is None
    assert rs.event_age_unbroken_last(ev, [0.0] * 3, 63) is None             # misaligned
    assert rs.event_age_unbroken_last([], [], 63) is None


def test_level_span_last_and_close_below_high_pct_last():
    assert rs.level_span_last([5.0, 3.0, 2.0, 4.0]) == 3        # 5 is three bars back
    assert rs.level_span_last([4.0, 3.0, 2.0, 4.0]) == 3        # a tie is "at or above"
    assert rs.level_span_last([1.0, 3.0, 2.0, 4.0]) == 4        # nothing as high: the length
    assert rs.level_span_last([5.0, None, 2.0, 4.0]) == 2       # a hole ends what is known
    assert rs.level_span_last([5.0, 3.0, 2.0, None]) is None
    assert rs.level_span_last([]) is None
    assert rs.close_below_high_pct_last([16.0, 8.0], 2) == -50.0         # 8 / 16 - 1
    assert rs.close_below_high_pct_last([50.0, 16.0, 8.0], 2) == -50.0   # 50 is outside the window
    assert rs.close_below_high_pct_last([16.0, 8.0], 3) is None          # window not full
    assert rs.close_below_high_pct_last([16.0, None, 8.0], 3) is None    # a hole in the window
    assert rs.close_below_high_pct_last([16.0, 0.0, 8.0], 3) is None     # not a price
    assert rs.close_below_high_pct_last([8.0, 10.0], 2) == 0.0


# ───────────────────────────────── rails ────────────────────────────────────

def test_screen_fields_defines_no_maths_of_its_own():
    """Every number comes from `relative_strength`: the function body holds no
    `max`, `min`, `sum`, loop or division of its own."""
    tree = pyast.parse((ROOT / "api" / "services" / "screener" / "rs_columns.py")
                       .read_text(encoding="utf-8"))
    fn = next(n for n in pyast.walk(tree)
              if isinstance(n, pyast.FunctionDef) and n.name == "screen_fields")
    calls = {n.func.id for n in pyast.walk(fn)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)}
    assert not calls & {"max", "min", "sum", "sorted", "abs"}, calls
    assert not any(isinstance(n, (pyast.For, pyast.While, pyast.Div, pyast.Mult))
                   for n in pyast.walk(fn))
    used = {n.attr for n in pyast.walk(fn)
            if isinstance(n, pyast.Attribute) and isinstance(n.value, pyast.Name)
            and n.value.id == "rs"}
    assert {"compute_phase1_columns", "rolling_count", "bars_ago_column", "event_gap_last",
            "event_age_unbroken_last", "level_span_last", "close_below_high_pct_last"} <= used


def test_the_windows_are_the_ones_the_brief_names():
    assert rs.SCREEN_NH_COUNT_WINDOW == 20
    assert rs.SCREEN_NHBP_WINDOW == 63
    assert rs_columns.LOOKBACK == 252
    # The before-price rule is the chart's own 2% tolerance, not a second number.
    assert rs.DEFAULT_PRICE_TOLERANCE_PCT == 2.0


def test_screen_fields_changes_nothing_collect_one_returns():
    bars, bench = _bars(SPIKED), _bars(SPIKED_SPY)
    before = rs_columns.collect_one(bars, bench)
    rs_columns.screen_fields(bars, bench)
    assert rs_columns.collect_one(bars, bench) == before
    assert not set(KEYS) & set(before)
