"""
Auth router — signup, login, logout, current user, Stripe checkout/portal.
All NEW endpoints under /api/auth/*. Does not touch any existing routes.
"""

import os
import sqlite3
from fastapi import APIRouter, HTTPException, Response, Depends
from pydantic import BaseModel, EmailStr

from api.services.auth_service import (
    create_user,
    verify_password,
    create_session,
    delete_session,
    get_user_plan,
    get_subscription,
    change_password,
    list_all_users,
)
from api.services.stripe_service import create_checkout_session, create_portal_session
from api.middleware.auth_middleware import get_current_user, get_session_token

router = APIRouter(prefix="/api/auth", tags=["auth"])

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:5173")
COOKIE_SECURE = os.environ.get("RAILWAY_ENVIRONMENT") is not None  # True on Railway, False local


# ── Request schemas ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Auth endpoints ───────────────────────────────────────────────────────────

ADMIN_EMAILS = set(filter(None, os.environ.get("ADMIN_EMAILS", "").split(",")))


@router.post("/signup")
def signup(req: SignupRequest, response: Response):
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        user = create_user(req.email, req.password, req.display_name)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Auto-promote admin emails
    if user["email"] in ADMIN_EMAILS:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (user["id"],))
            conn.commit()
            user["role"] = "admin"
        finally:
            conn.close()

    token = create_session(user["id"])
    _set_session_cookie(response, token)
    return {"user": user, "plan": "free"}


@router.post("/login")
def login(req: LoginRequest, response: Response):
    user = verify_password(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_session(user["id"])
    _set_session_cookie(response, token)
    plan = get_user_plan(user["id"])
    return {"user": user, "plan": plan}


@router.post("/logout")
def logout(response: Response, token: str = Depends(get_session_token)):
    if token:
        delete_session(token)
    response.delete_cookie("uct_session", path="/")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    plan = get_user_plan(user["id"])
    sub = get_subscription(user["id"])
    return {
        "user": user,
        "plan": plan,
        "subscription": {
            "status": sub["status"] if sub else None,
            "current_period_end": sub["current_period_end"] if sub else None,
        } if sub else None,
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_pw(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not change_password(user["id"], req.current_password, req.new_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    return {"ok": True}


@router.get("/admin/users")
def admin_users(user: dict = Depends(get_current_user)):
    """Admin-only: list all users with subscription info. Only role=admin can access."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return list_all_users()


@router.get("/admin/stripe-check")
def stripe_check(user: dict = Depends(get_current_user)):
    """Admin-only: check Stripe env vars are set."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    from api.services.stripe_service import STRIPE_PRICE_ID_PRO, STRIPE_WEBHOOK_SECRET
    import stripe as _stripe
    return {
        "api_key_set": bool(_stripe.api_key),
        "api_key_prefix": (_stripe.api_key or "")[:12] + "..." if _stripe.api_key else None,
        "price_id": STRIPE_PRICE_ID_PRO or "(empty)",
        "webhook_secret_set": bool(STRIPE_WEBHOOK_SECRET),
        "dashboard_url": DASHBOARD_URL,
    }


# ── Stripe endpoints ────────────────────────────────────────────────────────

@router.post("/checkout")
def checkout(user: dict = Depends(get_current_user)):
    """Redirect user to Stripe Checkout to subscribe."""
    try:
        url = create_checkout_session(
            user_id=user["id"],
            user_email=user["email"],
            success_url=f"{DASHBOARD_URL}/dashboard?checkout=success",
            cancel_url=f"{DASHBOARD_URL}/signup?checkout=canceled",
        )
        return {"checkout_url": url}
    except Exception as e:
        print(f"[checkout] Stripe error for user {user['id']}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to create checkout session: {str(e)}")


@router.post("/portal")
def portal(user: dict = Depends(get_current_user)):
    """Redirect user to Stripe Customer Portal to manage subscription."""
    try:
        url = create_portal_session(
            user_id=user["id"],
            return_url=f"{DASHBOARD_URL}/settings",
        )
        return {"portal_url": url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Helpers ──────────────────────────────────────────────────────────────────

def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="uct_session",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=30 * 24 * 60 * 60,  # 30 days
    )
