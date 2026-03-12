"""
Schwab API Integration — OAuth2 + Option Chain Quotes
Endpoints used: Market Data Production (read-only, no trading)
"""

import os
import json
import time
import base64
import logging
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("schwab")

# ─── Config ─────────────────────────────────────────────────────────────────────
APP_KEY = os.getenv("SCHWAB_APP_KEY", "")
APP_SECRET = os.getenv("SCHWAB_APP_SECRET", "")
# For initial auth flow, use the Railway callback; for local dev, use 127.0.0.1
CALLBACK_URL = os.getenv("SCHWAB_CALLBACK_URL", "https://127.0.0.1")

AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize"
TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token"
CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"
QUOTES_URL = "https://api.schwabapi.com/marketdata/v1/quotes"

TOKEN_FILE = Path(os.getenv("SCHWAB_TOKEN_PATH", "/tmp/schwab_token.json"))


# ─── Token Management ────────────────────────────────────────────────────────────
def _get_basic_auth():
    """Base64 encode app_key:app_secret for token requests."""
    creds = f"{APP_KEY}:{APP_SECRET}"
    return base64.b64encode(creds.encode()).decode()


def save_tokens(tokens: dict):
    """Persist tokens to disk (or env var for Railway)."""
    tokens["saved_at"] = time.time()
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    logger.info("Tokens saved to %s", TOKEN_FILE)


def load_tokens() -> dict | None:
    """Load tokens from disk."""
    if TOKEN_FILE.exists():
        try:
            return json.loads(TOKEN_FILE.read_text())
        except Exception:
            return None
    # Also check env var (for Railway persistent config)
    env_token = os.getenv("SCHWAB_TOKEN_JSON")
    if env_token:
        try:
            return json.loads(env_token)
        except Exception:
            return None
    return None


def get_auth_url() -> str:
    """Generate the Schwab OAuth login URL."""
    params = {
        "client_id": APP_KEY,
        "redirect_uri": CALLBACK_URL,
        "response_type": "code",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            headers={
                "Authorization": f"Basic {_get_basic_auth()}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": CALLBACK_URL,
            },
        )
        resp.raise_for_status()
        tokens = resp.json()
        save_tokens(tokens)
        return tokens


async def refresh_access_token() -> dict | None:
    """Use refresh token to get a new access token."""
    tokens = load_tokens()
    if not tokens or "refresh_token" not in tokens:
        return None

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TOKEN_URL,
            headers={
                "Authorization": f"Basic {_get_basic_auth()}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "refresh_token",
                "refresh_token": tokens["refresh_token"],
            },
        )
        if resp.status_code != 200:
            logger.error("Token refresh failed: %s %s", resp.status_code, resp.text)
            return None
        new_tokens = resp.json()
        # Preserve refresh token if not returned
        if "refresh_token" not in new_tokens:
            new_tokens["refresh_token"] = tokens["refresh_token"]
        save_tokens(new_tokens)
        return new_tokens


async def get_valid_token() -> str | None:
    """Get a valid access token, refreshing if needed."""
    tokens = load_tokens()
    if not tokens:
        return None

    # Check if access token is still valid (~30 min lifetime)
    saved_at = tokens.get("saved_at", 0)
    expires_in = tokens.get("expires_in", 1800)
    if time.time() - saved_at > (expires_in - 60):  # refresh 1 min early
        logger.info("Access token expired, refreshing...")
        tokens = await refresh_access_token()
        if not tokens:
            return None

    return tokens.get("access_token")


