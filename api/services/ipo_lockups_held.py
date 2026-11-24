"""READ ONLY: the IPO lockup list (IPO LOCKUP) as this server already holds it.

`ipo_lockups.get_lockups()` answers from `held_build.HeldBuild.get()`, which STARTS the one background build (a read of
the listings scan's held answer, the name cache and each row's daily closes) when the held answer is due, and with
nothing held waits a few seconds on it. A reader that must never cause that work (the UCT Agent's `ipo.lockups` data
kind, MD-1 §4.20) reads through `held_lockups()` instead: the answer the service already holds, exactly as the route
serves it (`ipo_lockups._HELD.peek()`, which never starts a build), or nothing. It never builds, never reads a close or
the listings scan, and never writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. ⚠️ COUPLING, stated: the
service's module-level hold `_HELD`; a rail drives the service itself over invented listings and checks this reader
gives the route's own answer, so a rename or a drift fails it.
"""
from __future__ import annotations

from typing import Optional


def held_lockups() -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` without starting a build. `how` is `held` (the route's own answer: status `ok` or
    `warming`, with the service's `check` beside it) or `not_held` (nothing is held). Never builds."""
    from api.services import ipo_lockups as svc
    got = svc._HELD.peek()
    if not isinstance(got, dict) or got.get("status") not in ("ok", "warming"):
        return None, "not_held"
    return {k: v for k, v in got.items() if k != "v"}, "held"
