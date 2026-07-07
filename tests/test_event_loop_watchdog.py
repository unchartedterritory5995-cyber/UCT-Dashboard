"""Unit tests for the web-pod event-loop wedge watchdog (audit finding B3).

Covers:
  * should_kill — the PURE wedge-decision function (armed/observe/threshold),
  * lag measurement against a real running loop (responsive => 0 misses),
  * a real wedged loop drives the kill path (os._exit monkeypatched),
  * get_status shape, the disabled gate, and idempotent start.

No test ever calls the real os._exit — it is monkeypatched everywhere the kill
path can be reached.
"""

import asyncio
import threading
import time

import pytest

from api import event_loop_watchdog as w
from api.event_loop_watchdog import should_kill


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _clean_watchdog():
    """Reset module state before and after every test."""
    w._reset_for_tests()
    yield
    w._reset_for_tests()


@pytest.fixture
def running_loop():
    """A real asyncio loop spun up on its own thread (like uvicorn's)."""
    loop = asyncio.new_event_loop()
    ready = threading.Event()

    def _run():
        asyncio.set_event_loop(loop)
        loop.call_soon(ready.set)
        loop.run_forever()

    t = threading.Thread(target=_run, name="test-loop", daemon=True)
    t.start()
    ready.wait(timeout=5)
    try:
        yield loop
    finally:
        loop.call_soon_threadsafe(loop.stop)
        t.join(timeout=5)
        loop.close()


@pytest.fixture
def fast_env(monkeypatch):
    """Tiny cadence/threshold so timing tests run in well under a second."""
    monkeypatch.setenv("WATCHDOG_CHECK_SEC", "0.05")
    monkeypatch.setenv("WATCHDOG_WEDGE_SEC", "0.2")
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)


# ===========================================================================
# should_kill — the pure decision function
# ===========================================================================
def test_should_kill_not_enabled_never_kills():
    # Even with a catastrophic sustained lag, an unarmed watchdog never exits.
    assert should_kill(missed_streak=999, lag_ms=10_000_000, wedge_sec=30,
                        check_sec=5, enabled=False, observe=False) is False


def test_should_kill_observe_only_never_kills():
    # Observe is a hard override even when ENABLED is also set.
    assert should_kill(missed_streak=999, lag_ms=10_000_000, wedge_sec=30,
                        check_sec=5, enabled=True, observe=True) is False


def test_should_kill_below_consecutive_threshold_no_kill():
    # wedge/check = 30/5 => need >=6 consecutive misses. 2 is a blip.
    assert should_kill(missed_streak=2, lag_ms=100, wedge_sec=30,
                        check_sec=5, enabled=True, observe=False) is False


def test_should_kill_enough_misses_but_lag_below_threshold_no_kill():
    # Many misses but lag hasn't reached wedge_sec (fast-recovering flap).
    assert should_kill(missed_streak=100, lag_ms=1000, wedge_sec=30,
                        check_sec=5, enabled=True, observe=False) is False


def test_should_kill_sustained_and_armed_kills():
    # 6 consecutive misses AND lag >= 30s, armed => kill.
    assert should_kill(missed_streak=6, lag_ms=30_000, wedge_sec=30,
                        check_sec=5, enabled=True, observe=False) is True


def test_should_kill_min_consecutive_floor_is_two():
    # wedge/check = 1/5 => ceil(0.2)=1, floored to 2. One miss must not kill.
    assert should_kill(missed_streak=1, lag_ms=999_999, wedge_sec=1,
                        check_sec=5, enabled=True, observe=False) is False
    # Two misses past threshold => kill.
    assert should_kill(missed_streak=2, lag_ms=5000, wedge_sec=1,
                        check_sec=5, enabled=True, observe=False) is True


def test_should_kill_nonpositive_config_no_kill():
    assert should_kill(missed_streak=999, lag_ms=999_999, wedge_sec=0,
                        check_sec=5, enabled=True, observe=False) is False
    assert should_kill(missed_streak=999, lag_ms=999_999, wedge_sec=30,
                        check_sec=0, enabled=True, observe=False) is False


