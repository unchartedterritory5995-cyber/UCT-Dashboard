"""Drawing-geometry fixes from the blind tier round v2 (lab/geometry_eval REPORT_TIERS_V2.md,
2026-10-17). DISPLAY-ONLY: every fix lives under `geometry.extras` (draw_anchors / draw_ema /
draw_pole / draw_lanes); `anchors`, `levels`, `start_t`, `end_t` and confidence are untouched.

Synthetic bars only (public repo).
"""
from __future__ import annotations

import copy
import glob
import json
import os

import pytest

import api.routers.patterns  # noqa: F401 -- registers every detector
from api.services import auto_structures
from api.services.pattern_engine import detect_one, display
from api.services.pattern_engine.primitives.context import build_context
from tests.detector_fixtures import ymd_t

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bars(closes, lows=None, highs=None):
    out = []
    for i, c in enumerate(closes):
        lo = lows[i] if lows else c - 0.5
        hi = highs[i] if highs else c + 0.5
        out.append({"t": ymd_t(i), "o": c, "h": hi, "l": lo, "c": c, "v": 1000})
    return out


def _fixture_frames(pattern_id):
    out = []
    for f in sorted(glob.glob(os.path.join(REPO, "tests", "fixtures", pattern_id, "*.json"))):
        try:
            data = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        bars = data.get("bars") if isinstance(data, dict) else None
        if isinstance(bars, list) and bars and isinstance(bars[0], dict) and "h" in bars[0]:
            out.append([dict(b, t=ymd_t(i)) for i, b in enumerate(bars)])
    return out


def _fired(pid):
    """(bars, detection) for every fire of `pid` on its own fixtures."""
    out = []
    for bars in _fixture_frames(pid):
        try:
            dets = detect_one(bars, build_context(bars, sym="TEST"), pid)
        except Exception:
            continue
        out.extend((bars, d) for d in dets)
    return out


# -- b. snap anchors to the true extreme of each leg -----------------------------------------

def test_snap_moves_a_trough_onto_the_deeper_low_inside_its_leg():
    # T1 at 2, a DEEPER low at 5 (between T1 and the peak at 8), T2 at 12.
    lows = [10, 9, 8, 9, 8.5, 6, 8, 9, 11, 10, 9, 8.6, 8.1, 9, 10]
    bars = _bars([lo + 0.5 for lo in lows], lows=lows, highs=[lo + 1 for lo in lows])
    assert display.snap_to_extremes(bars, [2, 8, 12], ("low", "high", "low")) == [5, 8, 12]


def test_snap_keeps_order_and_never_returns_a_less_extreme_bar():
    lows = [5, 4, 3, 4, 5, 6, 7, 6, 5, 4, 3.5, 4]
    bars = _bars([lo + 0.5 for lo in lows], lows=lows, highs=[lo + 1 for lo in lows])
    idxs = [1, 5, 9]
    out = display.snap_to_extremes(bars, idxs, ("low", "high", "low"))
    assert out == sorted(out) and len(set(out)) == 3
    for o, i, k in zip(out, idxs, ("low", "high", "low")):
        assert (bars[o]["l"] <= bars[i]["l"]) if k == "low" else (bars[o]["h"] >= bars[i]["h"])
    assert out == [2, 6, 10]


@pytest.mark.parametrize("pid", ["double_bottom", "double_top", "head_shoulders"])
def test_snapped_draw_anchors_ride_the_detection_and_anchors_are_untouched(pid):
    fired = _fired(pid)
    assert fired, f"control: {pid} never fired on its fixtures"
    kinds = display.EXTREME_CHAINS[pid]
    for bars, d in fired:
        g = d["geometry"]
        draw = g["extras"]["draw_anchors"]
        assert len(draw) == len(g["anchors"]) == len(kinds)
        by_t = {b["t"]: b for b in bars}
        ts = [a["t"] for a in draw]
        assert ts == sorted(ts)
        for a, k in zip(draw, kinds):
            assert a["price"] == (by_t[a["t"]]["l"] if k == "low" else by_t[a["t"]]["h"])


