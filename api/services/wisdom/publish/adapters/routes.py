"""Routes for the dark publish adapters (stream S-F; CONTRACTS §0 #14–15, §2.1, §6.6).

MOUNTING — these routers carry RELATIVE prefixes and are mounted by stream S-F1's
`api/routers/wisdom_publish.py` (the registry mounts only that module's `router` and
`internal_router`). The exact lines S-F1 needs:

    from api.services.wisdom.publish.adapters import routes as adapter_routes
    router.include_router(adapter_routes.router)            # /api/admin/wisdom/publish/adapters/*
    internal_router = APIRouter(prefix="/api/internal/wisdom/publish", tags=["wisdom"])
    internal_router.include_router(adapter_routes.internal_router)   # /api/internal/wisdom/publish/adapters/*

GATES
- Every admin route, reads included, `Depends(require_admin)`: /api/admin/wisdom is not
  covered by AdminGuardMiddleware. Deciding a draft is the owner's: `require_owner` (the
  first ADMIN_EMAILS address; a second admin gets 403). The boot auth-surface audit sees
  both through the dependency tree.
- Machine routes carry one `Depends` named exactly `require_push_secret` (copied from
  api/routers/scan_live.py), so the route census classes them `worker`; they live under
  /api/internal, outside the boot audit's prefixes by design.
Everything here is a short read or a single small write; no long work on the request path.
"""
from __future__ import annotations

import hmac
import os
import sqlite3
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.middleware.auth_middleware import require_admin
from api.services.wisdom.core.owner import require_owner

router = APIRouter(prefix="/adapters", tags=["wisdom"])
internal_router = APIRouter(prefix="/adapters", tags=["wisdom"])


def require_push_secret(request: Request) -> None:
    """The worker credential — the PUSH_SECRET bearer (copied from api/routers/scan_live.py).

    Blank or unset PUSH_SECRET refuses everybody; compare_digest over UTF-8 BYTES, so a
    non-ASCII header answers 401, never 500."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"wisdom.db unavailable: {type(exc).__name__}")


# ── admin ────────────────────────────────────────────────────────────────────

@router.get("/status")
def adapters_status(_admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom.core import flags, store, timeutil
    from api.services.wisdom.publish.adapters import common

    since = timeutil.iso_et(timeutil.now_et() - timedelta(days=7))
    try:
        with store.read(for_request=True) as conn:
            def rows(sql, params=()):
                return [dict(r) for r in conn.execute(sql, params)]

            drafts = (rows("SELECT kind, status, COUNT(*) AS n FROM wisdom_drafts GROUP BY kind, status ORDER BY kind")
                      if common.table_exists(conn, "wisdom_drafts") else [])
            kb = (rows("SELECT kind, state, COUNT(*) AS n FROM wisdom_kb_rows GROUP BY kind, state ORDER BY kind")
                  if common.table_exists(conn, "wisdom_kb_rows") else [])
            log = rows("SELECT consumer, action, flag_state, COUNT(*) AS n FROM wisdom_publish_log WHERE at >= ? "
                       "GROUP BY consumer, action, flag_state ORDER BY consumer", (since,))
            docs = (conn.execute("SELECT COUNT(*) FROM wisdom_retrieval_docs").fetchone()[0]
                    if common.table_exists(conn, "wisdom_retrieval_docs") else None)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"flags": [{"env": env, "on": reader(), "member_visible": visible} for env, reader, visible in flags.GATES],
            "drafts": drafts, "kb_rows": kb, "publish_log_7d": log, "retrieval_docs": docs}


@router.get("/badges")
def adapters_badges(tickers: str = Query(..., min_length=1, max_length=2000), preview: bool = Query(False),
                    _admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom.publish.adapters import badges

    try:
        return badges.badges_for(badges.parse_tickers(tickers), preview=preview)
    except sqlite3.Error as exc:
        raise _unavailable(exc)


@router.get("/drafts")
def adapters_drafts(kind: Optional[str] = Query(None, max_length=40), status: Optional[str] = Query(None, max_length=20),
                    limit: int = Query(100, ge=1, le=500), _admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom.publish.adapters import drafts

    try:
        rows = drafts.list_drafts(kind=kind, status=status, limit=limit)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"drafts": rows, "count": len(rows)}


def _decide(draft_id: str, decision: str, owner: dict, note: Optional[str] = None) -> dict:
    from api.services.wisdom.publish.adapters import drafts

    try:
        return drafts.decide(draft_id, decision=decision, actor=str(owner.get("email") or owner.get("id") or "owner"),
                             note=note)
    except drafts.DraftRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except LookupError:
        raise HTTPException(status_code=404, detail="unknown draft")
    except sqlite3.Error as exc:
        raise _unavailable(exc)


@router.post("/drafts/{draft_id}/approve")
def adapters_draft_approve(draft_id: str, owner: dict = Depends(require_owner)) -> dict:
    return _decide(draft_id, "approve", owner)


@router.post("/drafts/{draft_id}/reject")
def adapters_draft_reject(draft_id: str, note: Optional[str] = Query(None, max_length=500),
                          owner: dict = Depends(require_owner)) -> dict:
    return _decide(draft_id, "reject", owner, note)


@router.get("/d20")
def adapters_d20(_admin: dict = Depends(require_admin)) -> dict:
    """The D20 gate report. Read-only: neither scorer delivers anything in W1."""
    from api.services.wisdom.core import flags, store, timeutil
    from api.services.wisdom.publish import level_alerts, lookalike
    from api.services.wisdom.publish.adapters import d20_gates

    today = timeutil.session_for(timeutil.now_et())
    try:
        with store.read(for_request=True) as conn:
            levels = d20_gates.delivery_gate(conn, level_alerts.SCORER, flag_env=level_alerts.FLAG_ENV,
                                             flag_on=flags.level_alerts_enabled(), today=today)
        looks = lookalike.delivery_status(today)
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"level_alerts": levels, "lookalike": looks, "s7_dependency": d20_gates.S7_DEPENDENCY}


# ── machine ──────────────────────────────────────────────────────────────────

@internal_router.get("/kb-export")
def adapters_kb_export(_: None = Depends(require_push_secret)) -> dict:
    from api.services.wisdom.publish.adapters import brainkb

    try:
        return brainkb.export_payload()
    except sqlite3.Error as exc:
        raise _unavailable(exc)


@internal_router.get("/clip-candidates")
def adapters_clip_candidates(video_id: int = Query(..., ge=1), since: Optional[str] = Query(None, max_length=40),
                             _: None = Depends(require_push_secret)) -> dict:
    from api.services.wisdom.publish.adapters import clips

    try:
        return clips.clip_candidates(video_id, since)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise _unavailable(exc)


class ReviewItemsIn(BaseModel):
    items: list[dict]


@internal_router.post("/review-items")
def adapters_review_items(body: ReviewItemsIn, _: None = Depends(require_push_secret)) -> dict:
    from api.services.wisdom.publish.adapters import brainkb

    try:
        return brainkb.enqueue_review_items(body.items)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise _unavailable(exc)
