from api.services.pattern_engine import memory
from api.services.pattern_engine.pattern_db import init_db


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
