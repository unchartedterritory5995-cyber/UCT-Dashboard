"""BRK-04 (roadmap RM-L04) — Web Push subscription endpoints, DARK.

  GET  /api/push/config       → {"configured": bool, "public_key": str|None}
  POST /api/push/subscribe    → body = the browser's PushSubscription.toJSON()
  POST /api/push/unsubscribe  → {"endpoint": ...}
  POST /api/push/test         → queue one test push to the caller's devices

Unset ``WEB_PUSH_ENABLED`` ⇒ every route answers 404 BEFORE identity is read.
Paid-gated (402) like the other alert preferences; owner-scoped — every write
names the session's own user id, never one from the body. Plain ``def``
handlers: they touch SQLite and must run on the threadpool, not the event loop.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import web_push as svc

router = APIRouter(prefix="/api/push", tags=["web-push"])


def _armed() -> None:
    if not svc.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for push notifications. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Push notifications require a paid plan")
    return user


class SubKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: SubKeys
    expirationTime: Optional[float] = None


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.get("/config", dependencies=[Depends(_armed)])
def push_config(_user: dict = Depends(require_paid)):
    cfg = svc.vapid_config()
    return {"configured": cfg is not None, "public_key": cfg["public_key"] if cfg else None}


@router.post("/subscribe", dependencies=[Depends(_armed)])
def push_subscribe(body: SubscribeBody, user: dict = Depends(require_paid)):
    if svc.vapid_config() is None:
        raise HTTPException(status_code=503, detail="Push notifications are not configured yet")
    try:
        return svc.subscribe(user["id"], body.endpoint, body.keys.p256dh, body.keys.auth)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/unsubscribe", dependencies=[Depends(_armed)])
def push_unsubscribe(body: UnsubscribeBody, user: dict = Depends(require_paid)):
    return {"removed": svc.unsubscribe(user["id"], body.endpoint)}


@router.post("/test", dependencies=[Depends(_armed)])
def push_test(user: dict = Depends(require_paid)):
    queued = svc.dispatch(user["id"], "UCT test notification",
                          "Push notifications are working on this device.", url="/settings",
                          tag="uct-push-test")
    return {"queued": queued}
