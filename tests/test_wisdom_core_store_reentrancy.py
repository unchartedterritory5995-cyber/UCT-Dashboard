"""core.store.write() nesting — the rail on a PROCESS DEADLOCK (found by S-D, 2026-09-14).

⛔⛔ WHY THIS FILE EXISTS. `extract.writer.write_output` persists inside the CALLER'S
write transaction — `batch.handle_result` opens `store.write()` and hands the connection
down. Two live core seams the writer calls from in there open their own `store.write()`:

    core.entities.resolve   -> aliases.ticker_for_alias -> load_aliases -> seed -> write()
    core.vocab.record_candidate -> lookup -> _db_rows -> ensure_seeded -> seed -> write()

WRITE_LOCK is a plain threading.Lock and BEGIN IMMEDIATE excludes even the same thread's
second connection, so before write() learned to JOIN, that second call hung the process
forever. ⭐ It never presented as a red test: on Windows pytest-timeout kills the process,
so the run lost its totals line and read as an infrastructure failure
(`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).

Every test here can fail by HANGING rather than by asserting, which is the point.
"""
from __future__ import annotations

import threading

import pytest

from api.services.wisdom.core import store


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS t_reentrancy (k TEXT PRIMARY KEY)")
    return tmp_path / "wisdom.db"


def test_a_nested_write_joins_the_transaction_instead_of_deadlocking(db):
    with store.write() as outer:
        outer.execute("INSERT INTO t_reentrancy VALUES ('outer')")
        with store.write() as inner:
            assert inner is outer                       # the SAME connection, not a second one
            inner.execute("INSERT INTO t_reentrancy VALUES ('inner')")
    with store.read() as conn:
        assert sorted(r[0] for r in conn.execute("SELECT k FROM t_reentrancy")) == ["inner", "outer"]


def test_the_nested_write_is_one_unit_of_work_and_rolls_back_together(db):
    with pytest.raises(RuntimeError):
        with store.write() as outer:
            outer.execute("INSERT INTO t_reentrancy VALUES ('outer')")
            with store.write() as inner:
                inner.execute("INSERT INTO t_reentrancy VALUES ('inner')")
            raise RuntimeError("the caller failed after the seam wrote")
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM t_reentrancy").fetchone()[0] == 0


def test_a_read_inside_this_threads_write_sees_the_uncommitted_rows(db):
    """⛔ The other half, and it bit harder than the deadlock did. A seed writes through
    store.write() and reads back through store.read(); on a SECOND connection that read
    comes back EMPTY, the caller falls back to its file default, and the answer it
    computes from that (core.vocab -> the prompt -> prompt.extractor_version()) differs
    from what the same process computes outside the transaction. Measured: two different
    extractor versions in one process, which blocks the golden gate against a version
    nothing ever evaluated."""
    with store.write() as conn:
        conn.execute("INSERT INTO t_reentrancy VALUES ('seeded')")
        with store.read() as reader:
            assert reader is conn
            assert [r[0] for r in reader.execute("SELECT k FROM t_reentrancy")] == ["seeded"]
    with store.read() as after:
        assert [r[0] for r in after.execute("SELECT k FROM t_reentrancy")] == ["seeded"]


def test_a_read_outside_a_write_still_gets_its_own_connection(db):
    """THE DISCRIMINATOR for the join above: the ordinary read path must be untouched,
    and must still be closed when the block exits."""
    with store.read() as first:
        with store.read() as second:
            assert first is not second
    with pytest.raises(Exception):
        first.execute("SELECT 1")              # closed on exit, as before


def test_two_spellings_of_one_database_are_one_transaction(db, tmp_path):
    """The key is the FILE. A seam that passes an explicit db_path must join, not
    deadlock against, the caller that passed none."""
    spelling = str(tmp_path / "." / "wisdom.db")
    with store.write() as outer:
        with store.write(spelling) as inner:
            assert inner is outer


def test_a_second_THREAD_is_still_excluded(db):
    """THE DISCRIMINATOR. Joining must be per-thread: if the nesting shortcut leaked
    across threads, two writers would share one connection and the serialisation this
    module promises would be gone — a much worse bug than the one it fixes."""
    seen = {}
    started = threading.Event()

    def other():
        started.set()
        with store.write() as conn:
            seen["conn"] = conn
            conn.execute("INSERT INTO t_reentrancy VALUES ('thread')")

    with store.write() as outer:
        assert store.in_write() is True
        worker = threading.Thread(target=other, daemon=True)
        worker.start()
        started.wait(5)
        worker.join(0.4)
        assert worker.is_alive(), "a second thread entered the write lock while it was held"
    worker.join(5)
    assert not worker.is_alive()
    assert seen["conn"] is not outer
    assert store.in_write() is False


def test_in_write_answers_for_this_thread_only(db):
    assert store.in_write() is False
    answers = []
    with store.write():
        assert store.in_write() is True
        thread = threading.Thread(target=lambda: answers.append(store.in_write()), daemon=True)
        thread.start()
        thread.join(5)
    assert answers == [False]
    assert store.in_write() is False
