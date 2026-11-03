"""Does `connections.swap_token_if_unchanged` really get `BEGIN IMMEDIATE` from `get_connection()`?
(Plan E Task 6, Step 4b.)

`get_connection()` hands out POOLED connections (`_PooledConnection`, `timeout=3`, default
isolation level). Two things could silently defeat the compare-and-swap: a pooled connection handed
out with a transaction already open, and an isolation mode that makes the explicit `BEGIN` a no-op.
These tests run against a real temp `auth.db` FILE (never `:memory:`, which is per-connection), with
real concurrent connections.
"""

from __future__ import annotations

import importlib
import json
import sqlite3
import threading
import time

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema

USER = "u-cas"


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.note_connectors.connections as conns
    importlib.reload(conns)
    conns.upsert_connector(USER, "evernote", _creds("rt0"))
    yield conns
    auth_db._drain_pool()


def _creds(rt: str) -> dict:
    return {"accessToken": f"at-{rt}", "refreshToken": rt, "expiresAt": None, "clientId": "cid"}


def _raw(path: str, timeout: float = 0.2) -> sqlite3.Connection:
    return sqlite3.connect(path, timeout=timeout, isolation_level=None, check_same_thread=False)


def test_two_threads_swapping_the_same_expected_token_exactly_one_wins(tmp_db):
    barrier = threading.Barrier(2)
    results: dict[str, bool] = {}
    errors: list[BaseException] = []

    def run(rt: str) -> None:
        try:
            barrier.wait(5)
            results[rt] = tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds(rt))
        except BaseException as exc:  # pragma: no cover - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(rt,)) for rt in ("rtA", "rtB")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    assert errors == []
    assert sorted(results.values()) == [False, True]
    winner = next(rt for rt, won in results.items() if won)
    stored = tmp_db.get_token(USER, "evernote")
    assert stored == _creds(winner)  # the winner's whole blob, never a mix


def test_swap_holds_the_write_lock_between_read_and_write(tmp_db, monkeypatch):
    in_swap, go = threading.Event(), threading.Event()
    real_decrypt = tmp_db._decrypt_token
    state = {"first": True}

    def slow_decrypt(blob):
        out = real_decrypt(blob)
        if state["first"]:
            state["first"] = False
            in_swap.set()
            assert go.wait(10)
        return out

    monkeypatch.setattr(tmp_db, "_decrypt_token", slow_decrypt)
    result: dict = {}
    t = threading.Thread(target=lambda: result.setdefault(
        "won", tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds("rt1"))))
    t.start()
    assert in_swap.wait(10)  # the swap has READ and not yet written
    other = _raw(auth_db._DB_PATH)
    try:
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            other.execute("BEGIN IMMEDIATE")
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            other.execute("UPDATE j2_note_connectors SET updated_at = 'x' WHERE user_id = ?", (USER,))
    finally:
        other.close()
        go.set()
        t.join(15)
    assert result["won"] is True
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt1"


def test_swap_under_a_held_write_lock_times_out_without_writing(tmp_db):
    holder = _raw(auth_db._DB_PATH, timeout=1)
    holder.execute("BEGIN IMMEDIATE")
    try:
        started = time.monotonic()
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds("rt1"))
        assert time.monotonic() - started >= 2.5  # it waited the busy timeout, then gave up
    finally:
        holder.execute("ROLLBACK")
        holder.close()
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt0"


@pytest.mark.parametrize("expected,won", [("rt0", True), ("rt-stale", False)])
def test_swap_on_a_pooled_connection_starts_its_own_transaction(tmp_db, monkeypatch, expected, won):
    monkeypatch.setattr(auth_db, "_pooling", lambda: True)
    warm = auth_db.get_connection()
    warm.execute("SELECT 1").fetchone()
    warm.close()  # back into the pool, so the swap REUSES it
    assert auth_db._POOL.get(auth_db._DB_PATH)

    seen: dict = {}
    real = tmp_db.get_connection

    def traced():
        conn = real()
        seen["conn"] = conn
        execute, close = conn.execute, conn.close

        def traced_execute(sql, *args):
            if sql.strip().upper() == "BEGIN IMMEDIATE":
                seen["before_begin"] = conn.in_transaction
            return execute(sql, *args)

        def traced_close():
            seen["at_close"] = conn.in_transaction
            conn.execute, conn.close = execute, close  # leave the pooled object as it was
            return close()

        conn.execute, conn.close = traced_execute, traced_close
        return conn

    monkeypatch.setattr(tmp_db, "get_connection", traced)
    assert tmp_db.swap_token_if_unchanged(USER, "evernote", expected, _creds("rt1")) is won
    assert seen["conn"] is warm  # the pooled connection, reused
    assert seen["before_begin"] is False  # no transaction was open when BEGIN IMMEDIATE ran
    assert seen["at_close"] is False  # committed or rolled back: never left open
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == ("rt1" if won else "rt0")
