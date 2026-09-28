"""restore_note_version never leaves its own write transaction open (wave 10, 10C re-review minor m1).

The restore takes BEGIN IMMEDIATE before it reads (the atomic compare-and-set). When the version exists
but the note is trashed, update_note -- running inside the restore's transaction -- answers None without
rolling back, because it did not begin the transaction. The restore must then release what IT began:
on a caller-supplied connection, a held write lock would stall every other note save behind it.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def notes(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import notes as svc
    yield auth_db, svc
    importlib.reload(auth_db)


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _note_with_a_version(auth_db, svc, uid="u-restore"):
    c = auth_db.get_connection()
    try:
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", (uid, f"{uid}@local.test"))
        c.commit()
    finally:
        c.close()
    note = svc.create_note(uid, {"title": "t", "bodyJson": _doc("first")})
    svc.update_note(uid, note["id"], {"bodyJson": _doc("second")}, force_version=True)
    versions = svc.list_note_versions(uid, note["id"])
    assert versions, "non-vacuity: an edit must have captured a version to restore"
    vid = versions[0]["id"] if isinstance(versions[0], dict) else versions[0]
    return uid, note["id"], vid


def test_a_restore_of_a_TRASHED_note_answers_None_and_releases_the_callers_connection(notes):
    auth_db, svc = notes
    uid, nid, vid = _note_with_a_version(auth_db, svc)
    assert svc.delete_note(uid, nid)                      # trash it: the version still exists
    conn = auth_db.get_connection()
    try:
        assert svc.restore_note_version(uid, nid, vid, conn=conn) is None
        assert not conn.in_transaction, "the restore left its BEGIN IMMEDIATE open on the caller's connection"
    finally:
        conn.close()


def test_CONTROL_a_restore_of_a_live_note_still_restores(notes):
    auth_db, svc = notes
    uid, nid, vid = _note_with_a_version(auth_db, svc, uid="u-restore-live")
    conn = auth_db.get_connection()
    try:
        out = svc.restore_note_version(uid, nid, vid, conn=conn)
        assert out is not None and "first" in (out.get("bodyPlain") or ""), out
    finally:
        conn.close()
