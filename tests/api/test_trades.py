import pytest
import json
import os
from httpx import AsyncClient, ASGITransport
from api.main import app

# The /api/trades router was DEPRECATED 2026-06-02 (Model Book replaced the
# personal trade log) and is commented out in api/main.py, kept only as a
# rollback backup — so these endpoints legitimately 404 today.
#
# Gated on whether the router is actually mounted rather than deleted outright:
# while it stays retired these skip, and if anyone restores the include_router
# line for a rollback they light straight back up. Delete this file together
# with api/routers/trades.py + data/trades.json when the backup is dropped.
_TRADES_MOUNTED = any(
    getattr(r, "path", "").startswith("/api/trades") for r in app.routes
)
pytestmark = pytest.mark.skipif(
    not _TRADES_MOUNTED,
    reason="/api/trades router is deprecated and not mounted (api/main.py)",
)


@pytest.mark.asyncio
async def test_trades_get_returns_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/trades")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_trades_post_adds_trade():
    trade = {
        "sym": "NVDA",
        "entry": 850.0,
        "stop": 820.0,
        "target": 920.0,
        "size_pct": 15.0,
        "notes": "VCP breakout"
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/trades", json=trade)
    assert r.status_code == 200
    data = r.json()
    assert data["sym"] == "NVDA"
    assert data["status"] == "open"
    assert "id" in data


@pytest.mark.asyncio
async def test_traders_returns_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/traders")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
