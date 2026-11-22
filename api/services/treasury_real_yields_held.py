"""READ ONLY: the real yield block (TIPS) and the breakevens this server already holds.

`treasury_real_yields.get_real()` starts the service's one background build (requests to the Treasury's website)
whenever nothing is held or a refresh is due. A reader that must never start that work (the UCT Agent's
`rates.realYields` data kind, MD-1 §4.18) reads through `held_real()` instead: the block the RATES route serves, built
from the real figures the service holds and the nominal days `treasury_yields` holds, or nothing. It never builds,
never asks the Treasury and never writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. It reads the service's own
hold (`treasury_real_yields._held`, a `held_build.HeldBuild`) through that hold's read-only `peek()`, the nominal days
through `treasury_yields.held_rows` (read only), and shapes them with the service's own `assemble`, so the breakevens
are the service's own arithmetic, never retyped here. A rail drives the service itself over an invented feed and reads
its answer back through this reader.
"""
from __future__ import annotations

from typing import Optional


def held_real() -> tuple[Optional[dict], str]:
    """READ ONLY: `(block, how)` without starting a build or asking the Treasury.

    `how` is `held` (the block as the RATES route's `real` would carry it, with the last failed look as `check`) or
    `not_held` (no real figure is held). Never builds."""
    from api.services import treasury_real_yields as svc
    from api.services import treasury_yields as ty
    got = svc._held.peek()
    if not isinstance(got, dict) or got.get("status") != "ok" or not isinstance(got.get("days"), dict) or not got["days"]:
        return None, "not_held"
    return svc.assemble(got, ty.held_rows(list(got["days"]))), "held"
