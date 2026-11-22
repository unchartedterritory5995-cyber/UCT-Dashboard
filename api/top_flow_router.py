"""
top_flow_router.py — API routes for Top Flow performance tracker.

POST /api/top-flow/save     — saves picks. ADMIN (since 2026-11-17; see save_picks).
GET  /api/top-flow/history  — returns all active + archived picks with daily history (READ snapshots here)
POST /api/top-flow/snapshot — WRITE-only: manual trigger to record a new price snapshot for active picks.
                              Returns 202-style {"status": "started"} immediately and runs in a background task.
                              One sweep at a time: while one runs, the answer is {"status": "already_running"}.
                              There is intentionally no GET handler — anonymous GETs fall through to the SPA
                              and return the index.html shell. To read the most recent snapshot, use /history.
POST /api/top-flow/purge-old/{keep_days} — ARCHIVES active picks older than keep_days. ADMIN.

🔴 `purge-old` WAS A GET, AND THAT IS THE WHOLE POINT OF THIS COMMENT.

A GET is fetched by things that never decided to fetch it: search crawlers,
Slack/Discord link-unfurl bots, browser prefetch, security scanners, a URL pasted
into a chat window. `keep_days` is caller-supplied and taken straight from the
path, so `GET /api/top-flow/purge-old/0` archived EVERY active pick — and it was
reachable by anybody, with no credential of any kind (auth/paywall sweep,
2026-08-09). One unfurl of that URL was a data-loss event nobody requested.

Two things changed together, and BOTH are load-bearing:
  * the VERB — a side-effecting operation must not answer a safe method, so no
    prefetcher can fire it by looking at a link;
  * the GATE — `require_flow_admin`, the same door `/wipe` and `/archive-now`
    already use. The verb alone is not a gate (a form post, a CSRF-shaped
    request and an ops curl are all POSTs); the gate alone would still leave a
    destructive operation behind a method the whole web treats as safe.

⚠️ It has no frontend caller — swept 2026-08-09 across `app/src` and both
OptionsFlow copies; the only reference in the repo was the roadmap doc listing
it. So this is not a breaking change for any member: it is closing a door that
only crawlers were walking through.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, Path
from api.flow_admin_auth import require_flow_admin, require_flow_user
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/top-flow", tags=["top-flow"])

# The manual sweep in flight, if any. Held so a second request can see it (and so
# the task is not garbage-collected mid-run). Per process: web is one process.
_snapshot_task: "asyncio.Task | None" = None


class Pick(BaseModel):
    sym: str
    cp: str
    strike: float
    exp: str
    entry: float = 0
    grade: str = ""
    dir: str = ""
    cap: str = ""
    hits: int = 0
    prem: float = 0
    dateSaved: str = ""


@router.post("/save")
def save_picks(picks: list[Pick], _auth: dict = Depends(require_flow_admin)):
    """Add picks to the tracked record. Admin session or service token.

    Gate changed 2026-11-17 from any signed-in session to `require_flow_admin`,
    the door the other write routes here use. The record is what the Flow Record
    scores, so who can add to it matters. Callers, traced the same day: the one
    call in the app is `wlPushDiscord` in OptionsFlow.jsx, which posts here only
    after POST /api/discord/push (itself `require_flow_admin`) answers ok, and
    which no control on the page has called since its two buttons were retired
    on 2026-08-04. No script, test or Discord code in this repo calls it.
    """
    from api.top_flow_tracker import save_picks as _save
    result = _save([p.model_dump() for p in picks])
    return result


@router.get("/history")
def get_history(_auth: dict = Depends(require_flow_user)):
    """Every active + archived Top Flow pick with its daily price history.

    Gated 2026-08-09. This is the firm's own tracked-pick performance record —
    which contracts were called, at what entry, and how they did — and its only
    consumer is `OptionsFlow.jsx`, a page `AuthGuard` serves to paid/admin only
    (`FREE_PAGES = ['/morning-wire']`). `require_flow_user` is the same door
    `/snapshot` uses, so a logged-in member's browser is
    unaffected while an anonymous caller no longer gets the record for free.
    """
    from api.top_flow_tracker import get_all
    return get_all()


@router.post("/snapshot")
async def trigger_snapshot(_auth: dict = Depends(require_flow_user)):
    """Trigger a new price snapshot for all active top-flow picks.

    POST-only by design — this is a write/side-effect endpoint that records a
    point-in-time price observation. To READ the latest snapshot or full
    history, GET /api/top-flow/history instead.

    A GET against /api/top-flow/snapshot will fall through to the React SPA
    catch-all and return index.html (this is expected, not a bug).

    One sweep at a time (2026-11-17). The in-app caller is the Tracker tab's
    "Fetch Live Prices" button, which every signed-in member has, so the gate
    stays `require_flow_user`; repeated clicks used to start one vendor sweep
    each. Now a request made while a sweep is running (this route's, or the
    4:30 PM scheduler's) is answered at once and starts nothing.
    """
    global _snapshot_task
    from api import top_flow_tracker as tracker

    if (_snapshot_task is not None and not _snapshot_task.done()) or tracker.snapshot_in_flight():
        return {"status": "already_running", "message": "A snapshot is already running. Nothing new was started."}

    async def _run():
        try:
            result = await tracker.snapshot_prices()
            logger.info("[top-flow-router] Background snapshot done: %s", result)
        except Exception as e:
            logger.error("[top-flow-router] Background snapshot error: %s", e)

    _snapshot_task = asyncio.create_task(_run())
    return {"status": "started", "message": "Snapshot running in background. Check Railway logs for results."}


@router.post("/migrate-entries")
async def migrate_entries(
    dry_run: bool = True,
    max_picks: int | None = None,
    force: bool = False,
    allow_backfill: bool = True,
    threshold: float = 50.0,
    _auth: dict = Depends(require_flow_admin),
):
    """One-shot bug-fix migration. Replaces stock-price `entry` values with
    the contract's actual price near dateSaved.

    Params:
        dry_run (default True): preview only, no writes. Set to false to commit.
        max_picks: cap how many picks to process this call (None = all).
        force: ignore the 'looks like stock price' heuristic.
        allow_backfill: fall back to Polygon backfill for picks without local
            snapshot history near dateSaved. Slower (rate-limited) but more
            thorough.
        threshold: entries above this $ value treated as suspect (default 50).

    Workflow (recommended):
        1. POST /api/top-flow/migrate-entries?dry_run=true&max_picks=10
           → review the 'changes' array to sanity-check
        2. POST /api/top-flow/migrate-entries?dry_run=false&max_picks=50
           → small commit to validate end-to-end
        3. POST /api/top-flow/migrate-entries?dry_run=false
           → commit the rest

    Idempotent: re-running on already-corrected picks skips them (their
    entry is now < threshold). Old buggy entry preserved as `entrySpot`
    so the migration can be reviewed or undone if needed.
    """
    from api.top_flow_tracker import migrate_entries as _migrate
    return await _migrate(
        dry_run=dry_run,
        max_picks=max_picks,
        force=force,
        allow_backfill=allow_backfill,
        threshold=threshold,
    )


@router.post("/archive-now")
def trigger_archive(_auth: dict = Depends(require_flow_admin)):
    """Debug endpoint — just archive expired picks, no vendor calls."""
    from api.top_flow_tracker import archive_expired, get_all
    count = archive_expired()
    data = get_all()
    return {"archived_now": count, "active": len(data["active"]), "archived_total": len(data["archived"])}


@router.post("/wipe")
def wipe_all(_auth: dict = Depends(require_flow_admin)):
    """Wipe ALL picks (active + archived). Use carefully — irreversible.
    Intended for one-time clean-slate before switching tracker data sources."""
    from api.top_flow_tracker import _data, _save
    n_active = len(_data.get("active", []))
    n_archived = len(_data.get("archived", []))
    _data["active"] = []
    _data["archived"] = []
    _save()
    return {"wiped_active": n_active, "wiped_archived": n_archived}


@router.post("/purge-old/{keep_days}")
def purge_old(keep_days: int = Path(ge=0, le=3650),
              _auth: dict = Depends(require_flow_admin)):
    """Archive active picks older than keep_days by dateSaved.

    ⛔ POST + admin, never GET — see the module docstring. `keep_days` is also
    BOUNDED now (`ge=0, le=3650`): the handler builds a cutoff with
    `date.today() - timedelta(days=keep_days)`, and an unbounded caller-supplied
    value raised `OverflowError`/`OverflowError: date value out of range` off the
    request path rather than answering honestly.
    """
    from api.top_flow_tracker import _data, _save
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=keep_days)).isoformat()
    still_active = []
    purged = 0
    for p in _data.get("active", []):
        if p.get("dateSaved", "9999") < cutoff:
            p["archivedDate"] = date.today().isoformat()
            p["purgeReason"] = f"older than {keep_days}d"
            entry = p.get("entry", 0)
            hist = p.get("history", [])
            final = hist[-1]["price"] if hist else 0
            p["finalPrice"] = final
            p["finalPnl"] = round((final - entry) / entry * 100, 1) if entry > 0 and final > 0 else 0
            _data["archived"].append(p)
            purged += 1
        else:
            still_active.append(p)
    _data["active"] = still_active
    if purged:
        _save()
    return {"purged": purged, "active": len(still_active), "archived_total": len(_data["archived"])}
