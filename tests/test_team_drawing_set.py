"""The TEAM DRAWING SET (owner direction 2026-10-17): the chart's auto-drawings show what the
team draws -- flags (pole + lanes), bases (breakout / pivot line), MA pullbacks (the tagged MA as a
curve + the tag-bar marker) and the learned levels + trendlines. registry.DISPLAY_TRUSTED IS this
set; members stay off (AUTO_STRUCTURES_MEMBERS_ENABLED=0) until it passes a blind check.

DISPLAY-ONLY: every stamp lives under `geometry.extras`; anchors, levels, start_t / end_t and
confidence are untouched. Synthetic bars only (public repo).
"""
from __future__ import annotations

import copy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import detect_one, display
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.authclients import ADMIN, PAID_MEMBER, authorize
from tests.detector_fixtures import ymd_t
from tests.pattern_engine.detectors import _pullback_v5_synth as SY
from tests.test_drawing_geometry_v2 import _bars, _fired


# -- the set ---------------------------------------------------------------------------------

def test_trusted_is_the_team_set_and_donchian_rectangle_left_it():
    assert registry.DISPLAY_TRUSTED is registry.DISPLAY_TEAM_SET
    assert {"donchian_breakout", "rectangle"}.isdisjoint(registry.DISPLAY_TRUSTED)
    assert not (registry.DISPLAY_TEAM_SET & registry.DISPLAY_HIDDEN)
    # the MA pullback is trusted for drawing but still INTERNAL: no member path serves it
    assert registry.is_internal("uct_pullback_ma_v5")


# -- bases: the breakout / pivot line ----------------------------------------------------------

def test_flat_base_draws_its_pivot_line_at_the_level_it_fires_above():
    fired = _fired("flat_base")
    assert fired, "control: flat_base never fired on its fixtures"
    drawn = 0
    for bars, d in fired:
        ex = d["geometry"]["extras"]
        a = d["geometry"]["anchors"]
        if ex.get("stale"):
            assert "draw_pivot" not in ex
            continue
        drawn += 1
        pv = ex["draw_pivot"]
        assert pv["price"] == float(a[1]["price"])            # the base high, never invented
        assert ex["draw_anchors"][0]["t"] <= pv["start_t"] <= pv["end_t"] <= ex["draw_anchors"][1]["t"] \
            or (pv["start_t"], pv["end_t"]) == (ex["draw_anchors"][0]["t"], ex["draw_anchors"][1]["t"])
        assert ex.get("draw_box", True) is True               # flat_base keeps its capped box
    assert drawn, "control: every flat_base fire was stale"


def _flat_det(closes):
    """A flat_base-shaped detection over `closes`: [advance low, base start@high, end@high, end@low]."""
    n = len(closes) - 1
    return {"pattern_id": "flat_base", "start_t": ymd_t(0), "end_t": ymd_t(n),
            "levels": {"entry": 100.6}, "confidence": 70,
            "geometry": {"shape": "rectangle", "extras": {},
                         "anchors": [{"t": ymd_t(0), "price": 80.0}, {"t": ymd_t(3), "price": 100.5},
                                     {"t": ymd_t(n), "price": 100.5}, {"t": ymd_t(n), "price": 89.5}]}}


def test_flat_base_that_broke_down_is_stale_and_one_that_holds_is_not():
    holds = [80, 84, 88, 91, 94, 99, 98, 100, 97, 99, 98, 99, 100, 98, 99]
    broke = [80, 84, 88, 91, 94, 99, 98, 100, 97, 93, 98, 99, 100, 98, 97, 92, 90, 88]
    for closes, stale in ((holds, False), (broke, True)):
        d = _flat_det(closes)
        before = copy.deepcopy({k: d[k] for k in ("levels", "start_t", "end_t", "confidence")})
        anchors = copy.deepcopy(d["geometry"]["anchors"])
        display.draw_geometry([d], _bars(closes))
        ex = d["geometry"]["extras"]
        assert bool(ex.get("stale")) is stale, closes
        assert ("draw_pivot" in ex) is (not stale)
        assert d["geometry"]["anchors"] == anchors
        assert {k: d[k] for k in before} == before


