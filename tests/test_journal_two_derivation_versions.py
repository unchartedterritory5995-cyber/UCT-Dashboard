"""The derived structures carry a VERSION of their derivation (wave 10, lane 10A, fix round 1,
review I-3).

`list_tasks` trusts a `j2_note_task_digest` row over the note's body, and the tag reads
trust `j2_note_tag_index`. Both are kept true between boots by triggers, and both are
recorded in `j2_schema_builds` when they are built. Without a version in that record, a
change to the DERIVATION -- `note_tasks.extract_tasks`, the tag fold, the trigger SQL --
would reach fresh databases only: every existing row, and every existing trigger body
(`CREATE TRIGGER IF NOT EXISTS` never replaces one), would keep the old shape, while
every test, built fresh, passed.

Pinned here:
  * each version constant is pinned to a HASH of its derivation's source (code with
    comments and docstrings removed; SQL as written), so an edit to the derivation
    without a version bump goes red here, by name, with the new hash to record;
  * the pin can fail (a control feeds it an edited source, and a bumped version);
  * a database built by ANOTHER version is rebuilt at the next boot through the guarded
    path: the tag index's triggers and rows are replaced, the task index is emptied
    and refilled -- and until that commits, the readers take the per-note path, so a
    rebuild that fails leaves every answer correct.

Follow-up F2 (review N-4): two trigger families were outside the scheme -- the task
index's INVALIDATION triggers and the FTS triggers, all `CREATE TRIGGER IF NOT EXISTS`, so
an edit to their SQL reached fresh databases only. Both are now pinned here (SQL with its
comments and whitespace normalised), and a database recorded by another version gets this
version's trigger bodies through the guarded path: the FTS swap inside the note_rowid
upgrade's one transaction, the task triggers inside the refill's.
"""
from __future__ import annotations

import ast
import hashlib
import inspect
import io
import json
import re
import sqlite3
import textwrap
import tokenize
from datetime import datetime

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import note_tasks
from api.services.journal_two import notes as notes_svc

U = "u1"
NOW = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)

#: ⛔ The recorded pins: (version, hash of the derivation's source at that version).
#: When the derivation changes, bump the version constant in db.py AND record the
#: new hash here -- the failure message prints it. Never edit a hash without a bump:
#: that is exactly the edit this file exists to refuse.
PINNED = {
    "task_digest": (2, "49cc7a9e7c57adfd0b14"),
    "tag_index": (1, "824bee1f0255f246d403"),
    "fts_map": (1, "517cd6b2ee3962634e1f"),
}


def _code_text(fn) -> str:
    """A function's source as tokens: comments, blank lines and its docstrings dropped,
    so a comment or a docstring edit is not a derivation change; the block structure
    is kept (INDENT/DEDENT markers)."""
    src = textwrap.dedent(inspect.getsource(fn))
    doc_lines: set[int] = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant) \
                    and isinstance(first.value.value, str):
                doc_lines.update(range(first.lineno, first.end_lineno + 1))
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in (tokenize.COMMENT, tokenize.NL, tokenize.ENCODING, tokenize.ENDMARKER):
            continue
        if tok.start[0] in doc_lines and tok.type in (tokenize.STRING, tokenize.NEWLINE):
            continue
        out.append({tokenize.INDENT: "<I>", tokenize.DEDENT: "<D>", tokenize.NEWLINE: ";"}.get(tok.type, tok.string))
    return " ".join(out)


def _sql_text(script: str) -> str:
    """SQL as tokens: its `--` comments removed and its whitespace collapsed, so a comment
    or a re-indent inside a DDL string is not a derivation change, and a changed token is.
    (None of the pinned DDL carries `--` inside a string literal.)"""
    return " ".join(re.sub(r"--[^\n]*", "", script).split())


