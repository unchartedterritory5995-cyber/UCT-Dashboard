"""The MEMBER drawing set (owner-approved 2026-10-17): what a PAID member's chart is drawn while
AUTO_STRUCTURES_MEMBERS_ENABLED is on. Exactly the seven types that passed two independent blind
packets: flat_base and the
MA pullback v5 (uct_pullback_ma_v5, otherwise INTERNAL) at 331774fc5a; the bc:flat-base PIVOT LINE
(box off; R5c 2.40 [2.10, 2.67] and bcflat-c2 2.30 [2.03, 2.57], lab/geometry_eval
REPORT_BCFLAT_C2.md); and bull_flag AS THE ROUND-9 DRAWING CODE DRAWS IT (8d033ec7d2; team_bf9a
2.43 [2.13, 2.73] and team_bf9b 2.40 [2.17, 2.63], lab/geometry_eval REPORT_BULLFLAG_R9.md).
(The learned levels + trendlines -- the `drawn` block, auto_draw.py -- passed too, but are WITHHELD
from members since 2026-10-23 until rebuilt to textbook rules: tests/test_member_learned_lines_withheld.py.)
Nothing else: not bc:cup-with-handle, not another internal uct_* id, not an experimental / hidden /
levels-layer row, not a bc:flat-base whose pivot stamp is missing (that would draw the full box,
which nobody judged), and not a bull_flag that is stale or does not carry the round-9 stamp
(extras.draw_round, written by display.draw_geometry only on a finished, drawn flag): a row stored
by older drawing code, or one whose verdicts never finished, was never judged. The one exception is
the "flagging" tier, which carries its own stamp (extras.flagging) and its own rails in
tests/test_flag_tiers.py. And (2026-10-18) uct_flat_top_breakout AS THE v2 DRAWING CODE DRAWS IT --
the "flat top" ceiling and its touch markers (lab flattop_draw_v2: A 2.60 [2.30, 2.83], B 2.57
[2.30, 2.80]) -- only while it carries that round's stamp beside a well-formed draw_flat_top; an
unconfirmed or non-v2 fire is never served (tests/test_flat_top_member_drawing.py carries the
drawing and the gate in full). And (2026-10-18) bc:cup-with-handle ONLY AS THE CUP TIER DRAWS IT
(lab cup_tier_v2 recognition + cup_draw_v4 drawing round 4): a cup row reaches a member only while it
carries extras.cup_tier at the confirmed round, not withheld; an UNSTAMPED cup row -- every cup row
below -- is never served (tests/test_cup_tier_member_drawing.py carries the stamp and the gate in full).

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
from api.services.pattern_engine import display
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, authorize
from tests.detector_fixtures import ymd_t
from tests.test_bull_flag_r7 import _drawn, _ohlc
from tests.test_bull_flag_r9 import SHORT_LEG, TALL_LEG, _flag_after
from tests.test_drawing_geometry_v2 import _bars
from tests.test_team_drawing_set_r4 import _flag_det

MEMBER_IDS = {"flat_base", "uct_pullback_ma_v5", "bc:flat-base", "bull_flag", "uct_flat_top_breakout",
              "bc:base", "bc:cup-with-handle", "draw:inside-day", "draw:double-bottom", "draw:shelf-pivot",
              "draw:remount", "draw:u_and_r", "draw:donchian_breakout",
              # round-2 setup drawings (setup_draw_r2.py), each blind-confirmed on two packets
              "draw:rsi-bullish-divergence", "draw:wyckoff-upthrust", "draw:channel", "draw:pennant",
              "draw:darvas-box", "draw:falling-wedge", "draw:double-top", "draw:golden-cross", "draw:death-cross"}
#: The member types that arrive as detection rows; bc:flat-base arrives as a base box.
MEMBER_ROW_IDS = {"flat_base", "uct_pullback_ma_v5", "bull_flag", "uct_flat_top_breakout"}
#: The internal ids a member may be drawn: each is in the member set by its own blind check.
MEMBER_INTERNAL_IDS = {"uct_pullback_ma_v5", "uct_flat_top_breakout"}
#: Team-set types that are NOT confirmed and must NEVER reach a member (none left since the cup tier).
NOT_MEMBER: set = set()
#: Member types served ONLY with their tier stamp (extras.cup_tier): every row in this file is
#: unstamped, so none of them may reach a member here.
STAMP_GATED = {"bc:cup-with-handle"}
#: The bull_flag drawing round the blind check confirmed (REPORT_BULLFLAG_R9.md). Pinned as a literal.
CONFIRMED_ROUND = 9
#: The flat-top drawing round the blind check confirmed (lab flattop_draw_v2). Pinned as a literal.
FLAT_TOP_ROUND = 2
#: A well-formed v2 flat-top drawing, as display.flat_top_drawing stamps it (synthetic prices).
FLAT_TOP_DRAW = {"price": 50.0, "start_t": 20260901, "end_t": 20261015, "label": "flat top",
                 "variant": "breakout",
                 "touches": [{"t": 20260901, "price": 50.0}, {"t": 20260915, "price": 49.95},
                             {"t": 20260929, "price": 50.0}]}


def _flag(rid, **extras):
    """A bull_flag store row whose geometry carries `extras` (the draw_geometry stamp lives there)."""
    return {"id": rid, "pattern_id": "bull_flag", "geometry": {"extras": dict(extras)}}


def _flat_top(rid, **extras):
    """A uct_flat_top_breakout store row; by default stamped as the confirmed v2 drawing."""
    ex = {"draw_round": FLAT_TOP_ROUND, "draw_flat_top": dict(FLAT_TOP_DRAW)}
    ex.update(extras)
    return {"id": rid, "pattern_id": "uct_flat_top_breakout", "geometry": {"extras": ex}}


#: One row per kind a member must NOT get beside the ones it must: the rest of the team set,
#: other internal uct_* ids, experimental, hidden, the levels layer, the replaced pivots, stray
#: bc:* rows in the store (unstamped, so never pivot-only), and bull_flags that are stale, carry
#: no round stamp, or carry another round's stamp.
STORE = [
    _flag("r1", draw_round=CONFIRMED_ROUND),
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
    {"id": "r12", "pattern_id": "bc:flat-base"},
    {"id": "r13", "pattern_id": "bc:cup-with-handle"},
    _flag("r14", draw_round=CONFIRMED_ROUND, stale=True, stale_reason="short_pole"),
    {"id": "r15", "pattern_id": "bull_flag"},
    _flag("r16", draw_round=CONFIRMED_ROUND - 1),
    _flat_top("r17"),
    _flat_top("r18", stale=True, stale_reason="few_touches"),
    _flat_top("r19", draw_round=CONFIRMED_ROUND),
]
#: The store rows a member is served, in store order.
SERVED_ROW_IDS = ["r1", "r2", "r3", "r17"]
BOX = {"structure_key": "flat-base", "name": "Flat base", "label": "Flat base",
       "start_t": 20260901, "end_t": 20261015, "top": 142.1, "floor": 131.4, "pivot": 142.1,
       "bars": 23, "sub_boxes": [], "source": "flat_base_state"}
PIVOT = {"start_t": 20260920, "end_t": 20261015, "price": 141.8}
DRAWN = {"model": "m", "asof_t": 20261015, "last_close": 140.0, "atr": 2.0,
         "last_bar_forming": False, "omitted": [],
         "horizontals": [{"price": 142.1, "kind": "swing_high"}],
         "trendlines": [{"t1": 20260901, "p1": 130.0, "t2": 20261001, "p2": 135.0,
                         "score": 0.7, "why": "x", "is_high": False}],
         "suppress": {"volume_profile_nodes": "hidden_by_default",
                      "swing_pivots": "replaced_by_learned"}}
URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


def _pivot_box(sym, key, start_t=BOX["start_t"]):
    """A base box exactly as _team_pivot leaves a team-set box that passed its verdicts: the
    pivot line stamped, the box off. Built through the real box_to_detection."""
    d = auto_structures.box_to_detection(sym, {**BOX, "structure_key": key, "start_t": start_t})
    d["geometry"]["extras"].update({"draw_pivot": dict(PIVOT), "draw_box": False})
    return d


def _structures(sym):
    """The structures a D/W/M chart can carry: a pivot-only bc:flat-base (the one a member gets),
    a pivot-only bc:cup-with-handle (team set, NOT member set), a square box, and a bc:flat-base
    whose stamp never ran (no pivot, box not off: it would draw the full box)."""
    return [
        _pivot_box(sym, "flat-base"),
        _pivot_box(sym, "cup-with-handle"),
        auto_structures.box_to_detection(sym, {**BOX, "structure_key": "square-box"}),
        auto_structures.box_to_detection(sym, {**BOX, "start_t": 20260801}),
    ]


def _flags(monkeypatch, admin, members):
    for name, on in (("AUTO_STRUCTURES_ENABLED", admin), ("AUTO_STRUCTURES_MEMBERS_ENABLED", members)):
        if on is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, "1" if on else "0")


#: The one scan every fake-store row belongs to, and the ticker's newest bar (FLAT_TOP_DRAW's as-of
#: bar), so the member path's latest-scan filter (auto_structures.fresh_member_rows) passes them all;
#: tests/test_member_rows_fresh.py owns that filter against a real store.
SCAN_AT = 1_790_000_000
LATEST_BAR = FLAT_TOP_DRAW["end_t"]


def _as_stored(rows):
    """`rows` as the real store returns them: every stored row carries last_seen_at (NOT NULL)."""
    out = json.loads(json.dumps(rows))
    for r in out:
        r.setdefault("last_seen_at", SCAN_AT)
    return out


def _store(monkeypatch, rows):
    """Patch the store with `rows` (honouring pattern_ids / include_internal); return the call list.
    The rows all belong to the ticker's latest scan, drawn as of its latest bar."""
    seen = []

    def active(sym, tf, pattern_ids=None, min_conf=0.0, include_internal=False):
        seen.append({"pattern_ids": None if pattern_ids is None else list(pattern_ids),
                     "include_internal": include_internal})
        out = _as_stored(rows)
        if pattern_ids:
            out = [r for r in out if r["pattern_id"] in pattern_ids]
        return out if include_internal else registry.drop_internal(out)

    monkeypatch.setattr(patterns_router.memory, "get_active_detections", active)
    monkeypatch.setattr(patterns_router.memory, "latest_scan_at", lambda sym, tf: SCAN_AT)
    monkeypatch.setattr(auto_structures, "latest_completed_bar_t", lambda sym, tf: LATEST_BAR)
    return seen


