"""Lock — wave 6, lane E, item 2 (the server half; the editor half is lane D's
`lib/lockedNote.js`, built against this exact contract).

What these pin (dispatch addendum, 2026-09-24):
  * `PATCH /api/j2/notes/{id}/lock` `{locked: <bool>}` round-trips both ways
    and ANSWERS WITH THE NOTE — `locked` and a NEWER `updatedAt` — so the
    editor can settle the landed revision (an `{ok: true}` body would leave an
    unlock-then-keystroke to 409 and fork the note);
  * the write ADVANCES `updated_at` like any metadata write, so another tab's
    compare-and-set and the outbox see it;
  * ⛔⛔ the server stores the flag and does NOT refuse a body write to a locked
    note — a queued offline edit must never become a conflict. The lock is the
    editor's to enforce;
  * one door for the value: a body PUT carrying `locked` does not change it;
  * list rows carry `locked` (the card/row glyph reads it).
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


def _note(client, title="N"):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _lock(client, note_id, locked=True):
    return client.patch(f"/api/j2/notes/{note_id}/lock", json={"locked": locked})


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def test_a_new_note_is_unlocked(app, client):
    _login_as(app, "u1")
    assert _note(client)["locked"] is False


def test_lock_round_trips_both_ways_and_answers_with_a_newer_revision(app, client):
    _login_as(app, "u1")
    n = _note(client)
    r = _lock(client, n["id"], True)
    assert r.status_code == 200, r.text
    locked = r.json()["note"]
    assert locked["locked"] is True
    assert locked["id"] == n["id"]
    assert locked["updatedAt"] > n["updatedAt"], "the lock must move the revision"
    assert client.get(f"/api/j2/notes/{n['id']}").json()["note"]["locked"] is True
    unlocked = _lock(client, n["id"], False).json()["note"]
    assert unlocked["locked"] is False
    assert unlocked["updatedAt"] > locked["updatedAt"]


def test_the_landed_revision_is_a_usable_baseline(app, client):
    # Unlock, then the editor's next save with the revision the unlock returned:
    # it lands (no 409), which is the whole point of answering with the note.
    _login_as(app, "u1")
    n = _note(client)
    _lock(client, n["id"], True)
    # The lock alone is visible to compare-and-set: a save against the
    # pre-lock revision (another tab that has not heard) is a conflict.
    r = client.put(f"/api/j2/notes/{n['id']}", json={"bodyJson": _doc("stale"), "baseUpdatedAt": n["updatedAt"]})
    assert r.status_code == 409
    base = _lock(client, n["id"], False).json()["note"]["updatedAt"]
    r = client.put(f"/api/j2/notes/{n['id']}", json={"bodyJson": _doc("after unlock"), "baseUpdatedAt": base})
    assert r.status_code == 200, r.text


def test_locking_a_locked_note_moves_nothing(app, client):
    _login_as(app, "u1")
    n = _note(client)
    first = _lock(client, n["id"], True).json()["note"]
    again = _lock(client, n["id"], True).json()["note"]
    assert again["locked"] is True
    assert again["updatedAt"] == first["updatedAt"]


def test_a_body_write_to_a_locked_note_is_NOT_refused(app, client):
    # ⛔⛔ The ruling: the server stores the flag and does not refuse body writes.
    # A queued offline edit must never become a conflict inside the offline layer.
    _login_as(app, "u1")
    n = _note(client)
    base = _lock(client, n["id"], True).json()["note"]["updatedAt"]
    r = client.put(f"/api/j2/notes/{n['id']}", json={"bodyJson": _doc("queued offline words"),
                                                      "baseUpdatedAt": base})
    assert r.status_code == 200, r.text
    body = r.json()["note"]
    assert body["bodyPlain"] == "queued offline words"
    assert body["locked"] is True, "saving words does not unlock the note"
    # A title-only save, without a baseline, is not refused either.
    assert client.put(f"/api/j2/notes/{n['id']}", json={"title": "renamed"}).status_code == 200


def test_a_body_put_cannot_change_the_lock(app, client):
    # One door for the value: a stale PUT replayed by the outbox must never
    # unlock (or lock) a note behind the member's back.
    _login_as(app, "u1")
    n = _note(client)
    _lock(client, n["id"], True)
    client.put(f"/api/j2/notes/{n['id']}", json={"title": "t", "locked": False})
    assert client.get(f"/api/j2/notes/{n['id']}").json()["note"]["locked"] is True


def test_the_lock_refuses_a_non_boolean_and_what_is_not_the_members(app, client):
    _login_as(app, "u1")
    n = _note(client)
    assert client.patch(f"/api/j2/notes/{n['id']}/lock", json={"locked": 1}).status_code == 400
    assert client.patch(f"/api/j2/notes/{n['id']}/lock", json={}).status_code == 400
    assert _lock(client, "missing").status_code == 404
    client.delete(f"/api/j2/notes/{n['id']}")
    assert _lock(client, n["id"]).status_code == 404, "a trashed note is restored before it is locked"
    _login_as(app, "u2")
    assert _lock(client, n["id"]).status_code == 404


def test_list_rows_carry_the_lock(app, client):
    _login_as(app, "u1")
    a = _note(client, "A")
    _note(client, "B")
    _lock(client, a["id"], True)
    rows = {n["title"]: n["locked"] for n in client.get("/api/j2/notes").json()["notes"]}
    assert rows == {"A": True, "B": False}
