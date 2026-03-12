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

        day        = t.get("day", {})
        last_trade = t.get("lastTrade", {})
        prev_day   = t.get("prevDay", {})

        # Pre-market: day.c == 0 (no regular-session trades yet).
        # Fall back to lastTrade.p (last extended-hours print) then prevDay.c.
        close = day.get("c") or last_trade.get("p") or prev_day.get("c") or 0.0
        return {
            "close":      close,
            "vwap":       day.get("vw", 0.0),
            "change_pct": round(float(t.get("todaysChangePerc", 0.0)), 4),
            "change":     round(float(t.get("todaysChange", 0.0)), 4),
        }


    def get_batch_snapshots(self, tickers: list[str]) -> dict[str, float]:
        """Return todaysChangePerc for a batch of tickers in one API call."""
        if not tickers:
            return {}
        tickers_param = ",".join(t.upper() for t in tickers)
        url = (
            f"{_REST_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
            f"?tickers={tickers_param}&apiKey={self._api_key}"
        )
        try:
            data = self._get(url)
        except Exception:
            return {}
        result = {}
        for t in data.get("tickers", []):
            ticker = t.get("ticker", "")
            if ticker:
                result[ticker] = round(float(t.get("todaysChangePerc", 0.0)), 4)
        return result


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


def _is_leveraged_etf(ticker: str) -> bool:
    """Return True if ticker is a leveraged/inverse ETF. Cached 24h via existing cache."""
    cache_key = f"is_lev_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info
        name = (info.get("longName", "") + " " + info.get("shortName", "")).lower()
        keywords = ["2x", "3x", "-2x", "-3x", "ultra", "leveraged", "inverse",
                    "bull 2", "bear 2", "bull 3", "bear 3", "direxion daily",
                    "proshares ultra"]
        result = any(kw in name for kw in keywords)
    except Exception:
        result = False
    cache.set(cache_key, result, ttl=86400)  # 24 hours
    return result


# ── Liquidity filter thresholds ───────────────────────────────────────────────
_PRICE_MIN    = 2.0          # price must be strictly above $2
_PM_VOL_MIN   = 50_000       # min shares in current session (pre-market at open)
_AVG_DVOL_MIN = 5_000_000    # min 5-day avg dollar volume ($5M)


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
        t = yf.Ticker(ticker)
        fi = t.fast_info
        close = float(fi.last_price)
        prev  = float(fi.previous_close)
        chg_pct = (close - prev) / prev * 100 if prev else 0.0
        return {"close": close, "vwap": close, "change_pct": round(chg_pct, 4)}
    except Exception:
        return {}


def get_ticker_snapshot(ticker: str) -> dict:
    """Return change_pct for a single equity ticker (for earnings gap display)."""
    try:
        return _get_client().get_single_ticker_snapshot(ticker)
    except Exception:
        return {}


def get_etf_snapshots(tickers: list[str]) -> dict[str, float]:
    """Return intraday % change for a list of ETF tickers via batch snapshot.

    Returns dict mapping ticker -> change_pct float.
    Returns empty dict on Massive client failure.
    """
    try:
        return _get_client().get_batch_snapshots(tickers)
    except Exception:
        return {}


