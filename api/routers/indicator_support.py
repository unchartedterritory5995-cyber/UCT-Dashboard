"""The indicator SUPPORT LOOP, Phase A — HTTP doors (``/api/indicator-support``).

Spec: ``docs/pine/support-loop/PHASE-A.md``. Everything this router stores goes
through ``api/services/indicator_support.py``, which owns every check; this file
only maps who may call what.

  GET    /config                 member  — is report storage on? (the flag)
  POST   /gaps                   member  — A2: allowlisted built-in names + kind
  GET    /gaps                   ADMIN   — Phase B's ranking (distinct members)
  POST   /reports                member  — A3: the opt-in report (flag + consent)
  GET    /reports/mine           member  — their own reports and status
  GET    /reports/mine/{id}      member  — one of their OWN reports (404 otherwise)
  DELETE /reports/mine/{id}      member  — withdraw = delete their OWN report
  GET    /reports                ADMIN   — list (no source)
  GET    /reports/{id}           ADMIN   — one report, with source
  PATCH  /reports/{id}           ADMIN   — status new/triaged/fixed/wontfix

⛔ A member asking for, or withdrawing, a report that is not theirs gets the SAME
404 as one that does not exist, so the door is not an oracle for other ids.
⛔ AUTHENTICATED throughout (``get_current_user``), like ``indicator_telemetry``.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import indicator_support as svc

router = APIRouter(prefix="/api/indicator-support", tags=["indicator-support"])


class GapItem(BaseModel):
    name: str = Field(..., max_length=80)
    kind: str = Field(..., max_length=20)


class GapsBody(BaseModel):
    dialect: str = Field("pine", max_length=16)
    gaps: list[GapItem] = Field(default_factory=list, max_length=svc.MAX_GAPS)
    unlisted: int = Field(0, ge=0, le=10_000)


class ReportBody(BaseModel):
    # ⛔ `Any`, not `bool`: pydantic would coerce "yes"/1 to True. The SERVICE asks
    # `consent is True`, and that is the check that must see the raw value.
    consent: Any = None
    # The character cap is the outer bound; the service enforces the BYTE cap.
    source: Optional[str] = Field(None, max_length=svc.MAX_SOURCE_BYTES)
    note: Optional[str] = Field(None, max_length=svc.MAX_NOTE_CHARS)
    tradingview_link: Optional[str] = Field(None, max_length=svc.MAX_LINK_CHARS)
    symbol: Optional[str] = Field(None, max_length=32)
    timeframe: Optional[str] = Field(None, max_length=16)
    gaps: list[GapItem] = Field(default_factory=list, max_length=svc.MAX_GAPS)


class StatusBody(BaseModel):
    status: str = Field(..., max_length=16)


@router.get("/config")
def config(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "reports_enabled": svc.reports_enabled(),
        "max_source_bytes": svc.MAX_SOURCE_BYTES,
        "max_note_chars": svc.MAX_NOTE_CHARS,
    }


@router.post("/gaps")
def post_gaps(body: GapsBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if body.dialect != "pine":
        return {"ok": True, "recorded": 0}
    n = svc.record_gaps(user["id"], [g.model_dump() for g in body.gaps], body.unlisted)
    return {"ok": True, "recorded": n}


@router.get("/gaps")
def get_gaps(days: int = 30, limit: int = 200, user: dict = Depends(require_admin)) -> dict[str, Any]:
    return {"window_days": max(1, min(int(days or 30), 365)), "gaps": svc.gap_ranking(days, limit)}


@router.post("/reports")
def post_report(body: ReportBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return svc.create_report(
            user["id"], consent=body.consent, source=body.source, note=body.note,
            tradingview_link=body.tradingview_link, symbol=body.symbol,
            timeframe=body.timeframe, gaps=[g.model_dump() for g in body.gaps],
        )
    except svc.ReportRefused as e:
        raise HTTPException(status_code=e.status, detail={"code": e.code, "message": e.message})


@router.get("/reports/mine")
def my_reports(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {"reports": svc.list_mine(user["id"])}


@router.get("/reports/mine/{report_id}")
def my_report(report_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    r = svc.get_mine(user["id"], report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.delete("/reports/mine/{report_id}")
def withdraw_report(report_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if not svc.withdraw(user["id"], report_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.get("/reports")
def admin_reports(status: Optional[str] = None, limit: int = 200,
                  user: dict = Depends(require_admin)) -> dict[str, Any]:
    return {"reports": svc.admin_list_reports(status, limit)}


@router.get("/reports/{report_id}")
def admin_report(report_id: str, user: dict = Depends(require_admin)) -> dict[str, Any]:
    r = svc.admin_get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.patch("/reports/{report_id}")
def admin_status(report_id: str, body: StatusBody, user: dict = Depends(require_admin)) -> dict[str, Any]:
    if body.status not in svc.STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    if not svc.admin_set_status(report_id, body.status):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "status": body.status}
