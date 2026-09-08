"""Browser Capture authorization — the first-party handshake and the two
scoped surfaces the extension is allowed to reach.

THE FLOW, and why each step is shaped the way it is:

    extension  → chrome.identity.launchWebAuthFlow opens
                 https://uctintelligence.com/journal/capture-connect
                 as a TOP-LEVEL first-party navigation, so the member's
                 existing `SameSite=Lax` session cookie IS sent (a Lax cookie
                 rides top-level navigations; it is subrequests it refuses).
                 No second login, and the extension never sees a password.
    member     → clicks Connect on a first-party UCT page
    page       → POST /api/j2/capture/authorize   (same-origin, session-authed)
    server     → single-use code, 120s, bound to member + client + redirect
    page       → redirects to the extension's own chromiumapp.org URL with the
                 code in the URL **FRAGMENT**
    extension  → POST /api/j2/capture/token       (code → scoped bearer)
    server     → the code is spent; a replay is refused

⛔ THE CODE TRAVELS IN THE FRAGMENT, NOT THE QUERY STRING. A fragment is never
sent to a server, never lands in an access log, and is not carried in a
Referer. The long-lived bearer never appears in a URL at all — it exists only in
the token response body and in `chrome.storage.local` (§5).

⛔ CSRF / CONFUSED DEPUTY (§15) — TWO independent barriers, either sufficient:
  1. `/authorize` is a POST authenticated by a `SameSite=Lax` cookie, which a
     browser does not attach to a cross-site POST. A hostile page cannot make
     this call as the member at all.
  2. The code is minted BOUND to a redirect target that must be a
     `chromiumapp.org` extension origin (and, when `CAPTURE_EXTENSION_IDS` is
     set, one of ours). Even a code obtained some other way cannot be steered
     to a web page.
Neither depends on the other, which is the point of having both.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.limiter import limiter
from api.middleware.auth_middleware import get_current_user
from api.middleware.capture_scope import require_capture_scope
from api.services.journal_two import capture_auth, capture_destinations

router = APIRouter(prefix="/api/j2/capture", tags=["journal-2-0", "browser-capture"])


@router.post("/authorize")
@limiter.limit("10/minute")
def authorize_extension(
    request: Request,
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Step 1 — the deliberate, first-party, session-authenticated connect.

    `get_current_user` is used here ON PURPOSE and unchanged: minting a capture
    credential must require a real UCT session, so this is the one place in the
    Browser Capture family that a capture token can never reach.
    """
    try:
        result = capture_auth.mint_authorization_code(
            user["id"],
            redirect_uri=payload.get("redirectUri"),
            client_id=payload.get("clientId") or capture_auth.CLIENT_ID,
        )
    except capture_auth.CaptureAuthError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result


@router.post("/token")
@limiter.limit("20/minute")
def exchange_code(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """Step 2 — code → scoped token. No session: the code IS the credential,
    which is why it is single-use and lives 120 seconds."""
    try:
        result = capture_auth.exchange_authorization_code(
            code=payload.get("code"),
            redirect_uri=payload.get("redirectUri") or "",
            client_id=payload.get("clientId") or capture_auth.CLIENT_ID,
            label=payload.get("label"),
        )
    except capture_auth.CaptureAuthError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result


@router.get("/destinations")
def list_capture_destinations(
    limit: int = capture_destinations.DEFAULT_LIMIT,
    principal: dict = Depends(require_capture_scope(capture_auth.SCOPE_DESTINATIONS_READ)),
) -> dict[str, Any]:
    """Where a capture may go. Minimal projection — see capture_destinations."""
    return {"destinations": capture_destinations.list_destinations(principal["id"], limit=limit)}


# ── Member-facing connection management (§16) ────────────────────────────────
# Session-only, deliberately: a capture credential must not be able to enumerate
# or revoke credentials, its own included. Managing connections is an account
# operation, and account operations need the account.

@router.get("/connections")
def list_capture_connections(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {"connections": capture_auth.list_connections(user["id"])}


@router.delete("/connections/{token_id}")
def revoke_capture_connection(token_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """Disconnect. Per credential: nobody is logged out, no shared secret
    rotates, no other member or device is affected."""
    if not capture_auth.revoke_connection(user["id"], token_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"revoked": True}
