"""Router-level tests for Wave B (High-Frequency Notebook UX)'s Favorites +
Recents endpoints: POST/DELETE /api/j2/notes/{id}/favorite, GET
/api/j2/notes/favorites, POST /api/j2/notes/{id}/opened, GET
/api/j2/notes/recents.

Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_notes_search_router.py.
"""
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


def _create_note(client, title="A note"):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200
    return r.json()["note"]["id"]


# ── Favorites ────────────────────────────────────────────────────────────────

def test_favorite_lifecycle_end_to_end(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)

    r = client.post(f"/api/j2/notes/{note_id}/favorite")
    assert r.status_code == 200
    assert r.json() == {"isFavorite": True}

    r = client.get("/api/j2/notes/favorites")
    assert r.status_code == 200
    assert [n["id"] for n in r.json()["notes"]] == [note_id]

    # GET /notes/{id} reflects the favorite state
    r = client.get(f"/api/j2/notes/{note_id}")
    assert r.json()["note"]["isFavorite"] is True

    r = client.delete(f"/api/j2/notes/{note_id}/favorite")
    assert r.status_code == 200
    assert r.json() == {"isFavorite": False}

    r = client.get("/api/j2/notes/favorites")
    assert r.json()["notes"] == []


def test_favoriting_a_nonexistent_note_is_404(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/does-not-exist/favorite")
    assert r.status_code == 404


def test_favoriting_another_users_note_is_404_not_a_leak(app, client):
    """Tenant isolation at the router boundary: u1 cannot favorite a note
    that belongs to u2, and gets the same honest 404 as a nonexistent note
    (never a 403 that would confirm the note's existence)."""
    _login_as(app, "u1")
    note_id = _create_note(client)

    _login_as(app, "u2")
    r = client.post(f"/api/j2/notes/{note_id}/favorite")
    assert r.status_code == 404
    assert client.get("/api/j2/notes/favorites").json()["notes"] == []


def test_route_declaration_order_favorites_is_not_swallowed_as_a_note_id(app, client):
    """GET /api/j2/notes/favorites must resolve to the favorites-list route,
    not fall through to GET /api/j2/notes/{note_id} with note_id='favorites'
    (which would 404) -- regression guard for the FastAPI declaration-order
    trap this file's other routes already carry comments about."""
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/favorites")
    assert r.status_code == 200
    assert r.json() == {"notes": []}


# ── Recents ──────────────────────────────────────────────────────────────────

def test_opened_beacon_then_recents_end_to_end(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)

    r = client.post(f"/api/j2/notes/{note_id}/opened")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get("/api/j2/notes/recents")
    assert r.status_code == 200
    assert [n["id"] for n in r.json()["notes"]] == [note_id]


def test_opened_beacon_on_a_bogus_note_id_never_errors(app, client):
    """Best-effort recency signal -- must return 200 even for garbage input,
    never break whatever triggered it on the frontend."""
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/totally-made-up-id/opened")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_opened_beacon_on_another_users_note_does_not_leak_into_their_recents(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)

    _login_as(app, "u2")
    client.post(f"/api/j2/notes/{note_id}/opened")
    assert client.get("/api/j2/notes/recents").json()["notes"] == []

    _login_as(app, "u1")
    assert client.get("/api/j2/notes/recents").json()["notes"] == []


def test_route_declaration_order_recents_is_not_swallowed_as_a_note_id(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/recents")
    assert r.status_code == 200
    assert r.json() == {"notes": []}


def test_recents_respects_limit_query_param(app, client):
    _login_as(app, "u1")
    for i in range(5):
        note_id = _create_note(client, title=f"Note {i}")
        client.post(f"/api/j2/notes/{note_id}/opened")
    r = client.get("/api/j2/notes/recents", params={"limit": 2})
    assert len(r.json()["notes"]) == 2
