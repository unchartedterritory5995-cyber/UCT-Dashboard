"""Tests for the admin chart-health router (audit + quarantine REST endpoints)."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from api.main import app


@pytest.fixture
def admin_client():
    """Bypass auth for tests by overriding the admin dependency."""
    from api.routers import admin_chart_health
    app.dependency_overrides[admin_chart_health.require_admin] = (
        lambda: {"id": 1, "role": "admin", "email": "admin@test"}
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_get_latest_audit_when_none(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=None):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json() == {"report": None}


def test_get_latest_audit_returns_report(admin_client):
    fake = {"run_id": 7, "tickers_scanned": 100, "issues_found": 3}
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=fake):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json()["report"]["run_id"] == 7


def test_run_audit_kicks_off_background(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.audit_universe") as mock_run:
        mock_run.return_value = {"run_id": 8, "issues_found": 0}
        r = admin_client.post(
            "/api/admin/bars/audit/run",
            json={"tickers": ["QQQ", "SPY"], "tfs": ["30"], "bars_counts": [100], "parallelism": 2},
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "started"
    assert body.get("ticker_count") == 2


def test_run_audit_rejects_when_no_tickers_resolvable(admin_client):
    """If body omits tickers AND cap_universe.json is missing/empty, return 400."""
    with patch("api.routers.admin_chart_health._load_universe", return_value=[]):
        r = admin_client.post("/api/admin/bars/audit/run", json={})
    assert r.status_code == 400


def test_quarantine_count(admin_client):
    with patch("api.routers.admin_chart_health.bar_quarantine.count", return_value=42):
        r = admin_client.get("/api/admin/bars/quarantine/count")
    assert r.status_code == 200
    assert r.json() == {"count": 42}


def test_quarantine_list(admin_client):
    items = [{"ticker": "QQQ", "tf": "30", "bar_time": 123, "reason": "x", "source": None, "detected_at": 0}]
    with patch("api.routers.admin_chart_health.bar_quarantine.list_for_ticker", return_value=items):
        r = admin_client.get("/api/admin/bars/quarantine/list?ticker=QQQ&tf=30")
    assert r.status_code == 200
    assert r.json() == {"items": items}


def test_quarantine_remove(admin_client):
    with patch("api.routers.admin_chart_health.bar_quarantine.remove") as mock_remove:
        r = admin_client.post(
            "/api/admin/bars/quarantine/remove",
            json={"ticker": "QQQ", "tf": "30", "bar_time": 123},
        )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    mock_remove.assert_called_once_with("QQQ", "30", 123)


def test_admin_endpoints_require_auth_when_override_cleared():
    """Without the admin override, anonymous requests get 401."""
    client = TestClient(app)
    r = client.get("/api/admin/bars/quarantine/count")
    assert r.status_code in (401, 403)


def test_liveness_endpoint(admin_client):
    fake = {"QQQ": 5, "SPY": 12, "TSLA": 0}
    with patch("api.routers.admin_chart_health.realtime_stream.get_last_seen_ages", return_value=fake):
        r = admin_client.get("/api/admin/bars/liveness")
    assert r.status_code == 200
    assert r.json() == {"ages": fake}


def test_liveness_endpoint_empty(admin_client):
    with patch("api.routers.admin_chart_health.realtime_stream.get_last_seen_ages", return_value={}):
        r = admin_client.get("/api/admin/bars/liveness")
    assert r.status_code == 200
    assert r.json() == {"ages": {}}
