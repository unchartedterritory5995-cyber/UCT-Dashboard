"""Wave 11 lane 11C — "Ask Notebook to do something": the doors.

  POST /api/j2/ai-actions/plan               {request}            -> the change set (PLANNED; nothing written)
  GET  /api/j2/ai-actions?noteId=            -> the member's change sets (with noteId: those that changed it)
  GET  /api/j2/ai-actions/{set_id}           -> one change set: request, plan, every change and its status
  POST /api/j2/ai-actions/{set_id}/apply     {changeIds, declinedIds?} -> per-change results + revisions
  POST /api/j2/ai-actions/{set_id}/undo      -> per-change results + revisions

The service, and every rule about the plan, its validation, apply and undo, is
`api/services/journal_two/ai_actions.py`; this file is the door.

⛔ DARK: `NOTEBOOK_AI_ACTIONS_ENABLED` unset means every route here answers 404
with FastAPI's own unknown-route body, BEFORE any credential is read --
router-level, writing help's shape. Read per request.

⛔ PLAN IS THE ONLY MODEL CALL, and it is charged the way writing help is: the
member's own daily count (`note_ask.reserve_ai_actions`), the shared dollar cap,
the population cap, one concurrent slot -- a failed plan is refunded and says
so. Apply and undo call no model.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, is_paid_user,
)
from api.services import note_ask
from api.services.journal_two import ai_actions as ai
from api.services.journal_two import notes as notes_service

logger = logging.getLogger(__name__)

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body
_MAX_BODY_BYTES = 256 * 1024
_MAX_IDS = ai.MAX_CHANGES


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate
    reads no credential and looks like no route at all."""
    if not ai.enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2/ai-actions",
    tags=["journal-2-0", "ai-actions"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py) -- a model call on the firm's key."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Notebook AI changes require a paid plan")
    return user


async def _read_json(request: Request) -> dict[str, Any]:
    """The JSON body, read INSIDE the dependency chain (writing help's M-1): the
    gate runs first, then the member, then the body; a bad body is a sentence."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > _MAX_BODY_BYTES:
            raise HTTPException(status_code=422, detail=ai.BAD_BODY_SENTENCE)
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=ai.BAD_BODY_SENTENCE) from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail=ai.BAD_BODY_SENTENCE)
    return body


async def _paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    return await _read_json(request)


async def _member_body(request: Request, _user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return await _read_json(request)


async def _population_gate(user_id, cost, day) -> None:
    """TERM-078: the population-wide daily cap, AFTER the member's own
    reservation; on a refusal the plan's reservation is given back."""
    from api.services import ai_population_cap
    refusal = await run_in_threadpool(ai_population_cap.admit, "notebook_ai_actions")
    if refusal:
        await run_in_threadpool(note_ask.refund_ai_actions, user_id, cost=cost, day=day)
        raise HTTPException(status_code=429, detail=refusal)


def _ids(raw: Any) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > _MAX_IDS or not all(isinstance(i, str) and i for i in raw):
        raise HTTPException(status_code=422, detail=ai.BAD_BODY_SENTENCE)
    return list(dict.fromkeys(raw))


@router.post("/plan")
async def plan_endpoint(payload: dict[str, Any] = Depends(_paid_body),
                        user: dict = Depends(require_paid)):
    user_id = user["id"]
    try:
        request_text = ai.parse_request(payload)
    except ai.AiActionsRequestError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Read-only: the candidate notes, folders, properties and tags. Off the loop.
    context = await run_in_threadpool(ai.build_context, user_id, request_text)
    model = ai.model_name()
    cost = ai.estimate_cost(context, model=model)
    day = note_ask.charge_day()
    if not await run_in_threadpool(note_ask.reserve_ai_actions, user_id, cost=cost, day=day):
        shared = await run_in_threadpool(note_ask.shared_cap_reached, cost=cost)
        raise HTTPException(status_code=429, detail=ai.SHARED_CAP_SENTENCE if shared else ai.BUDGET_SENTENCE)
    await _population_gate(user_id, cost, day)
    if not note_ask.begin_stream(user_id):
        await run_in_threadpool(note_ask.refund_ai_actions, user_id, cost=cost, day=day)
        raise HTTPException(status_code=429, detail=ai.BUSY_SENTENCE)

    plan: dict[str, Any] | None = None
    set_id = None
    try:
        # ⛔ Read at CALL time (`ai.complete`), so a test's stub reaches it.
        raw = await ai.complete(ai.request_kwargs(context, model=model), context)
        plan = await run_in_threadpool(ai.validate_plan, user_id, raw, context)
        set_id = await run_in_threadpool(ai.store_plan, user_id, request_text, plan, model=model)
    except Exception:
        # ⛔ NO REQUEST, NOTE TEXT OR MODEL OUTPUT IN THE LOG.
        logger.exception("[ai-actions] plan failed")
    finally:
        note_ask.end_stream(user_id)
        note_ask.run_in_background(
            notes_service._log_notebook_event, user_id, "notebook_ai_actions_planned",
            ai.telemetry(candidates_n=len(context["notes"]),
                         changes_n=len(plan["changes"]) if plan else 0,
                         skipped_n=plan["skippedCount"] if plan else 0, settled=set_id is not None))
    if set_id is None:
        await run_in_threadpool(note_ask.refund_ai_actions, user_id, cost=cost, day=day)
        raise HTTPException(status_code=502, detail=ai.FAILED_SENTENCE)
    return await run_in_threadpool(ai.get_change_set, user_id, set_id)


@router.get("")
async def list_endpoint(noteId: str | None = None, user: dict = Depends(get_current_user)):
    sets = await run_in_threadpool(ai.list_change_sets, user["id"], note_id=noteId or None)
    return {"changeSets": sets}


@router.get("/{set_id}")
async def get_endpoint(set_id: str, user: dict = Depends(get_current_user)):
    s = await run_in_threadpool(ai.get_change_set, user["id"], set_id)
    if s is None:
        raise HTTPException(status_code=404, detail=ai.NOT_FOUND_SENTENCE)
    return s


@router.post("/{set_id}/apply")
async def apply_endpoint(set_id: str, payload: dict[str, Any] = Depends(_member_body),
                         user: dict = Depends(get_current_user)):
    change_ids = _ids(payload.get("changeIds"))
    declined = _ids(payload.get("declinedIds"))
    try:
        out = await run_in_threadpool(ai.apply_changes, user["id"], set_id, change_ids, declined)
    except ai.AiActionsRequestError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if out is None:
        raise HTTPException(status_code=404, detail=ai.NOT_FOUND_SENTENCE)
    note_ask.run_in_background(
        notes_service._log_notebook_event, user["id"], "notebook_ai_actions_applied",
        {"applied": sum(1 for r in out["results"] if r["status"] == "applied"),
         "failed": sum(1 for r in out["results"] if r["status"] != "applied")})
    return out


@router.post("/{set_id}/undo")
async def undo_endpoint(set_id: str, _payload: dict[str, Any] = Depends(_member_body),
                        user: dict = Depends(get_current_user)):
    out = await run_in_threadpool(ai.undo_change_set, user["id"], set_id)
    if out is None:
        raise HTTPException(status_code=404, detail=ai.NOT_FOUND_SENTENCE)
    return out
