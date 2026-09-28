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
"""
from __future__ import annotations

import ast
import hashlib
import inspect
import io
import json
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
    "task_digest": (1, "dda732ed8047f2f98daa"),
    "tag_index": (1, "824bee1f0255f246d403"),
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


def _task_digest_sources() -> list[str]:
    return [
        _code_text(note_tasks.extract_tasks),
        _code_text(note_tasks._own_text_and_due),
        _code_text(note_tasks.parse_due),
        repr(note_tasks._DATE_RE.pattern),
        repr(note_tasks._NESTED_LISTS),
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
    # the version IS in the record's name, so a bump is what makes old records stop answering
    assert j2db._TASK_DIGEST_BUILD == f"j2_note_task_digest@{j2db.TASK_DIGEST_VERSION}"
    assert j2db._NOTE_TAG_INDEX_BUILD == f"j2_note_tag_index@{j2db.TAG_INDEX_VERSION}"


def test_the_pin_can_fail():
    """CONTROL: an edited derivation without a bump, and a bump without a recorded hash,
    are each refused -- and a comment is not a derivation change."""
    parts = _task_digest_sources()
    edited = parts[:1] + [parts[1].replace("strip", "lstrip", 1) + " x"] + parts[2:]
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION, edited)
    assert _verdict("task_digest", j2db.TASK_DIGEST_VERSION + 1, parts)
    tag_parts = _tag_index_sources()
    assert _verdict("tag_index", j2db.TAG_INDEX_VERSION, [tag_parts[0].replace("lower", "upper")] + tag_parts[1:])

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
