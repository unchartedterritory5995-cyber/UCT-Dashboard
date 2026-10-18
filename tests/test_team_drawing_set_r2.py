"""Team drawing set, round 2 (lab REPORT_TEAM_SET.md blind check, 2026-10-17): the display-only
fixes for what the judges named. Nothing here changes what any detector fires on, its confidence,
HIST_SCORE or `confirmed_only` -- every stamp lives under `geometry.extras` or in the learned
drawer's chart set. Synthetic bars only (public repo).

  1. bull_flag   only a PAUSE is drawn (no bar / lane above the pole high, midline flat-to-down);
                 of overlapping flags only the most confident is drawn at all.
  2. flat base   a pivot line needs a real base under it and must sit near price.
  3. cup         the rim line is the LEFT LIP, not a later spike.
  4. levels      no prior-day H/L at the last bar's own edges, at most 4, no duplicates.
  5. trendlines  no line cutting through closes, one line per anchor, no near-duplicates.
"""
from __future__ import annotations

import copy

from api.services import auto_draw, auto_structures
from api.services.pattern_engine import display
from tests.detector_fixtures import ymd_t
from tests.test_auto_draw import _synthetic
from tests.test_drawing_geometry_v2 import _bars, _flag


# -- 1. bull_flag: a pause under the pole high ------------------------------------------------

POLE_LOWS = [10, 10.5, 12, 14, 15]          # pole top = bar 4, high 16


def _flag_bars(flag_lows):
    lows = POLE_LOWS + list(flag_lows)
    return _bars([lo + 0.5 for lo in lows], lows=lows, highs=[lo + 1 for lo in lows])


PAUSE = [15, 14.8, 14.6, 14.5, 14.4, 14.3, 14.2]         # highs 16 .. 15.2: under the pole high


def test_a_pause_under_the_pole_high_is_drawn_and_display_only():
    bars = _flag_bars(PAUSE)
    d = _flag(70, ((5, 16.0), (11, 15.2)), ((5, 15.0), (11, 14.2)))
    before = copy.deepcopy({k: d.get(k) for k in ("confidence", "pivot_ts")})
    anchors = copy.deepcopy(d["geometry"]["anchors"])
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert not ex.get("stale"), ex
    assert ex["draw_lanes"] is True
    assert ex["draw_pole"][1]["price"] == 16.0
    assert d["geometry"]["anchors"] == anchors
    assert {k: d.get(k) for k in before} == before


def test_a_flag_running_past_the_pole_high_is_a_second_leg_and_not_drawn():
    bars = _flag_bars([16, 15.5, 15.2, 15, 15.1, 15.2, 15.3])   # bar 5's high 17 > pole high 16
    d = _flag(70, ((5, 17.0), (11, 16.3)), ((5, 15.5), (11, 15.0)))
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "past_pole_high"
    assert ex["draw_lanes"] is False


def test_a_lane_projected_above_the_pole_high_is_not_a_pause():
    bars = _flag_bars(PAUSE)
    # bars stay under 16, but the fitted upper lane ends at 16.4: the channel claims a leg up
    d = _flag(70, ((5, 15.6), (11, 16.4)), ((5, 14.0), (11, 14.6)))
    display.draw_geometry([d], bars)
    assert d["geometry"]["extras"]["stale_reason"] == "past_pole_high"


