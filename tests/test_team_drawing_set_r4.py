"""Team drawing set, round 4 (lab REPORT_TEAM_SET_R3.md blind check, 2026-10-17): the display-only
fixes for what the round-3 judges named. Nothing here changes what any detector fires on, its
confidence, levels, HIST_SCORE or `confirmed_only` -- every stamp lives under `geometry.extras` or
in the learned drawer's chart set. Synthetic bars only (public repo).

  1. flat_base     the box spans the FULL base (a band run ending near the last bar, up to
                   FLAT_RUN_GAP_BARS closes outside the band, never narrower than the detector's
                   base); the line is never set by the breakout bar; a line broken by a close
                   before the last bar is stale; the bc:flat-base shape / range rules apply too.
  2. bc:flat-base  the line on the base's top cluster, not one spike wick; no wide choppy range;
                   no recovery from a deep decline.
  3. cup           a handle at most a third of the cup's depth, in its upper half; no gap-island
                   cup; no rim already broken by a close before the last bar.
  4. bull_flag     a fast pole (>= POLE_MIN_ATR ATR in <= POLE_MAX_BARS bars), a flag of at least
                   FLAG_MIN_BARS bars, a midline that does not rise.
  5. levels        major swing levels rank ahead of micro levels; the nearest major swing high
                   above price is drawn whenever one exists within MAJOR_SWING_LOOKBACK bars.
  6. trendlines    no line gapped away from price, no support line across a crash, at least
                   TL_MIN_TOUCHES touches.
  7. MA pullback   no tag on a flat / rolling-over MA, none on a tag bar that never reached it.
"""
from __future__ import annotations

import copy

import numpy as np

from api.services import auto_draw, auto_structures
from api.services.pattern_engine import display
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from tests.detector_fixtures import ymd_t
from tests.test_auto_draw import _synthetic
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r3 import _cup_bars, _cup_box

FROZEN = ("confidence", "levels", "start_t", "end_t", "pivot_ts")


def _frozen(d):
    return copy.deepcopy({k: d.get(k) for k in FROZEN})


# -- 1. flat_base -----------------------------------------------------------------------------------

def _flat_det(closes, s, e=None, base_bars=None, highs=None, lows=None):
    """A flat_base detection whose detector base is [s, e] (default: to the last bar)."""
    bars = _bars(closes, lows=lows, highs=highs)
    e = len(closes) - 1 if e is None else e
    hi = max(b["h"] for b in bars[s:e + 1])
    lo = min(b["l"] for b in bars[s:e + 1])
    d = {"pattern_id": "flat_base", "start_t": ymd_t(0), "end_t": ymd_t(len(closes) - 1),
         "confidence": 70, "levels": {"entry": round(hi * 1.001, 2)}, "pivot_ts": [ymd_t(0), ymd_t(s)],
         "geometry": {"shape": "rectangle",
                      "extras": {"base_bars": base_bars or (e - s + 1)},
                      "anchors": [{"t": ymd_t(0), "price": 80.0}, {"t": ymd_t(s), "price": hi},
                                  {"t": ymd_t(e), "price": hi}, {"t": ymd_t(e), "price": lo}]}}
    return d, bars


def _base(n, start=0):
    """n alternating 99 / 100 closes ENDING on 100 (ATR(14) = 1.5, the base's top 100.5)."""
    return [100.0 if (n - 1 - k) % 2 == 0 else 99.0 for k in range(n)]


RUNUP = [85.0, 88.0, 91.0, 94.0, 97.0]                      # bars 0-4, below the band