@pytest.fixture
def calls(monkeypatch):
    """Patch the store (honouring pattern_ids / include_internal), the base boxes and the
    learned drawer; return the list of store calls the route made."""
    seen = _store(monkeypatch, STORE)
    monkeypatch.setattr(auto_structures, "structures_for", _structures)
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
    assert NOT_MEMBER.isdisjoint(registry.DISPLAY_MEMBER_SET)
    # the team set minus the member set is exactly the unconfirmed remainder
    assert set(registry.DISPLAY_TEAM_SET) - set(registry.DISPLAY_MEMBER_SET) == NOT_MEMBER
    # the internal ids a member may be drawn, and nothing else internal
    assert registry.DISPLAY_MEMBER_SET & registry.INTERNAL_PATTERN_IDS == MEMBER_INTERNAL_IDS
    # every member id is drawable: a registered detector, a team-set base box (pivot line), or
    # the base drawing (bc:base, its own structures row, gated by its own round stamp)
    bc = {pid for pid in registry.DISPLAY_MEMBER_SET if pid.startswith("bc:")}
    assert bc == {"bc:flat-base", "bc:base", "bc:cup-with-handle"}
    assert bc - {auto_structures.BASE_DRAW_ID} <= auto_structures.TEAM_PIVOT_BOXES
    # the inside-day drawing is its own structures row too (draw:inside-day, gated by its round stamp)
    # (and the setup drawings, their own `setup_draws` rows, each gated by its member-round literal)
    drawings = {auto_structures.INSIDE_DAY_DRAW_ID, "draw:double-bottom", auto_structures.SHELF_PIVOT_ID,
                "draw:remount", "draw:u_and_r", "draw:donchian_breakout"} | set(auto_structures.SETUP_DRAW_R2_IDS)
    assert set(registry.DISPLAY_MEMBER_SET) - bc - drawings <= set(registry.list_pattern_ids())


