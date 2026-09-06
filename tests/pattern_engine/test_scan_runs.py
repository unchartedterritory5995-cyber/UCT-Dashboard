import sqlite3

from api.services.pattern_engine import memory
from api.services.pattern_engine.pattern_db import init_db, _db_path


def test_start_scan_run_creates_a_started_row():
    init_db()
    memory.start_scan_run("test_job_start", 20260906, symbols_intended=42)
    row = memory.latest_scan_run("test_job_start")
    assert row is not None
    assert row["as_of"] == 20260906
    assert row["symbols_intended"] == 42
    assert row["started_at"] is not None
    assert row["completed_at"] is None
    assert row["symbols_scanned"] is None
    assert row["symbols_stored"] is None
    assert row["error"] is None


def test_complete_scan_run_marks_completion():
    init_db()
    memory.start_scan_run("test_job_complete", 20260906, symbols_intended=100)
    memory.complete_scan_run("test_job_complete", 20260906, symbols_scanned=97, symbols_stored=12)
    row = memory.latest_scan_run("test_job_complete")
    assert row["completed_at"] is not None
    assert row["symbols_scanned"] == 97
    assert row["symbols_stored"] == 12
    assert row["error"] is None


def test_fail_scan_run_records_error_but_not_completion():
    """A CAUGHT failure records an error message but `completed_at` stays
    NULL — a graceful failure is still "did not finish", same as a silent
    kill; only `error` distinguishes the two (see the next test)."""
    init_db()
    memory.start_scan_run("test_job_fail", 20260906, symbols_intended=5)
    memory.fail_scan_run("test_job_fail", 20260906, "boom: connection refused")
    row = memory.latest_scan_run("test_job_fail")
    assert row["completed_at"] is None
    assert row["error"] == "boom: connection refused"


def test_a_run_that_never_completes_or_fails_stays_open():
    """The silent-kill case this whole package exists to make visible: no
    complete_scan_run, no fail_scan_run call ever happens (process died).
    completed_at AND error both stay NULL forever — that absence IS the
    signal, never backfilled or inferred."""
    init_db()
    memory.start_scan_run("test_job_silent_kill", 20260906, symbols_intended=3700)
    row = memory.latest_scan_run("test_job_silent_kill")
    assert row["completed_at"] is None
    assert row["error"] is None


def test_latest_scan_run_returns_none_for_unknown_job():
    init_db()
    assert memory.latest_scan_run("test_job_never_seen_xyz") is None


def test_start_scan_run_same_day_retry_resets_the_row():
    """A second start_scan_run for the same (job_id, as_of) — e.g. a manual
    same-day retry — resets completed_at/scanned/stored back to the fresh
    STARTED state rather than leaving stale completion data from the first
    attempt visible under a new symbols_intended."""
    init_db()
    memory.start_scan_run("test_job_retry", 20260906, symbols_intended=10)
    memory.complete_scan_run("test_job_retry", 20260906, symbols_scanned=10, symbols_stored=1)
    row = memory.latest_scan_run("test_job_retry")
    assert row["completed_at"] is not None

    memory.start_scan_run("test_job_retry", 20260906, symbols_intended=20)
    row = memory.latest_scan_run("test_job_retry")
    assert row["symbols_intended"] == 20
    assert row["completed_at"] is None
    assert row["symbols_scanned"] is None
    assert row["symbols_stored"] is None


def test_latest_scan_run_returns_the_most_recent_as_of():
    init_db()
    memory.start_scan_run("test_job_history", 20260901, symbols_intended=1)
    memory.complete_scan_run("test_job_history", 20260901, symbols_scanned=1, symbols_stored=0)
    memory.start_scan_run("test_job_history", 20260906, symbols_intended=2)
    row = memory.latest_scan_run("test_job_history")
    assert row["as_of"] == 20260906
    assert row["completed_at"] is None


