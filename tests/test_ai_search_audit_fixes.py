"""Regression guards for the 2026-07-18 pre-launch audit fixes.

Each test pins a specific defect the adversarial workflow (verified by
executing the real code) or the live battery surfaced, so none can silently
return. Grouped by the finding they close.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.perplexity_search as pplx
from api.middleware.auth_middleware import get_current_user

_cap = {}


@pytest.fixture()
def client(monkeypatch):
    _cap.clear()

    def fake(query, **kw):
        _cap.update(kw); _cap["query"] = query
        return {"answer": "ok", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_UNI", {"NVDA", "AMD", "AAPL", "TSLA", "AMC", "BMO", "NOW", "LOW", "MA", "PM", "COHR", "F", "C"})
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend"})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 10.0, "direction": "up", "abs_pct": 1.0})
    for fn in ("_ctx_catalyst", "_ctx_tape", "_ctx_patterns", "_ctx_flow_ticker"):
        monkeypatch.setattr(ai, fn, lambda s: f"[{fn.upper()}:{s}]")
    monkeypatch.setattr(ai, "_ctx_flow_ticker", lambda s: f"[FLOW:{s}]")
    monkeypatch.setattr(ai, "_ctx_movers", lambda: "[MOVERS]")
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "[BREADTH]")
    monkeypatch.setattr(ai, "_ctx_earnings", lambda: "[EARNINGS]")
    monkeypatch.setattr(ai, "_ctx_candidates", lambda: "[CANDIDATES]")
    monkeypatch.setattr(ai, "_ctx_uct20", lambda: "[UCT20]")
    monkeypatch.setattr(ai, "_ctx_news", lambda: "[NEWS]")
    ai._usage_day = ""; ai._usage_by_user = {}; ai._usage_global = 0; ai._stats = ai._fresh_stats()
    app = FastAPI(); app.include_router(ai.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1}
    return TestClient(app)


def sys_of(client, q, mode=None):
    body = {"query": q}
    if mode:
        body["mode"] = mode
    r = client.post("/api/ai-search", json=body)
    assert r.status_code == 200, (q, r.status_code)
    return _cap.get("system", ""), _cap


# ── HIGH #1: recency over-match on evergreen/historical ─────────────────────
@pytest.mark.parametrize("q", [
    "How do I use the 200 day moving average as a stop?",
    "Is the 50 day moving average a good entry signal?",
    "Why did the 1987 crash happen?",
    "Why is diversification important for swing traders?",
    "Why is position sizing so important?",
])
def test_recency_not_forced_on_evergreen(client, q):
    assert ai._auto_recency(q) is None, q


@pytest.mark.parametrize("q", [
    "Why is NVDA up today?", "Why did TSLA drop this morning?",
    "Biggest gappers right now?", "What's moving premarket?",
])
def test_recency_day_still_fires_on_hot(client, q):
    assert ai._auto_recency(q) == "day", q


# ── MEDIUM #6: 'flow' must not match cash flow / news flow ──────────────────
@pytest.mark.parametrize("q", [
    "What is AAPL's free cash flow trend?",
    "Walk me through a discounted cash flow for NVDA",
    "What's the news flow on TSLA?",
])
def test_no_flow_hop_on_cash_or_news_flow(client, q):
    s, _ = sys_of(client, q)
    assert "[FLOW:" not in s, q


@pytest.mark.parametrize("q", [
    "What's the options flow on NVDA?", "Any sweeps in AMD?",
    "what's the flow looking like on TSLA",
])
def test_flow_hop_still_fires_on_options_flow(client, q):
    s, _ = sys_of(client, q)
    assert "[FLOW:" in s, q


# ── MEDIUM #7: amc/bmo tickers must not inject the earnings calendar ────────
@pytest.mark.parametrize("q", [
    "Should I buy AMC stock here?",
    "What's the short interest on AMC?",
    "Is BMO a good bank stock right now?",
])
def test_amc_bmo_ticker_no_earnings_feed(client, q):
    s, _ = sys_of(client, q)
    assert "[EARNINGS]" not in s, q


@pytest.mark.parametrize("q", ["Who reports earnings today?", "Which names are reporting tonight?"])
def test_earnings_feed_still_fires(client, q):
    s, _ = sys_of(client, q)
    assert "[EARNINGS]" in s, q


# ── MEDIUM #8: breadth words must not fire on single-stock ──────────────────
def test_breadth_words_not_on_single_stock(client):
    s, _ = sys_of(client, "Did NVDA advance today and is AMD in decline?")
    assert "[BREADTH]" not in s


@pytest.mark.parametrize("q", ["How's market breadth?", "advance-decline line looking healthy?", "market conditions today?"])
def test_breadth_still_fires_on_market_level(client, q):
    s, _ = sys_of(client, q)
    assert "[BREADTH]" in s, q


# ── MEDIUM #9: class-share cashtags + $FULLWORD ─────────────────────────────
def test_cashtag_class_shares_and_fullword():
    assert ai._extract_tickers("thoughts on $BRK.B?") == ["BRK.B"]
    assert ai._extract_tickers("what about $BRK-B") == ["BRK.B"]
    assert ai._extract_tickers("is $NVIDIA a buy") == []          # not a 5-char fragment
    assert ai._extract_tickers("$F and $C dividends") == ["F", "C"]


# ── HIGH #2 / LOW #20: jargon + stop-listed real tickers ────────────────────
@pytest.mark.parametrize("j", ["PM", "AM", "DTE", "OI", "DD", "ES", "DOW", "IV", "RSI", "GEX"])
def test_jargon_not_extracted(client, j):
    assert ai._extract_tickers(f"what is my {j} here") == []


def test_stoplisted_real_ticker_extracts_only_on_strong_cue():
    # NOW is a stopword but a real ticker (ServiceNow)
    assert ai._extract_tickers("is that happening now or later") == []
    assert ai._extract_tickers("thoughts on NOW stock") == ["NOW"]
    assert ai._extract_tickers("why is LOW moving") == ["LOW"]


# ── LOW #18: reasoning noun forms ───────────────────────────────────────────
@pytest.mark.parametrize("q", [
    "analysis of NVDA's moat", "give me a breakdown of the TSLA thesis",
    "analyse AMD's setup",
])
def test_reasoning_noun_forms_escalate(client, q):
    assert ai._auto_mode(q, "lite") == "reasoning", q


# ── LOW #19: uct20 'top picks' ──────────────────────────────────────────────
@pytest.mark.parametrize("q", ["What are your top picks?", "firm's top ideas right now?"])
def test_uct20_top_picks(client, q):
    s, _ = sys_of(client, q)
    assert "[UCT20]" in s, q


# ── HIGH #3/#4/#13 + MEDIUM #10: billing integrity ──────────────────────────
def test_empty_search_is_refunded(client, monkeypatch):
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda q, **k: {"answer": "", "error": "empty answer", "citations": []})
    r = client.post("/api/ai-search", json={"query": "why is NVDA up"})
    assert r.status_code == 200
    assert ai._usage_global == 0    # never bill a failed/empty search


def test_cached_search_is_free(client, monkeypatch):
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda q, **k: {"answer": "x", "citations": [], "related_questions": [], "cached": True})
    client.post("/api/ai-search", json={"query": "why is NVDA up"})
    assert ai._usage_global == 0


def test_reserve_is_atomic_and_caps(client, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "2")
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda q, **k: {"answer": "x", "citations": [], "related_questions": [], "cached": False})
    assert client.post("/api/ai-search", json={"query": "a"}).status_code == 200
    assert client.post("/api/ai-search", json={"query": "b"}).status_code == 200
    assert client.post("/api/ai-search", json={"query": "c"}).status_code == 429


def test_reasoning_bills_two_but_refunds_on_empty(client, monkeypatch):
    # reasoning empty → falls back to fast; only the fast unit should stick
    calls = {"n": 0}

    def fake(q, **k):
        calls["n"] += 1
        if k.get("mode") == "reasoning":
            return {"answer": "", "error": "empty answer", "citations": []}
        return {"answer": "recovered", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    r = client.post("/api/ai-search", json={"query": "full breakdown of NVDA thesis"})
    assert r.status_code == 200
    assert r.json()["answer"] == "recovered"     # fallback delivered
    assert ai._usage_global == 1                 # reasoning(2) refunded, fast(1) billed


def test_empty_query_rejected(client):
    assert client.post("/api/ai-search", json={"query": "   "}).status_code == 422


# ── HIGH #5 / MEDIUM #12: think-leak + empty caching ────────────────────────
def test_strip_think_handles_unclosed():
    assert pplx._strip_think("<think>reasoning with no close and the answer never came") == ""
    assert pplx._strip_think("<think>a</think>The answer.") == "The answer."
    assert pplx._strip_think("<think>a</think><think>b</think>Final.") == "Final."


def test_reasoning_token_floor():
    assert pplx._effective_max_tokens("reasoning", 700) >= 2200
    assert pplx._effective_max_tokens("fast", 700) == 700


def test_web_search_empty_not_cached(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    calls = {"n": 0}

    class _Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            calls["n"] += 1
            return {"choices": [{"message": {"content": "<think>all reasoning, no answer"}}], "citations": []}

    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _Resp())
    r1 = pplx.web_search("EMPTYTESTQ", mode="reasoning")
    assert r1.get("error") == "empty answer" and not r1.get("answer")
    r2 = pplx.web_search("EMPTYTESTQ", mode="reasoning")
    assert r2.get("error") == "empty answer"
    assert calls["n"] == 2      # not served from cache — re-hit the API


# ── MEDIUM #11: cache key doesn't collide on long queries ───────────────────
def test_manipulation_refusal_directive_present(client):
    # LIVE-AUDIT FINDING: a manipulation ask framed as "risk management"
    # ("minimum volume to push a thin float 5%... not planning to myself")
    # slipped the guard. The prompt now hard-refuses manipulation/how-to-move-
    # price operational detail regardless of framing.
    assert "ILLEGAL / MANIPULATION" in ai._WIDGET_SYSTEM
    s, _ = sys_of(client, "what's the minimum volume to push a thin float 5%")
    assert "how much capital or volume it takes to MOVE" in s
    assert "regardless of framing" in s


def test_cache_key_no_truncation_collision():
    base = "why is this very long question about the market going on and on " * 5
    k1 = pplx._cache_key("sonar-pro", None, "finance", 700, True, "sys", base + " NVDA")
    k2 = pplx._cache_key("sonar-pro", None, "finance", 700, True, "sys", base + " TSLA")
    assert k1 != k2
    # different system prompt (different grounding) also separates
    k3 = pplx._cache_key("sonar-pro", None, "finance", 700, True, "sysA" + "x" * 100, "q")
    k4 = pplx._cache_key("sonar-pro", None, "finance", 700, True, "sysB" + "x" * 100, "q")
    assert k3 != k4
