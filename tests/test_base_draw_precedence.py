"""One breakout line per base for a member: auto_structures.member_base_precedence.

A live survey (775 tickers) found bc:base reaching members on 34 charts, and on 6 of them members would
have seen two or three different "pivot" / "breakout" lines for the same base -- a bc:flat-base pivot,
a flat_base box top, or a "flat top" ceiling within a fraction of an ATR of the base pivot. On the
MEMBER path the incumbent (already shipped) drawing wins and bc:base is dropped; admins are unchanged.
The three shapes below are those cases rebuilt synthetically (no ticker, no real price). Public repo.
"""
from __future__ import annotations

import copy
import json

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures as AS
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_base_draw_member_drawing import _synth
from tests.test_member_drawing_set import _flags, _get, _store


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)


@pytest.fixture(scope="module")
def base():
    row = AS.base_draw_row("SYN", _synth())
    assert row is not None
    return row


def _bd(base):
    return base["geometry"]["extras"]["draw_base"]


def _days_before(t, n=400):
    return int(t) - n  # an int YYYYMMDD far before the base (only the order is compared)


def _flat_base_box(base, top, overlap=True):
    bd = _bd(base)
    s, e = (bd["start_t"], bd["end_t"]) if overlap else (_days_before(bd["start_t"], 900), _days_before(bd["start_t"], 500))
    return {"id": "fb", "pattern_id": "bc:flat-base", "start_t": s, "end_t": e,
            "geometry": {"shape": "base_box", "anchors": [{"t": s, "price": top}, {"t": e, "price": top * 0.9}],
                         "extras": {"top": top, "pivot": top, "draw_box": False,
                                    "draw_pivot": {"start_t": s, "end_t": e, "price": top}}}}


def _flat_base_det(base, top, overlap=True):
    bd = _bd(base)
    s, e = (bd["start_t"], bd["end_t"]) if overlap else (_days_before(bd["start_t"], 900), _days_before(bd["start_t"], 500))
    return {"id": "fbd", "pattern_id": "flat_base", "start_t": s, "end_t": e, "levels": {"entry": top},
            "geometry": {"shape": "base_box", "anchors": [{"t": s, "price": top}, {"t": e, "price": top * 0.9}],
                         "extras": {"top": top, "draw_anchors": [{"t": s, "price": top}, {"t": e, "price": top * 0.9}]}}}


def _flat_top(base, price, overlap=True):
    bd = _bd(base)
    s, e = (bd["start_t"], bd["end_t"]) if overlap else (_days_before(bd["start_t"], 900), _days_before(bd["start_t"], 500))
    return {"id": "ft", "pattern_id": "uct_flat_top_breakout", "start_t": s, "end_t": e,
            "levels": {"entry": price},
            "geometry": {"shape": "candle_mark", "anchors": [{"t": e, "price": price}],
                         "extras": {"draw_round": 2, "draw_flat_top": {"price": price, "start_t": s, "end_t": e,
                                                                        "label": "flat top", "touches": []}}}}


def _ids(rows):
    return [r["pattern_id"] for r in rows]


