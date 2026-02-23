"""Service layer calling Massive.com REST API directly.

Provides get_snapshot() and get_movers() with TTL caching.
Calls https://api.massive.com using MASSIVE_API_KEY env var.

No dependency on the local uct-intelligence package — works on Railway.
"""
import json
import os
import urllib.request
from typing import Any

from api.services.cache import cache

_REST_BASE = "https://api.massive.com"

_client = None


class _MassiveRestClient:
    """Lightweight REST client wrapping the Massive.com API directly.

    Polygon.io-compatible API at api.massive.com.
    Uses MASSIVE_API_KEY from environment variables.
    """

    def __init__(self):
        self._api_key = os.environ.get("MASSIVE_API_KEY", "")
        if not self._api_key:
            raise RuntimeError("MASSIVE_API_KEY not set in environment")

    def _get(self, url: str, timeout: int = 15) -> dict:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_top_movers(self, direction: str = "gainers", limit: int = 20) -> list:
        """Return top gaining or losing stocks for the current session.

        Returns list of dicts: ticker, change_pct, change, close, volume
        """
        if direction not in ("gainers", "losers"):
            raise ValueError("direction must be 'gainers' or 'losers'")
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/{direction}"
            f"?apiKey={self._api_key}"
        )
        data = self._get(url)
        result = []
        for t in data.get("tickers", [])[:limit]:
            day = t.get("day", {})
            result.append({
                "ticker":     t.get("ticker", ""),
                "change_pct": round(float(t.get("todaysChangePerc", 0.0)), 2),
                "change":     round(float(t.get("todaysChange", 0.0)), 4),
                "close":      day.get("c", 0.0),
                "volume":     int(float(day.get("v", 0) or 0)),
            })
        return result

    def get_single_ticker_snapshot(self, ticker: str) -> dict:
        """Return real-time snapshot for a single US equity ticker.

        Returns dict with: close, vwap, change_pct, change
        Returns empty dict if not found or on error.
        """
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
            f"/{ticker.upper()}?apiKey={self._api_key}"
        )
        try:
            data = self._get(url)
        except Exception:
            return {}

        if data.get("status") not in ("OK", "DELAYED"):
            return {}

        t = data.get("ticker", {})
        if not t:
            return {}

        day  = t.get("day", {})
        return {
            "close":      day.get("c", 0.0),
            "vwap":       day.get("vw", 0.0),
            "change_pct": round(float(t.get("todaysChangePerc", 0.0)), 4),
            "change":     round(float(t.get("todaysChange", 0.0)), 4),
        }


def _get_client() -> _MassiveRestClient:
    """Return a shared _MassiveRestClient instance, initializing on first call."""
    global _client
    if _client is None:
        try:
            _client = _MassiveRestClient()
        except Exception as e:
            raise RuntimeError(f"Failed to initialize Massive client: {e}")
    return _client


def _fmt_price(val) -> str:
    """Format a float price with comma-thousands and 2 decimals."""
    try:
        f = float(val)
        if f >= 1000:
            return f"{f:,.2f}"
        return f"{f:.2f}"
    except (TypeError, ValueError):
        return str(val)


def _fmt_chg(pct: float) -> tuple[str, str]:
    """Return (formatted change string, css class string) for a % change value."""
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.2f}%", ("pos" if pct >= 0 else "neg")


# ── Liquidity filter thresholds ───────────────────────────────────────────────
_PRICE_MIN    = 2.0          # price must be strictly above $2
_PM_VOL_MIN   = 50_000       # min shares in current session (pre-market at open)
_AVG_DVOL_MIN = 10_000_000   # min 5-day avg dollar volume ($10M)


def _get_avg_dollar_vol(tickers: list) -> dict[str, float]:
    """Return 5-day average dollar volume for each ticker via yfinance.

    Fetches all tickers in parallel (ThreadPoolExecutor).
    Returns float("inf") for any ticker where history cannot be fetched —
    meaning it will NOT be filtered out if yfinance is unavailable.
    """
    if not tickers:
        return {}
    try:
        import yfinance as yf
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def _fetch_one(ticker: str) -> tuple[str, float]:
            try:
                hist = yf.Ticker(ticker).history(period="10d")
                if hist.empty:
                    return ticker, 0.0
                dvol = (hist["Close"] * hist["Volume"]).tail(5)
                return ticker, float(dvol.mean()) if not dvol.empty else 0.0
            except Exception:
                return ticker, float("inf")  # can't fetch → don't filter out

        with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as ex:
            result = dict(f.result() for f in as_completed(ex.submit(_fetch_one, t) for t in tickers))
        return result
    except Exception:
        return {t: float("inf") for t in tickers}


