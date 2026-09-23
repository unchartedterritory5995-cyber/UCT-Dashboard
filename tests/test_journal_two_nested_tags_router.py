"""Nested tags (Obsidian's `a/b/c`) — wave 5.

What these pin:
  * a tag is also the PARENT of every `tag/...` below it — filtering by it
    returns the whole subtree, and the count agrees with the page;
  * a "parent" is a whole level, never a prefix of letters ("research" is not
    the parent of "researcher"), and `_` in a parent is text for its children
    (the exact-match half keeps the old JSON LIKE, wildcards and all — that is
    the flat-tag control's point, and fixing that quirk is a separate change);
  * ⛔ CONTROL: a FLAT tag (no `/`) returns exactly what the old predicate
    returned — computed here by running the old SQL against the same rows,
    not by restating what the answer should be;
  * saving normalises each level, so the tree has no empty or doubled levels;
  * the tree's counts are DISTINCT notes per subtree, with implied parents.
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


def _note(client, title, tags):
    r = client.post("/api/j2/notes", json={"title": title, "tags": tags})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _titles_for(client, tag):
    r = client.get("/api/j2/notes", params={"tag": tag, "sort": "title"})
    assert r.status_code == 200, r.text
    body = r.json()
    titles = sorted(n["title"] for n in body["notes"])
    assert body["total"] == len(titles), "the count and the page disagree"
    return titles


# ── the parent includes its children ────────────────────────────────────────

def test_a_parent_tag_returns_its_whole_subtree(app, client):
    _login_as(app, "u1")
    _note(client, "Top", ["research"])
    _note(client, "Mid", ["research/semis"])
    _note(client, "Deep", ["Research/Semis/NVDA"])
    _note(client, "Letters only", ["researcher"])
    _note(client, "Elsewhere", ["other/research"])
    assert _titles_for(client, "research") == ["Deep", "Mid", "Top"]
    assert _titles_for(client, "RESEARCH") == ["Deep", "Mid", "Top"]


def test_a_child_tag_returns_itself_and_below_not_its_parent(app, client):
    _login_as(app, "u1")
    _note(client, "Top", ["research"])
    _note(client, "Mid", ["research/semis"])
    _note(client, "Deep", ["research/semis/nvda"])
    _note(client, "Sibling", ["research/software"])
    assert _titles_for(client, "research/semis") == ["Deep", "Mid"]
    assert _titles_for(client, "research/semis/nvda") == ["Deep"]


def test_an_underscore_in_a_parent_is_text_for_its_children(app, client):
    # The CHILD half of the predicate compares decoded values, so "q_1" is the
    # parent of "q_1/plan" and not of "qx1/plan". (The EXACT half is the old
    # JSON LIKE, kept byte-identical on purpose — see the flat-tag control.)
    _login_as(app, "u1")
    _note(client, "Real child", ["q_1/plan"])
    _note(client, "Lookalike", ["qx1/plan"])
    assert _titles_for(client, "q_1") == ["Real child"]


def test_a_note_with_both_parent_and_child_is_listed_once(app, client):
    _login_as(app, "u1")
    _note(client, "Both", ["research", "research/semis"])
    assert _titles_for(client, "research") == ["Both"]


# ── ⛔ CONTROL: a flat tag behaves exactly as before ─────────────────────────

def test_flat_tags_return_exactly_what_the_old_predicate_returned(app, client, db_path):
    _login_as(app, "u1")
    _note(client, "A", ["swing"])
    _note(client, "B", ["Swing", "earnings"])
    _note(client, "C", ["swinging"])
    _note(client, "D", ["q3_plan"])
    _note(client, "E", ["q3xplan"])          # the old LIKE treats `_` as a wildcard
    _note(client, "I", ["50x"])              # …and `%` — a pre-existing quirk this
                                             # wave deliberately does NOT change
    _note(client, "F", ["earnings/q3"])
    _note(client, "G", [])
    trashed = _note(client, "H", ["swing"])
    assert client.delete(f"/api/j2/notes/{trashed['id']}").status_code == 200
    conn = sqlite3.connect(db_path)
    try:
        for flat in ["swing", "SWING", "earnings", "q3_plan", "50%", "missing"]:
            old = sorted(r[0] for r in conn.execute(
                "SELECT title FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                " AND lower(tags) LIKE ?",
                ("u1", f'%"{flat.lower()}"%'),
            ))
            new = _titles_for(client, flat)
            if flat == "earnings":
                # The ONE intended difference: "earnings" now also parents
                # "earnings/q3". Everything the old predicate found is still found.
                assert set(old) <= set(new) and set(new) - set(old) == {"F"}
            else:
                assert new == old, flat
    finally:
        conn.close()


# ── saving normalises each level ────────────────────────────────────────────

@pytest.mark.parametrize("raw, stored", [
    (["Research / Semis"], ["Research/Semis"]),
    (["research//semis/"], ["research/semis"]),
    (["/a/b/"], ["a/b"]),
    (["  swing  "], ["swing"]),                  # flat: only the old strip
    (["a/b", "A / B"], ["a/b"]),                 # same tag, deduped
    (["///"], []),                               # nothing left is no tag
])
def test_saving_normalises_each_level(app, client, raw, stored):
    _login_as(app, "u1")
    assert _note(client, "n", raw)["tags"] == stored


# ── the tree ────────────────────────────────────────────────────────────────

def _tree(client):
    r = client.get("/api/j2/notes/tags")
    assert r.status_code == 200, r.text
    return {n["key"]: n for n in r.json()["tree"]}


def test_the_tree_counts_distinct_notes_per_subtree(app, client):
    _login_as(app, "u1")
    _note(client, "Both", ["research", "research/semis"])
    _note(client, "Mid", ["research/semis"])
    _note(client, "Deep", ["research/semis/nvda"])
    _note(client, "Flat", ["swing"])
    tree = _tree(client)
    assert tree["research"]["own"] == 1
    assert tree["research"]["total"] == 3          # Both, Mid, Deep — Both once
    assert tree["research/semis"]["own"] == 2
    assert tree["research/semis"]["total"] == 3
    assert tree["research/semis/nvda"] == {
        "path": "research/semis/nvda", "key": "research/semis/nvda", "own": 1, "total": 1,
    }
    assert tree["swing"] == {"path": "swing", "key": "swing", "own": 1, "total": 1}


def test_a_parent_named_only_through_a_child_is_still_a_node(app, client):
    _login_as(app, "u1")
    _note(client, "Only child", ["Macro/Rates"])
    tree = _tree(client)
    assert tree["macro"] == {"path": "Macro", "key": "macro", "own": 0, "total": 1}
    assert tree["macro/rates"]["own"] == 1


def test_the_tree_total_is_what_filtering_by_that_tag_returns(app, client):
    _login_as(app, "u1")
    _note(client, "a", ["x"])
    _note(client, "b", ["x/y"])
    _note(client, "c", ["x", "x/y/z"])
    _note(client, "d", ["xy"])
    for key, node in _tree(client).items():
        assert node["total"] == len(_titles_for(client, node["path"])), key


def test_the_tree_is_owner_scoped_and_ignores_the_trash(app, client):
    _login_as(app, "other")
    _note(client, "Theirs", ["secret/plan"])
    _login_as(app, "u1")
    gone = _note(client, "Gone", ["old/idea"])
    assert client.delete(f"/api/j2/notes/{gone['id']}").status_code == 200
    _note(client, "Mine", ["mine/plan"])
    keys = set(_tree(client))
    assert keys == {"mine", "mine/plan"}


def test_the_flat_tag_list_is_unchanged_for_existing_readers(app, client):
    _login_as(app, "u1")
    _note(client, "a", ["swing", "research/semis"])
    body = client.get("/api/j2/notes/tags").json()
    assert sorted(t["tag"] for t in body["tags"]) == ["research/semis", "swing"]
    assert all(set(t) == {"tag", "count"} for t in body["tags"])


def test_tags_requires_a_signed_in_member(client):
    assert client.get("/api/j2/notes/tags").status_code == 401
