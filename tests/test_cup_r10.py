"""bc:cup-with-handle drawing, round 10 (lab REPORT_CUP_R9.md, 2026-10-18): display-only. A cup the rim rules DRAW
(its right side within RIM_REACH_ATR of the rim) whose right side's highest high since the cup's low still sits more
than HANDLE_PIVOT_EPS_ATR ATR(14) under the rim, and that has a handle box, now pivots at the HANDLE HIGH
(extras.draw_pivot) with the rim as a faint reference (extras.draw_rim_ref) -- round 9's two-line drawing. No handle
box, or a right side that reached / went over the rim: unchanged, the rim is the pivot. Round 9's beyond-reach band
is unchanged. The detector's state, firing, pivot, levels and `confirmed_only` are untouched. Synthetic bars only
(public repo); the fixture is round 9's (ATR(14) = 1.0, so the shortfall reads in ATR as 100.5 - reach).
"""
from __future__ import annotations

from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_cup_r9 import PRE, RIM, _cup, _extras


def _rim(bars):
    return display.cup_rim_line(bars, ymd_t(PRE), ymd_t(PRE + 18), bars[-1]["t"])


def test_the_epsilon_is_the_round_10_calibration_and_the_other_bands_are_unchanged():
    # lab out_cup_r10/judged_r9code.json: R9 839 (0.107 ATR short) read as "reached"; R8 821 (0.138) asked for
    assert display.HANDLE_PIVOT_EPS_ATR == 0.12
    assert display.RIM_REACH_ATR == 0.8
    assert display.HANDLE_PIVOT_REACH_ATR == 1.15


def test_a_right_side_within_reach_but_under_the_rim_pivots_at_the_handle_high():
    ex = _extras(99.9)                                          # 0.6 ATR under the rim: inside the 0.8 reach
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 99.9                    # the handle high is the pivot / entry
    assert ex["draw_pivot"]["start_t"] == ymd_t(PRE + 18)       # from the right side's latest peak
    assert ex["draw_pivot"]["end_t"] == ex["draw_rim_ref"]["end_t"]
    assert ex["draw_rim_ref"]["price"] == RIM                   # the rim stays, as a faint reference
    assert ex["draw_rim_ref"]["start_t"] == ymd_t(PRE)
    assert ex["draw_handle"]["top"] == 99.9                     # the box sits under the handle high
    assert ex["draw_box"] is False


def test_a_right_side_that_reached_the_rim_within_the_epsilon_keeps_the_rim_as_pivot():
    ex = _extras(100.45)                                        # 0.05 ATR under: reached
    assert ex["draw_pivot"]["price"] == RIM
    assert "draw_rim_ref" not in ex
    assert ex["draw_handle"]["top"] == 100.45                   # the handle box is still drawn
    ctl = _extras(100.3)                                        # control: 0.2 ATR under pivots at the handle high
    assert ctl["draw_pivot"]["price"] == 100.3 and ctl["draw_rim_ref"]["price"] == RIM


def test_a_right_side_over_the_rim_keeps_the_rim_as_pivot():
    ex = _extras(101.0)                                         # a wick 0.5 ATR over the rim, no close over it
    assert ex["draw_pivot"]["price"] == RIM
    assert "draw_rim_ref" not in ex


def test_within_reach_without_a_handle_box_nothing_changes():
    ex = _extras(99.9, handle=22)                              # pullback 22 bars after the peak: 'long', no box
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == RIM
    assert "draw_rim_ref" not in ex and "draw_handle" not in ex
    assert ex["handle_reason"] == "long"


def test_the_round_9_beyond_reach_band_is_unchanged():
    ex = _extras(99.5)                                          # 1.0 ATR under: round 9's band
    assert ex["draw_pivot"]["price"] == 99.5 and ex["draw_rim_ref"]["price"] == RIM
    far = _extras(99.2)                                         # 1.3 ATR under: still stale
    assert far.get("stale") is True and far["stale_reason"] == "short_of_rim"


def test_handle_pivot_in_reach_unit_answers():
    bars = _cup(99.9)
    rim = _rim(bars)
    box, _ = display.pullback_handle(bars, ymd_t(PRE), ymd_t(PRE + 18), rim)
    pv, why = display.handle_pivot_in_reach(bars, ymd_t(PRE), ymd_t(PRE + 18), rim, box)
    assert why is None and pv == {"start_t": box["start_t"], "end_t": rim["end_t"], "price": 99.9}
    assert display.handle_pivot_in_reach(bars, ymd_t(PRE), ymd_t(PRE + 18), rim, None) == (None, "no_handle")
    assert display.handle_pivot_in_reach(bars, None, ymd_t(PRE + 18), rim, box) == (None, "unknown")
    near = _cup(100.45)
    rim2 = _rim(near)
    box2, _ = display.pullback_handle(near, ymd_t(PRE), ymd_t(PRE + 18), rim2)
    assert display.handle_pivot_in_reach(near, ymd_t(PRE), ymd_t(PRE + 18), rim2, box2) == (None, "at_rim")