def test_the_flat_base_box_spans_the_full_base_through_two_dips():
    closes = RUNUP + _base(30, 5)                          # base bars 5..34
    closes[12] = closes[13] = 95.0                         # two closes OUT of the band
    d, bars = _flat_det(closes, 20)                        # the detector's window: 20..34
    before = _frozen(d)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    box = ex["draw_anchors"]
    # left of the dips: the whole base. The run reaches bar 5, but bar 5 closes in the base's LOWER
    # half (99 < 99.5) left of the detector's window, so the box starts on bar 6 -- never on the
    # run-up into the base (bars 0-4)
    assert box[0]["t"] == ymd_t(6), box
    assert box[1]["t"] == ymd_t(34)
    assert ex["draw_pivot"] == {"start_t": box[0]["t"], "end_t": ymd_t(34), "price": 100.5}
    assert _frozen(d) == before                            # display-only
    # control: a THIRD close out of the band ends the run (the tolerance is exactly two)
    closes3 = list(closes)
    closes3[14] = 95.0
    d3, bars3 = _flat_det(closes3, 20)
    display.draw_geometry([d3], bars3)
    assert d3["geometry"]["extras"]["draw_anchors"][0]["t"] >= ymd_t(15)


def test_the_flat_base_box_is_never_narrower_than_the_detectors_base():
    closes = RUNUP + _base(30, 5)
    closes[30] = closes[31] = closes[32] = 95.0            # three dips right before the end
    d, bars = _flat_det(closes, 15, base_bars=20)          # the detector's base: 20 bars
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    # the band run alone is 2 bars (33-34); the box still spans the detector's 20 bars
    assert ex["draw_anchors"][0]["t"] == ymd_t(15), ex["draw_anchors"]
    assert ex["draw_anchors"][1]["t"] == ymd_t(34)


def test_the_flat_base_line_is_never_the_breakout_bars_high():
    closes = RUNUP + _base(25, 5) + [103.0]                # the last bar breaks out
    highs = [c + 0.5 for c in closes]
    highs[-1] = 104.0
    d, bars = _flat_det(closes, 10, highs=highs)           # the detector's base high includes it
    assert d["geometry"]["anchors"][1]["price"] == 104.0
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 100.5              # the base's top, not 104
    assert ex["draw_anchors"][0]["price"] == 100.5         # the box top too
    assert ex["draw_anchors"][1]["t"] == ymd_t(30)         # the box ends AT the breakout bar
    # a spike wick inside the base does not set the line either
    closes2 = RUNUP + _base(25, 5)
    highs2 = [c + 0.5 for c in closes2]
    highs2[20] = 102.5
    d2, bars2 = _flat_det(closes2, 10, highs=highs2)
    display.draw_geometry([d2], bars2)
    assert d2["geometry"]["extras"]["draw_pivot"]["price"] == 100.5


def test_a_flat_base_line_broken_before_the_last_bar_is_stale():
    closes = RUNUP + _base(25, 5) + [103.0, 100.0]         # broke out, then the last bar is back in
    d, bars = _flat_det(closes, 10, e=29)                  # the detector's base ended at bar 29
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "broken", ex
    assert "draw_pivot" not in ex
    # control: the same close above the line ON the last bar is the news, drawn
    d2, bars2 = _flat_det(RUNUP + _base(25, 5) + [103.0], 10)
    display.draw_geometry([d2], bars2)
    assert not d2["geometry"]["extras"].get("stale")
    # and a base that already left the band below (no in-band close near the end): left_band
    d3, bars3 = _flat_det(RUNUP + _base(25, 5) + [96.0] * 4, 10)
    display.draw_geometry([d3], bars3)
    assert d3["geometry"]["extras"].get("stale_reason") in {"left_band", "broke_down"}


def test_flat_base_box_reports_the_line_and_the_break():
    closes = RUNUP + _base(25, 5) + [103.0]
    bars = _bars(closes)
    box, why = display.flat_base_box(bars, ymd_t(10), ymd_t(30), 21, 98.5)
    assert why is None and box["price"] == box["top"] == 100.5 and box["break"] == "breakout"
    assert box["floor"] == 98.5
    assert display.flat_base_box(bars, 99999999, ymd_t(30)) == (None, "unknown")


