"""bc:flat-base round 6 (lab REPORT_BCFLAT_C2.md, 2026-10-17): the display-only fixes for what the
bcflat-c2 judges named. Nothing here changes what base_geometry fires on or base_catalog's numbers
(top / floor / pivot / levels.entry) -- every stamp lives under `geometry.extras`. Synthetic bars
only (public repo). Each rule has a firing case and a control.

  1. anchor       the line's cluster is counted per SWING peak: the adjacent bars of one spike are
                  one touch, so they never make a cluster on their own (round 4's robust_top did).
  2. start        the drawn line starts at its first touch, not over the run-up bars below it.
  3. overhead     a swing high more than OVERHEAD_MAX_ATR above the line: a pullback-recovery.
  4. rolling      the last ROLL_BARS closes falling with the last close ROLL_BELOW_ATR under it.
  5. deep V       closes more than V_DEPTH_ATR under the line, fewer than V_MIN_TOP_FRAC in band.
  6. loose        a base of LOOSE_MIN_BARS+ bars wider than BCFLAT_MAX_RANGE_ATR.
"""
from __future__ import annotations

import copy

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r4 import RUNUP, _base

ATR = 1.5      # _base's alternating 99 / 100 closes, highs/lows +-0.5: every true range is 1.5


def _box(n, top, pivot=None):
    return {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(n - 1),
            "top": top, "floor": 89.5, "pivot": pivot}


def _detect(closes, highs=None, lows=None, top=100.5, pivot=100.6):
    bars = _bars(closes, lows=lows, highs=highs or [c + 0.5 for c in closes])
    return auto_structures.box_to_detection("ZZZ", _box(len(closes), top, pivot), bars), bars


# -- 1. anchor ---------------------------------------------------------------------------------------

def test_the_bars_of_one_spike_are_one_touch_so_the_line_stays_on_the_base_top():
    closes = RUNUP + _base(30)
    highs = [c + 0.5 for c in closes]
    highs[15], highs[16] = 103.0, 102.9                     # ONE spike, two adjacent bars
    bars = _bars(closes, highs=highs)
    assert display.atr14(bars) == ATR
    # round 4's rule counts the two bars as a cluster of two and lands on the spike
    assert display.robust_top(bars, 4, 33, ATR) == 103.0
    assert display.swing_peaks(bars, 4, 33).count(16) == 0  # bar 16 is part of bar 15's swing
    assert display.resistance_top(bars, 4, 33, ATR) == 100.5
    d, _ = _detect(closes, highs=highs, top=103.0, pivot=103.1)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 100.5
    assert d["levels"]["entry"] == 103.1                    # base_catalog's numbers, unchanged
    assert ex["top"] == 103.0 and ex["pivot"] == 103.1


def test_two_separate_swings_at_one_level_are_the_resistance():
    # control: the same two highs as two SEPARATE swings (bars 12 and 20) are a real cluster
    closes = RUNUP + _base(30)
    highs = [c + 0.5 for c in closes]
    highs[12], highs[20] = 103.0, 102.9
    bars = _bars(closes, highs=highs)
    assert display.resistance_top(bars, 4, 33, ATR) == 103.0
    assert display.resistance_top(bars, 5, 4, ATR) is None
    assert display.resistance_top(bars, 4, 33, None) == display.robust_top(bars, 4, 33, None)


def test_swing_peaks_keep_a_flat_tops_repeated_highs():
    bars = _bars([99.0, 100.0, 100.0, 100.0, 99.0, 98.0, 99.0, 100.0, 99.0])
    assert display.swing_peaks(bars, 0, 8) == [1, 2, 3, 7]  # a flat top's tied highs are each a touch
    assert display.swing_peaks(_bars(_base(9)), 0, 8) == [0, 2, 4, 6, 8]   # the alternating flat top


# -- 2. start ----------------------------------------------------------------------------------------

def test_the_line_starts_at_its_first_touch_not_over_the_run_up():
    closes = [91.0, 94.0, 97.0, 98.0, 98.5] + _base(30)     # an advance whose last bars close in the band
    d, bars = _detect(closes)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    ext = display.consolidation_extent(bars, ymd_t(0), ymd_t(len(closes) - 1), 100.5, 89.5)
    assert ext["start_t"] == ymd_t(2)                       # the consolidation span starts on the run-up
    first = display.first_touch(bars, 0, len(bars) - 1, 100.5, ATR)
    assert first == 6 and ex["draw_pivot"]["start_t"] == ymd_t(6), ex["draw_pivot"]
    assert all(b["h"] < 100.5 - display.TOP_TOUCH_ATR * ATR for b in bars[2:6])
    # control: a base whose first bar already touches the line starts where it always did
    d2, _ = _detect([97.0, 100.0] + _base(30))
    assert d2["geometry"]["extras"]["draw_pivot"]["start_t"] == ymd_t(1)
    assert display.first_touch(bars, 0, 5, 100.5, ATR) is None
    assert display.first_touch(bars, 0, 5, None, ATR) is None


