"""
Auth router — signup, login, logout, current user, Stripe checkout/portal.
All NEW endpoints under /api/auth/*. Does not touch any existing routes.
"""

import os
import csv
import io
import sqlite3
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Response, Depends, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, EmailStr

from api.limiter import limiter
from api.services import totp_service
from api.services.request_ip import client_ip
from api.services.auth_service import (
    create_user,
    verify_password,
    get_user_by_id,
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
    log_activity,
    get_recent_activity,
    get_user_detail,
    get_mrr_history,
    add_admin_note,
    get_admin_notes,
    list_admin_todos,
    add_admin_todo,
    set_admin_todo_done,
    update_admin_todo,
    delete_admin_todo,
    log_page_view,
    get_page_analytics,
    submit_feedback,
    get_recent_feedback,
    add_user_tag,
    remove_user_tag,
    get_user_tags,
    get_referral_code,
    get_referral_stats,
    apply_referral,
    get_admin_referral_stats,
    get_active_now,
    create_ticket,
    get_user_tickets,
    get_ticket_thread,
    add_ticket_message,
    update_ticket_status,
    get_all_tickets,
    get_ticket_stats,
    set_faq_vote,
    clear_faq_vote,
    get_faq_vote_summary,
    get_all_faq_vote_summaries,
    get_user_preferences,
    set_user_preference,
    delete_user_preference,
)
from api.services.email_service import (
    send_verification_email,
    send_password_reset_email,
    send_welcome_email,
)
from api.services.stripe_service import create_checkout_session, create_portal_session, annual_available
from api.middleware.auth_middleware import get_current_user, get_session_token, PAID_PLANS
from api.services.trial import trial_status

router = APIRouter(prefix="/api/auth", tags=["auth"])

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:5173")
COOKIE_SECURE = os.environ.get("RAILWAY_ENVIRONMENT") is not None  # True on Railway, False local


# ── Request schemas ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str = None
    referral_code: str = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Auth endpoints ───────────────────────────────────────────────────────────

ADMIN_EMAILS = set(filter(None, os.environ.get("ADMIN_EMAILS", "").split(",")))
ADMIN_EMAILS.add("unchartedterritory5995@gmail.com")  # Owner always admin
ADMIN_EMAILS.add("blake.bracco67@gmail.com")  # Admin


def _access_payload(user: dict, plan: str) -> dict:
    """Shared access fields for every auth response (signup/login/me).

    Feeds the frontend's single paid gate (AuthContext.isPaid): `trial` drives
    the trial banner + full-access equivalence, `paid_equiv` is the server's own
    "treat as paid" verdict (admin OR real paid plan OR active trial), and
    `billing.annual_available` lets the pricing page show honest annual copy.

    A genuinely-paid user (or admin) NEVER shows a trial chip — trial.active is
    forced False for them so the banner is trial-only.
    """
    ts = trial_status(user)
    is_paid_plan = user.get("role") == "admin" or plan in PAID_PLANS
    trial_active = bool(ts["active"]) and not is_paid_plan
    return {
        "trial": {
            "active": trial_active,
            "days_left": ts["days_left"] if trial_active else 0,
        },
        "paid_equiv": bool(is_paid_plan or trial_active),
        "billing": {"annual_available": annual_available()},
    }


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

    log_activity(user["id"], "signup")

    # Apply referral code if provided
    if req.referral_code:
        try:
            apply_referral(user["id"], req.referral_code.strip().upper())
        except Exception as e:
            print(f"[signup] Failed to apply referral code: {e}")

    # Discord notification
    try:
        from api.services.discord_notify import notify_signup
        notify_signup(user["email"], req.display_name)
    except Exception:
        pass

    ua = (request.headers.get("user-agent") or "")[:512]
    token = create_session(user["id"], user_agent=ua, ip_address=client_ip(request))
    _set_session_cookie(response, token)
    user["email_verified"] = False
    return {"user": user, "plan": "free", **_access_payload(user, "free")}


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, response: Response):
    user = verify_password(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Auto-promote admin emails on login (in case role wasn't set at signup)
    if user["email"] in ADMIN_EMAILS and user.get("role") != "admin":
        from api.services.auth_db import get_connection as _gc
        _conn = _gc()
        try:
            _conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (user["id"],))
            _conn.commit()
            user["role"] = "admin"
        finally:
            _conn.close()

    # Two-factor: the password alone doesn't earn a session. Hand back a
    # short-lived challenge token; /login/totp-verify trades it + a valid
    # authenticator (or backup) code for the real session.
    if totp_service.is_enabled(user["id"]):
        log_activity(user["id"], "login_totp_challenge", ip_address=client_ip(request))
        return {"requires_totp": True, "challenge_token": totp_service.mint_challenge(user["id"])}

    log_activity(user["id"], "login", ip_address=client_ip(request))

    ua = (request.headers.get("user-agent") or "")[:512]
    token = create_session(user["id"], user_agent=ua, ip_address=client_ip(request))
    _set_session_cookie(response, token)
    plan = get_user_plan(user["id"])
    return {"user": user, "plan": plan, **_access_payload(user, plan)}


class TotpLoginRequest(BaseModel):
    challenge_token: str
    code: str


@router.post("/login/totp-verify")
@limiter.limit("8/minute")
def login_totp_verify(request: Request, req: TotpLoginRequest, response: Response):
    """Second half of a 2FA login: challenge token (from /login) + a 6-digit
    authenticator code or a backup code → session cookie. Mirrors /login's
    response shape so the client finishes identically."""
    uid = totp_service.read_challenge(req.challenge_token)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign-in expired — enter your password again")
    if not totp_service.verify_login_code(uid, req.code):
        log_activity(uid, "login_totp_failed", ip_address=client_ip(request))
        raise HTTPException(status_code=401, detail="That code didn't work — try the next one from your app, or a backup code")
    full = get_user_by_id(uid)
    if not full:
        raise HTTPException(status_code=401, detail="Account not found")
    user = {
        "id": full["id"],
        "email": full["email"],
        "display_name": full.get("display_name"),
        "role": full.get("role"),
        "email_verified": bool(full.get("email_verified")),
    }
    log_activity(uid, "login", ip_address=client_ip(request))
    ua = (request.headers.get("user-agent") or "")[:512]
    token = create_session(uid, user_agent=ua, ip_address=client_ip(request))
    _set_session_cookie(response, token)
    plan = get_user_plan(uid)
    return {"user": user, "plan": plan, **_access_payload(user, plan)}


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
        **_access_payload(user, plan),
    }


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    full_name: str | None = None


