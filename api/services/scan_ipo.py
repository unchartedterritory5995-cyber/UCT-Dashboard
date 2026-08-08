"""IPO-in-last-1-year scan — stocks first traded within the trailing 365 days.

The "IPO date" is proxied by the earliest DAILY bar in bars.db (since-inception
warmed for the cap universe), so a ticker whose first daily bar falls within the
last year is treated as a recent IPO. The ONLY filter is that date window; results
are restricted to the $300M+ cap universe (bars.db coverage + noise control).

Cost split mirrors scan_volume: the recent-IPO SET is one indexed GROUP BY built
once per ET day (background); the live pass just attaches the current snapshot
price/change and is cached briefly.
"""
import threading
import time as _time
from datetime import timedelta

from api.services import bars_sqlite as _sqlite
from api.services import massive
from api.services.cache import cache
# Reuse the shared scan helpers (ET clock, provider symbology, ETF exclusion set).
from api.services.scan_volume import _now_et, _snap_lookup, _etf_symbols

_LOCK = threading.Lock()
_state = {"date": None, "map": None, "building": False, "built_at": 0.0}
_TTL = 120                     # live-scan cache (s) — the IPO set is daily; only price moves
_CACHE_KEY = "scan_ipo1y"
_LOOKBACK_DAYS = 365
_RELIST_FLOOR_DAYS = 800       # ~2y window for the reuse-candidate scan (bounds the query)
_RELIST_VERIFY_CAP = 600       # safety cap on candidates verified via sanitize


def _session_date() -> str:
    return _now_et().strftime("%Y-%m-%d")


def _sanitized_first_date(ticker: str):
    """The date (YYYYMMDD) of a ticker's FIRST bar AFTER the chart sanitize pass, which
    drops a recycled ticker's pre-listing history — so for a reused symbol this is its NEW
    listing date, not the old security's. None if unavailable."""
    try:
        from api.services import bars_fetch as _bf
        rows = _sqlite.get_bars(ticker, "D", 400)
        if not rows:
            return None
        bars = _bf._fmt_sqlite_bars(rows, "D", ticker)   # applies sanitize_daily_bars
        if not bars:
            return None
        t = str(bars[0].get("t") or "").replace("-", "")
        return int(t[:8]) if len(t) >= 8 and t[:8].isdigit() else None
    except Exception:
        return None


def _recent_relistings(since_ymd: int) -> dict:
    """{TICKER: current-listing YYYYMMDD} for recycled symbols relisted within the window.

    A SMALL candidate set (reuse-signature resume via bars.db) is confirmed + dated against
    the chart sanitize, so only real, correctly-dated reuses (SPCX) are added to the IPO set.
    Recent_first_trade already covers ordinary IPOs; this is just the reuse overlay.
    """
    now = _now_et()
    floor = int((now - timedelta(days=_RELIST_FLOOR_DAYS)).strftime("%Y%m%d"))
    try:
        cands = _sqlite.recent_relisting_candidates(since_ymd, floor)
    except Exception:
        return {}
    out: dict = {}
    for t in list(cands)[:_RELIST_VERIFY_CAP]:
        d = _sanitized_first_date(t)
        if d and d >= since_ymd:      # sanitize confirms a NEW listing inside the window
            out[t] = d
    return out


def _build_ipo_set() -> dict:
    """{TICKER: listing YYYYMMDD} for stocks whose CURRENT listing began in the last
    _LOOKBACK_DAYS.

    Base = recent_first_trade (MIN daily ts) for ordinary IPOs. Overlay = recycled tickers
    (SPCX = SpaceX now, a SPAC ETF before) whose old bars make MIN(ts) look old but whose
    CURRENT listing is recent — found via a reuse-signature scan and dated by the chart
    sanitize. NOT restricted to the static cap universe (recent IPOs like CBRS aren't in
    it). The live pass filters to currently-trading names via the snapshot and drops ETFs.
    """
    now = _now_et()
    since = int((now - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d"))
    try:
        base = _sqlite.recent_first_trade(since)
    except Exception:
        base = {}
    # Overlay recycled tickers whose CURRENT listing is recent (SPCX) — their old bars
    # hide them from MIN(ts). The overlay's sanitize-verified date wins.
    base.update(_recent_relistings(since))
    return base


def _ensure_ipo_set() -> dict | None:
    """Today's recent-IPO set, kicking a background build if stale. None while building."""
    date = _session_date()
    with _LOCK:
        if _state["date"] == date and _state["map"] is not None:
            return _state["map"]
        if _state["building"]:
            return None
        _state["building"] = True

    def _job():
        try:
            m = _build_ipo_set()
        except Exception:
            m = {}
        with _LOCK:
            _state.update(date=date, map=m, built_at=_time.time(), building=False)

    threading.Thread(target=_job, daemon=True, name="ipo-scan-ref").start()
    return None


def get_ipo_last_1y() -> dict:
    """Recent IPOs (first traded within the last year) with current price/change.

    Shape: {status, results:[{sym, ipo_date, price, prev_close, change_pct}], count, as_of}.
    """
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    ipos = _ensure_ipo_set()
    if ipos is None:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}

    etfs = _etf_symbols()   # ETFs/ETNs/funds to exclude (stocks-only scan)

    results = []
    for sym, first_ts in ipos.items():
        if sym in etfs:
            continue        # drop exchange-traded products (e.g. leveraged ETFs like SNXX)
        s = _snap_lookup(snap, sym) if snap else None
        # When the snapshot is present, require the ticker to be in it — that's the
        # "currently trading US equity" filter that replaces the cap-universe gate
        # (keeps recent IPOs, drops delisted/non-equity). If the snapshot is empty
        # (transient/off-market), fall back to showing the set with no price.
        if snap and not s:
            continue
        price = s.get("last_price") if s else None
        prev = s.get("prev_close") if s else None
        change_pct = None
        if isinstance(price, (int, float)) and isinstance(prev, (int, float)) and prev > 0:
            change_pct = round((price - prev) / prev * 100, 2)
        results.append({
            "sym": sym,
            "ipo_date": int(first_ts),   # YYYYMMDD of the first daily bar
            "price": price,
            "prev_close": prev,
            "change_pct": change_pct,
        })
    # Most recent IPO first (the frontend may re-sort).
    results.sort(key=lambda r: r["ipo_date"], reverse=True)
    out = {"status": "ok", "results": results, "count": len(results),
           "as_of": _now_et().isoformat()}
    # Don't pin an empty set (transient snapshot miss) for the full TTL.
    cache.set(_CACHE_KEY, out, ttl=_TTL if results else 15)
    return out


def status() -> dict:
    """Diagnostics (no auth) — recent-IPO set readiness."""
    with _LOCK:
        return {
            "reference_date": _state["date"],
            "reference_size": len(_state["map"]) if _state["map"] else 0,
            "building": _state["building"],
            "built_at": _state["built_at"],
        }
