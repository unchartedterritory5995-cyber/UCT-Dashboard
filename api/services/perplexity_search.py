"""Perplexity Sonar web search for voice Compass + future research tools.

Wraps Perplexity's /chat/completions API with full tiered-model support:
  - sonar-pro             — fast web search + light synthesis (~2-3s)
  - sonar-reasoning-pro   — explicit reasoning step before answer (~5-10s)
  - sonar-deep-research   — exhaustive multi-source research (~minutes)

Plus finance domain pack + recency filter support, both of which Perplexity
exposes and which dramatically improve answer quality for market questions.

Shares PERPLEXITY_API_KEY with the morning-wire pipeline.
"""

import json
import logging
import os
import time
from typing import Any, AsyncIterator

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.perplexity.ai/chat/completions"

# Three tiers Perplexity exposes. Voice routes based on question depth.
_MODELS = {
    "lite":      "sonar",             # cheapest — base web search, no pro synthesis
    "fast":      "sonar-pro",
    "reasoning": "sonar-reasoning-pro",
    "deep":      "sonar-deep-research",
}

# Per-tier timeouts. Deep research can run for minutes.
_TIMEOUTS = {
    "lite":      15,
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
    "lite":      900,    # 15 min
    "fast":      900,    # 15 min
    "reasoning": 1800,   # 30 min
    "deep":      3600,   # 1 hour
}


def _resolve_mode(mode: str) -> str:
    m = (mode or "fast").lower().strip()
    return m if m in _MODELS else "fast"


def _cache_key(model, recency_filter, domain_pack, max_tokens, related, system, query, salt="") -> str:
    # Shared by web_search AND stream_search so a streamed answer warms the
    # cache for later single-shot calls (and vice versa).
    return (
        f"pplx::{model}::{recency_filter or 'any'}::{domain_pack}::"
        f"{max_tokens}::{int(related)}::{(system or '')[:40]}::{salt}::{query.lower()[:300]}"
    )


def _build_messages(system_prompt: str, query: str, history: list | None = None) -> list[dict]:
    """Chat-completions message list: system, then prior Q/A turns (so
    follow-ups can resolve "it"/"that move"), then the new question."""
    msgs = [{"role": "system", "content": system_prompt}]
    for h in (history or []):
        q = (h.get("q") or "").strip() if isinstance(h, dict) else ""
        a = (h.get("a") or "").strip() if isinstance(h, dict) else ""
        if q and a:
            msgs.append({"role": "user", "content": q})
            msgs.append({"role": "assistant", "content": a})
    msgs.append({"role": "user", "content": query})
    return msgs


