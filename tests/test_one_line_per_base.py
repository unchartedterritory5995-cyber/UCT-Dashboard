"""One breakout line per base for a member, across detections AND structures:
auto_structures.member_one_line_per_base.

The daily drawing-quality check replays the member path over the liquid universe and flags two DRAWN rows
whose breakout lines sit within 1 ATR(14) of each other over the same bars. Between 2026-10-15 and
2026-10-22 it found seven such charts that no earlier precedence pass covered: the flat_base detector row
beside a bc:flat-base box at the cent (twice), a flat-top ceiling beside flat_base (at the cent and 0.14 ATR
apart), a bull_flag entry 0.28 ATR under a flat_base pivot, a flat_base pivot 0.57 ATR under a double-bottom
pivot, and one near miss at 1.03 ATR. Each case is rebuilt below synthetically (made-up ticker, rounded
geometry, the same prices and ATR distances). Public repo.
"""
from __future__ import annotations

import copy
import json

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures as AS
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store

S, E = 20260901, 20261015          # one base's bars (YYYYMMDD ints: only the order is compared)
FAR_S, FAR_E = 20250101, 20250301  # another base, months earlier


# -- synthetic rows, each in the shape the member path serves --------------------------------------

def _flat_base(p, s=S, e=E, rid="fb"):
    return {"id": rid, "pattern_id": "flat_base", "start_t": s, "end_t": e, "levels": {"entry": round(p * 1.001, 2)},
            "geometry": {"shape": "base_box", "anchors": [{"t": s, "price": p}, {"t": e, "price": p * 0.92}],
                         "extras": {"top": p, "pivot": p, "draw_box": False,
                                    "draw_pivot": {"price": p, "start_t": s, "end_t": e}}}}


def _bc_flat_base(p, s=S, e=E, rid="bcfb"):
    return {"id": rid, "pattern_id": "bc:flat-base", "start_t": s, "end_t": e,
            "geometry": {"shape": "base_box", "anchors": [{"t": s, "price": p}, {"t": e, "price": p * 0.9}],
                         "extras": {"top": p, "pivot": p, "draw_box": False,
                                    "draw_pivot": {"price": p, "start_t": s, "end_t": e}}}}


def _flat_top(p, s=S, e=E, rid="ft"):
    return {"id": rid, "pattern_id": "uct_flat_top_breakout", "start_t": s, "end_t": e, "levels": {"entry": p},
            "geometry": {"shape": "candle_mark", "anchors": [{"t": e, "price": p}],
                         "extras": {"draw_round": 2, "draw_flat_top": {
                             "price": p, "start_t": s, "end_t": e, "label": "flat top",
                             "touches": [{"t": s, "price": p}, {"t": s + 20, "price": p}, {"t": e, "price": p}]}}}}


def _bull_flag(p, s=S, e=E, rid="bf"):
    return {"id": rid, "pattern_id": "bull_flag", "start_t": s, "end_t": e, "levels": {"entry": p + 0.05},
            "draw_entry": True,
            "geometry": {"shape": "flag", "anchors": [{"t": s, "price": p * 0.9}, {"t": e, "price": p}],
                         "extras": {"draw_round": 9, "draw_entry_price": p}}}


def _double_bottom(p, s=S, e=E, rid="db"):
    return {"id": rid, "pattern_id": "draw:double-bottom", "start_t": s, "end_t": e,
            "geometry": {"shape": "double_bottom", "anchors": [],
                         "extras": {"draw_round": 2, "draw_shape": {
                             "shape": "double-bottom", "pivot": p, "low": p * 0.85, "start_t": s, "end_t": e,
                             "label": "pivot", "low_label": "base low", "draw_round": 2,
                             "marks": [{"t": s + 10, "price": p * 0.85}, {"t": e - 10, "price": p * 0.86}]}}}}


