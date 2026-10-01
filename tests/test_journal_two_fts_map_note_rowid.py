"""The search's integer hop: `j2_notes_fts_map.note_rowid` (wave 10, lane 10A).

A full-text match used to reach its note through FTS rowid -> `note_id` TEXT ->
j2_notes' TEXT primary key -> rowid: three lookups per match, ~15k matches for a
common term at 50k notes. The map now carries the note's rowid, maintained by the FTS
triggers, and `idx_j2_notes_fts_map_rowid_note (fts_rowid, note_rowid)` answers the
hop from the index alone (docs/notebook/perf-budgets.md §7).

`note_rowid` copies j2_notes' IMPLICIT rowid -- the value db.py's own comment refuses to
KEY on, because a logical dump/restore renumbers it. What is pinned here, and why:
  * every trigger path (insert, the body/title update, delete) keeps the column equal
    to the note's rowid, and a raw INSERT that bypasses every door still gets it;
  * the trigger bodies in `_J2_SCHEMA` and in `_J2_NOTES_FTS_TRIGGERS_DDL` are the
    same text, so a fresh database and an upgraded one run one trigger;
  * a database in the PRE-wave-10 shape (two-column map, old triggers, the old
    `idx_j2_notes_fts_map_rowid (fts_rowid)` index) is upgraded IN PLACE by
    `ensure_schema`: column filled, triggers replaced, the covering index built
    under its NEW name and the old one dropped. A changed definition under the old
    name would be a no-op on every existing database (review M-7, perf-budgets.md
    §2) -- the index-column assertion is what goes red if that happens;
  * a dump/restore that RENUMBERS j2_notes is repaired at the next boot, and search
    then returns the right notes;
  * ⛔ fix round 1 (review I-2): the readers trust `note_rowid` only while the upgrade is
    RECORDED (`j2_schema_builds`, in the upgrade's own transaction, which also makes the
    trigger swap atomic). An upgrade that FAILS -- on an old-shaped database, or on a
    drift repair -- leaves the map unrecorded, and every search answers through the
    pre-wave-10 `note_id` hop: the same notes, never `[]`.
"""
from __future__ import annotations

import json
import re
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"

# The PRE-wave-10 shape, spelled as it shipped (db.py at c7e140b9e). A description of
# history, not a copy of the current code: the current code must turn THIS into the
# new shape.
_OLD_MAP = "CREATE TABLE j2_notes_fts_map (note_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL)"
_OLD_TRIGGERS = """
CREATE TRIGGER j2_notes_fts_ai AFTER INSERT ON j2_notes BEGIN
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;
CREATE TRIGGER j2_notes_fts_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    DELETE FROM j2_notes_fts_map WHERE note_id = old.id;
END;
CREATE TRIGGER j2_notes_fts_au
AFTER UPDATE OF title, body_plain ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT OR REPLACE INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;
"""
_OLD_INDEX = "CREATE INDEX idx_j2_notes_fts_map_rowid ON j2_notes_fts_map(fts_rowid)"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """A DATA_DIR holding the v4/v5 flags, as production's does: those migrations are
    then no-ops, so whatever brings an old map up to date is the wave-10 step itself
    (a v4 rebuild would resync the map on its own and hide a broken upgrade)."""
    d = tmp_path / "data"
    d.mkdir()
    for flag in (".notebook_migration_v4", ".notebook_migration_v5"):
        (d / flag).write_bytes(b"1")
    monkeypatch.setenv("DATA_DIR", str(d))
    return d


def _conn(path):
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def _insert(c, nid, text, user=U, title=None):
    body = json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
              " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
              (nid, user, title or nid, body, text, "[]",
               "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"))


def _map_agrees(c):
    """[(note_id, map note_rowid, the note's rowid)] for every row that disagrees."""
    return [tuple(r) for r in c.execute(
        "SELECT m.note_id, m.note_rowid, n.rowid FROM j2_notes_fts_map m"
        " LEFT JOIN j2_notes n ON n.id = m.note_id WHERE m.note_rowid IS NOT n.rowid")]


def _index_cols(c, name):
    return [r[2] for r in c.execute(f"PRAGMA index_info('{name}')")]


