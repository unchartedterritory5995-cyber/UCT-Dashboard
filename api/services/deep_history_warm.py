"""One-time DEEP D/W/M history warm for the whole ticker universe.

The regular bars pre-warmer (bars_prewarm.py) keeps D/W/M fresh but only to
~5000 bars (~20yr daily). Charts request the FULL history (fullBarsFor: 20000
daily), so the first open of any stock deep pays a slow cold provider fetch
(~20s). This job pre-fills the persistent SQLite cache with the FULL history for
every ticker ONCE, so that cold fetch never happens for users again.

Design (mirrors the hard-won lessons in bars_prewarm):
  • WORKER-ONLY. The 2026 incident: web-side bar warming OOM'd the web pod and
    crash-looped the site. This never runs on web.
  • Small unit of work: one (ticker, tf) at a time, streamed straight to SQLite
    by _get_bars_inner — nothing accumulates in memory.
  • Bounded pool (few workers) + the same politeness as the pre-warmer, so we
    don't get throttled by the data provider.
  • Flag-gated OFF by default (DEEP_HISTORY_WARM_ENABLED). Ships dark.
  • Resumable + idempotent: a (ticker, tf) whose cached depth already covers deep
    history is skipped, so a worker restart mid-run resumes instead of restarting,
    and a completed run costs ~nothing to re-scan. A done-marker on the persistent
    volume short-circuits the whole job once the universe is fully warmed.
  • Active set first (priority + watchlists + themes) so the user's own charts go
    instant within minutes; the long tail fills in over the following hours.
"""
import os
import json
import time
import sqlite3


# Full-history targets — matched to the frontend's fullBarsFor(tf) so a warmed
# entry satisfies the chart's request as a pure cache hit. Daily is capped at ~50
# years (12500 sessions): that covers essentially every tradeable stock's full
# life (even 1970s-80s IPOs) WITHOUT the ~79-year request that made the backend
# chase empty pre-1976 history and fall through to slow yfinance dead-ends on
# every ticker. MUST stay in lockstep with fullBarsFor('D') in barsBackfill.js.
_DEEP_TARGET = {"D": 12500, "W": 4000, "M": 1200}
# A (ticker, tf) is considered "already deep" — and skipped — once its cached bar
# count reaches this floor for the tf. Below the daily floor a modern name (e.g. a
# 2015 IPO) has only a few thousand sessions total, so we still attempt it once;
# _get_bars_inner is a fast cache hit if there's genuinely nothing deeper to pull.
_DEEP_ENOUGH = {"D": 5200, "W": 1100, "M": 400}
_WORKERS = 2          # gentle — fewer concurrent deep fetches = less memory/CPU churn
_SLEEP_BETWEEN = 0.0  # per-job politeness handled by the provider client's limiter


def _marker_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), ".deep_history_warm_done_v1")


def _build_ticker_list() -> list[str]:
    """Universe ordered active-first: priority megacaps + watchlists + theme
    holdings + wire tickers, THEN the cap_universe long tail. Best-effort — any
    source that fails is simply skipped."""
    priority = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER']
    active: list[str] = list(priority)
    seen = set(priority)

    def _add(sym):
        if not sym:
            return
        s = str(sym).upper().strip()
        if s and s not in seen:
            seen.add(s)
            active.append(s)

    # Watchlists + tags (what users actually track).
    try:
        from api.services.auth_db import get_db_path
        db = sqlite3.connect(get_db_path())
        for tbl, col in [("watchlist_items", "sym"), ("ticker_tags", "sym")]:
            try:
                for (sym,) in db.execute(f"SELECT DISTINCT {col} FROM {tbl}").fetchall():
                    _add(sym)
            except Exception:
                pass
        db.close()
    except Exception:
        pass

    # Theme holdings (the Theme Tracker navigation surface).
    try:
        tax_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "themes_taxonomy.json")
        if os.path.exists(tax_path):
            with open(tax_path) as f:
                tax = json.load(f)

            def _collect(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k in ("sym", "ticker") and isinstance(v, str):
                            _add(v)
                        else:
                            _collect(v)
                elif isinstance(obj, list):
                    for x in obj:
                        _collect(x)
            _collect(tax)
    except Exception:
        pass

    # The full cap universe (long tail) last.
    try:
        cap_path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                for t in json.load(f):
                    _add(t)
    except Exception:
        pass

    return active


def deep_warm_history_once():
    """Entry point. Blocks until the universe's full D/W/M history is cached,
    then returns (leaving the done-marker). No-op unless enabled + on the worker."""
    if os.environ.get("DEEP_HISTORY_WARM_ENABLED", "0") != "1":
        print("[deep-warm] Skipped (set DEEP_HISTORY_WARM_ENABLED=1).")
        return
    if os.environ.get("WORKER_ENABLED") != "1":
        print("[deep-warm] Skipped — worker-only (never runs on the web pod).")
        return
    if os.path.exists(_marker_path()):
        print("[deep-warm] Already complete (marker present) — nothing to do.")
        return

    from concurrent.futures import ThreadPoolExecutor
    from api.services.bars_fetch import _get_bars_inner
    from api.services import bars_sqlite as _sqlite

    tickers = _build_ticker_list()
    jobs = [(sym, tf) for sym in tickers for tf in ("D", "W", "M")]
    print(f"[deep-warm] Starting: {len(tickers)} tickers × D/W/M = {len(jobs)} jobs "
          f"(workers={_WORKERS}). Active set first; long tail fills in behind it.")

    def _warm_one(job):
        sym, tf = job
        try:
            # Idempotent skip: cached depth already covers deep history.
            if _sqlite.get_count(sym.upper(), tf) >= _DEEP_ENOUGH[tf]:
                return "skipped"
            _get_bars_inner(sym.upper(), tf, _DEEP_TARGET[tf])
            if _SLEEP_BETWEEN:
                time.sleep(_SLEEP_BETWEEN)
            return "warmed"
        except Exception:
            return "failed"

    warmed = skipped = failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="deep-warm") as ex:
        for i, status in enumerate(ex.map(_warm_one, jobs), start=1):
            if status == "warmed":
                warmed += 1
            elif status == "skipped":
                skipped += 1
            else:
                failed += 1
            if i % 300 == 0:
                mins = (time.time() - t0) / 60
                print(f"[deep-warm] {i}/{len(jobs)} — {warmed} fetched, {skipped} already deep, "
                      f"{failed} failed ({mins:.1f} min elapsed)")

    print(f"[deep-warm] COMPLETE: {warmed} fetched, {skipped} already deep, {failed} failed "
          f"in {(time.time() - t0) / 60:.1f} min.")
    # Only mark done if the pass wasn't a near-total failure (e.g. provider down) —
    # otherwise leave the marker off so a later boot retries the whole universe.
    if warmed + skipped >= max(1, len(jobs) // 2):
        try:
            with open(_marker_path(), "w") as f:
                f.write(f"done ts={int(time.time())} warmed={warmed} skipped={skipped} failed={failed}\n")
            print("[deep-warm] Marker written — won't re-run until it's removed.")
        except Exception as e:
            print(f"[deep-warm] Could not write marker (will re-run next boot): {e}")
    else:
        print("[deep-warm] Too many failures — marker NOT written; will retry on next boot.")
