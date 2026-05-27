"""Perplexity Sonar web search for voice Compass + future research tools.

Wraps Perplexity's /chat/completions API with full tiered-model support:
  - sonar-pro             — fast web search + light synthesis (~2-3s)
  - sonar-reasoning-pro   — explicit reasoning step before answer (~5-10s)
  - sonar-deep-research   — exhaustive multi-source research (~minutes)

Plus finance domain pack + recency filter support, both of which Perplexity
exposes and which dramatically improve answer quality for market questions.

Shares PERPLEXITY_API_KEY with the morning-wire pipeline.
"""

import logging
import os
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.perplexity.ai/chat/completions"

# Three tiers Perplexity exposes. Voice routes based on question depth.
_MODELS = {
    "fast":      "sonar-pro",
    "reasoning": "sonar-reasoning-pro",
    "deep":      "sonar-deep-research",
}

# Per-tier timeouts. Deep research can run for minutes.
_TIMEOUTS = {
    "fast":      18,
    "reasoning": 35,
    "deep":      300,   # 5 min — deep research is intentionally slow
}

# Curated finance domain pack — locks the LLM to high-quality finance
# journalism + official sources, kills SEO spam and stale forum content.
_FINANCE_DOMAINS = [
    "bloomberg.com", "reuters.com", "wsj.com", "ft.com",
    "barrons.com", "marketwatch.com", "cnbc.com", "investors.com",
    "seekingalpha.com", "thefly.com", "benzinga.com", "briefing.com",
    "tradingview.com", "stockanalysis.com", "finance.yahoo.com",
    "federalreserve.gov", "sec.gov", "treasury.gov",
]

_RECENCY_VALUES = {"hour", "day", "week", "month"}

_DEFAULT_SYSTEM = (
    "You are a precise, decisive financial research assistant for a senior "
    "swing-trade portfolio manager. Reply in 2-4 sentences of plain prose — "
    "no markdown, no lists, no headers — your answer will be spoken aloud. "
    "Cite specific numbers, names, firms, and dates. If sources disagree, "
    "say so. Skip hedging; if the evidence is thin, say that plainly."
)

_DEEP_RESEARCH_SYSTEM = (
    "You are an exhaustive financial research analyst preparing a thorough "
    "brief for a senior portfolio manager. Cover bull case, bear case, "
    "consensus view, recent catalysts, key risks, and contrarian takes. "
    "Cite every claim. Length: 800-1500 words. Markdown structure is fine "
    "for deep research — the output is text, not voice."
)

_SEARCH_CACHE = TTLCache()

# Per-mode cache TTLs. Deep research is expensive so we cache it 1 hour.
_CACHE_TTL = {
    "fast":      900,    # 15 min
    "reasoning": 1800,   # 30 min
    "deep":      3600,   # 1 hour
}


def _resolve_mode(mode: str) -> str:
    m = (mode or "fast").lower().strip()
    return m if m in _MODELS else "fast"


def web_search(
    query: str,
    max_tokens: int = 400,
    system: str | None = None,
    mode: str = "fast",
    recency: str | None = None,
    domain_pack: str = "general",
    domains: list[str] | None = None,
) -> dict[str, Any]:
    """Synthesized web answer with citations.

    Returns ``{answer, citations, model, mode, elapsed_ms, cached, error?}``.
    Errors are returned in-band (never raises) so voice tools degrade
    gracefully.

    Args:
        query: natural-language question.
        max_tokens: cap on answer length (50-3000).
        system: override system prompt (defaults differ by mode).
        mode: "fast" (sonar-pro) | "reasoning" (sonar-reasoning-pro) |
              "deep" (sonar-deep-research, takes minutes).
        recency: "hour" | "day" | "week" | "month" — limits search to
                 results newer than that window.
        domain_pack: "finance" locks search to curated finance domains;
                     "general" is unrestricted.
        domains: explicit list (overrides domain_pack).
    """
    query = (query or "").strip()
    if not query:
        return {"answer": "", "citations": [], "error": "empty query"}

    resolved_mode = _resolve_mode(mode)
    model = _MODELS[resolved_mode]
    timeout = _TIMEOUTS[resolved_mode]
    ttl = _CACHE_TTL[resolved_mode]

    if domains is None and domain_pack == "finance":
        domains = _FINANCE_DOMAINS
    recency_filter = recency if recency in _RECENCY_VALUES else None

    # Cache key incorporates everything that affects the answer
    cache_key = (
        f"pplx::{model}::{recency_filter or 'any'}::{domain_pack}::"
        f"{max_tokens}::{(system or '')[:40]}::{query.lower()[:300]}"
    )
    cached = _SEARCH_CACHE.get(cache_key)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        return out

    api_key = os.environ.get("PERPLEXITY_API_KEY", "").strip()
    if not api_key:
        return {"answer": "", "citations": [], "error": "PERPLEXITY_API_KEY not set"}

    # Pick the right default system prompt for the mode
    default_system = _DEEP_RESEARCH_SYSTEM if resolved_mode == "deep" else _DEFAULT_SYSTEM
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system or default_system},
            {"role": "user", "content": query},
        ],
        "max_tokens": max(50, min(3000, int(max_tokens or 400))),
    }
    if domains:
        payload["search_domain_filter"] = domains[:20]
    if recency_filter:
        payload["search_recency_filter"] = recency_filter

    try:
        t0 = time.time()
        r = requests.post(
            _BASE,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except requests.Timeout:
        return {"answer": "", "citations": [], "error": f"timeout after {timeout}s",
                "mode": resolved_mode, "model": model}
    except requests.RequestException as e:
        _log.warning("perplexity request failed: %s", e)
        return {"answer": "", "citations": [], "error": f"request failed: {e}",
                "mode": resolved_mode, "model": model}

    try:
        answer = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        _log.warning("perplexity unexpected response shape: %s", e)
        return {"answer": "", "citations": [], "error": "unexpected response",
                "mode": resolved_mode, "model": model}

    raw_citations = data.get("citations") or []
    if not isinstance(raw_citations, list):
        raw_citations = []
    citations = [str(c) for c in raw_citations if c][:10]

    result = {
        "answer": answer,
        "citations": citations,
        "model": model,
        "mode": resolved_mode,
        "domain_pack": domain_pack,
        "recency": recency_filter,
        "elapsed_ms": elapsed_ms,
        "cached": False,
    }
    _SEARCH_CACHE.set(cache_key, dict(result), ttl)
    return result
