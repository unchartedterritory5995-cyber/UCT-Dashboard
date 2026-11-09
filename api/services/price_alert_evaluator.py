"""Scheduled server-side evaluation of armed price alerts (desktop Stage 1, Task 7).

Price alerts used to be evaluated only inside ``/api/live-prices`` for the symbols
in that request, so an alert on a symbol nobody was polling never fired. This loop
closes that: every ``interval_sec`` it reads the distinct armed symbols, fetches
their prices through the SAME path the endpoint uses (shared 15 s per-ticker
cache, the Massive semaphore, ``_fetch_snapshots`` -- no new socket), and hands
them to ``watchlist_alert_service.check_alerts_against_prices``.

Design rules (this runs on the production web pod):

* DARK: ``PRICE_ALERT_EVALUATOR_ENABLED`` must be exactly "1", read from
  ``os.environ`` each cycle. ``os.environ`` is fixed at process start, so a
  Railway change only reaches this code on a NEW BOOT: to stop it, ``--set
  PRICE_ALERT_EVALUATOR_ENABLED=0`` (which redeploys), or after a ``variable
  delete`` run ``railway redeploy --service web --yes``, and confirm the fresh
  boot from the pod. The thread always starts (it just sleeps).
* LIGHT: no armed alerts -> no fetch. Fully closed market (weekend, holiday,
  20:00-04:00 ET) -> no fetch. At most ``MAX_SYMBOLS_PER_CYCLE`` symbols per cycle
  (rotating so the tail is not starved), in batches of ``BATCH_SIZE``, and a
  ``MAX_CYCLE_SEC`` deadline checked between batches. The extended-hours volume
  warm is suppressed for this caller and fetched rows are NOT written back to the
  shared price cache (they carry a placeholder volume).
* OBSERVABLE: a failed fetch raises into ``run_cycle`` (a warning per cycle), and a
  summary line is logged every ``HEARTBEAT_SEC`` while enabled, so a dead
  evaluator is distinguishable from a quiet one.
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
HEARTBEAT_SEC = 900.0

_monotonic = time.monotonic
_cycle_lock = threading.Lock()
_running = threading.Event()
_thread: threading.Thread | None = None
_cursor = 0  # rotation offset when armed symbols exceed the per-cycle cap
_stats: dict = {}
_last_heartbeat: float | None = None


def enabled() -> bool:
    """Strictly "1", read per call (a typo falls to off)."""
    return os.environ.get("PRICE_ALERT_EVALUATOR_ENABLED", "0") == "1"


def _reset_stats() -> None:
    _stats.clear()
    _stats.update({"cycles": 0, "ran": 0, "skipped": {}, "symbols": 0,
                   "fetched": 0, "triggered": 0, "errors": 0, "last_error": None})


def _reset_for_tests() -> None:
    global _cursor, _last_heartbeat
    _cursor = 0
    _last_heartbeat = None
    _reset_stats()


_reset_stats()


def _market_open_now() -> bool:
    """False when nothing can trade: weekend, NYSE holiday, or 20:00-04:00 ET.

    The day check is the repo's own ``massive._today_et_is_a_trading_day``; only
    the 04:00-20:00 ET extended-hours window is added here. Unreadable -> True
    (fail open: a missed alert is worse than one extra cycle).
    """
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from api.services.massive import _today_et_is_a_trading_day
        if not _today_et_is_a_trading_day():
            return False
        now = datetime.now(ZoneInfo("America/New_York"))
        return 400 <= now.hour * 100 + now.minute < 2000
    except Exception:  # noqa: BLE001
        return True


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
    the misses under the endpoint's semaphore. RAISES on every failure branch
    (no client, valve timeout, vendor did not answer) so ``run_cycle`` logs it;
    returning {} would read as a healthy quiet cycle. Does NOT write fetched rows
    back to the shared cache (placeholder volume) and suppresses the
    extended-hours volume warm for this thread.
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
    try:
        client = lp._get_client()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"market-data client unavailable: {type(e).__name__}: {e}")
    if client is None:
        raise RuntimeError("market-data client unavailable (None)")
    if not lp._MASSIVE_SEM.acquire(timeout=lp._SEM_WAIT_S):
        raise RuntimeError("massive semaphore timeout (upstream saturated)")
    try:
        lp._FETCH_STATUS.last = None
        lp._SUPPRESS_EXVOL_WARM.on = True
        try:
            fetched = lp._fetch_snapshots(client, missing, lp._detect_session())
        finally:
            lp._SUPPRESS_EXVOL_WARM.on = False
        st = getattr(lp._FETCH_STATUS, "last", None) or {}
    finally:
        lp._MASSIVE_SEM.release()
    if not st.get("answered"):
        raise RuntimeError("vendor snapshot degraded or empty (not answered)")
    out.update(fetched)
    return out


def _count(report: dict) -> None:
    _stats["cycles"] += 1
    if report["skipped"]:
        sk = _stats["skipped"]
        sk[report["skipped"]] = sk.get(report["skipped"], 0) + 1
    else:
        _stats["ran"] += 1
    _stats["symbols"] += report["symbols"]
    _stats["fetched"] += report["fetched"]
    _stats["triggered"] += report["triggered"]
    if report["error"]:
        _stats["errors"] += 1
        _stats["last_error"] = report["error"]


def _heartbeat(force: bool = False) -> bool:
    """Log a summary at most every HEARTBEAT_SEC (the first call logs at once).
    Returns True if a line was emitted."""
    global _last_heartbeat
    now = _monotonic()
    if not force and _last_heartbeat is not None and now - _last_heartbeat < HEARTBEAT_SEC:
        return False
    _last_heartbeat = now
    _logger.info("[price-alert-eval] heartbeat: %s", dict(_stats))
    last = _stats.get("last_error")
    _reset_stats()
    _stats["last_error"] = last
    return True


def run_cycle(fetch_prices, now: float) -> dict:
    """One evaluation pass. Never raises. ``fetch_prices(symbols) -> {sym: row}``."""
    report = {"now": now, "skipped": None, "symbols": 0, "fetched": 0,
              "triggered": 0, "deadline_hit": False, "error": None}
    if not enabled():
        report["skipped"] = "disabled"
        return report
    if not _market_open_now():
        report["skipped"] = "market_closed"
        _count(report)
        return report
    if not _cycle_lock.acquire(blocking=False):
        report["skipped"] = "cycle_in_progress"
        _count(report)
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
                # An empty row reads 0.0, which would fire every "below" alert at $0.00.
                try:
                    if not float(price) > 0:
                        continue
                except (TypeError, ValueError):
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
        _count(report)


def _tick() -> None:
    try:
        report = run_cycle(default_fetch_prices, time.time())
        if report.get("skipped") != "disabled":
            _heartbeat()
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
