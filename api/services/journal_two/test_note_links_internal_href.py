"""Plan A Task 2 (L-2): an internal note link MARK counts as a note link.

An imported wiki link resolves to a `link` mark whose href is
`/journal?j2tab=notebook&note=<id>` (note_connectors/convert/rewrite.py). Before
this, only a `noteLink` NODE reached `j2_note_links`, so an imported link was
invisible to backlinks and the graph. These rails pin: the mark is projected
(once per link, however many bold/italic runs it spans), its words are never
touched, other hrefs are not projected, the sync engine's own placeholder
resolution reaches the projection (controller ruling 1), and a one-shot backfill
projects bodies already stored. Same in-memory-schema fixture as
test_wave_d_links.py.
"""
import json
import re
import sqlite3
from pathlib import Path

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.notes import (
    _internal_note_id,
    create_note,
    get_note_backlinks,
    get_note_graph,
)

REPO = Path(__file__).resolve().parents[3]


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _create(c, user_id, title, body_json):
    return create_note(user_id, {"title": title, "bodyJson": body_json}, conn=c)


def _href(note_id):
    return f"/journal?j2tab=notebook&note={note_id}"


def _linked(text, href, *extra_marks):
    return {"type": "text", "text": text,
            "marks": [*extra_marks, {"type": "link", "attrs": {"href": href}}]}


def _para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _link_rows(c, note_id):
    return [r["target_note_id"] for r in c.execute(
        "SELECT target_note_id FROM j2_note_links WHERE note_id = ? ORDER BY position", (note_id,))]


# ── The accepted shape, and its parity with the client ─────────────────────────

@pytest.mark.parametrize("href,expected", [
    ("/journal?j2tab=notebook&note=n123", "n123"),
    ("/journal?note=n123&j2tab=notebook", "n123"),
    ("  /journal?j2tab=notebook&note=a_B-9  ", "a_B-9"),
    ("/journal?j2tab=notebook&note=", None),
    ("/journal?j2tab=notebook&note=a b", None),
    ("/journal/x?note=n1", None),
    ("/journal?note=n1", None),
    ("/journal?j2tab=notebook&note=n1&x=1", None),
    ("/journal?j2tab=notebook&note=n1#frag", None),
    ("/journal?j2tab=notebook&note=n1\n/x", None),
    ("https://uctintelligence.com/journal?j2tab=notebook&note=n1", None),
    ("javascript:alert(1)", None),
    ("import-link://n1", None),
    ("", None),
    (None, None),
    (42, None),
])
def test_internal_note_id_accepts_exactly_the_in_app_shape(href, expected):
    assert _internal_note_id(href) == expected


def test_the_python_and_js_internal_link_patterns_are_one_pattern():
    """ONE FACT IN TWO FILES: linkClickOpen.js opens what notes.py projects. Read the
    client's literal rather than restating it here (a copy would be a third authority)."""
    from api.services.journal_two import notes as notes_mod
    src = (REPO / "app/src/pages/journal-2-0/lib/linkClickOpen.js").read_text(encoding="utf-8")
    m = re.search(r"const INTERNAL_NOTE_RE = /(.+)/\s*$", src, re.MULTILINE)
    assert m, "INTERNAL_NOTE_RE not found in linkClickOpen.js"
    assert m.group(1).replace("\\/", "/") == notes_mod._INTERNAL_NOTE_RE.pattern


# ── Projection on save ─────────────────────────────────────────────────────────

def test_internal_href_link_mark_is_projected_as_a_note_link():
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    a = _create(c, "u1", "A", _doc(_para({"type": "text", "text": "see "}, _linked("my alias", _href(b["id"])))))
    assert _link_rows(c, a["id"]) == [b["id"]]
    back = get_note_backlinks("u1", b["id"], conn=c)
    assert back["count"] == 1 and back["notes"][0]["id"] == a["id"]
    graph = get_note_graph("u1", conn=c)
    assert {"source": a["id"], "target": b["id"], "weight": 1} in graph["edges"]


def test_a_link_split_across_bold_runs_counts_once():
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    href = _href(b["id"])
    a = _create(c, "u1", "A", _doc(_para(
        _linked("my ", href), _linked("bold", href, {"type": "bold"}), _linked(" alias", href))))
    assert _link_rows(c, a["id"]) == [b["id"]]


def test_two_separate_links_to_one_note_are_two_rows():
    """CONTROL for the run-merge: words between two links make them two links."""
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    href = _href(b["id"])
    a = _create(c, "u1", "A", _doc(_para(_linked("one", href), {"type": "text", "text": " and "},
                                         _linked("two", href))))
    assert _link_rows(c, a["id"]) == [b["id"], b["id"]]


