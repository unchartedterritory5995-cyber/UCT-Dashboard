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

@router.post("/signup")
def signup(req: SignupRequest, response: Response):
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        user = create_user(req.email, req.password, req.display_name)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Email already registered")

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


# ── Stripe endpoints ────────────────────────────────────────────────────────

@router.post("/checkout")
def checkout(user: dict = Depends(get_current_user)):
    """Redirect user to Stripe Checkout to subscribe."""
    url = create_checkout_session(
        user_id=user["id"],
        user_email=user["email"],
        success_url=f"{DASHBOARD_URL}/dashboard?checkout=success",
        cancel_url=f"{DASHBOARD_URL}/signup?checkout=canceled",
    )
    return {"checkout_url": url}


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
