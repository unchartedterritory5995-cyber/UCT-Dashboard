"""
FastAPI router for Schwab API integration.
Add to main.py: from schwab_router import router as schwab_router
                 app.include_router(schwab_router)
"""

from fastapi import APIRouter, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse
from urllib.parse import urlparse, parse_qs
import api.schwab_service as schwab

router = APIRouter(prefix="/api/schwab", tags=["schwab"])


@router.get("/status")
async def schwab_status():
    """Check if Schwab API is connected."""
    authenticated = schwab.is_authenticated()
    persistent = str(schwab.TOKEN_FILE).startswith("/data")
    return {
        "connected": authenticated,
        "hasAppKey": bool(schwab.APP_KEY),
        "tokenStorage": str(schwab.TOKEN_FILE),
        "persistent": persistent,
        "message": "Connected to Schwab API" + (" (persistent)" if persistent else " (will reset on deploy)") if authenticated else "Not connected. Visit /api/schwab/login to authenticate.",
    }


@router.get("/login")
async def schwab_login():
    """Redirect user to Schwab OAuth login page."""
    if not schwab.APP_KEY:
        return JSONResponse(
            status_code=500,
            content={"error": "SCHWAB_APP_KEY environment variable not set."},
        )
    auth_url = schwab.get_auth_url()
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def schwab_callback(request: Request):
    """Handle Schwab OAuth callback with authorization code."""
    # Schwab redirects here with ?code=xxx
    code = request.query_params.get("code")
    if not code:
        # Sometimes the code is in the URL fragment — show a helper page
        return JSONResponse(
            status_code=400,
            content={
                "error": "No authorization code received.",
                "hint": "Check the URL for a 'code' parameter.",
                "url": str(request.url),
            },
        )

    try:
        tokens = await schwab.exchange_code(code)
        return JSONResponse(content={
            "status": "success",
            "message": "Schwab API connected! You can close this page.",
            "access_token_expires_in": tokens.get("expires_in", "unknown"),
        })
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Token exchange failed: {str(e)}"},
        )


@router.post("/refresh")
async def schwab_refresh():
    """Manually trigger token refresh."""
    tokens = await schwab.refresh_access_token()
    if tokens:
        return {"status": "success", "message": "Token refreshed."}
    return JSONResponse(
        status_code=401,
        content={"error": "Refresh failed. Re-authenticate at /api/schwab/login."},
    )


@router.get("/options-quote")
async def options_quote(
    symbol: str = Query(..., description="Ticker symbol, e.g. AAPL"),
    strike: float = Query(..., description="Strike price, e.g. 250"),
    expDate: str = Query(..., description="Expiration date YYYY-MM-DD, e.g. 2026-03-20"),
    cp: str = Query(..., description="C for Call, P for Put"),
):
    """Fetch current price for a single option contract."""
    result = await schwab.get_option_quote(symbol, strike, expDate, cp)
    return result


@router.post("/options-quotes")
async def options_quotes_batch(contracts: list[dict]):
    """
    Fetch current prices for multiple option contracts.
    Body: [{"symbol":"AAPL","strike":250,"expDate":"2026-03-20","cp":"C"}, ...]
    """
    results = await schwab.get_batch_option_quotes(contracts)
    return {"quotes": results}


@router.get("/market-summary")
async def market_summary():
    """Fetch current prices for SPY, QQQ, DIA, IWM, VIX."""
    results = await schwab.get_market_summary()
    return {"indices": results}


