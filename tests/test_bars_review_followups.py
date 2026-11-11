"""Review follow-ups to #1034 (N1, N2) and #1051 (covered-5m boundary lag).

N1  in-process BACKGROUND callers (bars_prewarm workers, `warm_bars_async`) took the
    "interactive or in-process" branch of `_bounded_date_delta`, so a prewarm burst
    could hold most of the D/W/M slots for up to 60 s each and shed a member's click
    after its 1 s slot wait. They now count against the warm share.
N2  `_start_tail_gapfill`: a runner that found the queue empty dropped the lock BEFORE
    releasing its slot, so a kick in between queued its key against a "full" pool and
    nobody ever drained it.
#1051  the covered-5m live proof trails each 5m boundary by the bucket's final minute
    for 2-5 s; thin covered names fell through to a request-path provider heal then.
"""
from __future__ import annotations

import threading
import time
import time as _real_time
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=_ET).timestamp())


def _until(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


def _saturate(sem):
    n = 0
    while sem.acquire(blocking=False):
        n += 1
    return n


def _release(sem, n):
    for _ in range(n):
        sem.release()


def _free(sem) -> int:
    n = _saturate(sem)
    _release(sem, n)
    return n


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    monkeypatch.setattr(bars_fetch, "_tail_gapfill_at", {})
    monkeypatch.setattr(bars_fetch, "_ext_completeness_attempt", {})
    monkeypatch.setattr(bars_fetch, "_completeness_attempt", {})
    bars_fetch.set_request_interactive(False)
    bars_fetch.end_request_budget()
    getattr(bars_fetch, "set_background_caller", lambda f: None)(False)
    yield
    bars_fetch.set_request_interactive(False)
    bars_fetch.end_request_budget()
    getattr(bars_fetch, "set_background_caller", lambda f: None)(False)


# ── N1: background in-process callers draw on the warm share ────────────────

def test_N1_background_in_process_caller_cannot_take_the_interactive_slots(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: [])
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_BG_SLOT_WAIT_S", 0.1, raising=False)
    held = _saturate(bars_fetch._date_delta_warm_sem)      # the warm share is in use
    free_before = _saturate(bars_fetch._date_delta_sem)
    _release(bars_fetch._date_delta_sem, free_before)
    try:
        bars_fetch.set_background_caller(True)              # e.g. a bars_prewarm worker
        assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is False, \
            "a background caller past the warm share must not take a click's slot"
        free_after = _saturate(bars_fetch._date_delta_sem)
        _release(bars_fetch._date_delta_sem, free_after)
        assert free_after == free_before
        # CONTROL: a truly interactive in-process caller (no background mark) is unaffected
        bars_fetch.set_background_caller(False)
        assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is True
    finally:
        _release(bars_fetch._date_delta_warm_sem, held)


def test_N1_background_caller_with_a_free_warm_share_completes_and_frees_both(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: [])
    bars_fetch.set_background_caller(True)
    assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is True
    assert _until(lambda: _free(bars_fetch._date_delta_warm_sem) == bars_fetch._DATE_DELTA_WARM_MAX)
    assert _until(lambda: _free(bars_fetch._date_delta_sem) == bars_fetch._DATE_DELTA_MAX)


def test_N1_warm_bars_async_marks_its_worker_threads_as_background(monkeypatch):
    seen = []
    done = threading.Event()

    def _inner(t, tf, bars):
        seen.append(bars_fetch._is_background_caller())
        done.set()
    monkeypatch.setattr(bars_fetch, "_get_bars_inner", _inner)
    bars_fetch.warm_bars_async(["AAPL"], tf="D", bars=10)
    assert done.wait(3.0)
    assert seen == [True]
    # and the mark is cleared for the next task on that pooled thread
    after = []
    bars_fetch._bars_warm_pool.submit(lambda: after.append(bars_fetch._is_background_caller())).result(3)
    assert after == [False]


def test_N1_bars_prewarm_worker_marks_itself_background():
    import inspect
    from api.services import bars_prewarm
    src = inspect.getsource(bars_prewarm)
    assert "_set_background_caller(True)" in src and "_set_background_caller(False)" in src