def _task_digest_sources() -> list[str]:
    return [
        _code_text(note_tasks.extract_tasks),
        _code_text(note_tasks._own_text_and_due),
        _code_text(note_tasks.parse_due),
        repr(note_tasks._DATE_RE.pattern),
        repr(note_tasks._NESTED_LISTS),
        _sql_text(j2db._TASK_DIGEST_TRIGGERS_DDL),     # the invalidation triggers (F2, N-4)
    ]


def _fts_map_sources() -> list[str]:
    return [
        _sql_text(j2db._J2_NOTES_FTS_TRIGGERS_DDL),    # the three FTS trigger bodies (F2, N-4)
        _sql_text(j2db._J2_NOTES_FTS_MAP_DDL),
        _sql_text(j2db._FTS_MAP_INDEX_DDL),
        _code_text(j2db._repair_fts_map_note_rowid),
        _code_text(j2db._fts_map_drift),
    ]


def _tag_index_sources() -> list[str]:
    return [
        repr(j2db._NOTE_TAG_INDEX_DDL),          # the table, its indexes, the trigger SQL
        repr(j2db._TAG_FOLD_REMOVED),
        j2db._TAG_FOLD_OF_JE,
        _code_text(j2db._tag_fold_sql),
        _code_text(j2db.rebuild_note_tag_index),
    ]


def _hash(parts: list[str]) -> str:
    return hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()[:20]


def _verdict(name: str, version: int, parts: list[str]) -> str | None:
    """None when `version` and the source agree with the pin, else what to do."""
    pinned_version, pinned_hash = PINNED[name]
    h = _hash(parts)
    if version != pinned_version:
        return (f"{name}: the version is {version} and the pin is {pinned_version} -- record "
                f"({version}, {h!r}) in PINNED")
    if h != pinned_hash:
        return (f"{name}: the derivation's source changed ({pinned_hash} -> {h}) without a version "
                f"bump. Bump the version in db.py (existing databases rebuild at the next boot) and "
                f"record the new hash; a change that cannot move a stored row still bumps")
    return None


def test_each_version_constant_is_pinned_to_its_derivations_source():
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION, _task_digest_sources()) is None
    assert _verdict("tag_index", j2db.TAG_INDEX_VERSION, _tag_index_sources()) is None
    assert _verdict("fts_map", j2db.FTS_MAP_VERSION, _fts_map_sources()) is None
    # the version IS in the record's name, so a bump is what makes old records stop answering
    assert j2db._TASK_DIGEST_BUILD == f"j2_note_task_digest@{j2db.TASK_DIGEST_VERSION}"
    assert j2db._NOTE_TAG_INDEX_BUILD == f"j2_note_tag_index@{j2db.TAG_INDEX_VERSION}"
    assert j2db._FTS_MAP_BUILD == f"j2_notes_fts_map.note_rowid@{j2db.FTS_MAP_VERSION}"


def test_the_pin_can_fail():
    """CONTROL: an edited derivation without a bump, and a bump without a recorded hash,
    are each refused -- and a comment is not a derivation change."""
    parts = _task_digest_sources()
    edited = parts[:1] + [parts[1].replace("strip", "lstrip", 1) + " x"] + parts[2:]
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION, edited)
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION + 1, parts)
    tag_parts = _tag_index_sources()
    assert _verdict("tag_index", j2db.TAG_INDEX_VERSION, [tag_parts[0].replace("lower", "upper")] + tag_parts[1:])
    # F2 (N-4): the trigger families. An edit to a trigger's SQL moves each pin ...
    task_trig = _sql_text(j2db._TASK_DIGEST_TRIGGERS_DDL.replace("UPDATE OF body_json", "UPDATE OF title"))
    assert task_trig != parts[-1]
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION, parts[:-1] + [task_trig])
    fts = _fts_map_sources()
    fts_trig = _sql_text(j2db._J2_NOTES_FTS_TRIGGERS_DDL.replace("UPDATE OF title, body_plain", "UPDATE OF title"))
    assert fts_trig != fts[0]
    assert _verdict("fts_map", j2db.FTS_MAP_VERSION, [fts_trig] + fts[1:])
    assert _verdict("fts_map", j2db.FTS_MAP_VERSION + 1, fts)
    # ... and a comment or a re-indent inside the SQL does not
    commented = j2db._J2_NOTES_FTS_TRIGGERS_DDL.replace(
        "BEGIN\n", "BEGIN  -- a comment about the body\n      ", 1)
    assert commented != j2db._J2_NOTES_FTS_TRIGGERS_DDL                 # non-vacuity: it was edited
    assert _sql_text(commented) == fts[0]

    def same(x):
        """doc"""
        return x + 1  # a comment
    commented = same

    def same(x):  # noqa: F811
        """another doc entirely"""
        # a different comment
        return x + 1
    recommented = same

    def same(x):  # noqa: F811
        return x + 2
    changed = same
    assert _code_text(commented) == _code_text(recommented)     # comments and docstrings: no change
    assert _code_text(commented) != _code_text(changed)         # code: a change


