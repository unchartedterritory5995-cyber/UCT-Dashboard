import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app
from api.middleware.auth_middleware import get_current_user

MOCK_MOVERS = {
    "ripping": [
        {"sym": "RNG", "pct": "+34.40%"},
        {"sym": "TNDM", "pct": "+32.67%"},
    ],
    "drilling": [
        {"sym": "GRND", "pct": "-50.55%"},
        {"sym": "CCOI", "pct": "-29.36%"},
    ]
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
async def test_movers_requires_auth():
    """Without a session, `/api/movers` refuses rather than serving live
    quotes anonymously (OI-17)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/movers")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_movers_structure(auth_override):
    with patch("api.routers.movers.get_movers", return_value=MOCK_MOVERS):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/movers")
    assert r.status_code == 200
    data = r.json()
    assert "ripping" in data
    assert "drilling" in data
    assert isinstance(data["ripping"], list)
    assert data["ripping"][0]["sym"] == "RNG"


@pytest.mark.asyncio
async def test_extended_movers_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/extended-movers")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_extended_movers_authenticated(auth_override):
    with patch("api.routers.movers.get_extended_movers", return_value={"movers": []}):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/extended-movers")
    assert r.status_code == 200
