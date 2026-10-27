"""The community template gallery's routes (wave 12, lane 12A).

The service is `api/services/journal_two/template_gallery.py`; the client is
`app/src/pages/journal-2-0/lib/templateGallery.js` + `components/notebook/TemplateGallery.jsx`.

  member  GET    /api/j2/template-gallery                     paid     browse (?q ?category ?sort ?section)
  member  GET    /api/j2/template-gallery/{gallery_id}        paid     one template in full (preview)
  member  GET    /api/j2/template-gallery/{gallery_id}/images/{n}  paid  an example note's image copy (P3b; ?rev=pending
                                                                       for the held revision's, author or admin only)
  member  POST   /api/j2/template-gallery                     paid     publish / resubmit one of Your templates
  member  POST   /api/j2/template-gallery/styles              paid     publish / resubmit one of Your journal styles (P3a; 404 while the library is off)
  member  POST   /api/j2/template-gallery/examples/preview    paid     exactly what an example note of yours would show (P3b; 404 while its switch is off)
  member  POST   /api/j2/template-gallery/examples            paid     publish / resubmit a note as an example of one of your styles (P3b; 404 while off)
  member  GET    /api/j2/template-gallery/layouts/status      paid     the member's own shared page layouts (P4b; 404 while layout sharing is off)
  member  POST   /api/j2/template-gallery/layouts             paid     share / reshare a page of their saved layout (P4b; 404 while off; publish budget)
  member  GET    /api/j2/template-gallery/updates             paid     the adopted styles with a newer listed version (P3a; 404 while the library is off)
  member  GET    /api/j2/template-gallery/updates/{style_id}  paid     the preview of "Update my copy" (P3a; 404 while off)
  member  POST   /api/j2/template-gallery/updates/{style_id}  paid     apply that update (P3a; 404 while off)
  member  DELETE /api/j2/template-gallery/{gallery_id}        session  unpublish (always possible)
  member  POST   /api/j2/template-gallery/{gallery_id}/use    paid     copy into Your templates
  member  POST   /api/j2/template-gallery/{gallery_id}/adopt  paid     adopt a listed style as the member's own copy (P3a; 404 while off)
  member  POST   /api/j2/template-gallery/{gallery_id}/adopt-layout  paid  the listed layout of a shared page (P4b; 404 while layout sharing is off; adopt budget)
  member  POST   /api/j2/template-gallery/{gallery_id}/report paid     report a listed template
  member  POST   /api/j2/template-gallery/{gallery_id}/helpful paid    mark a listed item helpful (P3a; 404 while off; 60/hour)
  member  DELETE /api/j2/template-gallery/{gallery_id}/helpful paid    take the mark back (P3a; 404 while off; same budget)
  member  GET    /api/j2/template-gallery/feed                paid     what the authors you follow have listed (P3a; 404 while off)
  member  GET    /api/j2/template-gallery/authors/{handle}    paid     an author's page by opaque handle (P3a; 404 while off)
  member  POST   /api/j2/template-gallery/authors/{handle}/follow   paid  follow an author (P3a; 404 while off; 60/hour)
  member  DELETE /api/j2/template-gallery/authors/{handle}/follow   paid  stop following (P3a; 404 while off; same budget)
  Wave 11 (Task 11.12; each 404 while wave 11 or the library is off, read per request, before the plan and the body):
  member  POST   /api/j2/template-gallery/share/preview       paid     what sharing a widget/routine/tracker/template sends
  member  POST   /api/j2/template-gallery/tools               paid     share a widget, routine or tracker (publish budget)
  member  GET    /api/j2/template-gallery/library             paid     the official templates by group (?group=)
  member  POST   /api/j2/template-gallery/tools/updates/{kind}/{copy_id}  paid  take the listed version into a copy
  member  GET    /api/j2/template-gallery/notes/{note_id}/helpful-prompt  paid  the 3rd-day line (read-only)
  member  POST   /api/j2/template-gallery/{gallery_id}/preview-mine   paid  preview with my data (preview budget)
  member  POST   /api/j2/template-gallery/{gallery_id}/adopt-tool     paid  adopt a listed tool (adopt budget)
  member  POST   /api/j2/template-gallery/{gallery_id}/use-template   paid  make a note from a template (adopt budget)
  member  POST   /api/j2/template-gallery/{gallery_id}/helpful-prompt paid  answer the 3rd-day line (Helpful budget)
  admin   GET    /api/j2/template-gallery/admin/queue                  pending, reported, hidden
  admin   PATCH  /api/j2/template-gallery/admin/items/{gallery_id}     approve|reject|hide|unhide|feature|unfeature
  admin   PATCH  /api/j2/template-gallery/admin/reports/{report_id}    hide|dismiss

The rules, the share and publish routers' (`notebook_shares.py`, `notebook_publish.py`):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` off answers the one
    404 for every route before the session, the plan or the body is read.
  * THE BODY IS READ INSIDE THE DEPENDENCY CHAIN -- the gate, then the member, then the body
    (`member_body` / `paid_body`), never a FastAPI body parameter, so a malformed body can
    never answer 422 ahead of the gate.
  * PLAN: browsing, previewing, using, reporting and publishing take this router's own
    `require_paid` (owner ruling 2026-10-02, "no free tier, everything is paywall"; security
    review I-7). UNPUBLISH DOES NOT, and that is a second ruling (2026-10-07): a member can
    always take their own content down, whatever their plan. It needs a session only.
  * RATE LIMITS, per member: publish 10/hour and report 30/hour in the in-process limiter
    (`public.enforce_rate`; ⚠️ PER-PROCESS STATE, scopes `notebook-gallery-publish` and
    `notebook-gallery-report` -- a second web process doubles both), plus a DURABLE daily cap
    each in `daily_usage_counters` (survives deploys; fails open on a database error). Adopting
    a style (P3a) is 30/hour in `notebook-gallery-adopt` and a durable 50/day. Helpful (`notebook-gallery-helpful`)
    and follow (`notebook-gallery-follow`) are 60/hour each, in-process only; marking and unmarking share a budget.
    Publishing an example note (P3b, R-P3b-8) SHARES the publish scopes: the same 10/hour and durable 10/day.
    Previewing one (P3b-F-R1) is 60/hour in `notebook-gallery-preview`, in-process only: each preview reduces
    the whole note, measured at up to ~3 s for a 200 KB worst case even once the scrub was made linear.
  * THE LITERAL `/updates`, `/feed`, `/examples`, `/layouts/...` AND `/authors/...` ROUTES COME BEFORE
    `/{gallery_id}`: a
    `GET /{gallery_id}` exists and would take "updates" or "feed" as an item id and answer its 404.
    Keep them above it.
  * Its paths are outside `/api/j2/notes/...`, so journal_two's `/api/j2/notes/{note_id}`
    cannot shadow them, and outside `/api/j2/note-templates/...`, whose `/{template_id}` would.
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from api.services import request_body_cap as body_cap
from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services import daily_counters
from api.services.journal_two import journal_styles as js
from api.services.journal_two import notes as notes_service
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two import template_library
from api.services.journal_two import template_preview
from api.services.journal_two import widget_definitions as wdefs
from api.services.journal_two import widget_request_body as wbody
from api.services.journal_two.notebook_widgets import notebook_widgets_wave_on
from api.services.journal_two.tool_errors import ToolError
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine.plan import PlanError, PlanTooNew

PUBLISH_RATE = "10/hour"
REPORT_RATE = "30/hour"
SCOPE_PUBLISH = "notebook-gallery-publish"
SCOPE_REPORT = "notebook-gallery-report"
DAILY_PUBLISH_SCOPE = "notebook_gallery_publish"
DAILY_REPORT_SCOPE = "notebook_gallery_report"
ADOPT_RATE = "30/hour"
SCOPE_ADOPT = "notebook-gallery-adopt"
DAILY_ADOPT_SCOPE = "notebook_gallery_adopt"
# R-P3-11: Helpful and follow are 60/hour each, in-process only (no durable daily count: a vote or a follow is
# a toggle, not a charge). Marking AND unmarking spend the same budget, so a toggle loop is bounded too.
HELPFUL_RATE = "60/hour"
SCOPE_HELPFUL = "notebook-gallery-helpful"
FOLLOW_RATE = "60/hour"
SCOPE_FOLLOW = "notebook-gallery-follow"
# P3b-F-R1 (final review C-1): an example's preview reduces the whole note each time -- on open, on every image
# switch and on every pause in a typed title -- and a 200 KB worst case still measured ~3 s once the scrub was made
# linear, all of it holding the one web process's GIL. Per member, in-process only (no durable count: a preview
# writes nothing and is not a charge), so a second process doubles it (the CLAUDE.md single-process roster).
PREVIEW_RATE = "60/hour"
SCOPE_PREVIEW = "notebook-gallery-preview"

HELPFUL_RATE_SENTENCE = "You've marked a lot of styles helpful. Try again later."
FOLLOW_RATE_SENTENCE = "You've followed or unfollowed a lot of authors. Try again later."
PUBLISH_RATE_SENTENCE = "You've published a lot to the community gallery today. Try again later."
REPORT_RATE_SENTENCE = "You've sent a lot of reports today. Try again later."
ADOPT_RATE_SENTENCE = "You've adopted a lot from the library today. Try again later."
PREVIEW_RATE_SENTENCE = "You've previewed a lot of example notes. Try again later."
MAX_BODY_BYTES = 256_000
TOO_LARGE_SENTENCE = "Request too large"


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, parses no body, and answers the one not-found."""
    if not gallery.enabled():
        raise public.not_found()


