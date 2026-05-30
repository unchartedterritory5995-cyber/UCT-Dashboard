import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    # uptime_seconds lets operators distinguish a healthy long-lived pod from
    # one that's silently restarting / idle-respawning (the cold-start that
    # makes the first chart load slow).
    assert isinstance(body["uptime_seconds"], int)
    assert body["uptime_seconds"] >= 0

@pytest.mark.asyncio
async def test_spa_fallback_serves_html():
    """When dist exists, unknown paths should return HTML (SPA fallback)."""
    import os
    dist = os.path.join(os.path.dirname(__file__), "..", "..", "app", "dist")
    if not os.path.exists(dist):
        pytest.skip("app/dist not built — run npm run build first")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/dashboard")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
