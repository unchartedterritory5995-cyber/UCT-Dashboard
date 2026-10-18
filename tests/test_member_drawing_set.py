"""The MEMBER drawing set (owner-approved 2026-10-17): what a PAID member's chart is drawn while
AUTO_STRUCTURES_MEMBERS_ENABLED is on. Exactly the four types that passed two independent blind
packets at 331774fc5a: learned levels, learned trendlines (the `drawn` block, auto_draw.py),
flat_base and the MA pullback v5 (uct_pullback_ma_v5, otherwise INTERNAL). Nothing else: not the
rest of the team set (bull_flag, bc:flat-base, bc:cup-with-handle), not another internal uct_* id,
not an experimental / hidden / levels-layer row.

The fake detection store below honours `pattern_ids` and `include_internal` the way
memory.get_active_detections does, so a route that asked for too much would be SERVED too much.
Synthetic ids and prices only (public repo).
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, authorize

MEMBER_IDS = {"flat_base", "uct_pullback_ma_v5"}

#: One row per kind a member must NOT get beside the two it must: the rest of the team set,
#: other internal uct_* ids, experimental, hidden, the levels layer, the replaced pivots.
STORE = [
    {"id": "r1", "pattern_id": "bull_flag"},
    {"id": "r2", "pattern_id": "flat_base"},
    {"id": "r3", "pattern_id": "uct_pullback_ma_v5"},
    {"id": "r4", "pattern_id": "uct_launch_pad"},
    {"id": "r5", "pattern_id": "uct_inside_day"},
    {"id": "r6", "pattern_id": "uct_flat_top_breakout"},
    {"id": "r7", "pattern_id": "donchian_breakout"},
    {"id": "r8", "pattern_id": "double_bottom"},
    {"id": "r9", "pattern_id": "support_resistance"},
    {"id": "r10", "pattern_id": "swing_pivots"},
    {"id": "r11", "pattern_id": "pullback_to_10ema"},
]
BOX = {"structure_key": "flat-base", "name": "Flat base", "label": "Flat base",
       "start_t": 20260901, "end_t": 20261015, "top": 142.1, "floor": 131.4, "pivot": 142.1,
       "bars": 23, "sub_boxes": [], "source": "flat_base_state"}
DRAWN = {"model": "m", "asof_t": 20261015, "last_close": 140.0, "atr": 2.0,
         "last_bar_forming": False, "omitted": [],
         "horizontals": [{"price": 142.1, "kind": "swing_high"}],
         "trendlines": [{"t1": 20260901, "p1": 130.0, "t2": 20261001, "p2": 135.0,
                         "score": 0.7, "why": "x", "is_high": False}],
         "suppress": {"volume_profile_nodes": "hidden_by_default",
                      "swing_pivots": "replaced_by_learned"}}
URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


def _flags(monkeypatch, admin, members):
    for name, on in (("AUTO_STRUCTURES_ENABLED", admin), ("AUTO_STRUCTURES_MEMBERS_ENABLED", members)):
        if on is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, "1" if on else "0")


@pytest.fixture
def calls(monkeypatch):
    """Patch the store (honouring pattern_ids / include_internal), the base boxes and the
    learned drawer; return the list of store calls the route made."""
    seen = []

    def active(sym, tf, pattern_ids=None, min_conf=0.0, include_internal=False):
        seen.append({"pattern_ids": None if pattern_ids is None else list(pattern_ids),
                     "include_internal": include_internal})
        out = [dict(r) for r in STORE]
        if pattern_ids:
            out = [r for r in out if r["pattern_id"] in pattern_ids]
        return out if include_internal else registry.drop_internal(out)

    monkeypatch.setattr(patterns_router.memory, "get_active_detections", active)
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [
        auto_structures.box_to_detection(sym, BOX),
        auto_structures.box_to_detection(sym, {**BOX, "structure_key": "cup-with-handle"}),
        auto_structures.box_to_detection(sym, {**BOX, "structure_key": "square-box"})])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: json.loads(json.dumps(DRAWN)))
    return seen


def _get(user, url=URL):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    return TestClient(app).get(url)


# -- the set ---------------------------------------------------------------------------------

def test_the_member_set_is_exactly_the_blind_confirmed_types():
    """Pinned as a literal: the owner approved THESE ids. Changing it is a deliberate edit here."""
    assert registry.DISPLAY_MEMBER_SET == frozenset(MEMBER_IDS)
    assert registry.DISPLAY_MEMBER_SET <= registry.DISPLAY_TEAM_SET
    assert not (registry.DISPLAY_MEMBER_SET & registry.DISPLAY_HIDDEN)
    assert {"bull_flag", "bc:flat-base", "bc:cup-with-handle"}.isdisjoint(registry.DISPLAY_MEMBER_SET)
    # the one internal id a member may be drawn, and nothing else internal
    assert registry.DISPLAY_MEMBER_SET & registry.INTERNAL_PATTERN_IDS == {"uct_pullback_ma_v5"}
    assert set(registry.DISPLAY_MEMBER_SET) <= set(registry.list_pattern_ids())


def test_admin_tiers_did_not_move():
    """The member set is a filter, not a re-tiering: the team set is still `trusted` for admins."""
    for pid in ("bull_flag", "flat_base", "bc:flat-base", "bc:cup-with-handle", "uct_pullback_ma_v5"):
        assert registry.display_policy(pid)["display_tier"] == "trusted", pid


# -- flag ON: a member gets exactly the four types ---------------------------------------------

def test_flag_on_member_gets_exactly_the_four_confirmed_types(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER).json()
    assert sorted(r["pattern_id"] for r in body["detections"]) == sorted(MEMBER_IDS)
    assert body["count"] == 2
    assert {r["display_tier"] for r in body["detections"]} == {"trusted"}
    assert "structures" not in body                        # bc:flat-base / bc:cup-with-handle: no
    drawn = body["drawn"]
    assert drawn["horizontals"] and drawn["trendlines"]    # learned levels + learned trendlines
    assert set(body) == {"sym", "tf", "detections", "count", "drawn"}
    # The four types, and nothing else that draws.
    types = {r["pattern_id"] for r in body["detections"]} | {"learned_levels", "learned_trendlines"}
    assert types == MEMBER_IDS | {"learned_levels", "learned_trendlines"}


def test_flag_on_no_other_internal_or_experimental_row_reaches_a_member(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER).json()
    ids = {r["pattern_id"] for r in body["detections"]}
    assert not (ids & (registry.INTERNAL_PATTERN_IDS - {"uct_pullback_ma_v5"}))
    assert not {pid for pid in ids if pid.startswith("uct_")} - {"uct_pullback_ma_v5"}
    assert all(registry.display_policy(pid)["display_tier"] == "trusted" for pid in ids)


def test_flag_on_the_internal_read_is_scoped_to_the_member_set(monkeypatch, calls):
    """The only store read that may include internal rows asks for the member-set ids only."""
    _flags(monkeypatch, True, True)
    _get(PAID_MEMBER)
    internal_reads = [c for c in calls if c["include_internal"]]
    assert internal_reads == [{"pattern_ids": sorted(MEMBER_IDS), "include_internal": True}]


def test_flag_on_a_types_filter_never_widens_the_set(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    none = _get(PAID_MEMBER, URL + "&types=bull_flag,uct_launch_pad").json()
    assert none["detections"] == [] and none["count"] == 0
    # an empty intersection must never reach the store as "no filter"
    assert not [c for c in calls if c["include_internal"] and not c["pattern_ids"]]
    one = _get(PAID_MEMBER, URL + "&types=uct_pullback_ma_v5,uct_launch_pad").json()
    assert [r["pattern_id"] for r in one["detections"]] == ["uct_pullback_ma_v5"]


def test_flag_on_intraday_gets_rows_but_no_daily_geometry(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER, URL.replace("tf=D", "tf=5")).json()
    assert sorted(r["pattern_id"] for r in body["detections"]) == sorted(MEMBER_IDS)
    assert "drawn" not in body and "structures" not in body


# -- flag OFF: byte-identical to before --------------------------------------------------------

def _expected_flag_off_bytes():
    """Today's member payload, built from first principles: every NON-internal row, store order,
    stamped with the registry's display policy, no structures / drawn."""
    rows = [{**r, **registry.display_policy(r["pattern_id"])}
            for r in STORE if r["pattern_id"] not in registry.INTERNAL_PATTERN_IDS]
    body = {"sym": "ZZZ", "tf": "D", "detections": rows, "count": len(rows)}
    return json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def test_flag_off_member_payload_is_byte_identical(monkeypatch, calls):
    want = _expected_flag_off_bytes()
    for admin in (True, False, None):
        for members in (False, None):
            _flags(monkeypatch, admin, members)
            for url in (URL, URL.replace("&include_structures=true", "")):
                got = _get(PAID_MEMBER, url).content
                assert got == want, (admin, members, url)
    # and the off path never asked the store for internal rows
    assert not [c for c in calls if c["include_internal"]]


