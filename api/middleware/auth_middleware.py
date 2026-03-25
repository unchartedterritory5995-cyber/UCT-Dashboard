"""
Auth middleware — extracts session token from cookie, attaches user to request.
Does NOT block any existing endpoints. Only used by routes that explicitly depend on it.
"""

from fastapi import Request, HTTPException, Depends, Cookie
from typing import Optional

from api.services.auth_service import validate_session, get_user_plan


def get_session_token(uct_session: Optional[str] = Cookie(None)) -> Optional[str]:
    return uct_session


def get_current_user(uct_session: Optional[str] = Cookie(None)) -> dict:
    """Dependency: returns authenticated user or raises 401."""
    user = validate_session(uct_session)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def get_current_user_optional(uct_session: Optional[str] = Cookie(None)) -> Optional[dict]:
    """Dependency: returns user if authenticated, None otherwise. Never raises."""
    return validate_session(uct_session)


def get_current_user_with_plan(user: dict = Depends(get_current_user)) -> dict:
    """Dependency: returns user dict with 'plan' field added."""
    user["plan"] = get_user_plan(user["id"])
    return user


def require_plan(allowed_plans: list[str]):
    """Factory: returns a dependency that checks user's plan against allowed list."""
    def checker(user: dict = Depends(get_current_user_with_plan)) -> dict:
        if user["plan"] not in allowed_plans:
            raise HTTPException(status_code=403, detail="Upgrade required")
        return user
    return checker


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency: requires admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
