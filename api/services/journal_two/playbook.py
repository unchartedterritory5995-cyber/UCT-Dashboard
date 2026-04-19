"""
Journal 2.0 — Playbook / Stock Observation Library.

Users save interesting stocks they see: symbol, thesis, key levels,
screenshots, status. Entries can be linked to an executed position/trade
for idea → outcome tracking.

Status lifecycle:
  watching → triggered → traded → (success / fail)
                                  ↓
                                  dead / passed

Spec: designed in chat (Phase 5 / Step 2b).
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection


VALID_STATUS = {"watching", "triggered", "traded", "passed", "dead"}
MAX_THESIS_CHARS = 5_000
MAX_NOTES_CHARS = 5_000
MAX_ATTACHMENTS = 8

# Share attachment root with calendar so user's upload dir is unified.
_ATTACHMENT_ROOT = Path(
    os.environ.get(
        "J2_ATTACHMENT_ROOT",
        str(Path(__file__).resolve().parents[3] / "data" / "j2_attachments"),
    )
)
_ALLOWED_IMAGE_MIMES = {
    "image/png", "image/jpeg", "image/gif", "image/webp",
}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024


class PlaybookValidationError(ValueError):
    """Raised when entry payload is malformed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_entry(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "symbol": row["symbol"],
        "observedDate": row["observed_date"],
        "setup": row["setup"],
        "thesis": row["thesis"] or "",
        "levels": json.loads(row["levels"] or "{}"),
        "status": row["status"],
        "attachments": json.loads(row["attachments"] or "[]"),
        "notes": row["notes"] or "",
        "linkedPositionId": row["linked_position_id"],
        "linkedTradeId": row["linked_trade_id"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _validate_levels(raw: Any) -> dict[str, Any]:
    if raw is None or raw == "":
        return {}
    if not isinstance(raw, dict):
        raise PlaybookValidationError("levels must be an object")
    out: dict[str, Any] = {}
    for k in ("support", "resistance", "trigger", "stop", "target"):
        v = raw.get(k)
        if v is None or v == "":
            continue
        if not isinstance(v, (int, float)):
            raise PlaybookValidationError(f"levels.{k} must be a number")
        if v < 0:
            raise PlaybookValidationError(f"levels.{k} must be >= 0")
        out[k] = float(v)
    return out


def _validate_attachments(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise PlaybookValidationError("attachments must be a list")
    if len(raw) > MAX_ATTACHMENTS:
        raise PlaybookValidationError(
            f"attachments exceeds cap of {MAX_ATTACHMENTS}"
        )
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise PlaybookValidationError("attachment entries must be objects")
        kind = item.get("kind")
        url = item.get("url")
        if kind not in ("link", "image"):
            raise PlaybookValidationError("attachment.kind must be link|image")
        if not isinstance(url, str) or not url.strip():
            raise PlaybookValidationError("attachment.url is required")
        out.append({
            "kind": kind,
            "url": url.strip(),
            "label": item.get("label", "") or "",
            "addedAt": item.get("addedAt") or _now_iso(),
        })
    return out


def _validate_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise PlaybookValidationError("payload must be an object")
    symbol = payload.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip():
        raise PlaybookValidationError("symbol is required")
    if len(symbol.strip()) > 16:
        raise PlaybookValidationError("symbol too long")

    observed_date = payload.get("observedDate")
    if not isinstance(observed_date, str) or not observed_date.strip():
        raise PlaybookValidationError("observedDate is required (YYYY-MM-DD)")
    try:
        datetime.fromisoformat(observed_date)
    except ValueError:
        raise PlaybookValidationError("observedDate must be YYYY-MM-DD")

    setup = payload.get("setup")
    if setup is not None and not isinstance(setup, str):
        raise PlaybookValidationError("setup must be string or null")

    thesis = payload.get("thesis", "") or ""
    if not isinstance(thesis, str):
        raise PlaybookValidationError("thesis must be a string")
    if len(thesis) > MAX_THESIS_CHARS:
        raise PlaybookValidationError(f"thesis exceeds {MAX_THESIS_CHARS} chars")

    notes = payload.get("notes", "") or ""
    if not isinstance(notes, str):
        raise PlaybookValidationError("notes must be a string")
    if len(notes) > MAX_NOTES_CHARS:
        raise PlaybookValidationError(f"notes exceeds {MAX_NOTES_CHARS} chars")

    status = payload.get("status", "watching")
    if status not in VALID_STATUS:
        raise PlaybookValidationError(
            f"status must be one of {sorted(VALID_STATUS)}"
        )

    levels = _validate_levels(payload.get("levels"))
    attachments = _validate_attachments(payload.get("attachments", []))

    return {
        "symbol": symbol.strip().upper(),
        "observedDate": observed_date,
        "setup": setup.strip() if isinstance(setup, str) and setup.strip() else None,
        "thesis": thesis,
        "notes": notes,
        "status": status,
        "levels": levels,
        "attachments": attachments,
    }


def list_entries(
    user_id: str,
    *,
    symbol: str | None = None,
    status: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All playbook entries for the user, newest first. Optional filters."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = "SELECT * FROM j2_playbook_entries WHERE user_id = ?"
        params: list[Any] = [user_id]
        if symbol:
            sql += " AND symbol = ?"
            params.append(symbol.strip().upper())
        if status:
            if status not in VALID_STATUS:
                raise PlaybookValidationError(f"invalid status filter: {status}")
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY observed_date DESC, created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_entry(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_entry(
    user_id: str,
    entry_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_playbook_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        return _row_to_entry(row) if row else None
    finally:
        if owned:
            conn.close()


def create_entry(
    user_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    validated = _validate_create_payload(payload)
    owned = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        new_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO j2_playbook_entries (
                id, user_id, symbol, observed_date, setup, thesis,
                levels, status, attachments, notes,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, user_id,
                validated["symbol"],
                validated["observedDate"],
                validated["setup"],
                validated["thesis"],
                json.dumps(validated["levels"]),
                validated["status"],
                json.dumps(validated["attachments"]),
                validated["notes"],
                now, now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_playbook_entries WHERE id = ?", (new_id,),
        ).fetchone()
        return _row_to_entry(row)
    finally:
        if owned:
            conn.close()


def update_entry(
    user_id: str,
    entry_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    if not isinstance(patch, dict):
        raise PlaybookValidationError("patch must be an object")

    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_playbook_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []

        if "symbol" in patch:
            s = patch["symbol"]
            if not isinstance(s, str) or not s.strip():
                raise PlaybookValidationError("symbol cannot be empty")
            sets.append("symbol = ?"); params.append(s.strip().upper())
        if "observedDate" in patch:
            d = patch["observedDate"]
            try:
                datetime.fromisoformat(d)
            except (TypeError, ValueError):
                raise PlaybookValidationError("observedDate must be YYYY-MM-DD")
            sets.append("observed_date = ?"); params.append(d)
        if "setup" in patch:
            v = patch["setup"]
            sets.append("setup = ?")
            params.append(v.strip() if isinstance(v, str) and v.strip() else None)
        if "thesis" in patch:
            v = patch["thesis"] or ""
            if not isinstance(v, str):
                raise PlaybookValidationError("thesis must be a string")
            if len(v) > MAX_THESIS_CHARS:
                raise PlaybookValidationError("thesis too long")
            sets.append("thesis = ?"); params.append(v)
        if "notes" in patch:
            v = patch["notes"] or ""
            if not isinstance(v, str):
                raise PlaybookValidationError("notes must be a string")
            if len(v) > MAX_NOTES_CHARS:
                raise PlaybookValidationError("notes too long")
            sets.append("notes = ?"); params.append(v)
        if "status" in patch:
            s = patch["status"]
            if s not in VALID_STATUS:
                raise PlaybookValidationError(f"invalid status: {s}")
            sets.append("status = ?"); params.append(s)
        if "levels" in patch:
            sets.append("levels = ?")
            params.append(json.dumps(_validate_levels(patch["levels"])))
        if "attachments" in patch:
            sets.append("attachments = ?")
            params.append(json.dumps(_validate_attachments(patch["attachments"])))
        if "linkedPositionId" in patch:
            sets.append("linked_position_id = ?")
            params.append(patch["linkedPositionId"])
        if "linkedTradeId" in patch:
            sets.append("linked_trade_id = ?")
            params.append(patch["linkedTradeId"])

        if not sets:
            return _row_to_entry(existing)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([entry_id, user_id])
        conn.execute(
            f"UPDATE j2_playbook_entries SET {', '.join(sets)} "
            f"WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_playbook_entries WHERE id = ?", (entry_id,),
        ).fetchone()
        return _row_to_entry(row)
    finally:
        if owned:
            conn.close()


def delete_entry(
    user_id: str,
    entry_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_playbook_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Image upload for playbook screenshots ────────────────────────────────────


async def save_screenshot(
    user_id: str,
    entry_id: str,
    upload,
) -> dict[str, Any]:
    """Validate + persist a screenshot attached to a playbook entry.
    Returns the attachment dict the client merges into the entry's
    attachments array."""
    if upload.content_type not in _ALLOWED_IMAGE_MIMES:
        raise PlaybookValidationError("Only PNG/JPG/GIF/WebP images allowed")
    raw = await upload.read()
    if len(raw) > _MAX_IMAGE_BYTES:
        raise PlaybookValidationError("Image must be < 5 MB")
    if len(raw) == 0:
        raise PlaybookValidationError("Empty file")

    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg",
        "image/gif": ".gif", "image/webp": ".webp",
    }
    ext = ext_map.get(upload.content_type, ".png")

    target_dir = _ATTACHMENT_ROOT / user_id / "playbook" / entry_id
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    target_path = target_dir / f"{new_id}{ext}"
    target_path.write_bytes(raw)

    public_url = f"/api/j2/playbook/attachments/{user_id}/{entry_id}/{new_id}{ext}"
    return {
        "kind": "image",
        "url": public_url,
        "label": (upload.filename or "")[:120],
        "addedAt": _now_iso(),
    }


def serve_screenshot_path(
    user_id: str,
    entry_id: str,
    filename: str,
) -> Path | None:
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    target = (_ATTACHMENT_ROOT / user_id / "playbook" / entry_id / filename).resolve()
    root = (_ATTACHMENT_ROOT / user_id / "playbook" / entry_id).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
