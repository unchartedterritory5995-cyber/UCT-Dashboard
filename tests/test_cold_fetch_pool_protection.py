"""Pool protection for truly-cold provider fetches (the HAR-diagnosed outage).

A member's HAR (2026-08-19) showed a fresh browser scanning obscure tickers: 15 cold
names each triggered a ~20s provider fetch, those held threadpool workers, and 664 WARM
charts (plus a /api/watchlists) queued behind them at 5-20s. `_cold_fetch_sem` caps how
many cold fetches run at once; when full, a cold request SHEDS (fast 503+Retry-After)
instead of piling on another 20s hold. These pin that behavior.
"""
from __future__ import annotations

import pytest
from api.services import bars_fetch


def _cold_store(monkeypatch):
    """Truly-cold ticker: nothing in mem/sqlite/disk, this request is the fetcher."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: [])
    monkeypatch.setattr(bars_fetch.disk_cache, "get", lambda s, tf, n: None)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_inflight", {})


def _drain(sem):
    """Acquire every slot so the next cold fetch must shed. Returns how many taken."""
    n = 0
    while sem.acquire(blocking=False):
        n += 1
    return n


def test_cold_fetch_SHEDS_when_pool_is_full(monkeypatch):
    _cold_store(monkeypatch)
    calls = {"fetch": 0}
    monkeypatch.setattr(bars_fetch, "_fetch_daily",
                        lambda *a, **k: calls.__setitem__("fetch", calls["fetch"] + 1) or [])
    taken = _drain(bars_fetch._cold_fetch_sem)   # exhaust the cap
    try:
        resp = bars_fetch._get_bars_inner("ZSQR", "D", 300)
    finally:
        for _ in range(taken):
            bars_fetch._cold_fetch_sem.release()
    assert resp.status_code == 503, "a shed cold fetch must return 503 (warming), not hang"
    assert resp.headers.get("Retry-After") == "3", "client must be told to re-poll fast"
    assert calls["fetch"] == 0, "SHED must NOT call the 20s provider fetch"
    assert bars_fetch.get_serve_layer() == "cold-shed"


def test_cold_fetch_RUNS_when_a_slot_is_free(monkeypatch):
    _cold_store(monkeypatch)
    calls = {"fetch": 0}
    monkeypatch.setattr(bars_fetch, "_fetch_daily",
                        lambda *a, **k: calls.__setitem__("fetch", calls["fetch"] + 1) or [])
    # a slot is available (pool not drained) → the fetch runs
    bars_fetch._get_bars_inner("ZSQR", "D", 300)
    assert calls["fetch"] == 1, "with a free slot the cold ticker fetches normally"


def test_the_slot_is_RELEASED_after_a_fetch(monkeypatch):
    """A fetch must return its slot so the cap doesn't leak to zero over time."""
    _cold_store(monkeypatch)
    monkeypatch.setattr(bars_fetch, "_fetch_daily", lambda *a, **k: [])
    before = bars_fetch._cold_fetch_sem._value
    bars_fetch._get_bars_inner("ZSQR", "D", 300)
    after = bars_fetch._cold_fetch_sem._value
    assert after == before, "the cold-fetch slot must be released after the fetch"


def test_a_WARM_ticker_never_touches_the_cold_cap(monkeypatch):
    """A ticker WITH stored rows takes the delta path, not the cold full-fetch — it must
    not consume a cold slot even when the cap is fully drained."""
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: 20260818)
    rows = [(20260818, 1.0, 1.1, 0.9, 1.05, 100)]
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: rows)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", lambda r, tf, t=None: [{"t": 1}])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf: True)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_daily", lambda tf, ts: True)   # force Layer 4
    monkeypatch.setattr(bars_fetch, "_daily_deblockable", lambda tf, ts: False)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda s, ts: [])
    taken = _drain(bars_fetch._cold_fetch_sem)   # cold cap fully drained
    try:
        resp = bars_fetch._get_bars_inner("AAPL", "D", 300)
    finally:
        for _ in range(taken):
            bars_fetch._cold_fetch_sem.release()
    assert resp.status_code == 200, "a warm/delta ticker must serve normally even when the cold cap is full"
