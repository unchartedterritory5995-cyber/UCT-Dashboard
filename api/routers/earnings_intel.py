"""Earnings intelligence router — call recap, sentiment, webcast, audio, rating changes,
and verbatim AV transcripts.

GET /api/earnings/call-recap/{ticker}   → call recap (24h cache, cost-guarded)
GET /api/earnings/sentiment/{ticker}    → AI sentiment (12h cache, cost-guarded)
GET /api/earnings/audio/{ticker}        → pluggable audio (env-gated)
GET /api/earnings/transcript/{ticker}   → verbatim transcript via AlphaVantage (lazy, cached)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Query

from api.services.call_recap import (
    get_call_recap,
    get_sentiment,
    get_webcast_url,
    get_rating_changes,
)
from api.services.earnings_audio import get_audio
from api.services.av_transcripts import get_transcript

_log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/earnings/call-recap/{ticker}")
def call_recap_endpoint(ticker: str):
    """AI-synthesized earnings call recap.

    Returns {headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}
    or null when no data is available.
    Cached 24h. Cost-guarded (reuses catalyst daily cap).
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        recap = get_call_recap(sym)
        webcast = get_webcast_url(sym)
        ratings = get_rating_changes(sym)
        return {
            "ticker": sym,
            "recap": recap,
            "webcast_url": webcast,
            "rating_changes": ratings,
        }
    except Exception as e:
        _log.warning("[earnings_intel] call-recap failed for %s: %s", sym, e)
        return {"ticker": sym, "recap": None, "webcast_url": None, "rating_changes": []}


@router.get("/api/earnings/audio/{ticker}")
def audio_endpoint(ticker: str):
    """Pluggable earnings-call audio.

    Returns {stream_url, kind: 'live'|'recorded', transcript_url} when a
    provider is configured (EARNINGS_AUDIO_PROVIDER env), otherwise null.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_audio(sym)
    except Exception as e:
        _log.warning("[earnings_intel] audio failed for %s: %s", sym, e)
        return None


@router.get("/api/earnings/sentiment/{ticker}")
def sentiment_endpoint(ticker: str):
    """AI-derived earnings sentiment.

    Returns {score: int(-100..100), label, rationale, drivers[]}
    or null when unavailable.
    Cached 12h. Cost-guarded.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_sentiment(sym)
    except Exception as e:
        _log.warning("[earnings_intel] sentiment failed for %s: %s", sym, e)
        return None


@router.get("/api/earnings/transcript/{ticker}")
def transcript_endpoint(
    ticker: str,
    quarter: Optional[str] = Query(default=None, description="e.g. 2025Q1; omit to auto-resolve latest"),
):
    """Verbatim earnings call transcript via AlphaVantage.

    Lazy / on-demand only to respect the 25 req/day free-tier quota.
    Results are cached 24h; throttle responses are short-cached 5 min.

    Returns:
        {symbol, quarter, segments: [{speaker, title, content, sentiment}], resolved}
        or null when unavailable.
    Never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None
    try:
        return get_transcript(sym, quarter=quarter or None)
    except Exception as e:
        _log.warning("[earnings_intel] av transcript failed for %s: %s", sym, e)
        return None
