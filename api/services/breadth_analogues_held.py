"""READ ONLY: the breadth analogues (ANLG, "days like today") as this server already holds them.

The ANLG route (`GET /api/breadth-monitor/analogues?top_n=N`) answers `breadth_analogues.find_analogues(top_n=N)`, which
answers from the module's own cache (one entry per `top_n`, `_CACHE_TTL` six hours) and, on a miss or an expired entry,
works the answer out on the caller's thread: a read of up to 500 sessions of breadth history and a similarity pass over
them. A reader that must never cause that work (the UCT Agent's `market.analogs` data kind, MD-1 §4.22) reads through
`held_analogues()` instead: the entry with the most matches the module holds (the search is identical up to the final
`top_n` cut, as the module says, so its first N rows are the answer for N), with the time it was worked out, or nothing.
It never reads the breadth store, never works anything out and never writes the cache.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives
`find_analogues` itself over invented breadth rows and checks this reader then gives exactly what the route served, and
nothing before.
"""
from __future__ import annotations

import time
from typing import Optional


def ttl_s() -> float:
    """How long the route serves an entry before it works the answer out again (`breadth_analogues._CACHE_TTL`)."""
    from api.services import breadth_analogues as svc
    return float(svc._CACHE_TTL)


def held_analogues() -> tuple[Optional[dict], Optional[float], str]:
    """READ ONLY: `(answer, built_at, how)`; `answer` is the held entry with the most matches (`top_n` beside it), `built_at`
    the unix time it was worked out, `how` `held` (inside the route's six hours), `expired` (older: the route would work it
    out again) or `not_held`. Never works anything out."""
    from api.services import breadth_analogues as svc
    held = [(n, e) for n, e in list(svc._cache.items())
            if isinstance(n, int) and isinstance(e, dict) and isinstance(e.get("data"), dict)]
    if not held:
        return None, None, "not_held"
    top_n, entry = max(held, key=lambda ne: (ne[0], ne[1].get("ts") or 0))
    built = entry.get("ts") if isinstance(entry.get("ts"), (int, float)) else None
    answer = {**entry["data"], "top_n": top_n}
    fresh = built is not None and (time.time() - built) < ttl_s()
    return answer, built, ("held" if fresh else "expired")
