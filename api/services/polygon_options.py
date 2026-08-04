"""Polygon (Massive) Options chain service — real Greeks, IV, OI, volume.

Uses the existing MASSIVE_API_KEY (Polygon Advanced tier, $200/mo gives
real-time NBBO + Greeks + IV + options trade flow). Replaces the
yfinance + Black-Scholes path with native exchange data.

Endpoints used:
  - /v3/snapshot/options/{underlying}              — full chain snapshot
  - /v3/snapshot/options/{underlying}/{contract}   — single contract detail
  - /v3/reference/options/contracts                — contract metadata
"""

import logging
import os
import time
from datetime import datetime
from typing import Any

import httpx

from api.services.cache import TTLCache
from api.services.massive import to_polygon_symbol

_log = logging.getLogger(__name__)

_BASE = "https://api.massive.com"
_TIMEOUT = 12
_CACHE = TTLCache()
_CHAIN_TTL = 60   # 1 min — Greeks move with underlying
_LIST_TTL = 3600  # 1 hour — expirations don't change intraday

_http = httpx.Client(
    timeout=httpx.Timeout(connect=3.0, read=15.0, write=5.0, pool=8.0),
    limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
    headers={"Accept": "application/json"},
)


def _api_key() -> str:
    return os.environ.get("MASSIVE_API_KEY", "").strip()


