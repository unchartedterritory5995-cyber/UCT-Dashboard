"""Unified Compass coach state — one row per user, holds the unified
trader profile + compass_enabled toggle when account_id == '_all_'.

Lives in its own table (j2_unified_coach_state) to keep the user-level
coach concept distinct from the per-account j2_accounts rows. All
unified-mode reviews/recaps/chat persist in their existing tables
with account_id = '_all_'.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

UNIFIED_ACCOUNT_ID = "_all_"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_state(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys() if hasattr(row, "keys") else []
    return {
        "userId": row["user_id"],
        "traderProfile": row["trader_profile"] or "",
        "compassEnabled": bool(row["compass_enabled"]),
        "onboarded": bool(row["onboarded"]),
        "onboardingMode": bool(row["onboarding_mode"]) if "onboarding_mode" in keys else False,
        "onboardingSessionId": (
            row["onboarding_session_id"] if "onboarding_session_id" in keys else None
        ),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_or_create(
    conn: sqlite3.Connection | None,
    user_id: str,
) -> dict[str, Any]:
    """Return the unified coach state, seeding defaults on first read."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is not None:
            return _row_to_state(row)
        now = _now_iso()
        conn.execute(
            """INSERT INTO j2_unified_coach_state
               (user_id, trader_profile, compass_enabled, onboarded, created_at, updated_at)
               VALUES (?, '', 1, 0, ?, ?)""",
            (user_id, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return _row_to_state(row)
    finally:
        if owned:
            conn.close()


def update_state(
    conn: sqlite3.Connection | None,
    user_id: str,
    *,
    trader_profile: str | None = None,
    compass_enabled: bool | None = None,
    onboarded: bool | None = None,
    onboarding_mode: bool | None = None,
    onboarding_session_id: str | None = None,
) -> dict[str, Any]:
    """Patch any subset of the state fields. Missing args = no change.

    `onboarding_session_id` is special: pass the empty string "" to clear it
    (set NULL); None means "leave unchanged" like the other fields.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        get_or_create(conn, user_id)

        fields: list[str] = []
        params: list[Any] = []
        if trader_profile is not None:
            fields.append("trader_profile = ?")
            params.append(trader_profile)
        if compass_enabled is not None:
            fields.append("compass_enabled = ?")
            params.append(1 if compass_enabled else 0)
        if onboarded is not None:
            fields.append("onboarded = ?")
            params.append(1 if onboarded else 0)
        if onboarding_mode is not None:
            fields.append("onboarding_mode = ?")
            params.append(1 if onboarding_mode else 0)
        if onboarding_session_id is not None:
            fields.append("onboarding_session_id = ?")
            params.append(onboarding_session_id or None)

        if fields:
            fields.append("updated_at = ?")
            params.append(_now_iso())
            params.append(user_id)
            conn.execute(
                f"UPDATE j2_unified_coach_state SET {', '.join(fields)} WHERE user_id = ?",
                params,
            )
            conn.commit()

        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return _row_to_state(row)
    finally:
        if owned:
            conn.close()