# ── a database built by another version is rebuilt through the guarded path ──────

def _doc(*items):
    content = [{"type": "paragraph", "content": [{"type": "text", "text": "plain"}]}]
    lis = [{"type": "taskItem", "attrs": {"checked": checked},
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}]}
           for t, checked in items]
    content.append({"type": "taskList", "content": lis})
    return {"type": "doc", "content": content}


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "v.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    notes_svc.register_note_sql_functions(c)
    yield c
    c.close()


def _texts(c):
    return sorted(t["text"] for t in note_tasks.list_tasks(U, status="all", now=NOW, conn=c)["tasks"])


def _as_if_built_by_version_0(c, family: str) -> None:
    c.execute("DELETE FROM j2_schema_builds WHERE name LIKE ?", (family + "@%",))
    c.execute("INSERT INTO j2_schema_builds (name, built_at) VALUES (?, 'then')", (family + "@0",))
    c.commit()


def test_a_task_index_built_by_another_version_is_refilled_and_not_trusted_until_then(conn, monkeypatch):
    for i in range(3):
        notes_svc.create_note(U, {"title": f"n{i}", "bodyJson": _doc((f"task {i}", i == 1))}, conn=conn)
    want = _texts(conn)
    assert want == ["task 0", "task 1", "task 2"]
    # version 0's rows: a shape the current extraction would never write
    conn.execute("UPDATE j2_note_task_digest SET tasks_json = ?",
                 (json.dumps([{"index": 0, "checked": False, "text": "OLD SHAPE", "due": None,
                               "depth": 1, "links": []}]),))
    _as_if_built_by_version_0(conn, j2db._TASK_DIGEST_FAMILY)
    # not trusted: the reader parses the bodies while the record is another version's
    assert not j2db.schema_built(conn, j2db._TASK_DIGEST_BUILD)
    assert _texts(conn) == want
    # a rebuild that FAILS (the record cannot be written) rolls back whole: the old rows
    # remain, no record stands, and the answer is still the bodies'
    real_mark = j2db._mark_built

    def refuse(c, name):
        if name == j2db._TASK_DIGEST_BUILD:
            raise sqlite3.OperationalError("database is locked")
        return real_mark(c, name)
    monkeypatch.setattr(j2db, "_mark_built", refuse)
    with pytest.raises(sqlite3.OperationalError):
        j2db.backfill_note_task_digest(conn)
    assert conn.execute("SELECT count(*) FROM j2_note_task_digest WHERE tasks_json LIKE '%OLD SHAPE%'"
                        ).fetchone()[0] == 3                        # non-vacuity: rolled back
    assert not j2db.schema_built(conn, j2db._TASK_DIGEST_BUILD)
    assert _texts(conn) == want
    # the next boot empties and refills from this code, and records the version
    monkeypatch.undo()
    j2db.ensure_schema(conn)
    assert j2db.schema_built(conn, j2db._TASK_DIGEST_BUILD)
    assert not conn.execute("SELECT 1 FROM j2_note_task_digest WHERE tasks_json LIKE '%OLD SHAPE%'"
                            ).fetchone()
    assert conn.execute("SELECT count(*) FROM j2_note_task_digest").fetchone()[0] == 3
    assert _texts(conn) == want
    assert not conn.execute("SELECT 1 FROM j2_schema_builds WHERE name = ?",
                            (j2db._TASK_DIGEST_FAMILY + "@0",)).fetchone()


