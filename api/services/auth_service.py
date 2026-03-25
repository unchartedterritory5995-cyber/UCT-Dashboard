"""
Auth service — user creation, password verification, session management.
Pure business logic, no HTTP concerns.
"""

import uuid
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt

from api.services.auth_db import get_connection


# ── User management ──────────────────────────────────────────────────────────

def create_user(email: str, password: str, display_name: str = None) -> dict:
    user_id = str(uuid.uuid4())
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
            (user_id, email.lower().strip(), password_hash, display_name),
        )
        conn.commit()
        return {"id": user_id, "email": email.lower().strip(), "display_name": display_name, "role": "member"}
    finally:
        conn.close()


def verify_password(email: str, password: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
        if not row:
            return None
        if not bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8")):
            return None
        return {
            "id": row["id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "role": row["role"],
        }
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email, display_name, role, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_email(email: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email, display_name, role, created_at FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Session management ───────────────────────────────────────────────────────

SESSION_TTL_DAYS = 30


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, expires_at.isoformat()),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def validate_session(token: str) -> dict | None:
    if not token:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT s.user_id, s.expires_at, u.email, u.display_name, u.role "
            "FROM sessions s JOIN users u ON s.user_id = u.id "
            "WHERE s.token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return None
        return {
            "id": row["user_id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "role": row["role"],
        }
    finally:
        conn.close()


def delete_session(token: str):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
    finally:
        conn.close()


def cleanup_expired_sessions():
    conn = get_connection()
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.commit()
        return result.rowcount
    finally:
        conn.close()


# ── Subscription helpers ─────────────────────────────────────────────────────

def get_subscription(user_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def upsert_subscription(user_id: str, stripe_customer_id: str, stripe_subscription_id: str,
                         plan: str, status: str, current_period_end: str = None):
    sub_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        existing = conn.execute("SELECT id FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE subscriptions SET stripe_customer_id=?, stripe_subscription_id=?, "
                "plan=?, status=?, current_period_end=? WHERE user_id=?",
                (stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, user_id),
            )
        else:
            conn.execute(
                "INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sub_id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end),
            )
        conn.commit()
    finally:
        conn.close()


def get_subscription_by_stripe_customer(stripe_customer_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM subscriptions WHERE stripe_customer_id = ?", (stripe_customer_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_plan(user_id: str) -> str:
    sub = get_subscription(user_id)
    if not sub:
        return "free"
    if sub["status"] in ("active", "trialing"):
        return sub["plan"]
    return "free"


def change_password(user_id: str, current_password: str, new_password: str) -> bool:
    """Change a user's password. Returns True on success, False if current password is wrong."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return False
        if not bcrypt.checkpw(current_password.encode("utf-8"), row["password_hash"].encode("utf-8")):
            return False
        new_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))
        conn.commit()
        return True
    finally:
        conn.close()


def list_all_users() -> list[dict]:
    """Admin function: return all users with their subscription status."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT u.id, u.email, u.display_name, u.role, u.created_at, "
            "s.plan, s.status as sub_status, s.current_period_end "
            "FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id "
            "ORDER BY u.created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
