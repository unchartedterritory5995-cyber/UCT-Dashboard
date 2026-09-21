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
import io
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


# ── daily must NOT be shed ───────────────────────────────────────────────────

def _force_layer4(monkeypatch, tf, last_ts):
    """Stub the store so `_get_bars_inner` reaches Layer 4's delta branch."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, t: last_ts)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars",
                        lambda s, t, n: [(last_ts, 1.0, 1.1, 0.9, 1.05, 100)])
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda r, t, tk=None: [{"t": 1}])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, t, tk=None: True)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, t: True)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    # cold-stale + not deblockable -> falls past the stale-serve block into Layer 4
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda t, ts, now=None: True)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_daily", lambda t, ts, now=None: True)
    monkeypatch.setattr(bars_fetch, "_intraday_deblockable", lambda t, ts: False)
    monkeypatch.setattr(bars_fetch, "_daily_deblockable", lambda t, ts: False)
    monkeypatch.setattr(bars_fetch, "_inflight", {})


def test_daily_is_NOT_routed_through_the_ceiling(monkeypatch):
    """⛔ DO NOT REGRESS DAILY. The ceiling is safe on intraday only because the
    client fast-polls a behind-the-market intraday tail (1.5 s × 5). D/W/M poll at
    300 s, so a shed daily would hold a stale first paint for FIVE MINUTES — worse
    than the correct-but-slower blocking fetch it replaced. Daily was never the
    defect: the 16 s was measured on 5m and 1m, and daily is already instant
    (edge-cached history + the server-side today bar + BARS_DAILY_ASYNC_HEAL).

    Behavioural, not a source read: drive the real serve path and watch which
    delta runs."""
    seen = {"bounded": 0, "daily": 0}
    monkeypatch.setattr(bars_fetch, "_bounded_delta",
                        lambda *a, **k: seen.__setitem__("bounded", seen["bounded"] + 1) or True)
    monkeypatch.setattr(bars_fetch, "_delta_daily",
                        lambda t, lt: seen.__setitem__("daily", seen["daily"] + 1) or [])
    _force_layer4(monkeypatch, tf="D", last_ts=20260918)

    bars_fetch._get_bars_inner("AAPL", "D", 600)
    assert seen["daily"] == 1, "daily must still take its own blocking delta"
    assert seen["bounded"] == 0, "daily must not be shed at the intraday ceiling"


def test_intraday_IS_routed_through_the_ceiling(monkeypatch):
    """CONTROL for the test above — without it, deleting the intraday branch
    entirely would leave that test green."""
    seen = {"bounded": 0}
    monkeypatch.setattr(bars_fetch, "_bounded_delta",
                        lambda *a, **k: seen.__setitem__("bounded", seen["bounded"] + 1) or True)
    _force_layer4(monkeypatch, tf="5", last_ts=int(time.time()) - 400_000)

    bars_fetch._get_bars_inner("AAPL", "5", 600)
    assert seen["bounded"] == 1, "intraday must go through the ceiling"
