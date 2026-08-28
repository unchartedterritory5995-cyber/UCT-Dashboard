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


def _effective_max_tokens(resolved_mode: str, max_tokens: int) -> int:
    """Reasoning models spend a large token budget inside <think> before the
    answer; a small cap (e.g. 700) gets fully consumed by reasoning and leaves
    an EMPTY answer after the think block is stripped. Floor reasoning at 2200
    so the real answer always survives."""
    base = max(50, min(3000, int(max_tokens or 400)))
    if resolved_mode == "reasoning":
        return max(base, 2200)
    return base


def _shadow_key(model: str, domain_pack: str, query: str) -> str:
    """Last-known-good key — deliberately COARSER than the answer cache key.

    The real cache key salts on the desk state (regime/tickers/ET-day/5-min
    freshness buckets) so answers refresh; that same salting makes it useless
    during a provider outage — yesterday's answer to the same question lives
    under a salt nothing will ever ask for again. The shadow keys on ONLY
    (model, domain pack, normalized query) so an outage can serve the most
    recent finished answer to the same question, clearly flagged stale.
    """
    import hashlib
    digest = hashlib.md5(query.lower().strip().encode("utf-8", "ignore")).hexdigest()
    return f"pplx-last::{model}::{domain_pack}::{digest}"


_SHADOW_TTL = 86400   # 24h — an outage answer a day old is still labeled, not lied


def _save_shadow(model: str, domain_pack: str, query: str, result: dict) -> None:
    try:
        _SEARCH_CACHE.set(_shadow_key(model, domain_pack, query), dict(result), _SHADOW_TTL)
    except Exception:
        pass


def _serve_shadow(model: str, domain_pack: str, query: str) -> dict | None:
    """A finished prior answer for this question, or None. Flagged stale=True
    and cached=True (the caller's refund logic treats it as free — it is)."""
    try:
        hit = _SEARCH_CACHE.get(_shadow_key(model, domain_pack, query))
    except Exception:
        return None
    if not hit or not hit.get("answer"):
        return None
    out = dict(hit)
    out["cached"] = True
    out["stale"] = True
    return out


def _notify_auth_failure(status: int) -> None:
    """A 401/403 from Perplexity means the SHARED key is dead for the whole
    product (this surface + morning-wire + catalyst enrichment). Page the admin
    channel — members only ever see a masked error. Best-effort; hourly memo on
    top of chart_health_alerts' own throttle/cooldown."""
    if status not in (401, 403):
        return
    try:
        import time as _t
        global _LAST_AUTH_ALERT
        if _t.time() - _LAST_AUTH_ALERT < 3600:
            return
        _LAST_AUTH_ALERT = _t.time()
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            "perplexity_auth_failure",
            "critical",   # critical = pages Discord (chart_health_alerts contract)
            f"Perplexity API returned {status} — the shared PERPLEXITY_API_KEY is "
            "being rejected (out of credits or revoked). AI Search is running "
            "degraded and morning-wire enrichment will fail until it is fixed.",
            {"status": status, "surface": "perplexity_search"},
        )
    except Exception:
        pass


_LAST_AUTH_ALERT = 0.0

# ── Cost telemetry. Perplexity had ZERO dollar accounting anywhere (measured
# 2026-08-27) while every Anthropic surface ledgers per-call. Prices are
# telemetry-grade estimates (list prices, env-overridable), recorded into the
# shared llm_route_cost_log via narrative_cost_guard so /admin surfaces can sum
# spend per surface. Never blocks, never raises.
_PPLX_PRICES = {   # $/1M tokens (input, output)
    "sonar":               (1.0, 1.0),
    "sonar-pro":           (3.0, 15.0),
    "sonar-reasoning-pro": (2.0, 8.0),
    "sonar-deep-research": (2.0, 8.0),
}


def _record_cost(model: str, usage: dict | None, surface: str) -> None:
    try:
        u = usage or {}
        tin = int(u.get("prompt_tokens") or 0)
        tout = int(u.get("completion_tokens") or 0)
        p_in, p_out = _PPLX_PRICES.get(model, (3.0, 15.0))
        fee = float(os.environ.get("PPLX_REQUEST_FEE_USD", "0.006"))
        cost = tin / 1e6 * p_in + tout / 1e6 * p_out + fee
        from api.services import narrative_cost_guard
        narrative_cost_guard.record(
            f"pplx:{surface}", model,
            input_tokens=tin, output_tokens=tout, cost_usd=round(cost, 6))
    except Exception:
        pass

