"""S7 first slice -- the minimum API surface to prove document-arrival
end-to-end (owner authorization, 2026-09-03). No alert-creation UI is built
this pass (explicitly out of scope); these endpoints ARE the creation/
management surface for now, exercised directly.

Registration is per authenticated member (`get_current_user`) -- a
document-arrival predicate is always private, never broadcast (matches
`alert_fires.user_id` never being NULL for this trigger type).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.alert_taxonomy import document_arrival as _doc_arrival
from api.services.alert_taxonomy import predicates as _predicates
from api.services.alert_taxonomy import receipts as _receipts
from api.services.alert_taxonomy.predicates import PredicateRegistrationError

_log = logging.getLogger(__name__)
router = APIRouter()


class DocumentArrivalCreate(BaseModel):
    ticker: str
    form_type: str | None = None
    keyword: str | None = None


@router.post("/api/alerts/taxonomy/document-arrival")
def create_document_arrival_alert(body: DocumentArrivalCreate, user: dict = Depends(get_current_user)):
    try:
        predicate_id = _doc_arrival.register_predicate_for_user(
            user["id"], body.ticker, form_type=body.form_type, keyword=body.keyword,
        )
    except PredicateRegistrationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"predicate_id": predicate_id}


@router.get("/api/alerts/taxonomy/document-arrival")
def list_document_arrival_alerts(active_only: bool = True, user: dict = Depends(get_current_user)):
    """`active_only=True` (default, unchanged) is the pre-existing "is this
    currently watched" answer used everywhere. `active_only=false` additionally
    surfaces the caller's own SUSPENDED predicates -- Stage 4/5 UI need this to
    render SUSPENDED state and offer reactivation; without it a suspended
    predicate would vanish from every surface with no way back to it."""
    return {
        "predicates": _predicates.list_predicates(
            type_id=_doc_arrival.TYPE_ID, user_id=user["id"], active_only=active_only,
        ),
    }


@router.delete("/api/alerts/taxonomy/document-arrival/{predicate_id}")
def suspend_document_arrival_alert(predicate_id: str, user: dict = Depends(get_current_user)):
    ok = _predicates.suspend_predicate(predicate_id, user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="predicate not found, not yours, or already suspended")
    return {"suspended": True}


@router.get("/api/alerts/taxonomy/fires")
def list_my_fires(limit: int = Query(50, ge=1, le=200), user: dict = Depends(get_current_user)):
    return {"fires": _receipts.list_fires(user["id"], limit=limit)}


@router.post("/api/admin/alerts/taxonomy/run-document-arrival-sweep")
def run_sweep_now(_admin: dict = Depends(require_admin)):
    """Manual trigger for validation -- the real cycle runs on the flagged
    20-minute scheduler job; this exists so a dry-run/live-validation pass
    does not have to wait for it."""
    return _doc_arrival.run_document_arrival_sweep()
