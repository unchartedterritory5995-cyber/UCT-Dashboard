"""OI-44 / W3 — the loop-blockers scanner as a permanent regression gate.

R52's static scanner (`docs/discord-render/instruments/oi44_loop_blockers.py`) found 17
`async def` route handlers doing blocking sqlite I/O directly on the shared event loop — the
same hazard class the boot-window stall census (OI-44) measures the cost of. 16 of them (the
member-reachable `/api/oi/confirmation-map` plus 15 `/api/admin/*`/`/api/oi/*`/`/api/flow/*`
routes, all in `api/main.py`) are wrapped in `run_in_threadpool` here.

⛔ ONE IS DELIBERATELY LEFT: `api/live_massive_router.py:enrich_oi`. That file is
PARTNER-OWNED (`project_partner_collab_branch` — Ravi co-edits it), so it is recorded as a
standing finding, not fixed unilaterally, mirroring the two sync-HTTP-inside-async findings
already left untouched in `api/massive_ws_worker.py` for the same reason.

⛔ This test names the allowlist, not a count — a count lets a new offender hide behind a
fixed one leaving. If `enrich_oi` is ever fixed (with the partner's ack), shrink the allowlist
in the same commit; do not widen it for a route not on this list.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
SCANNER_PATH = REPO / "docs" / "discord-render" / "instruments" / "oi44_loop_blockers.py"

_spec = importlib.util.spec_from_file_location("oi44_loop_blockers", SCANNER_PATH)
oi44_loop_blockers = importlib.util.module_from_spec(_spec)
sys.modules["oi44_loop_blockers"] = oi44_loop_blockers
_spec.loader.exec_module(oi44_loop_blockers)

#: (relative path, function name) — the ONLY route handlers this gate tolerates finding a
#: blocking call in. Every entry needs a reason; there is exactly one right now.
ALLOWED_ROUTE_BLOCKERS = {
    ("api/live_massive_router.py", "enrich_oi"),  # partner-owned file — not ours to fix
}


def _scan_all_routes():
    findings = []
    for p in sorted(oi44_loop_blockers.API.rglob("*.py")):
        findings.extend(oi44_loop_blockers.scan_file(p))
    return [f for f in findings if f["route"]]


def test_the_scanner_can_still_see_a_planted_blocker():
    """Non-vacuity control: prove the scanner is not just returning an empty list because it
    stopped working. Uses the scanner's own declared self-check suite."""
    assert oi44_loop_blockers.self_check() == 0


def test_no_loop_blocking_route_handler_beyond_the_named_partner_owned_exception():
    routes = _scan_all_routes()
    found = {
        (f["path"].relative_to(oi44_loop_blockers.ROOT).as_posix(), f["func"])
        for f in routes
    }
    unexpected = found - ALLOWED_ROUTE_BLOCKERS
    assert not unexpected, (
        "New async route handler(s) blocking the shared event loop, not on the allowlist: "
        f"{sorted(unexpected)}"
    )


def test_the_allowlist_itself_still_names_a_real_route_and_is_not_stale():
    """The allowlist is a claim about the live codebase, not a fossil. If enrich_oi stops
    existing or stops blocking, this fails so the allowlist gets shrunk rather than drifting."""
    routes = _scan_all_routes()
    found = {
        (f["path"].relative_to(oi44_loop_blockers.ROOT).as_posix(), f["func"])
        for f in routes
    }
    stale = ALLOWED_ROUTE_BLOCKERS - found
    assert not stale, (
        f"Allowlist entries no longer found blocking anything — shrink the allowlist: {stale}"
    )


def test_oi_confirmation_map_specifically_no_longer_blocks_the_loop():
    """The member-reachable one, named explicitly so a regression here can never hide inside
    the aggregate route_handlers count."""
    routes = _scan_all_routes()
    hit = {(f["path"].relative_to(oi44_loop_blockers.ROOT).as_posix(), f["func"]) for f in routes}
    assert ("api/main.py", "_oi_confirmation_map") not in hit
