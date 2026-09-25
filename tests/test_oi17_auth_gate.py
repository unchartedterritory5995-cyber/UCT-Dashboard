"""OI-17: four previously-anonymous market-data endpoints now require a
session — `/api/live-prices`, `/api/movers`, `/api/gex/data`, `/api/snapshot`
(+ `/api/snapshot/{ticker}`). `/api/extended-movers` was gated alongside its
sibling `/api/movers` for the same reason, though it wasn't named in OI-17.

Verified before this change that no legitimate anonymous caller exists: every
real frontend fetch of these four paths sits inside `<AuthGuard/>` (including
`Confluence.jsx`, which has no route of its own — it's a lazy tab mounted
inside the paid, authenticated `OptionsFlow.jsx`), and no Discord bot or other
backend service calls them over HTTP (only doc-comment references turned up).
`api/live_massive_router.py` (partner-owned) and `api/flow_proxy.py` are
untouched — OI-17 explicitly excludes the partner's fifth OI-17 endpoint.

Pattern: fake the GATE'S INPUT via `app.dependency_overrides[get_current_user]`,
never the gate itself — the real `Depends(get_current_user)` route code still
runs on the 200 path. Mirrors `tests/test_dashboard_signposts.py`.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user


@pytest.fixture
def auth_client():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 1, "role": "user", "email": "member@test",
    }
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    return TestClient(app)


# ── /api/live-prices ────────────────────────────────────────────────────────

def test_live_prices_requires_auth(anon_client):
    r = anon_client.get("/api/live-prices?tickers=AAPL")
    assert r.status_code == 401


def test_live_prices_authenticated_200(auth_client):
    # The whole-request fast-path cache hit is the simplest way to reach a
    # 200 without exercising the Massive-fetch business logic below it
    # (already covered by tests/test_live_prices_*.py) — this test's only
    # job is the auth gate, not payload shape.
    with patch("api.routers.live_prices.cache") as mock_cache:
        mock_cache.get.return_value = {"whole": "hit"}
        r = auth_client.get("/api/live-prices?tickers=AAPL")
    assert r.status_code == 200
    assert r.json() == {"whole": "hit"}


# ── /api/gex/data ────────────────────────────────────────────────────────────

def test_gex_data_requires_auth(anon_client):
    r = anon_client.get("/api/gex/data?ticker=SPY")
    assert r.status_code == 401


def test_gex_data_authenticated_200(auth_client):
    with patch(
        "api.gex_router.get_gex_data",
        new_callable=AsyncMock,
        return_value={"ticker": "SPY", "adjusted": False, "strikes": []},
    ):
        r = auth_client.get("/api/gex/data?ticker=SPY")
    assert r.status_code == 200
    assert r.json()["ticker"] == "SPY"
