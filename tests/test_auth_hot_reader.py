"""The two reads every authenticated request makes: one statement each, and nothing remembered.

Measured 2026-11-14. Through the connection pool, "read my session, then my plan" is ten
sqlite statements (two real reads and eight of the pool's own), and CPython hands the GIL
over around every one: 0.06 ms alone, 6 ms beside eight busy threads, 21 beside sixteen, 67
beside thirty. On production an unauthenticated tiny request took 62 ms twelve at once and a
signed-in tiny one 87 to 161 ms (190 to 520 in the minutes after a restart).

`auth_db.read_row` gives those two reads a per-thread, read-only connection of their own.
What this file holds it to:
  * the SAME answers as the pooled read, and exactly two statements for a check;
  * nothing is remembered: a revoked session, a changed plan, a renamed user are seen by the
    very next call;
  * the reader cannot write (sqlite refuses), the two writes `validate_session` makes still
    happen, through the pool;
  * a statement the schema refuses keeps the reader; a busy file is raised, not retried; a
    broken reader is dropped and the read is made through the pool;
  * off under pytest unless a test turns it on, and it never creates the file.

⛔ Every database is a tmp file. Nothing reads C:\\data.
"""
import sqlite3
import threading
import types

import pytest

from api.services import auth_db, auth_service

_REAL_POOLING = auth_db._pooling


@pytest.fixture
def hot(tmp_path, monkeypatch):
    """The real schema in a tmp file, one comped member with one session, the reader ON."""
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_pooling", lambda: True)      # pytest re-sets PYTEST_CURRENT_TEST per phase
    auth_db._drain_pool()
    auth_db.drop_hot_reader()
    auth_db.init_db()
    user = auth_service.create_user("reader@uctintelligence.internal", "Passw0rd!x", "reader")
    uid = user["id"] if isinstance(user, dict) else user
    tok = auth_service.create_session(uid)
    auth_service.comp_user_access("reader@uctintelligence.internal", True)
    monkeypatch.setattr(auth_service, "_should_write_last_login", lambda *a, **k: False)   # its own test turns it on
    yield types.SimpleNamespace(uid=uid, tok=tok, path=auth_db._DB_PATH)
    auth_db.drop_hot_reader()
    auth_db._drain_pool()


def _sql(path, statement, params=()):
    conn = sqlite3.connect(path)
    try:
        out = conn.execute(statement, params).fetchall()
        conn.commit()
        return out
    finally:
        conn.close()


def _check(ns):
    user = auth_service.validate_session(ns.tok)
    return user, (auth_service.get_user_plan(user["id"]) if user else None)


# ── the same answers, in two statements ──────────────────────────────────────

def test_the_reader_answers_what_the_pool_answers(hot, monkeypatch):
    with_reader = _check(hot)
    assert with_reader[0]["id"] == hot.uid and with_reader[1] == "pro"
    assert auth_db._HOT.conn is not None, "the reader was not used: the comparison would be vacuous"
    auth_db.drop_hot_reader()
    with monkeypatch.context() as m:
        m.setattr(auth_db, "hot_reader", lambda: None)             # the pooled read, as before
        through_pool = _check(hot)
    assert with_reader == through_pool
    assert auth_service.get_subscription(hot.uid) == dict(_row(hot.path, "SELECT * FROM subscriptions WHERE user_id = ?", (hot.uid,)))


def _row(path, statement, params):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(statement, params).fetchone()
    finally:
        conn.close()


def test_a_check_is_two_statements_and_touches_no_pooled_connection(hot, monkeypatch):
    _check(hot)                                                     # opens this thread's reader
    seen = []
    auth_db.hot_reader().set_trace_callback(seen.append)
    monkeypatch.setattr(auth_db, "get_connection", lambda: pytest.fail("a read went to the pool"))
    assert _check(hot)[1] == "pro"
    auth_db.hot_reader().set_trace_callback(None)
    assert len(seen) == 2, seen
    assert seen[0].startswith("SELECT s.user_id") and seen[1].startswith("SELECT * FROM subscriptions")


def test_CONTROL_through_the_pool_the_same_check_is_ten_statements(hot, monkeypatch):
    monkeypatch.setattr(auth_db, "hot_reader", lambda: None)
    seen = []
    real = auth_db.get_connection

    def traced():
        c = real()
        c.set_trace_callback(seen.append)
        return c
    _check(hot)
    monkeypatch.setattr(auth_db, "get_connection", traced)
    _check(hot)
    # two reads + the pool's proof on each return (the two pragmas on each checkout run before the trace is set)
    assert len(seen) == 6 and sum(1 for s in seen if s.startswith("SELECT s.") or s.startswith("SELECT * FROM subs")) == 2, seen


