"""Service layer wrapping MassiveClient from uct-intelligence.

Provides get_snapshot() and get_movers() with TTL caching.
MassiveClient is imported via sys.path manipulation since it lives in a
sibling project (uct-intelligence).
"""
import sys
import os
from typing import Any

# Import MassiveClient from the uct-intelligence project
_UCI_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "uct-intelligence")
)
if _UCI_PATH not in sys.path:
    sys.path.insert(0, _UCI_PATH)

from api.services.cache import cache

_client = None


def _get_client():
    """Return a shared MassiveClient instance, initializing on first call.

    Raises RuntimeError with a clear message if the client cannot be created
    (e.g. missing API keys or boto3).
    """
    global _client
    if _client is None:
        try:
            from uct_intelligence.massive_data import MassiveClient
            _client = MassiveClient()
        except Exception as e:
            raise RuntimeError(f"Failed to initialize MassiveClient: {e}")
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


def get_snapshot() -> dict:
    """Return formatted market snapshot with futures and ETF prices.

    Returns:
        {
          "futures": {"NQ": {"price": "...", "chg": "...", "css": "pos|neg"}, ...},
          "etfs":    {"QQQ": {"price": "...", "chg": "...", "css": "pos|neg"}, ...},
        }

    Raises RuntimeError / any exception on data fetch failure (caller handles
    with 503).
    """
    cached = cache.get("snapshot")
    if cached is not None:
        return cached

    client = _get_client()

    # Tickers we want in each bucket.
    # Futures are tracked via their ETF/index proxies in the Massive REST API.
    futures_tickers = ["NQ=F", "ES=F", "RTY=F", "BTC-USD"]
    futures_labels  = ["NQ",   "ES",   "RTY",   "BTC"]
    etf_tickers     = ["QQQ", "SPY", "IWM", "DIA", "VIX"]

    all_tickers = futures_tickers + etf_tickers

    # Fetch all via bulk snapshot call (one call, then split)
    prices = client.get_latest_prices(all_tickers)

    def _make_entry(ticker: str, label: str = None) -> dict[str, Any]:
        snap = client.get_single_ticker_snapshot(ticker)
        price = snap.get("close") or snap.get("vwap") or 0.0
        chg_pct = snap.get("change_pct") or 0.0
        chg_str, css = _fmt_chg(float(chg_pct))
        return {"price": _fmt_price(price), "chg": chg_str, "css": css}

    futures = {}
    for ticker, label in zip(futures_tickers, futures_labels):
        futures[label] = _make_entry(ticker)

    etfs = {}
    for ticker in etf_tickers:
        etfs[ticker] = _make_entry(ticker)

    data = {"futures": futures, "etfs": etfs}
    cache.set("snapshot", data, ttl=10)
    return data


def get_movers() -> dict:
    """Return top gainers and losers for the current session.

    Returns:
        {
          "ripping": [{"sym": "TICK", "pct": "+34.40%"}, ...],
          "drilling": [{"sym": "TICK", "pct": "-50.55%"}, ...],
        }

    Raises RuntimeError / any exception on data fetch failure (caller handles
    with 503).
    """
    cached = cache.get("movers")
    if cached is not None:
        return cached

    client = _get_client()

    gainers_raw = client.get_top_movers(direction="gainers", limit=10)
    losers_raw  = client.get_top_movers(direction="losers",  limit=10)

    def _fmt_mover(row: dict) -> dict[str, str]:
        pct = float(row.get("change_pct", 0.0))
        sign = "+" if pct >= 0 else ""
        return {"sym": row.get("ticker", ""), "pct": f"{sign}{pct:.2f}%"}

    data = {
        "ripping":  [_fmt_mover(r) for r in gainers_raw],
        "drilling": [_fmt_mover(r) for r in losers_raw],
    }
    cache.set("movers", data, ttl=30)
    return data
