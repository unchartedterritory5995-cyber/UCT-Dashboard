"""The 429 handler that did not exist, and the breaker it drives.

Before 2026-08-08 `grep -rn YFRateLimitError api/` returned ZERO hits. A
rate-limited Yahoo was therefore indistinguishable from a timeout, a delisted
ticker, or a parse error: every caller swallowed it and every caller retried on
its next poll. With a warmer firing 7×/weekday over ~80 symbols at 4-5 calls
each, plus a 5-minute-polled calendar sweep, that is what produced "dozens of
Too Many Requests per second, sustained" — the provider was refusing us and
nothing in the process could tell.

These tests pin the three properties that make that impossible to repeat:

  1. the exception is caught BY NAME, and returns the caller's fallback;
  2. while the breaker is open NO CALL LEAVES THE PROCESS — the callable is not
     invoked at all, which is what turns 320 attempts per warm cycle into 0;
  3. the log gets ONE line per trip, not one per suppressed call.

Plus the property that made consolidating three pools into one safe: a guarded
call made from inside the pool runs INLINE instead of waiting for a slot only
its own caller could free.
"""
from __future__ import annotations

import concurrent.futures as cf
import logging
import threading
import time

import pytest

from api.services import yf_util


@pytest.fixture(autouse=True)
def _clean_breaker():
    yf_util.reset_guard_state()
    yield
    yf_util.reset_guard_state()


def _rate_limit_exc():
    # NOTE: yfinance's YFRateLimitError.__init__ takes NO arguments and supplies
    # its own message. Constructing it with one is a TypeError.
    return yf_util.YFRateLimitError()


# ── 1. handled by name ───────────────────────────────────────────────────────

def test_the_rate_limit_exception_is_bound_to_the_real_yfinance_class():
    """If this is False the handler still works (via `is_rate_limit_error`) but
    the "by name" property is gone — say so loudly rather than pass quietly."""
    assert yf_util.guard_status()["rate_limit_exception_bound"] is True
    import yfinance.exceptions as yfe
    assert yf_util.YFRateLimitError is yfe.YFRateLimitError


def test_a_rate_limit_returns_the_caller_default_and_opens_the_breaker():
    def boom():
        raise _rate_limit_exc()

    assert yf_util.bounded_call(boom, "FALLBACK") == "FALLBACK"
    st = yf_util.guard_status()
    assert st["rate_limited_total"] == 1
    assert st["breaker_open"] is True
    assert st["cooldown_seconds_remaining"] > 0


def test_a_non_rate_limit_error_does_not_open_the_breaker():
    """A delisted ticker must not pause yfinance for the whole process."""
    def boom():
        raise ValueError("no data for TICKER")

    assert yf_util.bounded_call(boom, None) is None
    assert yf_util.guard_status()["breaker_open"] is False


# ── 2. an open breaker makes NO network call ─────────────────────────────────

def test_an_open_breaker_does_not_invoke_the_callable_at_all():
    """The load-bearing assertion. Returning the default is not enough — the
    point is that the request never happens, so a warm cycle costs Yahoo
    nothing while it is refusing us."""
    def boom():
        raise _rate_limit_exc()

    yf_util.bounded_call(boom, None)          # trips it

    calls = []
    yf_util.bounded_call(lambda: calls.append(1), None)
    yf_util.bounded_call(lambda: calls.append(1), None)
    assert calls == [], "breaker is open — the callable must not run"
    assert yf_util.guard_status()["suppressed_total"] == 2


def test_the_breaker_reopens_after_its_cooldown(monkeypatch):
    monkeypatch.setattr(yf_util, "_COOLDOWN_BASE_S", 0.15)

    def boom():
        raise _rate_limit_exc()

    yf_util.bounded_call(boom, None)
    assert yf_util.rate_limited() is True
    time.sleep(0.25)
    assert yf_util.rate_limited() is False
    assert yf_util.bounded_call(lambda: "back", None) == "back"


def test_the_cooldown_doubles_on_consecutive_trips(monkeypatch):
    monkeypatch.setattr(yf_util, "_COOLDOWN_BASE_S", 0.10)
    monkeypatch.setattr(yf_util, "_COOLDOWN_MAX_S", 100.0)

    def boom():
        raise _rate_limit_exc()

    waits = []
    for _ in range(3):
        yf_util.bounded_call(boom, None)
        waits.append(yf_util.guard_status()["cooldown_seconds_remaining"])
        # jump past the cooldown so the next call actually reaches `boom`
        with yf_util._state_lock:
            yf_util._state["cooldown_until"] = 0.0

    assert yf_util.guard_status()["consecutive_trips"] == 3
    assert waits[1] > waits[0] and waits[2] > waits[1], waits


