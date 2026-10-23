"""Textbook (IBD-style) numbers beside the base drawing (api/services/textbook_numbers.py), and their gates.

Rails, each on hand-built bars whose answer follows from the textbook definition:
  * the buy point is the base's pivot HIGH (a wick, not a body) + $0.10, never the as-of bar's high; the cup
    pivots on its handle high; the buy zone runs to +5%; depth is read from the base high;
  * the stage count walks every base type (flat, cup, double bottom), opens a stage only on a 20% gain from
    the prior buy point with the new base above it, resets on an undercut or a decline, and is omitted
    whenever the chain is not anchored;
  * the volume readout: breakout volume at or above the buy point (light under 40%), below it only when
    notable, never on a forming bar;
  * no lookahead; AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED off leaves every payload byte-identical and runs
    nothing; a member sees the textbook numbers only on the released MEMBER_TEXTBOOK_ROUND;
  * the two defects the blind A/B found, on the real charts' own drawn spans (PLSE, TECH, 2026-10-22): only a
    CEILING bar's high is a buy point (a spike wick through the base is not, and the printed number is guarded),
    and a base too shallow to describe gets no label, old or new.
Synthetic bars, plus those two drawn spans as a small fixture.
"""
from __future__ import annotations

import copy
import datetime
import json

import pytest

import api.routers.patterns as patterns_router  # noqa: F401 -- registers every detector
from api.services import auto_structures, base_metrics, textbook_numbers as tn
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_base_draw_member_drawing import _synth
from tests.test_base_metrics import _serve, _today
from tests.test_member_drawing_set import _flags, _get


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


# -- fixtures ---------------------------------------------------------------------------------------

