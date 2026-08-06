"""Background warm of the calendar week's earnings AI (preview + analysis).

Generates the AI ahead of a click so the names people actually open are instant
instead of a ~24s cold Claude call. Two ranking + freshness improvements over a
naive "top market cap on a timer":

  • CLICK-RELEVANCE RANKING — the warm set is ranked by (is-tracked, market-cap):
    every name in ANY user's watchlist / positions / My-Stocks is warmed first,
    then the biggest remaining caps fill the budget. So a $2B name someone
    actually follows is instant, not just the megacaps.
  • SKIP-IF-STABLE — a name is re-checked at most every few hours; the generator
    only re-sends to Claude when the inputs actually changed (consensus,
    revisions, surprises, news, implied move). Stable names cost ~$0 to keep warm,
    and a preview refreshes the moment its inputs move (e.g. consensus populating
    N/A → real). Names without a consensus yet are skipped so we never warm an
    "N/A" preview.

Plus a post-report pass warms the ANALYSIS for names that just reported, so the
after-the-print read is instant too.

Gated by EARNINGS_WARM_ENABLED (default on). Never raises.
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from api.services import earnings_ai_store

_logger = logging.getLogger(__name__)
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="earn-warm")
_locks = {"preview": threading.Lock(), "analysis": threading.Lock()}


def _tracked_union() -> set:
    """Flat set of every ticker in any user's watchlist / positions / My-Stocks."""
    try:
        from api.services.calendar_alerts import _collect_all_users_ticker_sets
        sets = _collect_all_users_ticker_sets() or {}
        out: set = set()
        for s in sets.values():
            out |= {str(t).upper() for t in (s or set())}
        return out
    except Exception as e:
        _logger.debug("[earn-warm] tracked union failed: %s", e)
        return set()


def _rank(weeks: int, *, reported: bool, tracked: set) -> list[dict]:
    """Collect this-and-next-week reporters (pending previews or reported
    analyses), dedupe by sym keeping the best market cap, and rank by
    (is-tracked, market-cap) descending."""
    from datetime import timedelta
    from api.routers.calendar import get_calendar, get_day_metrics, _week_dates

    cur_monday = _week_dates()[0]
    best: dict[str, dict] = {}
    for wk in range(max(weeks, 1)):
        monday = cur_monday + timedelta(days=7 * wk)
        try:
            payload = get_calendar(week=monday.isoformat()) or {}
        except Exception as e:
            _logger.warning("[earn-warm] get_calendar failed %s: %s", monday, e)
            continue
        for ds, day in (payload.get("days") or {}).items():
            metrics = {}
            try:
                metrics = get_day_metrics(date_str=ds) or {}
            except Exception:
                pass
            for bucket in ("bmo", "amc", "tbd"):
                for e in (day.get(bucket) or []):
                    sym = (e.get("sym") or "").upper()
                    if not sym:
                        continue
                    has_actual = e.get("eps_act") is not None
                    if reported and not has_actual:
                        continue
                    if not reported:
                        if has_actual:            # already reported → analysis path
                            continue
                        # PENDING preview: require a consensus so we never warm an
                        # "N/A" preview (skip-if-stable regenerates once it appears).
                        if e.get("eps_estimate") is None:
                            continue
                    mc = e.get("mc_b")
                    if mc is None:
                        mc = (metrics.get(sym) or {}).get("mc_b")
                    row = dict(e)
                    row["mc_b"] = mc
                    row["_is_tracked"] = sym in tracked
                    cur = best.get(sym)
                    if cur is None or (mc or -1) > (cur.get("mc_b") or -1):
                        best[sym] = row
    return sorted(
        best.values(),
        key=lambda r: (r.get("_is_tracked", False), r.get("mc_b") is not None, r.get("mc_b") or 0),
        reverse=True,
    )


def _run(kind: str, generator, reported: bool) -> dict:
    if os.environ.get("EARNINGS_WARM_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {"skipped": "disabled"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"skipped": "no-anthropic-key"}
    lock = _locks[kind]
    if not lock.acquire(blocking=False):
        return {"skipped": "already-running"}
    try:
        top_n = int(os.environ.get("EARNINGS_WARM_TOPN", "80"))
        weeks = int(os.environ.get("EARNINGS_WARM_WEEKS", "2"))
        recheck = float(os.environ.get("EARNINGS_WARM_RECHECK_HOURS", "6")) * 3600
        tracked = _tracked_union()
        ranked = _rank(1 if reported else weeks, reported=reported, tracked=tracked)

        submitted = fresh = 0
        for row in ranked[:top_n]:
            sym = row["sym"]
            age = earnings_ai_store.age(kind, sym)
            if age is not None and age < recheck:
                fresh += 1          # checked recently → don't re-fetch this cycle
                continue
            # force_fresh_check=True → the generator re-checks the signals_hash and
            # only calls Claude if the inputs changed.
            _POOL.submit(_safe_gen, generator, sym, row)
            submitted += 1

        _logger.info("[earn-warm:%s] candidates=%d tracked=%d submitted=%d recent=%d",
                     kind, len(ranked), sum(1 for r in ranked if r.get("_is_tracked")),
                     submitted, fresh)
        return {"kind": kind, "candidates": len(ranked), "submitted": submitted, "recent": fresh}
    except Exception as e:
        _logger.warning("[earn-warm:%s] pass failed: %s", kind, e)
        return {"error": str(e)}
    finally:
        lock.release()


def _safe_gen(generator, sym: str, row: dict) -> None:
    try:
        generator(sym, row, force_fresh_check=True)
    except Exception as e:
        _logger.debug("[earn-warm] gen failed %s: %s", sym, e)


def warm_week_previews() -> dict:
    """Warm PENDING reporters' previews (current + next week)."""
    from api.services.engine import _generate_earnings_preview
    return _run("preview", _generate_earnings_preview, reported=False)


def warm_reported_analyses() -> dict:
    """Warm the ANALYSIS for names that already reported this week, so the
    post-print read is instant too (runs after the close)."""
    from api.services.engine import _generate_earnings_analysis
    return _run("analysis", _generate_earnings_analysis, reported=True)
