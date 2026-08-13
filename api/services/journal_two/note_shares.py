"""Public share links for notebook notes (post-v1 round 2).

The screener-share idiom, applied to notes: the token IS the credential, the
public payload is SANITIZED and read-only, and the whole public surface is
flag-gated (J2_SHARE_LINKS_ENABLED, default OFF — nothing is reachable until
the flag flips, and revoking a link kills it instantly).

What a shared page serves — and deliberately does NOT:
- title / subtitle / bodyJson / hero / updatedAt. No user id, no tags, no
  folder, no ticker: the reader gets the DOCUMENT, not the account.
- Widget embeds render as their ARCHIVED IMAGES on the public page (the
  durable-image substrate doing exactly the job it was designed for) — a
  public reader must never mount live components that poll auth-scoped APIs.
- Attachment URLs inside the body are REWRITTEN to the token-scoped proxy
  (`/api/j2/shared/{token}/att/...`): the real attachment route is owner-only
  and must stay that way. Only image subs (inline/hero) are proxied — 'file'
  attachments (PDFs, CSVs) stay private in v1; a shared page is a reading
  surface, not a file drop.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_service


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def enabled() -> bool:
    return os.environ.get("J2_SHARE_LINKS_ENABLED", "0") == "1"


def _owned(conn: sqlite3.Connection, user_id: str, note_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM j2_notes WHERE id = ? AND user_id = ?", (note_id, user_id)
    ).fetchone()
    return row is not None


def get_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """The note's ACTIVE share token, or None."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT token, created_at FROM j2_note_shares"
            " WHERE note_id = ? AND user_id = ? AND revoked_at IS NULL",
            (note_id, user_id),
        ).fetchone()
        return {"token": row["token"], "createdAt": row["created_at"]} if row else None
    finally:
        if owned:
            conn.close()


def create_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Mint (or return the existing active) share token. None = not the
    caller's note."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if not _owned(conn, user_id, note_id):
            return None
        existing = get_share(user_id, note_id, conn=conn)
        if existing:
            return existing
        token = secrets.token_urlsafe(24)
        now = _now_iso()
        conn.execute(
            "INSERT INTO j2_note_shares (token, note_id, user_id, created_at)"
            " VALUES (?, ?, ?, ?)",
            (token, note_id, user_id, now),
        )
        conn.commit()
        return {"token": token, "createdAt": now}
    finally:
        if owned:
            conn.close()


def revoke_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_shares SET revoked_at = ?"
            " WHERE note_id = ? AND user_id = ? AND revoked_at IS NULL",
            (_now_iso(), note_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def _rewrite_attachment_urls(raw_json: str, user_id: str, note_id: str, token: str) -> str:
    """Point THIS note's attachment URLs at the token-scoped proxy. URLs for
    OTHER notes (an embed pasted across notes) are left untouched — they stay
    owner-only and render as broken images publicly, which is the honest
    outcome for content the token does not cover."""
    return raw_json.replace(
        f"/api/j2/notes/attachments/{user_id}/{note_id}/",
        f"/api/j2/shared/{token}/att/",
    )


def resolve_share(token: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """The SANITIZED public payload for an active token, or None."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT note_id, user_id FROM j2_note_shares"
            " WHERE token = ? AND revoked_at IS NULL",
            (token,),
        ).fetchone()
        if not row:
            return None
        note = notes_service.get_note(row["user_id"], row["note_id"], conn=conn)
        if not note:
            return None
        body_raw = _rewrite_attachment_urls(
            json.dumps(note.get("bodyJson") or {}), row["user_id"], row["note_id"], token,
        )
        hero = note.get("heroImageUrl")
        if hero:
            hero = _rewrite_attachment_urls(hero, row["user_id"], row["note_id"], token)
        return {
            "title": note.get("title") or "",
            "subtitle": note.get("subtitle"),
            "bodyJson": json.loads(body_raw),
            "heroImageUrl": hero,
            "updatedAt": note.get("updatedAt"),
        }
    finally:
        if owned:
            conn.close()


def resolve_share_attachment(token: str, sub: str, filename: str,
                             conn: sqlite3.Connection | None = None):
    """Filesystem path for a token-scoped attachment — images only ('file'
    attachments stay private), path-traversal guarded by serve_note_image_path."""
    if sub not in ("inline", "hero"):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT note_id, user_id FROM j2_note_shares"
            " WHERE token = ? AND revoked_at IS NULL",
            (token,),
        ).fetchone()
        if not row:
            return None
        return notes_service.serve_note_image_path(row["user_id"], row["note_id"], sub, filename)
    finally:
        if owned:
            conn.close()
