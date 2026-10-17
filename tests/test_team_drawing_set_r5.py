"""Team drawing set, round 5 (lab REPORT_TEAM_SET_R4.md + REPORT_TEAM_SET_R4_CONFIRM.md, 2026-10-17): the
display-only fixes for what the round-4 and confirm judges named. Nothing here changes what any detector fires
on, its confidence, levels, HIST_SCORE or `confirmed_only` -- every stamp lives under `geometry.extras` or in
the learned drawer's chart set. Synthetic bars only (public repo). Each rule has a firing case and a control.

  1. cup           rim_too_old, gap_crater, short_of_rim
  2. bc:flat-base  fresh_high, thin_base, deep_base
  3. flat_base     the run-up trimmed off the box's left edge; below_box; still_rising
  4. bull_flag     detached_flag, steep_flag, deep_flag, diverging lanes not drawn
  5. MA pullback   tag_above_ma, below_flat_ma; the drawn stop from the tag bar
  6. learned       near-duplicate levels merged (0.6 ATR), one trendline per side, a long line needs 4 touches
"""
from __future__ import annotations

import copy

from api.services import auto_draw, auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_auto_draw import _synthetic
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r3 import _cup_bars, _cup_box
from tests.test_team_drawing_set_r4 import (FAST_POLE, FLAG, PRE, RISING, RUNUP, _base, _drawn, _flag_det,
                                            _flat_det, _frozen, _pullback)


# -- 1. cup ------------------------------------------------------------------------------------------

def _rim_of(bars, cup_end=19):
    return display.cup_rim_line(bars, ymd_t(0), ymd_t(cup_end), ymd_t(len(bars) - 1))


