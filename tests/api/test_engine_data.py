import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_BREADTH = {
    "pct_above_50ma": 62.4,
    "pct_above_200ma": 55.1,
    "advancing": 227,
    "declining": 148,
    "distribution_days": 7,
    "market_phase": "Confirmed Uptrend"
}

MOCK_THEMES = {
    "leaders": [{"name": "Silver Miners", "pct": "+11.47%", "bar": 85}],
    "laggards": [{"name": "Bitcoin Miners", "pct": "-3.13%", "bar": 25}],
    "period": "1W"
}

MOCK_LEADERSHIP = [
    {"rank": 1, "sym": "NVDA", "score": 95, "thesis": "AI infrastructure leader"}
]

MOCK_RUNDOWN = {
    "html": "<p>Market analysis here</p>",
    "date": "2026-02-22"
}


@pytest.mark.asyncio
async def test_breadth_endpoint():
    with patch("api.routers.engine_data.get_breadth", return_value=MOCK_BREADTH):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/breadth")
    assert r.status_code == 200
    assert "pct_above_50ma" in r.json()
    assert "distribution_days" in r.json()


@pytest.mark.asyncio
async def test_themes_endpoint():
    with patch("api.routers.engine_data.get_themes", return_value=MOCK_THEMES):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/themes")
    assert r.status_code == 200
    assert "leaders" in r.json()
    assert "laggards" in r.json()


@pytest.mark.asyncio
async def test_leadership_endpoint():
    with patch("api.routers.engine_data.get_leadership", return_value=MOCK_LEADERSHIP):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/leadership")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_rundown_endpoint():
    with patch("api.routers.engine_data.get_rundown", return_value=MOCK_RUNDOWN):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/rundown")
    assert r.status_code == 200
    assert "html" in r.json()
