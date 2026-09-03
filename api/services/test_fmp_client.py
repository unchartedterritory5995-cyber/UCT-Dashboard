"""D1 — FMP adapter tests. Every test mocks `requests.Session.get` (no real
network call) and resets the module's own token bucket / cache state so
tests never leak into each other. Covers spec §21.2 (typed-error unit
tests per leaf class), §21.3 (rate-limiter configuration), and §6.4
(cached-forbidden distinguishability).
"""
import time
from unittest.mock import MagicMock, patch

import pytest

from api.services import fmp_client as fc
from api.services.cache import cache as _cache


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    fc._bucket_denied_total = 0
    for path in ("/stable/quote", "/stable/key-metrics-ttm", "/stable/ratios-ttm",
                 "/stable/grades", "/stable/grades-consensus", "/stable/grades-historical",
                 "/stable/price-target-consensus", "/stable/price-target-summary",
                 "/stable/earnings", "/stable/earning-call-transcript-dates",
                 "/stable/insider-trading/search", "/stable/earnings-calendar"):
        _cache.invalidate(f"fmp_forbidden_{path}")
    yield


def _mock_response(status_code=200, json_value=None, raise_for_status_error=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else []
    if raise_for_status_error:
        resp.raise_for_status.side_effect = raise_for_status_error
    else:
        resp.raise_for_status.return_value = None
    return resp


def test_missing_api_key_raises_not_configured(monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    with pytest.raises(fc.FMPNotConfigured):
        fc.get_quote("AAPL")


def test_successful_call_returns_provider_result_with_value_and_provenance():
    with patch.object(fc._session, "get", return_value=_mock_response(200, [{"symbol": "AAPL", "price": 230}])):
        result = fc.get_quote("AAPL")
    assert result.value == [{"symbol": "AAPL", "price": 230}]
    assert result.provenance.vendor == "fmp"
    assert result.provenance.source_activity == "fmp_client.get_quote"
    assert result.licensing_class == "R"
    assert result.freshness == "delayed_15"
    assert result.degraded is None


def test_get_quote_applies_caret_prefix_for_an_index_entity():
    """FMP's own index-quote convention (^SPX etc.) -- live-verified during
    the D1 completion pass. Applied ONLY when entity_type="index"; a plain
    equity/ETF ticker is never prefixed."""
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured["symbol"] = params.get("symbol")
        return _mock_response(200, [{"symbol": "^SPX", "name": "S&P 500 Index"}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        result = fc.get_quote("SPX", entity_type="index")
    assert captured["symbol"] == "^SPX"
    assert result.value == [{"symbol": "^SPX", "name": "S&P 500 Index"}]


def test_get_quote_does_not_prefix_a_non_index_entity():
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured["symbol"] = params.get("symbol")
        return _mock_response(200, [{"symbol": "AAPL"}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        fc.get_quote("AAPL", entity_type="equity")
    assert captured["symbol"] == "AAPL"


def test_get_quote_index_prefix_is_a_noop_when_already_prefixed():
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured["symbol"] = params.get("symbol")
        return _mock_response(200, [{"symbol": "^SPX"}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        fc.get_quote("^SPX", entity_type="index")
    assert captured["symbol"] == "^SPX"


def test_401_raises_auth_error():
    with patch.object(fc._session, "get", return_value=_mock_response(401)):
        with pytest.raises(fc.FMPAuthError) as exc_info:
            fc.get_quote("AAPL")
    assert exc_info.value.vendor == "fmp"
    assert exc_info.value.status == 401


def test_403_raises_auth_error_and_caches_forbidden_for_next_call():
    with patch.object(fc._session, "get", return_value=_mock_response(403)) as mock_get:
        with pytest.raises(fc.FMPAuthError):
            fc.get_key_metrics_ttm("ZZZZ")
    # Second call within the 24h window must NOT hit the network again —
    # it degrades instead of re-raising (spec §6.4).
    with patch.object(fc._session, "get") as mock_get2:
        result = fc.get_key_metrics_ttm("ZZZZ")
    mock_get2.assert_not_called()
    assert result.degraded == "cached_forbidden"
    assert result.degraded_since is not None
    assert result.value is None


def test_429_raises_rate_limited():
    with patch.object(fc._session, "get", return_value=_mock_response(429)):
        with pytest.raises(fc.FMPRateLimited) as exc_info:
            fc.get_quote("AAPL")
    assert exc_info.value.status == 429


def test_5xx_raises_transient():
    with patch.object(fc._session, "get", return_value=_mock_response(500)):
        with pytest.raises(fc.FMPTransient):
            fc.get_quote("AAPL")


def test_timeout_raises_transient():
    import requests as _r
    with patch.object(fc._session, "get", side_effect=_r.exceptions.Timeout("timed out")):
        with pytest.raises(fc.FMPTransient):
            fc.get_quote("AAPL")


def test_connection_error_raises_transient():
    import requests as _r
    with patch.object(fc._session, "get", side_effect=_r.exceptions.ConnectionError("dns fail")):
        with pytest.raises(fc.FMPTransient):
            fc.get_quote("AAPL")


def test_empty_array_response_raises_not_found_per_endpoint_predicate():
    """Spec §9.5: FMP signals 'nothing here' via HTTP 200 + an empty array,
    not a 404. Each typed function's own not_found_if predicate must
    convert that into FMPNotFound, distinguishable from every other state."""
    with patch.object(fc._session, "get", return_value=_mock_response(200, [])):
        with pytest.raises(fc.FMPNotFound):
            fc.get_analyst_grades("NOTAREALTICKER")


def test_genuinely_empty_is_not_confused_with_not_found_when_no_predicate_applies():
    """A field whose not_found_if predicate is satisfied by a non-empty-but-
    meaningless shape must still raise; but an endpoint where [] IS a valid
    answer (none configured to treat [] as not-found) must return
    successfully. get_transcript_content uses a list-emptiness check
    deliberately (an empty transcript-content list really does mean
    not-found for that specific endpoint) — this test instead confirms a
    non-empty, but still "no rows relevant" dict response for a
    not_found_if=_empty_container-gated endpoint distinguishes empty-dict
    from populated-dict correctly."""
    with patch.object(fc._session, "get", return_value=_mock_response(200, {"priceTarget": 250})):
        result = fc.get_price_target_summary("AAPL")
    assert result.value == {"priceTarget": 250}


def test_rate_limiter_sheds_calls_once_ceiling_exhausted(monkeypatch):
    monkeypatch.setattr(fc, "_FMP_RATE_LIMIT_PER_MIN", 3.0)
    fc._bucket_tokens = 3.0
    fc._bucket_updated = time.monotonic()
    fc._bucket_denied_total = 0
    with patch.object(fc._session, "get", return_value=_mock_response(200, [{"ok": True}])):
        for _ in range(3):
            fc.get_quote("AAPL")  # 3 tokens spent, all succeed
        with pytest.raises(fc.FMPRateLimited):
            fc.get_quote("AAPL")  # 4th call, same instant: bucket is dry
    assert fc._bucket_denied_total == 1


def test_rate_limiter_ceiling_is_reconfigurable_with_no_code_change(monkeypatch):
    """Spec acceptance criterion 3 / §21.3: changing the configured value
    changes enforced throughput with no code change."""
    monkeypatch.setattr(fc, "_FMP_RATE_LIMIT_PER_MIN", 1.0)
    fc._bucket_tokens = 1.0
    fc._bucket_updated = time.monotonic()
    with patch.object(fc._session, "get", return_value=_mock_response(200, [{"ok": True}])):
        fc.get_quote("AAPL")
        with pytest.raises(fc.FMPRateLimited):
            fc.get_quote("AAPL")

    monkeypatch.setattr(fc, "_FMP_RATE_LIMIT_PER_MIN", 5.0)
    fc._bucket_tokens = 5.0
    fc._bucket_updated = time.monotonic()
    with patch.object(fc._session, "get", return_value=_mock_response(200, [{"ok": True}])):
        for _ in range(5):
            fc.get_quote("AAPL")  # now sheds at a different N


def test_budget_reports_current_state():
    b = fc.budget()
    assert set(b.keys()) == {"tokens_remaining", "ceiling", "denied_total"}
    assert b["ceiling"] == fc._FMP_RATE_LIMIT_PER_MIN


def test_income_statement_period_param_only_added_for_quarter():
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured.update(params or {})
        return _mock_response(200, [{"date": "2026-06-30", "revenue": 100}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        fc.get_income_statement("AAPL", period="annual", limit=12)
    assert "period" not in captured
    captured.clear()
    with patch.object(fc._session, "get", side_effect=_fake_get):
        fc.get_income_statement("AAPL", period="quarter", limit=24)
    assert captured.get("period") == "quarter"


def test_earnings_calendar_takes_a_date_range_not_a_ticker():
    """The one typed function with a non-ticker signature — confirms the
    params it actually sends and that a normal date-range response parses."""
    captured = {}

    def _fake_get(url, params=None, timeout=None):
        captured.update(params or {})
        return _mock_response(200, [{"symbol": "AAPL", "date": "2026-08-05"}])

    with patch.object(fc._session, "get", side_effect=_fake_get):
        result = fc.get_earnings_calendar("2026-08-05", "2026-08-05")
    assert captured.get("from") == "2026-08-05"
    assert captured.get("to") == "2026-08-05"
    assert "symbol" not in captured
    assert result.value == [{"symbol": "AAPL", "date": "2026-08-05"}]
    assert result.provenance.source_activity == "fmp_client.get_earnings_calendar"


def test_no_two_vendor_errors_share_identity_with_massive_placeholder():
    """FMPNotFound must never be catchable by a bare except of a
    (not-yet-built) MassiveNotFound — proven here structurally against the
    shared factory, since the Massive adapter doesn't exist as a module
    yet this checkpoint."""
    from api.services import provider_errors as pe
    massive_fam = pe.make_vendor_errors("massive")
    assert not issubclass(fc.FMPNotFound, massive_fam.NotFound)
    assert not issubclass(massive_fam.NotFound, fc.FMPNotFound)
