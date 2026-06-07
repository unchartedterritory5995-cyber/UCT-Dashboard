"""
Schwab API Integration — OAuth2 + Option Chain Quotes
Endpoints used: Market Data Production (read-only, no trading)
"""

import os
import json
import time
import base64
import asyncio
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

# Persist to Railway volume (/data/) so tokens survive deploys
# Falls back to /tmp/ if volume not mounted
_DATA_DIR = Path("/data")
if _DATA_DIR.exists() and _DATA_DIR.is_dir():
    TOKEN_FILE = _DATA_DIR / "schwab_token.json"
else:
    TOKEN_FILE = Path(os.getenv("SCHWAB_TOKEN_PATH", "/tmp/schwab_token.json"))

_refresh_task = None


# ─── Token Management ────────────────────────────────────────────────────────────
def _get_basic_auth():
    """Base64 encode app_key:app_secret for token requests."""
    creds = f"{APP_KEY}:{APP_SECRET}"
    return base64.b64encode(creds.encode()).decode()


def save_tokens(tokens: dict):
    """Persist tokens to disk (Railway volume or /tmp fallback)."""
    tokens["saved_at"] = time.time()
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    print(f"[schwab] Tokens saved to {TOKEN_FILE}")


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

    # Check if contract is expired
    from datetime import datetime as dt, timedelta
    try:
        target = dt.strptime(exp_date, "%Y-%m-%d")
    except Exception:
        target = dt.now()
    
    today = dt.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if target < today:
        return {"error": f"Expired contract ({exp_date})", "expired": True}

    # Widen date range by ±5 days to handle off-by-one expiry dates
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
    FAST batch: groups contracts by symbol, fetches ONE chain per symbol,
    extracts all matching contracts from the response.
    20 contracts across 5 tickers = 5 API calls instead of 20.
    """
    token = await get_valid_token()
    if not token:
        return [{"error": "Not authenticated"}] * len(contracts)

    from datetime import datetime as dt, timedelta
    from collections import defaultdict

    today = dt.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Pre-filter: mark expired contracts, group rest by symbol
    by_symbol = defaultdict(list)
    expired_indices = set()
    for i, c in enumerate(contracts):
        try:
            exp = dt.strptime(c["expDate"], "%Y-%m-%d")
            if exp < today:
                expired_indices.add(i)
                continue
        except Exception:
            expired_indices.add(i)
            continue
        by_symbol[c["symbol"].upper()].append(c)

    # Fetch one chain per symbol
    results_map = {}  # key: "SYM|CP|STRIKE|EXPDATE" -> quote data

    async with httpx.AsyncClient(timeout=15.0) as client:
        for symbol, sym_contracts in by_symbol.items():
            # Find date range across all contracts for this symbol
            all_dates = []
            for c in sym_contracts:
                try:
                    d = dt.strptime(c["expDate"], "%Y-%m-%d")
                    all_dates.append(d)
                except Exception:
                    pass
            if not all_dates:
                continue
            from_date = (min(all_dates) - timedelta(days=5)).strftime("%Y-%m-%d")
            to_date = (max(all_dates) + timedelta(days=5)).strftime("%Y-%m-%d")

            # Determine if we need calls, puts, or both
            cps = set(c["cp"].upper() for c in sym_contracts)
            contract_type = "ALL" if len(cps) > 1 else ("CALL" if "C" in cps else "PUT")

            try:
                resp = await client.get(
                    CHAINS_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    params={
                        "symbol": symbol,
                        "contractType": contract_type,
                        "fromDate": from_date,
                        "toDate": to_date,
                        "includeUnderlyingQuote": "true",
                    },
                )
                if resp.status_code == 401:
                    new_tokens = await refresh_access_token()
                    if new_tokens:
                        token = new_tokens["access_token"]
                        resp = await client.get(
                            CHAINS_URL,
                            headers={"Authorization": f"Bearer {token}"},
                            params={
                                "symbol": symbol,
                                "contractType": contract_type,
                                "fromDate": from_date,
                                "toDate": to_date,
                                "includeUnderlyingQuote": "true",
                            },
                        )
                if resp.status_code != 200:
                    logger.warning("Chain fetch failed for %s: %s", symbol, resp.status_code)
                    continue

                data = resp.json()
                underlying = data.get("underlyingPrice", 0)

                # Parse all contracts from the chain into a flat lookup
                for chain_key in ["callExpDateMap", "putExpDateMap"]:
                    cp_letter = "C" if "call" in chain_key else "P"
                    exp_map = data.get(chain_key, {})
                    for exp_key, strikes in exp_map.items():
                        exp_date_str = exp_key.split(":")[0] if ":" in exp_key else exp_key
                        for strike_key, contract_list in strikes.items():
                            if contract_list and len(contract_list) > 0:
                                c = contract_list[0]
                                strike_val = float(strike_key)
                                k = f"{symbol}|{cp_letter}|{strike_val}|{exp_date_str}"
                                results_map[k] = {
                                    "symbol": symbol,
                                    "strike": strike_val,
                                    "expDate": exp_date_str,
                                    "cp": cp_letter,
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
                                    "underlyingPrice": underlying,
                                }
            except Exception as e:
                logger.warning("Chain fetch error for %s: %s", symbol, e)

    # Match requested contracts to chain data (fuzzy date match ±5 days)
    results = []
    for i, c in enumerate(contracts):
        if i in expired_indices:
            results.append({"symbol": c.get("symbol",""), "strike": float(c.get("strike",0)), "cp": c.get("cp",""), "error": f"Expired ({c.get('expDate','')})", "expired": True})
            continue
        sym = c["symbol"].upper()
        cp = c["cp"].upper()
        strike = float(c["strike"])
        try:
            target = dt.strptime(c["expDate"], "%Y-%m-%d")
        except Exception:
            results.append({"symbol": sym, "strike": strike, "error": "Bad date"})
            continue

        # Find best match within ±5 days
        best = None
        best_dist = 999
        for key, val in results_map.items():
            parts = key.split("|")
            if parts[0] == sym and parts[1] == cp and float(parts[2]) == strike:
                try:
                    exp_dt = dt.strptime(parts[3], "%Y-%m-%d")
                    dist = abs((exp_dt - target).days)
                    if dist < best_dist:
                        best_dist = dist
                        best = val
                except Exception:
                    pass
        if best and best_dist <= 5:
            results.append(best)
        else:
            results.append({"symbol": sym, "strike": strike, "cp": cp, "error": f"No match near {c['expDate']}"})

    return results


def is_authenticated() -> bool:
    """Check if we have tokens saved."""
    tokens = load_tokens()
    return tokens is not None and "access_token" in tokens


# ─── Market Index Quotes ─────────────────────────────────────────────────────────
MARKET_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
VIX_SYMBOLS = ["$VIX.X", "$VIX", "VIX", "UVXY"]  # Try multiple formats

async def get_market_summary() -> list[dict]:
    """Fetch current quotes for major indices."""
    token = await get_valid_token()
    if not token:
        return [{"error": "Not authenticated"}]

    display_names = {"SPY": "S&P 500", "QQQ": "NASDAQ", "DIA": "DOW 30", "IWM": "Russell 2000"}
    results = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Fetch main ETFs
        resp = await client.get(
            QUOTES_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={"symbols": ",".join(MARKET_SYMBOLS), "indicative": "false"},
        )
        if resp.status_code == 401:
            new_tokens = await refresh_access_token()
            if new_tokens:
                token = new_tokens["access_token"]
                resp = await client.get(
                    QUOTES_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    params={"symbols": ",".join(MARKET_SYMBOLS), "indicative": "false"},
                )
        if resp.status_code != 200:
            return [{"error": f"Schwab API error {resp.status_code}"}]

        data = resp.json()
        for sym in MARKET_SYMBOLS:
            q = data.get(sym, {})
            quote = q.get("quote", q)
            ref = q.get("reference", {})
            last = quote.get("lastPrice", quote.get("last", quote.get("regularMarketLastPrice", 0)))
            close = quote.get("closePrice", quote.get("previousClose", ref.get("previousClose", quote.get("regularMarketPreviousClose", 0))))
            change = last - close if last and close else 0
            pct = (change / close * 100) if close else 0
            results.append({
                "symbol": sym,
                "name": display_names.get(sym, sym),
                "price": round(last, 2),
                "change": round(change, 2),
                "pct": round(pct, 2),
            })

        # Try VIX symbols until one works
        vix_result = None
        for vix_sym in VIX_SYMBOLS:
            try:
                vresp = await client.get(
                    QUOTES_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    params={"symbols": vix_sym, "indicative": "true"},
                )
                if vresp.status_code == 200:
                    vdata = vresp.json()
                    vq = vdata.get(vix_sym, {})
                    vquote = vq.get("quote", vq)
                    vref = vq.get("reference", {})
                    vlast = vquote.get("lastPrice", vquote.get("last", vquote.get("mark", 0)))
                    vclose = vquote.get("closePrice", vquote.get("previousClose", vref.get("previousClose", 0)))
                    if vlast and vlast > 0:
                        vchange = vlast - vclose if vclose else 0
                        vpct = (vchange / vclose * 100) if vclose else 0
                        vix_result = {
                            "symbol": "VIX",
                            "name": "VIX",
                            "price": round(vlast, 2),
                            "change": round(vchange, 2),
                            "pct": round(vpct, 2),
                        }
                        logger.info("VIX loaded from symbol: %s = %s", vix_sym, vlast)
                        break
                    else:
                        logger.info("VIX symbol %s returned 0, trying next", vix_sym)
            except Exception as e:
                logger.info("VIX symbol %s failed: %s, trying next", vix_sym, e)

        if vix_result:
            results.append(vix_result)
        else:
            results.append({"symbol": "VIX", "name": "VIX", "price": 0, "change": 0, "pct": 0})
            logger.warning("No VIX symbol returned data")

    return results


# ─── Background Auto-Refresh ────────────────────────────────────────────────────
async def _auto_refresh_loop():
    """Refresh access token every 25 minutes so it never expires.
    Schwab access tokens last 30 min; refresh tokens last 7 days.
    As long as the app is running, users never need to re-authenticate.
    """
    while True:
        await asyncio.sleep(25 * 60)  # 25 minutes
        tokens = load_tokens()
        if tokens and "refresh_token" in tokens:
            logger.info("[schwab] Auto-refreshing access token...")
            result = await refresh_access_token()
            if result:
                logger.info("[schwab] Token auto-refreshed successfully.")
            else:
                logger.warning("[schwab] Token auto-refresh FAILED. Users may need to re-auth.")
        else:
            logger.info("[schwab] No refresh token found, skipping auto-refresh.")


def start_auto_refresh():
    """Start the background token refresh task. Call once at app startup."""
    global _refresh_task
    if _refresh_task is None or _refresh_task.done():
        _refresh_task = asyncio.create_task(_auto_refresh_loop())
        logger.info("[schwab] Auto-refresh task started. Token file: %s", TOKEN_FILE)


def stop_auto_refresh():
    """Stop the background refresh task."""
    global _refresh_task
    if _refresh_task and not _refresh_task.done():
        _refresh_task.cancel()
        logger.info("[schwab] Auto-refresh task stopped.")


async def get_mktcap_batch(symbols: list[str]) -> dict:
    """
    Fetch market cap for a batch of tickers. Tries Schwab first; on auth
    failure, empty response, or any unexpected shape, falls back to Yahoo's
    v7 quote endpoint (batch-capable, returns marketCap directly). The
    previous v8/finance/chart fallback was broken — that endpoint returns
    OHLC time series, not marketCap, so it silently produced 0 for every
    symbol and the whole batch came back as {}.

    Returns: { "AAPL": 2940000000000, "MSFT": 3100000000000, ... }
    Symbols missing from both providers are simply omitted.
    """
    results = {}
    symbols = [s.strip().upper() for s in symbols if s]
    if not symbols:
        return results

    token = await get_valid_token()

    # ── Path 1: Schwab (preferred — same auth path as the rest of the app) ──
    if token:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for i in range(0, len(symbols), 50):
                batch = symbols[i:i+50]
                try:
                    resp = await client.get(
                        QUOTES_URL,
                        headers={"Authorization": f"Bearer {token}"},
                        params={"symbols": ",".join(batch), "fields": "fundamental,quote", "indicative": "false"},
                    )
                    if resp.status_code == 401:
                        new_tokens = await refresh_access_token()
                        if new_tokens:
                            token = new_tokens["access_token"]
                            resp = await client.get(
                                QUOTES_URL,
                                headers={"Authorization": f"Bearer {token}"},
                                params={"symbols": ",".join(batch), "fields": "fundamental,quote", "indicative": "false"},
                            )
                    if resp.status_code == 200:
                        data = resp.json()
                        before = len(results)
                        for sym in batch:
                            q = data.get(sym, {}) or data.get(sym.upper(), {})
                            fund = q.get("fundamental", {}) or {}
                            # Schwab has been inconsistent here historically —
                            # accept several plausible field names so a rename
                            # on their side doesn't silently 0 us out again.
                            mc = (fund.get("marketCap") or fund.get("marketCapFloat")
                                  or fund.get("marketCapitalization") or 0)
                            if mc and mc > 0:
                                results[sym] = mc
                        if len(results) == before:
                            # Schwab returned 200 but no usable mktcap. Log the
                            # actual response shape once per batch so we can fix
                            # the selector instead of guessing.
                            sample = next(iter(data.items()), None)
                            logger.warning(
                                "[schwab] mktcap: no marketCap in response for batch %s. Sample: %s",
                                batch[:3], sample,
                            )
                    else:
                        logger.warning("[schwab] mktcap: HTTP %s for batch %s",
                                       resp.status_code, batch[:3])
                except Exception as e:
                    logger.warning("[schwab] mktcap batch error: %s", e)

    # If Schwab gave us full coverage, skip Yahoo
    missing = [s for s in symbols if s not in results]
    if not missing:
        return results

    # ── Path 2: Yahoo v7 quote (batch capable, returns marketCap field) ──
    # The /v7/finance/quote endpoint returns marketCap directly per symbol
    # in quoteResponse.result[]. Sometimes Yahoo demands a "crumb" cookie;
    # most of the time the bare call still works for US equities. We send
    # all missing symbols in one request (Yahoo allows ~200 per call).
    logger.info("[mktcap] Yahoo v7 fallback for %d symbol(s): %s", len(missing), missing[:5])
    ua = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        try:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v7/finance/quote",
                params={"symbols": ",".join(missing[:200])},
                headers={"User-Agent": ua, "Accept": "application/json"},
            )
            if resp.status_code == 200:
                items = (resp.json().get("quoteResponse", {}) or {}).get("result", []) or []
                for q in items:
                    sym = (q.get("symbol") or "").upper()
                    mc = q.get("marketCap") or 0
                    if sym and mc and mc > 0:
                        results[sym] = mc
            else:
                logger.warning("[mktcap] Yahoo v7 HTTP %s", resp.status_code)
        except Exception as e:
            logger.warning("[mktcap] Yahoo v7 error: %s", e)

    # ── Path 3: Yahoo v10 quoteSummary per-symbol (last resort) ──
    # Some symbols (recent IPOs, non-US listings) fail the v7 batch. Hit
    # quoteSummary one at a time as a final attempt. modules=price returns
    # marketCap.raw which is the canonical Yahoo number.
    still_missing = [s for s in missing if s not in results]
    if still_missing:
        logger.info("[mktcap] Yahoo v10 per-symbol fallback for %d: %s",
                    len(still_missing), still_missing[:5])
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            for sym in still_missing[:50]:
                try:
                    resp = await client.get(
                        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}",
                        params={"modules": "price"},
                        headers={"User-Agent": ua, "Accept": "application/json"},
                    )
                    if resp.status_code == 200:
                        result = (((resp.json().get("quoteSummary", {}) or {})
                                   .get("result", []) or [{}])[0])
                        price = result.get("price", {}) or {}
                        mc_obj = price.get("marketCap") or {}
                        mc = mc_obj.get("raw") if isinstance(mc_obj, dict) else mc_obj
                        if mc and mc > 0:
                            results[sym] = mc
                except Exception:
                    continue

    logger.info("[mktcap] Final: resolved %d/%d symbols", len(results), len(symbols))
    return results
