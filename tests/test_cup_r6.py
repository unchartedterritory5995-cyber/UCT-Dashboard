"""bc:cup-with-handle drawing, round 6 (lab REPORT_TEAM_SET_R5.md, 2026-10-17): display-only. The round-5
judges kept the rim (left lip) and asked for the handle pullback to be boxed; the round-4 handle rules
(a third of the cup's depth, the detector's fixed 5/10/15/20/25-bar sub-box) withheld it. One rim sat on a
wick spike before a crash the 2.5 ATR gap rule did not see (case_165). Nothing here changes what the
detector fires on, its levels or `confirmed_only` -- every stamp lives under `geometry.extras`. Synthetic
bars only (public repo). Each rule has a firing case and a control.

  1. pullback_handle  the handle box runs from the right side's LATEST peak to the last bar (or the bar
                      before a breakout close); no box when still rising, under HANDLE_MIN_BARS bars,
                      more than HANDLE_MAX_PULLBACK_BARS after the peak, or floored in the cup's lower half
  2. wiring           box_to_detection draws that box, never the detector's last sub-box
  3. spike_rim        a lip that is a wick spike above the bodies around it AND is followed by a crash
  4. short_of_rim     the right side must come within RIM_REACH_ATR (0.8) ATR; no 2%-of-price allowance
"""
from __future__ import annotations

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r3 import _cup_bars, _cup_box


def test_the_constants_are_the_round_6_calibration():
    assert display.HANDLE_MIN_BARS == 3
    assert display.HANDLE_MAX_PULLBACK_BARS == 20
    assert (display.SPIKE_RIM_ATR, display.SPIKE_RIM_BARS, display.CRASH_FALL_ATR) == (0.75, 5, 5.0)
    assert display.RIM_REACH_ATR == 0.8
    assert not hasattr(display, "RIM_REACH_FRAC")          # the 2%-of-price allowance is gone
    assert not hasattr(display, "handle_verdict")          # superseded by pullback_handle


# -- 1. pullback_handle ---------------------------------------------------------------------------
# round 3's cup (test_team_drawing_set_r3.CUP): bars 0-19, the lip 100.5 at bar 0, the low 82.5 at bar 8,
# the right side's highs 99.5 at bars 18 and 19; the cup's midpoint is 91.5.

RIM = {"start_t": ymd_t(0), "end_t": ymd_t(19), "price": 100.5}


def _handle(handle, tail=()):
    bars = _cup_bars(handle, tail)
    return display.pullback_handle(bars, ymd_t(0), ymd_t(19), {**RIM, "end_t": bars[-1]["t"]})


def test_the_handle_box_starts_at_the_right_sides_latest_peak_and_runs_to_the_last_bar():
    box, why = _handle([98, 97.5, 97, 97.5])
    assert why is None
    assert box == {"start_t": ymd_t(19), "end_t": ymd_t(23), "top": 99.5, "floor": 95.5}


def test_a_retest_of_the_peak_starts_the_handle_at_the_retest():
    box, _ = _handle([99, 98, 97.5, 98])                   # bar 20 retests 99.5
    assert box["start_t"] == ymd_t(20) and box["end_t"] == ymd_t(23)


def test_a_breakout_close_ends_the_handle_the_bar_before_it():
    box, why = _handle([98, 97.5, 97, 101])                # bar 23 closes 101 over the 100.5 rim
    assert why is None and box["end_t"] == ymd_t(22)
    # control: the same bar closing under the rim (and under the peak) is handle
    assert _handle([98, 97.5, 97, 98.5])[0]["end_t"] == ymd_t(23)


def test_no_box_while_the_right_side_is_still_rising():
    assert _handle([99.4, 99.7]) == (None, "no_pullback")  # bar 21 is the right side's high
    # control: one bar down after the peak and one more is a 3-bar handle
    assert _handle([99.7, 99.0, 98.8])[1] is None


def test_a_two_bar_pullback_is_short():
    assert _handle([98]) == (None, "short")                # bars 19-20
    assert _handle([98, 97.5])[1] is None                   # control: bars 19-21


def test_more_than_twenty_bars_after_the_peak_is_long():
    assert _handle([98.0] * 21) == (None, "long")
    assert _handle([98.0] * 20)[1] is None                  # control: exactly 20


def test_a_handle_floored_in_the_cups_lower_half_is_deep():
    assert _handle([98, 94, 90, 91]) == (None, "deep")     # floor 89.5 < 91.5
    box, why = _handle([98, 95, 93, 94])                   # floor 92.5: upper half
    assert why is None and box["floor"] == 92.5
    # round 4's "a third of the cup's depth" no longer applies: 8 of 18 under the rim draws
    assert _handle([98, 96, 94, 95])[1] is None


