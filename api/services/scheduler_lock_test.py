"""Tests for api.services.scheduler_lock.

The cross-process lock is the only thing standing between Phase 2's
--workers 2 and double-fired cron jobs (every COT refresh, MRR snapshot,
session cleanup duplicated). Tests cover:

  - First acquirer wins
  - Idempotent within a single process
  - Second process is denied while the first holds
  - Release allows reacquisition

Multi-process tests use multiprocessing.Process and are POSIX-only, since
fcntl is unavailable on Windows. The Windows code path is a no-op
(always grants), exercised by the in-process tests.
"""
import multiprocessing
import os
import sys

import pytest

requires_posix = pytest.mark.skipif(
    sys.platform == "win32",
    reason="fcntl is Linux/Mac only; Windows lock degrades to always-grant "
           "(verified by in-process tests). Production runs on Railway/Linux.",
)


def _reload_lock():
    import importlib
    from api.services import scheduler_lock
    # Reset module state between tests (the lock FD lives at module scope)
    scheduler_lock.release_scheduler_lock()
    importlib.reload(scheduler_lock)
    return scheduler_lock


def test_first_acquire_returns_true(tmp_path):
    lock = _reload_lock()
    path = str(tmp_path / "sched.lock")
    assert lock.acquire_scheduler_lock(path=path) is True
    assert lock.is_held() is True
    lock.release_scheduler_lock()


def test_acquire_is_idempotent_within_process(tmp_path):
    """Calling acquire twice in the same process must return True both times.
    Hardens against accidental double-call from defensive caller code."""
    lock = _reload_lock()
    path = str(tmp_path / "sched.lock")
    assert lock.acquire_scheduler_lock(path=path) is True
    assert lock.acquire_scheduler_lock(path=path) is True
    lock.release_scheduler_lock()


def test_release_clears_held_state(tmp_path):
    lock = _reload_lock()
    path = str(tmp_path / "sched.lock")
    lock.acquire_scheduler_lock(path=path)
    assert lock.is_held() is True
    lock.release_scheduler_lock()
    assert lock.is_held() is False


def test_release_allows_reacquisition(tmp_path):
    """After release, the same process can re-acquire the same path."""
    lock = _reload_lock()
    path = str(tmp_path / "sched.lock")
    assert lock.acquire_scheduler_lock(path=path) is True
    lock.release_scheduler_lock()
    assert lock.acquire_scheduler_lock(path=path) is True
    lock.release_scheduler_lock()


def _hold_lock_then_signal(lock_path: str, ready_event, release_event):
    """Helper run in a child process: acquire the lock, signal parent
    that we hold it, wait for parent to tell us to release."""
    from api.services import scheduler_lock as sl
    got = sl.acquire_scheduler_lock(path=lock_path)
    if not got:
        ready_event.set()  # signal anyway so parent doesn't deadlock
        return
    ready_event.set()
    release_event.wait(timeout=10)
    sl.release_scheduler_lock()


@requires_posix
def test_second_process_denied_while_first_holds(tmp_path):
    """The whole point: a second process trying to acquire the same lock
    while the first holds it must get False back. Without this, --workers 2
    would happily start two schedulers."""
    lock_path = str(tmp_path / "sched.lock")
    ctx = multiprocessing.get_context("spawn")  # avoid forked-state surprises
    ready = ctx.Event()
    release = ctx.Event()
    holder = ctx.Process(
        target=_hold_lock_then_signal,
        args=(lock_path, ready, release),
        name="lock-holder",
    )
    holder.start()
    try:
        # Wait for child to confirm it has the lock
        assert ready.wait(timeout=10), "child process never signaled ready"

        # In the parent (this process), reload the module and try to acquire.
        # Reload is necessary so any prior test state doesn't leak in.
        lock = _reload_lock()
        got = lock.acquire_scheduler_lock(path=lock_path)
        assert got is False, (
            "Second process acquired the lock while the first was holding it. "
            "Multi-worker scheduler de-duplication is broken."
        )
    finally:
        release.set()
        holder.join(timeout=5)
        if holder.is_alive():
            holder.terminate()


@requires_posix
def test_lock_releases_on_holder_process_exit(tmp_path):
    """When the lock-holding process exits, the OS releases the flock.
    A new process can then acquire it. This is what guarantees we don't
    leak locks across container restarts."""
    lock_path = str(tmp_path / "sched.lock")
    ctx = multiprocessing.get_context("spawn")

    def _short_lived_holder(p):
        from api.services import scheduler_lock as sl
        sl.acquire_scheduler_lock(path=p)
        # Process exits immediately, releasing the flock

    holder = ctx.Process(target=_short_lived_holder, args=(lock_path,))
    holder.start()
    holder.join(timeout=5)
    assert holder.exitcode == 0

    lock = _reload_lock()
    got = lock.acquire_scheduler_lock(path=lock_path)
    assert got is True, (
        "Lock not released after holder process exited. The OS should clean "
        "up flocks automatically — if this fails we'll leak locks across "
        "Railway container restarts."
    )
    lock.release_scheduler_lock()