def test_a_tag_index_built_by_another_version_gets_this_versions_triggers_and_rows(conn):
    for i in range(4):
        notes_svc.create_note(U, {"title": f"n{i}", "bodyJson": _doc(("t", False)),
                                  "tags": ["Setups" if i % 2 else "research/semis"]}, conn=conn)
    want = (notes_svc.list_and_count_notes(U, tag="setups", conn=conn)[1],
            notes_svc.list_and_count_notes(U, tag="research", conn=conn)[1])
    assert want == (2, 2)
    # version 0: a trigger body that derived no fold at all, and rows to match
    conn.execute("DROP TRIGGER j2_note_tag_index_au")
    conn.execute("CREATE TRIGGER j2_note_tag_index_au AFTER UPDATE OF tags ON j2_notes BEGIN"
                 " DELETE FROM j2_note_tag_index WHERE note_id = old.id; END")
    conn.execute("UPDATE j2_note_tag_index SET fold = NULL")
    _as_if_built_by_version_0(conn, j2db._NOTE_TAG_INDEX_FAMILY)
    assert not notes_svc._tag_index_ready(conn)                     # the per-note scan answers
    assert (notes_svc.list_and_count_notes(U, tag="setups", conn=conn)[1],
            notes_svc.list_and_count_notes(U, tag="research", conn=conn)[1]) == want
    out = j2db._ensure_note_tag_index(conn)
    assert out["rebuilt_for_version"] is True
    assert notes_svc._tag_index_ready(conn)
    body = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'j2_note_tag_index_au'").fetchone()[0]
    assert "INSERT INTO j2_note_tag_index" in body                   # this version's body, replaced
    assert conn.execute("SELECT count(*) FROM j2_note_tag_index WHERE fold IS NULL").fetchone()[0] == 0
    assert (notes_svc.list_and_count_notes(U, tag="setups", conn=conn)[1],
            notes_svc.list_and_count_notes(U, tag="research", conn=conn)[1]) == want


# ── F2 (review N-4): the two trigger families follow their version ───────────────

def _trigger_text(c, name):
    r = c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()
    return " ".join(r[0].split()) if r else None


def _code_trigger(script, name):
    """The code's text for one trigger, in the form sqlite_master keeps it."""
    for stmt in j2db._script_statements(script):
        words = stmt.replace("IF NOT EXISTS ", "").split()
        if words[2] == name:
            return " ".join(stmt.replace("IF NOT EXISTS ", "").rstrip().rstrip(";").split())
    raise AssertionError(f"{name} is not in the script")


# An au body a previous release could have shipped: it still names note_rowid (so the old
# `_fts_triggers_stale` test called it current) but no longer fires on body_plain.
_OLDER_FTS_AU = """CREATE TRIGGER j2_notes_fts_au
AFTER UPDATE OF title ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT OR REPLACE INTO j2_notes_fts_map(note_id, fts_rowid, note_rowid)
    VALUES (new.id, last_insert_rowid(), new.rowid);
END"""
_OLDER_TASK_AU = ("CREATE TRIGGER j2_note_task_digest_au AFTER UPDATE OF title ON j2_notes BEGIN"
                  " DELETE FROM j2_note_task_digest WHERE note_id = old.id; END")


def _search(c):
    return sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c))