def _dates(n, start=datetime.date(2023, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


def _hand(rows, vol=1e6):
    """Bars from (o, h, l, c) tuples, one session each."""
    ts = _dates(len(rows))
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": vol} for t, (o, h, l, c) in zip(ts, rows)]


def _path(start, legs, vol=1e6):
    """Bars along a close path: start, then each (n, target) leg interpolated linearly over n sessions;
    h = c x 1.01, l = c x 0.99, o = the previous close. Returns (bars, [index of each leg's last bar])."""
    closes, ends, c = [float(start)], [], float(start)
    for n, target in legs:
        for k in range(1, n + 1):
            closes.append(c + (target - c) * k / n)
        c = float(target)
        ends.append(len(closes) - 1)
    ts = _dates(len(closes))
    bars, prev = [], closes[0]
    for t, cl in zip(ts, closes):
        bars.append({"t": t, "o": prev, "h": round(cl * 1.01, 6), "l": round(cl * 0.99, 6), "c": cl, "v": vol})
        prev = cl
    return bars, ends


def _base_row(b, start_i, pivot, low, asof_i=None, metrics=True):
    asof_i = len(b) - 1 if asof_i is None else asof_i
    d = {"pivot": pivot, "start_t": b[start_i]["t"], "end_t": b[asof_i]["t"], "low": low,
         "low_t": b[start_i]["t"], "bars": asof_i - start_i, "label": "pivot", "low_label": "base low"}
    row = {"id": "bc:base:SYN", "pattern_id": "bc:base", "sym": "SYN", "start_t": d["start_t"],
           "end_t": d["end_t"], "geometry": {"shape": "base_draw", "extras": {"draw_base": d, "draw_round": 2}}}
    if metrics:
        row = base_metrics.with_metrics([row], b)[0]
    return row


# A flat 9-bar base: bodies top out at 50.00, ONE wick reaches 51.20; the as-of bar (last) spikes to 60.
FLAT = [(49.0, 49.6, 48.6, 49.5), (49.5, 50.3, 49.2, 50.0), (50.0, 51.2, 49.4, 49.6),   # the wick: 51.20
        (49.6, 49.9, 47.0, 47.5), (47.5, 48.0, 46.0, 46.4), (46.4, 47.9, 46.1, 47.8),
        (47.8, 49.4, 47.6, 49.2), (49.2, 50.1, 48.9, 49.9), (49.9, 50.2, 49.3, 49.8),
        (49.8, 60.0, 49.7, 52.0)]                                                         # as-of: high 60


# -- the buy point ----------------------------------------------------------------------------------

def test_the_buy_point_is_the_highest_HIGH_plus_ten_cents_not_the_body_or_the_as_of_bar():
    b = _hand(FLAT)
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    assert m["buy_point"] == 51.30                           # 51.20 + 0.10 (the body top is 50.00)
    assert m["base_high"] == 51.2
    assert m["buy_zone_top"] == round(51.30 * 1.05, 2) == 53.87    # 53.865
    assert m["pct_from_buy_point"] == round((52.0 - 51.30) / 51.30 * 100, 1) == 1.4
    assert m["depth_pct"] == round((51.2 - 46.0) / 51.2 * 100, 1) == 10.2   # from the base HIGH
    assert m["extended"] is False


def test_extended_past_the_buy_zone():
    rows = [r for r in FLAT[:-1]] + [(55.0, 56.0, 54.0, 55.0)]
    m = tn.compute(_base_row(_hand(rows), 0, pivot=50.0, low=46.0), _hand(rows))
    assert m["pct_from_buy_point"] == round((55.0 - 51.30) / 51.30 * 100, 1) == 7.2
    assert m["extended"] is True


def test_a_cup_pivots_on_its_handle_high_and_on_its_rim_without_one():
    b = _hand(FLAT)
    row = {"id": "cup", "pattern_id": "bc:cup-with-handle", "end_t": b[-1]["t"], "geometry": {"extras": {
        "draw_pivot": {"start_t": b[6]["t"], "end_t": b[-1]["t"], "price": 50.0},
        "draw_rim_ref": {"start_t": b[0]["t"], "end_t": b[-1]["t"], "price": 50.0},
        "draw_handle": {"start_t": b[6]["t"], "end_t": b[8]["t"], "top": 50.2, "floor": 48.9}}}}
    assert tn.compute(row, b)["buy_point"] == 50.30           # the handle's high 50.20 + 0.10
    del row["geometry"]["extras"]["draw_handle"]
    assert tn.compute(row, b)["buy_point"] == 51.30           # no handle: the rim's (left-side) high


def test_a_flat_base_pivots_on_the_highest_high_of_its_drawn_span():
    b = _hand(FLAT)
    row = {"id": "fb", "pattern_id": "bc:flat-base", "end_t": b[-1]["t"], "geometry": {"extras": {
        "top": 51.2, "floor": 46.0, "draw_pivot": {"start_t": b[3]["t"], "end_t": b[-1]["t"], "price": 50.0}}}}
    assert tn.compute(row, b)["buy_point"] == 50.30           # bars 3..8: highest high 50.20


def test_nonsense_in_nothing_out():
    b = _hand(FLAT)
    row = _base_row(b, 0, pivot=50.0, low=46.0)
    assert tn.buy_point(0) is None and tn.buy_point(None) is None and tn.buy_point(10) == 10.1
    assert tn.compute(row, b[:-1]) is None                    # the as-of bar is not in the series
    assert tn.compute({**row, "pattern_id": "bull_flag"}, b) is None
    assert tn.compute(None, b) is None and tn.compute(row, None) is None
    bad = copy.deepcopy(row)
    del bad["geometry"]["extras"]["draw_base"]
    assert tn.compute(bad, b) is None


# -- the blind A/B's two defects, on the real drawn spans (bars.db, as of 2026-10-22) ---------------

# PLSE: the member drawing (round 1) as served -- the pivot on the bodies at 55.20, ATR(14) 3.4728 -- and its
# span to the as-of bar. 2026-09-09 printed a wick to 58.90 from a body topping at 52.97: the old textbook rule
# took it as the buy point ("Buy point 59.00 / 26% deep"), over every other price in the base.
PLSE_DRAW = {"pivot": 55.2, "start_t": 20260903, "end_t": 20261022, "low": 43.32, "low_t": 20261016,
             "bars": 34, "atr": 3.4727714285714293, "label": "pivot", "low_label": "base low"}
PLSE_BARS = [
    (20260903, 53.79, 55.37, 53.11, 54.71, 702800), (20260904, 53.68, 54.75, 52.75, 53.24, 515200),
    (20260908, 52.93, 53.105, 47.7, 48.79, 769300), (20260909, 49.76, 58.9, 48.426, 52.97, 1560400),
    (20260910, 52.18, 57.94, 51.3, 54.43, 915500), (20260911, 54.5, 56.61, 50.315, 53.11, 664300),
    (20260914, 52.3, 55.78, 51.6, 54.21, 505832), (20260915, 54.415, 56.61, 53.51, 55.2, 472340),
    (20260916, 52.55, 54.2405, 48.61, 49.61, 1037137), (20260917, 49.46, 53.55, 49.01, 50.61, 571886),
    (20260918, 50.61, 54.29, 50.245, 53.87, 867540), (20260921, 53.97, 54.8099, 51.74, 53.31, 382256),
    (20260922, 53.23, 53.7867, 52.485, 52.69, 372189), (20260923, 53.75, 56.74, 51.87, 51.98, 550631),
    (20260924, 52.18, 53.605, 51.6221, 52.02, 406629), (20260925, 52.17, 54.05, 50.8009, 51.63, 663993),
    (20260928, 51.63, 53.6, 51.14, 52.32, 374814), (20260929, 52.24, 52.74, 48.92, 50.89, 516993),
    (20260930, 51.18, 51.27, 49.17, 49.92, 604607), (20261001, 49.49, 51.56, 49.12, 49.83, 450350),
    (20261002, 50.13, 50.7122, 47.7532, 47.9, 519265), (20261005, 47.89, 50.99, 47.47, 50.5, 433451),
    (20261006, 51.26, 51.26, 48.62, 49.75, 421365), (20261007, 49.11, 49.93, 48.13, 49.09, 409472),
    (20261008, 48.9, 50.32, 47.31, 49.98, 315585), (20261009, 49.98, 53.97, 49.98, 53.81, 367598),
    (20261012, 53.53, 53.98, 50.15, 52.45, 434413), (20261013, 53.02, 53.21, 48.01, 48.54, 455467),
    (20261014, 47.6, 48.9708, 44.8, 46.32, 440297), (20261015, 45.13, 46.67, 43.96, 45.59, 425632),
    (20261016, 45.49, 46.67, 43.32, 44.43, 327426), (20261019, 44.58, 48.12, 44.58, 47.55, 342451),
    (20261020, 47.25, 52.325, 47.25, 50.84, 385979), (20261021, 51.16, 52.03, 50.067, 51.31, 317921),
    (20261022, 50.92, 53.67, 50.0, 52.68, 421424)]

# TECH: a gap-then-flat range, 72.33-72.69 over 22 sessions (ATR 0.133), drawn as a base and labelled
# "0% deep" by both labels.
TECH_DRAW = {"pivot": 72.64, "start_t": 20260922, "end_t": 20261022, "low": 72.33, "low_t": 20260930,
             "bars": 22, "atr": 0.13293571428571177, "label": "pivot", "low_label": "base low"}
TECH_BARS = [
    (20260922, 72.52, 72.69, 72.46, 72.55, 3441497), (20260923, 72.5, 72.64, 72.48, 72.52, 3562210),
    (20260924, 72.54, 72.63, 72.51, 72.57, 2986227), (20260925, 72.59, 72.64, 72.555, 72.61, 2175955),
    (20260928, 72.58, 72.65, 72.485, 72.51, 3820152), (20260929, 72.36, 72.5, 72.36, 72.38, 3360178),
    (20260930, 72.38, 72.55, 72.33, 72.47, 3138664), (20261001, 72.5, 72.54, 72.38, 72.4, 2711405),
    (20261002, 72.44, 72.47, 72.38, 72.4, 1866663), (20261005, 72.41, 72.61, 72.38, 72.58, 2087228),
    (20261006, 72.58, 72.605, 72.41, 72.43, 2893249), (20261007, 72.43, 72.55, 72.43, 72.53, 3153715),
    (20261008, 72.56, 72.58, 72.43, 72.45, 5390348), (20261009, 72.46, 72.52, 72.44, 72.46, 2227970),
    (20261012, 72.47, 72.585, 72.44, 72.56, 2419628), (20261013, 72.49, 72.545, 72.48, 72.48, 2420572),
    (20261014, 72.5, 72.54, 72.48, 72.5, 1544854), (20261015, 72.53, 72.61, 72.5, 72.52, 2403837),
    (20261016, 72.59, 72.59, 72.45, 72.57, 2646349), (20261019, 72.51, 72.55, 72.47, 72.49, 2573896),
    (20261020, 72.48, 72.61, 72.48, 72.58, 3210448), (20261021, 72.54, 72.645, 72.5, 72.64, 3497692),
    (20261022, 72.56, 72.69, 72.5139, 72.62, 4161605)]


def _real(bars, draw):
    b = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": float(v)} for t, o, h, l, c, v in bars]
    row = {"id": "bc:base:REAL", "pattern_id": "bc:base", "sym": "REAL", "start_t": draw["start_t"],
           "end_t": draw["end_t"], "geometry": {"shape": "base_draw",
                                                "extras": {"draw_base": dict(draw), "draw_round": 1}}}
    return b, row


def test_plse_a_spike_wick_through_the_base_is_not_the_buy_point():
    b, row = _real(PLSE_BARS, PLSE_DRAW)
    m = tn.compute(base_metrics.with_metrics([row], b)[0], b)
    assert m["buy_point"] == 58.04 and m["base_high"] == 57.94     # 2026-09-10's high, a ceiling bar
    assert m["depth_pct"] == round((57.94 - 43.32) / 57.94 * 100, 1) == 25.2
    span = b[:-1]
    assert 58.04 - 0.10 == pytest.approx(57.94) and any(x["h"] == 57.94 for x in span)
    assert max(x["h"] for x in span) == 58.9 > m["base_high"]      # the spike is in the span, and ignored


def test_plse_the_guard_refuses_a_buy_point_that_is_not_a_ceiling_bars_high():
    b, row = _real(PLSE_BARS, PLSE_DRAW)
    span, piv, a = b[:-1], PLSE_DRAW["pivot"], PLSE_DRAW["atr"]
    assert tn.buy_point_justified(span, 58.04, piv, a) is True
    assert tn.buy_point_justified(span, 59.00, piv, a) is False    # the spike bar's high + 0.10
    assert tn.buy_point_justified(span, 58.05, piv, a) is False    # not any bar's high + 0.10
    assert tn.buy_point_justified(span, None, piv, a) is False


def test_plse_a_wrong_pivot_high_fails_closed_to_the_old_label(monkeypatch):
    # the selection reverting to "the window's highest high" must not print 59.00: the guard withholds the
    # textbook numbers, and the member keeps the old confirmed label
    b, row = _real(PLSE_BARS, PLSE_DRAW)
    mrow = base_metrics.with_metrics([row], b)[0]
    monkeypatch.setattr(tn, "pivot_high", lambda window, pivot, atr: max(x["h"] for x in window))
    assert tn.compute(mrow, b) is None
    out = tn.with_textbook([mrow], b)
    assert out[0] is mrow and out[0]["geometry"]["extras"]["metrics"]["pivot"] == 55.2


def test_a_ceiling_bars_wick_counts_only_up_to_the_spike_cap():
    b, row = _real(PLSE_BARS, PLSE_DRAW)
    piv, a = PLSE_DRAW["pivot"], PLSE_DRAW["atr"]
    i = next(k for k, x in enumerate(b) if x["t"] == 20260915)     # body top 55.20: ON the drawn ceiling
    b[i]["h"] = round(piv + 1.4 * a, 2)                            # 60.06: under the cap, the top of the base
    assert tn.compute(row, b)["buy_point"] == round(round(piv + 1.4 * a, 2) + 0.10, 2)
    b[i]["h"] = round(piv + 1.6 * a, 2)                            # 60.76: a spike -- left out
    assert tn.compute(row, b)["buy_point"] == 58.04


def test_no_ceiling_bar_or_no_readable_pivot_withholds():
    b, row = _real(PLSE_BARS, PLSE_DRAW)
    assert tn.pivot_high(b[:-1], 80.0, PLSE_DRAW["atr"]) is None   # no body near a ceiling at 80
    bad = copy.deepcopy(row)
    bad["geometry"]["extras"]["draw_base"]["pivot"] = None
    assert tn.compute(bad, b) is None


def test_tech_a_zero_percent_range_gets_no_label_old_or_new():
    b, row = _real(TECH_BARS, TECH_DRAW)
    assert base_metrics.compute(row, b) is None                    # the old label: withheld
    assert base_metrics.with_metrics([row], b)[0] is row           # the drawing row passes through untouched
    assert tn.compute(row, b) is None                              # the new label: withheld
    assert tn.with_textbook(base_metrics.with_metrics([row], b), b)[0] is row


@pytest.mark.parametrize("depth,range_atr,shallow", [
    (2.9, None, True), (3.0, None, False), (0.4, 2.71, True), (None, 9.0, True),
    (10.0, 1.4, True), (10.0, 1.5, False), (25.2, 4.2, False)])
def test_too_shallow(depth, range_atr, shallow):
    assert base_metrics.too_shallow(depth, range_atr) is shallow


# -- the stage count --------------------------------------------------------------------------------

def _chain_series(d_low=166.0):
    """An advance through three bases of THREE different shapes, then the current base:
        A flat base (100 -> 90 -> 100), stage 1 (the series is the full history from the listing);
        B cup / U (130 -> 106 -> 130) after a +30% advance, above A's buy point: stage 2;
        C double bottom / W (165 -> 140 -> 155 -> 138 -> 165) after +27%, above B's buy point: stage 3;
        D the current base (180 -> d_low -> 178) after only +9%: a base-on-base, still stage 3.
    Returns (bars, index of D's left-side high)."""
    legs = [(40, 100),                                        # the advance from the listing
            (15, 90), (15, 100),                              # A: flat
            (20, 130),
            (10, 112), (10, 106), (10, 112), (10, 130),       # B: rounded U
            (20, 165),
            (12, 140), (10, 155), (12, 138), (12, 165),       # C: W, the second low undercutting the first
            (12, 180),
            (12, d_low), (12, 178)]                           # D: the current base, then the as-of bar
    b, ends = _path(50, legs)
    b.append({**b[-1], "t": _dates(len(b) + 1)[-1], "o": 178.0, "h": 179.0, "l": 177.0, "c": 178.5})
    return b, ends[13]


def test_every_base_type_counts_in_the_walk():
    b, d_i = _chain_series()
    events, _, _ = tn._chain(b, d_i)
    bases = [e for e in events if e["kind"] == "base"]
    assert len(bases) == 3 and not [e for e in events if e["kind"] == "reset"]
    assert [round(e["lh"], 2) for e in bases] == [101.0, 131.3, 166.65]   # flat, cup, double bottom


def test_the_stage_counts_across_base_types_and_holds_on_a_base_on_base():
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i, full_history=True) == 3


def test_a_twenty_percent_advance_opens_the_next_stage():
    # D's left-side high pushed to 210 (+26% over C's buy point 166.75): stage 4
    b, d_i = _chain_series()
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 196), (12, 208)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 208.0, "h": 209.0, "l": 207.0,
                   "c": 208.5})
    assert tn.stage_count(legs_b, d_i, full_history=True) == 4


