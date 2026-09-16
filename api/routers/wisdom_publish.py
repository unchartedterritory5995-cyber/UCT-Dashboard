"""Wisdom Loop review queue, reports and dashboard routes (stream S-F; docs/wisdom/CONTRACTS.md §6.6).

Every admin route, reads included, carries Depends(require_admin): /api/admin/wisdom
is not covered by AdminGuardMiddleware, so the dependency IS the gate.

⛔ RULING ON A QUEUE ITEM IS THE OWNER'S. W1 §0.3 makes owner judgment a veto, and
the admin role also covers team members, the synthetic smoke account and an outside
contractor. POST /queue/{item_id}/action therefore depends on core.owner.require_owner
(require_admin + the first ADMIN_EMAILS address) and a second admin gets 403.
Reading the queue stays admin-wide; GET /queue/{item_id} says whether the caller may act.

Long work (the report preview) runs on a daemon thread with a per-process overlap
guard, never on the request path. The machine router /api/internal/wisdom/publish
carries require_push_secret on every route.

When api.services.wisdom.publish.adapters.routes exists (stream S-F2), its router and
internal_router are included here under /adapters. Its absence is not an error.
"""
from __future__ import annotations

import hmac
import importlib
import logging
import os
import sqlite3
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin
from api.services.wisdom import registry
from api.services.wisdom.core import flags, heartbeat, store, timeutil
from api.services.wisdom.core.owner import is_owner, require_owner
from api.services.wisdom.publish import chain, report, review
from api.services.wisdom.publish.schema import module_available

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/wisdom/publish", tags=["wisdom"])
internal_router = APIRouter(prefix="/api/internal/wisdom/publish", tags=["wisdom"])

ADAPTER_ROUTES_MODULE = "api.services.wisdom.publish.adapters.routes"
ADAPTERS_PREFIX = "/adapters"