def test_display_text_is_untouched_by_projection():
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    body = _doc(_para(_linked("my alias", _href(b["id"]))))
    a = _create(c, "u1", "A", body)
    row = c.execute("SELECT body_json, body_plain FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()
    assert json.loads(row["body_json"]) == body
    assert row["body_plain"] == "my alias"


def test_external_and_malformed_hrefs_are_not_projected():
    c = _conn()
    a = _create(c, "u1", "A", _doc(_para(
        _linked("web", "https://example.com/journal?j2tab=notebook&note=x1"),
        _linked("no tab", "/journal?note=x2"),
        _linked("space", "/journal?j2tab=notebook&note=a b"),
        _linked("pending", "import-link://notion:x3"),
    )))
    assert _link_rows(c, a["id"]) == []


def test_note_link_nodes_and_marks_share_document_order():
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    d = _create(c, "u1", "D", _doc())
    a = _create(c, "u1", "A", _doc(
        _para({"type": "noteLink", "attrs": {"noteId": d["id"]}}),
        _para(_linked("alias", _href(b["id"]))),
    ))
    assert _link_rows(c, a["id"]) == [d["id"], b["id"]]


# ── Controller ruling 1: the sync engine's resolution reaches the projection ───

def test_an_engine_resolved_link_is_projected_and_updated_at_does_not_move():
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    a = _create(c, "u1", "A", _doc(_para(_linked("my alias", "import-link://notion:b-key"))))
    assert _link_rows(c, a["id"]) == []
    before = c.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()[0]
    resolved = _doc(_para(_linked("my alias", _href(b["id"]))))
    assert engine._apply_resolved_body(c, "u1", a["id"], resolved, expected_updated_at=before) is True
    assert _link_rows(c, a["id"]) == [b["id"]]
    assert get_note_backlinks("u1", b["id"], conn=c)["count"] == 1
    after = c.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()[0]
    assert after == before


def test_a_refused_engine_write_leaves_the_projection_alone():
    """CONTROL: the optimistic lock failed (a member edit raced it), so neither the body
    nor its sidecars may change."""
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    a = _create(c, "u1", "A", _doc(_para(_linked("my alias", "import-link://notion:b-key"))))
    resolved = _doc(_para(_linked("my alias", _href(b["id"]))))
    assert engine._apply_resolved_body(c, "u1", a["id"], resolved, expected_updated_at="stale") is False
    assert _link_rows(c, a["id"]) == []


# ── One-shot backfill over bodies already stored ───────────────────────────────

def test_backfill_projects_existing_bodies_once(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    a = _create(c, "u1", "A", _doc())
    body = _doc(_para(_linked("my alias", _href(b["id"]))))
    # Written by raw SQL, the way a body stored before this change looks: no sidecar row.
    c.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(body), a["id"]))
    c.commit()
    stamp = c.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()[0]
    assert _link_rows(c, a["id"]) == []

    first = j2db.run_internal_link_projection_backfill(c)
    assert first["synced"] == 1
    assert (tmp_path / ".note_links_internal_href_v1").exists()
    second = j2db.run_internal_link_projection_backfill(c)
    assert second.get("skipped") is True
    assert _link_rows(c, a["id"]) == [b["id"]]
    assert c.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()[0] == stamp


