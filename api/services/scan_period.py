"""Custom-period % change scan — every US common stock ranked by its % change over a
user-selected [start, end] date range. Powers the Custom-Period Sort tool.

Whole-market by construction: TWO grouped-daily calls (the start + end date, each snapped
to the nearest trading day) give split-adjusted closes for the entire market, so
% change = (end_close - start_close) / start_close for every ticker in two calls. Filtered
to US common stock (currently trading), sorted gainers-first. Cached per date range.
"""
import json
import os
import threading
import time as _time
from datetime import date, timedelta

from api.services import massive
from api.services.cache import cache
from api.services.scan_volume import _now_et, _snap_lookup, _etf_symbols
from api.services.scan_ipo import _common_stock_symbols

_TTL = 300           # results cache (s) — the range is fixed; only live price/vol drift
_GROUP_STEPS = 9     # snap a target date back over a holiday/weekend up to this many days (covers year-end gaps)

# Ticker-reuse map (recycled-symbol detection) shared across ALL period ranges. Computed
# ONCE with a fixed early floor — its whole-universe window scan was the 3-5-min-per-range
# cost. Reuse boundaries are static historical data, so the map is cached in memory AND on
# disk (survives redeploys) and pre-warmed at startup. Correct for any start date >= floor.
_REUSE_FLOOR = 19900101
_REUSE_CK = "scan_period_reuse_map"
_REUSE_FILE = os.path.join(os.environ.get("DATA_DIR", "/data"), "period_reuse_map.json")
_REUSE_FILE_TTL = 7 * 86400
_reuse_lock = threading.Lock()


def _reuse_map() -> dict:
    """{TICKER: current-listing-start YYYYMMDD} for the whole warmed universe, floored at
    _REUSE_FLOOR. In-memory cache → durable /data file → compute (the slow whole-universe
    scan) once. Serialized so a stampede of pre-2004 requests computes it a single time."""
    cached = cache.get(_REUSE_CK)
    if cached is not None:
        return cached
    with _reuse_lock:
        cached = cache.get(_REUSE_CK)          # re-check under lock (a peer may have filled it)
        if cached is not None:
            return cached
        try:
            if os.path.exists(_REUSE_FILE) and (_time.time() - os.path.getmtime(_REUSE_FILE)) < _REUSE_FILE_TTL:
                with open(_REUSE_FILE) as fh:
                    m = json.load(fh)
                cache.set(_REUSE_CK, m, ttl=86400)
                return m
        except Exception:
            pass
        try:
            from api.services import bars_sqlite
            m = bars_sqlite.current_listing_starts(_REUSE_FLOOR)
        except Exception:
            m = {}
        cache.set(_REUSE_CK, m, ttl=86400)
        try:
            tmp = _REUSE_FILE + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(m, fh)
            os.replace(tmp, _REUSE_FILE)
        except Exception:
            pass
        return m


def warm_reuse_map() -> None:
    """Pre-warm the reuse map (startup background) so a pre-2004 sort never pays its
    one-time whole-universe scan on the compute path."""
    try:
        _reuse_map()
    except Exception:
        pass


def _to_date(ymd: int) -> date:
    s = str(int(ymd))
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _grouped_near(target: date):
    """({TICKER: adjusted close}, actual_date) via the whole-market grouped-daily endpoint,
    for the first trading day on/before target. FAST (two REST calls). Empty for a PRE-~2003
    date the provider doesn't cover — the caller then falls back to bars.db (off-thread)."""
    dt = target
    for _ in range(_GROUP_STEPS):
        try:
            m = massive.get_grouped_daily_closes(dt.isoformat(), adjusted=True)
        except Exception:
            m = {}
        if m:
            return m, dt
        dt = dt - timedelta(days=1)
    return {}, target


