"""Background warm of the calendar week's earnings AI (preview + analysis), plus
the Profile + Catalysts companions the same modal opens.

Generates the AI ahead of a click so the names people actually open are instant
instead of a ~25-40s cold Claude call. Two ranking + freshness ideas over a
naive "top market cap on a timer":

  • CLICK-RELEVANCE RANKING — the warm set is ranked by (is-tracked, market-cap):
    every name in ANY user's watchlist / positions / My-Stocks is warmed first,
    then the biggest remaining caps fill the budget. So a $2B name someone
    actually follows is instant, not just the megacaps.
  • SKIP-IF-STABLE — a name is re-checked at most every few hours; the generator
    only re-sends to Claude when the inputs actually changed (consensus,
    actuals, date, session). Stable names cost ~$0 to keep warm, and a preview
    refreshes the moment its inputs move (e.g. consensus populating N/A → real).
    Names without a consensus yet are skipped so we never warm an "N/A" preview.

Plus a post-report pass warms the ANALYSIS for names that just reported, so the
after-the-print read is instant too.

🔴 2026-08-21 — BOTH passes had been NO-OPS since they shipped, for one reason:
the calendar and the engine spell the same facts differently.
    calendar rows:  eps_est / eps_act / rev_est / rev_act          (no verdict)
    engine rows:    eps_estimate / reported_eps / rev_estimate / rev_actual
                    + verdict / surprise_pct
The preview ranker filtered on `e.get("eps_estimate") is None` — never present
on a calendar row — so EVERY pending name was skipped and every log line read
`candidates=0`. The analysis pass did find its names but handed the generator a
row with no `verdict`; the generator reads `""` as pending, skips the AI step,
ends with `analysis=None`, and persists nothing — re-running the whole provider
fan-out every cycle for nothing. Every click on a reporter was therefore a cold
generation; the owner measured ~40s. `engine_row()` below is the ONE adapter,
and verdict + surprise are DERIVED by engine._build_earnings_entry — the same
function the click path's rows come from — never restated here.

Gated by EARNINGS_WARM_ENABLED (default on). Never raises.
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from api.services import earnings_ai_store

_logger = logging.getLogger(__name__)
_WORKERS = int(os.environ.get("EARNINGS_WARM_WORKERS", "3") or 3)
_POOL = ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="earn-warm")
_locks = {"preview": threading.Lock(), "analysis": threading.Lock()}

# Names under this market cap (in $B) are not warmed unless someone tracks them
# — the house "Small+ (over $300mln)" standard. A row with NO cap is kept: an
# unknown cap is not a small cap.
_MIN_MC_B = float(os.environ.get("EARNINGS_WARM_MIN_MC_B", "0.3") or 0.3)

# Calendar spelling → engine spelling. Read in this order so a row that already
# carries the engine key (a test, or a future calendar change) still works.
_CAL_TO_ENGINE = {
    "eps_actual":   ("eps_act", "reported_eps", "eps_actual"),
    "eps_estimate": ("eps_est", "eps_estimate"),
    "rev_actual":   ("rev_act", "rev_actual"),
    "rev_estimate": ("rev_est", "rev_estimate"),
}


def _first(e: dict, *keys):
    for k in keys:
        v = e.get(k)
        if v is not None:
            return v
    return None


def has_actual(e: dict) -> bool:
    return _first(e, *_CAL_TO_ENGINE["eps_actual"]) is not None


def has_consensus(e: dict) -> bool:
    return _first(e, *_CAL_TO_ENGINE["eps_estimate"]) is not None


def engine_row(e: dict, date_iso: str | None = None, bucket: str | None = None) -> dict:
    """Adapt ONE calendar entry into the row the generators read.

    Verdict and surprise come from `engine._build_earnings_entry` — the exact
    function that builds the click path's rows — so the warm path and the
    click path agree by construction (and so the skip-if-stable signals hash,
    which reads engine keys, sees the same inputs from both). `date` and
    `session` are added because the preview prompt labels the report by them
    and the hash keys on them: a report-date shift must regenerate.
    """
    from api.services.engine import _build_earnings_entry
    raw = {
        "symbol": (e.get("sym") or e.get("symbol") or "").upper(),
        "ew_total": e.get("ew") or e.get("ew_total") or 0,
    }
    for engine_key, cal_keys in _CAL_TO_ENGINE.items():
        raw[engine_key] = _first(e, *cal_keys)
    row = _build_earnings_entry(raw)
    row["date"] = date_iso or e.get("date") or e.get("earnings_date")
    row["session"] = str(bucket or e.get("session") or e.get("when") or "").upper()
    for k in ("name", "time_et", "mc_b", "sector"):
        if e.get(k) is not None:
            row[k] = e[k]
    return row


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
    (is-tracked, market-cap) descending. Rows come back in ENGINE spelling."""
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
                    actual = has_actual(e)
                    if reported and not actual:
                        continue
                    if not reported:
                        if actual:                 # already reported → analysis path
                            continue
                        # PENDING preview: require a consensus so we never warm an
                        # "N/A" preview (skip-if-stable regenerates once it appears).
                        if not has_consensus(e):
                            continue
                    mc = e.get("mc_b")
                    if mc is None:
                        mc = (metrics.get(sym) or {}).get("mc_b")
                    is_tracked = sym in tracked
                    if mc is not None and mc < _MIN_MC_B and not is_tracked:
                        continue
                    row = engine_row(e, ds, bucket)
                    row["mc_b"] = mc
                    row["_is_tracked"] = is_tracked
                    cur = best.get(sym)
                    if cur is None or (mc or -1) > (cur.get("mc_b") or -1):
                        best[sym] = row
    return sorted(
        best.values(),
        key=lambda r: (r.get("_is_tracked", False), r.get("mc_b") is not None, r.get("mc_b") or 0),
        reverse=True,
    )


