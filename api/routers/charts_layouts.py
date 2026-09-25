"""Charts-workspace layout templates.

- GET    /api/charts/layouts             → {global:[...], mine:[...]} for the current user
- POST   /api/charts/layouts             → save a named layout (scope='user' any user;
                                             scope='global' admin-only = prebuilt template)
- PATCH  /api/charts/layouts/{id}        → rename in place (same permissions as DELETE)
- DELETE /api/charts/layouts/{id}        → admin for global, owner (or admin) for user
- POST   /api/charts/layouts/{id}/share  → mint (or return) a share link, owner only
- GET    /api/charts/layouts/{id}/share  → is this layout shared, and under what token
- DELETE /api/charts/layouts/{id}/share  → revoke the link
- GET    /api/charts/layouts/shared/{token} → resolve a share token to its layout,
                                             for any logged-in user (not just the owner)

Sharing is terminal-grade property 3, "saved things become names, and names are
addresses" — mirrors user_definitions.py's share/unshare/resolve design.
Declared BEFORE any bare `/{layout_id}` route in this file (there isn't one
today, but this repo has been bitten before by a static segment losing to a
path-param route registered first — Breadth's own `/live/drill/{metric_key}`
note in CLAUDE.md is why this is deliberate, not superstition).
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import charts_layout_service as svc

router = APIRouter(prefix="/api/charts/layouts", tags=["charts-layouts"])

_MAX_NAME = 60


class LayoutRename(BaseModel):
    name: str


class LayoutIn(BaseModel):
    name: str
    layout: dict
    groups: Optional[dict] = None
    scope: str = "user"  # 'user' | 'global'


@router.get("")
def list_layouts(user: dict = Depends(get_current_user)):
    return svc.list_for_user(user["id"])


@router.get("/shared/{token}")
def resolve_shared_layout(token: str, user: dict = Depends(get_current_user)):
    """Open somebody else's shared layout by token. Requires login (like every
    other route in this app) but NOT ownership — that's the whole point of a
    share link. A dead token (never existed, revoked, or its layout deleted)
    reads as a plain 404, same as any other missing resource."""
    row = svc.resolve_share(token)
    if not row:
        raise HTTPException(status_code=404, detail="This link is no longer valid")
    return row


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


def _assert_may_write(row: dict, user: dict) -> None:
    """The one ownership rule shared by rename and delete: a global (prebuilt)
    row is admin-only, a personal row belongs to its owner (or an admin)."""
    is_admin = user.get("role") == "admin"
    if row["scope"] == "global":
        if not is_admin:
            raise HTTPException(status_code=403, detail="Admin only")
    elif row["user_id"] != user["id"] and not is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.patch("/{layout_id}")
def rename_layout(layout_id: int, body: LayoutRename, user: dict = Depends(get_current_user)):
    row = svc.get(layout_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_may_write(row, user)
    name = (body.name or "").strip()[:_MAX_NAME]
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    try:
        updated = svc.rename(layout_id, name)
    except sqlite3.IntegrityError:
        # UNIQUE(scope, user_id, name) — a 500 here would read as a server fault
        # for what is really "pick another name".
        raise HTTPException(status_code=409, detail="You already have a layout with that name")
    if not updated:
        raise HTTPException(status_code=404, detail="Not found")
    return updated


@router.delete("/{layout_id}")
def delete_layout(layout_id: int, user: dict = Depends(get_current_user)):
    row = svc.get(layout_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_may_write(row, user)
    svc.delete(layout_id)
    return {"ok": True}


@router.post("/{layout_id}/share")
def share_layout(layout_id: int, user: dict = Depends(get_current_user)):
    """Mint (or return) the share link for one of MY layouts. Global (prebuilt)
    layouts are already visible to everyone and can't be shared this way —
    404 rather than a confusing 403, since from the caller's side a global
    layout genuinely isn't theirs to mint a personal link for."""
    row = svc.get(layout_id)
    if not row or row["scope"] != "user":
        raise HTTPException(status_code=404, detail="Not found")
    _assert_may_write(row, user)
    out = svc.share(user["id"], layout_id)
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    return out


@router.get("/{layout_id}/share")
def share_state(layout_id: int, user: dict = Depends(get_current_user)):
    """Is this layout shared, and under what token? READ-ONLY — a GET that
    minted a token would publish a layout because somebody opened a panel."""
    row = svc.get(layout_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_may_write(row, user)
    return svc.share_status(user["id"], layout_id) or {"token": None}


@router.delete("/{layout_id}/share")
def unshare_layout(layout_id: int, user: dict = Depends(get_current_user)):
    """Turn the link off. The token is tombstoned (an appended revocation row),
    not deleted, so a recipient gets a stable 'gone' rather than the link
    intermittently working depending on a race with the DELETE."""
    row = svc.get(layout_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_may_write(row, user)
    revoked = svc.unshare(user["id"], layout_id)
    return {"ok": True, "layout_id": layout_id, "revoked": revoked}
