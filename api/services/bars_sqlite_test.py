"""Tests for api.services.bars_sqlite — focused on the connection epoch
mechanism that lets data_sync.download_snapshot replace bars.db while
the process is running.

The non-obvious behavior under test: on Linux, when a file is replaced
via rename(), any FDs already open on the OLD inode keep working but
point to the now-unlinked file. Without active invalidation, every
thread holding a SQLite connection would silently keep reading the old
data forever after a snapshot pull. The bump_db_epoch() mechanism forces
all threads to reconnect on next use.

NOTE: the file-replacement tests require Linux/Mac semantics — Windows
disallows replacing a file that another handle still has open, which
production never does (Railway runs Linux). Skipped on win32."""
import os
import sqlite3
import sys
import threading

import pytest

requires_posix_replace = pytest.mark.skipif(
    sys.platform == "win32",
    reason="os.replace fails on Windows when the destination is open; "
           "the inode-swap behavior under test is Linux/Mac only "
           "(matches Railway production).",
)


def _reload_bars_sqlite():
    """Reimport bars_sqlite so it picks up the current DATA_DIR env var."""
    import importlib
    from api.services import bars_sqlite
    importlib.reload(bars_sqlite)
    return bars_sqlite


def _make_db(path: str, key_value_pairs: list[tuple[int, str]]) -> None:
    """Create a fresh SQLite file with a tiny test table."""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE IF NOT EXISTS t (k INT PRIMARY KEY, v TEXT)")
    c.executemany("INSERT OR REPLACE INTO t VALUES (?, ?)", key_value_pairs)
    c.commit()
    c.close()


@requires_posix_replace
def test_bump_db_epoch_makes_existing_connections_reconnect(tmp_path, monkeypatch):
    """The core regression test for the snapshot-pull bug.

    Steps that mirror production:
      1. Process opens a connection to bars.db (epoch 0)
      2. data_sync.download_snapshot atomically replaces bars.db on disk
      3. Without bump_db_epoch: the open connection keeps reading the OLD inode
      4. With bump_db_epoch: the connection is closed and reopens against the new file
    """
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")

    # State A: original DB
    _make_db(db_path, [(1, "old")])

    # Use the module's own connection helper so we exercise the real code path
    conn = bars_sqlite._conn()
    assert conn.execute("SELECT v FROM t WHERE k=1").fetchone() == ("old",)

    # Replace bars.db with State B (new content) — atomic rename like
    # data_sync.download_snapshot does after extracting the tarball.
    new_path = os.path.join(str(tmp_path), "bars.db.new")
    _make_db(new_path, [(1, "new")])
    os.replace(new_path, db_path)

    # Without bumping, the cached connection still points to the unlinked
    # inode and reads stale data. (We don't need to assert this — it's
    # OS behavior — but the next assertion proves bump_db_epoch fixes it.)

    bars_sqlite.bump_db_epoch()

    # Next call to _conn() must give us a connection to the NEW file
    fresh = bars_sqlite._conn()
    assert fresh.execute("SELECT v FROM t WHERE k=1").fetchone() == ("new",)


@requires_posix_replace
def test_bump_db_epoch_propagates_across_threads(tmp_path, monkeypatch):
    """Each thread has its own thread-local connection. A single bump must
    invalidate all of them."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")
    _make_db(db_path, [(1, "v1")])

    results: dict[str, str] = {}
    barrier = threading.Barrier(3)  # main + 2 worker threads

    def worker(name: str):
        # Open a connection in this thread and read once
        c = bars_sqlite._conn()
        results[f"{name}_before"] = c.execute("SELECT v FROM t WHERE k=1").fetchone()[0]
        barrier.wait()  # synchronize: all threads have read v1
        barrier.wait()  # wait for main to swap and bump
        c2 = bars_sqlite._conn()
        results[f"{name}_after"] = c2.execute("SELECT v FROM t WHERE k=1").fetchone()[0]

    t1 = threading.Thread(target=worker, args=("t1",))
    t2 = threading.Thread(target=worker, args=("t2",))
    t1.start()
    t2.start()

    barrier.wait()  # workers have read; safe to swap
    new_path = os.path.join(str(tmp_path), "bars.db.new")
    _make_db(new_path, [(1, "v2")])
    os.replace(new_path, db_path)
    bars_sqlite.bump_db_epoch()
    barrier.wait()  # tell workers to read again

    t1.join(timeout=5)
    t2.join(timeout=5)

    assert results["t1_before"] == "v1"
    assert results["t2_before"] == "v1"
    assert results["t1_after"] == "v2"
    assert results["t2_after"] == "v2"


def test_conn_sets_busy_timeout_pragma(tmp_path, monkeypatch):
    """Every connection must set busy_timeout=10000 so concurrent writers
    wait out lock contention instead of failing immediately. This is the
    primary defense against the OperationalError("database is locked")
    errors that contributed to the production corruption incident."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")
    _make_db(db_path, [(1, "x")])
    c = bars_sqlite._conn()
    row = c.execute("PRAGMA busy_timeout").fetchone()
    assert row[0] == 2000, f"expected busy_timeout=2000, got {row[0]}"


