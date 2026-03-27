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
            "email_verified": bool(row["email_verified"]) if "email_verified" in row.keys() else False,
        }
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT id, email, display_name, role, email_verified, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
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
            "SELECT s.user_id, s.expires_at, u.email, u.display_name, u.role, u.email_verified "
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
        user_id = row["user_id"]

        # Update last login timestamp (fire-and-forget, don't block)
        try:
            conn.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", (user_id,))
            conn.commit()
        except:
            pass

        return {
            "id": user_id,
            "email": row["email"],
            "display_name": row["display_name"],
            "role": row["role"],
            "email_verified": bool(row["email_verified"]),
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


def list_users_filtered(search: str = None, plan_filter: str = None, sort_by: str = "created_at") -> list[dict]:
    """Admin function: return users with optional search, plan filter, and sorting. Includes tags."""
    conn = get_connection()
    try:
        query = (
            "SELECT u.id, u.email, u.display_name, u.role, u.created_at, "
            "u.last_login_at, u.email_verified, "
            "s.plan, s.status as sub_status, s.current_period_end, s.stripe_customer_id, "
            "GROUP_CONCAT(ut.tag, ',') as tags "
            "FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id "
            "LEFT JOIN user_tags ut ON u.id = ut.user_id "
        )
        params = []
        conditions = []

        if search:
            conditions.append("u.email LIKE ?")
            params.append(f"%{search}%")

        if plan_filter == "pro":
            conditions.append("s.status IN ('active', 'trialing') AND s.plan = 'pro'")
        elif plan_filter == "comped":
            conditions.append("s.status = 'comped'")
        elif plan_filter == "free":
            conditions.append("(s.id IS NULL OR s.status NOT IN ('active', 'trialing', 'comped'))")

        if conditions:
            query += "WHERE " + " AND ".join(conditions) + " "

        query += "GROUP BY u.id "

        if sort_by == "email":
            query += "ORDER BY u.email ASC"
        else:
            query += "ORDER BY u.created_at DESC"

        rows = conn.execute(query, params).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["tags"] = [t for t in d["tags"].split(",") if t] if d.get("tags") else []
            result.append(d)
        return result
    finally:
        conn.close()


def get_admin_stats() -> dict:
    """Admin function: return dashboard stats."""
    conn = get_connection()
    try:
        total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

        pro_subscribers = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing', 'comped')"
        ).fetchone()[0]

        comped_count = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status = 'comped'"
        ).fetchone()[0]

        paying_subscribers = pro_subscribers - comped_count
        mrr = paying_subscribers * 20

        now_iso = datetime.now(timezone.utc).isoformat()
        seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        new_signups_7d = conn.execute(
            "SELECT COUNT(*) FROM users WHERE created_at > ?", (seven_days_ago,)
        ).fetchone()[0]

        new_signups_30d = conn.execute(
            "SELECT COUNT(*) FROM users WHERE created_at > ?", (thirty_days_ago,)
        ).fetchone()[0]

        # Signups by day for last 30 days
        rows = conn.execute(
            "SELECT DATE(created_at) as date, COUNT(*) as count "
            "FROM users WHERE created_at > ? "
            "GROUP BY DATE(created_at) ORDER BY date ASC",
            (thirty_days_ago,),
        ).fetchall()
        signups_by_day = [{"date": r["date"], "count": r["count"]} for r in rows]

        # Churn: canceled subscriptions in last 30 days
        churn_30d = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status = 'canceled' AND created_at > ?",
            (thirty_days_ago,),
        ).fetchone()[0]

        # Unverified users
        unverified_count = conn.execute(
            "SELECT COUNT(*) FROM users WHERE email_verified = 0"
        ).fetchone()[0]

        # Active (non-expired) sessions
        active_sessions = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE expires_at > ?", (now_iso,)
        ).fetchone()[0]

        # Conversion rate
        conversion_rate = round(pro_subscribers / total_users * 100, 1) if total_users > 0 else 0.0

        return {
            "total_users": total_users,
            "pro_subscribers": pro_subscribers,
            "paying_subscribers": paying_subscribers,
            "comped_count": comped_count,
            "mrr": mrr,
            "new_signups_7d": new_signups_7d,
            "new_signups_30d": new_signups_30d,
            "signups_by_day": signups_by_day,
            "churn_30d": churn_30d,
            "unverified_count": unverified_count,
            "active_sessions": active_sessions,
            "conversion_rate": conversion_rate,
        }
    finally:
        conn.close()


