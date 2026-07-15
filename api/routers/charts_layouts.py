"""Charts-workspace layout templates.

- GET    /api/charts/layouts        → {global:[...], mine:[...]} for the current user
- POST   /api/charts/layouts        → save a named layout (scope='user' any user;
                                        scope='global' admin-only = prebuilt template)
- DELETE /api/charts/layouts/{id}   → admin for global, owner (or admin) for user
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import charts_layout_service as svc

router = APIRouter(prefix="/api/charts/layouts", tags=["charts-layouts"])

_MAX_NAME = 60


class LayoutIn(BaseModel):
    name: str
    layout: dict
    groups: Optional[dict] = None
    scope: str = "user"  # 'user' | 'global'


@router.get("")
def list_layouts(user: dict = Depends(get_current_user)):
    return svc.list_for_user(user["id"])


@router.post("")
def save_layout(body: LayoutIn, user: dict = Depends(get_current_user)):
    scope = body.scope if body.scope in ("user", "global") else "user"
    if scope == "global" and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required for prebuilt templates")
    name = (body.name or "").strip()[:_MAX_NAME]
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not isinstance(body.layout, dict) or not isinstance(body.layout.get("widgets"), list):
        raise HTTPException(status_code=400, detail="Invalid layout")
    created_by = user.get("display_name") or user.get("email")
    return svc.upsert(scope, user["id"], name, body.layout, body.groups, created_by)


@router.delete("/{layout_id}")
def delete_layout(layout_id: int, user: dict = Depends(get_current_user)):
    row = svc.get(layout_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    is_admin = user.get("role") == "admin"
    if row["scope"] == "global":
        if not is_admin:
            raise HTTPException(status_code=403, detail="Admin only")
    elif row["user_id"] != user["id"] and not is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    svc.delete(layout_id)
    return {"ok": True}
