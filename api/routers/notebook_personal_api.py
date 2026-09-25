"""Wave 7 lane G (G1) — the member's personal API, under `/api/j2/personal`.

Two halves, and they authenticate differently ON PURPOSE:

  * TOKEN MANAGEMENT (`/tokens`) is an account operation, so it takes the
    member's real session (`get_current_user`) — minting also takes a paid plan.
    A personal token can never mint, list or revoke tokens, its own included.
    Listing and revoking are deliberately NOT paid-gated: a member whose plan
    lapsed must still be able to see and kill a year-long bearer.
  * THE NOTE DOORS (`/notes`, `/notes/{id}/append`, `/daily/append`) take the
    bearer through `require_capture_scope(<personal scope>)` — the same resolver
    the Browser Capture routes use, so the two token kinds are kept apart by one
    scope check rather than two rules. (It is session-first, exactly as for
    capture: a signed-in browser is already strictly more authorised.)

⛔ DARK: `NOTEBOOK_PERSONAL_API_ENABLED` unset means every route here answers
404 — the same body FastAPI gives a route that does not exist — before any
credential is read or anything is written. Read per request.

⛔ EVERY REFUSAL IS A SENTENCE A SHORTCUT CAN SHOW: `{"detail": "<sentence>"}`
for 400/401/403/404/413/423/429. The Browser Capture resolver's own 401/403
bodies speak to the EXTENSION ("Reconnect UCT Browser Capture"), so they are
translated here rather than leaked to a phone.

⚠️ PER-PROCESS STATE: the 30-requests-a-minute limit per token lives in the
shared `api/limiter.py` Limiter's in-memory storage. A second web process would
double it — listed for the CLAUDE.md single-process roster.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from api.limiter import limiter
from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, is_paid_user,
)
from api.middleware.capture_scope import _bearer, require_capture_scope
from api.services.journal_two import capture_auth
from api.services.journal_two import note_personal_api as papi

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body

UNAUTHORIZED_SENTENCE = (
    "Your UCT token is missing, expired or revoked. Make a new one in UCT "
    "Settings → Personal API and paste it into your Shortcut.")
FORBIDDEN_SENTENCE = (
    "This token isn't allowed to do that. Use a Personal API token from UCT Settings.")
RATE_SENTENCE = "Too many requests with this token. Wait a minute and try again."
BAD_JSON_SENTENCE = "Send a JSON body, for example {\"markdown\": \"Your text\"}."

# 200 KB of markdown plus room for the rest of a JSON body.
_MAX_BODY_BYTES = papi.MAX_MARKDOWN_BYTES + 16 * 1024
_RATE = "30/minute"


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off
    gate reads no credential, touches no table, and looks like no route."""
    if not papi.personal_api_enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2/personal",
    tags=["journal-2-0", "personal-api"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Personal API tokens require a paid plan")
    return user


# ── the per-token rate limit ─────────────────────────────────────────────────

def _rate_key(request: Request, principal: dict[str, Any]) -> str:
    """The slowapi-style key: the DIGEST of the presented bearer — never the
    bearer itself — or the member id for a signed-in browser."""
    bearer = _bearer(request.headers.get("authorization"))
    if principal.get("via") != "session" and bearer:
        return "personal-api:tok:" + hashlib.sha256(bearer.encode("utf-8")).hexdigest()
    return "personal-api:user:" + str(principal.get("id"))


def _enforce_rate(request: Request, principal: dict[str, Any]) -> None:
    if not limiter.enabled:
        return
    from limits import parse
    if not limiter.limiter.hit(parse(_RATE), "notebook-personal-api", _rate_key(request, principal)):
        raise HTTPException(status_code=429, detail=RATE_SENTENCE)


def personal_scope(scope: str):
    """`require_capture_scope(scope)`, with the refusals a Shortcut can read and
    the per-token rate limit applied once the credential is known good.

    ⛔ The inner resolver is CALLED, not declared as a sub-dependency: a
    sub-dependency's HTTPException escapes before this function could reword
    it. The `_capture_scope` marker is copied onto this closure so the
    capture-boundary census (tests/test_capture_auth_boundary.py) still sees,
    from the app's own dependency graph, every route a bearer can reach.
    """
    inner = require_capture_scope(scope)

    def dependency(
        request: Request,
        uct_session: Optional[str] = Cookie(None),
        authorization: Optional[str] = Header(None),
    ) -> dict[str, Any]:
        try:
            principal = inner(uct_session=uct_session, authorization=authorization)
        except HTTPException as e:
            if e.status_code == 401:
                raise HTTPException(status_code=401, detail=UNAUTHORIZED_SENTENCE) from e
            if e.status_code == 403:
                raise HTTPException(status_code=403, detail=FORBIDDEN_SENTENCE) from e
            raise
        _enforce_rate(request, principal)
        return principal

    dependency._capture_scope = scope  # type: ignore[attr-defined]
    return dependency


async def _json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail=papi.TOO_LARGE_SENTENCE)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=BAD_JSON_SENTENCE) from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=BAD_JSON_SENTENCE)
    return body


