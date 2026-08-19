"""Bars pre-warmer — the long-running loop that periodically refreshes
the most-viewed tickers' SQLite + disk cache entries.

Lives in services/ (not main.py) so the worker service can import it
without dragging in FastAPI."""
import os
import json
import shutil
import sqlite3
import threading
import time as _time


# ── Prewarmer liveness heartbeat ─────────────────────────────────────────────
# The prewarmer is the sole thing keeping the worker's bars.db warm. It ran for
# WEEKS as an UNSUPERVISED daemon thread whose refresh-loop body had no try/except,
# so a single `get_last_ts` raise (e.g. a transient `database is locked`) escaped
# `while True` and killed warming permanently while the process stayed up and the
# uploader kept shipping the now-frozen db — invisible to every monitor (the
# 2026-08-11 week-long daily freeze). This heartbeat + the loop guard + the
# supervisor below make that failure loud and self-healing.
_STATE_LOCK = threading.Lock()
# 🔴 2026-08-18: the heartbeat below existed ONLY in the steady refresh loop, and
# that loop is entered only AFTER the boot pass — 25,482 jobs, ~140 jobs/min,
# ~3 HOURS. The watchdog reaches its first verdict ~25 min in, so every worker
# deploy produced 2.5h of "prewarmer never started" while warming ran at full
# tilt. Liveness now begins the moment the prewarmer starts WORKING, and `phase`
# separates "starting up" from "steady state" so the alert can tell an operator
# whether a redeploy helps (dead) or hurts (booting).
_PREWARM_FRESH_STATE = {
    "started_ts": None,     # when the prewarmer last BEGAN working (boot entry)
    "last_beat_ts": None,   # most recent unit of work (liveness)
    "last_refresh_ts": None,  # last cycle that actually refreshed >=1 entry
    "phase": None,          # None until start; then one of _PHASES (below)
    "boot_done": 0,         # jobs consumed by the boot pass so far
    "boot_total": 0,        # jobs the boot pass was handed
    "refresh_done": 0,      # jobs consumed by the CURRENT steady refresh pass
    "refresh_total": 0,     # jobs that pass was handed
    "iterations": 0,        # STEADY-loop iterations (unchanged meaning)
    "restarts": 0,
    "last_error": None,
}
_PREWARM_STATE = dict(_PREWARM_FRESH_STATE)


def _reset_prewarm_state() -> None:
    """Restore the pristine heartbeat. Test seam — a module global that carries
    over between tests makes every `alive` assertion pass vacuously."""
    with _STATE_LOCK:
        _PREWARM_STATE.clear()
        _PREWARM_STATE.update(_PREWARM_FRESH_STATE)


# The lifecycle, and the ONE place it is enumerated. The alert branches on these
# strings, so a typo'd phase would fall through to the wrong remedy silently —
# which is the whole defect this file was changed to fix. _set_phase raises instead.
_PHASES = (
    "boot",      # first full pass over the universe; a redeploy RESTARTS it
    "steady",    # refresh loop; a redeploy costs one cycle
    "disabled",  # BARS_PREWARM_ENABLED != 1; no redeploy can help
)


def _set_phase(phase: str, *, total: int = 0, beat: bool = True) -> None:
    """Move the prewarmer between lifecycle phases, beating as it goes.

    ⛔ `beat=False` for any phase that is NOT work — "disabled" must never look
    alive, or the watchdog would report a healthy prewarmer that does nothing.
    """
    if phase not in _PHASES:
        raise ValueError(f"unknown prewarm phase {phase!r}; expected one of {_PHASES}")
    with _STATE_LOCK:
        now = _time.time()
        _PREWARM_STATE["phase"] = phase
        if beat:
            _PREWARM_STATE["last_beat_ts"] = now
        if phase == "boot":
            _PREWARM_STATE["started_ts"] = now
            _PREWARM_STATE["boot_total"] = total
            _PREWARM_STATE["boot_done"] = 0