def get_snapshot() -> dict:
    """Return formatted market snapshot for the FuturesStrip tile (QQQ/SPY/IWM/DIA/BTC/VIX).

    ETFs (QQQ, SPY, IWM, DIA): Massive REST API snapshot.
    BTC: yfinance (BTC-USD) — crypto not in Massive equities API.
    VIX: yfinance (^VIX) — index not in Massive equities API.

    Returns:
        {
          "futures": {"BTC": {"price": "...", "chg": "...", "css": "pos|neg"}},
          "etfs":    {"QQQ": ..., "SPY": ..., "IWM": ..., "DIA": ..., "VIX": ...},
        }

    Raises RuntimeError on Massive client failure (caller handles with 503).
    """
    cached = cache.get("snapshot")
    if cached is not None:
        return cached

    client = _get_client()

    # QQQ/SPY/IWM/DIA → Massive equities API (real-time)
    etf_tickers = ["QQQ", "SPY", "IWM", "DIA"]
    # BTC → yfinance (crypto not in Massive equities API)
    futures_map = {"BTC": "BTC-USD"}
    # VIX → yfinance (index, not a stock) but goes in the etfs dict for the frontend
    vix_yf_ticker = "^VIX"

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

    # VIX via yfinance — placed in etfs dict (frontend reads data.etfs.VIX)
    vix_snap = _yfinance_snapshot(vix_yf_ticker)
    etfs["VIX"] = _make_entry(vix_snap) if vix_snap else {"price": "—", "chg": "—", "css": ""}

    futures = {}
    for label, yf_ticker in futures_map.items():
        snap = _yfinance_snapshot(yf_ticker)
        futures[label] = _make_entry(snap) if snap else {"price": "—", "chg": "—", "css": ""}

    data = {"futures": futures, "etfs": etfs}
    cache.set("snapshot", data, ttl=15)
    return data


