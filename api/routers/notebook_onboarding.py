"""Notebook onboarding -- the sample notebook's routes (wave 8, lane 8C, C3; ruling D-C6).

Mounted by the controller at seam S8-2 (a stub with this prefix and no routes), so this
file adds routes without touching `api/main.py`.

  * DARK. The gate is `api.services.notebook_flags.flag_on(
    "NOTEBOOK_ONBOARDING_ENABLED", False)`, read per request, as a ROUTER dependency: an
    off gate runs before any route's own dependencies, reads no credential, writes
    nothing, and answers 404 exactly like an unknown route.
  * The sample is written only on an explicit click, refused with 409 for a member who
    has ANY note (active, archived or trashed), through `notes.import_confirm` -- the
    work is `api/services/journal_two/sample_notebook.py`.
  * Its prefix is outside `/api/j2/notes/...`, so mount order against `journal_two`
    does not matter (`tests/test_main_router_order.py`).

Routes:
  POST   /api/j2/onboarding/sample-notebook   paid; 200 {folderId, welcomeNoteId}, 409, 503
  GET    /api/j2/onboarding/sample-notebook   {ids, activeIds} -- what the Home strip reads
  DELETE /api/j2/onboarding/sample-notebook   {trashed: [...]} -- trashes the recorded ids
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.journal_two import sample_notebook
from api.services.notebook_flags import flag_on

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body


def onboarding_enabled() -> bool:
    return flag_on("NOTEBOOK_ONBOARDING_ENABLED", False)


def _require_enabled() -> None:
    if not onboarding_enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2/onboarding",
    tags=["journal-2-0", "notebook-onboarding"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The sample notebook is part of a paid plan.")
    return user


@router.post("/sample-notebook")
async def add_sample_notebook(user: dict = Depends(require_paid)):
    try:
        out = await run_in_threadpool(sample_notebook.seed, user["id"])
    except sample_notebook.SampleRefused:
        raise HTTPException(status_code=409, detail=sample_notebook.REFUSED_SENTENCE)
    except sample_notebook.SampleBusy:
        raise HTTPException(status_code=503, detail=sample_notebook.BUSY_SENTENCE)
    return {"folderId": out["folderId"], "welcomeNoteId": out["welcomeNoteId"]}


@router.get("/sample-notebook")
async def sample_notebook_status(user: dict = Depends(get_current_user)):
    uid = user["id"]
    ids = await run_in_threadpool(sample_notebook.recorded_ids, uid)
    active = await run_in_threadpool(sample_notebook.active_ids, uid) if ids else []
    return {"ids": ids, "activeIds": active}


@router.delete("/sample-notebook")
async def remove_sample_notebook(user: dict = Depends(get_current_user)):
    return await run_in_threadpool(sample_notebook.remove, user["id"])