def test_the_triggers_keep_note_rowid_equal_to_the_notes_rowid(tmp_path, data_dir):
    c = _conn(tmp_path / "t.db")
    j2db.ensure_schema(c)
    for i in range(5):
        _insert(c, f"n{i}", f"breakout number {i}")
    c.commit()
    # non-vacuity: every note has a map row carrying a real rowid
    rows = c.execute("SELECT count(*), count(note_rowid) FROM j2_notes_fts_map").fetchone()
    assert tuple(rows) == (5, 5), tuple(rows)
    assert _map_agrees(c) == []
    # the update trigger (title/body_plain) rewrites the row; it must still agree
    c.execute("UPDATE j2_notes SET body_plain = 'changed text', title = 'T' WHERE id = 'n2'")
    c.execute("DELETE FROM j2_notes WHERE id = 'n3'")
    c.commit()
    assert _map_agrees(c) == []
    assert c.execute("SELECT count(*) FROM j2_notes_fts_map WHERE note_id = 'n3'").fetchone()[0] == 0
    # the door writer path agrees too
    n = notes_svc.create_note(U, {"title": "door", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "via the door"}]}]}}, conn=c)
    assert _map_agrees(c) == [], n["id"]


def _trigger_bodies(text):
    out = {}
    for m in re.finditer(r"CREATE TRIGGER (?:IF NOT EXISTS )?(j2_notes_fts_a[idu])(.*?)END;", text, re.S):
        out[m.group(1)] = " ".join(m.group(2).split())
    return out


def test_the_two_copies_of_the_fts_triggers_are_the_same_text():
    fresh = _trigger_bodies(j2db._J2_SCHEMA)
    upgrade = _trigger_bodies(j2db._J2_NOTES_FTS_TRIGGERS_DDL)
    assert set(fresh) == {"j2_notes_fts_ai", "j2_notes_fts_au", "j2_notes_fts_ad"}, sorted(fresh)
    assert fresh == upgrade
    assert "note_rowid" in fresh["j2_notes_fts_ai"] and "note_rowid" in fresh["j2_notes_fts_au"]


def _build_old_shape(path):
    """A database exactly as a pre-wave-10 build leaves it, holding notes the OLD
    triggers indexed (so their map rows have no note_rowid at all)."""
    c = _conn(path)
    j2db.ensure_schema(c)
    c.execute("DROP TRIGGER j2_notes_fts_ai")
    c.execute("DROP TRIGGER j2_notes_fts_au")
    c.execute("DROP TRIGGER j2_notes_fts_ad")
    c.execute("DROP INDEX IF EXISTS idx_j2_notes_fts_map_rowid_note")
    c.execute("DROP TABLE j2_notes_fts_map")
    c.execute(_OLD_MAP)
    c.executescript(_OLD_TRIGGERS)
    c.execute(_OLD_INDEX)
    for i in range(6):
        _insert(c, f"n{i}", "breakout over the pivot" if i % 2 else "a quiet range")
    _insert(c, "other", "breakout over the pivot", user="u2")
    # a pre-wave-10 database has no record of the upgrade (ensure_schema above made one)
    c.execute("DELETE FROM j2_schema_builds WHERE name = ?", (j2db._FTS_MAP_BUILD,))
    c.commit()
    assert "note_rowid" not in {r[1] for r in c.execute("PRAGMA table_info(j2_notes_fts_map)")}
    return c


def test_an_old_shaped_database_is_upgraded_in_place(tmp_path, data_dir):
    path = tmp_path / "old.db"
    _build_old_shape(path).close()
    c = _conn(path)
    j2db.ensure_schema(c)
    # the column, filled for the rows the OLD triggers wrote
    assert "note_rowid" in {r[1] for r in c.execute("PRAGMA table_info(j2_notes_fts_map)")}
    assert c.execute("SELECT count(*) FROM j2_notes_fts_map").fetchone()[0] == 7
    assert _map_agrees(c) == []
    # the triggers now maintain it
    for name in ("j2_notes_fts_ai", "j2_notes_fts_au"):
        sql = c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()[0]
        assert "note_rowid" in sql, name
    _insert(c, "n9", "breakout again")
    c.execute("UPDATE j2_notes SET body_plain = 'breakout edited' WHERE id = 'n0'")
    c.commit()
    assert _map_agrees(c) == []
    # ⛔ the covering index under its NEW name, with BOTH columns; the old one gone.
    # Reusing the old name makes this red: an existing index is never replaced by
    # CREATE INDEX IF NOT EXISTS, so the old database would keep (fts_rowid) alone.
    assert _index_cols(c, "idx_j2_notes_fts_map_rowid_note") == ["fts_rowid", "note_rowid"]
    assert _index_cols(c, "idx_j2_notes_fts_map_rowid") == []
    # and search, which now reads note_rowid, finds exactly this member's matches
    notes_svc.register_note_sql_functions(c)
    got = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c))
    assert got == ["n0", "n1", "n3", "n5", "n9"], got


