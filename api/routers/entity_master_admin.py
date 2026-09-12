"""api/routers/entity_master_admin.py — Entity Master (S3) admin status/ops.

Read the decorators, not a list here — a hand-typed route table beside the
source that owns it is this repo's most-repeated defect (`modelbook.py`'s own
header says so, and `cot.py`'s said "4 routes" above five).

WHY THIS FILE EXISTS
--------------------
S3 (the Entity Master) shipped to production on 2026-09-02 in eight
checkpoints — `api/services/entity_master/{schema,store,api,reconciliation}.py`
plus `scripts/entity_master_seed.py`. Its admin status/ops routes were
authorized in the same gate packet and never built, so until now the store's
health was inspectable ONLY by opening `entity_master.db` by hand. That is not
an operational surface; it is the absence of one. `scripts/entity_master_seed.py`'s
own docstring already points here — *"or triggers the admin `/reconcile` route
(Checkpoint 6+, not built yet)"*.

⛔ ADMIN-ONLY, EVERY ROUTE, INCLUDING THE READ.
`entity-master-spec.md` §7.3 asks for the status route to be a **no-auth read**,
citing `GET /api/admin/bars-stream-status` and `GET /api/admin/reconciliation-status`
as precedent. That instruction is NOT followed here, by explicit owner
authorization for this build: this app has exactly two roles (`admin`,
`member`), and what `/status` reports is the shape of the firm's own instrument
universe — entity/alias counts, FIGI coverage, the ambiguous-alias defect
signal. `require_admin` is the gate the same spec's §7.4 and §12 already
demand for the write half, and using one posture for both halves of one
surface is cheaper to reason about than the spec's split. The deviation is
recorded here rather than silently taken.

⛔ THE WRITE HALF IS `/reconcile`, NOT `/reseed`, AND THAT IS A REAL CHOICE.
The seed lives in `scripts/entity_master_seed.py`, which is a standalone script
outside the `api` package — and `api/services/entity_master/reconciliation.py`
states in its own header that it keeps a duplicate copy of the seed's
canonicalization precisely because "this job must not depend on `scripts/` at
runtime". A `/reseed` route would have to import `scripts/` from `api/` and
break that boundary. `run_reconciliation` is the supported in-package
equivalent: spec §9.4 calls seed and reconcile "the same operation at different
points in the store's lifetime", and §7.4 names `POST /reconcile` by that name.

⛔ THE RUN IS NEVER ON THE REQUEST PATH, AND NEVER AUTOMATIC.
`run_reconciliation` re-fetches up to `max_pages` of Massive's reference feed
and then issues one `apply_event` per proposal — minutes of blocking network
work. It runs on a dedicated daemon thread, the shape `cot.py`'s
`POST /api/cot/narratives/prewarm` uses, and the route returns at once.

⚠️ DELIBERATELY **NOT** `BackgroundTasks`, which is what `cot.py`'s `/reseed`
and `/refresh` use. A `BackgroundTasks` entry for a `def` (non-async) callable
is run by Starlette in the shared anyio threadpool — the ONE 64-slot pool this
single-process web pod shares across every user, and pinning a worker there for
minutes on an unbounded external call is the exact mechanism CLAUDE.md names
as the cause of the 2026-07-01 524 outage. `cot_service.refresh_from_current`
is seconds of work and can afford it; a 60-page reference walk cannot. A
dedicated thread costs one thread and borrows nothing.

Nothing in this module is wired into APScheduler. A reconcile happens because
an admin asked for one, and `dry_run` defaults to **True** so the default call
writes nothing — the same "callers must opt IN to real writes" default
`run_reconciliation` itself sets, and the same discipline
`scripts/entity_master_seed.py --dry-run` follows.

⛔ NO CLIENT-SUPPLIED `db_path`. The seed script takes `--db-path` because an
operator at a shell already owns the filesystem; an HTTP route that took one
would be an arbitrary-path write lever wearing an admin gate. Both routes read
the service default (`DATA_DIR`), and tests reach a temp store by pointing
`entity_master.schema.DB_PATH` at one — never by a query parameter.
"""
from __future__ import annotations

