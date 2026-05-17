"""Bars pre-warmer — the long-running loop that periodically refreshes
the most-viewed tickers' SQLite + disk cache entries.

Lives in services/ (not main.py) so the worker service can import it
without dragging in FastAPI."""
import os
import json
import shutil
import sqlite3


def run_prewarmer_forever():
    """Entry point: blocks forever, refreshing the cache every 5 minutes.

    Behavior preserved exactly from the previous inline _prewarm_bars in
    api/main.py.lifespan(). BARS_PREWARM_ENABLED env var still gates the
    actual work — if unset, this function returns immediately.

    NOTE: the 'cache' reference in the wire_data try-block previously
    silently failed (NameError swallowed by except). It is now properly
    imported here so wire_data tickers are actually included."""
    if os.environ.get("BARS_PREWARM_ENABLED", "0") != "1":
        print("[prewarm] Skipped (set BARS_PREWARM_ENABLED=1 to enable).")
        return
    from api.services import bars_disk_cache as _disk
    import time as _t
    purged = _disk.purge_empty()
    if purged:
        print(f"[prewarm] Purged {purged} empty cache entries")
    _purge_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".cache_nuked_v2")
    if not os.path.exists(_purge_flag):
        _cache_dir = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")
        try:
            if os.path.isdir(_cache_dir):
                shutil.rmtree(_cache_dir)
                print(f"[prewarm] Nuked entire bars_cache directory")
        except Exception as e:
            print(f"[prewarm] Cache nuke failed: {e}")
        try:
            with open(_purge_flag, "w") as f:
                f.write("done")
        except Exception:
            pass
    tickers = set()
    tickers.update(['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                    'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                    'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER'])
    try:
        from api.services.cache import cache
        wd = cache.get("wire_data")
        if wd:
            for pick in (wd.get("uct20") or wd.get("leadership") or []):
                sym = pick.get("ticker") or pick.get("sym")
                if sym: tickers.add(sym.upper())
            cands = wd.get("candidates") or {}
            for group in (cands.get("pullback_ma") or [], cands.get("remount") or [], cands.get("gapper_news") or []):
                for c in (group if isinstance(group, list) else []):
                    sym = c.get("ticker") or c.get("sym")
                    if sym: tickers.add(sym.upper())
            earn = wd.get("earnings") or {}
            for bucket in (earn.get("bmo") or [], earn.get("amc") or []):
                for e in bucket:
                    sym = e.get("sym") or e.get("ticker")
                    if sym: tickers.add(sym.upper())
    except Exception:
        pass
    try:
        from api.services.auth_db import get_db_path
        db = sqlite3.connect(get_db_path())
        for tbl, col in [("watchlist_items", "sym"), ("ticker_tags", "sym")]:
            try:
                rows = db.execute(f"SELECT DISTINCT {col} FROM {tbl}").fetchall()
                for (sym,) in rows:
                    if sym: tickers.add(sym.upper())
            except Exception:
                pass
        db.close()
    except Exception:
        pass
    try:
        cap_path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                cap_tickers = json.load(f)
            tickers.update(t.upper() for t in cap_tickers if t)
            print(f"[prewarm] Loaded {len(cap_tickers)} tickers from cap_universe.json")
    except Exception:
        pass
    try:
        taxonomy_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "themes_taxonomy.json")
        if os.path.exists(taxonomy_path):
            with open(taxonomy_path) as f:
                themes = json.load(f)
            for theme in themes:
                etf = theme.get("ticker")
                if etf: tickers.add(etf.upper())
                for h in (theme.get("holdings") or []):
                    tickers.add(h["sym"].upper())
    except Exception:
        pass
    tickers.discard('')
    _PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                  'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                  'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER']
    priority_set = set(_PRIORITY)
    _FAST_PATH: list[str] = []
    try:
        from api.services import breadth_monitor as _bm
        latest = _bm.get_latest()
        if latest:
            seen: set[str] = set()
            for k, v in latest.items():
                if not k.endswith('_list') or not isinstance(v, list): continue
                for item in v:
                    if isinstance(item, dict):
                        sym = item.get('t')
                        if sym and sym.upper() not in seen and sym.upper() not in priority_set:
                            seen.add(sym.upper())
                            _FAST_PATH.append(sym.upper())
    except Exception as e:
        print(f"[prewarm] Fast-path lookup failed: {e}")
    fast_path_set = set(_FAST_PATH)
    rest = sorted(tickers - priority_set - fast_path_set)
    ticker_list = _PRIORITY + _FAST_PATH + rest
    print(f"[prewarm] Order: {len(_PRIORITY)} priority + {len(_FAST_PATH)} breadth-list + {len(rest)} long-tail = {len(ticker_list)} tickers")
    from concurrent.futures import ThreadPoolExecutor as _PrewarmTPE
    from api.routers.bars import _get_bars_inner, _needs_fresh
    from api.services import bars_sqlite as _sqlite
    # The prewarmer runs on the DEDICATED worker service in production
    # (USE_REMOTE_BARS=1 gates it off on web). The old [:200] intraday
    # cap was a web-process memory safeguard; the worker has its own
    # 50GB volume and serves no requests, so it can — and must —
    # pre-warm intraday for the WHOLE universe. That warmth then reaches
    # web via the existing R2 newer-wins merge, making every chart open
    # instant + fresh instead of a ~4s cold synchronous fetch. TFs are
    # tiered for sustainability: 60/30/15 (most-viewed; the ones the
    # freeze broke) for ALL tickers; 5/1 (heavier, less-viewed) for a
    # large priority tier. The in-process web path keeps the small cap.
    _IS_WORKER = os.environ.get("WORKER_ENABLED") == "1"
    _CORE_INTRADAY_TFS = ('60', '30', '15')
    _DEEP_INTRADAY_TFS = ('5', '1')
    _INTRADAY_TFS = _CORE_INTRADAY_TFS + _DEEP_INTRADAY_TFS  # refresh-loop hot-set union
    if _IS_WORKER:
        _CORE_INTRADAY_TICKERS = ticker_list            # full universe
        _DEEP_INTRADAY_TICKERS = ticker_list[:800]
        _PREWARM_WORKERS = 6
    else:
        _CORE_INTRADAY_TICKERS = ticker_list[:200]
        _DEEP_INTRADAY_TICKERS = ticker_list[:200]
        _PREWARM_WORKERS = 2
    def _warm_one(args):
        sym, tf, bar_count = args
        try:
            last_ts = _sqlite.get_last_ts(sym.upper(), tf)
            if not _needs_fresh(last_ts, tf):
                return ('skipped', sym, tf)
            _get_bars_inner(sym.upper(), tf, bar_count)
            return ('warmed', sym, tf)
        except Exception:
            pass
        return ('failed', sym, tf)
    jobs = []
    for sym in ticker_list: jobs.append((sym, 'D', 5000))
    for sym in ticker_list: jobs.append((sym, 'W', 5000))
    for sym in ticker_list: jobs.append((sym, 'M', 5000))
    for sym in _CORE_INTRADAY_TICKERS:
        for tf in _CORE_INTRADAY_TFS: jobs.append((sym, tf, 5000))
    for sym in _DEEP_INTRADAY_TICKERS:
        for tf in _DEEP_INTRADAY_TFS: jobs.append((sym, tf, 5000))
    print(f"[prewarm] {len(jobs)} jobs queued (worker={_IS_WORKER}; D/W/M all "
          f"+ {len(_CORE_INTRADAY_TICKERS)}x{len(_CORE_INTRADAY_TFS)} core "
          f"+ {len(_DEEP_INTRADAY_TICKERS)}x{len(_DEEP_INTRADAY_TFS)} deep intraday)")
    warmed = 0
    skipped = 0
    fast_path_size_jobs = (len(_PRIORITY) + len(_FAST_PATH))
    with _PrewarmTPE(max_workers=_PREWARM_WORKERS, thread_name_prefix="prewarm-bars") as ex:
        for i, (status, _sym, _tf) in enumerate(ex.map(_warm_one, jobs), start=1):
            if status == 'warmed': warmed += 1
            elif status == 'skipped': skipped += 1
            if i == fast_path_size_jobs:
                print(f"[prewarm] ★ Fast-path complete ({i} jobs) — Breadth scanning is hot. Continuing with long-tail in background.")
            if i % 500 == 0:
                print(f"[prewarm] Progress {i}/{len(jobs)} — {warmed} fetched, {skipped} cached")
    print(f"[prewarm] First pass complete: {warmed} fetched, {skipped} cached, {len(jobs)} total")
    while True:
        _t.sleep(300)
        # Augment the static job list with intraday for the live hot-set —
        # the tickers users are actually flipping through. Without this,
        # anything outside ticker_list[:200] only ever refreshed when a
        # user happened to hit it twice (the universe-freeze bug). Tuple
        # set-union dedups against the static jobs.
        cycle_jobs = jobs
        try:
            from api.services.bars_fetch import get_hot_intraday_tickers
            hot = get_hot_intraday_tickers(500)
            # P-2: this prewarmer runs in the WORKER process, so its own
            # get_hot_intraday_tickers() is empty (the web process records
            # views). Union the web-published hot-set from R2 so what
            # users actually flip through is refreshed first.
            try:
                from api.services import data_sync as _ds
                _r2_hot = _ds.get_hotset()
                if _r2_hot:
                    hot = list({*hot, *_r2_hot})
            except Exception:
                pass
            if hot:
                hot_jobs = [(s, tf, 5000) for s in hot for tf in _INTRADAY_TFS]
                cycle_jobs = list({*jobs, *hot_jobs})
                print(f"[prewarm] Hot-set: +{len(hot)} user-viewed tickers "
                      f"({len(cycle_jobs) - len(jobs)} extra intraday jobs)")
        except Exception as _e:
            print(f"[prewarm] Hot-set lookup failed (non-fatal): {_e}")
        refresh_jobs = [j for j in cycle_jobs if _needs_fresh(_sqlite.get_last_ts(j[0].upper(), j[1]), j[1])]
        if not refresh_jobs: continue
        refreshed = 0
        with _PrewarmTPE(max_workers=_PREWARM_WORKERS, thread_name_prefix="prewarm-refresh") as ex:
            for status, _sym, _tf in ex.map(_warm_one, refresh_jobs):
                if status == 'warmed': refreshed += 1
        if refreshed:
            print(f"[prewarm] Refresh pass: {refreshed} of {len(refresh_jobs)} entries refilled")