def test_the_flat_base_takes_the_bc_flat_base_shape_rules():
    # a staircase, ~0.27 ATR per bar (round 5: its last 3 bars pause, so its high is not in its last
    # 3 bars and the round-5 still_rising rule does not answer first)
    stairs = RUNUP + [97.0 + 0.4 * k for k in range(27)] + [106.8, 106.6, 106.7]
    d, bars = _flat_det(stairs, 10)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "stair_step", ex
    # control: the flat base of the same length draws
    d2, bars2 = _flat_det(RUNUP + _base(30, 5), 10)
    display.draw_geometry([d2], bars2)
    assert "draw_pivot" in d2["geometry"]["extras"]


# -- 2. bc:flat-base ---------------------------------------------------------------------------------

def _bc_flat(n, top, pivot=None):
    return {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(n - 1),
            "top": top, "floor": 89.5, "pivot": pivot}


def test_robust_top_is_the_top_cluster_not_one_wick():
    bars = _bars(_base(30), highs=[100.5] * 30)
    assert display.robust_top(bars, 0, 29, 1.5) == 100.5
    spiky = [100.5] * 30
    spiky[12] = 103.0                                       # one failed-breakout wick
    bars2 = _bars(_base(30), highs=spiky)
    assert display.robust_top(bars2, 0, 29, 1.5) == 100.5
    # two wicks together ARE the top
    spiky[20] = 102.9
    assert display.robust_top(_bars(_base(30), highs=spiky), 0, 29, 1.5) == 103.0
    assert display.robust_top(bars, 0, 29, None) == 100.5    # ATR unknown: the highest high
    assert display.robust_top(bars, 5, 4, 1.5) is None


