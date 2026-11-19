"""Community scan-board layouts (`api/services/screener_layout_gallery.py`), dark behind
`SCREENER_LAYOUT_GALLERY_ENABLED` (unset/0 off, `admin` owner preview, `1` everyone; read per
request through `auth._screener_flags`).

    GET    /api/screener/layout-gallery                      items, mine, (admin) queue, limits
    POST   /api/screener/layout-gallery                      {name, layout} -> {item}, pending
    DELETE /api/screener/layout-gallery/{gallery_id}         the author (or an admin) removes it
    POST   /api/screener/layout-gallery/{gallery_id}/use     {item}; one use per member, ever
    POST   /api/screener/layout-gallery/{gallery_id}/report  {reason} -> {reported, already}
    PATCH  /api/screener/layout-gallery/admin/{gallery_id}   {action}; admin only

Invariants:
  * GATE ORDER, on every route: the flag first (off for this caller -> the 404 of a route that
    does not exist, signed in or not, paid or not), then 401, then this router's own 402.
    The flag is two route dependencies in that order: `_armed` reads no session at all, so a
    fully dark route costs nothing; `_reaches` answers the owner preview (`admin`) per caller.
  * EVERY ROUTE DECLARES ITS OWN `require_paid` (the admin route too: then the role is checked
    in the body, 403), so `tests/test_screener_side_routers_auth.py` sweeps all of them.
  * Paths are written out in full in each decorator: `tests/test_screener_backtest_auth.py`
    finds a screener route by its literal decorator path, and a router prefix would hide these.
  * RATE LIMITS, per member (the notebook gallery's mechanics): publish 10/hour in the
    in-process limiter (`screener-layout-publish`) plus a DURABLE 10/day
    (`daily_usage_counters`, scope `screener_layout_publish`), the day's charge given back on
    any refusal; report 30/hour (`screener-layout-report`); use 60/hour
    (`screener-layout-use`). The in-process ones double under a second web process (the
    CLAUDE.md single-process roster).
  * A request body is capped at 16 KB while it is read.
"""
from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from api.middleware.auth_middleware import (
    get_current_user_optional, get_current_user_with_plan, is_paid_user,
)
from api.routers import auth
from api.services import daily_counters
from api.services import request_body_cap as body_cap
from api.services import screener_layout_gallery as gallery

FLAG_KEY = "screener_layout_gallery_enabled"

PUBLISH_RATE = "10/hour"
REPORT_RATE = "30/hour"
USE_RATE = "60/hour"
SCOPE_PUBLISH = "screener-layout-publish"
SCOPE_REPORT = "screener-layout-report"
SCOPE_USE = "screener-layout-use"
DAILY_PUBLISH_SCOPE = "screener_layout_publish"
DAILY_PUBLISH_CAP = 10
DAILY_PUBLISH_CAP_ENV = "SCREENER_LAYOUT_PUBLISH_DAILY_CAP"

PUBLISH_RATE_SENTENCE = "You've shared a lot of layouts today. Try again later."
REPORT_RATE_SENTENCE = "You've sent a lot of reports. Try again later."
USE_RATE_SENTENCE = "You've loaded a lot of layouts. Try again later."
MAX_BODY_BYTES = 16_000
TOO_LARGE_SENTENCE = "Request too large"
BAD_BODY_SENTENCE = "Send a JSON object"
NO_STORE = {"Cache-Control": "no-store"}

router = APIRouter(tags=["screener", "screener-layout-gallery"])


def _not_found() -> HTTPException:
    """The 404 of a route that does not exist (FastAPI's own body)."""
    return HTTPException(status_code=404, detail="Not Found")


def _armed() -> None:
    """Off for everyone: 404 before any session is read."""
    if not auth._screener_flags(is_admin=True)[FLAG_KEY]:
        raise _not_found()


def _reaches(user: Optional[dict] = Depends(get_current_user_optional)) -> None:
    """The owner preview (`admin`): on for admins only, and the 404 for everyone else, signed
    in or not, so nobody outside the preview can tell the routes exist."""
    is_admin = bool(user) and user.get("role") == "admin"
    if not auth._screener_flags(is_admin=is_admin)[FLAG_KEY]:
        raise _not_found()


GATE = [Depends(_armed), Depends(_reaches)]


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Community scan layouts require a paid plan",
                            headers=dict(NO_STORE))
    return user


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    """The JSON object of a paid caller's request, never more than 16 KB of it read."""
    from api.services.journal_two import widget_request_body as wbody
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, TOO_LARGE_SENTENCE)
    if not raw.strip():
        return {}
    try:
        data = wbody.loads_plain_body(raw)      # a body too deep to parse is its 400, never a 500
    except ValueError:
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE, headers=dict(NO_STORE)) from None
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail=BAD_BODY_SENTENCE, headers=dict(NO_STORE))
    return data


