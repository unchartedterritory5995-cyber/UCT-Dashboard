"""
Journal screenshot service — upload, serve, delete chart screenshots.
Storage: /data/journal_screenshots/ (Railway persistent volume).
Format: WebP via Pillow (same pattern as avatar upload).
"""

import os
import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_taxonomy import SCREENSHOT_SLOTS

_STORAGE_DIR = os.environ.get("SCREENSHOT_DIR", "/data/journal_screenshots")
# Local dev fallback
if not os.path.exists(os.path.dirname(_STORAGE_DIR)):
    _STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "journal_screenshots")

MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB
MAX_PER_TRADE = 5
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def list_screenshots(user_id: str, trade_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM journal_screenshots
               WHERE user_id = ? AND trade_id = ?
               ORDER BY sort_order, created_at""",
            (user_id, trade_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def upload_screenshot(user_id: str, trade_id: str, file, slot: str, label: str = "") -> dict | str:
    """Upload a screenshot. Returns dict on success, error string on failure."""
    if slot not in SCREENSHOT_SLOTS:
        return f"Invalid slot. Must be one of: {', '.join(SCREENSHOT_SLOTS)}"

    if file.content_type not in ALLOWED_TYPES:
        return "Only JPEG, PNG, or WebP images are allowed"

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        return "File too large (max 2MB)"

    conn = get_connection()
    try:
        # Verify trade belongs to user
        trade = conn.execute(
            "SELECT id FROM journal_entries WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        ).fetchone()
        if not trade:
            return "Trade not found"

        # Check limit
        count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_screenshots WHERE trade_id = ?",
            (trade_id,),
        ).fetchone()["c"]
        if count >= MAX_PER_TRADE:
            return f"Maximum {MAX_PER_TRADE} screenshots per trade"

        # Convert to WebP via Pillow
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(contents))
        img = img.convert("RGBA")
        # Resize large images (max 1920px wide)
        if img.width > 1920:
            ratio = 1920 / img.width
            img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

        sc_id = str(uuid.uuid4())[:12]
        filename = f"{user_id}_{trade_id}_{slot}_{sc_id}.webp"

        os.makedirs(_STORAGE_DIR, exist_ok=True)
        filepath = os.path.join(_STORAGE_DIR, filename)
        img.save(filepath, "WEBP", quality=85)

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO journal_screenshots
               (id, user_id, trade_id, slot, filename, label, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (sc_id, user_id, trade_id, slot, filename, (label or "")[:200], count, now),
        )
        conn.commit()

        return {
            "id": sc_id,
            "trade_id": trade_id,
            "slot": slot,
            "filename": filename,
            "label": label,
            "url": f"/api/journal/{trade_id}/screenshots/{sc_id}",
        }
    finally:
        conn.close()


def get_screenshot_path(user_id: str, trade_id: str, screenshot_id: str) -> str | None:
    """Get filesystem path for a screenshot. Returns None if not found."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename FROM journal_screenshots WHERE id = ? AND user_id = ? AND trade_id = ?",
            (screenshot_id, user_id, trade_id),
        ).fetchone()
        if not row:
            return None
        filepath = os.path.join(_STORAGE_DIR, row["filename"])
        return filepath if os.path.exists(filepath) else None
    finally:
        conn.close()


def delete_screenshot(user_id: str, trade_id: str, screenshot_id: str) -> bool:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename FROM journal_screenshots WHERE id = ? AND user_id = ? AND trade_id = ?",
            (screenshot_id, user_id, trade_id),
        ).fetchone()
        if not row:
            return False

        # Delete file
        filepath = os.path.join(_STORAGE_DIR, row["filename"])
        if os.path.exists(filepath):
            os.remove(filepath)

        # Delete record
        conn.execute(
            "DELETE FROM journal_screenshots WHERE id = ?",
            (screenshot_id,),
        )
        conn.commit()
        return True
    finally:
        conn.close()