# ===========================================================================
# Lag measurement against a real, responsive loop
# ===========================================================================
def test_responsive_loop_keeps_missed_streak_zero(running_loop, fast_env,
                                                  monkeypatch):
    monkeypatch.setenv("WATCHDOG_OBSERVE", "1")   # measure, never kill
    monkeypatch.delenv("WATCHDOG_ENABLED", raising=False)

    assert w.start_watchdog(loop=running_loop) is True
    time.sleep(0.4)  # ~8 probe cycles at 0.05s
    st = w.get_status()

    assert st["running"] is True
    assert st["checks"] >= 3                 # probes actually ran
    assert st["missed_streak"] == 0          # a healthy loop never misses
    assert st["max_lag_ms"] < 100            # idle loop services probes fast


# ===========================================================================
# A real wedged loop drives the kill path
# ===========================================================================
def test_wedged_loop_triggers_hard_exit(running_loop, fast_env, monkeypatch):
    monkeypatch.setenv("WATCHDOG_ENABLED", "1")   # armed
    monkeypatch.delenv("WATCHDOG_OBSERVE", raising=False)

    exits: list[int] = []
    monkeypatch.setattr(w.os, "_exit", lambda code: exits.append(code))
    # Keep the alert + dump off the wire during the test.
    monkeypatch.setattr(w, "_post_discord", lambda *a, **k: True)
    monkeypatch.setattr(w, "_dump_all_threads", lambda: None)

    assert w.start_watchdog(loop=running_loop) is True
    time.sleep(0.15)  # let a couple of healthy checks land first

    # Wedge the loop: a synchronous sleep inside a coroutine blocks it hard.
    async def _block():
        time.sleep(1.0)

    asyncio.run_coroutine_threadsafe(_block(), running_loop)

    # wedge_sec=0.2, check=0.05 => needs ~4 consecutive misses (~0.2s).
    deadline = time.time() + 2.0
    while not exits and time.time() < deadline:
        time.sleep(0.02)

    assert exits == [1], f"expected one os._exit(1), got {exits}"
    st = w.get_status()
    assert st["missed_streak"] >= 4


def test_trigger_wedge_calls_os_exit_and_never_raises(monkeypatch):
    exits: list[int] = []
    monkeypatch.setattr(w.os, "_exit", lambda code: exits.append(code))
    posts: list[str] = []
    monkeypatch.setattr(w, "_post_discord",
                        lambda hook, content: posts.append(content) or True)
    monkeypatch.setattr(w, "_dump_all_threads", lambda: None)

    w._trigger_wedge(lag_ms=42_000, missed=9, wedge_sec=30,
                     webhook="https://discord.example/hook")

    assert exits == [1]
    assert posts and "WEDGED" in posts[0]


# ===========================================================================
# get_status shape, disabled gate, idempotency
# ===========================================================================
def test_get_status_shape_before_start():
    st = w.get_status()
    required = {"enabled", "observe_only", "last_lag_ms", "max_lag_ms",
                "checks", "missed_streak", "started_at"}
    assert required.issubset(st.keys())
    assert st["started_at"] is None
    assert st["checks"] == 0
    assert st["missed_streak"] == 0
    assert st["running"] is False


def test_disabled_gate_does_not_start(running_loop, monkeypatch):
    monkeypatch.delenv("WATCHDOG_ENABLED", raising=False)
    monkeypatch.delenv("WATCHDOG_OBSERVE", raising=False)

    assert w.start_watchdog(loop=running_loop) is False
    st = w.get_status()
    assert st["running"] is False
    assert st["started_at"] is None


def test_idempotent_start(running_loop, fast_env, monkeypatch):
    monkeypatch.setenv("WATCHDOG_OBSERVE", "1")
    monkeypatch.delenv("WATCHDOG_ENABLED", raising=False)

    assert w.start_watchdog(loop=running_loop) is True
    first = w._thread
    # Second call must not spawn a second thread.
    assert w.start_watchdog(loop=running_loop) is True
    assert w._thread is first
    assert threading.active_count  # sanity


def test_start_never_raises_without_running_loop(monkeypatch):
    # No loop passed and none running in this thread -> returns False, no raise.
    monkeypatch.setenv("WATCHDOG_OBSERVE", "1")
    assert w.start_watchdog(loop=None) is False