def test_every_call_gets_its_own_dict(hot):
    a = auth_service.validate_session(hot.tok)
    a["plan"] = "tampered"
    a["id"] = "someone-else"
    b = auth_service.validate_session(hot.tok)
    assert b["id"] == hot.uid and "plan" not in b


# ── nothing is remembered ────────────────────────────────────────────────────

def test_a_revoked_session_is_refused_by_the_very_next_call(hot):
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid
    auth_service.delete_session(hot.tok)
    assert auth_service.validate_session(hot.tok) is None


def test_a_changed_plan_is_seen_by_the_very_next_call(hot):
    assert auth_service.get_user_plan(hot.uid) == "pro"
    _sql(hot.path, "UPDATE subscriptions SET status = 'canceled' WHERE user_id = ?", (hot.uid,))
    assert auth_service.get_user_plan(hot.uid) == "free"
    _sql(hot.path, "DELETE FROM subscriptions WHERE user_id = ?", (hot.uid,))
    assert auth_service.get_user_plan(hot.uid) == "free" and auth_service.get_subscription(hot.uid) is None


def test_a_changed_user_is_seen_by_the_very_next_call(hot):
    assert auth_service.validate_session(hot.tok)["role"] != "admin"
    _sql(hot.path, "UPDATE users SET role = 'admin', display_name = 'renamed' WHERE id = ?", (hot.uid,))
    after = auth_service.validate_session(hot.tok)
    assert after["role"] == "admin" and after["display_name"] == "renamed"


def test_a_write_from_another_connection_in_this_process_is_seen_at_once(hot):
    auth_service.validate_session(hot.tok)
    second = auth_service.create_session(hot.uid)                   # through the pool, after the reader opened
    assert auth_service.validate_session(second)["id"] == hot.uid


# ── the two writes still happen, and not through the reader ──────────────────

def test_an_expired_session_is_refused_and_removed(hot):
    _sql(hot.path, "UPDATE sessions SET expires_at = '2020-01-01T00:00:00+00:00' WHERE token = ?", (hot.tok,))
    assert auth_service.validate_session(hot.tok) is None
    assert _sql(hot.path, "SELECT COUNT(*) FROM sessions WHERE token = ?", (hot.tok,))[0][0] == 0
    assert auth_db.hot_reader().in_transaction is False


def test_the_last_login_write_is_made_through_the_pool(hot, monkeypatch):
    monkeypatch.setattr(auth_service, "_should_write_last_login", lambda *a, **k: True)
    _sql(hot.path, "UPDATE users SET last_login_at = NULL WHERE id = ?", (hot.uid,))
    _sql(hot.path, "UPDATE sessions SET last_seen_at = NULL WHERE token = ?", (hot.tok,))
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid
    assert _sql(hot.path, "SELECT last_login_at FROM users WHERE id = ?", (hot.uid,))[0][0] is not None
    assert _sql(hot.path, "SELECT last_seen_at FROM sessions WHERE token = ?", (hot.tok,))[0][0] is not None
    assert auth_db.hot_reader().in_transaction is False


