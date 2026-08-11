"""
Journal 2.0 — Notebook (replaces Playbook 2026-05-26).

Free-form Substack-style notes with TipTap doc body, folders, tags,
optional ticker, hero image. Spec:
docs/superpowers/specs/2026-05-26-notebook-design.md
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection

MAX_TITLE_CHARS = 300
MAX_SUBTITLE_CHARS = 500
MAX_BODY_JSON_BYTES = 1_000_000  # 1MB
MAX_TAG_LENGTH = 40
MAX_TAGS = 30
MAX_TICKER_LENGTH = 16
MAX_FOLDER_DEPTH = 6

_ATTACHMENT_ROOT = Path(
    os.environ.get(
        "J2_ATTACHMENT_ROOT",
        str(Path(__file__).resolve().parents[3] / "data" / "j2_attachments"),
    )
)
_ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_FILE_MIMES = {
    "application/pdf", "text/plain", "text/csv", "text/markdown",
    "application/zip", "audio/mpeg", "audio/mp4",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.document",
}
_MAX_FILE_BYTES = 25 * 1024 * 1024


class NoteValidationError(ValueError):
    """Raised when note payload is malformed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Body plain-text extraction ───────────────────────────────────────────────

def extract_plain_text(doc: dict[str, Any] | None) -> str:
    """Recursively walk a TipTap ProseMirror doc and concatenate all
    text nodes (space-separated). Returns '' for empty/missing doc."""
    if not isinstance(doc, dict):
        return ""
    out: list[str] = []
    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "text":
            t = node.get("text")
            if isinstance(t, str):
                out.append(t)
        for child in node.get("content", []) or []:
            walk(child)
    walk(doc)
    return " ".join(s for s in out if s)


# ── Validation ───────────────────────────────────────────────────────────────

def _validate_tags(raw: Any) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise NoteValidationError("tags must be a list")
    if len(raw) > MAX_TAGS:
        raise NoteValidationError(f"tags exceeds cap of {MAX_TAGS}")
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        if not isinstance(t, str):
            raise NoteValidationError("tag entries must be strings")
        t2 = t.strip()
        if not t2:
            continue
        if len(t2) > MAX_TAG_LENGTH:
            raise NoteValidationError(f"tag exceeds {MAX_TAG_LENGTH} chars")
        key = t2.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t2)
    return out


def _validate_body_json(raw: Any) -> dict[str, Any]:
    if raw is None or raw == "":
        return {"type": "doc", "content": []}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raise NoteValidationError("body_json must be valid JSON")
    if not isinstance(raw, dict):
        raise NoteValidationError("body_json must be an object")
    if raw.get("type") != "doc":
        raise NoteValidationError("body_json must be a TipTap doc")
    serialized = json.dumps(raw)
    if len(serialized.encode("utf-8")) > MAX_BODY_JSON_BYTES:
        raise NoteValidationError("body_json too large (>1MB)")
    return raw