def test_a_restore_that_renumbers_the_notes_is_repaired_at_boot(tmp_path, data_dir):
    """A LOGICAL dump/restore (`sqlite3 .dump`) re-inserts j2_notes without its implicit
    rowids -- renumbered (measured with Python's iterdump on a plain TEXT-keyed table:
    1,067 of 1,333 rows moved) -- while the map's rows come back with their stored
    values, so `note_rowid` points at the wrong notes. (iterdump itself cannot restore
    an FTS5 table, so the renumbering is made directly: a rowid change fires none of
    the note triggers, exactly as the restore's copy of the map does not follow.)"""
    c = _conn(tmp_path / "t.db")
    j2db.ensure_schema(c)
    for i in range(40):
        _insert(c, f"id{i:03d}", "breakout over the pivot" if i % 3 == 0 else "range day")
    c.commit()
    notes_svc.register_note_sql_functions(c)
    want = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c))
    assert want == ["id000", "id003", "id006", "id009", "id012", "id015", "id018",
                    "id021", "id024", "id027", "id030", "id033", "id036", "id039"]
    c.execute("UPDATE j2_notes SET rowid = 100000 - rowid")     # reversed, no collision
    c.commit()
    # non-vacuity: the map now disagrees for EVERY note, and search is wrong
    assert len(_map_agrees(c)) == 40
    assert sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c)) != want
    j2db.ensure_schema(c)              # the next boot
    assert _map_agrees(c) == []
    assert sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c)) == want


def test_the_repair_writes_nothing_when_the_map_already_agrees(tmp_path, data_dir):
    c = _conn(tmp_path / "t.db")
    j2db.ensure_schema(c)
    _insert(c, "a", "x")
    c.commit()
    assert j2db._repair_fts_map_note_rowid(c) == 0
    c.execute("UPDATE j2_notes_fts_map SET note_rowid = note_rowid + 100 WHERE note_id = 'a'")
    assert j2db._repair_fts_map_note_rowid(c) == 1
    assert _map_agrees(c) == []


# ── fix round 1 (review I-2): a failed upgrade degrades speed, never results ──────

def _answers(c, q="breakout"):
    """The four reads the reviewer's probe named: the list, the relevance order, and the
    pair (page + total) in both orders."""
    listed = sorted(n["id"] for n in notes_svc.list_notes(U, q=q, conn=c))
    ranked = sorted(n["id"] for n in notes_svc.list_notes(U, q=q, sort="relevance", conn=c))
    rows, total = notes_svc.list_and_count_notes(U, q=q, conn=c)
    rrows, rtotal = notes_svc.list_and_count_notes(U, q=q, sort="relevance", conn=c)
    return listed, ranked, (sorted(n["id"] for n in rows), total), (sorted(n["id"] for n in rrows), rtotal)


def _trigger_sql(c, name):
    return c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()[0]


def test_an_upgrade_that_fails_leaves_search_answering_the_old_way(tmp_path, data_dir, monkeypatch):
    """The reviewer's probe: an old-shaped database whose repair RAISES at boot (a `database
    is locked` on auth.db's 3 s timeout). The map keeps a NULL `note_rowid` for every row,
    and a NULL never satisfies `IN`: the unguarded read answered `[]` for every search
    until a later boot succeeded."""
    want = ["n1", "n3", "n5"]
    path = tmp_path / "old.db"
    _build_old_shape(path).close()
    c = _conn(path)

    def locked(conn):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(j2db, "_repair_fts_map_note_rowid", locked)
    j2db.ensure_schema(c)                          # prints the abort; boot goes on
    notes_svc.register_note_sql_functions(c)
    # non-vacuity: the map really holds NULLs, and nothing was recorded
    assert c.execute("SELECT count(*) FROM j2_notes_fts_map WHERE note_rowid IS NULL").fetchone()[0] == 7
    assert not notes_svc._fts_map_ready(c)
    # ONE transaction: the repair's failure rolled the trigger swap back with it
    assert "note_rowid" not in _trigger_sql(c, "j2_notes_fts_ai")
    assert "note_rowid" not in _trigger_sql(c, "j2_notes_fts_au")
    assert _answers(c) == (want, want, (want, 3), (want, 3))
    # the next boot upgrades, records it, and the answers do not move
    monkeypatch.undo()
    out = j2db._upgrade_fts_map_note_rowid(c)
    assert out["marked"] and out["triggers_replaced"] and out["rows_repaired"] == 7
    assert notes_svc._fts_map_ready(c) and _map_agrees(c) == []
    assert _answers(c) == (want, want, (want, 3), (want, 3))


