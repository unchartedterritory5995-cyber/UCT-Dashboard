import threading
import time
from collections import OrderedDict
from typing import Any

_MAX_SIZE = 500  # Prevent unbounded memory growth


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

    def __init__(self):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock = threading.RLock()

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
            while len(self._store) > _MAX_SIZE:
                self._store.popitem(last=False)

    def invalidate(self, key: str) -> None:
        """Remove a key from the cache immediately."""
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()

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
