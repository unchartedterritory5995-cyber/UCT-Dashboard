"""Tests for call_recap service + earnings_intel endpoints.

All LLM, Perplexity, and cost_guard calls are mocked — no real API calls.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch, call
import pytest
from fastapi.testclient import TestClient


# ─── Shared fixtures ──────────────────────────────────────────────────────────

@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.earnings_intel import router
    from api.middleware.auth_middleware import get_current_user
    app = FastAPI()
    app.include_router(router)
    # Endpoints now require auth — bypass with a fake user for these tests.
    app.dependency_overrides[get_current_user] = lambda: {"id": "test-user"}
    return TestClient(app)


_SAMPLE_RECAP = {
    "headline": "NVDA beat expectations with record revenue in Q1 FY2026.",
    "sentiment": "positive",
    "bullets": [
        "Revenue grew 78% YoY to $26.0B, beating consensus of $24.6B.",
        "Data-center revenue hit $22.6B, up 427% YoY.",
        "EPS of $5.98 beat estimate of $5.59.",
        "Gross margin expanded to 78.4%.",
    ],
    "quotes": [
        {"topic": "Data Center", "quote": "Demand is extraordinary and accelerating."},
    ],
    "guidance": "raised",
    "qa_highlights": [
        "Analyst asked about China export restrictions; CEO noted supply-chain adjustments.",
    ],
}

_SAMPLE_SENTIMENT = {
    "score": 82,
    "label": "Very Positive",
    "rationale": "Strong beat across all metrics with raised guidance.",
    "drivers": ["Revenue beat", "Margin expansion", "Raised guidance"],
}

_SAMPLE_WEBCAST = "https://investor.nvidia.com/events/event-details/nvidia-q1-fy2026"

_SAMPLE_RATINGS = [
    {"period": "2026-06-01", "strong_buy": 30, "buy": 10, "hold": 5,
     "sell": 1, "strong_sell": 0, "net": 39, "net_delta": 3},
    {"period": "2026-05-01", "strong_buy": 28, "buy": 9, "hold": 6,
     "sell": 1, "strong_sell": 0, "net": 36, "net_delta": None},
]

_PPLX_WEB_CONTEXT = "NVDA reported record revenue of $26B, beating estimates. Guidance raised."


def _make_anthropic_response(text: str):
    """Build a minimal mock Anthropic messages.create response."""
    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(type="text", text=text)]
    mock_resp.usage.input_tokens = 500
    mock_resp.usage.output_tokens = 300
    return mock_resp


# ─── Service-level tests ──────────────────────────────────────────────────────

class TestGetCallRecap:
    def _run(self, sym, pplx_context=_PPLX_WEB_CONTEXT,
             llm_response=None, cache_hit=None):
        """Run get_call_recap with full mocking."""
        from api.services.call_recap import get_call_recap

        llm_json = llm_response or json.dumps(_SAMPLE_RECAP)
        mock_response = _make_anthropic_response(llm_json)

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._pplx_earnings_highlights",
                   return_value=pplx_context), \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn, \
             patch("api.services.call_recap._anthropic_client") as mock_client_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = cache_hit
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = True
            mock_guard_fn.return_value = mock_guard

            mock_client = MagicMock()
            mock_client.messages.create.return_value = mock_response
            mock_client_fn.return_value = mock_client

            result = get_call_recap(sym)
        return result, mock_cache, mock_guard, mock_client

    def test_returns_correct_shape(self):
        result, _, _, _ = self._run("NVDA")
        assert result is not None
        assert "headline" in result
        assert "sentiment" in result
        assert isinstance(result["bullets"], list)
        assert isinstance(result["quotes"], list)
        assert "guidance" in result
        assert isinstance(result["qa_highlights"], list)

    def test_result_cached_24h(self):
        result, mock_cache, _, _ = self._run("NVDA")
        assert result is not None
        # cache.set called with 24h TTL
        called_args = mock_cache.set.call_args
        assert called_args is not None
        ttl = called_args[0][2]  # positional: (key, value, ttl)
        assert ttl == 24 * 3600

    def test_cost_guard_respected(self):
        from api.services.call_recap import get_call_recap

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn, \
             patch("api.services.call_recap._anthropic_client") as mock_client_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = False  # cap hit
            mock_guard_fn.return_value = mock_guard

            mock_client_fn.return_value = MagicMock()

            result = get_call_recap("COST_CAPPED")

        assert result is None
        mock_client_fn.return_value.messages.create.assert_not_called()

    def test_cache_hit_skips_llm(self):
        from api.services.call_recap import get_call_recap

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._anthropic_client") as mock_client_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = dict(_SAMPLE_RECAP)
            mock_cache_fn.return_value = mock_cache

            result = get_call_recap("NVDA")

        assert result is not None
        mock_client_fn.assert_not_called()

    def test_null_safe_on_empty_perplexity(self):
        result, _, _, _ = self._run("NOTHING", pplx_context="")
        assert result is None

    def test_null_safe_on_llm_exception(self):
        from api.services.call_recap import get_call_recap

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._pplx_earnings_highlights",
                   return_value=_PPLX_WEB_CONTEXT), \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn, \
             patch("api.services.call_recap._anthropic_client") as mock_client_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = True
            mock_guard_fn.return_value = mock_guard

            mock_client = MagicMock()
            mock_client.messages.create.side_effect = RuntimeError("LLM timeout")
            mock_client_fn.return_value = mock_client

            result = get_call_recap("AAPL")

        assert result is None


class TestGetSentiment:
    def _run(self, sym, pplx_context=_PPLX_WEB_CONTEXT,
             llm_response=None, cache_hit=None):
        from api.services.call_recap import get_sentiment

        llm_json = llm_response or json.dumps(_SAMPLE_SENTIMENT)
        mock_response = _make_anthropic_response(llm_json)

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._pplx_earnings_highlights",
                   return_value=pplx_context), \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn, \
             patch("api.services.call_recap._anthropic_client") as mock_client_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = cache_hit
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = True
            mock_guard_fn.return_value = mock_guard

            mock_client = MagicMock()
            mock_client.messages.create.return_value = mock_response
            mock_client_fn.return_value = mock_client

            result = get_sentiment(sym)
        return result, mock_cache

    def test_returns_correct_shape(self):
        result, _ = self._run("NVDA")
        assert result is not None
        assert "score" in result
        assert "label" in result
        assert "rationale" in result
        assert isinstance(result["drivers"], list)

    def test_score_clamped_to_valid_range(self):
        bad_json = json.dumps({
            "score": 9999,  # out of range
            "label": "Very Positive",
            "rationale": "Test",
            "drivers": [],
        })
        result, _ = self._run("NVDA", llm_response=bad_json)
        assert result is not None
        assert -100 <= result["score"] <= 100

    def test_cached_12h(self):
        result, mock_cache = self._run("AAPL")
        assert result is not None
        called_args = mock_cache.set.call_args
        ttl = called_args[0][2]
        assert ttl == 12 * 3600

    def test_cost_guard_respected(self):
        from api.services.call_recap import get_sentiment

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = False
            mock_guard_fn.return_value = mock_guard

            result = get_sentiment("CAPPED")

        assert result is None

    def test_null_safe_on_error(self):
        from api.services.call_recap import get_sentiment

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._perplexity") as mock_pplx_fn, \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = True
            mock_guard_fn.return_value = mock_guard

            # Make perplexity raise so _pplx_earnings_highlights propagates
            mock_pplx = MagicMock()
            mock_pplx.web_search.side_effect = Exception("network error")
            mock_pplx_fn.return_value = mock_pplx

            result = get_sentiment("ERR")

        assert result is None


class TestGetWebcastUrl:
    def test_returns_url(self):
        from api.services.call_recap import get_webcast_url

        pplx_result = {
            "answer": f"Visit {_SAMPLE_WEBCAST} for the earnings webcast.",
            "citations": [_SAMPLE_WEBCAST],
        }
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._perplexity") as mock_pplx_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_pplx = MagicMock()
            mock_pplx.web_search.return_value = pplx_result
            mock_pplx_fn.return_value = mock_pplx

            result = get_webcast_url("NVDA")

        assert result is not None
        assert result.startswith("https://")

    def test_cached_24h(self):
        from api.services.call_recap import get_webcast_url

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._perplexity") as mock_pplx_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_pplx = MagicMock()
            mock_pplx.web_search.return_value = {
                "answer": "https://investor.example.com/earnings",
                "citations": [],
            }
            mock_pplx_fn.return_value = mock_pplx

            get_webcast_url("AAPL")

        called_args = mock_cache.set.call_args
        ttl = called_args[0][2]
        assert ttl == 24 * 3600

    def test_null_safe_on_failure(self):
        from api.services.call_recap import get_webcast_url

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._perplexity") as mock_pplx_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_pplx = MagicMock()
            mock_pplx.web_search.side_effect = RuntimeError("timeout")
            mock_pplx_fn.return_value = mock_pplx

            result = get_webcast_url("ERR")

        assert result is None


class TestGetRatingChanges:
    def _fh_response(self):
        return [
            {"period": "2026-06-01", "strongBuy": 30, "buy": 10,
             "hold": 5, "sell": 1, "strongSell": 0},
            {"period": "2026-05-01", "strongBuy": 27, "buy": 9,
             "hold": 6, "sell": 2, "strongSell": 0},
        ]

    def test_returns_list_with_deltas(self):
        from api.services.call_recap import get_rating_changes
        import requests

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap.os") as mock_os, \
             patch("api.services.call_recap._req" if False else "requests.get") as mock_get:
            # Simpler: patch requests directly inside the module
            pass

        # Use a complete mock
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch.dict("os.environ", {"FINNHUB_API_KEY": "test-key"}), \
             patch("requests.get") as mock_get:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_resp = MagicMock()
            mock_resp.json.return_value = self._fh_response()
            mock_get.return_value = mock_resp

            result = get_rating_changes("NVDA")

        assert isinstance(result, list)
        assert len(result) == 2
        assert "net" in result[0]
        assert "net_delta" in result[0]
        # Oldest entry should have net_delta=None
        assert result[-1]["net_delta"] is None

    def test_empty_on_no_api_key(self):
        from api.services.call_recap import get_rating_changes

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch.dict("os.environ", {}, clear=True):

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            # Remove Finnhub key
            import os as _os
            orig = _os.environ.pop("FINNHUB_API_KEY", None)
            try:
                result = get_rating_changes("NVDA")
            finally:
                if orig:
                    _os.environ["FINNHUB_API_KEY"] = orig

        assert result == []

    def test_empty_on_request_failure(self):
        from api.services.call_recap import get_rating_changes

        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch.dict("os.environ", {"FINNHUB_API_KEY": "test-key"}), \
             patch("requests.get", side_effect=RuntimeError("network")):

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            result = get_rating_changes("ERR")

        assert result == []


# ─── Router-level tests ───────────────────────────────────────────────────────

class TestCallRecapEndpoint:
    def test_happy_path(self, client):
        with patch("api.routers.earnings_intel.get_call_recap",
                   return_value=_SAMPLE_RECAP), \
             patch("api.routers.earnings_intel.get_webcast_url",
                   return_value=_SAMPLE_WEBCAST), \
             patch("api.routers.earnings_intel.get_rating_changes",
                   return_value=_SAMPLE_RATINGS):
            r = client.get("/api/earnings/call-recap/NVDA")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "NVDA"
        assert data["recap"]["headline"] is not None
        assert data["webcast_url"] == _SAMPLE_WEBCAST
        assert isinstance(data["rating_changes"], list)

    def test_null_recap_still_returns_200(self, client):
        with patch("api.routers.earnings_intel.get_call_recap", return_value=None), \
             patch("api.routers.earnings_intel.get_webcast_url", return_value=None), \
             patch("api.routers.earnings_intel.get_rating_changes", return_value=[]):
            r = client.get("/api/earnings/call-recap/UNKNOWN")
        assert r.status_code == 200
        data = r.json()
        assert data["recap"] is None

    def test_exception_returns_safe_shape(self, client):
        with patch("api.routers.earnings_intel.get_call_recap",
                   side_effect=RuntimeError("db error")):
            r = client.get("/api/earnings/call-recap/ERR")
        assert r.status_code == 200
        data = r.json()
        assert data["recap"] is None
        assert data["rating_changes"] == []


class TestSentimentEndpoint:
    def test_happy_path(self, client):
        with patch("api.routers.earnings_intel.get_sentiment",
                   return_value=_SAMPLE_SENTIMENT):
            r = client.get("/api/earnings/sentiment/NVDA")
        assert r.status_code == 200
        data = r.json()
        assert data["score"] == 82
        assert data["label"] == "Very Positive"

    def test_null_returns_200(self, client):
        with patch("api.routers.earnings_intel.get_sentiment", return_value=None):
            r = client.get("/api/earnings/sentiment/UNKNOWN")
        assert r.status_code == 200
        assert r.json() is None

    def test_exception_returns_null(self, client):
        with patch("api.routers.earnings_intel.get_sentiment",
                   side_effect=RuntimeError("timeout")):
            r = client.get("/api/earnings/sentiment/ERR")
        assert r.status_code == 200
        assert r.json() is None
