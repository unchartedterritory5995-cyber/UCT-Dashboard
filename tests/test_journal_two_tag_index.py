"""The tag index `j2_note_tag_index` (wave 10, lane 10A) answers exactly what the per-note
scan did.

Every tag read -- the search box's "a note whose tag IS the text typed", the `tag=` filter,
the rename roster and `GET /notes/tags` -- used to read every note's `tags` JSON and test it
in Python (~25 ms of every `q=` search, ~56 ms of `tag=setups`, the whole json_each pass of
`/notes/tags`, at 50k notes: docs/notebook/perf-budgets.md §7). They now read an index kept
by PURE-SQL triggers, found by a SUPERSET key (`fold`) and decided by the SAME exact tests
(`j2_tag_is` / `j2_tag_match`). The per-note scan stays as the fallback until the index is
built, so it is also the ORACLE here: every read runs both ways and must agree.

Pinned:
  * the differential, over randomized libraries holding every tag shape the identity treats
    specially: nested paths, case variants, spaces/tabs/slashes `tag_key` normalises away,
    non-ASCII ("Élan", the Kelvin sign folding to "k"), numbers beside their text twin, nested
    arrays, nulls, duplicates, `%`/`_`; trashed, archived and another member's notes (no door
    can store anything but strings -- `_validate_tags` -- so the rest is raw data);
  * the triggers keep the rows EXACTLY `json_each` of each note's current `tags`, through
    insert, tag update, a non-tag update and delete;
  * the Python and SQL halves of `fold` agree (one character table, imported, never retyped);
  * a database without the index is built in place (and the build is recorded in the same
    transaction), and a renumbering of j2_notes' rowids is rebuilt at the next boot.
"""
from __future__ import annotations

import json
import random
import sqlite3
import uuid

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"

_POOL = ["earnings", "Earnings", "EARNINGS", "setups", "setups/breakout", "Setups / Breakout",
         "setups//vcp", "/setups/pullback/", " research ", "research/semis", "Research/Semis",
         "research\tsemis", "researchers", "Q3 / Q4", "q3/q4", "élan", "Élan", "Kelvin", "kelvin",
         "50%", "a_b", "macro", "macro/rates", "x", 1, "1", 2.5, ["nested"], None, "   ", "/"]


def _tags(rng):
    k = rng.randint(0, 4)
    return [rng.choice(_POOL) for _ in range(k)]


def _library(tmp_path, seed, n=250):
    rng = random.Random(seed)
    c = sqlite3.connect(str(tmp_path / f"t{seed}.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    for i in range(n):
        ts = f"2026-09-{1 + (i % 25):02d}T00:00:00+00:00"
        roll = rng.random()
        deleted = ts if roll < 0.06 else None
        archived = ts if 0.06 <= roll < 0.12 else None
        user = U if rng.random() < 0.9 else "u2"
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at,"
                  " updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (uuid.UUID(int=rng.getrandbits(128)).hex, user, f"note {i}", '{"type":"doc"}',
                   "breakout text" if i % 7 == 0 else "plain", json.dumps(_tags(rng)), ts, ts, deleted, archived))
    c.commit()
    return c


def _unbuilt(c):
    """Run the next reads down the per-note scan (the index is 'not built')."""
    class _Scope:
        def __enter__(self):
            c.execute("SAVEPOINT unbuilt")
            c.execute("DELETE FROM j2_schema_builds WHERE name = 'j2_note_tag_index'")

        def __exit__(self, *exc):
            c.execute("ROLLBACK TO unbuilt")
            c.execute("RELEASE unbuilt")
    return _Scope()


def _keys():
    out = set()
    for v in _POOL:
        k = notes_svc.tag_key(v)
        if k:
            out.add(k)
            out.add(k.split("/")[0])
    return sorted(out | {"setu", "research/sem", "nope", "k", "élan", "Élan".lower()})


@pytest.mark.parametrize("seed", [11, 12, 13])
def test_every_tag_read_answers_what_the_per_note_scan_answered(tmp_path, seed):
    c = _library(tmp_path, seed)
    try:
        assert notes_svc._tag_index_ready(c)
        checked = hits = 0
        for key in _keys():
            got = (notes_svc.list_and_count_notes(U, tag=key, limit=500, conn=c),
                   notes_svc.list_and_count_notes(U, q=key, limit=500, conn=c),
                   notes_svc.list_and_count_notes(U, q=key, sort="relevance", limit=500, conn=c),
                   notes_svc.list_and_count_notes(U, tag=key, deleted=True, limit=500, conn=c),
                   notes_svc.list_and_count_notes(U, folder_id="__archived__", tag=key, limit=500, conn=c),
                   notes_svc.tag_member_notes(U, key, conn=c))
            with _unbuilt(c):
                assert not notes_svc._tag_index_ready(c)
                want = (notes_svc.list_and_count_notes(U, tag=key, limit=500, conn=c),
                        notes_svc.list_and_count_notes(U, q=key, limit=500, conn=c),
                        notes_svc.list_and_count_notes(U, q=key, sort="relevance", limit=500, conn=c),
                        notes_svc.list_and_count_notes(U, tag=key, deleted=True, limit=500, conn=c),
                        notes_svc.list_and_count_notes(U, folder_id="__archived__", tag=key, limit=500, conn=c),
                        notes_svc.tag_member_notes(U, key, conn=c))
            assert got == want, key
            checked += 1
            hits += got[0][1] > 0
        got_tree = notes_svc.tag_counts_and_tree(U, conn=c)
        with _unbuilt(c):
            want_tree = notes_svc.tag_counts_and_tree(U, conn=c)
        assert got_tree == want_tree
        # non-vacuity: many keys matched notes, and the cloud is not empty
        assert checked == len(_keys()) >= 20 and hits >= 12, (checked, hits)
        assert len(got_tree["tags"]) >= 10 and got_tree["tree"], got_tree
    finally:
        c.close()


