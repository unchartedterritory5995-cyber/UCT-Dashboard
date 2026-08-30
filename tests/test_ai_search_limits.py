from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

# ⚠️ REPAIRED 2026-08-09 — AI Search (LLM spend on the firm's key) became `require_paid`.
# These tests overrode `get_current_user` and asserted 200, which ENCODED THE
# HOLE the auth sweep found: they proved a caller with A SESSION got the data,
# and signup is open and free, so that was never the same claim as "a member who
# paid". The override moved to `get_current_user_with_plan` (the gate's INPUT) —
# ⛔ NOT to `require_paid` itself, because overriding a gate means never running
# it (`lesson_injected_dependency_hides_the_fetch`).
PAID = {"id": 1, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": 2, "email": "free@example.test", "role": "member", "plan": "free"}


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
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
    # a `meta` tier event now precedes the deltas
    assert events[0]["type"] == "meta"
    assert [e["type"] for e in events[1:]] == ["delta", "delta", "final"]
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


def test_summarize_flow_rows_aggregates_today_only():
    rows = [
        {"CreatedDate": "7/18/2026", "Premium": "1500000", "CallPut": "CALL", "Side": "A",
         "Strike": "200", "ExpirationDate": "8/15/2026"},
        {"CreatedDate": "7/18/2026", "Premium": "500000", "CallPut": "PUT", "Side": "B",
         "Strike": "180", "ExpirationDate": "8/15/2026"},
        {"CreatedDate": "7/17/2026", "Premium": "9000000", "CallPut": "CALL", "Side": "A",
         "Strike": "190", "ExpirationDate": "8/15/2026"},   # yesterday — excluded
    ]
    out = ai._summarize_flow_rows("NVDA", rows, "7/18/2026")
    assert "NVDA options flow today (UCT tape): 2 notable prints" in out
    assert "$2.0M premium" in out and "call-heavy" in out
    assert "$1.5M calls / $0.5M puts" in out and "75% at ask" in out
    assert "largest: CALL $200 exp 8/15/2026 $1.50M" in out


def test_summarize_flow_rows_weekend_falls_back_to_last_session():
    rows = [
        {"CreatedDate": "7/16/2026", "Premium": "800000", "CallPut": "PUT", "Side": "A"},
        {"CreatedDate": "7/17/2026", "Premium": "2000000", "CallPut": "CALL", "Side": "A",
         "Strike": "205", "ExpirationDate": "9/19/2026"},
    ]
    out = ai._summarize_flow_rows("NVDA", rows, "7/18/2026")   # Saturday — no rows today
    assert "options flow last session (7/17/2026)" in out
    assert "1 notable prints" in out and "$2.0M premium" in out


def test_summarize_flow_rows_no_rows_at_all():
    assert ai._summarize_flow_rows("NVDA", [], "7/18/2026") == ""


def test_flow_and_patterns_grounding_wiring(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend"})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 10.0, "direction": "up", "abs_pct": 1.0})
    monkeypatch.setattr(ai, "_ctx_catalyst", lambda s: "")
    monkeypatch.setattr(ai, "_ctx_tape", lambda s: "")
    monkeypatch.setattr(ai, "_ctx_patterns", lambda s: f"{s} active setups (UCT pattern engine): High Tight Flag (82% conf)")
    monkeypatch.setattr(ai, "_ctx_flow_ticker", lambda s: f"{s} options flow today (UCT tape): 12 notable prints")
    monkeypatch.setattr(ai, "_UNI", {"NVDA"})
    c = _client()
    # flow phrasing → patterns AND flow both ground
    c.post("/api/ai-search", json={"query": "what is the options flow saying on NVDA"})
    assert "NVDA active setups (UCT pattern engine)" in captured["system"]
    assert "NVDA options flow today (UCT tape)" in captured["system"]
    # non-flow phrasing → patterns yes, flow skipped (HTTP hop saved)
    c.post("/api/ai-search", json={"query": "what do you think of NVDA here"})
    assert "NVDA active setups (UCT pattern engine)" in captured["system"]
    assert "options flow today" not in captured["system"]


def test_scope_guard_present_in_widget_prompt():
    # The refusal sentence + the hard no-general-purpose clause are the guard.
    assert "I'm the UCT research desk" in ai._WIDGET_SYSTEM
    assert "never write code" in ai._WIDGET_SYSTEM.lower()
    # …and scope must NOT be exclusive to instruments. "you exist exclusively
    # for markets" was pinned here until 2026-08-29, and it is exactly what made
    # the desk refuse "find me an example of an exhaustion extension" twice in
    # one minute — the firm's own candle vocabulary, answered as off-topic.
    assert "exclusively for markets" not in ai._WIDGET_SYSTEM
    assert "technical analysis" in ai._WIDGET_SYSTEM.lower()


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


def test_clean_history_caps_and_filters():
    raw = [
        "not-a-dict",
        {"q": "", "a": "orphan answer"},
        {"q": "q1", "a": "a1"},
        {"q": "q2", "a": "a2"},
        {"q": "q3" * 400, "a": "a3" * 900},
        {"q": "q4", "a": "a4"},
    ]
    out = ai._clean_history(raw)
    # last 3 entries considered, malformed dropped, sizes capped
    assert [h["q"][:2] for h in out] == ["q2", "q3", "q4"]
    assert len(out[1]["q"]) == 300 and len(out[1]["a"]) == 1200


def test_history_salt_separates_threads():
    h = [{"q": "why is SMCI up", "a": "AI capex."}]
    assert ai._history_salt("base", []) == "base"
    salted = ai._history_salt("base", h)
    assert salted.startswith("base|h") and salted != ai._history_salt("base", [{"q": "other", "a": "x"}])


def test_history_threaded_to_search(monkeypatch):
    _reset_counters()
    captured = {}

    def fake(query, **kw):
        captured.update(kw)
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    r = _client().post("/api/ai-search", json={
        "query": "how did the stock react?",
        "history": [{"q": "What was JPM's last report like?", "a": "JPM beat on EPS."}],
    })
    assert r.status_code == 200
    assert captured["history"] == [{"q": "What was JPM's last report like?", "a": "JPM beat on EPS."}]
    assert "|h" in captured["cache_salt"] or captured["cache_salt"].startswith("h")


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
    # De-identified: the per-user breakdown (raw user_id) was removed from /admin/stats.
    assert "top_users" not in d
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


# ── capture-foundation wiring (ai_search_log) ────────────────────────────────
def test_answer_returns_stable_answer_id_and_logs(monkeypatch, tmp_path):
    _reset_counters()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    r = _client(user_id=5).post("/api/ai-search", json={"query": "why is SMCI moving today"})
    assert r.status_code == 200
    aid = r.json().get("answer_id")
    assert aid and len(aid) >= 16                 # stable id returned to the client
    ins = ail.insights(days=1)
    assert ins["window_count"] == 1
    assert ins["by_freshness"].get("time_sensitive") == 1   # 'today' → time_sensitive


def test_logging_is_invariant_when_disabled(monkeypatch, tmp_path):
    _reset_counters()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "0")
    ail._reset_for_tests()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    r = _client(user_id=5).post("/api/ai-search", json={"query": "q"})
    # Answer path is unaffected by logging being off; still returns an id + answer.
    assert r.status_code == 200 and r.json()["answer"].startswith("echo:")
    assert r.json().get("answer_id")


def test_signal_endpoint_records_and_gates_admin(monkeypatch, tmp_path):
    _reset_counters()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u1", answer_id="AID1", query="q", answer="a")
    # a member can record a passive save signal
    r = _client(user_id=5, role="user").post("/api/ai-search/signal", json={"answer_id": "AID1", "kind": "save"})
    assert r.status_code == 200 and r.json()["ok"] is True
    # pin is admin-only
    assert _client(role="user").post("/api/ai-search/signal", json={"answer_id": "AID1", "kind": "pin"}).status_code == 403
    assert _client(role="admin").post("/api/ai-search/signal", json={"answer_id": "AID1", "kind": "pin"}).status_code == 200
    # unknown kind rejected
    assert _client(role="user").post("/api/ai-search/signal", json={"answer_id": "AID1", "kind": "bogus"}).status_code == 422


def test_admin_log_endpoint(monkeypatch, tmp_path):
    _reset_counters()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u1", query="what is a VCP pattern", answer="A VCP is...")
    assert _client(role="user").get("/api/ai-search/admin/log").status_code == 403
    r = _client(role="admin").get("/api/ai-search/admin/log?days=7")
    assert r.status_code == 200
    d = r.json()
    assert d["window_count"] == 1 and d["by_freshness"].get("evergreen") == 1


def test_stream_endpoint_logs_final_answer_and_id(monkeypatch, tmp_path):
    _reset_counters()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()

    async def fake_stream(query, **kw):
        yield {"type": "delta", "text": "SMCI is ripping"}
        yield {"type": "final", "answer": "SMCI is ripping on AI capex",
               "citations": ["https://reuters.com/x"], "related_questions": [], "cached": False,
               "model": "sonar-pro"}

    monkeypatch.setattr(ai.perplexity_search, "stream_search", fake_stream)
    with _client(user_id=8).stream("POST", "/api/ai-search/stream",
                                   json={"query": "why is SMCI moving today"}) as r:
        assert r.status_code == 200
        body = "".join(chunk for chunk in r.iter_text())
    # meta event carries the stable answer_id; final too
    assert '"answer_id"' in body and '"type": "final"' in body
    # the finished answer was captured exactly once (run_in_executor already drained
    # on the sync TestClient event loop by the time the stream closes)
    ins = ail.insights(days=1)
    assert ins["window_count"] == 1
    assert ins["recent"][0]["answer_snip"].startswith("SMCI is ripping")
    assert ins["recent"][0]["endpoint"] == "stream"


# ── Phase 2 memory blend wiring ──────────────────────────────────────────────
def _capture_system_fake():
    cap = {}
    def fake(query, **kw):
        cap['system'] = kw.get('system', '')
        return {"answer": "x", "citations": [], "related_questions": [], "cached": False}
    return cap, fake


def test_memory_block_injected_into_system(monkeypatch):
    _reset_counters()
    cap, fake = _capture_system_fake()
    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    import api.services.ai_search_memory as mem
    monkeypatch.setattr(mem, "retrieve_context", lambda q, qt, **k: "\n\nPRIOR DESK RESEARCH (test block)")
    r = _client().post("/api/ai-search", json={"query": "what is a VCP pattern"})
    assert r.status_code == 200
    assert "PRIOR DESK RESEARCH (test block)" in cap['system']


def test_memory_absent_when_retrieval_empty(monkeypatch):
    _reset_counters()
    cap, fake = _capture_system_fake()
    monkeypatch.setattr(ai.perplexity_search, "web_search", fake)
    import api.services.ai_search_memory as mem
    monkeypatch.setattr(mem, "retrieve_context", lambda q, qt, **k: "")   # flag off / no hit
    r = _client().post("/api/ai-search", json={"query": "what is a VCP pattern"})
    assert r.status_code == 200
    assert "PRIOR DESK RESEARCH" not in cap['system']   # invariance: nothing injected
