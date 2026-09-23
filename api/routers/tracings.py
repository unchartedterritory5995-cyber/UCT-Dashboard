"""S5 CP3 (GATE-S5-PERSISTENCE-USER-STATE, fingerprint 41ffcc91c) — Tracings'
dedicated store, mounted at `/api/tracings`.

⛔ DARK AT CP3. Mounted, tested, and reachable over HTTP — but nothing in the
product calls it yet (`useTracingsSync.js` still reads
`POST /api/auth/preferences`). CP4 is the checkpoint that wires a live
consumer, behind its own compiled constant, defaulting OFF.
`tests/test_tracings_store.py` carries the inertness rail asserting no
frontend path reaches `/api/tracings` yet.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import tracings_store

router = APIRouter(prefix="/api/tracings", tags=["tracings"])


class SetTracingsRequest(BaseModel):
    doc: str
    expectedRevision: Optional[int] = None


@router.get("")
def get_tracings_endpoint(user: dict = Depends(get_current_user)):
    result = tracings_store.get_tracings(user["id"])
    if result is None:
        return {"doc": None, "revision": None, "updatedAt": None}
    return result


@router.put("")
def set_tracings_endpoint(req: SetTracingsRequest, user: dict = Depends(get_current_user)):
    try:
        return tracings_store.set_tracings(user["id"], req.doc, req.expectedRevision)
    except tracings_store.TracingsConflictError:
        raise HTTPException(status_code=409, detail="tracings document changed since your baseline")
