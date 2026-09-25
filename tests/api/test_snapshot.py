import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app
from api.middleware.auth_middleware import get_current_user

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


@pytest.fixture
def auth_override():
    """Fakes the GATE'S INPUT, never the gate itself — the real
    Depends(get_current_user) route code still runs. Cleared after every
    test so the override can never leak into another module."""
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 1, "role": "user", "email": "member@test",
    }
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_snapshot_requires_auth():
    """Without a session, `/api/snapshot` refuses rather than serving live
    quotes anonymously (OI-17)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/snapshot")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_snapshot_returns_structure(auth_override):
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
async def test_snapshot_503_on_error(auth_override):
    with patch("api.routers.snapshot.get_snapshot", side_effect=Exception("API down")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/snapshot")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_ticker_snapshot_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/snapshot/AAPL")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ticker_snapshot_authenticated(auth_override):
    with patch("api.routers.snapshot.get_ticker_snapshot", return_value={"price": 200.0}):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/snapshot/AAPL")
    assert r.status_code == 200
    assert r.json()["price"] == 200.0
