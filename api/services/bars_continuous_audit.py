"""Continuous audit + reconciliation worker.

Runs on a single background thread. Three rolling cadences:
  - Every 5 min: spot-check 100 most-recently-fetched bars
  - Every 1 hour: full sweep of priority universe (UCT20 + watchlists + candidates)
  - Every 24 hours: full universe sweep

Each pass runs validation + reconciliation + self-heal in sequence.
"""
import threading
import time
import logging
from api.services import bars_audit


_logger = logging.getLogger(__name__)
_running = threading.Event()
_thread: threading.Thread | None = None


def start():
    global _thread
    if _running.is_set():
        return
    _running.set()
    _thread = threading.Thread(target=_loop, daemon=True, name="bars-continuous-audit")
    _thread.start()


def stop():
    _running.clear()


def _loop():
    last_5min = 0
    last_1hr = 0
    last_24hr = 0
    while _running.is_set():
        now = int(time.time())
        try:
            if now - last_5min > 300:
                _run_5min_check()
                last_5min = now
            if now - last_1hr > 3600:
                _run_priority_sweep()
                last_1hr = now
            if now - last_24hr > 86400:
                _run_universe_sweep()
                last_24hr = now
        except Exception:
            _logger.exception("[continuous_audit] iteration failed")
        # Sleep in 1s chunks so stop() is responsive
        for _ in range(60):
            if not _running.is_set():
                return
            time.sleep(1)


def _run_5min_check():
    """Intraday freshness watchdog.

    The May-8 universe freeze went unnoticed for ~8 days because nothing
    actively checked whether cached intraday bars were keeping up with the
    market. This samples a bounded spread of intraday (ticker, tf) entries
    and, if a meaningful fraction is missing >=1 whole trading session,
    raises a chart-health alert so a freeze pages instead of silently
    persisting. Fully defensive — never raises into the audit loop.
    """
    try:
        import random
        from api.services import bars_sqlite as _bs
        from api.services.bars_fetch import _is_cold_stale_intraday
        from api.services import chart_health_alerts as _alerts

        intraday = [
            (t, tf) for (t, tf) in _bs.get_all_tickers()
            if tf in ("1", "5", "15", "30", "60")
        ]
        if not intraday:
            _logger.info("[continuous_audit] 5min freshness: no intraday entries yet")
            return
        sample = random.sample(intraday, min(80, len(intraday)))
        cold = []
        for t, tf in sample:
            if _is_cold_stale_intraday(tf, _bs.get_last_ts(t, tf)):
                cold.append(f"{t}/{tf}")
        ratio = len(cold) / len(sample)
        _logger.info(
            f"[continuous_audit] 5min freshness: {len(cold)}/{len(sample)} "
            f"intraday entries cold-stale ({ratio:.0%})"
        )
        if ratio >= 0.30:
            _alerts.emit(
                "intraday_universe_stale", "critical",
                f"{ratio:.0%} of sampled intraday charts are >=1 session "
                f"behind ({len(cold)}/{len(sample)}). Universe freshness "
                f"pipeline likely broken (worker/R2 or prewarmer).",
                {"ratio": round(ratio, 3), "cold": len(cold),
                 "sample": len(sample), "examples": cold[:15]},
            )
        elif ratio >= 0.10:
            _alerts.emit(
                "intraday_universe_stale", "warning",
                f"{ratio:.0%} of sampled intraday charts are >=1 session "
                f"behind ({len(cold)}/{len(sample)}).",
                {"ratio": round(ratio, 3), "cold": len(cold),
                 "sample": len(sample), "examples": cold[:15]},
            )
    except Exception:
        _logger.exception("[continuous_audit] 5min freshness check failed")


def _run_priority_sweep():
    _logger.info("[continuous_audit] 1hr priority sweep")
    try:
        from api import main as api_main
        tickers = api_main._resolve_priority_tickers()
    except Exception:
        _logger.exception("[continuous_audit] failed to resolve priority tickers")
        return
    if not tickers:
        return
    try:
        bars_audit.audit_universe(tickers, scope="continuous-priority")
    except Exception:
        _logger.exception("[continuous_audit] priority audit_universe failed")


def _run_universe_sweep():
    _logger.info("[continuous_audit] 24hr universe sweep")
    import json, os
    try:
        with open("api/data/cap_universe.json") as f:
            data = json.load(f)
        tickers = data if isinstance(data, list) else data.get("tickers") or []
    except Exception:
        _logger.exception("[continuous_audit] failed to load cap_universe")
        return
    if not tickers:
        return
    try:
        bars_audit.audit_universe(tickers, scope="continuous-universe")
    except Exception:
        _logger.exception("[continuous_audit] universe audit_universe failed")