def _validate_ticker(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise NoteValidationError("ticker must be a string")
    t = raw.strip().upper()
    if not t:
        return None
    if len(t) > MAX_TICKER_LENGTH:
        raise NoteValidationError("ticker too long")
    if not re.match(r"^[A-Z0-9.\-]+$", t):
        raise NoteValidationError("ticker has invalid characters")
    return t


# ── Import support ───────────────────────────────────────────────────────────

def _import_payload_hash(note: dict) -> str:
    """Compute a SHA256 hash of the note's immutable content for fingerprinting."""
    basis = json.dumps({
        "title": note.get("title") or "",
        "subtitle": note.get("subtitle") or None,
        "bodyJson": note.get("bodyJson") or {},
        "tags": sorted(note.get("tags") or []),
        "ticker": note.get("ticker") or None,
        "folderPath": note.get("folderPath") or [],
        "updatedAt": note.get("updatedAt") or "",
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _import_date(value, fallback):
    """Validate and return an ISO date string, or fallback if invalid."""
    if not value or not isinstance(value, str):
        return fallback
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    except ValueError:
        return fallback


def import_check(user_id: str, import_keys: list[str], conn: sqlite3.Connection | None = None) -> dict:
    """Check which import keys already exist for the user.

    Returns: {"existing": {key: {"id", "updatedAt", "importHash"}}}
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = {}
        keys = [k for k in (import_keys or []) if isinstance(k, str)][:5000]
        for i in range(0, len(keys), 500):  # SQLite variable limit safety
            chunk = keys[i:i + 500]
            q = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT id, import_key, updated_at, import_hash FROM j2_notes "
                f"WHERE user_id = ? AND import_key IN ({q})", (user_id, *chunk)):
                existing[row["import_key"]] = {
                    "id": row["id"], "updatedAt": row["updated_at"],
                    "importHash": row["import_hash"]}
        return {"existing": existing}
    finally:
        if owned:
            conn.close()


def import_confirm(user_id: str, payload: dict, conn: sqlite3.Connection | None = None) -> dict:
    """Transactional upsert of notes by fingerprint.

    Payload shape: {
        "source": str,
        "destFolderId": str|None,
        "notes": [{importKey, title, subtitle?, bodyJson, tags, ticker?,
                   createdAt?, updatedAt?, folderPath: [str, ...]}]
    }

    Returns: {"created": [...], "updated": [...], "skipped": [...]}
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("notes"), list):
        raise NoteValidationError("invalid import payload")
    notes = payload["notes"]
    if len(notes) > 500:
        raise NoteValidationError("too many notes in one batch (max 500)")
    raw_source = payload.get("source")
    if raw_source is not None and not isinstance(raw_source, str):
        raise NoteValidationError("source must be a string")
    source = (raw_source or "file")[:40]
    dest = payload.get("destFolderId") or ""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if dest:
            ok = conn.execute("SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                              (dest, user_id)).fetchone()
            if not ok:
                raise NoteValidationError("destination folder not found")
        created, updated, skipped = [], [], []
        # One import operation = one imported_at timestamp, deliberate
        now = _now_iso()
        path_cache: dict[tuple, str] = {}
        for n in notes:
            key = n.get("importKey")
            if not key or not isinstance(key, str):
                raise NoteValidationError("importKey required on every note")
            body_json = _validate_body_json(n.get("bodyJson"))
            body_plain = extract_plain_text(body_json)
            title = (n.get("title") or "Untitled").strip()[:MAX_TITLE_CHARS]
            tags = _validate_tags(n.get("tags"))
            ticker = _validate_ticker(n.get("ticker"))
            h = _import_payload_hash(n)
            path = tuple((n.get("folderPath") or [])[:MAX_FOLDER_DEPTH])
            if path not in path_cache:
                path_cache[path] = (ensure_folder_path(user_id, list(path), dest, conn=conn)
                                    if path else (dest or None))
            folder_id = path_cache[path] or None
            row = conn.execute(
                "SELECT id, import_hash FROM j2_notes WHERE user_id = ? AND import_key = ?",
                (user_id, key)).fetchone()
            item = {"importKey": key, "id": row["id"] if row else None}
            if row and row["import_hash"] == h:
                skipped.append(item); continue
            created_at = _import_date(n.get("createdAt"), now)
            updated_at = _import_date(n.get("updatedAt"), now)
            if row:
                conn.execute(
                    "UPDATE j2_notes SET title=?, subtitle=?, body_json=?, body_plain=?, "
                    "folder_id=?, ticker=?, tags=?, import_hash=?, imported_at=?, updated_at=? "
                    "WHERE id=? AND user_id=?",
                    (title, n.get("subtitle") or None, json.dumps(body_json), body_plain,
                     folder_id, ticker, json.dumps(tags), h, now, updated_at,
                     row["id"], user_id))
                updated.append(item)
            else:
                new_id = uuid.uuid4().hex
                conn.execute(
                    "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, "
                    "body_plain, ticker, tags, import_source, import_key, import_hash, "
                    "imported_at, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (new_id, user_id, folder_id, title, n.get("subtitle") or None,
                     json.dumps(body_json), body_plain, ticker, json.dumps(tags),
                     source, key, h, now, created_at, updated_at))
                item["id"] = new_id
                created.append(item)
        conn.commit()
        return {"created": created, "updated": updated, "skipped": skipped}
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── Row mapping ──────────────────────────────────────────────────────────────

def _row_to_note(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "accountId": row["account_id"],
        "folderId": row["folder_id"],
        "title": row["title"] or "",
        "subtitle": row["subtitle"],
        "bodyJson": json.loads(row["body_json"] or '{"type":"doc","content":[]}'),
        "bodyPlain": row["body_plain"] or "",
        "heroImageUrl": row["hero_image_url"],
        "ticker": row["ticker"],
        "tags": json.loads(row["tags"] or "[]"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_folder(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "sortOrder": row["sort_order"],
        "createdAt": row["created_at"],
        "parentId": row["parent_id"] or None,
    }


def _folder_depth(conn: sqlite3.Connection, user_id: str, folder_id: str) -> int:
    """1-based depth of folder_id. Walks up; a cycle or missing parent stops the walk."""
    depth, cur, seen = 0, folder_id, set()
    while cur and cur not in seen:
        seen.add(cur)
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (cur, user_id)).fetchone()
        if row is None:
            break
        depth += 1
        cur = row["parent_id"]
    return depth


# ── Notes CRUD ───────────────────────────────────────────────────────────────

def list_notes(
    user_id: str,
    *,
    folder_id: str | None = None,
    tag: str | None = None,
    ticker: str | None = None,
    q: str | None = None,
    sort: str = "updated",
    limit: int = 100,
    offset: int = 0,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = "SELECT * FROM j2_notes WHERE user_id = ?"
        params: list[Any] = [user_id]
        if folder_id == "__unfiled__":
            sql += " AND folder_id IS NULL"
        elif folder_id:
            sql += " AND folder_id = ?"
            params.append(folder_id)
        if ticker:
            sql += " AND ticker = ?"
            params.append(ticker.strip().upper())
        if tag:
            # JSON LIKE — case-insensitive substring of any tag value.
            sql += ' AND lower(tags) LIKE ?'
            params.append(f'%"{tag.lower()}"%')
        if q:
            sql += " AND (lower(title) LIKE ? OR lower(body_plain) LIKE ?)"
            ql = f"%{q.lower()}%"
            params.extend([ql, ql])
        order_col = {
            "updated": "updated_at DESC",
            "created": "created_at DESC",
            "title": "title COLLATE NOCASE ASC",
        }.get(sort, "updated_at DESC")
        sql += f" ORDER BY {order_col} LIMIT ? OFFSET ?"
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        return _row_to_note(row) if row else None
    finally:
        if owned:
            conn.close()


def create_note(
    user_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    title = (payload.get("title") or "").strip()
    if len(title) > MAX_TITLE_CHARS:
        raise NoteValidationError("title too long")
    subtitle = payload.get("subtitle")
    if subtitle is not None:
        if not isinstance(subtitle, str):
            raise NoteValidationError("subtitle must be a string")
        subtitle = subtitle.strip() or None
        if subtitle and len(subtitle) > MAX_SUBTITLE_CHARS:
            raise NoteValidationError("subtitle too long")
    body_json = _validate_body_json(payload.get("bodyJson"))
    body_plain = extract_plain_text(body_json)
    folder_id = payload.get("folderId") or None
    ticker = _validate_ticker(payload.get("ticker"))
    tags = _validate_tags(payload.get("tags"))
    hero = payload.get("heroImageUrl") or None
    account_id = payload.get("accountId") or None

    owned = conn is None
    conn = conn or get_connection()
    try:
        new_id = uuid.uuid4().hex
        now = _now_iso()
        if folder_id:
            ok = conn.execute(
                "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                (folder_id, user_id),
            ).fetchone()
            if not ok:
                raise NoteValidationError("folder not found")
        conn.execute(
            """
            INSERT INTO j2_notes (
                id, user_id, account_id, folder_id, title, subtitle,
                body_json, body_plain, hero_image_url, ticker, tags,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, user_id, account_id, folder_id, title, subtitle,
                json.dumps(body_json), body_plain, hero, ticker,
                json.dumps(tags), now, now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_note(row)
    finally:
        if owned:
            conn.close()


def update_note(
    user_id: str,
    note_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    if not isinstance(patch, dict):
        raise NoteValidationError("patch must be an object")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []

        if "title" in patch:
            t = (patch["title"] or "").strip()
            if len(t) > MAX_TITLE_CHARS:
                raise NoteValidationError("title too long")
            sets.append("title = ?"); params.append(t)
        if "subtitle" in patch:
            s = patch["subtitle"]
            if s is not None:
                if not isinstance(s, str):
                    raise NoteValidationError("subtitle must be a string")
                s = s.strip() or None
                if s and len(s) > MAX_SUBTITLE_CHARS:
                    raise NoteValidationError("subtitle too long")
            sets.append("subtitle = ?"); params.append(s)
        if "bodyJson" in patch:
            bj = _validate_body_json(patch["bodyJson"])
            bp = extract_plain_text(bj)
            sets.append("body_json = ?"); params.append(json.dumps(bj))
            sets.append("body_plain = ?"); params.append(bp)
        if "folderId" in patch:
            f = patch["folderId"] or None
            if f:
                ok = conn.execute(
                    "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                    (f, user_id),
                ).fetchone()
                if not ok:
                    raise NoteValidationError("folder not found")
            sets.append("folder_id = ?"); params.append(f)
        if "ticker" in patch:
            sets.append("ticker = ?"); params.append(_validate_ticker(patch["ticker"]))
        if "tags" in patch:
            sets.append("tags = ?"); params.append(json.dumps(_validate_tags(patch["tags"])))
        if "heroImageUrl" in patch:
            h = patch["heroImageUrl"] or None
            if h is not None and not isinstance(h, str):
                raise NoteValidationError("heroImageUrl must be string or null")
            sets.append("hero_image_url = ?"); params.append(h)

        if not sets:
            return _row_to_note(existing)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([note_id, user_id])
        conn.execute(
            f"UPDATE j2_notes SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _row_to_note(row)
    finally:
        if owned:
            conn.close()


def delete_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Folders CRUD ─────────────────────────────────────────────────────────────

def list_folders(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_folders WHERE user_id = ? "
            "ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_folder(r) for r in rows]
    finally:
        if owned:
            conn.close()


def create_folder(
    user_id: str,
    name: str,
    sort_order: int = 0,
    parent_id: str = "",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not isinstance(name, str) or not name.strip():
        raise NoteValidationError("folder name is required")
    n = name.strip()
    if len(n) > 80:
        raise NoteValidationError("folder name too long")
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Validate parent if truthy
        if parent_id:
            parent_row = conn.execute(
                "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                (parent_id, user_id)).fetchone()
            if parent_row is None:
                raise NoteValidationError("parent folder not found")
            # Check depth cap
            parent_depth = _folder_depth(conn, user_id, parent_id)
            if parent_depth + 1 > MAX_FOLDER_DEPTH:
                raise NoteValidationError("folder nesting too deep")

        new_id = uuid.uuid4().hex
        now = _now_iso()
        try:
            conn.execute(
                "INSERT INTO j2_note_folders (id, user_id, name, sort_order, parent_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (new_id, user_id, n, sort_order, parent_id, now),
            )
        except sqlite3.IntegrityError:
            raise NoteValidationError("folder with that name already exists")
        if owned:
            conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_folder(row)
    finally:
        if owned:
            conn.close()


def update_folder(
    user_id: str,
    folder_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        sets: list[str] = []
        params: list[Any] = []
        if "name" in patch:
            n = (patch["name"] or "").strip()
            if not n:
                raise NoteValidationError("folder name cannot be empty")
            if len(n) > 80:
                raise NoteValidationError("folder name too long")
            sets.append("name = ?"); params.append(n)
        if "sortOrder" in patch:
            so = patch["sortOrder"]
            if not isinstance(so, int):
                raise NoteValidationError("sortOrder must be integer")
            sets.append("sort_order = ?"); params.append(so)
        if not sets:
            return _row_to_folder(existing)
        params.extend([folder_id, user_id])
        try:
            conn.execute(
                f"UPDATE j2_note_folders SET {', '.join(sets)} "
                f"WHERE id = ? AND user_id = ?",
                params,
            )
        except sqlite3.IntegrityError:
            raise NoteValidationError("folder with that name already exists")
        if owned:
            conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        return _row_to_folder(row)
    finally:
        if owned:
            conn.close()


def delete_folder(
    user_id: str,
    folder_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Delete folder; re-parents children and notes to the deleted folder's parent.
    Root deletion (parent_id='') sends notes to Unfiled (NULL)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id)).fetchone()
        if row is None:
            return False
        parent = row["parent_id"] or ""

        # Detect name collisions BEFORE any mutations
        # Exclude the deleted folder itself from the destination set to avoid self-referential false positives
        collision = conn.execute(
            "SELECT name FROM j2_note_folders WHERE user_id = ? AND parent_id = ? AND id != ? AND name IN "
            "(SELECT name FROM j2_note_folders WHERE user_id = ? AND parent_id = ?)",
            (user_id, parent, folder_id, user_id, folder_id)).fetchone()
        if collision:
            raise NoteValidationError(
                f"cannot delete: a folder named '{collision['name']}' already exists at the destination — rename it first")

        now = _now_iso()
        # Delete the folder first to avoid UNIQUE constraint violations when re-parenting
        cur = conn.execute(
            "DELETE FROM j2_note_folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        # notes climb to the parent; at root ('' parent) they go Unfiled (NULL)
        conn.execute(
            "UPDATE j2_notes SET folder_id = ?, updated_at = ? WHERE folder_id = ? AND user_id = ?",
            (parent or None, now, folder_id, user_id))
        conn.execute(
            "UPDATE j2_note_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?",
            (parent, folder_id, user_id))
        if owned:
            conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def ensure_folder_path(user_id: str, path_parts: list[str], dest_folder_id: str = "", conn=None) -> str:
    """Upsert a folder chain under dest_folder_id; returns leaf folder id.
    Truncates each segment to the 80-char folder-name cap."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        pid = dest_folder_id or ""
        for raw in path_parts:
            name = (raw or "").strip()[:80] or "Untitled"
            row = conn.execute(
                "SELECT id FROM j2_note_folders WHERE user_id = ? AND parent_id = ? AND name = ?",
                (user_id, pid, name)).fetchone()
            if row:
                pid = row["id"]
            else:
                pid = create_folder(user_id, name, parent_id=pid, conn=conn)["id"]
        return pid
    finally:
        if owned:
            conn.close()


# ── Image upload ─────────────────────────────────────────────────────────────

async def save_note_image(
    user_id: str,
    note_id: str,
    upload,
    *,
    kind: str = "inline",  # "inline" or "hero"
) -> dict[str, Any]:
    """Validate + persist an image attached to a note. Returns
    {url, width, height}. Caller is responsible for setting
    hero_image_url on the note row (if kind=hero) or inserting an
    image node in body_json (if kind=inline)."""
    if upload.content_type not in _ALLOWED_IMAGE_MIMES:
        raise NoteValidationError("Only PNG/JPG/GIF/WebP images allowed")
    raw = await upload.read()
    if len(raw) > _MAX_IMAGE_BYTES:
        raise NoteValidationError("Image must be < 5 MB")
    if len(raw) == 0:
        raise NoteValidationError("Empty file")

    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg",
        "image/gif": ".gif", "image/webp": ".webp",
    }
    ext = ext_map.get(upload.content_type, ".png")

    sub = "hero" if kind == "hero" else "inline"
    target_dir = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    target_path = target_dir / f"{new_id}{ext}"
    target_path.write_bytes(raw)

    public_url = (
        f"/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{new_id}{ext}"
    )
    # Width/height: only computed if Pillow can read it; otherwise skip.
    width = height = None
    try:
        from PIL import Image
        with Image.open(target_path) as im:
            width, height = im.size
    except Exception:
        pass
    return {"url": public_url, "width": width, "height": height}


async def save_note_attachment(
    user_id: str,
    note_id: str,
    upload,
) -> dict[str, Any]:
    """Validate + persist a non-image file attached to a note. Returns
    {url, name, size}. File is stored under _ATTACHMENT_ROOT/{user_id}/notes/{note_id}/file/"""
    if upload.content_type not in _ALLOWED_FILE_MIMES:
        raise NoteValidationError(f"MIME type {upload.content_type} not allowed")
    raw = await upload.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise NoteValidationError("File must be < 25 MB")
    if len(raw) == 0:
        raise NoteValidationError("Empty file")

    # Extract extension from filename; default to .bin if not in allowlist
    filename = getattr(upload, "filename", "") or "attachment"
    ext_map = {
        ".pdf": ".pdf", ".txt": ".txt", ".csv": ".csv", ".md": ".md",
        ".zip": ".zip", ".mp3": ".mp3", ".m4a": ".m4a",
        ".docx": ".docx", ".xlsx": ".xlsx",
    }
    # Get extension from filename (case-insensitive)
    file_ext = ""
    if "." in filename:
        file_ext = filename[filename.rfind("."):].lower()
    ext = ext_map.get(file_ext, ".bin")

    sub = "file"
    target_dir = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    target_path = target_dir / f"{new_id}{ext}"
    target_path.write_bytes(raw)

    public_url = (
        f"/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{new_id}{ext}"
    )
    return {"url": public_url, "name": filename, "size": len(raw)}


def serve_note_image_path(
    user_id: str,
    note_id: str,
    sub: str,
    filename: str,
) -> Path | None:
    if sub not in ("hero", "inline", "file"):
        return None
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    base = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub
    target = (base / filename).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target


# ── Playbook → TipTap converter (used by migration in db.py) ─────────────────

def convert_playbook_to_tiptap(entry: dict[str, Any]) -> dict[str, Any]:
    """Build a TipTap ProseMirror doc from a legacy playbook entry dict
    (the shape returned by the old playbook.py `_row_to_entry`).
    Returns {"type":"doc","content":[...]} ready to JSON-encode."""
    content: list[dict[str, Any]] = []

    # H1: symbol — observedDate
    symbol = entry.get("symbol") or ""
    observed = entry.get("observedDate") or ""
    heading_text = (
        f"{symbol} — {observed}" if symbol and observed else (symbol or observed or "Note")
    )
    content.append({
        "type": "heading",
        "attrs": {"level": 1},
        "content": [{"type": "text", "text": heading_text}],
    })

    # Levels table
    levels = entry.get("levels") or {}
    if isinstance(levels, dict) and any(levels.get(k) is not None for k in
                                         ("trigger", "support", "resistance", "stop", "target")):
        rows = []
        header_cells = []
        body_cells = []
        for key, label in [
            ("trigger", "Trigger"), ("support", "Support"),
            ("resistance", "Resistance"), ("stop", "Stop"), ("target", "Target"),
        ]:
            v = levels.get(key)
            if v is None:
                continue
            header_cells.append({
                "type": "tableHeader",
                "content": [{"type": "paragraph",
                             "content": [{"type": "text", "text": label}]}],
            })
            body_cells.append({
                "type": "tableCell",
                "content": [{"type": "paragraph",
                             "content": [{"type": "text", "text": f"${v}"}]}],
            })
        rows.append({"type": "tableRow", "content": header_cells})
        rows.append({"type": "tableRow", "content": body_cells})
        content.append({"type": "table", "content": rows})

    # Thesis paragraph (only if non-empty)
    thesis = (entry.get("thesis") or "").strip()
    if thesis:
        content.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": thesis}],
        })

    # Attachments: images become image nodes, links become paragraph w/ link.
    for att in (entry.get("attachments") or []):
        if not isinstance(att, dict):
            continue
        url = att.get("url")
        if not url:
            continue
        if att.get("kind") == "image":
            content.append({"type": "image", "attrs": {"src": url, "alt": ""}})
        elif att.get("kind") == "link":
            label = att.get("label") or url
            content.append({
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": label,
                    "marks": [{"type": "link", "attrs": {"href": url}}],
                }],
            })

    # Additional notes
    notes = (entry.get("notes") or "").strip()
    if notes:
        content.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": notes}],
        })

    return {"type": "doc", "content": content}
