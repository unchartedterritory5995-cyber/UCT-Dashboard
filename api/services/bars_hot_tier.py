"""In-memory hot tier RAM cache for the top 500 most-accessed tickers.

Bypasses disk + SQLite. Capacity is fixed; LRU eviction. Reads are pure dict
lookups (~1us). Writes promote the key to most-recently-used.

Hot set definition: UCT20 ∪ watchlists ∪ candidates ∪ theme core ∪ LRU.
P5-9 implements warm-on-startup; this module is pure data structure.
"""
import threading
from collections import OrderedDict
from typing import Optional

_CAPACITY = 500
_lock = threading.RLock()
_cache: OrderedDict = OrderedDict()


def _key(ticker: str, tf: str, bars: int) -> tuple:
    return (str(ticker).upper(), tf, int(bars))


def _reset():
    """Test helper."""
    with _lock:
        _cache.clear()


def get(ticker: str, tf: str, bars: int) -> Optional[dict]:
    k = _key(ticker, tf, bars)
    with _lock:
        if k not in _cache:
            return None
        _cache.move_to_end(k)
        return _cache[k]


def set(ticker: str, tf: str, bars: int, payload: dict) -> None:
    k = _key(ticker, tf, bars)
    with _lock:
        if k in _cache:
            _cache.move_to_end(k)
        _cache[k] = payload
        if len(_cache) > _CAPACITY:
            _cache.popitem(last=False)  # evict LRU


def clear() -> None:
    with _lock:
        _cache.clear()


def size() -> int:
    with _lock:
        return len(_cache)


def keys() -> list[tuple]:
    with _lock:
        return list(_cache.keys())
