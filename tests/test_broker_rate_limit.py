"""Tests for the SnapTrade global rate limiter (token bucket).

Uses a deterministic fake clock: virtual time only advances when the
limiter sleeps, so we can assert exact pacing without real wall-clock
waits.
"""

from __future__ import annotations

import asyncio

import pytest

from api.services.journal_two.broker.rate_limit import AsyncRateLimiter


class FakeClock:
    """Virtual monotonic clock. `sleep(dt)` advances time by dt."""

    def __init__(self):
        self.t = 0.0

    def now(self) -> float:
        return self.t

    async def sleep(self, dt: float) -> None:
        # Yield to the loop so other tasks can run, then advance time.
        await asyncio.sleep(0)
        self.t += max(0.0, dt)


def _mk(rate, capacity=None):
    clk = FakeClock()
    rl = AsyncRateLimiter(rate, capacity, clock=clk.now, sleep=clk.sleep)
    return rl, clk


@pytest.mark.asyncio
async def test_initial_burst_no_wait():
    rl, clk = _mk(rate=2.0, capacity=5.0)
    # Bucket starts full → 5 immediate acquires, zero virtual time elapsed.
    for _ in range(5):
        await rl.acquire(1)
    assert clk.now() == 0.0


@pytest.mark.asyncio
async def test_waits_after_drain():
    rl, clk = _mk(rate=2.0, capacity=2.0)  # 2 tokens/sec
    await rl.acquire(2)          # drain the bucket, no wait
    assert clk.now() == 0.0
    await rl.acquire(1)          # need 1 token → 0.5s at 2/sec
    assert clk.now() == pytest.approx(0.5, abs=1e-9)


@pytest.mark.asyncio
async def test_rate_bounded_under_concurrency():
    # capacity 1, rate 1/sec. 5 concurrent single-token acquires.
    # First is free (bucket full); remaining 4 each cost 1s → ~4s total.
    rl, clk = _mk(rate=1.0, capacity=1.0)

    async def one():
        await rl.acquire(1)

    await asyncio.gather(*(one() for _ in range(5)))
    assert clk.now() == pytest.approx(4.0, abs=1e-6)


@pytest.mark.asyncio
async def test_acquire_more_than_capacity_raises():
    rl, _ = _mk(rate=1.0, capacity=2.0)
    with pytest.raises(ValueError):
        await rl.acquire(3)


@pytest.mark.asyncio
async def test_acquire_zero_is_noop():
    rl, clk = _mk(rate=1.0, capacity=1.0)
    await rl.acquire(0)
    assert clk.now() == 0.0


def test_invalid_construction():
    with pytest.raises(ValueError):
        AsyncRateLimiter(0)
    with pytest.raises(ValueError):
        AsyncRateLimiter(1.0, 0)
