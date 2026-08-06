"""AlphaVantage earnings call transcript service.

GET https://www.alphavantage.co/query
    ?function=EARNINGS_CALL_TRANSCRIPT&symbol=AAPL&quarter=2025Q1&apikey=KEY

AV free tier: 25 requests/day — this service is lazy / on-demand only.

Rate-limit discipline:
- Cache each (ticker, quarter) result 24h (key av_transcript_{TICKER}_{Q}).
- Cache the resolved-latest mapping 24h (key av_transcript_latest_{TICKER}).
- Probe at most 4 candidates newest-first when quarter is None.
- On throttle response (Information/Note key present, or missing transcript key):
  return None and short-cache 5 min to avoid hammering.
- Never raise.

`_fetch_quarter`'s HTTP call is now GATED by the shared
`api.services.alphavantage_client` daily budget (data-dependability
migration, Task 15) rather than firing an uncoordinated `requests.get` —
this was one of up to seven AV call sites in this codebase spending the SAME
25/day account budget with zero visibility to each other. It consults the
primitives directly (`av_take_token`/`av_note_throttle`/
`is_av_throttle_response`) rather than the full `av_get`/`av_get_status`
wrapper, mirroring the escape hatch `finnhub_client.py` documents for a
caller that needs to keep its own HTTP call shape (here: the exact
`requests.get(url, timeout=15)` this module's existing test suite patches,
and the throttle-vs-genuine-miss distinction this probe loop already relies
on to decide "stop probing" vs "try the next candidate" — the same reason
`av_get_status` exists as a lower-level alternative to `av_get`, see that
module's docstring). It deliberately does NOT gate on
`alphavantage_client.av_in_cooldown()` before its own attempts — see
`_fetch_quarter`'s docstring for why — but DOES engage that shared cooldown
via `av_note_throttle` when it detects its own throttle, so other AV callers
still benefit from what this one just learned.
"""
from __future__ import annotations

import logging
import os
import threading
import requests as _requests_module
from datetime import date, timedelta
from typing import Optional

from api.services.alphavantage_client import (
    av_take_token as _av_take_token,
    av_note_throttle as _av_note_throttle,
    is_av_throttle_response as _is_av_throttle,
)
from api.services.cache import cache as _cache_singleton

_log = logging.getLogger(__name__)

# Module-level references — tests patch these targets directly
requests = _requests_module
cache = _cache_singleton

_CACHE_TTL_HIT      = 86_400   # 24h — transcripts don't change
_CACHE_TTL_THROTTLE = 300      # 5 min — don't hammer on quota exhaustion
_MAX_PROBE          = 4        # candidates to try before giving up

# Sentinel returned by _fetch_quarter when AV rate-limits (Information/Note key)
# so the caller can distinguish "throttled" from "genuine miss" and stop probing.
_THROTTLED = object()

# Per-ticker locks: prevent two concurrent cold-requests from both probing
# up to 4 AV calls (25/day budget) for the same ticker simultaneously.
_ticker_locks: dict[str, threading.Lock] = {}
_ticker_locks_mu = threading.Lock()


def _av_key() -> str:
    return os.environ.get("ALPHAVANTAGE_API_KEY", "")


def _probe_quarters(n: int = _MAX_PROBE) -> list[str]:
    """Generate up to *n* quarter labels (e.g. '2026Q1') newest-first from today.

    AV uses calendar-ish quarter labels derived from the fiscal-year end.
    Probing covers the most recent completed quarters.
    """
    today = date.today()
    labels: list[str] = []
    # Walk backwards in ~91-day steps to approximate calendar quarters.
    cursor = today
    for _ in range(n):
        # Map month → calendar quarter
        q_num = (cursor.month - 1) // 3 + 1
        labels.append(f"{cursor.year}Q{q_num}")
        cursor = cursor - timedelta(days=91)
    # Deduplicate while preserving order (different dates may land on same Q label)
    seen: set[str] = set()
    unique: list[str] = []
    for lbl in labels:
        if lbl not in seen:
            seen.add(lbl)
            unique.append(lbl)
    return unique[:n]


