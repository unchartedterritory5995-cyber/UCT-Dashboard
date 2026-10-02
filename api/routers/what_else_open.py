"""TERM-093 — the "what else was open, named" capture. See api/services/what_else_open.py.

Three routes, all ADMIN-ONLY (the subject is the owner-desk) and all DARK behind
WHAT_ELSE_OPEN_CAPTURE_ENABLED: unset, every route is the FastAPI 404 to every
caller including admins, and the table is never created.

⛔ No DELETE route, by construction (stopping the capture is unsetting the flag).
Sync `def` handlers: SQLite work runs in the threadpool, never on the event loop.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin
from api.services import what_else_open as weo

router = APIRouter()


class _OccasionIn(BaseModel):
    occasion_id: str = Field(..., max_length=64)
    occasion: str = Field(..., max_length=64)
    context: str | None = Field(None, max_length=12)


class _AnswerIn(BaseModel):
    tools: list[str] = Field(..., max_length=len(weo.TOOLS))
    other_text: str | None = Field(None, max_length=200)


def _gate() -> None:
    if not weo.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.post("/api/instruments/what-else-open/occasion")
def post_occasion(body: _OccasionIn, user: dict = Depends(require_admin)):
    _gate()
    try:
        created = weo.record_occasion(user["id"], body.occasion_id, body.occasion, body.context)
    except weo.CaptureError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "created": created, "tools": list(weo.TOOLS)}


@router.post("/api/instruments/what-else-open/occasion/{occasion_id}/answer")
def post_answer(occasion_id: str, body: _AnswerIn, user: dict = Depends(require_admin)):
    _gate()
    try:
        written = weo.record_answer(user["id"], occasion_id, body.tools, body.other_text)
    except weo.CaptureError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not written:
        # Not theirs, unknown, or ALREADY answered — an answer is never overwritten.
        raise HTTPException(status_code=409, detail="occasion not open for an answer")
    return {"ok": True}


@router.get("/api/admin/instruments/what-else-open")
def get_summary(user: dict = Depends(require_admin)):
    _gate()
    return weo.summary()
