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
    from api.middleware.auth_middleware import (
        get_current_user, get_current_user_with_plan,
    )
    app = FastAPI()
    app.include_router(router)
    # These endpoints are behind `require_paid`, which resolves the user through
    # get_current_user_with_plan — overriding get_current_user alone leaves the
    # real dependency in place and every request 402s. Both are overridden so
    # the fixture keeps working whichever gate an endpoint uses.
    paid = {"id": "test-user", "role": "admin", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: paid
    app.dependency_overrides[get_current_user_with_plan] = lambda: paid
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

    # ── Failure caching ───────────────────────────────────────────────────────
    #
    # A recap that fails to synthesize used to be pinned as "__null__" for the
    # full 24h SUCCESS ttl. One transient parse or transport blip therefore
    # blanked the Call panel for a whole trading day, with nothing retrying --
    # which is the state the reported DIS screenshot was in (the sibling
    # sentiment gauge, cached separately, had resolved fine).
    #
    # Two tiers, because the two failures are not the same claim:
    #   * an EXCEPTION is transient by nature -> retry within minutes
    #   * an EMPTY provider answer is a real "nothing published yet" -> longer,
    #     but never a full day, since a recap lands hours after the call

    def test_a_transient_failure_is_not_pinned_for_the_success_ttl(self):
        from api.services.call_recap import get_call_recap, _FAILURE_TTL

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

            assert get_call_recap("NVDA") is None

        ttl = mock_cache.set.call_args[0][2]
        assert ttl == _FAILURE_TTL
        assert ttl <= 900, "a transient failure must heal within minutes, not a session"

    def test_an_empty_provider_answer_is_cached_shorter_than_a_success(self):
        from api.services.call_recap import get_call_recap, _EMPTY_TTL, _RECAP_TTL

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
             patch("api.services.call_recap._pplx_earnings_highlights", return_value=""), \
             patch("api.services.call_recap._cost_guard") as mock_guard_fn:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            mock_guard = MagicMock()
            mock_guard.may_synthesize.return_value = True
            mock_guard_fn.return_value = mock_guard

            assert get_call_recap("NOTHING") is None

        ttl = mock_cache.set.call_args[0][2]
        assert ttl == _EMPTY_TTL
        assert ttl < _RECAP_TTL, "an absent recap must not outlive a real one"

    def test_null_safe_on_llm_exception(self):
        from api.services.call_recap import get_call_recap

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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
        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
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
    """get_rating_changes: FMP `stable/grades-historical` primary, Finnhub
    `/stock/recommendation` fallback (data-dependability migration plan,
    Task 5). Both sources are mocked at the module functions this file calls
    (`earnings_estimates._fmp_grades_historical`, `finnhub_client.fh_get`)
    rather than at `requests.get`, since `_fmp_grades_historical` already has
    its own dedicated shape/failure test coverage in
    tests/test_earnings_estimates_fmp_grades.py — these tests only lock in
    get_rating_changes' OWN composition (net/net_delta) and its
    FMP-first-then-Finnhub-fallback ordering.
    """

    def _fmp_response(self):
        # Shape returned by earnings_estimates._fmp_grades_historical (already
        # remapped from FMP's raw analystRatings* field names).
        return [
            {"period": "2026-06-01", "strongBuy": 30, "buy": 10,
             "hold": 5, "sell": 1, "strongSell": 0},
            {"period": "2026-05-01", "strongBuy": 27, "buy": 9,
             "hold": 6, "sell": 2, "strongSell": 0},
        ]

    def _fh_response(self):
        return [
            {"period": "2026-06-01", "strongBuy": 30, "buy": 10,
             "hold": 5, "sell": 1, "strongSell": 0},
            {"period": "2026-05-01", "strongBuy": 27, "buy": 9,
             "hold": 6, "sell": 2, "strongSell": 0},
        ]

    def test_returns_list_with_deltas_from_fmp(self):
        """FMP is primary — Finnhub is never touched when FMP answers."""
        from api.services.call_recap import get_rating_changes

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
             patch("api.services.earnings_estimates._fmp_grades_historical",
                   return_value=self._fmp_response()) as fmp_spy, \
             patch("api.services.finnhub_client.fh_get") as fh_spy:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            result = get_rating_changes("NVDA")

        fmp_spy.assert_called_once_with("NVDA", limit=4)
        fh_spy.assert_not_called()
        assert isinstance(result, list)
        assert len(result) == 2
        assert "net" in result[0]
        assert "net_delta" in result[0]
        assert result[0]["net"] == (30 + 10) - (1 + 0)
        # Oldest entry should have net_delta=None
        assert result[-1]["net_delta"] is None

    def test_falls_back_to_finnhub_when_fmp_yields_nothing(self):
        from api.services.call_recap import get_rating_changes

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
             patch("api.services.earnings_estimates._fmp_grades_historical",
                   return_value=[]), \
             patch("api.services.finnhub_client.fh_get",
                   return_value=self._fh_response()) as fh_spy:

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            result = get_rating_changes("NVDA")

        fh_spy.assert_called_once()
        assert fh_spy.call_args.args[0] == "/stock/recommendation"
        assert len(result) == 2
        assert result[0]["net"] == (30 + 10) - (1 + 0)
        assert result[-1]["net_delta"] is None

    def test_empty_when_both_providers_yield_nothing(self):
        from api.services.call_recap import get_rating_changes

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
             patch("api.services.earnings_estimates._fmp_grades_historical",
                   return_value=[]), \
             patch("api.services.finnhub_client.fh_get", return_value=None):

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            result = get_rating_changes("NVDA")

        assert result == []

    def test_empty_on_no_ticker(self):
        from api.services.call_recap import get_rating_changes
        assert get_rating_changes("") == []
        assert get_rating_changes(None) == []

    def test_empty_on_fmp_and_finnhub_request_failure(self):
        """End-to-end: FMP down (its own bounded try/except returns []) AND
        Finnhub raising is swallowed by fh_get's own contract (never raises) —
        confirms the composition layer here adds no new failure mode."""
        from api.services.call_recap import get_rating_changes

        # The web-context fallback now runs ONLY for a ticker with no published
        # transcript -- one that HAS a transcript is handed to the background
        # warmer rather than generated on the request path. Both preconditions
        # are pinned below: leaving them to ambient state is exactly how this
        # broke, when another suite left av_transcripts patched and these
        # silently exercised a different branch.
        with patch("api.services.call_recap._cache") as mock_cache_fn, \
             patch("api.services.call_recap._store",
                   return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch("api.services.call_recap._transcript_for", return_value=None), \
             patch("api.services.earnings_estimates._fmp_grades_historical",
                   return_value=[]), \
             patch("api.services.finnhub_client.fh_get", return_value=None):

            mock_cache = MagicMock()
            mock_cache.get.return_value = None
            mock_cache_fn.return_value = mock_cache

            result = get_rating_changes("ERR")

        assert result == []


# ─── Router-level tests ───────────────────────────────────────────────────────

class TestCallRecapEndpoint:
    def test_happy_path(self, client):
        with patch("api.routers.earnings_intel.get_call_recap_with_status",
                   return_value=(_SAMPLE_RECAP, "ready")), \
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
        with patch("api.routers.earnings_intel.get_call_recap_with_status",
                   return_value=(None, "generating")), \
             patch("api.routers.earnings_intel.get_webcast_url", return_value=None), \
             patch("api.routers.earnings_intel.get_rating_changes", return_value=[]):
            r = client.get("/api/earnings/call-recap/UNKNOWN")
        assert r.status_code == 200
        data = r.json()
        assert data["recap"] is None
        # The REASON travels with the null, so the panel can say "writing this
        # now" instead of "no recap", which reads as failure.
        assert data["recap_status"] == "generating"

    def test_exception_returns_safe_shape(self, client):
        with patch("api.routers.earnings_intel.get_call_recap_with_status",
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


class TestRecapStatusDistinguishesWhyItIsMissing:
    """A bare None told the reader nothing.

    "We are writing this right now" and "this company published no transcript"
    both rendered as *No call recap yet*, which reads as failure in the first
    case — and the first case is the common one, because the request path never
    generates inline. The status must come out of the SAME branch that decides
    the recap, so the two cannot drift.
    """

    @pytest.fixture(autouse=True)
    def _isolate_cache(self, monkeypatch):
        """The cache must not answer before the branch under test runs.

        These assert on WHICH BRANCH was taken. An earlier test in this file
        leaves a real cache entry for the same symbol, which made the capped
        and generating cases pass in isolation and fail in a full-file run —
        the precise ambient-state trap this module's other tests call out.
        """
        import api.services.call_recap as cr
        monkeypatch.setattr(cr, "_cache", lambda: _FakeCache())

    def test_a_stored_recap_reads_ready(self, monkeypatch):
        import api.services.call_recap as cr
        monkeypatch.setattr(cr, "_store", lambda: _FakeStore({"headline": "hi"}))
        recap, status = cr.get_call_recap_with_status("DIS")
        assert status == "ready" and recap["headline"] == "hi"

    def test_a_transcript_with_no_recap_reads_generating(self, monkeypatch):
        # The exact case the empty state used to mislabel: the warmer has been
        # handed this symbol and the recap lands in ~40s.
        import api.services.call_recap as cr
        triggered = []
        monkeypatch.setattr(cr, "_store", lambda: _FakeStore(None))
        monkeypatch.setattr(cr, "_cost_guard", lambda: _FakeGuard(True))
        monkeypatch.setattr(cr, "_transcript_for",
                            lambda s: {"segments": [{"speaker": "CEO", "content": "x"}]})
        monkeypatch.setattr(cr, "_trigger_background_warm", triggered.append)

        recap, status = cr.get_call_recap_with_status("DIS")

        assert (recap, status) == (None, "generating")
        assert triggered == ["DIS"], "the status must not claim a warm that never started"

    def test_an_explicit_past_quarter_says_so(self, monkeypatch):
        import api.services.call_recap as cr
        monkeypatch.setattr(cr, "_store", lambda: _FakeStore(None))
        assert cr.get_call_recap_with_status("DIS", "2019Q2") == (
            None, "no_recap_for_quarter")

    def test_the_plain_wrapper_still_returns_just_the_recap(self, monkeypatch):
        # One implementation decides both, so the two can never disagree.
        import api.services.call_recap as cr
        monkeypatch.setattr(cr, "_store", lambda: _FakeStore({"headline": "hi"}))
        assert cr.get_call_recap("DIS") == {"headline": "hi"}


class _FakeStore:
    def __init__(self, stored):
        self._stored = stored

    def get(self, sym, quarter=None):
        return self._stored

    def has(self, sym, quarter=None):
        return self._stored is not None

    def may_spend(self):
        return True


class _FakeGuard:
    def __init__(self, allowed):
        self._allowed = allowed

    def may_synthesize(self, _date):
        return self._allowed


def test_the_daily_cap_reads_capped_not_unavailable(monkeypatch):
    """"Try again tomorrow" is a different message from "there is nothing"."""
    import api.services.call_recap as cr
    monkeypatch.setattr(cr, "_cache", lambda: _FakeCache())
    monkeypatch.setattr(cr, "_store", lambda: _FakeStore(None))
    monkeypatch.setattr(cr, "_cost_guard", lambda: _FakeGuard(False))
    assert cr.get_call_recap_with_status("DIS") == (None, "capped")


class _FakeCache:
    def __init__(self):
        self._d = {}

    def get(self, k):
        return self._d.get(k)

    def set(self, k, v, ttl=None):
        self._d[k] = v


def test_a_cold_recap_fetches_webcast_and_ratings_CONCURRENTLY(client):
    """Pinned with a barrier, not a stopwatch.

    When the recap is not warmed the handler must still fetch the webcast link
    and the rating trend. Awaited in source order those two WERE the cost of a
    cold open — 3.12s p95 under 20 concurrent readers against 0.05s once
    cached. Both must be in flight at once, or the barrier never releases.
    """
    import threading
    barrier = threading.Barrier(2, timeout=5)

    def _leg(result):
        def fn(_sym):
            barrier.wait()          # BrokenBarrierError if run one after another
            return result
        return fn

    with patch("api.routers.earnings_intel.get_call_recap_with_status",
               return_value=(None, "generating")), \
         patch("api.routers.earnings_intel.get_webcast_url",
               side_effect=_leg("https://ir.example.com")), \
         patch("api.routers.earnings_intel.get_rating_changes",
               side_effect=_leg([{"period": "2026-08-01"}])):
        r = client.get("/api/earnings/call-recap/NVDA")

    assert r.status_code == 200
    data = r.json()
    assert data["webcast_url"] == "https://ir.example.com"
    assert len(data["rating_changes"]) == 1


def test_a_SLOW_webcast_lookup_does_not_hold_the_panel(client, monkeypatch):
    """The optional link may not spend the request.

    get_webcast_url is a Perplexity call: ~2.4s alone, and 7-10s under twenty
    concurrent readers — measured on production, and the entire reason a cold
    open ran 7.31s p50 against a 2-3s budget. It is a "Listen live" link. The
    recap must come back without it.
    """
    import time
    import api.routers.earnings_intel as ei
    monkeypatch.setattr(ei, "_WEBCAST_TIMEOUT", 0.2)

    def _slow(_sym):
        time.sleep(5)
        return "https://ir.example.com/late"

    started = time.time()
    with patch("api.routers.earnings_intel.get_call_recap_with_status",
               return_value=(None, "generating")), \
         patch("api.routers.earnings_intel.get_webcast_url", side_effect=_slow), \
         patch("api.routers.earnings_intel.get_rating_changes",
               return_value=[{"period": "2026-08-01"}]):
        r = client.get("/api/earnings/call-recap/SLOW")
    elapsed = time.time() - started

    assert r.status_code == 200
    assert elapsed < 3, f"the slow webcast held the response for {elapsed:.1f}s"
    body = r.json()
    assert body["webcast_url"] is None, "returned a link it did not wait for"
    # The rest of the payload is intact — degrading the optional field must not
    # degrade the required ones.
    assert body["recap_status"] == "generating"
    assert len(body["rating_changes"]) == 1
