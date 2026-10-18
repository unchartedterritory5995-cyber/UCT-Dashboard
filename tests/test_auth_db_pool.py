"""auth_db's reused connections (2026-10-17).

A pooled `close()` must be indistinguishable from a real one to every caller: whatever a
caller left behind (an open transaction, a changed row factory, an ATTACHed database, a TEMP
table) is either undone or makes the close real. The pool is OFF under pytest by default, so
every test here turns it on and drains it.

⛔ Every database is a tmp file. Nothing reads C:\\data.
"""
import sqlite3
import threading

import pytest

from api.services import auth_db

_REAL_POOLING = auth_db._pooling     # the env-reading original, captured before any patch


@pytest.fixture
def pooled(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    c = sqlite3.connect(auth_db._DB_PATH)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)")
    c.commit()
    c.close()
    monkeypatch.setattr(auth_db, "_pooling", lambda: True)   # pytest re-sets PYTEST_CURRENT_TEST per phase
    auth_db._drain_pool()
    yield
    auth_db._drain_pool()


def _raw(conn):
    """The connection object itself, to compare identities across checkouts."""
    return id(conn)


def test_a_closed_connection_is_reused(pooled):
    a = auth_db.get_connection()
    first = _raw(a)
    a.close()
    b = auth_db.get_connection()
    assert _raw(b) == first
    b.close()


def test_CONTROL_under_pytest_a_close_is_a_real_close(pooled, monkeypatch):
    monkeypatch.setattr(auth_db, "_pooling", _REAL_POOLING)  # the env-reading original
    a = auth_db.get_connection()
    a.close()
    with pytest.raises(sqlite3.ProgrammingError):
        a.execute("SELECT 1")
    assert not auth_db._POOL.get(auth_db._DB_PATH)


def test_an_uncommitted_write_is_discarded_as_a_real_close_would(pooled):
    a = auth_db.get_connection()
    a.execute("INSERT INTO t VALUES ('k', 'v')")
    a.close()
    b = auth_db.get_connection()
    assert b.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0
    assert not b.in_transaction
    b.close()


def test_a_committed_write_is_kept(pooled):
    a = auth_db.get_connection()
    a.execute("INSERT INTO t VALUES ('k', 'v')")
    a.commit()
    a.close()
    b = auth_db.get_connection()
    assert b.execute("SELECT v FROM t WHERE k='k'").fetchone()["v"] == "v"
    b.close()


def test_a_changed_row_factory_is_reset(pooled):
    a = auth_db.get_connection()
    a.row_factory = None
    a.close()
    b = auth_db.get_connection()
    assert b.row_factory is sqlite3.Row
    b.close()


def test_foreign_keys_and_busy_timeout_are_reapplied(pooled):
    a = auth_db.get_connection()
    a.execute("PRAGMA foreign_keys=OFF")
    a.execute("PRAGMA busy_timeout=1")
    a.close()
    b = auth_db.get_connection()
    assert b.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert b.execute("PRAGMA busy_timeout").fetchone()[0] == 3000
    b.close()


def test_an_attached_database_makes_the_close_real(pooled, tmp_path):
    a = auth_db.get_connection()
    a.execute("ATTACH DATABASE ? AS other", (str(tmp_path / "other.db"),))
    first = _raw(a)
    a.close()
    b = auth_db.get_connection()
    assert _raw(b) != first
    assert {r[1] for r in b.execute("PRAGMA database_list")} <= {"main", "temp"}
    b.close()


def test_a_temp_table_makes_the_close_real(pooled):
    a = auth_db.get_connection()
    a.execute("CREATE TEMP TABLE scratch (x)")
    first = _raw(a)
    a.close()
    b = auth_db.get_connection()
    assert _raw(b) != first
    b.close()


def test_a_changed_isolation_level_makes_the_close_real(pooled):
    a = auth_db.get_connection()
    a.isolation_level = None
    first = _raw(a)
    a.close()
    b = auth_db.get_connection()
    assert _raw(b) != first and b.isolation_level == ""
    b.close()


def test_a_connection_survives_many_round_trips(pooled):
    """The temp-schema check itself makes `temp` show in database_list; a connection must
    still be reused on its second, third, ... return (it was refused on the second)."""
    first = None
    for _ in range(5):
        c = auth_db.get_connection()
        first = first or _raw(c)
        assert _raw(c) == first
        c.close()


def test_a_second_close_is_not_a_second_pool_entry(pooled):
    a = auth_db.get_connection()
    a.close()
    a.close()
    assert len(auth_db._POOL[auth_db._DB_PATH]) == 1


def test_the_pool_is_bounded(pooled):
    conns = [auth_db.get_connection() for _ in range(auth_db._POOL_MAX + 3)]
    for c in conns:
        c.close()
    assert len(auth_db._POOL[auth_db._DB_PATH]) == auth_db._POOL_MAX
    with pytest.raises(sqlite3.ProgrammingError):
        conns[-1].execute("SELECT 1")                 # past the bound: really closed


def test_each_file_has_its_own_pool(pooled, tmp_path, monkeypatch):
    a = auth_db.get_connection()
    a.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "second.db"))
    b = auth_db.get_connection()
    assert b.execute("PRAGMA database_list").fetchone()[2].endswith("second.db")
    b.close()


def test_no_two_threads_ever_hold_the_same_connection(pooled):
    held, errors, lock = set(), [], threading.Lock()

    def work():
        try:
            for _ in range(200):
                c = auth_db.get_connection()
                with lock:
                    if id(c) in held:
                        errors.append("shared")
                    held.add(id(c))
                c.execute("SELECT COUNT(*) FROM t").fetchone()
                with lock:
                    held.discard(id(c))
                c.close()
        except Exception as e:  # noqa: BLE001 - reported below
            errors.append(repr(e))

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert 0 < len(auth_db._POOL[auth_db._DB_PATH]) <= auth_db._POOL_MAX


def test_validate_session_works_through_the_pool(pooled, tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "full.db"))
    auth_db.init_db()
    from api.services import auth_service
    user = auth_service.create_user("pool@local.dev", "Passw0rd!x", "p")
    uid = user["id"] if isinstance(user, dict) else user
    tok = auth_service.create_session(uid)
    for _ in range(5):
        assert auth_service.validate_session(tok)["id"] == uid
    auth_service.delete_session(tok)
    assert auth_service.validate_session(tok) is None
    assert auth_db._POOL.get(auth_db._DB_PATH)        # the reads went through the pool
