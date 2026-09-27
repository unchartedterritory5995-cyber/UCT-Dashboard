"""The task index `j2_note_task_digest` (wave 10, lane 10A): every writer keeps it true.

The tasks view (`note_tasks.list_tasks`) reads one small row per checklist-bearing note
instead of json-parsing and walking every such note's whole body on every open (the
~100 ms of Python docs/notebook/perf-budgets.md §2 named as the lever). That is the
"every-writer aggregate" the wave-7 budget file warned about, so correctness is not
left to the writers:

  * the table's TRIGGERS (pure SQL, db.py) delete a note's row on every body write, by
    any statement, so a row is either exactly its note's current tasks or absent;
  * `list_tasks` computes a note with no row from its body, so an absent row costs
    time, never a wrong answer;
  * the door writers refill the row in the same transaction
    (`notes._sync_note_task_digest`, called from `_sync_note_sidecars`) -- that is
    what keeps the view fast.

Pinned here:
  * THE WRITERS ARE DERIVED FROM THE CODE, never listed by hand: every function under
    `api/` whose SQL inserts a note or writes a note's body. Each is DRIVEN below, or
    named in `EXEMPT` with its reason; a new writer that is neither fails the census.
  * after each driven writer the answer equals parsing every body, and for the DOOR
    writers the row is present and exact (FRESH). The connector engine's raw media
    rewrite is held to NEVER STALE (absent or exact): it does not refill, by design of
    a file this lane does not own, and the triggers cover it.
  * trash, restore, archive and purge keep the answer equal (the reader filters live
    notes; a purge's trigger removes the row).
  * a row that disagrees with its body is READ (the reader trusts the index when a row
    exists) -- the proof that the body is not being parsed behind it.
  * a database holding the old shape (no table, no triggers) gains both, filled, at
    the next `ensure_schema`.
Each rail was mutation-proved (the lane report, wave10-10A-report.md).
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sqlite3
from datetime import datetime

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import note_tasks
from api.services.journal_two import notes as notes_svc

U = "u1"
NOW = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
REPO = pathlib.Path(__file__).resolve().parents[1]

# Writers found by `_derived_writers` that are deliberately NOT driven, with why.
EXEMPT = {
    ("api/services/journal_two/db.py", "run_notebook_migration_v1"):
        "one-shot legacy playbook conversion behind its own flag; its inserts fire the "
        "invalidating trigger and `backfill_note_task_digest` fills them at the same boot",
    ("api/services/journal_two/roundtrip_export_fixture.py", "main"):
        "a fixture builder for the export round-trip rail, never a production path",
}


def _derived_writers() -> set[tuple[str, str]]:
    """(file, function) for every function under api/ whose SQL inserts a j2_notes row
    or writes its body -- `UPDATE j2_notes SET` naming body_json, or an assembled SET
    (`update_note` builds its list). Read from the AST, never recalled."""
    ins = re.compile(r"INSERT\s+(?:OR\s+\w+\s+)?INTO\s+j2_notes\s*\(")
    upd = re.compile(r"UPDATE\s+j2_notes\s+SET\b")
    out = set()
    for p in sorted((REPO / "api").rglob("*.py")):
        rel = p.relative_to(REPO).as_posix()
        if "/test_" in rel or rel.split("/")[-1].startswith("test_") or "__pycache__" in rel:
            continue
        src = p.read_text(encoding="utf-8")
        if "j2_notes" not in src:
            continue
        for node in ast.walk(ast.parse(src)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            seg = ast.get_source_segment(src, node) or ""
            hit = bool(ins.search(seg))
            for m in upd.finditer(seg):
                win = seg[m.end(): m.end() + 220]
                if "body_json" in win or "{" in win[:40]:
                    hit = True
            if hit:
                out.add((rel, node.name))
    return out


def _doc(*items, text="plain paragraph"):
    """A doc with one paragraph and, when `items` is given, one checklist of them:
    each item is (text, checked, due-or-None)."""
    content = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
    if items:
        lis = []
        for t, checked, due in items:
            inner = [{"type": "text", "text": t + " "}]
            if due:
                inner.append({"type": "dateMention", "attrs": {"date": due}})
            lis.append({"type": "taskItem", "attrs": {"checked": checked},
                        "content": [{"type": "paragraph", "content": inner}]})
        content.append({"type": "taskList", "content": lis})
    return {"type": "doc", "content": content}


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "tasks.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    yield c
    c.close()


def _oracle(c, user=U, **kw):
    """`list_tasks` with the index EMPTIED -- every note computed from its body, which
    is the pre-wave-10 answer. Rolled back, so the index is untouched."""
    c.execute("SAVEPOINT oracle")
    try:
        c.execute("DELETE FROM j2_note_task_digest")
        return note_tasks.list_tasks(user, now=NOW, conn=c, **kw)
    finally:
        c.execute("ROLLBACK TO oracle")
        c.execute("RELEASE oracle")


def _stored_tasks(c, note_id):
    row = c.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    return note_tasks.extract_tasks(json.loads(row["body_json"]))


def _row(c, note_id):
    r = c.execute("SELECT tasks_json FROM j2_note_task_digest WHERE note_id = ?", (note_id,)).fetchone()
    return None if r is None else json.loads(r["tasks_json"])


def _assert_fresh(c, note_id):
    want = _stored_tasks(c, note_id)
    got = _row(c, note_id)
    if want:
        assert got == want, f"{note_id}: index row {got!r} != the body's tasks {want!r}"
    else:
        assert got is None, f"{note_id}: a note with no tasks keeps an index row {got!r}"


def _assert_never_stale(c, note_id):
    got = _row(c, note_id)
    assert got is None or got == _stored_tasks(c, note_id), f"{note_id}: a STALE index row {got!r}"


def _assert_answer_equal(c):
    for status in ("open", "done", "all"):
        got = note_tasks.list_tasks(U, status=status, now=NOW, conn=c)
        assert got == _oracle(c, status=status), status


def _new(c, *items, title="n"):
    return notes_svc.create_note(U, {"title": title, "bodyJson": _doc(*items)}, conn=c)["id"]


# ── the census ────────────────────────────────────────────────────────────────

DRIVEN = {
    ("api/services/journal_two/notes.py", "create_note"),
    ("api/services/journal_two/notes.py", "update_note"),
    ("api/services/journal_two/notes.py", "append_widget_embed"),
    ("api/services/journal_two/notes.py", "append_financial_fact"),
    ("api/services/journal_two/notes.py", "append_document_excerpt"),
    ("api/services/journal_two/notes.py", "import_confirm"),
    ("api/services/journal_two/note_connectors/engine.py", "_apply_resolved_body"),
}


def test_every_body_writer_in_the_code_is_driven_here_or_exempt_with_a_reason():
    derived = _derived_writers()
    # non-vacuity: the derivation sees the writers everyone knows exist
    assert {("api/services/journal_two/notes.py", "create_note"),
            ("api/services/journal_two/notes.py", "update_note")} <= derived, derived
    missing = derived - DRIVEN - set(EXEMPT)
    assert not missing, (f"a note body writer nobody drives against the task index: {sorted(missing)} "
                         "-- drive it in this file, or exempt it with a reason")
    stale = (DRIVEN | set(EXEMPT)) - derived
    assert not stale, f"named here but no longer a writer in the code: {sorted(stale)}"


# ── the writers ───────────────────────────────────────────────────────────────

def test_create_note(conn):
    nid = _new(conn, ("buy the dip", False, "2026-09-24"), ("sell half", True, None))
    _assert_fresh(conn, nid)
    assert _row(conn, nid)                      # non-vacuity: it holds tasks
    _assert_answer_equal(conn)


def test_update_note(conn):
    nid = _new(conn, ("first", False, None))
    notes_svc.update_note(U, nid, {"bodyJson": _doc(("first", True, None), ("second", False, "2026-09-26"))},
                          conn=conn)
    _assert_fresh(conn, nid)
    assert [t["checked"] for t in _row(conn, nid)] == [True, False]
    notes_svc.update_note(U, nid, {"bodyJson": _doc()}, conn=conn)      # every task removed
    _assert_fresh(conn, nid)
    assert _row(conn, nid) is None
    _assert_answer_equal(conn)


def test_restore_note_version_reaches_the_index_through_update_note(conn):
    nid = _new(conn, ("v1 task", False, None))
    notes_svc.update_note(U, nid, {"bodyJson": _doc(("v2 task", False, None))}, conn=conn, force_version=True)
    versions = notes_svc.list_note_versions(U, nid, conn=conn)
    assert versions, "non-vacuity: a version was captured to restore"
    notes_svc.restore_note_version(U, nid, versions[-1]["id"], conn=conn)
    _assert_fresh(conn, nid)
    _assert_answer_equal(conn)


@pytest.mark.parametrize("append", ["widget", "fact", "excerpt"])
def test_the_three_appenders(conn, append):
    nid = _new(conn, ("keep me", False, "2026-09-20"))
    before = _row(conn, nid)
    if append == "widget":
        notes_svc.append_widget_embed(U, nid, {"widgetId": "chart", "params": {"symbol": "AMD"}}, conn=conn)
    elif append == "fact":
        notes_svc.append_financial_fact(U, nid, "fact-1", conn=conn)
    else:
        notes_svc.append_document_excerpt(U, nid, "exc-1", conn=conn)
    body = conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()["body_json"]
    assert {"widget": "widgetEmbed", "fact": "financialFact", "excerpt": "documentExcerpt"}[append] in body
    # the body write dropped the row (trigger) and the door refilled it (sidecars)
    _assert_fresh(conn, nid)
    assert _row(conn, nid) == before
    _assert_answer_equal(conn)


def test_import_confirm_creates_and_updates(conn):
    note = {"importKey": "k1", "title": "imported", "bodyJson": _doc(("from notion", False, None)), "tags": []}
    r = notes_svc.import_confirm(U, {"source": "notion", "notes": [note]}, conn=conn)
    nid = r["created"][0]["id"]
    _assert_fresh(conn, nid)
    note2 = {**note, "bodyJson": _doc(("from notion", True, None), ("added later", False, "2026-09-25"))}
    r2 = notes_svc.import_confirm(U, {"source": "notion", "notes": [note2]}, conn=conn)
    assert [i["id"] for i in r2["updated"]] == [nid], r2
    _assert_fresh(conn, nid)
    assert len(_row(conn, nid)) == 2
    _assert_answer_equal(conn)


def test_the_connector_engines_raw_rewrite_is_never_stale(conn):
    from api.services.journal_two.note_connectors import engine
    nid = _new(conn, ("old text", False, None))
    upd = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (nid,)).fetchone()["updated_at"]
    assert engine._apply_resolved_body(conn, U, nid, _doc(("resolved text", False, "2026-09-25")),
                                       expected_updated_at=upd)
    # it does not refill (not a door); the trigger dropped the old row, so it is absent,
    # never the old tasks -- and the answer still comes from the new body
    _assert_never_stale(conn, nid)
    assert _row(conn, nid) is None
    _assert_answer_equal(conn)
    assert [t["text"] for t in note_tasks.list_tasks(U, now=NOW, conn=conn)["tasks"]] == ["resolved text"]


def test_a_raw_body_write_by_no_door_at_all_drops_the_row(conn):
    nid = _new(conn, ("a", False, None))
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(_doc(("b", False, None))), nid))
    conn.commit()
    assert _row(conn, nid) is None
    _assert_answer_equal(conn)


def test_trash_restore_archive_and_purge_keep_the_answer(conn):
    a = _new(conn, ("a1", False, None), title="a")
    b = _new(conn, ("b1", False, "2026-09-01"), title="b")
    _new(conn, ("c1", True, None), title="c")
    notes_svc.delete_note(U, a, conn=conn)
    _assert_answer_equal(conn)
    assert "a1" not in [t["text"] for t in note_tasks.list_tasks(U, now=NOW, conn=conn)["tasks"]]
    notes_svc.restore_note(U, a, conn=conn)
    _assert_answer_equal(conn)
    _assert_fresh(conn, a)
    notes_svc.set_note_archived(U, b, True, conn=conn)
    _assert_answer_equal(conn)
    notes_svc.set_note_archived(U, b, False, conn=conn)
    _assert_answer_equal(conn)
    conn.execute("DELETE FROM j2_notes WHERE id = ?", (a,))     # the purge's hard delete
    conn.commit()
    assert _row(conn, a) is None
    _assert_answer_equal(conn)


def test_another_members_tasks_never_appear(conn):
    _new(conn, ("mine", False, None))
    notes_svc.create_note("u2", {"title": "theirs", "bodyJson": _doc(("theirs", False, None))}, conn=conn)
    got = [t["text"] for t in note_tasks.list_tasks(U, now=NOW, conn=conn)["tasks"]]
    assert got == ["mine"], got


# ── the reader ────────────────────────────────────────────────────────────────

def test_the_reader_uses_a_row_when_there_is_one_and_the_body_when_there_is_not(conn):
    """Plant a row that DISAGREES with its body: the reader must return the row's
    tasks -- proof it is not parsing the body behind the index. Then drop the row:
    the body's tasks come back. (Planting is the only way a row can disagree; the
    triggers make it impossible through any write.)"""
    nid = _new(conn, ("from the body", False, None))
    planted = [{"index": 0, "checked": False, "text": "from the index", "due": None, "depth": 1, "links": []}]
    conn.execute("UPDATE j2_note_task_digest SET tasks_json = ? WHERE note_id = ?", (json.dumps(planted), nid))
    conn.commit()
    assert [t["text"] for t in note_tasks.list_tasks(U, now=NOW, conn=conn)["tasks"]] == ["from the index"]
    conn.execute("DELETE FROM j2_note_task_digest WHERE note_id = ?", (nid,))
    conn.commit()
    assert [t["text"] for t in note_tasks.list_tasks(U, now=NOW, conn=conn)["tasks"]] == ["from the body"]


def test_a_database_without_the_index_gains_it_filled(tmp_path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    for name in ("j2_note_task_digest_ai", "j2_note_task_digest_au", "j2_note_task_digest_ad"):
        c.execute(f"DROP TRIGGER {name}")
    c.execute("DROP TABLE j2_note_task_digest")
    for i in range(4):
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
                  " VALUES (?,?,?,?,?,?,?,?)",
                  (f"n{i}", U, f"n{i}", json.dumps(_doc(("t%d" % i, False, None)) if i % 2 else _doc()),
                   "", "[]", "2026-09-01T00:00:00Z", f"2026-09-0{i + 1}T00:00:00Z"))
    c.commit()
    c.close()
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')")}
    assert {"j2_note_task_digest", "j2_note_task_digest_ai", "j2_note_task_digest_au",
            "j2_note_task_digest_ad"} <= names
    assert sorted(r[0] for r in c.execute("SELECT note_id FROM j2_note_task_digest")) == ["n1", "n3"]
    for nid in ("n0", "n1", "n2", "n3"):
        _assert_fresh(c, nid)
    c.close()