def test_dbc_shape_a_flat_base_pivot_and_box_top_beside_the_base_pivot_keep_the_incumbents(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    boxes = [_flat_base_box(base, p - 0.02 / 33.65 * a * 10), base]
    dets = [_flat_base_det(base, p - 0.13 / 33.65 * a * 10)]
    assert _ids(AS.member_base_precedence(dets, boxes)) == ["bc:flat-base"]


def test_zd_shape_a_pivot_a_tenth_of_an_atr_away(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    assert _ids(AS.member_base_precedence([], [_flat_base_box(base, p - 0.1 * a), base])) == ["bc:flat-base"]


def test_ovv_shape_a_flat_top_ceiling_two_thirds_of_an_atr_above(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    dets = [_flat_top(base, p + 0.66 * a)]
    assert _ids(AS.member_base_precedence(dets, [base])) == []
    # the incumbent detection itself is never touched (only structures are returned)


def test_either_condition_is_enough(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    # level within 1 ATR, spans disjoint
    assert AS.member_base_precedence([_flat_top(base, p + 0.9 * a, overlap=False)], [base]) == []
    # spans overlap, level far away
    assert AS.member_base_precedence([_flat_top(base, p + 6 * a, overlap=True)], [base]) == []


def test_control_an_incumbent_that_covers_another_base_leaves_the_base_drawing(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    far = [_flat_top(base, p + 1.5 * a, overlap=False)]
    box = _flat_base_box(base, p - 3 * a, overlap=False)
    assert _ids(AS.member_base_precedence(far, [box, base])) == ["bc:flat-base", "bc:base"]
    # no incumbent at all: purely additive
    assert AS.member_base_precedence([], [base]) == [base]
    # a non-incumbent row on the same pivot does not displace it
    flag = {"id": "bf", "pattern_id": "bull_flag", "start_t": _bd(base)["start_t"], "end_t": _bd(base)["end_t"],
            "levels": {"entry": p}, "geometry": {"extras": {}}}
    assert AS.member_base_precedence([flag], [base]) == [base]


def test_the_threshold_is_one_atr(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    assert AS.BASE_PRECEDENCE_ATR == 1.0
    assert AS.member_base_precedence([_flat_top(base, p + 0.99 * a, overlap=False)], [base]) == []
    assert AS.member_base_precedence([_flat_top(base, p + 1.01 * a, overlap=False)], [base]) == [base]


def test_fails_closed_without_an_atr_or_a_readable_incumbent_span(base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    no_atr = copy.deepcopy(base)
    del no_atr["geometry"]["extras"]["draw_base"]["atr"]
    far = _flat_top(base, p + 5 * a, overlap=False)
    assert AS.member_base_precedence([far], [no_atr]) == []
    assert AS.member_base_precedence([], [no_atr]) == [no_atr]       # nothing to collide with
    spanless = {"id": "x", "pattern_id": "flat_base", "levels": {"entry": p + 9 * a}, "geometry": {"extras": {}}}
    assert AS.member_base_precedence([spanless], [base]) == []


def test_member_route_drops_the_base_and_the_admin_route_keeps_it(monkeypatch, base):
    p, a = _bd(base)["pivot"], _bd(base)["atr"]
    box = _flat_base_box(base, p - 0.1 * a)
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [])
    monkeypatch.setattr(AS, "structures_for", lambda sym: json.loads(json.dumps([box, base])))
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)
    monkeypatch.setattr(AS, "member_rows", lambda rows: list(rows or []))
    member = _get(PAID_MEMBER).json()
    assert _ids(member["structures"]) == ["bc:flat-base"]
    admin = _get(ADMIN).json()
    assert _ids(admin["structures"]) == ["bc:flat-base", "bc:base"]
    # control: with no incumbent the member gets the base drawing
    monkeypatch.setattr(AS, "structures_for", lambda sym: json.loads(json.dumps([base])))
    assert _ids(_get(PAID_MEMBER).json()["structures"]) == ["bc:base"]


def _stale(row, reason="broke_down"):
    r = copy.deepcopy(row)
    r["geometry"]["extras"].update({"stale": True, "stale_reason": reason})
    return r


def test_a_stale_incumbent_is_never_drawn_so_it_covers_nothing(base):
    """The client drops a stale row (PatternOverlay.selectDrawable), so a stale flat_base / bc:flat-base
    that would have covered the base must not drop the bc:base drawing: the chart would show neither."""
    top = _bd(base)["pivot"]
    for inc in (_flat_base_det(base, top), _flat_base_box(base, top)):
        assert [r["pattern_id"] for r in AS.member_base_precedence([inc], [base])] == []
        assert [r["pattern_id"] for r in AS.member_base_precedence([_stale(inc)], [base])] == ["bc:base"]
        got = [r["pattern_id"] for r in AS.member_base_precedence([], [_stale(inc), base])]
        want = [inc["pattern_id"], "bc:base"]  # the incumbent row itself is never dropped here
        assert got == want
