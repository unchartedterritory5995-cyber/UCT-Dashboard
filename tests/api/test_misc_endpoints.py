import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app


@pytest.mark.asyncio
async def test_earnings_returns_structure():
    mock = {"bmo": [{"sym": "AAPL", "verdict": "Beat"}], "amc": []}
    with patch("api.routers.earnings.get_earnings", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings")
    assert r.status_code == 200
    assert "bmo" in r.json()
    assert "amc" in r.json()


@pytest.mark.asyncio
async def test_news_returns_list():
    mock = [{"headline": "Test", "source": "Finnhub", "url": "http://x.com", "time": "5m ago"}]
    with patch("api.routers.news.get_news", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/news")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert r.json()[0]["headline"] == "Test"


@pytest.mark.asyncio
async def test_screener_returns_list():
    mock = [{"sym": "NVDA", "rs_score": 95, "vol_ratio": 2.1, "mom": 0.85}]
    with patch("api.routers.screener.get_screener", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/screener")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
