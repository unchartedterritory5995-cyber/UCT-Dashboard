"""POST /api/screener/membership-diff: the New-today answer for one screen (dark).

404 unless SCREENER_NEW_TODAY_ENABLED reaches this user (owner preview reaches admins
only); 402 for a free member, like every screener read. Spec section 1 of
docs/superpowers/specs/2026-10-16-screener-focus-next-design.md.
Plain `def`: SQLite plus at most one scan, so it runs on the threadpool.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import auth
from api.services.screener import membership

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


def _armed() -> None:
    """Flag fully off: 404 for everyone, BEFORE the paid gate, so a free member cannot
    tell the route exists. The per-user (owner preview) answer is decided in the route."""
    if membership.job_enabled() is False:
        raise HTTPException(status_code=404, detail="Not Found")


class DiffIn(BaseModel):
    spec: dict


@router.post("/api/screener/membership-diff", dependencies=[Depends(_armed)])
def membership_diff(body: DiffIn, user=Depends(require_paid)):
    is_admin = (user or {}).get("role") == "admin"
    if not auth._screener_flags(is_admin=is_admin)["screener_new_today_enabled"]:
        raise HTTPException(status_code=404, detail="Not Found")
    return membership.diff(body.spec or {})
