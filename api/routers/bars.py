"""OHLCV bar data endpoint — serves JSON bars for client-side charting (Lightweight Charts v5).

Daily/Weekly: Massive API (Polygon-compatible) via get_agg_bars()
Intraday (5/30/60 min): Massive API agg endpoint (yfinance fallback)
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from api.services.cache import cache
from api.services.massive import _get_client, _REST_BASE

router = APIRouter()

# yfinance period/interval config (same as charts.py)
_YF_CONFIG = {
    '5':  {'period': '5d',  'interval': '5m'},
    '30': {'period': '1mo', 'interval': '30m'},
    '60': {'period': '1mo', 'interval': '60m'},
}

# Ticker overrides for yfinance
_YF_TICKERS = {'VIX': '^VIX', 'BTC': 'BTC-USD'}

# Cache TTLs by timeframe (seconds)
_CACHE_TTL = {'5': 60, '30': 60, '60': 60, 'D': 300, 'W': 900}


def _resample_weekly(daily_bars: list[dict]) -> list[dict]:
    """Resample daily bars to weekly (ISO week grouping)."""
    if not daily_bars:
        return []
    weeks = {}
    for bar in daily_bars:
        # bar["t"] is unix ms from Massive
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        key = dt.isocalendar()[:2]  # (year, week)
        if key not in weeks:
            weeks[key] = {
                "dt": dt, "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": bar.get("v", 0),
            }
        else:
            w = weeks[key]
            w["h"] = max(w["h"], bar["h"])
            w["l"] = min(w["l"], bar["l"])
            w["c"] = bar["c"]
            w["v"] = w["v"] + bar.get("v", 0)
    result = []
    for w in sorted(weeks.values(), key=lambda x: x["dt"]):
        result.append({
            "t": w["dt"].strftime("%Y-%m-%d"),
            "o": w["o"], "h": w["h"], "l": w["l"], "c": w["c"], "v": w["v"],
        })
    return result


def _fetch_intraday_massive(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from Massive API agg endpoint.

    tf='5':  5-min bars, last 5 trading days
    tf='30': 30-min bars, last 30 trading days
    tf='60': 60-min bars, last 30 trading days
    """
    multiplier = int(tf)  # 5, 30, or 60
    lookback_days = 5 if tf == '5' else 30
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=lookback_days + 3)).strftime("%Y-%m-%d")

    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{ticker.upper()}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=5000&apiKey={client._api_key}"
        )
        data = client._get(url)
        results = data.get("results") or []
        if not results:
            return []
        bars = []
        for bar in results:
            bars.append({
                "t": int(bar["t"] / 1000),  # ms → unix seconds for LW Charts UTCTimestamp
                "o": round(bar["o"], 2),
                "h": round(bar["h"], 2),
                "l": round(bar["l"], 2),
                "c": round(bar["c"], 2),
                "v": int(bar.get("v", 0)),
            })
        return bars[-max_bars:]
    except Exception:
        return []


def _fetch_intraday_yfinance(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from yfinance (fallback)."""
    import yfinance as yf
    config = _YF_CONFIG.get(tf)
    if not config:
        return []
    yf_sym = _YF_TICKERS.get(ticker.upper(), ticker.upper())
    try:
        df = yf.Ticker(yf_sym).history(period=config["period"], interval=config["interval"])
        if df.empty:
            return []
        # Strip timezone
        if df.index.tzinfo is not None:
            df.index = df.index.tz_localize(None)
        bars = []
        for ts, row in df.iterrows():
            bars.append({
                "t": int(ts.timestamp()),  # unix seconds for LW Charts UTCTimestamp
                "o": round(row["Open"], 2),
                "h": round(row["High"], 2),
                "l": round(row["Low"], 2),
                "c": round(row["Close"], 2),
                "v": int(row.get("Volume", 0)),
            })
        return bars[-max_bars:]
    except Exception:
        return []


def _fetch_intraday(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars — Massive API primary, yfinance fallback."""
    bars = _fetch_intraday_massive(ticker, tf, max_bars)
    if bars:
        return bars
    return _fetch_intraday_yfinance(ticker, tf, max_bars)


def _fetch_daily(ticker: str, max_bars: int) -> list[dict]:
    """Fetch daily bars from Massive API."""
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=max_bars * 2)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    bars = []
    for bar in raw[-max_bars:]:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        bars.append({
            "t": dt.strftime("%Y-%m-%d"),  # BusinessDay format for LW Charts
            "o": round(bar["o"], 2),
            "h": round(bar["h"], 2),
            "l": round(bar["l"], 2),
            "c": round(bar["c"], 2),
            "v": int(bar.get("v", 0)),
        })
    return bars


def _fetch_weekly(ticker: str, max_bars: int) -> list[dict]:
    """Fetch weekly bars — daily from Massive, resampled to weekly."""
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    # ~3 years of daily data for weekly resampling
    from_date = (datetime.utcnow() - timedelta(days=max_bars * 10)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    weekly = _resample_weekly(raw)
    return weekly[-max_bars:]


@router.get("/api/bars/{ticker}")
def get_bars(
    ticker: str,
    tf: str = Query(default="D", description="Timeframe: 5, 30, 60, D, W"),
    bars: int = Query(default=200, ge=1, le=500, description="Max bars"),
):
    """Return OHLCV bars for client-side charting."""
    ticker_up = ticker.upper()
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    cached = cache.get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    if tf in ("5", "30", "60"):
        result_bars = _fetch_intraday(ticker_up, tf, bars)
    elif tf == "W":
        result_bars = _fetch_weekly(ticker_up, bars)
    else:
        result_bars = _fetch_daily(ticker_up, bars)

    payload = {"ticker": ticker_up, "tf": tf, "bars": result_bars}
    cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))

    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
    )
