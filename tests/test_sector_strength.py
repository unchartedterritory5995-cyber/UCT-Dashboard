"""Sector strength service — SPDR sector-ETF relative performance.

Root-cause fix for the voice tool's silent theme fallback: this is the real
computation (11 SPDR sector ETFs, period returns from daily bars), fully
testable with an injected fake bars source so no test hits the network.
"""

import threading
import time
from unittest.mock import patch

from api.services import sector_strength as ss


def _fake_bars_fetcher(closes_by_ticker: dict[str, list[float]]):
    """Build a bars_fetcher(ticker, n_bars) -> [{'c': close}, ...] for tests."""
    def _fetch(ticker: str, n_bars: int) -> list[dict]:
        closes = closes_by_ticker.get(ticker, [])
        return [{"c": c} for c in closes]
    return _fetch


# ── compute_sector_returns (pure, no network) ──────────────────────────────

def test_compute_sector_returns_ranks_strongest_first():
    # 2 sectors with enough bars for a 1-bar (Today) lookback.
    closes = {
        "XLK": [100.0, 110.0],   # +10%
        "XLF": [50.0, 49.0],     # -2%
    }
    fetcher = _fake_bars_fetcher(closes)
    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK", "Financials": "XLF"}):
        rows = ss.compute_sector_returns(1, bars_fetcher=fetcher)
    assert [r["sector"] for r in rows] == ["Technology", "Financials"]
    assert rows[0]["change_pct"] == 10.0
    assert rows[1]["change_pct"] == -2.0


def test_compute_sector_returns_honors_lookback_window():
    # 21-bar lookback needs 22 closes (ref bar + 21 bars later): 100 -> 121 = +21%.
    closes = {"XLK": [100.0] + [100.0] * 20 + [121.0]}
    fetcher = _fake_bars_fetcher(closes)
    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK"}):
        rows = ss.compute_sector_returns(21, bars_fetcher=fetcher)
    assert len(rows) == 1
    assert rows[0]["change_pct"] == 21.0


def test_compute_sector_returns_skips_insufficient_data():
    # Not enough bars for the requested lookback -> sector is dropped, not faked.
    closes = {"XLK": [100.0, 101.0]}  # only 2 bars, need 6 for a 5-bar window
    fetcher = _fake_bars_fetcher(closes)
    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK"}):
        rows = ss.compute_sector_returns(5, bars_fetcher=fetcher)
    assert rows == []


def test_compute_sector_returns_swallows_per_ticker_fetch_errors():
    def _flaky_fetch(ticker, n_bars):
        if ticker == "XLK":
            raise RuntimeError("network down")
        return [{"c": 10.0}, {"c": 11.0}]
    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK", "Financials": "XLF"}):
        rows = ss.compute_sector_returns(1, bars_fetcher=_flaky_fetch)
    assert len(rows) == 1
    assert rows[0]["sector"] == "Financials"


def test_compute_sector_returns_empty_when_all_sectors_fail():
    def _always_empty(ticker, n_bars):
        return []
    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK"}):
        rows = ss.compute_sector_returns(5, bars_fetcher=_always_empty)
    assert rows == []


# ── get_sector_strength (cached wrapper) ───────────────────────────────────

def test_get_sector_strength_uses_period_to_bars_mapping():
    with patch.object(ss, "compute_sector_returns") as m:
        m.return_value = [{"sector": "Technology", "ticker": "XLK", "change_pct": 1.0}]
        ss.cache.invalidate(f"sector_strength_{ss.PERIOD_TO_BARS['1M']}")
        ss.get_sector_strength(period="1M")
    m.assert_called_once_with(ss.PERIOD_TO_BARS["1M"])


def test_get_sector_strength_defaults_to_today():
    with patch.object(ss, "compute_sector_returns") as m:
        m.return_value = []
        ss.cache.invalidate(f"sector_strength_{ss.PERIOD_TO_BARS['Today']}")
        ss.get_sector_strength()
    m.assert_called_once_with(ss.PERIOD_TO_BARS["Today"])