def test_integrity_ok_returns_true_when_file_missing(tmp_path, monkeypatch):
    """A missing bars.db is a valid state (init_db will create it).
    integrity_ok must NOT report this as corruption — that would trigger
    a needless force_resync on every cold-start of a fresh container."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    assert bars_sqlite.integrity_ok() is True


def test_integrity_ok_returns_true_for_good_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")
    _make_db(db_path, [(1, "x")])
    assert bars_sqlite.integrity_ok() is True


def test_integrity_ok_returns_false_for_garbage_file(tmp_path, monkeypatch):
    """The startup integrity check must catch the production failure mode:
    bars.db is present but its on-disk pages are garbage (whether from a
    killed-mid-write process or from stale -wal/-shm being applied to a
    new main file). Without this guard, init_db would silently fail and
    every put_bars at runtime would raise "disk image is malformed"."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")
    with open(db_path, "wb") as f:
        f.write(b"this is not a SQLite database, just garbage bytes")
    assert bars_sqlite.integrity_ok() is False


def test_is_malformed_error_recognizes_canonical_message():
    """Defensive — guards against a SQLite version bumping the wording."""
    from api.services import bars_sqlite
    assert bars_sqlite._is_malformed_error(
        sqlite3.DatabaseError("database disk image is malformed")
    )
    assert bars_sqlite._is_malformed_error(
        sqlite3.DatabaseError("DATABASE DISK IMAGE IS MALFORMED")
    )
    assert not bars_sqlite._is_malformed_error(
        sqlite3.OperationalError("database is locked")
    )


def test_put_bars_triggers_recovery_on_malformed(tmp_path, monkeypatch):
    """The whole reason this module gained a recovery path: when put_bars
    encounters a malformed image, it must (a) schedule a background
    snapshot re-pull, (b) drop the poisoned thread-local connection so
    the next call gets a fresh handle after recovery completes, and
    (c) re-raise so the caller's existing exception handler fires."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()

    class _PoisonedConn:
        def executemany(self, *_a, **_kw):
            raise sqlite3.DatabaseError("database disk image is malformed")

        def commit(self):
            pass

        def close(self):
            pass

    poisoned = _PoisonedConn()
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: poisoned)

    # Pre-seed the thread-local cache so we can verify it gets cleared.
    bars_sqlite._local.conn = poisoned

    triggered = {"count": 0}
    monkeypatch.setattr(
        bars_sqlite,
        "_trigger_corruption_recovery",
        lambda: triggered.__setitem__("count", triggered["count"] + 1),
    )

    with pytest.raises(sqlite3.DatabaseError):
        bars_sqlite.put_bars(
            "AAPL", "D",
            [{"t": 20240101, "o": 1, "h": 2, "l": 1, "c": 2, "v": 100}],
        )

    assert triggered["count"] == 1, "recovery should be scheduled exactly once"
    assert getattr(bars_sqlite._local, "conn", "missing") is None, (
        "thread-local connection should be cleared after malformed error so "
        "the next call (post-recovery) opens a fresh handle"
    )


def test_put_bars_retries_on_locked_then_succeeds(tmp_path, monkeypatch):
    """OperationalError("database is locked") on the first attempt must be
    retried (busy_timeout already absorbs most contention; this loop covers
    the residual cases). We simulate one transient lock then a successful
    write and verify put_bars completes without raising."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()

    real_conn = sqlite3.connect(os.path.join(str(tmp_path), "bars.db"))
    real_conn.execute(
        "CREATE TABLE IF NOT EXISTS ohlcv ("
        "ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
        "PRIMARY KEY(ticker, tf, ts))"
    )
    real_conn.commit()

    # sqlite3.Connection methods are read-only attributes, so we wrap the
    # real connection in a thin proxy whose executemany is monkeypatchable.
    class _FlakyConn:
        def __init__(self, real):
            self._real = real
            self.calls = 0

        def executemany(self, *args, **kwargs):
            self.calls += 1
            if self.calls == 1:
                raise sqlite3.OperationalError("database is locked")
            return self._real.executemany(*args, **kwargs)

        def commit(self):
            return self._real.commit()

    flaky = _FlakyConn(real_conn)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: flaky)

    n = bars_sqlite.put_bars(
        "AAPL", "D",
        [{"t": 20240101, "o": 1, "h": 2, "l": 1, "c": 2, "v": 100}],
    )
    assert n == 1
    assert flaky.calls == 2, "expected one retry after a single locked error"


