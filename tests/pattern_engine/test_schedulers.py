"""Verify the pattern engine scheduled jobs are registered + callable.

These are smoke tests — they confirm the job wrapper functions are
importable from api.main and don't raise. The actual cron triggers are
wired in api.main.lifespan() and depend on the live scheduler instance,
which is exercised at deploy time.

Each wrapper MUST catch all exceptions internally (logged + printed,
never propagated) so APScheduler can't be brought down by a failed pattern
detector or a missing DB row.
"""


def test_track_outcomes_job_callable():
    """The outcome tracker wrapper should never raise — exceptions are logged."""
    from api.main import _run_patterns_track_outcomes
    _run_patterns_track_outcomes()


def test_recompute_stats_job_callable():
    """The stats recompute wrapper should never raise — exceptions are logged."""
    from api.main import _run_patterns_recompute_stats
    _run_patterns_recompute_stats()


def test_universe_scan_job_callable():
    """The universe scan wrapper should never raise.

    On a fresh local checkout, get_bars() may return nothing for most tickers
    — the wrapper should treat that as a no-op and return cleanly.
    """
    from api.main import _run_patterns_universe_scan
    _run_patterns_universe_scan()
