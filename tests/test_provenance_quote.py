"""Tests for GET /api/provenance/quote (S8 Step 2 — live D1 -> S8 wiring).

No-auth, matching /api/live-prices and /api/fundamentals/{ticker}'s existing
no-auth convention for ordinary quote-shaped data. Mocks the HTTP layer
inside each adapter (never the network), same pattern as
test_fmp_client.py / test_massive_d1.py.
"""
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services import fmp_client as fc
from api.services import massive as m
from api.services.cache import cache as _cache


@pytest.fixture(scope="module")
def client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    fc._bucket_denied_total = 0
    fc._served_total = 0
    m._bucket_tokens = m._MASSIVE_RATE_LIMIT_PER_MIN
    m._bucket_updated = time.monotonic()
    m._bucket_denied_total = 0
    m._served_total = 0
    _cache.delete_prefix("massive_forbidden_")
    _cache.delete_prefix("fmp_forbidden_")
    yield


def _fmp_resp(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else []
    resp.raise_for_status.return_value = None
    return resp


def _massive_resp(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else {}
    resp.raise_for_status.return_value = None
    return resp


def test_both_vendors_answer_successfully(client):
    fmp_body = [{"symbol": "AAPL", "price": 230.0, "timestamp": time.time() - 300}]
    massive_body = {"status": "OK", "ticker": {"day": {"c": 230.5}, "updated": int(time.time() * 1e9)}}
    with patch.object(fc._session, "get", return_value=_fmp_resp(200, fmp_body)), \
         patch.object(m._http, "get", return_value=_massive_resp(200, massive_body)):
        r = client.get("/api/provenance/quote", params={"symbol": "aapl"})
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "AAPL"
    assert body["vendors"]["fmp"]["freshness"] == "delayed_15"
    assert body["vendors"]["fmp"]["provenance"]["vendor"] == "fmp"
    assert body["vendors"]["massive"]["freshness"] == "real_time"
    assert body["vendors"]["massive"]["provenance"]["vendor"] == "massive"


def test_a_single_vendor_can_be_requested(client):
    with patch.object(fc._session, "get", return_value=_fmp_resp(200, [{"symbol": "AAPL", "timestamp": time.time()}])):
        r = client.get("/api/provenance/quote", params={"symbol": "AAPL", "vendor": "fmp"})
    body = r.json()
    assert "fmp" in body["vendors"]
    assert "massive" not in body["vendors"]


def test_massives_live_confirmed_index_entitlement_gap_reports_honestly(client):
    """The exact live-confirmed case from the D1 checkpoint: a 403, not a
    format problem. Must surface as entitlement_denied=true, not a 500."""
    with patch.object(m._http, "get", return_value=_massive_resp(403)):
        r = client.get("/api/provenance/quote", params={"symbol": "SPX", "vendor": "massive"})
    assert r.status_code == 200  # the ENDPOINT succeeds; the vendor result reports the failure
    v = r.json()["vendors"]["massive"]
    assert v["error"] is True
    assert v["kind"] == "auth_error"
    assert v["entitlement_denied"] is True


def test_a_401_reports_entitlement_denied_false(client):
    with patch.object(fc._session, "get", return_value=_fmp_resp(401)):
        r = client.get("/api/provenance/quote", params={"symbol": "AAPL", "vendor": "fmp"})
    v = r.json()["vendors"]["fmp"]
    assert v["kind"] == "auth_error"
    assert v["entitlement_denied"] is False


def test_not_found_reports_the_typed_kind_not_a_500(client):
    with patch.object(fc._session, "get", return_value=_fmp_resp(200, [])):
        r = client.get("/api/provenance/quote", params={"symbol": "ZZZNOTREAL", "vendor": "fmp"})
    assert r.status_code == 200
    v = r.json()["vendors"]["fmp"]
    assert v["error"] is True
    assert v["kind"] == "not_found"


def test_a_5xx_reports_transient_not_a_500(client):
    with patch.object(m._http, "get", return_value=_massive_resp(500)):
        r = client.get("/api/provenance/quote", params={"symbol": "AAPL", "vendor": "massive"})
    v = r.json()["vendors"]["massive"]
    assert v["kind"] == "transient"


def test_one_vendors_failure_never_blocks_the_others_success(client):
    with patch.object(fc._session, "get", return_value=_fmp_resp(500)), \
         patch.object(m._http, "get", return_value=_massive_resp(200, {"status": "OK", "ticker": {"day": {"c": 1.0}}})):
        r = client.get("/api/provenance/quote", params={"symbol": "AAPL"})
    body = r.json()["vendors"]
    assert body["fmp"]["error"] is True
    assert "error" not in body["massive"]


def test_no_auth_required(client):
    with patch.object(fc._session, "get", return_value=_fmp_resp(200, [{"symbol": "AAPL"}])):
        r = client.get("/api/provenance/quote", params={"symbol": "AAPL", "vendor": "fmp"})
    assert r.status_code == 200


def test_index_entity_type_applies_the_caret_prefix(client):
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured["symbol"] = params.get("symbol")
        return _fmp_resp(200, [{"symbol": "^SPX"}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        client.get("/api/provenance/quote", params={"symbol": "SPX", "vendor": "fmp", "entity_type": "index"})
    assert captured["symbol"] == "^SPX"
