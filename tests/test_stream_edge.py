"""stream-edge (docs/plans/2026-11-17-stream-edge.md): the live chart stream served off the web pod."""
import asyncio

import pytest
from fastapi import HTTPException

from api import chart_edge_token as cet
from api import stream_edge_main as se


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", "test-edge-secret")


def test_a_valid_member_cookie_is_admitted(secret):
    assert se.edge_access(cet.mint()) == {"via": "edge_token"}


@pytest.mark.parametrize("token", [None, "", "v1.garbage.sig", "nope"])
def test_missing_or_forged_cookies_are_refused(secret, token):
    with pytest.raises(HTTPException) as e:
        se.edge_access(token)
    assert e.value.status_code == 401


def test_an_expired_or_service_token_is_refused(secret):
    with pytest.raises(HTTPException):
        se.edge_access(cet.mint(now=1_000_000))                 # long expired
    svc = cet.mint_service()
    if svc:
        with pytest.raises(HTTPException):
            se.edge_access(svc)                                 # a render credential is not a member


def test_no_secret_configured_refuses_everyone(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", "x")
    tok = cet.mint()
    monkeypatch.delenv("CHART_EDGE_SECRET")
    with pytest.raises(HTTPException):
        se.edge_access(tok)


def test_the_app_serves_web_s_own_bars_route_with_only_auth_swapped():
    from api.bars_auth import require_bars_access
    from api.routers import stream as stream_router
    app = se.build_app(start_feed=False)
    routes = {r.path: r for r in app.routes if hasattr(r, "endpoint")}
    assert routes["/api/stream/bars"].endpoint is stream_router.stream_bars, "byte-identical frames"
    assert "/api/stream/prices" not in routes, "phase A serves bars only"
    assert app.dependency_overrides[require_bars_access] is se.edge_access


def test_the_bars_route_answers_401_without_a_cookie(secret):
    from fastapi.testclient import TestClient
    with TestClient(se.build_app(start_feed=False)) as c:
        r = c.get("/api/stream/bars?bars=ZZA:1&v=2")
        assert r.status_code == 401
        assert c.get("/healthz").json()["ok"] is True


def test_the_edge_feed_client_carries_no_side_feeds(monkeypatch):
    from api.services import bar_broadcaster, bar_stream, feed_client as fc
    saved = (bar_stream._record_only, bar_broadcaster._singleton)

    async def go():
        client = fc.start_remote(side_feeds=False, client_prefix="edge")
        try:
            assert client.side is None and client.side_worker is None
            assert client.client_id.startswith("edge-")
        finally:
            await fc.stop_remote(timeout_s=1.0)
    try:
        asyncio.run(go())
    finally:
        bar_stream._record_only = saved[0]
        bar_broadcaster._singleton = saved[1]
