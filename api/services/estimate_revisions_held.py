"""READ ONLY: estimate revision breadth by sector (EEHSC) as this server already holds it.

`estimate_revisions.get_breadth()` answers from `held_build.HeldBuild.get()`, which STARTS the one background read of
the estimate snapshot store when the held answer is more than 30 minutes old, and with nothing held waits a few seconds
on it. A reader that must never cause that work (the UCT Agent's `estimates.revisionBreadth` data kind, MD-1 §4.20)
reads through `held_breadth()` instead: the same answer the route serves for one estimate and one window, shaped by the
same steps over the answer the service already holds (`estimate_revisions.peek()`, which never starts a read), or
nothing. It never builds, never opens the store and never writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives the service
itself over an invented store and checks this reader gives the route's own answer for every estimate and window, so a
drift fails it.
"""
from __future__ import annotations

from typing import Optional


def held_breadth(metric: str = "eps", window: int = 30) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one estimate (`eps` or `revenue`) and one window (7 or 30 days), without starting a
    read. `how` is `held` (the route's own answer, with the service's `check` beside it) or `not_held` (nothing is held,
    or a word the service does not take). Never builds."""
    from api.services import estimate_revisions as svc
    if metric not in svc.METRICS or window not in svc.WINDOWS:
        return None, "not_held"
    got = svc.peek()
    if not isinstance(got, dict) or got.get("status") != "ok" or not isinstance(got.get("slices"), dict):
        return None, "not_held"
    out = {k: v for k, v in got.items() if k != "slices"}
    out.update(got["slices"].get(f"{metric}:{window}") or {"metric": metric, "window": window,
                                                            "total": svc._blank_counts(), "sectors": []})
    return out, "held"
