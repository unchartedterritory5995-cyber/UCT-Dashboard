"""Background prewarmer that fills the logo_cache for every cap_universe
ticker. Daemon thread on startup; idempotent across reboots (skips tickers
already cached). Polite sleep between live fetches. Never raises.
Disable via TICKER_LOGOS_PREWARM_DISABLED=1."""
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)


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
    from api.services import ticker_logos as tl
    universe = _load_universe()
    if not universe:
        return
    warmed = skipped = failed = 0
    started = time.time()
    _logger.info("[logo-prewarm] starting pass over %d tickers", len(universe))
    for i, ticker in enumerate(universe, 1):
        if tl.get_logo_path(ticker):
            skipped += 1
            continue
        try:
            ok = tl.resolve_and_cache(ticker)
            warmed += 1 if ok else 0
            failed += 0 if ok else 1
        except Exception:
            failed += 1
        time.sleep(0.25)
        if i % 200 == 0:
            _logger.info("[logo-prewarm] %d/%d warmed=%d skipped=%d failed=%d",
                         i, len(universe), warmed, skipped, failed)
    _logger.info("[logo-prewarm] done in %.1fs warmed=%d skipped=%d failed=%d",
                 time.time() - started, warmed, skipped, failed)


def start_async() -> None:
    if os.environ.get("TICKER_LOGOS_PREWARM_DISABLED") == "1":
        _logger.info("[logo-prewarm] disabled via env")
        return

    def _runner():
        time.sleep(90)  # let bars/names prewarmers take their initial flurry first
        try:
            _run_pass()
        except Exception as e:
            _logger.warning("[logo-prewarm] aborted: %s", e)

    threading.Thread(target=_runner, daemon=True, name="logo-prewarm").start()