def test_the_confirmed_bull_flag_round_is_round_9_and_the_drawing_code_is_round_9():
    """The member gate is pinned to the round the blind check confirmed (8d033ec7d2); the drawing
    code on this branch IS that round. If the drawing code moves on, the second line goes red and
    members stop getting bull_flag (fail closed) until the new round is confirmed."""
    assert auto_structures.MEMBER_BULL_FLAG_ROUND == CONFIRMED_ROUND
    assert display.BULL_FLAG_DRAW_ROUND == CONFIRMED_ROUND


def test_admin_tiers_did_not_move():
    """The member set is a filter, not a re-tiering: the team set is still `trusted` for admins."""
    for pid in ("bull_flag", "flat_base", "bc:flat-base", "bc:cup-with-handle", "uct_pullback_ma_v5",
                "uct_flat_top_breakout"):
        assert registry.display_policy(pid)["display_tier"] == "trusted", pid


# -- flag ON: a member gets exactly the seven types --------------------------------------------

def test_flag_on_member_gets_exactly_the_seven_confirmed_types(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER).json()
    assert [r["id"] for r in body["detections"]] == SERVED_ROW_IDS
    assert sorted(r["pattern_id"] for r in body["detections"]) == sorted(MEMBER_ROW_IDS)
    assert body["count"] == 4
    assert {r["display_tier"] for r in body["detections"]} == {"trusted"}
    # bc:flat-base: exactly ONE base box, the pivot-only one; the cup, the square box and the
    # unstamped flat-base are not served
    assert [s["pattern_id"] for s in body["structures"]] == ["bc:flat-base"]
    # The learned levels + trendlines (`drawn`) are WITHHELD from members since 2026-10-23 (owner:
    # rebuild to textbook support/resistance first; auto_structures.MEMBER_LEARNED_LINES_ROUND = None,
    # railed in tests/test_member_learned_lines_withheld.py). The fixture's drawn_for still answers,
    # so its absence here is the gate, not an empty drawer.
    assert "drawn" not in body
    assert set(body) == {"sym", "tf", "detections", "count", "structures"}
    # The confirmed types, and nothing else that draws.
    types = ({r["pattern_id"] for r in body["detections"]}
             | {s["pattern_id"] for s in body["structures"]})
    # (this fixture's structures carry no base drawing and no stamped cup; bc:base reaching a member is
    # railed in tests/test_base_draw_member_drawing.py, the cup in tests/test_cup_tier_member_drawing.py)
    # (nor an inside-day drawing: tests/test_inside_day_draw_member_drawing.py)
    # (nor a double-bottom drawing: tests/test_shape_draw.py)
    # (nor a shelf pivot: AUTO_STRUCTURES_SHELF_ENABLED is off here; tests/test_shelf_pivot_member_path.py)
    # (nor a setup drawing: those ride `setup_draws`, never `structures`; tests/test_setup_draw_member_gate.py)
    assert types == MEMBER_IDS - {"bc:base", "draw:inside-day", "draw:double-bottom",
                                  "draw:shelf-pivot", "draw:remount", "draw:u_and_r", "draw:donchian_breakout"} - STAMP_GATED         - set(auto_structures.SETUP_DRAW_R2_IDS)      # setup drawings ride `setup_draws`, never `structures`