def _bars_near(target: date, indexed: bool):
    """({TICKER: close}, actual_date) from bars.db's deep (yfinance-sourced) daily history —
    the PRE-~2003 fallback. With the by-date daily index built (`indexed`), ONE contiguous
    windowed range-scan (`closes_near_date`) — fast even on cold storage. If the index isn't
    ready yet, fall back to per-ticker as-of seeks over the CS universe (`closes_asof`), which
    use the base index and avoid a full scan. App/hyphen keys, survivorship-biased coverage."""
    from api.services import bars_sqlite
    try:
        frm = target - timedelta(days=_GROUP_STEPS + 7)
        to_i, from_i = int(target.strftime("%Y%m%d")), int(frm.strftime("%Y%m%d"))
        if indexed:
            m = bars_sqlite.closes_near_date(to_i, from_i)
        else:
            m = bars_sqlite.closes_asof(list(_common_stock_symbols()), to_i, from_i)
    except Exception:
        m = {}
    return m, target


def _assemble(start_closes: dict, end_closes: dict, sd: date, ed: date, partial: bool, start_ymd: int) -> dict:
    """Turn two {ticker: close} maps into the ranked result set: normalize keys, filter to
    currently-trading common stock, (on the partial/bars.db path) drop recycled tickers, and
    compute % change per name."""
    # Normalize both sides to app/hyphen form so grouped (BRK.B) and bars.db (BRK-B) keys join.
    start_closes = {k.replace(".", "-"): v for k, v in start_closes.items()}
    end_closes = {k.replace(".", "-"): v for k, v in end_closes.items()}

    cs = _common_stock_symbols()
    if not cs:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}
    etfs = _etf_symbols()
    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    # Partial (bars.db) path: drop RECYCLED tickers whose CURRENT listing began after the
    # start date — their start close belongs to a different, prior company (SQ, WTW, RMIX…).
    # The reuse boundaries are STATIC historical data, so use the shared, cached, fixed-floor
    # map (computed once, not per range — that whole-universe window scan was the 3-5 min/range
    # cost). Only for start dates at/after the floor; a rare pre-floor sort computes its own.
    reuse = {}
    if partial:
        try:
            if int(start_ymd) >= _REUSE_FLOOR:
                reuse = _reuse_map()
            else:
                from api.services import bars_sqlite
                reuse = bars_sqlite.current_listing_starts(int(start_ymd))
        except Exception:
            reuse = {}

    results = []
    for app, sc in start_closes.items():
        if not sc or sc <= 0:
            continue
        ec = end_closes.get(app)
        if not ec or ec <= 0:
            continue
        if app not in cs or app in etfs or app.endswith("ZZT"):
            continue
        if partial and reuse.get(app, 0) > int(start_ymd):
            continue
        # Currently-trading filter (whole-market path): require the ticker in the live
        # snapshot to drop delisted names. On the partial path we KEEP names bars.db has.
        s = snap.get(app) or _snap_lookup(snap, app) if snap else None
        if snap and not s and not partial:
            continue
        results.append({
            "sym": app,
            "period_change": round((ec - sc) / sc * 100, 2),
            "net_change": round(ec - sc, 2),
            "start_close": round(sc, 4),
            "end_close": round(ec, 4),
            "price": (s.get("last_price") if s else None),
            "volume": (s.get("today_vol") if s else None),
        })
    results.sort(key=lambda r: r["period_change"], reverse=True)
    return {
        "status": "ok",
        "results": results,
        "count": len(results),
        "start": int(sd.strftime("%Y%m%d")),
        "end": int(ed.strftime("%Y%m%d")),
        "as_of": _now_et().isoformat(),
        "partial": partial,
    }


# In-flight pre-coverage (bars.db) computes — the slow full-scans run once per range on a
# background thread; concurrent requests for the same range just get "computing".
_partial_inflight: set = set()
_partial_lock = threading.Lock()


