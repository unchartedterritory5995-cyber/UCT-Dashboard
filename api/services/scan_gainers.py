"""Top-Gainers scans — the top 5% of the liquid US stock market by N-day % change.

Three periods (30 / 60 / 90 trading days). A stock QUALIFIES when its N-day gain (live
price vs its close N trading days ago) ranks in the top 5% of the liquid, non-ETF universe.

Two-stage, whole-market AND chart-accurate:
  discover   ONE grouped-daily call for the date N sessions ago gives EVERY ticker's close
             (the entire market, not a static list — so runners like OTLK/EXFY are ranked);
             one snapshot gives current prices. We rank by that gain and shortlist the
             strongest movers + count the liquid universe (for the 5% cutoff). Built once/day.
  verify     each shortlisted mover's reference close is recomputed from the SAME sanitized
             bars the chart serves (bars.db → bars_sanitize). That is the ONLY source that
             un-does the provider's phantom split adjustments (TPC/BCPC read a bogus +400%
             off the raw/adjusted feed), applies REAL splits (MVIS reverse-split → down, not
             up), and cuts recycled-ticker pre-listing history (SPCX). A mover with too little
             CLEAN history (reuse / very recent IPO) is dropped; one bars.db doesn't track
             keeps the grouped close (coverage over precision).
  live scan  rank the verified shortlist by live price vs the corrected reference, keep the
             top 5% (cached ~60s).
"""
import math
import threading
import time as _time

from api.services import bars_sqlite as _sqlite
from api.services import massive
from api.services.cache import cache
# Shared scan helpers (ET clock, session date, provider symbology, ETF set).
from api.services.scan_volume import _now_et, _session_date, _snap_lookup, _etf_symbols

# scan id → N completed sessions back (matches the frontend perf30d/60d/90d columns).
_PERIODS = {"30d": 30, "60d": 60, "90d": 90}
_TOP_FRACTION = 0.05          # keep the top 5% of the liquid universe
_SCAN_TTL = 60               # live-scan cache (s)

# Liquidity + sanity filters (keep the list to real, tradable movers).
_MIN_PRICE = 1.0             # skip sub-$1 names (penny / junk noise)
_MIN_DOLLAR_VOL = 1_000_000  # prev-day $ turnover floor (price × prev_vol)
_MAX_CHANGE_PCT = 1000.0     # final backstop vs any artifact that slips verification
_MAX_VERIFY = 800            # shortlist size sent to chart-true verification
_SANITIZE_FETCH = 400        # daily bars pulled for the sanitize pass (≥ 90 + reuse context)

_ref_lock = threading.Lock()
# Per-period reference state, keyed by scan id ('30d'|'60d'|'90d'). Each is
# {date, map, building, built_at, universe}. `map` = {app_ticker: verified ref close};
# `universe` = liquid-universe count (the 5% denominator). Built lazily per ET day.
_ref_states: dict = {}


def _state(pid: str) -> dict:
    st = _ref_states.get(pid)
    if st is None:
        st = {"date": None, "map": None, "building": False, "built_at": 0.0, "universe": 0}
        _ref_states[pid] = st
    return st


def _ymd_to_iso(ymd: int) -> str:
    s = str(int(ymd))
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def _sanitized_ref_close(ticker: str, n_sessions: int):
    """Chart-true close `n_sessions` trading days back — bars.db daily rows run through the
    SAME sanitize the chart serves (_fmt_sqlite_bars → sanitize_daily_bars).

    Returns a float ref close; None if bars.db doesn't track the ticker (caller may fall
    back to the grouped close); or False if it IS tracked but lacks enough CLEAN history
    (recycled ticker / very recent IPO → caller drops it)."""
    try:
        from api.services import bars_fetch as _bf
        rows = _sqlite.get_bars(ticker, "D", _SANITIZE_FETCH)   # oldest-first (ts,o,h,l,c,v)
        if not rows:
            return None
        bars = _bf._fmt_sqlite_bars(rows, "D", ticker)          # applies sanitize_daily_bars
        if not bars or len(bars) <= n_sessions:
            return False
        c = bars[-(n_sessions + 1)].get("c")
        return float(c) if isinstance(c, (int, float)) and c > 0 else False
    except Exception:
        return None