def test_flag_on_the_member_bull_flag_is_the_admins_row(monkeypatch, calls):
    """The member is drawn the same bull_flag row an admin is: same geometry, same entry policy."""
    _flags(monkeypatch, True, True)
    member = [r for r in _get(PAID_MEMBER).json()["detections"] if r["pattern_id"] == "bull_flag"]
    assert [r["id"] for r in member] == ["r1"]
    assert member[0]["geometry"]["extras"] == {"draw_round": CONFIRMED_ROUND}
    assert member[0]["draw_entry"] is True and member[0]["display_tier"] == "trusted"
    admin = [r for r in _get(ADMIN).json()["detections"] if r["id"] == "r1"]
    assert admin == member


def test_a_stale_or_unconfirmed_bull_flag_is_never_served_to_a_member(monkeypatch, calls):
    """Fail closed: stale (any reason, even with the right round), no stamp, no geometry, or any
    stamp that is not exactly the confirmed round -> dropped. Admins still see every one."""
    _flags(monkeypatch, True, True)
    base = _flag("f", draw_round=CONFIRMED_ROUND)
    variants = [
        _flag("v1", draw_round=CONFIRMED_ROUND, stale=True),
        _flag("v2", draw_round=CONFIRMED_ROUND, stale=True, stale_reason="overlapped"),
        _flag("v3", draw_round=CONFIRMED_ROUND, stale=1),
        _flag("v4"),
        _flag("v5", draw_round=None),
        _flag("v6", draw_round=CONFIRMED_ROUND - 1),
        _flag("v7", draw_round=CONFIRMED_ROUND + 1),
        _flag("v8", draw_round=str(CONFIRMED_ROUND)),
        _flag("v9", draw_round=float(CONFIRMED_ROUND)),
        {"id": "v10", "pattern_id": "bull_flag"},
        {"id": "v11", "pattern_id": "bull_flag", "geometry": None},
        {"id": "v12", "pattern_id": "bull_flag", "geometry": {"extras": None}},
    ]
    rows = [{**r, **registry.display_policy("bull_flag")} for r in variants]
    assert auto_structures.member_rows(rows) == []
    ctrl = {**base, **registry.display_policy("bull_flag")}
    assert auto_structures.member_rows([ctrl]) == [ctrl]      # control: the guard can pass
    # through the route: the stale (r14), unstamped (r15) and round-8 (r16) rows never arrive
    body = _get(PAID_MEMBER).json()
    assert not {"r14", "r15", "r16"} & {r["id"] for r in body["detections"]}
    admin_ids = [r["id"] for r in _get(ADMIN).json()["detections"]]
    assert {"r14", "r15", "r16"} <= set(admin_ids)


