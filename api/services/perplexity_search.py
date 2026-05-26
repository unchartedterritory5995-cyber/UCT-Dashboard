"""Perplexity Sonar web search for voice Compass + future research tools.

Wraps Perplexity's /chat/completions API with the sonar-pro model. Returns
synthesized cited answers for "live web" questions the internal KB + market
APIs can't answer — street consensus, analyst takes, macro/policy news,
breaking developments beyond the cached headline feed.

Shares PERPLEXITY_API_KEY with the morning-wire pipeline (perplexity_research.py).
"""

import logging
import os
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.perplexity.ai/chat/completions"
_MODEL = "sonar-pro"
_TIMEOUT = 18  # voice latency budget

_DEFAULT_SYSTEM = (
    "You are a precise, decisive financial research assistant for a senior "
    "swing-trade portfolio manager. Reply in 2-4 sentences of plain prose — "
    "no markdown, no lists, no headers — your answer will be spoken aloud. "
    "Cite specific numbers, names, firms, and dates. If sources disagree, "
    "say so. Skip hedging; if the evidence is thin, say that plainly."
)

# 15-min TTL — voice often repeats variants of the same query. Cached
# instance lives at module scope so it survives across tool calls in one
# session but not across redeploys.
_SEARCH_CACHE = TTLCache()
_CACHE_TTL = 900


def web_search(query: str, max_tokens: int = 400, system: str | None = None) -> dict[str, Any]:
    """Synthesized web answer with citations.

    Returns ``{answer, citations, elapsed_ms, cached, error?}``.
    Errors are returned in-band (never raises) so voice tools can degrade
    gracefully.
    """
    query = (query or "").strip()
    if not query:
        return {"answer": "", "citations": [], "error": "empty query"}

    key = f"pplx::{(system or '')[:40]}::{max_tokens}::{query.lower()[:300]}"
    cached = _SEARCH_CACHE.get(key)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        return out

    api_key = os.environ.get("PERPLEXITY_API_KEY", "").strip()
    if not api_key:
        return {"answer": "", "citations": [], "error": "PERPLEXITY_API_KEY not set"}

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": system or _DEFAULT_SYSTEM},
            {"role": "user", "content": query},
        ],
        "max_tokens": max(50, min(2000, int(max_tokens or 400))),
    }
    try:
        t0 = time.time()
        r = requests.post(
            _BASE,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except requests.Timeout:
        return {"answer": "", "citations": [], "error": f"timeout after {_TIMEOUT}s"}
    except requests.RequestException as e:
        _log.warning("perplexity request failed: %s", e)
        return {"answer": "", "citations": [], "error": f"request failed: {e}"}

    try:
        answer = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        _log.warning("perplexity unexpected response shape: %s", e)
        return {"answer": "", "citations": [], "error": "unexpected response"}

    raw_citations = data.get("citations") or []
    if not isinstance(raw_citations, list):
        raw_citations = []
    citations = [str(c) for c in raw_citations if c][:8]

    result = {
        "answer": answer,
        "citations": citations,
        "elapsed_ms": elapsed_ms,
        "cached": False,
    }
    _SEARCH_CACHE.set(key, dict(result), _CACHE_TTL)
    return result