def _partial_bg(ck: str, start_ymd: int, end_ymd: int):
    try:
        from api.services import bars_sqlite
        # Build the by-date daily index once (fast no-op once present, incl. after the
        # startup pre-build) so the two whole-market reads are index-only range scans.
        indexed = bars_sqlite.ensure_daily_bydate_index()
        sc, sd = _bars_near(_to_date(start_ymd), indexed)
        ec, ed = _bars_near(_to_date(end_ymd), indexed)
        if not sc or not ec:
            out = {"status": "unavailable", "results": [], "count": 0,
                   "error": "Market-wide data isn't available this far back — it begins around 2003.",
                   "as_of": None}
            cache.set(ck, out, ttl=3600)
            return
        out = _assemble(sc, ec, sd, ed, True, start_ymd)
        cache.set(ck, out, ttl=_TTL if out.get("results") else 3600)
    except Exception:
        cache.set(ck, {"status": "unavailable", "results": [], "count": 0,
                       "error": "Couldn't load data for this period.", "as_of": None}, ttl=300)
    finally:
        with _partial_lock:
            _partial_inflight.discard(ck)


def get_period_change(start_ymd: int, end_ymd: int) -> dict:
    """Every US common stock's % change over [start, end], sorted desc (biggest gainers
    first). Whole-market via two fast grouped-daily calls; PRE-~2003 ranges fall back to
    bars.db on a BACKGROUND thread (returns "computing" until ready) so the slow scan never
    hangs the request. Shape: {status, results, count, start, end, as_of, partial}."""
    if start_ymd >= end_ymd:
        return {"status": "error", "results": [], "count": 0, "error": "start must be before end"}
    ck = f"scan_period_{start_ymd}_{end_ymd}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    start_closes, sd = _grouped_near(_to_date(start_ymd))   # fast (grouped-daily only)
    end_closes, ed = _grouped_near(_to_date(end_ymd))
    if start_closes and end_closes:
        out = _assemble(start_closes, end_closes, sd, ed, False, start_ymd)
        cache.set(ck, out, ttl=_TTL if out.get("results") else 15)
        return out

    # Grouped empty. A recent date may still be warming ("computing"); a date well in the
    # past is a provider-coverage boundary → kick the bars.db fallback onto a background
    # thread and report "computing" until it caches a result (never full-scan synchronously).
    bad = _to_date(start_ymd) if not start_closes else _to_date(end_ymd)
    if (_now_et().date() - bad).days > 30:
        with _partial_lock:
            if ck not in _partial_inflight:
                _partial_inflight.add(ck)
                threading.Thread(target=_partial_bg, args=(ck, start_ymd, end_ymd), daemon=True).start()
    return {"status": "computing", "results": [], "count": 0, "as_of": None}


def debug_period(start_ymd: int, end_ymd: int) -> dict:
    """Synchronous ground-truth probe for a stuck pre-2004 sort (admin diagnostic).
    Reports whether grouped-daily covers the dates, whether bars.db actually HOLDS
    daily data near them, the by-date index state, and the current cache/inflight
    state — so we can tell "slow" from "the deep history isn't on this pod." Bounded;
    does NOT full-scan (relies on the by-date index for counts)."""
    import time as _t
    from api.services import bars_sqlite
    ck = f"scan_period_{start_ymd}_{end_ymd}"
    out = {"start": start_ymd, "end": end_ymd, "cache_key": ck}

    t0 = _t.time()
    sc, sd = _grouped_near(_to_date(start_ymd))
    ec, ed = _grouped_near(_to_date(end_ymd))
    out["grouped"] = {
        "start_count": len(sc), "start_snapped": int(sd.strftime("%Y%m%d")),
        "end_count": len(ec), "end_snapped": int(ed.strftime("%Y%m%d")),
        "covers_both": bool(sc and ec), "ms": round((_t.time() - t0) * 1000),
    }
    try:
        out["bars_db"] = bars_sqlite.daily_coverage_probe(start_ymd, end_ymd)
    except Exception as e:
        out["bars_db"] = {"error": str(e)}
    cached = cache.get(ck)
    out["cache"] = {"present": cached is not None,
                    "status": (cached or {}).get("status"),
                    "count": (cached or {}).get("count")}
    with _partial_lock:
        out["inflight"] = ck in _partial_inflight
    try:
        cs = _common_stock_symbols()
        out["cs_universe_size"] = len(cs) if cs else 0
    except Exception as e:
        out["cs_universe_size"] = f"error: {e}"
    rm = cache.get(_REUSE_CK)
    out["reuse_map"] = {"warm": rm is not None, "size": (len(rm) if rm else 0),
                        "file": os.path.exists(_REUSE_FILE)}
    return out


