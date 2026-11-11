"""The live screener's 30 s cadence and the rest that keeps it from running back to back.

2026-11-11. The overlay write stopped convoying on the GIL (chunked multi-row
statements, `test_screener_live_write_convoy.py`), so the sweep moved from a
60 s to a 30 s trigger. A sweep that still runs long must not turn that into
continuous work against the file every member scan reads: `sweep_job` owes as
much idle as the last sweep took, and rests a tick until it has been paid.
"""
from __future__ import annotations

import pytest

from api.services.screener import live_tier


def _work_receipt(duration_ms: float) -> dict:
    r = live_tier._blank_receipt(session="regular", session_ymd=20261111,
                                 rows_written=5, rows_considered=5, rows_matched=5)
    r["duration_ms"] = duration_ms
    return r


@pytest.fixture
def clock(monkeypatch):
    """A monotonic clock the test advances by hand."""
    now = {"t": 1000.0}
    monkeypatch.setattr(live_tier.time, "monotonic", lambda: now["t"])
    monkeypatch.setattr(live_tier, "_LAST_RECEIPT", None)
    return now


@pytest.fixture
def sweeps(monkeypatch):
    """`run_sweep` replaced by a queue of receipts; records how often it ran."""
    calls = {"n": 0, "queue": []}

    def fake():
        calls["n"] += 1
        return calls["queue"].pop(0)

    monkeypatch.setattr(live_tier, "run_sweep", fake)
    return calls


def test_the_default_cadence_is_thirty_seconds(monkeypatch):
    monkeypatch.delenv("SCREENER_LIVE_INTERVAL_S", raising=False)
    assert live_tier.interval_s() == 30


def test_the_env_var_still_overrides_the_cadence(monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_INTERVAL_S", "60")
    assert live_tier.interval_s() == 60


def test_the_scheduled_job_uses_the_thirty_second_default(monkeypatch, tmp_path):
    import api.main as m

    class _Sched:
        def __init__(self):
            self.jobs = {}

        def add_job(self, fn, **k):
            self.jobs[k.get("id")] = (fn, k)

    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
    monkeypatch.delenv("SCREENER_LIVE_INTERVAL_S", raising=False)
    sched = _Sched()
    m.register_screener_jobs(sched)
    _, kw = sched.jobs["screener_live_tier"]
    assert kw["trigger"].interval.total_seconds() == 30
    assert kw["max_instances"] == 1


def test_a_slow_sweep_rests_the_next_tick_and_keeps_its_receipt(clock, sweeps):
    sweeps["queue"] = [_work_receipt(20_000)]
    first = live_tier.sweep_job()
    assert sweeps["n"] == 1 and first["skipped_reason"] is None

    clock["t"] += 10.0  # the next 30 s tick lands 10 s after a 20 s sweep ended
    rested = live_tier.sweep_job()

    assert sweeps["n"] == 1, "the sweep must not run while idle is still owed"
    assert rested["skipped_reason"] == "resting"
    # The status surface keeps the cycle that actually ran.
    assert live_tier.last_receipt()["swept_at"] == first["swept_at"]
    assert live_tier.last_receipt()["skipped_reason"] is None


def test_the_sweep_runs_again_once_the_idle_is_paid(clock, sweeps):
    sweeps["queue"] = [_work_receipt(20_000), _work_receipt(20_000)]
    live_tier.sweep_job()
    clock["t"] += 20.5
    again = live_tier.sweep_job()
    assert sweeps["n"] == 2
    assert again["skipped_reason"] is None


def test_a_fast_sweep_never_rests(clock, sweeps):
    sweeps["queue"] = [_work_receipt(8_000), _work_receipt(8_000)]
    live_tier.sweep_job()
    clock["t"] += 22.0  # 30 s tick after an 8 s sweep: 22 s idle > 8 s owed
    live_tier.sweep_job()
    assert sweeps["n"] == 2


def test_a_sub_second_sweep_owes_nothing_even_back_to_back(clock, sweeps):
    sweeps["queue"] = [_work_receipt(400), _work_receipt(400)]
    live_tier.sweep_job()
    live_tier.sweep_job()  # no time passes at all
    assert sweeps["n"] == 2


def test_a_zero_fraction_turns_the_rest_off(clock, sweeps, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_MIN_REST_FRACTION", "0")
    sweeps["queue"] = [_work_receipt(25_000), _work_receipt(25_000)]
    live_tier.sweep_job()
    clock["t"] += 5.0
    live_tier.sweep_job()
    assert sweeps["n"] == 2


def test_an_out_of_session_cycle_owes_no_rest(clock, sweeps):
    """A skipped cycle did no work; it must not inherit or create a debt."""
    skipped = live_tier._blank_receipt(skipped_reason="not_regular_session",
                                       session="post")
    skipped["duration_ms"] = 5_000
    sweeps["queue"] = [skipped, _work_receipt(100)]
    live_tier.sweep_job()
    live_tier.sweep_job()
    assert sweeps["n"] == 2
