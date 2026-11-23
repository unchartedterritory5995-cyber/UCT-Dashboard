"""READ ONLY: one stock's statistics (STAT) as this server already holds them.

`stock_stats.get_stock_stats()` works a stock out on the request when nothing is held for the session (one read of the
stored daily bars, SPY's and the sector fund's closes, and MKTH's held answer, whose reader starts MKTH's own background
build when that is due). A reader that must never cause that work (the UCT Agent's `stock.stats` data kind, MD-1
§4.19) reads through `held_stats()` instead: the answer the service holds for the stock, exactly as the route served it
when it was worked out, or nothing. It never builds, never reads a price, never asks MKTH and never writes anything:
not even the service's least-recently-asked order moves.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
hold (`stock_stats._cache`, under the service's own lock). A rail drives the service itself over invented bars and
reads its answer back through this reader, so a hold that drifted fails it.
"""
from __future__ import annotations

from typing import Optional


def held_stats(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one canonical symbol, without working anything out.

    `how` is `held` (the answer the service holds: status `ok`, or `not_held` when the service found no stored prices
    for the stock) or `not_held` (nothing is held for the symbol). The answer carries its own `session`: it may be an
    earlier session's. Never builds."""
    from api.services import stock_stats as svc
    with svc._lock:
        entry = svc._cache.get(sym)
        answer = entry.get("answer") if isinstance(entry, dict) else None
    if not isinstance(answer, dict) or answer.get("status") not in ("ok", "not_held"):
        return None, "not_held"
    return answer, "held"
