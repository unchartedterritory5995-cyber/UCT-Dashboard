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
    # Snapshot the ACTIVE set (what users actually navigate from: priority
    # + wire/UCT20/candidates/earnings + watchlists + tags) BEFORE the
    # cap_universe bulk-add. Heavy intraday warming is scoped to this set
    # (+ breadth drill lists + theme holdings, added below). The
    # cap_universe long tail still gets light Daily/Weekly/Monthly + the
    # on-demand-correct Part-1 path — just not proactive 5-TF intraday.
    _active = set(tickers)
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
                _tax = json.load(f)
            # PRE-EXISTING BUG FIX (2026-05-17): themes_taxonomy.json is a
            # dict {version, generated_at, sectors, themes} — the old
            # `for theme in themes:` iterated dict KEYS (strings),
            # AttributeError'd on .get(), and was silently swallowed by
            # the except. Net: Theme Tracker's ~1,316 holdings were NEVER
            # prewarmed. Walk the whole doc and collect every sym/ticker
            # value — robust to nesting (sectors→themes→holdings) and to
            # future structure changes. Exactly the broad navigation
            # surface the user wants kept fast.
            def _collect(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k in ("sym", "ticker") and isinstance(v, str) and v:
                            s = v.upper()
                            tickers.add(s); _active.add(s)
                        else:
                            _collect(v)
                elif isinstance(obj, list):
                    for x in obj:
                        _collect(x)
            _collect(_tax)
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
    # Breadth drill lists ARE the universe the user navigates from — fold
    # them into the active set explicitly.
    _active |= priority_set | fast_path_set
    rest = sorted(tickers - priority_set - fast_path_set)
    ticker_list = _PRIORITY + _FAST_PATH + rest
    # The ACTIVE intraday list = priority + breadth drill lists + wire/
    # watchlist/tag/theme tickers (everything EXCEPT the cap_universe-only
    # long tail). This is what gets proactive 5-TF intraday warming.
    _active_intraday = (
        _PRIORITY + _FAST_PATH
        + sorted(_active - priority_set - fast_path_set)
    )
    print(f"[prewarm] Order: {len(_PRIORITY)} priority + {len(_FAST_PATH)} breadth-list + {len(rest)} long-tail = {len(ticker_list)} tickers")
    print(f"[prewarm] Active intraday set: {len(_active_intraday)} tickers "
          f"(scoped to breadth/watchlist/UCT20/candidates/themes; "
          f"cap_universe long tail = on-demand intraday only)")
    from concurrent.futures import ThreadPoolExecutor as _PrewarmTPE
    from api.routers.bars import _get_bars_inner, _needs_fresh
    from api.services import bars_sqlite as _sqlite
    # Prewarmer runs on the DEDICATED worker (USE_REMOTE_BARS=1 gates it
    # off on web). Proactive 5-TF intraday warming is scoped to the
    # ACTIVE set — the tickers users actually navigate from (Breadth
    # drill lists + watchlists + UCT20 + candidates + theme holdings +
    # priority), NOT the full cap_universe long tail. Rationale: that's
    # where ~all real chart opens originate, it keeps those lists very
    # fresh on a tight cycle, and it slashes worker SQLite write volume
    # (more headroom behind the write-lock / busy_timeout). The
    # cap_universe-only long tail still gets light Daily/Weekly/Monthly
    # universe-wide + the on-demand Part-1 path (correct on first open,
    # ~2-4s then cached) — never wrong, just not pre-warmed. TFs tiered:
    # 60/30/15 for the whole active set; 5/1 (heavier) for the top tier.
    _IS_WORKER = os.environ.get("WORKER_ENABLED") == "1"
    _CORE_INTRADAY_TFS = ('60', '30', '15')
    _DEEP_INTRADAY_TFS = ('5', '1')
    _INTRADAY_TFS = _CORE_INTRADAY_TFS + _DEEP_INTRADAY_TFS  # refresh-loop hot-set union
    if _IS_WORKER:
        _CORE_INTRADAY_TICKERS = _active_intraday       # active set, not full universe
        _DEEP_INTRADAY_TICKERS = _active_intraday[:800]
        # 4 (not 6): fetches are network-bound so 4 still parallelises
        # well, but fewer concurrent writers = a much shorter wait queue
        # behind the SQLite write lock. Sweet spot for throughput.
        _PREWARM_WORKERS = 4
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
