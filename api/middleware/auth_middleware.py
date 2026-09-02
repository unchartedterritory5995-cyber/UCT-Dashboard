"""
Auth middleware — extracts session token from cookie, attaches user to request.
Does NOT block any existing endpoints. Only used by routes that explicitly depend on it.
"""

from fastapi import Request, HTTPException, Depends, Cookie
from typing import Optional

from api.services.auth_service import validate_session, get_user_plan
from api.services.trial import is_paid_or_trial, is_account_in_trial


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


def meets_plan_gate(user: dict, allowed_plans: list[str]) -> bool:
    """THE membership predicate `require_plan(allowed_plans)` enforces, as a
    plain function over an already-resolved user dict — for a caller that
    cannot use the cookie-bound `Depends` chain (e.g. a device-token
    authenticated request, which carries no session cookie to read a user
    from). Admins always pass; 'comped' users (comped to paid) are treated
    as allowed — matching is_paid_user/requires_voice_access semantics so
    admin/comp accounts aren't locked out of paid features (and can test
    them); an active trial also passes (feature access only).

    `require_plan` below is the ONLY caller inside the cookie-bound
    dependency chain — it is now a thin wrapper that resolves the user from
    the session cookie and defers the actual entitlement decision here.
    Any other caller resolving its own user (e.g. from a device token) must
    call THIS function directly rather than re-deriving the rule — two
    copies of one membership predicate drift the moment either one changes
    and nothing catches it (see note_sync.py's obsidian device-push gate)."""
    if user.get("role") == "admin":
        return True
    plan = user.get("plan")
    if plan in allowed_plans or plan == "comped":
        return True
    # full-access trial grants paid-feature access (see trial.py).
    if is_account_in_trial(user):
        return True
    return False


def require_plan(allowed_plans: list[str]):
    """Factory: returns a dependency that checks user's plan against allowed
    list. Thin cookie-reading layer over `meets_plan_gate` — see its
    docstring for the actual entitlement rule."""
    def checker(user: dict = Depends(get_current_user_with_plan)) -> dict:
        if meets_plan_gate(user, allowed_plans):
            return user
        raise HTTPException(status_code=403, detail="Upgrade required")
    return checker


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency: requires admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Paid access ─────────────────────────────────────────────────────────────

# Plans that count as "paid". Admins always pass regardless of plan.
# Single source of truth — mirrored by isPaid in app/src/context/AuthContext.jsx.
PAID_PLANS = {"pro", "premium", "lifetime"}

# Back-compat alias (was the voice-only name).
PAID_VOICE_PLANS = PAID_PLANS


def is_paid_user(user: dict) -> bool:
    """True if the user is an admin, on a paid plan, OR within their trial window.

    The trial grants paid-FEATURE access only (see api/services/trial.py); admin
    surfaces (role == 'admin') and billing state are decided separately and are
    unaffected. Defensively defaulted — any error resolves to not-paid."""
    return is_paid_or_trial(user)


def requires_voice_access(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Dependency: gates voice endpoints to paid plans + admins (+ trial users)."""
    if user.get("role") == "admin":
        return user
    if user.get("plan") in PAID_PLANS:
        return user
    # Full-access trial covers Compass / voice (feature access only).
    if is_account_in_trial(user):
        return user
    raise HTTPException(status_code=402, detail="Voice features require a paid plan")