def _as_if_fts_recorded_by(c, record):
    c.execute("DELETE FROM j2_schema_builds WHERE name = ? OR name LIKE ?",
              (j2db._FTS_MAP_FAMILY, j2db._FTS_MAP_FAMILY + "@%"))
    c.execute("INSERT INTO j2_schema_builds (name, built_at) VALUES (?, 'then')", (record,))
    c.commit()


@pytest.mark.parametrize("record", ["j2_notes_fts_map.note_rowid", "j2_notes_fts_map.note_rowid@0"])
def test_an_fts_map_recorded_by_another_version_gets_this_versions_triggers(conn, monkeypatch, record):
    """Today's databases hold the BARE record (the upgrade had no version), and a later
    release will leave `@<n-1>`. Either one is another version: the readers take the
    `note_id` hop until the next boot swaps in this code's three trigger bodies, inside
    the upgrade's one transaction -- so a swap that fails leaves the OLD triggers whole."""
    for i in range(6):
        notes_svc.create_note(U, {"title": f"n{i}", "bodyJson": _doc(("t", False))}, conn=conn)
    ids = sorted(r["id"] for r in conn.execute("SELECT id FROM j2_notes"))
    conn.execute("UPDATE j2_notes SET body_plain = CASE WHEN rowid % 2 = 0"
                 " THEN 'breakout over the pivot' ELSE 'a quiet range' END")
    conn.commit()
    want = _search(conn)
    assert len(want) == 3, want                                     # non-vacuity: three match
    conn.execute("DROP TRIGGER j2_notes_fts_au")
    conn.execute(_OLDER_FTS_AU)
    _as_if_fts_recorded_by(conn, record)
    assert not notes_svc._fts_map_ready(conn)                       # the note_id hop answers
    assert _search(conn) == want
    # a rebuild that FAILS at its last step rolls the swap back: the older body stands whole
    real_mark = j2db._mark_built

    def refuse(c, name):
        if name == j2db._FTS_MAP_BUILD:
            raise sqlite3.OperationalError("database is locked")
        return real_mark(c, name)
    monkeypatch.setattr(j2db, "_mark_built", refuse)
    with pytest.raises(sqlite3.OperationalError):
        j2db._upgrade_fts_map_note_rowid(conn)
    assert _trigger_text(conn, "j2_notes_fts_au") == " ".join(_OLDER_FTS_AU.split())
    assert {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'"
                                       " AND name LIKE 'j2_notes_fts_a_'")} == {
        "j2_notes_fts_ai", "j2_notes_fts_au", "j2_notes_fts_ad"}
    assert not notes_svc._fts_map_ready(conn)
    assert _search(conn) == want
    # the other version's record was withdrawn FIRST, in its own commit, before the swap
    assert not j2db._recorded(conn, record)
    # the next boot swaps in this version's bodies and records the version
    monkeypatch.undo()
    out = j2db._upgrade_fts_map_note_rowid(conn)
    assert out["reason"] == "built" and out["triggers_replaced"] and out["marked"]
    for name in ("j2_notes_fts_ai", "j2_notes_fts_au", "j2_notes_fts_ad"):
        assert _trigger_text(conn, name) == _code_trigger(j2db._J2_NOTES_FTS_TRIGGERS_DDL, name), name
    assert notes_svc._fts_map_ready(conn)
    # and a body_plain write the older body ignored is now searchable
    other = next(i for i in ids if i not in want)
    conn.execute("UPDATE j2_notes SET body_plain = 'breakout from a sync' WHERE id = ?", (other,))
    conn.commit()
    assert _search(conn) == sorted(want + [other])