def _cup(p, s=S, e=E, rid="cup"):
    return {"id": rid, "pattern_id": "bc:cup-with-handle", "start_t": s, "end_t": e,
            "geometry": {"shape": "base_box", "anchors": [],
                         "extras": {"draw_box": False, "draw_pivot": {"price": p, "start_t": s, "end_t": e},
                                    "draw_handle": {"top": p, "floor": p * 0.95, "start_t": e - 10, "end_t": e}}}}


def _base(p, s=S, e=E, rid="base"):
    return {"id": rid, "pattern_id": "bc:base", "start_t": s, "end_t": e,
            "geometry": {"shape": "base_draw", "anchors": [],
                         "extras": {"draw_round": 2, "draw_base": {
                             "pivot": p, "low": p * 0.88, "start_t": s, "end_t": e, "atr": 1.0,
                             "label": "pivot", "low_label": "base low"}}}}


def _ids(rows):
    return [r["pattern_id"] for r in rows]


def _bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def _run(dets, sts, atr):
    """Run the pass on deep copies; also assert every kept row comes back as the very object passed in."""
    d0, s0 = copy.deepcopy(dets), copy.deepcopy(sts)
    before = _bytes([d0, s0])
    od, os_ = AS.member_one_line_per_base(d0, s0, atr=atr)
    ins = {id(r) for r in d0 + s0}
    assert all(id(r) in ins for r in od + os_), "a kept row was replaced, not passed through"
    assert _bytes([d0, s0]) == before, "the pass modified a row it was handed"
    return od, os_


# -- the seven charts the check found --------------------------------------------------------------

def test_ACVA_shape_flat_base_and_bc_flat_base_at_the_cent_keep_the_box_pivot():
    d, s = _run([_flat_base(10.50)], [_bc_flat_base(10.50)], atr=0.40)
    assert (_ids(d), _ids(s)) == ([], ["bc:flat-base"])


def test_EQH_shape_flat_base_and_bc_flat_base_at_the_cent_keep_the_box_pivot():
    d, s = _run([_flat_base(55.06)], [_bc_flat_base(55.06)], atr=1.30)
    assert (_ids(d), _ids(s)) == ([], ["bc:flat-base"])


def test_TX_shape_flat_top_and_flat_base_at_the_cent_keep_the_flat_top():
    # the detection order is the store's; the flat base came first on the real chart
    d, s = _run([_flat_base(59.32), _flat_top(59.32)], [], atr=1.10)
    assert (_ids(d), _ids(s)) == (["uct_flat_top_breakout"], [])


def test_A_shape_flat_top_177_05_over_flat_base_176_38_keep_the_flat_top():
    a = (177.05 - 176.38) / 0.14             # the two lines were 0.14 ATR apart
    d, s = _run([_flat_top(177.05), _flat_base(176.38)], [], atr=a)
    assert (_ids(d), _ids(s)) == (["uct_flat_top_breakout"], [])


def test_SONO_shape_bull_flag_entry_under_the_flat_base_pivot_keep_the_flat_base():
    a = (18.25 - 18.08) / 0.28
    d, s = _run([_bull_flag(18.08), _flat_base(18.25)], [], atr=a)
    assert (_ids(d), _ids(s)) == (["flat_base"], [])


def test_CBC_shape_flat_base_under_the_double_bottom_pivot_keep_the_double_bottom():
    a = (33.48 - 33.07) / 0.57
    d, s = _run([_flat_base(33.07)], [_double_bottom(33.48)], atr=a)
    assert (_ids(d), _ids(s)) == ([], ["draw:double-bottom"])


def test_ROKU_shape_a_near_miss_at_1_03_atr_is_untouched_byte_identical():
    a = 1.0
    dets, sts = [_flat_base(100.00)], [_bc_flat_base(100.00 + 1.03 * a)]
    d, s = _run(dets, sts, atr=a)
    assert _bytes([d, s]) == _bytes([dets, sts])


# -- the rule's edges ------------------------------------------------------------------------------

def test_the_threshold_is_one_atr_inclusive():
    for gap, kept in ((0.999, 1), (1.0, 1), (1.001, 2)):
        d, s = _run([_flat_base(50.0)], [_bc_flat_base(50.0 + gap)], atr=1.0)
        assert len(d) + len(s) == kept, gap


