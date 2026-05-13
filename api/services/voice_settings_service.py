"""
Voice settings service — per-user voice preferences for TTS / future modes.

Storage: voice_settings table in auth.db (created in api/services/auth_db.py).
"""

from datetime import datetime, timezone
from api.services.auth_db import get_connection


ALLOWED_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"}
MIN_SPEED = 0.5
MAX_SPEED = 2.0
DEFAULT_VOICE = "verse"
DEFAULT_SPEED = 1.0
DEFAULT_RETENTION_DAYS = 30


def _ensure_proactive_column(conn) -> None:
    """Idempotent migration: add proactive_speak column for P3-C unification."""
    try:
        conn.execute(
            "ALTER TABLE voice_settings ADD COLUMN proactive_speak INTEGER NOT NULL DEFAULT 0"
        )
        conn.commit()
    except Exception:
        pass  # column already exists


def get_voice_settings(user_id: str) -> dict:
    """Return per-user voice settings; creates a default row if missing."""
    conn = get_connection()
    try:
        _ensure_proactive_column(conn)
        row = conn.execute(
            "SELECT enabled, voice, speed, retention_days, proactive_speak "
            "FROM voice_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            conn.execute(
                """INSERT INTO voice_settings
                       (user_id, enabled, voice, speed, retention_days, proactive_speak)
                   VALUES (?, 1, ?, ?, ?, 0)""",
                (user_id, DEFAULT_VOICE, DEFAULT_SPEED, DEFAULT_RETENTION_DAYS),
            )
            conn.commit()
            return {
                "enabled": True,
                "voice": DEFAULT_VOICE,
                "speed": DEFAULT_SPEED,
                "retention_days": DEFAULT_RETENTION_DAYS,
                "proactive_speak": False,
            }
        return {
            "enabled": bool(row["enabled"]),
            "voice": row["voice"],
            "speed": float(row["speed"]),
            "retention_days": int(row["retention_days"]),
            "proactive_speak": bool(row["proactive_speak"]),
        }
    finally:
        conn.close()


def update_voice_settings(
    user_id: str,
    *,
    enabled: bool | None = None,
    voice: str | None = None,
    speed: float | None = None,
    retention_days: int | None = None,
    proactive_speak: bool | None = None,
) -> dict:
    """Validate + upsert voice settings. Returns the new full settings dict."""
    if voice is not None and voice not in ALLOWED_VOICES:
        raise ValueError(f"voice must be one of {sorted(ALLOWED_VOICES)}, got {voice!r}")
    if speed is not None and not (MIN_SPEED <= speed <= MAX_SPEED):
        raise ValueError(f"speed must be in [{MIN_SPEED}, {MAX_SPEED}], got {speed}")
    if retention_days is not None and not (1 <= retention_days <= 3650):
        raise ValueError(f"retention_days must be in [1, 3650], got {retention_days}")

    # Ensure row exists (and grab current values for partial update)
    current = get_voice_settings(user_id)
    new_enabled = current["enabled"] if enabled is None else bool(enabled)
    new_voice = current["voice"] if voice is None else voice
    new_speed = current["speed"] if speed is None else float(speed)
    new_retention = current["retention_days"] if retention_days is None else int(retention_days)
    new_proactive = (
        bool(current.get("proactive_speak"))
        if proactive_speak is None
        else bool(proactive_speak)
    )

    conn = get_connection()
    try:
        _ensure_proactive_column(conn)
        conn.execute(
            """UPDATE voice_settings
               SET enabled = ?, voice = ?, speed = ?, retention_days = ?,
                   proactive_speak = ?, updated_at = ?
               WHERE user_id = ?""",
            (
                1 if new_enabled else 0,
                new_voice,
                new_speed,
                new_retention,
                1 if new_proactive else 0,
                datetime.now(timezone.utc).isoformat(),
                user_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "enabled": new_enabled,
        "voice": new_voice,
        "speed": new_speed,
        "retention_days": new_retention,
        "proactive_speak": new_proactive,
    }
