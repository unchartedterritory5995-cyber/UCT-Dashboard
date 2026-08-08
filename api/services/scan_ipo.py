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
# Reuse the shared scan helpers (ET clock, provider symbology, ETF set, reuse-aware map).
from api.services.scan_volume import _now_et, _snap_lookup, _etf_symbols, _listing_starts

_LOCK = threading.Lock()
_state = {"date": None, "map": None, "building": False, "built_at": 0.0}
_TTL = 120                     # live-scan cache (s) — the IPO set is daily; only price moves
_CACHE_KEY = "scan_ipo1y"
_LOOKBACK_DAYS = 365


def _session_date() -> str:
    return _now_et().strftime("%Y-%m-%d")


def _build_ipo_set() -> dict:
    """{TICKER: current-listing-start YYYYMMDD} for stocks whose CURRENT listing began in
    the last _LOOKBACK_DAYS.

    Reuse-aware: a recycled ticker (SPCX = SpaceX now, a SPAC ETF before June 2026) is
    dated by its NEW listing, not the old security's years-old bars — so a recent IPO
    behind a reused symbol is no longer hidden by MIN(ts). NOT restricted to the static
    cap universe (recent IPOs like CBRS aren't in that file). The live pass filters to
    currently-trading names via the snapshot and drops ETFs.
    """
    now = _now_et()
    since = int((now - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d"))
    try:
        starts = _listing_starts()
    except Exception:
        return {}
    return {t: d for t, d in starts.items() if d >= since}


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