def test_a_rim_older_than_the_charts_default_zoom_is_not_drawn():
    old = _cup_bars([98, 97.5, 97, 97.5], tail=[99.0] * 185)        # the lip 208 bars before the last
    ex = auto_structures.box_to_detection("ZZZ", _cup_box(23), old)["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "rim_too_old", ex
    # control: 193 bars back (inside the 200-bar zoom) the same cup draws its rim
    ok = auto_structures.box_to_detection("ZZZ", _cup_box(23), _cup_bars([98, 97.5, 97, 97.5], tail=[99.0] * 170))
    assert not ok["geometry"]["extras"].get("stale"), ok["geometry"]["extras"]
    assert ok["geometry"]["extras"]["draw_pivot"]["price"] == 100.5


GAP_CUP = [100, 100, 89, 88, 87, 86, 86, 87, 88, 90, 92, 94, 96, 97, 98, 99, 99, 99, 99, 99]


def test_a_rim_on_a_pre_gap_down_high_over_a_crater_is_not_drawn():
    lows = [99.5, 99.5] + [c - 3.5 for c in GAP_CUP[2:]]             # bar 2 gaps 10 under bar 1's low
    bars = _bars(GAP_CUP, lows=lows)
    assert display.gap_island(bars, 0, 19) is False                  # not an island: no gap back up
    rim = _rim_of(bars)
    assert rim["price"] == 100.5
    assert display.cup_shape_verdict(bars, ymd_t(0), ymd_t(19), rim) == (False, "gap_crater")
    # control: the same cup falling bar by bar (overlapping, no gap) is a cup
    smooth = _bars(GAP_CUP, lows=[c - 3.5 for c in GAP_CUP], highs=[100.5, 100.5, 96.0] + [c + 0.5 for c in GAP_CUP[3:]])
    assert display.cup_shape_verdict(smooth, ymd_t(0), ymd_t(19), _rim_of(smooth)) == (True, None)


SHORT_CUP = [100, 100, 99, 96, 93, 90, 88, 87, 86, 86, 87, 88, 90, 91, 92, 93, 94, 94, 94, 94]


def test_a_rim_the_right_side_never_came_back_to_is_not_drawn():
    bars = _bars(SHORT_CUP, lows=[c - 3.5 for c in SHORT_CUP])        # the right side tops at 94.5
    rim = _rim_of(bars)
    assert rim["price"] == 100.5
    assert display.cup_shape_verdict(bars, ymd_t(0), ymd_t(19), rim) == (False, "short_of_rim")
    # control: a right side that reached within 2% of the rim (99.5 vs 100.5) draws
    ok = _cup_bars([])                                                # round 3's cup: back to 99
    assert display.cup_shape_verdict(ok, ymd_t(0), ymd_t(19), _rim_of(ok)) == (True, None)


def test_cup_reach_verdict_unknown_is_drawn():
    bars = _cup_bars([98, 97.5])
    assert display.cup_reach_verdict(bars, display._index(bars), 9, {"start_t": 99999999, "price": 100.5}) \
        == (True, None)


# -- 2. bc:flat-base ---------------------------------------------------------------------------------

def _bc(closes, highs, top):
    box = {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(len(closes) - 1),
           "top": top, "floor": min(closes) - 0.5, "pivot": top + 0.1}
    return auto_structures.box_to_detection("ZZZ", box, _bars(closes, highs=highs))["geometry"]["extras"]


def test_a_line_first_touched_in_the_last_bars_is_a_fresh_high_not_a_base():
    closes = [98.0 if k % 2 else 99.0 for k in range(26)]
    highs = [c + 0.5 for c in closes]
    for k in range(20, 26):                                          # the line's highs: the last 6 bars
        highs[k] = 101.0
    ex = _bc(closes, highs, 101.0)
    assert ex["stale"] is True and ex["stale_reason"] == "fresh_high", ex
    # control: the same line touched early too (bars 3 and 4) has a base under it
    highs2 = list(highs)
    highs2[3] = highs2[4] = 101.0
    ok = _bc(closes, highs2, 101.0)
    assert not ok.get("stale") and ok["draw_pivot"]["price"] == 101.0, ok


def test_flat_top_verdict_thin_and_deep_bases():
    s, e = ymd_t(0), ymd_t(29)
    flat = _bars(_base(30))                                         # ATR 1.5, every close in the band
    assert display.flat_top_verdict(flat, s, e, 100.5) == (True, None)
    # a line over a span where most closes sit under the band: no base under it
    thin = [100.0 if k % 2 else 99.0 for k in range(10)] + [92.0] * 20   # 10 of 30 closes in the band
    thin_bars = _bars(thin)
    assert display.flat_top_verdict(thin_bars, s, e, 100.5) == (False, "thin_base")
    # a rounded / deep base: 6 closes 7 points (4.7 ATR > 4.4) under the line, the rest in the band
    # (the dip early in the span, so the last 14 bars' ATR stays 1.5)
    deep = _base(30)
    for k in range(5, 11):
        deep[k] = 93.5
    assert display.flat_top_verdict(_bars(deep), s, e, 100.5) == (False, "deep_base")
    # control: a dip of 4 points (under 4.4 ATR) is a shakeout inside a base
    shallow = _base(30)
    for k in range(5, 11):
        shallow[k] = 96.5
    assert display.flat_top_verdict(_bars(shallow), s, e, 100.5) == (True, None)
    assert display.flat_top_verdict(flat, s, 99999999, 100.5) == (True, None)


# -- 3. flat_base ------------------------------------------------------------------------------------

def test_the_run_up_is_trimmed_off_the_boxs_left_edge():
    closes = RUNUP + _base(30, 5)                                   # run-up 85..97 (bars 0-4), base 5-34
    d, bars = _flat_det(closes, 2, base_bars=33)                    # the detector's base reaches bar 2
    before = _frozen(d)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    # the width floor alone would start the box on bar 2 (close 91); the rising closes under the band
    # (91, 94, 97) are the run-up, so the box starts on the base's first bar
    assert ex["draw_anchors"][0]["t"] == ymd_t(5), ex["draw_anchors"]
    assert _frozen(d) == before                                     # display-only
    # control: closes under the band that do NOT rise into the next one stay inside the box
    flat_dip = [96.0, 96.0, 96.0, 96.0, 96.0] + _base(30, 5)
    d2, bars2 = _flat_det(flat_dip, 2, base_bars=33)
    display.draw_geometry([d2], bars2)
    assert d2["geometry"]["extras"]["draw_anchors"][0]["t"] == ymd_t(2), d2["geometry"]["extras"]


def test_a_base_already_back_under_its_box_is_not_drawn():
    closes = RUNUP + _base(25, 5) + [99.0, 100.0, 96.0]            # the last close under the floor 98.5
    d, bars = _flat_det(closes, 10, e=len(closes) - 2)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "below_box", ex
    # control: the last close back in the base draws
    d2, bars2 = _flat_det(RUNUP + _base(25, 5) + [99.0, 100.0, 99.0], 10, e=len(closes) - 2)
    display.draw_geometry([d2], bars2)
    assert not d2["geometry"]["extras"].get("stale"), d2["geometry"]["extras"]


def test_a_box_over_a_still_rising_advance_is_not_drawn():
    rise = [97.6 + 0.15 * k for k in range(20)]                    # +0.15 a bar, highs at the end
    d, bars = _flat_det(RUNUP + rise, 5)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "still_rising", ex
    # control: the same climb pausing for its last 4 bars (its high no longer in the last 3 bars)
    paused = RUNUP + rise[:16] + [99.7, 99.6, 99.7, 99.6]
    d2, bars2 = _flat_det(paused, 5)
    display.draw_geometry([d2], bars2)
    assert d2["geometry"]["extras"].get("stale_reason") != "still_rising", d2["geometry"]["extras"]


# -- 4. bull_flag ------------------------------------------------------------------------------------

def test_a_flag_on_a_later_leg_is_not_this_poles_flag():
    ex = _drawn(PRE + FAST_POLE + FLAG, 18, ((22, 16.9), (24, 16.5)), ((22, 15.9), (24, 15.5)))
    assert ex["stale"] is True and ex["stale_reason"] == "detached_flag", ex
    # control: the same lanes starting on the bar after the pole's top draw
    ok = _drawn(PRE + FAST_POLE + FLAG, 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5)))
    assert not ok.get("stale"), ok


