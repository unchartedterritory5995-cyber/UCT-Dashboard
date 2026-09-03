"""D1 — Massive adapter tests. Per provider-abstraction-spec.md §10.1, the
adapter EXTENDS `_MassiveRestClient` in place rather than a parallel module
(unlike FMP, which had no existing chokepoint class) — so these tests target
`massive._MassiveRestClient`'s new typed methods (`get_quote`,
`get_batch_quotes`) and the batch-symbol-translation bug fix
(`get_batch_snapshots`/`get_batch_rich_snapshots`), mocking `massive._http.get`
(no real network call). Mirrors test_fmp_client.py's shape.
"""
import time
from unittest.mock import MagicMock, patch

import pytest

from api.services import massive as m
from api.services.cache import cache as _cache


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "test-key")
    m._bucket_tokens = m._MASSIVE_RATE_LIMIT_PER_MIN
    m._bucket_updated = time.monotonic()
    m._bucket_denied_total = 0
    # forbidden_key includes the per-symbol path (e.g.
    # "massive_forbidden_/v2/.../tickers/AAPL"), so a plain-cache singleton
    # would otherwise leak the 401 test's cached-forbidden state into every
    # later test that also uses "AAPL" — sweep the whole prefix, not one key.
    _cache.delete_prefix("massive_forbidden_")
    yield


def _client():
    return m._MassiveRestClient()


def _mock_response(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"{status_code} error")
    else:
        resp.raise_for_status.return_value = None
    return resp


# ── get_quote ────────────────────────────────────────────────────────────────

def test_missing_api_key_raises_not_configured(monkeypatch):
    """`_MassiveRestClient.__init__` already guards this (pre-existing,
    unchanged behavior — a bare RuntimeError, not this build's typed
    MassiveNotConfigured) since the class always requires a key to
    construct at all. get_quote's own `if not self._api_key` check is
    defensive dead code under normal construction, kept for a caller that
    might someday bypass __init__ (e.g. via __new__)."""
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MASSIVE_API_KEY"):
        _client()


def test_get_quote_returns_provider_result_with_value_and_provenance():
    c = _client()
    ok_body = {"status": "OK", "ticker": {"day": {"c": 230.0}, "todaysChangePerc": 1.2}}
    with patch.object(m._http, "get", return_value=_mock_response(200, ok_body)):
        result = c.get_quote("AAPL")
    assert result.value == {"day": {"c": 230.0}, "todaysChangePerc": 1.2}
    assert result.provenance.vendor == "massive"
    assert result.provenance.source_activity == "massive.get_quote"
    assert result.licensing_class == "R"
    assert result.freshness == "real_time"
    assert result.degraded is None


def test_get_quote_dot_symbol_translation_for_dual_class_ticker():
    c = _client()
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch.object(m._http, "get", side_effect=_fake_get):
        c.get_quote("BRK-B")
    assert "BRK.B" in captured["url"]
    assert "BRK-B" not in captured["url"]


def test_get_quote_entity_master_vendor_symbol_preferred():
    c = _client()
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch("api.services.entity_master.api.vendor_symbol", return_value="BRK.B-EM"), \
         patch.object(m._http, "get", side_effect=_fake_get):
        c.get_quote("BRK-B", entity_id="01FAKE")
    assert "BRK.B-EM" in captured["url"]


def test_get_quote_entity_master_failure_falls_back_to_to_polygon_symbol():
    c = _client()
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"status": "OK", "ticker": {}})

    with patch("api.services.entity_master.api.vendor_symbol", side_effect=RuntimeError("db down")), \
         patch.object(m._http, "get", side_effect=_fake_get):
        c.get_quote("BRK-B", entity_id="01FAKE")
    assert "BRK.B" in captured["url"]


def test_get_quote_status_not_ok_raises_not_found():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(200, {"status": "NOT_FOUND"})):
        with pytest.raises(m.MassiveNotFound):
            c.get_quote("ZZZNOTREAL")


def test_get_quote_bare_http_404_also_raises_not_found():
    """Live-verified during the Real-Provider Validation Checkpoint
    (2026-09-02): a delisted equity, a plain index ticker, and a nonexistent
    symbol all answered with a bare HTTP 404, not the 200-body-with-non-OK-
    status shape spec §10.5 anticipated."""
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(404)):
        with pytest.raises(m.MassiveNotFound):
            c.get_quote("ZZZNOTREAL")


def test_get_quote_401_raises_auth_error_and_caches_forbidden():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(401)):
        with pytest.raises(m.MassiveAuthError):
            c.get_quote("AAPL")
    with patch.object(m._http, "get") as mock_get2:
        result = c.get_quote("AAPL")
    mock_get2.assert_not_called()
    assert result.degraded == "cached_forbidden"
    assert result.degraded_since is not None
    assert result.value is None


def test_get_quote_429_raises_rate_limited():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(429)):
        with pytest.raises(m.MassiveRateLimited) as exc_info:
            c.get_quote("AAPL")
    assert exc_info.value.status == 429


def test_get_quote_5xx_raises_transient():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(500)):
        with pytest.raises(m.MassiveTransient):
            c.get_quote("AAPL")


def test_get_quote_network_error_raises_transient():
    c = _client()
    with patch.object(m._http, "get", side_effect=ConnectionError("dns fail")):
        with pytest.raises(m.MassiveTransient):
            c.get_quote("AAPL")