def comp_user_access(email: str, grant: bool = True) -> dict:
    """Admin function: grant or revoke comped Pro access for a user."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
        if not row:
            raise ValueError(f"User not found: {email}")
        user_id = row["id"]

        if grant:
            existing = conn.execute("SELECT id FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE subscriptions SET plan='pro', status='comped', "
                    "stripe_customer_id=NULL, stripe_subscription_id=NULL, current_period_end=NULL "
                    "WHERE user_id=?",
                    (user_id,),
                )
            else:
                sub_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'comped')",
                    (sub_id, user_id),
                )
            conn.commit()
            return {"ok": True, "email": email, "action": "granted"}
        else:
            conn.execute(
                "UPDATE subscriptions SET status='canceled' WHERE user_id=? AND status='comped'",
                (user_id,),
            )
            conn.commit()
            return {"ok": True, "email": email, "action": "revoked"}
    finally:
        conn.close()


# ── Email verification ──────────────────────────────────────────────────────

def create_email_verification(user_id: str) -> str:
    """Generate a verification token (24hr TTL). Returns the token string."""
    token = secrets.token_urlsafe(32)
    ver_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    conn = get_connection()
    try:
        # Remove any existing verifications for this user
        conn.execute("DELETE FROM email_verifications WHERE user_id = ?", (user_id,))
        conn.execute(
            "INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
            (ver_id, user_id, token, expires_at.isoformat()),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def verify_email_token(token: str) -> str | None:
    """Validate a verification token. Returns user_id on success, None on failure."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id, expires_at FROM email_verifications WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            conn.execute("DELETE FROM email_verifications WHERE token = ?", (token,))
            conn.commit()
            return None
        # Mark user verified and clean up
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (row["user_id"],))
        conn.execute("DELETE FROM email_verifications WHERE token = ?", (token,))
        conn.commit()
        return row["user_id"]
    finally:
        conn.close()


# ── Password reset ──────────────────────────────────────────────────────────

def create_password_reset(email: str) -> str | None:
    """Generate a password reset token (1hr TTL). Returns token or None if user not found."""
    user = get_user_by_email(email)
    if not user:
        return None
    token = secrets.token_urlsafe(32)
    reset_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    conn = get_connection()
    try:
        # Remove any existing unused resets for this user
        conn.execute("DELETE FROM password_resets WHERE user_id = ? AND used = 0", (user["id"],))
        conn.execute(
            "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
            (reset_id, user["id"], token, expires_at.isoformat()),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def execute_password_reset(token: str, new_password: str) -> bool:
    """Validate reset token and update password. Returns True on success."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ?", (token,)
        ).fetchone()
        if not row or row["used"]:
            return False
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return False
        # Update password
        new_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, row["user_id"]))
        conn.execute("UPDATE password_resets SET used = 1 WHERE id = ?", (row["id"],))
        conn.commit()
        return True
    finally:
        conn.close()


def cleanup_expired_tokens():
    """Delete expired verification and reset tokens."""
    conn = get_connection()
    try:
        now = datetime.now(timezone.utc).isoformat()
        v = conn.execute("DELETE FROM email_verifications WHERE expires_at < ?", (now,))
        r = conn.execute("DELETE FROM password_resets WHERE expires_at < ?", (now,))
        conn.commit()
        return v.rowcount + r.rowcount
    finally:
        conn.close()


# ── Activity logging ──────────────────────────────────────────────────────

def log_activity(user_id: str, action: str, details: str = "", ip_address: str = ""):
    """Insert an activity log entry."""
    entry_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO activity_log (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)",
            (entry_id, user_id, action, details, ip_address),
        )
        conn.commit()
    except Exception as e:
        print(f"[activity] Failed to log {action} for {user_id}: {e}")
    finally:
        conn.close()


def get_recent_activity(limit: int = 50) -> list[dict]:
    """Return the most recent activity entries joined with user info."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT a.id, a.user_id, a.action, a.details, a.ip_address, a.created_at, "
            "u.email, u.display_name "
            "FROM activity_log a JOIN users u ON a.user_id = u.id "
            "ORDER BY a.created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_user_activity(user_id: str, limit: int = 20) -> list[dict]:
    """Return activity entries for a specific user."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, action, details, ip_address, created_at "
            "FROM activity_log WHERE user_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def submit_feedback(user_id: str, email: str, page: str, message: str, rating: int = None) -> dict:
    """Insert a feedback entry."""
    fb_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO feedback (id, user_id, email, page, message, rating) VALUES (?, ?, ?, ?, ?, ?)",
            (fb_id, user_id, email, page, message, rating),
        )
        conn.commit()
        return {"id": fb_id, "ok": True}
    finally:
        conn.close()


def get_recent_feedback(limit: int = 50) -> list[dict]:
    """Return feedback newest first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, user_id, email, page, message, rating, created_at "
            "FROM feedback ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_user_tag(user_id: str, tag: str) -> dict:
    """Add a tag to a user (ignore duplicate)."""
    tag_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO user_tags (id, user_id, tag) VALUES (?, ?, ?)",
            (tag_id, user_id, tag),
        )
        conn.commit()
        return {"ok": True, "user_id": user_id, "tag": tag}
    finally:
        conn.close()


