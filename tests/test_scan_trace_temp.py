"""Package 8G-B scanner-serving instrumentation (TEMPORARY, 2026-09-05).
Proves the diagnostic patch is safe: it never breaks a request, it never
emits below the slow threshold, and its log line carries the expected
fields with no request/response data. Delete alongside the instrumentation
itself once production trace evidence has been collected.
"""
import logging
import time
import types

from api.services.screener import scan_trace_temp


def _request_with_ingress(t_ingress):
    state = types.SimpleNamespace(t_ingress=t_ingress)
    return types.SimpleNamespace(state=state)


def test_fast_request_never_logs(caplog):
    caplog.set_level(logging.WARNING, logger="scanner.trace_temp")
    t0 = time.perf_counter()
    req = _request_with_ingress(t0)
    scan_trace_temp.record(req, t0 + 0.001, t0 + 0.002, t0 + 0.003, rows_returned=10)
    assert caplog.records == []


def test_slow_request_logs_expected_fields(caplog):
    caplog.set_level(logging.WARNING, logger="scanner.trace_temp")
    t0 = time.perf_counter() - 0.5  # 500ms "ago" -> definitely over the 300ms bar
    req = _request_with_ingress(t0)
    scan_trace_temp.record(req, t0 + 0.01, t0 + 0.02, t0 + 0.03, rows_returned=7)
    assert len(caplog.records) == 1
    msg = caplog.records[0].message
    assert "total_ms=" in msg
    assert "pre_route_ms=" in msg
    assert "run_scan_ms=" in msg
    assert "post_scan_ms=" in msg
    assert "rows=7" in msg
    # No request/response content of any kind in the diagnostic line.
    assert "pattern_engine_ids" not in msg
    assert "ticker" not in msg


def test_missing_t_ingress_is_a_safe_noop(caplog):
    caplog.set_level(logging.WARNING, logger="scanner.trace_temp")
    req = types.SimpleNamespace(state=types.SimpleNamespace())  # no t_ingress set
    scan_trace_temp.record(req, 1.0, 2.0, 3.0, rows_returned=1)
    assert caplog.records == []


def test_record_never_raises_even_on_garbage_input():
    """Diagnostics must fail safe -- a real request must never break because
    of this instrumentation."""
    class _Boom:
        @property
        def state(self):
            raise RuntimeError("simulated failure")

    scan_trace_temp.record(_Boom(), 1.0, 2.0, 3.0, rows_returned=None)  # must not raise


def test_stage_is_a_noop_when_reset_stages_was_never_called():
    """Any OTHER caller of a `with scan_trace_temp.stage(...)`-wrapped
    function (there are none besides run_scan today, but the contract must
    hold) sees zero effect -- no dict is created, nothing is recorded.
    `pop_stages()` unconditionally leaves the contextvar at None, so calling
    it first makes this test order-independent regardless of what other
    tests in the same process called run_scan() directly beforehand."""
    scan_trace_temp.pop_stages()
    with scan_trace_temp.stage("whatever"):
        pass
    assert scan_trace_temp.pop_stages() == {}


def test_reset_then_stage_then_pop_round_trips_and_clears():
    scan_trace_temp.reset_stages()
    with scan_trace_temp.stage("sql_execute_fetch"):
        time.sleep(0.001)
    with scan_trace_temp.stage("row_convert"):
        pass
    stages = scan_trace_temp.pop_stages()
    assert set(stages) == {"sql_execute_fetch", "row_convert"}
    assert stages["sql_execute_fetch"] > 0
    # popped -- a second pop must not resurrect stale data for the next request
    assert scan_trace_temp.pop_stages() == {}


def test_slow_request_log_line_includes_stage_breakdown(caplog):
    caplog.set_level(logging.WARNING, logger="scanner.trace_temp")
    t0 = time.perf_counter() - 0.5
    req = _request_with_ingress(t0)
    req.state.run_scan_stages = {"sql_execute_fetch": 12.3, "row_convert": 0.4}
    scan_trace_temp.record(req, t0 + 0.01, t0 + 0.02, t0 + 0.03, rows_returned=3)
    assert len(caplog.records) == 1
    msg = caplog.records[0].message
    assert "sql_execute_fetch_ms=12.3" in msg
    assert "row_convert_ms=0.4" in msg
