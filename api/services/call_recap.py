"""Call recap + sentiment service for the Calendar EarningsHub competitor.

Provides:
  get_call_recap(ticker)  → {headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}
  get_sentiment(ticker)   → {score, label, rationale, drivers[]}
  get_webcast_url(ticker) → str | None   (IR "Listen live" link)
  get_rating_changes(ticker) → [{period, strong_buy, buy, hold, sell, strong_sell, net_delta}]

All functions:
  - Are cached (24h / 12h / 24h / 6h respectively)
  - Are cost-guarded via catalyst cost_guard (reuses the daily cap)
  - Are null-safe — return None on any error, never raise

Model: claude-opus-4-7 per feedback_opus_for_synthesis.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import llm_timeouts

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

_RECAP_TTL   = 24 * 3600   # 24 hours
_SENTIMENT_TTL = 12 * 3600  # 12 hours
_WEBCAST_TTL  = 24 * 3600   # 24 hours
_RATINGS_TTL  = 6 * 3600    # 6 hours

_OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL", "claude-opus-4-7")

# ── lazy imports ─────────────────────────────────────────────────────────────

def _cache():
    from api.services.cache import cache
    return cache


def _perplexity():
    from api.services import perplexity_search
    return perplexity_search


def _cost_guard():
    from api.services.catalyst import cost_guard
    return cost_guard


def _anthropic_client():
    """Lazy Anthropic client — same init as engine._get_anthropic_client().

    BOUNDED: reached from `/api/earnings-intel/*` on the request path. Opus
    synthesis with a large output, so the LONG request-path budget rather than
    the 60s one — but bounded, because the SDK's default is 600s and this runs
    on one of the pod's 64 shared anyio workers.
    """
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(
        api_key=api_key,
        timeout=llm_timeouts.seconds("CALL_RECAP_LLM_TIMEOUT_SECS",
                                     llm_timeouts.REQUEST_PATH_LONG),
    )


def _today_date() -> str:
    return datetime.datetime.now(_ET).date().isoformat()


# ── Perplexity helper ─────────────────────────────────────────────────────────

def _pplx_earnings_highlights(ticker: str) -> str:
    """Use Perplexity to gather recent earnings call highlights for ticker."""
    pplx = _perplexity()
    query = (
        f"What happened on {ticker}'s most recent earnings call? "
        f"Include: headline result, management guidance quotes, "
        f"key analyst Q&A moments, and whether guidance was raised/cut/maintained. "
        f"Cite sources. Be specific with numbers."
    )
    try:
        result = pplx.web_search(
            query,
            max_tokens=600,
            domain_pack="finance",
            recency="month",
        )
        answer = (result or {}).get("answer") or ""
        return answer
    except Exception as e:
        _log.debug("Perplexity earnings highlights failed for %s: %s", ticker, e)
        return ""


# ── get_call_recap ────────────────────────────────────────────────────────────

def get_call_recap(ticker: str) -> Optional[dict[str, Any]]:
    """Return AI-synthesized earnings call recap for the most recent quarter.

    Shape: {headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}
    Cached 24h. Cost-guarded. Returns None on failure.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    ck = f"call_recap::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit if hit != "__null__" else None

    market_date = _today_date()
    guard = _cost_guard()
    if not guard.may_synthesize(market_date):
        _log.info("[call_recap] cost cap reached, skipping %s", sym)
        return None

    # --- Gather context from Perplexity ---
    try:
        web_context = _pplx_earnings_highlights(sym)
    except Exception as e:
        _log.warning("[call_recap] perplexity fetch failed for %s: %s", sym, e)
        _cache().set(ck, "__null__", _RECAP_TTL)
        return None

    if not web_context:
        _cache().set(ck, "__null__", _RECAP_TTL)
        return None

    # --- LLM synthesis ---
    prompt = (
        f"Based on the following information about {sym}'s recent earnings call, "
        f"produce a JSON object with EXACTLY these keys:\n"
        f"- headline: one-sentence summary of the call outcome (string)\n"
        f"- sentiment: 'positive' | 'negative' | 'mixed' | 'neutral'\n"
        f"- bullets: list of 4-6 key takeaway strings\n"
        f"- quotes: list of up to 3 notable management quote objects: "
        f"  {{topic, quote}} where quote is a paraphrased or verbatim statement\n"
        f"- guidance: 'raised' | 'cut' | 'maintained' | 'none' | null\n"
        f"- qa_highlights: list of up to 3 notable analyst Q&A exchanges as short strings\n\n"
        f"Source context:\n{web_context}\n\n"
        f"Return ONLY the JSON object, no explanation or markdown fences."
    )
    try:
        client = _anthropic_client()
        response = client.messages.create(
            model=_OPUS_MODEL,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = (response.content[0].text or "").strip()

        # Record cost
        guard.record(
            market_date=market_date,
            ticker=sym,
            model=_OPUS_MODEL,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

        # Parse JSON
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        result = json.loads(raw)
        # Validate required keys
        required = {"headline", "sentiment", "bullets", "quotes", "guidance", "qa_highlights"}
        for k in required:
            if k not in result:
                result[k] = None if k in ("headline", "sentiment", "guidance") else []

        _cache().set(ck, result, _RECAP_TTL)
        return result

    except Exception as e:
        _log.warning("[call_recap] LLM synthesis failed for %s: %s", sym, e)
        _cache().set(ck, "__null__", _RECAP_TTL)
        return None


# ── get_sentiment ─────────────────────────────────────────────────────────────

def get_sentiment(ticker: str) -> Optional[dict[str, Any]]:
    """Return AI-derived earnings sentiment for the most recent call/results.

    Shape: {score: int(-100..100), label: str, rationale: str, drivers: list[str]}
    Cached 12h. Cost-guarded. Returns None on failure.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    ck = f"call_sentiment::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit if hit != "__null__" else None

    market_date = _today_date()
    guard = _cost_guard()
    if not guard.may_synthesize(market_date):
        _log.info("[call_sentiment] cost cap reached, skipping %s", sym)
        return None

    try:
        web_context = _pplx_earnings_highlights(sym)
    except Exception as e:
        _log.warning("[call_sentiment] perplexity fetch failed for %s: %s", sym, e)
        _cache().set(ck, "__null__", _SENTIMENT_TTL)
        return None

    if not web_context:
        _cache().set(ck, "__null__", _SENTIMENT_TTL)
        return None

    prompt = (
        f"Analyze the market and investor sentiment around {sym}'s most recent earnings.\n\n"
        f"Source context:\n{web_context}\n\n"
        f"Return a JSON object with EXACTLY these keys:\n"
        f"- score: integer from -100 (extremely negative) to 100 (extremely positive)\n"
        f"- label: one of 'Very Positive' | 'Positive' | 'Neutral' | 'Negative' | 'Very Negative'\n"
        f"- rationale: 2-3 sentence explanation of the score\n"
        f"- drivers: list of 3-5 short strings naming specific sentiment drivers\n\n"
        f"Return ONLY the JSON, no markdown."
    )
    try:
        client = _anthropic_client()
        response = client.messages.create(
            model=_OPUS_MODEL,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = (response.content[0].text or "").strip()

        guard.record(
            market_date=market_date,
            ticker=sym,
            model=_OPUS_MODEL,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        result = json.loads(raw)
        # Null-safe defaults
        result.setdefault("score", 0)
        result.setdefault("label", "Neutral")
        result.setdefault("rationale", "")
        result.setdefault("drivers", [])
        # Clamp score
        try:
            result["score"] = max(-100, min(100, int(result["score"])))
        except (TypeError, ValueError):
            result["score"] = 0

        _cache().set(ck, result, _SENTIMENT_TTL)
        return result

    except Exception as e:
        _log.warning("[call_sentiment] LLM synthesis failed for %s: %s", sym, e)
        _cache().set(ck, "__null__", _SENTIMENT_TTL)
        return None


# ── get_webcast_url ───────────────────────────────────────────────────────────

def get_webcast_url(ticker: str) -> Optional[str]:
    """Find the IR / webcast URL for a ticker's live earnings call.

    Uses Perplexity to locate the official IR page or webcast link.
    Cached 24h. Returns None on failure.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    ck = f"webcast_url::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit if hit != "__null__" else None

    pplx = _perplexity()
    query = (
        f"What is the official investor relations webcast or earnings call listen link "
        f"for {sym} stock? Return only the direct URL, no explanation."
    )
    try:
        result = pplx.web_search(query, max_tokens=100, domain_pack="finance")
        answer = (result or {}).get("answer") or ""
        citations = (result or {}).get("citations") or []

        # Try to extract a URL from the answer
        import re
        urls = re.findall(r"https?://[^\s\"'<>]+", answer)
        url = None
        if urls:
            # Prefer IR / investor domain
            for u in urls:
                if any(kw in u.lower() for kw in ("investor", "ir.", "earnings", "webcast")):
                    url = u
                    break
            if not url:
                url = urls[0]
        elif citations:
            url = citations[0]

        _cache().set(ck, url if url else "__null__", _WEBCAST_TTL)
        return url
    except Exception as e:
        _log.debug("get_webcast_url failed for %s: %s", sym, e)
        _cache().set(ck, "__null__", _WEBCAST_TTL)
        return None


# ── get_rating_changes ────────────────────────────────────────────────────────

def get_rating_changes(ticker: str) -> list[dict[str, Any]]:
    """Recent analyst recommendation changes, newest first, with
    month-over-month net (buy-side minus sell-side) deltas. Empty list on
    total failure.

    FMP `stable/grades-historical` is primary (data-dependability migration
    plan, Task 5) — Finnhub `/stock/recommendation` shares the process-wide
    60/min budget across every caller in the app and is the weaker plan
    overall. Finnhub only fires when FMP yields nothing usable, and is
    routed through the shared `finnhub_client.fh_get` token bucket / 429
    cooldown so it never spends that shared budget uncoordinated.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return []

    ck = f"rating_changes::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit

    from api.services import earnings_estimates as ee
    data = ee._fmp_grades_historical(sym, limit=4)

    if not data:
        from api.services.finnhub_client import fh_get
        fh_data = fh_get("/stock/recommendation", {"symbol": sym}, timeout=10)
        if isinstance(fh_data, list):
            data = [
                {
                    "period":     item.get("period") or "",
                    "strongBuy":  int(item.get("strongBuy") or 0),
                    "buy":        int(item.get("buy") or 0),
                    "hold":       int(item.get("hold") or 0),
                    "sell":       int(item.get("sell") or 0),
                    "strongSell": int(item.get("strongSell") or 0),
                }
                for item in fh_data[:4] if isinstance(item, dict)
            ]

    if not data:
        _cache().set(ck, [], _RATINGS_TTL)
        return []

    # Normalize and compute net (buy-side minus sell-side) + month-over-month delta
    rows = []
    for item in data[:4]:   # last 4 months is enough context
        sb = int(item.get("strongBuy") or 0)
        b  = int(item.get("buy") or 0)
        h  = int(item.get("hold") or 0)
        sl = int(item.get("sell") or 0)
        ss = int(item.get("strongSell") or 0)
        net = (sb + b) - (sl + ss)
        rows.append({
            "period":      item.get("period") or "",
            "strong_buy":  sb,
            "buy":         b,
            "hold":        h,
            "sell":        sl,
            "strong_sell": ss,
            "net":         net,
        })

    # Compute month-over-month net delta (newest - prior)
    for i in range(len(rows) - 1):
        rows[i]["net_delta"] = rows[i]["net"] - rows[i + 1]["net"]
    if rows:
        rows[-1]["net_delta"] = None   # oldest has no prior

    _cache().set(ck, rows, _RATINGS_TTL)
    return rows
