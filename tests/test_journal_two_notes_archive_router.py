"""Archive — wave 6, lane E, item 1.

What these pin:
  * an archived note LEAVES the default list, its count, search, the quick
    switcher, the graph (as a node AND as either end of an edge), the sidebar's
    folder counts and leaf rows, the tag tree/counts, favorites and recents —
    and it is listed, and counted, under the Archived entry (`folder_id=
    __archived__`), whose count agrees with its page;
  * ⛔ ARCHIVE IS NOT TRASH: nothing is deleted, the note still opens, the trash
    does not list it, and a trashed note cannot be archived;
  * ⛔ UNARCHIVE RESTORES THE NOTE EXACTLY WHERE IT WAS — same folder, same
    revision. Archive is a visibility flag: it never advances `updated_at`, so
    it can never turn an open editor's next save into a conflict (the reason is
    in `notes.set_note_archived`'s docstring);
  * the bulk bar's `archive` / `unarchive` ops answer per note.
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


def _note(client, title, **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _folder(client, name):
    r = client.post("/api/j2/note-folders", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["folder"]["id"]


def _archive(client, note_id, archived=True):
    return client.patch(f"/api/j2/notes/{note_id}/archive", json={"archived": archived})


def _list(client, **params):
    r = client.get("/api/j2/notes", params={"sort": "title", **params})
    assert r.status_code == 200, r.text
    body = r.json()
    titles = [n["title"] for n in body["notes"]]
    assert body["total"] == len(titles), "the count and the page disagree"
    return titles


def _link_doc(*target_ids):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "noteLink", "attrs": {"noteId": t}} for t in target_ids
    ]}]}


# ── the Archived entry ──────────────────────────────────────────────────────

def test_an_archived_note_leaves_the_default_list_and_joins_the_archive(app, client):
    _login_as(app, "u1")
    keep = _note(client, "Keep")
    gone = _note(client, "Gone")
    r = _archive(client, gone["id"])
    assert r.status_code == 200, r.text
    assert r.json()["note"]["archivedAt"]
    assert _list(client) == ["Keep"]
    assert _list(client, folder_id="__archived__") == ["Gone"]
    # Unarchive brings it back, and the archive empties.
    assert _archive(client, gone["id"], False).json()["note"]["archivedAt"] is None
    assert _list(client) == ["Gone", "Keep"]
    assert _list(client, folder_id="__archived__") == []
    assert keep["id"]  # non-vacuity: two notes really were made


def test_every_list_row_says_whether_it_is_archived(app, client):
    _login_as(app, "u1")
    n = _note(client, "N")
    rows = client.get("/api/j2/notes").json()["notes"]
    assert rows[0]["archivedAt"] is None
    _archive(client, n["id"])
    rows = client.get("/api/j2/notes", params={"folder_id": "__archived__"}).json()["notes"]
    assert rows[0]["archivedAt"]


def test_unarchive_restores_the_note_exactly_where_it_was(app, client):
    _login_as(app, "u1")
    fid = _folder(client, "Research")
    n = _note(client, "In a folder", folderId=fid)
    before = client.get(f"/api/j2/notes/{n['id']}").json()["note"]
    archived = _archive(client, n["id"]).json()["note"]
    assert archived["folderId"] == fid, "archive must not move the note out of its folder"
    # ⛔ The revision is untouched both ways: an open editor's baseline stays good.
    assert archived["updatedAt"] == before["updatedAt"]
    back = _archive(client, n["id"], False).json()["note"]
    assert back["folderId"] == fid
    assert back["updatedAt"] == before["updatedAt"]
    assert _list(client, folder_id=fid) == ["In a folder"]


def test_archive_is_idempotent_and_keeps_the_first_archive_time(app, client):
    _login_as(app, "u1")
    n = _note(client, "N")
    first = _archive(client, n["id"]).json()["note"]["archivedAt"]
    again = _archive(client, n["id"]).json()["note"]["archivedAt"]
    assert again == first


# ── archive is NOT trash ────────────────────────────────────────────────────

def test_archive_is_not_trash_nothing_is_deleted(app, client):
    _login_as(app, "u1")
    n = _note(client, "Kept safe")
    _archive(client, n["id"])
    got = client.get(f"/api/j2/notes/{n['id']}")
    assert got.status_code == 200, "an archived note still opens"
    assert got.json()["note"]["deletedAt"] is None
    assert _list(client, deleted="true") == [], "the trash does not list an archived note"


def test_a_trashed_note_cannot_be_archived(app, client):
    _login_as(app, "u1")
    n = _note(client, "Trashed")
    assert client.delete(f"/api/j2/notes/{n['id']}").status_code == 200
    assert _archive(client, n["id"]).status_code == 404
    # ⛔ And NOTHING was written: restored, it comes back into the library, not
    # the archive (a 404 alone could hide a write the read then filtered out).
    assert client.post(f"/api/j2/notes/{n['id']}/restore").status_code == 200
    assert _list(client) == ["Trashed"]
    assert _list(client, folder_id="__archived__") == []


def test_archive_refuses_a_non_boolean_and_another_members_note(app, client):
    _login_as(app, "u1")
    n = _note(client, "Mine")
    assert client.patch(f"/api/j2/notes/{n['id']}/archive", json={"archived": "yes"}).status_code == 400
    assert client.patch(f"/api/j2/notes/{n['id']}/archive", json={}).status_code == 400
    _login_as(app, "u2")
    assert _archive(client, n["id"]).status_code == 404


def test_an_archived_trashed_note_is_still_in_the_trash(app, client):
    _login_as(app, "u1")
    n = _note(client, "Both")
    _archive(client, n["id"])
    assert client.delete(f"/api/j2/notes/{n['id']}").status_code == 200
    assert _list(client, deleted="true") == ["Both"]
    assert _list(client, folder_id="__archived__") == []


# ── it leaves every default surface ─────────────────────────────────────────

def test_search_does_not_find_an_archived_note(app, client):
    _login_as(app, "u1")
    _note(client, "Semis live")
    gone = _note(client, "Semis archived")
    _archive(client, gone["id"])
    assert _list(client, q="semis") == ["Semis live"]
    # …but a search inside the Archived entry does.
    assert _list(client, q="semis", folder_id="__archived__") == ["Semis archived"]


def test_the_quick_switcher_does_not_offer_an_archived_note(app, client):
    _login_as(app, "u1")
    live = _note(client, "Rotation live")
    gone = _note(client, "Rotation archived")
    client.post(f"/api/j2/notes/{gone['id']}/opened")
    client.post(f"/api/j2/notes/{gone['id']}/favorite")
    _archive(client, gone["id"])
    got = client.get("/api/j2/notes/switcher", params={"q": "rotation"}).json()["notes"]
    assert [n["id"] for n in got] == [live["id"]]


def test_the_graph_drops_an_archived_note_as_a_node_and_as_either_end(app, client):
    _login_as(app, "u1")
    a = _note(client, "A")
    b = _note(client, "B")
    c = _note(client, "C", bodyJson=_link_doc(a["id"], b["id"]))
    graph = client.get("/api/j2/notes/graph").json()
    assert {n["id"] for n in graph["nodes"]} == {a["id"], b["id"], c["id"]}
    assert len(graph["edges"]) == 2  # non-vacuity: the edges exist first
    _archive(client, a["id"])
    graph = client.get("/api/j2/notes/graph").json()
    assert {n["id"] for n in graph["nodes"]} == {b["id"], c["id"]}
    assert [(e["source"], e["target"]) for e in graph["edges"]] == [(c["id"], b["id"])]
    degree = {n["id"]: n["degree"] for n in graph["nodes"]}
    assert degree[c["id"]] == 1, "an archived neighbour must not inflate degree"
    _archive(client, c["id"])  # the SOURCE end archived
    assert client.get("/api/j2/notes/graph").json()["edges"] == []


def test_folder_counts_and_leaf_rows_agree_with_the_list(app, client):
    _login_as(app, "u1")
    fid = _folder(client, "F")
    _note(client, "Live", folderId=fid)
    gone = _note(client, "Gone", folderId=fid)
    _note(client, "Loose")
    _archive(client, gone["id"])
    counts = client.get("/api/j2/notes/folder-counts").json()
    assert counts["counts"][fid] == 1
    assert counts["total"] == 2
    # The Archived entry's badge is its OWN list's total (one authority), the
    # same idiom as the Trash badge -- never a second COUNT written here.
    assert client.get("/api/j2/notes", params={"folder_id": "__archived__", "limit": 1}).json()["total"] == 1
    leaves = client.get("/api/j2/notes/by-folders", params={"ids": fid}).json()["byFolder"][fid]
    assert [n["title"] for n in leaves] == ["Live"]
    assert _list(client, folder_id=fid) == ["Live"]


def test_the_tag_tree_counts_what_the_tag_filter_lists(app, client):
    _login_as(app, "u1")
    _note(client, "Live", tags=["semis/nvda"])
    gone = _note(client, "Gone", tags=["semis/nvda", "swing"])
    _archive(client, gone["id"])
    tree = {n["key"]: n for n in client.get("/api/j2/notes/tags").json()["tree"]}
    flat = {t["tag"]: t["count"] for t in client.get("/api/j2/notes/tags").json()["tags"]}
    assert tree["semis"]["total"] == len(_list(client, tag="semis")) == 1
    assert "swing" not in flat, "a tag only an archived note carries leaves the cloud"


def test_favorites_and_recents_leave_out_an_archived_note(app, client):
    _login_as(app, "u1")
    live = _note(client, "Live")
    gone = _note(client, "Gone")
    for n in (live, gone):
        client.post(f"/api/j2/notes/{n['id']}/favorite")
        client.post(f"/api/j2/notes/{n['id']}/opened")
    _archive(client, gone["id"])
    favs = [n["id"] for n in client.get("/api/j2/notes/favorites").json()["notes"]]
    recents = [n["id"] for n in client.get("/api/j2/notes/recents").json()["notes"]]
    assert favs == [live["id"]]
    assert recents == [live["id"]]
    # Unarchive brings the favourite back — the star was never removed.
    _archive(client, gone["id"], False)
    favs = {n["id"] for n in client.get("/api/j2/notes/favorites").json()["notes"]}
    assert favs == {live["id"], gone["id"]}


# ── the bulk bar ────────────────────────────────────────────────────────────

def test_bulk_archive_and_unarchive_answer_per_note(app, client):
    _login_as(app, "u1")
    a = _note(client, "A")
    b = _note(client, "B")
    t = _note(client, "T")
    client.delete(f"/api/j2/notes/{t['id']}")
    _archive(client, b["id"])
    r = client.post("/api/j2/notes/batch", json={
        "ids": [a["id"], b["id"], t["id"], "nope"], "op": "archive"})
    assert r.status_code == 200, r.text
    by_id = {x["id"]: x["status"] for x in r.json()["results"]}
    assert by_id == {a["id"]: "changed", b["id"]: "unchanged",
                     t["id"]: "in_trash", "nope": "not_found"}
    # ⛔ No revision moved, so there is nothing for the client to land.
    assert all("updatedAt" not in x for x in r.json()["results"])
    assert _list(client) == []
    r = client.post("/api/j2/notes/batch", json={"ids": [a["id"], b["id"]], "op": "unarchive"})
    assert r.json()["changed"] == 2
    assert _list(client) == ["A", "B"]
