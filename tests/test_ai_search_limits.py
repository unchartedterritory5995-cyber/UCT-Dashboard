from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import get_current_user


def _client(user_id=1, role="user"):
    app = FastAPI()
    app.include_router(ai.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id, "role": role}
    return TestClient(app)


def _reset_counters():
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._stats = ai._fresh_stats()


def _fake_search(cached=False):
    def fake(query, **kw):
        return {"answer": f"echo: {query}", "citations": [], "related_questions": [], "cached": cached}
    return fake


def test_requires_auth():
    app = FastAPI()
    app.include_router(ai.router)
    r = TestClient(app).post("/api/ai-search", json={"query": "hi"})
    assert r.status_code in (401, 403)


def test_happy_path_bills_quota(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    r = _client().post("/api/ai-search", json={"query": "why is SMCI moving"})
    assert r.status_code == 200 and r.json()["answer"].startswith("echo:")
    assert ai._usage_global == 1


def test_per_user_daily_cap_429(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "3")
    c = _client()
    for i in range(3):
        assert c.post("/api/ai-search", json={"query": f"q{i}"}).status_code == 200
    r = c.post("/api/ai-search", json={"query": "one too many"})
    assert r.status_code == 429
    assert "limit" in r.json()["detail"].lower()


def test_cap_is_per_user(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "1")
    assert _client(user_id=1).post("/api/ai-search", json={"query": "a"}).status_code == 200
    # user 1 is capped, user 2 is not
    assert _client(user_id=1).post("/api/ai-search", json={"query": "b"}).status_code == 429
    assert _client(user_id=2).post("/api/ai-search", json={"query": "c"}).status_code == 200


def test_cached_answers_do_not_count(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search(cached=True))
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "1")
    c = _client()
    for i in range(5):
        assert c.post("/api/ai-search", json={"query": "same q"}).status_code == 200
    assert ai._usage_global == 0


def _fake_stream(events):
    async def fake(query, **kw):
        for ev in events:
            yield ev
    return fake


def _read_sse(resp):
    out = []
    for block in resp.text.split("\n\n"):
        block = block.strip()
        if block.startswith("data:"):
            import json
            out.append(json.loads(block[5:]))
    return out


def test_stream_emits_deltas_then_final_and_bills_once(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "stream_search", _fake_stream([
        {"type": "delta", "text": "Hel"},
        {"type": "delta", "text": "lo"},
        {"type": "final", "answer": "Hello", "citations": [], "related_questions": [], "cached": False},
    ]))
    r = _client().post("/api/ai-search/stream", json={"query": "hi"})
    assert r.status_code == 200
    events = _read_sse(r)
    assert [e["type"] for e in events] == ["delta", "delta", "final"]
    assert events[-1]["answer"] == "Hello"
    assert ai._usage_global == 1


def test_stream_cached_final_is_free(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "stream_search", _fake_stream([
        {"type": "final", "answer": "Hello", "citations": [], "related_questions": [], "cached": True},
    ]))
    r = _client().post("/api/ai-search/stream", json={"query": "hi"})
    assert r.status_code == 200
    assert ai._usage_global == 0


def test_stream_respects_daily_cap(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "stream_search", _fake_stream([
        {"type": "final", "answer": "x", "citations": [], "related_questions": [], "cached": False},
    ]))
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "1")
    c = _client()
    assert c.post("/api/ai-search/stream", json={"query": "a"}).status_code == 200
    assert c.post("/api/ai-search/stream", json={"query": "b"}).status_code == 429


def test_auto_mode_escalation():
    # explicit client mode is respected
    assert ai._auto_mode("anything", "reasoning") == "reasoning"
    assert ai._auto_mode("anything", "fast") == "fast"
    # deep-analysis phrasing → reasoning
    assert ai._auto_mode("Give me the bull case and bear case for NVDA", "lite") == "reasoning"
    assert ai._auto_mode("analyze COHR's valuation", "lite") == "reasoning"
    # comparison / list / outlook phrasing → fast
    assert ai._auto_mode("compare AMD versus NVDA", "lite") == "fast"
    assert ai._auto_mode("who are COHR's closest competitors", "lite") == "fast"
    # long questions → fast
    long_q = " ".join(["word"] * 20)
    assert ai._auto_mode(long_q, "lite") == "fast"
    # default tier is sonar-pro ("fast") — owner call 2026-07-18
    assert ai._auto_mode("why is SMCI moving today", "lite") == "fast"


