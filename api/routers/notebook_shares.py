"""Note share links -- the five routes (moved here from journal_two.py by wave 8 seam S8-2,
hardened by lane 8B).

Why a separate router: lane 8B (sharing + publish-to-web) works on these routes this
wave, and lane 8C adds export formats in the same neighbourhood. `journal_two.py` is
one 5,000-line file, and a pathspec commit to it carries every lane's hunks at once --
so the share routes live here and `journal_two.py` is touched by no lane in wave 8.
`api/main.py` mounts this router BEFORE `journal_two`
(`tests/test_notebook_share_routes.py` asks the real app).

What lane 8B changed, each one a finding of `docs/notebook/share-links-authorization-proof.md`:
  * THE GATE IS A ROUTER DEPENDENCY, so it runs before any route's own dependencies
    (F-GATE-ORDER): with the flag off, every route answers the same 404 -- before the
    session is read, before the plan is checked, before anything is written.
  * ONE 404 (F-BODIES): every public miss and the flag-off path answer
    `public_note_payload.not_found()` -- the same status, body and headers.
  * THE PUBLIC HEADERS (F-NO-STORE, F-API-HEADERS): `Cache-Control: no-store, private`,
    `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` on the JSON AND
    the image `FileResponse`.
  * RATE LIMITS (F-RATE, ruling D-B10): 60/min per IP on the public read, 240/min per IP
    on public images, 30/hour per member on mint. ⚠️ PER-PROCESS STATE (the
    `api/limiter.py` Limiter's in-memory storage; scopes `notebook-share-public`,
    `notebook-share-images`, `notebook-share-mint`) -- a second web process doubles them.
  * PLAN (F-PLAN, ruling D-B3): mint takes this router's own `require_paid`. Status and
    revoke do NOT -- a member whose plan lapsed must always be able to see and kill a
    public link.
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.journal_two import note_shares
from api.services.journal_two import public_note_payload as public

PUBLIC_RATE = "60/minute"
IMAGE_RATE = "240/minute"
MINT_RATE = "30/hour"

SCOPE_PUBLIC = "notebook-share-public"
SCOPE_IMAGES = "notebook-share-images"
SCOPE_MINT = "notebook-share-mint"

PUBLIC_RATE_SENTENCE = "Too many requests for this page. Wait a minute and try again."
MINT_RATE_SENTENCE = "You've made a lot of share links in the last hour. Try again later."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, touches no table, and answers the one not-found."""
    if not note_shares.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2",
    tags=["journal-2-0"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py, which reads the sentence as a LITERAL in the
    HTTPException call -- so it stays inline, never a named constant)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Share links require a paid plan")
    return user


@router.get("/notes/{note_id}/share")
def get_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Status. A foreign note and a missing note both answer `{"share": null}`."""
    return {"share": note_shares.get_share(user["id"], note_id)}


@router.post("/notes/{note_id}/share")
def create_note_share_endpoint(
    note_id: str,
    request: Request,
    payload: Any = Body(default=None),
    user: dict = Depends(require_paid),
) -> dict[str, Any]:
    """Mint (or return the active link). Body `{expiresInDays: null | 7 | 30 | 90}`,
    optional. A foreign note and a missing note answer the same 404."""
    if payload is not None and not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE)
    try:
        days = note_shares.validate_expiry((payload or {}).get("expiresInDays"))
    except ValueError:
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE) from None
    public.enforce_rate(MINT_RATE, SCOPE_MINT, f"member:{user['id']}", MINT_RATE_SENTENCE, public=False)
    share = note_shares.create_share(user["id"], note_id, expires_in_days=days)
    if share is None:
        raise public.not_found()
    return {"share": share}


@router.delete("/notes/{note_id}/share")
def revoke_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Revoke. Never paid-gated, never rate-limited: killing a link must always work."""
    return {"revoked": note_shares.revoke_share(user["id"], note_id)}


@router.get("/shared/{token}")
def resolve_shared_note_endpoint(token: str, request: Request) -> Any:
    """PUBLIC — no auth by design (a link that only opens for people with an
    account is not sharing). The token is the credential; the payload is
    sanitized by the one public reducer; the flag is the master switch."""
    public.enforce_rate(PUBLIC_RATE, SCOPE_PUBLIC, public.client_key(request),
                        PUBLIC_RATE_SENTENCE, public=True)
    payload = note_shares.resolve_share(token)
    if payload is None:
        raise public.not_found()
    return public.public_json({"note": payload})


@router.get("/shared/{token}/att/{sub}/{filename}")
def serve_shared_attachment_endpoint(token: str, sub: str, filename: str, request: Request) -> Any:
    """PUBLIC image proxy for a shared note — images only, token-scoped to
    exactly that note's directory, path-traversal guarded downstream."""
    public.enforce_rate(IMAGE_RATE, SCOPE_IMAGES, public.client_key(request),
                        PUBLIC_RATE_SENTENCE, public=True)
    path = note_shares.resolve_share_attachment(token, sub, filename)
    if path is None:
        raise public.not_found()
    return public.public_file(path)