@router.post("/update-profile")
def update_profile(req: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    from api.services.auth_db import get_connection
    updates = {}
    if req.display_name is not None:
        name = req.display_name.strip()
        if not name or len(name) > 100:
            raise HTTPException(400, "Display name must be 1-100 characters")
        updates["display_name"] = name
    if req.full_name is not None:
        fn = req.full_name.strip()
        if not fn or len(fn) > 200:
            raise HTTPException(400, "Full name must be 1-200 characters")
        updates["full_name"] = fn
    if not updates:
        raise HTTPException(400, "No fields to update")
    conn = get_connection()
    try:
        for col, val in updates.items():
            conn.execute(f"UPDATE users SET {col} = ? WHERE id = ?", (val, user["id"]))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, **updates}


@router.get("/export-data")
def export_user_data(user: dict = Depends(get_current_user)):
    """Export all user data as JSON (GDPR-friendly)."""
    import json as _json
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        # Gather all user-associated data
        sub = conn.execute("SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ?", (user["id"],)).fetchone()
        prefs = conn.execute("SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?", (user["id"],)).fetchall()
        activity = conn.execute("SELECT action, details, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", (user["id"],)).fetchall()
        feedback_rows = conn.execute("SELECT message, rating, page, created_at FROM feedback WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
        tickets = conn.execute("SELECT subject, category, status, created_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
    finally:
        conn.close()

    # Load trades/watchlists from JSON files if they exist
    trades = []
    watchlists = []
    try:
        import pathlib
        trades_file = pathlib.Path("/data/trades.json")
        if trades_file.exists():
            all_trades = _json.loads(trades_file.read_text())
            trades = [t for t in all_trades if t.get("user_id") == user["id"]]
        wl_file = pathlib.Path("/data/watchlists.json")
        if wl_file.exists():
            all_wl = _json.loads(wl_file.read_text())
            watchlists = [w for w in all_wl if w.get("user_id") == user["id"]]
    except Exception:
        pass

    export = {
        "exported_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "profile": {
            "email": user.get("email"),
            "display_name": user.get("display_name"),
            "created_at": user.get("created_at"),
            "email_verified": bool(user.get("email_verified")),
        },
        "subscription": dict(sub) if sub else None,
        "preferences": {r["pref_key"]: r["pref_value"] for r in prefs} if prefs else {},
        "activity": [dict(r) for r in activity] if activity else [],
        "feedback": [dict(r) for r in feedback_rows] if feedback_rows else [],
        "support_tickets": [dict(r) for r in tickets] if tickets else [],
        "trades": trades,
        "watchlists": watchlists,
    }

    from fastapi.responses import Response
    return Response(
        content=_json.dumps(export, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="uct-export-{user["id"][:8]}.json"'}
    )


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


# ── Two-factor authentication (TOTP + backup codes) ──────────────────────────

class TotpCodeRequest(BaseModel):
    code: str

class TotpDisableRequest(BaseModel):
    password: str
    code: str


@router.get("/totp/status")
def totp_status(user: dict = Depends(get_current_user)):
    return totp_service.status(user["id"])


@router.post("/totp/setup")
@limiter.limit("10/minute")
def totp_setup(request: Request, user: dict = Depends(get_current_user)):
    """Start (or restart) enrollment: fresh secret + QR. Nothing is enforced
    until /totp/verify-setup confirms a working authenticator."""
    if not totp_service.is_available():
        raise HTTPException(status_code=503, detail="Two-factor setup is temporarily unavailable")
    try:
        out = totp_service.begin_setup(user["id"], user["email"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_activity(user["id"], "totp_setup_started", ip_address=client_ip(request))
    return out


@router.post("/totp/verify-setup")
@limiter.limit("10/minute")
def totp_verify_setup(request: Request, req: TotpCodeRequest, user: dict = Depends(get_current_user)):
    try:
        codes = totp_service.confirm_setup(user["id"], req.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_activity(user["id"], "totp_enabled", ip_address=client_ip(request))
    return {"ok": True, "backup_codes": codes}


@router.post("/totp/disable")
@limiter.limit("5/minute")
def totp_disable(request: Request, req: TotpDisableRequest, user: dict = Depends(get_current_user)):
    """Turning 2FA off requires the password AND a valid current code (or a
    backup code) — a stolen session alone must not be able to strip 2FA."""
    if not verify_password(user["email"], req.password):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    if not totp_service.verify_login_code(user["id"], req.code):
        raise HTTPException(status_code=401, detail="That code didn't work")
    totp_service.disable(user["id"])
    log_activity(user["id"], "totp_disabled", ip_address=client_ip(request))
    return {"ok": True}


@router.post("/totp/backup-codes/regenerate")
@limiter.limit("5/minute")
def totp_regen_backup(request: Request, req: TotpCodeRequest, user: dict = Depends(get_current_user)):
    """Mint a fresh set of 10 backup codes (invalidates the old set). Requires
    a valid current code so a hijacked session can't burn the real owner's
    recovery path unnoticed."""
    if not totp_service.verify_login_code(user["id"], req.code):
        raise HTTPException(status_code=401, detail="That code didn't work")
    codes = totp_service.regenerate_backup_codes(user["id"])
    log_activity(user["id"], "totp_backup_codes_regenerated", ip_address=client_ip(request))
    return {"ok": True, "backup_codes": codes}


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
    # Look up user_id from token before executing reset (for activity log)
    from api.services.auth_db import get_connection as _get_conn
    _conn = _get_conn()
    try:
        _reset_row = _conn.execute("SELECT user_id FROM password_resets WHERE token = ? AND used = 0", (req.token,)).fetchone()
        _reset_user_id = _reset_row["user_id"] if _reset_row else None
    finally:
        _conn.close()

    if not execute_password_reset(req.token, req.new_password):
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    if _reset_user_id:
        log_activity(_reset_user_id, "password_reset")

    return {"ok": True}


@router.post("/verify-email")
def verify_email(req: VerifyEmailRequest):
    """Validate email verification token."""
    user_id = verify_email_token(req.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    log_activity(user_id, "email_verified")
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


# ── Feedback endpoints ────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    message: str
    page: str = ""
    rating: int = None


@router.post("/feedback")
def post_feedback(req: FeedbackRequest, user: dict = Depends(get_current_user)):
    """Authenticated: submit user feedback."""
    if not req.message.strip():
        raise HTTPException(400, "Message is required")
    result = submit_feedback(user["id"], user["email"], req.page, req.message.strip(), req.rating)
    return result


@router.get("/admin/feedback")
def admin_feedback(user: dict = Depends(get_current_user), limit: int = 50):
    """Admin-only: return recent feedback."""
    _require_admin(user)
    return get_recent_feedback(limit=limit)


# ── Admin to-do list (shared across all admins) ───────────────────────────────

class TodoRequest(BaseModel):
    task: str


class TodoDoneRequest(BaseModel):
    done: bool


@router.get("/admin/todos")
def admin_list_todos(user: dict = Depends(get_current_user)):
    """Admin-only: shared to-do list for all admins."""
    _require_admin(user)
    return list_admin_todos()


@router.post("/admin/todos")
def admin_create_todo(req: TodoRequest, user: dict = Depends(get_current_user)):
    """Admin-only: add a task to the shared to-do list."""
    _require_admin(user)
    task = req.task.strip()
    if not task:
        raise HTTPException(400, "Task is required")
    return add_admin_todo(task, user["email"])


@router.post("/admin/todos/{todo_id}/done")
def admin_toggle_todo(todo_id: str, req: TodoDoneRequest, user: dict = Depends(get_current_user)):
    """Admin-only: cross a task off (or restore it)."""
    _require_admin(user)
    result = set_admin_todo_done(todo_id, req.done, user["email"])
    if not result:
        raise HTTPException(404, "Task not found")
    return result


@router.put("/admin/todos/{todo_id}")
def admin_edit_todo(todo_id: str, req: TodoRequest, user: dict = Depends(get_current_user)):
    """Admin-only: edit a task's text."""
    _require_admin(user)
    task = req.task.strip()
    if not task:
        raise HTTPException(400, "Task is required")
    result = update_admin_todo(todo_id, task)
    if not result:
        raise HTTPException(404, "Task not found")
    return result


@router.delete("/admin/todos/{todo_id}")
def admin_remove_todo(todo_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: permanently delete a task."""
    _require_admin(user)
    if not delete_admin_todo(todo_id):
        raise HTTPException(404, "Task not found")
    return {"ok": True}


# ── User tag endpoints ────────────────────────────────────────────────────────

class AddTagRequest(BaseModel):
    tag: str


@router.post("/admin/users/{user_id}/tags")
def admin_add_tag(user_id: str, req: AddTagRequest, user: dict = Depends(get_current_user)):
    """Admin-only: add a tag to a user."""
    _require_admin(user)
    return add_user_tag(user_id, req.tag.strip())


@router.delete("/admin/users/{user_id}/tags/{tag}")
def admin_remove_tag(user_id: str, tag: str, user: dict = Depends(get_current_user)):
    """Admin-only: remove a tag from a user."""
    _require_admin(user)
    return remove_user_tag(user_id, tag)


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

@router.post("/admin/verify-email")
def admin_verify_email(req: dict, user: dict = Depends(get_current_user)):
    """Admin-only: manually verify a user's email."""
    _require_admin(user)
    email = req.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (row["id"],))
        conn.commit()
        return {"ok": True, "email": email, "verified": True}
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
        # Log comp/revoke with admin attribution
        from api.services.auth_service import get_user_by_email
        target = get_user_by_email(req.email)
        if target:
            action_label = "comp_granted" if req.action == "grant" else "comp_revoked"
            log_activity(target["id"], action_label, details=f"by admin {user['email']}")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/admin/activity")
def admin_activity(user: dict = Depends(get_current_user), limit: int = 50):
    """Admin-only: return recent activity log."""
    _require_admin(user)
    return get_recent_activity(limit=limit)


@router.get("/admin/mrr-history")
def admin_mrr_history(user: dict = Depends(get_current_user), days: int = 90):
    """Admin-only: return MRR snapshot history."""
    _require_admin(user)
    return get_mrr_history(days=days)


@router.get("/admin/users/{user_id}/notes")
def admin_get_notes(user_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: return all admin notes for a user."""
    _require_admin(user)
    return get_admin_notes(user_id)


@router.post("/admin/users/{user_id}/notes")
def admin_add_note(user_id: str, req: dict, user: dict = Depends(get_current_user)):
    """Admin-only: add admin note for a user."""
    _require_admin(user)
    note_text = req.get("note", "").strip()
    if not note_text:
        raise HTTPException(status_code=400, detail="Note text required")
    return add_admin_note(user_id, note_text, user["email"])


@router.get("/admin/analytics")
def admin_page_analytics(user: dict = Depends(get_current_user), days: int = 7):
    """Admin-only: return page view analytics."""
    _require_admin(user)
    return get_page_analytics(days=days)


@router.post("/track")
def track_page_view(req: dict, user: dict = Depends(get_current_user)):
    """Log a page view for the authenticated user (fire-and-forget from frontend)."""
    page = req.get("page", "").strip()
    if not page:
        return {"ok": True}
    log_page_view(user["id"], page)
    return {"ok": True}


@router.get("/admin/users/{user_id}")
def admin_user_detail(user_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: return full user detail (info + subscription + counts + activity)."""
    _require_admin(user)
    detail = get_user_detail(user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="User not found")
    return detail


@router.post("/admin/users/{user_id}/verify")
def admin_verify_user_by_id(user_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: force-verify a user's email by user ID."""
    _require_admin(user)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (user_id,))
        conn.commit()
        log_activity(user_id, "force_verified", details=f"by admin {user['email']}")
        return {"ok": True, "user_id": user_id, "verified": True}
    finally:
        conn.close()


@router.post("/admin/users/{user_id}/reset-password")
def admin_reset_password_by_id(user_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: send password reset email to user by ID."""
    _require_admin(user)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        token = create_password_reset(row["email"])
        if token:
            try:
                send_password_reset_email(row["email"], token, DASHBOARD_URL)
            except Exception as e:
                print(f"[admin] Failed to send reset email: {e}")
        return {"ok": True, "user_id": user_id}
    finally:
        conn.close()


def _cascade_delete_user(conn, user_id: str) -> None:
    """Delete a user and EVERY row referencing them, across all tables.

    The auth.db has grown to 38+ tables with a foreign key to users(id)
    (voice_*, journal/j2_*, ticker_tags, watchlist_alerts, trading_accounts,
    referrals.referred_user_id, …). Because every connection runs with
    PRAGMA foreign_keys=ON, a single leftover child row (even one ticker tag)
    makes the final `DELETE FROM users` raise "FOREIGN KEY constraint failed"
    → HTTP 500 → the admin panel shows "Delete failed". The hand-maintained
    table list below silently fell ~24 tables behind, so any user who had
    tagged a ticker / used voice / set an alert became undeletable.

    Rather than keep chasing the schema, discover the referencing tables at
    runtime via PRAGMA and clear them. FK enforcement is turned off for the
    scope of the wipe (safe: get_connection() hands out a private connection)
    so deletion order and chain depth can never trip a constraint. Orphaned
    grandchildren that FK to tickets/watchlists rather than to users directly
    are swept afterward.

    Call the broker-sync GDPR purge BEFORE this (it does an external SnapTrade
    revoke that needs the rows present); this then clears whatever remains.
    """
    conn.commit()  # close any implicit txn so the PRAGMA actually takes effect
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for t in tables:
            if t == "users":
                continue
            ref_cols = {fk[3] for fk in conn.execute(f'PRAGMA foreign_key_list("{t}")').fetchall()
                        if fk[2] == "users"}
            for col in ref_cols:
                conn.execute(f'DELETE FROM "{t}" WHERE "{col}" = ?', (user_id,))
        # Grandchildren that reference tickets/watchlists (not users) — now orphaned.
        for orphan_sql in (
            "DELETE FROM ticket_messages    WHERE ticket_id    NOT IN (SELECT id FROM support_tickets)",
            "DELETE FROM ticket_attachments WHERE ticket_id    NOT IN (SELECT id FROM support_tickets)",
            "DELETE FROM watchlist_items    WHERE watchlist_id NOT IN (SELECT id FROM watchlists)",
        ):
            try:
                conn.execute(orphan_sql)
            except Exception:
                pass  # table may not exist in older schemas
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys=ON")


@router.delete("/admin/users/{user_id}")
def admin_delete_user_by_id(user_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: delete a user by ID."""
    _require_admin(user)
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        # Broker-sync cascade (GDPR/CCPA): purge encrypted credentials + data,
        # best-effort revoke at SnapTrade — run first so the external revoke
        # sees the rows before the full wipe removes them.
        try:
            from api.services.journal_two.broker import service as _broker_service
            _broker_service.purge_on_account_deletion(user_id, conn)
        except Exception as _e:
            print(f"[admin-delete] broker purge failed (non-fatal): {_e}")
        _cascade_delete_user(conn, user_id)
        return {"ok": True, "user_id": user_id, "deleted": True}
    finally:
        conn.close()


class ForceVerifyRequest(BaseModel):
    email: EmailStr


@router.post("/admin/force-verify")
def admin_force_verify(req: ForceVerifyRequest, user: dict = Depends(get_current_user)):
    """Admin-only: force-verify a user's email."""
    _require_admin(user)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (req.email.lower().strip(),)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (row["id"],))
        conn.commit()
        log_activity(row["id"], "force_verified", details=f"by admin {user['email']}")
        return {"ok": True, "email": req.email, "verified": True}
    finally:
        conn.close()


class DeleteUserRequest(BaseModel):
    email: EmailStr


@router.post("/admin/delete-user")
def admin_delete_user(req: DeleteUserRequest, user: dict = Depends(get_current_user)):
    """Admin-only: delete a user and all their data (cascade)."""
    _require_admin(user)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (req.email.lower().strip(),)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        target_id = row["id"]
        # Prevent self-deletion
        if target_id == user["id"]:
            raise HTTPException(status_code=400, detail="Cannot delete your own account")
        # Broker-sync cascade (GDPR/CCPA) first (external SnapTrade revoke needs
        # the rows present), then wipe every users(id)-referencing table.
        try:
            from api.services.journal_two.broker import service as _broker_service
            _broker_service.purge_on_account_deletion(target_id, conn)
        except Exception as _e:
            print(f"[delete-user] broker purge failed (non-fatal): {_e}")
        _cascade_delete_user(conn, target_id)
        return {"ok": True, "email": req.email, "deleted": True}
    finally:
        conn.close()


@router.get("/admin/export-csv")
def admin_export_csv(user: dict = Depends(get_current_user)):
    """Admin-only: export all users as CSV."""
    _require_admin(user)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT u.email, u.display_name, "
            "COALESCE(s.plan, 'free') as plan, COALESCE(s.status, 'none') as status, "
            "u.email_verified, u.created_at, u.last_login_at "
            "FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id "
            "ORDER BY u.created_at DESC"
        ).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["email", "display_name", "plan", "status", "email_verified", "created_at", "last_login_at"])
        for r in rows:
            writer.writerow([r["email"], r["display_name"], r["plan"], r["status"],
                             r["email_verified"], r["created_at"], r["last_login_at"]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=users_export.csv"},
        )
    finally:
        conn.close()


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


class MaintenanceRequest(BaseModel):
    enabled: bool


@router.post("/admin/maintenance")
def admin_toggle_maintenance(req: MaintenanceRequest, user: dict = Depends(get_current_user)):
    """Admin-only: toggle maintenance mode."""
    _require_admin(user)
    import api.main as _main_module
    _main_module._MAINTENANCE_MODE = req.enabled
    log_activity(user["id"], "maintenance_toggled", details=f"enabled={req.enabled}")
    return {"ok": True, "maintenance": req.enabled}


@router.post("/admin/send-announcement")
def admin_send_announcement(req: dict, user: dict = Depends(get_current_user)):
    """Admin-only: send an email announcement to users by audience segment."""
    _require_admin(user)
    subject = req.get("subject", "").strip()
    message = req.get("message", "").strip()
    audience = req.get("audience", "all")  # "all", "pro", "free"

    if not subject or not message:
        raise HTTPException(400, "Subject and message required")

    from api.services.email_service import send_email
    from api.services.auth_db import get_connection

    conn = get_connection()
    try:
        if audience == "pro":
            rows = conn.execute(
                "SELECT u.email FROM users u JOIN subscriptions s ON u.id = s.user_id "
                "WHERE s.status IN ('active', 'trialing', 'comped')"
            ).fetchall()
        elif audience == "free":
            rows = conn.execute(
                "SELECT u.email FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id "
                "WHERE s.id IS NULL OR s.status NOT IN ('active', 'trialing', 'comped')"
            ).fetchall()
        else:
            rows = conn.execute("SELECT email FROM users").fetchall()

        emails = [r["email"] for r in rows]
        sent = 0
        for email in emails:
            html = f'''
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0f0d;padding:40px 20px;">
              <tr><td align="center">
                <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1c17;border:1px solid #2e3127;border-radius:8px;padding:32px;">
                  <tr><td style="font-family:'Cinzel',serif;color:#c9a84c;font-size:18px;text-align:center;padding-bottom:16px;">U C T</td></tr>
                  <tr><td style="font-family:Arial,sans-serif;color:#e8e3d6;font-size:15px;line-height:1.6;padding:0 8px;">{message}</td></tr>
                  <tr><td style="border-top:1px solid #2e3127;margin-top:24px;padding-top:16px;font-family:Arial,sans-serif;color:#706b5e;font-size:11px;text-align:center;">
                    UCT Intelligence — <a href="https://uctintelligence.com" style="color:#c9a84c;">uctintelligence.com</a>
                  </td></tr>
                </table>
              </td></tr>
            </table>
            '''
            try:
                send_email(email, subject, html)
                sent += 1
            except:
                pass

        return {"ok": True, "sent": sent, "total": len(emails)}
    finally:
        conn.close()


@router.post("/admin/sync-subscriptions")
def sync_subscriptions(user: dict = Depends(get_current_user)):
    """Admin-only: sync all completed Stripe checkouts to DB."""
    _require_admin(user)
    import stripe as _stripe
    from api.services.auth_service import upsert_subscription
    from datetime import datetime, timezone
    synced = []
    try:
        sessions = _stripe.checkout.Session.list(limit=20)
    except Exception as e:
        raise HTTPException(500, f"Stripe API error: {e}")
    for sess in sessions.data:
        try:
            status = getattr(sess, "status", None)
            metadata = getattr(sess, "metadata", {})
            if isinstance(metadata, dict):
                uid = metadata.get("user_id")
            else:
                uid = getattr(metadata, "user_id", None) or (dict(metadata).get("user_id") if metadata else None)
            if status in ("complete", "completed") and uid:
                sub_id = getattr(sess, "subscription", None)
                cust_id = getattr(sess, "customer", None)
                if sub_id and cust_id:
                    sub = _stripe.Subscription.retrieve(sub_id)
                    period_end = None
                    raw_end = getattr(sub, "current_period_end", None)
                    if raw_end:
                        period_end = datetime.fromtimestamp(raw_end, tz=timezone.utc).isoformat()
                    upsert_subscription(
                        user_id=uid,
                        stripe_customer_id=cust_id,
                        stripe_subscription_id=sub_id,
                        plan="pro",
                        status=getattr(sub, "status", "active"),
                        current_period_end=period_end,
                    )
                    synced.append({"user_id": uid, "status": getattr(sub, "status", "active")})
        except Exception as e:
            print(f"[sync] Error syncing session: {e}")
            continue
    return {"synced": synced}


# ── Referral endpoints ──────────────────────────────────────────────────────

@router.get("/my-referral")
def my_referral(user: dict = Depends(get_current_user)):
    """Return the current user's referral code + stats."""
    stats = get_referral_stats(user["id"])
    return stats


class ApplyReferralRequest(BaseModel):
    code: str


@router.post("/apply-referral")
def apply_referral_endpoint(req: ApplyReferralRequest, user: dict = Depends(get_current_user)):
    """Apply a referral code for the current user."""
    ok = apply_referral(user["id"], req.code.strip().upper())
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid referral code")
    return {"ok": True}


@router.get("/admin/referrals")
def admin_referrals(user: dict = Depends(get_current_user)):
    """Admin-only: referral program stats."""
    _require_admin(user)
    return get_admin_referral_stats()


# ── Active now endpoint ────────────────────────────────────────────────────

@router.get("/admin/active-now")
def admin_active_now(user: dict = Depends(get_current_user)):
    """Admin-only: users active in the last 5 minutes."""
    _require_admin(user)
    return get_active_now(minutes=5)


# ── Support ticket endpoints (user) ─────────────────────────────────────────

class CreateTicketRequest(BaseModel):
    subject: str
    message: str
    category: str = "general"


@router.post("/tickets")
def post_create_ticket(req: CreateTicketRequest, user: dict = Depends(get_current_user)):
    """Create a new support ticket."""
    if not req.subject.strip() or not req.message.strip():
        raise HTTPException(400, "Subject and message are required")
    result = create_ticket(user["id"], req.subject.strip(), req.message.strip(), req.category)

    # Discord notification
    try:
        from api.services.discord_notify import _send_webhook
        _send_webhook({
            "title": "\U0001F3AB New Support Ticket",
            "description": f"**{user['email']}** submitted: {req.subject.strip()}",
            "fields": [{"name": "Category", "value": req.category, "inline": True}],
            "color": 0xC9A84C,
        })
    except Exception:
        pass

    return result


@router.get("/tickets")
def get_my_tickets(user: dict = Depends(get_current_user)):
    """Return all tickets for the current user."""
    return get_user_tickets(user["id"])


@router.get("/tickets/{ticket_id}")
def get_my_ticket_thread(ticket_id: str, user: dict = Depends(get_current_user)):
    """Return a ticket thread, verifying ownership."""
    thread = get_ticket_thread(ticket_id, user_id=user["id"])
    if not thread:
        raise HTTPException(404, "Ticket not found")
    return thread


class TicketMessageRequest(BaseModel):
    message: str


@router.post("/tickets/{ticket_id}/messages")
def post_ticket_message(ticket_id: str, req: TicketMessageRequest, user: dict = Depends(get_current_user)):
    """Add a user message to a ticket thread."""
    if not req.message.strip():
        raise HTTPException(400, "Message is required")
    # Verify ownership
    thread = get_ticket_thread(ticket_id, user_id=user["id"])
    if not thread:
        raise HTTPException(404, "Ticket not found")

    # A user replying to a resolved ticket reopens it, otherwise the reply is
    # invisible to admins (their open/in-progress filters never resurface it).
    reopened = thread["ticket"]["status"] == "resolved"
    if reopened:
        update_ticket_status(ticket_id, "open")

    result = add_ticket_message(ticket_id, user["id"], req.message.strip(), sender_role="user")

    # Notify admins so a user reply never sits unseen until someone happens to
    # open the admin panel. New-ticket creation already pings Discord; this
    # closes the gap for every subsequent reply.
    try:
        from api.services.discord_notify import _send_webhook
        _send_webhook({
            "title": "\U0001F501 Ticket Reopened" if reopened else "\U0001F4AC Ticket Reply",
            "description": f"**{user['email']}** replied to: {thread['ticket']['subject']}",
            "fields": [{"name": "Category", "value": thread["ticket"].get("category") or "general", "inline": True}],
            "color": 0xC9A84C,
        })
    except Exception:
        pass

    return result


# ── FAQ helpfulness votes ──────────────────────────────────────────────────

class FaqVoteRequest(BaseModel):
    helpful: bool  # true = up, false = down


@router.post("/faq-vote/{faq_id}")
def post_faq_vote(faq_id: str, req: FaqVoteRequest, user: dict = Depends(get_current_user)):
    """Record a helpful/not-helpful vote on a Support FAQ article."""
    if not faq_id or len(faq_id) > 64:
        raise HTTPException(400, "Invalid article id")
    return set_faq_vote(user["id"], faq_id, req.helpful)


@router.delete("/faq-vote/{faq_id}")
def delete_faq_vote(faq_id: str, user: dict = Depends(get_current_user)):
    """Withdraw a previous vote."""
    return clear_faq_vote(user["id"], faq_id)


@router.get("/faq-vote/{faq_id}")
def get_faq_vote(faq_id: str, user: dict = Depends(get_current_user)):
    """Aggregate helpfulness counts + the caller's own vote for one article."""
    return get_faq_vote_summary(faq_id, user_id=user["id"])


@router.get("/faq-votes")
def get_faq_votes(user: dict = Depends(get_current_user)):
    """Every FAQ article's vote summary + the caller's own votes in one call."""
    return {"votes": get_all_faq_vote_summaries(user_id=user["id"])}


# ── Ticket attachments (image screenshots) ─────────────────────────────────
#
# Attachments are keyed to a specific message on a ticket. Flow:
#   1. Client creates the ticket + message (existing endpoints)
#   2. Client uploads each image via POST /tickets/{ticket_id}/messages/{msg_id}/attachments
#   3. Thread rendering reads GET /tickets/{ticket_id}/attachments and inlines
#      matching rows below their parent message

@router.post("/tickets/{ticket_id}/messages/{message_id}/attachments")
async def upload_ticket_attachment(
    ticket_id: str,
    message_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Attach an image to a ticket message. Owner-only."""
    from api.services import support_attachments as att

    # Ownership + membership check: the message must belong to the ticket AND
    # the ticket must belong to the caller.
    thread = get_ticket_thread(ticket_id, user_id=user["id"])
    if not thread:
        raise HTTPException(404, "Ticket not found")
    if not any(m["id"] == message_id for m in thread["messages"]):
        raise HTTPException(404, "Message not found on this ticket")

    if file.content_type not in att.ALLOWED_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, WebP, and GIF images are allowed")

    raw = await file.read()
    try:
        row = att.save_attachment(user["id"], ticket_id, message_id, raw)
    except ValueError as e:
        raise HTTPException(400, str(e))

    return {
        "id": row["id"],
        "filename": row["filename"],
        "width": row["width"],
        "height": row["height"],
        "url": f"/api/auth/tickets/{ticket_id}/attachments/{row['filename']}",
    }


@router.get("/tickets/{ticket_id}/attachments")
def list_ticket_attachments(ticket_id: str, user: dict = Depends(get_current_user)):
    """List every attachment on a ticket. Owner-only (admins hit the admin path)."""
    from api.services import support_attachments as att
    # Admin bypasses ownership so they can review the full thread.
    is_admin = user.get("role") == "admin"
    rows = att.get_attachments_for_ticket(ticket_id, user_id=None if is_admin else user["id"])
    for r in rows:
        r["url"] = f"/api/auth/tickets/{ticket_id}/attachments/{r['filename']}"
    return {"attachments": rows}


@router.get("/tickets/{ticket_id}/attachments/{filename}")
def serve_ticket_attachment(ticket_id: str, filename: str, user: dict = Depends(get_current_user)):
    """Serve one attachment file. Owner-only (admins bypass)."""
    from api.services import support_attachments as att
    is_admin = user.get("role") == "admin"
    path = att.get_attachment_path(ticket_id, filename, user_id=None if is_admin else user["id"])
    if not path or not path.exists():
        raise HTTPException(404, "Attachment not found")
    return FileResponse(
        str(path),
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.delete("/attachments/{attachment_id}")
def delete_ticket_attachment(attachment_id: str, user: dict = Depends(get_current_user)):
    """Remove an attachment. Owner-only. Used by the ticket form's
    remove-before-submit + the thread's user-side delete."""
    from api.services import support_attachments as att
    is_admin = user.get("role") == "admin"
    ok = att.delete_attachment(attachment_id, user_id=None if is_admin else user["id"])
    if not ok:
        raise HTTPException(404, "Attachment not found")
    return {"ok": True}


# ── Danger zone: request account deletion ──────────────────────────────────
#
# Solo-owner op — we do NOT delete accounts automatically. The user files a
# structured request via this endpoint, which creates a `deletion_requests`
# row + a paired [DELETE ACCOUNT] support ticket. The owner processes it
# manually. Requiring the current password blocks a stolen-cookie attacker
# from tanking someone's account.

class DeletionRequest(BaseModel):
    password: str
    reason: str = ""
    confirmation: str  # user must type "delete my account" to enable the submit


@router.post("/request-deletion")
def request_account_deletion(req: DeletionRequest, user: dict = Depends(get_current_user)):
    """Open a formal deletion request. See docstring above."""
    if req.confirmation.strip().lower() != "delete my account":
        raise HTTPException(400, 'Type "delete my account" exactly to confirm')

    # Re-verify the password to defeat stolen-cookie attacks.
    from api.services.auth_service import verify_password
    if not verify_password(user["email"], req.password):
        raise HTTPException(401, "Password is incorrect")

    from api.services.auth_db import get_connection
    import uuid as _uuid
    request_id = str(_uuid.uuid4())
    reason = (req.reason or "").strip()[:2000]

    # Create a paired support ticket so the request lives in the same admin
    # inbox the owner already checks daily.
    ticket = create_ticket(
        user_id=user["id"],
        subject="[DELETE ACCOUNT] " + (user.get("email") or "(unknown email)"),
        message=(
            "Account deletion requested.\n\n"
            f"User: {user.get('email')} ({user['id'][:8]})\n"
            f"Reason: {reason or '(no reason given)'}\n\n"
            "The user has re-verified their password. Please process the "
            "deletion (subscription cancel + data purge) at your earliest "
            "convenience."
        ),
        category="account",
    )

    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO deletion_requests (id, user_id, reason, ticket_id) VALUES (?, ?, ?, ?)",
            (request_id, user["id"], reason, ticket["id"]),
        )
        conn.commit()
    finally:
        conn.close()

    # Discord ping so the owner catches this out of hours.
    try:
        from api.services.discord_notify import _send_webhook
        _send_webhook({
            "title": "\U0001F6D1 Account Deletion Requested",
            "description": f"**{user['email']}** requested account deletion.",
            "fields": [{"name": "Reason", "value": reason[:1024] or "(none)", "inline": False}],
            "color": 0xef4444,
        })
    except Exception:
        pass

    return {"ok": True, "request_id": request_id, "ticket_id": ticket["id"]}


@router.get("/deletion-request")
def get_my_deletion_request(user: dict = Depends(get_current_user)):
    """Return the caller's pending deletion request, if any. Frontend uses
    this to swap the Danger Zone button for a status message so the user
    doesn't file duplicate requests."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, created_at, processed_at, ticket_id FROM deletion_requests "
            "WHERE user_id = ? AND processed_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (user["id"],),
        ).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


# ── Active sessions ─────────────────────────────────────────────────────────
#
# List every valid session (device / browser) the user has open, with a
# revoke-individual and revoke-others button. Complements the existing single
# /logout by making session hygiene visible.

@router.get("/sessions")
def list_my_sessions(request: Request, user: dict = Depends(get_current_user)):
    """List every valid session for the caller. The caller's own session is
    flagged so the UI can label it 'This device'."""
    from api.services.auth_db import get_connection
    current_token = request.cookies.get("uct_session")
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT token, user_agent, ip_address, created_at, last_seen_at "
            "FROM sessions WHERE user_id = ? AND expires_at > datetime('now') "
            "ORDER BY last_seen_at DESC",
            (user["id"],),
        ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        # Never leak the raw token; expose the last 6 chars so the UI can
        # target a revoke, and a flag for "you are here".
        tok = d.pop("token")
        d["short_id"] = tok[-6:] if tok else ""
        d["is_current"] = bool(current_token and tok == current_token)
        out.append(d)
    return {"sessions": out}


@router.delete("/sessions/{short_id}")
def revoke_session(short_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Revoke one specific session by its short id (last 6 chars of the
    token). Refuses to revoke the caller's own session — use the standard
    logout for that."""
    if not short_id or len(short_id) < 4 or len(short_id) > 16:
        raise HTTPException(400, "Invalid session id")
    current_token = request.cookies.get("uct_session") or ""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT token FROM sessions WHERE user_id = ? AND token LIKE ? LIMIT 1",
            (user["id"], f"%{short_id}"),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Session not found")
        if row["token"] == current_token:
            raise HTTPException(400, "Use the Log Out button for the current device")
        conn.execute("DELETE FROM sessions WHERE token = ?", (row["token"],))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(request: Request, user: dict = Depends(get_current_user)):
    """Kill every session except the caller's own. Use this after suspecting
    a stolen cookie or when signing out of a lost device."""
    current_token = request.cookies.get("uct_session") or ""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token != ?",
            (user["id"], current_token),
        )
        conn.commit()
        return {"ok": True, "revoked": cur.rowcount}
    finally:
        conn.close()


# ── Support ticket endpoints (admin) ───────────────────────────────────────

@router.get("/admin/tickets/stats")
def admin_ticket_stats(user: dict = Depends(get_current_user)):
    """Admin-only: ticket overview stats."""
    _require_admin(user)
    return get_ticket_stats()


@router.get("/admin/tickets")
def admin_tickets(user: dict = Depends(get_current_user), status: str = None, limit: int = 50):
    """Admin-only: list all tickets with optional status filter."""
    _require_admin(user)
    return get_all_tickets(status_filter=status, limit=limit)


@router.get("/admin/tickets/{ticket_id}")
def admin_ticket_thread(ticket_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: get ticket thread (no ownership check)."""
    _require_admin(user)
    thread = get_ticket_thread(ticket_id)
    if not thread:
        raise HTTPException(404, "Ticket not found")
    return thread


class AdminReplyRequest(BaseModel):
    message: str


@router.post("/admin/tickets/{ticket_id}/reply")
def admin_ticket_reply(ticket_id: str, req: AdminReplyRequest, user: dict = Depends(get_current_user)):
    """Admin-only: add an admin reply to a ticket."""
    _require_admin(user)
    if not req.message.strip():
        raise HTTPException(400, "Message is required")
    # Auto-set status to in_progress if currently open
    thread = get_ticket_thread(ticket_id)
    if not thread:
        raise HTTPException(404, "Ticket not found")
    if thread["ticket"]["status"] == "open":
        update_ticket_status(ticket_id, "in_progress")
    return add_ticket_message(ticket_id, user["id"], req.message.strip(), sender_role="admin")


class TicketStatusRequest(BaseModel):
    status: str
    priority: str = None


@router.post("/admin/tickets/{ticket_id}/status")
def admin_ticket_status(ticket_id: str, req: TicketStatusRequest, user: dict = Depends(get_current_user)):
    """Admin-only: update ticket status and optionally priority."""
    _require_admin(user)
    if req.status not in ("open", "in_progress", "resolved"):
        raise HTTPException(400, "Invalid status")
    if req.priority and req.priority not in ("low", "normal", "high", "urgent"):
        raise HTTPException(400, "Invalid priority")
    return update_ticket_status(ticket_id, req.status, req.priority)


# ── Stripe endpoints ────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    # "monthly" (STRIPE_PRICE_ID_PRO) | "annual" (STRIPE_PRICE_ID_ANNUAL, falls
    # back to monthly when that price isn't configured yet).
    plan: str = "monthly"


@router.post("/checkout")
def checkout(user: dict = Depends(get_current_user), body: Optional[CheckoutRequest] = None):
    """Redirect user to Stripe Checkout to subscribe. Optional body {plan}.

    First-ever subscribers get the 7-day card-required free trial
    (subscription_data.trial_period_days — the landing/Terms promise); anyone
    who has held a subscription before pays from day one."""
    from api.services.stripe_service import TRIAL_PERIOD_DAYS, is_trial_eligible
    billing = body.plan if (body and body.plan in ("monthly", "annual")) else "monthly"
    trial_days = TRIAL_PERIOD_DAYS if is_trial_eligible(user["id"]) else None
    try:
        url = create_checkout_session(
            user_id=user["id"],
            user_email=user["email"],
            success_url=f"{DASHBOARD_URL}/dashboard?checkout=success",
            cancel_url=f"{DASHBOARD_URL}/pricing?checkout=canceled",
            billing=billing,
            trial_days=trial_days,
        )
        return {"checkout_url": url, "trial_days": trial_days or 0}
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


# ── User preferences ─────────────────────────────────────────────────────────

class SetPreferenceRequest(BaseModel):
    key: str
    value: str


@router.get("/preferences")
def get_preferences(user: dict = Depends(get_current_user)):
    return get_user_preferences(user["id"])


@router.post("/preferences")
def upsert_preference(req: SetPreferenceRequest, user: dict = Depends(get_current_user)):
    set_user_preference(user["id"], req.key, req.value)
    return {"ok": True}


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
