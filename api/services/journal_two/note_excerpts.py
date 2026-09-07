"""Wave J — Document Intelligence II: excerpts / highlights / annotations.

`j2_note_excerpts` is BOTH the durable "saved passage" object and the
in-document highlight (one row serves both facets — see the Wave J entry
checkpoint, `docs/notebook/prelaunch-primary-notebook-build-plan.md`, for
the full rationale behind every decision below).

Two structural guarantees enforced by this module's own shape:
- **Source-text immutability.** There is no function that rewrites
  `captured_text` — only `update_excerpt_annotation` touches an existing
  row, and it stamps `modified_at` (checkpoint decision 74). A re-extraction
  of the underlying document's page text (Wave I's `extraction_version`
  bump) never reaches an already-captured excerpt.
- **Two-sided tenant re-verification on every write**, mirroring
  `thesis_evidence.py`'s own discipline exactly: both the destination note
  AND the source document must resolve as this user's own before an
  excerpt can be created.
"""
from __future__ import annotations

import sqlite3
import uuid
from typing import Any

from api.services.auth_db import get_connection

_MAX_QUOTE_CONTEXT_CHARS = 200


class ExcerptValidationError(ValueError):
    pass


def _now_iso() -> str:
    from api.services.journal_two.notes import _now_iso as _impl
    return _impl()


def _row_to_excerpt(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "noteId": row["note_id"],
        "documentId": row["document_id"],
        # Present only when the caller's query joined j2_note_documents
        # (list_note_excerpts does; create/get/update's bare
        # `SELECT * FROM j2_note_excerpts` do not -- the UI's document-name
        # citation line only needs it on the list read).
        "documentName": row["document_name"] if "document_name" in keys else None,
        "attachmentUrl": row["attachment_url"] if "attachment_url" in keys else None,
        "pageNumber": row["page_number"],
        "capturedText": row["captured_text"],
        "quotePrefix": row["quote_prefix"],
        "quoteSuffix": row["quote_suffix"],
        "charStart": row["char_start"],
        "charEnd": row["char_end"],
        "annotation": row["annotation"],
        "createdAt": row["created_at"],
        "modifiedAt": row["modified_at"],
    }


def create_excerpt(
    user_id: str, note_id: str, *,
    document_id: str, page_number: int, captured_text: str,
    quote_prefix: str | None = None,
    quote_suffix: str | None = None,
    char_start: int | None = None,
    char_end: int | None = None,
    annotation: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Create one immutable excerpt. Re-verifies BOTH the destination note
    AND the source document belong to this user before writing anything
    (checkpoint decision 37/104-107) — raises ExcerptValidationError on any
    failure, never a silent no-op."""
    captured_text = (captured_text or "").strip()
    if not captured_text:
        raise ExcerptValidationError("captured_text is required")
    if not isinstance(page_number, int) or page_number < 1:
        raise ExcerptValidationError("page_number must be a positive integer")

    owned = conn is None
    conn = conn or get_connection()
    try:
        from api.services.journal_two.notes import get_note
        if get_note(user_id, note_id, conn=conn) is None:
            raise ExcerptValidationError("Note not found")
        doc_row = conn.execute(
            "SELECT id FROM j2_note_documents WHERE id = ? AND user_id = ?",
            (document_id, user_id),
        ).fetchone()
        if doc_row is None:
            raise ExcerptValidationError("Document not found")

        # Truncate quote context server-side too -- the client only ever
        # SENDS a short window, but this is the actual security/sanity
        # boundary (checkpoint decision 106).
        if quote_prefix:
            quote_prefix = quote_prefix[-_MAX_QUOTE_CONTEXT_CHARS:]
        if quote_suffix:
            quote_suffix = quote_suffix[:_MAX_QUOTE_CONTEXT_CHARS]

        excerpt_id = uuid.uuid4().hex
        now = _now_iso()
        conn.execute(
            "INSERT INTO j2_note_excerpts"
            " (id, user_id, note_id, document_id, page_number, captured_text,"
            "  quote_prefix, quote_suffix, char_start, char_end, annotation,"
            "  created_at, modified_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
            (excerpt_id, user_id, note_id, document_id, page_number, captured_text,
             quote_prefix, quote_suffix, char_start, char_end,
             (annotation or "").strip() or None, now),
        )
        conn.commit()
        return get_excerpt(user_id, excerpt_id, conn=conn)
    finally:
        if owned:
            conn.close()


def get_excerpt(user_id: str, excerpt_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Joins the source document's name + attachment URL -- the single-
    excerpt read exists specifically so a thesis-evidence row (which only
    carries a bare `document_excerpt` target id) can open the exact source
    page without a second lookup, regardless of whether that excerpt is
    even a node in the CURRENTLY open note's own body."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT e.*, d.name AS document_name, d.attachment_url AS attachment_url"
            " FROM j2_note_excerpts e JOIN j2_note_documents d ON d.id = e.document_id"
            " WHERE e.id = ? AND e.user_id = ?",
            (excerpt_id, user_id),
        ).fetchone()
        return _row_to_excerpt(row) if row else None
    finally:
        if owned:
            conn.close()


def list_note_excerpts(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Every excerpt the note's own `j2_note_excerpt_refs` sidecar
    references, in document order -- mirrors `note_facts.list_note_facts`
    exactly. An excerpt whose id no longer resolves (its row was deleted,
    e.g. via source-document cascade) is simply absent from the join —
    that absence is what drives `ExcerptView`'s "no longer available"
    render, the same mechanism `FinancialFactView` already relies on."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT e.*, d.name AS document_name FROM j2_note_excerpt_refs r"
            " JOIN j2_note_excerpts e ON e.id = r.excerpt_id AND e.user_id = r.user_id"
            " JOIN j2_note_documents d ON d.id = e.document_id"
            " WHERE r.note_id = ? AND r.user_id = ?"
            " ORDER BY r.position",
            (note_id, user_id),
        ).fetchall()
        return [_row_to_excerpt(r) for r in rows]
    finally:
        if owned:
            conn.close()


def update_excerpt_annotation(
    user_id: str, excerpt_id: str, annotation: str | None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """The ONE editable field (checkpoint decision 14/74) -- captured_text
    itself is never rewritten. Returns None if not found / not this user's."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM j2_note_excerpts WHERE id = ? AND user_id = ?",
            (excerpt_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        now = _now_iso()
        conn.execute(
            "UPDATE j2_note_excerpts SET annotation = ?, modified_at = ? WHERE id = ? AND user_id = ?",
            ((annotation or "").strip() or None, now, excerpt_id, user_id),
        )
        conn.commit()
        return get_excerpt(user_id, excerpt_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_excerpt(user_id: str, excerpt_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Hard delete (unlike thesis_evidence's soft-delete) -- an excerpt is
    the source-of-truth capture itself, not a relationship; removing it from
    a note (deleting the `documentExcerpt` node) is the member's real intent
    to delete the capture, not just unlink it. Returns False if not found /
    not this user's."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_note_excerpts WHERE id = ? AND user_id = ?",
            (excerpt_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()