def test_get_sector_strength_caches_nonempty_result():
    key = f"sector_strength_{ss.PERIOD_TO_BARS['3M']}"
    ss.cache.invalidate(key)
    with patch.object(ss, "compute_sector_returns") as m:
        m.return_value = [{"sector": "Energy", "ticker": "XLE", "change_pct": 5.0}]
        first = ss.get_sector_strength(period="3M")
        second = ss.get_sector_strength(period="3M")
    assert first == second
    m.assert_called_once()  # second call served from cache, not recomputed
    ss.cache.invalidate(key)


def test_get_sector_strength_does_not_cache_empty_result():
    key = f"sector_strength_{ss.PERIOD_TO_BARS['Today']}"
    ss.cache.invalidate(key)
    with patch.object(ss, "compute_sector_returns", return_value=[]):
        rows = ss.get_sector_strength(period="Today")
    assert rows == []
    assert ss.cache.get(key) is None


# ── parallel fetch (524-shape hardening) ───────────────────────────────────

def test_compute_sector_returns_fetches_etfs_in_parallel():
    # Two fetches must overlap in time. Each fetcher call waits on a 2-party
    # barrier: if fetches ran sequentially the first call would block forever
    # (bounded by the barrier timeout) — parallel execution releases both.
    barrier = threading.Barrier(2)

    def _barrier_fetch(ticker, n_bars):
        barrier.wait(timeout=5)  # raises BrokenBarrierError if sequential
        return [{"c": 100.0}, {"c": 101.0}]

    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK", "Financials": "XLF"}):
        rows = ss.compute_sector_returns(1, bars_fetcher=_barrier_fetch)
    assert len(rows) == 2  # both survived; and correctness holds under parallelism
    assert all(r["change_pct"] == 1.0 for r in rows)


def test_compute_sector_returns_parallel_one_raising_ticker_survives():
    barrier = threading.Barrier(2)

    def _flaky_parallel_fetch(ticker, n_bars):
        barrier.wait(timeout=5)
        if ticker == "XLK":
            raise RuntimeError("upstream 502")
        return [{"c": 50.0}, {"c": 55.0}]

    with patch.object(ss, "SECTOR_ETFS", {"Technology": "XLK", "Financials": "XLF"}):
        rows = ss.compute_sector_returns(1, bars_fetcher=_flaky_parallel_fetch)
    assert [r["sector"] for r in rows] == ["Financials"]
    assert rows[0]["change_pct"] == 10.0


# ── single-flight cache-miss guard ─────────────────────────────────────────

def test_get_sector_strength_single_flight_two_racing_threads_one_compute():
    key = f"sector_strength_{ss.PERIOD_TO_BARS['1W']}"
    ss.cache.invalidate(key)

    start = threading.Barrier(2)
    calls = []
    calls_lock = threading.Lock()

    def _counting_compute(n_bars):
        with calls_lock:
            calls.append(n_bars)
        time.sleep(0.25)  # hold the compute open so the race window is real
        return [{"sector": "Technology", "ticker": "XLK", "change_pct": 2.0}]

    results = [None, None]

    def _worker(i):
        start.wait(timeout=5)  # both threads hit the cold cache together
        results[i] = ss.get_sector_strength(period="1W")

    with patch.object(ss, "compute_sector_returns", side_effect=_counting_compute):
        t1 = threading.Thread(target=_worker, args=(0,))
        t2 = threading.Thread(target=_worker, args=(1,))
        t1.start(); t2.start()
        t1.join(timeout=10); t2.join(timeout=10)

    assert len(calls) == 1, f"expected single-flight (1 compute), got {len(calls)}"
    assert results[0] == results[1]
    assert results[0][0]["sector"] == "Technology"
    ss.cache.invalidate(key)