def _build_reference(n_sessions: int):
    """Discover the strongest movers whole-market, then verify their reference close against
    the chart-true sanitized series. Returns {'map': {app: ref_close}, 'liquid': N} or None
    on a transient provider miss (so the caller retries rather than caching an empty day)."""
    today = int(_now_et().strftime("%Y%m%d"))
    ref_ymd = _sqlite.nth_recent_trading_date(n_sessions, today)
    if not ref_ymd:
        return None
    adj = massive.get_grouped_daily_closes(_ymd_to_iso(ref_ymd), adjusted=True)
    if not adj:
        return None
    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    if not snap:
        return None

    etfs = _etf_symbols()
    liquid = 0
    cand = []   # (app, grouped_adj_close, grouped_adj_change)
    for prov, adj_c in adj.items():
        if not adj_c or adj_c <= 0:
            continue
        app = prov.replace(".", "-")
        if app in etfs or app.endswith("ZZT"):   # ETFs + Polygon test symbols
            continue
        s = snap.get(prov) or _snap_lookup(snap, app)
        if not s:
            continue
        price = s.get("last_price")
        if not isinstance(price, (int, float)) or price < _MIN_PRICE:
            continue
        prev, pv = s.get("prev_close"), s.get("prev_vol")
        if (prev or 0) * (pv or 0) < _MIN_DOLLAR_VOL:
            continue
        liquid += 1
        cand.append((app, float(adj_c), (price - adj_c) / adj_c * 100))

    # Verify the strongest movers against the chart-true sanitized reference.
    cand.sort(key=lambda x: x[2], reverse=True)
    ref: dict[str, float] = {}
    for app, adj_c, _ in cand[:_MAX_VERIFY]:
        rc = _sanitized_ref_close(app, n_sessions)
        if rc is False:
            continue          # tracked but too little clean history (reuse / recent IPO)
        if rc is None:
            rc = adj_c        # not tracked in bars.db → grouped close (coverage)
        if isinstance(rc, (int, float)) and rc > 0:
            ref[app] = float(rc)
    return {"map": ref, "liquid": liquid}


def _ensure_reference(pid: str, n_sessions: int) -> dict | None:
    """Today's verified reference map for the period, kicking a background build if stale.
    Returns None while a build is in flight (the scan then reports 'computing')."""
    date = _session_date()
    with _ref_lock:
        st = _state(pid)
        if st["date"] == date and st["map"] is not None:
            return st["map"]
        if st["building"]:
            return None
        st["building"] = True

    def _job():
        built = None
        try:
            built = _build_reference(n_sessions)
        except Exception:
            built = None
        with _ref_lock:
            if built is None:
                _state(pid).update(building=False)   # transient miss → retry next request
            else:
                _state(pid).update(date=date, map=built["map"], built_at=_time.time(),
                                   building=False, universe=built.get("liquid", 0))

    threading.Thread(target=_job, daemon=True, name=f"gainers-ref-{pid}").start()
    return None


def _run_gainers(pid: str, n_sessions: int) -> dict:
    """Top 5% of the liquid universe by N-day % change (live price vs the verified reference
    close). Shape: {status, results:[{sym, change_nd, ref_close, price, prev_close,
    change_pct}], count, as_of}. Pre-sorted by change desc; the frontend re-sorts by its own
    perfNd column (fed the same change_nd + ref_close), so order stays consistent."""
    ck = f"scan_gainers_{pid}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    ref = _ensure_reference(pid, n_sessions)
    if ref is None:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}
    with _ref_lock:
        liquid = _state(pid).get("universe") or len(ref)

    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    if not snap:
        out = {"status": "ok", "results": [], "count": 0, "as_of": _now_et().isoformat()}
        cache.set(ck, out, ttl=15)
        return out

    gains = []
    for app, ref_close in ref.items():
        if not ref_close or ref_close <= 0:
            continue
        s = _snap_lookup(snap, app)
        if not s:
            continue
        price = s.get("last_price")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        change_nd = round((price - ref_close) / ref_close * 100, 2)
        if change_nd > _MAX_CHANGE_PCT:
            continue
        prev = s.get("prev_close")
        day_chg = (round((price - prev) / prev * 100, 2)
                   if isinstance(prev, (int, float)) and prev > 0 else None)
        gains.append({
            "sym": app,
            "change_nd": change_nd,     # ranking metric (N-day % move)
            "ref_close": ref_close,     # verified close N sessions ago → client recomputes live
            "price": price,
            "prev_close": prev,
            "change_pct": day_chg,
        })

    gains.sort(key=lambda g: g["change_nd"], reverse=True)
    cutoff = max(1, math.ceil(liquid * _TOP_FRACTION)) if gains else 0
    top = gains[:cutoff]
    out = {"status": "ok", "results": top, "count": len(top),
           "as_of": _now_et().isoformat()}
    cache.set(ck, out, ttl=_SCAN_TTL)
    return out


def get_top_gainers_30d() -> dict:
    """Top 5% of liquid non-ETF stocks by 30-trading-day % change."""
    return _run_gainers("30d", _PERIODS["30d"])


def get_top_gainers_60d() -> dict:
    """Top 5% of liquid non-ETF stocks by 60-trading-day % change."""
    return _run_gainers("60d", _PERIODS["60d"])


def get_top_gainers_90d() -> dict:
    """Top 5% of liquid non-ETF stocks by 90-trading-day % change."""
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