def test_backfill_pages_through_more_than_one_batch(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(j2db, "_INTERNAL_LINK_BACKFILL_BATCH", 2)
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    ids = [_create(c, "u1", f"A{i}", _doc())["id"] for i in range(5)]
    body = json.dumps(_doc(_para(_linked("x", _href(b["id"])))))
    c.executemany("UPDATE j2_notes SET body_json = ? WHERE id = ?", [(body, i) for i in ids])
    c.commit()
    out = j2db.run_internal_link_projection_backfill(c)
    assert out["synced"] == 5
    assert all(_link_rows(c, i) == [b["id"]] for i in ids)


def test_one_poison_note_never_aborts_the_backfill(monkeypatch, tmp_path, caplog):
    """Final review (promoted minor): one note whose projection raises aborted the whole pass,
    and with no flag written, it aborted again on every boot, so no note behind it was ever
    projected. Now: that note is logged and skipped, its half-written sidecars undone, the rest
    projected, and the flag written when the walk finishes."""
    import logging
    from api.services.journal_two import notes as notes_mod
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    ids = sorted(_create(c, "u1", f"A{i}", _doc())["id"] for i in range(3))
    body = json.dumps(_doc(_para(_linked("x", _href(b["id"])))))
    c.executemany("UPDATE j2_notes SET body_json = ? WHERE id = ?", [(body, i) for i in ids])
    c.commit()
    poison = ids[0]                   # first in walk order: everything after it must still run
    real = notes_mod._sync_note_sidecars

    def sync(conn, user_id, note_id, doc, body_plain):
        real(conn, user_id, note_id, doc, body_plain)       # writes its rows, THEN fails
        if note_id == poison:
            raise ValueError("a body the projection cannot read")

    monkeypatch.setattr(notes_mod, "_sync_note_sidecars", sync)
    with caplog.at_level(logging.WARNING):
        out = j2db.run_internal_link_projection_backfill(c)
    assert out["synced"] == 2 and out["failed"] == 1
    assert all(_link_rows(c, i) == [b["id"]] for i in ids[1:])
    assert _link_rows(c, poison) == []                       # its partial write was undone
    assert (tmp_path / ".note_links_internal_href_v1").exists()
    assert any(poison in r.getMessage() for r in caplog.records)


def test_backfill_writes_no_flag_over_an_empty_notebook(monkeypatch, tmp_path):
    """v4's rule: a flag over zero notes would let a restored backup skip the pass forever."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = _conn()
    j2db.run_internal_link_projection_backfill(c)
    assert not (tmp_path / ".note_links_internal_href_v1").exists()


# ── Fix round 1, I1: the backfill never holds the write lock while scanning ────

def _file_db_with_links(tmp_path, n):
    """A file-backed WAL notebook (a second connection can contend for its write
    lock) holding `n` notes whose stored bodies carry an internal link mark."""
    path = tmp_path / "j2.db"
    c = sqlite3.connect(str(path), timeout=0)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    ensure_schema(c)
    b = _create(c, "u1", "B", _doc())
    ids = [_create(c, "u1", f"A{i}", _doc())["id"] for i in range(n)]
    body = json.dumps(_doc(_para(_linked("x", _href(b["id"])))))
    c.executemany("UPDATE j2_notes SET body_json = ? WHERE id = ?", [(body, i) for i in ids])
    c.commit()
    return path, c, b["id"], ids


def _another_writer_can_take_the_lock(path):
    """True when a SECOND connection can take the write lock right now, with no wait."""
    other = sqlite3.connect(str(path), timeout=0)
    try:
        other.execute("BEGIN IMMEDIATE")
        other.execute("ROLLBACK")
        return True
    except sqlite3.OperationalError:
        return False
    finally:
        other.close()


def test_backfill_scans_unlocked_and_releases_the_lock_between_chunks(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(j2db, "_INTERNAL_LINK_BACKFILL_BATCH", 3)
    monkeypatch.setattr(j2db, "_INTERNAL_LINK_BACKFILL_CHUNK", 2)
    path, c, b_id, ids = _file_db_with_links(tmp_path, 7)

    scans, pauses = [], []
    real_scan = j2db._scan_internal_link_candidates

    def watched_scan(conn, after, limit):
        # The scan runs with NO transaction open, and another writer can get in.
        scans.append((conn.in_transaction, _another_writer_can_take_the_lock(path)))
        out = real_scan(conn, after, limit)
        assert len(out) <= limit
        return out

    def watched_pause(seconds=0.05):
        pauses.append((c.in_transaction, _another_writer_can_take_the_lock(path)))

    monkeypatch.setattr(j2db, "_scan_internal_link_candidates", watched_scan)
    monkeypatch.setattr(j2db, "_internal_link_backfill_pause", watched_pause)

    out = j2db.run_internal_link_projection_backfill(c)
    assert out["synced"] == 7
    assert all(_link_rows(c, i) == [b_id] for i in ids)
    assert len(scans) >= 3 and all(s == (False, True) for s in scans), scans
    # 7 notes in pages of 3 = chunks of 2+1, 2+1, 1 -> five chunks, five pauses
    assert len(pauses) == 5 and all(p == (False, True) for p in pauses), pauses
    assert (tmp_path / "data" / ".note_links_internal_href_v1").exists()
    assert j2db.run_internal_link_projection_backfill(c).get("skipped") is True
    c.close()


def test_CONTROL_a_held_lock_is_seen_by_the_probe(tmp_path):
    """The rail above can only pass by measuring: a connection holding the write
    lock makes the probe answer False."""
    path, c, _b, _ids = _file_db_with_links(tmp_path, 1)
    c.execute("BEGIN IMMEDIATE")
    try:
        assert _another_writer_can_take_the_lock(path) is False
    finally:
        c.execute("ROLLBACK")
    assert _another_writer_can_take_the_lock(path) is True
    c.close()


def test_backfill_projects_the_body_as_it_is_when_its_chunk_runs(monkeypatch, tmp_path):
    """A save that lands between the unlocked scan and the chunk is what gets
    projected: the chunk re-reads each body by id under the lock."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    path, c, b_id, ids = _file_db_with_links(tmp_path, 1)
    d = _create(c, "u1", "D", _doc())
    real_scan = j2db._scan_internal_link_candidates

    def scan_then_member_saves(conn, after, limit):
        out = real_scan(conn, after, limit)
        if out:
            other = sqlite3.connect(str(path))
            other.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?",
                          (json.dumps(_doc(_para(_linked("y", _href(d["id"]))))), ids[0]))
            other.commit()
            other.close()
        return out

    monkeypatch.setattr(j2db, "_scan_internal_link_candidates", scan_then_member_saves)
    j2db.run_internal_link_projection_backfill(c)
    assert _link_rows(c, ids[0]) == [d["id"]]
    c.close()