def _beat(refreshed: int = 0, *, boot_done: int | None = None,
          refresh_done: int | None = None) -> None:
    """Prove the prewarmer is doing work.

    Three callers, one meaning — "I am alive right now":
      * the steady loop, once per cycle          -> advances `iterations`
      * the boot pass, per job                   -> advances `boot_done`
      * the steady REFRESH pass, per job         -> advances `refresh_done`

    ⛔ Only the bare call counts an iteration. `iterations` means "steady-loop
    cycles" and an operator reads it that way; letting a 20,000-job pass inflate
    it would destroy the one number that says how many times the loop went round.
    """
    with _STATE_LOCK:
        now = _time.time()
        _PREWARM_STATE["last_beat_ts"] = now
        if boot_done is not None:
            _PREWARM_STATE["boot_done"] = boot_done
        elif refresh_done is not None:
            _PREWARM_STATE["refresh_done"] = refresh_done
        else:
            _PREWARM_STATE["iterations"] += 1
        if refreshed:
            _PREWARM_STATE["last_refresh_ts"] = now


def _run_refresh_pass(results, total: int) -> int:
    """Consume a steady-loop refresh pass, BEATING on every job.

    🔴 2026-08-19: THE SAME HOLE THE BOOT PASS HAD, ONE LOOP DOWN, AND THE FIX
    FOR THE BOOT PASS DID NOT CLOSE IT. `_beat()` sat only at the top of
    `while True`, and this pass — an unbounded `ex.map` over every stale entry —
    ran underneath it with nothing proving liveness. Measured on the live pod:
    `phase=steady, iterations=11, last_error=None, age_seconds=4896` — 81 minutes
    into a healthy refresh with `alive` already false at the 2700s threshold, so
    the watchdog was about to report a working prewarmer as DEAD.

    ⭐ THE RULE, STATED ONCE: any region that can outlast the liveness threshold
    must beat inside it. A heartbeat at the top of a loop only proves the loop
    turned over, never that the body is still moving.
    """
    refreshed = 0
    with _STATE_LOCK:
        _PREWARM_STATE["refresh_total"] = total
        _PREWARM_STATE["refresh_done"] = 0
    # Entering the pass IS work — beat before the first job so liveness never
    # depends on how long the executor takes to yield its first result.
    _beat(refresh_done=0)
    for i, (status, _sym, _tf) in enumerate(results, start=1):
        if status == 'warmed':
            refreshed += 1
        _beat(refresh_done=i)
    return refreshed


def _scan_stale(cycle_jobs, needs_fresh, last_ts) -> list:
    """The freshness scan, beating as it walks.

    Also inside the unbeaten region: ~25k SQLite reads before the executor even
    starts. Fast when the DB is healthy, and exactly the call that raised and
    killed the loop in the 2026-08-11 freeze — so a slow or lock-contended scan
    is precisely when liveness matters most.
    """
    out = []
    for i, j in enumerate(cycle_jobs, start=1):
        if needs_fresh(last_ts(j[0].upper(), j[1]), j[1]):
            out.append(j)
        if i % 500 == 0:
            _beat(refresh_done=0)
    return out


def _run_boot_pass(results, total: int, fast_path_size: int):
    """Consume the first-pass results, BEATING on every job.

    ⭐ THE WHOLE POINT: this used to be an inline `for` in run_prewarmer_forever
    with no beat in it, so the prewarmer looked dead for the entire pass. Extracted
    so liveness can be tested from INSIDE the pass — the moment the watchdog
    samples it — instead of after it returns, which was never the broken reading.
    """
    warmed = 0
    skipped = 0
    _set_phase("boot", total=total)
    for i, (status, _sym, _tf) in enumerate(results, start=1):
        if status == 'warmed':
            warmed += 1
        elif status == 'skipped':
            skipped += 1
        _beat(boot_done=i)
        if i == fast_path_size:
            print(f"[prewarm] ★ Fast-path complete ({i} jobs) — Breadth scanning is hot. Continuing with long-tail in background.")
        if i % 500 == 0:
            print(f"[prewarm] Progress {i}/{total} — {warmed} fetched, {skipped} cached")
    # Only on a clean finish. A raise here propagates to run_prewarmer_supervised,
    # which restarts and re-enters "boot" — marking "steady" in a `finally` would
    # report a steady loop that is not running.
    _set_phase("steady")
    return warmed, skipped