def test_an_undercut_of_the_prior_base_low_resets_to_stage_one():
    b, d_i = _chain_series(d_low=125.0)          # D falls under C's low (136.6): the count resets
    assert tn.stage_count(b, d_i, full_history=True) == 1


def test_an_unanchored_chain_prints_no_stage():
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i, full_history=False) is None   # the history may start mid-advance
    # ... but an undercut inside the window anchors it, unknown history or not
    b, d_i = _chain_series(d_low=125.0)
    assert tn.stage_count(b, d_i, full_history=False) == 1


def test_a_decline_resets_the_count_and_the_first_base_after_it_is_stage_one():
    # 100 -> 200, a 60% decline to 80 (a reset), a rally, base E (110 -> 98 -> 110), +27% to 140, base F
    b, ends = _path(100, [(40, 200), (40, 80), (20, 110), (15, 98), (15, 110), (15, 140), (12, 126), (12, 138)])
    b.append({**b[-1], "t": _dates(len(b) + 1)[-1], "o": 138.0, "h": 139.0, "l": 137.0, "c": 138.5})
    f_i = ends[5]
    events, _, _ = tn._chain(b, f_i)
    assert [e["kind"] for e in events] == ["reset", "base"]
    assert tn.stage_count(b, f_i, full_history=False) == 2     # E = 1 after the decline, F = 2


