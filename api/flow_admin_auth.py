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
from typing import Optional

from fastapi import Cookie, Header, HTTPException

from api.services.auth_service import validate_session


def _push_secret_ok(authorization: str) -> bool:
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    return bool(secret) and authorization == f"Bearer {secret}"


def require_flow_admin(uct_session: Optional[str] = Cookie(None),
                       authorization: str = Header(default="")) -> dict:
    """Admin session cookie OR PUSH_SECRET bearer. For destructive/mutating
    flow-data endpoints (uploads, prunes, wipes, backfills, Discord posts)."""
    if _push_secret_ok(authorization):
        return {"via": "push_secret", "role": "admin"}
    user = validate_session(uct_session)
    if user and user.get("role") == "admin":
        return user
    raise HTTPException(status_code=403,
                        detail="Admin session or service token required")


def require_flow_user(uct_session: Optional[str] = Cookie(None),
                      authorization: str = Header(default="")) -> dict:
    """Any logged-in session OR PUSH_SECRET bearer. For endpoints the normal
    frontend auto-calls from user browsers (top-flow save/snapshot)."""
    if _push_secret_ok(authorization):
        return {"via": "push_secret"}
    user = validate_session(uct_session)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Not authenticated")
