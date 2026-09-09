"""Router-level tests for Wave C (Version History)'s GET /api/j2/notes/{id}/versions,
GET /api/j2/notes/{id}/versions/{version_id}, and POST
/api/j2/notes/{id}/versions/{version_id}/restore.

Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_notes_favorites_recents_router.py.
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


def _edit(client, note_id, title):
    r = client.put(f"/api/j2/notes/{note_id}", json={"title": title})
    assert r.status_code == 200
    return r.json()["note"]


# ── list / get ───────────────────────────────────────────────────────────────

def test_list_versions_empty_for_a_never_edited_note(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.get(f"/api/j2/notes/{note_id}/versions")
    assert r.status_code == 200
    assert r.json() == {"versions": []}


def test_list_versions_after_an_edit_shows_the_original(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    _edit(client, note_id, "Edited")
    r = client.get(f"/api/j2/notes/{note_id}/versions")
    assert r.status_code == 200
    versions = r.json()["versions"]
    assert len(versions) == 1
    assert versions[0]["title"] == "Original"
    # List view never carries the body.
    assert "bodyPlain" not in versions[0]


def test_get_version_returns_full_content(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]
    r = client.get(f"/api/j2/notes/{note_id}/versions/{version_id}")
    assert r.status_code == 200
    assert r.json()["version"]["title"] == "Original"
    assert "bodyJson" in r.json()["version"]


def test_get_version_nonexistent_is_404(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.get(f"/api/j2/notes/{note_id}/versions/does-not-exist")
    assert r.status_code == 404


def test_get_version_wrong_note_is_404_not_a_leak(app, client):
    """Tenant/scope isolation at the router boundary: a real version id for
    note A, asked against note B, must 404 identically to a made-up id."""
    _login_as(app, "u1")
    note_a = _create_note(client, title="Note A")
    _edit(client, note_a, "Note A edited")
    version_id = client.get(f"/api/j2/notes/{note_a}/versions").json()["versions"][0]["id"]
    note_b = _create_note(client, title="Note B")
    r = client.get(f"/api/j2/notes/{note_b}/versions/{version_id}")
    assert r.status_code == 404


def test_list_and_get_versions_are_tenant_isolated(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Secret")
    _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    _login_as(app, "u2")
    assert client.get(f"/api/j2/notes/{note_id}/versions").json() == {"versions": []}
    assert client.get(f"/api/j2/notes/{note_id}/versions/{version_id}").status_code == 404


# ── restore ──────────────────────────────────────────────────────────────────

def test_restore_end_to_end(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    r = client.post(f"/api/j2/notes/{note_id}/versions/{version_id}/restore")
    assert r.status_code == 200
    assert r.json()["note"]["title"] == "Original"

    current = client.get(f"/api/j2/notes/{note_id}").json()["note"]
    assert current["title"] == "Original"


def test_restore_captures_pre_restore_state(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="A")
    _edit(client, note_id, "B")
    version_a_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    client.post(f"/api/j2/notes/{note_id}/versions/{version_a_id}/restore")

    versions_after = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"]
    assert "B" in {v["title"] for v in versions_after}


def test_restore_nonexistent_version_is_404(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client)
    r = client.post(f"/api/j2/notes/{note_id}/versions/does-not-exist/restore")
    assert r.status_code == 404


def test_restore_is_tenant_isolated(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    _login_as(app, "u2")
    r = client.post(f"/api/j2/notes/{note_id}/versions/{version_id}/restore")
    assert r.status_code == 404

    _login_as(app, "u1")
    current = client.get(f"/api/j2/notes/{note_id}").json()["note"]
    assert current["title"] == "Edited"  # untouched by the foreign attempt


def test_restore_with_a_stale_base_updated_at_returns_409(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    first = _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    # A "second tab" edits the note again, moving updated_at forward.
    _edit(client, note_id, "Edited elsewhere")

    # The restore attempt still carries the stale baseline from `first`.
    r = client.post(
        f"/api/j2/notes/{note_id}/versions/{version_id}/restore",
        json={"baseUpdatedAt": first["updatedAt"]},
    )
    assert r.status_code == 409
    current = client.get(f"/api/j2/notes/{note_id}").json()["note"]
    assert current["title"] == "Edited elsewhere"  # unaffected by the failed restore


def test_restore_with_a_fresh_base_updated_at_succeeds(app, client):
    _login_as(app, "u1")
    note_id = _create_note(client, title="Original")
    edited = _edit(client, note_id, "Edited")
    version_id = client.get(f"/api/j2/notes/{note_id}/versions").json()["versions"][0]["id"]

    r = client.post(
        f"/api/j2/notes/{note_id}/versions/{version_id}/restore",
        json={"baseUpdatedAt": edited["updatedAt"]},
    )
    assert r.status_code == 200
    assert r.json()["note"]["title"] == "Original"
