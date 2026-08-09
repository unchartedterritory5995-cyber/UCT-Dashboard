import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

# `/api/breadth`, `/api/themes` and `/api/leadership` are `require_paid`, and
# `/api/rundown` is `get_current_user` (the free tier), since the 2026-08-09
# auth sweep — all four answered anonymous callers. These are BEHAVIOUR tests,
# so they get the caller they always implied; the gate is owned by
# tests/test_exposed_routes_gated.py and asserted exactly once, there.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)

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
    with patch("api.routers.engine_data.get_leadership", return_value=MOCK_LEADERSHIP), \
         patch("api.routers.engine_data._load_wire_data", return_value={"date": "2099-01-01"}):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/leadership")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert isinstance(body["stocks"], list)
    assert body["stocks"][0]["sym"] == "NVDA"
    assert body["status"] in ("fresh", "stale", "no_data")
    assert "last_updated" in body


@pytest.mark.asyncio
async def test_leadership_endpoint_no_data():
    with patch("api.routers.engine_data.get_leadership", return_value=[]), \
         patch("api.routers.engine_data._load_wire_data", return_value=None):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/leadership")
    assert r.status_code == 200
    body = r.json()
    assert body["stocks"] == []
    assert body["status"] == "no_data"
    assert body["last_updated"] is None


@pytest.mark.asyncio
async def test_leadership_endpoint_stale():
    # Wire data exists but is older than 26h → status should be stale
    with patch("api.routers.engine_data.get_leadership", return_value=[]), \
         patch("api.routers.engine_data._load_wire_data", return_value={"date": "2000-01-01"}):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/leadership")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "stale"
    assert body["last_updated"] == "2000-01-01"


@pytest.mark.asyncio
async def test_rundown_endpoint():
    with patch("api.routers.engine_data.get_rundown", return_value=MOCK_RUNDOWN):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/rundown")
    assert r.status_code == 200
    assert "html" in r.json()
