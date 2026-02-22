import pytest
import json
import os
from httpx import AsyncClient, ASGITransport
from api.main import app


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