# ─── Option Chain Quotes ─────────────────────────────────────────────────────────
async def get_option_quote(symbol: str, strike: float, exp_date: str, cp: str) -> dict | None:
    """
    Fetch current price for a specific option contract.
    symbol: e.g. "AAPL"
    strike: e.g. 250.0
    exp_date: e.g. "2026-03-20" (YYYY-MM-DD)
    cp: "C" or "P"
    """
    token = await get_valid_token()
    if not token:
        return {"error": "Not authenticated. Visit /api/schwab/login to connect."}

    contract_type = "CALL" if cp.upper() == "C" else "PUT"

    # Widen date range by ±5 days to handle off-by-one expiry dates
    # (CSV might say 1/16 but actual expiry is 1/15 — the 3rd Friday)
    from datetime import datetime as dt, timedelta
    try:
        target = dt.strptime(exp_date, "%Y-%m-%d")
    except Exception:
        target = dt.now()
    from_date = (target - timedelta(days=5)).strftime("%Y-%m-%d")
    to_date = (target + timedelta(days=5)).strftime("%Y-%m-%d")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            CHAINS_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={
                "symbol": symbol.upper(),
                "contractType": contract_type,
                "strike": strike,
                "fromDate": from_date,
                "toDate": to_date,
                "includeUnderlyingQuote": "true",
            },
        )
        if resp.status_code == 401:
            # Try refresh and retry once
            tokens = await refresh_access_token()
            if tokens:
                resp = await client.get(
                    CHAINS_URL,
                    headers={"Authorization": f"Bearer {tokens['access_token']}"},
                    params={
                        "symbol": symbol.upper(),
                        "contractType": contract_type,
                        "strike": strike,
                        "fromDate": from_date,
                        "toDate": to_date,
                        "includeUnderlyingQuote": "true",
                    },
                )
        if resp.status_code != 200:
            return {"error": f"Schwab API error {resp.status_code}: {resp.text[:200]}"}

        data = resp.json()

        # Parse the nested option chain response
        chain_key = "callExpDateMap" if cp.upper() == "C" else "putExpDateMap"
        exp_map = data.get(chain_key, {})

        # Find the closest expiration to our target date
        best_contract = None
        best_distance = float("inf")
        for exp_key, strikes in exp_map.items():
            # exp_key looks like "2027-01-15:5" — parse the date part
            exp_date_str = exp_key.split(":")[0] if ":" in exp_key else exp_key
            try:
                exp_dt = dt.strptime(exp_date_str, "%Y-%m-%d")
                distance = abs((exp_dt - target).days)
            except Exception:
                distance = 999

            for strike_key, contracts in strikes.items():
                if contracts and len(contracts) > 0 and distance < best_distance:
                    best_distance = distance
                    best_contract = contracts[0]
                    best_contract["_matched_exp"] = exp_date_str

        if best_contract:
            c = best_contract
            return {
                "symbol": symbol.upper(),
                "strike": strike,
                "expDate": c.get("_matched_exp", exp_date),
                "cp": cp.upper(),
                "bid": c.get("bid", 0),
                "ask": c.get("ask", 0),
                "last": c.get("last", 0),
                "mark": c.get("mark", 0),
                "volume": c.get("totalVolume", 0),
                "openInterest": c.get("openInterest", 0),
                "iv": c.get("volatility", 0),
                "delta": c.get("delta", 0),
                "gamma": c.get("gamma", 0),
                "theta": c.get("theta", 0),
                "underlyingPrice": data.get("underlyingPrice", 0),
            }

        return {"error": f"No contract found for {symbol} {strike}{cp} near {exp_date}"}


async def get_batch_option_quotes(contracts: list[dict]) -> list[dict]:
    """
    Fetch prices for multiple contracts.
    Each contract: { "symbol": "AAPL", "strike": 250, "expDate": "2026-03-20", "cp": "C" }
    """
    results = []
    for contract in contracts:
        try:
            result = await get_option_quote(
                contract["symbol"],
                float(contract["strike"]),
                contract["expDate"],
                contract["cp"],
            )
            results.append(result or {"error": "No result"})
        except Exception as e:
            results.append({
                "symbol": contract.get("symbol"),
                "strike": contract.get("strike"),
                "error": str(e),
            })
    return results


def is_authenticated() -> bool:
    """Check if we have tokens saved."""
    tokens = load_tokens()
    return tokens is not None and "access_token" in tokens
