"""Excursion nightly backfill job + status state (Journal A+ Phase 2, Task 4).

Batch-computes MFE/MAE/exit-efficiency for every CLOSED equity trade + closed
option strategy that doesn't already have an excursion row, off the request path.

Two entry points:
  - `register_jobs(scheduler)` — gated by EXCURSION_ENGINE_ENABLED, schedules the
    nightly 03:10 ET Mon-Sat run (`_nightly` → `run_backfill()`). Mirrors
    api/j2_attachments_backup.register_jobs.
  - `run_backfill(...)` — the batch itself, called from the cron / the admin
    daemon thread / tests. Runs OFF the request path.

Idempotency: `excursions_store.existing_refs(user)` supplies the already-computed
trade_refs; those are skipped unless `force=True`. Each `compute_for_trade` /
`compute_for_option_strategy` upserts+commits its own row (short writer locks —
auth.db also serves logins), mirroring trading_day_backfill.py. One bad trade is
caught per-row so it never aborts the whole run.

The batch-by-symbol fetch optimization (fetch each symbol's bar window once) is a
documented follow-up — the correctness-first version iterates trades and lets
`compute_for_trade` do its own tiered fetch (correct, just not deduped).

Status: `get_state()` returns a copy of the last-run summary (camelCase, mirrors
the reconciliation-status / excursions_store view) for the admin status endpoint.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_two.excursion_engine import (
    compute_for_option_strategy,
    compute_for_trade,
)
from api.services.journal_two.excursions_store import existing_refs
from api.services.journal_two.trade_refs import prune_dead_excursions, trade_ref_for_row

logger = logging.getLogger(__name__)


# ── config (read fresh so a Railway var flip / test env takes effect without a
# ── module reload; register_jobs still gates at boot) ─────────────────────────

def _enabled() -> bool:
    return os.environ.get("EXCURSION_ENGINE_ENABLED", "0").lower() in ("1", "true", "yes")


# ── last-run status (thread-safe; the status endpoint reads a copy) ───────────

_STATE_LOCK = threading.Lock()
_state: dict = {
    "startedAt": None,
    "finishedAt": None,
    "tradesDone": 0,
    "optionsDone": 0,
    "insufficient": 0,
    "errors": 0,
    "symbols": 0,
    "pruned": 0,
    "error": None,
    # Concurrency guard: True while a backfill is in flight. Refuses an
    # overlapping run (double-click, or an admin click at 03:09 racing the
    # 03:10 cron). Set/cleared under _STATE_LOCK.
    "running": False,
}


def get_state() -> dict:
    """Copy of the last run's summary (under lock) for the status endpoint."""
    with _STATE_LOCK:
        return dict(_state)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── core batch ────────────────────────────────────────────────────────────────

def run_backfill(*, user_id: str | None = None, force: bool = False,
                 bar_fetch=None, conn=None, limit: int | None = None) -> dict:
    """Compute + persist excursions for closed equity trades + closed option
    strategies. All users, or one when `user_id` is given.

    Skips trade_refs already in `existing_refs(user)` unless `force`. Wraps each
    per-row compute in try/except so one bad trade never aborts the run (counted
    in `errors`). Updates the module status state. Returns the counts dict:
    `{trades_done, options_done, insufficient, errors, symbols}`.

    `limit` (when set) caps the number of COMPUTES this run — a controlled first
    backfill on a large book. Skipped-because-already-computed rows do NOT count
    against it (only rows we actually attempt to compute do). Default None =
    unbounded (the nightly cron).

    Concurrency: refuses an overlapping run — if a backfill is already in flight
    (`_state['running']`) it returns `{"skipped": "already running"}` WITHOUT
    touching the DB. The flag is cleared in a finally so a crash can't wedge it.

    `bar_fetch` (when injected) is threaded into `compute_for_*` — that keeps the
    core network-free for tests. `conn` (when injected) is used for the SELECTs
    and threaded into the compute upserts (tests inject an in-memory conn); in
    production it opens/closes its own `get_connection()` (auth.db).
    """
    # ── concurrency guard ─────────────────────────────────────────────────────
    with _STATE_LOCK:
        if _state.get("running"):
            return {"skipped": "already running"}
        _state["running"] = True
    try:
        return _run_backfill_locked(
            user_id=user_id, force=force, bar_fetch=bar_fetch, conn=conn, limit=limit,
        )
    finally:
        with _STATE_LOCK:
            _state["running"] = False


