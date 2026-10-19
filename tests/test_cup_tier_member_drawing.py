"""The cup tier on live cup rows (lab cup_tier_v2 recognition + cup_draw_v4 drawing round 4): the stamp, the
member gate, and what a member is drawn. Synthetic ids and prices only (public repo).

  * a row the tier does not stamp is byte-identical to the row without the stamp code (stamp off / stamp None);
  * the stamp adds ONE key, extras.cup_tier, and nothing else;
  * a forming session is dropped before the stamp is computed (the lab judged finished sessions), and an
    unknown or failing session clock stamps NOTHING (fail closed);
  * on the member path a served cup outranks a bc:flat-base (member_cup_precedence) and a bc:base
    (member_base_precedence) covering the same base; admin output is unchanged;
  * the member gate serves a cup row ONLY with the confirmed round (a literal), not withheld, well formed --
    every near miss fails closed, with a control proving the gate can pass;
  * a member is drawn the TIER's pivot / handle / rim reference in place of the admin rounds' drawing, and the
    admin row is not modified;
  * the route serves a stamped cup to a member and an unstamped one to nobody but admins.
"""
from __future__ import annotations

import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures, barspack
from api.services.pattern_engine import cup_tier
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, authorize

CUP = "bc:cup-with-handle"
#: The drawing round the blind packets confirmed (lab cup_draw_v4). Pinned as a literal.
CONFIRMED_ROUND = 4
BOX = {"structure_key": "cup-with-handle", "name": "Cup with handle", "label": "Cup with handle",
       "start_t": 20260601, "end_t": 20261015, "top": 142.1, "floor": 120.4, "pivot": 142.1,
       "bars": 95, "sub_boxes": [], "source": "cup_with_handle_state"}
ADMIN_PIVOT = {"start_t": 20260601, "end_t": 20261015, "price": 142.1}
PIVOT_H = {"start_t": 20260920, "end_t": 20261015, "price": 140.2}
RIM = {"start_t": 20260601, "end_t": 20261015, "price": 142.1}
HANDLE = {"start_t": 20260920, "end_t": 20261015, "top": 140.2, "floor": 136.0}
URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


def _stamp(**over):
    st = {"tier": "cup_conf", "v": 2, "t": 0.945, "C": 0.95, "lip_t": 20260601, "low_t": 20260715,
          "right_t": 20260920, "asof_t": 20261015, "atr": 1.5, "draw_round": CONFIRMED_ROUND, "withheld": None,
          "m": {"short_atr": 0.5}, "pivot_at": "handle_high", "pivot": dict(PIVOT_H), "rim_ref": dict(RIM),
          "handle": dict(HANDLE)}
    st.update(over)
    return st


def _cup_row(stamp=None, **extras):
    """A cup base box as box_to_detection + _team_pivot leave it (admin drawing: rim pivot, box off)."""
    d = auto_structures.box_to_detection("ZZZ", dict(BOX))
    d["geometry"]["extras"].update({"draw_pivot": dict(ADMIN_PIVOT), "draw_box": False,
                                    "draw_handle": {"start_t": 20261001, "end_t": 20261015, "top": 141.0,
                                                    "floor": 139.0}})
    d["geometry"]["extras"].update(extras)
    if stamp is not None:
        d["geometry"]["extras"]["cup_tier"] = stamp
    return d


def _bars(n=260):
    out, t = [], 20250101
    for i in range(n):
        out.append({"t": t + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1e6})
    return out


# -- the round ----------------------------------------------------------------------------------

def test_the_confirmed_round_is_4_and_the_drawing_code_is_round_4():
    """Pinned to the round the blind check confirmed; if the drawing code moves on, the second line goes red and
    members stop getting the cup (fail closed) until the new round is confirmed by hand."""
    assert auto_structures.MEMBER_CUP_TIER_ROUND == CONFIRMED_ROUND
    assert cup_tier.DRAW_ROUND == CONFIRMED_ROUND
    assert type(auto_structures.MEMBER_CUP_TIER_ROUND) is int


def test_the_cup_is_in_the_member_set_and_still_trusted_for_admins():
    assert CUP in registry.DISPLAY_MEMBER_SET
    assert registry.display_policy(CUP)["display_tier"] == "trusted"


# -- the stamp on a row ---------------------------------------------------------------------------

