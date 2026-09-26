"""Tag rename — wave 6, lane E, item 8 (carried from wave 5C, concern 4).

Renaming a tag renames it on every note that carries it, and a PARENT's rename
renames its children (`a/b` -> `x/b`: a tag is the parent of every `tag/...`
below it, the Obsidian convention the tree and the `tag=` filter already use).

What these pin:
  * `GET /api/j2/notes/tag-members?tag=` names the notes a rename would touch:
    live notes (archived ones too — unarchiving must not bring the old name
    back) carrying the tag or a tag below it; never a trashed note, never
    another member's, never "researcher" for "research" (whole levels only);
  * the rename goes through `POST /api/j2/notes/batch` (op `renameTag`), so every
    touched note answers with the revision it landed — the client settles it,
    and refuses and names a note whose words are waiting to sync — exactly as
    every other batch op does;
  * a child keeps its own spelling below the renamed part; two tags that become
    one are one; a renamed child that would outgrow the tag length is reported
    for THAT note, and the rest still rename;
  * a tag list edited while the rename runs is re-read and re-merged
    (compare-and-set), never clobbered;
  * a request that would rename nothing is a 400 before anything is written.
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


def _note(client, title, tags):
    r = client.post("/api/j2/notes", json={"title": title, "tags": tags})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _get(client, note_id):
    r = client.get(f"/api/j2/notes/{note_id}")
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _members(client, tag):
    r = client.get("/api/j2/notes/tag-members", params={"tag": tag})
    assert r.status_code == 200, r.text
    return r.json()


def _rename(client, ids, frm, to, expect=200):
    r = client.post("/api/j2/notes/batch", json={"ids": ids, "op": "renameTag", "args": {"from": frm, "to": to}})
    assert r.status_code == expect, r.text
    return r.json()


def _by_id(body):
    return {r["id"]: r for r in body["results"]}


# ── who a rename touches ─────────────────────────────────────────────────────

def test_tag_members_are_the_live_notes_with_the_tag_or_a_tag_below_it(app, client):
    _login_as(app, "u1")
    a = _note(client, "Parent", ["research"])
    b = _note(client, "Child", ["x", "Research/Semis"])
    _note(client, "Lookalike", ["researcher"])
    archived = _note(client, "Shelved", ["research"])
    assert client.patch(f"/api/j2/notes/{archived['id']}/archive", json={"archived": True}).status_code == 200
    trashed = _note(client, "Binned", ["research"])
    assert client.delete(f"/api/j2/notes/{trashed['id']}").status_code == 200
    _login_as(app, "u2")
    _note(client, "Someone else", ["research"])
    _login_as(app, "u1")

    body = _members(client, "research")
    assert sorted(n["id"] for n in body["notes"]) == sorted([a["id"], b["id"], archived["id"]])
    assert {n["id"]: n["title"] for n in body["notes"]}[b["id"]] == "Child"
    assert body["total"] == 3


def test_tag_members_of_a_tag_nobody_carries_is_an_empty_answer(app, client):
    _login_as(app, "u1")
    _note(client, "A", ["a"])
    assert _members(client, "nope") == {"notes": [], "total": 0}
    assert client.get("/api/j2/notes/tag-members", params={"tag": "  "}).status_code == 400


# ── the rename ───────────────────────────────────────────────────────────────

def test_a_rename_renames_the_tag_and_every_tag_below_it(app, client):
    _login_as(app, "u1")
    a = _note(client, "Parent", ["research"])
    b = _note(client, "Child", ["x", "Research/Semis", "research/semis/memory"])
    ids = [n["id"] for n in _members(client, "research")["notes"]]
    body = _rename(client, ids, "research", "study")
    assert body["changed"] == 2 and body["failed"] == 0
    assert _get(client, a["id"])["tags"] == ["study"]
    # ⭐ A child keeps its OWN spelling below the renamed part.
    assert _get(client, b["id"])["tags"] == ["x", "study/Semis", "study/semis/memory"]


def test_a_parent_rename_renames_its_children_a_b_to_x_b(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["a/b"])
    _rename(client, [n["id"]], "a", "x")
    assert _get(client, n["id"])["tags"] == ["x/b"]


def test_renaming_a_child_leaves_its_parent_and_siblings(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["a", "a/b", "a/c"])
    _rename(client, [n["id"]], "a/b", "a/beta")
    assert _get(client, n["id"])["tags"] == ["a", "a/beta", "a/c"]


def test_each_changed_note_answers_with_the_revision_it_landed(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["a"])
    before = _get(client, n["id"])["updatedAt"]
    result = _by_id(_rename(client, [n["id"]], "a", "b"))[n["id"]]
    after = _get(client, n["id"])["updatedAt"]
    assert result == {"id": n["id"], "status": "changed", "updatedAt": after}
    assert after != before


def test_two_tags_that_become_one_are_one(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["x", "a"])
    _rename(client, [n["id"]], "a", "X")
    assert _get(client, n["id"])["tags"] == ["x"]


def test_a_case_only_rename_changes_the_spelling(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["semis"])
    assert _by_id(_rename(client, [n["id"]], "semis", "Semis"))[n["id"]]["status"] == "changed"
    assert _get(client, n["id"])["tags"] == ["Semis"]


def test_a_note_without_the_tag_is_unchanged_and_keeps_its_revision(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["researcher"])
    before = _get(client, n["id"])["updatedAt"]
    assert _by_id(_rename(client, [n["id"]], "research", "study"))[n["id"]] == {"id": n["id"], "status": "unchanged"}
    assert _get(client, n["id"])["updatedAt"] == before
    assert _get(client, n["id"])["tags"] == ["researcher"]


def test_a_child_that_would_outgrow_the_tag_length_fails_that_note_only(app, client):
    _login_as(app, "u1")
    long_child = "a/" + "c" * 36  # 38 chars: fits
    n1 = _note(client, "Too long", [long_child])
    n2 = _note(client, "Fine", ["a"])
    body = _by_id(_rename(client, [n1["id"], n2["id"]], "a", "abcdef"))
    assert body[n1["id"]]["status"] == "invalid" and "40" in body[n1["id"]]["error"]
    assert body[n2["id"]]["status"] == "changed"
    assert _get(client, n1["id"])["tags"] == [long_child]
    assert _get(client, n2["id"])["tags"] == ["abcdef"]


def test_a_trashed_note_named_in_the_request_is_not_written(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["a"])
    assert client.delete(f"/api/j2/notes/{n['id']}").status_code == 200
    assert _by_id(_rename(client, [n["id"]], "a", "b"))[n["id"]]["status"] == "in_trash"


def test_a_tag_list_edited_meanwhile_is_re_read_and_re_merged(app, client, monkeypatch):
    _login_as(app, "u1")
    n = _note(client, "N", ["a"])
    from api.services.journal_two import notes as notes_service
    real = notes_service.note_batch_heads
    calls = {"n": 0}

    def racing_heads(user_id, ids, conn=None):
        heads = real(user_id, ids, conn=conn)
        calls["n"] += 1
        if calls["n"] == 1:
            # Another device adds a tag between the rename's read and its write.
            notes_service.update_note(user_id, n["id"], {"tags": ["a", "a/new"]})
        return heads

    monkeypatch.setattr(notes_service, "note_batch_heads", racing_heads)
    assert _by_id(_rename(client, [n["id"]], "a", "b"))[n["id"]]["status"] == "changed"
    assert calls["n"] == 2  # non-vacuity: the race happened and was re-read
    assert _get(client, n["id"])["tags"] == ["b", "b/new"]


def test_a_rename_that_names_nothing_is_a_400_before_anything_is_written(app, client):
    _login_as(app, "u1")
    n = _note(client, "N", ["a"])
    before = _get(client, n["id"])
    for args in ({"from": "a"}, {"to": "b"}, {"from": " ", "to": "b"}, {"from": "a", "to": " / "},
                 {"from": "a", "to": "a"}, {"from": ["a"], "to": "b"}):
        r = client.post("/api/j2/notes/batch", json={"ids": [n["id"]], "op": "renameTag", "args": args})
        assert r.status_code == 400, (args, r.text)
    assert _get(client, n["id"]) == before


def test_another_members_note_is_not_found_and_untouched(app, client):
    _login_as(app, "u2")
    theirs = _note(client, "Theirs", ["a"])
    _login_as(app, "u1")
    assert _by_id(_rename(client, [theirs["id"]], "a", "b"))[theirs["id"]]["status"] == "not_found"
    _login_as(app, "u2")
    assert _get(client, theirs["id"])["tags"] == ["a"]
