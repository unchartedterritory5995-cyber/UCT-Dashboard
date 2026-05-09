"""WS chaos tests — exercise edge cases of the real-time candle engine.

These tests don't run network IO. They drive realtime_candle.apply_tick
directly with synthetic tick sequences to verify the state machine handles:
  - Burst of many ticks within a single bar
  - Period boundary in-flight (last tick of one bar, first tick of next)
  - Concurrent threads pushing ticks (no state corruption)
  - Out-of-order arrival
  - Anomaly rejection
"""
import threading
import pytest
from api.services import realtime_candle as rc


@pytest.fixture(autouse=True)
def reset():
    rc._reset()
    yield
    rc._reset()


def test_tick_replay_burst():
    """100 ticks across a 1-min window — final candle has correct OHLC + total volume."""
    base = 1715080800
    rc.apply_tick("QQQ", price=700.0, ts=base, size=10, tf="1")
    high = 700.0
    low = 700.0
    last_price = 700.0
    total_vol = 10
    for i in range(1, 60):
        # Stay within ±2% deviation so sanity check accepts
        price = 700.0 + ((i % 7) - 3) * 0.2  # ~$700 ± $0.6
        ts = base + i
        rc.apply_tick("QQQ", price=price, ts=ts, size=1, tf="1")
        high = max(high, price)
        low = min(low, price)
        last_price = price
        total_vol += 1
    cur = rc.get_current("QQQ", "1")
    assert cur is not None
    assert cur["o"] == 700.0
    assert cur["h"] == high
    assert cur["l"] == low
    assert cur["c"] == last_price
    assert cur["v"] == total_vol


def test_period_boundary_in_flight():
    """Tick at 09:59:59 then 10:00:00 — bar rolls correctly."""
    rc.apply_tick("QQQ", price=700.0, ts=1715085599, size=10, tf="1")
    closed = rc.apply_tick("QQQ", price=701.0, ts=1715085600, size=5, tf="1")
    assert len(closed) == 1
    assert closed[0]["c"] == 700.0
    cur = rc.get_current("QQQ", "1")
    assert cur is not None
    assert cur["o"] == 701.0
    assert cur["t"] == 1715085600


def test_concurrent_ticks_no_corruption():
    """Threaded ticks don't corrupt the candle (lock works)."""
    base = 1715080800
    NUM_THREADS = 4
    TICKS_PER_THREAD = 50

    def push(idx):
        for i in range(TICKS_PER_THREAD):
            # Stay within sanity bounds
            price = 700.0 + ((idx + i) % 5) * 0.1
            rc.apply_tick("QQQ", price=price, ts=base + i, size=1, tf="1")

    threads = [threading.Thread(target=push, args=(i,)) for i in range(NUM_THREADS)]
    for t in threads: t.start()
    for t in threads: t.join()

    cur = rc.get_current("QQQ", "1")
    assert cur is not None
    # Volume = total ticks accepted. With out-of-order drops, some are rejected.
    # Verify at minimum the last sequential thread's ticks all landed.
    assert cur["v"] >= TICKS_PER_THREAD  # sanity floor
    # H/L are always coherent (high >= low, both within range)
    assert cur["h"] >= cur["l"]
    assert 699.5 <= cur["l"] <= 700.5
    assert 699.5 <= cur["h"] <= 700.5


def test_old_tick_rejected_after_advance():
    """A tick older than the current candle's last_tick_ts is silently dropped."""
    rc.apply_tick("QQQ", 700.0, 1715080800, 10, "1")
    rc.apply_tick("QQQ", 702.0, 1715080810, 5, "1")
    # Old tick — should be rejected
    rc.apply_tick("QQQ", 600.0, 1715080805, 999, "1")  # 5s before last
    cur = rc.get_current("QQQ", "1")
    # Volume should NOT include the rejected tick
    assert cur["v"] == 15  # 10 + 5
    assert cur["c"] == 702.0


def test_anomaly_tick_rejected():
    """A 50% deviation tick is rejected (sanity check)."""
    rc.apply_tick("QQQ", 700.0, 1715080800, 10, "1")
    # 1050 = +50% from 700 — should be rejected
    rc.apply_tick("QQQ", 1050.0, 1715080801, 5, "1")
    cur = rc.get_current("QQQ", "1")
    assert cur["c"] == 700.0
    assert cur["h"] == 700.0
    assert cur["v"] == 10  # second tick rejected, no volume added


def test_multiple_period_boundaries_clean():
    """Three consecutive 1-min bars all close cleanly with proper OHLC."""
    base = 1715080800  # arbitrary minute boundary
    # Bar 1: 700 → 700.5 → 700.3
    rc.apply_tick("QQQ", 700.0, base, 10, "1")
    rc.apply_tick("QQQ", 700.5, base + 30, 5, "1")
    rc.apply_tick("QQQ", 700.3, base + 59, 3, "1")
    # Bar 2 starts: 700.4 → 700.8 → 700.6
    closed1 = rc.apply_tick("QQQ", 700.4, base + 60, 8, "1")
    rc.apply_tick("QQQ", 700.8, base + 90, 4, "1")
    rc.apply_tick("QQQ", 700.6, base + 119, 2, "1")
    # Bar 3 starts
    closed2 = rc.apply_tick("QQQ", 700.7, base + 120, 6, "1")

    assert len(closed1) == 1
    assert closed1[0]["o"] == 700.0
    assert closed1[0]["h"] == 700.5
    assert closed1[0]["l"] == 700.0
    assert closed1[0]["c"] == 700.3
    assert closed1[0]["v"] == 18

    assert len(closed2) == 1
    assert closed2[0]["o"] == 700.4
    assert closed2[0]["h"] == 700.8
    assert closed2[0]["l"] == 700.4
    assert closed2[0]["c"] == 700.6
    assert closed2[0]["v"] == 14

    cur = rc.get_current("QQQ", "1")
    assert cur["t"] == base + 120
    assert cur["o"] == 700.7
