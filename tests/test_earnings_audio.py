"""Tests for earnings_audio service + /api/earnings/audio/{ticker} endpoint.

All external calls are mocked. Never makes real API calls.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.earnings_intel import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── Service-level tests ───────────────────────────────────────────────────────

class TestGetAudio:
    def test_provider_none_returns_none(self):
        from api.services.earnings_audio import get_audio
        with patch.dict("os.environ", {"EARNINGS_AUDIO_PROVIDER": "none"}):
            result = get_audio("AAPL")
        assert result is None

    def test_provider_missing_returns_none(self):
        from api.services.earnings_audio import get_audio
        import os
        env = dict(os.environ)
        env.pop("EARNINGS_AUDIO_PROVIDER", None)
        with patch.dict("os.environ", env, clear=True):
            result = get_audio("AAPL")
        assert result is None

    def test_unknown_provider_returns_none(self):
        from api.services.earnings_audio import get_audio
        with patch.dict("os.environ", {"EARNINGS_AUDIO_PROVIDER": "unknown_vendor"}):
            result = get_audio("AAPL")
        assert result is None

    def test_earningsapi_live_shape(self):
        """Mock earningsapi adapter returning live stream."""
        from api.services import earnings_audio as _mod

        mock_result = {
            "stream_url": "https://stream.earningsapi.com/live/AAPL",
            "kind": "live",
            "transcript_url": None,
        }
        with patch.dict("os.environ", {
            "EARNINGS_AUDIO_PROVIDER": "earningsapi",
            "EARNINGS_AUDIO_API_KEY": "test-key",
        }), patch.dict(_mod._ADAPTERS, {"earningsapi": lambda sym: mock_result}):
            result = _mod.get_audio("AAPL")

        assert result is not None
        assert result["stream_url"] == "https://stream.earningsapi.com/live/AAPL"
        assert result["kind"] == "live"
        assert "transcript_url" in result

    def test_earningsapi_recorded_shape(self):
        from api.services import earnings_audio as _mod

        mock_result = {
            "stream_url": "https://cdn.earningsapi.com/NVDA-q1-2026.mp3",
            "kind": "recorded",
            "transcript_url": "https://cdn.earningsapi.com/NVDA-q1-2026-transcript.pdf",
        }
        with patch.dict("os.environ", {
            "EARNINGS_AUDIO_PROVIDER": "earningsapi",
            "EARNINGS_AUDIO_API_KEY": "test-key",
        }), patch.dict(_mod._ADAPTERS, {"earningsapi": lambda sym: mock_result}):
            result = _mod.get_audio("NVDA")

        assert result["kind"] == "recorded"
        assert result["transcript_url"] is not None

    def test_adapter_exception_returns_none(self):
        """If the adapter raises, get_audio returns None (never propagates)."""
        from api.services import earnings_audio as _mod

        def _raise(_): raise RuntimeError("network error")

        with patch.dict("os.environ", {
            "EARNINGS_AUDIO_PROVIDER": "earningsapi",
            "EARNINGS_AUDIO_API_KEY": "test-key",
        }), patch.dict(_mod._ADAPTERS, {"earningsapi": _raise}):
            result = _mod.get_audio("ERR")

        assert result is None

    def test_earningsapi_no_key_returns_none(self):
        """EarningsAPI without a key should return None."""
        from api.services.earnings_audio import _earningsapi_get_audio
        import os
        env = dict(os.environ)
        env.pop("EARNINGS_AUDIO_API_KEY", None)
        with patch.dict("os.environ", env, clear=True):
            result = _earningsapi_get_audio("AAPL")
        assert result is None

    def test_quartr_stub_returns_none(self):
        """Quartr stub should return None (not yet implemented)."""
        from api.services.earnings_audio import _quartr_get_audio
        assert _quartr_get_audio("NVDA") is None

    def test_earningscall_stub_returns_none(self):
        """EarningsCall stub should return None (not yet implemented)."""
        from api.services.earnings_audio import _earningscall_get_audio
        assert _earningscall_get_audio("TSLA") is None

    def test_empty_ticker_returns_none(self):
        from api.services.earnings_audio import get_audio
        with patch.dict("os.environ", {"EARNINGS_AUDIO_PROVIDER": "earningsapi",
                                        "EARNINGS_AUDIO_API_KEY": "test-key"}):
            result = get_audio("")
        assert result is None


# ── EarningsAPI HTTP adapter ───────────────────────────────────────────────────

class TestEarningsApiAdapter:
    def test_live_stream_returned_when_200(self):
        from api.services.earnings_audio import _earningsapi_get_audio

        live_data = {
            "stream_url": "https://stream.earningsapi.com/live/AAPL",
            "kind": "live",
            "transcript_url": None,
        }

        mock_live_resp = MagicMock()
        mock_live_resp.status_code = 200
        mock_live_resp.json.return_value = live_data

        with patch.dict("os.environ", {"EARNINGS_AUDIO_API_KEY": "test-key"}), \
             patch("requests.get", return_value=mock_live_resp):
            result = _earningsapi_get_audio("AAPL")

        assert result is not None
        assert result["kind"] == "live"

    def test_falls_back_to_recorded_when_live_404(self):
        from api.services.earnings_audio import _earningsapi_get_audio

        live_404 = MagicMock()
        live_404.status_code = 404

        recorded_data = {
            "audio_url": "https://cdn.earningsapi.com/AAPL-q1.mp3",
            "transcript_url": "https://cdn.earningsapi.com/AAPL-q1-transcript.pdf",
        }
        recorded_ok = MagicMock()
        recorded_ok.status_code = 200
        recorded_ok.json.return_value = recorded_data

        with patch.dict("os.environ", {"EARNINGS_AUDIO_API_KEY": "test-key"}), \
             patch("requests.get", side_effect=[live_404, recorded_ok]):
            result = _earningsapi_get_audio("AAPL")

        assert result is not None
        assert result["kind"] == "recorded"
        assert "stream_url" in result

    def test_returns_none_when_both_fail(self):
        from api.services.earnings_audio import _earningsapi_get_audio

        not_found = MagicMock()
        not_found.status_code = 404

        with patch.dict("os.environ", {"EARNINGS_AUDIO_API_KEY": "test-key"}), \
             patch("requests.get", return_value=not_found):
            result = _earningsapi_get_audio("UNKNOWN")

        assert result is None


# ── Endpoint tests ────────────────────────────────────────────────────────────

class TestAudioEndpoint:
    def test_provider_none_returns_null(self, client):
        with patch.dict("os.environ", {"EARNINGS_AUDIO_PROVIDER": "none"}):
            r = client.get("/api/earnings/audio/AAPL")
        assert r.status_code == 200
        assert r.json() is None

    def test_provider_set_returns_audio(self, client):
        mock_audio = {
            "stream_url": "https://cdn.example.com/NVDA.mp3",
            "kind": "recorded",
            "transcript_url": None,
        }
        with patch("api.routers.earnings_intel.get_audio", return_value=mock_audio):
            r = client.get("/api/earnings/audio/NVDA")
        assert r.status_code == 200
        data = r.json()
        assert data["stream_url"] is not None
        assert data["kind"] in ("live", "recorded")

    def test_exception_returns_null(self, client):
        with patch("api.routers.earnings_intel.get_audio",
                   side_effect=RuntimeError("provider down")):
            r = client.get("/api/earnings/audio/ERR")
        assert r.status_code == 200
        assert r.json() is None
