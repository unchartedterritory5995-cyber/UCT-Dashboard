"""Nested tags (Obsidian's `a/b/c`) — wave 5.

What these pin:
  * a tag is also the PARENT of every `tag/...` below it — filtering by it
    returns the whole subtree, and the count agrees with the page;
  * a "parent" is a whole level, never a prefix of letters ("research" is not
    the parent of "researcher"), and `%` / `_` in a tag are text;
  * ⛔ CONTROL: a FLAT tag (no `/`) returns what the old predicate returned —
    computed here by running the old SQL against the same rows, not by
    restating what the answer should be — with every difference NAMED: a
    parent now finds its children, and the old JSON LIKE's wildcard quirk is
    gone (it found notes the tag tree never counted, so a count and its list
    disagreed — fix round 1, S2);
  * tags saved BEFORE nested tags existed ("Q3 / Q4", stored verbatim by the
    old strip-only validator) and non-ASCII tags ("Élan", which the JSON text
    stores as a backslash-u escape) are found by the same key the tree counts
    them under — rows inserted without the API, because the API would
    normalise them and hide the case;
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
    # Decoded values compared by key, never a LIKE: "q_1" is the parent of
    # "q_1/plan" and not of "qx1/plan".
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
    _note(client, "E", ["q3xplan"])          # the old LIKE read `_` as a wildcard
    _note(client, "I", ["50x"])              # …and `%`
    _note(client, "F", ["earnings/q3"])
    _note(client, "G", [])
    trashed = _note(client, "H", ["swing"])
    assert client.delete(f"/api/j2/notes/{trashed['id']}").status_code == 200
    # Every way the new answer may differ from the old one, NAMED.
    children = {"earnings": {"F"}}                     # a parent finds its children
    wildcard_only = {"q3_plan": {"E"}, "50%": {"I"}}   # the quirk, now gone
    conn = sqlite3.connect(db_path)
    try:
        for flat in ["swing", "SWING", "earnings", "q3_plan", "50%", "missing"]:
            old = set(r[0] for r in conn.execute(
                "SELECT title FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                " AND lower(tags) LIKE ?",
                ("u1", f'%"{flat.lower()}"%'),
            ))
            new = set(_titles_for(client, flat))
            expected = (old - wildcard_only.get(flat, set())) | children.get(flat, set())
            assert new == expected, flat
        # Non-vacuity: the old predicate really did find the wildcard rows.
        assert "E" in set(r[0] for r in conn.execute(
            "SELECT title FROM j2_notes WHERE lower(tags) LIKE ?", ('%"q3_plan"%',)))
    finally:
        conn.close()


def test_a_wildcard_tag_lists_exactly_what_the_tree_counts(app, client):
    _login_as(app, "u1")
    _note(client, "Real", ["q3_plan"])
    _note(client, "Lookalike", ["q3xplan"])
    _note(client, "Fifty", ["50%"])
    _note(client, "Fifty-ish", ["50x"])
    tree = _tree(client)
    assert _titles_for(client, "q3_plan") == ["Real"]
    assert tree["q3_plan"]["total"] == 1
    assert _titles_for(client, "50%") == ["Fifty"]
    assert tree["50%"]["total"] == 1


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


def _raw_tags(db_path, note_id, tags, *, ensure_ascii=True):
    """Store `tags` EXACTLY as given — the way a note saved before nested tags
    (or by an importer/sync that bypassed the validator) holds them. Through
    the API they would be normalised, and the case would vanish.
    `ensure_ascii=False` writes raw UTF-8 instead of backslash-u escapes, as a
    writer using SQLite's own JSON functions would (review R1-N1)."""
    import json
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE j2_notes SET tags = ? WHERE id = ?",
                     (json.dumps(tags, ensure_ascii=ensure_ascii), note_id))
        conn.commit()
    finally:
        conn.close()


def _stored_tags(db_path, note_id):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT tags FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
    finally:
        conn.close()