def test_the_bc_flat_base_line_sits_on_the_flat_top_not_a_spike():
    closes = RUNUP + _base(30, 5)
    highs = [c + 0.5 for c in closes]
    highs[20] = 103.0                                       # a failed-breakout spike
    bars = _bars(closes, highs=highs)
    box = _bc_flat(len(closes), 103.0, 103.1)
    d = auto_structures.box_to_detection("ZZZ", box, bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 100.5
    assert d["levels"]["entry"] == 103.1                    # base_catalog's numbers, unchanged


def test_flat_range_verdict_wide_range_and_deep_decline():
    flat = _bars(_base(40))                                 # ATR 1.5; range 2.0 = 1.3 ATR
    s, e = ymd_t(0), ymd_t(39)
    assert display.flat_range_verdict(flat, s, e, 100.5) == (True, None)
    wide = [100.5] * 40
    wide[10] = 108.0                                        # a 9.5-point range: > 4.8 ATR
    assert display.flat_range_verdict(_bars(_base(40), highs=wide), s, e, 100.5) == (False, "wide_range")
    # a base 20% under the high of the bars before it: a recovery, not a base near the highs
    peak = [125.0] * 5 + [124.0 - k for k in range(24)]      # bars 0-28: the peak, then the fall
    bars = _bars(peak + _base(40))
    assert display.flat_range_verdict(bars, ymd_t(29), ymd_t(68), 100.5) == (False, "deep_decline")
    assert display.flat_range_verdict(flat, s, 99999999, 100.5) == (True, None)


def test_a_wide_or_deep_bc_flat_base_is_stale():
    closes = RUNUP + _base(30, 5)
    highs = [c + 0.5 for c in closes]
    highs[20] = 109.0
    ex = auto_structures.box_to_detection(
        "ZZZ", _bc_flat(len(closes), 109.0, 109.1), _bars(closes, highs=highs))["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "wide_range", ex
    deep = [125.0] * 5 + [124.0 - k for k in range(24)] + _base(40)
    box = {"structure_key": "flat-base", "start_t": ymd_t(29), "end_t": ymd_t(len(deep) - 1),
           "top": 100.5, "floor": 98.5, "pivot": 100.6}
    ex2 = auto_structures.box_to_detection("ZZZ", box, _bars(deep))["geometry"]["extras"]
    assert ex2["stale"] is True and ex2["stale_reason"] == "deep_decline", ex2
    # control: the same base after an advance (no higher high before it) draws
    up = [70.0 + k for k in range(29)] + _base(40)
    ok = auto_structures.box_to_detection("ZZZ", box, _bars(up))["geometry"]["extras"]
    assert not ok.get("stale") and ok["draw_pivot"]["price"] == 100.5, ok


# -- 3. cup ------------------------------------------------------------------------------------------

def test_a_deep_handle_draws_no_box_but_keeps_the_rim():
    # round 6 (tests/test_cup_r6.py): "deep" is now a floor in the cup's LOWER half (under 91.5 here);
    # round 4's "more than a third of the cup's depth" (the 93.5 floor this test used) draws
    bars = _cup_bars([98, 94, 90, 91])                      # floor 89.5: under the cup's midpoint
    ex = auto_structures.box_to_detection("ZZZ", _cup_box(23), bars)["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_pivot"]["price"] == 100.5
    assert "draw_handle" not in ex and ex["handle_reason"] == "deep"
    # control: a shallow handle is drawn
    ok = auto_structures.box_to_detection("ZZZ", _cup_box(23), _cup_bars([98, 97.5, 97, 97.5]))
    assert "draw_handle" in ok["geometry"]["extras"]


# round 6: handle_verdict (and this rail of its round-4 depth rule) was replaced by
# display.pullback_handle -- tests/test_cup_r6.py::test_a_handle_floored_in_the_cups_lower_half_is_deep.


ISLAND = [100, 100, 100, 90, 89, 88, 89, 90, 100, 100, 99, 99]     # gap down at 3, gap up at 8


def _island_box():
    return {"structure_key": "cup-with-handle", "start_t": ymd_t(0), "end_t": ymd_t(15),
            "top": 100.5, "floor": 87.5, "pivot": 100.5,
            "sub_boxes": [{"start_t": ymd_t(0), "end_t": ymd_t(11), "top": 100.5, "floor": 87.5},
                          {"start_t": ymd_t(12), "end_t": ymd_t(15), "top": 99.5, "floor": 97.5}]}


def test_a_gap_island_cup_is_stale():
    closes = ISLAND + [99, 98.5, 98, 98.5]
    bars = _bars(closes)
    assert display.gap_island(bars, 0, 11) is True
    ex = auto_structures.box_to_detection("ZZZ", _island_box(), bars)["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "gap_island", ex
    # control: the same closes with overlapping bars (no gaps) are a cup, not an island
    bars2 = _bars(closes, lows=[c - 11.0 for c in closes])
    assert display.gap_island(bars2, 0, 11) is False
    ex2 = auto_structures.box_to_detection("ZZZ", _island_box(), bars2)["geometry"]["extras"]
    assert ex2.get("stale_reason") != "gap_island"
    # a gap down that the price later fills from below, bar by bar, is not an island either
    filled = [100, 100, 90] + [91.0 + k for k in range(10)]
    assert display.gap_island(_bars(filled), 0, 12) is False


def test_a_rim_broken_before_the_last_bar_is_stale():
    bars = _cup_bars([99, 101, 102, 103])                   # closed above the rim (100.5) at 21
    ex = auto_structures.box_to_detection("ZZZ", _cup_box(23), bars)["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "rim_broken", ex
    # control: the break ON the last bar is the news, kept
    ok = auto_structures.box_to_detection("ZZZ", _cup_box(23), _cup_bars([99, 98.5, 99, 101]))
    assert not ok["geometry"]["extras"].get("stale"), ok["geometry"]["extras"]
    rim = {"start_t": ymd_t(0), "end_t": ymd_t(23), "price": 100.5}
    assert display.cup_shape_verdict(bars, ymd_t(0), ymd_t(19), rim) == (False, "rim_broken")
    assert display.cup_shape_verdict(bars, None, ymd_t(19), rim) == (True, None)


# -- 4. bull_flag ------------------------------------------------------------------------------------

PRE = [10.0] * 15                                           # bars 0-14: ATR(14) = 1.0


def _flag_det(closes, b0, b1, upper, lower, conf=70):
    return {"pattern_id": "bull_flag", "confidence": conf,
            "levels": {"entry": 17.6}, "start_t": ymd_t(b0), "end_t": ymd_t(len(closes) - 1),
            "pivot_ts": [ymd_t(b0), ymd_t(b1), ymd_t(len(closes) - 1)],
            "geometry": {"shape": "trendline_pair",
                         "anchors": [{"t": ymd_t(upper[0][0]), "price": upper[0][1]},
                                     {"t": ymd_t(upper[1][0]), "price": upper[1][1]},
                                     {"t": ymd_t(lower[0][0]), "price": lower[0][1]},
                                     {"t": ymd_t(lower[1][0]), "price": lower[1][1]}],
                         "extras": {"line_spaces": ["price", "price"]}}}


FAST_POLE = [11.0, 13.0, 15.0, 17.0]                        # bars 15-18: 8 ATR in 4 bars
FLAG = [17.0, 16.8, 16.6, 16.4, 16.2, 16.0]                 # bars 19-24


def _drawn(closes, b1, upper, lower):
    d = _flag_det(closes, 14, b1, upper, lower)
    before = _frozen(d)
    display.draw_geometry([d], _bars(closes))
    assert _frozen(d) == before                             # display-only
    return d["geometry"]["extras"]


def test_a_fast_pole_flag_draws():
    ex = _drawn(PRE + FAST_POLE + FLAG, 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5)))
    assert not ex.get("stale"), ex
    assert ex["draw_pole"][1]["price"] == 17.5


def test_a_slow_grind_is_not_a_pole():
    slow = [10.5, 11.0, 11.5, 12.0, 12.5, 13.0]             # 4 ATR in 6 bars (< POLE_MIN_ATR)
    flag = [13.0, 12.9, 12.8, 12.7, 12.6, 12.5]
    closes = PRE + slow + flag                               # pole top bar 20, flag 21-26
    ex = _drawn(closes, 20, ((21, 13.5), (26, 13.0)), ((21, 12.5), (26, 12.0)))
    assert ex["stale"] is True and ex["stale_reason"] == "slow_pole", ex
    # and a pole slower than POLE_MAX_BARS bars, however tall, is a grind too
    grind = [10.0 + 0.5 * (k + 1) for k in range(display.POLE_MAX_BARS + 2)]
    top = grind[-1]
    closes2 = PRE + grind + [top - 0.1 * k for k in range(6)]
    b1 = 14 + len(grind)
    ex2 = _drawn(closes2, b1, ((b1 + 1, top + 0.5), (b1 + 6, top)), ((b1 + 1, top - 0.6), (b1 + 6, top - 1.1)))
    assert ex2["stale"] is True and ex2["stale_reason"] == "slow_pole", ex2


def test_a_flag_needs_four_bars():
    closes = PRE + FAST_POLE + FLAG[:3]                      # a 3-bar flag
    ex = _drawn(closes, 18, ((19, 17.5), (21, 17.1)), ((19, 16.5), (21, 16.1)))
    assert ex["stale"] is True and ex["stale_reason"] == "short_flag", ex


def test_a_rising_flag_midline_is_not_a_flag():
    rising = [16.5, 16.55, 16.6, 16.65, 16.7, 16.7]
    # midline +0.2 over the flag: under round 2's 10% of the pole (0.8), over round 4's zero
    ex = _drawn(PRE + FAST_POLE + rising, 18, ((19, 17.0), (24, 17.2)), ((19, 16.0), (24, 16.2)))
    assert ex["stale"] is True and ex["stale_reason"] == "rising_flag", ex
    # control: the flat channel draws
    flat = _drawn(PRE + FAST_POLE + rising, 18, ((19, 17.2), (24, 17.2)), ((19, 16.0), (24, 16.0)))
    assert not flat.get("stale"), flat


def test_flag_shape_verdict_unknown_is_drawn():
    d = _flag_det(PRE + FAST_POLE + FLAG, 14, 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5)))
    d["pivot_ts"] = [99999999]
    assert display.flag_shape_verdict(_bars(PRE + FAST_POLE + FLAG), {}, d) == (True, None)