def _require_library() -> None:
    """P3a's gate for the STYLE routes (R-P3-10), a route dependency listed in `dependencies=[...]`, which
    FastAPI resolves before the route's own parameters (the plan check, the body): a library-off pod
    answers every caller, paid or not, signed in or not, with the one 404 that a route which does not
    exist answers. Nothing else enforces it -- a second copy in the handler would be a guard repeated."""
    if not gallery.library_enabled():
        raise public.not_found()


def _require_layout_sharing() -> None:
    """P4b's gate for the LAYOUT routes (R-P4b-10), the same shape as `_require_library`: a route dependency,
    resolved before the plan check and the body, so while layout sharing is off every caller, paid or not,
    signed in or not, gets the one 404 a route that does not exist answers."""
    if not gallery.layout_sharing_enabled():
        raise public.not_found()


def _require_example() -> None:
    """P3b's gate for the EXAMPLE routes (R-P3b-6), the same shape as `_require_library`: a route dependency, so
    an off switch (or the library off, which `example_enabled` includes) answers the one 404 before the plan
    check and the body."""
    if not gallery.example_enabled():
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
        raise HTTPException(status_code=402, detail="The community template gallery requires a paid plan",
                            headers={"Cache-Control": "no-store"})
    return user


async def _read_json(request: Request) -> dict[str, Any]:
    # ⛔ Capped WHILE it is read (wave 14, cap 2): this was `await request.body()`
    # then a length check, so a chunked or no-length body was buffered whole first.
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, TOO_LARGE_SENTENCE)
    if not raw.strip():
        return {}
    try:
        data = wbody.loads_plain_body(raw)      # F-ALIAS-1R A5: a body too deep to parse is its 400, never a 500
    except ValueError:
        raise HTTPException(status_code=422, detail="Send a JSON object", headers=dict(NO_STORE))
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object", headers=dict(NO_STORE))
    if wbody.unsavable_text(data):
        # Task 11.12 fix round 2 (I-A): a lone surrogate is the ONE body-reader refusal (`unsavable_text`), here in
        # this router's plain-sentence shape. It was a 500 on every door this reader serves.
        raise HTTPException(status_code=400, detail=wbody.bad_character_sentence(), headers=dict(NO_STORE))
    return data


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    return await _read_json(request)


async def library_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`/styles` and `/{id}/adopt` (Task 11.12 m-8): while wave 11 is on they carry wave 11's inputs (`edits`, `keep`,
    `answers`, `choices`), so the body is read by the wave 11 reader (16 KB, depth 16); off, by today's."""
    if _w11_on():
        return await w11_body(request, _user)
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


def _hit(limit: str, scope: str, user: dict, sentence: str, *, w11: bool = False) -> None:
    """THE in-process rate rule of this router: one `public.enforce_rate` hit, keyed on the member. `w11` only
    changes the SHAPE of the 429 (a wave 11 door answers `{code: rate, message}` with no-store); the bucket and
    the count are the same, so a scope shared by an old and a wave 11 door is one budget."""
    try:
        public.enforce_rate(limit, scope, f"member:{user['id']}", sentence, public=False)
    except HTTPException as e:
        if w11 and e.status_code == 429:
            raise _err(429, "rate", sentence) from None
        raise


def _daily_take(scope: str, user: dict, cap_env: str, default: int, sentence: str, *, w11: bool = False) -> str:
    """One durable charge for today (ET), or a 429 with the plain sentence (`{code: rate}` for a wave 11 door).
    Returns the day so a refused write can give the charge back."""
    from api.services.journal_two.calendar import et_today
    day = et_today()
    refused = daily_counters.take(day, [daily_counters.Charge(scope, str(user["id"]), 1, _cap(cap_env, default))])
    if refused is not None:
        if w11:
            raise _err(429, "rate", sentence)
        raise HTTPException(status_code=429, detail=sentence)
    return day


def _give_back(day: str, scope: str, user: dict) -> None:
    daily_counters.give_back(day, [daily_counters.Charge(scope, str(user["id"]), 1)])


def _bad(e: gallery.GalleryError) -> HTTPException:
    """Wave 11 (carry 3): a conflict that carries a machine code (`helpful_days`) answers `{code, message}`; every
    other refusal keeps today's plain-sentence detail."""
    if isinstance(e, gallery.GalleryConflict) and getattr(e, "code", None):
        return HTTPException(status_code=409, detail={"code": e.code, "message": str(e)}, headers=dict(NO_STORE))
    return HTTPException(status_code=409 if isinstance(e, gallery.GalleryConflict) else 400, detail=str(e))


def _server_error(e: gallery.GalleryServerError) -> HTTPException:
    """P3b Task 4: a failure the member cannot fix (an example's image copy or move), answered 500 with its sentence."""
    return HTTPException(status_code=500, detail=str(e))