def test_an_unstamped_row_is_byte_identical(monkeypatch):
    row = _cup_row()
    before = json.dumps(row, sort_keys=True)
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: None)
    _clock(monkeypatch, 99991231)
    auto_structures.cup_tier_stamp(row, _bars())
    assert json.dumps(row, sort_keys=True) == before


def test_the_stamp_adds_one_key_and_nothing_else(monkeypatch):
    row = _cup_row()
    before = copy.deepcopy(row)
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: _stamp())
    _clock(monkeypatch, 99991231)
    auto_structures.cup_tier_stamp(row, _bars())
    ex = row["geometry"]["extras"]
    assert ex.pop("cup_tier") == _stamp()
    assert row == before


def test_only_a_cup_row_is_stamped(monkeypatch):
    seen = []
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: seen.append(1) or _stamp())
    row = auto_structures.box_to_detection("ZZZ", {**BOX, "structure_key": "flat-base"})
    before = json.dumps(row, sort_keys=True)
    auto_structures.cup_tier_stamp(row, _bars())
    assert json.dumps(row, sort_keys=True) == before and seen == []


def _clock(monkeypatch, value):
    """Pin barspack's newest-complete-session clock (an int YYYYMMDD, None, or an exception to raise)."""
    def fake(now=None):
        if isinstance(value, BaseException):
            raise value
        return value
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", fake)


def test_a_forming_session_is_dropped_before_the_stamp(monkeypatch):
    got = []
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: got.append(list(bars)) or None)
    bars = _bars()
    _clock(monkeypatch, bars[-2]["t"])                           # the last bar is after the newest close
    auto_structures.cup_tier_stamp(_cup_row(), bars)
    assert got[-1] == bars[:-1]
    _clock(monkeypatch, bars[-1]["t"])
    auto_structures.cup_tier_stamp(_cup_row(), bars)
    assert got[-1] == bars                                       # control: a complete bar is kept


@pytest.mark.parametrize("clock", [None, RuntimeError("clock down")], ids=["clock-None", "clock-raises"])
def test_an_unknown_or_failing_session_clock_stamps_nothing(clock, monkeypatch):
    """Fail closed: last_bar_forming answers False (keep the bar) on an unknown clock; the stamp must
    not inherit that, so with no readable clock the tier is never even asked."""
    asked = []
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: asked.append(1) or _stamp())
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)
    _clock(monkeypatch, clock)
    row = _cup_row()
    before = json.dumps(row, sort_keys=True)
    auto_structures.cup_tier_stamp(row, _bars())
    assert asked == [] and json.dumps(row, sort_keys=True) == before
    _clock(monkeypatch, 99991231)                                # control: a readable clock stamps
    auto_structures.cup_tier_stamp(row, _bars())
    assert asked == [1] and row["geometry"]["extras"]["cup_tier"] == _stamp()


@pytest.mark.parametrize("bars", [None, [], [{"t": 1}], "junk", [{"t": 20260101, "o": None}] * 300])
def test_junk_never_raises_and_never_stamps(bars, monkeypatch):
    _clock(monkeypatch, 99991231)
    row = _cup_row()
    before = json.dumps(row, sort_keys=True)
    auto_structures.cup_tier_stamp(row, bars)
    assert json.dumps(row, sort_keys=True) == before


def test_the_real_stamp_holds_nothing_on_a_flat_series():
    assert cup_tier.stamp(_bars(600)) is None
    assert cup_tier.stamp(_bars(100)) is None


def test_structures_for_calls_the_stamp_on_every_served_cup_row(monkeypatch):
    """The wire: structures_for runs the stamp on a cup box, so a fire reaches the row."""
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: _bars(600))
    import api.services.screener.base_catalog as bc
    monkeypatch.setattr(bc, "current_base_structures", lambda bars: [dict(BOX)])
    monkeypatch.setattr(auto_structures, "_team_pivot", lambda ex, *a, **k: ex.update(
        {"draw_pivot": dict(ADMIN_PIVOT), "draw_box": False}))
    monkeypatch.setattr(cup_tier, "stamp", lambda bars: _stamp())
    _clock(monkeypatch, 99991231)
    auto_structures._CACHE.clear()
    try:
        rows = auto_structures.structures_for("ZZZ")
    finally:
        auto_structures._CACHE.clear()
    assert [r["pattern_id"] for r in rows] == [CUP]
    assert rows[0]["geometry"]["extras"]["cup_tier"] == _stamp()


# -- the member gate ------------------------------------------------------------------------------

def _policy(row):
    return {**row, **registry.display_policy(CUP)}


