"""Top-Gainers scans — the top 5% of the liquid US stock market by N-day % change.

Three periods (30 / 60 / 90 trading days). A stock QUALIFIES when its N-day gain
(live price vs its split-adjusted close N trading days ago) ranks in the top 5% of the
liquid, non-ETF universe. Filters: ETFs/ETNs/funds excluded, a price + dollar-volume
liquidity floor (so illiquid micro-cap pumps don't bury the real movers), and a
change-magnitude guard against ticker-reuse / bad-data artifacts.

Whole-market by construction:
  reference   grouped-daily calls for the date N trading sessions ago return EVERY
              ticker's close — the entire market, not a static list, so recent runners
              that aren't in cap_universe (e.g. OTLK, EXFY) are ranked too. Built once/day.
  live scan   ONE get_full_market_snapshot() gives every ticker's current price; we
              compute the gain, rank, and keep the top 5% (cached ~60s).

Getting the reference close RIGHT is the whole game (a wrong close is a wrong %). Two
provider data hazards, each handled at the reference:
  • SPLITS — the adjusted feed is correct for a REAL split (MVIS reverse-split: raw
    90-days-ago ~$0.58 vs adjusted ~$20 → raw would fake +479%), but occasionally
    PHANTOM-adjusts a name with no real split (TPC read ~$17.8 vs a $75 close → adjusted
    fakes +456%). We fetch the split CALENDAR and pick per ticker: adjusted close if it
    really split in the window, else the raw close. (No split feed → adjusted default, so
    real splits stay correct.)
  • TICKER REUSE — a recycled symbol (SPCX = SPAC ETF then, SpaceX now) whose current
    listing began AFTER the reference date is dropped (its ref close is a different
    security). A +1000% magnitude cap is the final backstop.
"""
import math
import threading
import time as _time

from api.services import bars_sqlite as _sqlite
from api.services import massive
from api.services.cache import cache
# Shared scan helpers (ET clock, session date, provider symbology, ETF set, reuse map).
from api.services.scan_volume import (
    _now_et, _session_date, _snap_lookup, _etf_symbols, _listing_starts,
)

# scan id → N completed sessions back (matches the frontend perf30d/60d/90d columns).
_PERIODS = {"30d": 30, "60d": 60, "90d": 90}
_TOP_FRACTION = 0.05          # keep the top 5% of ranked stocks
_SCAN_TTL = 60               # live-scan cache (s) — matches the snapshot's usefulness

# Liquidity + sanity filters (keep the list to real, tradable movers).
_MIN_PRICE = 1.0             # skip sub-$1 names (penny / junk noise)
_MIN_DOLLAR_VOL = 1_000_000  # prev-day $ turnover floor (price × prev_vol)
_MAX_CHANGE_PCT = 1000.0     # guard vs ticker-reuse / bad-data artifacts (e.g. RMIX +6022%)

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


def _ymd_to_iso(ymd: int) -> str:
    s = str(int(ymd))
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def _build_reference(n_sessions: int) -> dict:
    """{TICKER (provider-form): reference close N trading days ago} — whole US market.

    The reference DATE is bars.db's trading calendar (Nth distinct daily ts back). Per
    ticker the close is chosen to dodge both split hazards (see module docstring): the
    split-ADJUSTED close for a name that really split in the window, else the RAW close;
    and recycled tickers whose current listing began after the reference date are dropped.
    """
    today = int(_now_et().strftime("%Y%m%d"))
    ref_ymd = _sqlite.nth_recent_trading_date(n_sessions, today)
    if not ref_ymd:
        return {}
    ref_iso = _ymd_to_iso(ref_ymd)

    adj = massive.get_grouped_daily_closes(ref_iso, adjusted=True)
    if not adj:
        return {}
    raw = massive.get_grouped_daily_closes(ref_iso, adjusted=False)
    split_tk = massive.get_split_tickers(ref_iso, _ymd_to_iso(today))
    starts = _listing_starts()

    out: dict[str, float] = {}
    for prov, adj_c in adj.items():
        app = prov.replace(".", "-")
        ls = starts.get(app)
        if ls and ls > ref_ymd:
            continue    # ticker reuse: current listing began after the reference date
        # Real split → adjusted (MVIS); no real split → raw (dodges phantom-split TPC).
        # No split feed at all (empty set) → adjusted default so real splits stay correct.
        if split_tk:
            ref_c = adj_c if prov in split_tk else raw.get(prov, adj_c)
        else:
            ref_c = adj_c
        if isinstance(ref_c, (int, float)) and ref_c > 0:
            out[prov] = float(ref_c)
    return out


def _ensure_reference(pid: str, n_sessions: int) -> dict | None:
    """Today's whole-market reference-close map for the period, kicking a background build
    if stale. Returns None while a build is in flight (the scan then reports 'computing')."""
    date = _session_date()
    with _ref_lock:
        st = _state(pid)
        if st["date"] == date and st["map"] is not None:
            return st["map"]
        if st["building"]:
            return None
        st["building"] = True

    def _job():
        try:
            m = _build_reference(n_sessions)
        except Exception:
            m = {}
        with _ref_lock:
            _state(pid).update(date=date, map=m, built_at=_time.time(),
                               building=False, universe=len(m))

    threading.Thread(target=_job, daemon=True, name=f"gainers-ref-{pid}").start()
    return None


def _run_gainers(pid: str, n_sessions: int) -> dict:
    """Top 5% of liquid, non-ETF stocks by N-day % change (live price vs adjusted close
    N sessions ago).

    Shape: {status, results:[{sym, change_nd, ref_close, price, prev_close, change_pct}],
            count, as_of}. Pre-sorted by N-day change desc; the frontend re-sorts by its
            own perfNd column (fed the same change_nd + ref_close), so order stays consistent.
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
        out = {"status": "ok", "results": [], "count": 0, "as_of": _now_et().isoformat()}
        cache.set(ck, out, ttl=15)
        return out

    etfs = _etf_symbols()   # app-form set
    gains = []
    for provider_tk, ref_close in ref.items():
        if not ref_close or ref_close <= 0:
            continue
        app = provider_tk.replace(".", "-")   # provider→app form (BRK.B → BRK-B)
        if app.endswith("ZZT"):
            continue    # Polygon test symbols (ZVZZT/ZWZZT/ZXZZT/…) — not real stocks
        if app in etfs:
            continue
        s = snap.get(provider_tk) or _snap_lookup(snap, app)
        if not s:
            continue
        price = s.get("last_price")
        if not isinstance(price, (int, float)) or price < _MIN_PRICE:
            continue
        prev = s.get("prev_close")
        # Liquidity floor: prior-day dollar volume (stable), price × yesterday's volume.
        pv = s.get("prev_vol")
        dvol = (prev or 0) * (pv or 0)
        if dvol < _MIN_DOLLAR_VOL:
            continue
        change_nd = round((price - ref_close) / ref_close * 100, 2)
        if change_nd > _MAX_CHANGE_PCT:
            continue    # data artifact (ticker reuse / bad bar), not a real move
        day_chg = (round((price - prev) / prev * 100, 2)
                   if isinstance(prev, (int, float)) and prev > 0 else None)
        gains.append({
            "sym": app,
            "change_nd": change_nd,     # ranking metric (N-day % move)
            "ref_close": ref_close,     # adjusted close N sessions ago → client recomputes live
            "price": price,
            "prev_close": prev,
            "change_pct": day_chg,
        })

    gains.sort(key=lambda g: g["change_nd"], reverse=True)
    cutoff = max(1, math.ceil(len(gains) * _TOP_FRACTION)) if gains else 0
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