def _fetch_quarter(ticker: str, quarter: str) -> Optional[dict]:
    """Fetch a single (ticker, quarter) from AV.

    Returns dict with 'segments' list on success, None on any failure.
    Gated by the shared `alphavantage_client` daily budget before any
    network call is made (see module docstring, Task 15). Raises nothing.

    Deliberately does NOT also pre-check `alphavantage_client.av_in_cooldown()`
    here — this probe loop already stops itself on the FIRST throttle it
    personally observes (the `_THROTTLED` sentinel below), so it doesn't need
    to additionally defer to a cooldown some OTHER caller engaged moments
    ago; it still CONTRIBUTES to that shared cooldown (`_av_note_throttle`
    below) so other callers benefit from what this one just learned. This is
    a one-way handoff, not full bidirectional gating — see
    `alphavantage_client.py`'s module docstring on the budget-vs-cooldown
    split for callers with their own existing throttle-vs-miss handling.
    """
    key = _av_key()
    if not key:
        _log.debug("[av_transcripts] ALPHAVANTAGE_API_KEY not set")
        return None

    # Shared, process-wide daily budget — consulted BEFORE the network call
    # so an already-exhausted day costs zero HTTP round trips here too.
    # Treated the same as an AV-issued throttle: return the sentinel so the
    # probe loop in get_transcript stops immediately instead of burning more
    # of an already-spent budget on the next candidate quarter.
    if not _av_take_token():
        _log.info("[av_transcripts] AV daily budget exhausted — skipping %s %s", ticker, quarter)
        return _THROTTLED

    url = (
        "https://www.alphavantage.co/query"
        f"?function=EARNINGS_CALL_TRANSCRIPT"
        f"&symbol={ticker}"
        f"&quarter={quarter}"
        f"&apikey={key}"
    )

    try:
        resp = requests.get(url, timeout=15)
    except Exception as exc:
        _log.warning("[av_transcripts] HTTP error for %s %s: %s", ticker, quarter, exc)
        return None

    if not resp.ok:
        _log.warning("[av_transcripts] HTTP %d for %s %s", resp.status_code, ticker, quarter)
        return None

    try:
        data = resp.json()
    except Exception as exc:
        _log.warning("[av_transcripts] JSON parse error for %s %s: %s", ticker, quarter, exc)
        return None

    # Throttle / quota response detection (shared classifier, Task 15) —
    # return sentinel so caller stops probing
    if _is_av_throttle(data):
        _log.info("[av_transcripts] AV throttle/quota response for %s %s", ticker, quarter)
        _av_note_throttle(f"av_transcripts:{ticker}:{quarter}")
        return _THROTTLED  # distinct from None (genuine miss)

    raw_segments = data.get("transcript")
    if not raw_segments or not isinstance(raw_segments, list):
        return None  # empty / wrong shape — genuine miss, try next quarter

    segments = []
    for seg in raw_segments:
        if not isinstance(seg, dict):
            continue
        speaker  = (seg.get("speaker") or "").strip()
        title    = (seg.get("title") or "").strip()
        content  = (seg.get("content") or "").strip()
        # sentiment is optional in AV response
        sentiment = (seg.get("sentiment") or "").strip() or None
        if content:
            segments.append({
                "speaker":   speaker,
                "title":     title,
                "content":   content,
                "sentiment": sentiment,
            })

    if not segments:
        return None

    return {"segments": segments}


def _is_throttle(ticker: str, quarter: str) -> bool:
    """Re-detect throttle by checking if the cached response is None via short TTL key."""
    # We track throttle via a distinct cache key set by get_transcript.
    # This helper is for internal documentation; callers check cache directly.
    return False


