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
    """Router must search amc_tonight bucket so AVGO gets its row context."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_gen:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    # The row from amc_tonight should have been passed to the analysis function
    call_args = mock_gen.call_args
    assert call_args[0][0] == "AVGO"           # sym
    assert call_args[0][1] is not None          # row was found (not None)
    assert call_args[0][1]["verdict"] == "beat" # correct row


@pytest.mark.asyncio
async def test_earnings_analysis_sym_not_found_passes_none_row():
    """When sym isn't in any bucket, row=None is passed (Pending/cold state)."""
    with patch("api.routers.earnings.get_earnings", return_value={"bmo": [], "amc": [], "amc_tonight": []}), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_gen:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/UNKNOWN")
    assert r.status_code == 200
    call_args = mock_gen.call_args
    assert call_args[0][1] is None  # row=None when sym not found


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
         patch("api.routers.earnings._generate_earnings_preview", return_value=MOCK_PREVIEW) as mock_prev, \
         patch("api.routers.earnings._generate_earnings_analysis") as mock_anal:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/PL")
    assert r.status_code == 200
    mock_prev.assert_called_once()
    mock_anal.assert_not_called()
    call_args = mock_prev.call_args
    assert call_args[0][0] == "PL"
    assert call_args[0][1]["verdict"] == "Pending"


@pytest.mark.asyncio
async def test_non_pending_verdict_routes_to_analysis():
    """Non-pending verdict → _generate_earnings_analysis called, not _generate_earnings_preview."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_anal, \
         patch("api.routers.earnings._generate_earnings_preview") as mock_prev:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    mock_anal.assert_called_once()
    mock_prev.assert_not_called()
