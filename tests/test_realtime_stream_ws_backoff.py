"""realtime_stream.py — WS reconnect backoff / circuit breaker / shared-budget
coordination (2026-08-05).

Production incident this fixes: a WS reconnect storm ("reconnecting in 8s...
15s...2s" — NON-monotonic) burning Finnhub's account budget continuously,
starving the REST calls the earnings modal depends on. Two independent bugs
combined to cause it:
  1. No coordination at all with the shared REST budget (finnhub_client.py).
  2. The backoff RESET to 1s the instant a connection was ACCEPTED, even if
     Finnhub kicked it again immediately — a connect-then-immediate-kick
     pattern reset the counter every single cycle.

This file covers (1) `_ws_reconnect_transition` — the pure state machine
(bug #2) in isolation, no asyncio/websockets required — and (2) that
`_run_websocket` actually consults the shared budget gate and reports a
WS-side 429 into the shared cooldown, via a bounded async harness.
"""
import asyncio

import pytest

from api.services import realtime_stream as rs
from api.services import finnhub_client as fhc


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = fhc._time.monotonic()
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = fhc._time.monotonic()


# ── _ws_reconnect_transition: pure state machine ─────────────────────────────

class TestWsReconnectTransition:
    def test_a_stable_connection_resets_backoff_and_failure_count(self):
        t = rs._ws_reconnect_transition(consecutive_failures=5, backoff_s=8.0, was_stable=True)
        assert t["consecutive_failures"] == 0
        assert t["sleep_s"] == rs._WS_BASE_BACKOFF_S
        assert t["next_backoff_s"] == rs._WS_BASE_BACKOFF_S
        assert t["circuit_break"] is False

    def test_an_unstable_failure_doubles_backoff_and_increments_the_streak(self):
        t = rs._ws_reconnect_transition(consecutive_failures=1, backoff_s=2.0, was_stable=False)
        assert t["consecutive_failures"] == 2
        assert t["sleep_s"] == 2.0          # THIS cycle sleeps the OLD backoff
        assert t["next_backoff_s"] == 4.0   # NEXT cycle doubles
        assert t["circuit_break"] is False

    def test_backoff_growth_is_capped_at_the_max(self):
        t = rs._ws_reconnect_transition(consecutive_failures=1, backoff_s=rs._WS_MAX_BACKOFF_S, was_stable=False)
        assert t["next_backoff_s"] == rs._WS_MAX_BACKOFF_S  # never exceeds the ceiling

    def test_a_connect_then_immediate_kick_does_not_prematurely_reset_backoff(self):
        """THE bug this file exists to catch: a connection that is accepted
        and then immediately dropped (was_stable=False, because it never
        stayed open _WS_MIN_STABLE_CONNECT_S) must NOT reset backoff to 1 —
        that was the mechanism behind the observed non-monotonic storm."""
        backoff = rs._WS_BASE_BACKOFF_S
        failures = 0
        seen_sleeps = []
        for _ in range(5):
            t = rs._ws_reconnect_transition(failures, backoff, was_stable=False)
            seen_sleeps.append(t["sleep_s"])
            failures, backoff = t["consecutive_failures"], t["next_backoff_s"]
        # Strictly non-decreasing (until the cap) — never drops back to 1
        # partway through a continued failure streak.
        for a, b in zip(seen_sleeps, seen_sleeps[1:]):
            assert b >= a, f"backoff regressed mid-storm: {seen_sleeps}"
        assert seen_sleeps == [1, 2, 4, 8, 15]

    def test_circuit_breaker_trips_at_the_configured_ceiling(self):
        backoff = rs._WS_BASE_BACKOFF_S
        failures = 0
        tripped_at = None
        for i in range(1, rs._WS_MAX_CONSECUTIVE_FAILURES + 2):
            t = rs._ws_reconnect_transition(failures, backoff, was_stable=False)
            failures, backoff = t["consecutive_failures"], t["next_backoff_s"]
            if t["circuit_break"]:
                tripped_at = i
                break
        assert tripped_at == rs._WS_MAX_CONSECUTIVE_FAILURES
        assert t["sleep_s"] == rs._WS_CIRCUIT_BREAKER_S
        # Circuit breaker resets the streak/backoff for the NEXT attempt after
        # the quiet period — it doesn't wedge the loop permanently.
        assert t["consecutive_failures"] == 0
        assert t["next_backoff_s"] == rs._WS_BASE_BACKOFF_S

    def test_a_stable_connection_after_a_long_failure_streak_still_fully_recovers(self):
        t = rs._ws_reconnect_transition(consecutive_failures=rs._WS_MAX_CONSECUTIVE_FAILURES - 1,
                                         backoff_s=rs._WS_MAX_BACKOFF_S, was_stable=True)
        assert t == {"consecutive_failures": 0, "sleep_s": rs._WS_BASE_BACKOFF_S,
                     "next_backoff_s": rs._WS_BASE_BACKOFF_S, "circuit_break": False}