def test_draw_geometry_leaves_anchors_levels_and_confidence_alone():
    lows = [10, 9, 8, 9, 8.5, 6, 8, 9, 11, 10, 9, 8.6, 8.1, 9, 10]
    bars = _bars([lo + 0.5 for lo in lows], lows=lows, highs=[lo + 1 for lo in lows])
    d = {"pattern_id": "double_bottom", "confidence": 61.0, "levels": {"entry": 12.0},
         "start_t": ymd_t(2), "end_t": ymd_t(14),
         "geometry": {"shape": "neckline", "extras": {},
                      "anchors": [{"t": ymd_t(2), "price": 8.0}, {"t": ymd_t(8), "price": 12.0},
                                  {"t": ymd_t(12), "price": 8.1}]}}
    before = copy.deepcopy(d)
    display.draw_geometry([d], bars)
    assert d["geometry"]["extras"]["draw_anchors"][0] == {"t": ymd_t(5), "price": 6.0}
    for k in ("confidence", "levels", "start_t", "end_t"):
        assert d[k] == before[k]
    assert d["geometry"]["anchors"] == before["geometry"]["anchors"]


# -- c. the EMA a pullback names --------------------------------------------------------------

@pytest.mark.parametrize("pid,period", [("pullback_to_10ema", 10), ("holy_grail", 20)])
def test_pullback_draws_its_named_ema_over_the_pullback_window(pid, period):
    fired = _fired(pid)
    assert fired, f"control: {pid} never fired on its fixtures"
    for bars, d in fired:
        ema = d["geometry"]["extras"]["draw_ema"]
        assert ema["period"] == period
        pts = ema["points"]
        assert len(pts) >= 2
        # ends on the last bar AT the level the detector drew (same EMA, same seed)
        assert pts[-1]["t"] == bars[-1]["t"]
        assert pts[-1]["price"] == pytest.approx(d["geometry"]["anchors"][0]["price"], abs=1e-3)
        # starts at or before the pullback bar, no further back than the lookback
        idx = {b["t"]: i for i, b in enumerate(bars)}
        pb = idx[d["pivot_ts"][0]]
        assert pb - display.PULLBACK_WINDOW_LOOKBACK <= idx[pts[0]["t"]] <= pb
        # the points are the EMA, not a flat line
        assert len({p["price"] for p in pts}) > 1


@pytest.mark.parametrize("pid,period", sorted(display.PULLBACK_EMA.items()))
def test_every_pullback_period_draws_on_synthetic_bars(pid, period):
    """pullback_to_21ema does not fire on its own fixtures here (context gate), so the EMA
    segment is proven for every named period on a synthetic run."""
    closes = [100 + i * 0.5 + (3 if i == 85 else 0) for i in range(100)]
    bars = _bars(closes)
    d = {"pattern_id": pid, "pivot_ts": [ymd_t(90), ymd_t(99)],
         "geometry": {"shape": "horizontal_line", "extras": {},
                      "anchors": [{"t": ymd_t(99), "price": 1.0}]}}
    display.draw_geometry([d], bars)
    ema = d["geometry"]["extras"]["draw_ema"]
    assert ema["period"] == period
    # the window starts at the swing high before the pullback bar (bar 85)
    assert ema["points"][0]["t"] == ymd_t(85) and ema["points"][-1]["t"] == ymd_t(99)
    assert ema["points"][-1]["price"] == pytest.approx(
        display.ema_series([b["c"] for b in bars], period)[-1], abs=1e-3)


def test_ema_series_matches_the_detector_seed():
    closes = [float(10 + (i % 7)) for i in range(40)]
    s = display.ema_series(closes, 10)
    assert s[8] is None and s[9] == pytest.approx(sum(closes[:10]) / 10)
    from api.services.pattern_engine.detectors.uct.pullback_to_10ema import _ema
    assert s[-1] == pytest.approx(_ema(closes, 10))


# -- d. box extent capped to the consolidation -----------------------------------------------