def _safe_get(url: str, params: dict | None = None) -> dict:
    key = _api_key()
    if not key:
        raise RuntimeError("MASSIVE_API_KEY not set")
    p = dict(params or {})
    p["apiKey"] = key
    r = _http.get(url, params=p, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def list_expirations(ticker: str) -> dict[str, Any]:
    """All upcoming expirations for a ticker via /v3/reference/options/contracts."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    api_sym = to_polygon_symbol(sym)

    # Cache key uses the MAPPED (Polygon dot-notation) form so a class-share
    # ticker's cache entry lines up with get_chain's — see to_polygon_symbol.
    cache_key = f"pgxopt::exps::{api_sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    today = datetime.utcnow().date().isoformat()
    try:
        data = _safe_get(
            f"{_BASE}/v3/reference/options/contracts",
            params={
                "underlying_ticker": api_sym,
                "expired": "false",
                "expiration_date.gte": today,
                "limit": 1000,
                "order": "asc",
                "sort": "expiration_date",
            },
        )
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon expirations fetch failed: %s", e)
        return {"error": f"polygon request failed: {e}", "ticker": sym}

    seen: list[str] = []
    for c in (data.get("results") or []):
        exp = c.get("expiration_date")
        if exp and exp not in seen:
            seen.append(exp)
    result = {"ticker": sym, "count": len(seen), "expirations": seen}
    _CACHE.set(cache_key, dict(result), _LIST_TTL)
    return result


def _normalize_contract(c: dict) -> dict:
    """Flatten Polygon's nested snapshot into a flat voice-friendly row."""
    details = c.get("details") or {}
    greeks = c.get("greeks") or {}
    day = c.get("day") or {}
    last_trade = c.get("last_trade") or {}
    last_quote = c.get("last_quote") or {}
    underlying = c.get("underlying_asset") or {}
    return {
        "contract": details.get("ticker"),
        "strike": details.get("strike_price"),
        "expiration": details.get("expiration_date"),
        "type": details.get("contract_type"),
        "shares_per_contract": details.get("shares_per_contract") or 100,
        # Pricing
        "bid": last_quote.get("bid"),
        "ask": last_quote.get("ask"),
        "last": last_trade.get("price"),
        "day_open": day.get("open"),
        "day_high": day.get("high"),
        "day_low": day.get("low"),
        "day_close": day.get("close"),
        "day_volume": day.get("volume"),
        "day_vwap": day.get("vwap"),
        # The real deal — exchange-derived
        "iv": c.get("implied_volatility"),
        "open_interest": c.get("open_interest"),
        "delta": greeks.get("delta"),
        "gamma": greeks.get("gamma"),
        "theta": greeks.get("theta"),
        "vega": greeks.get("vega"),
        # Underlying context
        "underlying_price": underlying.get("price"),
        "underlying_ticker": underlying.get("ticker"),
        "break_even": c.get("break_even_price"),
    }


def get_chain(ticker: str, expiration: str = "",
              strikes_around_spot: int = 6) -> dict[str, Any]:
    """Full chain snapshot with REAL exchange-derived Greeks + IV + OI.
    Returns N strikes either side of spot for both calls and puts."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    n = max(2, min(20, int(strikes_around_spot or 6)))
    api_sym = to_polygon_symbol(sym)
    # Cache key uses the MAPPED form — same reasoning as list_expirations.
    cache_key = f"pgxopt::chain::{api_sym}::{expiration}::{n}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        params: dict[str, Any] = {"limit": 250}
        if expiration:
            params["expiration_date"] = expiration
        results: list[dict] = []
        url = f"{_BASE}/v3/snapshot/options/{api_sym}"
        pages = 0
        start = time.monotonic()  # per-OPERATION pagination budget (below) — distinct
        # from the 12s per-request _TIMEOUT; a stuck/looping cursor must yield a
        # partial chain, not pin an anyio threadpool worker indefinitely.
        while url and pages < 8:  # 8 × 250 = 2000 contracts — beyond any single-expiry chain
            if pages > 0 and time.monotonic() - start > 20:
                _log.warning(
                    "polygon chain pagination for %s truncated by 20s wall-clock "
                    "budget after %d page(s) — returning partial chain", sym, pages,
                )
                break
            if pages == 0:
                data = _safe_get(url, params=params)
            else:
                sep = "&" if "?" in url else "?"
                r = _http.get(f"{url}{sep}apiKey={_api_key()}", timeout=_TIMEOUT)
                r.raise_for_status()
                data = r.json()
            results.extend(data.get("results") or [])
            url = data.get("next_url")
            pages += 1
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon chain fetch failed for %s: %s", sym, e)
        return {"error": f"polygon request failed: {e}", "ticker": sym}

    if not results:
        return {"error": "no chain data", "ticker": sym}

    # Spot price from first result's underlying
    spot = None
    for r in results:
        ua = r.get("underlying_asset") or {}
        if ua.get("price"):
            spot = float(ua["price"])
            break
    if spot is None:
        return {"error": "no underlying price in chain", "ticker": sym}

    normalized = [_normalize_contract(c) for c in results]

    # Split calls / puts and filter to N strikes around spot
    calls = [c for c in normalized if (c.get("type") or "").lower() == "call"]
    puts = [c for c in normalized if (c.get("type") or "").lower() == "put"]

    # If no expiration filter passed, narrow to the nearest expiration
    if not expiration and calls:
        # Pick the nearest non-zero-DTE expiration
        all_exps = sorted({c["expiration"] for c in calls if c.get("expiration")})
        if all_exps:
            target_exp = all_exps[0]
            calls = [c for c in calls if c.get("expiration") == target_exp]
            puts = [c for c in puts if c.get("expiration") == target_exp]
            expiration = target_exp

    def _around_spot(rows: list[dict]) -> list[dict]:
        valid = [r for r in rows if r.get("strike") is not None]
        valid.sort(key=lambda r: abs(float(r["strike"]) - spot))
        kept = valid[: n * 2]
        kept.sort(key=lambda r: float(r["strike"]))
        return kept

    out = {
        "ticker": sym,
        "expiration": expiration or None,
        "spot": round(spot, 2),
        "calls": _around_spot(calls),
        "puts": _around_spot(puts),
        "source": "polygon (Massive Advanced)",
    }
    _CACHE.set(cache_key, dict(out), _CHAIN_TTL)
    return out


def get_contract(ticker: str, strike: float, expiration: str,
                 call_or_put: str = "call") -> dict[str, Any]:
    """Single-contract snapshot with full Greeks + IV + OI."""
    sym = (ticker or "").upper().strip()
    side = (call_or_put or "call").lower().strip()
    if side not in ("call", "put"):
        return {"error": "call_or_put must be 'call' or 'put'"}
    if not sym or not strike or not expiration:
        return {"error": "ticker, strike, and expiration required"}

    # Get the chain (cheap, cached) and pick nearest strike
    chain = get_chain(sym, expiration=expiration, strikes_around_spot=20)
    if "error" in chain:
        return chain
    rows = chain["calls"] if side == "call" else chain["puts"]
    try:
        tgt = float(strike)
    except (TypeError, ValueError):
        return {"error": "strike must be numeric"}
    rows.sort(key=lambda r: abs(float(r.get("strike") or 0) - tgt))
    if not rows:
        return {"error": "no matching contract"}
    match = rows[0]
    return {
        "ticker": sym,
        "side": side,
        "expiration": chain["expiration"],
        "spot": chain["spot"],
        "source": "polygon (Massive Advanced)",
        **match,
    }
