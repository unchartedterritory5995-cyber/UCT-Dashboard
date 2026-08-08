"""Highest-Volume-in-1-Year scan — a universe-wide, all-day intraday screen.

A stock QUALIFIES when TODAY's cumulative volume (so far) exceeds its highest
DAILY volume over the trailing ~252 completed sessions (≈ one trading year).
No other criteria. The set grows through the session as volume accumulates, so
the scan is "live" all day.

Cost split (mirrors breadth_live's reference/live separation):
  reference   per-ticker 252-session MAX daily volume, from bars.db. Changes
              only when a session completes (once a day), so it's built ONCE per
              ET day on a background thread and cached.
  live scan   ONE massive.get_full_market_snapshot() call returns every ticker's
              today_vol; we compare against the reference. Cheap — cached ~60s so
              a request-per-user during RTH doesn't refetch the whole market.
"""
import json
import os
import threading
import time as _time
from datetime import datetime, timedelta

try:
    import zoneinfo
    _ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None

from api.services import bars_sqlite as _sqlite
from api.services import massive
from api.services.cache import cache

_LOOKBACK = 252        # ~1 trading year of completed sessions
_REF_FETCH = 260       # pull a few extra daily bars so we can drop today's partial
_SCAN_TTL = 60         # live-scan cache (seconds) — matches the snapshot's usefulness
_MIN_PRIOR = 2         # need at least this many prior sessions to have a real high

_ref_lock = threading.Lock()
# Per-scan reference state, keyed by scan id ('1y' | 'ever'). Each is
# {date, map, building, built_at, universe}. Built lazily per ET day.
_ref_states: dict = {}


def _state(scan_id: str) -> dict:
    st = _ref_states.get(scan_id)
    if st is None:
        st = {"date": None, "map": None, "building": False, "built_at": 0.0, "universe": 0}
        _ref_states[scan_id] = st
    return st


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def _session_date() -> str:
    return _now_et().strftime("%Y-%m-%d")


def _today_yyyymmdd() -> int:
    return int(_now_et().strftime("%Y%m%d"))