def remove_user_tag(user_id: str, tag: str) -> dict:
    """Remove a tag from a user."""
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM user_tags WHERE user_id = ? AND tag = ?",
            (user_id, tag),
        )
        conn.commit()
        return {"ok": True, "user_id": user_id, "tag": tag}
    finally:
        conn.close()


def get_user_tags(user_id: str) -> list[str]:
    """Return list of tag strings for a user."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT tag FROM user_tags WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [r["tag"] for r in rows]
    finally:
        conn.close()


def record_mrr_snapshot():
    """Record a daily MRR snapshot — upsert on date."""
    conn = get_connection()
    try:
        total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        pro_subscribers = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing', 'comped')"
        ).fetchone()[0]
        comped_count = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status = 'comped'"
        ).fetchone()[0]
        paying = pro_subscribers - comped_count
        mrr = paying * 20
        churn_count = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE status = 'canceled'"
        ).fetchone()[0]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        snap_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO mrr_snapshots (id, date, total_users, pro_subscribers, comped_count, mrr, churn_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET total_users=excluded.total_users, "
            "pro_subscribers=excluded.pro_subscribers, comped_count=excluded.comped_count, "
            "mrr=excluded.mrr, churn_count=excluded.churn_count",
            (snap_id, today, total_users, pro_subscribers, comped_count, mrr, churn_count),
        )
        conn.commit()
        print(f"[mrr] Snapshot recorded for {today}: MRR=${mrr}, subs={pro_subscribers}")
    except Exception as e:
        print(f"[mrr] Failed to record snapshot: {e}")
    finally:
        conn.close()


def get_mrr_history(days: int = 90) -> list[dict]:
    """Return last N days of MRR snapshots."""
    conn = get_connection()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = conn.execute(
            "SELECT date, total_users, pro_subscribers, comped_count, mrr, churn_count "
            "FROM mrr_snapshots WHERE date >= ? ORDER BY date ASC",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_admin_note(user_id: str, note: str, admin_email: str) -> dict:
    """Insert an admin note for a user."""
    note_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO admin_notes (id, user_id, note, admin_email) VALUES (?, ?, ?, ?)",
            (note_id, user_id, note, admin_email),
        )
        conn.commit()
        return {"id": note_id, "user_id": user_id, "note": note, "admin_email": admin_email}
    finally:
        conn.close()


def get_admin_notes(user_id: str) -> list[dict]:
    """Return all admin notes for a user, newest first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, user_id, note, admin_email, created_at "
            "FROM admin_notes WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def log_page_view(user_id: str, page: str):
    """Insert a page view with 60-second dedup per user+page."""
    conn = get_connection()
    try:
        # Check if same page was logged within last 60 seconds
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        existing = conn.execute(
            "SELECT id FROM page_views WHERE user_id = ? AND page = ? AND created_at > ?",
            (user_id, page, cutoff),
        ).fetchone()
        if existing:
            return
        view_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO page_views (id, user_id, page) VALUES (?, ?, ?)",
            (view_id, user_id, page),
        )
        conn.commit()
    except Exception as e:
        print(f"[pageview] Failed to log: {e}")
    finally:
        conn.close()


