"""READ ONLY: one stock's UCT composite rating (RTG) as this server already holds it.

`research.ratings.get_ratings()` answers from the shared cache first and, on a miss, BUILDS the rating: one single-flight
walk of three vendor reads (fundamentals, ownership, a year of daily prices) on the caller's thread. A reader that must
never cause that work (the UCT Agent's `ratings` data kind, MD-1 §4.4 since v1.18) reads through `held_ratings()` instead:
the same cache entry `get_ratings()` answers from (`research_rat::<SYMBOL>`), or nothing. It never builds, never reads a
vendor and never writes anything. A fund is said as the route says it (the RTG route answers `not_applicable` for a fund
before it reads anything): `FUND_WHY` is the route's own sentence, pinned to it by a rail.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives `get_ratings()`
itself over invented legs and checks this reader then gives exactly what the route serves, and nothing before.
"""
from __future__ import annotations

from typing import Optional

#: the RTG route's own reason for a fund (`api/routers/research.py` `_RTG_FUND_WHY`; a rail pins the two together)
FUND_WHY = ("the UCT composite rates a company's earnings, growth, margins and value, "
            "which a fund does not have")


def cache_key(sym: str) -> str:
    """The key `research.ratings.get_ratings` reads and writes."""
    return f"research_rat::{(sym or '').upper().strip()}"


def held_ratings(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one stock, without starting a build. `how` is `held` (the route's own answer),
    `fund` (the route answers not applicable; `answer` carries its `reason`) or `not_held` (nothing is held). Never
    builds."""
    s = (sym or "").upper().strip()
    if not s:
        return None, "not_held"
    from api.services.ticker_search_index import fund_not_applicable
    na = fund_not_applicable(s, FUND_WHY)
    if na:
        return dict(na), "fund"
    from api.services.cache import cache
    got = cache.get(cache_key(s))
    if not isinstance(got, dict) or not got:
        return None, "not_held"
    return dict(got), "held"
