"""Support ticket image attachments.

Stores images at /data/support_attachments/ as WebP (Pillow-converted, max 2000px
long side, max 2 MB source). Metadata rows land in the `ticket_attachments` table
(id, ticket_id, message_id, user_id, filename, width, height, bytes, created_at).

Follows the same pattern as journal_screenshots + avatars — see api/routers/avatar.py.
"""

from __future__ import annotations

import io
import os
import uuid
from pathlib import Path

from api.services.auth_db import get_connection

# `SUPPORT_ATTACHMENTS_DIR` is the override; its DEFAULT is the literal that
# has always been here, so production with nothing set is unchanged.
ATTACH_DIR = Path(os.environ.get(
    "SUPPORT_ATTACHMENTS_DIR", "/data/support_attachments"))
MAX_SOURCE_BYTES = 5 * 1024 * 1024  # 5 MB source cap
MAX_DIM = 2000                       # long-side pixel cap
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_PER_MESSAGE = 5                  # match journal_screenshots


def _fallback_dir() -> Path:
    """Local-dev fallback when /data isn't a real mount."""
    return Path(__file__).resolve().parent.parent.parent / "data" / "support_attachments"


def _dir() -> Path:
    # /data may exist on Windows (drive-root shim) but not be writable; fall
    # back to a repo-relative folder if /data doesn't accept a mkdir.
    try:
        ATTACH_DIR.mkdir(parents=True, exist_ok=True)
        # Cheap write probe: touch a marker on first use.
        (ATTACH_DIR / ".writable").touch()
        return ATTACH_DIR
    except Exception:
        fb = _fallback_dir()
        fb.mkdir(parents=True, exist_ok=True)
        return fb


def save_attachment(
    user_id: str,
    ticket_id: str,
    message_id: str,
    raw_bytes: bytes,
) -> dict:
    """Convert to WebP, save, and insert the metadata row.

    Returns the row as a dict. Raises ValueError on validation failures
    (message > 2 MB, unreadable image, per-message cap exceeded).
    """
    if not raw_bytes:
        raise ValueError("Empty upload")
    if len(raw_bytes) > MAX_SOURCE_BYTES:
        raise ValueError("Image must be under 5 MB")

    # Enforce per-message cap BEFORE writing the file to disk.
    conn = get_connection()
    try:
        n = conn.execute(
            "SELECT COUNT(*) FROM ticket_attachments WHERE message_id = ?",
            (message_id,),
        ).fetchone()[0]
        if n >= MAX_PER_MESSAGE:
            raise ValueError(f"Maximum {MAX_PER_MESSAGE} attachments per message")

        from PIL import Image
        try:
            img = Image.open(io.BytesIO(raw_bytes))
            img.load()
        except Exception as e:
            raise ValueError(f"Could not read image: {e}")

        # Preserve alpha where present (PNG screenshots often have transparency).
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
        img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)

        out_dir = _dir()
        att_id = str(uuid.uuid4())
        filename = f"{user_id}_{ticket_id}_{message_id}_{uuid.uuid4().hex}.webp"
        out_path = out_dir / filename

        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=85, method=6)
        final_bytes = buf.getvalue()
        out_path.write_bytes(final_bytes)

        conn.execute(
            "INSERT INTO ticket_attachments "
            "(id, ticket_id, message_id, user_id, filename, width, height, bytes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (att_id, ticket_id, message_id, user_id, filename,
             img.width, img.height, len(final_bytes)),
        )
        conn.commit()

        return {
            "id": att_id,
            "ticket_id": ticket_id,
            "message_id": message_id,
            "filename": filename,
            "width": img.width,
            "height": img.height,
            "bytes": len(final_bytes),
        }
    finally:
        conn.close()


def get_attachments_for_ticket(ticket_id: str, user_id: str = None) -> list[dict]:
    """List every attachment on a ticket. If user_id is given, verify ownership
    (admins bypass this at the router layer)."""
    conn = get_connection()
    try:
        # Ownership check
        if user_id:
            owner = conn.execute(
                "SELECT user_id FROM support_tickets WHERE id = ?",
                (ticket_id,),
            ).fetchone()
            if not owner or owner[0] != user_id:
                return []
        rows = conn.execute(
            "SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC",
            (ticket_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_attachment_path(ticket_id: str, filename: str, user_id: str = None) -> Path | None:
    """Resolve a stored attachment. Enforces ownership (unless caller is admin
    at the router layer). Guards against path traversal."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT ta.filename, ta.user_id, t.user_id AS owner_id FROM ticket_attachments ta "
            "JOIN support_tickets t ON ta.ticket_id = t.id "
            "WHERE ta.ticket_id = ? AND ta.filename = ?",
            (ticket_id, filename),
        ).fetchone()
        if not row:
            return None
        if user_id and row["owner_id"] != user_id:
            return None
    finally:
        conn.close()
    # Reject any funny business in the filename.
    if "/" in filename or "\\" in filename or ".." in filename:
        return None
    for d in (_dir(), _fallback_dir(), ATTACH_DIR):
        path = d / filename
        if path.exists():
            return path
    return None


def delete_attachment(attachment_id: str, user_id: str = None) -> bool:
    """Remove an attachment. Owner or admin only."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT ta.filename, ta.user_id FROM ticket_attachments ta WHERE ta.id = ?",
            (attachment_id,),
        ).fetchone()
        if not row:
            return False
        if user_id and row["user_id"] != user_id:
            return False
        conn.execute("DELETE FROM ticket_attachments WHERE id = ?", (attachment_id,))
        conn.commit()
        # Remove the file if we can find it. This is best-effort; the DB row
        # is the source of truth.
        for d in (_dir(), _fallback_dir(), ATTACH_DIR):
            path = d / row["filename"]
            if path.exists():
                try: os.remove(path)
                except OSError: pass
                break
        return True
    finally:
        conn.close()
