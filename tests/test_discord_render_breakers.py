"""Per-dependency circuit breakers and jittered retries (step 2.4b, 03 §3.8).

The properties that matter when a dependency is down:
  * the breaker opens, and the NEXT member is refused immediately instead of waiting for the same
    timeout again;
  * exactly ONE probe is let through when the cooldown expires — not every waiting caller;
  * one dependency's outage never stops another (separate breakers, separate state);
  * a retry delay is jittered, so callers that failed together do not retry together.
"""
from __future__ import annotations

import threading

import pytest

from api.services.discord_render import breakers as br


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def _clean():
    br.reset_all_for_tests()
    yield
    br.reset_all_for_tests()


def _fail(b, n):
    for _ in range(n):
        assert b.allow()
        b.record_failure()


# ── opening ─────────────────────────────────────────────────────────────────

def test_it_opens_after_consecutive_failures_and_then_refuses_immediately():
    clock = Clock()
    b = br.Breaker("renderer", br.BreakerConfig(fail_threshold=3, cooldown_s=15.0), now=clock)
    _fail(b, 2)
    assert b.state == br.CLOSED, "two failures must not open a breaker with a threshold of three"
    assert b.allow() is True
    b.record_failure()
    assert b.state == br.OPEN
    assert b.allow() is False, "an open breaker must refuse without calling the dependency"
    assert b.snapshot()["trips"] == 1 and b.snapshot()["short_circuits"] == 1


def test_a_dependency_failing_every_other_call_still_opens():
    """⛔ A consecutive-only count never fires on a flapping dependency, which is just as broken."""
    clock = Clock()
    b = br.Breaker("flow", br.BreakerConfig(fail_threshold=99, fail_ratio=0.5, window=10), now=clock)
    for _ in range(5):
        assert b.allow()
        b.record_success()
        assert b.allow()
        b.record_failure()
    assert b.state == br.OPEN
    assert b.snapshot()["consecutive_failures"] == 1, "it opened on the RATIO, not a streak"


def test_a_success_resets_the_streak():
    clock = Clock()
    b = br.Breaker("bars", br.BreakerConfig(fail_threshold=3), now=clock)
    _fail(b, 2)
    assert b.allow()
    b.record_success()
    _fail(b, 2)
    assert b.state == br.CLOSED


# ── the half-open probe ─────────────────────────────────────────────────────

def test_after_the_cooldown_exactly_one_probe_is_let_through():
    """⛔ THE HERD. Every waiting caller probing at once is what knocked the dependency over."""
    clock = Clock()
    b = br.Breaker("renderer", br.BreakerConfig(fail_threshold=2, cooldown_s=15.0), now=clock)
    _fail(b, 2)
    assert b.allow() is False
    clock.t += 14.9
    assert b.allow() is False, "the cooldown had not elapsed"
    clock.t += 0.2
    assert b.allow() is True, "the first caller after the cooldown gets the probe"
    for _ in range(5):
        assert b.allow() is False, "a second caller must NOT probe while one is in flight"


def test_a_successful_probe_closes_the_breaker():
    clock = Clock()
    b = br.Breaker("renderer", br.BreakerConfig(fail_threshold=2, cooldown_s=10.0), now=clock)
    _fail(b, 2)
    clock.t += 11
    assert b.allow() is True
    b.record_success()
    assert b.state == br.CLOSED
    assert b.allow() is True and b.allow() is True, "closed means everyone goes through"


def test_a_failed_probe_reopens_for_a_full_cooldown():
    clock = Clock()
    b = br.Breaker("renderer", br.BreakerConfig(fail_threshold=2, cooldown_s=10.0), now=clock)
    _fail(b, 2)
    clock.t += 11
    assert b.allow() is True
    b.record_failure()
    assert b.state == br.OPEN
    assert b.allow() is False
    clock.t += 5
    assert b.allow() is False, "a failed probe must not shorten the next cooldown"
    clock.t += 6
    assert b.allow() is True


