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

    # Whole-market (grouped) path: cross-check against bars.db to drop tickers whose grouped
    # START close is BOGUS — recently-listed / recycled names (e.g. QH showing +3941%) that
    # didn't actually trade in their current listing at the start date. Signal: bars.db has
    # the name NEAR THE END but NOT at the start (its listing began after the start), or the
    # bars.db %-change wildly contradicts grouped (a stale/mis-adjusted start close). Fast:
    # two windowed range scans via the by-date index — skipped (not blocking) if it isn't built.
    bdb_start, bdb_end = {}, {}
    if not partial:
        try:
            from api.services import bars_sqlite
            if bars_sqlite.daily_bydate_index_ready():
                s_hi = int(sd.strftime("%Y%m%d")); s_lo = int((sd - timedelta(days=15)).strftime("%Y%m%d"))
                e_hi = int(ed.strftime("%Y%m%d")); e_lo = int((ed - timedelta(days=15)).strftime("%Y%m%d"))
                bdb_start = bars_sqlite.closes_near_date(s_hi, s_lo)
                bdb_end = bars_sqlite.closes_near_date(e_hi, e_lo)
        except Exception:
            bdb_start, bdb_end = {}, {}
    _xcheck = bool(bdb_start and bdb_end)   # only filter when both bars.db sides are present

    # Attach each name's industry/sector from the in-memory map so the frontend's Industry
    # column is PRE-LOADED for every row (no per-scroll meta fetch, no "—" flash). 6h-cached.
    try:
        smap = _sector_industry_map()
    except Exception:
        smap = {}

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
        if _xcheck and app in bdb_end and app not in bdb_start:
            continue   # trades now but not at the start → listing began after start → bogus start close
        if _xcheck:
            bs, be = bdb_start.get(app), bdb_end.get(app)
            if bs and be and bs > 0:
                gp = (ec - sc) / sc * 100      # grouped % change
                bp = (be - bs) / bs * 100      # bars.db % change (independent source)
                if abs(gp) > 150 and abs(gp - bp) > 150 and abs(gp) > 3 * abs(bp) + 100:
                    continue   # the two sources wildly disagree → grouped start close is suspect
        # Currently-trading filter (whole-market path): require the ticker in the live
        # snapshot to drop delisted names. On the partial path we KEEP names bars.db has.
        s = snap.get(app) or _snap_lookup(snap, app) if snap else None
        if snap and not s and not partial:
            continue
        _si = smap.get(app) or {}
        results.append({
            "sym": app,
            "period_change": round((ec - sc) / sc * 100, 2),
            "net_change": round(ec - sc, 2),
            "start_close": round(sc, 4),
            "end_close": round(ec, 4),
            "price": (s.get("last_price") if s else None),
            "volume": (s.get("today_vol") if s else None),
            "industry": _si.get("industry"),
            "sector": _si.get("sector"),
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
        # Only USE the by-date index if the startup pre-build already made it — never
        # trigger the build from here. A CREATE INDEX holds a multi-minute SQLite write
        # transaction; kicking it off mid-session would make bar writes contend site-wide.
        # If it's not ready yet, fall back to per-ticker seeks (slower, but no build).
        indexed = bars_sqlite.daily_bydate_index_ready()
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
        if out.get("status") == "ok":
            _kick_period_daily_warm(ck, out.get("results"))
    except Exception:
        cache.set(ck, {"status": "unavailable", "results": [], "count": 0,
                       "error": "Couldn't load data for this period.", "as_of": None}, ttl=300)
    finally:
        with _partial_lock:
            _partial_inflight.discard(ck)


# ── Server-side deep-daily warm (make the lists bulletproof) ──────────────────
# When a sort produces results, pre-build the DEEP daily history for the top-ranked
# tickers into the SAME serve caches /api/bars reads (via _get_bars_inner), so opening
# any of them is an instant cache hit instead of a cold multi-second provider build —
# the frontend warm races the user, this guarantees the server side is ready.
#
# SAFE + CHEAP by construction: bounded (the shared max-4 _bars_warm_pool), DAILY only,
# capped (_PERIOD_WARM_CAP), deduped per range (fires once, not per poll), and
# _get_bars_inner short-circuits already-cached tickers — so a re-sort costs ~0 and only
# genuinely-cold names ever touch the provider (then disk-cached ~48h). Flag-killable.
_PERIOD_WARM_ENABLED = os.environ.get("PERIOD_WARM_ENABLED", "1") == "1"
_PERIOD_WARM_CAP = int(os.environ.get("PERIOD_WARM_CAP", "600"))
_DEEP_DAILY_BARS = 12500          # matches the frontend fullBarsFor('D') deep request
_period_warm_seen: set = set()
_period_warm_lock = threading.Lock()


def _kick_period_daily_warm(ck: str, results) -> None:
    if not _PERIOD_WARM_ENABLED or not results:
        return
    with _period_warm_lock:
        if ck in _period_warm_seen:
            return
        _period_warm_seen.add(ck)
        if len(_period_warm_seen) > 500:      # bound the dedup set (many distinct ranges)
            _period_warm_seen.clear()
            _period_warm_seen.add(ck)
    syms = [r.get("sym") for r in results[:_PERIOD_WARM_CAP] if r.get("sym")]
    # The sort's START — the deep warm need only cover history back to here (a name already
    # holding a bar at/before it is skipped). Parsed from ck = "scan_period_{start}_{end}".
    try:
        start_ymd = int(ck.split("_")[2])
    except Exception:
        start_ymd = None

    def _run():
        try:
            from api.services.bars_fetch import warm_ticker_daily_deep, _bars_warm_pool
            for s in syms:
                try:
                    # Deep FETCH + persist the FULL daily history (not just _get_bars_inner,
                    # which can return recent-only for an old-era name) so a 2008-replay chart
                    # is already in SQLite ≤ cutoff. Skips tickers already deep enough.
                    _bars_warm_pool.submit(warm_ticker_daily_deep, s, start_ymd)
                except RuntimeError:          # pool shutting down
                    break
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True, name="period-daily-warm").start()


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
        if cached.get("status") == "ok":
            _kick_period_daily_warm(ck, cached.get("results"))
        return cached

    # Fetch BOTH whole-market dates AND prewarm the full-market snapshot CONCURRENTLY — these
    # three ~8,000-ticker calls were sequential (the 30-40s wait). Snapshot lands in its own
    # cache so _assemble reads it instantly; grouped-daily is now cached per date too.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="period-fetch") as _ex:
        _fs = _ex.submit(_grouped_near, _to_date(start_ymd))
        _fe = _ex.submit(_grouped_near, _to_date(end_ymd))
        _ex.submit(lambda: massive._get_client().get_full_market_snapshot())  # prewarm cache
        start_closes, sd = _fs.result()
        end_closes, ed = _fe.result()
    if start_closes and end_closes:
        out = _assemble(start_closes, end_closes, sd, ed, False, start_ymd)
        cache.set(ck, out, ttl=_TTL if out.get("results") else 15)
        if out.get("status") == "ok":
            _kick_period_daily_warm(ck, out.get("results"))
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


def coverage_probe(start_ymd: int, end_ymd: int) -> dict:
    """Would serving this range from bars.db (skipping the provider's grouped-daily call)
    give the SAME ranked list? Instruments the risk of the 'bars.db-primary' speedup.

    The provider's grouped-daily set is the authoritative, complete universe for a date.
    bars.db is survivorship-biased (delisted names absent) and coverage-dependent. This
    compares, at the RESULT level, the names each source would produce — a name only makes
    the list if it has BOTH a start and end close, is common stock, and isn't an ETF — then
    reports what bars.db would DROP versus the provider, with special attention to whether
    any dropped name is a big mover (the visible failure). Read-only; no writes, no warm."""
    from api.services import bars_sqlite
    sd_t, ed_t = _to_date(start_ymd), _to_date(end_ymd)

    # Authoritative provider closes (normalize BRK.B → BRK-B to match bars.db storage form).
    prov_s, sd = _grouped_near(sd_t)
    prov_e, ed = _grouped_near(ed_t)
    prov_s = {k.replace(".", "-"): v for k, v in prov_s.items()}
    prov_e = {k.replace(".", "-"): v for k, v in prov_e.items()}

    idx_ready = bars_sqlite.daily_bydate_index_ready()
    bdb_s = bdb_e = {}
    if idx_ready:
        # Same ±15-day windows _assemble uses for its cross-check.
        s_hi = int(sd.strftime("%Y%m%d")); s_lo = int((sd - timedelta(days=15)).strftime("%Y%m%d"))
        e_hi = int(ed.strftime("%Y%m%d")); e_lo = int((ed - timedelta(days=15)).strftime("%Y%m%d"))
        bdb_s = bars_sqlite.closes_near_date(s_hi, s_lo)
        bdb_e = bars_sqlite.closes_near_date(e_hi, e_lo)

    cs = _common_stock_symbols() or set()
    etfs = _etf_symbols() or set()

    def _result_set(start_map, end_map):
        """Names that would appear in the ranked list from this source, → their % change."""
        out = {}
        for app, sc in start_map.items():
            if not sc or sc <= 0:
                continue
            ec = end_map.get(app)
            if not ec or ec <= 0:
                continue
            if app not in cs or app in etfs or app.endswith("ZZT"):
                continue
            out[app] = (ec - sc) / sc * 100
        return out

    prov_res = _result_set(prov_s, prov_e)
    bdb_res = _result_set(bdb_s, bdb_e) if (bdb_s and bdb_e) else {}

    prov_names = set(prov_res)
    bdb_names = set(bdb_res)
    dropped = prov_names - bdb_names          # in the provider list, MISSING from bars.db → would vanish
    extra = bdb_names - prov_names            # bars.db has, provider doesn't (rare; stale/survivorship)
    overlap = prov_names & bdb_names

    cov_pct = round(100 * len(overlap) / len(prov_names), 2) if prov_names else None

    # The killer metric: are the dropped names BIG movers? A dropped +300% gainer is a
    # visible, unacceptable list change; a dropped ±2% name nobody would notice. Rank the
    # dropped names by |provider % change| and show the worst offenders.
    dropped_ranked = sorted(
        ({"sym": s, "pct": round(prov_res[s], 2)} for s in dropped),
        key=lambda r: abs(r["pct"]), reverse=True,
    )
    big_dropped = [d for d in dropped_ranked if abs(d["pct"]) >= 25]

    # Price agreement on the overlap: median |Δ| between the two sources' computed % change.
    # A large divergence = split-adjustment / staleness mismatch (bars.db close on a wrong basis).
    diffs = sorted(abs(prov_res[s] - bdb_res[s]) for s in overlap)
    if diffs:
        median_diff = round(diffs[len(diffs) // 2], 3)
        p95_diff = round(diffs[int(len(diffs) * 0.95)], 3)
        big_disagree = sum(1 for d in diffs if d > 5)  # >5 percentage-points apart
    else:
        median_diff = p95_diff = big_disagree = None

    return {
        "start": int(sd.strftime("%Y%m%d")), "end": int(ed.strftime("%Y%m%d")),
        "index_ready": idx_ready,
        "provider_result_count": len(prov_names),
        "bars_db_result_count": len(bdb_names),
        "overlap": len(overlap),
        "coverage_pct": cov_pct,                       # % of provider names bars.db also has
        "dropped_count": len(dropped),                 # names that would DISAPPEAR from the list
        "dropped_big_movers_count": len(big_dropped),  # of those, how many moved ≥25% (the real risk)
        "dropped_big_movers_sample": big_dropped[:25],
        "dropped_worst_sample": dropped_ranked[:15],
        "extra_in_bars_db_count": len(extra),
        "price_agreement": {                           # on the overlapping names
            "median_pct_diff": median_diff,
            "p95_pct_diff": p95_diff,
            "names_over_5pp_apart": big_disagree,
        },
        "verdict_hint": (
            "bars.db not usable (index not built / no data near dates)" if not bdb_res else
            "SAFE-looking: near-complete coverage + close price agreement"
            if (cov_pct or 0) >= 99 and not big_dropped and (median_diff or 0) < 2 else
            "RISKY: bars.db would drop names or diverge on price — keep provider-primary"
        ),
    }


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


def _robust_group_pct(vals) -> float:
    """Group's representative % change, robust to a single moonshot outlier (upside-winsorized
    mean). Shared implementation lives in api/services/robust_agg — the Theme Tracker uses the
    same one so both rankings treat outliers identically."""
    from api.services.robust_agg import robust_group_pct
    return robust_group_pct(vals)


def get_period_change_groups(start_ymd: int, end_ymd: int, group: str) -> dict:
    """Rank THEMES / SECTORS / INDUSTRIES by their (outlier-robust) % change over
    [start, end], reusing the whole-market per-stock period_change. Each group carries its
    member symbols so the UI can drill into it. `group` ∈ {'theme','sector','industry'}.
    Ranking uses `_robust_group_pct` (upside-winsorized mean) so one moonshot can't top a
    group; members still show their own raw % change."""
    if group not in ("theme", "sector", "industry"):
        return {"status": "error", "group": group, "results": [], "count": 0, "error": "bad group"}
    base = get_period_change(start_ymd, end_ymd)
    if base.get("status") != "ok":
        return {"status": base.get("status", "computing"), "group": group, "results": [], "count": 0, "error": base.get("error")}
    chg = {r["sym"]: r["period_change"] for r in base["results"]}

    buckets = {}  # name -> {"vals": [member % changes], "members": [syms]}
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
                buckets[name] = {"vals": vals, "members": members}
    else:
        smap = _sector_industry_map()
        field = group  # 'sector' | 'industry'
        for sym, c in chg.items():
            g = (smap.get(sym) or {}).get(field)
            if not g:
                continue
            b = buckets.setdefault(g, {"vals": [], "members": []})
            b["vals"].append(c)
            b["members"].append(sym)

    results = []
    for name, b in buckets.items():
        results.append({
            "name": name,
            "period_change": round(_robust_group_pct(b["vals"]), 2),
            "count": len(b["vals"]),
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