def web_search(
    query: str,
    max_tokens: int = 400,
    system: str | None = None,
    mode: str = "fast",
    recency: str | None = None,
    domain_pack: str = "general",
    domains: list[str] | None = None,
    related: bool = False,
    cache_salt: str = "",
    history: list | None = None,
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
    cache_key = _cache_key(model, recency_filter, domain_pack, max_tokens, related, system, query, cache_salt)
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
        "messages": _build_messages(system or default_system, query, history),
        "max_tokens": max(50, min(3000, int(max_tokens or 400))),
    }
    if domains:
        payload["search_domain_filter"] = domains[:20]
    if recency_filter:
        payload["search_recency_filter"] = recency_filter
    if related:
        payload["return_related_questions"] = True

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
        # sonar-reasoning models prefix a <think> block — never user-facing.
        answer = _strip_think(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as e:
        _log.warning("perplexity unexpected response shape: %s", e)
        return {"answer": "", "citations": [], "error": "unexpected response",
                "mode": resolved_mode, "model": model}

    raw_citations = data.get("citations") or []
    if not isinstance(raw_citations, list):
        raw_citations = []
    citations = [str(c) for c in raw_citations if c][:10]

    raw_related = data.get("related_questions") or []
    related_questions = [str(q).strip() for q in raw_related if q and str(q).strip()][:4] if isinstance(raw_related, list) else []

    result = {
        "answer": answer,
        "citations": citations,
        "related_questions": related_questions,
        "model": model,
        "mode": resolved_mode,
        "domain_pack": domain_pack,
        "recency": recency_filter,
        "elapsed_ms": elapsed_ms,
        "cached": False,
    }
    _SEARCH_CACHE.set(cache_key, dict(result), ttl)
    return result


_THINK_RE = __import__("re").compile(r"<think>[\s\S]*?</think>\s*")


def _strip_think(text: str) -> str:
    """sonar-reasoning models prefix answers with a <think>…</think> block —
    internal monologue that must never reach users."""
    return _THINK_RE.sub("", text or "").strip()


class _ThinkFilter:
    """Streaming twin of _strip_think: feed() raw deltas, get back only text
    that is confirmed OUTSIDE think blocks (holds a small tail so tags split
    across chunk boundaries can't leak). flush() releases the held tail."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self._buf = ""
        self._in_think = False

    def feed(self, text: str) -> str:
        self._buf += text
        out: list[str] = []
        while True:
            if self._in_think:
                i = self._buf.find(self.CLOSE)
                if i < 0:
                    # discard confirmed think content, keep a possible partial closer
                    self._buf = self._buf[-(len(self.CLOSE) - 1):]
                    return "".join(out)
                self._buf = self._buf[i + len(self.CLOSE):].lstrip("\n")
                self._in_think = False
            else:
                i = self._buf.find(self.OPEN)
                if i < 0:
                    safe = len(self._buf) - (len(self.OPEN) - 1)
                    if safe > 0:
                        out.append(self._buf[:safe])
                        self._buf = self._buf[safe:]
                    return "".join(out)
                out.append(self._buf[:i])
                self._buf = self._buf[i + len(self.OPEN):]
                self._in_think = True

    def flush(self) -> str:
        out = "" if self._in_think else self._buf
        self._buf = ""
        return out


async def stream_search(
    query: str,
    max_tokens: int = 400,
    system: str | None = None,
    mode: str = "fast",
    domains: list[str] | None = None,
    domain_pack: str = "finance",
    recency: str | None = None,
    related: bool = False,
    cache_salt: str = "",
    history: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Streaming twin of web_search().

    Async generator yielding ``{"type": "delta", "text": str}`` as tokens
    arrive, then one ``{"type": "final", **result}`` where result is shaped
    exactly like web_search()'s return. A cache hit yields just the final
    event. Failures yield ``{"type": "error", "error": str}`` and stop —
    callers fall back to web_search().

    Fully async (httpx) — never pins an anyio threadpool worker while the
    answer streams, so it is safe on the single shared event loop.
    """
    resolved_mode = _resolve_mode(mode)
    model = _MODELS[resolved_mode]
    timeout = _TIMEOUTS[resolved_mode]
    ttl = _CACHE_TTL[resolved_mode]

    if domains is None and domain_pack == "finance":
        domains = _FINANCE_DOMAINS
    recency_filter = recency if recency in _RECENCY_VALUES else None

    cache_key = _cache_key(model, recency_filter, domain_pack, max_tokens, related, system, query, cache_salt)
    cached = _SEARCH_CACHE.get(cache_key)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        yield {"type": "final", **out}
        return

    api_key = os.environ.get("PERPLEXITY_API_KEY", "").strip()
    if not api_key:
        yield {"type": "error", "error": "PERPLEXITY_API_KEY not set"}
        return

    default_system = _DEEP_RESEARCH_SYSTEM if resolved_mode == "deep" else _DEFAULT_SYSTEM
    payload: dict[str, Any] = {
        "model": model,
        "messages": _build_messages(system or default_system, query, history),
        "max_tokens": max(50, min(3000, int(max_tokens or 400))),
        "stream": True,
    }
    if domains:
        payload["search_domain_filter"] = domains[:20]
    if recency_filter:
        payload["search_recency_filter"] = recency_filter
    if related:
        payload["return_related_questions"] = True

    answer_parts: list[str] = []
    citations: list[str] = []
    related_questions: list[str] = []
    think = _ThinkFilter()
    t0 = time.time()
    try:
        import httpx

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                _BASE,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as r:
                if r.status_code != 200:
                    _log.warning("perplexity stream HTTP %s", r.status_code)
                    yield {"type": "error", "error": f"request failed ({r.status_code})"}
                    return
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except ValueError:
                        continue
                    # citations / related_questions ride on chunks (usually the last)
                    if isinstance(obj.get("citations"), list):
                        citations = [str(c) for c in obj["citations"] if c][:10]
                    rq = obj.get("related_questions")
                    if isinstance(rq, list):
                        related_questions = [str(q).strip() for q in rq if q and str(q).strip()][:4]
                    try:
                        delta = obj["choices"][0]["delta"].get("content") or ""
                    except (KeyError, IndexError, TypeError, AttributeError):
                        delta = ""
                    if delta:
                        answer_parts.append(delta)
                        visible = think.feed(delta)
                        if visible:
                            yield {"type": "delta", "text": visible}
    except Exception as e:  # timeout / network / protocol — caller falls back
        _log.warning("perplexity stream failed: %s", e)
        yield {"type": "error", "error": "stream failed"}
        return

    tail = think.flush()
    if tail:
        yield {"type": "delta", "text": tail}
    answer = _strip_think("".join(answer_parts))
    if not answer:
        yield {"type": "error", "error": "no answer"}
        return

    result = {
        "answer": answer,
        "citations": citations,
        "related_questions": related_questions,
        "model": model,
        "mode": resolved_mode,
        "domain_pack": domain_pack,
        "recency": recency_filter,
        "elapsed_ms": int((time.time() - t0) * 1000),
        "cached": False,
    }
    _SEARCH_CACHE.set(cache_key, dict(result), ttl)
    yield {"type": "final", **result}