# -- 5. learned levels ---------------------------------------------------------------------------------

def _major_rows():
    """300 bars: an advance to a major swing high (130) at bar 80 -- 219 bars back, outside the
    120-bar swing-high window -- a decline, then a long tight range around 100 to the last bar."""
    closes = [100.0 + 29.5 * k / 80 for k in range(80)] + [129.5]
    closes += [129.0 - 29.0 * k / 60 for k in range(1, 61)]
    closes += [99.6 if k % 2 else 100.4 for k in range(300 - len(closes))]
    rows = []
    for k, c in enumerate(closes):
        h = 130.0 if k == 80 else c + 0.5
        rows.append((ymd_t(k), c, h, c - 0.5, c, 1e6))
    return rows


def test_the_major_swing_high_overhead_is_drawn():
    rows = _major_rows()
    a = auto_draw.as_arrays(rows)
    assert auto_draw.swing_high_resistance(a, len(a) - 1) == []        # round 3 could not see it
    d = auto_draw.drawn_set(rows)
    major = [h for h in d["horizontals"] if h["source"] == "major_swing_high"]
    assert major == [{"source": "major_swing_high", "label": "swing H", "price": 130.0,
                      "t_from": ymd_t(80), "score": None}], d["horizontals"]
    assert len(d["horizontals"]) <= auto_draw.DRAWN_HORIZONTALS