def _in_active_data_window() -> bool:
    """THE one authority on "can market data still change right now". The steady
    refresh loop already throttles on it; the boot pass now agrees with it rather
    than holding a second opinion."""
    from api.services.data_sync import in_active_data_window
    return in_active_data_window()


def _expected_session() -> int:
    """THE one authority on "which session should the newest bar be" — the same
    call the daily-freshness watchdog grades the store against."""
    from api.services.bars_fetch import _expected_latest_session_yyyymmdd
    return _expected_latest_session_yyyymmdd()


_BOOT_SETTLED_TFS = ("D", "W", "M")


def _boot_can_skip(last_ts, tf) -> bool:
    """True when a boot-pass D/W/M job is provably a no-op fetch.

    ⭐ WHY THE BOOT PASS TOOK 3 HOURS. `_needs_fresh` answers `last_ts <= today`
    for D/W/M — deliberately True even when the stored bar IS today's, because an
    open session's high/low/close keep drifting. That is right during the session,
    where the in-memory 5-min TTL absorbs the repeats. The boot pass has a COLD
    in-memory cache, so nothing absorbs them: ~12,000 guaranteed no-op vendor
    fetches on every single deploy, which is what kept the steady loop from ever
    starting.

    Outside the active data window that bar can no longer change — the steady loop
    already skips its whole scan for exactly this reason. Kill switch:
    PREWARM_BOOT_SKIP_SETTLED=0.
    """
    if os.environ.get("PREWARM_BOOT_SKIP_SETTLED", "1") != "1":
        return False
    if tf not in _BOOT_SETTLED_TFS or last_ts is None:
        return False
    try:
        if _in_active_data_window():
            return False
        return int(last_ts) >= _expected_session()
    except Exception:
        # Never fail CLOSED into "skip" — under-skipping costs a redundant fetch,
        # over-skipping re-creates the frozen store this whole file exists to stop.
        return False


def prewarm_heartbeat() -> dict:
    """Snapshot of prewarmer liveness for the worker health endpoint + watchdog.

    `alive` = the prewarmer did a unit of work within the last ~45 min (covers the
    1800s off-hours idle sleep with margin). A stale beat means warming has died.

    ⛔ `alive` alone is NOT enough to act on: read `phase` with it. "boot" means a
    first pass is in flight and a redeploy would restart it from zero."""
    with _STATE_LOCK:
        s = dict(_PREWARM_STATE)
    beat = s.get("last_beat_ts")
    s["age_seconds"] = (_time.time() - beat) if beat else None
    s["alive"] = bool(beat and (_time.time() - beat) < 2700)
    return s


# Small, always-liquid, always-in-universe sample for the daily-freshness probe.
# A frozen DAILY store is exactly what the intraday hot-set watchdog can't see, so
# this is the signal the 2026-08-11 freeze needed.
_LIQUID_SAMPLE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
                  "SPY", "QQQ", "IWM", "AMD", "JPM", "XOM", "BAC", "DIA"]


