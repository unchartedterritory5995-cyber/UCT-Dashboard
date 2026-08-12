"""Scheduler job BODIES for note-connector sync.

Job REGISTRATION (the `_scheduler.add_job(...)` calls, ids, `CronTrigger`s)
lives in `api/main.py`, next to every other scheduled job family (broker
sync, COT, Twitter, desk sessions) — this module owns only the callable
bodies, wrapped for `BackgroundScheduler`'s plain-thread-callable contract
(no event loop of its own, hence `asyncio.run` — mirrors `broker/sync.py`'s
`run_due_sync_blocking`/`run_nightly_reconcile_blocking` exactly).

Two jobs, both DOUBLE-GATED on `NOTE_SYNC_ENABLED` — mirrors the
awareness-engine idiom in `api/main.py` (`_add_compass_job` gates
*registration*; `_awareness_engine_scan` re-checks `AWARENESS_ENGINE_ENABLED`
*inside the job body*): `api/main.py` only ever calls `add_job(...)` for
these two functions when `NOTE_SYNC_ENABLED == "1"` at startup, AND each
function below re-checks the flag itself before doing any work — so a flag
flipped OFF between registration and a job's next fire (no redeploy in
between) is still honored.

  - `run_due_sync_blocking` — the INCREMENTAL tick: `engine.sync_due_sources()`,
    cursor-based, each source's own cooldown/interval
    (`NOTE_SYNC_INTERVAL_MIN`, default 30 min) governs whether it actually
    syncs.
  - `run_full_nightly_sync_blocking` — the FULL-listing pass: every active,
    sync-enabled source, `cursor=None`. Delete detection (engine.py's
    2-strike miss_streak, plus the `list_deleted` wiring) ONLY runs on a
    full listing, which the incremental tick above never produces —
    WITHOUT this job, delete detection is unreachable in production.
"""

from __future__ import annotations

import asyncio
import logging
import os

log = logging.getLogger("note_connectors.scheduler")


def enabled() -> bool:
    return os.environ.get("NOTE_SYNC_ENABLED") == "1"


def run_due_sync_blocking() -> None:
    """Synchronous wrapper for `BackgroundScheduler` (runs on a worker
    thread, no event loop of its own). Never raises into the scheduler."""
    if not enabled():
        return
    from . import engine
    try:
        asyncio.run(engine.sync_due_sources())
    except Exception as e:  # noqa: BLE001
        log.warning("scheduled note-connector due-sources tick failed: %s", e)


def run_full_nightly_sync_blocking() -> None:
    """Synchronous wrapper for `BackgroundScheduler`. Bypasses every
    source's cooldown/interval via `full=True, manual=True` (see
    `engine.sync_all_active_sources_full`). Never raises into the
    scheduler."""
    if not enabled():
        return
    from . import engine
    try:
        asyncio.run(engine.sync_all_active_sources_full())
    except Exception as e:  # noqa: BLE001
        log.warning("scheduled note-connector nightly full sync failed: %s", e)
