"""The request path must never wait on a provider without a ceiling.

⛔ THE DEFECT THIS RAILS. Measured on production 2026-09-20: `UTMD tf=5` answered
in 16,102 ms then 503, `BATRK tf=1` in 16,331 ms. Neither is a provider latency —
it is the CF Worker's 8 s abort plus the web pod's 8 s re-proxy to the same tier.
The tier reached those numbers because Layer 4's delta branch called the provider
synchronously on the request thread with no bound.

⭐ THE CONTROL IS THE POINT. A ceiling test that passes because the fake provider
is fast proves nothing, so `test_a_slow_delta_would_block_without_the_ceiling`
drives the SAME fake through a bare call and asserts it really does take longer
than the deadline. Without that, deleting `_bounded_delta` leaves this file green.
"""
import threading
import time

import pytest

from api.services import bars_fetch

#: A plausible recent bar instant. ⚠️ NOT a fixed epoch — `_bounded_delta`
#: inherits `_bg_delta`'s `_is_intraday_stale` guard (5-day gate), so a bar
#: dated 2023 is correctly REFUSED and the persist assertion below would fail
#: for a reason that has nothing to do with the deadline.
_RECENT = int(time.time()) - 600


@pytest.fixture(autouse=True)
def _fast_deadline(monkeypatch):
    """A short ceiling keeps the suite quick; the behaviour under test is the
    ceiling existing, not its production value."""
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)


def _slow_delta(seconds=3.0):
    """A provider that behaves like the measured UTMD case: eventually answers,
    far past any budget a request may spend."""
    started = threading.Event()

    def _fn(ticker, tf, last_ts):
        started.set()
        time.sleep(seconds)
        return [{"t": int(last_ts) + 300, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}]

    _fn.started = started
    return _fn


def test_a_slow_delta_would_block_without_the_ceiling():
    """CONTROL — the fake really is slow, so the ceiling test below cannot pass
    for the wrong reason."""
    fn = _slow_delta(1.0)
    t0 = time.perf_counter()
    fn("AAPL", "5", _RECENT)
    assert time.perf_counter() - t0 >= 0.9


def test_bounded_delta_returns_at_the_deadline(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow_delta(3.0))
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)

    t0 = time.perf_counter()
    completed = bars_fetch._bounded_delta("AAPL", "5", _RECENT, False)
    elapsed = time.perf_counter() - t0

    assert completed is False, "a 3 s provider must not report completion"
    assert elapsed < 1.0, f"request waited {elapsed:.2f}s past a 0.3s ceiling"


def test_the_job_keeps_running_and_still_persists_after_the_deadline(monkeypatch):
    """⭐ The write must land for the NEXT poll — a deadline costs latency, never
    the fetch. This is what makes the ceiling strictly better than blocking."""
    persisted = []
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow_delta(0.6))
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars",
                        lambda t, tf, rows, **k: persisted.append((t, tf, len(rows))))

    assert bars_fetch._bounded_delta("AAPL", "5", _RECENT, False) is False
    assert persisted == [], "nothing should have landed yet"
    time.sleep(1.2)
    assert persisted == [("AAPL", "5", 1)], "the shed job must still persist its rows"


def test_a_fast_delta_completes_inside_the_deadline(monkeypatch):
    """The common case is unchanged: a fast provider still yields a correct,
    fully-healed first paint."""
    monkeypatch.setattr(bars_fetch, "_delta_intraday",
                        lambda t, tf, lt: [{"t": lt + 300, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    assert bars_fetch._bounded_delta("AAPL", "5", _RECENT, False) is True


def test_no_capacity_sheds_immediately_instead_of_queueing(monkeypatch):
    """Under a scan storm the budget is spent; the request must answer from the
    local store at once rather than pile up."""
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow_delta(3.0))
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    drained = []
    while bars_fetch._bg_delta_sem.acquire(blocking=False):
        drained.append(1)
    try:
        t0 = time.perf_counter()
        assert bars_fetch._bounded_delta("AAPL", "5", _RECENT, False) is False
        assert time.perf_counter() - t0 < 0.1, "a shed request must not wait at all"
    finally:
        for _ in drained:
            bars_fetch._bg_delta_sem.release()


def test_the_capacity_bound_is_released_so_it_cannot_leak(monkeypatch):
    """A semaphore that leaks a slot per shed request would silently disable the
    heal path after a few dozen cold symbols."""
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow_delta(0.2))
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    for _ in range(5):
        bars_fetch._bounded_delta("AAPL", "5", _RECENT, False)
    time.sleep(0.6)
    free = []
    while bars_fetch._bg_delta_sem.acquire(blocking=False):
        free.append(1)
    for _ in free:
        bars_fetch._bg_delta_sem.release()
    assert len(free) >= 2, f"slots leaked — only {len(free)} free"


def test_a_raising_provider_still_releases_and_reports_completion(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _boom)
    assert bars_fetch._bounded_delta("AAPL", "5", _RECENT, False) is True


# ── the deep / custom-timeframe door into the same defect ────────────────────

def test_the_deep_fetch_is_bounded_too(monkeypatch):
    """⛔ `_is_deep_request` is True at >= 1200 bars, and `_customBaseBars` is a flat
    5000 — so EVERY custom-timeframe first paint (2m, 45m, 4h) is classified as a
    deep backfill and used to take a bare `_fetch_intraday` on the request thread.
    That is the 16-second path again, by a different door."""
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 0.3)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday",
                        lambda t, tf, n: (time.sleep(3.0), [])[1])
    t0 = time.perf_counter()
    assert bars_fetch._bounded_fetch_intraday("AAPL", "1", 5000) is False
    assert time.perf_counter() - t0 < 1.0


def test_the_deep_ceiling_is_longer_than_the_delta_ceiling():
    """⭐ A pan is an EXPLICIT ask for deep history, so it keeps a longer budget
    than a routine tail top-up — but both stay under the edge's 8 s abort, which is
    what keeps the double-origin path unreachable."""
    assert bars_fetch._DEEP_DEADLINE_SECONDS > bars_fetch._REQUEST_DEADLINE_SECONDS
    assert bars_fetch._DEEP_DEADLINE_SECONDS < 8.0
    assert bars_fetch._REQUEST_DEADLINE_SECONDS < 8.0


def test_a_shed_deep_fetch_still_persists_and_marks_history_complete(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 0.2)
    persisted, marked = [], []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday",
                        lambda t, tf, n: (time.sleep(0.5),
                                          [{"t": _RECENT, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])[1])
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars",
                        lambda t, tf, rows, **k: persisted.append(t))
    monkeypatch.setattr(bars_fetch, "_mark_history_complete",
                        lambda t, tf: marked.append(t))
    assert bars_fetch._bounded_fetch_intraday("AAPL", "5", 5000) is False
    time.sleep(0.9)
    assert persisted == ["AAPL"] and marked == ["AAPL"]