async def _run(fn, *args, **kwargs):
    """Service work is SQLite: off the event loop, with its refusals mapped to
    their status and sentence."""
    try:
        return await run_in_threadpool(fn, *args, **kwargs)
    except papi.PersonalApiError as e:
        raise HTTPException(status_code=e.status, detail=e.message) from e


# ── token management (session) ───────────────────────────────────────────────

@router.post("/tokens")
def mint_token(payload: dict[str, Any] | None = None, user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Make a personal token. The bearer is in THIS response and nowhere else,
    ever — the list below never carries it."""
    label = (payload or {}).get("label")
    if label is not None and not isinstance(label, str):
        raise HTTPException(status_code=400, detail="“label” must be text.")
    try:
        return capture_auth.mint_personal_token(user["id"], label)
    except capture_auth.CaptureAuthError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/tokens")
def list_tokens(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {"tokens": capture_auth.list_connections(
        user["id"], client_type=capture_auth.PERSONAL_CLIENT_TYPE)}


@router.delete("/tokens/{token_id}")
def revoke_token(token_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Revoke one PERSONAL token. A Browser Capture connection is revoked from
    its own card, so this door refuses any id that is not a personal token."""
    mine = {t["id"] for t in capture_auth.list_connections(
        user["id"], client_type=capture_auth.PERSONAL_CLIENT_TYPE)}
    if token_id not in mine or not capture_auth.revoke_connection(user["id"], token_id):
        raise HTTPException(status_code=404, detail="That token wasn't found. It may already be revoked.")
    return {"revoked": True}


# ── the note doors (bearer) ──────────────────────────────────────────────────

@router.post("/notes")
async def create_note(
    request: Request,
    principal: dict = Depends(personal_scope(capture_auth.SCOPE_NOTES_CREATE)),
) -> dict[str, Any]:
    body = await _json_body(request)
    note = await _run(papi.create_note_from_markdown, principal["id"],
                      title=body.get("title"), markdown=body.get("markdown"),
                      folder=body.get("folder"), tags=body.get("tags"))
    return {"note": papi.public_note(note)}


@router.post("/notes/{note_id}/append")
async def append_to_note(
    note_id: str,
    request: Request,
    principal: dict = Depends(personal_scope(capture_auth.SCOPE_NOTES_APPEND)),
) -> dict[str, Any]:
    body = await _json_body(request)
    note = await _run(papi.append_markdown, principal["id"], note_id, body.get("markdown"))
    return {"note": papi.public_note(note)}


@router.post("/daily/append")
async def append_to_daily(
    request: Request,
    principal: dict = Depends(personal_scope(capture_auth.SCOPE_NOTES_APPEND)),
) -> dict[str, Any]:
    body = await _json_body(request)
    out = await _run(papi.append_to_daily, principal["id"], body.get("markdown"))
    return {"note": papi.public_note(out["note"]), "created": out["created"], "day": out["day"]}