def test_the_probe_is_single_flight_under_real_threads():
    clock = Clock()
    b = br.Breaker("renderer", br.BreakerConfig(fail_threshold=2, cooldown_s=1.0), now=clock)
    _fail(b, 2)
    clock.t += 2
    allowed, lock = [], threading.Lock()

    def worker():
        ok = b.allow()
        with lock:
            allowed.append(ok)
    threads = [threading.Thread(target=worker) for _ in range(25)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(allowed) == 1, f"{sum(allowed)} callers probed at once"


# ── isolation ───────────────────────────────────────────────────────────────

def test_one_dependency_going_down_never_stops_another():
    """⛔ A shared breaker opened by flow-worker would stop chart renders — the opposite of degrading."""
    flow, renderer = br.breaker("flow"), br.breaker("renderer")
    for _ in range(20):
        if flow.allow():
            flow.record_failure()
    assert flow.state == br.OPEN
    assert renderer.state == br.CLOSED and renderer.allow() is True
    assert br.breaker("flow") is flow, "the registry must return the SAME breaker per name"


def test_every_named_dependency_has_its_own_config():
    for name in ("renderer", "flow", "quote", "bars"):
        assert name in br.DEFAULTS
        assert br.breaker(name).config is br.DEFAULTS[name]
    assert br.breaker("something-new").config.fail_threshold > 0, "an unknown name still gets a breaker"


# ── retries and jitter ──────────────────────────────────────────────────────

def test_the_retry_delay_is_jittered_and_grows():
    lo = br.retry_delay(1, 0.4, 0.5, rand=lambda: 0.0)
    hi = br.retry_delay(1, 0.4, 0.5, rand=lambda: 1.0)
    assert lo == pytest.approx(0.4) and hi == pytest.approx(0.9)
    assert br.retry_delay(2, 0.4, 0.5, rand=lambda: 0.0) == pytest.approx(0.8)
    # ⛔ Jitter is the point: a fixed delay re-synchronises every caller that failed together.
    assert len({round(br.retry_delay(1), 4) for _ in range(40)}) > 1


def test_call_retries_then_records_one_failure_not_three():
    calls, slept = [], []
    def boom():
        calls.append(1)
        raise TimeoutError("provider")
    with pytest.raises(TimeoutError):
        br.call("bars", boom, attempts=3, sleep=slept.append, rand=lambda: 0.5)
    assert len(calls) == 3, "all three attempts should have run"
    assert len(slept) == 2, "two waits between three attempts"
    assert br.breaker("bars").snapshot()["consecutive_failures"] == 1, (
        "a retried call is ONE failure against the breaker, not three — otherwise a single slow "
        "moment trips it")


def test_call_returns_on_a_later_attempt_and_records_success():
    state = {"n": 0}
    def flaky():
        state["n"] += 1
        if state["n"] < 3:
            raise ConnectionError("transient")
        return "chart.png"
    assert br.call("renderer", flaky, attempts=3, sleep=lambda s: None) == "chart.png"
    assert br.breaker("renderer").state == br.CLOSED
    assert br.breaker("renderer").snapshot()["consecutive_failures"] == 0


def test_call_refuses_without_touching_the_dependency_when_open():
    b = br.breaker("flow")
    for _ in range(20):
        if b.allow():
            b.record_failure()
    assert b.state == br.OPEN
    touched = []
    with pytest.raises(br.BreakerOpen) as e:
        br.call("flow", lambda: touched.append(1))
    assert touched == [], "the dependency was called while its breaker was open"
    assert e.value.name == "flow"


def test_a_non_retryable_error_is_not_retried_but_still_counts():
    calls = []
    def bad():
        calls.append(1)
        raise ValueError("bad request")
    with pytest.raises(ValueError):
        br.call("quote", bad, attempts=3, retry_on=(TimeoutError,), sleep=lambda s: None)
    assert len(calls) == 1, "a non-retryable error must not be retried"
    assert br.breaker("quote").snapshot()["consecutive_failures"] == 1


def test_snapshot_all_reports_every_live_breaker():
    br.call("renderer", lambda: "ok")
    b = br.breaker("flow")
    for _ in range(20):
        if b.allow():
            b.record_failure()
    snap = br.snapshot_all()
    assert snap["renderer"]["state"] == br.CLOSED and snap["flow"]["state"] == br.OPEN
    assert snap["flow"]["trips"] >= 1
