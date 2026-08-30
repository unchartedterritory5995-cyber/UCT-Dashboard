import time
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.pattern_engine import memory

# The pattern engine's output is `require_paid`, and `POST /{id}/feedback` is
# `get_current_user`, since the 2026-08-09 auth sweep — all of it answered
# anonymous callers before. These are BEHAVIOUR tests, so they get the caller
# they always implied; the gate itself is owned by
# tests/test_exposed_routes_gated.py and asserted exactly once, there.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)


client = TestClient(app)


def test_scan_and_types_routes_are_gone():
    """/scan and /types were removed 2026-08-26 with the Patterns page.

    The SPA catch-all can answer unrouted GETs with 200 HTML, so assert on the
    ROUTE TABLE, not a status code (the broker_sync 405 lesson).
    """
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/api/patterns/scan" not in paths
    assert "/api/patterns/types" not in paths
    # Control: the per-symbol read (chart overlay) is still routed.
    assert "/api/patterns/{sym}" in paths


def test_get_detections_for_symbol_no_data():
    """No detections in DB → empty list, 200 OK."""
    init_db()
    r = client.get("/api/patterns/NOSYM_XYZ?tf=D&confirmed_only=false")
    assert r.status_code == 200
    assert r.json()["detections"] == []


def test_get_detections_returns_stored():
    """Store a detection via memory layer; verify endpoint returns it."""
    init_db()
    d = {
        "id": "test-router-det-1",
        "sym": "ZZZZ", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100, "entry_condition": "", "stop": 95, "stop_basis": "",
                   "target_primary": 110, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 80.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 70.0,
                               "context_score": 80.0, "historical_score": 50.0},
        "narrative": {"headline": "", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        # ⛔ RELATIVE TO NOW, NEVER A DATE LITERAL. `get_active_detections`
        # windows on `detected_at >= now - ACTIVE_WINDOW_SECS` (7d, added
        # 2026-08-26). A 2023 literal sits silently outside it and empties
        # the assert -- which reads as a product bug and is a fixture rotting.
        "detected_at": int(time.time()) - 60,
        "last_seen_at": int(time.time()) - 60,
    }
    memory.store_detection(d)
    r = client.get("/api/patterns/ZZZZ?tf=D&confirmed_only=false")
    assert r.status_code == 200
    body = r.json()
    found = [x for x in body["detections"] if x["id"] == "test-router-det-1"]
    assert len(found) == 1


def test_min_conf_filter():
    """Detections below min_conf are excluded."""
    init_db()
    r = client.get("/api/patterns/ZZZZ?tf=D&min_conf=95&confirmed_only=false")
    assert r.status_code == 200
    body = r.json()
    found = [x for x in body["detections"] if x["id"] == "test-router-det-1"]
    assert len(found) == 0


def test_post_feedback():
    """POST feedback writes a row."""
    init_db()
    r = client.post(
        "/api/patterns/test-router-det-1/feedback",
        json={"rating": "great", "user_id": "test-user", "note": "looks clean"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("feedback_id") is not None


def test_post_feedback_invalid_rating():
    r = client.post(
        "/api/patterns/test-router-det-1/feedback",
        json={"rating": "garbage", "user_id": "test-user"},
    )
    assert r.status_code == 400
