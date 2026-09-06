"""api/routers/theme_sets.py

Per-user CUSTOM THEME SETS for the Theme Tracker (see api/services/theme_sets.py).

  GET    /api/theme-sets            -> {enabled, sets:[{id,name}]}          PAID
  POST   /api/theme-sets            -> create {name}                        PAID
  GET    /api/theme-sets/{id}       -> full diff definition                 PAID (owner)
  PUT    /api/theme-sets/{id}       -> replace {name,hidden,removed,added,custom}  PAID (owner)
  DELETE /api/theme-sets/{id}       -> delete                               PAID (owner)

Feature-flagged via THEME_SETS_ENABLED (default OFF). When off, the list reports
{enabled:false} and every write is refused, so the widget shows only the shared default.
Ownership is enforced in every service call (user_id in the WHERE clause) -- one user can
never read or edit another user's set.
"""
from fastapi import APIRouter, Body, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import theme_sets as svc

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    # Own 402 sentence per the per-router convention (test_user_definitions_auth rail).
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Custom theme sets require a paid plan")
    return user


def _require_enabled():
    if not svc.enabled():
        raise HTTPException(status_code=404, detail="Custom theme sets are not enabled")


@router.get("/api/theme-sets")
def list_theme_sets(user: dict = Depends(require_paid)):
    if not svc.enabled():
        return {"enabled": False, "sets": []}
    return {"enabled": True, "sets": svc.list_sets(user["id"])}


@router.post("/api/theme-sets")
def create_theme_set(body: dict = Body(default={}), user: dict = Depends(require_paid)):
    _require_enabled()
    name = (body or {}).get("name") or "My Themes"
    diff = {k: (body or {}).get(k) for k in ("themes", "hidden", "removed", "added", "custom")}
    created = svc.create_set(user["id"], name, diff)
    if not created:
        raise HTTPException(status_code=400, detail="Theme-set limit reached")
    return created


@router.get("/api/theme-sets/{set_id}")
def get_theme_set(set_id: str, user: dict = Depends(require_paid)):
    _require_enabled()
    s = svc.get_set(user["id"], set_id)
    if not s:
        raise HTTPException(status_code=404, detail="Theme set not found")
    return s


@router.put("/api/theme-sets/{set_id}")
def update_theme_set(set_id: str, body: dict = Body(default={}), user: dict = Depends(require_paid)):
    _require_enabled()
    name = (body or {}).get("name")
    diff = {k: (body or {}).get(k) for k in ("themes", "hidden", "removed", "added", "custom")}
    updated = svc.replace_set(user["id"], set_id, name, diff)
    if not updated:
        raise HTTPException(status_code=404, detail="Theme set not found")
    return updated


@router.delete("/api/theme-sets/{set_id}")
def delete_theme_set(set_id: str, user: dict = Depends(require_paid)):
    _require_enabled()
    if not svc.delete_set(user["id"], set_id):
        raise HTTPException(status_code=404, detail="Theme set not found")
    return {"ok": True}
