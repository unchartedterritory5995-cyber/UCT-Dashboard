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


def test_global_budget_429(monkeypatch):
    _reset_counters()
    monkeypatch.setattr(ai.perplexity_search, "web_search", _fake_search())
    monkeypatch.setenv("AI_SEARCH_GLOBAL_DAILY_LIMIT", "2")
    assert _client(user_id=10).post("/api/ai-search", json={"query": "a"}).status_code == 200
    assert _client(user_id=11).post("/api/ai-search", json={"query": "b"}).status_code == 200
    r = _client(user_id=12).post("/api/ai-search", json={"query": "c"})
    assert r.status_code == 429
    assert "tomorrow" in r.json()["detail"].lower()