# ── _run_websocket: shared-budget gate + cross-source 429 coordination ──────
# Bounded async harness: patches websockets.connect + asyncio.sleep so the
# infinite loop can be driven a fixed number of iterations and then stopped
# deterministically via a sentinel exception, rather than actually sleeping
# or hitting the network.

class _StopLoop(Exception):
    """Raised by the patched asyncio.sleep once the test has seen enough."""


@pytest.mark.asyncio
async def test_run_websocket_never_attempts_connect_when_budget_denied(monkeypatch):
    """If the shared gate says no, _run_websocket must not even call
    websockets.connect — an attempt we already know competes for scarce
    budget is worse than no attempt (see finnhub_client's WS-priority
    design)."""
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setattr(rs, "_FINNHUB_KEY", "test-key")
    monkeypatch.setattr(rs, "_WS_URL", "wss://example.invalid/test")

    connect_calls = {"n": 0}

    class _FakeWebsockets:
        @staticmethod
        def connect(*a, **k):
            connect_calls["n"] += 1
            raise AssertionError("websockets.connect was called despite a denied budget gate")

    monkeypatch.setitem(__import__("sys").modules, "websockets", _FakeWebsockets)
    monkeypatch.setattr(fhc, "fh_ws_reconnect_allowed", lambda: False)

    sleep_calls = {"n": 0}

    async def fake_sleep(seconds):
        sleep_calls["n"] += 1
        if sleep_calls["n"] >= 3:
            raise _StopLoop()

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with pytest.raises(_StopLoop):
        await rs._run_websocket()

    assert connect_calls["n"] == 0
    assert sleep_calls["n"] >= 3


@pytest.mark.asyncio
async def test_run_websocket_reports_a_ws_side_429_into_the_shared_cooldown(monkeypatch):
    """A rejected handshake shaped like Finnhub's real 429 message must
    engage the SAME cooldown fh_get respects, so REST backs off in step."""
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setattr(rs, "_FINNHUB_KEY", "test-key")
    monkeypatch.setattr(rs, "_WS_URL", "wss://example.invalid/test")
    monkeypatch.setattr(fhc, "fh_ws_reconnect_allowed", lambda: True)

    class _FakeWebsockets:
        @staticmethod
        def connect(*a, **k):
            raise RuntimeError("server rejected WebSocket connection: HTTP 429")

    monkeypatch.setitem(__import__("sys").modules, "websockets", _FakeWebsockets)

    assert fhc.fh_in_cooldown() is False

    sleep_calls = {"n": 0}

    async def fake_sleep(seconds):
        sleep_calls["n"] += 1
        raise _StopLoop()

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with pytest.raises(_StopLoop):
        await rs._run_websocket()

    assert fhc.fh_in_cooldown() is True


