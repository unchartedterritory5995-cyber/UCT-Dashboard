"""Tiny in-process PNG cache + single-flight for /chart.

Why: members pile onto the same names at the same moments (NVDA after the
close, SPY at the open). A finished chart is good for a short while — the
daily bar only changes on a new session close, an intraday bar every few
minutes — so the second request for the same (symbol, timeframe) inside the
TTL is answered instantly, and N simultaneous requests share ONE render.

Single process, single dict: the web pod is one uvicorn process (see the
launch-hardening notes in CLAUDE.md). No eviction beyond TTL; the working set
is bounded by "tickers members asked for in the last minute".
"""
from __future__ import annotations

import threading
import time
from typing import Callable

# seconds a finished chart is served without re-rendering
_TTL = {"D": 45, "W": 45, "M": 45}
_TTL_INTRADAY = 20

_lock = threading.Lock()
_entries: dict[str, tuple[float, bytes, str]] = {}      # key → (expires_at, png, filename)
_inflight: dict[str, "threading.Event"] = {}
_results: dict[str, object] = {}


def ttl_for(tf: str) -> int:
    return _TTL.get(tf, _TTL_INTRADAY)


def clear() -> None:
    with _lock:
        _entries.clear()
        _inflight.clear()
        _results.clear()


def get(key: str, *, now: Callable[[], float] = time.monotonic):
    """(png, filename) if cached and fresh, else None."""
    with _lock:
        hit = _entries.get(key)
        if not hit:
            return None
        expires, png, filename = hit
        if now() >= expires:
            _entries.pop(key, None)
            return None
        return png, filename


def put(key: str, png: bytes, filename: str, *, ttl_s: int, now: Callable[[], float] = time.monotonic) -> None:
    with _lock:
        _entries[key] = (now() + ttl_s, png, filename)


def single_flight(key: str, producer: Callable[[], object], *, ttl_s: int,
                  cache_value: Callable[[object], tuple | None] | None = None,
                  wait_s: float = 75.0):
    """Run `producer` once per key at a time. Concurrent callers for the same
    key wait for the leader's result instead of producing again. The leader's
    result is cached when `cache_value(result)` yields a (png, filename) pair
    (default: the result itself when it is not None). A producer that raises
    releases the waiters with None and caches nothing."""
    cache_value = cache_value or (lambda r: r if r is not None else None)
    with _lock:
        ev = _inflight.get(key)
        if ev is None:
            ev = threading.Event()
            _inflight[key] = ev
            leader = True
        else:
            leader = False
    if not leader:
        ev.wait(wait_s)
        with _lock:
            return _results.get(key)
    result = None
    try:
        result = producer()
        cv = cache_value(result)
        if cv is not None:
            png, filename = cv
            put(key, png, filename, ttl_s=ttl_s)
        return result
    finally:
        with _lock:
            _results[key] = result
            _inflight.pop(key, None)
        ev.set()
        # Waiters read _results right after the event; drop it a moment later
        # so a stale failure never answers a future caller.
        threading.Timer(2.0, lambda: _results.pop(key, None)).start()