def _universe() -> list[str]:
    """The $300M+ cap universe (app-form tickers, e.g. BRK-B)."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    try:
        with open(path) as f:
            arr = json.load(f)
        return [str(t).upper() for t in arr if t]
    except Exception:
        return []


def _ref_max_vol(ticker: str) -> int | None:
    """Max daily volume over the trailing ≤252 COMPLETED sessions (excludes today).

    Daily bars in bars.db carry `ts` as a YYYYMMDD int (date_tf), so today's
    still-evolving bar is dropped by an int compare against the ET date.
    """
    try:
        rows = _sqlite.get_bars(ticker, "D", _REF_FETCH)  # (ts,o,h,l,c,v), oldest-first
    except Exception:
        return None
    if not rows:
        return None
    today = _today_yyyymmdd()
    vols = []
    for r in rows:
        ts = r[0]
        if isinstance(ts, (int, float)) and int(ts) >= today:
            continue  # drop today's partial daily bar
        v = r[5]
        if isinstance(v, (int, float)) and v > 0:
            vols.append(int(v))
    vols = vols[-_LOOKBACK:]
    if len(vols) < _MIN_PRIOR:
        return None
    return max(vols)


def _build_reference(days: int | None, exclude_set: set | None = None) -> dict:
    """{TICKER: max daily volume over the lookback} for the WHOLE bars.db universe.

    days=365 → trailing ~1 trading year; days=None → since inception (all-time).
    One indexed GROUP BY over bars.db daily bars (exclusive of today) — near-instant.
    Scans EVERY tracked US ticker (NOT the static $300M+ cap list — so recent names that
    aren't in that file are never dropped), minus `exclude_set` (ETFs/ETNs/funds). The
    live pass's snapshot-presence check then removes delisted / non-equity noise.
    """
    now = _now_et()
    to_ymd = int(now.strftime("%Y%m%d"))                       # exclude today's partial
    from_ymd = 0 if days is None else int((now - timedelta(days=days)).strftime("%Y%m%d"))
    try:
        m = _sqlite.max_daily_volume_in_range(from_ymd, to_ymd, _MIN_PRIOR)
    except Exception:
        return {}
    if exclude_set:
        m = {t: v for t, v in m.items() if t not in exclude_set}
    return m


def _ensure_reference(scan_id: str, days: int | None) -> dict | None:
    """Return today's reference map for the scan, kicking a background build if stale.

    Returns None while a build is in flight (the scan then reports 'computing').
    The build is a single SQL aggregate, so this window is ~instant.
    """
    date = _session_date()
    with _ref_lock:
        st = _state(scan_id)
        if st["date"] == date and st["map"] is not None:
            return st["map"]
        if st["building"]:
            return None
        st["building"] = True

    def _job():
        try:
            etfs = _etf_symbols()   # stocks-only: drop ETFs/ETNs/funds from the reference
        except Exception:
            etfs = set()
        try:
            m = _build_reference(days, etfs)
        except Exception:
            m = {}
        with _ref_lock:
            _state(scan_id).update(date=date, map=m, built_at=_time.time(),
                                   building=False, universe=len(m))

    threading.Thread(target=_job, daemon=True, name=f"volscan-ref-{scan_id}").start()
    return None


def _snap_lookup(snap: dict, sym: str):
    """Snapshot keys are provider-form (BRK.B); the universe is app-form (BRK-B)."""
    s = snap.get(sym)
    if s is not None:
        return s
    try:
        return snap.get(massive.to_polygon_symbol(sym))
    except Exception:
        return None


# ── ETF exclusion (shared by the IPO + Top-Gainers scans) ─────────────────────
# Polygon `type` codes for exchange-traded products to EXCLUDE from stocks-only scans:
# ETF, ETN, ETV (structured products), ETS (single-stock ETFs), FUND (closed-end/mutual).
_ETF_TYPES = ("ETF", "ETN", "ETV", "ETS", "FUND")
_ETF_CACHE_KEY = "scan_etf_set"
_ETF_TTL = 24 * 3600


def _etf_symbols() -> set:
    """Set of ETF/ETN/fund tickers (app-form) to exclude from stocks-only scans.

    Bulk-fetched (paginated) from Polygon reference tickers, cached 24h. Fail-OPEN:
    on any error returns the last cached set (possibly empty) so a reference hiccup
    never drops real stocks — it only means ETFs slip through until it recovers.
    """
    cached = cache.get(_ETF_CACHE_KEY)
    if cached is not None:
        return cached
    out: set = set()
    try:
        cli = massive._get_client()
        for typ in _ETF_TYPES:
            url = (f"{massive._REST_BASE}/v3/reference/tickers"
                   f"?type={typ}&market=stocks&active=true&limit=1000&apiKey={cli._api_key}")
            for _ in range(30):  # safety cap on pagination
                j = cli._get(url) or {}
                for r in (j.get("results") or []):
                    t = (r.get("ticker") or "").upper().replace(".", "-")  # provider→app form
                    if t:
                        out.add(t)
                nxt = j.get("next_url")
                if not nxt:
                    break
                url = f"{nxt}&apiKey={cli._api_key}"
    except Exception:
        return cache.get(_ETF_CACHE_KEY) or set()
    # Cache a real result for the day; a transiently-empty result only briefly.
    cache.set(_ETF_CACHE_KEY, out, ttl=_ETF_TTL if out else 300)
    return out


def _run_scan(scan_id: str, days: int | None) -> dict:
    """Tickers whose today_vol exceeds their `scan_id` max daily volume.

    Cached _SCAN_TTL seconds so it recomputes at most ~once/min during RTH.
    Shape: {status, results:[{sym,volume,ref_max,ratio,price,prev_close,change_pct}],
            count, as_of}.
    """
    ck = f"scan_hv_{scan_id}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    ref = _ensure_reference(scan_id, days)
    if ref is None:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    if not snap:
        # No snapshot (off-market / transient) — nothing to compare; don't cache long.
        out = {"status": "ok", "results": [], "count": 0, "as_of": _now_et().isoformat()}
        cache.set(ck, out, ttl=15)
        return out

    results = []
    for sym, rmax in ref.items():
        if rmax <= 0:
            continue
        s = _snap_lookup(snap, sym)
        if not s:
            continue
        tv = int(s.get("today_vol") or 0)
        if tv <= rmax:
            continue
        price = s.get("last_price")
        prev = s.get("prev_close")
        change_pct = None
        if isinstance(price, (int, float)) and isinstance(prev, (int, float)) and prev > 0:
            change_pct = round((price - prev) / prev * 100, 2)
        results.append({
            "sym": sym,
            "volume": tv,
            "ref_max": int(rmax),
            "ratio": round(tv / rmax, 2),
            "price": price,
            "prev_close": prev,
            "change_pct": change_pct,
        })
    # Rank by how decisively today beat the historical high.
    results.sort(key=lambda r: r["ratio"], reverse=True)
    out = {"status": "ok", "results": results, "count": len(results),
           "as_of": _now_et().isoformat()}
    cache.set(ck, out, ttl=_SCAN_TTL)
    return out


def get_highest_volume_1y() -> dict:
    """Today's volume > trailing ~1-year (252-session) max daily volume."""
    return _run_scan("1y", 365)


def get_highest_volume_ever() -> dict:
    """Today's volume > all-time (since-inception) max daily volume."""
    return _run_scan("ever", None)


def status(scan_id: str = "1y") -> dict:
    """Diagnostics (no auth) — reference readiness for a scan."""
    with _ref_lock:
        st = _state(scan_id)
        return {
            "scan": scan_id,
            "reference_date": st["date"],
            "reference_size": len(st["map"]) if st["map"] else 0,
            "universe": st["universe"],
            "building": st["building"],
            "built_at": st["built_at"],
        }
