"""Background prewarmer that fills the logo_cache for every cap_universe
ticker. Daemon thread on startup; idempotent across reboots (skips tickers
already cached). Uses a bounded thread pool against CDN logo sources so a
full universe pass finishes in a couple of minutes, not ~15. Never raises.
Disable via TICKER_LOGOS_PREWARM_DISABLED=1.

A pass can also be triggered on demand (POST /api/logos/prewarm) — a module
level lock ensures only one pass runs at a time and exposes live progress."""
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

_logger = logging.getLogger(__name__)

# Concurrency against the CDN logo sources (Parqet/FMP). 12 is gentle for a
# CDN yet fills ~3,700 tickers in ~2-3 min. Finnhub is the last-resort source
# inside resolve_and_cache and only fires for the small CDN-miss tail.
_WORKERS = int(os.environ.get("TICKER_LOGOS_PREWARM_WORKERS", "12"))

_RUN_LOCK = threading.Lock()
_PROGRESS = {"running": False, "total": 0, "done": 0, "warmed": 0,
             "skipped": 0, "failed": 0, "started_at": None}


def get_progress() -> dict:
    return dict(_PROGRESS)


def _resolve_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    return here if os.path.exists(here) else os.path.join("api", "data", "cap_universe.json")


def _load_universe():
    try:
        with open(_resolve_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return [str(t).upper() for t in data if t]
    except Exception as e:
        _logger.warning("[logo-prewarm] cap_universe load failed: %s", e)
    return []


def _run_pass():
    """Resolve every not-yet-cached universe ticker concurrently. Idempotent:
    already-cached tickers are skipped instantly (disk stat only)."""
    from api.services import ticker_logos as tl
    if not _RUN_LOCK.acquire(blocking=False):
        _logger.info("[logo-prewarm] pass already running — skipping")
        return
    try:
        universe = _load_universe()
        if not universe:
            return

        # Partition up front so 'skipped' is cheap and the pool only does work.
        todo = [t for t in universe if not tl.get_logo_path(t)]
        _PROGRESS.update(running=True, total=len(universe), done=0, warmed=0,
                         skipped=len(universe) - len(todo), failed=0,
                         started_at=time.time())
        started = time.time()
        _logger.info("[logo-prewarm] starting pass: %d universe, %d to warm, %d already cached",
                     len(universe), len(todo), len(universe) - len(todo))

        def _warm(ticker):
            try:
                return bool(tl.resolve_and_cache(ticker))
            except Exception:
                return False

        with ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="logo-warm") as ex:
            futs = {ex.submit(_warm, t): t for t in todo}
            for i, fut in enumerate(as_completed(futs), 1):
                ok = fut.result()
                _PROGRESS["warmed"] += 1 if ok else 0
                _PROGRESS["failed"] += 0 if ok else 1
                _PROGRESS["done"] = i
                if i % 250 == 0:
                    _logger.info("[logo-prewarm] %d/%d warmed=%d failed=%d",
                                 i, len(todo), _PROGRESS["warmed"], _PROGRESS["failed"])

        _logger.info("[logo-prewarm] done in %.1fs warmed=%d skipped=%d failed=%d",
                     time.time() - started, _PROGRESS["warmed"],
                     _PROGRESS["skipped"], _PROGRESS["failed"])
    finally:
        _PROGRESS["running"] = False
        _RUN_LOCK.release()


def run_now() -> bool:
    """Kick a pass on a background thread immediately. Returns False if a pass
    is already running. Used by the on-demand trigger endpoint."""
    if _PROGRESS["running"]:
        return False
    threading.Thread(target=_safe_run, daemon=True, name="logo-prewarm-now").start()
    return True


def _safe_run():
    try:
        _run_pass()
    except Exception as e:
        _logger.warning("[logo-prewarm] aborted: %s", e)


def start_async() -> None:
    if os.environ.get("TICKER_LOGOS_PREWARM_DISABLED") == "1":
        _logger.info("[logo-prewarm] disabled via env")
        return

    def _runner():
        time.sleep(30)  # brief stagger so startup settles; CDN sources don't fight yfinance
        _safe_run()

    threading.Thread(target=_runner, daemon=True, name="logo-prewarm").start()
