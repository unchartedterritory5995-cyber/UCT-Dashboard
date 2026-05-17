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
        from api.services import bars_sqlite as _bs
        from api.services.bars_fetch import (
            _is_cold_stale_intraday, get_hot_intraday_tickers,
        )
        from api.services import chart_health_alerts as _alerts

        TFS = ("60", "30", "15", "5", "1")

        # ── Actionable signal: the HOT-SET (charts users actually open) ──
        # The untouched long tail of the ~3,685-ticker universe staying
        # frozen is the EXPECTED steady state — Part 1 heals it on access,
        # by design. Alerting on that = a permanently-red signal that
        # hides a real regression. What's actionable is: are the charts
        # users are actively viewing fresh? If a meaningful fraction of
        # recently-requested tickers is >=1 session behind, the freshness
        # pipeline (Part 1 sync fetch / hot-set prewarm / R2 merge) is
        # genuinely broken and someone must look.
        hot = get_hot_intraday_tickers(200)
        if hot:
            hot_cold = []
            hot_checked = 0
            for t in hot:
                for tf in TFS:
                    last = _bs.get_last_ts(t, tf)
                    if last is None:
                        continue  # tf never requested for this ticker
                    hot_checked += 1
                    if _is_cold_stale_intraday(tf, last):
                        hot_cold.append(f"{t}/{tf}")
            if hot_checked:
                hot_ratio = len(hot_cold) / hot_checked
                _logger.info(
                    f"[continuous_audit] hot-set freshness: {len(hot_cold)}/"
                    f"{hot_checked} cold ({hot_ratio:.0%}) over {len(hot)} "
                    f"recently-viewed tickers"
                )
                if hot_ratio >= 0.20:
                    _alerts.emit(
                        "intraday_hotset_stale", "critical",
                        f"{hot_ratio:.0%} of ACTIVELY-VIEWED intraday charts "
                        f"are >=1 session behind ({len(hot_cold)}/"
                        f"{hot_checked}). Freshness pipeline broken — Part 1 "
                        f"sync fetch / hot-set prewarm / R2 merge.",
                        {"ratio": round(hot_ratio, 3), "cold": len(hot_cold),
                         "checked": hot_checked, "examples": hot_cold[:15]},
                    )
                elif hot_ratio >= 0.08:
                    _alerts.emit(
                        "intraday_hotset_stale", "warning",
                        f"{hot_ratio:.0%} of actively-viewed intraday charts "
                        f"are >=1 session behind ({len(hot_cold)}/{hot_checked}).",
                        {"ratio": round(hot_ratio, 3), "cold": len(hot_cold),
                         "checked": hot_checked, "examples": hot_cold[:15]},
                    )

        # ── Visibility-only: universe baseline (NOT alerted) ────────────
        # Logged so an operator can see long-tail healing progress / decide
        # whether a bulk warm-universe pass is worth running. Never emits.
        try:
            import random
            allintr = [
                (t, tf) for (t, tf) in _bs.get_all_tickers()
                if tf in ("1", "5", "15", "30", "60")
            ]
            if allintr:
                samp = random.sample(allintr, min(80, len(allintr)))
                base_cold = sum(
                    1 for t, tf in samp
                    if _is_cold_stale_intraday(tf, _bs.get_last_ts(t, tf))
                )
                _logger.info(
                    f"[continuous_audit] universe baseline (info, not "
                    f"alerted): {base_cold}/{len(samp)} long-tail intraday "
                    f"cold ({base_cold / len(samp):.0%})"
                )
        except Exception:
            pass
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
