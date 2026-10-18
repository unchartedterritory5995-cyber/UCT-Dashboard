"""bc:cup-with-handle drawing, round 8 (lab REPORT_CUP_R7.md, 2026-10-17): display-only. Round 7 found the
cause the display rules could not reach: the base catalog's cup start (cup.cup_with_handle_state ->
base_geometry) can fall a bar or more AFTER the real left peak, so the lip drawn is a lower secondary high on
the decline (R7 684 / 858, judged 1). Round 8 starts the DRAWN cup on that peak
(display.cup_true_start, wired in auto_structures._team_pivot); every later rule -- prior_peak, short_of_rim,
the handle -- reads the moved start. The detector's state, firing, pivot, levels and `confirmed_only` are
untouched. Synthetic bars only (public repo). Each rule has a firing case and a control.
"""
from __future__ import annotations

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars

# PRE flat bars at 100 (high 100.5, low 99.5); the detector's cup from bar PRE: its lip 100.5 at the cup's
# first bar, the low at +8, the right side's peak high `reach` at +18, then 22 flat bars at 97 with range
# 1.0 -- ATR(14) is exactly 1.0. `peak` puts a higher high (close `peak - 0.3`, so it is no wick spike)
# `peak_back` bars before the detector's start.
DOWN_UP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 98]
PRE = 25


def _cup(peak=None, peak_back=1, reach=100.0):
    closes = [100.0] * PRE + DOWN_UP + [97.0] * 22
    lows = [99.5] * PRE + [c - 3.5 for c in DOWN_UP] + [96.5] * 22
    highs = [100.5] * PRE + [c + 0.5 for c in DOWN_UP[:-1]] + [reach] + [97.5] * 22
    if peak is not None:
        highs[PRE - peak_back] = peak
        closes[PRE - peak_back] = peak - 0.3
    return _bars(closes, lows=lows, highs=highs)


def _box():
    return {"structure_key": "cup-with-handle", "start_t": ymd_t(PRE), "end_t": ymd_t(PRE + 40),
            "top": 100.5, "floor": 82.5, "pivot": 100.5,
            "sub_boxes": [{"start_t": ymd_t(PRE), "end_t": ymd_t(PRE + 18), "top": 100.5, "floor": 82.5},
                          {"start_t": ymd_t(PRE + 19), "end_t": ymd_t(PRE + 40), "top": 97.5, "floor": 96.5}]}


def _start(bars):
    return display.cup_true_start(bars, ymd_t(PRE), ymd_t(PRE + 18))


def test_the_lookback_is_the_round_8_calibration():
    # N = 1: the largest look-back that moves no judged-3 cup off the chart (R4 050 dies at 2, lab
    # out_cup_r8/calib.json)
    assert display.CUP_START_LOOKBACK_BARS == 1


def test_a_higher_peak_the_bar_before_the_detectors_start_becomes_the_cups_start():
    bars = _cup(100.7)
    assert _start(bars) == ymd_t(PRE - 1)
    rim = display.cup_rim_line(bars, ymd_t(PRE - 1), ymd_t(PRE + 18), bars[-1]["t"])
    assert rim["start_t"] == ymd_t(PRE - 1) and rim["price"] == 100.7      # the lip on the true peak


def test_the_start_stays_when_the_bar_before_is_not_above_the_lip_or_is_out_of_reach():
    assert _start(_cup()) == ymd_t(PRE)                     # equal to the lip (100.5): not above it
    assert _start(_cup(100.4)) == ymd_t(PRE)                # under the lip
    assert _start(_cup(100.7, peak_back=2)) == ymd_t(PRE)   # two bars back: past the 1-bar look-back


def test_unknown_spans_keep_the_detectors_start():
    bars = _cup(100.7)
    assert display.cup_true_start(bars, None, ymd_t(PRE + 18)) is None
    assert display.cup_true_start(bars, ymd_t(PRE), None) == ymd_t(PRE)
    assert display.cup_true_start(bars, ymd_t(0), ymd_t(PRE + 18)) == ymd_t(0)    # no bar before it


def test_box_to_detection_draws_the_rim_on_the_true_peak():
    ex = auto_structures.box_to_detection("ZZZ", _box(), _cup(100.7))["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["start_t"] == ymd_t(PRE - 1) and ex["draw_pivot"]["price"] == 100.7
    assert ex["cup_start_moved_from"] == ymd_t(PRE)
    assert ex["sub_boxes"][0]["start_t"] == ymd_t(PRE)     # the detector's own numbers are untouched
    # control: no higher bar before the start -> the rim stays on the detector's lip, nothing recorded
    ok = auto_structures.box_to_detection("ZZZ", _box(), _cup())["geometry"]["extras"]
    assert ok["draw_pivot"]["start_t"] == ymd_t(PRE) and ok["draw_pivot"]["price"] == 100.5
    assert "cup_start_moved_from" not in ok


def test_short_of_rim_is_judged_against_the_moved_rim():
    # the right side (100.0) is 0.5 ATR under the detector's lip -- drawn at round 7 -- but 0.9 ATR under
    # the true peak (100.9): RIM_REACH_ATR 0.8 now rejects it
    ex = auto_structures.box_to_detection("ZZZ", _box(), _cup(100.9))["geometry"]["extras"]
    assert ex.get("stale") is True and ex["stale_reason"] == "short_of_rim", ex
    # control: a right side that reaches within 0.8 ATR of the true peak draws
    ok = auto_structures.box_to_detection("ZZZ", _box(), _cup(100.9, reach=100.2))["geometry"]["extras"]
    assert not ok.get("stale") and ok["draw_pivot"]["price"] == 100.9, ok
