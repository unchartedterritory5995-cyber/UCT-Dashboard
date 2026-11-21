"""READ ONLY: the Treasury auctions answer this server already holds.

`treasury_auctions.get_auctions()` starts the service's one background build (two requests to the Treasury's Fiscal
Data service) whenever nothing is held or a refresh is due. A reader that must never start that work (the UCT Agent's
`rates.auctions` data kind, MD-1 §4.18) reads through `held_auctions()` instead: the answer the service holds (in
memory, or the copy on this server's disk, looked for once per process), shaped as the route serves it, or nothing.
It never builds, never asks the publisher and never writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
hold (`treasury_auctions._held`, a `held_build.HeldBuild`) through that hold's read-only `peek()`; a rail drives the
service itself over an invented publisher and reads its answer back through this reader, so a hold that drifted fails
it.
"""
from __future__ import annotations

from typing import Optional


def held_auctions() -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` without starting a build or asking the publisher.

    `how` is `held` (the answer the service holds, as `get_auctions()` would serve it: the hold's version stamp left
    out, the last failed look kept as `check`) or `not_held` (nothing is held, or what is held is not an `ok` answer).
    Never builds."""
    from api.services import treasury_auctions as svc
    got = svc._held.peek()
    if not isinstance(got, dict) or got.get("status") != "ok":
        return None, "not_held"
    return {k: v for k, v in got.items() if k != "v"}, "held"