def _yfinance_snapshot(ticker: str) -> dict:
    """Fetch latest price via yfinance (used for futures/crypto not in Massive equities)."""
    try:
        import yfinance as yf
        hist = yf.Ticker(ticker).history(period="2d")
        if hist.empty:
            return {}
        close = float(hist["Close"].iloc[-1])
        prev  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else close
        chg_pct = (close - prev) / prev * 100 if prev else 0.0
        return {"close": close, "vwap": close, "change_pct": round(chg_pct, 4)}
    except Exception:
        return {}


def get_snapshot() -> dict:
    """Return formatted market snapshot with futures and ETF prices.

    ETFs (QQQ, SPY, IWM, DIA, VIX): Massive REST API snapshot.
    Futures (NQ, ES, RTY, BTC): yfinance fallback (futures not in equities API).

    Returns:
        {
          "futures": {"NQ": {"price": "...", "chg": "...", "css": "pos|neg"}, ...},
          "etfs":    {"QQQ": {"price": "...", "chg": "...", "css": "pos|neg"}, ...},
        }

    Raises RuntimeError on Massive client failure (caller handles with 503).
    """
    cached = cache.get("snapshot")
    if cached is not None:
        return cached

    client = _get_client()

    etf_tickers = ["QQQ", "SPY", "IWM", "DIA", "VIX"]
    futures_map = {"NQ": "NQ=F", "ES": "ES=F", "RTY": "RTY=F", "BTC": "BTC-USD"}

    def _make_entry(snap: dict) -> dict[str, Any]:
        price   = snap.get("close") or snap.get("vwap") or 0.0
        chg_pct = snap.get("change_pct") or 0.0
        chg_str, css = _fmt_chg(float(chg_pct))
        return {"price": _fmt_price(price), "chg": chg_str, "css": css}

    etfs = {}
    for ticker in etf_tickers:
        try:
            snap = client.get_single_ticker_snapshot(ticker)
            etfs[ticker] = _make_entry(snap) if snap else {"price": "—", "chg": "—", "css": ""}
        except Exception:
            etfs[ticker] = {"price": "—", "chg": "—", "css": ""}

    futures = {}
    for label, yf_ticker in futures_map.items():
        snap = _yfinance_snapshot(yf_ticker)
        futures[label] = _make_entry(snap) if snap else {"price": "—", "chg": "—", "css": ""}

    data = {"futures": futures, "etfs": etfs}
    cache.set("snapshot", data, ttl=15)
    return data


def get_movers() -> dict:
    """Return top gainers and losers passing all liquidity filters.

    Filters (applied in order):
      1. Gap ≥ 3%          — abs(change_pct) >= 3.0
      2. Price > $2        — close > 2.0
      3. PM volume ≥ 50K   — session shares traded >= 50,000
      4. Avg 5d dvol ≥ $10M — 5-day avg (close × volume) >= $10M (via yfinance)

    Primary source: Massive REST API (live, 30s TTL).
    Fallback: movers from last engine wire_data push (daily at 7:35 AM ET).

    Returns:
        {
          "ripping":  [{"sym": "TICK", "pct": "+34.40%"}, ...],
          "drilling": [{"sym": "TICK", "pct": "-50.55%"}, ...],
        }
    """
    cached = cache.get("movers")
    if cached is not None:
        return cached

    try:
        client = _get_client()

        gainers_raw = client.get_top_movers(direction="gainers", limit=20)
        losers_raw  = client.get_top_movers(direction="losers",  limit=20)

        def _quick_pass(row: dict) -> bool:
            """Stage 1–3: filters that use data already in the row."""
            if abs(float(row.get("change_pct", 0.0))) < 3.0:
                return False
            if float(row.get("close", 0.0)) <= _PRICE_MIN:
                return False
            if int(row.get("volume", 0)) < _PM_VOL_MIN:
                return False
            return True

        gainers_pass = [r for r in gainers_raw if _quick_pass(r)]
        losers_pass  = [r for r in losers_raw  if _quick_pass(r)]

        # Stage 4: 5-day avg dollar volume (parallel yfinance fetch)
        candidates = list({r["ticker"] for r in gainers_pass + losers_pass})
        avg_dvol = _get_avg_dollar_vol(candidates)

        def _fmt_mover(row: dict) -> dict[str, str] | None:
            ticker = row.get("ticker", "")
            if avg_dvol.get(ticker, float("inf")) < _AVG_DVOL_MIN:
                return None
            pct  = float(row.get("change_pct", 0.0))
            sign = "+" if pct >= 0 else ""
            return {"sym": ticker, "pct": f"{sign}{pct:.2f}%"}

        data = {
            "ripping":  [m for r in gainers_pass if (m := _fmt_mover(r)) is not None],
            "drilling": [m for r in losers_pass  if (m := _fmt_mover(r)) is not None],
        }
        cache.set("movers", data, ttl=30)
        return data

    except Exception:
        # Fall back to movers from the last engine wire_data push.
        wire = cache.get("wire_data")
        if wire and wire.get("movers"):
            data = wire["movers"]
            cache.set("movers", data, ttl=30)
            return data
        return {"ripping": [], "drilling": []}
