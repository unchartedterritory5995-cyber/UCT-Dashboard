"""Router-level tests for Wave H's Research Home + Ticker Research Workspace
endpoints. Same standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_thesis_router.py."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture(autouse=True)
def _no_real_entity_master(monkeypatch):
    from api.services.entity_master import api as entity_master
    monkeypatch.setattr(
        entity_master, "resolve",
        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"),
    )


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _create_note(client, title="A note", **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200
    return r.json()["note"]["id"]


def test_home_requires_auth(app, client):
    r = client.get("/api/j2/notebook/home")
    assert r.status_code == 401


def test_ticker_research_summary_requires_auth(app, client):
    r = client.get("/api/j2/notes/research/NVDA/summary")
    assert r.status_code == 401


def test_home_returns_all_bounded_sections(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, "NVDA note", ticker="NVDA")
    client.put(f"/api/j2/notes/{note_id}", json={"properties": {"builtin:thesis_status": "active"}})

    r = client.get("/api/j2/notebook/home")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"continueWorking", "favorites", "activeTheses", "openPositionResearch", "needsReview"}
    assert [n["id"] for n in body["activeTheses"]] == [note_id]


def test_home_is_tenant_scoped(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, "u1 note")
    client.post(f"/api/j2/notes/{note_id}/favorite")

    _login_as(app, "u2")
    r = client.get("/api/j2/notebook/home")
    assert r.status_code == 200
    assert r.json()["favorites"] == []


def test_ticker_research_summary_returns_notes_theses_facts_trades(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, "NVDA thesis", ticker="NVDA")
    client.put(f"/api/j2/notes/{note_id}", json={
        "properties": {"builtin:research_type": "long_thesis", "builtin:thesis_status": "active"},
    })

    r = client.get("/api/j2/notes/research/NVDA/summary")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"identity", "notes", "activeTheses", "pastTheses", "facts", "tradeSummary"}
    assert body["identity"]["symbol"] == "NVDA"
    assert [n["id"] for n in body["notes"]] == [note_id]
    assert [n["id"] for n in body["activeTheses"]] == [note_id]
    assert body["tradeSummary"] == {"openPositions": 0, "closedTrades": 0}


def test_ticker_research_summary_with_zero_research_still_200s(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/research/ZZZZ/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["notes"] == []
    assert body["tradeSummary"] == {"openPositions": 0, "closedTrades": 0}


def test_ticker_research_summary_is_tenant_scoped(app, client):
    _login_as(app, "u1")
    _create_note(client, "u1's NVDA note", ticker="NVDA")

    _login_as(app, "u2")
    r = client.get("/api/j2/notes/research/NVDA/summary")
    assert r.status_code == 200
    assert r.json()["notes"] == []


def test_multi_ticker_note_appears_in_both_workspace_summaries(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, "NVDA vs AMD")
    body = client.get(f"/api/j2/notes/{note_id}").json()["note"]["bodyJson"]
    body["content"] = [
        {"type": "paragraph", "content": [{"type": "text", "text": "$NVDA and $AMD compared"}]},
    ]
    r = client.put(f"/api/j2/notes/{note_id}", json={"bodyJson": body})
    assert r.status_code == 200

    nvda = client.get("/api/j2/notes/research/NVDA/summary").json()
    amd = client.get("/api/j2/notes/research/AMD/summary").json()
    assert [n["id"] for n in nvda["notes"]] == [note_id]
    assert [n["id"] for n in amd["notes"]] == [note_id]
