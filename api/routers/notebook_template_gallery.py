"""The community template gallery's routes (wave 12, lane 12A).

The service is `api/services/journal_two/template_gallery.py`; the client is
`app/src/pages/journal-2-0/lib/templateGallery.js` + `components/notebook/TemplateGallery.jsx`.

  member  GET    /api/j2/template-gallery                     session  browse (?q ?category ?sort ?section)
  member  GET    /api/j2/template-gallery/{gallery_id}        session  one template in full (preview)
  member  POST   /api/j2/template-gallery                     paid     publish / resubmit one of Your templates
  member  DELETE /api/j2/template-gallery/{gallery_id}        session  unpublish (always possible)
  member  POST   /api/j2/template-gallery/{gallery_id}/use    session  copy into Your templates
  member  POST   /api/j2/template-gallery/{gallery_id}/report session  report a listed template
  admin   GET    /api/j2/template-gallery/admin/queue                  pending, reported, hidden
  admin   PATCH  /api/j2/template-gallery/admin/items/{gallery_id}     approve|reject|hide|unhide|feature|unfeature
  admin   PATCH  /api/j2/template-gallery/admin/reports/{report_id}    hide|dismiss

The rules, the share and publish routers' (`notebook_shares.py`, `notebook_publish.py`):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` off answers the one
    404 for every route before the session, the plan or the body is read.
  * THE BODY IS READ INSIDE THE DEPENDENCY CHAIN -- the gate, then the member, then the body
    (`member_body` / `paid_body`), never a FastAPI body parameter, so a malformed body can
    never answer 422 ahead of the gate.
  * PLAN: publishing takes this router's own `require_paid`; unpublish does NOT -- a member
    whose plan lapsed can always take their template down. Browsing, using and reporting
    need a session only (member templates are free, wave 6 owner ruling).
  * RATE LIMITS, per member: publish 10/hour and report 30/hour in the in-process limiter
    (`public.enforce_rate`; ⚠️ PER-PROCESS STATE, scopes `notebook-gallery-publish` and
    `notebook-gallery-report` -- a second web process doubles both), plus a DURABLE daily cap
    each in `daily_usage_counters` (survives deploys; fails open on a database error).
  * Its paths are outside `/api/j2/notes/...`, so journal_two's `/api/j2/notes/{note_id}`
    cannot shadow them, and outside `/api/j2/note-templates/...`, whose `/{template_id}` would.
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.services import request_body_cap as body_cap
from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services import daily_counters
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import template_gallery as gallery

PUBLISH_RATE = "10/hour"
REPORT_RATE = "30/hour"
SCOPE_PUBLISH = "notebook-gallery-publish"
SCOPE_REPORT = "notebook-gallery-report"
DAILY_PUBLISH_SCOPE = "notebook_gallery_publish"
DAILY_REPORT_SCOPE = "notebook_gallery_report"

PUBLISH_RATE_SENTENCE = "You've published a lot to the community gallery today. Try again later."
REPORT_RATE_SENTENCE = "You've sent a lot of reports today. Try again later."
MAX_BODY_BYTES = 256_000
TOO_LARGE_SENTENCE = "Request too large"


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, parses no body, and answers the one not-found."""
    if not gallery.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/template-gallery",
    tags=["journal-2-0", "notebook-template-gallery"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Publishing to the community gallery requires a paid plan")
    return user


async def _read_json(request: Request) -> dict[str, Any]:
    # ⛔ Capped WHILE it is read (wave 14, cap 2): this was `await request.body()`
    # then a length check, so a chunked or no-length body was buffered whole first.
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, TOO_LARGE_SENTENCE)
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Send a JSON object")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object")
    return data


async def member_body(request: Request, _user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return await _read_json(request)


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    return await _read_json(request)


async def admin_body(request: Request, _user: dict = Depends(require_admin)) -> dict[str, Any]:
    return await _read_json(request)


def _is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


def _cap(env: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(env, default)))
    except (TypeError, ValueError):
        return default


def _daily_take(scope: str, user: dict, cap_env: str, default: int, sentence: str) -> str:
    """One durable charge for today (ET), or a 429 with the plain sentence. Returns the day
    so a refused write can give the charge back."""
    from api.services.journal_two.calendar import et_today
    day = et_today()
    refused = daily_counters.take(day, [daily_counters.Charge(scope, str(user["id"]), 1, _cap(cap_env, default))])
    if refused is not None:
        raise HTTPException(status_code=429, detail=sentence)
    return day


def _give_back(day: str, scope: str, user: dict) -> None:
    daily_counters.give_back(day, [daily_counters.Charge(scope, str(user["id"]), 1)])


