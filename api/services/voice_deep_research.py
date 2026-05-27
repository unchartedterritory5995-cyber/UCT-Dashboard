"""Deep research sub-agent — multi-source synthesis for voice Compass.

The biggest accuracy multiplier in the Phase 2 stack. Voice Compass
(gpt-realtime) is fast but not the smartest reasoning model. For
substantive "explain / research / what is / why" questions, voice calls
this tool, which:

  1. Fans out parallel data fetches to: lookup_trading_principle (KB),
     web_search (Perplexity), and — if a ticker is detected — quote +
     fundamentals + recent news + tweet sentiment for that ticker.
  2. Bundles every source into a single context blob.
  3. Hands the blob + question to Claude Sonnet 4.6 for synthesis.
  4. Returns a sharp, decisive, multi-source-cited answer that voice
     narrates verbatim.

The split is intentional: voice realtime for fast turn-taking, Claude
for the heavy thinking. Single tool call from the voice agent's
perspective.

Cost: ~$0.02-0.05 per call (Claude Sonnet 4.6 at $3/M input + $15/M
output). Latency: 5-9s total. Only triggered when voice Compass decides
the question warrants deep research.
"""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_CLAUDE_MODEL = os.environ.get("DEEP_RESEARCH_MODEL", "claude-sonnet-4-6")
_CLAUDE_TIMEOUT = 30
_FETCH_TIMEOUT = 12

_CACHE = TTLCache()
_CACHE_TTL = 1800  # 30 min — same question often comes up again

_SYNTHESIS_SYSTEM = (
    "You are the deep-research synthesis engine behind a senior swing-trade "
    "portfolio manager's voice assistant. You receive a question plus a "
    "bundle of pre-fetched sources (internal trading knowledge base, live "
    "web search results with citations, and — if relevant — live ticker "
    "data + recent news + trader social chatter). Your job: synthesize ONE "
    "sharp, decisive, cited answer in 3-5 sentences of plain prose suitable "
    "for being read aloud.\n\n"
    "Rules:\n"
    "- Plain prose. NO markdown, NO bullet points, NO headers — voice output.\n"
    "- Cite sources by name when material. Web research → say 'per Bloomberg' / "
    "'per Reuters' / 'per the Fed release' as appropriate. Internal KB → say "
    "'the playbook on this' or 'our knowledge base'. Ticker data → 'current "
    "quote' or 'latest filing'.\n"
    "- Decisive PM voice. NO hedging language ('it depends', 'might be', "
    "'could potentially'). If the data is mixed, say so directly and pick "
    "the strongest read.\n"
    "- Don't invent. Every numeric claim, every named entity, must come "
    "from the source bundle. If the bundle is silent, say 'sources are "
    "thin on this — I'd want more before sizing'.\n"
    "- 3-5 sentences. Earned brevity, not lazy brevity."
)


def _safe_call(fn, *args, timeout: float = _FETCH_TIMEOUT, **kwargs):
    """Run a fetch in a thread with timeout. Returns result or None."""
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(fn, *args, **kwargs)
            return fut.result(timeout=timeout)
    except (FutureTimeout, Exception) as e:
        _log.warning("deep_research sub-fetch failed: %s", e)
        return None


def _gather_sources(question: str, ticker: str = "") -> dict[str, Any]:
    """Parallel fan-out across all relevant data sources. Each sub-fetch is
    timeout-bounded so a single slow source can't block the whole bundle."""
    bundle: dict[str, Any] = {"question": question}

    # Always call: KB lookup + web search.
    # If ticker provided: also quote, fundamentals, news for that ticker.
    fetches = []

    def _kb():
        try:
            from api.services.voice_kb_service import lookup
            entries = lookup(question, k=3) or []
            return {"entries": entries} if entries else None
        except Exception as e:
            _log.warning("KB lookup failed: %s", e)
            return None

    def _web():
        try:
            from api.services.perplexity_search import web_search
            # Use reasoning mode + finance pack + day recency by default for
            # deep_research — the sub-agent question is always substantive
            # enough to warrant the extra ~5s of reasoning, and finance pack
            # kills SEO-spam citations.
            return web_search(
                question, max_tokens=600,
                mode="reasoning", recency="day", domain_pack="finance",
            )
        except Exception as e:
            _log.warning("web search failed: %s", e)
            return None

    def _quote(t):
        try:
            from api.services.massive import get_ticker_snapshot
            return get_ticker_snapshot(t)
        except Exception:
            return None

    def _fundamentals(t):
        try:
            from api.services.fundamentals import get_fundamentals
            return get_fundamentals(t)
        except Exception:
            return None

    def _news(t):
        try:
            from api.services.engine import get_news
            items = get_news(t) or []
            return items[:5]
        except Exception:
            return None

    def _tweets(t):
        try:
            from api.services import tweet_store
            return tweet_store.tweets_for_ticker(t, hours=24)[:5]
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {
            "kb": ex.submit(_kb),
            "web": ex.submit(_web),
        }
        if ticker:
            t_up = ticker.upper().strip()
            futures["quote"] = ex.submit(_quote, t_up)
            futures["fundamentals"] = ex.submit(_fundamentals, t_up)
            futures["news"] = ex.submit(_news, t_up)
            futures["tweets"] = ex.submit(_tweets, t_up)

        for key, fut in futures.items():
            try:
                bundle[key] = fut.result(timeout=_FETCH_TIMEOUT)
            except Exception as e:
                _log.warning("deep_research bundle.%s timed out/failed: %s", key, e)
                bundle[key] = None

    return bundle


