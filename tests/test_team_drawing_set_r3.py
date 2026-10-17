"""Team drawing set, round 3 (lab REPORT_TEAM_SET_R2.md blind check, 2026-10-17): the display-only
fixes for what the round-2 judges named. Nothing here changes what any detector fires on, its
confidence, HIST_SCORE or `confirmed_only` -- every stamp lives under `geometry.extras` or in the
learned drawer's chart set. Synthetic bars only (public repo).

  1. bull_flag    the pole's top is the TRUE swing high between the pole start and the flag start.
  2. cup handle   a handle box only with >= 3 bars, at most a third of the cup, ending before the
                  rim's breakout bar; otherwise no box, the rim stays.
  3. bc:flat-base no stair-step (trending closes) and no deep V under the band.
  4. flat_base    the box spans the contiguous in-band run nearest the last bar.
  5. levels       unbroken swing-high resistance; one of the four above price when any exists; the
                  prior-day pair is deliberate (omitted with a reason, or drawn from the bar before a
                  forming last bar).
  6. trendlines   a line already broken by a close before the last bar is stale and not drawn.
"""
from __future__ import annotations

import copy
from datetime import datetime

import numpy as np

from api.services import auto_draw, auto_structures, barspack
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_auto_draw import _synthetic
from tests.test_drawing_geometry_v2 import _bars, _flag


# -- 1. bull_flag: the pole top on the true swing high ------------------------------------------

POLE_LOWS = [10, 10.5, 12, 14, 15]          # the detector's pole-top pivot is bar 4 (high 16)
PAUSE = [15, 14.8, 14.6, 14.5, 14.4, 14.3, 14.2]


def _pole_bars(flag_lows, spike=17.0):
    lows = POLE_LOWS + list(flag_lows)
    highs = [lo + 1 for lo in lows]
    highs[2] = spike                          # an EARLIER, higher high inside the pole
    return _bars([lo + 0.5 for lo in lows], lows=lows, highs=highs)


def test_the_pole_top_is_the_highest_high_between_pole_start_and_flag_start():
    bars = _pole_bars(PAUSE)
    d = _flag(70, ((5, 16.0), (11, 15.2)), ((5, 15.0), (11, 14.2)))
    before = copy.deepcopy({k: d.get(k) for k in ("confidence", "pivot_ts", "levels")})
    display.draw_geometry([d], bars)
    pole = d["geometry"]["extras"]["draw_pole"]
    assert pole[1] == {"t": ymd_t(2), "price": 17.0}, pole    # not the lower, later bar 4 (16)
    assert pole[0] == {"t": ymd_t(0), "price": 10.0}
    assert {k: d.get(k) for k in before} == before            # display-only
    # control: when the pivot IS the highest high, the pole is unchanged
    d2 = _flag(70, ((5, 16.0), (11, 15.2)), ((5, 15.0), (11, 14.2)))
    display.draw_geometry([d2], _pole_bars(PAUSE, spike=13.0))
    assert d2["geometry"]["extras"]["draw_pole"][1] == {"t": ymd_t(4), "price": 16.0}


def test_pole_top_index_ties_keep_the_earliest_bar():
    bars = _bars([10, 11, 12, 11, 12], highs=[10.5, 13, 12.5, 13, 12.5])
    assert display.pole_top_index(bars, 0, 4) == 1
    assert display.pole_top_index(bars, 2, 4) == 3


def test_the_pause_verdict_reads_the_same_true_pole_high():
    # flag bars reach 16.5: above the lower pivot (16) but under the true pole high (17) -> a pause
    lows = [15.5, 15.2, 15.0, 14.8, 14.6, 14.4, 14.2]
    d = _flag(70, ((5, 16.5), (11, 15.2)), ((5, 15.5), (11, 14.2)))
    display.draw_geometry([d], _pole_bars(lows))
    assert not d["geometry"]["extras"].get("stale"), d["geometry"]["extras"]
    # control: without the higher spike the same flag runs past the pole high
    d2 = _flag(70, ((5, 16.5), (11, 15.2)), ((5, 15.5), (11, 14.2)))
    display.draw_geometry([d2], _pole_bars(lows, spike=13.0))
    assert d2["geometry"]["extras"]["stale_reason"] == "past_pole_high"


# -- 2. cup handle box -------------------------------------------------------------------------

CUP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 99, 99]  # 20 bars