SLOW_POLE = [11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0]      # bars 15-22: 9 ATR in 8 bars (1.1/bar)


def test_a_flag_falling_faster_than_the_pole_rose_is_not_a_flag():
    closes = PRE + SLOW_POLE + [17.6, 16.8, 16.0, 15.2]              # the flag falls 0.8 a bar
    ex = _drawn(closes, 22, ((23, 18.1), (26, 15.7)), ((23, 17.1), (26, 14.7)))
    assert ex["stale"] is True and ex["stale_reason"] == "steep_flag", ex
    # control: a flag falling 0.5 a bar (under 0.65 x the pole's 1.1) draws
    ok = _drawn(PRE + SLOW_POLE + [18.0, 17.5, 17.0, 16.5], 22, ((23, 18.5), (26, 17.0)), ((23, 17.5), (26, 16.0)))
    assert not ok.get("stale"), ok


def test_a_flag_that_gave_back_half_the_pole_is_not_a_flag():
    deep = [16.5, 15.5, 14.5, 14.0, 13.6, 13.5]                     # lows to 13.0: 4.5 of an 8-point pole
    ex = _drawn(PRE + FAST_POLE + deep, 18, ((19, 17.0), (24, 14.5)), ((19, 15.5), (24, 13.0)))
    assert ex["stale"] is True and ex["stale_reason"] == "deep_flag", ex
    # control: FLAG gives back 1.5 of the 8-point pole and draws
    ok = _drawn(PRE + FAST_POLE + FLAG, 18, ((19, 17.5), (24, 16.5)), ((19, 16.5), (24, 15.5)))
    assert not ok.get("stale"), ok


def test_diverging_lanes_are_not_drawn_at_all():
    ex = _drawn(PRE + FAST_POLE + FLAG, 18, ((19, 17.5), (24, 17.3)), ((19, 17.0), (24, 15.5)))
    # round 2 hid only the lanes (pole + entry still drawn); round 5 draws nothing
    assert ex["lanes_reason"] == "diverging"
    assert ex["stale"] is True and ex["stale_reason"] == "diverging", ex


# -- 5. MA pullback ----------------------------------------------------------------------------------

def test_a_tag_bar_low_above_the_ma_is_not_a_tag():
    d, bars = _pullback(RISING, tag_low_offset=0.3)                  # 0.3 over the MA: > 0.18 ATR, < 0.25
    pos = display._index(bars)
    j = len(bars) - 1
    at = display.atr14(bars)
    assert 0.18 * at < 0.3 < 0.25 * at, at                          # the band this rule owns
    assert display.ma_tag_verdict(bars, display._index(bars), d["geometry"]["extras"]) \
        == (False, "tag_above_ma")
    d2, bars2 = _pullback(RISING, tag_low_offset=0.1)               # control: 0.1 ATR above
    assert display.ma_tag_verdict(bars2, display._index(bars2), d2["geometry"]["extras"]) == (True, None)


def _chop(amp, drift):
    return [100.0 + 0.5 * k for k in range(50)] + [125.0 + drift * k + (amp if k % 3 == 0 else -amp)
                                                  for k in range(40)]


