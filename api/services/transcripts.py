"""Earnings call transcript service — FMP fetch + Claude AI summarization.

FMP `stable/earning-call-transcript(-dates)`, the only source:
  1. FMP   stable/earning-call-transcript-dates → newest (year, quarter)
     FMP   stable/earning-call-transcript?symbol=&year=&quarter= → full text
  2. Claude Haiku/Sonnet summarization → structured bullets + sentiment

⚰️ The Finnhub `/stock/transcripts/list` + `/stock/transcripts` fallback leg was
DELETED 2026-11-28 (licensed-first pass 1): it 403'd on every call on this plan
(below; licensing register T-52), so it never returned a transcript.

Cache: 24h on success, 1h on miss.

── 2026-08-05: FMP promoted to primary ──────────────────────────────────────
Live probe (three rounds, 10s apart): Finnhub `/stock/transcripts/list`
returned **403 on every call** — this Finnhub plan does not carry the
endpoint, not a throttle. The EarningsModal transcript section has therefore
been permanently hidden for every user (CLAUDE.md documented this as
"Requires Finnhub premium — section hides when unavailable").

FMP `stable/earning-call-transcript-dates` + `stable/earning-call-transcript`
(already paid FMP Ultimate, verified 200 with real content — 84 quarters for
AAPL, full body for the latest) are now tried first. Finnhub was kept as an
explicit fallback until 2026-11-28, when the leg was deleted: a fallback that
403s on every call is not a safety net.

The FMP call plumbing (auth, bounded timeout, error handling) is NOT
duplicated here — it's delegated to api.services.fmp_transcripts' private
helpers (`_available` / `_fetch`), which already implement the same two-leg
fetch for the separate verbatim-transcript feature (earnings_intel.py). This
module wants FMP's single joined `content` string instead of that module's
speaker-segmented shape, so it calls the raw fetch, not `get_transcript()`.
"""

from __future__ import annotations
from api.services import llm_models
import json
import logging
import os

from api.services import llm_timeouts

_logger = logging.getLogger(__name__)

_TRANSCRIPT_CACHE_TTL_HIT  = 86_400   # 24h — transcripts don't change
_TRANSCRIPT_CACHE_TTL_MISS = 3_600    # 1h — retry window
_TRANSCRIPT_AI_MODEL       = llm_models.SONNET  # upgraded Haiku→Sonnet 2026-05-27 (richer transcript summaries)
_TRANSCRIPT_AI_MAX_TOKENS  = 800      # 5-7 detailed bullets from full call
_MAX_TRANSCRIPT_CHARS      = 12_000   # truncation threshold
_HEAD_CHARS                = 3_000    # CEO/CFO prepared remarks
_TAIL_CHARS                = 4_000    # analyst Q&A section


def _smart_truncate(full_text: str) -> str:
    """Keep CEO/CFO remarks (head) + analyst Q&A (tail); drop the middle on
    long transcripts. Same 3K/4K boundaries for both the FMP and Finnhub
    legs — unchanged by the 2026-08-05 provider migration."""
    if len(full_text) > _MAX_TRANSCRIPT_CHARS:
        head = full_text[:_HEAD_CHARS]
        tail = full_text[-_TAIL_CHARS:]
        return (
            f"{head}\n\n"
            f"[... transcript truncated — {len(full_text):,} chars total ...]\n\n"
            f"{tail}"
        )
    return full_text


def _fetch_latest_transcript_fmp(symbol: str) -> dict | None:
    """FMP leg — stable/earning-call-transcript-dates → newest (year,
    quarter) → stable/earning-call-transcript for the full `content` string.

    Builds `text` from FMP's single pre-joined `content` string, NOT from a
    speaker-`parts` list (that was Finnhub's shape) — there is nothing to
    concatenate here.
    """
    from api.services import fmp_transcripts

    avail = fmp_transcripts._available(symbol)
    if not avail:
        return None
    year, quarter = avail[0]  # _available returns [(fiscalYear, quarter), ...] newest-first

    row = fmp_transcripts._fetch(symbol, year, quarter)
    content = row.get("content") if isinstance(row, dict) else None
    full_text = (content or "").strip()
    if not full_text:
        return None

    return {
        "text":    _smart_truncate(full_text),
        "quarter": quarter,
        "year":    year,
        "title":   f"{symbol.upper()} Q{quarter} {year}",
    }


