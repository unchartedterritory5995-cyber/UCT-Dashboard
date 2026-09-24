"""Bulk operations — POST /api/j2/notes/batch and POST /api/j2/notes/batch/export.

Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_notes_favorites_recents_router.py.

The contract these pin:
  * auth, and OWNERSHIP per note — another member's id is `not_found` and is
    left exactly as it was (never "forbidden": that would confirm it exists);
  * a request that would fail every note is a 400 BEFORE anything is written;
  * every op, both its `changed` and its `unchanged` answer;
  * `updatedAt` is returned exactly when the note's revision advanced — the
    client lands it (settleNoteWrites), so a missing one forks an open editor
    and an invented one lands a revision the server never had;
  * partial failure is reported per note, in the order sent;
  * a tag edited concurrently is re-read and MERGED, never overwritten;
  * (fix round 1) a move says where each note CAME FROM, and a per-note move
    puts a selection back — refusing a note that moved again since (the bulk
    bar's Undo, B1); tags are compared by `tag_key`, so a legacy "Q3 / Q4" is
    found and removed (S2);
  * the selection export reuses the single-note export and says what it skipped.
"""
from __future__ import annotations

import importlib
import io
import json
import os
import tempfile
import zipfile

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


def _note(client, title="A note", **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _get(client, nid):
    r = client.get(f"/api/j2/notes/{nid}")
    return r.json()["note"] if r.status_code == 200 else None


def _folder(client, name):
    r = client.post("/api/j2/note-folders", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["folder"]["id"]


def _batch(client, ids, op, args=None, expect=200):
    r = client.post("/api/j2/notes/batch", json={"ids": ids, "op": op, "args": args or {}})
    assert r.status_code == expect, r.text
    return r.json()


def _by_id(body):
    return {r["id"]: r for r in body["results"]}


# ── auth + request validation ────────────────────────────────────────────────

def test_requires_a_signed_in_member(client):
    r = client.post("/api/j2/notes/batch", json={"ids": ["x"], "op": "trash"})
    assert r.status_code == 401


@pytest.mark.parametrize("payload, needle", [
    ({"ids": [], "op": "trash"}, "non-empty"),
    ({"ids": "abc", "op": "trash"}, "non-empty"),
    ({"ids": ["a", ""], "op": "trash"}, "non-empty string"),
    ({"ids": ["a"], "op": "explode"}, "op must be one of"),
    ({"ids": ["a"], "op": "addTag", "args": {"tag": "   "}}, "tag is required"),
    ({"ids": ["a"], "op": "addTag", "args": {}}, "tag is required"),
    ({"ids": ["a"], "op": "addTag", "args": {"tag": "x" * 41}}, "tag exceeds"),
    ({"ids": ["a"], "op": "move", "args": "nope"}, "args must be an object"),
    ({"ids": ["a"], "op": "move", "args": {"folderId": 7}}, "folderId must be"),
    ({"ids": ["a", "b"], "op": "move", "args": {"folders": {"a": None}}}, "for every id"),
    ({"ids": ["a"], "op": "move", "args": {"folders": ["a"]}}, "for every id"),
    ({"ids": ["a"], "op": "move", "args": {"folders": {"a": 7}}}, "folderId must be"),
    ({"ids": ["a"], "op": "move", "args": {"folderId": "nope"}}, "folder not found"),
    ({"ids": ["a"], "op": "move", "args": {"folderId": None, "expectFolderId": 7}}, "expectFolderId"),
])
def test_a_request_that_would_fail_every_note_is_a_400(app, client, payload, needle):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/batch", json=payload)
    assert r.status_code == 400
    assert needle in r.json()["detail"]


def test_too_many_ids_is_a_400(app, client):
    _login_as(app, "u1")
    r = client.post("/api/j2/notes/batch", json={"ids": [f"n{i}" for i in range(501)], "op": "trash"})
    assert r.status_code == 400
    assert "at most 500" in r.json()["detail"]


def test_moving_into_someone_elses_folder_is_refused_and_writes_nothing(app, client):
    _login_as(app, "other")
    theirs = _folder(client, "Theirs")
    _login_as(app, "u1")
    n = _note(client)
    r = client.post("/api/j2/notes/batch", json={"ids": [n["id"]], "op": "move", "args": {"folderId": theirs}})
    assert r.status_code == 400
    assert r.json()["detail"] == "folder not found"
    assert _get(client, n["id"])["folderId"] is None
    assert _get(client, n["id"])["updatedAt"] == n["updatedAt"]


# ── ownership ────────────────────────────────────────────────────────────────

def test_another_members_note_is_not_found_and_untouched(app, client):
    _login_as(app, "owner")
    theirs = _note(client, "Theirs", tags=["keep"])
    _login_as(app, "u1")
    mine = _note(client, "Mine")
    for op, args in [("trash", {}), ("addTag", {"tag": "x"}), ("removeTag", {"tag": "keep"}),
                     ("move", {"folderId": None}), ("favorite", {}), ("restore", {})]:
        body = _batch(client, [theirs["id"], mine["id"]], op, args)
        assert _by_id(body)[theirs["id"]]["status"] == "not_found", op
    _login_as(app, "owner")
    after = _get(client, theirs["id"])
    assert after is not None and after["tags"] == ["keep"]
    assert after["updatedAt"] == theirs["updatedAt"]


# ── each op ──────────────────────────────────────────────────────────────────

def test_move_changes_folder_and_returns_the_new_revision(app, client):
    _login_as(app, "u1")
    f = _folder(client, "Research")
    a, b = _note(client, "A"), _note(client, "B")
    body = _batch(client, [a["id"], b["id"]], "move", {"folderId": f})
    for n in (a, b):
        res = _by_id(body)[n["id"]]
        now = _get(client, n["id"])
        assert res["status"] == "changed"
        assert now["folderId"] == f
        # ⛔ The revision the client lands must be the one the server now holds.
        assert res["updatedAt"] == now["updatedAt"]
        assert res["updatedAt"] != n["updatedAt"]
    assert body["changed"] == 2 and body["failed"] == 0


def test_move_to_where_it_already_is_is_unchanged_and_advances_nothing(app, client):
    _login_as(app, "u1")
    f = _folder(client, "Research")
    n = _note(client, "A", folderId=f)
    body = _batch(client, [n["id"]], "move", {"folderId": f})
    res = _by_id(body)[n["id"]]
    assert res == {"id": n["id"], "status": "unchanged"}
    assert _get(client, n["id"])["updatedAt"] == n["updatedAt"]


def test_move_to_unfiled(app, client):
    _login_as(app, "u1")
    f = _folder(client, "Research")
    n = _note(client, "A", folderId=f)
    body = _batch(client, [n["id"]], "move", {"folderId": None})
    assert _by_id(body)[n["id"]]["status"] == "changed"
    assert _get(client, n["id"])["folderId"] is None


def test_add_tag_keeps_other_tags_and_is_case_insensitive(app, client):
    _login_as(app, "u1")
    a = _note(client, "A", tags=["Swing"])
    b = _note(client, "B", tags=["earnings"])
    body = _batch(client, [a["id"], b["id"]], "addTag", {"tag": "Earnings"})
    assert _by_id(body)[a["id"]]["status"] == "changed"
    assert _get(client, a["id"])["tags"] == ["Swing", "Earnings"]
    # already there, in a different case: nothing written
    assert _by_id(body)[b["id"]] == {"id": b["id"], "status": "unchanged"}
    assert _get(client, b["id"])["updatedAt"] == b["updatedAt"]


def test_add_tag_to_a_note_at_the_cap_is_invalid_for_that_note_only(app, client):
    _login_as(app, "u1")
    full = _note(client, "Full", tags=[f"t{i}" for i in range(30)])
    ok = _note(client, "Ok")
    body = _batch(client, [full["id"], ok["id"]], "addTag", {"tag": "new"})
    res = _by_id(body)
    assert res[full["id"]]["status"] == "invalid"
    assert "cap" in res[full["id"]]["error"]
    assert res[ok["id"]]["status"] == "changed"
    assert body["failed"] == 1 and body["changed"] == 1


def test_remove_tag(app, client):
    _login_as(app, "u1")
    a = _note(client, "A", tags=["Swing", "earnings"])
    b = _note(client, "B", tags=["swing"])
    c = _note(client, "C", tags=["other"])
    body = _batch(client, [a["id"], b["id"], c["id"]], "removeTag", {"tag": "EARNINGS"})
    assert _get(client, a["id"])["tags"] == ["Swing"]
    assert _by_id(body)[b["id"]]["status"] == "unchanged"
    assert _by_id(body)[c["id"]]["status"] == "unchanged"


def test_favorite_and_unfavorite_never_advance_a_revision(app, client):
    _login_as(app, "u1")
    a, b = _note(client, "A"), _note(client, "B")
    assert client.post(f"/api/j2/notes/{b['id']}/favorite").status_code == 200
    body = _batch(client, [a["id"], b["id"]], "favorite")
    assert _by_id(body)[a["id"]] == {"id": a["id"], "status": "changed"}
    assert _by_id(body)[b["id"]] == {"id": b["id"], "status": "unchanged"}
    favs = {n["id"] for n in client.get("/api/j2/notes/favorites").json()["notes"]}
    assert favs == {a["id"], b["id"]}
    body = _batch(client, [a["id"], b["id"]], "unfavorite")
    assert all(r["status"] == "changed" and "updatedAt" not in r for r in body["results"])
    assert client.get("/api/j2/notes/favorites").json()["notes"] == []
    assert _get(client, a["id"])["updatedAt"] == a["updatedAt"]


def test_trash_then_restore(app, client):
    _login_as(app, "u1")
    a, b = _note(client, "A"), _note(client, "B")
    body = _batch(client, [a["id"], b["id"]], "trash")
    # Trashing does not advance the revision, so there is nothing to land.
    assert all(r == {"id": r["id"], "status": "changed"} for r in body["results"])
    assert _get(client, a["id"]) is None
    again = _batch(client, [a["id"]], "trash")
    assert _by_id(again)[a["id"]]["status"] == "unchanged"
    # A trashed note cannot be moved or tagged until restored.
    assert _by_id(_batch(client, [a["id"]], "addTag", {"tag": "x"}))[a["id"]]["status"] == "in_trash"
    body = _batch(client, [a["id"], b["id"]], "restore")
    for n in (a, b):
        res = _by_id(body)[n["id"]]
        now = _get(client, n["id"])
        assert res["status"] == "changed"
        assert now is not None
        # restore_note DOES advance the revision — the client must land it.
        assert res["updatedAt"] == now["updatedAt"]
    assert _by_id(_batch(client, [a["id"]], "restore"))[a["id"]]["status"] == "unchanged"


# ── partial failure ─────────────────────────────────────────────────────────

def test_a_mixed_batch_reports_every_note_in_the_order_sent(app, client):
    _login_as(app, "u1")
    ok = _note(client, "Ok")
    done = _note(client, "Done", tags=["x"])
    trashed = _note(client, "Trashed")
    assert client.delete(f"/api/j2/notes/{trashed['id']}").status_code == 200
    ids = ["missing", ok["id"], trashed["id"], done["id"], ok["id"]]  # ok named twice
    body = _batch(client, ids, "addTag", {"tag": "x"})
    assert [(r["id"], r["status"]) for r in body["results"]] == [
        ("missing", "not_found"),
        (ok["id"], "changed"),
        (trashed["id"], "in_trash"),
        (done["id"], "unchanged"),
    ]
    assert (body["changed"], body["unchanged"], body["failed"]) == (1, 1, 2)
    assert _get(client, ok["id"])["tags"] == ["x"]  # acted on once


# ── concurrency ─────────────────────────────────────────────────────────────

def test_a_tag_list_edited_meanwhile_is_re_read_and_merged_not_clobbered(app, client, monkeypatch):
    _login_as(app, "u1")
    n = _note(client, "A", tags=["a"])
    from api.services.journal_two import notes as notes_service
    real = notes_service.note_batch_heads
    calls = {"n": 0}

    def racing_heads(user_id, ids, conn=None):
        heads = real(user_id, ids, conn=conn)
        calls["n"] += 1
        if calls["n"] == 1:
            # Another writer (the editor, a second tab) lands between the
            # batch's read and its write.
            notes_service.update_note(user_id, n["id"], {"tags": ["a", "x"]})
        return heads

    monkeypatch.setattr(notes_service, "note_batch_heads", racing_heads)
    body = _batch(client, [n["id"]], "addTag", {"tag": "b"})
    assert _by_id(body)[n["id"]]["status"] == "changed"
    assert _get(client, n["id"])["tags"] == ["a", "x", "b"]


def test_a_note_that_keeps_changing_is_reported_as_a_conflict_and_not_written(app, client, monkeypatch):
    _login_as(app, "u1")
    n = _note(client, "A", tags=["a"])
    from api.services.journal_two import notes as notes_service

    def always_conflicts(*a, **k):
        raise notes_service.NoteConflictError("moved again")

    monkeypatch.setattr(notes_service, "update_note", always_conflicts)
    body = _batch(client, [n["id"]], "addTag", {"tag": "b"})
    assert _by_id(body)[n["id"]] == {"id": n["id"], "status": "conflict"}
    monkeypatch.undo()
    assert _get(client, n["id"])["tags"] == ["a"]


# ── export the selection ─────────────────────────────────────────────────────

def _export(client, ids, expect=200):
    r = client.post("/api/j2/notes/batch/export", json={"ids": ids})
    assert r.status_code == expect, r.text
    return r


def test_export_requires_a_signed_in_member(client):
    assert client.post("/api/j2/notes/batch/export", json={"ids": ["x"]}).status_code == 401


def test_export_is_a_zip_of_the_selected_notes_only_and_says_what_it_skipped(app, client):
    _login_as(app, "other")
    theirs = _note(client, "Theirs")
    _login_as(app, "u1")
    a = _note(client, "Alpha plan")
    b = _note(client, "Alpha plan")          # same title: must not overwrite
    _note(client, "Not selected")
    gone = _note(client, "Gone")
    assert client.delete(f"/api/j2/notes/{gone['id']}").status_code == 200
    r = _export(client, [a["id"], b["id"], gone["id"], theirs["id"]])
    assert r.headers["content-type"] == "application/zip"
    assert "attachment;" in r.headers["content-disposition"]
    assert r.headers["x-export-count"] == "2"
    assert r.headers["x-export-skipped"] == "2"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    mds = sorted(n for n in names if n.endswith(".md"))
    assert len(mds) == 2 and "Alpha plan.md" in mds
    assert all("Not selected" not in n and "Theirs" not in n for n in names)
    manifest = json.loads(zf.read("UCT_NOTEBOOK_EXPORT.json"))
    assert manifest["product"] == "uct-notebook-export" and manifest["note_count"] == 2
    issues = zf.read("EXPORT_ISSUES.txt").decode()
    assert gone["id"] in issues and theirs["id"] in issues


def test_export_merges_a_notes_own_zip_attachments_and_issues(app, client, monkeypatch):
    # A single-note export comes back as a ZIP when the note bundles files.
    # This pins the merge: the note's .md at the root, its attachments under
    # their own per-note path, and its issue lines carried into ONE issues file.
    _login_as(app, "u1")
    a = _note(client, "With image")
    b = _note(client, "Plain")
    from api.services.journal_two import notes_export
    real = notes_export.build_single_note_export

    def fake(user_id, note_id, conn=None):
        if note_id != a["id"]:
            return real(user_id, note_id, conn=conn)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("With image.md", "# With image\n![](attachments/u1/x/img/p.png)\n")
            zf.writestr("attachments/u1/x/img/p.png", b"PNGDATA")
            zf.writestr("EXPORT_ISSUES.txt", "- one attachment was too large")
        return buf.getvalue(), "With image-20260923.zip", "application/zip"

    monkeypatch.setattr(notes_export, "build_single_note_export", fake)
    r = _export(client, [a["id"], b["id"]])
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    assert {"With image.md", "Plain.md", "attachments/u1/x/img/p.png"} <= names
    assert zf.read("attachments/u1/x/img/p.png") == b"PNGDATA"
    assert "one attachment was too large" in zf.read("EXPORT_ISSUES.txt").decode()


def test_export_is_refused_while_another_export_holds_the_slot(app, client, monkeypatch):
    _login_as(app, "u1")
    a = _note(client, "A")
    from api.services.journal_two import notes_export
    monkeypatch.setattr(notes_export, "acquire_export_slot", lambda: False)
    r = _export(client, [a["id"]], expect=429)
    assert "already running" in r.json()["detail"]


def test_export_releases_its_slot_so_the_next_one_runs(app, client):
    _login_as(app, "u1")
    a = _note(client, "A")
    _export(client, [a["id"]])
    _export(client, [a["id"]])  # would be a 429 if the first leaked its slot


# ── fix round 1: Undo for move (B1), legacy tags (S2) ───────────────────────

def test_a_move_says_where_each_note_came_from(app, client):
    _login_as(app, "u1")
    f1, f2, dest = _folder(client, "One"), _folder(client, "Two"), _folder(client, "Dest")
    a = _note(client, "A", folderId=f1)
    b = _note(client, "B", folderId=f2)
    c = _note(client, "C")
    body = _batch(client, [a["id"], b["id"], c["id"]], "move", {"folderId": dest})
    res = _by_id(body)
    assert res[a["id"]]["fromFolderId"] == f1
    assert res[b["id"]]["fromFolderId"] == f2
    assert res[c["id"]]["fromFolderId"] is None and "fromFolderId" in res[c["id"]]


def test_undo_puts_every_note_back_where_it_came_from(app, client):
    _login_as(app, "u1")
    f1, f2, dest = _folder(client, "One"), _folder(client, "Two"), _folder(client, "Dest")
    a = _note(client, "A", folderId=f1)
    b = _note(client, "B", folderId=f2)
    c = _note(client, "C")
    ids = [a["id"], b["id"], c["id"]]
    moved = _by_id(_batch(client, ids, "move", {"folderId": dest}))
    back = _batch(client, ids, "move", {
        "folders": {i: moved[i]["fromFolderId"] for i in ids},
        "expectFolderId": dest,
    })
    assert back["changed"] == 3 and back["failed"] == 0
    assert [_get(client, i)["folderId"] for i in ids] == [f1, f2, None]
    # The Undo advanced each revision, and says so, so the client lands it.
    for i, r in _by_id(back).items():
        assert r["updatedAt"] == _get(client, i)["updatedAt"]


def test_undo_never_moves_a_note_that_was_moved_again_since(app, client):
    _login_as(app, "u1")
    f1, dest, elsewhere = _folder(client, "One"), _folder(client, "Dest"), _folder(client, "Elsewhere")
    a = _note(client, "A", folderId=f1)
    b = _note(client, "B", folderId=f1)
    ids = [a["id"], b["id"]]
    _batch(client, ids, "move", {"folderId": dest})
    # Another tab files B somewhere else before the member presses Undo.
    assert client.put(f"/api/j2/notes/{b['id']}", json={"folderId": elsewhere}).status_code == 200
    before = _get(client, b["id"])
    back = _by_id(_batch(client, ids, "move", {"folders": {a["id"]: f1, b["id"]: f1},
                                               "expectFolderId": dest}))
    assert back[a["id"]]["status"] == "changed"
    assert back[b["id"]] == {"id": b["id"], "status": "moved_since"}
    after = _get(client, b["id"])
    assert (after["folderId"], after["updatedAt"]) == (elsewhere, before["updatedAt"])


# ── fix round 3: the Undo is a real compare-and-set (R1-N3) ─────────────────

def _race_on(monkeypatch, note_id, concurrent_patch):
    """Make another tab's write land on `note_id` between the batch's READ of
    it and the Undo's write — the window a long Undo leaves open, since every
    note commits separately after one read of all the heads."""
    from api.services.journal_two import notes as notes_service
    real = notes_service.update_note
    fired = []

    def racing(user_id, nid, patch, conn=None, **kw):
        if nid == note_id and kw.get("expected_updated_at") and not fired:
            fired.append(1)
            real(user_id, nid, concurrent_patch)            # the other tab, no CAS
        return real(user_id, nid, patch, conn=conn, **kw)

    monkeypatch.setattr(notes_service, "update_note", racing)
    return fired


def test_a_move_landing_mid_undo_is_never_overwritten(app, client, monkeypatch):
    _login_as(app, "u1")
    f1, dest, elsewhere = _folder(client, "One"), _folder(client, "Dest"), _folder(client, "Elsewhere")
    a = _note(client, "A", folderId=f1)
    b = _note(client, "B", folderId=f1)
    ids = [a["id"], b["id"]]
    _batch(client, ids, "move", {"folderId": dest})
    fired = _race_on(monkeypatch, b["id"], {"folderId": elsewhere})
    back = _by_id(_batch(client, ids, "move", {"folders": {a["id"]: f1, b["id"]: f1},
                                               "expectFolderId": dest}))
    assert fired, "the race never ran"
    assert back[a["id"]]["status"] == "changed"
    assert back[b["id"]] == {"id": b["id"], "status": "moved_since"}
    assert _get(client, a["id"])["folderId"] == f1
    assert _get(client, b["id"])["folderId"] == elsewhere        # the other tab's move stands


def test_an_edit_mid_undo_is_re_read_and_the_note_still_goes_back(app, client, monkeypatch):
    _login_as(app, "u1")
    f1, dest = _folder(client, "One"), _folder(client, "Dest")
    b = _note(client, "B", folderId=f1)
    _batch(client, [b["id"]], "move", {"folderId": dest})
    fired = _race_on(monkeypatch, b["id"], {"title": "B, edited meanwhile"})
    back = _by_id(_batch(client, [b["id"]], "move", {"folders": {b["id"]: f1}, "expectFolderId": dest}))
    assert fired
    assert back[b["id"]]["status"] == "changed"
    after = _get(client, b["id"])
    assert (after["folderId"], after["title"]) == (f1, "B, edited meanwhile")
    assert back[b["id"]]["updatedAt"] == after["updatedAt"]


def test_undo_to_a_deleted_folder_fails_that_note_only_and_says_where_it_stayed(app, client):
    _login_as(app, "u1")
    f1, f2, dest = _folder(client, "One"), _folder(client, "Two"), _folder(client, "Dest")
    a = _note(client, "A", folderId=f1)
    b = _note(client, "B", folderId=f2)
    ids = [a["id"], b["id"]]
    _batch(client, ids, "move", {"folderId": dest})
    assert client.delete(f"/api/j2/note-folders/{f1}").status_code == 200
    before = _get(client, a["id"])
    back = _batch(client, ids, "move", {"folders": {a["id"]: f1, b["id"]: f2}, "expectFolderId": dest})
    res = _by_id(back)
    assert res[a["id"]] == {"id": a["id"], "status": "folder_gone",
                            "stayedInFolderId": dest, "stayedInFolderName": "Dest"}
    assert res[b["id"]]["status"] == "changed"
    after = _get(client, a["id"])
    assert (after["folderId"], after["updatedAt"]) == (dest, before["updatedAt"])   # untouched
    assert _get(client, b["id"])["folderId"] == f2


def test_a_legacy_spelled_tag_is_removed_and_not_added_twice(app, client, db_path):
    import sqlite3
    _login_as(app, "u1")
    n = _note(client, "Legacy", tags=["x"])
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE j2_notes SET tags = ? WHERE id = ?", ('["Q3 / Q4", "x"]', n["id"]))
        conn.commit()
    finally:
        conn.close()
    # The bulk bar builds its Remove chips from the notes' own spelling.
    added = _batch(client, [n["id"]], "addTag", {"tag": "q3/q4"})
    assert _by_id(added)[n["id"]]["status"] == "unchanged"
    removed = _batch(client, [n["id"]], "removeTag", {"tag": "Q3 / Q4"})
    assert _by_id(removed)[n["id"]]["status"] == "changed"
    assert _get(client, n["id"])["tags"] == ["x"]