def get_page_analytics(days: int = 7) -> list[dict]:
    """Return top pages by view count with unique user counts."""
    conn = get_connection()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows = conn.execute(
            "SELECT page, COUNT(*) as views, COUNT(DISTINCT user_id) as unique_users "
            "FROM page_views WHERE created_at > ? "
            "GROUP BY page ORDER BY views DESC LIMIT 20",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_user_engagement(user_id: str) -> dict:
    """Return page view stats for a user."""
    conn = get_connection()
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        unique = conn.execute(
            "SELECT COUNT(DISTINCT page) FROM page_views WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        last_row = conn.execute(
            "SELECT page FROM page_views WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        return {
            "total_page_views": total,
            "unique_pages": unique,
            "last_active_page": last_row["page"] if last_row else None,
        }
    finally:
        conn.close()


def get_user_detail(user_id: str) -> dict | None:
    """Return full user detail: user info + subscription + journal/watchlist counts + recent activity."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, email, display_name, role, email_verified, created_at, last_login_at "
            "FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return None
        user = dict(row)

        # Subscription info
        sub_row = conn.execute(
            "SELECT plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at "
            "FROM subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        user["subscription"] = dict(sub_row) if sub_row else None
        # Flatten sub_status for frontend getUserPlan compatibility
        user["sub_status"] = sub_row["status"] if sub_row else None
        user["stripe_customer_id"] = sub_row["stripe_customer_id"] if sub_row else None
        user["current_period_end"] = sub_row["current_period_end"] if sub_row else None

        # Journal entry count
        user["journal_count"] = conn.execute(
            "SELECT COUNT(*) FROM journal_entries WHERE user_id = ?", (user_id,)
        ).fetchone()[0]

        # Watchlist count
        user["watchlist_count"] = conn.execute(
            "SELECT COUNT(*) FROM watchlists WHERE user_id = ?", (user_id,)
        ).fetchone()[0]

        # Last 10 activity entries
        activity_rows = conn.execute(
            "SELECT id, action, details, ip_address, created_at "
            "FROM activity_log WHERE user_id = ? "
            "ORDER BY created_at DESC LIMIT 10",
            (user_id,),
        ).fetchall()
        user["recent_activity"] = [dict(r) for r in activity_rows]

        # Admin notes
        note_rows = conn.execute(
            "SELECT id, note, admin_email, created_at "
            "FROM admin_notes WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        user["notes"] = [dict(r) for r in note_rows]

        # Engagement stats
        total_pv = conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        unique_pv = conn.execute(
            "SELECT COUNT(DISTINCT page) FROM page_views WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        last_pv = conn.execute(
            "SELECT page FROM page_views WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        user["engagement"] = {
            "total_page_views": total_pv,
            "unique_pages": unique_pv,
            "last_active_page": last_pv["page"] if last_pv else None,
        }

        # Tags
        tag_rows = conn.execute(
            "SELECT tag FROM user_tags WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        user["tags"] = [r["tag"] for r in tag_rows]

        # Login history (last 10 logins with IP)
        login_rows = conn.execute(
            "SELECT ip_address, created_at "
            "FROM activity_log WHERE user_id = ? AND action = 'login' "
            "ORDER BY created_at DESC LIMIT 10",
            (user_id,),
        ).fetchall()
        user["login_history"] = [dict(r) for r in login_rows]

        return user
    finally:
        conn.close()


# ── Referral tracking ──────────────────────────────────────────────────────

def generate_referral_code(user_id: str) -> str:
    """Create a unique 8-char alphanumeric referral code for a user."""
    import string
    import random
    conn = get_connection()
    try:
        # Check if user already has a code
        user_row = conn.execute("SELECT referral_code FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row and user_row["referral_code"]:
            return user_row["referral_code"]

        # Generate unique code
        chars = string.ascii_uppercase + string.digits
        for _ in range(20):  # retry up to 20 times
            code = ''.join(random.choices(chars, k=8))
            try:
                ref_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO referrals (id, referrer_user_id, referral_code) VALUES (?, ?, ?)",
                    (ref_id, user_id, code),
                )
                conn.execute("UPDATE users SET referral_code = ? WHERE id = ?", (code, user_id))
                conn.commit()
                return code
            except Exception:
                conn.rollback()
                continue
        raise RuntimeError("Failed to generate unique referral code")
    finally:
        conn.close()


def get_referral_code(user_id: str) -> str:
    """Return existing referral code or generate a new one."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT referral_code FROM users WHERE id = ?", (user_id,)).fetchone()
        if row and row["referral_code"]:
            return row["referral_code"]
    finally:
        conn.close()
    return generate_referral_code(user_id)