def test_latest_complete_scan_run_returns_none_when_nothing_ever_completed():
    init_db()
    memory.start_scan_run("test_job_never_completed", 20260906, symbols_intended=7)
    assert memory.latest_complete_scan_run("test_job_never_completed") is None
    # latest_scan_run (attempt) still sees it -- the two functions disagree
    # on purpose for exactly this row.
    assert memory.latest_scan_run("test_job_never_completed") is not None


def test_latest_complete_scan_run_is_not_shadowed_by_a_newer_unfinished_attempt():
    """The central 'latest attempt vs latest complete' correctness case
    (owner review, package: scan-completeness/redeploy-reliability). Run A
    completes; run B starts and is never finished (simulating a redeploy
    mid-run); run C starts fresh. latest_scan_run (attempt) must track the
    newest row (C); latest_complete_scan_run must keep returning A -- an
    interrupted attempt, however recent, must never make a caller believe
    the last known-good complete run doesn't exist or has been superseded."""
    init_db()
    job = "test_job_abc_shadow"

    # Run A: completes cleanly.
    memory.start_scan_run(job, 20260901, symbols_intended=100)
    memory.complete_scan_run(job, 20260901, symbols_scanned=100, symbols_stored=9)

    # Run B: starts, never completes or fails (the silent-kill case).
    memory.start_scan_run(job, 20260903, symbols_intended=110)

    attempt = memory.latest_scan_run(job)
    assert attempt["as_of"] == 20260903
    assert attempt["completed_at"] is None

    complete = memory.latest_complete_scan_run(job)
    assert complete["as_of"] == 20260901
    assert complete["completed_at"] is not None
    assert complete["symbols_stored"] == 9

    # Run C: starts fresh (e.g. the next scheduled fire).
    memory.start_scan_run(job, 20260906, symbols_intended=120)

    attempt = memory.latest_scan_run(job)
    assert attempt["as_of"] == 20260906
    assert attempt["completed_at"] is None

    # A is STILL the last known-good complete run -- B and C being newer,
    # unfinished attempts must not shadow it.
    complete = memory.latest_complete_scan_run(job)
    assert complete["as_of"] == 20260901
    assert complete["symbols_stored"] == 9


def test_persistence_survives_an_independent_reader_bypassing_memory_py():
    """The interrupted-run row must be real, on-disk state -- not an
    in-memory artifact of the same Python objects that wrote it. Verifies
    by reading the row back through a completely separate sqlite3
    connection that never goes through pattern_db.get_connection()/
    memory.py at all, simulating a distinct process/reader opening the
    same patterns.db file after the writer is gone."""
    init_db()
    memory.start_scan_run("test_job_independent_reader", 20260906, symbols_intended=55)

    raw_conn = sqlite3.connect(_db_path())
    try:
        raw_conn.row_factory = sqlite3.Row
        row = raw_conn.execute(
            "SELECT * FROM pattern_scan_runs WHERE job_id = ? AND as_of = ?",
            ("test_job_independent_reader", 20260906),
        ).fetchone()
    finally:
        raw_conn.close()

    assert row is not None
    assert row["symbols_intended"] == 55
    assert row["completed_at"] is None
    assert row["error"] is None


def test_start_scan_run_raises_on_a_broken_connection_rather_than_swallowing(monkeypatch):
    """These functions do NOT catch their own DB errors -- the non-fatal
    guarantee this package advertises ("a bug in this bookkeeping can never
    break the actual scan") lives entirely in the CALL SITE's own
    try/except (api/main.py's _run_patterns_universe_scan wraps every one
    of these calls individually), not inside memory.py. This test pins that
    architectural boundary: if these functions started silently swallowing
    their own errors instead, a genuinely broken metadata DB (disk full,
    corruption) would go unnoticed forever instead of at least appearing
    once in the caller's own debug log."""
    init_db()

    def _broken_connection():
        raise sqlite3.OperationalError("simulated: disk full")

    monkeypatch.setattr(memory, "get_connection", _broken_connection)
    try:
        memory.start_scan_run("test_job_broken_conn", 20260906, symbols_intended=1)
        assert False, "expected start_scan_run to raise on a broken connection"
    except sqlite3.OperationalError:
        pass