def _is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


def _hit(limit: str, scope: str, user: dict, sentence: str) -> None:
    """One in-process rate hit, keyed on the member (`public.enforce_rate`, the shared limiter)."""
    from api.services.journal_two import public_note_payload as public
    public.enforce_rate(limit, scope, f"member:{user['id']}", sentence, public=False)


def _daily_cap() -> int:
    try:
        return max(0, int(os.environ.get(DAILY_PUBLISH_CAP_ENV, DAILY_PUBLISH_CAP)))
    except (TypeError, ValueError):
        return DAILY_PUBLISH_CAP


def _daily_take(user: dict) -> str | None:
    """One durable publish charge for today (ET), or a 429. Returns the day so a refused publish
    can give the charge back, or None when the counter failed open and charged nothing."""
    from api.services.journal_two.calendar import et_today
    day = et_today()
    refused, charged = daily_counters.take_charged(
        day, [daily_counters.Charge(DAILY_PUBLISH_SCOPE, str(user["id"]), 1, _daily_cap())])
    if refused is not None:
        raise HTTPException(status_code=429, detail=PUBLISH_RATE_SENTENCE)
    return day if charged else None


def _give_back(day: str | None, user: dict) -> None:
    if day is None:
        return                              # the take charged nothing: never refund another publish's charge
    daily_counters.give_back(day, [daily_counters.Charge(DAILY_PUBLISH_SCOPE, str(user["id"]), 1)])


def _refusal(e: gallery.LayoutError) -> HTTPException:
    return HTTPException(status_code=409 if isinstance(e, gallery.LayoutConflict) else 400, detail=str(e),
                         headers=dict(NO_STORE))


# ── every member the flag reaches ────────────────────────────────────────────────────────

@router.get("/api/screener/layout-gallery", dependencies=GATE)
def list_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return gallery.list_for(user["id"], is_admin=_is_admin(user))


@router.post("/api/screener/layout-gallery", dependencies=GATE)
def publish_endpoint(body: dict[str, Any] = Depends(paid_body),
                     user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{name, layout: {widgets}}`. Stored pending; an admin approves it before anyone else sees it."""
    _hit(PUBLISH_RATE, SCOPE_PUBLISH, user, PUBLISH_RATE_SENTENCE)
    day = _daily_take(user)
    try:
        item = gallery.publish(user["id"], body.get("name"), body.get("layout"))
    except gallery.LayoutError as e:
        _give_back(day, user)
        raise _refusal(e)
    except Exception:
        _give_back(day, user)
        raise
    return {"item": item}


# The literal `/admin/...` route comes BEFORE `/{gallery_id}`: FastAPI answers on first match.
@router.patch("/api/screener/layout-gallery/admin/{gallery_id}", dependencies=GATE)
def admin_endpoint(gallery_id: str, body: dict[str, Any] = Depends(paid_body),
                   user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{action: approve | decline | hide | unhide | dismiss}`."""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        item = gallery.admin_act(user["id"], gallery_id, body.get("action"))
    except gallery.LayoutError as e:
        raise _refusal(e)
    if item is None:
        raise _not_found()
    return {"item": item}


@router.delete("/api/screener/layout-gallery/{gallery_id}", dependencies=GATE)
def unpublish_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    if not gallery.unpublish(user["id"], gallery_id, is_admin=_is_admin(user)):
        raise _not_found()
    return {"ok": True}


@router.post("/api/screener/layout-gallery/{gallery_id}/use", dependencies=GATE)
def use_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    _hit(USE_RATE, SCOPE_USE, user, USE_RATE_SENTENCE)
    item = gallery.use(user["id"], gallery_id, is_admin=_is_admin(user))
    if item is None:
        raise _not_found()
    return {"item": item}


@router.post("/api/screener/layout-gallery/{gallery_id}/report", dependencies=GATE)
def report_endpoint(gallery_id: str, body: dict[str, Any] = Depends(paid_body),
                    user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{reason: name | broken | other}`."""
    _hit(REPORT_RATE, SCOPE_REPORT, user, REPORT_RATE_SENTENCE)
    try:
        out = gallery.report(user["id"], gallery_id, body.get("reason"))
    except gallery.LayoutError as e:
        raise _refusal(e)
    if out is None:
        raise _not_found()
    return out
