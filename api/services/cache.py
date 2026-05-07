import time
from collections import OrderedDict
from typing import Any

_MAX_SIZE = 500  # Prevent unbounded memory growth


class TTLCache:
    def __init__(self):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()

    def get(self, key: str) -> Any:
        if key not in self._store:
            return None
        value, expires_at = self._store[key]
        if time.time() > expires_at:
            del self._store[key]
            return None
        # Move to end (most recently used)
        self._store.move_to_end(key)
        return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (value, time.time() + ttl)
        # Evict oldest entries if over max size
        while len(self._store) > _MAX_SIZE:
            self._store.popitem(last=False)

    def invalidate(self, key: str) -> None:
        """Remove a key from the cache immediately."""
        self._store.pop(key, None)

    def delete_prefix(self, prefix: str) -> int:
        """Remove every key starting with ``prefix``. Returns the count.

        Used by the refresh-bars admin endpoint to wipe every cached
        bars payload for a ticker+tf regardless of the requested
        bars_count (cache keys are ``bars_{TICKER}_{tf}_{count}``, and
        we want to drop all variants in one call)."""
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            self._store.pop(k, None)
        return len(keys)


# Singleton used across all services
cache = TTLCache()
