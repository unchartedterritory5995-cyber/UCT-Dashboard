"""
flow_admin_auth.py — auth dependencies for the options-flow mutating endpoints.

Before 2026-07-06 every mutating flow endpoint (/api/flow/upload,
/api/darkpool/clear, /api/dealer-positioning/backfill, /api/top-flow/wipe, …)
was unauthenticated — one curl could wipe or poison production data
(competitive-roadmap T1-4). These dependencies close that while keeping both
legitimate callers working:

- Browser admin flows (the in-app CSV upload / admin workbenches) authenticate
  via the normal uct_session cookie with role=admin.
- External scripts (partner tooling, cron, ops curl) authenticate with
  `Authorization: Bearer <PUSH_SECRET>` — the same service-token idiom used
  by /api/push and /api/flow-gap-fill.
"""
import os
import json
import hmac
import hashlib
from typing import Optional

from fastapi import Cookie, Header, HTTPException

from api.services.auth_service import validate_session

# P5 proxy-trust headers. auth.db lives ONLY on web, so when the flow endpoints
# run on the WORKER (post-cutover) they can't validate a session cookie. Instead,
# web (which HAS auth.db) validates the cookie in the reverse-proxy, then vouches
# for the user by HMAC-signing the payload with PUSH_SECRET and forwarding it as
# these headers over Railway private networking. The worker trusts them ONLY when
# FLOW_PROXY_TRUST=1 (a worker-only flag) — so this path is a complete no-op on
# web and cannot be forged from the public internet.
_PROXY_USER_HEADER = "x-uct-proxy-user"
_PROXY_SIG_HEADER = "x-uct-proxy-sig"


def _push_secret_ok(authorization: str) -> bool:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    return bool(secret) and authorization == f"Bearer {secret}"


def proxy_sign_user(user_json: str) -> str:
    """HMAC-SHA256 the user payload with PUSH_SECRET (web-side; used by the proxy)."""
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    return hmac.new(secret.encode(), user_json.encode(), hashlib.sha256).hexdigest()


def _proxy_trusted_user(proxy_user: str, proxy_sig: str) -> Optional[dict]:
    """Worker-side: return the web-vouched user, or None. Inert unless
    FLOW_PROXY_TRUST=1, so it never fires on web (which has no such flag)."""
    if os.environ.get("FLOW_PROXY_TRUST", "0") != "1":
        return None
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not (proxy_user and proxy_sig and secret):
        return None
    if not hmac.compare_digest(proxy_sign_user(proxy_user), proxy_sig):
        return None
    try:
        u = json.loads(proxy_user)
        return u if isinstance(u, dict) else None
    except Exception:  # noqa: BLE001
        return None


def require_flow_admin(uct_session: Optional[str] = Cookie(None),
                       authorization: str = Header(default=""),
                       x_uct_proxy_user: str = Header(default=""),
                       x_uct_proxy_sig: str = Header(default="")) -> dict:
    """Admin session cookie OR PUSH_SECRET bearer OR (on the flow worker) a
    web-vouched admin. For destructive/mutating flow-data endpoints."""
    if _push_secret_ok(authorization):
        return {"via": "push_secret", "role": "admin"}
    tu = _proxy_trusted_user(x_uct_proxy_user, x_uct_proxy_sig)
    if tu and tu.get("role") == "admin":
        return {**tu, "via": "proxy_trusted"}
    user = validate_session(uct_session)
    if user and user.get("role") == "admin":
        return user
    raise HTTPException(status_code=403,
                        detail="Admin session or service token required")


def require_flow_user(uct_session: Optional[str] = Cookie(None),
                      authorization: str = Header(default=""),
                      x_uct_proxy_user: str = Header(default=""),
                      x_uct_proxy_sig: str = Header(default="")) -> dict:
    """Any logged-in session OR PUSH_SECRET bearer OR (on the flow worker) a
    web-vouched user. For endpoints the frontend auto-calls from browsers."""
    if _push_secret_ok(authorization):
        return {"via": "push_secret"}
    tu = _proxy_trusted_user(x_uct_proxy_user, x_uct_proxy_sig)
    if tu:
        return {**tu, "via": "proxy_trusted"}
    user = validate_session(uct_session)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Not authenticated")