def test_a_drift_repair_that_fails_leaves_search_answering_the_old_way(tmp_path, data_dir, monkeypatch):
    """A recorded map whose notes a restore RENUMBERED: the record is forgotten FIRST, in
    its own commit, so a repair that then fails leaves the readers on the `note_id` hop
    -- the right notes -- rather than on `note_rowid`s that now point at other notes."""
    c = _conn(tmp_path / "t.db")
    j2db.ensure_schema(c)
    for i in range(12):
        _insert(c, f"id{i:03d}", "breakout over the pivot" if i % 3 == 0 else "range day")
    c.commit()
    notes_svc.register_note_sql_functions(c)
    want = _answers(c)
    assert want[0] == ["id000", "id003", "id006", "id009"]
    c.execute("UPDATE j2_notes SET rowid = 100000 - rowid")
    c.commit()
    assert _answers(c) != want                     # non-vacuity: the drift really misleads

    def locked(conn):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(j2db, "_repair_fts_map_note_rowid", locked)
    j2db.ensure_schema(c)
    assert not notes_svc._fts_map_ready(c)
    assert _answers(c) == want
    monkeypatch.undo()
    j2db.ensure_schema(c)
    assert notes_svc._fts_map_ready(c) and _map_agrees(c) == []
    assert _answers(c) == want


def test_the_trigger_ddl_splits_into_whole_statements():
    """`executescript` commits before it runs, so the upgrade executes the trigger DDL
    statement by statement; each trigger body must come through whole."""
    stmts = j2db._script_statements(j2db._J2_NOTES_FTS_TRIGGERS_DDL)
    assert [s.split()[2] for s in stmts] == ["j2_notes_fts_ai", "j2_notes_fts_ad", "j2_notes_fts_au"]
    assert all(s.rstrip().endswith("END;") for s in stmts)


@pytest.mark.parametrize("recorded", [True, False])
def test_a_members_search_does_not_move_when_another_member_matches(tmp_path, data_dir, recorded):
    """Fix round 1 (review M-4): the ranked pass is scoped to the searching member, on the
    recorded path and on the `note_id` fallback alike. Member A's results and totals are the
    same whether or not member B holds matching notes, and B's notes never appear. (The ORDER
    within A's results is bm25's, whose term weights are corpus-wide over the one shared
    FTS table -- pre-existing, and not what this pins.)

    ⛔ Re-review N-2: `alone[0]` (the plain list) used to be the only member pinned to a
    LITERAL. The other three -- relevance, and the plain/relevance page+total -- were only
    compared with THEMSELVES before and after member B's notes arrive, via `_answers(c) ==
    alone`. A filter that drops the searching member's OWN matches from the relevance pass
    (the reviewer's mutation: `user_id = upper(?2)` in `_RELEVANCE_RANKED_SQL`) answers `[]`
    for relevance and its page BOTH before and after B's notes -- `[] == []` -- so that
    comparison alone cannot go red for it. Pinning every member of `alone` to what `alone[0]`
    already proved closes that: relevance must describe the SAME notes as the plain list, and
    its page/total must be `(alone[0], len(alone[0]))`, not merely self-consistent."""
    c = _conn(tmp_path / "m.db")
    j2db.ensure_schema(c)
    for i in range(8):
        _insert(c, f"a{i}", "breakout over the pivot" if i % 2 else "a quiet range")
    c.commit()
    notes_svc.register_note_sql_functions(c)
    if not recorded:
        c.execute("DELETE FROM j2_schema_builds WHERE name = ?", (j2db._FTS_MAP_BUILD,))
        c.commit()
    assert notes_svc._fts_map_ready(c) is recorded
    alone = _answers(c)
    assert alone[0] == ["a1", "a3", "a5", "a7"]
    # N-2: relevance and its page describe the SAME matches as the plain list -- pinned to a
    # literal derived from alone[0], not merely compared with itself before/after B's notes.
    assert alone[1] == alone[0]
    assert alone[2] == (alone[0], len(alone[0]))
    assert alone[3] == (alone[0], len(alone[0]))
    for i in range(20):
        _insert(c, f"b{i}", "breakout breakout over the pivot", user="u2", title="breakout")
    c.commit()
    assert _answers(c) == alone
    with_b = notes_svc.list_notes(U, q="breakout", sort="relevance", limit=500, conn=c)
    assert not [n for n in with_b if n["id"].startswith("b")]
