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


def test_backfill_writes_no_flag_over_an_empty_notebook(monkeypatch, tmp_path):
    """v4's rule: a flag over zero notes would let a restored backup skip the pass forever."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = _conn()
    j2db.run_internal_link_projection_backfill(c)
    assert not (tmp_path / ".note_links_internal_href_v1").exists()


def test_the_boot_hook_runs_the_backfill_in_a_background_thread(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    path = tmp_path / "j2.db"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    b = _create(c, "u1", "B", _doc())
    a = _create(c, "u1", "A", _doc())
    c.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?",
              (json.dumps(_doc(_para(_linked("x", _href(b["id"]))))), a["id"]))
    c.commit()
    t = j2db.start_internal_link_projection_backfill(c)
    assert t is not None and t.daemon
    t.join(timeout=30)
    assert not t.is_alive()
    assert _link_rows(c, a["id"]) == [b["id"]]
    assert (tmp_path / "data" / ".note_links_internal_href_v1").exists()
    assert j2db.start_internal_link_projection_backfill(c) is None  # flag present: no thread
    c.close()


def test_the_boot_hook_starts_no_thread_for_an_in_memory_db(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = _conn()
    _create(c, "u1", "A", _doc())
    assert j2db.start_internal_link_projection_backfill(c) is None
