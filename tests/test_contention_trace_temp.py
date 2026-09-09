"""Tests for the TEMPORARY natural-load contention-attribution diagnostic
(api/services/screener/contention_trace_temp.py). Mirrors the same
fail-safe/order-independence discipline used for the earlier (now
reverted) scan_trace_temp diagnostic this session."""
import time

from api.services.screener import contention_trace_temp as ct


def test_stage_is_a_noop_when_reset_stages_was_never_called():
    ct.pop_stages()  # force a known-clean state, order-independent of other tests
    with ct.stage("whatever"):
        time.sleep(0.001)
    assert ct.pop_stages() == {}


def test_reset_then_stage_records_elapsed_ms():
    ct.reset_stages()
    with ct.stage("a"):
        time.sleep(0.001)
    with ct.stage("b"):
        time.sleep(0.001)
    stages = ct.pop_stages()
    assert set(stages.keys()) == {"a", "b"}
    assert stages["a"] > 0
    assert stages["b"] > 0


def test_pop_stages_clears_state_for_next_call():
    ct.reset_stages()
    with ct.stage("x"):
        pass
    first = ct.pop_stages()
    assert "x" in first
    assert ct.pop_stages() == {}


def test_record_never_raises_on_slow_request():
    ct.reset_stages()
    ct.record(500.0, {"run_scan_total": 480.0, "sql_execute_fetch": 400.0})


def test_record_below_threshold_and_not_a_fast_sample_logs_nothing(capsys):
    ct._last_fast_log_at = time.time()  # suppress the fast-sample path
    ct.record(50.0, {})
    out = capsys.readouterr().out
    assert out == ""


def test_record_never_includes_request_body_or_secret_looking_fields(capsys):
    ct.reset_stages()
    ct.record(999.0, {"run_scan_total": 900.0})
    out = capsys.readouterr().out
    for banned in ("password", "token", "secret", "authorization", "api_key"):
        assert banned not in out.lower()


def test_instrument_scheduler_tracks_active_job_across_execution():
    class FakeScheduler:
        def add_job(self, func, *a, **kw):
            self._fn = func
            return func

    sched = FakeScheduler()
    ct.instrument_scheduler(sched)

    seen_during = {}

    def _job():
        seen_during["snapshot"] = ct._active_jobs_snapshot()

    sched.add_job(_job, id="my_test_job")
    assert "my_test_job" not in ct._active_jobs_snapshot()
    sched._fn()
    assert "my_test_job" in seen_during["snapshot"]
    assert "my_test_job" not in ct._active_jobs_snapshot()


def test_instrument_scheduler_removes_job_on_exception():
    class FakeScheduler:
        def add_job(self, func, *a, **kw):
            self._fn = func
            return func

    sched = FakeScheduler()
    ct.instrument_scheduler(sched)

    def _boom():
        raise RuntimeError("boom")

    sched.add_job(_boom, id="boom_job")
    try:
        sched._fn()
    except RuntimeError:
        pass
    assert "boom_job" not in ct._active_jobs_snapshot()