def test_consolidation_extent_trims_the_run_up_and_the_breakdown():
    # 0-4 run-up (closes below the mid), 5-14 base (with a one-bar shakeout at 9), 15-17 breakdown.
    closes = [80, 84, 88, 91, 94, 99, 98, 100, 97, 93, 98, 99, 100, 98, 97, 92, 90, 88]
    bars = _bars(closes)
    ext = display.consolidation_extent(bars, ymd_t(0), ymd_t(17), 100.5, 79.5)
    # mid = 90: the first close >= 90 is bar 3, the last is bar 16
    assert (ext["start_t"], ext["end_t"]) == (ymd_t(3), ymd_t(16))
    assert ext["top"] == 100.5 and ext["floor"] == 89.5
    # a base pressing its top keeps its full span
    flat = _bars([99, 98, 100, 99, 98, 99, 100])
    ext = display.consolidation_extent(flat, ymd_t(0), ymd_t(6), 100.5, 97.5)
    assert (ext["start_t"], ext["end_t"]) == (ymd_t(0), ymd_t(6))


def test_consolidation_extent_unknown_span_or_empty_band_is_none():
    bars = _bars([10, 11, 12])
    assert display.consolidation_extent(bars, 1, ymd_t(2), 12.5, 9.5) is None
    assert display.consolidation_extent(bars, ymd_t(0), ymd_t(2), 100.0, 90.0) is None


def test_flat_base_draws_the_base_not_the_prior_advance():
    fired = _fired("flat_base")
    assert fired, "control: flat_base never fired on its fixtures"
    for bars, d in fired:
        a = d["geometry"]["anchors"]
        draw = d["geometry"]["extras"]["draw_anchors"]
        assert len(draw) == 2
        assert draw[0]["t"] >= a[1]["t"] and draw[1]["t"] <= a[3]["t"]
        assert min(p["price"] for p in draw) >= a[3]["price"] - 1e-9 > a[0]["price"]


def test_bc_flat_base_and_square_box_carry_a_capped_extent_others_do_not():
    closes = [80, 84, 88, 91, 94, 99, 98, 100, 97, 93, 98, 99, 100, 98, 97, 92, 90, 88]
    bars = _bars(closes)
    box = {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(17),
           "top": 100.5, "floor": 79.5, "pivot": 100.6}
    d = auto_structures.box_to_detection("ZZZ", box, bars)
    assert d["geometry"]["extras"]["draw_anchors"] == [
        {"t": ymd_t(3), "price": 100.5}, {"t": ymd_t(16), "price": 89.5}]
    # the served box numbers are base_catalog's, unchanged
    assert d["geometry"]["anchors"] == [{"t": ymd_t(0), "price": 100.5}, {"t": ymd_t(17), "price": 79.5}]
    assert d["levels"]["entry"] == 100.6
    sq = auto_structures.box_to_detection("ZZZ", {**box, "structure_key": "square-box"}, bars)
    assert "draw_anchors" in sq["geometry"]["extras"]
    cup = auto_structures.box_to_detection("ZZZ", {**box, "structure_key": "cup-with-handle"}, bars)
    assert "draw_anchors" not in cup["geometry"]["extras"]
    assert "draw_anchors" not in auto_structures.box_to_detection("ZZZ", box)["geometry"]["extras"]


def test_handle_extent_stops_at_the_first_close_above_the_lip():
    # handle bars 10-14 sit under the lip (100); bar 15 closes above it; 16-17 run on.
    closes = [90] * 10 + [97, 96, 95, 96, 98, 101, 104, 106]
    bars = _bars(closes)
    ext = display.handle_extent(bars, ymd_t(10), ymd_t(17), 100.0)
    assert (ext["start_t"], ext["end_t"]) == (ymd_t(10), ymd_t(14))
    assert ext["top"] == 98.5 and ext["floor"] == 94.5
    # no breakout: the whole handle stays
    assert display.handle_extent(bars, ymd_t(10), ymd_t(14), 100.0)["end_t"] == ymd_t(14)
    # broke out on the first handle bar: nothing to draw
    assert display.handle_extent(bars, ymd_t(15), ymd_t(17), 100.0) is None