def test_a_drawn_base_under_a_higher_left_side_high_is_counted_as_that_whole_correction():
    # the drawn base starts on D's right side, under D's left-side high: still D, still stage 3
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i + 14, full_history=True) == 3
    # ... and that whole correction's low is what is checked for the undercut: D fell to 123.75, under C's
    # low, while the drawn right side (from 151.50) never did -- it is stage 1, not stage 3
    b, d_i = _chain_series(d_low=125.0)
    assert min(x["l"] for x in b[d_i + 18:-1]) > 136.62
    assert tn.stage_count(b, d_i + 18, full_history=True) == 1
    # ... and the new left-side high is the whole correction's: D peaks at 210 (+26% over C's buy point
    # 166.75) and the drawn right side tops out at 199.98, under the 20% line (200.10): stage 4, not 3
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 185), (12, 198)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 198.0, "h": 198.5, "l": 197.0,
                   "c": 198.2})
    assert max(x["h"] for x in legs_b[d_i + 18:-1]) < 166.75 * 1.2 < 210 * 1.01
    assert tn.stage_count(legs_b, d_i + 18, full_history=True) == 4


def test_a_twenty_percent_advance_does_not_open_a_stage_when_the_new_base_falls_back_under_the_buy_point():
    # D's left-side high is +26% over C's buy point, but D corrects to 160 (under C's buy point 166.75, above
    # C's low 136.62): it did not form ABOVE the prior buy point, so it is a base-on-base -- stage 3
    b, d_i = _chain_series()
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 160), (12, 208)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 208.0, "h": 209.0, "l": 207.0,
                   "c": 208.5})
    assert tn.stage_count(legs_b, d_i, full_history=True) == 3