@pytest.mark.asyncio
async def test_a_liveness_forced_reconnect_does_not_stale_poison_a_later_failures_stability(monkeypatch):
    """Regression for a bug found while reviewing this fix: the liveness-
    timeout path (feed silent _RECV_TIMEOUT_S while subscribed) exits the
    `async with` block WITHOUT an exception, so it never reaches the
    was_stable/backoff bookkeeping in the except handler — it just retries
    immediately from the top of the outer loop. If `connect_started` were
    left set from that earlier successful connection, a LATER genuine
    connect failure would compute was_stable from a STALE timestamp (however
    long ago that first connection happened, easily >= _WS_MIN_STABLE_CONNECT_S
    in production) instead of correctly treating an unknown-stability session
    as a continued failure. `connect_started` must be reset to None at the
    liveness-break site.

    Sequence driven: fail, fail (builds a real failure streak) -> connect
    succeeds then immediately liveness-times-out (the reset site under test)
    -> fail again. A stale connect_started (the bug) would make this final
    failure compute was_stable=True (via a manipulated fake clock showing
    a huge apparent gap) and WRONGLY reset the failure streak; the fix keeps
    it climbing.
    """
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setattr(rs, "_FINNHUB_KEY", "test-key")
    monkeypatch.setattr(rs, "_WS_URL", "wss://example.invalid/test")
    monkeypatch.setattr(fhc, "fh_ws_reconnect_allowed", lambda: True)

    # At least one subscriber so the liveness-timeout path takes the
    # `break` branch (not the `continue` "nothing subscribed" branch).
    with rs._lock:
        rs._subscribed.add("AAPL")
    try:
        class _FakeConnCtx:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def send(self, *a, **k):
                pass

            async def recv(self):
                # Never actually awaited — the fake wait_for below intercepts
                # before awaiting it, so this body never runs.
                raise AssertionError("recv() should never be awaited directly")

        call_n = {"n": 0}

        class _FakeWebsockets:
            @staticmethod
            def connect(*a, **k):
                call_n["n"] += 1
                if call_n["n"] in (1, 2):
                    raise RuntimeError(f"boom{call_n['n']}")
                if call_n["n"] == 3:
                    return _FakeConnCtx()
                raise RuntimeError("boom-final")

        monkeypatch.setitem(__import__("sys").modules, "websockets", _FakeWebsockets)

        # Controlled fake clock, always advancing by 1000s per call: EVERY
        # two calls are >= _WS_MIN_STABLE_CONNECT_S (10s) apart, unconditionally
        # — so IF the bug were reintroduced (a second time.monotonic() call
        # reading connect_started's stale timestamp), was_stable would compute
        # True regardless of exactly how many clock calls preceded it. The
        # fix short-circuits on `connect_started is not None` and never makes
        # that second call at all in this flow (see trace in the docstring).
        import itertools
        clock = itertools.count(100.0, 1000.0)

        def fake_monotonic():
            return next(clock)

        monkeypatch.setattr(rs.time, "monotonic", fake_monotonic)

        async def fake_wait_for(coro, timeout):
            coro.close()  # avoid "coroutine was never awaited"
            raise asyncio.TimeoutError()

        monkeypatch.setattr(asyncio, "wait_for", fake_wait_for)

        sleep_calls = []

        async def fake_sleep(seconds):
            sleep_calls.append(seconds)
            if len(sleep_calls) >= 4:
                raise _StopLoop()

        monkeypatch.setattr(asyncio, "sleep", fake_sleep)

        with pytest.raises(_StopLoop):
            await rs._run_websocket()

        # sleep_calls, in order: boom1 (backoff=1) -> boom2 (backoff=2) ->
        # <liveness break: connect succeeds, immediately times out, NO sleep,
        # retries from the top> -> boom-final ×2 more (backoff=4, then 8).
        # THE regression check: with the bug, the failure AFTER the liveness
        # break would see was_stable=True (stale connect_started from the
        # brief successful connection, huge fake-clock gap) and wrongly reset
        # to the BASE backoff (1s) instead of carrying the streak forward —
        # i.e. the buggy sequence would read [1, 2, 1, 2] instead of this.
        assert sleep_calls == [1, 2, 4, 8], (
            f"connect_started leaked across the liveness-break site — "
            f"a later failure's backoff was wrongly reset instead of "
            f"continuing to climb: {sleep_calls}"
        )
    finally:
        with rs._lock:
            rs._subscribed.discard("AAPL")
