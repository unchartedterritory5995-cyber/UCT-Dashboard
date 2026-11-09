"""Scheduled server-side evaluation of armed price alerts (desktop Stage 1, Task 7).

Price alerts used to be evaluated only inside ``/api/live-prices`` for the symbols
in that request, so an alert on a symbol nobody was polling never fired. This loop
closes that: every ``interval_sec`` it reads the distinct armed symbols, fetches
their prices through the SAME path the endpoint uses (shared 15 s per-ticker
cache, the Massive semaphore, ``_fetch_snapshots`` -- no new socket), and hands
them to ``watchlist_alert_service.check_alerts_against_prices``.

Design rules (this runs on the production web pod):

* DARK: ``PRICE_ALERT_EVALUATOR_ENABLED`` must be exactly "1". Read per cycle, so
  the kill switch needs no restart. The thread is always started (it just sleeps)
  so a flag flip takes effect on the next cycle.
* LIGHT: no armed alerts -> no fetch. At most ``MAX_SYMBOLS_PER_CYCLE`` symbols
  per cycle (rotating so the tail is not starved), in batches of ``BATCH_SIZE``,
  and a ``MAX_CYCLE_SEC`` deadline checked between batches.
* EXACTLY ONCE: the fire-once guard is ``watchlist_alert_service._trigger_alert``,
  a compare-and-set on ``is_active`` in the existing store; a racing
  ``/api/live-prices`` check that loses delivers nothing.
* NEVER RAISES out of the loop, and cycles never overlap (non-blocking lock; the
  sleep is taken AFTER a cycle, so a slow cycle delays the next, not stacks).
* ``market_closed`` rows are dropped, exactly as ``live_prices.py`` does.
"""
from __future__ import annotations

import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)

FLAG = "PRICE_ALERT_EVALUATOR_ENABLED"
BATCH_SIZE = 50
MAX_SYMBOLS_PER_CYCLE = 200
MAX_CYCLE_SEC = 20.0

_monotonic = time.monotonic
_cycle_lock = threading.Lock()
_running = threading.Event()
_thread: threading.Thread | None = None
_cursor = 0  # rotation offset when armed symbols exceed the per-cycle cap


def enabled() -> bool:
    """Strictly "1", read per call (a typo falls to off)."""
    return os.environ.get("PRICE_ALERT_EVALUATOR_ENABLED", "0") == "1"


def _reset_for_tests() -> None:
    global _cursor
    _cursor = 0


def _armed_symbols() -> list[str]:
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT sym FROM watchlist_alerts WHERE is_active = 1 ORDER BY sym"
        ).fetchall()
    finally:
        conn.close()
    return [r["sym"] for r in rows if r["sym"]]


def _select(symbols: list[str]) -> list[str]:
    """At most MAX_SYMBOLS_PER_CYCLE, rotating through the list across cycles."""
    global _cursor
    n = len(symbols)
    if n <= MAX_SYMBOLS_PER_CYCLE:
        _cursor = 0
        return symbols
    start = _cursor % n
    picked = (symbols + symbols)[start:start + MAX_SYMBOLS_PER_CYCLE]
    _cursor = (start + MAX_SYMBOLS_PER_CYCLE) % n
    return picked


def default_fetch_prices(symbols: list[str]) -> dict:
    """Prices for ``symbols`` via live_prices' own cache + valve + snapshot fetch.

    Mirrors the endpoint's tier 2: serve the shared per-ticker cache, fetch only
    the misses under the endpoint's semaphore, write results back to that cache.
    Returns {} when the provider is unavailable (the caller treats it as a
    failed cycle that fires nothing).
    """
    from api.routers import live_prices as lp
    from api.services import breadth_symbols

    out: dict = {}
    missing: list[str] = []
    for tk in symbols:
        if breadth_symbols.is_breadth_symbol(tk):
            continue  # no market-data provider; the request path still serves these
        hit = lp.cache.get(lp._px_key(tk))
        if hit is not None:
            out[tk] = hit
        else:
            missing.append(tk)
    if not missing:
        return out
    client = lp._get_client()
    if client is None:
        return out
    if not lp._MASSIVE_SEM.acquire(timeout=lp._SEM_WAIT_S):
        return out
    try:
        fetched = lp._fetch_snapshots(client, missing, lp._detect_session())
    finally:
        lp._MASSIVE_SEM.release()
    for tk, val in fetched.items():
        lp.cache.set(lp._px_key(tk), val, ttl=lp._CACHE_TTL)
        out[tk] = val
    return out


