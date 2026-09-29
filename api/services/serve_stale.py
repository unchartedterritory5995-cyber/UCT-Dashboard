"""Serve the last good payload instantly; refresh behind the user.

WHY THIS EXISTS
---------------
`cache.TTLCache` expires on a HARD clock: `get()` only does `move_to_end` for
LRU, it never extends `expires_at`. An entry therefore dies exactly `ttl`
seconds after it was WRITTEN, no matter how much traffic the surface has. So a
cache in front of an expensive multi-provider rebuild does not protect users —
it just decides WHICH user pays. Measured on prod 2026-07-31, polling
`/api/calendar` every 20s for 13 minutes:

    07:50:02   4.51s   <- cold
    08:00:18   7.97s   <- cold, exactly ~10 min later (TTL = 600s)
    (38 others) 0.12s

Raising the TTL only makes the stall rarer and the data staler; it cannot
remove it. The fix is to stop making a USER the one who rebuilds.

This is the same shape already proven in `engine.get_news()` ("stale-while-
revalidate so a user never blocks on the 2-4s rebuild") and on Options Flow,
factored out so the Calendar's two cold surfaces share one tested unit.

THE THREE RULES
---------------
1. **Bounded.** A stale payload is served only while it is younger than
   `max_age_seconds`. Past that we rebuild synchronously — correctness wins
   over speed, and a silently-failing refresh can never pin users to
   arbitrarily old data. (Options Flow lesson: never delete serve-stale —
   bound it.)
2. **Only GOOD payloads are remembered.** An error/empty rebuild must never
   become the value every user sees for the next window. The caller supplies
   `good()`; `get_news` does the same with its error placeholder.
3. **Single-flight.** Concurrent cold callers collapse onto ONE build, and at
   most one background refresh per key runs at a time. Without this, N
   concurrent cold clicks each fire their own full provider fan-out.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

_logger = logging.getLogger(__name__)


class ServeStale:
    """Per-key last-good-payload slots with single-flight refresh.

    Not a cache — it sits BESIDE the real TTL cache and only holds the most
    recent good value per key as a fallback for the moment the TTL lapses.
    """

    def __init__(self, name: str, max_age_seconds: float, max_keys: int = 256):
        self.name = name
        self.max_age = float(max_age_seconds)
        # Keys are caller-supplied (the enrichment slot is keyed by ?date=), so
        # both dicts are bounded — otherwise browsing/probing arbitrary dates
        # grows them forever. Same reason `_ENRICH_STATS` is bounded.
        self.max_keys = int(max_keys)
        self._slots: dict[str, tuple[Any, float]] = {}
        self._lock = threading.Lock()
        self._refreshing: set[str] = set()
        self._build_locks: dict[str, threading.Lock] = {}

    # ── slot state ────────────────────────────────────────────────────────────

    def remember(self, key: str, value: Any, *, at: float | None = None) -> None:
        """Hold `value` as `key`'s last good payload.

        `at` is when the payload was BUILT (unix time), for a caller restoring
        one it carried across a restart (TERM-070). The slot's age — and so the
        `max_age` bound — counts from that build, never from the restore: a
        deploy must not extend a payload's servable life by even a second.
        Omitted, it is now, which is every in-process caller's case."""
        with self._lock:
            self._slots[key] = (value, time.time() if at is None else float(at))
            self._prune_locked()

    def _prune_locked(self) -> None:
        """Drop the oldest slots, and any build lock nobody is holding.

        Caller must hold `self._lock`. A held lock is never dropped — evicting
        one mid-build would let a second thread build the same key concurrently,
        silently undoing single-flight."""
        if len(self._slots) > self.max_keys:
            for key in sorted(self._slots, key=lambda k: self._slots[k][1])[:-self.max_keys]:
                self._slots.pop(key, None)
        if len(self._build_locks) > self.max_keys:
            for key, lock in list(self._build_locks.items()):
                if len(self._build_locks) <= self.max_keys:
                    break
                if key not in self._slots and key not in self._refreshing and not lock.locked():
                    self._build_locks.pop(key, None)

    def peek(self, key: str) -> tuple[Any, float | None]:
        """(value, age_seconds), or (None, None) when nothing is remembered."""
        with self._lock:
            slot = self._slots.get(key)
        if slot is None:
            return None, None
        value, at = slot
        return value, time.time() - at

    def forget(self, key: str) -> None:
        with self._lock:
            self._slots.pop(key, None)

    def _build_lock(self, key: str) -> threading.Lock:
        with self._lock:
            lock = self._build_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._build_locks[key] = lock
                self._prune_locked()
            return lock

    # ── the serve path ────────────────────────────────────────────────────────

    def serve(
        self,
        key: str,
        *,
        fresh: Callable[[], Any],
        build: Callable[[], Any],
        good: Callable[[Any], bool],
    ) -> Any:
        """Fresh cache → return it. Else serve the last good payload and
        refresh behind the caller. Else build synchronously (single-flight).

        `build` is expected to write the real TTL cache itself, exactly as it
        did before this wrapper existed.
        """
        hit = fresh()
        if hit is not None:
            return hit

        value, age = self.peek(key)
        if value is not None and age is not None and age <= self.max_age:
            self._kick(key, build, good)
            return value

        # Nothing usable to serve — this caller has to build. Collapse a herd
        # onto one build so N cold clicks don't each fan out to every provider.
        with self._build_lock(key):
            hit = fresh()          # a racer may have finished while we queued
            if hit is not None:
                return hit
            # Re-check the slot too, not just the TTL cache: the winner of the
            # lock remembers its payload here, and we must not assume `build`
            # populates a cache `fresh` can see. Without this the waiters each
            # rebuild and the "single-flight" lock only SERIALISES the herd
            # instead of collapsing it.
            value, age = self.peek(key)
            if value is not None and age is not None and age <= self.max_age:
                return value
            built = build()
            if good(built):
                self.remember(key, built)
            return built

    def kick(self, key: str, *, build: Callable[[], Any],
             good: Callable[[Any], bool]) -> None:
        """Start one background refresh of `key` NOW, exactly as a stale serve
        would, and a no-op while one is already running (TERM-082, additive).

        For a caller that knows the answer just changed (a wire push
        invalidating `/api/earnings`) and must not wait for the next reader to
        notice. The slot is untouched: until the refresh lands, readers keep
        getting the remembered payload, marked stale, within `max_age`."""
        self._kick(key, build, good)

    def _kick(self, key: str, build: Callable[[], Any], good: Callable[[Any], bool]) -> None:
        """Refresh in the background — one at a time per key."""
        with self._lock:
            if key in self._refreshing:
                return
            self._refreshing.add(key)

        def _bg():
            try:
                built = build()
                if good(built):
                    self.remember(key, built)
            except Exception as exc:                      # never kill the thread silently
                _logger.warning("%s: background refresh of %s failed: %s",
                                self.name, key, exc)
            finally:
                with self._lock:
                    self._refreshing.discard(key)

        threading.Thread(target=_bg, daemon=True,
                         name=f"{self.name}-refresh").start()


