"""TTL cache wrapper around bar_quarantine.quarantined_times.

Hot path concern from Plan 1 reviewer: bars_disk_cache.get() runs a SQLite
SELECT against quarantined_bars on every cache hit. With prewarm hitting 18K+
entries per pass, this adds load to auth.db.

This wrapper caches results 60s. bar_quarantine.add()/remove() invalidate.
"""
import time
import threading
from typing import Optional

from api.services import bar_quarantine

_TTL_SEC = 60
_lock = threading.RLock()
_cache: dict[tuple[str, str], tuple[set, float]] = {}


def _reset():
    """Test helper."""
    with _lock:
        _cache.clear()


def quarantined_times_cached(ticker: str, tf: str) -> set[int]:
    key = (str(ticker).upper(), tf)
    now = time.time()
    with _lock:
        entry = _cache.get(key)
        if entry and entry[1] > now:
            return entry[0]
    val = bar_quarantine.quarantined_times(ticker, tf)
    with _lock:
        _cache[key] = (val, now + _TTL_SEC)
    return val


def invalidate(ticker: str, tf: str) -> None:
    key = (str(ticker).upper(), tf)
    with _lock:
        _cache.pop(key, None)


def invalidate_all() -> None:
    _reset()
