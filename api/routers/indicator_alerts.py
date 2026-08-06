"""REST endpoints for chart indicator alerts.

Per-user CRUD over the ``indicator_alerts`` table. All endpoints require
an authenticated session via the canonical ``get_current_user`` dependency.

The background evaluator (started from the app lifespan) reads the same
table and dispatches deliveries through the watchlist-alert pipeline, so
these endpoints only need to manage the alert rows themselves.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import indicator_alert_service as ias
from api.services import indicator_alert_evaluator


router = APIRouter(prefix="/api/indicator-alerts", tags=["indicator-alerts"])


class AlertCreate(BaseModel):
    sym: str
    indicator: str
    condition: str
    threshold: Optional[float] = None
    tf: str
    params: Optional[dict[str, Any]] = None


class SnoozeBody(BaseModel):
    minutes: int = 60


# ⚠️ THE OTHER PRICE-ALERT PRODUCT, NAMED SO IT CANNOT BE REBUILT BY ACCIDENT.
# `watchlist_alerts` already exists and already delivers price alerts, through
# `check_alerts_against_prices` on the 15-second live-price poll. A bare price
# alert asked for HERE is the same product under a second name, and two products
# with one name is how a user ends up with two alerts and one notification. The
# chart lane's price relation is an OPERAND (`{"kind": "close"}`, the grammar
# Task 3 built) evaluated closed-bar on the alert's own timeframe — a different
# question with a different latency, not a synonym.
_PRICE_ALIASES = {"price", "close", "last", "last_price", "px"}

# Worst-case seconds between the event and the notification, per timeframe.
# Spec §8 requires this to be STATED rather than discovered. It is
# (evaluator cycle interval) + (how long a bar takes to close), and the second
# term is zero on the forming lane — which is the lane that repaints.
_TF_SECONDS = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600,
               "D": 86_400, "W": 604_800, "M": 2_678_400}
_CYCLE_SECONDS = 60


@router.get("")
def list_my_alerts(user: dict = Depends(get_current_user)):
    return {"alerts": ias.list_for_user(user["id"])}


@router.get("/catalog")
def get_alert_catalog(user: dict = Depends(get_current_user)):
    """What the alert dropdown may offer.

    Served by the module that EVALUATES, so the dropdown cannot offer an alert
    that cannot fire — `IndicatorAlertPopover.jsx` used to hand-write its own
    copy and the two had already drifted apart.

    ⚠️ AUTH-GATED like every other endpoint on this router, deliberately: it is
    an enumeration of internals, not public content. The popover only renders
    for a signed-in user, so nothing is lost by gating it.

    ⚠️ DECLARED BEFORE `/{alert_id}` would matter if a GET on that path existed.
    It does not today (only DELETE and POST /{id}/toggle) — but keep this route
    above any future `GET /{alert_id}` or `catalog` will be parsed as an id.
    """
    return {"catalog": indicator_alert_evaluator.alert_catalog()}


@router.get("/fired")
def list_my_fires(limit: int = 50, user: dict = Depends(get_current_user)):
    """The fired log — what actually reached this user, newest first.

    ⚠️ DECLARED ABOVE ANY `/{alert_id}` GET, like `/catalog`. There is no such
    route today (only DELETE and POST on that path), and this is the second
    literal segment that would be parsed as an id if one were added.
    """
    return {"fires": ias.list_fires(user["id"], limit)}


@router.get("/latency")
def get_alert_latency(user: dict = Depends(get_current_user)):
    """Worst-case seconds from the event to the notification, per timeframe.

    Spec §8 asks for this to be STATED, not discovered by a member timing their
    own alerts. It is the evaluator's cycle interval plus, on the closed lane,
    the time a bar takes to finish — the second term is the honest price of not
    repainting, and it is zero on the lane that does.
    """
    mode = indicator_alert_evaluator.eval_mode()
    closed = mode == "closed"
    return {
        "mode": mode,
        "cycle_seconds": _CYCLE_SECONDS,
        "worst_case_seconds": {
            tf: _CYCLE_SECONDS + (secs if closed else 0)
            for tf, secs in _TF_SECONDS.items()
        },
    }


@router.post("")
def create_alert(body: AlertCreate, user: dict = Depends(get_current_user)):
    # ⛔ THE CREATE PATH USED TO VALIDATE NOTHING. A typo'd indicator was stored,
    # accepted, and then silently never fired — an alert the user believes is
    # watching. That is the same silence `needs_attention` exists to end, reached
    # one step earlier, where it can still be refused instead of explained.
    raw = (body.indicator or "").strip()
    if raw.lower() in _PRICE_ALIASES:
        raise HTTPException(
            status_code=400,
            detail=("A bare price alert belongs to the watchlist alert lane "
                    "(/api/watchlist-alerts), which already delivers it on the "
                    "15-second live-price poll. Building a second one here "
                    "would give you two alerts under one name."),
        )
    address = indicator_alert_evaluator.resolve_address(raw)
    if indicator_alert_evaluator.value_function(address) is None:
        raise HTTPException(
            status_code=400,
            detail=(f"{body.indicator!r} is not an indicator this chart can "
                    "evaluate, so an alert on it could never fire. See "
                    "GET /api/indicator-alerts/catalog for what is offered."),
        )
    alert_id = ias.create(
        user_id=user["id"],
        sym=body.sym.upper(),
        indicator=body.indicator,
        condition=body.condition,
        threshold=body.threshold,
        tf=body.tf,
        params_json=body.params,
    )
    return {"id": alert_id}


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    ias.delete(alert_id)
    return {"ok": True}


@router.post("/{alert_id}/toggle")
def toggle_alert(alert_id: int, user: dict = Depends(get_current_user)):
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    new_state = not alert["active"]
    ias.set_active(alert_id, new_state)
    return {"active": new_state}


@router.post("/{alert_id}/snooze")
def snooze_alert(alert_id: int, body: SnoozeBody,
                 user: dict = Depends(get_current_user)):
    """Quiet for N minutes, then speak again if the condition is still true.

    ⛔ NOT `toggle`. A toggled-off alert stops being EVALUATED, so it cannot
    observe the condition going false and can never re-arm; a snoozed one keeps
    being evaluated and keeps its `last_value` current — which under
    `ALERT_EVAL_MODE == "forming"` is the `prev` its next crossing is measured
    against. Snooze is silence; toggle is absence.
    """
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    try:
        return ias.snooze(alert_id, body.minutes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{alert_id}/rearm")
def rearm_alert(alert_id: int, user: dict = Depends(get_current_user)):
    """Arm it again now — "tell me the next time this happens".

    The automatic re-arm needs the condition to be observed FALSE first, which
    is correct and is also why a user staring at a fired alert on a level that
    has not come back needs a button.
    """
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    return ias.rearm(alert_id)


@router.get("/{alert_id}/fires")
def list_alert_fires(alert_id: int, limit: int = 50,
                     user: dict = Depends(get_current_user)):
    """One alert's own history. Ownership-checked like every other route here."""
    alert = ias.get(alert_id)
    if not alert or alert["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Alert not found")
    from api.services import alert_fired_log
    return {"fires": alert_fired_log.fires_for_alert(alert_id, limit)}