def test_flag_on_a_real_round_9_flag_reaches_a_member_and_a_real_stale_one_does_not(monkeypatch):
    """End to end through the REAL display.draw_geometry (the round-9 test fixtures): a flag every
    verdict passes is stamped with the round and served as confirmed; a short-pole flag is stale,
    never stamped with the round, and carries only the "flagging" stamp. Flagging tier withheld from
    members 2026-10-24 (blind textbook score 1.28): the member gets the confirmed flag only; the admin
    gets all three. Control: the one-literal re-enable (MEMBER_FLAGGING_ROUND = 9) serves the flagging
    row again and still drops the unstamped one (test_flag_tiers.py covers the tier itself)."""
    good, _ = _drawn(*_flag_after(TALL_LEG))
    bad, _ = _drawn(*_flag_after(SHORT_LEG))
    assert not good.get("stale") and good["draw_round"] == CONFIRMED_ROUND
    assert bad["stale"] is True and bad["stale_reason"] == "short_pole"
    assert "draw_round" not in bad                      # a stale flag is never stamped
    assert bad["flagging"]["tier"] == "flagging"
    unstamped = {k: v for k, v in bad.items() if k != "flagging"}
    rows = [_flag("g", **good), _flag("b", **bad), _flag("u", **unstamped)]
    _flags(monkeypatch, True, True)
    _store(monkeypatch, rows)
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    body = _get(PAID_MEMBER).json()
    assert [r["id"] for r in body["detections"]] == ["g"]
    assert body["detections"][0]["geometry"]["extras"]["draw_pole"] == good["draw_pole"]
    admin = _get(ADMIN).json()
    assert [r["id"] for r in admin["detections"]] == ["g", "b", "u"]
    monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", 9)      # control: the re-enable
    body = _get(PAID_MEMBER).json()
    assert [r["id"] for r in body["detections"]] == ["g", "b"]
    assert body["detections"][1]["geometry"]["extras"]["flagging"] == bad["flagging"]
    assert [r["id"] for r in _get(ADMIN).json()["detections"]] == ["g", "b", "u"]


def test_a_flag_drawn_by_a_newer_round_is_not_served_until_confirmed(monkeypatch):
    """If the drawing code moves to a new round (BULL_FLAG_DRAW_ROUND bumped) the stamp no longer
    matches the confirmed round, and members get no bull_flag: fail closed, admins unaffected."""
    monkeypatch.setattr(display, "BULL_FLAG_DRAW_ROUND", CONFIRMED_ROUND + 1)
    ex, _ = _drawn(*_flag_after(TALL_LEG))
    assert ex["draw_round"] == CONFIRMED_ROUND + 1
    row = {**_flag("n", **ex), **registry.display_policy("bull_flag")}
    assert auto_structures.member_rows([row]) == []


