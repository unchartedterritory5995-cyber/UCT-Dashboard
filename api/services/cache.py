import threading
import time
from collections import OrderedDict
from typing import Any

# DEFAULT LRU cap for the shared app singleton. 500 → 1000 (2026-07-02 scale
# pass): the journal holdings list adds ~60 small `bars_{T}_D_30` keys per user
# page-load, which at launch scale churned evictions against the hot
# news/snapshot/analyst/movers keys long before their TTLs (live-prices already
# moved to its own dedicated instance).
# Kept bounded because bars payloads can be MB-scale — raise further only with
# a pod-memory check, or give bars its own size-aware cache.
#
# ⚠️ THIS IS A DEFAULT, NOT A CEILING ON EVERY INSTANCE. It used to be read
# directly inside `set()`, which made it a module-wide constant that silently
# capped the "DEDICATED" `live_prices.cache` too — the instance that exists
# specifically to escape LRU pressure. Above ~970 distinct tickers that cache
# thrashed permanently (31.7% miss / ~3.1k upstream fetches per 2s poll round at
# 200 users × 50 tickers), which funnels into `live_prices._MASSIVE_SEM` and
# reproduces the launch-day 524 from a different direction. An instance whose
# working set is a known, derivable quantity now states its OWN bound; raising
# this default would instead have changed every other cache's memory profile.
_MAX_SIZE = 1000


class TTLCache:
    """Thread-safe TTL cache backed by OrderedDict.

    The lock is load-bearing: this singleton is hammered by /api/bars
    handlers (FastAPI sync route → anyio threadpool) AND by background
    fetch threads spawned from the stale-while-revalidate path. Without
    serialization, the OrderedDict ops below race in ways that surface
    as bare `Internal Server Error` 500s under low concurrency:
      • `move_to_end` / `popitem(last=False)` / `del self._store[key]`
        can hit `KeyError` if another thread mutates between the check
        and the op.
      • The `while len > _MAX_SIZE: popitem` eviction loop can call
        popitem on an emptied dict.
    These KeyErrors bubble up past the bars router's try/except
    boundary in obscure ways (response.headers assignment on a
    half-constructed object) and Starlette returns the default plain
    "Internal Server Error" text. An RLock here removes the entire
    failure mode."""

    def __init__(self, max_size: int | None = None):
        """`max_size` bounds THIS instance's LRU.

        Defaults to the shared `_MAX_SIZE`. Pass an explicit bound when the
        instance's working set is a known quantity that the app-wide default
        does not describe — see `api/routers/live_prices.py`, whose per-ticker
        key space is the tradable universe, not 1,000.
        """
        if max_size is not None and max_size < 1:
            raise ValueError(f"max_size must be >= 1, got {max_size!r}")
        self._max_size: int = _MAX_SIZE if max_size is None else int(max_size)
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock = threading.RLock()

    @property
    def max_size(self) -> int:
        """This instance's LRU bound. Read it — never re-derive it."""
        return self._max_size

    def __len__(self) -> int:
        """Live entry count, expired-but-not-yet-reaped included.

        Exists so a capacity rail can READ occupancy off the cache instead of
        re-deriving it from a private attribute (the repo's most repeated
        defect: a second authority over one value).
        """
        with self._lock:
            return len(self._store)

    def get(self, key: str) -> Any:
        with self._lock:
            if key not in self._store:
                return None
            value, expires_at = self._store[key]
            if time.time() > expires_at:
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (value, time.time() + ttl)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def invalidate(self, key: str) -> None:
        """Remove a key from the cache immediately."""
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()

    def keys_with_prefix(self, prefix: str) -> list[str]:
        """Snapshot of currently-cached (non-expired-by-clock-only) keys starting
        with ``prefix``. Read-only; used to sample WARM entries (e.g. the
        fundamentals monitor prefers checking tickers users are actually viewing,
        which are free cache hits, over cold long-tail fetches)."""
        with self._lock:
            return [k for k in self._store if k.startswith(prefix)]

    def items_with_expiry(self) -> list[tuple[str, Any, float]]:
        """Snapshot of live entries as ``(key, value, expires_at)``.

        `expires_at` is an ABSOLUTE unix time, which is what makes a durable
        snapshot correct rather than merely plausible: `api/services/
        cache_snapshot.py` restores each entry with its REMAINING ttl, so a
        value's lifetime is unchanged by a pod restart — it expires at the same
        wall-clock instant it would have on the pod that computed it.

        Reading it through this method (rather than `cache._store`) keeps the
        expiry in ONE authority. A caller that recomputed "when does this
        expire" from its own clock would drift from the value `get()` enforces.

        Expired-but-unreaped entries are filtered here, so a caller never has to
        re-implement the staleness rule `get()` already owns.
        """
        now = time.time()
        with self._lock:
            return [
                (k, v, exp) for k, (v, exp) in self._store.items() if exp > now
            ]

    def delete_prefix(self, prefix: str) -> int:
        """Remove every key starting with ``prefix``. Returns the count.

        Used by the refresh-bars admin endpoint to wipe every cached
        bars payload for a ticker+tf regardless of the requested
        bars_count (cache keys are ``bars_{TICKER}_{tf}_{count}``, and
        we want to drop all variants in one call)."""
        with self._lock:
            keys = [k for k in self._store if k.startswith(prefix)]
            for k in keys:
                self._store.pop(k, None)
            return len(keys)


# Singleton used across all services
cache = TTLCache()