BOX = {"structure_key": "flat-base", "start_t": ymd_t(0), "end_t": ymd_t(14),
       "top": 100.5, "floor": 79.5, "pivot": 100.6}


def test_bc_flat_base_draws_the_pivot_line_only():
    bars = _bars([80, 84, 88, 91, 94, 99, 98, 100, 97, 99, 98, 99, 100, 98, 99])
    d = auto_structures.box_to_detection("ZZZ", BOX, bars)
    ex = d["geometry"]["extras"]
    assert ex["draw_box"] is False
    assert ex["draw_pivot"] == {"start_t": ymd_t(3), "end_t": ymd_t(14), "price": 100.6}
    assert d["geometry"]["anchors"] == [{"t": ymd_t(0), "price": 100.5}, {"t": ymd_t(14), "price": 79.5}]
    # no pivot from base_catalog: the box top is the line
    nop = auto_structures.box_to_detection("ZZZ", {**BOX, "pivot": None}, bars)
    assert nop["geometry"]["extras"]["draw_pivot"]["price"] == 100.5
    # no bars: nothing stamped (rows stored before the fix draw as before)
    assert "draw_pivot" not in auto_structures.box_to_detection("ZZZ", BOX)["geometry"]["extras"]
    # other boxes are not stamped
    sq = auto_structures.box_to_detection("ZZZ", {**BOX, "structure_key": "square-box"}, bars)
    assert "draw_pivot" not in sq["geometry"]["extras"]


def test_a_bc_flat_base_that_broke_down_is_stale_and_not_served(monkeypatch):
    closes = [80, 84, 88, 91, 94, 99, 98, 100, 97, 93, 98, 99, 100, 98, 97, 92, 90, 88]
    bars = _bars(closes)
    box = {**BOX, "end_t": ymd_t(17)}
    d = auto_structures.box_to_detection("ZZZ", box, bars)
    assert d["geometry"]["extras"]["stale"] is True
    assert "draw_pivot" not in d["geometry"]["extras"]
    from api.services.screener import base_catalog
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: bars)
    monkeypatch.setattr(base_catalog, "current_base_structures", lambda b: [box])
    auto_structures._CACHE.clear()
    try:
        assert auto_structures.structures_for("BROKEFB") == []
    finally:
        auto_structures._CACHE.clear()


def test_bc_cup_with_handle_draws_the_rim_line_to_the_breakout_and_the_capped_handle():
    closes = [90] * 10 + [97, 96, 95, 96, 98, 101, 104, 106]
    bars = _bars(closes)
    cup = {"structure_key": "cup-with-handle", "start_t": ymd_t(0), "end_t": ymd_t(17),
           "top": 100.0, "floor": 85.0, "pivot": 100.1,
           "sub_boxes": [{"start_t": ymd_t(0), "end_t": ymd_t(9), "top": 100.0, "floor": 85.0},
                         {"start_t": ymd_t(10), "end_t": ymd_t(17), "top": 106.5, "floor": 94.5}]}
    ex = auto_structures.box_to_detection("ZZZ", cup, bars)["geometry"]["extras"]
    assert ex["draw_box"] is False
    assert ex["draw_pivot"] == {"start_t": ymd_t(0), "end_t": ymd_t(15), "price": 100.1}
    assert ex["draw_handle"] == {"start_t": ymd_t(10), "end_t": ymd_t(14), "top": 98.5, "floor": 94.5}
    # handle broke out on its first bar: no handle to draw, and the cup's own sub-box is NOT it
    gone = auto_structures.box_to_detection("ZZZ", {**cup, "sub_boxes": [
        cup["sub_boxes"][0], {**cup["sub_boxes"][1], "start_t": ymd_t(15)}]}, bars)
    assert "draw_handle" not in gone["geometry"]["extras"]


