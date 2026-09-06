"""Router-level tests for Wave D's GET /api/j2/notes/{id}/backlinks and
GET /api/j2/notes/link-targets. Same standalone-FastAPI-app + temp-auth.db
pattern as test_journal_two_notes_favorites_recents_router.py /
test_journal_two_notes_versions_router.py.
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


def _create_note(client, title="A note", body_json=None):
    payload = {"title": title}
    if body_json is not None:
        payload["bodyJson"] = body_json
    r = client.post("/api/j2/notes", json=payload)
    assert r.status_code == 200
    return r.json()["note"]["id"]


def _link_doc(target_id):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "noteLink", "attrs": {"noteId": target_id}},
    ]}]}


# ── /notes/{id}/backlinks ─────────────────────────────────────────────────────

def test_backlinks_endpoint_empty_for_a_fresh_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.get(f"/api/j2/notes/{note_id}/backlinks")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "notes": []}


def test_backlinks_endpoint_lists_the_linking_note(app, client):
    _login_as(app, "u1")
    target_id = _create_note(client, title="Target")
    source_id = _create_note(client, title="Source", body_json=_link_doc(target_id))
    r = client.get(f"/api/j2/notes/{target_id}/backlinks")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["notes"][0]["id"] == source_id


def test_backlinks_endpoint_is_tenant_isolated(app, client):
    _login_as(app, "u1")
    target_id = _create_note(client, title="Target")
    _create_note(client, title="Source", body_json=_link_doc(target_id))

    _login_as(app, "u2")
    r = client.get(f"/api/j2/notes/{target_id}/backlinks")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "notes": []}


def test_backlinks_endpoint_never_errors_for_a_nonexistent_note_id(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/does-not-exist/backlinks")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "notes": []}


# ── /notes/link-targets ────────────────────────────────────────────────────────

def test_link_targets_endpoint_resolves_a_real_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="My Note")
    r = client.get(f"/api/j2/notes/link-targets?ids={note_id}")
    assert r.status_code == 200
    body = r.json()["targets"]
    assert body[note_id] == {"title": "My Note", "status": "active"}


def test_link_targets_endpoint_resolves_multiple_ids(app, client):
    _login_as(app, "u1")
    a = _create_note(client, title="A")
    b = _create_note(client, title="B")
    r = client.get(f"/api/j2/notes/link-targets?ids={a},{b},ghost-id")
    body = r.json()["targets"]
    assert set(body.keys()) == {a, b}


def test_link_targets_endpoint_omits_a_foreign_users_note(app, client):
    _login_as(app, "u1")
    foreign_id = _create_note(client, title="Not Yours")

    _login_as(app, "u2")
    r = client.get(f"/api/j2/notes/link-targets?ids={foreign_id}")
    assert r.json()["targets"] == {}


def test_link_targets_endpoint_reports_trashed_status(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Will be trashed")
    r = client.delete(f"/api/j2/notes/{note_id}")
    assert r.status_code == 200
    r = client.get(f"/api/j2/notes/link-targets?ids={note_id}")
    assert r.json()["targets"][note_id]["status"] == "trashed"


def test_link_targets_endpoint_with_empty_ids_returns_empty(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/link-targets?ids=")
    assert r.status_code == 200
    assert r.json() == {"targets": {}}


def test_link_targets_route_registered_before_dynamic_note_detail(app):
    """/notes/link-targets must be a distinct static route, not swallowed by
    the dynamic /notes/{note_id} route (same shadowing hazard as
    /notes/backlinks and /notes/export)."""
    from api.routers.journal_two import router

    paths = [rt.path for rt in router.routes]
    assert "/api/j2/notes/link-targets" in paths
    assert "/api/j2/notes/{note_id}" in paths
    assert paths.index("/api/j2/notes/link-targets") < paths.index("/api/j2/notes/{note_id}")