def test_non_overlapping_spans_are_untouched_byte_identical():
    dets = [_flat_base(20.0, FAR_S, FAR_E), _bull_flag(20.0)]
    sts = [_bc_flat_base(20.0)]
    # the flat base is a different, earlier base; the flag and the box share one base -> only they meet
    d, s = _run(dets, sts, atr=1.0)
    assert (_ids(d), _ids(s)) == (["flat_base"], ["bc:flat-base"])
    # and with nothing overlapping at all, the whole payload comes back byte-identical
    dets2, sts2 = [_flat_base(20.0, FAR_S, FAR_E)], [_bc_flat_base(20.0)]
    d2, s2 = _run(dets2, sts2, atr=1.0)
    assert _bytes([d2, s2]) == _bytes([dets2, sts2])


def test_a_chart_with_one_drawing_or_none_is_byte_identical_and_reads_no_atr():
    def boom():
        raise AssertionError("ATR read for a chart with nothing to compare")
    for dets, sts in (([], []), ([_flat_base(9.0)], []), ([], [_bc_flat_base(9.0)]),
                      ([_flat_base(9.0, FAR_S, FAR_E)], [_bc_flat_base(9.0)])):
        d, s = _run(dets, sts, atr=boom)
        assert _bytes([d, s]) == _bytes([dets, sts])


def test_two_rows_of_the_same_id_are_left_to_that_drawings_own_rules():
    for make in (_bull_flag, _flat_base, _flat_top, _bc_flat_base):
        a, b = make(25.0, rid="a"), make(25.0, rid="b")
        dets = [a, b] if not a["pattern_id"].startswith("bc:") else []
        sts = [a, b] if a["pattern_id"].startswith("bc:") else []
        d, s = _run(dets, sts, atr=1.0)
        assert _bytes([d, s]) == _bytes([dets, sts]), make.__name__
    # and still so when a row of another id shares the bars (so the pass does compare lines), far away
    dets = [_bull_flag(25.0, rid="a"), _bull_flag(25.0, rid="b"), _flat_base(40.0)]
    d, s = _run(dets, [], atr=1.0)
    assert _bytes([d, s]) == _bytes([dets, []])


def test_rows_outside_the_priority_list_are_never_touched():
    pull = {"id": "pb", "pattern_id": "uct_pullback_ma_v5", "start_t": S, "end_t": E, "levels": {"entry": 10.0},
            "draw_entry": True, "geometry": {"shape": "ma", "anchors": [], "extras": {
                "draw_pivot": {"price": 10.0, "start_t": S, "end_t": E}}}}
    inside = {"id": "id", "pattern_id": "draw:inside-day", "start_t": E - 2, "end_t": E,
              "geometry": {"shape": "inside_day", "anchors": [], "extras": {"draw_inside_day": {
                  "trigger": 10.0, "stop": 9.5, "start_t": E - 2, "end_t": E, "atr": 1.0}}}}
    shelf = {"id": "sh", "pattern_id": "draw:shelf-pivot", "start_t": S, "end_t": E,
             "geometry": {"shape": "shelf_pivot", "anchors": [], "extras": {"draw_shelf": {
                 "price": 10.0, "start_t": S, "end_t": E}}}}
    d, s = _run([pull, _flat_base(10.0)], [inside, shelf], atr=1.0)
    assert (_ids(d), _ids(s)) == (["uct_pullback_ma_v5", "flat_base"], ["draw:inside-day", "draw:shelf-pivot"])


def test_a_stale_row_is_never_drawn_so_it_neither_covers_nor_is_removed():
    stale = _flat_top(30.0)
    stale["geometry"]["extras"].update({"stale": True, "stale_reason": "broke_down"})
    d, s = _run([stale, _flat_base(30.0)], [], atr=1.0)
    assert _ids(d) == ["uct_flat_top_breakout", "flat_base"]


