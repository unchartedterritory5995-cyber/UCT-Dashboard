import pytest
import os
os.environ["PUSH_SECRET"] = "test-secret-123"

from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

SAMPLE_PAYLOAD = {
    "date": "2026-02-22",
    "rundown_html": "<p>Test rundown</p>",
    "leadership": [{"sym": "NVDA", "thesis": "AI leader"}],
    "themes": {"XLK": {"name": "Tech", "ticker": "XLK", "1W": 2.5, "1M": 5.0, "3M": 12.0}},
    "earnings": {"bmo": [], "amc": []},
}

def test_push_valid_secret_returns_ok():
    resp = client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer test-secret-123"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

def test_push_invalid_secret_returns_401():
    resp = client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer wrong-secret"},
    )
    assert resp.status_code == 401

def test_push_no_auth_returns_401():
    resp = client.post("/api/push", json=SAMPLE_PAYLOAD)
    assert resp.status_code == 401

def test_push_data_stored_in_cache():
    from api.services.cache import cache
    cache.invalidate("wire_data")
    client.post(
        "/api/push",
        json=SAMPLE_PAYLOAD,
        headers={"Authorization": "Bearer test-secret-123"},
    )
    stored = cache.get("wire_data")
    assert stored is not None
    assert stored.get("date") == "2026-02-22"
