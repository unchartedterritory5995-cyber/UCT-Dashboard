"""READ ONLY: one stock's analyst ratings and price targets (ANR) as this server already holds them.

`research.analyst_ratings.get_analyst_ratings()` answers through `analyst_grades.get_analyst_grades()`, which reads the
shared cache first and, on a miss, asks the vendor four times on the caller's thread (the consensus, the price target, the
recent rating actions and the rating trend). A reader that must never cause that work (the UCT Agent's `analyst.ratings`
data kind, MD-1 §4.21) reads through `held_ratings()` instead: the same cache entry the composer answers from
(`analyst_grades_<SYMBOL>`), shaped exactly as the route shapes it, or nothing. It never asks the vendor, never resolves
an entity and never writes anything.

What the composer holds, and what each is here:
  a payload            `held`: the route's own record (consensus, price target, recent actions, the outage flag)
  `{"_miss": True}`    with `_outage` False: the vendor answered for every leg and found no coverage (`held`, every
                       section None); with `_outage` True: the route answers 503 for it, so this is `failed`
  nothing              `not_held`
A fund is said as the route says it (`FUND_WHY` is the route's own sentence, pinned to it by a rail).

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives the composer itself
over invented legs and checks this reader then gives the route's own record, and nothing before.
"""
from __future__ import annotations

from typing import Optional

#: the ANR route's own reason for a fund (`api/routers/research.py` `_ANR_FUND_WHY`; a rail pins the two together)
FUND_WHY = "funds carry no sell-side analyst ratings or price targets"
_EMPTY_ACTIONS = {"items": [], "_meta": None}


def cache_key(sym: str) -> str:
    """The key `analyst_grades.get_analyst_grades` reads and writes (the canonical ticker, never the vendor's)."""
    return f"analyst_grades_{(sym or '').upper().strip()}"


def held_ratings(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(record, how)` for one stock, without asking the vendor. `how` is `held`, `fund` (the record carries the
    route's `reason`), `failed` (the composer holds an outage) or `not_held`. Never builds."""
    s = (sym or "").upper().strip()
    if not s:
        return None, "not_held"
    from api.services.ticker_search_index import fund_not_applicable
    na = fund_not_applicable(s, FUND_WHY)
    if na:
        return {"sym": s, "consensus": None, "price_target": None, "recent_actions": dict(_EMPTY_ACTIONS), **na}, "fund"
    from api.services import analyst_grades
    got = analyst_grades.cache.get(cache_key(s))
    if not isinstance(got, dict):
        return None, "not_held"
    if got.get("_miss"):
        if got.get("_outage"):
            return None, "failed"
        return {"sym": s, "consensus": None, "price_target": None, "recent_actions": dict(_EMPTY_ACTIONS),
                "outage": False}, "held"
    return {"sym": s, "consensus": got.get("consensus"), "price_target": got.get("price_target"),
            "recent_actions": got.get("recent_actions") or dict(_EMPTY_ACTIONS),
            "outage": bool(got.get("_outage"))}, "held"