def test_a_clean_call_closes_the_breaker_and_resets_the_backoff(monkeypatch):
    monkeypatch.setattr(yf_util, "_COOLDOWN_BASE_S", 0.10)

    def boom():
        raise _rate_limit_exc()

    yf_util.bounded_call(boom, None)
    time.sleep(0.15)
    assert yf_util.bounded_call(lambda: "ok", None) == "ok"
    st = yf_util.guard_status()
    assert st["consecutive_trips"] == 0
    assert st["breaker_open"] is False


def test_one_trip_is_not_compounded_by_every_in_flight_call(monkeypatch):
    """8 workers can all come back 429 from the same burst. That is ONE event —
    counting each as a strike would jump the cooldown to the 900s cap on the
    first incident."""
    monkeypatch.setattr(yf_util, "_COOLDOWN_BASE_S", 30.0)

    def boom():
        raise _rate_limit_exc()

    for _ in range(5):
        # force the breaker "closed" so each call really reaches `boom`, the
        # way concurrent in-flight calls would
        with yf_util._state_lock:
            open_until = yf_util._state["cooldown_until"]
        yf_util.bounded_call(boom, None)
        with yf_util._state_lock:
            if open_until:
                yf_util._state["cooldown_until"] = open_until

    assert yf_util.guard_status()["rate_limited_total"] == 1, (
        "a suppressed call must not be counted as a fresh 429"
    )


# ── 3. one log line per trip, not per call ───────────────────────────────────

def test_a_rate_limit_storm_logs_once_not_once_per_call(caplog):
    def boom():
        raise _rate_limit_exc()

    with caplog.at_level(logging.DEBUG, logger="api.services.yf_util"):
        yf_util.bounded_call(boom, None)
        for _ in range(50):
            yf_util.bounded_call(boom, None)

    lines = [r for r in caplog.records if "rate-limited" in r.getMessage()]
    assert len(lines) == 1, (
        f"{len(lines)} log lines for one rate-limit event — this is the flood "
        "the breaker exists to stop"
    )
    assert "pausing ALL yfinance calls" in lines[0].getMessage()


# ── is_rate_limit_error: the defensive fallbacks ─────────────────────────────

@pytest.mark.parametrize("exc", [
    yf_util.YFRateLimitError(),
    yf_util.YFGuardPaused(),
    Exception("YFRateLimitError: Too Many Requests"),
    Exception("HTTP 429 rate limit exceeded"),
])
def test_is_rate_limit_error_recognises_the_common_shapes(exc):
    assert yf_util.is_rate_limit_error(exc) is True


def test_is_rate_limit_error_recognises_a_429_response_object():
    class _Resp:
        status_code = 429

    class _HTTPError(Exception):
        response = _Resp()

    assert yf_util.is_rate_limit_error(_HTTPError("boom")) is True


def test_is_rate_limit_error_recognises_a_reloaded_duplicate_class():
    """`importlib.reload` gives a class with the same NAME and a different
    identity — `isinstance` says no, the MRO name check says yes."""
    Dup = type("YFRateLimitError", (Exception,), {})
    assert yf_util.is_rate_limit_error(Dup("x")) is True


def test_is_rate_limit_error_says_no_to_an_ordinary_failure():
    assert yf_util.is_rate_limit_error(ValueError("no data")) is False
    assert yf_util.is_rate_limit_error(cf.TimeoutError()) is False


# ── reraise adapter semantics ────────────────────────────────────────────────

def test_reraise_propagates_the_rate_limit_instead_of_returning_a_default():
    def boom():
        raise _rate_limit_exc()

    with pytest.raises(yf_util.YFRateLimitError):
        yf_util.bounded_call(boom, None, reraise=True)


def test_reraise_raises_while_the_breaker_is_open_so_callers_see_no_data():
    def boom():
        raise _rate_limit_exc()

    yf_util.bounded_call(boom, None)
    with pytest.raises(yf_util.YFRateLimitError):
        yf_util.bounded_call(lambda: "never", None, reraise=True)


def test_reraise_propagates_a_timeout():
    with pytest.raises(cf.TimeoutError):
        yf_util.bounded_call(lambda: time.sleep(2.0), None, timeout=0.15, reraise=True)


# ── the pre-existing contract, unchanged ─────────────────────────────────────

def test_bounded_call_still_returns_the_value_on_the_happy_path():
    assert yf_util.bounded_call(lambda: 7, default=-1, timeout=1.0) == 7


def test_bounded_call_still_returns_the_default_promptly_on_timeout():
    t0 = time.monotonic()
    got = yf_util.bounded_call(lambda: time.sleep(1.5) or "slow", "D", timeout=0.2)
    assert got == "D"
    assert time.monotonic() - t0 < 1.0


