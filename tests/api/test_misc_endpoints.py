import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app
from api.middleware.auth_middleware import get_current_user_with_plan


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
async def test_screener_refuses_an_anonymous_caller():
    """`/api/screener` carried NO dependency at all until 2026-08-08 — this test
    asserted a 200 for an anonymous caller and was the only thing watching it.
    Owner ruling 2026-08-06/08-07: everything is paid."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/screener")
    assert r.status_code == 401, r.text[:200]


@pytest.mark.asyncio
async def test_screener_returns_list_for_a_paid_caller():
    mock = [{"sym": "NVDA", "rs_score": 95, "vol_ratio": 2.1, "mom": 0.85}]
    # ⚠️ The override is on what `require_paid` DEPENDS on, never on the gate
    # itself — overriding the gate would mean the gate never runs.
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "u_paid", "role": "member", "plan": "pro"}
    try:
        with patch("api.routers.screener.get_screener", return_value=mock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                r = await ac.get("/api/screener")
    finally:
        app.dependency_overrides.pop(get_current_user_with_plan, None)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
