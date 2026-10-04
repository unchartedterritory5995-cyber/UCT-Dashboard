"""The member's alert routing rule (FT-036) and outbound webhooks (FT-033).

Two surfaces, two dark gates, one router:
  * /api/alerts/routing*   -- 404 unless ALERT_ROUTING_RULE_ENABLED=1
  * /api/alerts/webhooks*  -- 404 unless ALERT_WEBHOOKS_ENABLED=1
Every route is `require_paid` (402) and keyed on the caller's own id. Plain
`def` throughout: SQLite and (at create) one DNS lookup, never a send -- the
POST to a member's endpoint happens only in the scheduler's drain job.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.alert_taxonomy import outbound_webhooks as hooks
from api.services.alert_taxonomy import routing_rule as routing

router = APIRouter()

CREATE_BURST = "10/hour"
TEST_BURST = "6/minute"


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Alert routing and webhooks require a paid plan")
    return user


def _routing_armed() -> None:
    if not routing.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _webhooks_armed() -> None:
    if not hooks.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _burst(rate: str, scope: str, user_id) -> None:
    from api.limiter import limiter
    if not limiter.enabled:
        return
    from limits import parse
    if not limiter.limiter.hit(parse(rate), scope, f"{scope}:user:{user_id}"):
        raise HTTPException(status_code=429, detail="Too many requests. Wait a little and try again.")


# ── FT-036: one global routing rule, with suspend ───────────────────────────

class RoutingIn(BaseModel):
    email: bool | None = None
    push: bool | None = None
    webhook: bool | None = None


@router.get("/api/alerts/routing", dependencies=[Depends(_routing_armed)])
def get_routing(user: dict = Depends(require_paid)):
    return routing.get(user["id"]).as_dict()


@router.put("/api/alerts/routing", dependencies=[Depends(_routing_armed)])
def put_routing(body: RoutingIn, user: dict = Depends(require_paid)):
    return routing.set_channels(user["id"], email=body.email, push=body.push,
                                webhook=body.webhook).as_dict()


@router.post("/api/alerts/routing/suspend", dependencies=[Depends(_routing_armed)])
def suspend_alerts(user: dict = Depends(require_paid)):
    """Withhold every notification; keep every definition and every fire."""
    return routing.suspend(user["id"]).as_dict()


@router.post("/api/alerts/routing/resume", dependencies=[Depends(_routing_armed)])
def resume_alerts(user: dict = Depends(require_paid)):
    return routing.resume(user["id"]).as_dict()


# ── FT-035: per-alert expiry ────────────────────────────────────────────────

class ExpiryIn(BaseModel):
    expires_at: float | None = None   # unix seconds; null clears it


def _lifecycle_armed() -> None:
    from api.services.alert_taxonomy import lifecycle
    if not lifecycle.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.put("/api/alerts/predicates/{predicate_id}/expiry", dependencies=[Depends(_lifecycle_armed)])
def set_alert_expiry(predicate_id: str, body: ExpiryIn, user: dict = Depends(require_paid)):
    """Past its expiry an alert is SUSPENDED (kept, reactivatable), never deleted."""
    from api.services.alert_taxonomy import lifecycle
    try:
        out = lifecycle.set_expiry(user["id"], predicate_id, body.expires_at)
    except lifecycle.LifecycleError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if out is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return out


# ── FT-033: outbound webhooks ───────────────────────────────────────────────

class WebhookIn(BaseModel):
    url: str


@router.get("/api/alerts/webhooks", dependencies=[Depends(_webhooks_armed)])
def list_webhooks(user: dict = Depends(require_paid)):
    return {"webhooks": hooks.list_webhooks(user["id"]),
            "signature_header": "X-UCT-Signature",
            "signature_scheme": "t=<unix>,v1=hex(HMAC-SHA256(secret, '<t>.<raw body>'))"}


@router.post("/api/alerts/webhooks", dependencies=[Depends(_webhooks_armed)])
def create_webhook(body: WebhookIn, user: dict = Depends(require_paid)):
    """Returns the signing secret ONCE. It is never readable again."""
    _burst(CREATE_BURST, "alert-webhook-create", user["id"])
    try:
        return hooks.create(user["id"], body.url)
    except hooks.WebhookError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/alerts/webhooks/{webhook_id}", dependencies=[Depends(_webhooks_armed)])
def revoke_webhook(webhook_id: str, user: dict = Depends(require_paid)):
    if not hooks.revoke(user["id"], webhook_id):
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"revoked": webhook_id}


@router.post("/api/alerts/webhooks/{webhook_id}/test", dependencies=[Depends(_webhooks_armed)])
def test_webhook(webhook_id: str, user: dict = Depends(require_paid)):
    """Queues a signed `webhook.test` delivery; the drain sends it within a minute."""
    _burst(TEST_BURST, "alert-webhook-test", user["id"])
    did = hooks.enqueue_test(user["id"], webhook_id)
    if did is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"queued": did}


@router.get("/api/alerts/webhooks/{webhook_id}/deliveries", dependencies=[Depends(_webhooks_armed)])
def webhook_deliveries(webhook_id: str, user: dict = Depends(require_paid)):
    rows = hooks.deliveries(user["id"], webhook_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"deliveries": rows}
