"""Top-Gainers scans — the top 5% of the stock universe by N-day % change.

Three periods (30 / 60 / 90 trading days). A stock QUALIFIES when its N-day gain
(live price vs its close N completed sessions ago) ranks in the top 5% of the cap
universe. The ONLY other filter is that ETFs/ETNs/leveraged funds are excluded —
stocks only.

Cost split mirrors scan_volume: the per-ticker reference close (N sessions back) is
one window-function query over bars.db built ONCE per ET day on a background thread;
the live pass attaches the current market snapshot, computes each gain, ranks the
whole set, and keeps the top 5% (cached ~60s so RTH traffic doesn't refetch the market).
"""
import math
import threading
import time as _time

from api.services import bars_sqlite as _sqlite
from api.services import massive
from api.services.cache import cache
# Shared scan helpers (ET clock, session date, provider symbology, cap universe, ETF set).
from api.services.scan_volume import (
    _now_et, _session_date, _snap_lookup, _universe, _etf_symbols,
)

# scan id → N completed sessions back (matches the frontend perf30d/60d/90d columns).
_PERIODS = {"30d": 30, "60d": 60, "90d": 90}
_TOP_FRACTION = 0.05   # keep the top 5% of ranked stocks
_SCAN_TTL = 60         # live-scan cache (s) — matches the snapshot's usefulness

_ref_lock = threading.Lock()
# Per-period reference state, keyed by scan id ('30d'|'60d'|'90d'). Each is
# {date, map, building, built_at, universe}. Built lazily per ET day.
_ref_states: dict = {}


def _state(pid: str) -> dict:
    st = _ref_states.get(pid)
    if st is None:
        st = {"date": None, "map": None, "building": False, "built_at": 0.0, "universe": 0}
        _ref_states[pid] = st
    return st


def _build_reference(n_sessions: int, universe_set: set) -> dict:
    """{TICKER: close N completed sessions ago} for the non-ETF cap universe.

    One window-function query over bars.db daily bars (exclusive of today's partial).
    """
    to_ymd = int(_now_et().strftime("%Y%m%d"))   # exclude today's evolving bar
    try:
        m = _sqlite.close_n_sessions_back(n_sessions, to_ymd)
    except Exception:
        return {}
    if universe_set:
        m = {t: c for t, c in m.items() if t in universe_set}
    return m


def _ensure_reference(pid: str, n_sessions: int) -> dict | None:
    """Today's reference-close map for the period, kicking a background build if stale.

    Returns None while a build is in flight (the scan then reports 'computing').
    """
    date = _session_date()
    with _ref_lock:
        st = _state(pid)
        if st["date"] == date and st["map"] is not None:
            return st["map"]
        if st["building"]:
            return None
        st["building"] = True

    def _job():
        uni = set(_universe())
        try:
            uni -= _etf_symbols()   # stocks only (drop ETFs/ETNs/funds before ranking)
        except Exception:
            pass
        try:
            m = _build_reference(n_sessions, uni)
        except Exception:
            m = {}
        with _ref_lock:
            _state(pid).update(date=date, map=m, built_at=_time.time(),
                               building=False, universe=len(uni))

    threading.Thread(target=_job, daemon=True, name=f"gainers-ref-{pid}").start()
    return None


def _run_gainers(pid: str, n_sessions: int) -> dict:
    """Top 5% of non-ETF stocks by N-day % change (live price vs close N sessions ago).

    Shape: {status, results:[{sym, change_nd, price, prev_close, change_pct}], count, as_of}.
    Results are pre-sorted by N-day change desc; the frontend re-sorts by its own perfNd
    column (same definition), so membership + order stay consistent.
    """
    ck = f"scan_gainers_{pid}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    ref = _ensure_reference(pid, n_sessions)
    if ref is None:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    if not snap:
        # No snapshot (off-market / transient) — nothing to rank; don't cache long.
        out = {"status": "ok", "results": [], "count": 0, "as_of": _now_et().isoformat()}
        cache.set(ck, out, ttl=15)
        return out

    gains = []
    for sym, ref_close in ref.items():
        if not ref_close or ref_close <= 0:
            continue
        s = _snap_lookup(snap, sym)
        if not s:
            continue
        price = s.get("last_price")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        change_nd = round((price - ref_close) / ref_close * 100, 2)
        prev = s.get("prev_close")
        day_chg = (round((price - prev) / prev * 100, 2)
                   if isinstance(prev, (int, float)) and prev > 0 else None)
        gains.append({
            "sym": sym,
            "change_nd": change_nd,   # the ranking metric (N-day % move)
            "price": price,
            "prev_close": prev,
            "change_pct": day_chg,
        })

    gains.sort(key=lambda g: g["change_nd"], reverse=True)
    # Top 5% by count (ceil, at least 1) of the ranked stock set.
    cutoff = max(1, math.ceil(len(gains) * _TOP_FRACTION)) if gains else 0
    top = gains[:cutoff]
    out = {"status": "ok", "results": top, "count": len(top),
           "as_of": _now_et().isoformat()}
    cache.set(ck, out, ttl=_SCAN_TTL)
    return out


def get_top_gainers_30d() -> dict:
    """Top 5% of non-ETF stocks by 30-trading-day % change."""
    return _run_gainers("30d", _PERIODS["30d"])


def get_top_gainers_60d() -> dict:
    """Top 5% of non-ETF stocks by 60-trading-day % change."""
    return _run_gainers("60d", _PERIODS["60d"])


def get_top_gainers_90d() -> dict:
    """Top 5% of non-ETF stocks by 90-trading-day % change."""
    return _run_gainers("90d", _PERIODS["90d"])


def status(pid: str = "30d") -> dict:
    """Diagnostics (no auth) — reference readiness for a period."""
    with _ref_lock:
        st = _state(pid)
        return {
            "scan": pid,
            "reference_date": st["date"],
            "reference_size": len(st["map"]) if st["map"] else 0,
            "universe": st["universe"],
            "building": st["building"],
            "built_at": st["built_at"],
        }