def test_the_flagging_tier_draws_no_entry_line_so_it_meets_nothing(monkeypatch):
    flag = _bull_flag(18.08)
    del flag["geometry"]["extras"]["draw_round"]
    flag["geometry"]["extras"].update({"stale": True, "stale_reason": "x",
                                       "flagging": {"tier": "flagging", "draw_round": 9}})
    monkeypatch.setattr(AS._display, "FLAGGING_REASONS", frozenset({"x"}))
    assert AS._flagging_flag(flag) and AS._drawn_incumbent(flag)    # drawn, as the faint tier
    d, s = _run([flag, _flat_base(18.25)], [], atr=1.0)
    assert _ids(d) == ["bull_flag", "flat_base"]


@pytest.mark.parametrize("winner,loser", [
    (_cup, _flat_top), (_cup, _double_bottom), (_double_bottom, _flat_top), (_flat_top, _bc_flat_base),
    (_bc_flat_base, _flat_base), (_flat_base, _base), (_base, _bull_flag), (_flat_top, _bull_flag),
])
def test_the_priority_order_decides_every_pair(winner, loser):
    w, lo = winner(40.0), loser(40.2)
    for order in ((w, lo), (lo, w)):
        rows = list(order)
        dets = [r for r in rows if not r["pattern_id"].startswith(("bc:", "draw:"))]
        sts = [r for r in rows if r["pattern_id"].startswith(("bc:", "draw:"))]
        d, s = _run(dets, sts, atr=1.0)
        assert _ids(d + s) == [w["pattern_id"]], order


def test_the_priority_order_is_the_documented_literal():
    assert AS.ONE_LINE_PER_BASE_PRIORITY == (
        "bc:cup-with-handle", "draw:double-bottom", "uct_flat_top_breakout", "bc:flat-base", "flat_base",
        "bc:base", "bull_flag", "draw:donchian_breakout", "draw:rectangle")
    assert AS.ONE_LINE_PER_BASE_ATR == 1.0


def test_three_rows_on_one_base_keep_exactly_one_and_the_order_of_the_rest():
    other = _flat_base(80.0, FAR_S, FAR_E, rid="other")
    dets = [_bull_flag(18.10), other, _flat_base(18.25), _flat_top(18.20)]
    d, s = _run(dets, [_bc_flat_base(18.22)], atr=0.6)
    assert (_ids(d), _ids(s)) == (["flat_base", "uct_flat_top_breakout"], [])
    assert d[0]["id"] == "other"


def test_without_an_atr_only_lines_at_the_same_cent_are_one_line():
    """No bars ATR and no stamped ATR: the exact duplicates (ACVA / EQH / TX) still go, and a distinct
    line is never hidden on a guessed width."""
    for atr in (None, 0, -1.0, float("nan"), lambda: None):
        d, s = _run([_flat_base(10.50)], [_bc_flat_base(10.50)], atr=atr)
        assert (_ids(d), _ids(s)) == ([], ["bc:flat-base"]), atr
        d, s = _run([_flat_base(10.50)], [_bc_flat_base(10.52)], atr=atr)
        assert (_ids(d), _ids(s)) == (["flat_base"], ["bc:flat-base"]), atr


def test_without_a_bars_atr_a_stamped_atr_is_used():
    db = _double_bottom(33.48)
    db["geometry"]["extras"]["draw_shape"]["atr"] = 0.72
    d, s = _run([_flat_base(33.07)], [db], atr=None)
    assert (_ids(d), _ids(s)) == ([], ["draw:double-bottom"])
    db["geometry"]["extras"]["draw_shape"]["atr"] = 0.30          # 0.41 apart > 0.30
    d, s = _run([_flat_base(33.07)], [db], atr=None)
    assert (_ids(d), _ids(s)) == (["flat_base"], ["draw:double-bottom"])


