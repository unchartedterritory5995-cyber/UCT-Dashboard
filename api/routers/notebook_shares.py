"""Note share links -- the five routes (moved here from journal_two.py by wave 8 seam S8-2,
hardened by lane 8B), plus the owner's list of their own links (`GET /api/j2/share/links`,
lane 8B, for Settings → Sharing & publishing).

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
    `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` and (wave-8 final
    review M-7) `X-Content-Type-Options: nosniff` on the JSON AND the image `FileResponse`;
    the image adds `Content-Security-Policy: default-src 'none'`
    (`public_note_payload.PUBLIC_HEADERS` / `PUBLIC_IMAGE_HEADERS`).
  * RATE LIMITS (F-RATE, ruling D-B10): 60/min per IP on the public read, 240/min per IP
    on public images, 30/hour per member on mint. ⚠️ PER-PROCESS STATE (the
    `api/limiter.py` Limiter's in-memory storage; scopes `notebook-share-public`,
    `notebook-share-images`, `notebook-share-mint`) -- a second web process doubles them.
  * PLAN (F-PLAN, ruling D-B3): mint takes this router's own `require_paid`. Status and
    revoke do NOT -- a member whose plan lapsed must always be able to see and kill a
    public link.
  * THE BODY IS READ INSIDE THE DEPENDENCY CHAIN (wave-8 final review I-1): gate, then the
    member, then the body (`read_expiry` below) -- never a FastAPI body parameter, which is
    decoded before any dependency and made a dark route answer a malformed body with 422.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.journal_two import note_shares
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import widget_request_body as wbody

PUBLIC_RATE = "60/minute"
IMAGE_RATE = "240/minute"
MINT_RATE = "30/hour"

SCOPE_PUBLIC = "notebook-share-public"
SCOPE_IMAGES = "notebook-share-images"
SCOPE_MINT = "notebook-share-mint"
#: Audit 2026-11-05, S19: the share preview, per member, in-process (a second web process doubles it).
PREVIEW_RATE = "60/minute"
SCOPE_PREVIEW = "notebook-share-preview"
PREVIEW_RATE_SENTENCE = "Too many previews in a minute. Wait a moment and try again."

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


#: Far past any body a real request sends (`{"expiresInDays": 30}`); it bounds what is BUFFERED.
_MAX_BODY_BYTES = 64 * 1024


async def read_expiry(request: Request) -> int | None:
    """See `_read_share_options`, which this calls for the expiry alone (the publish doors)."""
    return (await _read_share_options(request))[0]


#: Audit 2026-11-05, S19: the one sentence for a `hidePnl` that is not a boolean.
HIDE_PNL_SENTENCE = "Choose whether to hide your P&L and position size: true or false."


async def read_share_options(request: Request) -> tuple[int | None, bool]:
    """`(days, hide_pnl)` for the share-link mint: `{expiresInDays, hidePnl?}`. `hidePnl` absent is False (a client
    that predates S19 mints exactly what it always did); anything but a boolean is one 422 sentence."""
    return await _read_share_options(request, with_hide=True)


async def _read_share_options(request: Request, with_hide: bool = False) -> tuple[int | None, bool]:
    """`{expiresInDays: null | 7 | 30 | 90}` from the request body, optional -> the days.

    ⛔ THE ONE BODY PARSE for every expiry door (mint here; publish, publish folder and PATCH
    in `notebook_publish.py`), called ONLY from a dependency that depends on the router's
    `require_paid` -- so the order is always the gate (router level), the member, then the
    body (wave-8 final review I-1; the shape `notebook_writing_help._read_payload` fixed
    for writing help's M-1).

    ⚰️ The routes declared `payload: Any = Body(default=None)`, and FastAPI decodes a
    declared JSON body BEFORE it solves any dependency: with the gate OFF a malformed body
    answered 422 `json_invalid` -- an answer a route that does not exist never gives -- and
    with it on, a signed-out caller got 422 instead of 401. Anything that is not an empty
    body, `null` or a JSON object with a valid `expiresInDays` is now the one 422 sentence."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > _MAX_BODY_BYTES:
            raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE)
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        return None, False
    try:
        payload = wbody.loads_plain_body(raw)  # W11-R55: too deep to parse is 400 no-store
    except ValueError:
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE) from None
    if payload is None:
        return None, False
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE)
    try:
        days = note_shares.validate_expiry(payload.get("expiresInDays"))
    except ValueError:
        raise HTTPException(status_code=422, detail=note_shares.EXPIRY_SENTENCE) from None
    hide = payload.get("hidePnl", False) if with_hide else False
    if not isinstance(hide, bool):
        raise HTTPException(status_code=422, detail=HIDE_PNL_SENTENCE)
    return days, hide


async def expiry_body(request: Request, _user: dict = Depends(require_paid)) -> tuple[int | None, bool]:
    """The mint's options `(days, hide_pnl)`, read AFTER this router's `require_paid` has answered (see
    `read_expiry`). Audit 2026-11-05, S19: it also reads `hidePnl`, in the same one parse."""
    return await read_share_options(request)


@router.get("/notes/{note_id}/share")
def get_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Status. A foreign note and a missing note both answer `{"share": null}`."""
    return {"share": note_shares.get_share(user["id"], note_id)}


@router.post("/notes/{note_id}/share")
def create_note_share_endpoint(
    note_id: str,
    options: tuple[int | None, bool] = Depends(expiry_body),
    user: dict = Depends(require_paid),
) -> dict[str, Any]:
    """Mint (or return the active link). Body `{expiresInDays: null | 7 | 30 | 90, hidePnl?: bool}`,
    optional. A foreign, missing, trashed or archived note answers the same 404."""
    public.enforce_rate(MINT_RATE, SCOPE_MINT, f"member:{user['id']}", MINT_RATE_SENTENCE, public=False)
    days, hide_pnl = options
    share = note_shares.create_share(user["id"], note_id, expires_in_days=days, hide_pnl=hide_pnl)
    if share is None:
        raise public.not_found()
    return {"share": share}


@router.get("/notes/{note_id}/share/preview")
def preview_note_share_endpoint(note_id: str, hide_pnl: bool = Query(default=True, alias="hidePnl"),
                                user: dict = Depends(require_paid)) -> Any:
    """Audit 2026-11-05, S19: "Preview: see exactly what they'll see". The public read's own payload for the
    member's OWN note, through the same reducer, before a link exists. Owner only; a foreign, missing, trashed or
    archived note is the same 404. Rate-limited per member (one reduction of the note each)."""
    public.enforce_rate(PREVIEW_RATE, SCOPE_PREVIEW, f"member:{user['id']}", PREVIEW_RATE_SENTENCE, public=False)
    payload = note_shares.preview_share(user["id"], note_id, hide_pnl=hide_pnl)
    if payload is None:
        raise public.not_found()
    return public.public_json({"note": payload})


@router.delete("/notes/{note_id}/share")
def revoke_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Revoke. Never paid-gated, never rate-limited: killing a link must always work."""
    return {"revoked": note_shares.revoke_share(user["id"], note_id)}


@router.get("/share/links")
def list_share_links_endpoint(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """The member's own share links (not revoked), each with its note's title, dates and
    state -- Settings → Sharing & publishing reads it when only share links are on (with
    publishing on it reads `GET /api/j2/publish`, which carries these too). Never plan-gated:
    a member whose plan lapsed can always see, and revoke, a public link."""
    return {"shares": note_shares.list_shares(user["id"])}


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