def _cup_bars(handle, tail=()):
    closes = CUP + list(handle) + list(tail)
    return _bars(closes)


def test_handle_verdict_short_long_after_breakout_and_ok():
    bars = _cup_bars([98, 97.5, 97, 97.5, 98, 97, 97.5, 98], tail=[101, 102])   # 30 bars
    cs, ce = ymd_t(0), ymd_t(19)
    rim = {"start_t": ymd_t(0), "end_t": ymd_t(28), "price": 100.5}           # close 101 at 28 > rim
    h = lambda a, b: {"start_t": ymd_t(a), "end_t": ymd_t(b)}                  # noqa: E731
    assert display.handle_verdict(bars, h(20, 21), cs, ce, rim) == (False, "short")
    assert display.handle_verdict(bars, h(20, 27), cs, ce, rim) == (False, "long")  # 8 > 20/3
    assert display.handle_verdict(bars, h(23, 28), cs, ce, rim) == (False, "after_breakout")
    assert display.handle_verdict(bars, h(20, 23), cs, ce, rim) == (True, None)
    # a rim that never broke out (its end bar closes under it) does not bound the handle
    open_rim = {**rim, "end_t": ymd_t(27)}
    assert display.handle_verdict(bars, h(22, 27), cs, ce, open_rim)[1] != "after_breakout"
    assert display.handle_verdict(bars, h(20, 22), cs, ce, open_rim) == (True, None)


def _cup_box(handle_end):
    return {"structure_key": "cup-with-handle", "start_t": ymd_t(0), "end_t": ymd_t(handle_end),
            "top": 100.5, "floor": 85.5, "pivot": 100.5,
            "sub_boxes": [{"start_t": ymd_t(0), "end_t": ymd_t(19), "top": 100.5, "floor": 85.5},
                          {"start_t": ymd_t(20), "end_t": ymd_t(handle_end), "top": 98.5,
                           "floor": 96.5}]}


def test_a_one_bar_handle_draws_no_box_but_keeps_the_rim():
    bars = _cup_bars([98])
    ex = auto_structures.box_to_detection("ZZZ", _cup_box(20), bars)["geometry"]["extras"]
    assert not ex.get("stale")
    assert ex["draw_pivot"]["price"] == 100.5             # the rim stays
    assert "draw_handle" not in ex and ex["handle_reason"] == "short"
    # control: a four-bar handle is drawn
    bars4 = _cup_bars([98, 97.5, 97, 97.5])
    ex4 = auto_structures.box_to_detection("ZZZ", _cup_box(23), bars4)["geometry"]["extras"]
    assert ex4["draw_handle"]["start_t"] == ymd_t(20) and ex4["draw_handle"]["end_t"] == ymd_t(23)


# -- 3. bc:flat-base: no stair-step, no deep V ----------------------------------------------------

def _flat_box(n, top, floor, pivot):
    return {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(n - 1),
            "top": top, "floor": floor, "pivot": pivot}