def test_pullback_handle_unknown_span_or_rim():
    bars = _cup_bars([98, 97.5, 97])
    assert display.pullback_handle(bars, 99999999, ymd_t(19), RIM) == (None, "unknown")
    assert display.pullback_handle(bars, ymd_t(0), ymd_t(19), {"price": None}) == (None, "unknown")


# -- 2. wiring --------------------------------------------------------------------------------------

def test_box_to_detection_draws_the_pullback_not_the_detectors_sub_box():
    ex = auto_structures.box_to_detection("ZZZ", _cup_box(23), _cup_bars([98, 97.5, 97, 97.5]))["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 100.5                          # the rim stays on the left lip
    assert ex["draw_handle"] == {"start_t": ymd_t(19), "end_t": ymd_t(23), "top": 99.5, "floor": 95.5}
    # the detector's own handle sub-box (bars 20-23) is untouched
    assert ex["sub_boxes"][1]["start_t"] == ymd_t(20)
    # a withheld handle names its reason and keeps the rim
    deep = auto_structures.box_to_detection("ZZZ", _cup_box(23), _cup_bars([98, 94, 90, 91]))["geometry"]["extras"]
    assert "draw_handle" not in deep and deep["handle_reason"] == "deep" and deep["draw_pivot"]["price"] == 100.5


# -- 3. spike_rim -----------------------------------------------------------------------------------

def _spike_bars(lip_high=102.0, after=(99.0, 96.0, 94.0, 93.0, 92.0)):
    """20 flat bars at 100 (range 1.0), the lip bar (open 100, close 100.2, high `lip_high`), then `after`."""
    bars = []
    closes = [100.0] * 20 + [100.2] + list(after)
    for i, c in enumerate(closes):
        bars.append({"t": ymd_t(i), "o": 100.0 if i == 20 else c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": 1000})
    bars[20]["h"] = lip_high
    return bars


def test_a_wick_spike_lip_followed_by_a_crash_is_a_spike_rim():
    assert display.spike_rim(_spike_bars(), 20) is True    # 1.8 above the bodies, a 10-point fall
    # controls -- each half alone is a real lip
    assert display.spike_rim(_spike_bars(lip_high=100.7), 20) is False            # no wick over the bodies
    assert display.spike_rim(_spike_bars(after=(99.8, 99.6, 99.4, 99.2, 99.0)), 20) is False   # no crash
    assert display.spike_rim(_spike_bars(), None) is False


def test_cup_reach_verdict_rejects_a_spike_rim():
    bars = _spike_bars() + [{"t": ymd_t(26 + k), "o": c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": 1000}
                            for k, c in enumerate([93, 95, 97, 99, 100.5, 101.5])]
    rim = {"start_t": ymd_t(20), "end_t": ymd_t(31), "price": 102.0}
    low_j = min(range(20, 32), key=lambda j: bars[j]["l"])
    assert display.cup_reach_verdict(bars, display._index(bars), low_j, rim) == (False, "spike_rim")
    flat = [dict(b) for b in bars]
    flat[20]["h"] = 100.7
    ok = display.cup_reach_verdict(flat, display._index(flat), low_j, {**rim, "price": 100.7})
    assert ok[1] != "spike_rim", ok


# -- 4. short_of_rim at 0.8 ATR, no percent allowance ---------------------------------------------

DOWN_UP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 98]   # bars 0-18


def _reach_bars(peak_high):
    """A cup whose right side peaks at bar 18 (`peak_high`), then 22 flat bars at 97 (range 1.0, so
    ATR(14) is exactly 1.0). The rim (lip) is 100.5."""
    closes = DOWN_UP + [97.0] * 22
    lows = [c - 3.5 for c in DOWN_UP] + [96.5] * 22
    highs = [c + 0.5 for c in DOWN_UP[:-1]] + [peak_high] + [97.5] * 22
    return _bars(closes, lows=lows, highs=highs)


def test_short_of_rim_is_0_8_atr_with_no_percent_allowance():
    for peak, want in ((99.6, (False, "short_of_rim")),     # 0.9 ATR short
                       (99.0, (False, "short_of_rim")),     # 1.5 ATR / 1.5% short: round 5's 2% let it draw
                       (99.8, (True, None))):               # control: 0.7 ATR short
        bars = _reach_bars(peak)
        assert display.atr14(bars) == 1.0
        rim = display.cup_rim_line(bars, ymd_t(0), ymd_t(18), bars[-1]["t"])
        assert rim["price"] == 100.5
        assert display.cup_shape_verdict(bars, ymd_t(0), ymd_t(18), rim) == want, peak
