import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_SNAPSHOT = {
    "futures": {
        "NQ": {"price": "25,039.75", "chg": "+0.54%", "css": "pos"},
        "ES": {"price": "6,909.50", "chg": "+0.22%", "css": "pos"},
        "RTY": {"price": "2,663.00", "chg": "+0.10%", "css": "pos"},
        "BTC": {"price": "67,105", "chg": "+1.20%", "css": "pos"},
    },
    "etfs": {
        "QQQ": {"price": "495.79", "chg": "+0.50%", "css": "pos"},
        "SPY": {"price": "580.00", "chg": "+0.40%", "css": "pos"},
        "IWM": {"price": "210.00", "chg": "+0.10%", "css": "pos"},
        "DIA": {"price": "430.00", "chg": "+0.20%", "css": "pos"},
        "VIX": {"price": "19.62", "chg": "-3.30%", "css": "neg"},
    }
}

@pytest.mark.asyncio
async def test_snapshot_returns_structure():
    with patch("api.routers.snapshot.get_snapshot", return_value=MOCK_SNAPSHOT):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/snapshot")
    assert r.status_code == 200
    data = r.json()
    assert "futures" in data
    assert "etfs" in data
    assert "NQ" in data["futures"]
    assert "QQQ" in data["etfs"]

@pytest.mark.asyncio
async def test_snapshot_503_on_error():
    with patch("api.routers.snapshot.get_snapshot", side_effect=Exception("API down")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/snapshot")
    assert r.status_code == 503