def test_only_one_of_two_overlapping_real_flags_is_stamped():
    """The overlap pass stales the less confident of two flags over the same bars: only the kept
    one carries the round stamp, so a member is drawn one pole and one entry line, as judged."""
    rows, top, up, dn = _flag_after(TALL_LEG)
    bars = _ohlc(rows)
    closes = [r[3] for r in rows]
    hi = _flag_det(closes, 14, top, up, dn, conf=80)
    lo = _flag_det(closes, 14, top, up, dn, conf=60)
    display.draw_geometry([lo, hi], bars)
    assert hi["geometry"]["extras"]["draw_round"] == CONFIRMED_ROUND
    assert lo["geometry"]["extras"]["stale_reason"] == "overlapped"
    assert "draw_round" not in lo["geometry"]["extras"]
    policy = registry.display_policy("bull_flag")
    served = auto_structures.member_rows([{**lo, **policy}, {**hi, **policy}])
    assert [r["confidence"] for r in served] == [80]


def test_flag_on_bc_flat_base_draws_the_pivot_only_as_admins_see_it(monkeypatch, calls):
    """The member's bc:flat-base row is byte-for-byte the admin's: the box is off and the pivot
    line is stamped, so PatternOverlay draws the line and no box -- what the judges scored."""
    _flags(monkeypatch, True, True)
    box = _get(PAID_MEMBER).json()["structures"][0]
    ex = box["geometry"]["extras"]
    assert ex["draw_box"] is False
    assert ex["draw_pivot"] == PIVOT
    assert not ex.get("stale")
    assert "draw_handle" not in ex and "draw_sub_boxes" not in ex   # no cup handle box
    assert box["draw_entry"] is False                                # no entry line either
    assert box["display_tier"] == "trusted" and box["display_layer"] == "structures"
    admin = [s for s in _get(ADMIN).json()["structures"] if s["id"] == box["id"]]
    assert admin == [box]


def test_flag_on_a_bc_flat_base_that_is_not_pivot_only_is_never_served(monkeypatch, calls):
    """A box whose stamp failed or never ran would draw the full box: a member gets nothing."""
    _flags(monkeypatch, True, True)
    base = _pivot_box("ZZZ", "flat-base")
    variants = []
    for change in ({"draw_box": True}, {"stale": True}, {"draw_pivot": None},
                   {"draw_pivot": {**PIVOT, "price": float("nan")}},
                   {"draw_pivot": {**PIVOT, "price": "x"}},
                   {"draw_pivot": {"price": 141.8}}):
        v = json.loads(json.dumps(base))
        v["geometry"]["extras"].update(change)
        variants.append(v)
    v = json.loads(json.dumps(base))
    del v["geometry"]["extras"]["draw_box"]
    variants.append(v)
    assert auto_structures.member_rows(variants) == []
    assert auto_structures.member_rows([base]) == [base]       # control: the guard can pass


def test_flag_on_no_other_internal_or_experimental_row_reaches_a_member(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER).json()
    ids = {r["pattern_id"] for r in body["detections"] + body.get("structures", [])}
    assert not (ids & (registry.INTERNAL_PATTERN_IDS - MEMBER_INTERNAL_IDS))
    assert not {pid for pid in ids if pid.startswith("uct_")} - MEMBER_INTERNAL_IDS
    assert not (ids & NOT_MEMBER)
    assert not (ids & STAMP_GATED)          # the unstamped cup row in the structures is dropped
    assert all(registry.display_policy(pid)["display_tier"] == "trusted" for pid in ids)


def test_flag_on_every_other_type_stays_out(monkeypatch):
    """One row for EVERY registered detector id (internal ones included) and every team-set base
    box, each carrying the bull_flag round stamp so no stamp check can be what drops it (the flat
    top and the flat base carry their OWN round's stamp, for the same reason): a member is served
    the member-set ids and nothing else."""
    every = sorted(set(registry.list_pattern_ids()) | set(registry.DISPLAY_TEAM_SET))
    assert "bull_flag" in every and "bc:cup-with-handle" in every     # the sweep is not vacuous
    rows = [(_flat_top(f"x{i}") if pid == "uct_flat_top_breakout"
             else _flag(f"x{i}", draw_round=(auto_structures.MEMBER_FLAT_BASE_ROUND if pid == "flat_base"
                                             else CONFIRMED_ROUND)) | {"pattern_id": pid})
            for i, pid in enumerate(every)]
    _flags(monkeypatch, True, True)
    _store(monkeypatch, rows)
    monkeypatch.setattr(auto_structures, "structures_for",
                        lambda sym: [_pivot_box(sym, "flat-base"), _pivot_box(sym, "cup-with-handle")])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    body = _get(PAID_MEMBER).json()
    got = {r["pattern_id"] for r in body["detections"]}
    assert got == MEMBER_ROW_IDS
    assert [s["pattern_id"] for s in body["structures"]] == ["bc:flat-base"]
    # the direct filter, over the same rows with the admin policy: the same answer (the bc:flat-base
    # DETECTION row here carries no pivot stamp, so it is dropped as not pivot-only)
    direct = auto_structures.member_rows(
        [{**r, **registry.display_policy(r["pattern_id"])} for r in rows])
    assert {r["pattern_id"] for r in direct} == MEMBER_ROW_IDS