def test_a_rising_channel_under_the_pole_high_is_not_a_pause():
    bars = _flag_bars([13, 13.2, 13.4, 13.6, 13.8, 14.0, 14.2])  # highs 14 .. 15.2, all < 16
    d = _flag(70, ((5, 14.0), (11, 15.2)), ((5, 13.0), (11, 14.2)))
    display.draw_geometry([d], bars)
    ex = d["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "rising_channel"
    # control: the same channel sloping DOWN by the same amount is a pause
    d2 = _flag(70, ((5, 15.2), (11, 14.0)), ((5, 14.2), (11, 13.0)))
    display.draw_geometry([d2], _flag_bars([14.2, 14, 13.8, 13.6, 13.4, 13.2, 13.0]))
    assert not d2["geometry"]["extras"].get("stale")


def test_overlapping_flags_draw_one_pole_and_one_entry_line():
    bars = _flag_bars(PAUSE)
    best = _flag(70, ((5, 16.0), (11, 15.2)), ((5, 15.0), (11, 14.2)))
    worse = _flag(55, ((5, 16.0), (11, 15.2)), ((5, 15.0), (11, 14.2)), pole=(1, 4))
    crossing = _flag(40, ((5, 15.0), (11, 14.0)), ((5, 15.5), (11, 13.5)), pole=(2, 4))
    display.draw_geometry([worse, crossing, best], bars)
    drawn = [d for d in (best, worse, crossing) if not d["geometry"]["extras"].get("stale")]
    assert drawn == [best]
    assert worse["geometry"]["extras"]["stale_reason"] == "overlapped"
    # a lanes-off flag (crossing) is not a free pass: it would still draw a pole + entry line
    assert crossing["geometry"]["extras"]["stale"] is True


# -- 2. flat base: a real base under the pivot, near price -------------------------------------

BOX = {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(14),
       "top": 100.5, "floor": 79.5, "pivot": 100.6}


def test_bc_flat_base_pivot_on_a_last_bar_spike_with_no_base_is_not_drawn():
    closes = [80, 80.5, 81, 80, 80.5, 81, 80.5, 80, 81, 80.5, 80, 81, 80.5, 80, 81, 90]
    highs = [c + 0.5 for c in closes]
    highs[-1] = 95.0
    bars = _bars(closes, highs=highs)
    box = {**BOX, "end_t": ymd_t(15), "top": 95.0, "pivot": 95.0}
    ex = auto_structures.box_to_detection("ZZZ", box, bars)["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "no_base"
    assert "draw_pivot" not in ex


def test_bc_flat_base_pivot_far_above_price_is_not_drawn():
    base = [99, 98, 100, 97, 99, 98, 99, 100, 98, 99, 98, 99, 100, 98, 99]
    closes = base + [95, 92, 90, 88, 87, 86, 85, 86, 85, 84]
    ex = auto_structures.box_to_detection("ZZZ", BOX, _bars(closes))["geometry"]["extras"]
    assert ex["stale"] is True and ex["stale_reason"] == "far_from_price"
    # control: the same base with price still at the line draws its pivot
    ok = auto_structures.box_to_detection("ZZZ", BOX, _bars(base))["geometry"]["extras"]
    # (round 4: the line is the base's top cluster of highs, 100.5, not base_catalog's 100.6)
    assert not ok.get("stale") and ok["draw_pivot"]["price"] == 100.5


def test_flat_base_detector_pivot_needs_the_base_too():
    # the base never got near the level the line stands for: price left the band under it
    # (round 4: the line is the base's own top, so the old "base high floating above the bars"
    # cannot be drawn at all; a line price has fallen away from is still not drawn)
    closes = [80, 84, 88, 91, 90, 89, 90, 91, 90, 89, 90, 91, 90, 84, 80]
    n = len(closes) - 1
    d = {"pattern_id": "flat_base", "start_t": ymd_t(0), "end_t": ymd_t(n), "confidence": 70,
         "levels": {"entry": 100.6},
         "geometry": {"shape": "rectangle", "extras": {},
                      "anchors": [{"t": ymd_t(0), "price": 80.0}, {"t": ymd_t(3), "price": 100.5},
                                  {"t": ymd_t(n), "price": 100.5}, {"t": ymd_t(n), "price": 89.5}]}}
    display.draw_geometry([d], _bars(closes))
    ex = d["geometry"]["extras"]
    # (round 5: the last close under the box's floor reads first as "below_box")
    assert ex["stale"] is True and ex["stale_reason"] in {"no_base", "far_from_price", "left_band", "below_box"}
    assert "draw_pivot" not in ex
    assert d["levels"]["entry"] == 100.6       # display-only


def test_pivot_base_verdict_counts_closes_in_the_band():
    bars = _bars([100] * 10 + [99] * 5)        # ATR ~1.0 at the end
    s, e = ymd_t(0), ymd_t(14)
    assert display.pivot_base_verdict(bars, s, e, 100.5) == (True, None)
    # a line ~7 ATR over the last close: far from price
    assert display.pivot_base_verdict(bars, s, e, 106.0) == (False, "far_from_price")
    # near the last close, but every close sits ABOVE the line: no base under it
    assert display.pivot_base_verdict(bars, ymd_t(9), e, 98.6) == (False, "no_base")


# -- 3. cup: the rim at the left lip ---------------------------------------------------------

def test_cup_rim_line_is_the_left_lip_not_a_later_spike():
    closes = [95, 98, 100, 96, 92, 88, 86, 89, 93, 98, 97, 96, 97, 98, 102]
    highs = [c + 0.5 for c in closes]
    highs[9] = 104.0
    bars = _bars(closes, highs=highs)
    rim = display.cup_rim_line(bars, ymd_t(0), ymd_t(9), ymd_t(14))
    assert rim == {"start_t": ymd_t(2), "end_t": ymd_t(14), "price": 100.5}
    # no breakout yet: the line runs to the end of the span
    early = display.cup_rim_line(bars, ymd_t(0), ymd_t(9), ymd_t(13))
    assert early["end_t"] == ymd_t(13)
    assert display.cup_rim_line(bars, ymd_t(0), 99999999, ymd_t(14)) is None


# -- 4/5. the learned drawer's chart set -----------------------------------------------------

SEEDS = range(1, 41)


def _arr(bars):
    return auto_draw.as_arrays(bars)


def test_learned_levels_drop_prior_day_at_the_last_bar_cap_four_no_duplicates():
    seen_learned = 0
    for seed in SEEDS:
        bars = _synthetic(seed)
        d = auto_draw.drawn_set(bars)
        hs = d["horizontals"]
        assert 1 <= len(hs) <= 4 == auto_draw.DRAWN_HORIZONTALS
        # round 3 made this deliberate: with a complete last bar the prior day IS that bar, so its
        # high / low are never drawn at its own range edges -- they are listed as omitted instead
        assert not any(h["source"].startswith("prior_day") for h in hs)
        assert {o["source"] for o in d["omitted"]} == {"prior_day_high", "prior_day_low"}
        ps = [h["price"] for h in hs]
        assert all(abs(x - y) > auto_draw.H_DUP_ATR * d["atr"] - 1e-6
                   for i, x in enumerate(ps) for y in ps[i + 1:]), (seed, ps)
        dists = [abs(p - d["last_close"]) for p in ps]
        assert dists == sorted(dists)
        seen_learned += any(h["source"] == "learned" for h in hs)
    assert seen_learned, "control: the learned fill never entered"


def _cut_closes(a, at, tl):
    idx = {int(a[j, 0]): j for j in range(len(a))}
    ja, jb = idx[tl["t1"]], idx[tl["t2"]]
    slope = (tl["p2"] - tl["p1"]) / (jb - ja)
    n = 0
    for j in range(ja + 1, jb):
        line = tl["p1"] + slope * (j - ja)
        n += (a[j, 4] > line + 0.1 * at) if tl["is_high"] else (a[j, 4] < line - 0.1 * at)
    return n, slope


def _violations(a, at, tls):
    """(cut, shared_anchor, near_dup) counts over a trendline set."""
    cut = shared = dup = 0
    info = []
    for tl in tls:
        n, slope = _cut_closes(a, at, tl)
        cut += n >= auto_draw.TL_MAX_CUT_CLOSES
        info.append((tl["is_high"], slope, tl["p_now"], {(tl["is_high"], tl["t1"]), (tl["is_high"], tl["t2"])}))
    for i, x in enumerate(info):
        for y in info[i + 1:]:
            shared += bool(x[3] & y[3])
            dup += (x[0] == y[0] and abs(x[1] - y[1]) <= auto_draw.TL_DUP_SLOPE_ATR * at
                    and abs(x[2] - y[2]) <= auto_draw.TL_DUP_OFFSET_ATR * at)
    return cut, shared, dup


def test_learned_trendlines_no_cut_through_one_per_anchor_no_near_duplicates():
    raw_bad = 0
    drew = 0
    for seed in SEEDS:
        bars = _synthetic(seed)
        d = auto_draw.drawn_set(bars)
        a = _arr(bars)
        at = auto_draw.atr(a, len(a) - 1)
        assert _violations(a, at, d["trendlines"]) == (0, 0, 0), seed
        assert len(d["trendlines"]) <= auto_draw.DRAWN_TRENDLINES
        drew += len(d["trendlines"])
        raw = [{**r["coords"], "is_high": r["is_high"]}
               for r in auto_draw.propose(bars, k=auto_draw.DRAWN_TRENDLINES, kinds=("trendline",))]
        raw_bad += sum(_violations(a, at, raw)) > 0
    assert drew, "control: the filter drew no trendline at all"
    # control: the unfiltered top-3 (what round 1 drew) does break these rules, so the check can see it
    assert raw_bad, "control: the raw ranking never violated a rule; the fixture cannot distinguish"

