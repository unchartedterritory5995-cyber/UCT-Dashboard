"""Polygon (Massive) Options chain service — real Greeks, IV, OI, volume.

Uses the existing MASSIVE_API_KEY (Polygon Advanced tier, $200/mo gives
real-time NBBO + Greeks + IV + options trade flow). Replaces the
yfinance + Black-Scholes path with native exchange data.

TERM-069: this is the ONE options-chain implementation. The yfinance +
Black-Scholes leg (`options_chain.py`) is deleted, and nothing falls back to it;
tests/test_term069_chain_leg_retired.py rails that no second chain appears.

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
from zoneinfo import ZoneInfo

import httpx

from api.services import single_flight
from api.services.cache import TTLCache
from api.services.massive import to_polygon_symbol

_log = logging.getLogger(__name__)

_BASE = "https://api.massive.com"
_TIMEOUT = 12     # kept for importers; requests use the client's own Timeout below (S4)
_CACHE = TTLCache()
_CHAIN_TTL = 60   # 1 min — Greeks move with underlying
_LIST_TTL = 3600  # 1 hour — expirations don't change intraday
_ERROR_TTL = 20   # S3: a vendor failure is remembered briefly so a cold stampede pays it once
_EXP_QUERIES = 12  # forward-walk pages for list_expirations (each starts past the last date seen)
_EXP_MAX = 120     # expirations kept — SPY's dailies alone fill ~40, then monthlies, quarterlies, LEAPS
_EXP_BAND = 0.10   # O1: the walk reads CALLS within ±10% of spot only — a few strikes per expiry
_EXP_BUDGET_S = 20.0    # S4: list_expirations' overall wall-clock budget
_FLIGHT_WAIT_S = 60.0   # S3: a follower waits at most this long for the leader's fetch
_ET = ZoneInfo("America/New_York")

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
    # S4: no per-call `timeout=` — a bare number would REPLACE the client's connect/pool limits
    # with one flat value; the client's httpx.Timeout is the one policy.
    r = _http.get(url, params=p)
    r.raise_for_status()
    return r.json()


def _today_et():
    return datetime.now(_ET).date()


def _spot_hint(api_sym: str) -> float | None:
    """The underlying price, for list_expirations' strike band (O1). A cached chain answers for
    free; otherwise ONE snapshot row (limit=1) carries `underlying_asset.price`. None on any
    failure -- the walk then runs calls-only without a band, never guessing a price."""
    for key in _CACHE.keys_with_prefix(f"pgxopt::chain::{api_sym}::"):
        hit = _CACHE.get(key)
        if isinstance(hit, dict) and isinstance(hit.get("spot"), (int, float)) and hit["spot"] > 0:
            return float(hit["spot"])
    try:
        data = _safe_get(f"{_BASE}/v3/snapshot/options/{api_sym}", params={"limit": 1})
    except (RuntimeError, httpx.HTTPError, ValueError):
        return None
    for r in data.get("results") or []:
        try:
            px = float((r.get("underlying_asset") or {}).get("price"))
        except (TypeError, ValueError):
            continue
        if px > 0:
            return px
    return None


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
        return {**cached, "ticker": sym}

    def _lead() -> dict[str, Any]:
        hit = _CACHE.get(cache_key)
        if hit is not None:
            return dict(hit)
        return _walk_expirations(sym, api_sym, cache_key)

    try:
        out = single_flight.run(cache_key, _lead, wait=_FLIGHT_WAIT_S)
    except single_flight.SingleFlightTimeout:
        return {"error": "expirations fetch still in flight", "ticker": sym}
    return {**out, "ticker": sym}


def _walk_expirations(sym: str, api_sym: str, cache_key: str) -> dict[str, Any]:
    now_et = datetime.now(_ET)
    today = now_et.date().isoformat()
    # ⛔ ONE PAGE IS NOT THE LIST. The reference endpoint returns CONTRACTS, and a liquid
    # underlying has hundreds per expiration: 1,000 SPY contracts sorted by date covered only
    # THREE expirations (measured on production 2026-09-29 -- the member chain's picker offered
    # Wed/Thu/Fri and nothing else). So walk FORWARD: each query starts strictly after the last
    # date already seen, which is guaranteed new ground, bounded by _EXP_QUERIES and _EXP_MAX.
    # O1: even walking, 12 x 1,000 contracts of BOTH sides at EVERY strike ended SPY's list
    # ~7 weeks out. Every listed expiration has calls near the money, so reading CALLS within
    # ±_EXP_BAND of spot costs a handful of contracts per expiration and reaches the LEAPS.
    # Today's own expiration is dropped once the 16:00 ET close has passed.
    spot = _spot_hint(api_sym)
    seen: list[str] = []
    after = None
    complete = False
    start = time.monotonic()
    try:
        for i in range(_EXP_QUERIES):
            if i > 0 and time.monotonic() - start > _EXP_BUDGET_S:
                _log.warning("polygon expirations walk for %s stopped by the %.0fs budget "
                             "after %d page(s)", sym, _EXP_BUDGET_S, i)
                break
            params = {
                "underlying_ticker": api_sym,
                "contract_type": "call",
                "expired": "false",
                "limit": 1000,
                "order": "asc",
                "sort": "expiration_date",
            }
            if spot:
                params["strike_price.gte"] = round(spot * (1 - _EXP_BAND), 2)
                params["strike_price.lte"] = round(spot * (1 + _EXP_BAND), 2)
            if after:
                params["expiration_date.gt"] = after
            elif now_et.hour >= 16:
                params["expiration_date.gt"] = today
            else:
                params["expiration_date.gte"] = today
            data = _safe_get(f"{_BASE}/v3/reference/options/contracts", params=params)
            rows = data.get("results") or []
            for c in rows:
                exp = c.get("expiration_date")
                if exp and exp not in seen:
                    seen.append(exp)
            if not rows or len(rows) < 1000 or len(seen) >= _EXP_MAX:
                complete = True
                break
            after = seen[-1]
        # falling off the loop (page cap) or a budget break leaves `complete` False
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        if not seen:
            _log.warning("polygon expirations fetch failed: %s", e)
            err = {"error": f"polygon request failed: {e}", "ticker": sym}
            _CACHE.set(cache_key, dict(err), _ERROR_TTL)  # S3: one failure per stampede
            return err
        _log.warning("polygon expirations walk stopped early for %s: %s", sym, e)
        complete = False
    seen = seen[:_EXP_MAX]
    result = {"ticker": sym, "count": len(seen), "expirations": seen}
    if not complete:
        result["partial"] = True
    # A partial walk (budget, page cap, mid-walk error) is cached briefly so the next reader
    # retries soon; a complete list holds for the hour.
    _CACHE.set(cache_key, dict(result), _LIST_TTL if complete else 300)
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
        # BRK-01 increment 3: WHEN the bid/ask was quoted. The vol surface puts this on every
        # point it draws, and refuses a point that has none (api/services/vol_surface.py).
        "quote_time": _ns_to_iso(last_quote.get("last_updated")),
        "quote_timeframe": last_quote.get("timeframe"),
    }


def _ns_to_iso(ns) -> str | None:
    """Massive stamps a quote in Unix NANOSECONDS. None (never a guessed 'now') when absent."""
    try:
        v = int(ns)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    from datetime import timezone
    return datetime.fromtimestamp(v / 1e9, tz=timezone.utc).isoformat(timespec="seconds")


def get_chain(ticker: str, expiration: str = "",
              strikes_around_spot: int = 6, *,
              min_abs_delta: float | None = None,
              band_pct: float = 0.25) -> dict[str, Any]:
    """Full chain snapshot with REAL exchange-derived Greeks + IV + OI.

    Returns N strikes either side of spot for both calls and puts. With `min_abs_delta` (O2: the
    vol surface / RR-BF table), every further strike within ±`band_pct` of spot whose VENDOR
    |delta| is at least that value is kept too, so the 25- and 10-delta wings are reachable on a
    $1-strike name instead of stopping ~1.5% from spot.

    S3: the vendor walk is identical for every n, so it is fetched and cached ONCE per
    (symbol, expiration) -- untrimmed -- and trimmed per caller afterwards. Concurrent cold
    readers of one key share a single fetch (single flight); a vendor failure is cached for
    _ERROR_TTL so a stampede pays it once."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    n = max(2, min(20, int(strikes_around_spot or 6)))
    api_sym = to_polygon_symbol(sym)
    full = _full_chain(sym, api_sym, expiration)
    if "error" in full:
        return {**full, "ticker": sym} if "ticker" in full else dict(full)
    spot = full["spot"]
    return {
        "ticker": sym,
        "expiration": full["expiration"],
        "spot": round(spot, 2),
        "calls": _trim(full["calls"], spot, n, min_abs_delta, band_pct),
        "puts": _trim(full["puts"], spot, n, min_abs_delta, band_pct),
        "source": "polygon (Massive Advanced)",
    }


