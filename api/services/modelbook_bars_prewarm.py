"""Permanent bar warming for the Model Book.

The Model Book is a curated library of a few hundred unique tickers. Charts must
load INSTANTLY on first view for every user — including brand-new visitors whose
browser IndexedDB is empty — so the backend must always serve their bars from a
warm cache, never a cold 3-5s upstream fetch.

This keeps every Model Book stock's DAILY + WEEKLY bars hot in the persistent
disk/SQLite cache (the Railway volume, which survives redeploys). Because the
curated set is small and historical years are IMMUTABLE, this is cheap: the first
pass warms everything, and every later pass is almost entirely `_needs_fresh`
skips (only the current year's still-evolving bars get re-fetched).

Wiring mirrors the main bars prewarmer (`bars_prewarm.run_prewarmer_forever`):
  - Non-remote web (`USE_REMOTE_BARS` unset): started from `api.main` lifespan —
    warms the web pod's own serving cache.
  - Remote setup: started from `api.worker_main` — the worker warms its cache and
    the bars get to web through the existing R2 snapshot bridge.

Depth note: the Model Book chart requests D/W at `bars=8000` (~32y daily), deeper
than the main prewarmer's 5000, so the oldest year tabs (2005+) frame correctly.
We warm at the same 8000 depth so the cache fully satisfies the chart's request.

Gated by `MODELBOOK_BARS_PREWARM_ENABLED` (default on). Tunables:
  MODELBOOK_BARS_PREWARM_WORKERS (default 2),
  MODELBOOK_BARS_PREWARM_REFRESH_SEC (default 21600 = 6h),
  MODELBOOK_BARS_PREWARM_DELAY_SEC (default 25).
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

_TFS = ("D", "W")          # Model Book only ever shows Daily / Weekly
_BAR_COUNT = 8000          # match StockChart's D/W request depth (covers the oldest year tabs)


def _enabled() -> bool:
    return os.environ.get("MODELBOOK_BARS_PREWARM_ENABLED", "1") == "1"


def _symbols() -> list[str]:
    """Distinct upper-cased tickers across every curated year. IDB/cache are keyed
    by (sym, tf) not year, so a ticker recurring across years is warmed once."""
    from api.services import modelbook_service
    syms: set[str] = set()
    try:
        for s in modelbook_service.get_all_stocks():
            sym = (s.get("symbol") or "").strip().upper()
            if sym:
                syms.add(sym)
    except Exception as e:  # never let a DB hiccup kill the warmer
        print(f"[modelbook-bars] symbol lookup failed (non-fatal): {e}")
    return sorted(syms)


def _warm_one(args):
    sym, tf = args
    try:
        from api.routers.bars import _get_bars_inner, _needs_fresh
        from api.services import bars_sqlite as _sqlite
        last_ts = _sqlite.get_last_ts(sym, tf)
        if not _needs_fresh(last_ts, tf):
            return "skipped"           # already warm; immutable closed years skip forever
        _get_bars_inner(sym, tf, _BAR_COUNT)
        return "warmed"
    except Exception:
        return "failed"


def _run_forever():
    workers = int(os.environ.get("MODELBOOK_BARS_PREWARM_WORKERS", "2") or "2")
    refresh = int(os.environ.get("MODELBOOK_BARS_PREWARM_REFRESH_SEC", str(6 * 3600)) or str(6 * 3600))
    while True:
        try:
            syms = _symbols()
            jobs = [(s, tf) for s in syms for tf in _TFS]
            warmed = skipped = failed = 0
            if jobs:
                with ThreadPoolExecutor(max_workers=max(1, workers),
                                        thread_name_prefix="mb-bars-warm") as ex:
                    for r in ex.map(_warm_one, jobs):
                        if r == "warmed":
                            warmed += 1
                        elif r == "skipped":
                            skipped += 1
                        else:
                            failed += 1
            print(f"[modelbook-bars] warm pass: {warmed} fetched, {skipped} cached, "
                  f"{failed} failed ({len(syms)} tickers x {len(_TFS)} tf)")
        except Exception as e:
            print(f"[modelbook-bars] warm pass crashed (non-fatal): {e}")
        time.sleep(refresh)


def start_async():
    """Spawn the warmer on a daemon thread after a short boot delay so the app
    and the main prewarmer's priority pass settle first. No-op if disabled."""
    if not _enabled():
        print("[modelbook-bars] disabled (MODELBOOK_BARS_PREWARM_ENABLED=0)")
        return
    delay = float(os.environ.get("MODELBOOK_BARS_PREWARM_DELAY_SEC", "25") or "25")

    def _delayed():
        time.sleep(delay)
        print("[modelbook-bars] starting Model Book bar warmer")
        _run_forever()

    threading.Thread(target=_delayed, daemon=True, name="modelbook-bars-warm").start()
