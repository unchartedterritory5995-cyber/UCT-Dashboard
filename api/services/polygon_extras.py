"""Polygon Advanced extras — endpoints worth wiring beyond the bars +
options + news we already use.

All free with the $200/mo MASSIVE_API_KEY tier.

Exposes:
  - get_ticker_details(ticker)        — sector / industry / description / employees / etc
  - get_indices_snapshot([symbols])   — real-time SPX / NDX / RUT / VIX / DJI
  - get_upcoming_dividends(ticker, count)
  - get_recent_splits(ticker, count)
  - get_crypto_snapshot(symbol)       — BTC, ETH, etc. (X:BTCUSD format)
  - get_forex_snapshot(pair)          — EUR/USD, USD/JPY, etc. (C:EURUSD format)
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any

import httpx

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.massive.com"
_TIMEOUT = 12
_CACHE = TTLCache()

_TTL_DETAILS = 6 * 3600       # 6 hr — sector/industry doesn't change intraday
_TTL_INDICES = 30             # 30 sec — indices move tick-by-tick
_TTL_CORP_ACTIONS = 12 * 3600 # 12 hr — dividends/splits don't change often
_TTL_CRYPTO_FX = 15           # 15 sec — fast-moving

_http = httpx.Client(
    timeout=httpx.Timeout(connect=3.0, read=12.0, write=5.0, pool=8.0),
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


# ── 1. Ticker details ──────────────────────────────────────────────────────

def get_ticker_details(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    cache_key = f"pgxdet::{sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        data = _safe_get(f"{_BASE}/v3/reference/tickers/{sym}")
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon ticker details failed for %s: %s", sym, e)
        return {"error": f"polygon request failed: {e}", "ticker": sym}

    r = data.get("results") or {}
    if not r:
        return {"error": "not found", "ticker": sym}
    branding = r.get("branding") or {}
    addr = r.get("address") or {}

    result = {
        "ticker": r.get("ticker") or sym,
        "name": r.get("name"),
        "market": r.get("market"),                # stocks/crypto/fx/otc/indices
        "type": r.get("type"),                    # CS / ETF / ADR / etc
        "primary_exchange": r.get("primary_exchange"),
        "currency_name": r.get("currency_name"),
        "active": r.get("active"),
        "cik": r.get("cik"),
        "composite_figi": r.get("composite_figi"),
        "share_class_figi": r.get("share_class_figi"),
        "market_cap": r.get("market_cap"),
        "phone_number": r.get("phone_number"),
        "address": ", ".join(filter(None, [
            addr.get("address1"), addr.get("city"),
            addr.get("state"), addr.get("postal_code"),
        ])) or None,
        "description": (r.get("description") or "")[:1500],
        "sic_code": r.get("sic_code"),
        "sic_description": r.get("sic_description"),
        "homepage_url": r.get("homepage_url"),
        "total_employees": r.get("total_employees"),
        "list_date": r.get("list_date"),
        "weighted_shares_outstanding": r.get("weighted_shares_outstanding"),
        "logo_url": branding.get("logo_url"),
        "icon_url": branding.get("icon_url"),
        "source": "polygon (Massive Advanced)",
    }
    _CACHE.set(cache_key, dict(result), _TTL_DETAILS)
    return result


# ── 2. Indices snapshot ────────────────────────────────────────────────────

# Common index symbols — Polygon uses I: prefix for indices
_DEFAULT_INDICES = ["I:SPX", "I:NDX", "I:DJI", "I:RUT", "I:VIX"]
_INDEX_ALIASES = {
    "SPX": "I:SPX", "SP500": "I:SPX", "S&P": "I:SPX",
    "NDX": "I:NDX", "NASDAQ100": "I:NDX",
    "DJI": "I:DJI", "DOW": "I:DJI",
    "RUT": "I:RUT", "RUSSELL": "I:RUT",
    "VIX": "I:VIX",
}


def _resolve_index(sym: str) -> str:
    s = (sym or "").upper().strip()
    if s.startswith("I:"):
        return s
    return _INDEX_ALIASES.get(s, f"I:{s}")


def get_indices_snapshot(symbols: list[str] | str | None = None) -> dict[str, Any]:
    """Real-time snapshot for one or more indices."""
    if isinstance(symbols, str):
        items = [s.strip() for s in symbols.split(",") if s.strip()]
    elif isinstance(symbols, list):
        items = symbols
    else:
        items = _DEFAULT_INDICES
    if not items:
        items = _DEFAULT_INDICES
    resolved = [_resolve_index(s) for s in items][:10]

    cache_key = f"pgxidx::{','.join(resolved)}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        data = _safe_get(
            f"{_BASE}/v3/snapshot/indices",
            params={"ticker.any_of": ",".join(resolved)},
        )
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon indices fetch failed: %s", e)
        return {"error": f"polygon request failed: {e}"}

    out = []
    for r in (data.get("results") or []):
        sess = r.get("session") or {}
        out.append({
            "ticker": r.get("ticker"),
            "name": r.get("name"),
            "value": r.get("value"),
            "change": sess.get("change"),
            "change_pct": sess.get("change_percent"),
            "open": sess.get("open"),
            "high": sess.get("high"),
            "low": sess.get("low"),
            "previous_close": sess.get("previous_close"),
            "market_status": r.get("market_status"),
        })
    result = {"count": len(out), "indices": out, "source": "polygon"}
    _CACHE.set(cache_key, dict(result), _TTL_INDICES)
    return result


# ── 3. Upcoming dividends ──────────────────────────────────────────────────

def get_upcoming_dividends(ticker: str = "", count: int = 10) -> dict[str, Any]:
    """Upcoming dividends, optionally filtered by ticker."""
    sym = (ticker or "").upper().strip()
    count = max(1, min(50, int(count or 10)))
    cache_key = f"pgxdiv::{sym}::{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    today = datetime.utcnow().date().isoformat()
    params: dict[str, Any] = {
        "ex_dividend_date.gte": today,
        "limit": count,
        "order": "asc",
        "sort": "ex_dividend_date",
    }
    if sym:
        params["ticker"] = sym

    try:
        data = _safe_get(f"{_BASE}/v3/reference/dividends", params=params)
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon dividends fetch failed: %s", e)
        return {"error": f"polygon request failed: {e}"}

    items = []
    for r in (data.get("results") or [])[:count]:
        items.append({
            "ticker": r.get("ticker"),
            "cash_amount": r.get("cash_amount"),
            "currency": r.get("currency"),
            "declaration_date": r.get("declaration_date"),
            "ex_dividend_date": r.get("ex_dividend_date"),
            "record_date": r.get("record_date"),
            "pay_date": r.get("pay_date"),
            "frequency": r.get("frequency"),   # 1=annual, 4=quarterly, 12=monthly
            "dividend_type": r.get("dividend_type"),
        })
    result = {"count": len(items), "dividends": items, "source": "polygon"}
    _CACHE.set(cache_key, dict(result), _TTL_CORP_ACTIONS)
    return result


# ── 4. Recent + upcoming splits ────────────────────────────────────────────

def get_splits(ticker: str = "", count: int = 10, lookback_days: int = 90) -> dict[str, Any]:
    """Stock splits in the lookback window + any upcoming, optional ticker filter."""
    sym = (ticker or "").upper().strip()
    count = max(1, min(50, int(count or 10)))
    lookback_days = max(1, min(730, int(lookback_days or 90)))
    cache_key = f"pgxsplit::{sym}::{count}::{lookback_days}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    since = (datetime.utcnow().date() - timedelta(days=lookback_days)).isoformat()
    params: dict[str, Any] = {
        "execution_date.gte": since,
        "limit": count,
        "order": "desc",
        "sort": "execution_date",
    }
    if sym:
        params["ticker"] = sym

    try:
        data = _safe_get(f"{_BASE}/v3/reference/splits", params=params)
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon splits fetch failed: %s", e)
        return {"error": f"polygon request failed: {e}"}

    items = []
    for r in (data.get("results") or [])[:count]:
        items.append({
            "ticker": r.get("ticker"),
            "execution_date": r.get("execution_date"),
            "split_from": r.get("split_from"),
            "split_to": r.get("split_to"),
            "ratio": (f"{r.get('split_to')}:{r.get('split_from')}"
                      if r.get("split_to") and r.get("split_from") else None),
        })
    result = {"count": len(items), "splits": items, "source": "polygon"}
    _CACHE.set(cache_key, dict(result), _TTL_CORP_ACTIONS)
    return result


# ── 5. Crypto snapshot ─────────────────────────────────────────────────────

def get_crypto_snapshot(symbol: str = "BTCUSD") -> dict[str, Any]:
    s = (symbol or "BTCUSD").upper().strip().replace("-", "").replace("/", "")
    if not s.startswith("X:"):
        s = f"X:{s}"
    cache_key = f"pgxcrypto::{s}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        data = _safe_get(
            f"{_BASE}/v2/snapshot/locale/global/markets/crypto/tickers/{s}",
        )
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon crypto failed for %s: %s", s, e)
        return {"error": f"polygon request failed: {e}"}

    t = data.get("ticker") or {}
    day = t.get("day") or {}
    prev = t.get("prevDay") or {}
    result = {
        "ticker": t.get("ticker"),
        "last_trade_price": (t.get("lastTrade") or {}).get("p"),
        "day_open": day.get("o"),
        "day_high": day.get("h"),
        "day_low": day.get("l"),
        "day_close": day.get("c"),
        "day_volume": day.get("v"),
        "day_vwap": day.get("vw"),
        "prev_close": prev.get("c"),
        "change": t.get("todaysChange"),
        "change_pct": t.get("todaysChangePerc"),
        "source": "polygon",
    }
    _CACHE.set(cache_key, dict(result), _TTL_CRYPTO_FX)
    return result


# ── 6. Forex snapshot ──────────────────────────────────────────────────────

def get_forex_snapshot(pair: str = "EURUSD") -> dict[str, Any]:
    s = (pair or "EURUSD").upper().strip().replace("/", "").replace("-", "")
    if not s.startswith("C:"):
        s = f"C:{s}"
    cache_key = f"pgxfx::{s}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        data = _safe_get(
            f"{_BASE}/v2/snapshot/locale/global/markets/forex/tickers/{s}",
        )
    except RuntimeError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        _log.warning("polygon fx failed for %s: %s", s, e)
        return {"error": f"polygon request failed: {e}"}

    t = data.get("ticker") or {}
    day = t.get("day") or {}
    prev = t.get("prevDay") or {}
    quote = t.get("lastQuote") or {}
    result = {
        "ticker": t.get("ticker"),
        "bid": quote.get("b"),
        "ask": quote.get("a"),
        "day_open": day.get("o"),
        "day_high": day.get("h"),
        "day_low": day.get("l"),
        "day_close": day.get("c"),
        "prev_close": prev.get("c"),
        "change": t.get("todaysChange"),
        "change_pct": t.get("todaysChangePerc"),
        "source": "polygon",
    }
    _CACHE.set(cache_key, dict(result), _TTL_CRYPTO_FX)
    return result
