"""The narrow auth dependency for the Browser Capture surfaces — and ONLY those.

⛔ WHY THIS IS NOT A CHANGE TO `get_current_user` (§8). Teaching the app-wide
dependency to accept the extension bearer would make it a site-wide credential
in one line: every route that depends on `get_current_user` — notes, account,
trading, admin-adjacent — would start accepting it, and nothing in the diff
would say so. So the extension credential is resolved HERE, by a dependency
that a route must opt into by name, and `tests/test_capture_auth_boundary.py`
pins the set of routes allowed to opt in. Adding a route to that set is a
deliberate, reviewable act; widening `get_current_user` would not have been.

The precedence is session-first. A member with a live UCT session is already
strictly more authorized than any capture token, so the in-app doors resolve
exactly as they did before this module existed — the extension path is reached
only when there is no session at all, which on a `chrome-extension://` origin is
always (the cookie is `SameSite=Lax` and is never sent cross-site).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import Cookie, Header, HTTPException

from api.services.auth_service import validate_session
from api.services.journal_two import capture_auth

# What the extension is told when its credential is gone. Deliberately not a
# bare "401 Unauthorized" string: §17 requires the product experience to be an
# instruction, and the extension turns this into one button.
RECONNECT = {
    "error": "reconnect_required",
    "message": "Reconnect UCT Browser Capture to continue.",
}
# Wrong scope is a DIFFERENT answer from an invalid credential: the credential
# is real and current, it simply does not authorize this. Reconnecting would not
# help, so the extension must not offer it.
FORBIDDEN_SCOPE = {
    "error": "insufficient_scope",
    "message": "This connection is not permitted to do that.",
}


def _bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract a bearer value. Never logged, never echoed, never returned in an
    error — this function is the only place the raw header is read."""
    if not authorization or not isinstance(authorization, str):
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def require_capture_scope(scope: str):
    """Factory: a dependency accepting EITHER a normal authenticated web session
    OR a Browser Capture credential carrying `scope`.

    Returns a principal `{"id", "via", "scopes"}`. `id` is the ONE member the
    request acts as — resolved server-side from the credential, never from the
    request body — so every downstream store keeps the tenant isolation Slice 1
    already proved.
    """
    def dependency(
        uct_session: Optional[str] = Cookie(None),
        authorization: Optional[str] = Header(None),
    ) -> dict[str, Any]:
        user = validate_session(uct_session)
        if user:
            return {"id": user["id"], "via": "session", "scopes": None, "user": user}

        principal = capture_auth.resolve_token(_bearer(authorization))
        if principal is None:
            raise HTTPException(status_code=401, detail=RECONNECT)
        if scope not in principal["scopes"]:
            raise HTTPException(status_code=403, detail=FORBIDDEN_SCOPE)
        return {
            "id": principal["user_id"],
            "via": "extension",
            "scopes": principal["scopes"],
            "user": None,
        }

    # The marker the structural rail reads. Each closure is a distinct object,
    # so walking FastAPI's resolved dependency graph for this attribute answers
    # "which routes can an extension credential reach?" from the app itself —
    # never from a hand-typed list that drifts the first time a route is added.
    dependency._capture_scope = scope  # type: ignore[attr-defined]
    return dependency
