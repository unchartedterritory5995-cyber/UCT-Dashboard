"""Fail-closed admin gate for the confirmed-unauthenticated ops/mutation endpoints.

The `/api/admin/{massive,oi,ticker-types,flow}/*`, `/api/admin/alert-tester`, and
`/api/live/admin/*` families were completely unauthenticated — anyone who found a URL
could corrupt/wipe the Options Flow DB (apply-gap-fill, clear-before-date, rebuild-color,
normalize-sweep-sides, …), run minutes of blocking backfill work on the event loop, or
run expensive debug queries. Each carried its own unfulfilled `TODO: require_admin`.

Other admin surfaces already gate themselves per-endpoint (`/api/admin/bars/*` uses
`Depends(require_admin)`; the auth admin panel likewise), and the read-only status
dashboards (`reconciliation-status`, `fundamentals-health`, `twitter-stats`,
`catalyst-stats`) are intentionally anonymous — so those are deliberately NOT matched
here. This middleware gates only the enumerated prefixes and requires an admin session;
within those subtrees it fails CLOSED (a new massive/oi/flow/… route is protected by
default). The session read is on the event loop, which is fine: this surface is ops-only
(near-zero traffic), never a user hot path.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from api.services.auth_service import validate_session

# Whole subtrees that were unauthenticated and must require admin. Everything else under
# /api/admin (already Depends-gated, or read-only status dashboards) is left untouched.
GUARDED_PREFIXES = (
    "/api/admin/massive/",
    "/api/admin/oi/",
    "/api/admin/ticker-types/",
    "/api/admin/flow/",
    "/api/admin/alert-tester",
    "/api/live/admin/",
)


def _is_guarded(path: str) -> bool:
    return any(path.startswith(p) for p in GUARDED_PREFIXES)


class AdminGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if _is_guarded(request.url.path):
            user = None
            try:
                user = validate_session(request.cookies.get("uct_session"))
            except Exception:  # pragma: no cover - any auth error ⇒ unauthenticated
                user = None
            if not user or user.get("role") != "admin":
                return JSONResponse({"detail": "Admin access required"}, status_code=403)
        return await call_next(request)