def test_an_unexpected_error_keeps_only_the_highest_priority_row():
    def broken():
        raise RuntimeError("bars store down")
    d, s = _run([_flat_base(10.0), _bull_flag(12.0)], [_bc_flat_base(10.0)], atr=broken)
    assert (_ids(d), _ids(s)) == ([], ["bc:flat-base"])


def test_daily_atr14_is_the_mean_true_range_of_the_last_14_sessions(monkeypatch):
    bars = [{"t": i, "o": 10, "h": 11, "l": 9, "c": 10, "v": 1} for i in range(30)]
    bars[-1] = {"t": 29, "o": 10, "h": 16, "l": 9, "c": 15, "v": 1}     # one wide bar: TR 7
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: bars)
    assert AS.daily_atr14("ZZZ") == pytest.approx((13 * 2 + 7) / 14)
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: bars[:14])
    assert AS.daily_atr14("ZZZ") is None
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: (_ for _ in ()).throw(OSError("x")))
    assert AS.daily_atr14("ZZZ") is None


# -- the route: members get one line, admins are unchanged ----------------------------------------

def test_member_route_serves_one_line_and_the_admin_route_is_unchanged(monkeypatch):
    dets = [_flat_base(10.50, rid="m1"), {**_flat_top(30.0, FAR_S, FAR_E), "id": "m2"}]
    box = _bc_flat_base(10.50)
    for r in dets:
        r["tf"] = "D"
    _flags(monkeypatch, True, True)
    _store(monkeypatch, dets)
    # this rail is about one line per base; the interim recert textbook gate (test_textbook_pivot_gate.py) would
    # withhold the synthetic flat top on its own, so it is switched off here
    monkeypatch.setattr(AS, "MEMBER_PIVOT_GATE_ROUND", None)
    monkeypatch.setattr(AS, "structures_for", lambda sym: json.loads(json.dumps([box])))
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)
    monkeypatch.setattr(AS, "member_rows", lambda rows: list(rows or []))
    monkeypatch.setattr(AS, "fresh_member_rows", lambda sym, tf, rows: list(rows))
    monkeypatch.setattr(AS, "daily_atr14", lambda sym: 0.40)
    member = _get(PAID_MEMBER).json()
    assert [r["id"] for r in member["detections"]] == ["m2"]
    assert member["count"] == 1
    assert _ids(member["structures"]) == ["bc:flat-base"]
    admin = _get(ADMIN).json()
    assert sorted(r["id"] for r in admin["detections"]) == ["m1", "m2"]
    # control: with the box gone, the member keeps the flat base
    monkeypatch.setattr(AS, "structures_for", lambda sym: [])
    member = _get(PAID_MEMBER).json()
    assert [r["id"] for r in member["detections"]] == ["m1", "m2"] and member["count"] == 2


# -- the bc:base line as DRAWN: textbook round 2 draws it at metrics_textbook.line, not the body pivot --------

def _base_tb(body, line, low=None, rid="base"):
    """A bc:base row whose body pivot is `body` and whose released textbook numbers draw the top line at `line`
    (buy point = line + $0.10), as the member path serves it after with_metrics."""
    r = _base(body, rid=rid)
    if low is not None:
        r["geometry"]["extras"]["draw_base"]["low"] = low
    r["geometry"]["extras"]["metrics_textbook"] = {"line": line, "buy_point": round(line + 0.10, 2)}
    r["geometry"]["extras"]["metrics_textbook_round"] = AS.MEMBER_TEXTBOOK_ROUND
    return r


def test_bodies_more_than_one_atr_apart_but_drawn_lines_within_one_atr_dedupe_to_one():
    # body pivot 50.00 is 1.30 ATR under the bull_flag entry 51.30; the DRAWN line 51.20 is 0.10 ATR from it
    d, s = _run([_bull_flag(51.30)], [_base_tb(50.00, 51.20)], atr=1.0)
    assert (_ids(d), _ids(s)) == ([], ["bc:base"])
    # control: the same body without the textbook line keeps both (the body is what is drawn then)
    d, s = _run([_bull_flag(51.30)], [_base(50.00)], atr=1.0)
    assert (_ids(d), _ids(s)) == (["bull_flag"], ["bc:base"])