def daily_freshness_report(sample: int = 12) -> dict:
    """Sample liquid tickers' newest DAILY bar in the LOCAL store and report how
    stale it is vs the last expected session. `days_behind` is a calendar-day proxy
    (median across the sample); `stale` fires only past a multi-session gap so a
    normal same-day lag never false-alarms. Read by the worker health endpoint AND
    the freshness watchdog — the direct check the intraday-only watchdog lacks."""
    out = {"sampled": 0, "newest_session": None, "expected_session": None,
           "days_behind": None, "stale": None}
    try:
        from api.services import bars_sqlite as _sqlite
        from api.services.bars_fetch import _expected_latest_session_yyyymmdd
        from datetime import date
        newest = []
        for s in _LIQUID_SAMPLE[:sample]:
            try:
                ts = _sqlite.get_last_ts(s, "D")   # daily last_ts is a YYYYMMDD int
                if ts:
                    newest.append(int(ts))
            except Exception:
                pass
        if not newest:
            return out
        newest.sort()
        median = newest[len(newest) // 2]
        expected = _expected_latest_session_yyyymmdd()

        def _d(y):
            return date(y // 10000, (y // 100) % 100, y % 100)
        days_behind = max(0, (_d(expected) - _d(median)).days)
        out.update({"sampled": len(newest), "newest_session": median,
                    "expected_session": expected, "days_behind": days_behind,
                    "stale": days_behind > 4})
    except Exception as e:
        out["error"] = str(e)[:180]
    return out


def run_prewarmer_supervised():
    """Run the prewarmer, restarting it (bounded backoff) if it ever exits or
    raises — so warming can never stop permanently from a single unhandled error.
    This is what the worker should spawn instead of the bare loop."""
    backoff = 5
    while True:
        try:
            run_prewarmer_forever()
            # Returned normally = the enable flag is off (nothing to supervise).
            return
        except Exception as e:  # pragma: no cover - defensive top-level guard
            with _STATE_LOCK:
                _PREWARM_STATE["restarts"] += 1
                _PREWARM_STATE["last_error"] = f"restart: {str(e)[:180]}"
            try:
                print(f"[prewarm] loop crashed — restarting in {backoff}s: {e}")
            except Exception:
                pass
            _time.sleep(backoff)
            backoff = min(backoff * 2, 300)


def run_prewarmer_forever():
    """Entry point: blocks forever, refreshing the cache every 5 minutes.

    Behavior preserved exactly from the previous inline _prewarm_bars in
    api/main.py.lifespan(). BARS_PREWARM_ENABLED env var still gates the
    actual work — if unset, this function returns immediately.

    NOTE: the 'cache' reference in the wire_data try-block previously
    silently failed (NameError swallowed by except). It is now properly
    imported here so wire_data tickers are actually included."""
    # Default ON for the WORKER pod — warming is the worker's whole job, and a
    # missing/unset BARS_PREWARM_ENABLED is EXACTLY what silently froze the store
    # for a week (2026-08-11). An explicit BARS_PREWARM_ENABLED=0 still disables it
    # (the escape hatch, e.g. to stop an OOM); everywhere else (web/local/tests) it
    # stays OFF unless explicitly enabled, so behavior there is unchanged.
    _flag = os.environ.get("BARS_PREWARM_ENABLED")
    if _flag is None:
        _flag = "1" if os.environ.get("WORKER_ENABLED") == "1" else "0"
    if _flag != "1":
        # Recorded, NOT beaten: a switched-off prewarmer is genuinely not warming.
        # Naming it is what stops the alert from sending an operator into a
        # redeploy loop for a condition no redeploy can fix.
        _set_phase("disabled", beat=False)
        print("[prewarm] Skipped (BARS_PREWARM_ENABLED=0, or not the worker pod).")
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
    # 60/30/15 for the whole active set; 5/1 expanded from top-800 to top-1500
    # (2026-05-23) so post-heal cold-fetch latency drops for the long-tail of
    # theme/watchlist tickers that users actually navigate. The chart
    # default-zoom width is the same regardless of TF, so the difference between
    # 800 and 1500 tickers is roughly 2x more 5min/1min jobs queued — bounded
    # by `_needs_fresh` so subsequent passes only refresh stale entries.
    _IS_WORKER = os.environ.get("WORKER_ENABLED") == "1"
    _CORE_INTRADAY_TFS = ('60', '30', '15')
    _DEEP_INTRADAY_TFS = ('5', '1')
    _INTRADAY_TFS = _CORE_INTRADAY_TFS + _DEEP_INTRADAY_TFS  # refresh-loop hot-set union
    if _IS_WORKER:
        # CORRECTNESS RESTORE (2026-06-08): core intraday (60/30/15) is warmed
        # across the FULL cap_universe again. The 2026-06-07 cost trim had
        # scoped it to the active set only — but 60m bars can ONLY self-heal by
        # being re-resampled from clean 30m (see bars_reconciliation `_TFS`
        # comment: "60m heals indirectly"), and that indirect heal SILENTLY
        # depended on this full-universe pass re-resampling every ticker's 60m
        # each cycle. Scoping it to the active set froze wrong/stale long-tail
        # 30m/60m bars (the append-only R2 merge can't fix interior bars, and
        # the reconciliation healer excludes 60m). The cost justification for
        # the cut — that the constant bars.db writes tripped the snapshot
        # fingerprint, shipping the full 688 MB tarball every cycle — no longer
        # holds: the delta snapshot (SNAPSHOT_DELTA_ENABLED) bounds egress to a
        # recency window regardless of write volume, so restoring this pass
        # costs only worker CPU, not egress. Deep intraday (5/1) stays scoped to
        # the active top-1500 (heaviest queue, least long-tail-critical).
        # Worker count held at 4 (the prior bump to 8 saturated Massive/worker
        # CPU and starved the web pod, see reverted commit 68392f4).
        #
        # PHASE 4 (2026-08-19): 5m and 1m are now warmed for DIFFERENT breadths.
        # 5m is the timeframe users actually SCAN intraday, so widen its coverage
        # toward the universe — warming a ticker's 5m even ONCE per session makes its
        # first-open instant (the serve then rides the same-session SWR fast path; it
        # need not stay perfectly fresh). 1m is the heaviest series + the least-viewed,
        # so it stays capped. Both env-tunable: raise PREWARM_5M_CAP toward the full
        # universe (e.g. 99999) once Massive throughput is confirmed to absorb it.
        _CORE_INTRADAY_TICKERS = ticker_list
        _FIVEMIN_TICKERS = ticker_list[:int(os.environ.get("PREWARM_5M_CAP", "2500"))]
        _ONEMIN_TICKERS = _active_intraday[:int(os.environ.get("PREWARM_1M_CAP", "1500"))]
        _PREWARM_WORKERS = 4
    else:
        _CORE_INTRADAY_TICKERS = ticker_list[:200]
        _FIVEMIN_TICKERS = ticker_list[:200]
        _ONEMIN_TICKERS = ticker_list[:200]
        _PREWARM_WORKERS = 2
    def _warm_one(args):
        sym, tf, bar_count = args
        try:
            last_ts = _sqlite.get_last_ts(sym.upper(), tf)
            # Settled D/W/M outside the data window: provably nothing to fetch.
            if _boot_can_skip(last_ts, tf):
                return ('skipped', sym, tf)
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
    for sym in _FIVEMIN_TICKERS: jobs.append((sym, '5', 5000))   # 5m: wide (scanned TF)
    for sym in _ONEMIN_TICKERS: jobs.append((sym, '1', 5000))    # 1m: capped (heaviest)
    print(f"[prewarm] {len(jobs)} jobs queued (worker={_IS_WORKER}; D/W/M all "
          f"+ {len(_CORE_INTRADAY_TICKERS)}x{len(_CORE_INTRADAY_TFS)} core "
          f"+ {len(_FIVEMIN_TICKERS)} 5m + {len(_ONEMIN_TICKERS)} 1m)")
    fast_path_size_jobs = (len(_PRIORITY) + len(_FAST_PATH))
    # ⛔ BEFORE the executor exists. `ex.map(...)` is evaluated as an ARGUMENT and
    # ThreadPoolExecutor.map submits every job immediately, so workers are already
    # running `_warm_one` before `_run_boot_pass` is entered. Establishing liveness
    # inside the helper therefore leaves a window where the prewarmer is doing work
    # and its own heartbeat still reads dead — small in production, but it is the
    # very state this file exists to make impossible, so it is closed here.
    _set_phase("boot", total=len(jobs))
    with _PrewarmTPE(max_workers=_PREWARM_WORKERS, thread_name_prefix="prewarm-bars") as ex:
        warmed, skipped = _run_boot_pass(
            ex.map(_warm_one, jobs), len(jobs), fast_path_size_jobs)
    print(f"[prewarm] First pass complete: {warmed} fetched, {skipped} cached, {len(jobs)} total")
    while True:
        # Beat FIRST so liveness is proven every iteration; the whole body is then
        # GUARDED so a single stale-read / DB-locked raise can never kill warming
        # (the 2026-08-11 freeze, where an unguarded get_last_ts raise escaped this
        # loop and froze the universe for a week). On a body crash we log +
        # short-backoff + continue instead of letting the thread die.
        _beat()
        try:
            # Market-hours gate: overnight + weekends, bars are static, so the
            # ~14k-job freshness scan below is pure SQLite-read churn (nothing is
            # stale, nothing gets fetched). Idle on a long sleep and skip the scan
            # entirely. The boot warm above already populated the cache; the
            # per-entry _needs_fresh gate would no-op anyway — this just avoids
            # spinning the whole scan every 5 min around the clock.
            from api.services import data_sync as _ds_window
            if not _ds_window.in_active_data_window():
                _t.sleep(1800)
                continue
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
                    # Order matters. The old code did `list({*jobs, *hot_jobs})` — a
                    # set union that SCRAMBLED the queue, so a long-tail static daily
                    # could run before the dailies of tickers users are actually
                    # looking at. Right after the 4pm ET close that left freshly-
                    # viewed charts cold-stale for the ~15-30min a full universe
                    # daily sweep takes (4 workers x ~1-2s/yf-tail-fill x ~3700) —
                    # the "daily not recognizing today" reports (2026-06-15). Build
                    # an ORDERED, de-duplicated queue that puts hot-set DAILIES
                    # first (the reported surface), then hot-set intraday, then the
                    # static universe — so the charts users open are refreshed to
                    # today's session before the long tail.
                    hot_daily = [(s, 'D', 5000) for s in hot]
                    hot_intraday = [(s, tf, 5000) for s in hot for tf in _INTRADAY_TFS]
                    seen = set()
                    cycle_jobs = []
                    for j in (*hot_daily, *hot_intraday, *jobs):
                        if j not in seen:
                            seen.add(j)
                            cycle_jobs.append(j)
                    print(f"[prewarm] Hot-set: +{len(hot)} user-viewed tickers "
                          f"(dailies prioritized; {len(cycle_jobs) - len(jobs)} extra jobs)")
            except Exception as _e:
                print(f"[prewarm] Hot-set lookup failed (non-fatal): {_e}")
            refresh_jobs = _scan_stale(cycle_jobs, _needs_fresh, _sqlite.get_last_ts)
            if not refresh_jobs:
                continue
            with _PrewarmTPE(max_workers=_PREWARM_WORKERS, thread_name_prefix="prewarm-refresh") as ex:
                refreshed = _run_refresh_pass(
                    ex.map(_warm_one, refresh_jobs), len(refresh_jobs))
            if refreshed:
                with _STATE_LOCK:
                    _PREWARM_STATE["last_refresh_ts"] = _t.time()
                print(f"[prewarm] Refresh pass: {refreshed} of {len(refresh_jobs)} entries refilled")
        except Exception as _cycle_err:
            with _STATE_LOCK:
                _PREWARM_STATE["last_error"] = str(_cycle_err)[:200]
            print(f"[prewarm] refresh cycle crashed (non-fatal, continuing): {_cycle_err}")
            _t.sleep(60)