def test_a_task_index_of_another_version_gets_this_versions_invalidation_triggers(conn, monkeypatch):
    """A version bump used to refill the rows and KEEP the old trigger, so the next body
    write the old trigger ignores left a stale row that `list_tasks` served. The refill now
    drops and recreates the three invalidation triggers in its own transaction."""
    nid = notes_svc.create_note(U, {"title": "t", "bodyJson": _doc(("old task", False))}, conn=conn)["id"]
    conn.execute("DROP TRIGGER j2_note_task_digest_au")
    conn.execute(_OLDER_TASK_AU)
    _as_if_built_by_version_0(conn, j2db._TASK_DIGEST_FAMILY)
    # a refill that FAILS rolls the trigger swap back with it
    real_mark = j2db._mark_built

    def refuse(c, name):
        if name == j2db._TASK_DIGEST_BUILD:
            raise sqlite3.OperationalError("database is locked")
        return real_mark(c, name)
    monkeypatch.setattr(j2db, "_mark_built", refuse)
    with pytest.raises(sqlite3.OperationalError):
        j2db.backfill_note_task_digest(conn)
    assert _trigger_text(conn, "j2_note_task_digest_au") == " ".join(_OLDER_TASK_AU.split())
    monkeypatch.undo()
    j2db.ensure_schema(conn)
    for name in j2db._TASK_DIGEST_TRIGGERS:
        assert _trigger_text(conn, name) == _code_trigger(j2db._TASK_DIGEST_TRIGGERS_DDL, name), name
    assert j2db.schema_built(conn, j2db._TASK_DIGEST_BUILD)
    assert conn.execute("SELECT count(*) FROM j2_note_task_digest").fetchone()[0] == 1   # refilled
    # a body write by no door (a migration, the connector engine): the row is dropped, and
    # the tasks view reads the new body -- never the stale row
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(_doc(("new task", False))), nid))
    conn.commit()
    assert conn.execute("SELECT count(*) FROM j2_note_task_digest").fetchone()[0] == 0
    assert _texts(conn) == ["new task"]


def test_the_task_triggers_are_one_text_spliced_into_the_schema():
    """ONE authority: a fresh database runs `_J2_SCHEMA`, a version rebuild runs
    `_TASK_DIGEST_TRIGGERS_DDL`, and the first contains the second verbatim."""
    assert j2db._TASK_DIGEST_TRIGGERS_DDL in j2db._J2_SCHEMA
    stmts = j2db._script_statements(j2db._TASK_DIGEST_TRIGGERS_DDL)
    assert [s.split()[5] for s in stmts] == list(j2db._TASK_DIGEST_TRIGGERS)


@pytest.mark.parametrize("record, reason", [
    ("j2_notes_fts_map.note_rowid", "rebuilt_for_version"),      # every database today
    ("j2_notes_fts_map.note_rowid@0", "rebuilt_for_version"),
    (None, "built"),
])
def test_the_fts_upgrade_names_why_it_rebuilt(conn, record, reason):
    conn.execute("DELETE FROM j2_schema_builds WHERE name LIKE 'j2_notes_fts_map.note_rowid%'")
    if record:
        conn.execute("INSERT INTO j2_schema_builds (name, built_at) VALUES (?, 'then')", (record,))
    conn.commit()
    out = j2db._upgrade_fts_map_note_rowid(conn)
    assert out["reason"] == reason and out["marked"]
    assert [r[0] for r in conn.execute("SELECT name FROM j2_schema_builds"
                                       " WHERE name LIKE 'j2_notes_fts_map.note_rowid%'")] == [j2db._FTS_MAP_BUILD]
    # and a database already at this version, in shape, rebuilds nothing
    assert j2db._upgrade_fts_map_note_rowid(conn)["reason"] is None


