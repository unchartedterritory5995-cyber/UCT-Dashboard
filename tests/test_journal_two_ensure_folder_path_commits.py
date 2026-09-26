"""`notes.ensure_folder_path` with NO connection must leave its folders COMMITTED
(wave 7, lane I; reported by lane G).

The function opens its own connection when handed none, and creates any missing
folder of the chain through `create_folder(..., conn=conn)`. `create_folder` commits
only a connection IT opened, so the chain was written inside a transaction nobody
committed, and closing the connection threw it away. The caller got back a folder
id for a row that did not exist. Lane G met it through the personal API as "The
note wasn't saved: folder not found." and worked around it by passing an
already-committed connection; the no-connection form stayed a trap for the next
caller.

The rail reads the result the way the next request would: from a FRESH connection
opened after the call returned. A read on the writer's own connection would see
its uncommitted rows and pass either way.
"""
from __future__ import annotations

import sqlite3
import threading

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "folders.db"
    c = sqlite3.connect(str(path))
    j2db.ensure_schema(c)
    c.commit()
    c.close()
    opened = []

    def _open():
        conn = sqlite3.connect(str(path), timeout=3)
        conn.row_factory = sqlite3.Row
        opened.append(conn)
        return conn

    # The function's own connection comes from the module-level opener.
    monkeypatch.setattr(notes_svc, "get_connection", _open)
    return path, opened


def _fresh_rows(path):
    c = sqlite3.connect(str(path))
    try:
        return {(r[0], r[1], r[2]) for r in c.execute(
            "SELECT id, name, parent_id FROM j2_note_folders WHERE user_id = ?", (U,))}
    finally:
        c.close()


def test_the_folder_chain_is_committed_when_the_function_owns_the_connection(db_path):
    path, opened = db_path
    leaf = notes_svc.ensure_folder_path(U, ["Inbox", "Shortcuts"])
    # control: the function really took the no-connection branch and opened its own
    assert len(opened) == 1, "ensure_folder_path did not open its own connection"
    rows = _fresh_rows(path)
    by_name = {name: (fid, parent) for fid, name, parent in rows}
    assert set(by_name) == {"Inbox", "Shortcuts"}, (
        "a fresh connection cannot see the folders ensure_folder_path created -- "
        "they were never committed", rows)
    assert by_name["Shortcuts"] == (leaf, by_name["Inbox"][0])
    assert by_name["Inbox"][1] == ""


def test_an_existing_chain_is_reused_not_recreated(db_path):
    path, _ = db_path
    first = notes_svc.ensure_folder_path(U, ["Inbox"])
    again = notes_svc.ensure_folder_path(U, ["Inbox"])
    assert again == first
    assert len(_fresh_rows(path)) == 1


def test_a_callers_connection_is_left_for_the_caller_to_commit(db_path):
    """The other half of the contract, unchanged: handed a connection, the function
    writes in the caller's transaction and does NOT commit it (the importer and the
    personal API both commit their own, after the note write)."""
    path, _ = db_path
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    try:
        notes_svc.ensure_folder_path(U, ["Inbox"], conn=c)
        assert c.in_transaction, "the caller's transaction was committed out from under it"
        assert _fresh_rows(path) == set()
        c.commit()
        assert {name for _, name, _ in _fresh_rows(path)} == {"Inbox"}
    finally:
        c.close()


def test_non_vacuity_a_fresh_connection_sees_a_committed_folder(db_path):
    """`create_folder` with no connection commits; if the fresh reader could not see
    THAT, the first test would be red for the wrong reason."""
    path, _ = db_path
    notes_svc.create_folder(U, "Direct")
    assert {name for _, name, _ in _fresh_rows(path)} == {"Direct"}


# ── whole-branch fix · M-9: concurrent first use makes ONE folder ─────────────