def test_flag_on_the_internal_read_is_scoped_to_the_member_set(monkeypatch, calls):
    """The only store read that may include internal rows asks for the member-set ids only."""
    _flags(monkeypatch, True, True)
    _get(PAID_MEMBER)
    internal_reads = [c for c in calls if c["include_internal"]]
    assert internal_reads == [{"pattern_ids": sorted(MEMBER_IDS), "include_internal": True}]


def test_flag_on_a_types_filter_never_widens_the_set(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    none = _get(PAID_MEMBER, URL + "&types=uct_launch_pad,bc:cup-with-handle,donchian_breakout").json()
    assert none["detections"] == [] and none["count"] == 0
    assert [s["pattern_id"] for s in none["structures"]] == ["bc:flat-base"]
    # an empty intersection must never reach the store as "no filter"
    assert not [c for c in calls if c["include_internal"] and not c["pattern_ids"]]
    one = _get(PAID_MEMBER, URL + "&types=uct_pullback_ma_v5,uct_launch_pad").json()
    assert [r["pattern_id"] for r in one["detections"]] == ["uct_pullback_ma_v5"]
    flag = _get(PAID_MEMBER, URL + "&types=bull_flag,bc:cup-with-handle").json()
    assert [r["id"] for r in flag["detections"]] == ["r1"]      # the stamped, non-stale one only


def test_flag_on_intraday_gets_rows_but_no_daily_geometry(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    body = _get(PAID_MEMBER, URL.replace("tf=D", "tf=5")).json()
    assert sorted(r["pattern_id"] for r in body["detections"]) == sorted(MEMBER_ROW_IDS)
    assert "drawn" not in body and "structures" not in body


def test_flag_on_a_real_stamped_bc_flat_base_reaches_a_member_as_its_pivot(monkeypatch):
    """End to end through the REAL _team_pivot stamp (the same synthetic base as
    test_team_drawing_set): a member's structures carry the pivot line, box off."""
    box = {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(20),
           "top": 100.5, "floor": 89.5, "pivot": 100.6}
    bars = _bars([80, 84, 88, 91, 94, 99, 98, 100, 97, 99, 98, 99, 100, 98, 99, 98, 99, 100, 98, 99, 100])
    real = auto_structures.box_to_detection("ZZZ", box, bars)
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(patterns_router.memory, "get_active_detections",
                        lambda *a, include_internal=False, **k: [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [real])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    body = _get(PAID_MEMBER).json()
    assert [s["pattern_id"] for s in body["structures"]] == ["bc:flat-base"]
    ex = body["structures"][0]["geometry"]["extras"]
    assert ex["draw_box"] is False
    assert ex["draw_pivot"] == {"start_t": ymd_t(5), "end_t": ymd_t(20), "price": 100.5}


# -- flag OFF: byte-identical to before --------------------------------------------------------

def _expected_flag_off_bytes():
    """Today's member payload, built from first principles: every NON-internal row, store order,
    stamped with the registry's display policy, no structures / drawn."""
    rows = [{**r, **registry.display_policy(r["pattern_id"])}
            for r in _as_stored(STORE) if r["pattern_id"] not in registry.INTERNAL_PATTERN_IDS]
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
        "bc:flat-base", "bc:cup-with-handle", "bc:square-box", "bc:flat-base"]
    assert "drawn" in body


# -- derived, not restated ---------------------------------------------------------------------

def test_moving_the_registry_constant_moves_what_a_member_gets(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(registry, "DISPLAY_MEMBER_SET", frozenset({"flat_base"}))
    body = _get(PAID_MEMBER).json()
    assert [r["pattern_id"] for r in body["detections"]] == ["flat_base"]
    assert "structures" not in body                     # bc:flat-base left the set
    assert [c for c in calls if c["include_internal"]][-1]["pattern_ids"] == ["flat_base"]
