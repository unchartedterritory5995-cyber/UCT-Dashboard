"""Tests for api/services/av_transcripts.py.

All AlphaVantage HTTP calls are mocked — no real network traffic.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch, call as mock_call
import pytest


# ── Helpers ──────────────────────────────────────────────────────────────────

# Ensure ALPHAVANTAGE_API_KEY is set for all tests so _fetch_quarter doesn't
# early-return before making the (mocked) HTTP call.
import os as _os
_os.environ.setdefault("ALPHAVANTAGE_API_KEY", "test-key-for-tests-only")

_HAPPY_SEGMENTS = [
    {"speaker": "Tim Cook", "title": "CEO", "content": "Revenue grew strongly.", "sentiment": None},
    {"speaker": "Luca Maestri", "title": "CFO", "content": "Margins expanded.", "sentiment": "positive"},
]

_AV_HAPPY_RESPONSE = {
    "symbol":     "AAPL",
    "quarter":    "2025Q1",
    "transcript": [
        {"speaker": "Tim Cook",     "title": "CEO", "content": "Revenue grew strongly."},
        {"speaker": "Luca Maestri", "title": "CFO", "content": "Margins expanded.",
         "sentiment": "positive"},
    ],
}

_AV_THROTTLE_INFORMATION = {
    "Information": "Thank you for using Alpha Vantage! "
                   "Our standard API rate limit is 25 requests per day.",
}

_AV_THROTTLE_NOTE = {
    "Note": "Thank you for using Alpha Vantage! "
            "Our standard API call frequency is 5 calls per minute.",
}

_AV_EMPTY_TRANSCRIPT = {
    "symbol":     "XYZ",
    "quarter":    "2025Q4",
    "transcript": [],
}

_AV_MISSING_TRANSCRIPT_KEY = {
    "symbol":  "XYZ",
    "quarter": "2025Q4",
    # No "transcript" key at all
}


def _mock_requests_get(json_data, status_code=200):
    """Return a mock requests.Response with the given JSON."""
    mock_resp = MagicMock()
    mock_resp.ok = status_code < 400
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data
    return mock_resp


def _fresh_cache():
    """Return a MagicMock cache that always misses."""
    mock_cache = MagicMock()
    mock_cache.get.return_value = None
    return mock_cache


# ── _probe_quarters ───────────────────────────────────────────────────────────

class TestProbeQuarters:
    def test_returns_at_most_max_probe(self):
        from api.services.av_transcripts import _probe_quarters
        result = _probe_quarters(4)
        assert len(result) <= 4

    def test_labels_are_strings_with_Q(self):
        from api.services.av_transcripts import _probe_quarters
        for lbl in _probe_quarters(4):
            assert "Q" in lbl
            year_str, q_str = lbl.split("Q")
            assert year_str.isdigit()
            assert q_str in ("1", "2", "3", "4")

    def test_no_duplicates(self):
        from api.services.av_transcripts import _probe_quarters
        candidates = _probe_quarters(4)
        assert len(candidates) == len(set(candidates))


# ── get_transcript — happy path ───────────────────────────────────────────────

class TestGetTranscriptHappyPath:
    def test_known_quarter_returns_segments(self):
        """get_transcript with explicit quarter → returns parsed segments."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_HAPPY_RESPONSE)
            result = get_transcript("AAPL", quarter="2025Q1")

        assert result is not None
        assert result["symbol"] == "AAPL"
        assert result["quarter"] == "2025Q1"
        assert len(result["segments"]) == 2
        seg0 = result["segments"][0]
        assert seg0["speaker"] == "Tim Cook"
        assert seg0["title"] == "CEO"
        assert "Revenue" in seg0["content"]

    def test_result_cached_24h(self):
        """Successful fetch is stored with 24h TTL."""
        from api.services.av_transcripts import get_transcript, _CACHE_TTL_HIT

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_HAPPY_RESPONSE)
            get_transcript("AAPL", quarter="2025Q1")

        # At least one cache.set call with the 24h TTL (may be positional or kwarg)
        set_calls = mock_cache.set.call_args_list
        ttls = []
        for c in set_calls:
            args, kwargs = c
            if len(args) >= 3:
                ttls.append(args[2])
            elif "ttl" in kwargs:
                ttls.append(kwargs["ttl"])
        assert _CACHE_TTL_HIT in ttls, f"Expected 24h TTL in {ttls}"

    def test_cache_hit_avoids_second_call(self):
        """Second call for same (ticker, quarter) uses cache — no extra HTTP."""
        from api.services.av_transcripts import get_transcript

        stored_payload = {
            "symbol":   "AAPL",
            "quarter":  "2025Q1",
            "segments": _HAPPY_SEGMENTS,
            "resolved": False,
        }
        mock_cache = MagicMock()
        mock_cache.get.return_value = stored_payload  # always warm

        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            result = get_transcript("AAPL", quarter="2025Q1")
            mock_req.get.assert_not_called()

        assert result is stored_payload

    def test_probe_returns_first_non_empty(self):
        """Quarter probe: tries candidates newest-first, returns on first hit."""
        from api.services.av_transcripts import get_transcript, _probe_quarters

        candidates = _probe_quarters(4)
        # First candidate returns empty; second returns data
        responses = [
            _mock_requests_get(_AV_EMPTY_TRANSCRIPT),      # first probe → miss
            _mock_requests_get(_AV_HAPPY_RESPONSE),         # second probe → hit
        ]

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.side_effect = responses
            result = get_transcript("AAPL")  # no quarter → probe

        assert result is not None
        assert len(result["segments"]) == 2
        # Only 2 HTTP calls were made (stopped after first hit)
        assert mock_req.get.call_count == 2

    def test_resolved_flag_true_when_auto_resolved(self):
        """Auto-probed transcript sets resolved=True."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_HAPPY_RESPONSE)
            result = get_transcript("AAPL")

        assert result["resolved"] is True

    def test_resolved_false_when_explicit_quarter(self):
        """Explicit quarter → resolved=False."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_HAPPY_RESPONSE)
            result = get_transcript("AAPL", quarter="2025Q1")

        assert result["resolved"] is False


