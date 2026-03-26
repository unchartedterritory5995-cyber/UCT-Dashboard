"""
Auth router — signup, login, logout, current user, Stripe checkout/portal.
All NEW endpoints under /api/auth/*. Does not touch any existing routes.
"""

import os
import sqlite3
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr

from api.limiter import limiter
from api.services.auth_service import (
    create_user,
    verify_password,
    create_session,
    delete_session,
    get_user_plan,
    get_subscription,
    change_password,
    list_all_users,
    list_users_filtered,
    get_admin_stats,
    comp_user_access,
    create_email_verification,
    verify_email_token,
    create_password_reset,
    execute_password_reset,
)
from api.services.email_service import (
    send_verification_email,
    send_password_reset_email,
    send_welcome_email,
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
@limiter.limit("3/minute")
def signup(request: Request, req: SignupRequest, response: Response):
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

    # Send verification email (non-blocking — don't fail signup if email fails)
    try:
        ver_token = create_email_verification(user["id"])
        send_verification_email(user["email"], ver_token, DASHBOARD_URL)
    except Exception as e:
        print(f"[signup] Failed to send verification email: {e}")

    token = create_session(user["id"])
    _set_session_cookie(response, token)
    user["email_verified"] = False
    return {"user": user, "plan": "free"}


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, response: Response):
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


# ── Email verification & password reset ──────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class VerifyEmailRequest(BaseModel):
    token: str


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, req: ForgotPasswordRequest):
    """Send password reset email. Always returns ok to prevent email enumeration."""
    token = create_password_reset(req.email)
    if token:
        try:
            send_password_reset_email(req.email, token, DASHBOARD_URL)
        except Exception as e:
            print(f"[auth] Failed to send reset email: {e}")
    return {"ok": True}


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, req: ResetPasswordRequest):
    """Validate reset token and set new password."""
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not execute_password_reset(req.token, req.new_password):
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    return {"ok": True}


@router.post("/verify-email")
def verify_email(req: VerifyEmailRequest):
    """Validate email verification token."""
    user_id = verify_email_token(req.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    # Send welcome email
    from api.services.auth_service import get_user_by_id
    user = get_user_by_id(user_id)
    if user:
        try:
            send_welcome_email(user["email"], user.get("display_name"))
        except Exception as e:
            print(f"[auth] Failed to send welcome email: {e}")
    return {"ok": True, "user_id": user_id}


@router.post("/resend-verification")
@limiter.limit("3/minute")
def resend_verification(request: Request, user: dict = Depends(get_current_user)):
    """Resend email verification link. Requires auth."""
    if user.get("email_verified"):
        return {"ok": True, "message": "Email already verified"}
    try:
        token = create_email_verification(user["id"])
        send_verification_email(user["email"], token, DASHBOARD_URL)
    except Exception as e:
        print(f"[auth] Failed to resend verification email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send verification email")
    return {"ok": True}


def _require_admin(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


class AdminResetRequest(BaseModel):
    email: EmailStr
    new_password: str

@router.post("/admin/reset-password")
def admin_reset_password(req: AdminResetRequest, user: dict = Depends(get_current_user)):
    """Admin-only: reset any user's password by email."""
    _require_admin(user)
    import bcrypt as _bcrypt
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        new_hash = _bcrypt.hashpw(req.new_password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, row["id"]))
        conn.commit()
        return {"ok": True, "email": req.email}
    finally:
        conn.close()

@router.get("/admin/users")
def admin_users(
    user: dict = Depends(get_current_user),
    search: str = None,
    plan: str = None,
    sort: str = "created_at",
):
    """Admin-only: list all users with subscription info. Supports search, plan filter, sort."""
    _require_admin(user)
    return list_users_filtered(search=search, plan_filter=plan, sort_by=sort)


@router.get("/admin/stats")
def admin_stats(user: dict = Depends(get_current_user)):
    """Admin-only: return dashboard stats (total users, subscribers, MRR, signups)."""
    _require_admin(user)
    return get_admin_stats()


class CompAccessRequest(BaseModel):
    email: EmailStr
    action: str  # "grant" or "revoke"


@router.post("/admin/comp-access")
def admin_comp_access(req: CompAccessRequest, user: dict = Depends(get_current_user)):
    """Admin-only: grant or revoke comped Pro access for a user."""
    _require_admin(user)
    try:
        result = comp_user_access(req.email, grant=(req.action == "grant"))
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/admin/stripe-check")
def stripe_check(user: dict = Depends(get_current_user)):
    """Admin-only: check Stripe env vars are set."""
    _require_admin(user)
    from api.services.stripe_service import STRIPE_PRICE_ID_PRO, STRIPE_WEBHOOK_SECRET
    import stripe as _stripe
    return {
        "api_key_set": bool(_stripe.api_key),
        "api_key_prefix": (_stripe.api_key or "")[:12] + "..." if _stripe.api_key else None,
        "price_id": STRIPE_PRICE_ID_PRO or "(empty)",
        "webhook_secret_set": bool(STRIPE_WEBHOOK_SECRET),
        "dashboard_url": DASHBOARD_URL,
    }


@router.post("/admin/sync-subscriptions")
def sync_subscriptions(user: dict = Depends(get_current_user)):
    """Admin-only: sync all completed Stripe checkouts to DB."""
    _require_admin(user)
    import stripe as _stripe
    from api.services.auth_service import upsert_subscription
    from datetime import datetime, timezone
    synced = []
    sessions = _stripe.checkout.Session.list(limit=20)
    for sess in sessions.data:
        if sess.status == "complete" and sess.metadata.get("user_id"):
            sub_id = sess.subscription
            cust_id = sess.customer
            if sub_id and cust_id:
                sub = _stripe.Subscription.retrieve(sub_id)
                period_end = None
                if hasattr(sub, 'current_period_end') and sub.current_period_end:
                    period_end = datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc).isoformat()
                upsert_subscription(
                    user_id=sess.metadata["user_id"],
                    stripe_customer_id=cust_id,
                    stripe_subscription_id=sub_id,
                    plan="pro",
                    status=sub.status,
                    current_period_end=period_end,
                )
                synced.append({"user_id": sess.metadata["user_id"], "status": sub.status})
    return {"synced": synced}


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