# ── Which tier answered (TERM-082, PROD-C7) ──────────────────────────────────
#
# `ServeStale.serve` returns a value and says nothing about where it came from,
# so a served-stale payload is indistinguishable from a fresh one. PROD-C7
# requires staleness to be visible on the response. The labels are the ones
# `/api/bars` already emits on its `Server-Timing` header
# (`bars_fetch._mark_serve`) — "mem", "stale-swr", "fetch", "inflight-wait" —
# and CARD 16 already rules on `stale-swr`, so no new vocabulary is invented.

#: Served from the real TTL cache.
TIER_FRESH = "mem"
#: Served from the last-good slot while a refresh runs behind the caller.
TIER_STALE = "stale-swr"
#: Built synchronously by this caller (cold start, or the slot was too old).
TIER_BUILD = "fetch"
#: Waited on another caller's in-flight build and took its result.
TIER_WAIT = "inflight-wait"


def serve_with_tier(
    stale: ServeStale,
    key: str,
    *,
    fresh: Callable[[], Any],
    build: Callable[[], Any],
    good: Callable[[Any], bool],
) -> tuple[Any, str, float | None]:
    """`stale.serve(...)`, plus WHICH tier answered and the age of a stale
    answer: `(value, tier, stale_age_seconds)`.

    Observes the callbacks rather than changing `ServeStale`, so the ten
    existing consumers are untouched. `stale_age_seconds` is set only for
    `TIER_STALE` and is read from the slot the moment the TTL cache missed —
    before the background refresh can overwrite it."""
    caller = threading.get_ident()
    seen = {"fresh_calls": 0, "fresh_hit": False, "built": False, "age": None}

    def _fresh():
        seen["fresh_calls"] += 1
        value = fresh()
        if value is not None:
            seen["fresh_hit"] = True
        elif seen["fresh_calls"] == 1:
            _v, age = stale.peek(key)
            seen["age"] = age
        return value

    def _build():
        # The background refresh runs on its own thread; only a build on the
        # CALLER's thread means this request paid for it.
        if threading.get_ident() == caller:
            seen["built"] = True
        return build()

    value = stale.serve(key, fresh=_fresh, build=_build, good=good)
    if seen["built"]:
        return value, TIER_BUILD, None
    if seen["fresh_hit"]:
        return value, TIER_FRESH, None
    if seen["fresh_calls"] >= 2:
        # Queued on the build lock and took the winner's freshly remembered
        # payload — current, not stale.
        return value, TIER_WAIT, None
    return value, TIER_STALE, seen["age"]


def server_timing(name: str, tier: str, dur_ms: float,
                  stale_age_s: float | None = None) -> str:
    """The `Server-Timing` value, in `/api/bars`' exact shape:
    `<name>;desc="<tier>";dur=<ms>` plus a `stale-age;dur=<ms>` sub-metric
    when a stale payload answered (bars adds phase sub-metrics the same way)."""
    out = f'{name};desc="{tier}";dur={dur_ms:.1f}'
    if tier == TIER_STALE and stale_age_s is not None:
        out += f", stale-age;dur={stale_age_s * 1000.0:.0f}"
    return out