def test_a_confirmed_stamp_is_served_with_the_tiers_drawing():
    row = _policy(_cup_row(_stamp()))
    admin_before = copy.deepcopy(row)
    served = auto_structures.member_rows([row])
    assert len(served) == 1
    ex = served[0]["geometry"]["extras"]
    assert ex["draw_pivot"] == PIVOT_H and ex["draw_handle"] == HANDLE and ex["draw_rim_ref"] == RIM
    assert ex["draw_box"] is False
    assert ex["cup_tier"] == _stamp()
    assert row == admin_before                                   # the admin row is not modified


def test_a_rim_pivot_stamp_draws_no_rim_reference_and_drops_the_admin_one():
    row = _policy(_cup_row(_stamp(pivot_at="rim", pivot=dict(RIM), rim_ref=None),
                           draw_rim_ref=dict(RIM), draw_sub_boxes=[{"start_t": 1, "end_t": 2}]))
    ex = auto_structures.member_rows([row])[0]["geometry"]["extras"]
    assert ex["draw_pivot"] == RIM and "draw_rim_ref" not in ex and "draw_sub_boxes" not in ex
    assert ex["draw_handle"] == HANDLE


def test_every_near_miss_fails_closed():
    nan = float("nan")
    variants = [
        _cup_row(),                                              # unstamped
        _cup_row(_stamp(), stale=True),
        _cup_row(_stamp(draw_round=CONFIRMED_ROUND - 1)),
        _cup_row(_stamp(draw_round=CONFIRMED_ROUND + 1)),
        _cup_row(_stamp(draw_round=str(CONFIRMED_ROUND))),
        _cup_row(_stamp(draw_round=float(CONFIRMED_ROUND))),
        _cup_row(_stamp(draw_round=None)),
        _cup_row(_stamp(tier="cup")),
        _cup_row(_stamp(withheld="handle_deep")),
        _cup_row({k: v for k, v in _stamp().items() if k != "withheld"}),
        _cup_row(_stamp(pivot=None)),
        _cup_row(_stamp(pivot={**PIVOT_H, "price": nan})),
        _cup_row(_stamp(pivot={**PIVOT_H, "price": "x"})),
        _cup_row(_stamp(pivot={"price": 140.2})),
        _cup_row(_stamp(pivot={**PIVOT_H, "start_t": 20261016})),   # start after end
        _cup_row(_stamp(handle=None)),
        _cup_row(_stamp(handle={**HANDLE, "top": 130.0})),           # top below floor
        _cup_row(_stamp(handle={**HANDLE, "floor": float("inf")})),
        _cup_row(_stamp(rim_ref=None)),                              # handle_high without a rim reference
        _cup_row(_stamp(pivot_at="rim")),                            # rim pivot WITH a rim reference
        _cup_row(_stamp(pivot_at="lip")),
        _cup_row("not a dict"),
    ]
    assert auto_structures.member_rows([_policy(v) for v in variants]) == []
    assert len(auto_structures.member_rows([_policy(_cup_row(_stamp()))])) == 1   # control: the gate can pass


def test_a_newer_drawing_round_is_not_served_until_confirmed(monkeypatch):
    monkeypatch.setattr(cup_tier, "DRAW_ROUND", CONFIRMED_ROUND + 1)
    st = _stamp(draw_round=cup_tier.DRAW_ROUND)
    assert auto_structures.member_rows([_policy(_cup_row(st))]) == []


def test_other_member_rows_pass_through_untouched():
    flat = auto_structures.box_to_detection("ZZZ", {**BOX, "structure_key": "flat-base"})
    flat["geometry"]["extras"].update({"draw_pivot": dict(ADMIN_PIVOT), "draw_box": False})
    flat = {**flat, **registry.display_policy("bc:flat-base")}
    assert auto_structures.member_rows([flat]) == [flat]
    assert auto_structures.member_rows([flat])[0] is flat


# -- through the route ----------------------------------------------------------------------------