def test_bounded_call_still_returns_the_default_on_an_arbitrary_error():
    def boom():
        raise RuntimeError("nope")

    assert yf_util.bounded_call(boom, default=None, timeout=1.0) is None


# ── re-entrancy: the property that made ONE pool safe ────────────────────────

def test_a_nested_guarded_call_runs_inline_instead_of_waiting_for_a_slot(monkeypatch):
    """`ratings_universe` submits `_compute_one` through the guard, and
    `_compute_one` calls `fundamentals.get_fundamentals`, which is guarded too.
    Three separate pools tolerated that by accident. ONE pool would have every
    worker parked waiting for a slot only another worker could free, so every
    nested call would burn its full deadline and return the default.

    Proven on a deliberately 1-wide pool: without the inline path the inner
    call cannot possibly get a slot."""
    tiny = cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="yf-tiny")
    monkeypatch.setitem(yf_util._LANES, "default", tiny)
    try:
        def inner():
            return "inner-ran"

        def outer():
            return yf_util.bounded_call(inner, "INNER-STARVED", timeout=0.5)

        t0 = time.monotonic()
        got = yf_util.bounded_call(outer, "OUTER-TIMED-OUT", timeout=3.0)
        assert got == "inner-ran"
        assert time.monotonic() - t0 < 1.0, "the nested call waited for a slot"
    finally:
        tiny.shutdown(wait=False)


def test_the_in_pool_marker_is_cleared_so_a_reused_thread_is_still_bounded(monkeypatch):
    """Pool threads are reused. If the marker leaked, the SECOND call on that
    thread would run inline with no wall-clock cap — a silent removal of the
    timeout for everything after the first hang."""
    tiny = cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="yf-tiny")
    monkeypatch.setitem(yf_util._LANES, "default", tiny)
    try:
        seen = []
        yf_util.bounded_call(lambda: seen.append(threading.current_thread()), None)
        # a later call from the MAIN thread must still be submitted, i.e. the
        # marker did not leak out of the worker
        got = yf_util.bounded_call(lambda: time.sleep(1.5) or "slow", "D", timeout=0.2)
        assert got == "D", "timeout no longer enforced — the in_pool marker leaked"
    finally:
        tiny.shutdown(wait=False)


# ── lanes: isolation of threads, never of policy ─────────────────────────────

def test_a_lane_uses_its_own_slots():
    yf_util.bounded_call(lambda: 1, None, lane="earnings")
    assert "earnings" in yf_util._LANES
    assert yf_util._LANES["earnings"] is not yf_util._LANES["default"]


def test_a_trip_in_one_lane_pauses_every_lane():
    """The whole reason a lane is not a second guard."""
    def boom():
        raise _rate_limit_exc()

    yf_util.bounded_call(boom, None, lane="earnings")

    calls = []
    yf_util.bounded_call(lambda: calls.append("default"), None)
    yf_util.bounded_call(lambda: calls.append("earnings"), None, lane="earnings")
    assert calls == []


def test_an_undeclared_lane_falls_back_to_the_default_rather_than_raising(caplog):
    with caplog.at_level(logging.WARNING, logger="api.services.yf_util"):
        assert yf_util.bounded_call(lambda: "ok", None, lane="nope") == "ok"
    assert any("undeclared lane" in r.getMessage() for r in caplog.records)
    assert "nope" not in yf_util._LANES


# ── the adapters really are this guard ───────────────────────────────────────

def test_yfinance_pool_run_in_pool_goes_through_the_shared_guard(monkeypatch):
    seen = {}

    def spy(fn, default, timeout=12.0, *, reraise=False, lane="default"):
        seen["called"] = True
        seen["reraise"] = reraise
        return fn()

    monkeypatch.setattr(yf_util, "bounded_call", spy)
    from api.services import yfinance_pool
    assert yfinance_pool.run_in_pool(lambda: "v", timeout=1) == "v"
    assert seen == {"called": True, "reraise": True}


def test_massive_bounded_yf_goes_through_the_shared_guard(monkeypatch):
    seen = {}

    def spy(fn, default, timeout=12.0, *, reraise=False, lane="default"):
        seen["called"] = True
        return default

    monkeypatch.setattr(yf_util, "bounded_call", spy)
    from api.services import massive
    assert massive._bounded_yf(lambda: "never", "DEF") == "DEF"
    assert seen == {"called": True}


def test_pool_status_surfaces_the_breaker_to_an_operator():
    from api.services import yfinance_pool
    st = yfinance_pool.pool_status()
    assert "breaker_open" in st and "cooldown_seconds_remaining" in st
    assert st["max_workers"] >= 1
    assert "default_timeout_seconds" in st