def _trim(rows: list[dict], spot: float, n: int, min_abs_delta: float | None,
          band_pct: float) -> list[dict]:
    """The n*2 strikes nearest spot, plus (when asked) the delta wings inside the band. Rows are
    COPIED so a caller sorting or editing them can never reach the shared cache entry."""
    valid = [r for r in rows if r.get("strike") is not None]
    valid.sort(key=lambda r: abs(float(r["strike"]) - spot))
    kept = valid[: n * 2]
    if min_abs_delta is not None:
        lo, hi = spot * (1 - band_pct), spot * (1 + band_pct)
        for r in valid[n * 2:]:
            d = r.get("delta")
            if (lo <= float(r["strike"]) <= hi and isinstance(d, (int, float))
                    and abs(d) >= min_abs_delta):
                kept.append(r)
    kept.sort(key=lambda r: float(r["strike"]))
    return [dict(r) for r in kept]


def _full_chain(sym: str, api_sym: str, expiration: str) -> dict[str, Any]:
    """The untrimmed, normalised chain for one (symbol, expiration), cached + single-flighted."""
    # Cache key uses the MAPPED form — same reasoning as list_expirations. No `n` in it (S3).
    cache_key = f"pgxopt::chain::{api_sym}::{expiration}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached

    def _lead() -> dict[str, Any]:
        hit = _CACHE.get(cache_key)
        if hit is not None:
            return hit
        return _fetch_chain(sym, api_sym, expiration, cache_key)

    try:
        return single_flight.run(cache_key, _lead, wait=_FLIGHT_WAIT_S)
    except single_flight.SingleFlightTimeout:
        return {"error": "chain fetch still in flight", "ticker": sym}