def test_the_boot_starter_runs_the_backfill_on_a_daemon_thread_with_its_own_connection(
        monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    path, c, b_id, ids = _file_db_with_links(tmp_path, 2)
    opened = []

    def connect():
        conn = sqlite3.connect(str(path), timeout=30)
        opened.append(conn)
        return conn

    t = j2db.start_internal_link_projection_backfill(connect)
    assert t is not None and t.daemon
    t.join(timeout=30)
    assert not t.is_alive()
    assert len(opened) == 1 and opened[0] is not c
    assert all(_link_rows(c, i) == [b_id] for i in ids)
    assert (tmp_path / "data" / ".note_links_internal_href_v1").exists()
    assert j2db.start_internal_link_projection_backfill(connect) is None  # flagged: no thread
    c.close()


def test_the_backfill_is_started_by_main_after_init_db_never_by_ensure_schema():
    """Fix round 1, I1: started from the lifespan once `_init_auth_db()` has run and
    committed, never from inside `ensure_schema`, where it raced the boot
    connection's remaining schema writes."""
    import ast
    import inspect

    ensure_src = inspect.getsource(j2db.ensure_schema)
    assert "start_internal_link_projection_backfill" not in ensure_src
    main_src = (REPO / "api/main.py").read_text(encoding="utf-8")
    tree = ast.parse(main_src)
    life = next(n for n in ast.walk(tree)
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    calls = [(n.lineno, n.func.id) for n in ast.walk(life)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id in ("_init_auth_db", "start_internal_link_projection_backfill")]
    names = [name for _ln, name in sorted(calls)]
    assert names == ["_init_auth_db", "start_internal_link_projection_backfill"], calls


# ── Fix round 1, M2: a failed projection undoes the body write, and only it ────

def test_a_failed_projection_rolls_back_the_engine_body_write(monkeypatch):
    from api.services.journal_two import notes as notes_mod
    c = _conn()
    b = _create(c, "u1", "B", _doc())
    original = _doc(_para(_linked("my alias", "import-link://notion:b-key")))
    a = _create(c, "u1", "A", original)
    c.commit()
    before = c.execute("SELECT updated_at, body_json FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()
    # Something else the connection holds, uncommitted: a savepoint must not discard it.
    c.execute("UPDATE j2_notes SET title = 'kept' WHERE id = ?", (b["id"],))

    def boom(*_a, **_k):
        raise RuntimeError("projection failed")

    monkeypatch.setattr(notes_mod, "_sync_note_sidecars", boom)
    resolved = _doc(_para(_linked("my alias", _href(b["id"]))))
    with pytest.raises(RuntimeError, match="projection failed"):
        engine._apply_resolved_body(c, "u1", a["id"], resolved, expected_updated_at=before["updated_at"])
    after = c.execute("SELECT updated_at, body_json FROM j2_notes WHERE id = ?", (a["id"],)).fetchone()
    assert after["body_json"] == before["body_json"]
    assert json.loads(after["body_json"]) == original
    assert after["updated_at"] == before["updated_at"]
    assert _link_rows(c, a["id"]) == []
    assert c.execute("SELECT title FROM j2_notes WHERE id = ?", (b["id"],)).fetchone()[0] == "kept"


