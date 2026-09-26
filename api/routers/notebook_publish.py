"""Publish-to-web -- a read-only public page for a note or a folder (wave 8, lane 8B).

The routes (the service is `api/services/journal_two/note_publish.py`; the public page is
`PublishedPage.jsx`, at `/p/:slug` and `/p/:slug/n/:pid`):

  owner   GET    /api/j2/publish                      session   mine: publications + share links
  owner   POST   /api/j2/publish/notes/{note_id}      paid      publish a note
  owner   POST   /api/j2/publish/folders/{folder_id}  paid      publish a folder
  owner   POST   /api/j2/publish/{slug}/refresh       paid      Update: re-snapshot a folder
  owner   PATCH  /api/j2/publish/{slug}               paid      {expiresInDays}
  owner   DELETE /api/j2/publish/{slug}               session   unpublish
  public  GET    /api/j2/published/{slug}                             a note, or a folder's index
  public  GET    /api/j2/published/{slug}/n/{pid}                     one note of a folder
  public  GET    /api/j2/published/{slug}/att/{sub}/{filename}        a published note's image
  public  GET    /api/j2/published/{slug}/n/{pid}/att/{sub}/{filename} a folder note's image

The rules, the same as the share router's (`notebook_shares.py`), each railed by
tests/test_share_publish_authorization.py:
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_PUBLISH_ENABLED` off answers the one 404 for
    every route before the session or the plan is read (ruling D-B9: off until the owner's
    legal sign-off).
  * ONE 404 for every public miss and the flag-off path, with the public headers.
  * `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, nofollow` (always -- ruling
    D-B10) and `Referrer-Policy: no-referrer` on every public response.
  * RATE LIMITS (ruling D-B10): 60/min per IP on the public reads, 240/min per IP on images,
    30/hour per member on publish / publish folder / Update. ⚠️ PER-PROCESS STATE (scopes
    `notebook-publish-public`, `notebook-publish-images`, `notebook-publish-mint`).
  * PLAN (ruling D-B3): publishing takes this router's own `require_paid`; the list and
    unpublish do NOT -- a member whose plan lapsed can always see and take down a page.
  * Its paths are outside `/api/j2/notes/...`, so journal_two's `/api/j2/notes/{note_id}`
    cannot shadow them (`tests/test_main_router_order.py`).
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.journal_two import note_publish
from api.services.journal_two import note_shares
from api.services.journal_two import public_note_payload as public

PUBLIC_RATE = "60/minute"
IMAGE_RATE = "240/minute"
MINT_RATE = "30/hour"

SCOPE_PUBLIC = "notebook-publish-public"
SCOPE_IMAGES = "notebook-publish-images"
SCOPE_MINT = "notebook-publish-mint"

PUBLIC_RATE_SENTENCE = "Too many requests for this page. Wait a minute and try again."
MINT_RATE_SENTENCE = "You've published a lot in the last hour. Try again later."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies."""
    if not note_publish.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2",
    tags=["journal-2-0", "notebook-publish"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Publishing to the web requires a paid plan")
    return user


def _expiry(payload: Any) -> int | None:
    """`{expiresInDays: null | 7 | 30 | 90}`, optional; anything else is a 422 sentence."""
    if payload is not None and not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE)
    try:
        return note_shares.validate_expiry((payload or {}).get("expiresInDays"))
    except ValueError:
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE) from None


def _mint_limit(user: dict) -> None:
    public.enforce_rate(MINT_RATE, SCOPE_MINT, f"member:{user['id']}", MINT_RATE_SENTENCE, public=False)


# ── the owner's doors ───────────────────────────────────────────────────────────────────

@router.get("/publish")
def list_mine_endpoint(note_id: str | None = None, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Every publication and share link the member has not revoked. `?note_id=` adds the
    context the editor's Share door needs for that one note."""
    return note_publish.list_mine(user["id"], note_id=note_id)


@router.post("/publish/notes/{note_id}")
def publish_note_endpoint(note_id: str, payload: Any = Body(default=None),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    days = _expiry(payload)
    _mint_limit(user)
    pub = note_publish.publish_note(user["id"], note_id, expires_in_days=days)
    if pub is None:
        raise public.not_found()
    return {"publication": pub}


@router.post("/publish/folders/{folder_id}")
def publish_folder_endpoint(folder_id: str, payload: Any = Body(default=None),
                            user: dict = Depends(require_paid)) -> dict[str, Any]:
    days = _expiry(payload)
    _mint_limit(user)
    pub = note_publish.publish_folder(user["id"], folder_id, expires_in_days=days)
    if pub is None:
        raise public.not_found()
    return {"publication": pub}


@router.post("/publish/{slug}/refresh")
def refresh_endpoint(slug: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    _mint_limit(user)
    pub = note_publish.refresh(user["id"], slug)
    if pub is None:
        raise public.not_found()
    return {"publication": pub}


@router.patch("/publish/{slug}")
def set_expiry_endpoint(slug: str, payload: Any = Body(default=None),
                        user: dict = Depends(require_paid)) -> dict[str, Any]:
    days = _expiry(payload)
    pub = note_publish.set_expiry(user["id"], slug, days)
    if pub is None:
        raise public.not_found()
    return {"publication": pub}


@router.delete("/publish/{slug}")
def unpublish_endpoint(slug: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Never paid-gated, never rate-limited: taking a page down must always work."""
    return {"revoked": note_publish.revoke(user["id"], slug)}


# ── the public read ─────────────────────────────────────────────────────────────────────

def _public_limit(request: Request, images: bool = False) -> None:
    public.enforce_rate(IMAGE_RATE if images else PUBLIC_RATE, SCOPE_IMAGES if images else SCOPE_PUBLIC,
                        public.client_key(request), PUBLIC_RATE_SENTENCE, public=True)


@router.get("/published/{slug}")
def resolve_endpoint(slug: str, request: Request) -> Any:
    """PUBLIC — no auth by design: a published page is public by definition."""
    _public_limit(request)
    payload = note_publish.resolve(slug)
    if payload is None:
        raise public.not_found()
    return public.public_json(payload)


@router.get("/published/{slug}/n/{pid}")
def resolve_member_endpoint(slug: str, pid: str, request: Request) -> Any:
    _public_limit(request)
    payload = note_publish.resolve_member(slug, pid)
    if payload is None:
        raise public.not_found()
    return public.public_json(payload)


@router.get("/published/{slug}/att/{sub}/{filename}")
def note_attachment_endpoint(slug: str, sub: str, filename: str, request: Request) -> Any:
    _public_limit(request, images=True)
    path = note_publish.resolve_attachment(slug, sub, filename)
    if path is None:
        raise public.not_found()
    return public.public_file(path)


@router.get("/published/{slug}/n/{pid}/att/{sub}/{filename}")
def member_attachment_endpoint(slug: str, pid: str, sub: str, filename: str, request: Request) -> Any:
    _public_limit(request, images=True)
    path = note_publish.resolve_attachment(slug, sub, filename, pid=pid)
    if path is None:
        raise public.not_found()
    return public.public_file(path)