# ── Companions: the Profile + Catalysts tabs of the same modal ───────────────
# Both services are generate-once (their own stores + daily caps gate the
# spend), but each `_gen_async` spawns an UNBOUNDED thread per name — kicking
# 180 of them at once is a fan-out the web pod cannot absorb. So the warm calls
# their synchronous generators on THIS pool, paced by its worker count.

def _companions_enabled() -> bool:
    return os.environ.get("EARNINGS_WARM_COMPANIONS", "1").lower() in ("1", "true", "yes")


def _needs_profile(sym: str) -> bool:
    from api.services.stock_brief import service as sb, store as sb_store
    if not sb._enabled():
        return False
    sb_store._init_db()
    return sb_store.needs_generation(sym, sb._period(sb._year()), sb._RETRY_AFTER, sb._REFRESH_AFTER)


def _needs_catalysts(sym: str) -> bool:
    from api.services.news_catalysts import service as nc, store as nc_store
    if not nc._enabled():
        return False
    nc_store._init_db()
    return nc_store.needs_generation(sym, nc.HIST_PERIOD, nc._RETRY_AFTER)


def _needs_companion(sym: str) -> bool:
    for needs in (_needs_profile, _needs_catalysts):
        try:
            if needs(sym):
                return True
        except Exception as e:
            _logger.debug("[earn-warm] companion check failed %s: %s", sym, e)
    return False


def _safe_companions(sym: str) -> None:
    """Profile (stock_brief) then Catalysts (news_catalysts) for one name."""
    from api.services.stock_brief import service as sb
    from api.services.news_catalysts import service as nc
    for label, needs, svc in (("profile", _needs_profile, sb), ("catalysts", _needs_catalysts, nc)):
        try:
            if not needs(sym):
                continue
            if sym in getattr(svc, "_generating", ()):   # a viewer already kicked it
                continue
            svc._generate_and_store(sym)
        except Exception as e:
            _logger.debug("[earn-warm] %s gen failed %s: %s", label, sym, e)


def _run(kind: str, generator, reported: bool) -> dict:
    if os.environ.get("EARNINGS_WARM_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {"skipped": "disabled"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"skipped": "no-anthropic-key"}
    lock = _locks[kind]
    if not lock.acquire(blocking=False):
        return {"skipped": "already-running"}
    try:
        top_n = int(os.environ.get("EARNINGS_WARM_TOPN", "200"))
        weeks = int(os.environ.get("EARNINGS_WARM_WEEKS", "2"))
        recheck = float(os.environ.get("EARNINGS_WARM_RECHECK_HOURS", "6")) * 3600
        tracked = _tracked_union()
        ranked = _rank(1 if reported else weeks, reported=reported, tracked=tracked)
        chosen = ranked[:top_n]
        dropped = len(ranked) - len(chosen)

        submitted = fresh = 0
        for row in chosen:
            sym = row["sym"]
            age = earnings_ai_store.age(kind, sym)
            if age is not None and age < recheck:
                fresh += 1          # checked recently → don't re-fetch this cycle
                continue
            # force_fresh_check=True → the generator re-checks the signals_hash and
            # only calls Claude if the inputs changed.
            _POOL.submit(_safe_gen, generator, sym, row)
            submitted += 1

        companions = 0
        if _companions_enabled():
            for row in chosen:
                if _needs_companion(row["sym"]):
                    _POOL.submit(_safe_companions, row["sym"])
                    companions += 1

        # `dropped_by_topn` is logged so a bounded warm never reads as "covered
        # everything" — a silently truncated list is how a cold click hides.
        _logger.info("[earn-warm:%s] candidates=%d tracked=%d submitted=%d recent=%d "
                     "companions=%d dropped_by_topn=%d",
                     kind, len(ranked), sum(1 for r in ranked if r.get("_is_tracked")),
                     submitted, fresh, companions, dropped)
        return {"kind": kind, "candidates": len(ranked), "submitted": submitted,
                "recent": fresh, "companions": companions, "dropped_by_topn": dropped}
    except Exception as e:
        _logger.warning("[earn-warm:%s] pass failed: %s", kind, e)
        return {"error": str(e)}
    finally:
        lock.release()


def _safe_gen(generator, sym: str, row: dict) -> None:
    try:
        generator(sym, row, force_fresh_check=True)
    except Exception as e:
        _logger.warning("[earn-warm] gen failed %s: %s", sym, e)


def warm_week_previews() -> dict:
    """Warm PENDING reporters' previews (current + next week)."""
    from api.services.engine import _generate_earnings_preview
    return _run("preview", _generate_earnings_preview, reported=False)


def warm_reported_analyses() -> dict:
    """Warm the ANALYSIS for names that already reported this week, so the
    post-print read is instant too (runs after the BMO and AMC prints)."""
    from api.services.engine import _generate_earnings_analysis
    return _run("analysis", _generate_earnings_analysis, reported=True)
