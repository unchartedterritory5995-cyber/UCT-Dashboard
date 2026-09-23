"""S5 CP3 (GATE-S5-PERSISTENCE-USER-STATE, fingerprint 41ffcc91c) — Tracings'
dedicated store, ruled OFF `user_preferences` rather than growing that
endpoint's other 70 call sites a compare-and-set they don't need.

⛔ DARK AT CP3. Built and tested; nothing in the product calls it yet.
`useTracingsSync.js` still reads `POST /api/auth/preferences`. CP4 is the
checkpoint that wires a live consumer, behind its own compiled constant,
defaulting OFF (`tests/test_tracings_store.py` carries the inertness rail).

Mirrors `api/services/journal_two/notes.py::update_note`'s compare-and-set
shape (an explicit baseline the caller sends, compared against the stored
value, raising rather than silently overwriting on a mismatch) but with an
explicit integer `revision` counter as the CAS token instead of a reused
timestamp — SPEC-S5 A-2 asks for "a revision the server RETURNS on every
write", and a counter has no clock-skew ambiguity a timestamp baseline does.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.auth_db import get_connection


class TracingsConflictError(Exception):
    """Raised when `expected_revision` no longer matches the stored row —
    another writer (a second tab, a second device) landed first. The caller
    should re-fetch, merge or fork, and retry; a blind overwrite here is
    exactly the clobber A-1 exists to prevent."""


def get_tracings(user_id: str, conn=None) -> Optional[dict[str, Any]]:
    """Returns `{"doc": <raw JSON text>, "revision": int, "updatedAt": str}`,
    or None if this member has never written a tracings document."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT doc, revision, updated_at FROM tracings_documents WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {"doc": row["doc"], "revision": row["revision"], "updatedAt": row["updated_at"]}
    finally:
        if owned:
            conn.close()


def set_tracings(
    user_id: str,
    doc: str,
    expected_revision: Optional[int] = None,
    conn=None,
) -> dict[str, Any]:
    """Compare-and-set write. `expected_revision=None` is last-writer-wins
    (matches `update_note`'s `expected_updated_at=None` convention) — a
    caller that never read a baseline gets the old behavior, not a refusal.
    `doc` is stored as-is (the caller's export blob, already JSON text);
    this layer does not parse or validate its shape, matching
    `hasTracingContent`'s own shape-tolerant stance client-side.

    Returns the new `{"doc", "revision", "updatedAt"}` on success. Raises
    `TracingsConflictError` on a stale baseline — nothing is written.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT revision FROM tracings_documents WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if existing is not None and expected_revision is not None and existing["revision"] != expected_revision:
            raise TracingsConflictError("tracings document changed since the client's baseline")

        if existing is None:
            conn.execute(
                "INSERT INTO tracings_documents (user_id, doc, revision) VALUES (?, ?, 1)",
                (user_id, doc),
            )
            new_revision = 1
        else:
            new_revision = existing["revision"] + 1
            conn.execute(
                "UPDATE tracings_documents SET doc = ?, revision = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE user_id = ?",
                (doc, new_revision, user_id),
            )
        conn.commit()
        row = conn.execute(
            "SELECT doc, revision, updated_at FROM tracings_documents WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return {"doc": row["doc"], "revision": row["revision"], "updatedAt": row["updated_at"]}
    finally:
        if owned:
            conn.close()