def test_closes_already_under_a_flattening_ma_suppress_the_tag():
    d, bars = _pullback(_chop(2.0, 0.1))
    assert display.ma_tag_verdict(bars, display._index(bars), d["geometry"]["extras"]) \
        == (False, "below_flat_ma")
    before = _frozen(d)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "below_flat_ma" and "draw_ema" not in ex
    assert _frozen(d) == before
    # control: the same chop around a MA still rising 0.2 a bar is a pullback
    d2, bars2 = _pullback(_chop(2.0, 0.2))
    assert display.ma_tag_verdict(bars2, display._index(bars2), d2["geometry"]["extras"]) == (True, None)


def test_the_drawn_stop_starts_on_the_tag_bar_at_its_low():
    d, bars = _pullback(RISING)
    sec = [{"shape": "horizontal_line", "role": "stop", "label": "x",
            "anchors": [{"t": ymd_t(50), "price": 1.0}, {"t": ymd_t(69), "price": 1.0}]}]
    d["geometry"]["secondary"] = copy.deepcopy(sec)
    before = _frozen(d)
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    j = len(bars) - 1
    assert ex["draw_stop"] == {"start_t": ex["tag_t"], "end_t": bars[j]["t"], "price": bars[j]["l"]}
    assert ex["draw_stop"]["price"] == d["levels"]["stop"]
    assert d["geometry"]["secondary"] == sec                        # the detector's own geometry untouched
    assert _frozen(d) == before
    # a tag bar before the last: the stop runs from it to the last bar
    pos = display._index(bars)
    st = display.stop_segment(bars, pos, {"tag_t": bars[j - 3]["t"]})
    assert st == {"start_t": bars[j - 3]["t"], "end_t": bars[j]["t"], "price": bars[j - 3]["l"]}
    assert display.stop_segment(bars, pos, {"tag_t": 99999999}) is None


# -- 6. learned drawer -------------------------------------------------------------------------------

def test_near_duplicate_levels_within_point_six_atr_merge():
    lvl = lambda p, j: {"price": p, "_j": j}                         # noqa: E731
    close, at = 100.0, 1.0
    out = auto_draw._rank_levels([(3, lvl(103.0, 10)), (3, lvl(103.55, 20))], close, at, 97, 4)
    assert [h["price"] for h in out] == [103.0]                     # 0.55 ATR apart: one level
    out2 = auto_draw._rank_levels([(3, lvl(103.0, 10)), (3, lvl(103.65, 20))], close, at, 97, 4)
    assert [h["price"] for h in out2] == [103.0, 103.65]            # control: 0.65 ATR apart: two


def _sides(trendlines):
    return [tl["is_high"] for tl in trendlines]


def test_one_trendline_per_side(monkeypatch):
    sets = [_synthetic(s) for s in range(1, 41)]
    drew = 0
    for bars in sets:
        sides = _sides(auto_draw.drawn_set(bars)["trendlines"])
        assert len(sides) == len(set(sides)), sides
        drew += len(sides)
    assert drew, "control: no trendline drawn at all"
    # non-vacuity: without the rule some set draws two lines on one side
    monkeypatch.setattr(auto_draw, "TL_PER_SIDE", 3)
    assert any(len(s) != len(set(s)) for s in (_sides(auto_draw.drawn_set(b)["trendlines"]) for b in sets))


def _long_three(bars):
    a = auto_draw.as_arrays(bars)
    i = len(a) - 1
    at = auto_draw.atr(a, i)
    idx = {int(a[j, 0]): j for j in range(i + 1)}
    out = []
    for tl in auto_draw.drawn_set(bars)["trendlines"]:
        ja, jb = idx[tl["t1"]], idx[tl["t2"]]
        n = auto_draw._touches(a, i, at, ja, tl["p1"], (tl["p2"] - tl["p1"]) / (jb - ja), tl["is_high"])
        out.append((i - ja, n))
    return out


def test_a_long_trendline_needs_four_touches(monkeypatch):
    sets = [_synthetic(s) for s in range(1, 61)]
    long_drawn = 0
    for bars in sets:
        for span, n in _long_three(bars):
            assert n >= (auto_draw.TL_LONG_MIN_TOUCHES if span >= auto_draw.TL_LONG_SPAN
                         else auto_draw.TL_MIN_TOUCHES), (span, n)
            long_drawn += span >= auto_draw.TL_LONG_SPAN
    assert long_drawn, "control: no long line drawn at all"
    # non-vacuity: with round 4's 3 touches some long line with exactly 3 touches is drawn
    monkeypatch.setattr(auto_draw, "TL_LONG_MIN_TOUCHES", 3)
    assert any(span >= auto_draw.TL_LONG_SPAN and n == 3 for b in sets for span, n in _long_three(b))
