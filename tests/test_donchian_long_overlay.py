"""donchian_breakout on the chart overlay: the LONG drawing never shows a downside (bearish) break.

The detector emits its 20/55-bar LOW breaks (Turtle shorts) under the same id as its long breakouts.
Firing is untouched; registry.row_display_policy stamps such a row `hidden`, and PatternOverlay never
draws a hidden row. Synthetic bars only (public repo).
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.classical.donchian_breakout import detect_donchian_breakout
from api.services.pattern_engine.primitives.context import build_context
from tests.authclients import ADMIN, authorize
from tests.detector_fixtures import ymd_t


def _range_then(last_close: float, last_vol: float = 3_000_000.0) -> list:
    """90 sessions in a 99-101 range, then one session closing at `last_close` on heavy volume."""
    bars = []
    for i in range(90):
        c = 100.0 + (0.5 if i % 2 else -0.5)
        bars.append({"t": ymd_t(i), "o": 100.0, "h": 101.0, "l": 99.0, "c": c, "v": 1_000_000.0})
    lo, hi = min(100.0, last_close) - 0.5, max(100.0, last_close) + 0.5
    bars.append({"t": ymd_t(90), "o": 100.0, "h": hi, "l": lo, "c": last_close, "v": last_vol})
    return bars


def _fire(bars):
    return detect_donchian_breakout(bars, build_context(bars, sym="TEST"))


def test_the_detector_still_fires_both_directions():
    """Firing is untouched: the low break is still detected, under the same id."""
    down = _fire(_range_then(95.0))
    up = _fire(_range_then(105.0))
    assert [d["direction"] for d in down] == ["bearish"]
    assert [d["direction"] for d in up] == ["bullish"]
    assert {d["pattern_id"] for d in down + up} == {"donchian_breakout"}


def test_a_bearish_row_is_hidden_and_a_bullish_row_keeps_the_ids_tier():
    base = registry.display_policy("donchian_breakout")["display_tier"]
    assert base != "hidden"   # control: the id itself draws (experimental), so hiding is per row
    pol = registry.row_display_policy
    assert pol({"pattern_id": "donchian_breakout", "direction": "bearish"})["display_tier"] == "hidden"
    assert pol({"pattern_id": "donchian_breakout", "direction": "Bearish"})["display_tier"] == "hidden"
    assert pol({"pattern_id": "donchian_breakout", "direction": "bullish"})["display_tier"] == base
    assert pol({"pattern_id": "donchian_breakout"})["display_tier"] == base
    # only the named id: another id's bearish row keeps its own tier
    assert pol({"pattern_id": "rectangle", "direction": "bearish"})["display_tier"] == \
        registry.display_policy("rectangle")["display_tier"]


def test_the_detectors_own_rows_route_to_the_right_tier():
    """End to end from real detector output: the bearish fire is hidden, the bullish one is not."""
    down = _fire(_range_then(95.0))[0]
    up = _fire(_range_then(105.0))[0]
    assert registry.row_display_policy(down)["display_tier"] == "hidden"
    assert registry.row_display_policy(up)["display_tier"] != "hidden"


def test_the_route_serves_a_bearish_donchian_row_as_hidden(monkeypatch):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, ADMIN)
    rows = [{"id": "dn", "pattern_id": "donchian_breakout", "direction": "bearish", "last_seen_at": 1},
            {"id": "up", "pattern_id": "donchian_breakout", "direction": "bullish", "last_seen_at": 1}]
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", lambda *a, **k: [dict(r) for r in rows])
    body = TestClient(app).get("/api/patterns/ZZZ?tf=D&confirmed_only=false").json()
    tiers = {r["id"]: r["display_tier"] for r in body["detections"]}
    assert tiers["dn"] == "hidden" and tiers["up"] != "hidden"
    assert body["count"] == 2   # served (an admin's "All" still lists it), never drawn
