"""Wave 8 lane 8B, B4 -- an account deletion takes every publication with it.

`j2_note_publications` is self-ensured by note_publish.py and listed in
`account_purge._DIRECT_USER_TABLES`; docs/account-deletion-manifest.md is regenerated from
that list (tests/test_account_deletion_manifest.py holds the two equal). This file proves the
row-level half: after `purge_user_data(A)` A has ZERO publication rows, B's are untouched, and
A's pages answer the one not-found.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest

A, B = "user-purge-a", "user-purge-b"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def _count(user_id: str) -> int:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM j2_note_publications WHERE user_id = ?", (user_id,)).fetchone()[0]
    finally:
        c.close()


def test_an_account_purge_leaves_zero_publication_rows(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import account_purge, note_publish, notes
    slugs = {}
    for user in (A, B):
        n = notes.create_note(user, {"title": f"{user} note"})["id"]
        f = notes.create_folder(user, f"{user} folder")["id"]
        notes.create_note(user, {"title": "member", "folderId": f})
        slugs[user] = (note_publish.publish_note(user, n)["slug"], note_publish.publish_folder(user, f)["slug"])
    # a revoked row is still a row, and must go too
    note_publish.revoke(A, slugs[A][0])
    note_publish.publish_note(A, notes.create_note(A, {"title": "again"})["id"])
    assert _count(A) == 3 and _count(B) == 2                                # control: rows exist

    c = get_connection()
    try:
        report = account_purge.purge_user_data(A, c)
        c.commit()
    finally:
        c.close()
    assert not report.get("errors"), report
    assert _count(A) == 0
    assert _count(B) == 2                                                    # scoped to A
    assert note_publish.resolve(slugs[A][1]) is None
    assert note_publish.resolve(slugs[B][1]) is not None


def test_the_table_is_in_the_purge_list():
    from api.services.journal_two import account_purge
    assert "j2_note_publications" in account_purge._DIRECT_USER_TABLES
