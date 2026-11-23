"""READ ONLY: one stock's volume footprint and gaps (VFP) as this server already holds them.

`volume_footprint.get_volume_footprint()` works a stock out on the request when nothing is held for the session (one
read of the stored daily bars and of the earnings dates the earnings page holds), and a held answer whose earnings
re-check is due is looked at again first. A reader that must never cause that work (the UCT Agent's
`stock.volumeFootprint` data kind, MD-1 §4.19) reads through `held_footprint()` instead: the answer the service holds
for the stock, exactly as the route served it when it was worked out, or nothing. It never builds, never reads a bar or
an earnings date and never writes anything: not even the service's least-recently-asked order moves.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
hold (`volume_footprint._cache`, under the service's own lock). A rail drives the service itself over invented bars and
reads its answer back through this reader.
"""
from __future__ import annotations

from typing import Optional


def held_footprint(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one canonical symbol, without working anything out.

    `how` is `held` (status `ok`, or `not_held` when the service found no stored prices) or `not_held` (nothing is held
    for the symbol). The answer carries its own `session`: it may be an earlier session's. Never builds."""
    from api.services import volume_footprint as svc
    with svc._lock:
        entry = svc._cache.get(sym)
        answer = entry.get("answer") if isinstance(entry, dict) else None
    if not isinstance(answer, dict) or answer.get("status") not in ("ok", "not_held"):
        return None, "not_held"
    return answer, "held"