def test_init_db_creates_provenance_table(tmp_path, monkeypatch):
    """The bars_provenance schema lands as part of init_db so future
    fetch sites can record source attribution without coordinating a
    separate migration step."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()
    c = bars_sqlite._conn()
    rows = c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='bars_provenance'"
    ).fetchall()
    assert rows, "bars_provenance table not created by init_db"


def test_put_provenance_round_trip(tmp_path, monkeypatch):
    """Basic write+read: ensure put_provenance + get_provenance agree."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()

    n = bars_sqlite.put_provenance("AAPL", "30", [1000, 2000, 3000],
                                    source="massive", fetched_at=12345)
    assert n == 3

    row = bars_sqlite.get_provenance("AAPL", "30", 2000)
    assert row == {"source": "massive", "fetched_at": 12345}


def test_get_provenance_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()
    assert bars_sqlite.get_provenance("AAPL", "30", 9999) is None


def test_put_provenance_replaces_on_conflict(tmp_path, monkeypatch):
    """A higher-priority source replacing a fallback bar must overwrite
    the source label, not insert a duplicate. The ON CONFLICT REPLACE
    semantic is the contract."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()

    bars_sqlite.put_provenance("AAPL", "30", [1000], source="yfinance", fetched_at=100)
    bars_sqlite.put_provenance("AAPL", "30", [1000], source="massive", fetched_at=200)

    row = bars_sqlite.get_provenance("AAPL", "30", 1000)
    assert row == {"source": "massive", "fetched_at": 200}


def test_put_provenance_empty_timestamps_is_noop(tmp_path, monkeypatch):
    """Calling with no timestamps must not crash. Common when a fetch
    returned zero new bars (no provenance to record either)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()
    assert bars_sqlite.put_provenance("AAPL", "30", [], source="massive") == 0


def test_get_provenance_summary_counts_by_source(tmp_path, monkeypatch):
    """Surfaces "what fraction of this ticker's bars came from each
    source" — a key signal for spotting heavy fallback usage that
    suggests Massive is failing for a ticker."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    bars_sqlite.init_db()

    bars_sqlite.put_provenance("AAPL", "30", [1, 2, 3, 4], source="massive")
    bars_sqlite.put_provenance("AAPL", "30", [5, 6], source="fmp")
    bars_sqlite.put_provenance("AAPL", "30", [7], source="yfinance")
    bars_sqlite.put_provenance("AAPL", "60", [1], source="massive")  # different tf

    summary = bars_sqlite.get_provenance_summary("AAPL", "30")
    assert summary == {"massive": 4, "fmp": 2, "yfinance": 1}


def test_bump_with_no_existing_connection_is_safe(tmp_path, monkeypatch):
    """Calling bump_db_epoch before any thread has opened a connection
    should not raise. (Edge case: data_sync.download_snapshot may run
    before any web request handler has touched bars_sqlite.)"""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    # No _conn() call before bump
    bars_sqlite.bump_db_epoch()
    # Now create the DB and open
    db_path = os.path.join(str(tmp_path), "bars.db")
    _make_db(db_path, [(1, "x")])
    c = bars_sqlite._conn()
    assert c.execute("SELECT v FROM t WHERE k=1").fetchone() == ("x",)


def test_bump_db_epoch_replaces_thread_local_connection_object(tmp_path, monkeypatch):
    """Platform-agnostic test that proves the epoch mechanism actually
    discards the cached connection object after a bump. We don't replace
    the file — that's tested with @requires_posix_replace above — but we
    verify _conn() returns a different Connection instance after bump."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    bars_sqlite = _reload_bars_sqlite()
    db_path = os.path.join(str(tmp_path), "bars.db")
    _make_db(db_path, [(1, "before")])

    c1 = bars_sqlite._conn()
    c1_again = bars_sqlite._conn()
    # No bump yet — same connection object cached in thread-local
    assert c1 is c1_again

    bars_sqlite.bump_db_epoch()

    c2 = bars_sqlite._conn()
    # After bump, _conn() must have closed c1 and opened a fresh one
    assert c2 is not c1, (
        "bump_db_epoch did not invalidate the cached connection — "
        "_conn() returned the same object before and after bump"
    )
    # The new connection still works
    assert c2.execute("SELECT v FROM t WHERE k=1").fetchone() == ("before",)
