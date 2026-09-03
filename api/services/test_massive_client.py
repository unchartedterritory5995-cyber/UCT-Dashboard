"""D1 — Massive adapter tests (minimum scope built for the Real-Provider
Validation Checkpoint). Every test mocks `massive._http.get` (no real
network call) and resets the module's own token bucket / cache state so
tests never leak into each other. Mirrors test_fmp_client.py's shape.
"""
import time
from unittest.mock import MagicMock, patch

import pytest

from api.services import massive_client as mc
from api.services.cache import cache as _cache


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    mc._bucket_tokens = mc._MASSIVE_RATE_LIMIT_PER_MIN
    mc._bucket_updated = time.monotonic()
    mc._bucket_denied_total = 0
    _cache.invalidate("massive_forbidden_get_quote")
    yield


def _mock_response(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"{status_code} error")
    else:
        resp.raise_for_status.return_value = None
    return resp


def test_missing_api_key_raises_not_configured(monkeypatch):
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    with pytest.raises(mc.MassiveNotConfigured):
        mc.get_quote("AAPL")


def test_successful_call_returns_provider_result_with_value_and_provenance():
    ok_body = {"status": "OK", "ticker": {"day": {"c": 230.0}, "todaysChangePerc": 1.2}}
    with patch.object(mc._http, "get", return_value=_mock_response(200, ok_body)):
        result = mc.get_quote("AAPL")
    assert result.value == {"day": {"c": 230.0}, "todaysChangePerc": 1.2}
    assert result.provenance.vendor == "massive"
    assert result.provenance.source_activity == "massive_client.get_quote"
    assert result.licensing_class == "R"
    assert result.freshness == "real_time"
    assert result.degraded is None


def test_dot_symbol_translation_applied_for_dual_class_ticker():
    """BRK-B must resolve to BRK.B at the Massive REST boundary — same
    verified translation `to_polygon_symbol()` already applies."""
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch.object(mc._http, "get", side_effect=_fake_get):
        mc.get_quote("BRK-B")
    assert "BRK.B" in captured["url"]
    assert "BRK-B" not in captured["url"]


def test_entity_master_vendor_symbol_preferred_when_available():
    """When entity_id resolves to a real Entity Master vendor_symbol
    mapping, it wins over to_polygon_symbol() -- the D1 authorization's
    Section 6 design."""
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch("api.services.entity_master.api.vendor_symbol", return_value="BRK.B-EM"), \
         patch.object(mc._http, "get", side_effect=_fake_get):
        mc.get_quote("BRK-B", entity_id="01FAKE")
    assert "BRK.B-EM" in captured["url"]


def test_entity_master_lookup_failure_falls_back_to_to_polygon_symbol():
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch("api.services.entity_master.api.vendor_symbol", side_effect=RuntimeError("db down")), \
         patch.object(mc._http, "get", side_effect=_fake_get):
        mc.get_quote("BRK-B", entity_id="01FAKE")
    assert "BRK.B" in captured["url"]


def test_no_entity_master_mapping_falls_back_to_to_polygon_symbol():
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch("api.services.entity_master.api.vendor_symbol", return_value=None), \
         patch.object(mc._http, "get", side_effect=_fake_get):
        mc.get_quote("BRK-B", entity_id="01FAKE")
    assert "BRK.B" in captured["url"]


def test_status_not_ok_raises_not_found():
    """Massive DOES carry a status field (unlike FMP) -- an unsupported
    symbol answers 200 with a non-OK/DELAYED status, not an empty list."""
    with patch.object(mc._http, "get", return_value=_mock_response(200, {"status": "NOT_FOUND"})):
        with pytest.raises(mc.MassiveNotFound):
            mc.get_quote("ZZZNOTREAL")


def test_bare_http_404_also_raises_not_found():
    """Live-verified during the Real-Provider Validation Checkpoint
    (2026-09-02): a genuinely unsupported/delisted/nonexistent symbol
    (ZZZNOTREAL, a delisted equity, a plain index ticker with no "I:"
    prefix) answers with a bare HTTP 404, NOT a 200 body carrying a
    non-OK `status` field. The initial adapter build only handled the
    200-body shape and mapped a real 404 to MassiveTransient -- a
    misclassification this checkpoint's whole purpose is to catch."""
    with patch.object(mc._http, "get", return_value=_mock_response(404)):
        with pytest.raises(mc.MassiveNotFound):
            mc.get_quote("ZZZNOTREAL")


def test_401_raises_auth_error_and_caches_forbidden_for_next_call():
    with patch.object(mc._http, "get", return_value=_mock_response(401)) as mock_get:
        with pytest.raises(mc.MassiveAuthError):
            mc.get_quote("AAPL")
    with patch.object(mc._http, "get") as mock_get2:
        result = mc.get_quote("AAPL")
    mock_get2.assert_not_called()
    assert result.degraded == "cached_forbidden"
    assert result.degraded_since is not None
    assert result.value is None


def test_429_raises_rate_limited():
    with patch.object(mc._http, "get", return_value=_mock_response(429)):
        with pytest.raises(mc.MassiveRateLimited) as exc_info:
            mc.get_quote("AAPL")
    assert exc_info.value.status == 429


def test_5xx_raises_transient():
    with patch.object(mc._http, "get", return_value=_mock_response(500)):
        with pytest.raises(mc.MassiveTransient):
            mc.get_quote("AAPL")


def test_network_error_raises_transient():
    with patch.object(mc._http, "get", side_effect=ConnectionError("dns fail")):
        with pytest.raises(mc.MassiveTransient):
            mc.get_quote("AAPL")


def test_rate_limiter_sheds_calls_once_ceiling_exhausted(monkeypatch):
    monkeypatch.setattr(mc, "_MASSIVE_RATE_LIMIT_PER_MIN", 3.0)
    mc._bucket_tokens = 3.0
    mc._bucket_updated = time.monotonic()
    mc._bucket_denied_total = 0
    with patch.object(mc._http, "get", return_value=_mock_response(200, {"status": "OK", "ticker": {}})):
        for _ in range(3):
            mc.get_quote("AAPL")
        with pytest.raises(mc.MassiveRateLimited):
            mc.get_quote("AAPL")
    assert mc._bucket_denied_total == 1


def test_budget_reports_current_state():
    b = mc.budget()
    assert set(b.keys()) == {"tokens_remaining", "ceiling", "denied_total"}
    assert b["ceiling"] == mc._MASSIVE_RATE_LIMIT_PER_MIN


def test_no_two_vendor_errors_share_identity_with_fmp():
    from api.services import fmp_client as fc
    assert not issubclass(mc.MassiveNotFound, fc.FMPNotFound)
    assert not issubclass(fc.FMPNotFound, mc.MassiveNotFound)