def _run_backfill_locked(*, user_id, force, bar_fetch, conn, limit) -> dict:
    """The actual batch, run under the `_state['running']` guard set by
    `run_backfill`. Split out so the guard's try/finally stays trivial."""
    started = _now_iso()
    own = conn is None
    if own:
        conn = get_connection()

    trades_done = options_done = insufficient = errors = pruned = 0
    processed = 0  # rows we ATTEMPTED to compute — the `limit` cap counts these
    symbols: set[str] = set()
    fatal_error: str | None = None

    # Per-user existing-refs cache (idempotency skip). Snapshot once per user —
    # each row appears once in the SELECT, so no intra-run double-processing.
    existing_by_user: dict[str, set[str]] = {}

    def _refs_for(uid: str) -> set[str]:
        if uid not in existing_by_user:
            existing_by_user[uid] = existing_refs(uid, conn)
        return existing_by_user[uid]

    try:
        # ── closed equity trades (exit_date IS NOT NULL) ──────────────────────
        if user_id:
            trade_rows = conn.execute(
                "SELECT * FROM j2_trades WHERE exit_date IS NOT NULL AND user_id = ?",
                (user_id,),
            ).fetchall()
        else:
            trade_rows = conn.execute(
                "SELECT * FROM j2_trades WHERE exit_date IS NOT NULL",
            ).fetchall()

        for row in trade_rows:
            if limit is not None and processed >= limit:
                break
            try:
                uid = row["user_id"]
                ref = trade_ref_for_row(row)
                if not force and ref in _refs_for(uid):
                    continue  # already computed — does NOT count against `limit`
                processed += 1
                rec = compute_for_trade(row, bar_fetch=bar_fetch, conn=conn)
                trades_done += 1
                sym = rec.get("symbol")
                if sym:
                    symbols.add(sym)
                if rec.get("data_quality") == "insufficient":
                    insufficient += 1
            except Exception:  # noqa: BLE001 — one bad trade must not abort the run
                logger.exception("[j2-excursion] compute failed for a trade")
                errors += 1

        # ── closed option strategies (status = 'closed') ─────────────────────
        if user_id:
            opt_rows = conn.execute(
                "SELECT * FROM j2_option_strategies WHERE status = 'closed' AND user_id = ?",
                (user_id,),
            ).fetchall()
        else:
            opt_rows = conn.execute(
                "SELECT * FROM j2_option_strategies WHERE status = 'closed'",
            ).fetchall()

        for row in opt_rows:
            if limit is not None and processed >= limit:
                break
            try:
                uid = row["user_id"]
                ref = f"id:{row['id']}"  # options are never in j2_trades
                if not force and ref in _refs_for(uid):
                    continue  # already computed — does NOT count against `limit`
                processed += 1
                legs = conn.execute(
                    "SELECT * FROM j2_option_legs WHERE strategy_id = ? "
                    "ORDER BY leg_index ASC",
                    (row["id"],),
                ).fetchall()
                rec = compute_for_option_strategy(
                    row, legs, bar_fetch=bar_fetch, conn=conn,
                )
                options_done += 1
                sym = rec.get("symbol")
                if sym:
                    symbols.add(sym)
                if rec.get("data_quality") == "insufficient":
                    insufficient += 1
            except Exception:  # noqa: BLE001
                logger.exception("[j2-excursion] compute failed for an option strategy")
                errors += 1

        # ── prune dead excursion residue ──────────────────────────────────────
        # A broker re-slice retires old refs; their excursion rows (machine
        # output, recomputed above for the live refs) would otherwise accumulate
        # forever. Rows with user attachments are kept (Trust Center queue).
        try:
            pruned = prune_dead_excursions(user_id=user_id, conn=conn)
        except Exception:  # noqa: BLE001 — hygiene must never fail the backfill
            logger.exception("[j2-excursion] orphan prune failed")
    except Exception as e:  # noqa: BLE001 — a fatal (e.g. SELECT) error is recorded, not raised
        logger.exception("[j2-excursion] backfill run failed")
        fatal_error = str(e)[:300]
    finally:
        if own:
            conn.close()

    counts = {
        "trades_done": trades_done,
        "options_done": options_done,
        "insufficient": insufficient,
        "errors": errors,
        "symbols": len(symbols),
        "pruned": pruned,
    }
    with _STATE_LOCK:
        _state.update({
            "startedAt": started,
            "finishedAt": _now_iso(),
            "tradesDone": trades_done,
            "optionsDone": options_done,
            "insufficient": insufficient,
            "errors": errors,
            "symbols": len(symbols),
            "pruned": pruned,
            "error": fatal_error,
        })
    logger.info(
        "[j2-excursion] backfill done: trades=%d options=%d insufficient=%d errors=%d symbols=%d pruned=%d",
        trades_done, options_done, insufficient, errors, len(symbols), pruned,
    )
    return counts


# ── scheduler ─────────────────────────────────────────────────────────────────

def _nightly() -> None:
    """Cron target — full-universe backfill (all users, skip already-computed)."""
    run_backfill()


def register_jobs(scheduler) -> bool:
    """Nightly 03:10 ET Mon-Sat excursion backfill. Gated by
    EXCURSION_ENGINE_ENABLED. Returns True iff the job was registered."""
    if not _enabled():
        logger.info("[j2-excursion] disabled (EXCURSION_ENGINE_ENABLED != 1)")
        return False
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    scheduler.add_job(
        _nightly,
        CronTrigger(day_of_week="mon-sat", hour=3, minute=10,
                    timezone=ZoneInfo("America/New_York")),
        id="j2_excursion_backfill", max_instances=1, replace_existing=True,
    )
    logger.info("[j2-excursion] scheduled 03:10 ET Mon-Sat")
    return True
