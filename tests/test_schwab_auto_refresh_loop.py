"""Rails on `schwab_service._auto_refresh_loop` (2026-11-10).

The loop had FOUR defects over its life; the docstring on the loop itself records all
four. Two were fixed earlier (nothing started it; a docstring that promised re-auth was
never needed). These tests pin the other two, which were found by ARMING the thing and
then watching it fail to do its job:

  3. It slept 25 minutes BEFORE its first check, so a pod that boots holding a nearly
     expired token leaves it to expire, and a pod that redeploys more often than 25
     minutes never checks at all. Measured on web: a token 45 minutes old and expired
     while this loop was "running".
  4. It had no try/except, so one raise exited `while True` and killed auto-refresh for
     the life of the process — silently, and indistinguishably from working.

Every behavioural test here is written so the OLD code fails it. That is the point: a
test that passes against both versions pins nothing.
"""
import ast
import asyncio
import inspect
import time

import pytest

from api import schwab_service


def _expiring_token() -> dict:
    """A token real `_is_expiring` calls expiring: age 1800s > (1800 - 60)."""
    return {"access_token": "old", "refresh_token": "r", "expires_in": 1800,
            "saved_at": time.time() - 1800}


def _fresh_token() -> dict:
    return {"access_token": "new", "refresh_token": "r", "expires_in": 1800,
            "saved_at": time.time()}


@pytest.fixture
def loop_env(monkeypatch):
    """Drive the loop with fakes and a recorded call log."""
    state = {"calls": 0, "event": asyncio.Event(), "raise_times": 0}

    async def fake_get_valid_token():
        state["calls"] += 1
        if state["raise_times"] >= state["calls"]:
            raise RuntimeError("transient network blip")
        state["event"].set()
        return "fresh-access-token"

    monkeypatch.setattr(schwab_service, "get_valid_token", fake_get_valid_token)
    return state


async def _run_until(state, task, timeout=2.0):
    try:
        await asyncio.wait_for(state["event"].wait(), timeout=timeout)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


# ─── bug 3: check BEFORE sleeping ────────────────────────────────────────────────

async def test_first_tick_refreshes_before_the_first_sleep(monkeypatch, loop_env):
    """⛔ MUTATION-PROOF AGAINST THE ORIGINAL ORDER.

    The poll interval is set to ~3 hours, so the ONLY way a refresh can happen inside
    this test's 2-second budget is if the loop checks before it sleeps. The old
    `await asyncio.sleep(25 * 60)`-first body would still be sleeping and this test
    would time out.
    """
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 10_000)
    monkeypatch.setattr(schwab_service, "load_tokens", lambda: _expiring_token())

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    await _run_until(loop_env, task)

    assert loop_env["calls"] == 1, (
        "expected exactly one refresh on the first tick, before any sleep; "
        "got %d" % loop_env["calls"])


async def test_a_fresh_token_is_not_refreshed(monkeypatch, loop_env):
    """POSITIVE CONTROL for the test above: the loop must not refresh on every wake-up,
    or arming it would hammer Schwab every poll interval. Without this, a loop that
    refreshes unconditionally would pass the bug-3 test."""
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 10_000)
    monkeypatch.setattr(schwab_service, "load_tokens", lambda: _fresh_token())

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    # Give it room to tick and reach its sleep.
    for _ in range(50):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert loop_env["calls"] == 0, "a fresh token must not be refreshed"


async def test_missing_refresh_token_is_idle_not_an_error(monkeypatch, loop_env):
    """flow-worker's replica deliberately holds NO refresh token. The loop must treat
    that as idle rather than attempting a refresh it cannot do."""
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 10_000)
    monkeypatch.setattr(
        schwab_service, "load_tokens",
        lambda: {"access_token": "a", "expires_in": 1800, "saved_at": time.time() - 1800})

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    for _ in range(50):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert loop_env["calls"] == 0


async def test_no_token_at_all_is_idle(monkeypatch, loop_env):
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 10_000)
    monkeypatch.setattr(schwab_service, "load_tokens", lambda: None)

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    for _ in range(50):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert loop_env["calls"] == 0


# ─── bug 4: one tick's exception must not end the loop ───────────────────────────

async def test_a_raising_tick_does_not_kill_the_loop(monkeypatch, loop_env):
    """⛔ MUTATION-PROOF AGAINST THE MISSING try/except.

    The first refresh raises; the second must still be attempted. The old body had no
    guard, so the exception propagated out of `while True`, the task ended, and
    `calls` stopped at 1 forever.
    """
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 0)
    monkeypatch.setattr(schwab_service, "load_tokens", lambda: _expiring_token())
    loop_env["raise_times"] = 1          # only the FIRST call raises

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    await _run_until(loop_env, task)

    assert loop_env["calls"] >= 2, (
        "the loop must survive a raising tick and try again; it stopped after %d call(s)"
        % loop_env["calls"])