def _charged_publish(user: dict, publish: Any, *, w11: bool = False) -> Any:
    """ONE charge rule for every publish route -- an outline, a style, an example note, a layout, and since wave 11
    a widget, routine or tracker (`POST /tools`) and a template (P3b review M-7): the in-process 10/hour, then one
    durable charge for today, then `publish()`. A refusal of any kind gives the day's charge back: a 400 or 409
    (`GalleryError`), a 404 (`None`), and an unexpected failure too, so a typo or a server fault never costs a
    member a slot. Returns what `publish()` returned. `w11` (Task 11.12) only shapes the 429s for a wave 11 door;
    such a door hands in a `publish` already wrapped in `_w11`, so its refusals arrive mapped."""
    _hit(PUBLISH_RATE, SCOPE_PUBLISH, user, PUBLISH_RATE_SENTENCE, w11=w11)
    day = _daily_take(DAILY_PUBLISH_SCOPE, user, "NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", 10, PUBLISH_RATE_SENTENCE,
                      w11=w11)
    try:
        item = publish()
    except gallery.GalleryError as e:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise _bad(e)
    except gallery.GalleryServerError as e:          # P3b Task 4: `Couldn't copy an image. Nothing was shared.`
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise _server_error(e)
    except Exception:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise
    if item is None:
        _give_back(day, DAILY_PUBLISH_SCOPE, user)
        raise public.not_found()
    return item


# ── every member ────────────────────────────────────────────────────────────────────────