# ── Throttle / quota handling ─────────────────────────────────────────────────

class TestThrottleHandling:
    def _run_throttle(self, json_body):
        """Helper: call get_transcript when AV returns a throttle body."""
        from api.services.av_transcripts import get_transcript, _CACHE_TTL_THROTTLE

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(json_body)
            result = get_transcript("AAPL", quarter="2025Q1")

        return result, mock_cache

    def test_information_key_returns_none(self):
        result, _ = self._run_throttle(_AV_THROTTLE_INFORMATION)
        assert result is None

    def test_note_key_returns_none(self):
        result, _ = self._run_throttle(_AV_THROTTLE_NOTE)
        assert result is None

    def test_throttle_not_long_cached(self):
        """Throttle response must be short-cached (5 min), NOT 24h."""
        from api.services.av_transcripts import _CACHE_TTL_HIT, _CACHE_TTL_THROTTLE

        _, mock_cache = self._run_throttle(_AV_THROTTLE_INFORMATION)
        set_calls = mock_cache.set.call_args_list
        # Extract TTLs from positional or keyword args
        ttls = []
        for c in set_calls:
            args, kwargs = c
            if len(args) >= 3:
                ttls.append(args[2])
            elif "ttl" in kwargs:
                ttls.append(kwargs["ttl"])
        assert ttls, "Expected at least one cache.set call"
        # None of the TTLs should be the 24h hit TTL
        assert _CACHE_TTL_HIT not in ttls, (
            f"Throttle response was long-cached at {_CACHE_TTL_HIT}s — must use {_CACHE_TTL_THROTTLE}s"
        )
        assert all(t <= _CACHE_TTL_THROTTLE for t in ttls)

    def test_empty_transcript_array_returns_none(self):
        """Empty transcript array is treated as miss, not throttle, but still returns None."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_EMPTY_TRANSCRIPT)
            result = get_transcript("XYZ", quarter="2025Q4")

        assert result is None

    def test_missing_transcript_key_returns_none(self):
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.return_value = _mock_requests_get(_AV_MISSING_TRANSCRIPT_KEY)
            result = get_transcript("XYZ", quarter="2025Q4")

        assert result is None


# ── Error handling / never raises ─────────────────────────────────────────────

class TestErrorHandling:
    def test_http_error_returns_none(self):
        """Non-200 HTTP status → None, no raise."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_resp = MagicMock()
            mock_resp.ok = False
            mock_resp.status_code = 500
            mock_req.get.return_value = mock_resp
            result = get_transcript("AAPL", quarter="2025Q1")

        assert result is None

    def test_network_exception_returns_none(self):
        """Connection error → None, no raise."""
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        with patch("api.services.av_transcripts.cache", mock_cache), \
             patch("api.services.av_transcripts.requests") as mock_req:
            mock_req.get.side_effect = ConnectionError("network down")
            result = get_transcript("AAPL", quarter="2025Q1")

        assert result is None

    def test_missing_api_key_returns_none(self):
        """No ALPHAVANTAGE_API_KEY → None, no HTTP call."""
        import os
        from api.services.av_transcripts import get_transcript

        mock_cache = _fresh_cache()
        original_key = os.environ.pop("ALPHAVANTAGE_API_KEY", None)
        try:
            with patch("api.services.av_transcripts.cache", mock_cache), \
                 patch("api.services.av_transcripts.requests") as mock_req:
                result = get_transcript("AAPL", quarter="2025Q1")
                mock_req.get.assert_not_called()
        finally:
            if original_key is not None:
                os.environ["ALPHAVANTAGE_API_KEY"] = original_key

        assert result is None

    def test_empty_ticker_returns_none(self):
        from api.services.av_transcripts import get_transcript
        assert get_transcript("") is None
        assert get_transcript("   ") is None


# ── Endpoint integration ──────────────────────────────────────────────────────

class TestTranscriptEndpoint:
    @pytest.fixture()
    def client(self):
        from fastapi import FastAPI
        from api.routers.earnings_intel import router
        app = FastAPI()
        app.include_router(router)
        from fastapi.testclient import TestClient
        return TestClient(app)

    def test_endpoint_happy_path(self, client):
        payload = {
            "symbol":   "AAPL",
            "quarter":  "2025Q1",
            "segments": [{"speaker": "CEO", "title": "CEO", "content": "Strong results.", "sentiment": None}],
            "resolved": True,
        }
        with patch("api.routers.earnings_intel.get_transcript", return_value=payload) as mock_svc:
            resp = client.get("/api/earnings/transcript/AAPL?quarter=2025Q1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "AAPL"
        assert data["quarter"] == "2025Q1"
        assert len(data["segments"]) == 1
        mock_svc.assert_called_once_with("AAPL", quarter="2025Q1")

    def test_endpoint_returns_null_on_miss(self, client):
        with patch("api.routers.earnings_intel.get_transcript", return_value=None):
            resp = client.get("/api/earnings/transcript/AAPL")
        assert resp.status_code == 200
        assert resp.json() is None

    def test_endpoint_no_quarter_passes_none(self, client):
        with patch("api.routers.earnings_intel.get_transcript", return_value=None) as mock_svc:
            client.get("/api/earnings/transcript/TSLA")
        mock_svc.assert_called_once_with("TSLA", quarter=None)