# -- volume -----------------------------------------------------------------------------------------

def _vol_series(last_close, last_vol, n=60):
    rows = [(10.0, 10.2, 9.8, 10.0)] * (n - 1) + [(10.0, max(10.2, last_close), 9.9, last_close)]
    b = _hand(rows)
    b[-1]["v"] = last_vol
    return b


@pytest.mark.parametrize("close,vol,want", [
    (10.5, 1.62e6, {"vol_pct": 62, "breakout": True, "light": False}),   # a breakout on +62%
    (10.5, 1.40e6, {"vol_pct": 40, "breakout": True, "light": False}),   # the IBD minimum exactly
    (10.5, 1.22e6, {"vol_pct": 22, "breakout": True, "light": True}),    # a breakout on light volume
    (10.3, 1.0e6, {"vol_pct": 0, "breakout": True, "light": True}),      # AT the buy point counts
    (9.9, 1.50e6, {"vol_pct": 50, "breakout": False, "light": False}),   # below it, notable
    (9.9, 0.55e6, {"vol_pct": -45, "breakout": False, "light": False}),  # below it, a dry-up
    (9.9, 1.20e6, None),                                                 # below it, ordinary: nothing
])
def test_the_volume_readout(close, vol, want):
    assert tn.volume_readout(_vol_series(close, vol), 10.30, True) == want


