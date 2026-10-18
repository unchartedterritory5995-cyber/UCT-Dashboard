"""bc:cup-with-handle drawing, round 9 (lab REPORT_CUP_R8.md, 2026-10-17): display-only. A cup whose right side
stalled MORE than RIM_REACH_ATR (0.8) but at most HANDLE_PIVOT_REACH_ATR ATR(14) under the rim, with a handle and
no prior_peak, is no longer stale short_of_rim: its PIVOT is drawn at the handle high (extras.draw_pivot), the rim
stays as a faint reference (extras.draw_rim_ref), and the handle box sits under the handle high. Within 0.8 ATR
nothing changes (the rim is the pivot). The detector's state, firing, pivot, levels and `confirmed_only` are
untouched. Synthetic bars only (public repo). Each rule has a firing case and a control.
"""
from __future__ import annotations

from api.services import auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_drawing_geometry_v2 import _bars

# PRE flat bars at 100 (high 100.5, low 99.5): the rim (left lip) is 100.5 at the cup's first bar. The cup falls to
# a low of 82.5 at +8 and its right side peaks at `reach` on bar +18 (the handle high), then `handle` bars drift
# under it (close reach-0.8, range 1.0) -- ATR(14) is exactly 1.0, so the shortfall in ATR is 100.5 - reach.
DOWN_UP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 98]
PRE = 25
RIM = 100.5


def _cup(reach, handle=16, peak_back=None, peak=None):
    tail = [reach - 0.8] * handle
    closes = [100.0] * PRE + DOWN_UP + tail
    lows = [99.5] * PRE + [c - 3.5 for c in DOWN_UP] + [c - 0.5 for c in tail]
    highs = [100.5] * PRE + [c + 0.5 for c in DOWN_UP[:-1]] + [reach] + [c + 0.5 for c in tail]
    if peak is not None:
        highs[PRE - peak_back] = peak
        closes[PRE - peak_back] = peak - 0.3
    return _bars(closes, lows=lows, highs=highs)


def _box(handle=16):
    end = PRE + 18 + handle
    return {"structure_key": "cup-with-handle", "start_t": ymd_t(PRE), "end_t": ymd_t(end),
            "top": RIM, "floor": 82.5, "pivot": RIM,
            "sub_boxes": [{"start_t": ymd_t(PRE), "end_t": ymd_t(PRE + 18), "top": RIM, "floor": 82.5},
                          {"start_t": ymd_t(PRE + 19), "end_t": ymd_t(end), "top": 99.0, "floor": 98.0}]}


def _extras(reach, **kw):
    handle = kw.get("handle", 16)
    return auto_structures.box_to_detection("ZZZ", _box(handle), _cup(reach, **kw))["geometry"]["extras"]


def test_the_band_is_the_round_9_calibration_and_the_rim_reach_is_unchanged():
    # lab out_cup_r9/judged_r8code.json: judged cups 0.80-1.12 ATR short scored 1-2, every one further short 0-1
    assert display.HANDLE_PIVOT_REACH_ATR == 1.15
    assert display.RIM_REACH_ATR == 0.8


def test_the_fixture_atr_is_one_so_the_shortfall_reads_in_atr():
    assert abs(display.atr14(_cup(99.5)) - 1.0) < 1e-9


def test_a_right_side_stalled_inside_the_band_draws_its_pivot_at_the_handle_high():
    ex = _extras(99.5)                                          # 1.0 ATR under the rim
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 99.5                    # the handle high is the pivot / entry
    assert ex["draw_pivot"]["start_t"] == ymd_t(PRE + 18)       # from the right side's latest peak
    assert ex["draw_rim_ref"]["price"] == RIM                   # the rim stays, as a reference
    assert ex["draw_rim_ref"]["start_t"] == ymd_t(PRE)
    h = ex["draw_handle"]
    assert h["start_t"] == ymd_t(PRE + 18) and h["top"] == 99.5 # the box sits under the handle high
    assert h["floor"] < h["top"]
    assert ex["draw_box"] is False


def test_within_rim_reach_nothing_changes_the_rim_is_the_pivot():
    ex = _extras(99.9)                                          # 0.6 ATR under the rim
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == RIM
    assert "draw_rim_ref" not in ex


def test_a_right_side_short_of_the_band_stays_stale():
    ex = _extras(99.2)                                          # 1.3 ATR under the rim
    assert ex.get("stale") is True and ex["stale_reason"] == "short_of_rim", ex
    assert "draw_rim_ref" not in ex and "draw_pivot" not in ex
    assert ex["handle_pivot_reason"] == "short_of_rim"


def test_inside_the_band_without_a_handle_stays_stale():
    ex = _extras(99.5, handle=22)                              # pullback 22 bars after the peak: 'long', no box
    assert ex.get("stale") is True and ex["stale_reason"] == "short_of_rim", ex
    assert "draw_rim_ref" not in ex
    ok = _extras(99.5, handle=16)                              # control: the same cup with a 16-bar handle draws
    assert ok.get("draw_rim_ref")


def test_inside_the_band_with_a_prior_peak_stays_stale():
    ex = _extras(99.5, peak=102.0, peak_back=5)                # a higher peak 5 bars before the cup: 2.5 ATR over
    assert ex.get("stale") is True, ex
    assert "draw_rim_ref" not in ex
    assert ex["handle_pivot_reason"] == "prior_peak"


def test_handle_pivot_unit_answers():
    bars = _cup(99.5)
    rim = display.cup_rim_line(bars, ymd_t(PRE), ymd_t(PRE + 18), bars[-1]["t"])
    pv, box, why = display.handle_pivot(bars, ymd_t(PRE), ymd_t(PRE + 18), rim)
    assert why is None and pv["price"] == box["top"] == 99.5
    near = _cup(99.9)
    rim2 = display.cup_rim_line(near, ymd_t(PRE), ymd_t(PRE + 18), near[-1]["t"])
    assert display.handle_pivot(near, ymd_t(PRE), ymd_t(PRE + 18), rim2) == (None, None, "in_reach")
    assert display.handle_pivot(bars, None, ymd_t(PRE + 18), rim) == (None, None, "unknown")
