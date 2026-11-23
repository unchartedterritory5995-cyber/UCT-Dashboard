"""READ ONLY: one stock's factor exposure (FCTX) as this server already holds it.

`factor_exposure.get_factor_exposure()` first makes sure the session's fund set is held (it READS the stored closes of
up to seven funds and their alternatives when it is not), then works the stock out on the request when nothing is held
for that fund set. A reader that must never cause that work (the UCT Agent's `stock.factorExposure` data kind, MD-1
§4.19) reads through `held_exposure()` instead: the answer the service holds for the stock, exactly as the route served
it when it was worked out, or nothing. It never reads the fund set, never builds, never reads a price and never writes
anything: not even the service's least-recently-asked order moves.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
hold (`factor_exposure._cache`, under the service's own lock). A rail drives the service itself over invented bars and
reads its answer back through this reader.
"""
from __future__ import annotations

from typing import Optional


def held_exposure(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one canonical symbol, without working anything out.

    `how` is `held` (status `ok`, or `not_held` when the service found no stored prices) or `not_held` (nothing is held
    for the symbol). The answer carries its own `session`: it may be an earlier session's. Never builds."""
    from api.services import factor_exposure as svc
    with svc._lock:
        entry = svc._cache.get(sym)
        answer = entry.get("answer") if isinstance(entry, dict) else None
    if not isinstance(answer, dict) or answer.get("status") not in ("ok", "not_held"):
        return None, "not_held"
    return answer, "held"
