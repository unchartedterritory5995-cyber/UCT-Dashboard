# api/routers/community.py
"""The Floor — community forum API.

Spec: docs/superpowers/specs/2026-07-09-community-space-design.md
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import community_store as store

router = APIRouter(prefix="/api/community", tags=["community"])

MAX_BODY_BYTES = 50_000
THREADS_PER_HOUR = int(os.environ.get("COMMUNITY_THREADS_PER_HOUR", "5"))
POSTS_PER_HOUR = int(os.environ.get("COMMUNITY_POSTS_PER_HOUR", "30"))


def _enabled() -> bool:
    return os.environ.get("COMMUNITY_ENABLED", "0") == "1"


def require_community(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not _enabled():
        raise HTTPException(status_code=503, detail="Community is not enabled")
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Floor requires a paid plan")
    return user


def _is_mentor(user: dict) -> bool:
    return user.get("role") == "admin"


@router.get("/status")
def status(user: dict = Depends(get_current_user)):
    enabled = _enabled()
    return {
        "enabled": enabled,
        "acked": store.has_ack(user["id"]) if enabled else False,
        "is_mentor": _is_mentor(user),
        "muted": store.is_muted(user["id"]) if enabled else False,
    }


@router.get("/spaces")
def spaces(user: dict = Depends(require_community)):
    unread = store.unread_summary(user["id"])["by_space"]
    return [
        {"key": k, "label": v["label"], "mentor_only": v["mentor_only"],
         "unread": unread.get(k, 0)}
        for k, v in store.SPACES.items()
    ]


@router.get("/unread")
def unread(user: dict = Depends(require_community)):
    return store.unread_summary(user["id"])


@router.get("/threads")
def threads(space: str = Query(...), limit: int = Query(50, ge=1, le=100),
            offset: int = Query(0, ge=0),
            user: dict = Depends(require_community)):
    if space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    return {"threads": store.list_threads(space, limit=limit, offset=offset)}


@router.get("/threads/{thread_id}")
def thread_detail(thread_id: int, user: dict = Depends(require_community)):
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    return t
