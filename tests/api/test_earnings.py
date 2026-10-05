import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_EARNINGS = {
    "bmo": [],
    "amc": [],
    "amc_tonight": [
        {
            "sym": "AVGO",
            "verdict": "beat",
            "reported_eps": 1.60,
            "eps_estimate": 1.50,
            "surprise_pct": "+6.7%",
            "rev_actual": 14000,
            "rev_estimate": 13500,
            "rev_surprise_pct": "+3.7%",
            "change_pct": 5.2,
            "ew_total": 195,
        }
    ],
}

MOCK_ANALYSIS = {
    "sym": "AVGO",
    "analysis": "Broadcom beat on all metrics.",
    "yoy_eps_growth": "+22.1%",
    "beat_streak": "Beat 4 of last 4",
    "news": [],
}


@pytest.mark.asyncio
async def test_earnings_analysis_finds_amc_tonight_row():
    """Router must search amc_tonight bucket so AVGO gets its row context.

    S1 (2026-10-05): generation runs on the click pool, never inside the request, so the
    row is asserted on the job the router KICKS rather than on a synchronous call."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._cached_for", return_value=None), \
         patch("api.routers.earnings._kick_generation") as mock_kick:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    call_args = mock_kick.call_args
    assert call_args[0][0] == "AVGO"           # sym
    assert call_args[0][1] is not None          # row was found (not None)
    assert call_args[0][1]["verdict"] == "beat" # correct row
    assert call_args[0][2] is False             # a reported row -> analysis, not preview


@pytest.mark.asyncio
async def test_earnings_analysis_sym_not_found_routes_to_preview():
    """When sym isn't in any bucket, the router treats it as pending/cold
    state and routes to _generate_earnings_preview with a synthesized
    minimal row ({"sym": sym}). The older `analysis with row=None` path
    was replaced when the preview pipeline shipped."""
    with patch("api.routers.earnings.get_earnings", return_value={"bmo": [], "amc": [], "amc_tonight": []}), \
         patch("api.routers.earnings._cached_for", return_value=None), \
         patch("api.routers.earnings._is_unpreviewable_fund", return_value=False), \
         patch("api.routers.earnings._kick_generation") as mock_kick:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/UNKNOWN")
    assert r.status_code == 200
    # The preview path is chosen (pending=True); the pool job builds `{"sym": sym}` itself
    call_args = mock_kick.call_args
    assert call_args[0][0] == "UNKNOWN"
    assert call_args[0][2] is True


MOCK_PENDING_ROW = {
    "sym": "PL",
    "verdict": "Pending",
    "eps_estimate": -0.04,
    "rev_estimate": 78.0,
    "change_pct": 5.64,
}

MOCK_PREVIEW = {
    "sym": "PL",
    "preview_text": "Palantir reports tonight with elevated expectations.",
    "preview_bullets": ["Beat 2 of last 4.", "Watch $78M revenue target.", "Gap +5.6% raises the bar."],
    "beat_history": ["✗", "✓", "✗", "✓"],
    "yoy_eps_growth": "-12.3%",
    "beat_streak": "Beat 2 of last 4",
    "news": [],
}

MOCK_EARNINGS_WITH_PENDING = {
    "bmo": [],
    "amc": [],
    "amc_tonight": [MOCK_PENDING_ROW],
}


@pytest.mark.asyncio
async def test_pending_verdict_routes_to_preview():
    """Pending verdict → _generate_earnings_preview called, not _generate_earnings_analysis."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS_WITH_PENDING), \
         patch("api.routers.earnings._cached_for", return_value=None), \
         patch("api.routers.earnings._is_unpreviewable_fund", return_value=False), \
         patch("api.routers.earnings._kick_generation") as mock_kick:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/PL")
    assert r.status_code == 200
    call_args = mock_kick.call_args
    assert call_args[0][0] == "PL"
    assert call_args[0][1]["verdict"] == "Pending"
    assert call_args[0][2] is True


@pytest.mark.asyncio
async def test_non_pending_verdict_routes_to_analysis():
    """Non-pending verdict → _generate_earnings_analysis called, not _generate_earnings_preview."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._cached_for", return_value=None), \
         patch("api.routers.earnings._kick_generation") as mock_kick:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    assert mock_kick.call_args[0][2] is False


@pytest.mark.asyncio
async def test_S1_a_bare_request_never_generates_inside_the_request():
    """S1: without cached_only/background the router used to run the LLM synchronously
    (~30 s on the shared threadpool). It must answer `generating` at once and kick a job."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._cached_for", return_value=None), \
         patch("api.routers.earnings._generate_earnings_analysis") as mock_anal, \
         patch("api.routers.earnings._generate_earnings_preview") as mock_prev, \
         patch("api.routers.earnings._kick_generation") as mock_kick:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    mock_anal.assert_not_called()
    mock_prev.assert_not_called()
    mock_kick.assert_called_once()
    assert r.json().get("generating") is True
