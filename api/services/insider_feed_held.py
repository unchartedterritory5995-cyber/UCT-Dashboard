"""READ ONLY: the INS panel's market-wide insider purchases as this server already holds them.

The INS route (`GET /api/insider/feed?scope=market`) answers `insider.get_market_insider_buys()`, which answers from the
shared cache entry `insider_feed_market` and, on a miss, pages the vendor's newest Form 4 filings (up to
`insider._MARKET_MAX_PAGES` requests) on the caller's thread and writes the cache. A reader that must never cause that
work (the UCT Agent's `insider.market` data kind, MD-1 §4.22) reads through `held_market_buys()` instead: the same cache
entry, or nothing. It never asks the vendor and never writes anything.

The entry holds the route's own rows (largest dollar amount first, at most `insider._MARKET_CAP`). A list the service
wrote after every page failed is empty, exactly like a list with no purchase in the window: the entry does not say which,
and this reader does not guess.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives the service itself
over an invented vendor page and checks this reader then gives exactly what the route serves, and nothing before.
"""
from __future__ import annotations

from typing import Optional


def cache_key() -> str:
    """The key `insider.get_market_insider_buys` reads and writes."""
    from api.services import insider
    return insider._MARKET_FEED_KEY


def held_market_buys() -> tuple[Optional[list], str]:
    """READ ONLY: `(rows, how)`; `how` is `held` (the route's own rows) or `not_held` (nothing is held). Never pages the
    vendor and never writes the cache."""
    from api.services.cache import cache
    got = cache.get(cache_key())
    if not isinstance(got, list):
        return None, "not_held"
    return [dict(r) for r in got if isinstance(r, dict)], "held"