def _flags(monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_MEMBERS_ENABLED", "1")


def _get(user):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    return TestClient(app).get(URL)


def test_the_route_serves_a_stamped_cup_to_a_member_and_an_unstamped_one_only_to_admins(monkeypatch):
    _flags(monkeypatch)
    stamped = _cup_row(_stamp())
    unstamped = auto_structures.box_to_detection("ZZZ", {**BOX, "start_t": 20260501})
    unstamped["geometry"]["extras"].update({"draw_pivot": dict(ADMIN_PIVOT), "draw_box": False})
    monkeypatch.setattr(patterns_router.memory, "get_active_detections",
                        lambda sym, tf, pattern_ids=None, min_conf=0.0, include_internal=False: [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [stamped, unstamped])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    member = _get(PAID_MEMBER).json()["structures"]
    assert [s["id"] for s in member] == [stamped["id"]]
    assert member[0]["geometry"]["extras"]["draw_pivot"] == PIVOT_H
    admin = _get(ADMIN).json()["structures"]
    assert [s["id"] for s in admin] == [stamped["id"], unstamped["id"]]
    assert admin[0]["geometry"]["extras"]["draw_pivot"] == ADMIN_PIVOT        # admins keep the admin drawing


# -- precedence on the member path ------------------------------------------------------------------

def _flat(price, start_t, end_t):
    d = auto_structures.box_to_detection("ZZZ", {**BOX, "structure_key": "flat-base", "start_t": start_t,
                                                  "end_t": end_t, "top": price, "pivot": price})
    d["geometry"]["extras"].update({"draw_pivot": {"start_t": start_t, "end_t": end_t, "price": price},
                                    "draw_box": False})
    return {**d, **registry.display_policy("bc:flat-base")}


def _served_cup():
    return auto_structures.member_rows([_policy(_cup_row(_stamp()))])[0]


def test_a_served_cup_drops_a_flat_base_with_a_near_pivot():
    cup = _served_cup()                                         # pivot 140.2, ATR 1.5
    near = _flat(140.9, 20250101, 20250301)                     # 0.47 ATR away, disjoint span
    assert auto_structures.member_cup_precedence([cup, near]) == [cup]


def test_a_served_cup_drops_a_flat_base_whose_span_overlaps():
    cup = _served_cup()
    overlap = _flat(120.0, 20260801, 20260901)                  # far level, inside the cup (lip..as-of)
    assert auto_structures.member_cup_precedence([cup, overlap]) == [cup]


def test_control_a_far_disjoint_flat_base_stays_and_nothing_without_a_cup():
    cup = _served_cup()
    far = _flat(120.0, 20250101, 20250301)                      # 13.5 ATR away, disjoint
    assert auto_structures.member_cup_precedence([cup, far]) == [cup, far]
    near = _flat(140.9, 20250101, 20250301)
    assert auto_structures.member_cup_precedence([near]) == [near]   # no cup: nothing to outrank
    unstamped = _policy(_cup_row())                              # an unstamped cup never triggers it
    assert auto_structures.member_cup_precedence([unstamped, near]) == [unstamped, near]


def test_the_cup_precedence_fails_closed():
    cup = _served_cup()
    cup["geometry"]["extras"]["cup_tier"] = {**cup["geometry"]["extras"]["cup_tier"], "atr": None}
    far = _flat(120.0, 20250101, 20250301)
    assert auto_structures.member_cup_precedence([cup, far]) == [cup]


def test_a_served_cup_drops_a_near_bc_base_through_member_base_precedence():
    cup = _served_cup()                                          # member form: draw_pivot = tier pivot 140.2
    base = {"id": "bc:base:ZZZ", "pattern_id": "bc:base", "start_t": 20250101, "end_t": 20250301,
            "geometry": {"extras": {"draw_base": {"pivot": 140.6, "low": 130.0, "atr": 1.5,
                                                  "start_t": 20250101, "end_t": 20250301}}}}
    assert auto_structures.member_base_precedence([], [cup, base]) == [cup]
    far = {**base, "geometry": {"extras": {"draw_base": {**base["geometry"]["extras"]["draw_base"],
                                                           "pivot": 100.0}}}}
    lone_cup = {**cup, "start_t": 20260601, "end_t": 20261015}
    assert auto_structures.member_base_precedence([], [lone_cup, far]) == [lone_cup, far]  # control


def test_the_route_drops_the_flat_base_for_members_only(monkeypatch):
    _flags(monkeypatch)
    cup = _cup_row(_stamp())
    flat = _flat(140.9, 20250101, 20250301)
    monkeypatch.setattr(patterns_router.memory, "get_active_detections",
                        lambda sym, tf, pattern_ids=None, min_conf=0.0, include_internal=False: [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [cup, flat])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    assert [s["pattern_id"] for s in _get(PAID_MEMBER).json()["structures"]] == [CUP]
    assert [s["pattern_id"] for s in _get(ADMIN).json()["structures"]] == [CUP, "bc:flat-base"]
