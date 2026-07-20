"""Theme Membership Engine — admin ops endpoints (/api/theme-engine/*).

All endpoints require_admin (canonical dependency from auth_middleware, same
pattern as admin_chart_health). The engine itself lives in
api/services/theme_engine/; this router is the owner's ops surface: status,
weekly report, rollback, suppression review, validation dry-run, and the
decision-ledger reset that makes go-live safe.

## Activation runbook (owner)
1. Deploy with THEME_ENGINE_ENABLED unset — engine fully inert; overlay tables
   are still initialized at boot so these endpoints work.
2. Validation: POST /api/theme-engine/dry-run?batch=50 — runs a REAL orphan
   batch (real LLM calls, real cost) but writes NO membership rows. Watch the
   run appear/finish in GET /api/theme-engine/status; hand-check the examined/
   added/skipped counts and logs before trusting the engine.
3. ⚠️ CRITICAL — BEFORE flipping live: POST /api/theme-engine/clear-decisions.
   A dry-run still RECORDS engine_decisions rows for every examined sym
   (orphans.py records 'none'/'below_gate' even when dry), and
   run_orphan_batch skips any sym decided within THEME_ENGINE_REEVAL_DAYS
   (default 35d) — so a validation dry-run left in place makes the first LIVE
   run examine 0 syms for ~5 weeks. Clearing the ledger between validation
   and go-live is the runbook step that prevents that.
4. Set THEME_ENGINE_ENABLED=1 in Railway + redeploy → crons register:
   theme_engine_orphans Mon-Fri 23:00 ET, theme_engine_improve Sat 10:00 ET
   (improve + co-movement audit + weekly Discord report).
5. Undo a bad run: POST /api/theme-engine/rollback/{run_id} — NEWEST run
   first. Kill switch: unset THEME_ENGINE_ENABLED + redeploy (overlay rows
   persist but stop growing).
"""
import logging
import threading

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import require_admin
from api.services.theme_engine import improve, invalidate, orphans, store

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/theme-engine", tags=["theme-engine"])


@router.get("/status")
def engine_status(user: dict = Depends(require_admin)):
    """Recent engine runs + today's LLM spend + owner-review queue size +
    overlay add-row count."""
    with store._conn() as c:
        rows = c.execute(
            "SELECT * FROM engine_runs ORDER BY started_at DESC, rowid DESC LIMIT 20"
        ).fetchall()
    return {
        "runs": [dict(r) for r in rows],
        "day_cost_usd": store.day_cost_usd(),
        "pending_suppressions": len(store.pending_suppressions()),
        "overlay_adds": len(store.engine_rows()),
    }


@router.get("/report")
def engine_report(user: dict = Depends(require_admin)):
    """The weekly digest text (same content the Sat cron posts to Discord)."""
    return {"text": improve.weekly_report_text()}


@router.post("/rollback/{run_id}")
def rollback_run(run_id: str, user: dict = Depends(require_admin)):
    """Inverse-replay a run's membership events (newest run first — see
    store.rollback_run), then invalidate derived caches immediately."""
    undone = store.rollback_run(run_id)
    invalidate.post_engine_run()
    return {"undone": undone}


@router.post("/suppress/{theme_id}/{sym}/dismiss")
def dismiss_suppression(theme_id: str, sym: str, user: dict = Depends(require_admin)):
    """Owner reviewed a suppress proposal and rejected it (member stays)."""
    store.set_suppress_status(theme_id, sym, "dismissed")
    return {"ok": True}


@router.post("/dry-run")
def start_dry_run(batch: int = Query(50, ge=1, le=2000),
                  user: dict = Depends(require_admin)):
    """Kick off a VALIDATION orphan batch (dry_run=True — real LLM spend, no
    membership writes) on a daemon thread (house admin background pattern, cf.
    admin_purge). Returns immediately; the run appears in GET /status. This is
    the owner's hand-check artifact generator before go-live."""
    def _run():
        try:
            res = orphans.run_orphan_batch(batch=batch, dry_run=True)
            _logger.info("theme-engine dry-run finished: %s", res)
        except Exception as e:  # noqa: BLE001
            _logger.warning("theme-engine dry-run failed: %s", e)

    threading.Thread(target=_run, daemon=True, name="theme-engine-dry-run").start()
    return {"started": True, "run_id": None}


@router.post("/clear-decisions")
def clear_decisions(user: dict = Depends(require_admin)):
    """Delete ALL engine_decisions rows; returns the count deleted.

    ⚠️ CRITICAL ops step (review carry-forward): a validation DRY-RUN records
    a decision row for every examined sym ('none'/'below_gate' — orphans.py
    records even when dry), and run_orphan_batch excludes syms decided within
    THEME_ENGINE_REEVAL_DAYS (35d) from its candidate list. Left in place,
    those rows make the first LIVE run examine 0 syms for ~5 weeks. The
    activation runbook (module docstring) calls this endpoint between
    validation and go-live to reset the ledger."""
    cur = store._exec_retry("DELETE FROM engine_decisions")
    return {"deleted": cur.rowcount}
