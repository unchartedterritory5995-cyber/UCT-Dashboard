"""Every /api/nhnl/* route must be paid-gated.

Derived from `router.routes` (never a hand-listed set) so a route added tomorrow
without its own `require_paid` fails this test, mirroring test_scan_screener_auth.
"""
from fastapi.routing import APIRoute

from api.routers import nhnl as nhnl_router


def _dependency_calls(route: APIRoute):
    """Flatten every dependency callable attached to a route."""
    seen = []

    def _walk(dep):
        if dep.call is not None:
            seen.append(dep.call)
        for sub in dep.dependencies:
            _walk(sub)

    _walk(route.dependant)
    return seen


def test_every_nhnl_route_is_paid_gated():
    routes = [r for r in nhnl_router.router.routes if isinstance(r, APIRoute)]
    assert routes, "router exposed no routes — wiring regressed"
    for route in routes:
        calls = _dependency_calls(route)
        assert nhnl_router.require_paid in calls, (
            f"{route.path} is not behind require_paid")


def test_router_exposes_the_expected_paths():
    paths = {r.path for r in nhnl_router.router.routes if isinstance(r, APIRoute)}
    assert "/api/nhnl/live" in paths
    assert "/api/nhnl/status" in paths
