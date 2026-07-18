from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import get_current_user


def _client(user_id=1):
    app = FastAPI()
    app.include_router(ai.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id}
    return TestClient(app)


def _reset_counters():
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0


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


def test_auto_recency_heuristic():
    assert ai._auto_recency("Why is SMCI moving today?") == "day"
    assert ai._auto_recency("biggest premarket movers") == "day"
    assert ai._auto_recency("recent analyst upgrades on NVDA") == "week"
    assert ai._auto_recency("What was JPM's last earnings report like?") is None
    assert ai._auto_recency("Who are COHR's closest competitors by business line?") is None


def test_global_budget_429(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    monkeypatch.setenv("AI_SEARCH_GLOBAL_DAILY_LIMIT", "2")
    assert _client(user_id=10).post("/api/ai-search", json={"query": "a"}).status_code == 200
    assert _client(user_id=11).post("/api/ai-search", json={"query": "b"}).status_code == 200
    r = _client(user_id=12).post("/api/ai-search", json={"query": "c"})
    assert r.status_code == 429
    assert "tomorrow" in r.json()["detail"].lower()