def test_bc_cup_with_handle_draws_a_handle_capped_at_the_breakout():
    closes = [90] * 10 + [97, 96, 95, 96, 98, 101, 104, 106]
    bars = _bars(closes)
    box = {"structure_key": "cup-with-handle", "start_t": ymd_t(0), "end_t": ymd_t(17),
           "top": 100.0, "floor": 85.0, "pivot": 100.1,
           "sub_boxes": [{"start_t": ymd_t(0), "end_t": ymd_t(9), "top": 100.0, "floor": 85.0},
                         {"start_t": ymd_t(10), "end_t": ymd_t(17), "top": 106.5, "floor": 94.5}]}
    d = auto_structures.box_to_detection("ZZZ", box, bars)
    ex = d["geometry"]["extras"]
    assert ex["sub_boxes"] == box["sub_boxes"]          # served numbers unchanged
    assert ex["draw_sub_boxes"][0] == box["sub_boxes"][0]
    assert ex["draw_sub_boxes"][1] == {"start_t": ymd_t(10), "end_t": ymd_t(14),
                                       "top": 98.5, "floor": 94.5}
    gone = auto_structures.box_to_detection("ZZZ", {**box, "sub_boxes": [
        box["sub_boxes"][0], {**box["sub_boxes"][1], "start_t": ymd_t(15)}]}, bars)
    assert gone["geometry"]["extras"]["draw_sub_boxes"] == [box["sub_boxes"][0]]


# -- e. bull_flag: the pole, and no crossing / diverging / overlapping lanes -------------------

def _flag(conf, upper, lower, pole=(0, 4)):
    return {"pattern_id": "bull_flag", "confidence": conf,
            "pivot_ts": [ymd_t(pole[0]), ymd_t(pole[1]), ymd_t(11)],
            "geometry": {"shape": "trendline_pair",
                         "anchors": [{"t": ymd_t(upper[0][0]), "price": upper[0][1]},
                                     {"t": ymd_t(upper[1][0]), "price": upper[1][1]},
                                     {"t": ymd_t(lower[0][0]), "price": lower[0][1]},
                                     {"t": ymd_t(lower[1][0]), "price": lower[1][1]}],
                         "extras": {"line_spaces": ["price", "price"]}}}


def test_lane_verdict_parallel_crossing_diverging():
    bars = _bars([10 + i for i in range(12)])
    par = _flag(60, ((5, 20), (11, 19)), ((5, 18), (11, 17)))
    cross = _flag(60, ((5, 20), (11, 17)), ((5, 18), (11, 18)))
    div = _flag(60, ((5, 20), (11, 23)), ((5, 19), (11, 18)))
    assert display.lane_verdict(bars, par["geometry"]) == (True, None)
    assert display.lane_verdict(bars, cross["geometry"]) == (False, "crossing")
    assert display.lane_verdict(bars, div["geometry"]) == (False, "diverging")


def test_bull_flag_draws_its_pole_and_only_the_best_overlapping_lanes():
    lows = [10, 10.5, 12, 14, 15, 16, 15.5, 15.2, 15, 15.1, 15.2, 15.3]
    bars = _bars([lo + 0.5 for lo in lows], lows=lows, highs=[lo + 1 for lo in lows])
    best = _flag(70, ((5, 17), (11, 16.3)), ((5, 15.5), (11, 15)))
    worse = _flag(55, ((6, 16.5), (11, 16.3)), ((6, 15.5), (11, 15.1)), pole=(1, 5))
    display.draw_geometry([worse, best], bars)
    assert best["geometry"]["extras"]["draw_pole"] == [{"t": ymd_t(0), "price": 10.0},
                                                       {"t": ymd_t(4), "price": 16.0}]
    assert best["geometry"]["extras"]["draw_lanes"] is True
    assert worse["geometry"]["extras"]["draw_lanes"] is False
    assert worse["geometry"]["extras"]["lanes_reason"] == "overlapped"
    assert "draw_pole" in worse["geometry"]["extras"]


def test_bull_flag_on_its_fixtures_stamps_pole_and_lane_verdict():
    fired = _fired("bull_flag")
    assert fired, "control: bull_flag never fired on its fixtures"
    for bars, d in fired:
        ex = d["geometry"]["extras"]
        assert isinstance(ex["draw_lanes"], bool)
        pole = ex["draw_pole"]
        assert pole[0]["t"] < pole[1]["t"] and pole[0]["price"] < pole[1]["price"]


def test_a_broken_detection_never_breaks_annotate():
    bars = _bars([10, 11, 12])
    dets = [{"pattern_id": "double_bottom", "geometry": {"anchors": [{"t": "x"}]}},
            {"pattern_id": "bull_flag", "geometry": None}, None,
            {"pattern_id": "pullback_to_10ema", "pivot_ts": [ymd_t(1)], "geometry": {"anchors": []}}]
    display.annotate(dets, bars)
