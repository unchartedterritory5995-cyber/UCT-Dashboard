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
  • Resumable + idempotent: a (ticker, tf) that has ALREADY BEEN GRAFTED is skipped
    (`_already_deep` — a first bar before the vendor's archive floor is the only proof
    of that; a row COUNT is not, and reading one as proof is what truncated every
    megacap to 2003 until 2026-09-09). A worker restart mid-run resumes instead of
    restarting, and a completed run costs ~nothing to re-scan. A done-marker on the
    persistent volume short-circuits the whole job once the universe is fully warmed.
  • Active set first (priority + watchlists + themes) so the user's own charts go
    instant within minutes; the long tail fills in over the following hours.
"""
import os
import json
import time
import sqlite3

from api.services import bars_sqlite as _sqlite


# Full-history targets — matched to the frontend's fullBarsFor(tf) so a warmed
# entry satisfies the chart's request as a pure cache hit. Daily is capped at ~50
# years (12500 sessions): that covers essentially every tradeable stock's full
# life (even 1970s-80s IPOs) WITHOUT the ~79-year request that made the backend
# chase empty pre-1976 history and fall through to slow yfinance dead-ends on
# every ticker. MUST stay in lockstep with fullBarsFor('D') in barsBackfill.js.
_DEEP_TARGET = {"D": 12500, "W": 4000, "M": 1200}

#: 🔴 A ROW COUNT CANNOT TELL YOU HOW FAR BACK A SERIES REACHES, AND THIS ONE
#: STOPPED TELLING US IN MID-2023. The skip test here used to be
#: ``get_count(sym, tf) >= {"D": 5200, "W": 1100, "M": 400}[tf]``. What makes deep
#: history deep is the **yfinance pre-2003 graft** (`_fetch_daily(..., deep=True)`);
#: Massive/Polygon's daily aggregates begin at a hard floor of **2003-09-10**
#: (`bars_fetch._DEEP_REQUEST_THRESHOLD`'s docstring names the same date). So a name
#: listed BEFORE 2003 that Massive covers completely — every megacap — holds exactly
#: the floor-to-today session count and NOTHING older. That count was 5,200 around
#: **mid-2023** and is **5,785 today**: from the day it crossed, every such symbol
#: answered "already deep" and was skipped, permanently, having never once been
#: grafted. Measured 2026-09-09 against the live edge origin: 30 of 80 large caps
#: truncated, SPY/MSFT/AAPL/NVDA/AMD/ORCL/WMT/JPM/GS/PEP/LLY/COST/MU/… all sitting at
#: exactly `n=5785, first=2003-09-10`, while every symbol that HAD been grafted started
#: before the floor (CME 2002-12-06 was the shallowest, n=5975). Not one symbol landed
#: between the two groups — the split is total, and it is a DATE split wearing a
#: count's clothing.
#:
#: ⭐ SO ASK THE QUESTION WE ACTUALLY MEAN: does the stored series begin BEFORE the
#: vendor's floor? Only the graft can put a bar there. That test cannot go stale as the
#: market ages, because the floor is a property of the vendor's archive, not of how
#: much time has passed.
#:
#: ⚠️ THE FLOOR IS PER-TIMEFRAME, BECAUSE W/M ROWS ARE PERIOD-KEYED, NOT DAY-KEYED. The
#: monthly bar covering 2003-09-10 is keyed **2003-09-01** and the weekly one to its
#: Monday, **2003-09-08** — both EARLIER than the daily floor. A single 20030910
#: constant would read those as "starts before the floor ⇒ grafted" and re-create the
#: exact skip we are removing, on W and M, invisibly.
#:
#: ⚠️ THE IRONY WORTH KEEPING: the more popular the symbol, the more certainly it was
#: skipped. `_build_ticker_list` puts the megacaps FIRST, and the shallow pre-warmer
#: keeps exactly those resident in bars.db — so the priority list guaranteed they were
#: over the count floor before the deep warmer ever looked at them.
_VENDOR_FLOOR_YMD = {"D": 20030910, "W": 20030908, "M": 20030901}

# A first bar in [floor, this] IS the vendor-floor signature rather than an inception
# date. A few sessions of slack: a given ticker's first available Massive bar can land
# a day or two past the archive's opening. The cost of the slack is one extra (cheap,
# idempotent) deep attempt per sweep for the rare name that genuinely listed in
# September 2003; the cost of NOT having it is another permanent truncation.
_VENDOR_FLOOR_WINDOW_END_YMD = {"D": 20030930, "W": 20030930, "M": 20030901}
_WORKERS = 2          # gentle — fewer concurrent deep fetches = less memory/CPU churn
_SLEEP_BETWEEN = 0.0  # per-job politeness handled by the provider client's limiter


def _marker_path() -> str:
    # ⭐ v2, 2026-09-09. The marker is the job's whole idempotency story: v1 is
    # present on the worker volume, so the corrected skip test above would never have
    # been REACHED. A new filename is the re-run — one sweep, then quiet again.
    return os.path.join(os.environ.get("DATA_DIR", "/data"), ".deep_history_warm_done_v2")


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
    # X24 (2026-08-26): this imported `auth_db.get_db_path`, a name that has
    # never existed there -- the module's only public door is `get_connection`.
    # The ImportError was swallowed by the bare `except Exception: pass` below,
    # so deep history has never once warmed a symbol a member actually tracks.
    # One of THREE copies, in three spellings; the rail that makes the class
    # impossible is `tests/test_auth_db_names_are_real.py`.
    try:
        from api.services.auth_db import get_connection
        db = get_connection()
    except (ImportError, AttributeError, NameError, TypeError):
        _LOGX24 = __import__("logging").getLogger(__name__)
        _LOGX24.exception("[deep_history] auth.db door is broken -- watchlists NOT read")
        db = None
    except Exception:                                              # noqa: BLE001
        db = None
    if db is not None:
        try:
            for tbl, col in (("watchlist_items", "sym"), ("ticker_tags", "sym")):
                try:
                    for (sym,) in db.execute(f"SELECT DISTINCT {col} FROM {tbl}"):
                        _add(sym)
                except Exception:                                  # noqa: BLE001
                    pass
        finally:
            db.close()

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


def _already_deep(sym: str, tf: str) -> bool:
    """Has this (ticker, tf) already had the deep pre-2003 graft applied?

    Three cases, in the only order that is safe:

      • first bar BEFORE the tf's vendor floor  → True. Only the deep merge can put a
        bar there.
      • first bar ON/just after the floor       → False, at ANY row count. This is the
        un-grafted signature, and letting a count overrule it is the whole bug.
      • first bar clearly AFTER the floor       → a genuine post-2003 listing; done once
        it holds the full deep target, so a sweep doesn't re-fetch it forever.

    ⛔ Never answer True from a bar COUNT alone. A store read that fails answers False:
    attempting a warm that turns out to be a cache hit is cheap; skipping one that was
    never grafted is the silent, permanent truncation this replaced.
    """
    tfu = (tf or "D").upper()
    if tfu not in _VENDOR_FLOOR_YMD:
        return False
    try:
        first = _sqlite.get_first_ts(sym, tfu)
    except Exception:                                              # noqa: BLE001
        return False
    if first is None:
        return False                                    # nothing stored → not deep
    first = int(first)
    if first < _VENDOR_FLOOR_YMD[tfu]:
        return True                                     # a pre-floor bar → graft landed
    if first <= _VENDOR_FLOOR_WINDOW_END_YMD[tfu]:
        return False                                    # pinned to the floor → never grafted
    try:
        return _sqlite.get_count(sym, tfu) >= _DEEP_TARGET[tfu]
    except Exception:                                              # noqa: BLE001
        return False


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
    from api.services.bars_fetch import warm_ticker_deep

    tickers = _build_ticker_list()
    jobs = [(sym, tf) for sym in tickers for tf in ("D", "W", "M")]
    print(f"[deep-warm] Starting: {len(tickers)} tickers × D/W/M = {len(jobs)} jobs "
          f"(workers={_WORKERS}). Active set first; long tail fills in behind it.")

    def _warm_one(job):
        sym, tf = job
        try:
            # Idempotent skip: this series has ALREADY been grafted (a bar before
            # _VENDOR_FLOOR_YMD[tf] can only have come from the deep merge), or it
            # already holds the full deep target.
            if _already_deep(sym.upper(), tf):
                return "skipped"
            # SYNCHRONOUS + direct. Going through the serve path (_get_bars_inner)
            # reports success while the real fetch is dropped at the bg semaphore for
            # any symbol that already holds shallow rows — see warm_ticker_deep.
            wrote = warm_ticker_deep(sym.upper(), tf)
            if _SLEEP_BETWEEN:
                time.sleep(_SLEEP_BETWEEN)
            return "warmed" if wrote else "failed"
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