def run_cycle(fetch_prices, now: float) -> dict:
    """One evaluation pass. Never raises. ``fetch_prices(symbols) -> {sym: row}``."""
    report = {"now": now, "skipped": None, "symbols": 0, "fetched": 0,
              "triggered": 0, "deadline_hit": False, "error": None}
    if not enabled():
        report["skipped"] = "disabled"
        return report
    if not _cycle_lock.acquire(blocking=False):
        report["skipped"] = "cycle_in_progress"
        return report
    try:
        symbols = _select(_armed_symbols())
        report["symbols"] = len(symbols)
        if not symbols:
            report["skipped"] = "no_armed_alerts"
            return report
        started = _monotonic()
        prices: dict = {}
        for i in range(0, len(symbols), BATCH_SIZE):
            if i and _monotonic() - started >= MAX_CYCLE_SEC:
                report["deadline_hit"] = True
                break
            batch = symbols[i:i + BATCH_SIZE]
            try:
                rows = fetch_prices(batch) or {}
            except Exception as e:  # noqa: BLE001
                report["error"] = f"{type(e).__name__}: {e}"
                _logger.warning("[price-alert-eval] price fetch failed: %s", report["error"])
                break
            for sym, info in rows.items():
                if not isinstance(info, dict):
                    price, closed = info, False
                else:
                    price, closed = info.get("price"), info.get("market_closed")
                # Closed-market rows replay the last close; same rule as live_prices.
                if closed or price is None:
                    continue
                prices[sym] = price
        report["fetched"] = len(prices)
        if report["error"] and not prices:
            return report  # fired nothing; next cycle retries
        if prices:
            from api.services.watchlist_alert_service import check_alerts_against_prices
            reports: list = []
            triggered = check_alerts_against_prices(prices, reports=reports)
            report["triggered"] = len(triggered)
            bad = [r for r in reports if r.get("channels_failed")]
            if triggered:
                _logger.info("[price-alert-eval] triggered %d price alert(s)", len(triggered))
            if bad:
                _logger.warning(
                    "[price-alert-eval] DELIVERY INCOMPLETE: %d of %d fire(s) missed a "
                    "channel and will not be retried -- %s", len(bad), len(reports),
                    [r.get("errors") or r.get("channels") for r in bad])
        return report
    except Exception as e:  # noqa: BLE001
        report["error"] = f"{type(e).__name__}: {e}"
        _logger.exception("[price-alert-eval] cycle failed")
        return report
    finally:
        _cycle_lock.release()


def _tick() -> None:
    try:
        run_cycle(default_fetch_prices, time.time())
    except Exception:  # noqa: BLE001
        _logger.exception("[price-alert-eval] tick failed")


def start_evaluator(interval_sec: int = 60) -> None:
    """Start the background thread. Idempotent. Sleeps AFTER each cycle."""
    global _thread
    if _running.is_set():
        return
    _running.set()

    def _loop() -> None:
        while _running.is_set():
            _tick()
            for _ in range(max(1, int(interval_sec))):
                if not _running.is_set():
                    return
                time.sleep(1)

    _thread = threading.Thread(target=_loop, daemon=True, name="price-alert-eval")
    _thread.start()


def stop_evaluator() -> None:
    _running.clear()


def is_running() -> bool:
    return _running.is_set()
