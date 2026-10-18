"""bc:cup-with-handle drawing, round 7 (lab REPORT_CUP_R6.md, 2026-10-17): display-only. The round-6 judges
flagged rims on a secondary high under the true left peak (the lip is the highest high from the DETECTOR'S cup
start, which can fall after the real peak), rims on a single wick spike with no crash after it, and handle
boxes poking above the rim. Nothing here changes what the detector fires on, its levels or `confirmed_only`;
the rim is never re-anchored (lab REPORT_BCFLAT_R6.md). Synthetic bars only (public repo). Each rule has a
firing case and a control.

  1. prior_peak     the right side's highest high sits more than PRIOR_PEAK_REACH_ATR ATR(14) under the
                    highest high in the PRIOR_PEAK_BARS bars before the cup's start: not drawn
  2. spike_rim      a lip wick more than SPIKE_RIM_ATR (0.6) ATR over every body within 5 bars, no crash needed
  3. handle top     the handle box's top is capped at the rim
"""
from __future__ import annotations

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r3 import _cup_bars


def test_the_constants_are_the_round_7_calibration():
    assert (display.PRIOR_PEAK_BARS, display.PRIOR_PEAK_REACH_ATR) == (20, 1.5)
    assert (display.SPIKE_RIM_ATR, display.SPIKE_RIM_BARS) == (0.6, 5)
    assert not hasattr(display, "CRASH_FALL_ATR")          # spike_rim's crash half is gone


# -- 1. prior_peak ----------------------------------------------------------------------------------
# PRE flat bars at 100 (high 100.5), one of them carrying the prior peak's high; then the cup from bar
# PRE: closes DOWN_UP (the lip 100.5 at the cup's first bar, the low at +8), the right side's peak high
# `reach` at +18, then 22 flat bars at 97 with range 1.0 -- ATR(14) is exactly 1.0.

DOWN_UP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 98]
PRE = 25


def _prior_bars(peak_high, peak_back=3, reach=100.0):
    closes = [100.0] * PRE + DOWN_UP + [97.0] * 22
    lows = [99.5] * PRE + [c - 3.5 for c in DOWN_UP] + [96.5] * 22
    highs = [100.5] * PRE + [c + 0.5 for c in DOWN_UP[:-1]] + [reach] + [97.5] * 22
    highs[PRE - peak_back] = peak_high
    return _bars(closes, lows=lows, highs=highs)


def _verdict(bars):
    rim = display.cup_rim_line(bars, ymd_t(PRE), ymd_t(PRE + 18), bars[-1]["t"])
    assert rim["price"] == 100.5 and rim["start_t"] == ymd_t(PRE)      # the lip at the cup's start
    return display.cup_shape_verdict(bars, ymd_t(PRE), ymd_t(PRE + 18), rim)


def test_a_right_side_short_of_the_peak_before_the_cup_start_is_prior_peak():
    bars = _prior_bars(101.6)                     # the right side (100.0) is 1.6 ATR under it
    assert display.atr14(bars) == 1.0
    low_j = PRE + 8
    assert display.prior_peak(bars, PRE, low_j) is True
    assert _verdict(bars) == (False, "prior_peak")
    # controls: 1.4 ATR short draws (the rim reach rule alone is met: 0.5 ATR under the lip)
    assert display.prior_peak(_prior_bars(101.4), PRE, low_j) is False
    assert _verdict(_prior_bars(101.4)) == (True, None)


def test_prior_peak_reads_only_the_twenty_bars_before_the_cup_start():
    assert display.prior_peak(_prior_bars(105.0, peak_back=20), PRE, PRE + 8) is True
    assert display.prior_peak(_prior_bars(105.0, peak_back=21), PRE, PRE + 8) is False
    # a higher peak INSIDE the cup's span is the lip itself (cup_rim_line), never a prior peak
    assert display.prior_peak(_prior_bars(105.0), 0, PRE + 8) is False


def test_prior_peak_unknown_spans_never_fire():
    bars = _prior_bars(105.0)
    assert display.prior_peak(bars, None, PRE + 8) is False
    assert display.prior_peak(bars, PRE, None) is False
    assert display.prior_peak(bars, PRE, len(bars) - 1) is False       # no bar after the low


def test_box_to_detection_marks_a_prior_peak_cup_stale_and_keeps_the_rim_where_it_was():
    def box():
        return {"structure_key": "cup-with-handle", "start_t": ymd_t(PRE), "end_t": ymd_t(PRE + 40),
                "top": 100.5, "floor": 82.5, "pivot": 100.5,
                "sub_boxes": [{"start_t": ymd_t(PRE), "end_t": ymd_t(PRE + 18), "top": 100.5, "floor": 82.5},
                              {"start_t": ymd_t(PRE + 19), "end_t": ymd_t(PRE + 40), "top": 97.5,
                               "floor": 96.5}]}
    ex = auto_structures.box_to_detection("ZZZ", box(), _prior_bars(101.6))["geometry"]["extras"]
    assert ex.get("stale") is True and ex["stale_reason"] == "prior_peak", ex
    ok = auto_structures.box_to_detection("ZZZ", box(), _prior_bars(101.4))["geometry"]["extras"]
    assert not ok.get("stale"), ok
    assert ok["draw_pivot"]["price"] == 100.5 and ok["draw_pivot"]["start_t"] == ymd_t(PRE)   # not moved


# -- 2. spike_rim without a crash -------------------------------------------------------------------

def _wick_bars(lip_high):
    """20 flat bars at 100 (range 1.0), the lip bar (open 100, close 100.2, high `lip_high`), then a slow
    drift down -- no crash after the lip."""
    closes = [100.0] * 20 + [100.2] + [99.8, 99.6, 99.4, 99.2, 99.0]
    bars = [{"t": ymd_t(i), "o": 100.0 if i == 20 else c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": 1000}
            for i, c in enumerate(closes)]
    bars[20]["h"] = lip_high
    return bars


def _over_bodies(bars):
    return (bars[20]["h"] - 100.2) / display.atr14(bars[:21])


def test_a_wick_lip_over_its_bodies_is_a_spike_rim_with_no_crash_after_it():
    hi = _wick_bars(100.9)
    assert 0.6 < _over_bodies(hi) < 0.75                 # round 6's 0.75 + crash rule let it draw
    assert display.spike_rim(hi, 20) is True
    lo = _wick_bars(100.75)
    assert _over_bodies(lo) < 0.6                        # control: under 0.6 ATR is a real lip
    assert display.spike_rim(lo, 20) is False


# -- 3. the handle box's top is capped at the rim ---------------------------------------------------
# round 3's cup (test_team_drawing_set_r3.CUP): the lip 100.5 at bar 0, the low 82.5 at bar 8.

RIM = {"start_t": ymd_t(0), "end_t": ymd_t(19), "price": 100.5}


def test_a_right_side_peak_wick_over_the_rim_is_capped_at_the_rim():
    bars = _cup_bars([100.3, 99.5, 99.0, 99.2])           # bar 20 closes 100.3 under the rim, high 100.8
    assert bars[20]["h"] == 100.8
    box, why = display.pullback_handle(bars, ymd_t(0), ymd_t(19), {**RIM, "end_t": bars[-1]["t"]})
    assert why is None and box["start_t"] == ymd_t(20)
    assert box["top"] == 100.5
    # control: a peak under the rim keeps its own high
    bars = _cup_bars([98, 97.5, 97, 97.5])
    box, _ = display.pullback_handle(bars, ymd_t(0), ymd_t(19), {**RIM, "end_t": bars[-1]["t"]})
    assert box["top"] == 99.5