def test_a_failed_last_login_write_never_fails_the_request(hot, monkeypatch):
    monkeypatch.setattr(auth_service, "_should_write_last_login", lambda *a, **k: True)

    def locked(*a, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(auth_service, "_touch_last_login", locked)
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid


def test_the_reader_cannot_write(hot):
    auth_service.validate_session(hot.tok)
    reader = auth_db.hot_reader()
    with pytest.raises(sqlite3.OperationalError):
        reader.execute("DELETE FROM sessions")
    assert reader.in_transaction is False, "no transaction was opened ahead of the refused write"
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid, "and the session is still there"
    # ... which is what keeps a later read current: a transaction left open would pin one snapshot
    auth_service.delete_session(hot.tok)
    assert auth_service.validate_session(hot.tok) is None


# ── one per thread, for one file ─────────────────────────────────────────────

def test_a_thread_keeps_its_reader_and_no_two_threads_share_one(hot):
    mine = auth_db.hot_reader()
    assert auth_db.hot_reader() is mine
    theirs = []

    def other():
        theirs.append(auth_db.hot_reader())
        assert auth_service.validate_session(hot.tok)["id"] == hot.uid
        auth_db.drop_hot_reader()
    t = threading.Thread(target=other)
    t.start()
    t.join()
    assert theirs and theirs[0] is not None and theirs[0] is not mine
    auth_db.drop_hot_reader()
    assert auth_db.hot_reader() is not mine, "dropped: the next read opens a new one"


def test_another_database_file_is_another_reader(hot, tmp_path, monkeypatch):
    first = auth_db.hot_reader()
    other = str(tmp_path / "second.db")
    _sql(other, "CREATE TABLE t (k TEXT)")
    monkeypatch.setattr(auth_db, "_DB_PATH", other)
    second = auth_db.hot_reader()
    assert second is not first
    assert second.execute("PRAGMA database_list").fetchone()[2].endswith("second.db")
    with pytest.raises(sqlite3.ProgrammingError):
        first.execute("SELECT 1")                                   # the old one was closed, not leaked


def test_a_read_never_creates_the_file(tmp_path, monkeypatch):
    missing = str(tmp_path / "nothing-here.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", missing)
    monkeypatch.setattr(auth_db, "_pooling", lambda: True)
    auth_db.drop_hot_reader()
    assert auth_db.hot_reader() is None
    import os
    assert not os.path.exists(missing)


def test_under_pytest_there_is_no_reader_and_the_read_goes_through_the_pool(hot, monkeypatch):
    auth_db.drop_hot_reader()
    monkeypatch.setattr(auth_db, "_pooling", _REAL_POOLING)         # the env-reading original
    assert auth_db.hot_reader() is None
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid
    assert auth_db._HOT.conn is None


# ── when something is wrong ──────────────────────────────────────────────────

def test_a_database_with_no_toolkit_column_is_read_and_the_reader_is_kept(hot):
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid
    _sql(hot.path, "ALTER TABLE users DROP COLUMN toolkit")
    auth_db.drop_hot_reader()                                       # (a new connection sees the new schema)
    first = auth_db.hot_reader()
    user = auth_service.validate_session(hot.tok)
    assert user["id"] == hot.uid and "toolkit" not in user
    assert auth_db.hot_reader() is first, "the schema's answer is not a broken reader"


def test_a_busy_file_is_raised_as_it_was_never_retried_and_the_reader_is_dropped(hot, monkeypatch):
    dropped = []

    class Busy:
        def execute(self, *a):
            raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(auth_db, "hot_reader", lambda: Busy())
    monkeypatch.setattr(auth_db, "drop_hot_reader", lambda: dropped.append(1))
    monkeypatch.setattr(auth_db, "get_connection", lambda: pytest.fail("a second three-second wait"))
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        auth_service.validate_session(hot.tok)
    assert dropped == [1]


def test_a_reader_that_broke_is_dropped_and_the_read_is_made_through_the_pool(hot):
    auth_service.validate_session(hot.tok)
    broken = auth_db.hot_reader()
    sqlite3.Connection.close(broken)                                # closed underneath: ProgrammingError on use
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid, "answered, through the pool"
    assert auth_db._HOT.conn is None, "the broken one was dropped"
    assert auth_service.validate_session(hot.tok)["id"] == hot.uid
    assert auth_db._HOT.conn is not None and auth_db._HOT.conn is not broken, "and the next read opened a new one"


def test_many_threads_check_while_another_writes(hot):
    errors = []
    stop = threading.Event()

    def writer():
        i = 0
        while not stop.is_set():
            i += 1
            try:
                auth_db.execute_with_retry("UPDATE users SET display_name = ? WHERE id = ?", (f"name-{i}", hot.uid))
            except Exception as e:                                  # noqa: BLE001 - reported below
                errors.append(("writer", repr(e)))

    def reader():
        try:
            for _ in range(150):
                user = auth_service.validate_session(hot.tok)
                if not user or user["id"] != hot.uid or auth_service.get_user_plan(hot.uid) != "pro":
                    errors.append(("wrong", user))
        except Exception as e:                                      # noqa: BLE001 - reported below
            errors.append(("reader", repr(e)))
        finally:
            auth_db.drop_hot_reader()
    w = threading.Thread(target=writer)
    readers = [threading.Thread(target=reader) for _ in range(8)]
    w.start()
    for t in readers:
        t.start()
    for t in readers:
        t.join(timeout=60)
    stop.set()
    w.join(timeout=10)
    assert errors == []
