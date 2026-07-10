"""Trade screenshots — image attachments keyed on the stable trade_ref.

Screenshots key on `trade_ref` (`ext:<external_id>` for broker rows, `id:<row id>`
for manual — see trade_refs.py), NOT the j2_trades row uuid, because broker rows
are purged and reinserted with fresh uuids on every full resync. The attachment
FILES live under the shared `_ATTACHMENT_ROOT` (same tree the day-notes / notebook
images use), so the P1a nightly R2 backup already covers them.

Validation (5 MB cap, png/jpg/jpeg/gif/webp, raw bytes stored — no re-encode) and
the path-traversal guard mirror `calendar.py::save_attachment` / `serve_attachment_path`.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.calendar import _ATTACHMENT_ROOT


class TradeAttachmentError(ValueError):
    """Upload validation failure (bad MIME, too large, empty)."""


_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
_MIME_TO_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg",
    "image/gif": ".gif", "image/webp": ".webp",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ref_dir(trade_ref: str) -> str:
    """Filesystem-safe directory name for a trade_ref. Refs contain ':' which is
    invalid in Windows filenames and dangerous in a path — map it to '_'."""
    return trade_ref.replace(":", "_")


async def save_trade_attachment(user_id: str, trade_ref: str, upload) -> dict[str, Any]:
    """Validate + persist an uploaded image for a trade. Returns the attachment
    dict the client renders. `upload` is a FastAPI UploadFile."""
    if upload.content_type not in _ALLOWED_IMAGE_MIMES:
        raise TradeAttachmentError("Only PNG, JPG, GIF, or WebP images allowed")

    raw = await upload.read()
    if len(raw) > _MAX_IMAGE_BYTES:
        raise TradeAttachmentError("Image must be < 5 MB")
    if len(raw) == 0:
        raise TradeAttachmentError("Empty file")

    ext = ""
    fname = (upload.filename or "").lower()
    for candidate in _ALLOWED_IMAGE_EXTS:
        if fname.endswith(candidate):
            ext = candidate
            break
    if not ext:
        ext = _MIME_TO_EXT.get(upload.content_type, ".png")

    ref_dir = _ref_dir(trade_ref)
    target_dir = _ATTACHMENT_ROOT / user_id / "trades" / ref_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    filename = f"{new_id}{ext}"
    (target_dir / filename).write_bytes(raw)

    label = (upload.filename or "")[:120]
    created_at = _now_iso()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_trade_attachments "
            "(id, user_id, trade_ref, filename, label, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (new_id, user_id, trade_ref, filename, label, created_at),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "id": new_id,
        "url": f"/api/j2/trades/attachments/{user_id}/{ref_dir}/{filename}",
        "label": label,
        "createdAt": created_at,
    }


def list_trade_attachments(
    user_id: str, trade_ref: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, filename, label, created_at FROM j2_trade_attachments "
            "WHERE user_id = ? AND trade_ref = ? ORDER BY created_at ASC",
            (user_id, trade_ref),
        ).fetchall()
        ref_dir = _ref_dir(trade_ref)
        return [
            {
                "id": r["id"],
                "url": f"/api/j2/trades/attachments/{user_id}/{ref_dir}/{r['filename']}",
                "label": r["label"],
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    finally:
        if own:
            conn.close()


def delete_trade_attachment(user_id: str, attachment_id: str) -> bool:
    """Remove the DB row AND the file on disk. Returns True if a row was deleted."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id, trade_ref, filename FROM j2_trade_attachments "
            "WHERE id = ? AND user_id = ?",
            (attachment_id, user_id),
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            "DELETE FROM j2_trade_attachments WHERE id = ? AND user_id = ?",
            (attachment_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Best-effort file removal — a missing file must never raise.
    try:
        path = (
            _ATTACHMENT_ROOT / row["user_id"] / "trades"
            / _ref_dir(row["trade_ref"]) / row["filename"]
        )
        if path.exists():
            path.unlink()
    except OSError:
        pass
    return True


def serve_trade_attachment_path(
    user_id: str, ref_dir: str, filename: str,
) -> Path | None:
    """Resolve a trade attachment to a disk path, or None if missing or the
    filename attempts to escape the (user, ref_dir) directory (traversal guard)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    if "/" in ref_dir or "\\" in ref_dir or ref_dir.startswith("."):
        return None
    base = _ATTACHMENT_ROOT / user_id / "trades" / ref_dir
    target = (base / filename).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
