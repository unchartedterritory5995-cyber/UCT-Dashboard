"""Tests for GET /api/admin/massive-adapter-status (D1 §7.3 admin/status
surface). Mirrors test_fmp_adapter_status.py's shape."""
import time

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from api.services import massive as m
from api.services.cache import cache as _cache


@pytest.fixture(scope="module")
def client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    m._bucket_tokens = m._MASSIVE_RATE_LIMIT_PER_MIN
    m._bucket_updated = time.monotonic()
    m._bucket_denied_total = 0
    m._served_total = 0
    _cache.delete_prefix("massive_forbidden_")
    yield


def _mock_response(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else {}
    resp.raise_for_status.return_value = None
    return resp


def test_status_endpoint_is_reachable_with_no_auth(client):
    r = client.get("/api/admin/massive-adapter-status")
    assert r.status_code == 200


def test_status_reports_key_present_when_env_set(client, monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["vendor"] == "massive"
    assert body["evidence_ladder"]["KP"] is True


def test_status_reports_key_absent_when_env_unset(client, monkeypatch):
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["evidence_ladder"]["KP"] is False


def test_status_never_exposes_the_key_value(client, monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "super-secret-value-12345")
    r = client.get("/api/admin/massive-adapter-status")
    assert "super-secret-value-12345" not in r.text


def test_status_oc_field_is_false_before_any_call(client):
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["evidence_ladder"]["OC"] is False
    assert body["budget"]["served_total"] == 0


def test_status_oc_field_flips_true_after_a_real_call(client):
    c = m._MassiveRestClient()
    with patch.object(m._http, "get", return_value=_mock_response(200, {"status": "OK", "ticker": {}})):
        c.get_quote("AAPL")
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["evidence_ladder"]["OC"] is True
    assert body["budget"]["served_total"] == 1


def test_status_ca_field_is_never_auto_derived(client):
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["evidence_ladder"]["CA"] is None


def test_status_budget_shape_matches_massive_budget(client):
    body = client.get("/api/admin/massive-adapter-status").json()
    assert set(body["budget"].keys()) == {"tokens_remaining", "ceiling", "denied_total", "served_total"}


def test_status_honestly_reports_coverage_db_not_registered(client):
    body = client.get("/api/admin/massive-adapter-status").json()
    assert body["coverage_db_registered"] is False


def test_status_names_the_index_entitlement_limitation(client):
    """Live-confirmed during the checkpoint: index quotes 403 for this key/
    plan regardless of symbol format — a real, unfixed gap, not invented."""
    body = client.get("/api/admin/massive-adapter-status").json()
    limitations = " ".join(body["known_limitations"])
    assert "index" in limitations.lower()
    assert "get_index_quote" not in body["typed_functions"]
