"""Earnings call transcript service — Finnhub fetch + Claude AI summarization.

Two-step flow:
  1. Finnhub /stock/earnings-transcripts/list → get transcript IDs
  2. Finnhub /stock/earnings-transcripts?id={id} → full transcript text
  3. Claude Haiku summarization → structured bullets + sentiment

Cache: 24h on success, 1h on miss.
"""

from __future__ import annotations
import json
import logging
import os

_logger = logging.getLogger(__name__)

_TRANSCRIPT_CACHE_TTL_HIT  = 86_400   # 24h — transcripts don't change
_TRANSCRIPT_CACHE_TTL_MISS = 3_600    # 1h — retry window
_TRANSCRIPT_AI_MODEL       = "claude-haiku-4-5-20251001"
_TRANSCRIPT_AI_MAX_TOKENS  = 800      # 5-7 detailed bullets from full call
_MAX_TRANSCRIPT_CHARS      = 12_000   # truncation threshold
_HEAD_CHARS                = 3_000    # CEO/CFO prepared remarks
_TAIL_CHARS                = 4_000    # analyst Q&A section


def _fetch_latest_transcript(symbol: str) -> dict | None:
    """Fetch the most recent earnings call transcript from Finnhub.

    Returns {text, quarter, year, title} or None if unavailable.
    """
    import requests

    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    if not fh_key:
        return None

    # Step 1: list available transcripts
    try:
        list_url = (
            f"https://finnhub.io/api/v1/stock/transcripts/list"
            f"?symbol={symbol}&token={fh_key}"
        )
        resp = requests.get(list_url, timeout=10)
        if not resp.ok:
            _logger.warning("Transcript list HTTP %d for %s", resp.status_code, symbol)
            return None
        data = resp.json()
        transcripts = data.get("transcripts", [])
        if not transcripts:
            return None
    except Exception as exc:
        _logger.warning("Transcript list fetch failed for %s: %s", symbol, exc)
        return None

    # Pick the most recent transcript
    latest = transcripts[0]
    transcript_id = latest.get("id")
    if not transcript_id:
        return None

    # Step 2: fetch full transcript
    try:
        detail_url = (
            f"https://finnhub.io/api/v1/stock/transcripts"
            f"?id={transcript_id}&token={fh_key}"
        )
        resp = requests.get(detail_url, timeout=15)
        if not resp.ok:
            _logger.warning("Transcript detail HTTP %d for %s", resp.status_code, symbol)
            return None
        detail = resp.json()
    except Exception as exc:
        _logger.warning("Transcript detail fetch failed for %s: %s", symbol, exc)
        return None

    # Concatenate all speech entries
    parts = detail.get("transcript", [])
    if not parts:
        return None

    text_parts = []
    for part in parts:
        name = part.get("name", "")
        speech_items = part.get("speech", [])
        if isinstance(speech_items, list):
            for s in speech_items:
                speaker = s.get("name", name)
                content = s.get("speech", "")
                if content:
                    text_parts.append(f"{speaker}: {content}")
        elif isinstance(speech_items, str) and speech_items:
            text_parts.append(f"{name}: {speech_items}")

    full_text = "\n\n".join(text_parts)
    if not full_text.strip():
        return None

    # Smart truncation: keep CEO/CFO remarks (head) + analyst Q&A (tail)
    if len(full_text) > _MAX_TRANSCRIPT_CHARS:
        head = full_text[:_HEAD_CHARS]
        tail = full_text[-_TAIL_CHARS:]
        full_text = (
            f"{head}\n\n"
            f"[... transcript truncated — {len(full_text):,} chars total ...]\n\n"
            f"{tail}"
        )

    return {
        "text":    full_text,
        "quarter": latest.get("quarter") or detail.get("quarter"),
        "year":    latest.get("year") or detail.get("year"),
        "title":   latest.get("title", ""),
    }


def _analyze_transcript(symbol: str, text: str, quarter: int | None, year: int | None) -> dict | None:
    """Summarize transcript via Claude Haiku → structured JSON."""
    try:
        import anthropic

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None

        client = anthropic.Anthropic(api_key=api_key)

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
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()

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

    # Fetch transcript from Finnhub
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
