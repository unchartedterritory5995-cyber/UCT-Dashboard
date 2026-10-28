"""STAGING-ONLY stand-in for ``api.middleware.auth_middleware`` (Checkpoint D2).

The staging web bundle has no UCT auth store, so this file is copied into the
bundle AS ``api/middleware/auth_middleware.py`` and the real News router imports
``require_admin`` from it unchanged. The "admin" here is whoever presents the
staging read token:

    Authorization: Bearer <staging read token>

checked against ``TXN_STAGING_READ_TOKEN_SHA256`` in constant time. No digest
configured => every read is refused (fail closed). Header only -- never a query
parameter -- so the token cannot land in an access log.

⛔ Never part of the production web image; tools/txn_staging_bundle.py is the
only thing that places it.
"""
from __future__ import annotations

import hashlib
import hmac
import os

from fastapi import Header, HTTPException

STAGING_ADMIN = {"id": "txn-staging", "email": "staging@invalid", "role": "admin",
                 "display_name": "TXN staging"}


def _digests() -> tuple[str, ...]:
    return tuple(h.strip().lower() for h in os.environ.get("TXN_STAGING_READ_TOKEN_SHA256", "").split(",")
                 if len(h.strip()) == 64)


def get_current_user(authorization: str = Header("")) -> dict:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    presented = hashlib.sha256(token.strip().encode()).hexdigest()
    if not any(hmac.compare_digest(presented, d) for d in _digests()):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return dict(STAGING_ADMIN)


def require_admin(authorization: str = Header("")) -> dict:
    return get_current_user(authorization)