# ── get_batch_quotes ─────────────────────────────────────────────────────────

def test_get_batch_quotes_empty_input_returns_empty_value_no_call():
    c = _client()
    with patch.object(m._http, "get") as mock_get:
        result = c.get_batch_quotes([])
    mock_get.assert_not_called()
    assert result.value == {}
    assert result.degraded is None


def test_get_batch_quotes_translates_dual_class_and_maps_back_to_canonical():
    """The exact bug live_prices.py::_fetch_snapshots's own docstring named:
    dual-class tickers sent unmapped to the batch endpoint come back n=0 for
    that symbol. get_batch_quotes must request the DOT form and key its
    result by the caller's original (hyphen) form."""
    c = _client()
    captured = {}

    def _fake_get(url, timeout=None):
        captured["url"] = url
        return _mock_response(200, {"tickers": [
            {"ticker": "AAPL", "day": {"c": 230.0}},
            {"ticker": "BRK.B", "day": {"c": 505.0}},
        ]})

    with patch.object(m._http, "get", side_effect=_fake_get):
        result = c.get_batch_quotes(["AAPL", "BRK-B"])
    assert "BRK.B" in captured["url"]
    assert "BRK-B" not in captured["url"]
    assert set(result.value.keys()) == {"AAPL", "BRK-B"}
    assert result.value["BRK-B"]["day"]["c"] == 505.0


def test_get_batch_quotes_missing_tickers_are_simply_absent_not_an_error():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(200, {"tickers": [
        {"ticker": "AAPL", "day": {"c": 230.0}},
    ]})):
        result = c.get_batch_quotes(["AAPL", "ZZZNOTREAL"])
    assert set(result.value.keys()) == {"AAPL"}
    assert result.degraded is None


def test_get_batch_quotes_401_degrades_rather_than_raising_for_the_batch():
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(401)):
        with pytest.raises(m.MassiveAuthError):
            c.get_batch_quotes(["AAPL"])
    with patch.object(m._http, "get") as mock_get2:
        result = c.get_batch_quotes(["AAPL"])
    mock_get2.assert_not_called()
    assert result.degraded == "cached_forbidden"
    assert result.value is None


# ── Existing methods' external contract is UNCHANGED (acceptance criterion 9) ─

def test_get_batch_snapshots_dual_class_ticker_now_resolves_instead_of_silently_dropping():
    """Before the D1 fix, this method never called to_polygon_symbol()
    internally -- a dual-class ticker request came back n=0 and was silently
    absent from the result. Real behavior improvement, contract unchanged
    (still a plain {ticker: pct} dict, never raises)."""
    c = _client()
    c._SNAPSHOT_BATCH = 200  # class attribute already set; explicit for clarity

    def _fake_get(url, timeout=None):
        assert "BRK.B" in url
        assert "BRK-B" not in url
        return {"tickers": [
            {"ticker": "BRK.B", "day": {"c": 510.0}, "prevDay": {"c": 500.0}},
        ]}

    with patch.object(c, "_get", side_effect=_fake_get):
        out = c.get_batch_snapshots(["BRK-B"])
    assert "BRK-B" in out
    assert out["BRK-B"] == round((510.0 - 500.0) / 500.0 * 100.0, 4)


def test_get_batch_rich_snapshots_dual_class_ticker_now_resolves():
    c = _client()

    def _fake_get(url, timeout=None):
        assert "BF.B" in url
        return {"tickers": [
            {"ticker": "BF.B", "day": {"c": 40.0, "o": 39.5}, "prevDay": {"c": 39.0}},
        ]}

    with patch.object(c, "_get", side_effect=_fake_get):
        out = c.get_batch_rich_snapshots(["BF-B"])
    assert "BF-B" in out
    assert out["BF-B"]["price"] == 40.0


def test_get_single_ticker_snapshot_still_returns_plain_dict_never_raises():
    """Unaffected by the D1 additions -- confirms acceptance criterion 9
    ("zero application call-site changes") for this pre-existing method."""
    c = _client()
    with patch.object(c, "_get", side_effect=RuntimeError("network down")):
        out = c.get_single_ticker_snapshot("AAPL")
    assert out == {}


# ── Rate limiter / budget ────────────────────────────────────────────────────

def test_rate_limiter_sheds_calls_once_ceiling_exhausted(monkeypatch):
    monkeypatch.setattr(m, "_MASSIVE_RATE_LIMIT_PER_MIN", 3.0)
    m._bucket_tokens = 3.0
    m._bucket_updated = time.monotonic()
    m._bucket_denied_total = 0
    c = _client()
    with patch.object(m._http, "get", return_value=_mock_response(200, {"status": "OK", "ticker": {}})):
        for _ in range(3):
            c.get_quote("AAPL")
        with pytest.raises(m.MassiveRateLimited):
            c.get_quote("AAPL")
    assert m._bucket_denied_total == 1


def test_budget_reports_current_state():
    b = m.budget()
    assert set(b.keys()) == {"tokens_remaining", "ceiling", "denied_total"}
    assert b["ceiling"] == m._MASSIVE_RATE_LIMIT_PER_MIN


def test_no_two_vendor_errors_share_identity_with_fmp():
    from api.services import fmp_client as fc
    assert not issubclass(m.MassiveNotFound, fc.FMPNotFound)
    assert not issubclass(fc.FMPNotFound, m.MassiveNotFound)