def test_member_without_include_structures_is_unchanged_with_the_flag_on(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    got = _get(PAID_MEMBER, URL.replace("&include_structures=true", "")).content
    assert got == _expected_flag_off_bytes()


# -- admin: unchanged --------------------------------------------------------------------------

def test_admin_payload_is_identical_with_the_member_flag_on_or_off(monkeypatch, calls):
    bodies = []
    for members in (False, None, True):
        _flags(monkeypatch, True, members)
        bodies.append(_get(ADMIN).content)
    assert bodies[0] == bodies[1] == bodies[2]
    body = json.loads(bodies[0])
    assert [r["id"] for r in body["detections"]] == [r["id"] for r in STORE]   # internal included
    tiers = {r["pattern_id"]: r["display_tier"] for r in body["detections"]}
    assert tiers["bull_flag"] == tiers["flat_base"] == tiers["uct_pullback_ma_v5"] == "trusted"
    assert [s["pattern_id"] for s in body["structures"]] == [
        "bc:flat-base", "bc:cup-with-handle", "bc:square-box"]
    assert "drawn" in body


# -- derived, not restated ---------------------------------------------------------------------

def test_moving_the_registry_constant_moves_what_a_member_gets(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(registry, "DISPLAY_MEMBER_SET", frozenset({"flat_base"}))
    body = _get(PAID_MEMBER).json()
    assert [r["pattern_id"] for r in body["detections"]] == ["flat_base"]
    assert [c for c in calls if c["include_internal"]][-1]["pattern_ids"] == ["flat_base"]
