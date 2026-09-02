"""Dedicated bars-serving tier entrypoint (Path B Phase 1, 2026-09-02).

The `bars-api` service serves /api/bars + /api/bars-history from the SAME shared
serve core as the web pod, with no warmers/uploader/WS. These pin that the app
builds, exposes exactly the intended routes, and that health works — without
starting any of the background sync threads (lifespan not entered).
"""
import importlib

import api.bars_api_main as bam


def test_app_builds_and_exposes_only_the_intended_routes():
    app = bam._build_app()
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    # The serving endpoints + health/ready.
    assert "/api/bars/{ticker}" in paths
    assert "/api/bars-history/{ticker}" in paths
    assert "/api/health" in paths
    assert "/api/ready" in paths
    assert "/internal/health" in paths
    # It must NOT mount warmer/admin/app surfaces — serving only.
    assert "/api/admin/warm-universe" not in paths
    assert "/api/stream/bars" not in paths
    assert "/api/live-prices" not in paths


def test_health_and_ready_return_serving_identity():
    from starlette.testclient import TestClient
    # Build the app but do NOT enter the lifespan (no background sync threads):
    app = bam._build_app()
    # Manually exercise the route handlers without lifespan by hitting them via a
    # client that skips startup — TestClient runs lifespan, so instead call the
    # underlying functions through the router is overkill; just assert the app has
    # them and the health payload shape is correct via a direct call.
    # Find the health endpoint function and call it.
    health_fn = next(r.endpoint for r in app.routes
                     if getattr(r, "path", None) == "/api/health")
    payload = health_fn()
    assert payload["service"] == "bars-api"
    assert payload["alive"] is True
    ready_fn = next(r.endpoint for r in app.routes
                    if getattr(r, "path", None) == "/api/ready")
    assert ready_fn()["ready"] is True


def test_uses_the_shared_serve_core_not_a_copy():
    # The route must delegate to bars.serve_bars / serve_bars_history — one impl.
    from api.routers import bars as bars_router
    assert hasattr(bars_router, "serve_bars")
    assert hasattr(bars_router, "serve_bars_history")
    # And the entrypoint imports them (not a re-implementation).
    src = importlib.import_module("api.bars_api_main")
    assert "from api.routers.bars import serve_bars, serve_bars_history" in \
        open(src.__file__, encoding="utf-8").read()