# Retry budget for transient upstream failures (429 / 5xx) on the blocking
# path: ONE retry after a short pause. Bounded so the request path can never
# stack timeouts; auth errors (4xx other than 429) never retry.
_RETRY_STATUSES = {429, 500, 502, 503, 504}
_RETRY_PAUSE_S = 0.6


def _mask_http_error(e: "requests.RequestException") -> tuple[str, int | None]:
    """Member-safe error string + the status code. str(HTTPError) embeds the
    full provider URL ('401 Client Error: Unauthorized for url: https://…'),
    which must never reach a member's screen — the stream path already masks
    to 'request failed (401)'; this makes the blocking path match it."""
    status = getattr(getattr(e, "response", None), "status_code", None)
    return (f"request failed ({status})" if status else "request failed (network)", status)


def _cache_key(model, recency_filter, domain_pack, max_tokens, related, system, query, salt="") -> str:
    # Shared by web_search AND stream_search so a streamed answer warms the
    # cache for later single-shot calls (and vice versa). The system prompt +
    # query are HASHED IN FULL (not truncated) — truncating query[:300]/
    # system[:40] let two different long questions (or two different
    # desk-grounding blocks) collide on one cache entry and serve the wrong
    # answer.
    import hashlib
    digest = hashlib.md5(
        f"{system or ''}\x00{query.lower()}".encode("utf-8", "ignore")
    ).hexdigest()
    return (
        f"pplx::{model}::{recency_filter or 'any'}::{domain_pack}::"
        f"{max_tokens}::{int(related)}::{salt}::{digest}"
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
    cost_surface: str = "perplexity",
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
        "max_tokens": _effective_max_tokens(resolved_mode, max_tokens),
    }
    if domains:
        payload["search_domain_filter"] = domains[:20]
    if recency_filter:
        payload["search_recency_filter"] = recency_filter
    if related:
        payload["return_related_questions"] = True

    t0 = time.time()
    data = None
    for attempt in (0, 1):
        try:
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
            break
        except requests.Timeout:
            stale = _serve_shadow(model, domain_pack, query)
            if stale is not None:
                return stale
            return {"answer": "", "citations": [], "error": f"timeout after {timeout}s",
                    "mode": resolved_mode, "model": model}
        except requests.RequestException as e:
            # Full detail stays server-side; members get a status-only string.
            _log.warning("perplexity request failed: %s", e)
            msg, status = _mask_http_error(e)
            if status in _RETRY_STATUSES and attempt == 0:
                time.sleep(_RETRY_PAUSE_S)
                continue
            _notify_auth_failure(status or 0)
            stale = _serve_shadow(model, domain_pack, query)
            if stale is not None:
                return stale
            return {"answer": "", "citations": [], "error": msg,
                    "mode": resolved_mode, "model": model}
    elapsed_ms = int((time.time() - t0) * 1000)

    try:
        # sonar-reasoning models prefix a <think> block — never user-facing.
        answer = _strip_think(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as e:
        _log.warning("perplexity unexpected response shape: %s", e)
        return {"answer": "", "citations": [], "error": "unexpected response",
                "mode": resolved_mode, "model": model}

    # An empty answer (all-<think> that consumed the budget, or a blank
    # completion) must NOT be cached for the full TTL — return an error so the
    # caller can fall back, and don't poison the cache with 30 min of blank.
    if not answer:
        return {"answer": "", "citations": [], "error": "empty answer",
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
    _save_shadow(model, domain_pack, query, result)
    _record_cost(model, data.get("usage"), cost_surface)
    return result


# Match a think block whether or not it is closed — an UNTERMINATED <think>
# (model ran out of tokens mid-reasoning) must still be stripped, never leaked.
_THINK_RE = __import__("re").compile(r"<think>[\s\S]*?(?:</think>\s*|\Z)")


def _strip_think(text: str) -> str:
    """sonar-reasoning models prefix answers with a <think>…</think> block —
    internal monologue that must never reach users. Also strips an unclosed
    block (reasoning that consumed the whole token budget)."""
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
    cost_surface: str = "perplexity",
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
        "max_tokens": _effective_max_tokens(resolved_mode, max_tokens),
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
    usage: dict | None = None
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
                    _notify_auth_failure(r.status_code)
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
                    # citations / related_questions / usage ride on chunks (usually the last)
                    if isinstance(obj.get("usage"), dict):
                        usage = obj["usage"]
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
    _save_shadow(model, domain_pack, query, result)
    _record_cost(model, usage, cost_surface)
    yield {"type": "final", **result}
