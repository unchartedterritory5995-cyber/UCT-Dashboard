"""Grounding coverage for the 2026-07-18 gap-closing pass: per-ticker
fundamentals / analyst / insider (cached internal reads, intent-gated)."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import get_current_user

_cap = {}


@pytest.fixture()
def client(monkeypatch):
    _cap.clear()

    def fake(query, **kw):
        _cap.update(kw); _cap["query"] = query
        return {"answer": "ok", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_UNI", {"NVDA", "AMD", "AVGO", "LLY", "XOM", "AAPL"})
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend"})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 100.0, "direction": "up", "abs_pct": 1.0})
    for fn in ("_ctx_catalyst", "_ctx_tape", "_ctx_patterns", "_ctx_flow_ticker"):
        monkeypatch.setattr(ai, fn, lambda s: "")
    monkeypatch.setattr(ai, "_ctx_fundamentals", lambda s: f"[FUND:{s}]")
    monkeypatch.setattr(ai, "_ctx_analyst", lambda s: f"[ANALYST:{s}]")
    monkeypatch.setattr(ai, "_ctx_insider", lambda s: f"[INSIDER:{s}]")
    ai._usage_day = ""; ai._usage_by_user = {}; ai._usage_global = 0; ai._stats = ai._fresh_stats()
    app = FastAPI(); app.include_router(ai.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1}
    return TestClient(app)


def sysof(client, q):
    r = client.post("/api/ai-search", json={"query": q})
    assert r.status_code == 200
    return _cap.get("system", "")


# ── fundamentals fires on valuation / market-cap / dividend / next-earnings ──
@pytest.mark.parametrize("q", [
    "What's NVDA's forward P/E and market cap?",
    "Is AMD cheap on valuation here?",
    "What's XOM's dividend yield?",
    "Who's bigger by market cap, AVGO or NVDA?",
    "When does NVDA report next?",
    "What's AMD's revenue growth and net margin?",
    "Walk me through AAPL's free cash flow",
])
def test_fundamentals_fires(client, q):
    assert "[FUND:" in sysof(client, q), q


# ── analyst fires on rating / price-target / upgrade phrasing ────────────────
@pytest.mark.parametrize("q", [
    "What's the analyst consensus on NVDA?",
    "Any price target changes on AMD?",
    "Who upgraded LLY recently?",
    "What's Wall Street's rating on AVGO?",
])
def test_analyst_fires(client, q):
    assert "[ANALYST:" in sysof(client, q), q


# ── insider fires on insider / exec-buying phrasing ─────────────────────────
@pytest.mark.parametrize("q", [
    "Any insider buying in NVDA?",
    "Has the LLY CEO been buying stock?",
    "Recent insider selling on AMD?",
    "Any form 4 activity on XOM?",
])
def test_insider_fires(client, q):
    assert "[INSIDER:" in sysof(client, q), q


# ── plain price/flow/setup questions must NOT pay for these reads ───────────
@pytest.mark.parametrize("q", [
    "What is NVDA trading at right now?",
    "Why is AMD moving today?",
    "Is there a setup on NVDA?",
    "What's the options flow on AMD?",
])
def test_no_grounding_on_plain_questions(client, q):
    s = sysof(client, q)
    assert "[FUND:" not in s and "[ANALYST:" not in s and "[INSIDER:" not in s, q


# ── intent isolation: a dividend question doesn't pull analyst/insider ──────
def test_intent_isolation(client):
    s = sysof(client, "What's XOM's dividend yield?")
    assert "[FUND:" in s and "[ANALYST:" not in s and "[INSIDER:" not in s


def test_analyst_question_isolation(client):
    s = sysof(client, "Any analyst upgrades on NVDA?")
    assert "[ANALYST:" in s and "[INSIDER:" not in s


# ── regex-collision guards (audit lesson) ───────────────────────────────────
def test_fundamentals_regexes_dont_false_fire(client):
    # 'rating' the movie, 'insider' info tip already handled by manipulation guard
    s = sysof(client, "What's moving right now?")
    assert "[FUND:" not in s and "[ANALYST:" not in s


def test_real_functions_smoke(monkeypatch):
    # the real _ctx_* return "" gracefully when the service yields nothing
    monkeypatch.setattr("api.services.fundamentals.get_fundamentals", lambda s: {"error": "x"})
    assert ai._ctx_fundamentals("NVDA") == ""
    monkeypatch.setattr("api.services.analyst_intel.get_analyst_intel", lambda s: {"consensus": None, "price_target": None, "recent_actions": []})
    assert ai._ctx_analyst("NVDA") == ""
    monkeypatch.setattr("api.services.insider.get_insider_activity", lambda s: [])
    assert ai._ctx_insider("NVDA") == ""
