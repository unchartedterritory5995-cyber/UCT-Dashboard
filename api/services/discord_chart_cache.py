"""Tiny in-process PNG cache + single-flight for /chart.

Why: members pile onto the same names at the same moments (NVDA after the
close, SPY at the open). A finished chart is good for a short while — the
daily bar only changes on a new session close, an intraday bar every few
minutes — so the second request for the same (symbol, timeframe) inside the
TTL is answered instantly, and N simultaneous requests share ONE render.

Single process, single dict: the web pod is one uvicorn process (see the
launch-hardening notes in CLAUDE.md).

TTL is SESSION-AWARE. A render costs ~2 s of a shared Chromium; a cached hit
costs nothing, so the only question is how long a chart stays true:

  * regular hours - the last candle is moving. Short.
  * pre/post-market - the candle is parked but the orange Pre/Post chip tracks
    a live print. Short.
  * QUIET (weekends, and 20:00-04:00 ET when even the extended session is shut)
    - nothing on the image can change. A daily chart at 23:00 is byte-identical
    to the same chart at 02:00, and under the old flat 45 s every member asking
    overnight paid a fresh render for a picture we already had.

The image carries its own "as of" stamp, so serving a cached one is honest
rather than stale - but the stamp is why QUIET is 15 minutes and not an hour.

⚠️ A LONGER TTL NEEDS A BOUND. At ~250-400 KB a PNG, 15 minutes of a busy
channel is hundreds of megabytes on a small pod, so the cache now carries a
byte budget and evicts least-recently-USED first. Lengthening the TTL without
this trades latency for an OOM.
"""
from __future__ import annotations

import datetime as _dt
import os
import threading
import time
from typing import Callable
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

# seconds a finished chart is served without re-rendering, while the tape can move
# Measured 2026-08-26: a render is 2-8 s and a busy set can take longer than
# the OLD 45 s TTL, so a repeat of the very same request missed the cache and
# rendered again. The image carries its own "as of" stamp, so a two-minute-old
# daily chart is honest rather than stale.
_TTL = {"D": 120, "W": 120, "M": 120}
_TTL_INTRADAY = 60
# …and while nothing can move at all (see the module docstring)
_TTL_QUIET = int(os.environ.get("DISCORD_CHART_QUIET_TTL", "900"))
# Total PNG bytes held. ~250-400 KB each, so 96 MB is a few hundred charts.
_MAX_BYTES = int(os.environ.get("DISCORD_CHART_CACHE_BYTES", str(96 * 1024 * 1024)))

_lock = threading.Lock()
_entries: dict[str, tuple[float, bytes, str]] = {}      # key → (expires_at, png, filename)
_used: dict[str, float] = {}                            # key → last touch (LRU order)
_ttl_of: dict[str, int] = {}                            # key → the ttl it was stored with
_inflight: dict[str, "threading.Event"] = {}
_results: dict[str, object] = {}


def market_quiet(now_et: _dt.datetime | None = None) -> bool:
    """True when nothing on a chart can change: a weekend, or a weekday outside
    04:00-20:00 ET (the window the extended session actually trades in - the
    same 04:00 boundary `massive._detect_session` uses to open pre-market)."""
    now = now_et or _dt.datetime.now(_ET)
    if now.weekday() >= 5:
        return True
    hm = now.hour * 100 + now.minute
    return hm < 400 or hm >= 2000


def ttl_for(tf: str, now_et: _dt.datetime | None = None) -> int:
    if market_quiet(now_et):
        return _TTL_QUIET
    return _TTL.get(tf, _TTL_INTRADAY)


def clear() -> None:
    with _lock:
        _used.clear()
        _ttl_of.clear()
        _entries.clear()
        _inflight.clear()
        _results.clear()


def _evict_locked(now_v: float) -> None:
    """Drop expired entries, then least-recently-USED until inside the budget.
    Called with _lock held."""
    for k in [k for k, (exp, _, _) in _entries.items() if exp <= now_v]:
        _entries.pop(k, None)
        _used.pop(k, None)
        _ttl_of.pop(k, None)
    total = sum(len(png) for _, png, _ in _entries.values())
    if total <= _MAX_BYTES:
        return
    for k in sorted(_used, key=_used.get):                # oldest touch first
        entry = _entries.pop(k, None)
        _used.pop(k, None)
        _ttl_of.pop(k, None)
        if entry:
            total -= len(entry[1])
        if total <= _MAX_BYTES:
            return


def age_of(key: str, *, now: Callable[[], float] = time.monotonic) -> float | None:
    """Seconds since this entry was stored, or None if it is not cached. Lets a
    warmer decide what is going stale without knowing how the cache stores it."""
    with _lock:
        hit = _entries.get(key)
        if not hit:
            return None
        expires, png, _ = hit
        ttl = _ttl_of.get(key)
        if ttl is None:
            return 0.0
        return max(0.0, ttl - (expires - now()))


def cache_bytes() -> int:
    with _lock:
        return sum(len(png) for _, png, _ in _entries.values())


def get(key: str, *, now: Callable[[], float] = time.monotonic):
    """(png, filename) if cached and fresh, else None."""
    with _lock:
        hit = _entries.get(key)
        if not hit:
            return None
        expires, png, filename = hit
        if now() >= expires:
            _entries.pop(key, None)
            _used.pop(key, None)
            return None
        _used[key] = now()                      # a HIT is a use: LRU keeps what members ask for
        return png, filename


def put(key: str, png: bytes, filename: str, *, ttl_s: int, now: Callable[[], float] = time.monotonic) -> None:
    with _lock:
        _entries[key] = (now() + ttl_s, png, filename)
        _used[key] = now()
        _ttl_of[key] = int(ttl_s)
        _evict_locked(now())


def single_flight(key: str, producer: Callable[[], object], *, ttl_s,
                  cache_value: Callable[[object], tuple | None] | None = None,
                  wait_s: float = 75.0):
    """Run `producer` once per key at a time. Concurrent callers for the same
    key wait for the leader's result instead of producing again. The leader's
    result is cached when `cache_value(result)` yields a (png, filename) pair
    (default: the result itself when it is not None). A producer that raises
    releases the waiters with None and caches nothing.

    `ttl_s` is seconds, or a callable taking the produced result - some results
    are worth keeping for a session and some for a minute, and only the producer
    knows which of the two it just made."""
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
            put(key, png, filename, ttl_s=(ttl_s(result) if callable(ttl_s) else ttl_s))
        return result
    finally:
        with _lock:
            _results[key] = result
            _inflight.pop(key, None)
        ev.set()
        # Waiters read _results right after the event; drop it a moment later
        # so a stale failure never answers a future caller.
        threading.Timer(2.0, lambda: _results.pop(key, None)).start()
