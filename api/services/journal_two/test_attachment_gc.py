"""Tests for the orphaned note-attachment GC (attachment_gc.py).

The sweep's four safety rails each get a case that FAILS if the rail is
deleted: user-wide references (cross-note paste), the upload-name shape
filter, the age gate, and dry_run.
"""

from __future__ import annotations

import sqlite3
import time
import uuid

import pytest

from api.services.journal_two import attachment_gc, notes as notes_mod
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def root(tmp_path, monkeypatch):
    r = tmp_path / "j2_attachments"
    monkeypatch.setattr(notes_mod, "_ATTACHMENT_ROOT", r)
    return r


OLD = time.time() - 10 * 24 * 3600  # far past the 48h gate


def _mkfile(root, user, note, sub, name, *, mtime=OLD, data=b"png"):
    d = root / user / "notes" / note / sub
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    f.write_bytes(data)
    import os
    os.utime(f, (mtime, mtime))
    return f


def _upload_name(ext=".png"):
    return f"{uuid.uuid4().hex}{ext}"


def _note_with_url(conn, user, name):
    body = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": f"see /api/j2/notes/attachments/{user}/n1/inline/{name}"},
    ]}]}
    return notes_mod.create_note(user, {"title": "ref", "bodyJson": body}, conn=conn)


def test_referenced_file_survives_and_orphan_goes(conn, root):
    kept = _upload_name()
    gone = _upload_name()
    note = _note_with_url(conn, "u1", kept)
    _mkfile(root, "u1", note["id"], "inline", kept)
    f_gone = _mkfile(root, "u1", note["id"], "inline", gone)
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert rep["deleted"] == 1 and rep["orphaned"] == 1
    assert not f_gone.exists()
    assert (root / "u1" / "notes" / note["id"] / "inline" / kept).exists()


def test_cross_note_reference_protects_the_file(conn, root):
    """An embed pasted from note A into note B carries A's fallback URL — the
    reference set must be user-wide or B's archive dies with A's directory."""
    name = _upload_name()
    _note_with_url(conn, "u1", name)              # the REFERENCING note (B)
    f = _mkfile(root, "u1", "deleted-note-a", "inline", name)  # A's dir, note row gone
    stray = _mkfile(root, "u1", "deleted-note-a", "inline", _upload_name())
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert f.exists(), "cross-note referenced file must survive its home note's deletion"
    assert not stray.exists()
    assert rep["deleted"] == 1


def test_age_gate_spares_young_uploads(conn, root):
    young = _mkfile(root, "u1", "n1", "inline", _upload_name(), mtime=time.time())
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert young.exists()
    assert rep["deleted"] == 0 and rep["skipped_young"] == 1 and rep["orphaned"] == 1


def test_only_our_upload_shape_is_ever_touched(conn, root):
    handplaced = _mkfile(root, "u1", "n1", "inline", "readme-keep.png")
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert handplaced.exists()
    assert rep["orphaned"] == 0 and rep["files_scanned"] == 1


def test_dry_run_deletes_nothing_but_names_the_bodies(conn, root):
    f = _mkfile(root, "u1", "n1", "inline", _upload_name())
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn, dry_run=True)
    assert f.exists()
    assert rep["deleted"] == 0 and rep["orphaned"] == 1
    assert rep["examples"] and rep["examples"][0].startswith("u1/notes/n1/inline/")


def test_inbox_fallback_url_counts_as_a_reference(conn, root):
    name = _upload_name()
    conn.execute(
        "INSERT INTO j2_capture_inbox (id, user_id, widget_id, params_json,"
        " search_text, fallback_url, captured_at, created_at)"
        " VALUES ('c1', 'u1', 'chart', '{}', '[chart]',"
        " '/api/j2/notes/attachments/u1/n1/inline/" + name + "', 't', 't')"
    )
    f = _mkfile(root, "u1", "n1", "inline", name)
    attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert f.exists()


def test_user_scope_limits_the_walk(conn, root):
    f1 = _mkfile(root, "u1", "n1", "inline", _upload_name())
    f2 = _mkfile(root, "u2", "n9", "inline", _upload_name())
    rep = attachment_gc.sweep_orphaned_attachments(conn=conn, user_id="u2")
    assert f1.exists() and not f2.exists()
    assert rep["users"] == 1


def test_empty_dirs_fold_up_after_delete(conn, root):
    _mkfile(root, "u1", "n1", "inline", _upload_name())
    attachment_gc.sweep_orphaned_attachments(conn=conn)
    assert not (root / "u1" / "notes" / "n1" / "inline").exists()
    assert not (root / "u1" / "notes" / "n1").exists()