class _HeldAfterFirstRead:
    """A connection whose FIRST "is this folder there?" read waits at a barrier
    until every racer has made it: the exact interleaving that makes two
    `Inbox` folders when the check and the insert are split."""

    def __init__(self, conn, barrier):
        self._c = conn
        self._barrier = barrier
        self._held = False

    def execute(self, sql, *args):
        cur = self._c.execute(sql, *args)
        if not self._held and sql.lstrip().upper().startswith("SELECT ID FROM J2_NOTE_FOLDERS"):
            self._held = True
            self._barrier.wait(timeout=10)
        return cur

    def __getattr__(self, name):
        return getattr(self._c, name)


def _race(n, go):
    results, errors = [], []

    def run():
        try:
            results.append(go())
        except Exception as e:  # noqa: BLE001 -- surfaced below
            errors.append(repr(e))

    threads = [threading.Thread(target=run) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results, errors


def _inbox_rows(path):
    return [r for r in _fresh_rows(path) if r[1] == "Inbox"]


def test_two_concurrent_first_uses_make_ONE_folder_when_it_owns_the_connection(db_path, monkeypatch):
    """Backend review M-9: `ensure_folder_path` did a SELECT and then an INSERT
    with no lock between them, and there is no unique index on (user_id,
    parent_id, name) -- deliberately none now either: existing production
    duplicates would make such a migration fail. Email-in's `Inbox` and the
    personal API's `folder` path are concurrent first users (Cloudflare
    delivers in parallel). The check and the insert now run under BEGIN
    IMMEDIATE."""
    path, _ = db_path
    barrier = threading.Barrier(2)

    def _open():
        conn = sqlite3.connect(str(path), timeout=10)
        conn.row_factory = sqlite3.Row
        return _HeldAfterFirstRead(conn, barrier)

    monkeypatch.setattr(notes_svc, "get_connection", _open)
    results, errors = _race(2, lambda: notes_svc.ensure_folder_path(U, ["Inbox"]))
    assert errors == []
    assert len(_inbox_rows(path)) == 1, _fresh_rows(path)
    assert len(results) == 2 and len(set(results)) == 1, "the two callers were given different folders"


def test_two_concurrent_first_uses_make_ONE_folder_on_the_callers_connections(db_path):
    """The email-in / personal-API shape: each caller opens its own
    connection, hands it in, and commits after."""
    path, _ = db_path
    barrier = threading.Barrier(2)

    def go():
        raw = sqlite3.connect(str(path), timeout=10)
        raw.row_factory = sqlite3.Row
        conn = _HeldAfterFirstRead(raw, barrier)
        try:
            fid = notes_svc.ensure_folder_path(U, ["Inbox"], conn=conn)
            raw.commit()
            return fid
        finally:
            raw.close()

    results, errors = _race(2, go)
    assert errors == []
    assert len(_inbox_rows(path)) == 1, _fresh_rows(path)
    assert len(set(results)) == 1


def test_an_EXISTING_folder_takes_no_write_lock(db_path):
    """The common case -- the folder is already there -- stays a plain read: a
    caller's connection is not left holding a write transaction for nothing."""
    path, _ = db_path
    first = notes_svc.ensure_folder_path(U, ["Inbox"])
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    try:
        assert notes_svc.ensure_folder_path(U, ["Inbox"], conn=c) == first
        assert not c.in_transaction, "an existing folder took the write lock"
    finally:
        c.close()


def test_a_caller_already_in_a_transaction_is_left_to_commit_it(db_path):
    """The importer's shape: it has written before it asks for a folder, so its
    transaction already holds the lock; the function must not try to open a
    second one (`cannot start a transaction within a transaction`)."""
    path, _ = db_path
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    try:
        notes_svc.create_folder(U, "Earlier", conn=c)
        assert c.in_transaction
        fid = notes_svc.ensure_folder_path(U, ["Inbox"], conn=c)
        assert c.in_transaction and fid
        c.commit()
        assert {name for _, name, _ in _fresh_rows(path)} == {"Earlier", "Inbox"}
    finally:
        c.close()
