"""Options chain + Greeks for voice Compass.

Free starting point — yfinance for chain/IV/OI/volume, Black-Scholes for
Greeks (delta/gamma/theta/vega/rho). If reliability is poor in production,
upgrade to Polygon options (~$29/mo) or ORATS later — the voice tool
signatures stay the same.
"""

import logging
import math
from datetime import datetime, timezone
from typing import Any

import yfinance as yf
from scipy.stats import norm

from api.services import yf_util
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_CACHE = TTLCache()
_CACHE_TTL = 300  # 5 min — option chains move fast intraday

# Risk-free rate fallback when FRED isn't reachable. Refresh periodically.
_RFR_FALLBACK = 0.045


def _risk_free_rate() -> float:
    """Use the latest 3-month T-bill yield if FRED is wired, else fallback."""
    try:
        from api.services.fred_economic import get_series
        r = get_series("3m_yield", periods=1)
        latest = (r or {}).get("latest")
        if latest and isinstance(latest.get("value"), (int, float)):
            return float(latest["value"]) / 100.0
    except Exception:
        pass
    return _RFR_FALLBACK


def _black_scholes_greeks(spot: float, strike: float, T: float, r: float,
                          sigma: float, is_call: bool) -> dict[str, float]:
    """Standard Black-Scholes Greeks. T in years, sigma annualized IV.
    Returns delta, gamma, theta (per day), vega (per 1%), rho (per 1%)."""
    if T <= 0 or sigma <= 0 or spot <= 0 or strike <= 0:
        return {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    sqrt_T = math.sqrt(T)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    nd1 = norm.cdf(d1)
    nd2 = norm.cdf(d2)
    npd1 = norm.pdf(d1)
    if is_call:
        delta = nd1
        rho = strike * T * math.exp(-r * T) * nd2 / 100.0
        theta = (
            -(spot * npd1 * sigma) / (2 * sqrt_T)
            - r * strike * math.exp(-r * T) * nd2
        ) / 365.0
    else:
        delta = nd1 - 1.0
        rho = -strike * T * math.exp(-r * T) * (1 - nd2) / 100.0
        theta = (
            -(spot * npd1 * sigma) / (2 * sqrt_T)
            + r * strike * math.exp(-r * T) * (1 - nd2)
        ) / 365.0
    gamma = npd1 / (spot * sigma * sqrt_T)
    vega = (spot * npd1 * sqrt_T) / 100.0
    return {
        "delta": round(delta, 4),
        "gamma": round(gamma, 6),
        "theta": round(theta, 4),
        "vega": round(vega, 4),
        "rho": round(rho, 4),
    }


def _years_to_expiry(exp_str: str) -> float:
    try:
        exp = datetime.strptime(exp_str, "%Y-%m-%d").replace(
            hour=16, tzinfo=timezone.utc,  # 4pm ET-ish (use UTC for simplicity)
        )
        now = datetime.now(timezone.utc)
        days = max(0.0, (exp - now).total_seconds() / 86400.0)
        return days / 365.0
    except Exception:
        return 0.0


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _row_to_summary(row, spot: float, T: float, r: float, is_call: bool) -> dict[str, Any]:
    iv = _safe_float(row.get("impliedVolatility")) or 0.0
    strike = _safe_float(row.get("strike")) or 0.0
    greeks = _black_scholes_greeks(spot, strike, T, r, iv, is_call=is_call)
    return {
        "contract": row.get("contractSymbol"),
        "strike": strike,
        "last": _safe_float(row.get("lastPrice")),
        "bid": _safe_float(row.get("bid")),
        "ask": _safe_float(row.get("ask")),
        "iv": round(iv, 4),
        "volume": int(row.get("volume") or 0),
        "open_interest": int(row.get("openInterest") or 0),
        "in_the_money": bool(row.get("inTheMoney")),
        **greeks,
    }


def list_expirations(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    cache_key = f"opt::exps::{sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)
    try:
        exps = yf_util.bounded_call(lambda: list(yf.Ticker(sym).options or []), None)
        if exps is None:
            raise RuntimeError("bounded yfinance call returned no data")
    except Exception as e:
        _log.warning("yfinance options listing failed for %s: %s", sym, e)
        return {"error": f"yfinance options failed: {e}", "ticker": sym}
    out = {"ticker": sym, "count": len(exps), "expirations": exps}
    _CACHE.set(cache_key, dict(out), _CACHE_TTL)
    return out


def get_chain(ticker: str, expiration: str = "",
              strikes_around_spot: int = 6) -> dict[str, Any]:
    """Option chain for a ticker on a specific expiration (default = nearest).
    Returns ~strikes_around_spot strikes either side of spot for both call
    and put, with Greeks computed."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    cache_key = f"opt::chain::{sym}::{expiration}::{strikes_around_spot}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    # `.info`, `.options` and `.option_chain()` are three separate network
    # round-trips on the same Ticker — one guarded unit, one deadline. Splitting
    # them into three guarded calls would triple the pool traffic for one chain.
    def _read():
        t = yf.Ticker(sym)
        info = t.info or {}
        spot = _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
        if not spot:
            return {"error": "could not get spot price", "ticker": sym}
        exps = list(t.options or [])
        if not exps:
            return {"error": f"no options listed for {sym}"}
        exp_pick = expiration if expiration in exps else exps[0]
        return {"spot": spot, "exp": exp_pick, "chain": t.option_chain(exp_pick)}

    try:
        got = yf_util.bounded_call(_read, None)
        if got is None:
            raise RuntimeError("bounded yfinance call returned no data")
        if "error" in got:
            return got
        spot, exp, chain = got["spot"], got["exp"], got["chain"]
    except Exception as e:
        _log.warning("yfinance option_chain failed for %s %s: %s", sym, expiration, e)
        return {"error": f"yfinance chain failed: {e}", "ticker": sym}

    T = _years_to_expiry(exp)
    r = _risk_free_rate()
    n = max(2, min(15, int(strikes_around_spot or 6)))

    def _around_spot(df, is_call: bool):
        df = df.copy()
        df["distance"] = (df["strike"] - spot).abs()
        df = df.sort_values("distance").head(n * 2)
        df = df.sort_values("strike")
        return [_row_to_summary(r_, spot, T, r, is_call=is_call) for _, r_ in df.iterrows()]

    out = {
        "ticker": sym,
        "expiration": exp,
        "spot": round(spot, 2),
        "risk_free_rate": round(r, 4),
        "years_to_expiry": round(T, 4),
        "days_to_expiry": round(T * 365, 1),
        "calls": _around_spot(chain.calls, is_call=True),
        "puts": _around_spot(chain.puts, is_call=False),
    }
    _CACHE.set(cache_key, dict(out), _CACHE_TTL)
    return out


def get_contract(ticker: str, strike: float, expiration: str,
                 call_or_put: str = "call") -> dict[str, Any]:
    """Single contract quote + Greeks."""
    sym = (ticker or "").upper().strip()
    side = (call_or_put or "call").lower().strip()
    if side not in ("call", "put"):
        return {"error": "call_or_put must be 'call' or 'put'"}
    if not sym or not expiration or not strike:
        return {"error": "ticker, strike, and expiration are required"}

    chain = get_chain(sym, expiration=expiration, strikes_around_spot=15)
    if "error" in chain:
        return chain
    rows = chain["calls"] if side == "call" else chain["puts"]
    try:
        target_strike = float(strike)
    except (TypeError, ValueError):
        return {"error": "strike must be numeric"}
    # Nearest-strike match
    rows.sort(key=lambda x: abs((x.get("strike") or 0) - target_strike))
    if not rows:
        return {"error": "no matching contract"}
    match = rows[0]
    return {
        "ticker": sym,
        "expiration": chain["expiration"],
        "side": side,
        "spot": chain["spot"],
        **match,
    }