def _index_rows(c):
    return sorted((r[0], json.dumps(r[1]), r[2]) for r in c.execute(
        "SELECT note_id, tag, user_id FROM j2_note_tag_index"))


def _json_each_rows(c):
    return sorted((r[0], json.dumps(r[1]), r[2]) for r in c.execute(
        "SELECT n.id, je.value, n.user_id FROM j2_notes n,"
        " json_each(CASE WHEN json_valid(n.tags) THEN n.tags ELSE '[]' END) je WHERE je.value IS NOT NULL"))


def test_the_triggers_keep_the_rows_exactly_the_notes_tags(tmp_path):
    c = _library(tmp_path, 21, n=60)
    try:
        assert _index_rows(c) == _json_each_rows(c) != []
        ids = [r[0] for r in c.execute("SELECT id FROM j2_notes ORDER BY rowid")]
        c.execute("UPDATE j2_notes SET tags = ? WHERE id = ?", (json.dumps(["fresh", "Fresh/Child", 3]), ids[0]))
        c.execute("UPDATE j2_notes SET tags = '[]' WHERE id = ?", (ids[1],))
        c.execute("UPDATE j2_notes SET tags = 'not json' WHERE id = ?", (ids[2],))
        c.execute("UPDATE j2_notes SET title = 'renamed', body_plain = 'x' WHERE id = ?", (ids[3],))
        c.execute("DELETE FROM j2_notes WHERE id = ?", (ids[4],))
        c.commit()          # the door below takes BEGIN IMMEDIATE (wave 10C's atomic write)
        owner = c.execute("SELECT user_id FROM j2_notes WHERE id = ?", (ids[5],)).fetchone()[0]
        note, changed = notes_svc.patch_note_tags(owner, ids[5], ["patched"], [], conn=c)     # the door
        assert note is not None and changed and "patched" in note["tags"]
        c.commit()
        assert _index_rows(c) == _json_each_rows(c)
        assert c.execute("SELECT count(*) FROM j2_note_tag_index WHERE note_id = ?", (ids[4],)).fetchone()[0] == 0
    finally:
        c.close()


def test_the_python_and_sql_halves_of_the_fold_agree():
    rng = random.Random(7)
    alphabet = "abcXYZ019/_%- \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f"
    c = sqlite3.connect(":memory:")
    sql = "SELECT " + j2db._tag_fold_sql("?")
    for _ in range(500):
        s = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 12)))
        assert c.execute(sql, (s,)).fetchone()[0] == notes_svc._tag_fold(s.lower()), repr(s)
    # and the removed set is exactly what tag_key may remove on ASCII: its whitespace, and "/"
    assert set(j2db._TAG_FOLD_REMOVED) == {c for c in range(128) if chr(c).isspace()} | {ord("/")}
    c.close()


def test_a_database_without_the_index_is_built_in_place(tmp_path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    for name in ("j2_note_tag_index_ai", "j2_note_tag_index_au", "j2_note_tag_index_ad"):
        c.execute(f"DROP TRIGGER {name}")
    c.execute("DROP TABLE j2_note_tag_index")
    c.execute("DELETE FROM j2_schema_builds")
    for i in range(5):
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
                  " VALUES (?,?,?,?,?,?,?,?)", (f"n{i}", U, f"n{i}", "{}", "", json.dumps(["setups", f"t{i}"]),
                                                "2026-09-01", "2026-09-01"))
    c.commit()
    c.close()
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    assert notes_svc._tag_index_ready(c)
    assert _index_rows(c) == _json_each_rows(c) and len(_index_rows(c)) == 10
    rows, total = notes_svc.list_and_count_notes(U, tag="setups", conn=c)
    assert total == 5
    c.close()


def test_a_renumbering_of_the_notes_is_rebuilt_at_the_next_boot(tmp_path):
    c = _library(tmp_path, 31, n=40)
    try:
        want = notes_svc.list_and_count_notes(U, tag="setups", limit=500, conn=c)
        c.execute("UPDATE j2_notes SET rowid = 100000 - rowid")
        c.commit()
        bad = c.execute("SELECT count(*) FROM j2_note_tag_index t WHERE t.note_rowid IS NOT"
                        " (SELECT x.rowid FROM j2_notes x WHERE x.id = t.note_id)").fetchone()[0]
        assert bad > 0                                   # non-vacuity: it really drifted
        out = j2db._ensure_note_tag_index(c)
        assert out["rebuilt_for_drift"], out
        assert _index_rows(c) == _json_each_rows(c)
        assert notes_svc.list_and_count_notes(U, tag="setups", limit=500, conn=c) == want
    finally:
        c.close()


def test_a_raw_json_true_tag_is_found_where_the_cloud_counts_it(tmp_path):
    """No door can store a boolean tag (`_validate_tags` takes strings only), but raw data
    can. json_each reads JSON `true` as the integer 1, so the tag cloud has always counted
    it under "1" -- and the per-note scan's TEXT prefilter looks for "1" in `[true]` and
    never found it, so the cloud and its own filter disagreed. The index reads the same
    json_each value the cloud does: the filter now finds what the cloud counts."""
    c = sqlite3.connect(str(tmp_path / "b.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('b1', ?, 'b', '{}', '', '[true]', '2026-09-01', '2026-09-01')", (U,))
    c.commit()
    cloud = {t["tag"]: t["count"] for t in notes_svc.tag_counts_and_tree(U, conn=c)["tags"]}
    assert cloud == {"1": 1}, cloud
    assert [n["id"] for n in notes_svc.list_notes(U, tag="1", conn=c)] == ["b1"]
    c.close()