def apply_referral(referred_user_id: str, code: str) -> bool:
    """Mark a referral as completed, linking the referred user."""
    conn = get_connection()
    try:
        # Find the referral row for this code that hasn't been used yet
        row = conn.execute(
            "SELECT id, referrer_user_id FROM referrals WHERE referral_code = ? AND status = 'pending' LIMIT 1",
            (code,),
        ).fetchone()
        if not row:
            # Code might exist but all slots used — create a new completed entry
            referrer_row = conn.execute(
                "SELECT referrer_user_id FROM referrals WHERE referral_code = ? LIMIT 1",
                (code,),
            ).fetchone()
            if not referrer_row:
                return False
            ref_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code, status) "
                "VALUES (?, ?, ?, ?, 'completed')",
                (ref_id, referrer_row["referrer_user_id"], referred_user_id, code),
            )
            conn.commit()
            return True
        # Update the existing pending row
        conn.execute(
            "UPDATE referrals SET referred_user_id = ?, status = 'completed' WHERE id = ?",
            (referred_user_id, row["id"]),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def get_referral_stats(user_id: str) -> dict:
    """Return referral stats for a user."""
    code = get_referral_code(user_id)
    conn = get_connection()
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM referrals WHERE referrer_user_id = ?", (user_id,)
        ).fetchone()[0]
        successful = conn.execute(
            "SELECT COUNT(*) FROM referrals WHERE referrer_user_id = ? AND status = 'completed'",
            (user_id,),
        ).fetchone()[0]
        return {
            "code": code,
            "total_referrals": total,
            "successful_referrals": successful,
        }
    finally:
        conn.close()


def get_admin_referral_stats() -> dict:
    """Return admin-level referral program statistics."""
    conn = get_connection()
    try:
        total_referrals = conn.execute("SELECT COUNT(*) FROM referrals").fetchone()[0]
        completed = conn.execute(
            "SELECT COUNT(*) FROM referrals WHERE status = 'completed'"
        ).fetchone()[0]
        conversion_rate = round(completed / total_referrals * 100, 1) if total_referrals > 0 else 0.0

        # Top referrers
        rows = conn.execute(
            "SELECT r.referrer_user_id, u.email, r.referral_code, "
            "COUNT(*) as total, "
            "SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) as successful "
            "FROM referrals r JOIN users u ON r.referrer_user_id = u.id "
            "GROUP BY r.referrer_user_id "
            "ORDER BY successful DESC, total DESC LIMIT 20"
        ).fetchall()
        top_referrers = [
            {
                "email": r["email"],
                "code": r["referral_code"],
                "total": r["total"],
                "successful": r["successful"],
            }
            for r in rows
        ]

        return {
            "total_referrals": total_referrals,
            "completed_referrals": completed,
            "conversion_rate": conversion_rate,
            "top_referrers": top_referrers,
        }
    finally:
        conn.close()


# ── Login history ──────────────────────────────────────────────────────────

def get_login_history(user_id: str, limit: int = 10) -> list[dict]:
    """Return last N login entries with IP + timestamp."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ip_address, created_at "
            "FROM activity_log WHERE user_id = ? AND action = 'login' "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Active users ───────────────────────────────────────────────────────────

def get_active_now(minutes: int = 5) -> dict:
    """Return users active in the last N minutes based on page_views."""
    conn = get_connection()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        rows = conn.execute(
            "SELECT pv.user_id, u.email, pv.page, MAX(pv.created_at) as last_seen "
            "FROM page_views pv JOIN users u ON pv.user_id = u.id "
            "WHERE pv.created_at > ? "
            "GROUP BY pv.user_id "
            "ORDER BY last_seen DESC",
            (cutoff,),
        ).fetchall()
        users = [{"email": r["email"], "page": r["page"], "last_seen": r["last_seen"]} for r in rows]
        return {"count": len(users), "users": users}
    finally:
        conn.close()
