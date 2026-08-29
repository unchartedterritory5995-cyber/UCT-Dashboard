"""Tests for auth_db.py's connection/retry helpers."""
import importlib
import os
import sqlite3

import pytest


def _reload_auth_db():
    """Reimport auth_db so it picks up the current AUTH_DB_PATH env var."""
    from api.services import auth_db
    importlib.reload(auth_db)
    return auth_db


def _make_db(path: str) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)")
        conn.commit()
    finally:
        conn.close()


def test_execute_with_retry_retries_once_on_locked_then_succeeds(tmp_path, monkeypatch):
    """A transient 'database is locked' on the first attempt must be
    retried once instead of raised straight to the caller — this is what
    was landing as a 500 on POST /api/auth/preferences under concurrent
    writes (auth.db is single-writer SQLite on the universal request path;
    see get_connection's timeout=3 note)."""
    db_path = os.path.join(str(tmp_path), "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", db_path)
    auth_db = _reload_auth_db()
    _make_db(db_path)

    real_get_connection = auth_db.get_connection
    calls = {"n": 0}

    class _FlakyConn:
        def __init__(self, real):
            self._real = real

        def execute(self, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise sqlite3.OperationalError("database is locked")
            return self._real.execute(*args, **kwargs)

        def commit(self):
            return self._real.commit()

        def close(self):
            return self._real.close()

    monkeypatch.setattr(auth_db, "get_connection", lambda: _FlakyConn(real_get_connection()))

    auth_db.execute_with_retry("INSERT INTO t (k, v) VALUES (?, ?)", (1, "hello"))

    assert calls["n"] == 2, "expected one retry after a single locked error"
    check = sqlite3.connect(db_path)
    try:
        assert check.execute("SELECT v FROM t WHERE k=1").fetchone() == ("hello",)
    finally:
        check.close()


def test_execute_with_retry_raises_after_exhausting_retries(tmp_path, monkeypatch):
    """A lock that never clears must still surface as an error, not hang or
    silently succeed — the retry is bounded, not infinite."""
    db_path = os.path.join(str(tmp_path), "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", db_path)
    auth_db = _reload_auth_db()
    _make_db(db_path)

    class _AlwaysLockedConn:
        def execute(self, *args, **kwargs):
            raise sqlite3.OperationalError("database is locked")

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(auth_db, "get_connection", lambda: _AlwaysLockedConn())

    with pytest.raises(sqlite3.OperationalError):
        auth_db.execute_with_retry("INSERT INTO t (k, v) VALUES (?, ?)", (1, "hello"))


def test_execute_with_retry_does_not_retry_other_errors(tmp_path, monkeypatch):
    """Only lock contention is worth retrying. Any other OperationalError
    (a genuine SQL/schema mistake) must raise immediately — retrying can
    never fix it, and burning the backoff on it only delays the real error."""
    db_path = os.path.join(str(tmp_path), "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", db_path)
    auth_db = _reload_auth_db()
    _make_db(db_path)

    calls = {"n": 0}

    class _BrokenConn:
        def execute(self, *args, **kwargs):
            calls["n"] += 1
            raise sqlite3.OperationalError("no such table: missing")

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(auth_db, "get_connection", lambda: _BrokenConn())

    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        auth_db.execute_with_retry("INSERT INTO missing (k) VALUES (1)")
    assert calls["n"] == 1, "a non-lock error must not be retried"
