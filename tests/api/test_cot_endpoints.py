# tests/api/test_cot_endpoints.py
"""Integration tests for /api/cot/* endpoints."""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with COT DB pointing at a temp directory."""
    monkeypatch.setenv("COT_DB_PATH", str(tmp_path / "cot_test.db"))
    # Re-import to pick up new DB_PATH
    import importlib
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()

    from api.main import app
    return TestClient(app)


def test_get_symbols_structure(client):
    resp = client.get("/api/cot/symbols")
    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    assert "INDICES" in data["groups"]
    assert "METALS"  in data["groups"]
    indices = data["groups"]["INDICES"]
    assert any(item["symbol"] == "ES" for item in indices)
    assert any(item["symbol"] == "NQ" for item in indices)
    # Each item has symbol + name
    for group_items in data["groups"].values():
        for item in group_items:
            assert "symbol" in item
            assert "name"   in item


def test_get_status_shape(client):
    resp = client.get("/api/cot/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "last_updated"            in data
    assert "next_scheduled_refresh"  in data
    assert "record_count"            in data
    assert data["record_count"] == 0   # empty test DB


def test_unknown_symbol_returns_404(client):
    resp = client.get("/api/cot/FAKESYMBOL")
    assert resp.status_code == 404


def test_weeks_below_range_returns_400(client):
    resp = client.get("/api/cot/ES?weeks=0")
    assert resp.status_code == 400


def test_weeks_above_range_returns_400(client):
    resp = client.get("/api/cot/ES?weeks=999")
    assert resp.status_code == 400


def test_get_cot_empty_db_returns_empty_list(client):
    resp = client.get("/api/cot/ES?weeks=52")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_cot_returns_correct_shape(client, tmp_path, monkeypatch):
    """Insert one record directly and verify the endpoint returns it."""
    monkeypatch.setenv("COT_DB_PATH", str(tmp_path / "cot_test.db"))
    import importlib
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()
    svc._upsert_records([{
        "symbol": "ES", "date": "2025-03-07",
        "large_spec_net": 150000, "commercial_net": -200000,
        "small_spec_net": 50000,  "open_interest": 2500000,
    }])
    from api.main import app
    c = TestClient(app)
    resp = c.get("/api/cot/ES?weeks=52")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    r = data[0]
    assert r["date"]           == "2025-03-07"
    assert r["large_spec_net"] == 150000
    assert r["commercial_net"] == -200000
    assert r["small_spec_net"] == 50000
    assert r["open_interest"]  == 2500000


def test_manual_refresh_accepted(client):
    with patch("api.services.cot_service.refresh_from_current", return_value=42):
        resp = client.post("/api/cot/refresh")
    assert resp.status_code == 200
    assert resp.json()["status"] == "refresh started"