def test_bodies_within_one_atr_but_drawn_lines_more_than_one_atr_apart_keep_both():
    # body pivot 50.00 is 0.50 ATR under the bull_flag entry 50.50; the DRAWN line 51.60 is 1.10 ATR over it
    dets, sts = [_bull_flag(50.50)], [_base_tb(50.00, 51.60)]
    d, s = _run(dets, sts, atr=1.0)
    assert _bytes([d, s]) == _bytes([dets, sts])
    # control: without the textbook line the body is drawn and the two are one line
    d, s = _run([_bull_flag(50.50)], [_base(50.00)], atr=1.0)
    assert (_ids(d), _ids(s)) == ([], ["bc:base"])


@pytest.mark.parametrize("tb", [
    {"line": 51.20, "buy_point": 51.20},          # buy point not above the line
    {"line": 40.00, "buy_point": 40.10},          # line not above the low (44.00)
    {"line": None, "buy_point": 51.30},
    {"line": "x", "buy_point": 51.30},
    {"line": 51.20},                              # no buy point
    {"line": float("nan"), "buy_point": 51.30},
    "51.20",                                      # not a dict
])
def test_a_malformed_textbook_stamp_falls_back_to_the_body_pivot_as_the_chart_does(tb):
    r = _base(50.00)
    r["geometry"]["extras"]["metrics_textbook"] = tb
    assert AS._breakout_lines(r) == [(50.00, S, E)]


def test_a_released_textbook_line_is_the_bc_base_breakout_line():
    assert AS._breakout_lines(_base_tb(50.00, 51.20)) == [(51.20, S, E)]


def test_member_route_compares_the_drawn_line_metrics_attached_before_the_one_line_pass(monkeypatch):
    """The route attaches metrics (with_metrics) BEFORE member_one_line_per_base: with the metrics pass after it,
    the bull_flag 1.30 ATR over the body would survive beside a bc:base line drawn 0.10 ATR under it."""
    flag = {**_bull_flag(51.30), "id": "bf1", "tf": "D"}
    box = _base(50.00)

    def fake_metrics(sym, rows, *, member=False):
        out = []
        for r in rows or []:
            if r.get("pattern_id") == "bc:base":
                ex = {**r["geometry"]["extras"], "metrics_textbook": {"line": 51.20, "buy_point": 51.30},
                      "metrics_textbook_round": AS.MEMBER_TEXTBOOK_ROUND}
                r = {**r, "geometry": {**r["geometry"], "extras": ex}}
            out.append(r)
        return out

    _flags(monkeypatch, True, True)
    _store(monkeypatch, [flag])
    monkeypatch.setattr(AS, "structures_for", lambda sym: json.loads(json.dumps([box])))
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)
    monkeypatch.setattr(AS, "member_rows", lambda rows: list(rows or []))
    monkeypatch.setattr(AS, "fresh_member_rows", lambda sym, tf, rows: list(rows))
    monkeypatch.setattr(AS, "member_trend_gate", lambda sym, d, s: (list(d), list(s)))
    monkeypatch.setattr(AS, "shelf_pivot_row", lambda *a, **k: None)
    monkeypatch.setattr(AS, "daily_atr14", lambda sym: 1.0)
    monkeypatch.setattr(AS, "with_metrics", fake_metrics)
    member = _get(PAID_MEMBER).json()
    assert member["detections"] == [] and member["count"] == 0
    assert _ids(member["structures"]) == ["bc:base"]
    assert member["structures"][0]["geometry"]["extras"]["metrics_textbook"]["line"] == 51.20
    # control: metrics that draw nothing new (the body line) keep both
    monkeypatch.setattr(AS, "with_metrics", lambda sym, rows, member=False: rows)
    member = _get(PAID_MEMBER).json()
    assert [r["id"] for r in member["detections"]] == ["bf1"] and member["count"] == 1
    assert _ids(member["structures"]) == ["bc:base"]
