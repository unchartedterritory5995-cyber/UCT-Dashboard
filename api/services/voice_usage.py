"""
Voice usage tracking — counts Mode A (read-aloud) seconds per user per month
and enforces a configurable cap. Admin users bypass the cap.

Storage: voice_usage_monthly table in auth.db.
"""

from datetime import datetime
from api.services.auth_db import get_connection


# 120 min/month default cap. ~$1.80 OpenAI cost. Override via env in future.
MODE_A_DEFAULT_CAP_SECONDS = 7200

# Cost estimate: $0.030 / minute (tts-1-hd) = $0.000500 / second
MODE_A_COST_PER_SECOND = 0.00050


def _current_year_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def record_mode_a_seconds(user_id: str, seconds: int) -> None:
    """Add to this user's Mode A total for the current calendar month."""
    if seconds <= 0:
        return
    ym = _current_year_month()
    cost_delta = seconds * MODE_A_COST_PER_SECOND
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_usage_monthly
               (user_id, year_month, mode_a_seconds, estimated_cost_usd)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, year_month) DO UPDATE SET
                 mode_a_seconds = mode_a_seconds + excluded.mode_a_seconds,
                 estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
            (user_id, ym, int(seconds), cost_delta),
        )
        conn.commit()
    finally:
        conn.close()


def get_monthly_usage(user_id: str, year_month: str | None = None) -> dict:
    """Return usage for a given month (defaults to current). Zeros if no row."""
    ym = year_month or _current_year_month()
    conn = get_connection()
    try:
        row = conn.execute(
            """SELECT mode_a_seconds, mode_b_calls, mode_c_seconds, estimated_cost_usd
               FROM voice_usage_monthly WHERE user_id = ? AND year_month = ?""",
            (user_id, ym),
        ).fetchone()
        if row is None:
            return {
                "year_month": ym,
                "mode_a_seconds": 0,
                "mode_b_calls": 0,
                "mode_c_seconds": 0,
                "estimated_cost_usd": 0.0,
            }
        return {
            "year_month": ym,
            "mode_a_seconds": int(row["mode_a_seconds"]),
            "mode_b_calls": int(row["mode_b_calls"]),
            "mode_c_seconds": int(row["mode_c_seconds"]),
            "estimated_cost_usd": float(row["estimated_cost_usd"]),
        }
    finally:
        conn.close()


def is_within_mode_a_cap(
    user_id: str,
    *,
    cap_seconds: int = MODE_A_DEFAULT_CAP_SECONDS,
    is_admin: bool = False,
) -> bool:
    """True if user can generate more Mode A audio this month."""
    if is_admin:
        return True
    return get_monthly_usage(user_id)["mode_a_seconds"] < cap_seconds


# ── Mode B (one-shot) ───────────────────────────────────────────────────────

# 200 calls/month default. Each call ≈ $0.003 (Whisper + gpt-4o-mini + tts-1-hd).
# Hard ceiling ~$0.60/user/month.
MODE_B_DEFAULT_CAP_CALLS = 200
MODE_B_COST_PER_CALL = 0.003


def record_mode_b_call(user_id: str) -> None:
    """Increment Mode B call count for the current month."""
    ym = _current_year_month()
    cost_delta = MODE_B_COST_PER_CALL
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_usage_monthly
               (user_id, year_month, mode_b_calls, estimated_cost_usd)
               VALUES (?, ?, 1, ?)
               ON CONFLICT (user_id, year_month) DO UPDATE SET
                 mode_b_calls = mode_b_calls + 1,
                 estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
            (user_id, ym, cost_delta),
        )
        conn.commit()
    finally:
        conn.close()


def is_within_mode_b_cap(
    user_id: str,
    *,
    cap_calls: int = MODE_B_DEFAULT_CAP_CALLS,
    is_admin: bool = False,
) -> bool:
    if is_admin:
        return True
    return get_monthly_usage(user_id)["mode_b_calls"] < cap_calls
