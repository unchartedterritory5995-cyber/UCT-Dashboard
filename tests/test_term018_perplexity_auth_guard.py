"""TERM-018 / G-15: the Perplexity dead-key page, fired THROUGH ITS ROUTE.

`perplexity_search._notify_auth_failure` decides that a 401/403 from Perplexity means
the SHARED key is dead for the whole product, and pages ONE `critical`
(`perplexity_auth_failure`) at most once an hour. The wire recorded for TERM-018 is the
member's ask: `POST /api/ai-search` -> `fast_lane_answer` ->
`perplexity_search.web_search` -> the guard. These tests mount the same
`ai_search.router` object `api/main.py` includes and POST a question as a paid member.
Only the auth dependency, the provider's HTTP response, the desk-only fallback and the
sink are replaced; web_search's real error ladder runs.

CONTROLS: a 5xx from the provider is an outage to retry, not a dead key, and raises
nothing; a second 401 inside the hour is memoised and does not page again.
"""
from __future__ import annotations

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai_search
import api.services.perplexity_search as perplexity_search
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import chart_health_alerts


class _Resp:
    def __init__(self, status: int):
        self.status_code = status

    def raise_for_status(self):
        err = requests.HTTPError(f"{self.status_code} Client Error")
        err.response = self
        raise err

    def json(self):
        return {}


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "term018-key")
    monkeypatch.setattr(perplexity_search, "_LAST_AUTH_ALERT", 0.0)
    monkeypatch.setattr(perplexity_search, "_retry_pause", lambda attempt: 0.0)
    try:
        perplexity_search._SEARCH_CACHE._data.clear()
    except Exception:
        pass
    monkeypatch.setattr(ai_search, "_desk_only_answer", lambda *a, **k: None)
    monkeypatch.setattr(ai_search, "_claude_synth_enabled", lambda: False)
    ai_search._usage_day = ""
    ai_search._usage_by_user = {}
    ai_search._usage_global = 0
    yield
    try:
        perplexity_search._SEARCH_CACHE._data.clear()
    except Exception:
        pass


@pytest.fixture
def alerts(monkeypatch):
    seen: list[tuple[str, str]] = []

    def emit(key, severity, message=None, metadata=None, **kw):
        seen.append((key, severity))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", emit)
    return seen


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(ai_search.router)
    who = {"id": 18018, "role": "user", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _provider_answers(monkeypatch, status: int) -> None:
    monkeypatch.setattr(perplexity_search.requests, "post", lambda *a, **k: _Resp(status))


def _ask(client, q: str) -> dict:
    r = client.post("/api/ai-search", json={"query": q})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_rejected_key_on_a_members_ask_pages_critical(monkeypatch, client, alerts):
    _provider_answers(monkeypatch, 401)
    body = _ask(client, "term018 why is the probe moving x1")
    assert body.get("error") and not body.get("answer")
    assert alerts == [("perplexity_auth_failure", "critical")]


def test_CONTROL_a_provider_outage_is_not_a_dead_key(monkeypatch, client, alerts):
    _provider_answers(monkeypatch, 503)
    _ask(client, "term018 why is the probe moving x2")
    assert alerts == []


def test_CONTROL_a_second_rejection_inside_the_hour_does_not_page_again(
        monkeypatch, client, alerts):
    _provider_answers(monkeypatch, 403)
    _ask(client, "term018 why is the probe moving x3")
    _ask(client, "term018 why is the probe moving x4")
    assert alerts == [("perplexity_auth_failure", "critical")]