def test_every_door_keeps_both_indexes_after_a_version_rebuild(conn):
    """The brief's hard constraint: every write door keeps updating the FTS map and the task
    index. A database recorded by OTHER versions of both families, carrying older trigger
    bodies that ignore a body write, is booted -- then ONE write goes through each door the
    task-index census derives from the code (`DRIVEN`, tests/test_journal_two_task_digest.py),
    and both indexes must describe the note as it now stands."""
    from api.services.journal_two.note_connectors import engine
    from tests.test_journal_two_task_digest import DRIVEN
    conn.execute("DROP TRIGGER j2_notes_fts_au")
    conn.execute(_OLDER_FTS_AU)
    conn.execute("DROP TRIGGER j2_note_task_digest_au")
    conn.execute(_OLDER_TASK_AU)
    _as_if_fts_recorded_by(conn, "j2_notes_fts_map.note_rowid")
    _as_if_built_by_version_0(conn, j2db._TASK_DIGEST_FAMILY)
    j2db.ensure_schema(conn)                                        # the boot
    assert notes_svc._fts_map_ready(conn) and j2db.schema_built(conn, j2db._TASK_DIGEST_BUILD)

    def new(text="keep"):
        return notes_svc.create_note(U, {"title": "n", "bodyJson": _doc((text, False))}, conn=conn)["id"]

    def update():
        nid = new()
        notes_svc.update_note(U, nid, {"bodyJson": _doc(("edited", True), ("added", False))}, conn=conn)
        return nid

    def appender(fn, *args):
        def door():
            nid = new()
            fn(U, nid, *args, conn=conn)
            return nid
        return door

    def imported():
        note = {"importKey": "k1", "title": "imported", "bodyJson": _doc(("from notion", False)), "tags": []}
        nid = notes_svc.import_confirm(U, {"source": "notion", "notes": [note]}, conn=conn)["created"][0]["id"]
        note2 = {**note, "bodyJson": _doc(("from notion", True), ("added later", False))}
        assert [i["id"] for i in notes_svc.import_confirm(
            U, {"source": "notion", "notes": [note2]}, conn=conn)["updated"]] == [nid]
        return nid

    def resolved():
        nid = new("old text")
        upd = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0]
        assert engine._apply_resolved_body(conn, U, nid, _doc(("resolved text", False)), expected_updated_at=upd)
        return nid

    nb = "api/services/journal_two/notes.py"
    doors = {
        (nb, "create_note"): new,
        (nb, "update_note"): update,
        (nb, "append_widget_embed"): appender(notes_svc.append_widget_embed,
                                              {"widgetId": "chart", "params": {"symbol": "AMD"}}),
        (nb, "append_financial_fact"): appender(notes_svc.append_financial_fact, "fact-1"),
        (nb, "append_document_excerpt"): appender(notes_svc.append_document_excerpt, "exc-1"),
        (nb, "import_confirm"): imported,
        ("api/services/journal_two/note_connectors/engine.py", "_apply_resolved_body"): resolved,
    }
    assert set(doors) == DRIVEN, "a door the census knows is not driven here, or the reverse"
    nids = {}
    for key, door in doors.items():
        nid = nids[key] = door()
        row = conn.execute(
            "SELECT m.note_rowid, n.rowid, f.title, f.body_plain, n.title, n.body_plain"
            " FROM j2_notes n JOIN j2_notes_fts_map m ON m.note_id = n.id"
            " JOIN j2_notes_fts f ON f.rowid = m.fts_rowid WHERE n.id = ?", (nid,)).fetchone()
        assert row is not None, f"{key}: no FTS map row"
        assert row[0] == row[1], f"{key}: the map's note_rowid is not the note's rowid"
        assert (row[2], row[3]) == (row[4], row[5]), f"{key}: the indexed text is not the note's"
        body = conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0]
        want = note_tasks.extract_tasks(json.loads(body))
        got = conn.execute("SELECT tasks_json FROM j2_note_task_digest WHERE note_id = ?", (nid,)).fetchone()
        if key[1] == "_apply_resolved_body":      # not a door: absent or exact, never stale
            assert got is None or json.loads(got[0]) == want, key
        else:
            assert got is not None and json.loads(got[0]) == want, f"{key}: the task row is not the body's"
    # and the search, answering through the recorded map, finds exactly the note whose body
    # the update door rewrote (the older au body would have left it unindexed)
    assert [n["id"] for n in notes_svc.list_notes(U, q="edited", conn=conn)] == [nids[(nb, "update_note")]]
