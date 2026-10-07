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
  PUT    /api/j2/onboarding/tours/{tour_id}   {state, step} -> {value} -- ONE tour's seen-state
         row, merged into `notebook_tours` on the server (wave 14, lane W14-C2): two tabs
         recording different tours at once can no longer erase each other's row.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.journal_two import sample_notebook, tour_seen_state
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


# ── per-tour seen state (wave 14, lane W14-C2) ───────────────────────────────

class TourRow(BaseModel):
    state: str
    step: Optional[str] = None


# ⛔ FIN (2026-10-06, security review I-5): the body is NOT a declared parameter.
# FastAPI reads a declared body before it solves any dependency, so with the flag
# off this door answered 422 to malformed JSON (every other request: 404) and
# buffered an anonymous body of any size. `_json` reads it capped, after the
# router's gate and after the session. Rail: tests/test_notebook_body_census.py.
# The body is one state word and one step id.
MAX_BODY_BYTES = 8 * 1024
TOO_LARGE_SENTENCE = "Request too large"


def _json(annotation, *, after=get_current_user):
    return body_cap.capped_json(annotation, lambda: MAX_BODY_BYTES, lambda: TOO_LARGE_SENTENCE, after=after)


@router.put("/tours/{tour_id}")
async def record_tour_state(tour_id: str, body: TourRow = Depends(_json(TourRow)), user: dict = Depends(get_current_user)):
    """Upsert ONE tour's `{v, state, step}` row inside `notebook_tours`, atomically, and
    answer the whole merged map as the stored TEXT value (`value`), so the client puts the
    server's answer -- other tabs' rows included -- straight into its preferences cache.

    Authenticated (any member: a tour is not a paid capability; its OWN flag gates whether
    the tour shows). Validated: the id and step formats (`tour_seen_state.ID_RE`), the state
    enum. Size-capped: `MAX_TOURS` rows, 413 past it. Behind the onboarding gate like every
    route here, so a dark gate answers 404 -- which the client reads as "no merge door" and
    falls back to the whole-value preference write it used before this route existed."""
    if not tour_seen_state.valid_id(tour_id):
        raise HTTPException(status_code=400, detail="Invalid tour id.")
    if body.state not in tour_seen_state.STATES:
        raise HTTPException(status_code=400, detail="Invalid tour state.")
    if body.step is not None and not tour_seen_state.valid_id(body.step):
        raise HTTPException(status_code=400, detail="Invalid tour step.")
    try:
        merged = await run_in_threadpool(tour_seen_state.record, user["id"], tour_id, body.state, body.step)
    except tour_seen_state.TooManyTours:
        raise HTTPException(status_code=413, detail="Too many tours recorded.")
    return {"value": json.dumps(merged, separators=(",", ":"))}
