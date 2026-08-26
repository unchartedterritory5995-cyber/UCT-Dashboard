"""What members keep asking for, so the render happens BEFORE they ask.

A chart costs ~2.4 s of a shared Chromium; a cache hit costs nothing. The PNG
cache already collapses repeats inside its TTL, but the moment an entry expires
the next member pays full price again - and in a 750-member server the same
handful of names (SPY, NVDA, the day's movers) get asked over and over, so that
full price is paid again and again for a picture we could have had ready.

This is the demand-driven half of the answer: every chart request records its
(request, prefs) under the same key the PNG cache uses, and a scheduler job
re-renders the ones that are both RECENT and near expiry. Nothing here decides
what a chart looks like - it hands back the exact ChartRequest that was served,
so a warmed chart is the same bytes the member would have got.

⛔ Deliberately NOT a second bars prewarmer. The dashboard already owns keeping
the bars store fresh universe-wide; this only re-runs charts members actually
asked for, and re-running one happens to freshen that symbol's bars as a side
effect of the normal path.

Bounded on purpose: `_MAX_KEYS` entries, and a key that nobody has asked for in
`_RECENT_S` stops being warmed. The working set is "what the server is talking
about", which is small.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Callable

_MAX_KEYS = int(os.environ.get("DISCORD_CHART_HOTSET_MAX", "24"))
# A key nobody has asked for in this long is not hot any more.
_RECENT_S = float(os.environ.get("DISCORD_CHART_HOTSET_RECENT_S", "3600"))
# Re-render once an entry is this far through its TTL, so the next asker still
# finds a fresh one instead of paying for the render themselves.
REFRESH_AT = float(os.environ.get("DISCORD_CHART_HOTSET_REFRESH_AT", "0.7"))

_lock = threading.Lock()
# key → (last_request_ts, hits, req, prefs, ttl_s)
_seen: dict[str, tuple] = {}


def record(key: str, req, prefs: dict, ttl_s: int, *, now: Callable[[], float] = time.monotonic) -> None:
    """Note that a member asked for this chart."""
    if not key:
        return
    t = now()
    with _lock:
        prev = _seen.get(key)
        hits = (prev[1] + 1) if prev else 1
        _seen[key] = (t, hits, req, dict(prefs or {}), int(ttl_s))
        if len(_seen) > _MAX_KEYS:
            # drop the coldest: fewest hits, then oldest ask
            for k in sorted(_seen, key=lambda k: (_seen[k][1], _seen[k][0]))[: len(_seen) - _MAX_KEYS]:
                _seen.pop(k, None)


def due(cache_age: Callable[[str], float | None], *, limit: int = 8,
        now: Callable[[], float] = time.monotonic) -> list[tuple]:
    """[(key, req, prefs)] worth re-rendering now: asked for recently, and either
    already gone from the cache or far enough through their TTL that the next
    member would otherwise pay for the render. Hottest first.

    `cache_age(key)` returns the entry's age in seconds, or None if it is not
    cached - so this module never has to know how the cache stores anything."""
    t = now()
    out = []
    with _lock:
        items = list(_seen.items())
    for key, (last, hits, req, prefs, ttl_s) in items:
        if t - last > _RECENT_S:
            continue
        age = cache_age(key)
        if age is not None and age < ttl_s * REFRESH_AT:
            continue                      # still fresh enough; leave it alone
        out.append((hits, key, req, prefs))
    out.sort(key=lambda r: -r[0])
    return [(k, rq, p) for _, k, rq, p in out[:limit]]


def snapshot() -> list[tuple]:
    """(key, hits, age_s) for diagnostics."""
    t = time.monotonic()
    with _lock:
        return sorted(((k, v[1], round(t - v[0], 1)) for k, v in _seen.items()), key=lambda r: -r[1])


def clear_for_tests() -> None:
    with _lock:
        _seen.clear()
