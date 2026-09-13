"""The owner gate for owner-private Wisdom data (docs/wisdom/CONTRACTS.md §2.4).

require_admin alone is not enough: the admin role also covers team members, the
synthetic smoke account and an outside contractor. The owner is the FIRST
address in ADMIN_EMAILS, the same resolution api/routers/render_panels.py,
desk_daily_session and compass_health use. ADMIN_EMAILS unset refuses everyone.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException

from api.middleware.auth_middleware import require_admin


def owner_email() -> Optional[str]:
    emails = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
    return emails[0] if emails else None


def is_owner(user: Optional[dict]) -> bool:
    owner = owner_email()
    email = str((user or {}).get("email") or "").strip().lower()
    return bool(owner) and email == owner


def require_owner(user: dict = Depends(require_admin)) -> dict:
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Owner access required")
    return user
