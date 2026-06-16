"""
index_bars.py — yfinance-backed bars fetcher for cash-settled indexes that
Schwab's /pricehistory endpoint doesn't serve.

Why this exists:
  Schwab serves /pricehistory for ETFs (SPY, QQQ, IWM, DIA) but silently
  returns {"bars": []} for cash-settled index symbols (SPX, NDX, VIX, RUT,
  DJX, XSP, XND) — the /chains endpoint works for these (which is why GEX
  data loads), but /pricehistory does not.

Two-tier fetch strategy:
  1. PRIMARY: yfinance with the Yahoo index symbol (^GSPC for SPX, ^NDX
     for NDX, etc.). Works reliably for daily/weekly/monthly.
  2. FALLBACK: for intraday timeframes (1/5/15/30/60m), if the primary
     returns sparse data (Yahoo's intraday history for index symbols is
     often just a few days or empty), fall back to the corresponding ETF
     × a dynamically-computed ratio that aligns the price scale with the
     option strikes (SPY × ~10 ≈ SPX).

The ETF-proxy ratio is computed at request time from the latest daily
close — this handles slow drift in ETF NAV vs index level over time
(SPY isn't exactly SPX/10 forever; the ratio shifts with dividend
distributions). Proxy only invoked when primary fails, so normal
Daily/Weekly/Monthly fetches keep using the true index series.

Output format matches the existing /api/bars/{ticker} response shape:
  {"ticker": <original>, "tf": <tf>, "bars": [{t, o, h, l, c, v}, ...]}
  where t is unix seconds (UTC), o/h/l/c floats, v int.

Volume bars are flat zero for true indexes. When the ETF proxy is used,
real SPY/QQQ/IWM volume IS preserved — useful as a sentiment proxy when
SPX is being charted.
"""

import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger("index_bars")

# (Yahoo symbol, divisor to convert index level → option-strike scale)
INDEX_MAP = {
    "SPX": ("^GSPC", 1.0),
    "NDX": ("^NDX",  1.0),
    "VIX": ("^VIX",  1.0),
    "RUT": ("^RUT",  1.0),
    "DJX": ("^DJI",  100.0),   # DJX = Dow Jones / 100
    "XSP": ("^GSPC", 10.0),    # XSP = SPX / 10
    "XND": ("^NDX",  100.0),   # XND = NDX / 100
}
INDEX_TICKERS = frozenset(INDEX_MAP.keys())

# ETF proxy — used when the index symbol returns sparse intraday.
# Map: original_symbol → (etf_symbol, target_yahoo_for_ratio_numerator)
#   ratio = latest_daily_close(target_yahoo) / latest_daily_close(etf)
#   bar_value = etf_value * ratio  (then ÷ original divisor for XSP/XND/DJX)
# VIX has no clean proxy (VXX is path-dependent), so no fallback for VIX.
ETF_PROXY = {
    "SPX": ("SPY", "^GSPC"),
    "XSP": ("SPY", "^GSPC"),
    "NDX": ("QQQ", "^NDX"),
    "XND": ("QQQ", "^NDX"),
    "RUT": ("IWM", "^RUT"),
    "DJX": ("DIA", "^DJI"),
}

# Map UI tf values to yfinance interval strings.
TF_MAP = {
    "1":  "1m",  "5":  "5m",  "15": "15m",
    "30": "30m", "60": "60m", "1h": "60m",
    "D":  "1d",  "W":  "1wk", "M":  "1mo",
    "d":  "1d",  "w":  "1wk", "m":  "1mo",
}

# Largest period yfinance accepts per interval.
PERIOD_MAP = {
    "1m":  "7d",
    "2m":  "60d", "5m":  "60d", "15m": "60d", "30m": "60d",
    "60m": "60d", "90m": "60d",
    "1d":  "5y",  "5d":  "5y",  "1wk": "10y", "1mo": "max", "3mo": "max",
}

INTRADAY_SPARSE_THRESHOLD = 10
INTRADAY_INTERVALS = frozenset({"1m", "2m", "5m", "15m", "30m", "60m", "90m"})


def is_index(ticker: str) -> bool:
    """True if the ticker should route through yfinance instead of Schwab."""
    return (ticker or "").upper().strip() in INDEX_TICKERS