import datetime
import threading

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import require_admin
from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store

router = APIRouter(prefix="/api/admin/entity-master", tags=["entity-master-admin"])

#: How many proposal symbols a finished reconcile summary carries. The COUNT is
#: always exact and reported separately; this bounds the NAMES so a first real
#: run against ~6k un-entitied symbols cannot return a multi-megabyte blob from
#: a status route. `sample_truncated` says when the list is short of the count —
#: a truncation that does not announce itself reads as a smaller result set
#: (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
SAMPLE_LIMIT = 50


# ── the single-flight reconcile runner ──────────────────────────────────────
#
# Module-level state, per-PROCESS, exactly like `sync._locks` and
# `recent_orders._last_poll` in the broker family: correct on this pod because
# the web pod is ONE uvicorn process. It is a guard, not a cache — if the web
# pod ever goes multi-instance, two instances each admit one run and the
# single-flight property is gone. Recorded here rather than discovered later.

_RUN_LOCK = threading.Lock()
_running: dict | None = None      # the in-flight run, or None
_last_run: dict | None = None     # the most recent FINISHED run, or None


def _now_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


def _summarize(result: dict) -> dict:
    """Counts always; names bounded and the truncation named."""
    creates = result.get("proposed_creates") or []
    delists = result.get("proposed_delists") or []
    ambiguous = result.get("ambiguous") or []
    return {
        "dry_run": bool(result.get("dry_run")),
        "live_symbols_count": result.get("live_symbols_count"),
        "open_aliases_count": result.get("open_aliases_count"),
        "skipped_existing_count": result.get("skipped_existing_count"),
        "proposed_creates_count": len(creates),
        "proposed_delists_count": len(delists),
        "ambiguous_count": len(ambiguous),
        "rejected_count": len(result.get("rejected") or []),
        # Present only on a real (non-dry) run — `run_reconciliation` omits
        # them entirely on a dry run rather than reporting a misleading 0.
        "created": result.get("created"),
        "delisted": result.get("delisted"),
        "proposed_creates_sample": [c.get("symbol") for c in creates[:SAMPLE_LIMIT]],
        "proposed_delists_sample": [d.get("symbol") for d in delists[:SAMPLE_LIMIT]],
        "ambiguous_sample": ambiguous[:SAMPLE_LIMIT],
        "rejected_sample": (result.get("rejected") or [])[:SAMPLE_LIMIT],
        "sample_truncated": max(len(creates), len(delists), len(ambiguous)) > SAMPLE_LIMIT,
    }


def _run_reconcile(dry_run: bool, started_at: str) -> None:
    """The daemon-thread body. Never raises onto anything — a failure is
    RECORDED on `_last_run` and readable from `/status`, because a background
    run that dies silently is indistinguishable from one that never started
    (`lesson_a_swallowed_error_becomes_a_confident_finding` is about the
    swallow; this is the half that makes the swallow honest)."""
    global _running, _last_run
    summary: dict = {"started_at": started_at, "dry_run": dry_run}
    try:
        # Lazy import: keeps `api.main`'s import graph off Massive's module at
        # boot, and lets a test substitute `run_reconciliation` on the module.
        from api.services.entity_master import reconciliation

        result = reconciliation.run_reconciliation(dry_run=dry_run)
        summary.update(_summarize(result))
        summary["ok"] = True
    except Exception as e:  # noqa: BLE001 — the whole point is to record it
        summary["ok"] = False
        summary["error"] = f"{type(e).__name__}: {e}"
    finally:
        summary["finished_at"] = _now_iso()
        with _RUN_LOCK:
            _last_run = summary
            _running = None


def _reconcile_state() -> dict:
    with _RUN_LOCK:
        return {
            "in_flight": dict(_running) if _running else None,
            "last_run": dict(_last_run) if _last_run else None,
        }


# ── routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status(_admin: dict = Depends(require_admin)):
    """Row counts, FIGI coverage, the ambiguous-alias defect signal, the last
    seed/reconcile times, and the reconcile runner's state.

    `entity-master-spec.md` §7.3's field names are kept (`entities`, `aliases`,
    `delisted`, `figi_coverage_pct`, `ambiguous_count`, `last_seed_at`,
    `last_reconcile_at`) so the spec and the artifact can be diffed without a
    translation table. The extra fields are what the store can also answer
    cheaply and an operator actually asks for.

    ⚠️ `last_seed_at` / `last_reconcile_at` are DERIVED from the event trail —
    `MAX(applied_at)` over `entity_events` grouped by `source` — because the
    store keeps no separate run ledger and the event trail is the only durable
    record of either operation. So `last_seed_at` is precisely "the newest
    `admin_manual`-sourced event", which the seed script writes and a future
    hand-submitted admin event would write too. It is not a claim that a full
    seed ran at that moment, and it is NOT restated from a counter that could
    drift away from the rows (`lesson_health_check_reads_a_proxy_not_the_artifact`).
    """
    counts = em_store.status_counts()
    entities = counts["entities"]
    figi = counts["entities_with_composite_figi"]
    return {
        # spec §7.3's shape
        "entities": entities,
        "aliases": counts["aliases"],
        "delisted": counts["delisted_entities"],
        # Guarded rather than assumed: a store that has never been seeded has
        # zero entities, and `/status` on a fresh store must answer, not 500.
        "figi_coverage_pct": round(100.0 * figi / entities, 2) if entities else 0.0,
        "ambiguous_count": counts["ambiguous_open_aliases"],
        "last_seed_at": counts["last_seed_at"],
        "last_reconcile_at": counts["last_reconcile_at"],
        # beyond the spec's shape — what the store can also answer cheaply
        "open_aliases": counts["open_aliases"],
        "entities_with_composite_figi": figi,
        "figi_rows": counts["figi_rows"],
        "vendor_symbols": counts["vendor_symbols"],
        "relations": counts["relations"],
        "events": counts["events"],
        "rejected_events": counts["rejected_events"],
        "lifecycle_states": counts["lifecycle_states"],
        "db_path": em_schema.DB_PATH,
        "reconcile": _reconcile_state(),
    }


@router.post("/reconcile")
def start_reconcile(dry_run: bool = True, _admin: dict = Depends(require_admin)):
    """Start ONE reconciliation pass on a daemon thread and return at once.

    `dry_run` defaults to **True** — a caller must opt in to real writes, the
    same default `run_reconciliation` itself sets and the same discipline
    `scripts/entity_master_seed.py --dry-run` follows. A dry run calls
    `apply_event` not once.

    Idempotent in both senses that matter:
      * two overlapping requests do not start two runs — the second gets 409
        and the first is untouched;
      * a completed run re-applied changes nothing. Every write goes through
        `apply_event`, whose `dedup_key` (`reconcile:new_entity:<sym>:<date>`)
        makes a same-day repeat a no-op, and whose collision guard plus
        `run_reconciliation`'s own `resolve()`-then-skip keep a later repeat
        from creating a second entity for a symbol that already has one.

    Progress and the finished summary are read from `GET /status`'s
    `reconcile` object — this route deliberately returns no result, because a
    route that waited for one would be the request-path run it exists to avoid.
    """
    global _running
    started_at = _now_iso()
    with _RUN_LOCK:
        if _running is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "a reconciliation run is already in flight "
                    f"(started {_running.get('started_at')}, dry_run="
                    f"{_running.get('dry_run')}); read GET "
                    "/api/admin/entity-master/status for its state"
                ),
            )
        _running = {"started_at": started_at, "dry_run": bool(dry_run)}

    try:
        threading.Thread(
            target=_run_reconcile,
            args=(bool(dry_run), started_at),
            daemon=True,
            name="entity-master-reconcile",
        ).start()
    except Exception:
        # The slot was claimed above; if the thread never started, release it
        # or the surface is wedged at 409 until the pod restarts.
        with _RUN_LOCK:
            _running = None
        raise

    return {
        "started": True,
        "dry_run": bool(dry_run),
        "started_at": started_at,
        "status_url": "/api/admin/entity-master/status",
    }
