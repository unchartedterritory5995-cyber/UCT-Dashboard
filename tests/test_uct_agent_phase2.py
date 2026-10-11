"""UCT Agent Phase 2 — the server half (docs/agent/PHASE2.md)."""
from __future__ import annotations

import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters, narrative_cost_guard
from api.services.uct_agent import store, turn

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    yield TestClient(app)
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    daily_counters.clear()


def _caller(calls):
    env = '{"disposition":"answer","reply":"hi","question":null,"ops":[],"unsupported_category":null,"research":null,"title":null}'

    def call(**kw):
        calls.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=env)], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=10_000, output_tokens=200))
    return call


def test_COST_CEILING_unset_changes_nothing(client, monkeypatch):
    calls = []
    monkeypatch.delenv(rx.COST_CAP_ENV, raising=False)
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    narrative_cost_guard.record(turn.COST_SURFACE, "claude-haiku-4-5", cost_usd=999.0)
    assert client.post("/api/agent/turn", json={"message": "hi"}).status_code == 200
    assert calls


def test_COST_CEILING_set_refuses_BEFORE_the_model_call_once_reached(client, monkeypatch):
    calls = []
    monkeypatch.setenv(rx.COST_CAP_ENV, "0.05")
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    assert client.post("/api/agent/turn", json={"message": "hi"}).status_code == 200     # $0.011 spent
    narrative_cost_guard.record(turn.COST_SURFACE, "claude-haiku-4-5", cost_usd=0.05)
    n = len(calls)
    r = client.post("/api/agent/turn", json={"message": "hi again"})
    assert r.status_code == 429 and "spending limit" in r.json()["detail"]
    assert len(calls) == n                                                              # no model call
    assert rx.over_cost_cap() is True


def test_COST_CEILING_also_stops_the_background_naming_call(monkeypatch):
    monkeypatch.setattr(rx, "over_cost_cap", lambda: True)
    named = []
    monkeypatch.setattr(turn, "name_conversation", lambda *a, **k: named.append(1) or "X")
    rx._name_unnamed(1, "c")
    assert named == []


def test_PROMPT_concepts_use_UCTs_own_definitions_never_invented_ones():
    p = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert "starter or saved screens" in p and "never invent your own criteria" in p
    assert "Strongest\" means highest RS Rank (say so)" in p
    # still no capability names hard-coded in the generic prompt (the manifest carries them)
    import re
    assert not set(re.findall(r"\b(?:screener|watchlist|chart|layout)\.[a-z][A-Za-z]+\b", p)) - {"screener.run", "widget.addCharts"}
