"""Exchange Breadth V1 — the `exch_session` flush race (validation 2026-10-05).

The v1 historical grind lost four `exch_session` rows: the pump flushed a SNAPSHOT of the counts
dict and then `clear()`ed it, discarding a session the main thread added mid-flush. These tests
reproduce that interleaving DETERMINISTICALLY (a connection that fires the main thread's `put`
while the flush is writing), prove the old code loses the row, and prove the fix cannot.
"""
import json
import os
import sqlite3
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "breadth_exch"))
import exch_counts as xc  # noqa: E402

C1 = {"us": 10, "NYSE": 4, "NASDAQ": 5, "OTHER": 1, "UNRESOLVED": 0, "CONFLICT": 0, "absent": 0}
C2 = {"us": 11, "NYSE": 4, "NASDAQ": 6, "OTHER": 1, "UNRESOLVED": 0, "CONFLICT": 0, "absent": 0}


class RacingConn:
    """sqlite3 connection whose FIRST insert runs `during_write` — the main thread's
    `resolve_universes` landing while the pump is mid-flush (exactly what happened on the runner)."""

    def __init__(self, during_write):
        self.c = sqlite3.connect(":memory:")
        self.during_write = during_write
        self.fired = False

    def execute(self, sql, *a):
        r = self.c.execute(sql, *a)
        if sql.startswith("INSERT") and not self.fired:
            self.fired = True
            self.during_write()
        return r

    def commit(self):
        self.c.commit()

    def persisted(self):
        return {d: json.loads(c) for d, c in self.c.execute("SELECT date, counts FROM exch_session")}


# ── the pre-fix implementation, verbatim from exch_grind.py @ eff3eca45 ─────────────────────
def _old_write_counts(conn, _counts):
    conn.execute("CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT)")
    for d, c in list(_counts.items()):
        conn.execute("INSERT OR REPLACE INTO exch_session VALUES(?,?)", (d, json.dumps(c, sort_keys=True)))
    conn.commit()
    _counts.clear()


def _accounted(conn, pending):
    return set(conn.persisted()) | set(pending)


def test_old_implementation_loses_the_session_added_mid_flush():
    """The bite: the reproduction really reproduces the v1 loss."""
    counts = {"2021-03-01": C1}
    conn = RacingConn(lambda: counts.__setitem__("2021-03-02", C2))
    _old_write_counts(conn, counts)
    assert _accounted(conn, counts) == {"2021-03-01"}          # 2021-03-02 vanished
    _old_write_counts(conn, counts)                            # and no later flush recovers it
    assert "2021-03-02" not in conn.persisted()


def test_fixed_flush_never_drops_a_session_added_mid_flush():
    buf = xc.SessionCounts()
    buf.put("2021-03-01", C1)
    conn = RacingConn(lambda: buf.put("2021-03-02", C2))
    assert xc.flush(buf, conn) == 1
    assert conn.persisted() == {"2021-03-01": C1}
    assert buf.pending() == {"2021-03-02": C2}                 # still owned, not lost
    xc.flush(buf, conn)
    assert conn.persisted() == {"2021-03-01": C1, "2021-03-02": C2}
    assert buf.pending() == {}


def test_mutation_snapshot_then_clear_is_caught():
    """Mutation check: the same buffer with the old snapshot-write-clear flush loses the row, so it
    is the SWAP in `drain` (not the lock alone) that protects the invariant."""
    def mutant_flush(buf, conn):
        conn.execute(xc.CREATE_SQL)
        with buf._lock:
            batch = dict(buf._pending)                 # snapshot instead of swap
        for d, c in sorted(batch.items()):
            conn.execute(xc.INSERT_SQL, (d, json.dumps(c, sort_keys=True)))
        conn.commit()
        with buf._lock:
            buf._pending.clear()                       # the v1 bug
        return len(batch)

    buf = xc.SessionCounts()
    buf.put("2021-03-01", C1)
    conn = RacingConn(lambda: buf.put("2021-03-02", C2))
    mutant_flush(buf, conn)
    assert _accounted(conn, buf.pending()) == {"2021-03-01"}   # the mutant drops 2021-03-02


def test_failed_write_restores_the_batch_without_clobbering_newer_values():
    buf = xc.SessionCounts()
    buf.put("2010-09-16", C1)

    class Boom:
        def execute(self, sql, *a):
            if sql.startswith("INSERT"):
                buf.put("2010-09-16", C2)    # a newer value for the same session arrives
                raise sqlite3.OperationalError("database is locked")

        def commit(self):
            raise AssertionError("unreachable")

    with pytest.raises(sqlite3.OperationalError):
        xc.flush(buf, Boom())
    assert buf.pending() == {"2010-09-16": C2}


def test_threaded_stress_every_put_is_persisted_exactly_once():
    buf = xc.SessionCounts()
    path_conn = sqlite3.connect(":memory:", check_same_thread=False)
    lock = threading.Lock()
    stop = threading.Event()
    N = 3000

    def pump():
        while not stop.is_set():
            with lock:
                xc.flush(buf, path_conn)

    t = threading.Thread(target=pump)
    t.start()
    for i in range(N):
        buf.put(f"S{i:05d}", {"us": i})
    stop.set()
    t.join()
    with lock:
        xc.flush(buf, path_conn)
    got = dict(path_conn.execute("SELECT date, counts FROM exch_session"))
    assert len(got) == N and buf.pending() == {}
    assert all(json.loads(got[f"S{i:05d}"]) == {"us": i} for i in range(N))


def test_exch_grind_uses_the_buffer_and_never_clears_a_dict():
    src = open(os.path.join(ROOT, "tools", "breadth_exch", "exch_grind.py"), encoding="utf-8").read()
    assert "_counts = xc.SessionCounts()" in src
    assert "_counts.put(D, c)" in src
    assert "xc.flush(_counts, conn)" in src
    assert "_counts.clear()" not in src and "_counts = {}" not in src
