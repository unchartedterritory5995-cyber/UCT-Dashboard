import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

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

@pytest.mark.asyncio
async def test_movers_structure():
    with patch("api.routers.movers.get_movers", return_value=MOCK_MOVERS):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/movers")
    assert r.status_code == 200
    data = r.json()
    assert "ripping" in data
    assert "drilling" in data
    assert isinstance(data["ripping"], list)
    assert data["ripping"][0]["sym"] == "RNG"
