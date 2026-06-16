"""Async token-bucket rate limiter.

SnapTrade enforces a *partner-wide* rate limit (shared across every UCT
user, not per-account). A per-account semaphore can't protect it — many
users syncing at once would still burst past the partner ceiling. This
limiter is instantiated once in `snaptrade_client` and every outbound
call passes through it.

Token-bucket semantics:
  • `capacity` tokens of burst headroom.
  • refills at `rate` tokens/second.
  • `acquire(n)` consumes n tokens, sleeping until enough have refilled.

Correctness notes:
  • Token accounting happens under a lock, so concurrent callers can never
    over-consume — the issued rate is bounded regardless of contention.
  • Sleeping happens *outside* the lock, then the caller re-checks. This
    avoids serializing all waiters behind one held lock while still
    bounding the rate (a caller that wakes to find tokens already taken
    simply waits again).
  • `clock`/`sleep` are injectable so the behavior is unit-testable with a
    deterministic fake clock (no real wall-clock waits in tests).
"""

from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable


class AsyncRateLimiter:
    def __init__(
        self,
        rate: float,
        capacity: float | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        if rate <= 0:
            raise ValueError("rate must be > 0")
        cap = rate if capacity is None else capacity
        if cap <= 0:
            raise ValueError("capacity must be > 0")
        self._rate = float(rate)
        self._capacity = float(cap)
        self._clock = clock
        self._sleep = sleep
        self._tokens = float(cap)  # start full (allow an initial burst)
        self._last = clock()
        self._lock = asyncio.Lock()

    async def acquire(self, n: float = 1.0) -> None:
        """Block until `n` tokens are available, then consume them."""
        if n <= 0:
            return
        if n > self._capacity:
            raise ValueError(
                f"cannot acquire {n} tokens; capacity is {self._capacity}"
            )
        while True:
            async with self._lock:
                now = self._clock()
                # Refill for elapsed time (never above capacity).
                elapsed = max(0.0, now - self._last)
                self._tokens = min(
                    self._capacity, self._tokens + elapsed * self._rate
                )
                self._last = now
                if self._tokens >= n:
                    self._tokens -= n
                    return
                # Not enough yet — compute how long until the deficit refills.
                wait = (n - self._tokens) / self._rate
            # Sleep outside the lock so other callers can make progress, then
            # loop and re-check (tokens may have been taken meanwhile).
            await self._sleep(wait)

    @property
    def available_tokens(self) -> float:
        """Best-effort current token count (refilled to 'now'). For
        introspection/tests; not a reservation."""
        now = self._clock()
        elapsed = max(0.0, now - self._last)
        return min(self._capacity, self._tokens + elapsed * self._rate)
