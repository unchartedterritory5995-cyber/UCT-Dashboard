"""
index_bars.py — yfinance-backed bars fetcher for cash-settled indexes that
Schwab's /pricehistory endpoint doesn't serve.

Why this exists:
  Schwab serves /pricehistory for ETFs (SPY, QQQ, IWM, DIA) but silently
  returns {"bars": []} for cash-settled index symbols (SPX, NDX, VIX, RUT,
  DJX, XSP, XND) — the /chains endpoint works for these (which is why GEX
  data loads), but /pricehistory does not. The fix is to route index
  symbols through a different data provider for the bars endpoint only.

Output format matches the existing /api/bars/{ticker} response shape:
  {"ticker": <original>, "tf": <tf>, "bars": [{t, o, h, l, c, v}, ...]}
  where t is unix seconds (UTC), o/h/l/c floats, v int.

XSP / XND / DJX are notional sub-units. We divide by their ratio so the
chart price aligns with option strikes (XSP $450 chart line lines up
with XSP options struck at $450). For SPX/NDX/VIX/RUT divisor == 1.

yfinance limits:
  1m bars      → max 7 days history
  2m-90m bars  → max 60 days history
  Daily+       → years of history

For typical GEX/swing-trading use (1d Daily setups + intraday confirm)
these limits are not a constraint. If 60d intraday becomes limiting,
the natural upgrade path is to swap yfinance for Polygon (Ravi already
has a Polygon API key from the breadth-indicator work) — same interface,
just replace fetch_index_bars internals.
"""

import logging
from typing import Optional

logger = logging.getLogger("index_bars")

# (Yahoo symbol, divisor to convert index level → option-strike scale)
INDEX_MAP = {
    "SPX": ("^GSPC", 1.0),
    "NDX": ("^NDX",  1.0),
    "VIX": ("^VIX",  1.0),
    "RUT": ("^RUT",  1.0),
    "DJX": ("^DJI",  100.0),   # DJX = Dow Jones / 100
    "XSP": ("^GSPC", 10.0),    # XSP = SPX / 10 (mini SPX option root)
    "XND": ("^NDX",  100.0),   # XND = NDX / 100 (micro NDX option root)
}
INDEX_TICKERS = frozenset(INDEX_MAP.keys())

# Map UI tf values to yfinance interval strings. Tolerates the lowercase
# variants the frontend occasionally sends.
TF_MAP = {
    "1":  "1m",  "5":  "5m",  "15": "15m",
    "30": "30m", "60": "60m", "1h": "60m",
    "D":  "1d",  "W":  "1wk", "M":  "1mo",
    "d":  "1d",  "w":  "1wk", "m":  "1mo",
}

# Largest period yfinance accepts per interval — exceeding these returns
# Yahoo's "1m data only available for last 7 days" rejection.
PERIOD_MAP = {
    "1m":  "7d",
    "2m":  "60d", "5m":  "60d", "15m": "60d", "30m": "60d",
    "60m": "60d", "90m": "60d",
    "1d":  "5y",  "5d":  "5y",  "1wk": "10y", "1mo": "max", "3mo": "max",
}


def is_index(ticker: str) -> bool:
    """True if the ticker should route through yfinance instead of Schwab.

    Use at the top of /api/bars/{ticker} to decide which fetcher to call.
    """
    return (ticker or "").upper().strip() in INDEX_TICKERS


def fetch_index_bars(ticker: str, tf: str = "D", bars: int = 600,
                     since: Optional[int] = None) -> dict:
    """Fetch OHLCV bars for an index symbol via yfinance.

    Args:
        ticker: original symbol (e.g., 'SPX')
        tf:     timeframe string from the UI (1/5/15/30/60/D/W/M)
        bars:   max number of bars to return (most recent N)
        since:  optional unix-seconds timestamp; returns only bars strictly
                newer than this (delta fetch). Quietly ignored if the
                yfinance period window doesn't reach back that far.

    Returns the standard bars response shape:
        {"ticker": ticker, "tf": tf, "bars": [{t, o, h, l, c, v}, ...]}

    On any error returns an empty bars array — matches Schwab's silent-empty
    behavior. The frontend already handles empty arrays gracefully, so the
    chart degrades to "no data" rather than throwing.

    NOTE on concurrency: this function is SYNCHRONOUS (yfinance uses
    requests internally). If your bars route is async, wrap the call:
        await asyncio.to_thread(fetch_index_bars, ticker, tf, bars, since)
    Otherwise you'll block the event loop for 200-2000ms per request.
    """
    sym = (ticker or "").upper().strip()
    if sym not in INDEX_MAP:
        return {"ticker": ticker, "tf": tf, "bars": []}

    yahoo_sym, divisor = INDEX_MAP[sym]
    interval = TF_MAP.get(tf)
    if not interval:
        logger.warning(f"[index_bars] unknown tf={tf!r} for {ticker}")
        return {"ticker": ticker, "tf": tf, "bars": []}

    try:
        import yfinance as yf
    except ImportError:
        logger.error("[index_bars] yfinance not installed — `pip install yfinance` "
                     "and add to requirements.txt")
        return {"ticker": ticker, "tf": tf, "bars": []}

    period = PERIOD_MAP.get(interval, "60d")
    try:
        # auto_adjust=False preserves raw OHLC (no dividend back-adjustment,
        # which is meaningless for indexes anyway but worth being explicit).
        # prepost=False keeps RTH-only bars, matching Schwab's convention so
        # the rest of the chart code doesn't see surprise session boundaries.
        df = yf.download(
            yahoo_sym,
            period=period,
            interval=interval,
            auto_adjust=False,
            prepost=False,
            progress=False,
            threads=False,  # safer in single-request serverless context
        )
    except Exception as e:
        logger.error(f"[index_bars] yfinance.download failed for "
                     f"{yahoo_sym} {interval}: {e}")
        return {"ticker": ticker, "tf": tf, "bars": []}

    if df is None or df.empty:
        logger.warning(f"[index_bars] yfinance returned empty for "
                       f"{yahoo_sym} {interval}")
        return {"ticker": ticker, "tf": tf, "bars": []}

    # yfinance flips to a MultiIndex column structure in some versions even
    # for a single ticker — flatten so row['Open'] etc. work uniformly.
    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)

    out = []
    for idx, row in df.iterrows():
        try:
            t = int(idx.timestamp())
            o = float(row["Open"])  / divisor
            h = float(row["High"])  / divisor
            l = float(row["Low"])   / divisor
            c = float(row["Close"]) / divisor
            v_raw = row.get("Volume", 0)
            # NaN-safe int conversion (volume is often 0 or NaN for indexes
            # since they don't trade as shares).
            v = int(v_raw) if v_raw == v_raw else 0
        except (KeyError, ValueError, TypeError, AttributeError):
            continue
        # Skip placeholder rows where OHLC came through as NaN (yfinance
        # occasionally emits these for non-trading sessions).
        if any(x != x for x in (o, h, l, c)):
            continue
        if since is not None and t <= since:
            continue
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})

    # yfinance returns the full period window; cap to most recent N bars.
    if len(out) > bars:
        out = out[-bars:]

    return {"ticker": ticker, "tf": tf, "bars": out}
