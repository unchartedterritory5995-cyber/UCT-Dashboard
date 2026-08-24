"""A REFUSED snapshot build must say so — at both call sites.

`snapshot_builder.run_build` returns all-zero counters when the in-flight guard
turns a build away. `tests/test_screener_api.py` already pins that the BUILDER
refuses and names the reason. What was never pinned is that anyone LISTENS:

  * the boot self-warm printed `built=0 skipped=0 errors=0`, which is
    indistinguishable from a build that ran and found nothing to do;
  * the nightly discarded the return value entirely, so a refused nightly —
    the day the snapshot silently does not advance — left no trace at all.

That is how three concurrent builds starved each other for five hours while
every log line read healthy. A guard whose activation is invisible is not a
guard, so these tests watch the guard FIRE, each against a control showing the
same call site printing counters on a build that actually ran.
"""
import re

import pytest


def _refusal():
    return {"skipped_reason": "a build is already in flight", "built": 0,
            "skipped": 0, "errors": 0, "populated": {}, "empty_columns": [],
            "sources": {}}


def _completion():
    return {"built": 12, "skipped": 3, "errors": 0, "populated": {},
            "empty_columns": [], "sources": {}}


def _nightly_job(monkeypatch):
    """Return the function the scheduler would run at 03:00 ET.

    Derived from the registration rather than re-implemented here: a hand-copied
    body would keep passing after the real one regressed.
    """
    import api.main as main

    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    # The registration also kicks the boot warm, which starts a real thread.
    monkeypatch.setattr(main, "start_screener_snapshot_warm", lambda: None)

    jobs = {}

    class _FakeScheduler:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = func

    assert main.register_screener_jobs(_FakeScheduler()) is True
    job = jobs.get("screener_snapshot_nightly")
    assert job is not None, (
        "the nightly job id changed; this test targets the wrong job. Read the "
        "ids off register_screener_jobs rather than trusting this string."
    )
    return job


@pytest.mark.parametrize("stats,expect_refused", [
    (_refusal(), True),
    (_completion(), False),  # the control
])
def test_the_nightly_reports_a_refusal_and_still_reports_a_real_build(
        capsys, monkeypatch, stats, expect_refused):
    from api.services.screener import snapshot_builder

    monkeypatch.setattr(snapshot_builder, "run_build", lambda *a, **k: stats)
    _nightly_job(monkeypatch)()
    out = capsys.readouterr().out

    if expect_refused:
        assert "REFUSED" in out, (
            "a refused nightly printed nothing that distinguishes it from a "
            f"build that ran. Got: {out!r}")
        assert "already in flight" in out, "the REASON was dropped"
        # The counters must NOT be presented for a build that never happened.
        assert "built=0" not in out
    else:
        assert "REFUSED" not in out
        assert "built=12" in out and "skipped=3" in out


@pytest.mark.parametrize("stats,expect_refused", [
    (_refusal(), True),
    (_completion(), False),  # the control
])
def test_the_boot_self_warm_reports_a_refusal_and_still_reports_a_real_build(
        capsys, monkeypatch, stats, expect_refused):
    import api.main as main
    from api.services.screener import snapshot_builder, snapshot_db

    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_DELAY_SECS", "0")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_MIN", "3000")
    monkeypatch.setattr(snapshot_db, "init_db", lambda *a, **k: None)
    # Below warm_min, so the warm proceeds to the build rather than short-circuiting.
    monkeypatch.setattr(snapshot_db, "count_rows", lambda *a, **k: 10)
    monkeypatch.setattr(snapshot_builder, "run_build", lambda *a, **k: stats)

    t = main.start_screener_snapshot_warm()
    assert t is not None
    t.join(timeout=10)
    assert not t.is_alive(), "the warm thread never finished"
    out = capsys.readouterr().out

    if expect_refused:
        assert "REFUSED" in out, (
            "a refused boot warm printed the all-zero counters, which read as "
            f"a no-op build. Got: {out!r}")
        assert "already in flight" in out, "the REASON was dropped"
        assert not re.search(r"built=0\b", out), (
            "counters from a build that never ran were printed anyway")
    else:
        assert "REFUSED" not in out
        assert "built=12" in out