def test_a_stair_step_climb_is_not_a_flat_base():
    closes = [90 + 0.33 * i for i in range(31)]                     # trends ~0.33 ATR / bar
    ex = auto_structures.box_to_detection(
        "ZZZ", _flat_box(31, closes[-1] + 0.5, 89.5, closes[-1] + 0.2), _bars(closes))["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "stair_step", ex
    assert "draw_pivot" not in ex
    # control: a flat base of the same length draws its pivot
    flat = [99 + (i % 2) for i in range(31)]
    ok = auto_structures.box_to_detection("ZZZ", _flat_box(31, 100.5, 97.5, 100.6), _bars(flat))
    assert ok["geometry"]["extras"]["draw_pivot"]["price"] == 100.6


def test_a_deep_v_under_the_band_is_not_a_flat_base():
    flat = [99 + (i % 2) for i in range(16)]
    v = [97, 94, 91, 90, 91, 94, 97]
    closes = flat + v + flat
    ex = auto_structures.box_to_detection(
        "ZZZ", _flat_box(len(closes), 100.5, 89.5, 100.6), _bars(closes))["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "deep_v", ex
    assert "draw_pivot" not in ex


def test_flat_shape_verdict_thresholds():
    flat = _bars([99 + (i % 2) for i in range(30)])
    s, e = ymd_t(0), ymd_t(29)
    assert display.flat_shape_verdict(flat, s, e, 100.6) == (True, None)
    assert display.flat_shape_verdict(flat, s, e, None) == (True, None)          # unknown: draw
    assert display.flat_shape_verdict(flat, s, 99999999, 100.6) == (True, None)


# -- 4. flat_base box: the contiguous in-band run nearest the last bar ----------------------------

def _flat_base_det(n, high):
    return {"pattern_id": "flat_base", "start_t": ymd_t(0), "end_t": ymd_t(n - 1), "confidence": 70,
            "levels": {"entry": high + 0.1},
            "geometry": {"shape": "rectangle", "extras": {},
                         "anchors": [{"t": ymd_t(0), "price": 80.0}, {"t": ymd_t(0), "price": high},
                                     {"t": ymd_t(n - 1), "price": high},
                                     {"t": ymd_t(n - 1), "price": 89.5}]}}


def test_the_flat_base_box_is_the_last_contiguous_run_in_the_band():
    # a range, a deep drop out of the band, then the recovery range that is the live base
    closes = [99 + (i % 2) for i in range(10)] + [90] * 5 + [99 + (i % 2) for i in range(15)]
    d = _flat_base_det(len(closes), 100.5)
    before = copy.deepcopy({k: d.get(k) for k in ("confidence", "levels", "start_t", "end_t")})
    display.draw_geometry([d], _bars(closes))
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_anchors"][0]["t"] == ymd_t(15), ex["draw_anchors"]      # not bar 0
    assert ex["draw_anchors"][1]["t"] == ymd_t(29)
    assert ex["draw_pivot"]["start_t"] == ymd_t(15)
    assert ex["draw_anchors"][1]["price"] == 98.5                          # floor of the run only
    assert {k: d.get(k) for k in before} == before
    # control: with no drop the run is the whole base
    d2 = _flat_base_det(30, 100.5)
    display.draw_geometry([d2], _bars([99 + (i % 2) for i in range(30)]))
    assert d2["geometry"]["extras"]["draw_anchors"][0]["t"] == ymd_t(0)


def test_band_run_extent_ends_at_a_breakout_bar():
    closes = [99 + (i % 2) for i in range(20)] + [102]
    bars = _bars(closes)
    ext = display.consolidation_extent(bars, ymd_t(0), ymd_t(20), 100.5, 98.5)
    assert ext["break"] == "breakout"
    run = display.band_run_extent(bars, ext, ymd_t(0), ymd_t(20), 100.5)
    assert run["end_t"] == ymd_t(20) and run["break"] == "breakout"
    assert run["top"] == 100.5                                    # the breakout bar is not the base


# -- 5. learned levels -----------------------------------------------------------------------------

def _rows(closes, highs=None):
    out = []
    for k, c in enumerate(closes):
        h = highs[k] if highs else c + 0.5
        out.append((ymd_t(k), c, h, c - 0.5, c, 1e6))
    return out


def test_swing_high_resistance_keeps_unbroken_pivots_above_price():
    n = 60
    closes = [100.0] * n
    highs = [100.5] * n
    highs[10] = 120.0                       # an older swing high, never closed above -> kept
    highs[30] = 110.0                       # a swing high closed through at bar 40 -> broken
    closes[40] = 112.0
    highs[40] = 112.5
    highs[50] = 99.0                        # (not a pivot -- equal neighbours either side)
    a = auto_draw.as_arrays(_rows(closes, highs))
    got = auto_draw.swing_high_resistance(a, n - 1)
    prices = [g["price"] for g in got]
    assert 120.0 in prices
    assert 110.0 not in prices
    assert all(p > closes[-1] for p in prices)


def test_the_four_nearest_keep_one_above_price_when_any_exists():
    close = 100.0
    below = [{"price": p} for p in (99.5, 99.0, 98.5, 98.0, 97.5)]
    above = {"price": 108.0}
    out = auto_draw._cap_nearest(below + [above], close, 4)
    assert len(out) == 4 and above in out
    dists = [abs(h["price"] - close) for h in out]
    assert dists == sorted(dists)
    # control: nothing above -> plain four nearest
    assert auto_draw._cap_nearest(below, close, 4) == below[:4]


def test_swing_high_resistance_reaches_the_drawn_set_and_one_level_sits_above_price():
    seen_swing = 0
    for seed in range(1, 41):
        bars = _synthetic(seed)
        d = auto_draw.drawn_set(bars)
        hs = d["horizontals"]
        seen_swing += any(h["source"] == "swing_high" for h in hs)
        a = auto_draw.as_arrays(bars)
        cands = [s["price"] for s in auto_draw.swing_high_resistance(a, len(a) - 1)]
        if cands:
            assert any(h["price"] > d["last_close"] for h in hs), (seed, hs)
    assert seen_swing, "control: no swing-high resistance level ever reached the chart"


def test_the_prior_day_pair_is_deliberate_omitted_or_drawn_from_the_bar_before():
    drawn_from_forming = 0
    for seed in range(1, 41):
        bars = _synthetic(seed)
        done = auto_draw.drawn_set(bars)
        assert not any(h["source"].startswith("prior_day") for h in done["horizontals"])
        assert done["omitted"] == [
            {"source": "prior_day_high", "reason": auto_draw.PRIOR_DAY_IS_LAST_BAR},
            {"source": "prior_day_low", "reason": auto_draw.PRIOR_DAY_IS_LAST_BAR}]
        live = auto_draw.drawn_set(bars, last_bar_forming=True)
        assert live["omitted"] == [] and live["last_bar_forming"] is True
        prev = bars[-2]
        for h in live["horizontals"]:
            if h["source"] == "prior_day_high":
                assert h["price"] == round(prev[2], 4) and h["t_from"] == prev[0]
            if h["source"] == "prior_day_low":
                assert h["price"] == round(prev[3], 4) and h["t_from"] == prev[0]
        drawn_from_forming += any(h["source"].startswith("prior_day") for h in live["horizontals"])
    assert drawn_from_forming, "control: a forming last bar never let the prior day onto the chart"


def _et(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=barspack._ET)


def test_last_bar_forming_reads_the_session_clock():
    # 2026-08-18 is a Tuesday
    assert auto_structures.last_bar_forming(20260818, _et(2026, 8, 18, 14, 0)) is True
    assert auto_structures.last_bar_forming(20260818, _et(2026, 8, 18, 17, 0)) is False
    assert auto_structures.last_bar_forming(20260817, _et(2026, 8, 18, 14, 0)) is False


# -- 6. learned trendlines: no stale (already broken) line -----------------------------------------

def test_broken_before_last_ignores_a_break_on_the_last_bar():
    a = np.array([[ymd_t(k), 10, 10.5, 9.5, 10.0, 1] for k in range(12)], dtype=float)
    # flat resistance at 10.2 through anchors 0 and 4
    assert auto_draw._broken_before_last(a, 11, 1.0, 0, 4, 10.2, 0.0, 1) is False
    a[11, 4] = 11.0                              # the break is the last bar itself: news, kept
    assert auto_draw._broken_before_last(a, 11, 1.0, 0, 4, 10.2, 0.0, 1) is False
    a[8, 4] = 11.0                               # an earlier close through it: stale
    assert auto_draw._broken_before_last(a, 11, 1.0, 0, 4, 10.2, 0.0, 1) is True
    # support side mirrors it
    b = np.array([[ymd_t(k), 10, 10.5, 9.5, 10.0, 1] for k in range(12)], dtype=float)
    b[7, 4] = 9.0
    assert auto_draw._broken_before_last(b, 11, 1.0, 0, 4, 9.8, 0.0, 0) is True


def _stale(a, at, tl):
    idx = {int(a[j, 0]): j for j in range(len(a))}
    ja, jb = idx[tl["t1"]], idx[tl["t2"]]
    slope = (tl["p2"] - tl["p1"]) / (jb - ja)
    return auto_draw._broken_before_last(a, len(a) - 1, at, ja, jb, tl["p1"], slope, tl["is_high"])


def test_drawn_trendlines_are_never_stale():
    raw_stale = drew = 0
    for seed in range(1, 41):
        bars = _synthetic(seed)
        d = auto_draw.drawn_set(bars)
        a = auto_draw.as_arrays(bars)
        at = auto_draw.atr(a, len(a) - 1)
        assert not any(_stale(a, at, tl) for tl in d["trendlines"]), seed
        drew += len(d["trendlines"])
        raw = [{**r["coords"], "is_high": r["is_high"]}
               for r in auto_draw.propose(bars, k=auto_draw.DRAWN_TL_POOL, kinds=("trendline",))]
        raw_stale += any(_stale(a, at, tl) for tl in raw)
    assert drew, "control: the filter drew no trendline at all"
    assert raw_stale, "control: the raw ranking never offered a stale line; the fixture cannot distinguish"