def _sector_industry_map():
    """{app_sym: {'sector', 'industry'}} read from the prewarmed ticker_meta disk cache
    (the only whole-universe sector/industry source — no bulk API exists). Globbing ~4k
    small JSON files is ~1s, so cache it for 6h."""
    ck = "period_sector_industry_map"
    cached = cache.get(ck)
    if cached is not None:
        return cached
    import glob
    import json
    import os
    from api.services.ticker_meta import _CACHE_DIR
    out = {}
    try:
        for path in glob.glob(os.path.join(_CACHE_DIR, "*.json")):
            sym = os.path.splitext(os.path.basename(path))[0]
            try:
                with open(path) as fh:
                    d = json.load(fh)
            except Exception:
                continue
            out[sym] = {"sector": d.get("sector"), "industry": d.get("industry")}
    except Exception:
        pass
    cache.set(ck, out, ttl=21600)
    return out


def get_period_change_groups(start_ymd: int, end_ymd: int, group: str) -> dict:
    """Rank THEMES / SECTORS / INDUSTRIES by their equal-weight mean % change over
    [start, end], reusing the whole-market per-stock period_change. Each group carries its
    member symbols so the UI can drill into it. `group` ∈ {'theme','sector','industry'}."""
    if group not in ("theme", "sector", "industry"):
        return {"status": "error", "group": group, "results": [], "count": 0, "error": "bad group"}
    base = get_period_change(start_ymd, end_ymd)
    if base.get("status") != "ok":
        return {"status": base.get("status", "computing"), "group": group, "results": [], "count": 0, "error": base.get("error")}
    chg = {r["sym"]: r["period_change"] for r in base["results"]}

    buckets = {}  # name -> {"_sum", "count", "members"}
    if group == "theme":
        from api.services import theme_db
        try:
            themes = theme_db.get_all_themes().get("themes", [])
        except Exception:
            themes = []
        for th in themes:
            name = th.get("name")
            if not name:
                continue
            members, vals = [], []
            for h in th.get("holdings", []):
                if h.get("source") == "engine":   # owner-only aggregate (matches every UCT group metric)
                    continue
                s = str(h.get("sym", "")).replace(".", "-")   # taxonomy is dot-form; scan is hyphen-form
                if s in chg:
                    members.append(s)
                    vals.append(chg[s])
            if vals:
                buckets[name] = {"_sum": sum(vals), "count": len(vals), "members": members}
    else:
        smap = _sector_industry_map()
        field = group  # 'sector' | 'industry'
        for sym, c in chg.items():
            g = (smap.get(sym) or {}).get(field)
            if not g:
                continue
            b = buckets.setdefault(g, {"_sum": 0.0, "count": 0, "members": []})
            b["_sum"] += c
            b["count"] += 1
            b["members"].append(sym)

    results = []
    for name, b in buckets.items():
        results.append({
            "name": name,
            "period_change": round(b["_sum"] / b["count"], 2) if b["count"] else 0.0,
            "count": b["count"],
            "members": b["members"],
        })
    results.sort(key=lambda r: r["period_change"], reverse=True)
    return {
        "status": "ok",
        "group": group,
        "results": results,
        "count": len(results),
        "start": base.get("start"),
        "end": base.get("end"),
        "as_of": base.get("as_of"),
    }