def test_the_tree_total_is_what_filtering_by_that_tag_returns(app, client, db_path):
    _login_as(app, "u1")
    _note(client, "a", ["x"])
    _note(client, "b", ["x/y"])
    _note(client, "c", ["x", "x/y/z"])
    _note(client, "d", ["xy"])
    # Legacy + non-ASCII rows, inserted without the API (review S2 / N2).
    _raw_tags(db_path, _note(client, "legacy", ["t"])["id"], ["Q3 / Q4"])
    _raw_tags(db_path, _note(client, "legacy2", ["t"])["id"], ["q3/q4", "X / Y"])
    _raw_tags(db_path, _note(client, "accent upper", ["t"])["id"], ["ÉLAN"])
    _raw_tags(db_path, _note(client, "accent lower", ["t"])["id"], ["élan/vital"])
    tree = _tree(client)
    # Non-vacuity: the legacy and non-ASCII keys really are in the tree.
    assert {"q3", "q3/q4", "élan", "élan/vital", "x/y"} <= set(tree)
    assert tree["q3/q4"]["total"] == 2
    assert tree["élan"]["total"] == 2
    for key, node in tree.items():
        assert node["total"] == len(_titles_for(client, node["path"])), key


def test_a_legacy_spelling_is_found_by_every_spelling_of_it(app, client, db_path):
    _login_as(app, "u1")
    _raw_tags(db_path, _note(client, "legacy", ["t"])["id"], ["Q3 / Q4"])
    for asked in ["Q3 / Q4", "q3/q4", "Q3/Q4/", " q3 /q4 "]:
        assert _titles_for(client, asked) == ["legacy"], asked
    assert _titles_for(client, "q3") == ["legacy"]


def test_case_folds_beyond_ascii(app, client, db_path):
    _login_as(app, "u1")
    _note(client, "one", ["Élan"])
    _raw_tags(db_path, _note(client, "two", ["t"])["id"], ["élan"])
    # One note carrying two spellings of the same tag still counts ONCE.
    _raw_tags(db_path, _note(client, "three", ["t"])["id"], ["ÉLAN", "élan"])
    assert _titles_for(client, "élan") == ["one", "three", "two"]
    assert _titles_for(client, "ÉLAN") == ["one", "three", "two"]
    body = client.get("/api/j2/notes/tags").json()
    assert [t["count"] for t in body["tags"]] == [3], "one tag, counted once per note — not two chips"
    tree = {n["key"]: n for n in body["tree"]}
    assert (tree["élan"]["own"], tree["élan"]["total"]) == (3, 3)


def test_a_raw_utf8_row_counts_and_filters_identically(app, client, db_path):
    """R1-N1: the prefilter is sound whatever the writer. A row holding raw
    UTF-8 (no backslash-u escape) was counted by the tree and not found by
    `tag=`; it now counts and filters exactly like an escaped one."""
    _login_as(app, "u1")
    raw_id = _note(client, "raw", ["t"])["id"]
    _raw_tags(db_path, raw_id, ["Élan", "ÉLAN/vital"], ensure_ascii=False)
    _raw_tags(db_path, _note(client, "escaped", ["t"])["id"], ["élan"])
    _note(client, "plain ascii", ["elan"])            # NOT the same key: e != é
    stored = _stored_tags(db_path, raw_id)
    # Non-vacuity: the row really is raw UTF-8, with no escape to pass on.
    assert "É" in stored and "\\u" not in stored, stored
    tree = _tree(client)
    assert tree["élan"]["total"] == 2
    assert tree["élan/vital"]["total"] == 1
    for asked in ["élan", "Élan", "ÉLAN"]:
        assert _titles_for(client, asked) == ["escaped", "raw"], asked
    assert _titles_for(client, "élan/vital") == ["raw"]
    assert _titles_for(client, "elan") == ["plain ascii"]
    for key, node in tree.items():
        assert node["total"] == len(_titles_for(client, node["path"])), key
    r = client.get("/api/j2/notes", params={"q": "Élan"})
    assert sorted(n["title"] for n in r.json()["notes"]) == ["escaped", "raw"]


def test_the_search_box_finds_a_legacy_or_non_ascii_tag(app, client, db_path):
    _login_as(app, "u1")
    _raw_tags(db_path, _note(client, "legacy", ["t"])["id"], ["Q3 / Q4"])
    _note(client, "accent", ["Élan"])
    for q, title in [("q3/q4", "legacy"), ("élan", "accent")]:
        r = client.get("/api/j2/notes", params={"q": q})
        assert r.status_code == 200, r.text
        assert [n["title"] for n in r.json()["notes"]] == [title], q


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