def test_never_volume_on_a_forming_or_unconfirmed_bar_or_without_a_full_average():
    b = _vol_series(10.5, 1.62e6)
    assert tn.volume_readout(b, 10.30, False) is None
    assert tn.volume_readout(b[-50:], 10.30, True) is None          # 49 prior sessions: no 50-day average
    b[45]["l"] = 8.5                     # a real pullback: a flat 4% range is too shallow to label at all
    row = _base_row(b, 40, pivot=10.0, low=8.5)
    assert "volume" in tn.compute(row, b, asof_complete=lambda t: True)
    assert "volume" not in tn.compute(row, b, asof_complete=lambda t: False)
    assert "volume" not in tn.compute(row, b)                        # no clock: not complete

    def boom(t):
        raise RuntimeError("clock")
    assert "volume" not in tn.compute(row, b, asof_complete=boom)


# -- no lookahead -----------------------------------------------------------------------------------

def test_appending_future_bars_changes_no_number():
    b, d_i = _chain_series()
    row = _base_row(b, d_i, pivot=180.0, low=164.0)
    fut, _ = _path(400, [(30, 90)])
    ts = _dates(len(b) + len(fut))[len(b):]
    longer = b + [{**x, "t": t, "v": 9e9} for x, t in zip(fut, ts)]
    got = tn.compute(row, b, asof_complete=lambda t: True, full_history=True)
    assert got is not None and got.get("stage") == 3
    assert tn.compute(row, longer, asof_complete=lambda t: True, full_history=True) == got