def _fetch_yf(yahoo_sym: str, interval: str, period: str,
              divisor: float, since: Optional[int]) -> List[Dict[str, Any]]:
    """Pull bars from yfinance and convert to {t,o,h,l,c,v}. Returns []
    on any failure — caller decides whether to retry / fall back.
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.error("[index_bars] yfinance not installed")
        return []

    try:
        df = yf.download(
            yahoo_sym,
            period=period,
            interval=interval,
            auto_adjust=False,
            prepost=False,
            progress=False,
            threads=False,
        )
    except Exception as e:
        logger.error(f"[index_bars] yfinance.download failed for "
                     f"{yahoo_sym} {interval} {period}: {e}")
        return []

    if df is None or df.empty:
        return []

    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)

    out: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        try:
            t = int(idx.timestamp())
            o = float(row["Open"])  / divisor
            h = float(row["High"])  / divisor
            l = float(row["Low"])   / divisor
            c = float(row["Close"]) / divisor
            v_raw = row.get("Volume", 0)
            v = int(v_raw) if v_raw == v_raw else 0
        except (KeyError, ValueError, TypeError, AttributeError):
            continue
        if any(x != x for x in (o, h, l, c)):
            continue
        if since is not None and t <= since:
            continue
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def _proxy_ratio(target_yahoo: str, etf_sym: str) -> Optional[float]:
    """Compute index_level / etf_price from latest daily close so ETF-proxied
    bars scale to match the index. Returns None on failure.

    Done off the daily series because daily data is reliable for both sides
    and the ratio shifts slowly anyway (dividend distributions ~quarterly).
    """
    try:
        import yfinance as yf
        idx_df = yf.download(target_yahoo, period="5d", interval="1d",
                             auto_adjust=False, progress=False, threads=False)
        etf_df = yf.download(etf_sym, period="5d", interval="1d",
                             auto_adjust=False, progress=False, threads=False)
        if idx_df is None or idx_df.empty or etf_df is None or etf_df.empty:
            return None
        if hasattr(idx_df.columns, "nlevels") and idx_df.columns.nlevels > 1:
            idx_df.columns = idx_df.columns.get_level_values(0)
        if hasattr(etf_df.columns, "nlevels") and etf_df.columns.nlevels > 1:
            etf_df.columns = etf_df.columns.get_level_values(0)
        idx_close = float(idx_df["Close"].iloc[-1])
        etf_close = float(etf_df["Close"].iloc[-1])
        if etf_close <= 0:
            return None
        return idx_close / etf_close
    except Exception as e:
        logger.warning(f"[index_bars] proxy ratio fetch failed "
                       f"({target_yahoo}/{etf_sym}): {e}")
        return None


def fetch_index_bars(ticker: str, tf: str = "D", bars: int = 600,
                     since: Optional[int] = None) -> dict:
    """Fetch OHLCV bars for an index symbol.

    Strategy:
      Daily/Weekly/Monthly  → ^GSPC etc. directly (reliable)
      Intraday              → ^GSPC first, fall back to SPY × ratio if sparse

    NOTE: synchronous (yfinance uses requests internally). FastAPI runs sync
    route handlers in its thread pool, so blocking here doesn't stall the
    event loop. If invoked from async code, wrap with asyncio.to_thread.
    """
    sym = (ticker or "").upper().strip()
    if sym not in INDEX_MAP:
        return {"ticker": ticker, "tf": tf, "bars": []}

    yahoo_sym, divisor = INDEX_MAP[sym]
    interval = TF_MAP.get(tf)
    if not interval:
        logger.warning(f"[index_bars] unknown tf={tf!r} for {ticker}")
        return {"ticker": ticker, "tf": tf, "bars": []}

    period = PERIOD_MAP.get(interval, "60d")

    # PRIMARY: index symbol directly.
    out = _fetch_yf(yahoo_sym, interval, period, divisor, since)

    # FALLBACK: for intraday, if the index symbol returned sparse data,
    # try the ETF proxy. Common for ^GSPC/^NDX — Yahoo's intraday history
    # for cash indexes is intermittent vs the rock-solid ETF series.
    if (interval in INTRADAY_INTERVALS
            and len(out) < INTRADAY_SPARSE_THRESHOLD
            and sym in ETF_PROXY):
        etf_sym, ratio_target = ETF_PROXY[sym]
        logger.info(f"[index_bars] {sym} {interval} returned {len(out)} bars "
                    f"from {yahoo_sym}; trying ETF proxy {etf_sym}")
        ratio = _proxy_ratio(ratio_target, etf_sym)
        if ratio is not None:
            # Combined divisor: scale ETF → index level (via ratio), then
            # ÷ divisor for XSP/XND/DJX. For SPX/NDX/RUT divisor==1.
            proxy_div = divisor / ratio
            proxy_out = _fetch_yf(etf_sym, interval, period, proxy_div, since)
            if len(proxy_out) > len(out):
                logger.info(f"[index_bars] proxy {etf_sym} returned "
                            f"{len(proxy_out)} bars — using proxy")
                out = proxy_out

    if len(out) > bars:
        out = out[-bars:]

    return {"ticker": ticker, "tf": tf, "bars": out}
