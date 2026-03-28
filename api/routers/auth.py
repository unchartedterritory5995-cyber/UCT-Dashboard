"""
Auth router — signup, login, logout, current user, Stripe checkout/portal.
All NEW endpoints under /api/auth/*. Does not touch any existing routes.
"""

import os
import csv
import io
import sqlite3
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import StreamingResponse
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
    log_activity,
    get_recent_activity,
    get_user_detail,
    get_mrr_history,
    add_admin_note,
    get_admin_notes,
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
    referral_code: str = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Auth endpoints ───────────────────────────────────────────────────────────

ADMIN_EMAILS = set(filter(None, os.environ.get("ADMIN_EMAILS", "").split(",")))
ADMIN_EMAILS.add("unchartedterritory5995@gmail.com")  # Owner always admin


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

    log_activity(user["id"], "login", ip_address=request.client.host)

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


class UpdateProfileRequest(BaseModel):
    display_name: str


@router.post("/update-profile")
def update_profile(req: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    name = req.display_name.strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Display name must be 1-100 characters")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (name, user["id"]))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "display_name": name}


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
        conn.execute("DELETE FROM activity_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM email_verifications WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM journal_entries WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM admin_notes WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM page_views WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM referrals WHERE referrer_user_id = ?", (user_id,))
        # Support tickets + messages (cascade via FK, but explicit for safety)
        tk_ids = [r["id"] for r in conn.execute("SELECT id FROM support_tickets WHERE user_id = ?", (user_id,)).fetchall()]
        for tk_id in tk_ids:
            conn.execute("DELETE FROM ticket_messages WHERE ticket_id = ?", (tk_id,))
        conn.execute("DELETE FROM support_tickets WHERE user_id = ?", (user_id,))
        wl_ids = [r["id"] for r in conn.execute("SELECT id FROM watchlists WHERE user_id = ?", (user_id,)).fetchall()]
        for wl_id in wl_ids:
            conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (wl_id,))
        conn.execute("DELETE FROM watchlists WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
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
        # Cascade delete all related data
        conn.execute("DELETE FROM activity_log WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM subscriptions WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM email_verifications WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM password_resets WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM journal_entries WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM admin_notes WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM page_views WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM referrals WHERE referrer_user_id = ?", (target_id,))
        # Support tickets + messages
        tk_ids = [r["id"] for r in conn.execute("SELECT id FROM support_tickets WHERE user_id = ?", (target_id,)).fetchall()]
        for tk_id in tk_ids:
            conn.execute("DELETE FROM ticket_messages WHERE ticket_id = ?", (tk_id,))
        conn.execute("DELETE FROM support_tickets WHERE user_id = ?", (target_id,))
        # Watchlist items via watchlist IDs
        wl_ids = [r["id"] for r in conn.execute("SELECT id FROM watchlists WHERE user_id = ?", (target_id,)).fetchall()]
        for wl_id in wl_ids:
            conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (wl_id,))
        conn.execute("DELETE FROM watchlists WHERE user_id = ?", (target_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (target_id,))
        conn.commit()
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
    return add_ticket_message(ticket_id, user["id"], req.message.strip(), sender_role="user")


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
