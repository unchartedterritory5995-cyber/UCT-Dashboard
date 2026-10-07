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
from api.services.alert_taxonomy import cooldowns as _cooldowns
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
        # TERM-062: the published re-arm rule rides the list every filing-watch
        # surface already polls -- no extra request to show it.
        "cooldown": _cooldowns.published_cooldown(_doc_arrival.TYPE_ID),
    }


@router.get("/api/alerts/taxonomy/cooldowns")
def published_alert_cooldowns(user: dict = Depends(get_current_user)):
    """TERM-062: every member-facing trigger type's re-arm rule, derived from the
    constants the alert code applies (alert_taxonomy/cooldowns.py). Policy only:
    it reads no member's predicates or fires."""
    return {"cooldowns": _cooldowns.published_cooldowns()}


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


@router.get("/api/admin/alert-taxonomy/dark-report/{alert_type}")
def alert_taxonomy_dark_report_one(alert_type: str, _admin: dict = Depends(require_admin)):
    """The real agreed/new_only/legacy_only/not_comparable counts for every
    predicate of ONE S7 alert type -- price-level, event-proximity,
    position-risk, scan-membership-change, catalyst-match, regime-change, or
    indicator-condition.

    ADMIN, not no-auth: `predicate_id` values can carry member-configured
    specifics (a ticker, a level), so this is not the pure-counter shape the
    codebase's genuinely-no-auth admin routes (`bars-stream-status`,
    `reconciliation-status`) hold themselves to (see `disk_status`'s own
    docstring on that exact line).

    This is the first HTTP-reachable way to read this data at all -- previously
    the only path was a hand-written SQL query over `railway ssh`, one type
    (price-level) at a time, via `tools/s7_price_level_report.py`.
    """
    from api.services.alert_taxonomy import dark_report as _dark_report
    try:
        return _dark_report.dark_report(alert_type)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/admin/alert-taxonomy/dark-report")
def alert_taxonomy_dark_report_all(_admin: dict = Depends(require_admin)):
    """Every S7 alert type's dark-comparison report in one call. See
    `alert_taxonomy_dark_report_one` for what each type's payload holds."""
    from api.services.alert_taxonomy import dark_report as _dark_report
    return _dark_report.dark_report_all()


# ── FT-034: rating-change (dark: ALERT_RATING_CHANGE_ENABLED) ───────────────

def _rating_change_armed() -> None:
    from api.services.alert_taxonomy import rating_change as _rc
    if not _rc.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class RatingChangeCreate(BaseModel):
    ticker: str
    actions: list[str] | None = None


@router.post("/api/alerts/taxonomy/rating-change", dependencies=[Depends(_rating_change_armed)])
def create_rating_change_alert(body: RatingChangeCreate, user: dict = Depends(get_current_user)):
    """Be told when an analyst upgrades or downgrades this ticker."""
    from api.services.alert_taxonomy import rating_change as _rc
    _rc.register()
    try:
        pid = _rc.register_predicate_for_user(user["id"], body.ticker, actions=body.actions)
    except PredicateRegistrationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"predicate_id": pid}


@router.get("/api/alerts/taxonomy/rating-change", dependencies=[Depends(_rating_change_armed)])
def list_rating_change_alerts(active_only: bool = True, user: dict = Depends(get_current_user)):
    from api.services.alert_taxonomy import rating_change as _rc
    return {"predicates": _predicates.list_predicates(type_id=_rc.TYPE_ID, user_id=user["id"],
                                                      active_only=active_only)}


@router.delete("/api/alerts/taxonomy/rating-change/{predicate_id}",
               dependencies=[Depends(_rating_change_armed)])
def suspend_rating_change_alert(predicate_id: str, user: dict = Depends(get_current_user)):
    """Suspend, never delete: the predicate and its fires stay."""
    if not _predicates.suspend_predicate(predicate_id, user["id"]):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"predicate_id": predicate_id, "suspended": True}


@router.post("/api/admin/alerts/taxonomy/run-rating-change-sweep",
             dependencies=[Depends(_rating_change_armed)])
def run_rating_change_sweep_now(_admin: dict = Depends(require_admin)):
    from api.services.alert_taxonomy import rating_change as _rc
    return _rc.run_sweep()


# ── FT-035: remind + per-channel read-state (dark: ALERT_REMIND_ENABLED) ────

def _remind_armed() -> None:
    from api.services.alert_taxonomy import remind as _remind
    if not _remind.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class RemindIn(BaseModel):
    minutes: float | None = None


class ReadIn(BaseModel):
    channel: str = "in_app"


@router.put("/api/alerts/taxonomy/predicates/{predicate_id}/remind",
            dependencies=[Depends(_remind_armed)])
def set_alert_remind(predicate_id: str, body: RemindIn, user: dict = Depends(get_current_user)):
    from api.services.alert_taxonomy import remind as _remind
    try:
        out = _remind.set_remind(user["id"], predicate_id, body.minutes)
    except _remind.RemindError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if out is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return out


@router.post("/api/alerts/taxonomy/fires/{fire_id}/read", dependencies=[Depends(_remind_armed)])
def mark_fire_read_on_channel(fire_id: int, body: ReadIn, user: dict = Depends(get_current_user)):
    from api.services.alert_taxonomy import remind as _remind
    try:
        ok = _remind.mark_read(fire_id, user["id"], body.channel)
    except _remind.RemindError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return _remind.read_state(fire_id, user["id"])


@router.get("/api/alerts/taxonomy/fires/{fire_id}/read-state", dependencies=[Depends(_remind_armed)])
def fire_read_state(fire_id: int, user: dict = Depends(get_current_user)):
    from api.services.alert_taxonomy import remind as _remind
    out = _remind.read_state(fire_id, user["id"])
    if out is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return out


# ── AC-7: per-trigger ops monitor + channel health (dark: ALERT_OPS_MONITOR_ENABLED) ──

def _ops_monitor_armed() -> None:
    from api.services.alert_taxonomy import ops_monitor as _ops
    if not _ops.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/admin/alerts/ops-monitor", dependencies=[Depends(_ops_monitor_armed)])
def alert_ops_monitor(hours: int = Query(24, ge=1, le=24 * 14), _admin: dict = Depends(require_admin)):
    """Per trigger type: evaluated / fired / could-not-evaluate. Per channel
    kind (the AC-2 registry): ok / failed / skipped and a health status.
    NAMES only -- the registry never returns a webhook value."""
    from api.services.alert_taxonomy import ops_monitor as _ops
    from api.services.alert_taxonomy import queue_caps as _caps
    return {**_ops.report(window_s=hours * 3600), "queue": _caps.published()}
