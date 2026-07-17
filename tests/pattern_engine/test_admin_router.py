import time
import uuid

from fastapi.testclient import TestClient

from api.main import app
from api.services.pattern_engine.pattern_db import get_connection, init_db
from api.services.pattern_engine import memory


client = TestClient(app)


def _uid(prefix: str) -> str:
    """Generate a unique detection id per test invocation. Tests share a
    persistent SQLite db on disk, so reusing fixed ids across runs would
    trip pattern_detections.id UNIQUE constraint."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def test_health_endpoint_returns_200_and_required_keys():
    r = client.get("/api/admin/patterns/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("detector_count", "stored_detections_total", "registered_detectors",
                "stored_by_pattern", "stored_by_status", "schema_version"):
        assert key in body


# ─── Gate 5 operator review ────────────────────────────────────────────────

def _seed_detection(det_id: str, detected_at: int | None = None) -> dict:
    """Insert a minimal Detection through memory.store_detection.

    Uses a randomized sym so hash_key is unique per call — hash_key derives
    from (sym, tf, pattern_id, start_t, end_t) and SQLite UNIQUEs it. Two
    calls within the same second would otherwise collide.
    """
    if detected_at is None:
        detected_at = int(time.time())
    unique_sym = f"ADM{uuid.uuid4().hex[:5].upper()}"
    d = {
        "id": det_id,
        "sym": unique_sym, "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": detected_at - 3600,
        "end_t": detected_at,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "",
                   "stop": 95.0, "stop_basis": "",
                   "target_primary": 110.0, "target_secondary": None,
                   "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 80.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 70.0,
                               "context_score": 80.0, "historical_score": 50.0},
        "narrative": {"headline": "Test bull flag forming",
                      "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": detected_at, "last_seen_at": detected_at,
    }
    memory.store_detection(d)
    return d


def test_recent_endpoint_returns_window():
    init_db()
    r = client.get("/api/admin/patterns/recent?hours=48")
    assert r.status_code == 200
    body = r.json()
    for key in ("detections", "count", "reviewed_count", "accepted",
                "rejected", "flagged", "accept_rate_pct", "hours_window"):
        assert key in body
    assert body["hours_window"] == 48
    assert isinstance(body["detections"], list)


def test_recent_endpoint_clamps_hours():
    """hours param bounded 1-168."""
    r = client.get("/api/admin/patterns/recent?hours=999")
    assert r.status_code == 422
    r = client.get("/api/admin/patterns/recent?hours=0")
    assert r.status_code == 422


def test_recent_endpoint_includes_review_fields():
    init_db()
    det_id = _uid("test-admin-recent")
    _seed_detection(det_id)
    r = client.get("/api/admin/patterns/recent?hours=24")
    assert r.status_code == 200
    body = r.json()
    found = [d for d in body["detections"] if d["id"] == det_id]
    assert len(found) == 1
    d = found[0]
    assert "reviewed" in d
    assert "reviewer_rating" in d
    assert "reviewer_note" in d
    assert d["reviewed"] is False
    assert d["reviewer_rating"] is None


def test_review_endpoint_accepts_valid_action():
    init_db()
    det_id = _uid("test-admin-review-accept")
    _seed_detection(det_id)
    r = client.post(
        f"/api/admin/patterns/{det_id}/review",
        json={"action": "accept", "note": "clean setup"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "accept"
    assert body["feedback_id"] is not None


def test_review_endpoint_rejects_invalid_action():
    r = client.post(
        "/api/admin/patterns/whatever/review",
        json={"action": "garbage"},
    )
    assert r.status_code == 400


def test_review_then_recent_marks_reviewed():
    """End-to-end: store → review → recent shows reviewed=true with rating."""
    init_db()
    det_id = _uid("test-admin-review-flow")
    _seed_detection(det_id)

    # Submit a reject
    r = client.post(
        f"/api/admin/patterns/{det_id}/review",
        json={"action": "reject", "note": "fake breakout"},
    )
    assert r.status_code == 200

    # Verify recent picks it up
    r2 = client.get("/api/admin/patterns/recent?hours=24")
    assert r2.status_code == 200
    body = r2.json()
    matched = [d for d in body["detections"] if d["id"] == det_id]
    assert len(matched) == 1
    d = matched[0]
    assert d["reviewed"] is True
    assert d["reviewer_rating"] == "wrong"
    assert d["reviewer_note"] == "fake breakout"
    assert body["reviewed_count"] >= 1
    assert body["rejected"] >= 1


def test_review_action_mapping():
    """All three actions map to the right pattern_feedback rating."""
    init_db()
    cases = [
        (_uid("test-admin-map-accept"), "accept", "great"),
        (_uid("test-admin-map-reject"), "reject", "wrong"),
        (_uid("test-admin-map-flag"), "flag", "miss"),
    ]
    for det_id, action, expected_rating in cases:
        _seed_detection(det_id)
        r = client.post(
            f"/api/admin/patterns/{det_id}/review",
            json={"action": action},
        )
        assert r.status_code == 200, f"{action} failed: {r.text}"

    # Verify in the DB
    conn = get_connection()
    try:
        for det_id, _action, expected_rating in cases:
            row = conn.execute("""
                SELECT rating, user_id FROM pattern_feedback
                WHERE detection_id = ? AND user_id = 'admin_operator'
                ORDER BY created_at DESC LIMIT 1
            """, (det_id,)).fetchone()
            assert row is not None, f"no feedback for {det_id}"
            assert row["rating"] == expected_rating
            assert row["user_id"] == "admin_operator"
    finally:
        conn.close()
