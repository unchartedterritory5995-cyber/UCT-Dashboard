"""Background prewarmer that fills the ticker_meta disk cache for every
ticker in the cap_universe. Runs once on Railway startup as a daemon
thread; survives redeploys because the cache is on the persistent volume.

Design notes:
- Walks cap_universe sequentially; skips tickers that already have a
  fresh disk-cached entry (idempotent across restarts).
- Sleeps between calls so yfinance rate limits don't trip — a full pass
  takes ~30 min in steady state, but most subsequent boots no-op after
  ~10 seconds because the cache is already warm.
- Never raises — backfill is best-effort. The autocomplete still works
  with whatever subset has been warmed.
"""
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)


def _resolve_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", "cap_universe.json")


def _load_universe():
    try:
        with open(_resolve_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return [str(t).upper() for t in data if t]
    except Exception as e:
        _logger.warning("[ticker-names-prewarm] cap_universe load failed: %s", e)
    return []


def _has_fresh_disk_entry(ticker: str) -> bool:
    try:
        from api.services import ticker_meta as tm
        p = tm._disk_path(ticker)
        if not os.path.exists(p):
            return False
        # _disk_get returns None when the file is older than _TTL; we want
        # the same staleness semantics so the prewarmer refreshes 24h+ rows.
        return tm._disk_get(ticker) is not None
    except Exception:
        return False


def _warm_one(ticker: str) -> bool:
    """Returns True if the ticker now has a name in cache."""
    try:
        from api.services.ticker_meta import _base_meta
        meta = _base_meta(ticker)
        return bool(meta and meta.get("name"))
    except Exception as e:
        _logger.info("[ticker-names-prewarm] %s failed: %s", ticker, e)
        return False


def _run_pass():
    universe = _load_universe()
    if not universe:
        return

    skipped = 0
    warmed = 0
    failed = 0
    started = time.time()
    _logger.info("[ticker-names-prewarm] starting pass over %d tickers", len(universe))

    for i, ticker in enumerate(universe, 1):
        if _has_fresh_disk_entry(ticker):
            skipped += 1
            continue
        ok = _warm_one(ticker)
        if ok:
            warmed += 1
        else:
            failed += 1
        # Be polite to yfinance / Finnhub — 250ms between live fetches is
        # gentle enough to avoid sustained 429s while still finishing the
        # full universe in well under an hour.
        time.sleep(0.25)
        if i % 200 == 0:
            _logger.info(
                "[ticker-names-prewarm] progress %d/%d (warmed=%d skipped=%d failed=%d)",
                i, len(universe), warmed, skipped, failed,
            )

    elapsed = time.time() - started
    _logger.info(
        "[ticker-names-prewarm] done in %.1fs — warmed=%d skipped=%d failed=%d",
        elapsed, warmed, skipped, failed,
    )


def start_async() -> None:
    """Kick off the prewarm pass on a background daemon thread."""
    if os.environ.get("TICKER_NAMES_PREWARM_DISABLED") == "1":
        _logger.info("[ticker-names-prewarm] disabled via env")
        return

    def _runner():
        # Stagger boot — let the rest of startup settle so we don't fight
        # for the worker pool while bars_prewarm is in its initial flurry.
        time.sleep(60)
        try:
            _run_pass()
        except Exception as e:
            _logger.warning("[ticker-names-prewarm] aborted: %s", e)

    threading.Thread(target=_runner, daemon=True, name="ticker-names-prewarm").start()