def test_with_textbook_only_on_rows_with_metrics_and_never_mutates():
    b = _hand(FLAT)
    row = _base_row(b, 0, pivot=50.0, low=46.0)
    plain = _base_row(b, 0, pivot=50.0, low=46.0, metrics=False)
    other = {"id": "x", "pattern_id": "draw:inside-day", "geometry": {"extras": {}}}
    before = copy.deepcopy([row, plain, other])
    out = tn.with_textbook([row, plain, other], b)
    assert [row, plain, other] == before
    assert out[1] is plain and out[2] is other
    ex = out[0]["geometry"]["extras"]
    assert ex["metrics_textbook_round"] == tn.TEXTBOOK_ROUND and ex["metrics_textbook"]["buy_point"] == 51.30
    assert list(ex)[:-2] == list(row["geometry"]["extras"])          # appended after the metrics keys


# -- the gates --------------------------------------------------------------------------------------

def _plain_payload(monkeypatch, user):
    """The payload with the textbook step replaced by the identity: what the route served before it."""
    with monkeypatch.context() as m:
        m.setattr(auto_structures, "_with_textbook", lambda rows, bars: rows)
        return _get(user).content


@pytest.mark.parametrize("user", [ADMIN, PAID_MEMBER], ids=["admin", "member"])
@pytest.mark.parametrize("flag", [None, "0", "false"])
def test_flag_off_the_payload_is_byte_identical_and_nothing_runs(monkeypatch, user, flag):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    if flag is None:
        monkeypatch.delenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", flag)
    want = _plain_payload(monkeypatch, user)
    calls = []
    monkeypatch.setattr(tn, "compute", lambda *a, **k: calls.append(1))   # counted, never raised
    got = _get(user).content
    assert got == want and b"metrics_textbook" not in got and b'"metrics"' in got
    assert calls == []


@pytest.mark.parametrize("user", [ADMIN, PAID_MEMBER], ids=["admin", "member"])
def test_textbook_on_but_metrics_off_computes_nothing(monkeypatch, user):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("AUTO_STRUCTURES_METRICS_ENABLED", raising=False)
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    got = _get(user).content
    assert got == _today(monkeypatch, user) and b"metrics" not in got


def test_flag_on_an_admin_sees_the_textbook_numbers(monkeypatch):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    ex = _get(ADMIN).json()["structures"][0]["geometry"]["extras"]
    row = base_metrics.with_metrics([auto_structures.base_draw_row("SYN", b)], b)[0]
    assert ex["metrics_textbook"] == json.loads(json.dumps(tn.compute(
        row, b, asof_complete=auto_structures.last_bar_complete, full_history=True)))
    assert ex["metrics_textbook_round"] == tn.TEXTBOOK_ROUND
    assert ex["metrics"] == base_metrics.compute(row, b)                # the confirmed metrics stay beside


def test_the_member_textbook_round_is_released():
    """Round 1 passed its blind A/B (2026-10-23, new preferred 20-2) and was released by hand, after the two
    defects that check found (PLSE, TECH below) were fixed. Moving either literal is a deliberate act."""
    assert auto_structures.MEMBER_TEXTBOOK_ROUND == 1 and type(auto_structures.MEMBER_TEXTBOOK_ROUND) is int
    assert tn.TEXTBOOK_ROUND == 1


@pytest.mark.parametrize("member_round,shown", [
    (None, False), (1, True), (2, False), ("1", False), (True, False), (1.0, False)])
def test_a_member_sees_the_textbook_numbers_only_on_the_released_round(monkeypatch, member_round, shown):
    b = _synth()
    _flags(monkeypatch, True, True)
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    monkeypatch.setattr(auto_structures, "MEMBER_TEXTBOOK_ROUND", member_round)
    got = _get(PAID_MEMBER)
    ex = got.json()["structures"][0]["geometry"]["extras"]
    assert "metrics" in ex                                              # the confirmed metrics either way
    assert ("metrics_textbook" in ex) is shown and ("metrics_textbook_round" in ex) is shown
    if not shown:   # an unreleased round serves the member exactly the metrics-only payload
        assert got.content == _plain_payload(monkeypatch, PAID_MEMBER)


def test_the_member_strip_returns_a_row_without_textbook_keys_untouched():
    row = {"pattern_id": "bc:base", "geometry": {"extras": {"metrics": {}, "metrics_round": 1}}}
    assert auto_structures._member_textbook(row) is row
