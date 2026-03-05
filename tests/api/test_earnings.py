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