@router.get("")
def list_gallery_endpoint(q: str = "", category: str = "", sort: str = "newest", section: str = "all",
                          item_type: str = Query("", alias="type"), trading_style: str = "",
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    """The gallery as this member sees it; `viewer.admin` lets the client show the review
    queue's door (the queue itself is admin-gated on the server). P3a: `?type=outline|style` and
    `?trading_style=` are the library's chips; the service refuses both style filters with a 400 while the
    library is off (R-P3-10). Before P3a both were unknown parameters, ignored with a 200; no client sends
    either while the switch is off, so a member sees today's gallery (final review M-13, item 4).

    P4b: `capabilities.layoutSharing` is the server-only layout-sharing switch as this answer saw it (R-P4b-10);
    the lazy library reads it from here, so it costs the first-open closure nothing. `?type=page_layout` passes
    the service's own check, which refuses it (400) while that switch is off."""
    try:
        items = gallery.list_gallery(user["id"], q=q, category=category or None, sort=sort,
                                     section=section, item_type=item_type or None,
                                     trading_style=trading_style or None, is_admin=_is_admin(user))
    except gallery.GalleryError as e:
        raise _bad(e)
    # R-P3b-6 (ruling P3b-R6): what the lazy library may offer, additively. A client reads a missing key as false.
    # Wave 11 (Task 11.12): each card's `contains` and the viewer's `credit` (`_card_facts`; unchanged while off).
    return {"templates": _card_facts(user["id"], items), "viewer": {"admin": _is_admin(user)},
            "capabilities": {"exampleNotes": gallery.example_enabled(),
                             "layoutSharing": gallery.layout_sharing_enabled()}}


@router.get("/admin/queue")
def admin_queue_endpoint(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    return gallery.admin_queue()


@router.post("/styles", dependencies=[Depends(_require_library)])
def publish_style_endpoint(body: dict[str, Any] = Depends(library_body), user: dict = Depends(require_paid)) -> Any:
    """`{styleId, title, description?, category, tradingStyle?}` -> a PENDING style item, or a
    held revision of an approved one. 404 for everyone while the library is off (R-P3-10), by the
    `_require_library` route dependency, before the plan check and the body.

    Wave 11 (Task 11.12): while wave 11 is on the author's share-preview answers travel too (`edits`, `keep`,
    W11-R6), every refusal answers from its class (`_w11`: a `ShareError` is 400 with its code), and the answer adds
    `droppedSlots` and is `no-store`. Off, exactly today's route."""
    if not _w11_on():
        item = _charged_publish(user, lambda: gallery.publish_style(
            user["id"], body.get("styleId"), title=body.get("title"), description=body.get("description"),
            category=body.get("category"), trading_style=body.get("tradingStyle")))
        dropped = item.pop("droppedProperties", 0)
        return {"template": item, "droppedProperties": dropped}
    item = _charged_publish(user, lambda: _w11(lambda: gallery.publish_style(
        user["id"], body.get("styleId"), title=body.get("title"), description=body.get("description"),
        category=body.get("category"), trading_style=body.get("tradingStyle"), edits=body.get("edits"),
        keep=_keep(body))), w11=True)
    dropped = item.pop("droppedProperties", 0)
    out = {"template": item, "droppedProperties": dropped}
    if "droppedSlots" in item:
        out["droppedSlots"] = item.pop("droppedSlots")
    return _ok(out)


# ⛔ P4b: the literal `/layouts` routes are declared BEFORE `GET /{gallery_id}` too, each gated by
# `_require_layout_sharing` (R-P4b-10), a route dependency ahead of the plan check and the body.

@router.get("/layouts/status", dependencies=[Depends(_require_layout_sharing)])
def layout_status_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{shared: {today, trade}}` -- each the member's own layout item for that page (with `status`, `version` and
    `hasRevision`), or null when they have not shared it."""
    status = gallery.layout_status(user["id"])
    if status is None:
        raise public.not_found()
    return status


@router.post("/layouts", dependencies=[Depends(_require_layout_sharing)])
def publish_layout_endpoint(body: dict[str, Any] = Depends(paid_body),
                            user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{page, title, description?, category, tradingStyle?}` -> `{template, droppedPanels}`. The SERVER builds the
    layout from the member's own saved preference (R-P4b-3/4); the client names only the page. It spends the
    publish budget through `_charged_publish`, the one charge rule every publish route uses (P4b final m-2), so
    any refusal, a server error included, gives the day's charge back."""
    item = _charged_publish(user, lambda: gallery.publish_layout(
        user["id"], body.get("page"), title=body.get("title"), description=body.get("description"),
        category=body.get("category"), trading_style=body.get("tradingStyle")))
    dropped = item.pop("droppedPanels", 0)
    return {"template": item, "droppedPanels": dropped}


# ⛔ The literal `/examples` routes (P3b) are declared BEFORE `/{gallery_id}`, and gated by `_require_example`, a
# route dependency: an off switch answers every caller the one 404 before the plan check and the body. The body is
# `{noteId, imagesOn}` / `{noteId, styleItemId, imagesOn, title}`; the SERVER reads and reduces the note, and any
# body a client sends alongside is ignored (R-P3b, Global Constraints).

IMAGES_ON_SENTENCE = "imagesOn must be a list of image addresses."
MAX_IMAGES_ON = 100
MAX_IMAGE_ADDRESS_CHARS = 2048


def _images_on(body: dict[str, Any]) -> list[str]:
    """The ORIGINAL addresses of the images the author switched on. Absent is none; anything but a short list of
    non-empty strings is a 400. Which of them the example may keep is the reducer's decision, not this one's."""
    raw = body.get("imagesOn")
    if raw is None:
        return []
    if (not isinstance(raw, list) or len(raw) > MAX_IMAGES_ON
            or not all(isinstance(s, str) and 0 < len(s) <= MAX_IMAGE_ADDRESS_CHARS for s in raw)):
        raise HTTPException(status_code=400, detail=IMAGES_ON_SENTENCE)
    return raw


@router.post("/examples/preview", dependencies=[Depends(_require_example)])
def preview_example_endpoint(body: dict[str, Any] = Depends(paid_body),
                             user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{noteId, imagesOn?, title?}` -> `{bodyJson, changes, counts, images, title}`: exactly what other members
    would see, for the author, the title included (the note's own when none is sent). Writes nothing. 404 when
    the note is not theirs, not live, or the sample notebook's; 400 for a note too long to be an example, or a
    raw title over 2,000 characters. `{noteId, title, titleOnly: true}` -> `{title}`: the title alone (P3b-F2-R2).

    Its cost is bounded three ways: a note over the example ceiling is refused before it is reduced, it is
    reduced once, in linear time (P3b-F-R1), and a member may run `PREVIEW_RATE` of them (429 after; P3b-F-R1
    reversed review M-2's "not rate-limited", whose premise -- the size bounds the cost -- the final review's
    measurement disproved)."""
    # P3b-F2-R2: `titleOnly: true` scrubs the typed title alone (at most 2,000 characters) and reduces nothing of the
    # note, so it is not charged to the preview budget: typing a title never spends the whole-note reductions.
    title_only = body.get("titleOnly") is True
    if not title_only:
        public.enforce_rate(PREVIEW_RATE, SCOPE_PREVIEW, f"member:{user['id']}", PREVIEW_RATE_SENTENCE, public=False)
    try:
        if title_only:
            out = gallery.preview_example_title(None, user["id"], body.get("noteId"), body.get("title"))
        else:
            out = gallery.preview_example(None, user["id"], body.get("noteId"), _images_on(body), body.get("title"))
    except gallery.GalleryError as e:
        raise _bad(e)
    if out is None:
        raise public.not_found()
    return out


@router.post("/examples", dependencies=[Depends(_require_example)])
def publish_example_endpoint(body: dict[str, Any] = Depends(paid_body),
                             user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{noteId, styleItemId, imagesOn?, title}` -> `{template}`: a PENDING example note linked to the style, or a
    held revision of an approved one. 400 for a style that is not theirs to link or a note of another kind; 404 for
    a note that may not be an example. Rate-limited with sharing a style (R-P3b-8); a refused or failed publish
    gives the day's charge back."""
    images_on = _images_on(body)
    item = _charged_publish(user, lambda: gallery.publish_example(
        None, user["id"], body.get("noteId"), body.get("styleItemId"), images_on, body.get("title")))
    return {"template": item}


# ⛔ The literal `/updates` routes are declared BEFORE `GET /{gallery_id}`: that route would take "updates"
# as an item id and answer its 404. Each is gated by `_require_library` (R-P3-10), a route dependency, so a
# library-off pod answers every caller with the one 404 before the plan check and the body.

@router.get("/updates", dependencies=[Depends(_require_library)])
def list_updates_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{updates: [{galleryId, title, styleId, styleName, fromVersion, toVersion}]}` -- the member's adopted
    styles whose community item is now listed at a higher version."""
    return {"updates": gallery.list_updates(user["id"])}


@router.get("/updates/{style_id}", dependencies=[Depends(_require_library)])
def plan_update_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{plan}` -- what "Update my copy" would add. 404 when the style is not an adopted copy of theirs or
    nothing newer is listed."""
    plan = gallery.plan_update(user["id"], style_id)
    if plan is None:
        raise public.not_found()
    return {"plan": plan}


TO_VERSION_SENTENCE = "Say which version you previewed: toVersion must be a whole number."


@router.post("/updates/{style_id}", dependencies=[Depends(_require_library)])
def apply_update_endpoint(style_id: str, body: dict[str, Any] = Depends(paid_body),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{takeOutline?: bool, baseUpdatedAt, toVersion: int}` -> `{style}`. 409 when the copy changed since the
    preview (`baseUpdatedAt` is the `updatedAt` the member previewed against) or a newer version is listed than
    the `toVersion` they previewed; 404 when there is nothing to apply. `toVersion` is REQUIRED (ruling
    P3a-T10-R4): the library never shipped, so no client predates it, and an optional field would let any caller
    that omits it apply a version it never previewed (M-8)."""
    take_outline = body.get("takeOutline", False)
    if take_outline is None:
        take_outline = False
    if not isinstance(take_outline, bool):
        raise HTTPException(status_code=400, detail="takeOutline must be true or false")
    to_version = body.get("toVersion")
    if isinstance(to_version, bool) or not isinstance(to_version, int):
        raise HTTPException(status_code=400, detail=TO_VERSION_SENTENCE)
    try:
        style = gallery.apply_update(user["id"], style_id, take_outline=take_outline,
                                     base_updated_at=body.get("baseUpdatedAt"), to_version=to_version)
    except gallery.GalleryError as e:
        raise _bad(e)
    if style is None:
        raise public.not_found()
    return {"style": style}


# ⛔ `/feed` and `/authors/...` (P3a Task 6) are literal paths too, declared BEFORE `GET /{gallery_id}`, and gated
# the same way: `_require_library` ahead of the plan check (R-P3-10). Nothing here returns a user id or an
# email (R-P3-2): an author is the opaque handle.

@router.get("/feed", dependencies=[Depends(_require_library)])
def feed_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{templates: [...]}` -- what the authors this member follows have listed, newest first. The same item
    shape as the gallery list, so one card renders both."""
    return {"templates": _card_facts(user["id"], gallery.feed(user["id"]))}


@router.get("/authors/{handle}", dependencies=[Depends(_require_library)])
def author_page_endpoint(handle: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{author: {handle, label, itemCount, following, mine}, items: [...]}` -- 404 for a handle that is not one."""
    page = gallery.author_page(user["id"], handle)
    if page is None:
        raise public.not_found()
    if isinstance(page.get("items"), list):
        page = {**page, "items": _card_facts(user["id"], page["items"])}
    return page


@router.post("/authors/{handle}/follow", dependencies=[Depends(_require_library)])
def follow_endpoint(handle: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{following: true}`. 404 for an unknown handle or your own (R-P3-11: 60/hour with unfollow)."""
    public.enforce_rate(FOLLOW_RATE, SCOPE_FOLLOW, f"member:{user['id']}", FOLLOW_RATE_SENTENCE, public=False)
    out = gallery.set_follow(user["id"], handle, True)
    if out is None:
        raise public.not_found()
    return out


@router.delete("/authors/{handle}/follow", dependencies=[Depends(_require_library)])
def unfollow_endpoint(handle: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{following: false}`. The same 404s and the same budget as following."""
    public.enforce_rate(FOLLOW_RATE, SCOPE_FOLLOW, f"member:{user['id']}", FOLLOW_RATE_SENTENCE, public=False)
    out = gallery.set_follow(user["id"], handle, False)
    if out is None:
        raise public.not_found()
    return out


# ── wave 11 (Task 11.12): sharing, adopting, using and previewing templates ─────────────────────
#
# ⛔ Every route in this block carries `_require_w11` in `dependencies=[...]`: while wave 11
# (`notebook_widgets_wave_on(11)`) or the library switch is off, every caller gets the one `public.not_found()` 404,
# read PER REQUEST, before the plan check and before the body is read (11.11 m-3). The literal paths are declared
# here, ABOVE `GET /{gallery_id}`, so "library", "share", "tools" and "notes" are never read as an item id.
#   * BODIES: `w11_body`, at most W11_MAX_BODY_BYTES and W11_MAX_BODY_DEPTH levels (413 / 400 `invalid`).
#   * ERRORS: `{"detail": {"code", "message"}}` from the refusal's CLASS (W9-R14: a `ToolError`'s own `status`,
#     `code` and `sentence`, a `ShareError`'s `slot` beside them), never by matching a sentence. ⛔ A refusal's
#     sentence is never logged or stored (R35: it may echo the author's own words).
#   * Every 200 and every error carries `Cache-Control: no-store` (`_ok`, `_err`, `public.not_found()`, the 402).
#   * RATES (in-process, ⚠️ PER-PROCESS STATE): the share preview and preview with my data spend
#     `notebook-gallery-preview` (60/hour), and preview with my data also `notebook-gallery-preview-mine`
#     (PREVIEW_MINE_RATE, its own short window, 11.9 m-1); publishing a tool spends the publish scope (10/hour plus
#     the durable 10/day); adopting a tool and using a template the adopt budget (30/hour plus the durable 50/day);
#     a library update the adopt scope's hourly half; the 3rd-day answer the Helpful scope.
#   * IDEMPOTENCY (W11-R34): `Idempotency-Key` is read and passed as `key=` to `adopt_tool`, `adopt_style` and
#     `use_library_template`; a malformed key is ignored, the existing create-key rule (`create_keys`).

NO_STORE = {"Cache-Control": "no-store"}
W11_MAX_BODY_BYTES = 16 * 1024
W11_MAX_BODY_DEPTH = 16
PREVIEW_MINE_RATE = "10/minute"
SCOPE_PREVIEW_MINE = "notebook-gallery-preview-mine"
NOTIFY_SENTENCE = "notify must be true or false"
#: m-2: the wave 11 previews' 429 (the plan's words for the preview scope); the scope is shared with P3b's example
#: preview, whose own sentence stays its own.
W11_PREVIEW_RATE_SENTENCE = "Too many previews in an hour. Try again later."
PREVIEW_MINE_RATE_SENTENCE = "Too many previews at once. Try again in a minute."
NOTE_CONFLICT_SENTENCE = "That note changed while it was being made. Try again."
#: I-1: a Use's own note fields (`title`, `ticker`); anything else in the body is not a note field.
TITLE_TEXT_SENTENCE = "title must be text"
#: The new paths this block adds (the 404 rail enumerates the router's routes against it).
W11_PATHS = (
    "/share/preview", "/tools", "/library", "/tools/updates/{kind}/{copy_id}", "/notes/{note_id}/helpful-prompt",
    "/{gallery_id}/preview-mine", "/{gallery_id}/adopt-tool", "/{gallery_id}/use-template",
    "/{gallery_id}/helpful-prompt",
)


def _w11_on() -> bool:
    """Wave 11 AND the library switch, read per call (both are needed by every wave 11 door)."""
    return gallery.library_enabled() and notebook_widgets_wave_on(11)


def _require_w11() -> None:
    """The wave 11 gate, a route dependency (resolved after the router's gate, before the plan check and the
    body): off, every caller gets the one 404 a route that does not exist answers."""
    if not _w11_on():
        raise public.not_found()


def _err(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra},
                         headers=dict(NO_STORE))


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=dict(NO_STORE))


async def w11_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    """The gate, then the member, then the body: at most W11_MAX_BODY_BYTES, W11_MAX_BODY_DEPTH deep."""
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, W11_MAX_BODY_BYTES, TOO_LARGE_SENTENCE), W11_MAX_BODY_DEPTH, _err)


def _w11(fn) -> Any:
    """Run `fn()`; answer every refusal from its CLASS (W9-R14). None is the one 404."""
    try:
        out = fn()
    except HTTPException:
        raise
    except ToolError as e:          # ShareError, LibraryError, CountCapError, KeyReused, RoutineError, TrackerError
        if e.status == 404:
            raise public.not_found()
        slot = getattr(e, "slot", None)
        raise _err(e.status, e.code, e.sentence, **({"slot": slot} if isinstance(slot, str) and slot else {}))
    except gallery.GalleryConflict as e:
        raise _err(409, getattr(e, "code", None) or "conflict", str(e))
    except gallery.GalleryError as e:
        raise _err(400, "invalid", str(e))
    except gallery.GalleryServerError as e:
        raise _err(500, "server", str(e))
    except wdefs.WidgetError as e:
        # m-3: by STATUS only (W9-R14). The widget store's cap never reaches here as a WidgetError: every wave 11
        # door that can make a widget wraps it in `CountCapError` (`template_gallery._cap_sentence`).
        if e.status == 404:
            raise public.not_found()
        raise _err(409 if e.status == 409 else 400, "conflict" if e.status == 409 else "invalid", e.sentence)
    except notes_service.NoteValidationError as e:     # I-1: a Use's note fields, refused by the notes module
        raise _err(400, "invalid", str(e))
    except notes_service.NoteConflictError:
        raise _err(409, "conflict", NOTE_CONFLICT_SENTENCE)
    except notes_service.NoteLockedError as e:
        raise _err(423, "locked", str(e))
    except js.StyleNotFound:
        raise public.not_found()
    except js.StyleValidationError as e:
        raise _err(400, "invalid", str(e))
    except PlanTooNew as e:
        raise _err(409, "too_new", e.sentence)
    except PlanError as e:
        raise _err(400, "invalid", e.sentence)
    except wrun.EngineBusy as e:
        raise _err(503, "busy", e.sentence)
    except wrun.EngineTooLong as e:
        raise _err(503, "too_long", e.sentence)
    if out is None:
        raise public.not_found()
    return out


def _key(request: Request) -> str | None:
    """W11-R34: the request's `Idempotency-Key`, as sent (the service applies the one uuid4 rule)."""
    return request.headers.get(gallery.IDEMPOTENCY_HEADER)


def _notify(body: dict) -> bool:
    notify = body.get("notify", False)
    if notify is None:
        return False
    if not isinstance(notify, bool):
        raise _err(400, "invalid", NOTIFY_SENTENCE)
    return notify


def _note_fields(body: dict) -> dict:
    """I-1: a Use's note fields, checked BEFORE any charge by the notes module's own rules: the ticker by
    `notes.validate_ticker` (type, length, grammar) and the title by type and `notes.validate_title`. A refusal is
    400 `invalid`; a Use never answers 500 for what a member typed."""
    out: dict = {}
    if "title" in body and body["title"] is not None:
        title = body["title"]
        if not isinstance(title, str):
            raise _err(400, "invalid", TITLE_TEXT_SENTENCE)
        try:
            notes_service.validate_title(title)                 # the notes module's one rule and sentence (A3)
        except notes_service.NoteValidationError as e:
            raise _err(400, "invalid", str(e))
        out["title"] = title
    if "ticker" in body:
        try:
            ticker = notes_service.validate_ticker(body["ticker"])
        except notes_service.NoteValidationError as e:
            raise _err(400, "invalid", str(e))
        if ticker is not None:
            out["ticker"] = ticker
    return out


def _keep(body: dict) -> Any:
    keep = body.get("keep")
    return () if keep is None else keep


# ── card facts (carry: `_summary` gains `contains` and the viewer's `credit`) ───────────────────────
#
# `_summary` already carries `usedBy` (the distinct-use count; the client words 0 as "New") and `updatedAt`. While
# wave 11 is on every card ALSO carries `contains` (the names its reduced payload places: each inline widget,
# routine and tracker by its shared name, a ready-made widget by its shelf name, a template routine or tracker by
# its template's name, a check-in by the check-in's) and, on an item the viewer holds a copy of, that copy's
# `credit` (W11-R7, the copy's snapshot). ⛔ The names are read INSIDE SQLite (`json_each` over the stored payload,
# guarded by `json_valid`): the list never parses a whole payload in Python (security review M-6).

_PARTS_SQL = (
    "SELECT g.id, '{part}', json_extract(p.value, '$.key'), json_extract(p.value, '$.name'),"
    " json_extract(p.value, '$.plan') FROM j2_template_gallery g, json_each(CASE WHEN json_valid(g.payload_json)"
    " THEN g.payload_json ELSE '{{}}' END, '$.{part}') p WHERE g.id IN ({marks}) AND g.item_type = 'style'"
    " AND json_type(p.value) = 'object'")
_BLOCKS_SQL = (
    "SELECT g.id, p.value FROM j2_template_gallery g, json_each(CASE WHEN json_valid(g.payload_json)"
    " THEN g.payload_json ELSE '{{}}' END, '$.blocks') p WHERE g.id IN ({marks}) AND g.item_type = 'style'"
    " AND json_valid(g.payload_json) AND json_extract(g.payload_json, '$.format') = 2"
    " AND json_type(p.value) = 'object' ORDER BY g.id, CAST(p.key AS INTEGER)")


def _part_name(family: str, settings: dict, block: dict, parts: dict) -> str | None:
    from api.services.journal_two import slot_fill, template_tools, trackers
    if family == "built":
        ref = settings.get("ref") if isinstance(settings.get("ref"), str) else ""
        if ref.startswith("inline:"):
            return (parts.get(("definitions", ref[len("inline:"):])) or (None,))[0]
        if ref.startswith("shelf:"):
            try:
                name, _reason = slot_fill.slot_name(block, {})
            except Exception:          # noqa: BLE001 -- an unreadable shelf ref names nothing
                return None
            return name
        return None
    pool = "routines" if family == "routine" else "trackers"
    if isinstance(settings.get("inline"), str):
        return (parts.get((pool, settings["inline"])) or (None,))[0]
    templates = template_tools.ROUTINE_TEMPLATES if family == "routine" else template_tools.TRACKER_TEMPLATES
    if isinstance(settings.get("template"), str) and settings["template"] in templates:
        return templates[settings["template"]].get("name")
    ref = settings.get("ref")
    if family == "tracker" and isinstance(ref, str) and ref in trackers.BUILTIN:
        return trackers.BUILTIN[ref].get("name")
    return None


def _contains(conn, ids: list[str]) -> dict[str, list[str]]:
    """{item id: [names]} for the template items among `ids`, in block order, each name once."""
    if not ids:
        return {}
    marks = ", ".join("?" for _ in ids)
    parts: dict[str, dict] = {}
    for part in ("definitions", "routines", "trackers"):
        for gid, kind, key, name, plan in conn.execute(_PARTS_SQL.format(part=part, marks=marks), ids):
            if isinstance(key, str):
                parts.setdefault(gid, {})[(kind, key)] = (name if isinstance(name, str) and name.strip() else None,
                                                          plan)
    out: dict[str, list[str]] = {}
    for gid, raw in conn.execute(_BLOCKS_SQL.format(marks=marks), ids):
        try:
            block = json.loads(raw)
        except (TypeError, ValueError):
            continue
        family = js.slot_family(block.get("block")) if isinstance(block, dict) else None
        settings = block.get("settings") if family and isinstance(block.get("settings"), dict) else None
        if settings is None:
            continue
        mine = parts.get(gid, {})
        try:
            defs = {k: {"plan": json.loads(p) if isinstance(p, str) else p}
                    for (kind, k), (_n, p) in mine.items() if kind == "definitions"}
            if js.slot_wave_off(block["block"], settings, {"definitions": defs}):
                continue                                  # a dark family is never named (flags-off rule)
        except Exception:          # noqa: BLE001 -- an unreadable slot names nothing
            continue
        name = _part_name(family, settings, block, mine)
        names = out.setdefault(gid, [])
        if isinstance(name, str) and name.strip() and name.strip() not in names:
            names.append(name.strip())
    return out


def _viewer_credits(conn, user_id: str, items: list[dict]) -> dict[str, str]:
    """{item id: the credit of the viewer's newest copy of it} (W11-R7, the copy's snapshot). m-6: ONE read of the
    viewer's credit rows, then ONE `library_facts` call per copy kind (at most four), never a read per copy."""
    kinds = {i["id"]: ("template" if i.get("itemType") == "style" else gallery.TOOL_KIND_OF.get(i.get("itemType")))
             for i in items if not i.get("mine") and isinstance(i.get("id"), str)}
    kinds = {k: v for k, v in kinds.items() if v}
    if not kinds:
        return {}
    marks = ", ".join("?" for _ in kinds)
    newest: dict[str, tuple[str, str]] = {}
    for gid, kind, tool_id in conn.execute(
            "SELECT gallery_id, tool_kind, tool_id FROM j2_gallery_credits WHERE user_id = ? AND gallery_id IN"
            f" ({marks}) ORDER BY created_at, rowid", (user_id, *kinds)):
        if kinds.get(gid) == kind:
            newest[gid] = (kind, tool_id)
    by_kind: dict[str, list[str]] = {}
    for kind, tool_id in newest.values():
        by_kind.setdefault(kind, []).append(tool_id)
    facts = {kind: gallery.library_facts(user_id, kind, ids, conn=conn) for kind, ids in by_kind.items()}
    out = {}
    for gid, (kind, tool_id) in newest.items():
        credit = (facts.get(kind, {}).get(tool_id) or {}).get("credit")
        if credit:
            out[gid] = credit
    return out


def _card_facts(user_id: str, items: list[dict], *, in_yours: bool = False) -> list[dict]:
    """The list cards with `contains` and the viewer's `credit` (and, for the library, `inYourTemplates`), in a
    constant number of statements plus one credit read per held copy. Wave 11 off: the cards exactly as they were."""
    if not items or not _w11_on():
        return items
    from api.services.auth_db import get_connection
    ids = [i["id"] for i in items if isinstance(i.get("id"), str)]
    conn = get_connection()
    try:
        names = _contains(conn, ids)
        credits = _viewer_credits(conn, user_id, items)
        held: set = set()
        if in_yours and ids:
            held = {r[0] for r in conn.execute(
                "SELECT DISTINCT source_gallery_id FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL"
                f" AND archived_at IS NULL AND source_gallery_id IN ({', '.join('?' for _ in ids)})",
                (user_id, *ids))}
    finally:
        conn.close()
    out = []
    for i in items:
        card = {**i, "contains": names.get(i.get("id"), [])}
        if i.get("id") in credits:
            card["credit"] = credits[i["id"]]
        if in_yours:
            card["inYourTemplates"] = i.get("id") in held
        out.append(card)
    return out


# ── the wave 11 routes ──────────────────────────────────────────────────────────────────────────────

@router.post("/share/preview", dependencies=[Depends(_require_w11)])
def share_preview_endpoint(body: dict[str, Any] = Depends(w11_body),
                           user: dict = Depends(require_paid)) -> JSONResponse:
    """`{kind, id, edits?, keep?}` -> `{travels, slots, kept, notShared, prefill, outline?, outlineGone?,
    droppedSlots?, droppedProperties?}` (W11-R22): what sharing one of the member's own widgets, routines, trackers
    or templates would send. The author only; nothing is written or stored."""
    _hit(PREVIEW_RATE, SCOPE_PREVIEW, user, W11_PREVIEW_RATE_SENTENCE, w11=True)
    return _ok(_w11(lambda: gallery.share_preview(user["id"], body.get("kind"), body.get("id"),
                                                  edits=body.get("edits"), keep=_keep(body))))


@router.post("/tools", dependencies=[Depends(_require_w11)])
def publish_tool_endpoint(body: dict[str, Any] = Depends(w11_body),
                          user: dict = Depends(require_paid)) -> JSONResponse:
    """`{kind, id, title, description?, edits, keep?}` -> `{template}`: a PENDING widget, routine or tracker item
    (or a held revision of an approved one). ⛔ The LISTED title is the reduced payload's (11.15 M-6), never
    `title` as sent: the service fills only what the payload leaves blank."""
    item = _charged_publish(user, lambda: _w11(lambda: gallery.publish_tool(
        user["id"], body.get("kind"), body.get("id"), title=body.get("title"), description=body.get("description"),
        edits=body.get("edits"), keep=_keep(body))), w11=True)
    return _ok({"template": item})


@router.get("/library", dependencies=[Depends(_require_w11)])
def library_endpoint(group: str = "", user: dict = Depends(require_paid)) -> JSONResponse:
    """`?group=` -> `{templates, groups}`: the official templates (W11-R4), approved and visible, in
    `template_library.GROUPS` order (one group with `group`), each the gallery's summary with `group`, `contains`
    and `inYourTemplates` (the member holds a live copy)."""
    keys = template_library.GROUP_KEYS
    if group and group not in keys:
        raise _err(400, "invalid", "Unknown group.")
    # m-6: ONE list read across every group, put in GROUPS order (stable: newest first inside a group). The list is
    # capped at `LIST_LIMIT` rows; only a capped answer (which could have cut an official row) is re-read per group.
    order = {k: i for i, k in enumerate(keys)}

    def official(listed: list[dict]) -> list[dict]:
        return [r for r in listed if r.get("firm") and r.get("group") in order]
    listed = _w11(lambda: gallery.list_gallery(user["id"], item_type="style", group=group or None,
                                               is_admin=_is_admin(user)))
    if len(listed) >= gallery.LIST_LIMIT and not group:
        listed = [r for g in keys for r in _w11(lambda: gallery.list_gallery(
            user["id"], item_type="style", group=g, is_admin=_is_admin(user)))]
    rows = sorted(official(listed), key=lambda r: order[r["group"]])
    return _ok({"templates": _card_facts(user["id"], rows, in_yours=True),
                "groups": [{"key": k, "label": label} for k, label in template_library.GROUPS]})


@router.post("/tools/updates/{kind}/{copy_id}", dependencies=[Depends(_require_w11)])
def update_tool_endpoint(kind: str, copy_id: str, body: dict[str, Any] = Depends(w11_body),
                         user: dict = Depends(require_paid)) -> JSONResponse:
    """`{answers?}` -> `{kind, id, version, tool}`: the LISTED version taken into the member's adopted copy. A new
    choice left unanswered is 400 `unresolved` (the client then opens "Make it yours" for the copy); 404 when the
    copy is not the member's library copy or nothing newer is listed."""
    _hit(ADOPT_RATE, SCOPE_ADOPT, user, ADOPT_RATE_SENTENCE, w11=True)
    return _ok(_w11(lambda: gallery.update_tool(user["id"], kind, copy_id, answers=body.get("answers"))))


@router.get("/notes/{note_id}/helpful-prompt", dependencies=[Depends(_require_w11)])
def helpful_prompt_endpoint(note_id: str, user: dict = Depends(require_paid)) -> JSONResponse:
    """`{show: false}` or `{show: true, itemId, title, line}` (W11-R9). Read-only: asking records nothing."""
    return _ok(gallery.helpful_prompt(user["id"], note_id))


@router.post("/{gallery_id}/preview-mine", dependencies=[Depends(_require_w11)])
def preview_mine_endpoint(gallery_id: str, body: dict[str, Any] = Depends(w11_body),
                          user: dict = Depends(require_paid)) -> JSONResponse:
    """`{answers?}` -> `{slots, cards, tools, questions, credit}` (W11-R12, R24, R27b): the item with the viewer's
    own data. Spends the shared preview scope AND its own short per-member window (11.9 m-1)."""
    _hit(PREVIEW_MINE_RATE, SCOPE_PREVIEW_MINE, user, PREVIEW_MINE_RATE_SENTENCE, w11=True)
    _hit(PREVIEW_RATE, SCOPE_PREVIEW, user, W11_PREVIEW_RATE_SENTENCE, w11=True)
    return _ok(_w11(lambda: template_preview.preview_mine(user["id"], gallery_id, answers=body.get("answers"))))


@router.post("/{gallery_id}/adopt-tool", dependencies=[Depends(_require_w11)])
def adopt_tool_endpoint(gallery_id: str, request: Request, body: dict[str, Any] = Depends(w11_body),
                        user: dict = Depends(require_paid)) -> JSONResponse:
    """`{answers?, notify?}` -> `{kind, id, credit}` (`replayed: true` for a repeated `Idempotency-Key`)."""
    notify = _notify(body)
    return _ok(_spend_adopt(user, lambda: _w11(lambda: gallery.adopt_tool(
        user["id"], gallery_id, answers=body.get("answers"), notify=notify, key=_key(request))), w11=True))


@router.post("/{gallery_id}/use-template", dependencies=[Depends(_require_w11)])
def use_template_endpoint(gallery_id: str, request: Request, body: dict[str, Any] = Depends(w11_body),
                          user: dict = Depends(require_paid)) -> JSONResponse:
    """`{answers?, choices?, ticker?, title?}` -> `{note, skipped, style, credit, created, reused}`: a note made
    from the member's copy of a listed template (the first Use adopts it, W11-R4). Two at once make one copy
    (Review Focus 2). The note is served as every note is (`_servable_note`)."""
    fields = _note_fields(body)
    out = _spend_adopt(user, lambda: _w11(lambda: gallery.use_library_template(
        user["id"], gallery_id, answers=body.get("answers"), choices=body.get("choices"), payload=fields,
        key=_key(request))), w11=True)
    from api.routers.journal_two import _servable_note
    return _ok({**out, "note": _servable_note(out["note"])})


@router.post("/{gallery_id}/helpful-prompt", dependencies=[Depends(_require_w11)])
def answer_helpful_prompt_endpoint(gallery_id: str, body: dict[str, Any] = Depends(w11_body),
                                   user: dict = Depends(require_paid)) -> JSONResponse:
    """`{answer: yes|not_really|dismissed}` -> `{answer, helpful, count}`. "yes" also marks Helpful (409
    `helpful_days` before the 3rd day). The wave gate runs before the answer is validated (11.11 m-3)."""
    _hit(HELPFUL_RATE, SCOPE_HELPFUL, user, HELPFUL_RATE_SENTENCE, w11=True)
    return _ok(_w11(lambda: gallery.answer_helpful_prompt(user["id"], gallery_id, body.get("answer"))))


@router.get("/{gallery_id}")
def get_item_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    item = gallery.get_item(user["id"], gallery_id, is_admin=_is_admin(user))
    if item is None:
        raise public.not_found()
    return {"template": _card_facts(user["id"], [item])[0]}


@router.get("/{gallery_id}/images/{n}", dependencies=[Depends(_require_example)])
def example_image_endpoint(gallery_id: str, n: str, rev: str = "", user: dict = Depends(require_paid)) -> Any:
    """An example note's image copy (P3b Task 4, R-P3b-7), with `PUBLIC_HEADERS` and the image CSP
    (`public.public_file`). Served when the item is approved and not hidden, or to its author or an admin;
    `?rev=pending` is the held revision's copy, for the author or an admin only (ruling P3b-R14). Anything else is the
    one 404, and so is every route here while the example switch is off (`_require_example`, before the plan check)."""
    path = gallery.example_image_path(user["id"], gallery_id, n, is_admin=_is_admin(user), rev=rev or None)
    if path is None:
        raise public.not_found()
    return public.public_file(path)


@router.post("")
def publish_endpoint(body: dict[str, Any] = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{templateId, title, description?, category}` -> a PENDING submission (or the same
    copy resubmitted). The SERVER reads the template; the client never sends its body."""
    item = _charged_publish(user, lambda: gallery.publish(
        user["id"], body.get("templateId"), title=body.get("title"), description=body.get("description"),
        category=body.get("category")))
    return {"template": item}


@router.delete("/{gallery_id}")
def unpublish_endpoint(gallery_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    # SESSION ONLY, ON PURPOSE (owner ruling 2026-10-07): a member can always take their own
    # content down, whatever their plan. Pinned by name in tests/test_paywall_gate_free_tier.py.
    if not gallery.unpublish(user["id"], gallery_id):
        raise public.not_found()
    return {"ok": True}


@router.post("/{gallery_id}/use")
def use_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        out = gallery.use_template(user["id"], gallery_id)
    except gallery.GalleryError as e:
        raise _bad(e)
    if out is None:
        raise public.not_found()
    return out


def _spend_adopt(user: dict, adopt, *, w11: bool = False) -> dict[str, Any]:
    """THE adopt budget, for a style, a layout, and since wave 11 a tool and a template's Use alike (R-P3-11, F16):
    30/hour in-process plus a durable 50/day, and the day's charge given back on every refusal (a `GalleryError`,
    400 or 409), on a None (404) and on an exception. ONE copy: every adopt route calls this, never a block of its
    own. `w11` (Task 11.12) only shapes the 429s; a wave 11 door hands in an `adopt` already wrapped in `_w11`."""
    _hit(ADOPT_RATE, SCOPE_ADOPT, user, ADOPT_RATE_SENTENCE, w11=w11)
    day = _daily_take(DAILY_ADOPT_SCOPE, user, "NOTEBOOK_GALLERY_ADOPT_DAILY_CAP", 50, ADOPT_RATE_SENTENCE, w11=w11)
    try:
        out = adopt()
    except gallery.GalleryError as e:
        _give_back(day, DAILY_ADOPT_SCOPE, user)
        raise _bad(e)
    except Exception:
        _give_back(day, DAILY_ADOPT_SCOPE, user)
        raise
    if out is None:
        _give_back(day, DAILY_ADOPT_SCOPE, user)
        raise public.not_found()
    return out


@router.post("/{gallery_id}/adopt", dependencies=[Depends(_require_library)])
def adopt_endpoint(gallery_id: str, request: Request, body: dict[str, Any] = Depends(library_body),
                   user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{notify?: bool}` -> `{style, notify, credit}`: the member's own copy of a listed style (R-P3-10:
    404 while the library is off, by `_require_library`, before the plan and the body). Rate-limited per
    R-P3-11: 30/hour in-process plus a durable 50/day; a refused or failed adopt gives the day's charge back.

    Wave 11 (Task 11.12): while wave 11 is on, `{notify?, answers?, choices?}` answer a template's choices and reuse
    questions, the `Idempotency-Key` header is passed (W11-R34), and refusals answer from their class (`_w11`).
    Off, exactly today's route."""
    if _w11_on():
        notify = _notify(body)                       # n-3: the wave 11 shape, with no-store
    else:
        notify = body.get("notify", False)
        if notify is None:
            notify = False
        if not isinstance(notify, bool):
            raise HTTPException(status_code=400, detail="notify must be true or false")
        return _spend_adopt(user, lambda: gallery.adopt_style(user["id"], gallery_id, notify=notify))
    return _ok(_spend_adopt(user, lambda: _w11(lambda: gallery.adopt_style(
        user["id"], gallery_id, notify=notify, answers=body.get("answers"), choices=body.get("choices"),
        key=_key(request))), w11=True))


LAYOUT_VERSION_SENTENCE = "Say which version you previewed: version must be a whole number."


@router.post("/{gallery_id}/adopt-layout", dependencies=[Depends(_require_layout_sharing)])
def adopt_layout_endpoint(gallery_id: str, body: dict[str, Any] = Depends(paid_body),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{version: int}` -> `{layout, version, credit}`: the LISTED layout of a shared page, for the client to apply
    and save through the member's own preference door (R-P4b-8: the server writes no preference). 404 for everyone
    while layout sharing is off (`_require_layout_sharing`, before the plan and the body); 409 when a newer version
    is listed than the one previewed; 400 when `version` is not a whole number (a bool is not one), before any
    charge. It spends the adopt budget exactly as `POST /{id}/adopt` does (F16, `_spend_adopt`)."""
    version = body.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise HTTPException(status_code=400, detail=LAYOUT_VERSION_SENTENCE)
    return _spend_adopt(user, lambda: gallery.adopt_layout(user["id"], gallery_id, version=version))


@router.post("/{gallery_id}/helpful", dependencies=[Depends(_require_library)])
def helpful_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{helpful: true, count}`. One per member per item; 404 for an item they can't see, one that isn't listed,
    or their own (R-P3-10: 404 for everyone while the library is off; R-P3-11: 60/hour with unmarking).
    Wave 11 (W11-R8): before the 3rd use day, 409 `{"code": "helpful_days", "message": S_HELPFUL_DAYS}` (`_bad`)."""
    public.enforce_rate(HELPFUL_RATE, SCOPE_HELPFUL, f"member:{user['id']}", HELPFUL_RATE_SENTENCE, public=False)
    try:
        out = gallery.set_helpful(user["id"], gallery_id, True)
    except gallery.GalleryError as e:
        raise _bad(e)
    if out is None:
        raise public.not_found()
    return out


@router.delete("/{gallery_id}/helpful", dependencies=[Depends(_require_library)])
def unhelpful_endpoint(gallery_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{helpful: false, count}`. The same 404s and the same budget as marking."""
    public.enforce_rate(HELPFUL_RATE, SCOPE_HELPFUL, f"member:{user['id']}", HELPFUL_RATE_SENTENCE, public=False)
    out = gallery.set_helpful(user["id"], gallery_id, False)
    if out is None:
        raise public.not_found()
    return out


@router.post("/{gallery_id}/report")
def report_endpoint(gallery_id: str, body: dict[str, Any] = Depends(paid_body),
                    user: dict = Depends(require_paid)) -> dict[str, Any]:
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
    """`{action: approve|reject|hide|unhide|feature|unfeature, note?, reviewedUpdatedAt?}`.
    Hide is a visibility state; nothing here deletes a member's template. An approval and a
    rejection (P3b-F-R4) must carry `reviewedUpdatedAt`, the `updatedAt` of the version the
    reviewer saw; if the template changed since, the answer is 409 and nothing changes."""
    try:
        item = gallery.admin_act(admin["id"], gallery_id, body.get("action"), note=body.get("note"),
                                 reviewed_updated_at=body.get("reviewedUpdatedAt"))
    except gallery.GalleryError as e:
        raise _bad(e)
    except gallery.GalleryServerError as e:          # P3b Task 4: an example's held copies could not be moved
        raise _server_error(e)
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
