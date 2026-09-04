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
    """The (now daily, full-universe) scan wrapper should never raise.

    On a fresh local checkout, get_bars() may return nothing for most tickers
    — the wrapper should treat that as a no-op and return cleanly.
    """
    from api.main import _run_patterns_universe_scan
    _run_patterns_universe_scan()


def test_leaders_scan_job_callable():
    """The hourly leaders scan wrapper (daily pass + intraday pass) never raises."""
    from api.main import _run_patterns_leaders_scan
    _run_patterns_leaders_scan()


def test_track_outcomes_job_does_not_hardcode_a_stale_lookback():
    """Phase 3B (2026-09-03): the scheduled job used to call
    track_outcomes(lookback_hours=72) — a hardcoded value that silently
    abandoned nearly all classical/structure/uct-family detections (see
    tests/pattern_engine/test_memory.py's Phase 3B section for the real-data
    evidence). The fix removed the override so the job defers to
    memory.TRACK_OUTCOMES_LOOKBACK_HOURS — one authority for the value. A
    source sweep (not just the smoke-call above) so a future hardcoded
    override can't silently reintroduce the defect."""
    import ast
    import inspect
    from api.main import _run_patterns_track_outcomes
    tree = ast.parse(inspect.getsource(_run_patterns_track_outcomes))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and getattr(n.func, "attr", getattr(n.func, "id", None)) == "track_outcomes"]
    assert calls, "expected a track_outcomes(...) call in the job body"
    for call in calls:
        assert not call.args and not call.keywords, (
            "the scheduled job must call track_outcomes() with no arguments — "
            "it should defer to memory.TRACK_OUTCOMES_LOOKBACK_HOURS as the "
            "single authority, not pass its own lookback_hours override"
        )


def test_prune_job_callable():
    """The retention-sweep wrapper never raises, even on an empty store."""
    from api.main import _run_patterns_prune
    _run_patterns_prune()


def test_all_four_pattern_jobs_are_registered():
    """The four job ids exist in the scheduler wiring of api/main.py.

    Asserted by AST over the add_job calls (the desk_session_audit idiom) so a
    merge that silently drops one block goes red — the 2026-05-21 deletion took
    the whole pattern family out for two months without a test noticing.
    """
    import ast
    import api.main as m

    src = open(m.__file__, encoding="utf-8").read()
    ids = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job":
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    for job_id in ("patterns_leaders_scan", "patterns_universe_scan",
                   "patterns_prune", "patterns_track_outcomes"):
        assert job_id in ids, f"scheduler wiring for {job_id} is missing"
    # Non-vacuity control: the walk actually sees unrelated jobs too.
    assert len(ids) > 10