async def test_load_tokens_raising_does_not_kill_the_loop(monkeypatch, loop_env):
    """The guard has to cover the whole tick, not just the refresh. A corrupt or
    half-written token file makes `load_tokens` itself raise."""
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 0)
    calls = {"n": 0}

    def flaky_load():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("bad json on the volume")
        return _expiring_token()

    monkeypatch.setattr(schwab_service, "load_tokens", flaky_load)

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    await _run_until(loop_env, task)

    assert calls["n"] >= 2 and loop_env["calls"] >= 1


async def test_cancellation_still_stops_the_loop(monkeypatch, loop_env):
    """The broad `except Exception` must NOT swallow CancelledError, or
    `stop_auto_refresh()` would be unable to stop the task."""
    monkeypatch.setattr(schwab_service, "_AUTO_REFRESH_POLL_SEC", 10_000)
    monkeypatch.setattr(schwab_service, "load_tokens", lambda: _fresh_token())

    task = asyncio.create_task(schwab_service._auto_refresh_loop())
    for _ in range(20):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()


# ─── structural rails ────────────────────────────────────────────────────────────

def _loop_ast():
    src = inspect.getsource(schwab_service._auto_refresh_loop)
    return ast.parse(src.lstrip()).body[0]


def test_the_while_body_starts_with_a_try_not_a_sleep():
    """Pins BOTH fixes structurally, so neither can be undone by a tidy-up that still
    passes the behavioural tests by accident."""
    fn = _loop_ast()
    whiles = [n for n in fn.body if isinstance(n, ast.While)]
    assert len(whiles) == 1, "expected exactly one `while` in the loop"
    first = whiles[0].body[0]
    assert isinstance(first, ast.Try), (
        "the first statement inside `while True:` must be `try:` — if it is a sleep, "
        "bug 3 is back; if there is no Try, bug 4 is back. Got %s"
        % type(first).__name__)


def test_the_loop_refreshes_through_the_single_flighted_path():
    """⭐ It must call `get_valid_token()` (which holds `_TOKEN_REFRESH_LOCK`) and NOT
    `refresh_access_token()` directly — calling the refresh directly makes this loop a
    racer in the very refresh-storm that lock exists to prevent."""
    src = inspect.getsource(schwab_service._auto_refresh_loop)
    body = src.split('"""')[-1]          # strip the docstring, which names both
    assert "get_valid_token(" in body, "the loop must refresh via get_valid_token()"
    assert "refresh_access_token(" not in body, (
        "the loop must NOT call refresh_access_token() directly — that bypasses the "
        "single-flight lock")


def test_cancelled_error_is_re_raised_before_the_broad_except():
    """Order matters: `except asyncio.CancelledError: raise` has to come BEFORE
    `except Exception`, or cancellation is swallowed."""
    fn = _loop_ast()
    tries = [n for n in ast.walk(fn) if isinstance(n, ast.Try)]
    assert tries, "no try/except in the loop"
    handlers = tries[0].handlers
    names = []
    for h in handlers:
        t = h.type
        if isinstance(t, ast.Attribute):
            names.append(t.attr)
        elif isinstance(t, ast.Name):
            names.append(t.id)
        else:
            names.append(None)
    assert names[0] == "CancelledError", (
        "CancelledError must be the FIRST handler; got %s" % names)
    assert any(n == "Exception" for n in names), "a broad guard must follow it"
    assert any(isinstance(s, ast.Raise) for s in handlers[0].body), (
        "the CancelledError handler must re-raise")


def test_the_poll_interval_is_read_from_the_module_not_hardcoded():
    """A literal `25 * 60` in the body would make the interval unpatchable and reopen
    the redeploy-outruns-the-poll hole."""
    src = inspect.getsource(schwab_service._auto_refresh_loop)
    body = src.split('"""')[-1]
    assert "_AUTO_REFRESH_POLL_SEC" in body
    assert isinstance(schwab_service._AUTO_REFRESH_POLL_SEC, int)
    assert 0 <= schwab_service._AUTO_REFRESH_POLL_SEC <= 600, (
        "the poll must be well under the 30-minute token life; got %s"
        % schwab_service._AUTO_REFRESH_POLL_SEC)