def get_transcript(
    ticker: str,
    quarter: Optional[str] = None,
) -> Optional[dict]:
    """Fetch verbatim earnings call transcript from AlphaVantage.

    When *quarter* is None, probes the most recent calendar quarters
    newest-first and returns the FIRST that yields a non-empty transcript.
    The resolved quarter is cached so repeat opens cost 0 calls.

    Returns:
        {
            "symbol":   "AAPL",
            "quarter":  "2025Q1",
            "segments": [{"speaker", "title", "content", "sentiment"}, ...],
            "resolved": True,   # True when quarter was auto-resolved from probe
        }
        or None when unavailable / throttled.

    Never raises.
    """
    ticker = ticker.upper().strip()
    if not ticker:
        return None

    # ── Fast path: single known quarter ───────────────────────────────────────
    if quarter:
        cache_key = f"av_transcript_{ticker}_{quarter}"
        cached = cache.get(cache_key)
        if cached is not None:
            # Cached sentinel: {"_throttle": True} means a throttle or miss
            if cached.get("_throttle"):
                return None
            return cached

        result = _fetch_quarter(ticker, quarter)
        if result is None or result is _THROTTLED:
            cache.set(cache_key, {"_throttle": True}, ttl=_CACHE_TTL_THROTTLE)
            return None

        payload = {
            "symbol":   ticker,
            "quarter":  quarter,
            "segments": result["segments"],
            "resolved": False,
        }
        cache.set(cache_key, payload, ttl=_CACHE_TTL_HIT)
        return payload

    # ── Auto-resolve path: no quarter specified ────────────────────────────────
    # Check if we already resolved this ticker's latest quarter
    latest_key = f"av_transcript_latest_{ticker}"
    resolved_quarter: Optional[str] = cache.get(latest_key)

    if resolved_quarter:
        # We know which quarter had a transcript; fetch it (from cache if warm)
        return get_transcript(ticker, quarter=resolved_quarter)

    # Acquire a per-ticker lock so two concurrent cold-requests don't both
    # probe up to 4 AV calls (25/day budget) for the same ticker.
    with _ticker_locks_mu:
        if ticker not in _ticker_locks:
            _ticker_locks[ticker] = threading.Lock()
        lock = _ticker_locks[ticker]

    with lock:
        # Re-check latest_key inside the lock — a parallel caller may have
        # already resolved and cached the result while we waited.
        resolved_quarter = cache.get(latest_key)
        if resolved_quarter:
            return get_transcript(ticker, quarter=resolved_quarter)

        # Probe newest-first — STOP immediately on AV throttle (Information/Note key).
        # A genuine miss (empty transcript for that quarter) tries the next one.
        candidates = _probe_quarters(_MAX_PROBE)
        for candidate in candidates:
            cand_key = f"av_transcript_{ticker}_{candidate}"
            cached_cand = cache.get(cand_key)
            if cached_cand is not None:
                if cached_cand.get("_throttle"):
                    # Previously throttled — stop probing entirely
                    return None
                # Found a valid cached transcript
                cache.set(latest_key, candidate, ttl=_CACHE_TTL_HIT)
                return cached_cand

            # Live fetch
            result = _fetch_quarter(ticker, candidate)
            if result is _THROTTLED:
                # AV rate-limited — stop probing immediately to conserve quota
                cache.set(cand_key, {"_throttle": True}, ttl=_CACHE_TTL_THROTTLE)
                break
            if result is None:
                # Genuine miss for this quarter — short-cache and try next
                cache.set(cand_key, {"_throttle": True}, ttl=_CACHE_TTL_THROTTLE)
                continue

            payload = {
                "symbol":   ticker,
                "quarter":  candidate,
                "segments": result["segments"],
                "resolved": True,
            }
            cache.set(cand_key, payload, ttl=_CACHE_TTL_HIT)
            cache.set(latest_key, candidate, ttl=_CACHE_TTL_HIT)
            return payload

    # All candidates exhausted / throttled with no result
    return None