def _format_bundle_for_claude(bundle: dict[str, Any]) -> str:
    """Render the source bundle as a tagged context block Claude can read."""
    parts = [f"=== QUESTION ===\n{bundle['question']}"]

    kb = bundle.get("kb")
    if kb and isinstance(kb, dict) and kb.get("entries"):
        kb_lines = []
        for e in kb["entries"][:3]:
            txt = (e.get("text") or e.get("content") or "").strip()
            if txt:
                kb_lines.append(f"- {txt[:400]}")
        if kb_lines:
            parts.append("=== INTERNAL KNOWLEDGE BASE ===\n" + "\n".join(kb_lines))

    web = bundle.get("web")
    if web and isinstance(web, dict) and web.get("answer"):
        section = "=== WEB RESEARCH (Perplexity Sonar Pro) ===\n" + web["answer"]
        cites = web.get("citations") or []
        if cites:
            section += "\nSources:\n" + "\n".join(f"  [{i+1}] {c}" for i, c in enumerate(cites[:6]))
        parts.append(section)

    quote = bundle.get("quote")
    if quote:
        parts.append(
            "=== LIVE QUOTE ===\n"
            + f"price=${quote.get('day', {}).get('c', quote.get('last'))} "
            + f"change={quote.get('todaysChangePerc')}% "
            + f"vol={quote.get('day', {}).get('v')}"
        )

    fund = bundle.get("fundamentals")
    if fund and isinstance(fund, dict) and not fund.get("error"):
        keys = ["name", "sector", "industry", "market_cap", "pe_trailing",
                "pe_forward", "ps", "profit_margin_pct", "revenue_growth_pct",
                "fifty_two_week_high", "fifty_two_week_low", "beta",
                "analyst_target_mean", "analyst_recommendation"]
        rows = [f"  {k}: {fund[k]}" for k in keys if fund.get(k) is not None]
        if rows:
            parts.append("=== FUNDAMENTALS ===\n" + "\n".join(rows))

    news = bundle.get("news")
    if news and isinstance(news, list) and news:
        nlines = []
        for n in news[:5]:
            h = (n.get("headline") or n.get("title") or "").strip()
            src = n.get("source") or ""
            if h:
                nlines.append(f"  - {h}" + (f" ({src})" if src else ""))
        if nlines:
            parts.append("=== RECENT NEWS ===\n" + "\n".join(nlines))

    tw = bundle.get("tweets")
    if tw and isinstance(tw, list) and tw:
        tlines = []
        for t_ in tw[:5]:
            txt = (t_.get("text") or "").replace("\n", " ").strip()[:200]
            handle = t_.get("author_handle") or "?"
            if txt:
                tlines.append(f"  @{handle}: {txt}")
        if tlines:
            parts.append("=== TRADER TWITTER CHATTER ===\n" + "\n".join(tlines))

    return "\n\n".join(parts)


def _call_claude(bundle_text: str) -> dict[str, Any]:
    """Synthesize the bundle into a single voice-friendly answer."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return {"error": "ANTHROPIC_API_KEY not configured"}

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key, timeout=_CLAUDE_TIMEOUT)
    except Exception as e:
        return {"error": f"anthropic sdk init failed: {e}"}

    try:
        t0 = time.time()
        resp = client.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=600,
            system=_SYNTHESIS_SYSTEM,
            messages=[{"role": "user", "content": bundle_text}],
        )
        elapsed_ms = int((time.time() - t0) * 1000)
    except Exception as e:
        _log.warning("Claude synthesis call failed: %s", e)
        return {"error": f"claude call failed: {e}"}

    try:
        # response.content is a list of content blocks (text blocks)
        answer = "".join(
            (b.text if hasattr(b, "text") else "")
            for b in (resp.content or [])
        ).strip()
    except Exception as e:
        return {"error": f"could not extract claude response: {e}"}

    if not answer:
        return {"error": "claude returned empty content"}

    return {
        "answer": answer,
        "model": _CLAUDE_MODEL,
        "elapsed_ms": elapsed_ms,
        "input_tokens": getattr(resp.usage, "input_tokens", None),
        "output_tokens": getattr(resp.usage, "output_tokens", None),
    }


def deep_research(question: str, ticker: str = "") -> dict[str, Any]:
    """Multi-source synthesized research answer.

    Returns {answer, sources, model, elapsed_ms, cached, error?}.
    Errors returned in-band so voice tools can degrade gracefully.
    """
    question = (question or "").strip()
    if not question:
        return {"error": "empty question"}

    cache_key = f"deep::{(ticker or '').upper()}::{question.lower()[:300]}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        return out

    t0 = time.time()
    bundle = _gather_sources(question, ticker=ticker)
    bundle_text = _format_bundle_for_claude(bundle)

    # Collect citation URLs from web result for the response
    citations: list[str] = []
    web = bundle.get("web") or {}
    if isinstance(web, dict):
        citations.extend(web.get("citations") or [])

    synth = _call_claude(bundle_text)
    if synth.get("error"):
        return {
            "error": synth["error"],
            "question": question,
            "ticker": ticker.upper() if ticker else None,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    result = {
        "answer": synth["answer"],
        "citations": citations[:6],
        "sources_consulted": [k for k, v in bundle.items() if v and k != "question"],
        "model": synth.get("model"),
        "elapsed_ms": int((time.time() - t0) * 1000),
        "synth_elapsed_ms": synth.get("elapsed_ms"),
        "ticker": ticker.upper() if ticker else None,
        "cached": False,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
