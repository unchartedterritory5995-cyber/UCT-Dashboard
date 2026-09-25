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