def _fetch_latest_transcript(symbol: str) -> dict | None:
    """Fetch the most recent earnings call transcript from FMP (the dead
    Finnhub leg was deleted 2026-11-28, see the module docstring).

    Returns {text, quarter, year, title} or None if unavailable.
    """
    try:
        return _fetch_latest_transcript_fmp(symbol)
    except Exception as exc:
        _logger.warning("FMP transcript fetch failed for %s: %s", symbol, exc)
        return None


def _analyze_transcript(symbol: str, text: str, quarter: int | None, year: int | None) -> dict | None:
    """Summarize transcript via Claude Haiku → structured JSON."""
    try:
        import anthropic

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None

        # BOUNDED. `GET /api/transcripts/{symbol}` reaches here with NO auth
        # dependency — only `@limiter.limit("10/minute")` — so an anonymous
        # caller could otherwise open threads that each hold one of the pod's 64
        # anyio workers for the SDK's 600 s default. See api/services/llm_timeouts.py.
        client = anthropic.Anthropic(
            api_key=api_key,
            timeout=llm_timeouts.seconds("TRANSCRIPT_LLM_TIMEOUT_SECS",
                                         llm_timeouts.REQUEST_PATH),
            max_retries=0,
        )

        quarter_label = f"Q{quarter} {year}" if quarter and year else "recent quarter"

        prompt = (
            f"Analyze this {symbol} earnings call transcript ({quarter_label}).\n"
            f"Return JSON only — no markdown, no explanation.\n\n"
            f"TRANSCRIPT:\n{text}\n\n"
            'JSON format (exactly):\n'
            '{"headline": "<1 sentence key takeaway from the call>", '
            '"sentiment": "<bullish or bearish or neutral>", '
            '"bullets": ['
            '"<management tone and confidence level>", '
            '"<key revenue/earnings metrics discussed>", '
            '"<guidance changes or forward outlook>", '
            '"<notable analyst Q&A highlights or pushback>", '
            '"<strategic initiatives or pivots mentioned>", '
            '"<risks or challenges acknowledged>", '
            '"<any notable surprises from the call>"'
            "]}\n\n"
            "Be specific — reference actual numbers and quotes where possible. "
            "Drop any bullet that would be generic filler. No trade advice."
        )

        msg = client.messages.create(
            model=_TRANSCRIPT_AI_MODEL,
            max_tokens=_TRANSCRIPT_AI_MAX_TOKENS,
            **llm_models.plain(_TRANSCRIPT_AI_MODEL),
            metadata={"user_id": "transcript_summary:global"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = llm_models.text_of(msg).strip()

        # Strip markdown code fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        parsed = json.loads(raw)
        headline  = str(parsed.get("headline", "")).strip()
        sentiment = str(parsed.get("sentiment", "neutral")).strip().lower()
        bullets   = [str(b).strip() for b in parsed.get("bullets", [])[:7] if str(b).strip()]

        if sentiment not in ("bullish", "bearish", "neutral"):
            sentiment = "neutral"

        if not headline and not bullets:
            return None

        return {
            "headline":  headline,
            "sentiment": sentiment,
            "bullets":   bullets,
        }
    except Exception as exc:
        _logger.warning("Transcript AI analysis failed for %s: %s", symbol, exc, exc_info=True)
        return None


def get_transcript_summary(symbol: str) -> dict | None:
    """Main entry point — fetch + analyze latest transcript. Cached 24h.

    Returns {available, symbol, headline, sentiment, bullets, quarter, year} or None.
    """
    from api.services.cache import cache

    symbol = symbol.upper()
    cache_key = f"transcript_summary_{symbol}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Fetch transcript (FMP primary, Finnhub fallback)
    transcript = _fetch_latest_transcript(symbol)
    if not transcript:
        # No transcript available — cache negative result for 1h
        result = {"available": False, "symbol": symbol}
        cache.set(cache_key, result, ttl=_TRANSCRIPT_CACHE_TTL_MISS)
        return result

    # Analyze with Claude
    ai_result = _analyze_transcript(
        symbol,
        transcript["text"],
        transcript.get("quarter"),
        transcript.get("year"),
    )

    if not ai_result:
        result = {"available": False, "symbol": symbol}
        cache.set(cache_key, result, ttl=_TRANSCRIPT_CACHE_TTL_MISS)
        return result

    result = {
        "available": True,
        "symbol":    symbol,
        "headline":  ai_result["headline"],
        "sentiment": ai_result["sentiment"],
        "bullets":   ai_result["bullets"],
        "quarter":   transcript.get("quarter"),
        "year":      transcript.get("year"),
    }
    cache.set(cache_key, result, ttl=_TRANSCRIPT_CACHE_TTL_HIT)
    return result