def _bad(e: gallery.GalleryError) -> HTTPException:
    return HTTPException(status_code=409 if isinstance(e, gallery.GalleryConflict) else 400, detail=str(e))


# ── every member ────────────────────────────────────────────────────────────────────────

@router.get("")
def list_gallery_endpoint(q: str = "", category: str = "", sort: str = "newest", section: str = "all",
                          user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """The gallery as this member sees it; `viewer.admin` lets the client show the review
    queue's door (the queue itself is admin-gated on the server)."""
    try:
        items = gallery.list_gallery(user["id"], q=q, category=category or None, sort=sort,
                                     section=section, is_admin=_is_admin(user))
    except gallery.GalleryError as e:
        raise _bad(e)
    return {"templates": items, "viewer": {"admin": _is_admin(user)}}


@router.get("/admin/queue")
def admin_queue_endpoint(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    return gallery.admin_queue()


@router.get("/{gallery_id}")
def get_item_endpoint(gallery_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    item = gallery.get_item(user["id"], gallery_id, is_admin=_is_admin(user))
    if item is None:
        raise public.not_found()
    return {"template": item}


@router.post("")
def publish_endpoint(body: dict[str, Any] = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{templateId, title, description?, category}` -> a PENDING submission (or the same
    copy resubmitted). The SERVER reads the template; the client never sends its body."""
    public.enforce_rate(PUBLISH_RATE, SCOPE_PUBLISH, f"member:{user['id']}", PUBLISH_RATE_SENTENCE, public=False)
    day = _daily_take(DAILY_PUBLISH_SCOPE, user, "NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", 10, PUBLISH_RATE_SENTENCE)
    try:
        item = gallery.publish(user["id"], body.get("templateId"), title=body.get("title"),
                               description=body.get("description"), category=body.get("category"))
    except gallery.GalleryError as e:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise _bad(e)
    if item is None:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise public.not_found()
    return {"template": item}


@router.delete("/{gallery_id}")
def unpublish_endpoint(gallery_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if not gallery.unpublish(user["id"], gallery_id):
        raise public.not_found()
    return {"ok": True}


@router.post("/{gallery_id}/use")
def use_endpoint(gallery_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        out = gallery.use_template(user["id"], gallery_id)
    except gallery.GalleryError as e:
        raise _bad(e)
    if out is None:
        raise public.not_found()
    return out


@router.post("/{gallery_id}/report")
def report_endpoint(gallery_id: str, body: dict[str, Any] = Depends(member_body),
                    user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """`{reason, note?}`. One report per member per template; a repeat answers `already`."""
    public.enforce_rate(REPORT_RATE, SCOPE_REPORT, f"member:{user['id']}", REPORT_RATE_SENTENCE, public=False)
    day = _daily_take(DAILY_REPORT_SCOPE, user, "NOTEBOOK_GALLERY_REPORT_DAILY_CAP", 20, REPORT_RATE_SENTENCE)
    try:
        out = gallery.report(user["id"], gallery_id, reason=body.get("reason"), note=body.get("note"))
    except gallery.GalleryError as e:
        _give_back(day, DAILY_REPORT_SCOPE, user)
        raise _bad(e)
    if out is None:
        _give_back(day, DAILY_REPORT_SCOPE, user)
        raise public.not_found()
    if out.get("already"):
        _give_back(day, DAILY_REPORT_SCOPE, user)
    return out


# ── the review queue ────────────────────────────────────────────────────────────────────

@router.patch("/admin/items/{gallery_id}")
def admin_item_endpoint(gallery_id: str, body: dict[str, Any] = Depends(admin_body),
                        admin: dict = Depends(require_admin)) -> dict[str, Any]:
    """`{action: approve|reject|hide|unhide|feature|unfeature, note?}`. Hide is a visibility
    state; nothing here deletes a member's template."""
    try:
        item = gallery.admin_act(admin["id"], gallery_id, body.get("action"), note=body.get("note"))
    except gallery.GalleryError as e:
        raise _bad(e)
    if item is None:
        raise public.not_found()
    return {"template": item}


@router.patch("/admin/reports/{report_id}")
def admin_report_endpoint(report_id: str, body: dict[str, Any] = Depends(admin_body),
                          admin: dict = Depends(require_admin)) -> dict[str, Any]:
    """`{action: hide|dismiss}` on one OPEN report (the Floor's shape)."""
    try:
        ok = gallery.admin_report_act(admin["id"], report_id, body.get("action"))
    except gallery.GalleryError as e:
        raise _bad(e)
    if not ok:
        raise public.not_found()
    return {"ok": True}
