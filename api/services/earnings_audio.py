"""Pluggable earnings-call audio provider.

Gated by env vars:
  EARNINGS_AUDIO_PROVIDER  — none (default) | earningsapi | earningscall | quartr
  EARNINGS_AUDIO_API_KEY   — key for the chosen provider

get_audio(ticker) → None when provider=none
                  → {stream_url, kind: 'live'|'recorded', transcript_url} on success

All providers are null-safe; never raises.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

_log = logging.getLogger(__name__)


# ── Provider interface ────────────────────────────────────────────────────────

def _provider() -> str:
    return (os.environ.get("EARNINGS_AUDIO_PROVIDER") or "none").lower().strip()


def _api_key() -> str:
    return os.environ.get("EARNINGS_AUDIO_API_KEY") or ""


# ── EarningsAPI adapter ───────────────────────────────────────────────────────
# EarningsAPI (earningsapi.com) — $24.99 Pro / $39.99 Ultra
# Documented base: https://earningsapi.com/docs
# REST endpoints (as documented):
#   GET /v1/earnings/{ticker}/audio  — returns {audio_url, kind, transcript_url}
#   GET /v1/earnings/{ticker}/live   — live stream URL when call is in progress
#
# TODO: Confirm exact path once subscribed; the base URL and query-param style
# documented at earningsapi.com/docs as of 2026-06. Update _EARNINGSAPI_BASE
# and paths if they differ.

_EARNINGSAPI_BASE = "https://api.earningsapi.com"


def _earningsapi_get_audio(ticker: str) -> Optional[dict]:
    """EarningsAPI adapter — concrete implementation gated by API key."""
    key = _api_key()
    if not key:
        _log.debug("[earnings_audio] earningsapi key not set")
        return None

    import requests

    sym = ticker.upper()
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}

    # 1. Try live stream first (real-time call in progress)
    try:
        r = requests.get(
            f"{_EARNINGSAPI_BASE}/v1/earnings/{sym}/live",
            headers=headers,
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json() or {}
            stream_url = data.get("stream_url") or data.get("audio_url")
            if stream_url:
                return {
                    "stream_url": stream_url,
                    "kind": "live",
                    "transcript_url": data.get("transcript_url"),
                }
    except Exception as e:
        _log.debug("[earnings_audio] earningsapi live fetch failed for %s: %s", sym, e)

    # 2. Fall back to recorded audio
    try:
        r = requests.get(
            f"{_EARNINGSAPI_BASE}/v1/earnings/{sym}/audio",
            headers=headers,
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json() or {}
            stream_url = data.get("audio_url") or data.get("stream_url")
            if stream_url:
                return {
                    "stream_url": stream_url,
                    "kind": "recorded",
                    "transcript_url": data.get("transcript_url"),
                }
    except Exception as e:
        _log.debug("[earnings_audio] earningsapi recorded fetch failed for %s: %s", sym, e)

    return None


# ── EarningsCall adapter ──────────────────────────────────────────────────────
# TODO: Implement once EarningsCall (earningscall.co) API key is obtained.
# Documented base: https://earningscall.biz/api — REST, Bearer auth.
# Expected shape: {audio_url, transcript_url, kind}.

def _earningscall_get_audio(ticker: str) -> Optional[dict]:
    """EarningsCall.biz adapter — stub, pending API key."""
    # TODO: implement REST adapter against earningscall.biz/api
    # Expected endpoint: GET /v1/companies/{ticker}/earnings/latest/audio
    _log.debug("[earnings_audio] earningscall adapter not yet implemented for %s", ticker)
    return None


# ── Quartr adapter ────────────────────────────────────────────────────────────
# TODO: Implement once Quartr enterprise key is obtained.
# Quartr provides real-time HLS live streams; documented base: https://quartr.com/api
# Expected shape: {stream_url (HLS), kind: 'live'|'recorded', transcript_url}.

def _quartr_get_audio(ticker: str) -> Optional[dict]:
    """Quartr adapter — stub, pending enterprise key."""
    # TODO: implement real-time HLS stream endpoint from Quartr enterprise API
    # Expected endpoint: GET /v2/companies/{ticker}/events/latest/audio-stream
    _log.debug("[earnings_audio] quartr adapter not yet implemented for %s", ticker)
    return None


# ── Dispatch ──────────────────────────────────────────────────────────────────

_ADAPTERS = {
    "earningsapi":   _earningsapi_get_audio,
    "earningscall":  _earningscall_get_audio,
    "quartr":        _quartr_get_audio,
}


def get_audio(ticker: str) -> Optional[dict]:
    """Get earnings call audio for a ticker.

    Returns None when EARNINGS_AUDIO_PROVIDER=none (default) or on any failure.
    Returns {stream_url, kind: 'live'|'recorded', transcript_url} otherwise.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    prov = _provider()
    if prov == "none" or prov not in _ADAPTERS:
        return None

    adapter = _ADAPTERS[prov]
    try:
        return adapter(sym)
    except Exception as e:
        _log.warning("[earnings_audio] provider=%s failed for %s: %s", prov, sym, e)
        return None