# -- MA pullback: the tagged MA as a curve + the tag-bar marker ---------------------------------

def test_pullback_v5_draws_the_tagged_ema_and_marks_the_tag_bar():
    bars = SY.fire_e21(U.series)
    (d,) = detect_one(bars, build_context(bars, sym="TEST"), "uct_pullback_ma_v5")
    ex = d["geometry"]["extras"]
    ema = ex["draw_ema"]
    assert (ema["kind"], ema["period"]) == ("ema", 21)
    pts = ema["points"]
    assert len(pts) >= display.PULLBACK_EMA_MIN_BARS
    assert pts[0]["t"] <= d["start_t"] and pts[-1]["t"] == bars[-1]["t"]
    # the curve IS the detector's MA: its value on the marked session is the tagged level
    marked = d["geometry"]["anchors"][0]
    on_marked = next(p for p in pts if p["t"] == marked["t"])
    assert on_marked["price"] == pytest.approx(marked["price"], abs=1e-3)
    tag = next(b for b in bars if b["t"] == ex["tag_t"])
    assert ema["tag"] == {"t": tag["t"], "price": float(tag["l"])}
    assert ema["tag"]["price"] == pytest.approx(d["levels"]["stop"], abs=0.01)


def test_tagged_ma_segment_draws_an_sma_for_a_50_sma_tag_and_nothing_for_an_unknown_ma():
    bars = SY.uptrend(n=120)
    pos = {b["t"]: i for i, b in enumerate(bars)}
    d = {"start_t": bars[-8]["t"]}
    seg = display.tagged_ma_segment(bars, pos, {"tagged_ma": "s50", "tag_t": bars[-2]["t"]}, d)
    want = U.sma([b["c"] for b in bars], 50)
    assert (seg["kind"], seg["period"]) == ("sma", 50)
    assert seg["points"][-1]["price"] == pytest.approx(want[-1], abs=1e-3)
    assert seg["tag"]["t"] == bars[-2]["t"]
    assert display.tagged_ma_segment(bars, pos, {"tagged_ma": "x9"}, d) is None
    assert display.tagged_ma_segment(bars, pos, {}, d) is None


# -- the member route serves the team set (flag stays OFF in production) -------------------------

def _client(user, monkeypatch, rows):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)

    def active(*a, include_internal=False, **k):
        out = [dict(r) for r in rows]
        return out if include_internal else registry.drop_internal(out)
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", active)
    return TestClient(app)


ROWS = [{"id": "a", "pattern_id": "bull_flag"}, {"id": "b", "pattern_id": "uct_pullback_ma_v5"},
        {"id": "c", "pattern_id": "donchian_breakout"}, {"id": "d", "pattern_id": "rectangle"}]
URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


def test_member_gets_the_team_set_but_never_the_internal_pullback(monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_MEMBERS_ENABLED", "1")
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [
        auto_structures.box_to_detection(sym, BOX),
        auto_structures.box_to_detection(sym, {**BOX, "structure_key": "square-box"})])
    monkeypatch.setattr(auto_structures, "drawn_for",
                        lambda sym: {"trendlines": [], "horizontals": [], "suppress": {}})
    body = _client(PAID_MEMBER, monkeypatch, ROWS).get(URL).json()
    assert [r["pattern_id"] for r in body["detections"]] == ["bull_flag"]
    assert [r["pattern_id"] for r in body["structures"]] == ["bc:flat-base"]
    assert "drawn" in body
    admin = _client(ADMIN, monkeypatch, ROWS).get(URL).json()
    assert [r["pattern_id"] for r in admin["detections"]] == [r["pattern_id"] for r in ROWS]
    assert [r["display_tier"] for r in admin["detections"]] == [
        "trusted", "trusted", "experimental", "experimental"]