def test_major_swings_are_unbroken_and_beyond_the_close():
    rows = _major_rows()
    a = auto_draw.as_arrays(rows)
    i = len(a) - 1
    assert [r["price"] for r in auto_draw.major_swings(a, i, True)] == [130.0]
    # a close above it since breaks it
    a2 = a.copy()
    a2[200, 2], a2[200, 4] = 131.5, 131.0
    assert 130.0 not in [r["price"] for r in auto_draw.major_swings(a2, i, True)]
    # outside the lookback it is not a candidate
    assert auto_draw.major_swings(a, i, True, lookback=200) == []
    # a dip with higher lows on both sides is a major swing low below the close
    a3 = a.copy()
    a3[250, 3], a3[250, 4] = 95.5, 96.0
    assert auto_draw.major_swings(a3, i, False) == [{"price": 95.5, "j": 250}]
    assert auto_draw.major_swings(a, i, False) == []       # control: the even range has none


def test_micro_levels_rank_after_structural_ones():
    close, at, micro_from = 100.0, 1.0, 97
    lvl = lambda p, j: {"price": p, "_j": j}                    # noqa: E731
    cands = [(0, lvl(110.0, 10)),                               # major swing high, far
             (3, lvl(100.6, 99)), (3, lvl(99.4, 98)),           # micro: the last bars' range
             (3, lvl(103.0, 60)), (3, lvl(96.0, 40)), (3, lvl(104.5, 30))]
    out = auto_draw._rank_levels(cands, close, at, micro_from, 4)
    assert [h["price"] for h in out] == [103.0, 96.0, 104.5, 110.0]     # nearest first
    # control: with room, the micro levels are still drawn (demoted, not deleted)
    out6 = auto_draw._rank_levels(cands, close, at, micro_from, 6)
    assert {100.6, 99.4} <= {h["price"] for h in out6}


