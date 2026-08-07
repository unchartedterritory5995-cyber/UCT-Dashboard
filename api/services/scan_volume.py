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
from datetime import datetime

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
_SCAN_CACHE_KEY = "scan_hv1y"

_ref_lock = threading.Lock()
_ref_state = {"date": None, "map": None, "building": False, "built_at": 0.0, "universe": 0}


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


def _build_reference(universe: list[str]) -> dict:
    out = {}
    for t in universe:
        mv = _ref_max_vol(t)
        if mv:
            out[t] = mv
    return out


def _ensure_reference() -> dict | None:
    """Return today's reference map, kicking a background build if it's stale.

    Returns None while a build is in flight (the scan then reports 'computing').
    """
    date = _session_date()
    with _ref_lock:
        if _ref_state["date"] == date and _ref_state["map"] is not None:
            return _ref_state["map"]
        if _ref_state["building"]:
            return None
        _ref_state["building"] = True

    def _job():
        universe = _universe()
        try:
            m = _build_reference(universe)
        except Exception:
            m = {}
        with _ref_lock:
            _ref_state.update(date=date, map=m, built_at=_time.time(),
                              building=False, universe=len(universe))

    threading.Thread(target=_job, daemon=True, name="volscan-ref").start()
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


def get_highest_volume_1y() -> dict:
    """The scan result: tickers whose today_vol exceeds their trailing-252d max.

    Cached _SCAN_TTL seconds so it recomputes at most ~once/min during RTH.
    Shape: {status, results:[{sym,volume,ref_max,ratio,price,prev_close,change_pct}],
            count, as_of}.
    """
    cached = cache.get(_SCAN_CACHE_KEY)
    if cached is not None:
        return cached

    ref = _ensure_reference()
    if ref is None:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    if not snap:
        # No snapshot (off-market / transient) — nothing to compare; don't cache long.
        out = {"status": "ok", "results": [], "count": 0, "as_of": _now_et().isoformat()}
        cache.set(_SCAN_CACHE_KEY, out, ttl=15)
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
    # Rank by how decisively today beat the 1-year high.
    results.sort(key=lambda r: r["ratio"], reverse=True)
    out = {"status": "ok", "results": results, "count": len(results),
           "as_of": _now_et().isoformat()}
    cache.set(_SCAN_CACHE_KEY, out, ttl=_SCAN_TTL)
    return out


def status() -> dict:
    """Diagnostics (no auth) — reference readiness for the scan."""
    with _ref_lock:
        return {
            "reference_date": _ref_state["date"],
            "reference_size": len(_ref_state["map"]) if _ref_state["map"] else 0,
            "universe": _ref_state["universe"],
            "building": _ref_state["building"],
            "built_at": _ref_state["built_at"],
        }
