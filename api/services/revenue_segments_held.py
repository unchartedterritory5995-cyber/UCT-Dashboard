"""READ ONLY: one stock's revenue by segment (SEG) as this server already holds it.

`revenue_segments.get_segments()` answers through `held_reads.KeyedHeld.get()`, which STARTS the one background build of a
(stock, period) when nothing is held or a refresh is due (two vendor reads), and with nothing held waits a few seconds on
it. A reader that must never cause that work (the UCT Agent's `company.segments` data kind, MD-1 §4.21) reads through
`held_segments()` instead: the same answer the route serves for one stock and one period, read with
`KeyedHeld.peek()`, which never creates a key and never starts a build, or nothing. It never asks the vendor and never
writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives the service itself
over invented vendor answers and checks this reader then gives the route's own answer, and nothing before.
"""
from __future__ import annotations

from typing import Optional


def held_segments(sym: str, period: str = "annual") -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one stock and one period (`annual` or `quarter`), without starting a build. `how` is
    `held` (the route's own answer, with the service's `check` beside it) or `not_held`. Never builds."""
    from api.services import revenue_segments as svc
    s = (sym or "").upper().strip()
    if not s or period not in svc.PERIODS:
        return None, "not_held"
    got = svc._held.peek((s, period))
    if not isinstance(got, dict) or got.get("status") != "ok":
        return None, "not_held"
    return dict(got), "held"