def test_a_major_swing_high_overhead_reaches_every_drawn_set_that_has_one():
    have = beyond_nearest = 0
    for seed in range(1, 41):
        bars = _synthetic(seed)
        a = auto_draw.as_arrays(bars)
        i = len(a) - 1
        highs = auto_draw.major_swings(a, i, True)
        d = auto_draw.drawn_set(bars)
        if not highs:
            continue
        have += 1
        drawn = [h for h in d["horizontals"] if h["source"] == "major_swing_high"]
        assert drawn and drawn[0]["price"] == round(highs[0]["price"], 4), (seed, d["horizontals"])
        # non-vacuity: some of these sit beyond the four levels nearest the close
        near = sorted({round(float(x), 4) for x in a[max(0, i - 120):i + 1, 2:4].ravel()},
                      key=lambda p: abs(p - a[i, 4]))[:4]
        beyond_nearest += round(highs[0]["price"], 4) not in near
    assert have >= 10, "control: too few synthetic charts with a major swing high overhead"
    assert beyond_nearest, "control: every major high was among the nearest anyway"


# -- 6. learned trendlines -----------------------------------------------------------------------------

def test_touches_count_separate_contacts_with_the_line():
    a = np.array([[ymd_t(k), 10, 12.0, 9.0, 10.0, 1] for k in range(30)], dtype=float)
    for k in (0, 1, 12, 29):                                    # 0-1 adjacent: one contact
        a[k, 2] = 15.0
    assert auto_draw._touches(a, 29, 1.0, 0, 15.0, 0.0, 1) == 3
    a[20, 2] = 15.1
    assert auto_draw._touches(a, 29, 1.0, 0, 15.0, 0.0, 1) == 4
    # a support line through the lows
    b = np.array([[ymd_t(k), 10, 12.0, 9.0, 10.0, 1] for k in range(30)], dtype=float)
    assert auto_draw._touches(b, 29, 1.0, 0, 9.0, 0.0, 0) == 1     # one long run on the line


def test_crosses_crash_needs_a_fast_fall_of_several_atr():
    a = np.array([[ymd_t(k), 100, 100.5, 99.5, 100.0, 1] for k in range(60)], dtype=float)
    assert auto_draw._crosses_crash(a, 59, 0) is False
    for k, c in zip(range(30, 33), (96.0, 92.0, 90.0)):          # -10 in 3 bars, ATR ~1
        a[k, 2:5] = (c + 0.5, c - 0.5, c)
    a[33:, 2:5] = (90.5, 89.5, 90.0)
    assert auto_draw._crosses_crash(a, 59, 0) is True
    assert auto_draw._crosses_crash(a, 59, 40) is False            # the span starts after it


def _crash_rows(seed):
    rows = [list(r) for r in _synthetic(seed)]
    k = 250
    for j in range(k, len(rows)):                                  # a 30% crash over 3 bars at 250
        f = 0.9 if j == k else (0.85 if j == k + 1 else 0.82)
        f = f if j <= k + 2 else 0.82
        rows[j] = [rows[j][0]] + [round(x * f, 4) for x in rows[j][1:5]] + [rows[j][5]]
    return [tuple(r) for r in rows]


def _line_facts(a, at, tl):
    idx = {int(a[j, 0]): j for j in range(len(a))}
    ja, jb = idx[tl["t1"]], idx[tl["t2"]]
    slope = (tl["p2"] - tl["p1"]) / (jb - ja)
    i = len(a) - 1
    return (abs(tl["p_now"] - a[i, 4]) / at,
            auto_draw._touches(a, i, at, ja, tl["p1"], slope, tl["is_high"]),
            (not tl["is_high"]) and auto_draw._crosses_crash(a, i, ja))