# -- 3..6 bcflat_right_verdict -----------------------------------------------------------------------

def _verdict(closes, highs=None, lows=None, price=100.5, start=0):
    bars = _bars(closes, lows=lows, highs=highs or [c + 0.5 for c in closes])
    return display.bcflat_right_verdict(bars, ymd_t(start), ymd_t(len(closes) - 1), price), bars


def test_a_climax_high_far_above_the_line_is_a_pullback_recovery():
    closes = _base(30)
    highs = [c + 0.5 for c in closes]
    highs[8] = 100.5 + display.OVERHEAD_MAX_ATR * ATR + 0.2  # one swing high left above the line
    assert _verdict(closes, highs)[0] == (False, "overhead_high")
    # control: a high within OVERHEAD_MAX_ATR is a wick on the base, and the last bar never counts
    highs[8] = 100.5 + display.OVERHEAD_MAX_ATR * ATR - 0.2
    assert _verdict(closes, highs)[0] == (True, None)
    last = [c + 0.5 for c in closes]
    last[-1] = 106.0                                        # the breakout bar itself
    assert _verdict(closes, last)[0][1] != "overhead_high"


def test_a_right_side_rolling_over_under_the_line_is_stale():
    falling = [100.0 - 0.5 * k for k in range(8)]           # 100 .. 96.5, the last 8 closes
    (ok, why), bars = _verdict(_base(30) + falling)
    at = display.atr14(bars)
    assert 100.5 - 96.5 > display.ROLL_BELOW_ATR * at
    assert (ok, why) == (False, "rolling_over")
    # control 1: the same distance under the line, but flat (not rolling over)
    assert _verdict(_base(30) + [96.5] * 8)[0] == (True, None)
    # control 2: falling, but still within ROLL_BELOW_ATR of the line
    assert _verdict(_base(30) + [100.0, 99.8, 99.6, 99.4, 99.2, 99.0, 98.8, 98.6])[0] == (True, None)


def test_a_deep_v_with_little_time_at_the_top_is_stale():
    v = [100.0, 99.0] + [93.0] * 14 + [99.0, 100.0] * 3      # 14 closes 7.5 under the line, 8 in the band
    (ok, why), bars = _verdict(v)
    at = display.atr14(bars)
    assert 100.5 - 93.0 > display.V_DEPTH_ATR * at
    assert (ok, why) == (False, "v_recovery")
    # control: the same dip in a base that spent most of its time at the top is a shakeout
    held = _base(30) + [93.0] * 3 + [99.0, 100.0] * 4
    assert _verdict(held)[0] == (True, None)


def test_a_long_wide_base_is_loose_but_a_short_one_is_not():
    n = display.LOOSE_MIN_BARS
    lows = [c - 0.5 for c in _base(n)]
    lows[10] = 100.5 - display.BCFLAT_MAX_RANGE_ATR * ATR - 0.5   # one deep wick: range > 4.4 ATR
    assert _verdict(_base(n), lows=lows)[0] == (False, "loose_base")
    # control: the same range over LOOSE_MIN_BARS - 1 bars
    assert _verdict(_base(n - 1), lows=lows[1:])[0] == (True, None)


def test_the_verdict_draws_when_it_cannot_tell():
    closes = _base(30)
    bars = _bars(closes)
    assert display.bcflat_right_verdict(bars, 99999999, ymd_t(29), 100.5) == (True, None)
    assert display.bcflat_right_verdict(bars, ymd_t(0), ymd_t(29), None) == (True, None)


# -- integration: a stale reason reaches the row, and nothing outside extras moves ------------------

def test_a_rolling_over_base_is_stale_on_the_row_and_display_only():
    closes = RUNUP + _base(30) + [100.0 - 0.4 * k for k in range(8)]   # 100 .. 97.2: 2.7 ATR under
    d, _ = _detect(closes)
    before = copy.deepcopy({k: d[k] for k in ("start_t", "end_t", "levels", "confidence")})
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "rolling_over", ex
    assert "draw_pivot" not in ex
    assert d["levels"]["entry"] == 100.6 and d["start_t"] == ymd_t(0)
    assert {k: d[k] for k in ("start_t", "end_t", "levels", "confidence")} == before


def test_flat_base_still_uses_round_4s_top_cluster():
    # the confirmed flat_base drawing is NOT changed by round 6: its line is robust_top's
    import inspect
    src = inspect.getsource(display.flat_base_box)
    assert "robust_top(" in src and "resistance_top(" not in src