def require_push_secret(request: Request) -> None:
    """The machine credential — the PUSH_SECRET bearer (copied from api/routers/scan_live.py).

    ⛔ The failure direction is closed: an unset or blank PUSH_SECRET refuses everybody.
    ⚠️ compare_digest on UTF-8 BYTES, never ==, and never str: a non-ASCII header str
    makes compare_digest raise, which would answer 500 instead of 401."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(
            auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


class ReviewActionBody(BaseModel):
    action: str = Field(..., min_length=1, max_length=16)
    note: Optional[str] = Field(None, max_length=review.NOTE_MAX)


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"wisdom.db unavailable: {type(exc).__name__}: {exc}")


# ── queue ────────────────────────────────────────────────────────────────────

@router.get("/queue")
def queue_list(tab: Optional[str] = Query(None), status: str = Query("open"),
               limit: int = Query(50, ge=1, le=review.LIST_LIMIT_MAX), offset: int = Query(0, ge=0),
               _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            items = review.list_items(conn, tab=tab, status=status, limit=limit, offset=offset)
    except review.ReviewError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"items": items, "count": len(items), "tab": tab, "status": status, "limit": limit, "offset": offset}


@router.get("/queue/counts")
def queue_counts(_admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            return review.counts(conn)
    except sqlite3.Error as exc:
        raise _unavailable(exc)


@router.get("/queue/{item_id}")
def queue_item(item_id: str, user: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            item = review.get_item(conn, item_id)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    if item is None:
        raise HTTPException(status_code=404, detail="no such review item")
    item["can_act"] = bool(is_owner(user) and item["status"] == "open")
    return item


@router.post("/queue/{item_id}/action")
def queue_action(item_id: str, body: ReviewActionBody, owner: dict = Depends(require_owner)) -> dict:
    actor = str(owner.get("email") or owner.get("id") or "owner")
    try:
        with store.write() as conn:
            return review.act(conn, item_id, action=body.action, actor=actor, note=body.note,
                              actor_is_owner=True)
    except review.ReviewError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except sqlite3.Error as exc:
        raise _unavailable(exc)


# ── reports ──────────────────────────────────────────────────────────────────

_PREVIEW_LOCK = threading.Lock()
_PREVIEW: dict = {"running": False, "started_at": None, "finished_at": None, "report_id": None, "error": None}


@router.get("/reports")
def reports_list(kind: Optional[str] = Query(None, pattern="^(weekly|monthly_packet)$"),
                 limit: int = Query(20, ge=1, le=200), _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            rows = report.list_reports(conn, kind=kind, limit=limit)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    with _PREVIEW_LOCK:
        preview = dict(_PREVIEW)
    return {"reports": rows, "count": len(rows), "preview": preview}


@router.get("/reports/{report_id}")
def reports_get(report_id: str, _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            got = report.get_report(conn, report_id)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    if got is None:
        raise HTTPException(status_code=404, detail="no such report")
    return got


@router.post("/reports/preview")
def reports_preview(_admin: dict = Depends(require_admin)) -> dict:
    with _PREVIEW_LOCK:
        if _PREVIEW["running"]:
            raise HTTPException(status_code=409, detail="a report preview is already being built")
        _PREVIEW.update(running=True, started_at=timeutil.iso_et(timeutil.now_et()), finished_at=None,
                        report_id=None, error=None)

    def _build() -> None:
        report_id, error = None, None
        try:
            report_id = report.generate_preview()["report_id"]
        except Exception as exc:
            log.exception("[wisdom] report preview failed")
            error = f"{type(exc).__name__}: {exc}"
        finally:
            with _PREVIEW_LOCK:
                _PREVIEW.update(running=False, finished_at=timeutil.iso_et(timeutil.now_et()),
                                report_id=report_id, error=error)

    threading.Thread(target=_build, name="wisdom-report-preview", daemon=True).start()
    return {"started": True}


# ── dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
def dashboard(_admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            numbers = report.dashboard(conn)
            beats = {row["job_id"]: row for row in heartbeat.job_health(conn)}
            chains = chain.last_runs(conn)
            counts = review.counts(conn)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    jobs = [{"job_id": spec.job_id, "trigger": spec.trigger, "enabled": bool(spec.enabled()),
             "trading_days_only": spec.trading_days_only, "expected_every_s": spec.expected_every_s,
             "catch_up_grace_s": spec.catch_up_grace_s, "heartbeat": beats.get(spec.job_id)}
            for spec in registry.job_specs()]
    return {
        **numbers,
        "master_switch_on": flags.ingest_enabled(),
        "jobs": jobs,
        "flags": [{"env": env, "on": reader(), "member_visible": visible} for env, reader, visible in flags.GATES],
        "chains": chains,
        "chain_catalogue": chain.catalogue(),
        "queue_counts": counts,
        "adapter_routes": ADAPTER_ROUTES,
    }


# ── machine routes ───────────────────────────────────────────────────────────

@internal_router.get("/golden-candidates")
def golden_candidates(unpromoted_only: bool = Query(True), limit: int = Query(500, ge=1, le=5000),
                      _: None = Depends(require_push_secret)) -> dict:
    """For the PC-side golden harness (stream S-D): review rulings that grow the golden set."""
    try:
        with store.read(for_request=True) as conn:
            rows = review.golden_candidates(conn, unpromoted_only=unpromoted_only, limit=limit)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"candidates": rows, "count": len(rows)}


# ── the adapters' routes (stream S-F2), when built ──────────────────────────

def _include_adapter_routes() -> dict:
    if not module_available(ADAPTER_ROUTES_MODULE):
        return {"included": False, "reason": f"{ADAPTER_ROUTES_MODULE} not built yet"}
    try:
        mod = importlib.import_module(ADAPTER_ROUTES_MODULE)
    except Exception as exc:
        log.exception("[wisdom] %s failed to import; adapter routes not mounted", ADAPTER_ROUTES_MODULE)
        return {"included": False, "reason": f"{ADAPTER_ROUTES_MODULE} failed to import: {type(exc).__name__}"}
    included = []
    for attr, parent in (("router", router), ("internal_router", internal_router)):
        sub = getattr(mod, attr, None)
        if sub is None:
            continue
        # tolerate a sub-router that already carries the /adapters prefix itself
        prefix = "" if str(getattr(sub, "prefix", "")).startswith(ADAPTERS_PREFIX) else ADAPTERS_PREFIX
        parent.include_router(sub, prefix=prefix)
        included.append(attr)
    return {"included": bool(included), "routers": included}


ADAPTER_ROUTES = _include_adapter_routes()