def test_reasoning_bills_two_units(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    r = _client().post("/api/ai-search", json={"query": "full breakdown of NVDA's thesis"})
    assert r.status_code == 200
    assert captured["mode"] == "reasoning"
    assert ai._usage_global == 2


def test_grounding_injects_desk_context(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend", "confidence": 0.8})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 743.2, "direction": "up", "abs_pct": 1.4})
    monkeypatch.setattr(ai, "_ctx_catalyst", lambda s: f"{s} catalyst (UCT board, today): AI capex ramp.")
    monkeypatch.setattr(ai, "_UNI", {"NVDA", "SMCI"})
    r = _client().post("/api/ai-search", json={"query": "what do you think of NVDA here"})
    assert r.status_code == 200
    assert "UCT DESK CONTEXT" in captured["system"]
    assert "bull_trend" in captured["system"]
    assert "NVDA: last $743.2" in captured["system"]
    assert "AI capex ramp" in captured["system"]
    # salt = regime | syms | ET day
    bits = captured["cache_salt"].split("|")
    assert bits[0] == "bull_trend" and bits[1] == "NVDA" and len(bits[-1]) == 10


def test_grounding_absent_without_signal(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_regime_provider", lambda: {})
    monkeypatch.setattr(ai, "_UNI", set())
    r = _client().post("/api/ai-search", json={"query": "what happened in the market"})
    assert r.status_code == 200
    assert "UCT DESK CONTEXT" not in captured["system"]
    assert captured["cache_salt"] == ""


def test_intent_routed_desk_feeds(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend"})
    monkeypatch.setattr(ai, "_UNI", set())
    monkeypatch.setattr(ai, "_ctx_movers", lambda: "Movers (UCT live feed): up — TSLA +5.0%; down — none")
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "Breadth (UCT): score 71")
    c = _client()
    # movers phrasing pulls the movers feed but NOT breadth
    c.post("/api/ai-search", json={"query": "what's moving right now"})
    assert "Movers (UCT live feed)" in captured["system"]
    assert "Breadth (UCT)" not in captured["system"]
    # breadth phrasing pulls breadth
    c.post("/api/ai-search", json={"query": "how are market internals and breadth"})
    assert "Breadth (UCT): score 71" in captured["system"]
    # plain fundamental question pulls neither
    c.post("/api/ai-search", json={"query": "what was the last quarterly report like"})
    assert "Movers (UCT live feed)" not in captured["system"]
    assert "Breadth (UCT)" not in captured["system"]


def test_tape_injected_for_named_tickers(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend"})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 10.0, "direction": "up", "abs_pct": 1.0})
    monkeypatch.setattr(ai, "_ctx_catalyst", lambda s: "")
    monkeypatch.setattr(ai, "_ctx_tape", lambda s: f"{s} tape (UCT curated wires, last 8h): guidance raised")
    monkeypatch.setattr(ai, "_UNI", {"SMCI"})
    r = _client().post("/api/ai-search", json={"query": "anything new on SMCI"})
    assert r.status_code == 200
    assert "SMCI tape (UCT curated wires" in captured["system"]


def test_fresh_salt_buckets_hot_queries(monkeypatch):
    monkeypatch.setattr(ai, "_time_bucket", lambda: "b101")
    # day-recency query gets the bucket appended (with or without base salt)
    assert ai._fresh_salt("why is SMCI moving today", "GREEN|SMCI|2026-07-18") == "GREEN|SMCI|2026-07-18|b101"
    assert ai._fresh_salt("biggest premarket movers", "") == "b101"
    # fundamentals stay unbucketed → long-lived cache
    assert ai._fresh_salt("what was JPM's last earnings report like", "GREEN|JPM|2026-07-18") == "GREEN|JPM|2026-07-18"


def test_scope_guard_present_in_widget_prompt():
    assert "SCOPE — HARD RULE" in ai._WIDGET_SYSTEM
    assert "exclusively for markets" in ai._WIDGET_SYSTEM


def test_ticker_extraction_filters_noise(monkeypatch):
    monkeypatch.setattr(ai, "_UNI", {"NVDA", "COHR", "ALL"})
    # bare uppercase must be in universe and not a stopword; cashtags always pass
    assert ai._extract_tickers("what do you think of NVDA and $smci") == ["NVDA", "SMCI"]
    assert ai._extract_tickers("IS ALL OF THE MARKET UP") == []   # ALL is stopworded
    assert ai._extract_tickers("why did COHR beat") == ["COHR"]


def test_auto_recency_heuristic():
    assert ai._auto_recency("Why is SMCI moving today?") == "day"
    assert ai._auto_recency("biggest premarket movers") == "day"
    assert ai._auto_recency("recent analyst upgrades on NVDA") == "week"
    assert ai._auto_recency("What was JPM's last earnings report like?") is None
    assert ai._auto_recency("Who are COHR's closest competitors by business line?") is None


def test_admin_stats_requires_admin(monkeypatch):
    _reset_counters()
    r = _client(role="user").get("/api/ai-search/admin/stats")
    assert r.status_code == 403


def test_admin_stats_reports_usage(monkeypatch):
    _reset_counters()
    calls = {"n": 0}

    def fake(query, **kw):
        calls["n"] += 1
        # second call pretends to be a cache hit
        return {"answer": "x", "citations": [], "related_questions": [],
                "cached": calls["n"] == 2}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    c = _client(user_id=7)
    assert c.post("/api/ai-search", json={"query": "why is SMCI moving today"}).status_code == 200
    assert c.post("/api/ai-search", json={"query": "why is SMCI moving today"}).status_code == 200
    assert c.post("/api/ai-search", json={"query": "full breakdown of NVDA's thesis"}).status_code == 200

    r = _client(role="admin").get("/api/ai-search/admin/stats")
    assert r.status_code == 200
    d = r.json()
    assert d["requests"] == 3
    assert d["cache_hits"] == 1
    assert d["cache_hit_rate"] == round(1 / 3, 3)
    # sonar-pro default (2 fast requests) + one reasoning escalation
    assert d["by_mode"] == {"fast": 2, "reasoning": 1}
    # billed: 1 fast (other was cached) + reasoning at 2 units = 3
    assert d["billed_units"] == 3
    assert d["top_users"] == [{"user_id": 7, "units": 3}]
    assert d["single_shot_requests"] == 3 and d["stream_requests"] == 0


def test_global_budget_429(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    monkeypatch.setenv("AI_SEARCH_GLOBAL_DAILY_LIMIT", "2")
    assert _client(user_id=10).post("/api/ai-search", json={"query": "a"}).status_code == 200
    assert _client(user_id=11).post("/api/ai-search", json={"query": "b"}).status_code == 200
    r = _client(user_id=12).post("/api/ai-search", json={"query": "c"})
    assert r.status_code == 429
    assert "tomorrow" in r.json()["detail"].lower()