def _fetch_finviz_movers_live() -> tuple[list, list]:
    """Fetch current session top % movers from Finviz Elite screener.

    Quality filters applied at URL level:
      sh_price_o5        = price > $5
      sh_avgvol_o300     = avg daily vol > 300K
      sh_mktcap_smallover= mktcap > $300M (small-cap and above)

    Returns (ripping, drilling) — lists of {"sym", "pct"} dicts, up to 12 each,
    with |change| >= 3%. Sorted by magnitude descending (Finviz sort order).
    """
    import csv
    import io

    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        return [], []

    _qf = "sh_price_o5,sh_avgvol_o300,sh_mktcap_smallover"
    _headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv"}

    def _fetch_rows(order: str) -> list[dict]:
        url = (
            f"https://elite.finviz.com/export.ashx"
            f"?v=152&f={_qf}&o={order}&auth={token}"
        )
        try:
            req = urllib.request.Request(url, headers=_headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            return list(reader)
        except Exception:
            return []

    # Keyword check on Company name — instant, no yfinance calls needed.
    # Finviz CSV already includes the full company name in each row.
    _lev_kw = ("2x", "3x", "-2x", "-3x", "ultra pro", "ultrashort", "ultralong",
                "leveraged", "inverse", "daily bear", "daily bull",
                "direxion daily", "proshares ultra", "proshares short",
                "short bitcoin", "short ether", "2× long", "2× short")

    def _is_lev_by_name(row: dict) -> bool:
        name = (row.get("Company", "") + " " + row.get("Ticker", "")).lower()
        return any(kw in name for kw in _lev_kw)

    def _parse_pct(s: str) -> float:
        try:
            return float(s.replace("%", "").replace("+", "").strip())
        except (ValueError, AttributeError):
            return 0.0

    ripping:  list[dict] = []
    drilling: list[dict] = []

    for row in _fetch_rows("-change"):
        sym = row.get("Ticker", "").strip()
        pct = _parse_pct(row.get("Change", "0"))
        if not sym or pct < 3.0:
            break  # sorted descending; once below 3% all remaining are too
        if _is_lev_by_name(row):
            continue
        ripping.append({"sym": sym, "pct": f"+{pct:.2f}%"})
        if len(ripping) >= 12:
            break

    for row in _fetch_rows("change"):
        sym = row.get("Ticker", "").strip()
        pct = _parse_pct(row.get("Change", "0"))
        if not sym or pct > -3.0:
            break  # sorted ascending; once above -3% all remaining are too
        if _is_lev_by_name(row):
            continue
        drilling.append({"sym": sym, "pct": f"{pct:.2f}%"})
        if len(drilling) >= 12:
            break

    return ripping, drilling


def get_movers() -> dict:
    """Return morning gappers for the Movers at the Open sidebar.

    Sources merged to reach ~12 movers per side:
      1. wire_data movers — captured at 7:35 AM ET by the engine from Finviz.
         High-quality pre-market gappers (price > $10, avg vol > 300K, mktcap > $300M,
         session dollar vol >= $5M, gap >= 3%). Listed first.
      2. Finviz Elite live screener — fills remaining slots to 12.
         Quality filters at URL level: price > $5, avg vol > 300K, mktcap > $300M.
         Post-filter: |change| >= 3%, no leveraged ETFs.
         Beats Massive's raw top-N which gets crowded out by micro-cap noise.

    Returns:
        {
          "ripping":  [{"sym": "TICK", "pct": "+34.40%"}, ...],
          "drilling": [{"sym": "TICK", "pct": "-50.55%"}, ...],
        }
    """
    cached = cache.get("movers")
    if cached is not None:
        return cached

    # Stage 1: wire_data movers (pre-market gappers from 7:35 AM Finviz engine run)
    # Engine outputs "rippers"/"drillers"; normalize to "ripping"/"drilling".
    wire = cache.get("wire_data")
    engine_ripping:  list = []
    engine_drilling: list = []
    if wire and wire.get("movers"):
        data = wire["movers"]
        # Support both key conventions: rippers/drillers (engine) and ripping/drilling (legacy)
        engine_ripping  = data.get("rippers",  data.get("ripping",  []))
        engine_drilling = data.get("drillers", data.get("drilling", []))
        engine_ripping  = [m for m in engine_ripping  if not _is_leveraged_etf(m["sym"])]
        engine_drilling = [m for m in engine_drilling if not _is_leveraged_etf(m["sym"])]

    # Stage 2: Finviz Elite live screener — quality-filtered by mktcap/avgvol at URL level.
    # This beats Massive's raw top-N list which gets dominated by micro-cap noise
    # on high-volatility days (e.g. BTC pumps crowd out COIN, ASTS, etc.).
    fv_ripping, fv_drilling = _fetch_finviz_movers_live()

    engine_syms_rip = {m["sym"] for m in engine_ripping}
    engine_syms_drl = {m["sym"] for m in engine_drilling}

    supplement_rip = [m for m in fv_ripping  if m["sym"] not in engine_syms_rip]
    supplement_drl = [m for m in fv_drilling if m["sym"] not in engine_syms_drl]

    _TARGET = 12

    def _abs_pct(m: dict) -> float:
        try:
            return abs(float(m["pct"].replace("%", "").replace("+", "")))
        except (KeyError, ValueError):
            return 0.0

    combined_rip = engine_ripping + supplement_rip[:max(0, _TARGET - len(engine_ripping))]
    combined_drl = engine_drilling + supplement_drl[:max(0, _TARGET - len(engine_drilling))]

    # Sort by magnitude descending so biggest movers always appear first
    ripping  = sorted(combined_rip[:_TARGET], key=_abs_pct, reverse=True)
    drilling = sorted(combined_drl[:_TARGET], key=_abs_pct, reverse=True)

    # Apply cap_universe filter from engine push — removes ETFs and stocks that
    # only crossed $300M intraday due to a gap move but are normally sub-$300M.
    # cap_universe is built from the Finviz equity screener (cap_smallover), so
    # ETFs like USO/BNO/SVIX are excluded by construction.
    cap_uni = set(wire.get("cap_universe", []) if wire else [])
    if cap_uni:
        ripping  = [m for m in ripping  if m["sym"] in cap_uni]
        drilling = [m for m in drilling if m["sym"] in cap_uni]

    data = {"ripping": ripping, "drilling": drilling}

    # Pre-market (4–9:30 AM ET): 2-min TTL so fresh gaps show up quickly.
    # Regular hours / engine present: 5-min TTL (Finviz updates ~every 2 min anyway).
    try:
        from zoneinfo import ZoneInfo
        _et = ZoneInfo("America/New_York")
    except ImportError:
        from datetime import timezone, timedelta
        _et = timezone(timedelta(hours=-5))
    from datetime import datetime as _dt
    _now = _dt.now(_et)
    _is_premarket = 4 <= _now.hour < 9 or (_now.hour == 9 and _now.minute < 30)
    ttl = 120 if _is_premarket else 300
    cache.set("movers", data, ttl=ttl)
    return data
