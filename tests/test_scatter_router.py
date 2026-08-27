"""Every /api/scatter/* route must be paid-gated.

Derived from `router.routes` (never a hand-listed set) so a route added tomorrow
without its own `require_paid` fails this test, mirroring test_nhnl_router.
"""
from fastapi.routing import APIRoute

from api.routers import scatter as scatter_router


def _dependency_calls(route: APIRoute):
    seen = []

    def _walk(dep):
        if dep.call is not None:
            seen.append(dep.call)
        for sub in dep.dependencies:
            _walk(sub)

    _walk(route.dependant)
    return seen


def test_every_scatter_route_is_paid_gated():
    routes = [r for r in scatter_router.router.routes if isinstance(r, APIRoute)]
    assert routes, "router exposed no routes — wiring regressed"
    for route in routes:
        calls = _dependency_calls(route)
        assert scatter_router.require_paid in calls, (
            f"{route.path} is not behind require_paid")


def test_router_exposes_the_expected_paths():
    paths = {r.path for r in scatter_router.router.routes if isinstance(r, APIRoute)}
    assert {"/api/scatter/metrics", "/api/scatter/universes",
            "/api/scatter/data", "/api/scatter/live"} <= paths