def test_drawn_trendlines_are_near_price_touched_three_times_and_cross_no_crash():
    raw_far = raw_two = raw_crash = drew = 0
    sets = [_synthetic(s) for s in range(1, 41)] + [_crash_rows(s) for s in range(1, 21)]
    for bars in sets:
        a = auto_draw.as_arrays(bars)
        at = auto_draw.atr(a, len(a) - 1)
        d = auto_draw.drawn_set(bars)
        for tl in d["trendlines"]:
            dist, touches, crash = _line_facts(a, at, tl)
            assert dist <= auto_draw.TL_MAX_DIST_ATR + 1e-9, tl
            assert touches >= auto_draw.TL_MIN_TOUCHES, tl
            assert not crash, tl
            drew += 1
        for r in auto_draw.propose(bars, k=auto_draw.DRAWN_TL_POOL, kinds=("trendline",)):
            dist, touches, crash = _line_facts(a, at, {**r["coords"], "is_high": r["is_high"]})
            raw_far += dist > auto_draw.TL_MAX_DIST_ATR
            raw_two += touches < auto_draw.TL_MIN_TOUCHES
            raw_crash += bool(crash)
    assert drew, "control: no trendline was drawn at all"
    assert raw_far and raw_two and raw_crash, ("control: the raw ranking never offered the line "
                                               "a rule removes", raw_far, raw_two, raw_crash)


# -- 7. MA pullback tag --------------------------------------------------------------------------------

def _pullback(closes, tag_low_offset=0.0):
    """Bars over `closes` with the LAST bar the tag bar: its low on the 21 EMA (+ offset)."""
    bars = _bars(closes)
    ema = U.ema([b["c"] for b in bars], 21)
    j = len(bars) - 1
    bars[j]["l"] = round(ema[j] + tag_low_offset, 4)
    bars[j]["h"] = max(bars[j]["h"], bars[j]["l"] + 0.5)
    d = {"pattern_id": "uct_pullback_ma_v5", "confidence": 72, "start_t": ymd_t(j - 5),
         "end_t": ymd_t(j), "levels": {"entry": closes[-1], "stop": bars[j]["l"]},
         "geometry": {"shape": "horizontal_line", "anchors": [],
                      "extras": {"tagged_ma": "e21", "tag_t": ymd_t(j)}}}
    return d, bars


RISING = [100.0 + 0.5 * k for k in range(70)]                   # the 21 EMA rises ~5 per 10 bars


def test_ma_tag_verdict_rising_flat_and_off_the_ma():
    d, bars = _pullback(RISING)
    pos = display._index(bars)
    assert display.ma_tag_verdict(bars, pos, d["geometry"]["extras"]) == (True, None)
    flat = [100.0 + 0.5 * k for k in range(50)] + [125.0] * 40      # flat for the last 40
    d2, bars2 = _pullback(flat)
    assert display.ma_tag_verdict(bars2, display._index(bars2), d2["geometry"]["extras"]) \
        == (False, "ma_flat")
    d3, bars3 = _pullback(RISING, tag_low_offset=2.0)               # low 2 points (> 0.25 ATR) above
    assert display.ma_tag_verdict(bars3, display._index(bars3), d3["geometry"]["extras"]) \
        == (False, "tag_off_ma")
    # unknown MA / tag bar: drawn
    assert display.ma_tag_verdict(bars, pos, {"tagged_ma": "e99", "tag_t": ymd_t(5)}) == (True, None)


def test_a_tag_on_a_flat_ma_is_not_drawn():
    flat = [100.0 + 0.5 * k for k in range(50)] + [125.0] * 40
    d, bars = _pullback(flat)
    before = _frozen(d)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "ma_flat" and "draw_ema" not in ex
    assert _frozen(d) == before                                     # display / tag filter only
    # control: the rising MA draws its curve
    d2, bars2 = _pullback(RISING)
    display.draw_geometry([d2], bars2)
    assert not d2["geometry"]["extras"].get("stale") and "draw_ema" in d2["geometry"]["extras"]
