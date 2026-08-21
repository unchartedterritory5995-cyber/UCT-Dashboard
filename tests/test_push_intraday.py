"""push_intraday must never overwrite the wire's published exposure.

The handler's own comment says "never overwrites wire_data" — until
2026-08-21 the very next block patched wire_data.exposure.score with the
brain's AI exposure_pct. One authority: the Morning Wire's published
score is THE UCT Exposure; the brain's opinion lives only under its own
cache key (intraday_update).
"""
import os
os.environ["PUSH_SECRET"] = "test-secret-123"

from fastapi.testclient import TestClient
from api.main import app
from api.services.cache import cache

client = TestClient(app)

AUTH = {"Authorization": "Bearer test-secret-123"}

BRAIN_PAYLOAD = {
    "mode": "preclose",
    "timestamp": "2026-08-21T14:31:00-05:00",
    "date": "2026-08-21",
    "regime": {"phase": "Uptrend", "trend_score": 7, "distribution_days": 1,
               "exposure_pct": 75, "risk_score": 3.0, "notes": "test"},
    "ep_updates": [],
    "session_notes": "",
}


def _seed_wire(score=55):
    cache.set("wire_data", {"date": "2026-08-21",
                            "exposure": {"score": score, "exposure": score}},
              ttl=82800)


def test_intraday_push_does_not_mutate_wire_exposure():
    _seed_wire(55)
    resp = client.post("/api/push/intraday", json=BRAIN_PAYLOAD, headers=AUTH)
    assert resp.status_code == 200
    wire = cache.get("wire_data")
    assert wire["exposure"]["score"] == 55
    assert wire["exposure"]["exposure"] == 55


def test_intraday_push_with_none_exposure_does_not_mutate_wire():
    """After the brain-side change its payload may carry exposure_pct: None —
    the old block would have written score = None."""
    _seed_wire(55)
    payload = {**BRAIN_PAYLOAD,
               "regime": {**BRAIN_PAYLOAD["regime"], "exposure_pct": None}}
    resp = client.post("/api/push/intraday", json=payload, headers=AUTH)
    assert resp.status_code == 200
    assert cache.get("wire_data")["exposure"]["score"] == 55


def test_intraday_update_still_stored_in_own_lane():
    cache.invalidate("intraday_update")
    resp = client.post("/api/push/intraday", json=BRAIN_PAYLOAD, headers=AUTH)
    assert resp.status_code == 200
    stored = cache.get("intraday_update")
    assert stored["regime"]["exposure_pct"] == 75
