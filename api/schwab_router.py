"""
FastAPI router for Schwab API integration.
Add to main.py: from schwab_router import router as schwab_router
                 app.include_router(schwab_router)
"""

from fastapi import APIRouter, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse
from urllib.parse import urlparse, parse_qs
import schwab_service as schwab

router = APIRouter(prefix="/api/schwab", tags=["schwab"])


@router.get("/status")
async def schwab_status():
    """Check if Schwab API is connected."""
    authenticated = schwab.is_authenticated()
    return {
        "connected": authenticated,
        "hasAppKey": bool(schwab.APP_KEY),
        "message": "Connected to Schwab API" if authenticated else "Not connected. Visit /api/schwab/login to authenticate.",
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
