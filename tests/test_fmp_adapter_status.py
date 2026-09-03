"""Tests for GET /api/admin/fmp-adapter-status (D1 §7.3 admin/status surface).

No-auth, read-only — mirrors `test_provider_coverage_monitor.py`'s router-level
shape isn't a separate file there (that endpoint is exercised indirectly); this
one drives the real ASGI app directly, same as `test_admin_chart_health.py`'s
`real_app`/`client` fixtures, since a no-auth endpoint has no gate to fake.
"""
import time

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from api.services import fmp_client as fc


@pytest.fixture(scope="module")
def client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    fc._bucket_denied_total = 0
    fc._served_total = 0
    yield


def _mock_response(status_code=200, json_value=None):
    from unittest.mock import MagicMock
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else []
    resp.raise_for_status.return_value = None
    return resp


def test_status_endpoint_is_reachable_with_no_auth(client):
    r = client.get("/api/admin/fmp-adapter-status")
    assert r.status_code == 200


def test_status_reports_key_present_when_env_set(client, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["vendor"] == "fmp"
    assert body["evidence_ladder"]["KP"] is True


def test_status_reports_key_absent_when_env_unset(client, monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["evidence_ladder"]["KP"] is False


def test_status_never_exposes_the_key_value(client, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "super-secret-value-12345")
    r = client.get("/api/admin/fmp-adapter-status")
    assert "super-secret-value-12345" not in r.text


def test_status_oc_field_is_false_before_any_call(client):
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["evidence_ladder"]["OC"] is False
    assert body["budget"]["served_total"] == 0


def test_status_oc_field_flips_true_after_a_real_call(client):
    with patch.object(fc._session, "get", return_value=_mock_response(200, [{"ok": True}])):
        fc.get_quote("AAPL")
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["evidence_ladder"]["OC"] is True
    assert body["budget"]["served_total"] == 1


def test_status_ca_field_is_never_auto_derived(client):
    """Spec §18.2: CA (contract-active) has no automated promotion path —
    always reported as null, never guessed from any other signal."""
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["evidence_ladder"]["CA"] is None


def test_status_budget_shape_matches_fmp_client_budget(client):
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert set(body["budget"].keys()) == {"tokens_remaining", "ceiling", "denied_total", "served_total"}


def test_status_honestly_reports_coverage_db_not_registered(client):
    """Spec §18.1's field-registration work is separate, not-yet-done work —
    this endpoint must not fabricate a registered link."""
    body = client.get("/api/admin/fmp-adapter-status").json()
    assert body["coverage_db_registered"] is False