def _fetch_chain(sym: str, api_sym: str, expiration: str, cache_key: str) -> dict[str, Any]:
    def _fail(err: dict) -> dict:
        _CACHE.set(cache_key, err, _ERROR_TTL)
        return err

    try:
        params: dict[str, Any] = {"limit": 250}
        if expiration:
            params["expiration_date"] = expiration
        results: list[dict] = []
        url = f"{_BASE}/v3/snapshot/options/{api_sym}"
        pages = 0
        start = time.monotonic()  # per-OPERATION pagination budget (below) — distinct
        # from the client's per-request timeouts; a stuck/looping cursor must yield a
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
                r = _http.get(f"{url}{sep}apiKey={_api_key()}")
                r.raise_for_status()
                data = r.json()
            results.extend(data.get("results") or [])
            url = data.get("next_url")
            pages += 1
    except RuntimeError as e:
        return {"error": str(e)}  # no key: not a vendor answer, never cached
    except httpx.HTTPError as e:
        _log.warning("polygon chain fetch failed for %s: %s", sym, e)
        return _fail({"error": f"polygon request failed: {e}", "ticker": sym})

    if not results:
        return _fail({"error": "no chain data", "ticker": sym})

    # Spot price from first result's underlying
    spot = None
    for r in results:
        ua = r.get("underlying_asset") or {}
        if ua.get("price"):
            spot = float(ua["price"])
            break
    if spot is None:
        return _fail({"error": "no underlying price in chain", "ticker": sym})

    normalized = [_normalize_contract(c) for c in results]
    calls = [c for c in normalized if (c.get("type") or "").lower() == "call"]
    puts = [c for c in normalized if (c.get("type") or "").lower() == "put"]

    # If no expiration filter passed, narrow to the nearest expiration.
    if not expiration and calls:
        target_exp = default_expiration(c["expiration"] for c in calls if c.get("expiration"))
        if target_exp:
            calls = [c for c in calls if c.get("expiration") == target_exp]
            puts = [c for c in puts if c.get("expiration") == target_exp]
            expiration = target_exp

    full = {"expiration": expiration or None, "spot": spot, "calls": calls, "puts": puts}
    _CACHE.set(cache_key, full, _CHAIN_TTL)
    return full


def default_expiration(expirations, now: datetime | None = None) -> str | None:
    """O3: the nearest expiration AFTER today (ET) -- never the 0DTE one, which the chain's
    default view used to land on. After the 16:00 ET close today's expiry is gone anyway, so the
    rule is the same either side of the bell. Only when nothing later is listed does it fall back
    to the latest date on hand rather than to nothing."""
    exps = sorted({x for x in expirations if x})
    if not exps:
        return None
    today = (now.astimezone(_ET) if now else datetime.now(_ET)).date().isoformat()
    later = [x for x in exps if x > today]
    return later[0] if later else exps[-1]


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
