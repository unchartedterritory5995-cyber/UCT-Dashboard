"""Background warm of the calendar week's biggest earnings reporters.

Generates the AI preview for the top-N pending reporters (ranked by market cap)
BEFORE a user clicks, so the megacaps people actually open (TSM, JPM, NFLX, …)
are instant instead of a 20-30s cold Claude call. Cost-safe because it is:

  • generate-ONCE — results are disk-persisted (earnings_ai_store) and survive
    Railway redeploys, so a scheduled run after the first is a near-no-op (every
    already-warmed name is skipped without a token spent);
  • BOUNDED — only the top-N by market cap across the current + next week, not
    the long tail of micro-cap regional banks nobody clicks.

Gated by EARNINGS_WARM_ENABLED (default on). Never raises.
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from api.services import earnings_ai_store

_logger = logging.getLogger(__name__)
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="earn-warm")
_lock = threading.Lock()
_running = False


def _safe_gen(sym: str, row: dict) -> None:
    try:
        from api.services.engine import _generate_earnings_preview
        _generate_earnings_preview(sym, row)
    except Exception as e:
        _logger.debug("[earn-warm] gen failed %s: %s", sym, e)


def warm_week_previews() -> dict:
    """Rank the current + next week's PENDING reporters by market cap and warm
    the top-N previews. Idempotent + single-flight; skips names already fresh on
    disk. Returns a small stats dict."""
    if os.environ.get("EARNINGS_WARM_ENABLED", "1") != "1":
        return {"skipped": "disabled"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"skipped": "no-anthropic-key"}

    global _running
    with _lock:
        if _running:
            return {"skipped": "already-running"}
        _running = True
    try:
        return _do_warm()
    except Exception as e:
        _logger.warning("[earn-warm] pass failed: %s", e)
        return {"error": str(e)}
    finally:
        with _lock:
            _running = False


def _do_warm() -> dict:
    from datetime import timedelta
    # Calendar helpers live in the router module; they're plain callables
    # (most_anticipated_png already calls them directly off the request path).
    from api.routers.calendar import get_calendar, get_day_metrics, _week_dates

    top_n = int(os.environ.get("EARNINGS_WARM_TOPN", "60"))
    weeks = int(os.environ.get("EARNINGS_WARM_WEEKS", "2"))   # current + next by default

    cur_monday = _week_dates()[0]
    best: dict[str, dict] = {}
    for wk in range(max(weeks, 1)):
        monday = cur_monday + timedelta(days=7 * wk)
        try:
            payload = get_calendar(week=monday.isoformat()) or {}
        except Exception as e:
            _logger.warning("[earn-warm] get_calendar failed %s: %s", monday, e)
            continue
        days = (payload.get("days") or {})
        for ds, day in days.items():
            metrics = {}
            try:
                metrics = get_day_metrics(date=ds) or {}
            except Exception:
                pass
            for bucket in ("bmo", "amc", "tbd"):
                for e in (day.get(bucket) or []):
                    sym = (e.get("sym") or "").upper()
                    if not sym:
                        continue
                    # PENDING only — a reported name (eps_act set) shows the
                    # post-earnings analysis, generated lazily + disk-persisted.
                    if e.get("eps_act") is not None:
                        continue
                    mc = e.get("mc_b")
                    if mc is None:
                        mc = (metrics.get(sym) or {}).get("mc_b")
                    row = dict(e)
                    row["mc_b"] = mc
                    cur = best.get(sym)
                    if cur is None or (mc or -1) > (cur.get("mc_b") or -1):
                        best[sym] = row

    ranked = sorted(
        best.values(),
        key=lambda r: (r.get("mc_b") is not None, r.get("mc_b") or 0),
        reverse=True,
    )

    submitted = 0
    fresh = 0
    for row in ranked[:top_n]:
        sym = row["sym"]
        if earnings_ai_store.is_fresh("preview", sym):
            fresh += 1
            continue
        _POOL.submit(_safe_gen, sym, row)
        submitted += 1

    _logger.info(
        "[earn-warm] candidates=%d top_n=%d submitted=%d already_fresh=%d",
        len(ranked), top_n, submitted, fresh,
    )
    return {"candidates": len(ranked), "submitted": submitted, "fresh": fresh}
