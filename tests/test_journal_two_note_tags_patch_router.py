"""PATCH /api/j2/notes/{id}/tags — wave 6, lane E (controller request, folded
into item 8). The server half of lane D's tag door (M14).

⚰️ THE WINDOW THIS CLOSES. The editor's tag chips wrote tags as GET -> PUT of
the whole list: between the two, another device could add a tag, and the PUT
— built from the list the editor had READ — wrote it away. A tag change is
now a DELTA (`{add: [...], remove: [...]}`) applied to the STORED list, read
and written inside ONE SQLite transaction, so nothing can land in between.

What these pin:
  * add merges into the stored list (the request never needs to know the
    other tags); remove is by the tag's identity (`tag_key`), exactly — a
    parent's children stay;
  * it ANSWERS WITH THE NOTE at the new revision — the lock endpoint's shape —
    so the client can settle it (`settleMetadataRevision`); a change that
    changes nothing moves no revision;
  * ⛔⛔ one transaction: a write from another connection cannot land between
    this request's read and its write (the rail forces exactly that);
  * the two-device case lane D's M14 found: each device adds its own tag and
    both survive;
  * a request that cannot apply is a 400 and writes nothing; a trashed note or
    another member's is a 404.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
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


def _note(client, tags, title="N"):
    r = client.post("/api/j2/notes", json={"title": title, "tags": tags})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _get(client, note_id):
    r = client.get(f"/api/j2/notes/{note_id}")
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _patch(client, note_id, body, expect=200):
    r = client.patch(f"/api/j2/notes/{note_id}/tags", json=body)
    assert r.status_code == expect, r.text
    return r.json()


def test_add_merges_into_the_stored_list_and_answers_with_the_note_at_its_new_revision(app, client):
    _login_as(app, "u1")
    n = _note(client, ["a"])
    body = _patch(client, n["id"], {"add": ["b"]})
    assert set(body) == {"note", "changed"}
    assert body["changed"] is True
    note = body["note"]
    assert note["id"] == n["id"]
    assert note["tags"] == ["a", "b"]
    assert note["updatedAt"] != n["updatedAt"]
    # The answer IS the stored note: the revision the client settles is real.
    stored = _get(client, n["id"])
    assert stored["updatedAt"] == note["updatedAt"]
    assert stored["tags"] == ["a", "b"]
    # Same shape as the lock endpoint's answer (the note payload).
    assert {"locked", "archivedAt", "folderId"} <= set(note)


def test_remove_is_by_identity_and_leaves_a_parents_children(app, client):
    _login_as(app, "u1")
    n = _note(client, ["Q3 / Q4", "research", "research/semis"])
    note = _patch(client, n["id"], {"remove": ["q3/q4", "Research"]})["note"]
    assert note["tags"] == ["research/semis"]


def test_add_and_remove_together(app, client):
    _login_as(app, "u1")
    n = _note(client, ["a", "b"])
    assert _patch(client, n["id"], {"add": ["c"], "remove": ["a"]})["note"]["tags"] == ["b", "c"]


def test_a_change_that_changes_nothing_moves_no_revision(app, client):
    _login_as(app, "u1")
    n = _note(client, ["Semis"])
    body = _patch(client, n["id"], {"add": ["semis"], "remove": ["gone"]})
    note = body["note"]
    assert body["changed"] is False
    assert note["tags"] == ["Semis"]
    assert note["updatedAt"] == n["updatedAt"]
    assert _get(client, n["id"])["updatedAt"] == n["updatedAt"]


def test_a_delta_another_writer_already_satisfied_answers_changed_false_at_THEIR_revision(app, client, db_path):
    """⛔⛔ Wave 7 lane J, J9 -- the residual race lane H's M14 left open. Between the
    editor's read (revision R) and its PATCH, ANOTHER writer adds the same tag (revision
    R'). The PATCH has nothing to do: it writes no row and answers with the note as
    stored -- at R', which is NOT the revision the client read. A client judging "did my
    write move it" by comparing R' with R calls that moved, and records another writer's
    revision as its own. Only the route knows it wrote nothing: `changed` is False."""
    _login_as(app, "u1")
    n = _note(client, ["a"])
    other = sqlite3.connect(db_path)
    try:
        other.execute("UPDATE j2_notes SET tags = ?, updated_at = ? WHERE id = ?",
                      ('["a", "b"]', "2099-01-01T00:00:00+00:00", n["id"]))
        other.commit()
    finally:
        other.close()
    body = _patch(client, n["id"], {"add": ["b"]})
    assert body["changed"] is False
    assert body["note"]["tags"] == ["a", "b"]
    # The answer is at the OTHER writer's revision -- not the one the client read.
    assert body["note"]["updatedAt"] == "2099-01-01T00:00:00+00:00" != n["updatedAt"]
    assert _get(client, n["id"])["updatedAt"] == "2099-01-01T00:00:00+00:00"   # nothing written


def test_changed_is_true_exactly_when_this_request_wrote_a_row(app, client):
    _login_as(app, "u1")
    n = _note(client, ["a"])
    first = _patch(client, n["id"], {"add": ["b"]})
    again = _patch(client, n["id"], {"add": ["b"]})           # already there: nothing to write
    gone = _patch(client, n["id"], {"remove": ["zzz"]})        # absent: nothing to write
    back = _patch(client, n["id"], {"remove": ["b"]})
    assert [first["changed"], again["changed"], gone["changed"], back["changed"]] == [True, False, False, True]
    assert again["note"]["updatedAt"] == first["note"]["updatedAt"]
    assert back["note"]["updatedAt"] != first["note"]["updatedAt"]


def test_two_devices_each_adding_a_tag_both_survive(app, client):
    """Lane D's M14: device B's view of the note predates device A's tag. With
    a whole-list PUT, B's write would drop A's tag; a delta against the stored
    list cannot."""
    _login_as(app, "u1")
    n = _note(client, ["a"])
    _patch(client, n["id"], {"add": ["from-device-A"]})
    _patch(client, n["id"], {"add": ["from-device-B"]})  # B never saw A's tag
    assert _get(client, n["id"])["tags"] == ["a", "from-device-A", "from-device-B"]


def test_one_transaction_nothing_lands_between_the_read_and_the_write(app, client, monkeypatch, db_path):
    """⛔⛔ The rail forces the race: after this request has READ the stored
    list and before it writes, another connection tries to write the note's
    tags. Inside one transaction that write cannot land (it is refused, and
    the device that sent it retries); without one it lands — and is then
    silently overwritten by a list computed before it existed."""
    _login_as(app, "u1")
    n = _note(client, ["a"])
    from api.services.journal_two import notes as notes_service
    real = notes_service.update_note
    seen = {"calls": 0, "landed": None}

    def other_device_writes_first(*args, **kwargs):
        seen["calls"] += 1
        other = sqlite3.connect(db_path, timeout=0.2)
        try:
            other.execute(
                "UPDATE j2_notes SET tags = ?, updated_at = ? WHERE id = ?",
                ('["a", "intruder"]', "2099-01-01T00:00:00+00:00", n["id"]),
            )
            other.commit()
            seen["landed"] = True
        except sqlite3.OperationalError:
            seen["landed"] = False
        finally:
            other.close()
        return real(*args, **kwargs)

    monkeypatch.setattr(notes_service, "update_note", other_device_writes_first)
    _patch(client, n["id"], {"add": ["b"]})
    monkeypatch.undo()
    assert seen["calls"] == 1  # non-vacuity: the race was attempted
    final = _get(client, n["id"])["tags"]
    # Whatever happened, a write that LANDED is never lost…
    if seen["landed"]:
        assert "intruder" in final
    # …and inside one transaction it cannot land at all.
    assert seen["landed"] is False
    assert final == ["a", "b"]


def test_a_request_that_cannot_apply_is_a_400_and_writes_nothing(app, client):
    _login_as(app, "u1")
    n = _note(client, ["a"])
    for body in ({}, {"add": [], "remove": []}, {"add": "b"}, {"add": [3]},
                 {"add": ["b"], "remove": ["B"]}, {"add": ["x" * 41]}):
        r = client.patch(f"/api/j2/notes/{n['id']}/tags", json=body)
        assert r.status_code == 400, (body, r.text)
    stored = _get(client, n["id"])
    assert stored["tags"] == ["a"] and stored["updatedAt"] == n["updatedAt"]


def test_going_past_the_tag_cap_is_a_400_and_writes_nothing(app, client):
    _login_as(app, "u1")
    n = _note(client, [f"t{i}" for i in range(30)])
    r = client.patch(f"/api/j2/notes/{n['id']}/tags", json={"add": ["one-more"]})
    assert r.status_code == 400
    assert "30" in r.json()["detail"]
    stored = _get(client, n["id"])
    assert len(stored["tags"]) == 30 and stored["updatedAt"] == n["updatedAt"]


def test_a_trashed_note_and_another_members_are_404(app, client):
    _login_as(app, "u1")
    n = _note(client, ["a"])
    assert client.delete(f"/api/j2/notes/{n['id']}").status_code == 200
    _patch(client, n["id"], {"add": ["b"]}, expect=404)
    _login_as(app, "u2")
    theirs = _note(client, ["a"])
    _login_as(app, "u1")
    _patch(client, theirs["id"], {"add": ["b"]}, expect=404)
    _login_as(app, "u2")
    assert _get(client, theirs["id"])["tags"] == ["a"]