@router.get("/market-narrative")
async def market_narrative():
    """Generate AI narrative of today's market using Claude + web search."""
    import os
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return JSONResponse(status_code=500, content={"error": "ANTHROPIC_API_KEY not set"})

    try:
        from datetime import datetime
        today = datetime.now()
        today_str = today.strftime("%A, %B %d, %Y")
        # If weekend, ask for most recent trading day
        weekday = today.weekday()
        day_note = ""
        if weekday == 5:  # Saturday
            day_note = " (Saturday — markets closed, summarize Friday's action)"
        elif weekday == 6:  # Sunday
            day_note = " (Sunday — markets closed, summarize Friday's action)"
        
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=250,
            system="You are a financial news writer. Respond with ONLY 2-3 concise sentences. No preamble. No search commentary. No disclaimers. No 'based on my search' or 'I found'. Just the market summary as if writing a Bloomberg terminal flash.",
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{
                "role": "user",
                "content": f"Today is {today_str}{day_note}. Write 2-3 sentences: How did US markets close on the most recent trading day? Include S&P 500, Nasdaq, Dow moves and the main catalyst."
            }],
        )
        text = " ".join(
            block.text for block in response.content
            if hasattr(block, "text")
        ).strip()
        # Clean up any AI preamble that leaked through
        for noise in ["Based on", "I can see", "Let me search", "The search results", "I notice", "I need to"]:
            if text.startswith(noise):
                # Find first sentence that looks like actual market data
                sentences = text.split(". ")
                text = ". ".join(s for s in sentences if any(w in s for w in ["S&P", "Nasdaq", "Dow", "market", "stock", "fell", "rose", "gained", "dropped", "declined"]))
        return {"narrative": text if text else "Market summary unavailable."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ─── Daily Tracker Endpoints ──────────────────────────────────────────────────

@router.post("/track-contracts")
async def track_contracts(contracts: list[dict]):
    """
    Register top-flow CONV contracts for daily OI/price tracking.
    Called automatically by the dashboard whenever new flow data loads.
    Body: [{sym, cp, K, exp, grade, dir, hits, prem}, ...]
    """
    from api.daily_tracker import register_contracts
    count = register_contracts(contracts)
    return {"status": "ok", "registered": count}


@router.get("/snapshot-now")
async def snapshot_now():
    """
    Manually trigger an OI/price snapshot for all registered contracts.
    Normally runs automatically at 4:30 PM ET on weekdays.
    """
    from api.daily_tracker import store_daily_snapshot
    result = await store_daily_snapshot()
    return result


@router.get("/contract-history")
async def contract_history(
    sym: str = Query(..., description="Ticker, e.g. AAPL"),
    cp: str = Query(..., description="C or P"),
    strike: float = Query(..., description="Strike price, e.g. 200"),
    exp: str = Query(..., description="Expiry M/D or M/D/YYYY, e.g. 3/20"),
):
    """
    Return daily OI/price snapshots for a single contract.
    Used by the hover chart in the dashboard to overlay historical tracking data.
    Response: {"history": [{"date":"3/14/2026","oi":5000,"price":2.50,"spot":198.0,"volume":1234}, ...]}
    """
    from api.daily_tracker import get_history
    history = get_history(sym, cp, strike, exp)
    return {"sym": sym, "cp": cp, "strike": strike, "exp": exp, "history": history}


@router.get("/backfill-contract")
async def backfill_contract_history(
    sym: str = Query(..., description="Ticker, e.g. NVDA"),
    cp: str = Query(..., description="C or P"),
    strike: float = Query(..., description="Strike price, e.g. 200"),
    exp: str = Query(..., description="Expiry M/D or M/D/YYYY, e.g. 4/2"),
    days_back: int = Query(60, description="How many calendar days to backfill"),
):
    """
    Backfill daily volume + close price from Polygon.io for a single contract.
    Merges into contract_history.json without overwriting existing OI from daily tracker.
    Requires POLYGON_API_KEY env var (free key at https://polygon.io).
    """
    from api.daily_tracker import backfill_contract
    result = await backfill_contract(sym, cp, strike, exp, days_back)
    return result


@router.post("/backfill-all")
async def backfill_all_contracts(days_back: int = 60):
    """
    Backfill Polygon history for all registered CONV contracts.
    Polygon free tier allows 5 req/min — adds 13s delay between contracts.
    For 6 CONV contracts, completes in ~75 seconds.
    """
    from api.daily_tracker import backfill_all_registered
    result = await backfill_all_registered(days_back)
    return result
