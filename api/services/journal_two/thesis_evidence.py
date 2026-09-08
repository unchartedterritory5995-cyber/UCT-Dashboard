"""Wave G — Thesis Intelligence: typed evidence relationships.

The ONE new structural primitive this wave's entry checkpoint found
necessary (decision 15/24): `j2_thesis_evidence` points FROM a thesis note
TO either another note (`target_type='note'`), a captured financial fact
(`target_type='fact'`), or (Wave J) a saved document excerpt
(`target_type='document_excerpt'`), annotated with a SUPPORTS/OPPOSES
stance and an optional caption. See the Wave G entry checkpoint
(`docs/notebook/prelaunch-primary-notebook-build-plan.md`) for the full
48-point rationale, and the Wave J entry checkpoint for the
`document_excerpt` extension -- `target_type` was left an open string
specifically to invite it.

Soft-delete only (`removed_at`, never a hard DELETE on user action) — this
is what lets the Wave G changelog derive evidence-added/evidence-removed
events directly from this table's own timestamps, with no separate event
log (checkpoint decision 22/24/25).

Tenant re-verification is TWO-SIDED on every write (checkpoint decision 36,
mirrors `note_trade_links.resolve_trade_ref`'s own discipline): both the
thesis note AND the evidence target must resolve as this user's own before
a link is created. A reference is never treated as authorization.
"""
from __future__ import annotations

import sqlite3
import uuid
from typing import Any

from api.services.auth_db import get_connection

STANCES = ("supports", "opposes")
TARGET_TYPES = ("note", "fact", "document_excerpt")


class ThesisEvidenceValidationError(ValueError):
    pass


def _now_iso() -> str:
    from api.services.journal_two.notes import _now_iso as _impl
    return _impl()


def _row_to_evidence(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "noteId": row["note_id"],
        "targetType": row["target_type"],
        "targetId": row["target_id"],
        "stance": row["stance"],
        "caption": row["caption"],
        "createdAt": row["created_at"],
        "removedAt": row["removed_at"],
    }


def _target_exists(user_id: str, target_type: str, target_id: str, conn: sqlite3.Connection) -> bool:
    """Re-verifies the target is genuinely this user's own before a link can
    reference it -- a note id or fact id supplied by the client is never
    trusted on its own (checkpoint decision 36)."""
    if target_type == "note":
        from api.services.journal_two.notes import get_note
        return get_note(user_id, target_id, conn=conn) is not None
    if target_type == "fact":
        from api.services.journal_two.note_facts import get_fact_observation
        return get_fact_observation(user_id, target_id, conn=conn) is not None
    if target_type == "document_excerpt":
        from api.services.journal_two.note_excerpts import get_excerpt
        return get_excerpt(user_id, target_id, conn=conn) is not None
    return False


def add_evidence(
    user_id: str, note_id: str, *,
    target_type: str, target_id: str, stance: str,
    caption: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Create one evidence link. Re-verifies BOTH the thesis note and the
    target belong to this user before writing anything (checkpoint decision
    36) -- raises ThesisEvidenceValidationError on any failure, never a
    silent no-op link."""
    target_type = (target_type or "").strip().lower()
    stance = (stance or "").strip().lower()
    target_id = (target_id or "").strip()
    if target_type not in TARGET_TYPES:
        raise ThesisEvidenceValidationError(f"Unknown target type: {target_type!r}")
    if stance not in STANCES:
        raise ThesisEvidenceValidationError(f"Unknown stance: {stance!r}")
    if not target_id:
        raise ThesisEvidenceValidationError("target_id is required")

    owned = conn is None
    conn = conn or get_connection()
    try:
        from api.services.journal_two.notes import get_note
        if get_note(user_id, note_id, conn=conn) is None:
            raise ThesisEvidenceValidationError("Note not found")
        if not _target_exists(user_id, target_type, target_id, conn=conn):
            raise ThesisEvidenceValidationError("Evidence target not found")

        # ⛔⛔ WAVE N §4 — ONE LIVE EDGE PER (THESIS, TARGET).
        #
        # ⚰️ There was no guard here at all. The picker disables an
        # already-attached candidate, so the MEMBER could not create a
        # duplicate — and anything that was not the picker could: a second POST
        # simply inserted a second live row. A thesis holding one passage twice
        # then reports TWO supporting/opposing counts for ONE source, which is
        # §6's "curation cannot manufacture corroboration" arriving through a
        # different door. A guard that lives only in a disabled button is not a
        # guard.
        #
        # ⛔ DELIBERATELY NARROW. It is scoped to ONE note, so the same passage
        # still bears on as many theses as the member likes (that is the point
        # of a shared research corpus), and it ignores removed edges, so a
        # changed judgement — remove, re-add with the other stance — still
        # works. It runs AFTER the ownership check, so a member who cannot see
        # the target is refused for that reason and never learns from this
        # message that somebody else attached it.
        if conn.execute(
            "SELECT 1 FROM j2_thesis_evidence"
            " WHERE user_id = ? AND note_id = ? AND target_type = ? AND target_id = ?"
            " AND removed_at IS NULL LIMIT 1",
            (user_id, note_id, target_type, target_id),
        ).fetchone() is not None:
            raise ThesisEvidenceValidationError(
                "This evidence is already attached to this thesis")

        evidence_id = uuid.uuid4().hex
        now = _now_iso()
        conn.execute(
            "INSERT INTO j2_thesis_evidence"
            " (id, user_id, note_id, target_type, target_id, stance, caption, created_at, removed_at)"
            " VALUES (?,?,?,?,?,?,?,?,NULL)",
            (evidence_id, user_id, note_id, target_type, target_id, stance, caption, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM j2_thesis_evidence WHERE id = ?", (evidence_id,)).fetchone()
        return _row_to_evidence(row)
    finally:
        if owned:
            conn.close()


def list_note_evidence(
    user_id: str, note_id: str, *, include_removed: bool = False,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Newest-first. `include_removed=True` is for the changelog's own read
    (checkpoint decision 22c) -- the note-facing evidence panel always uses
    the default (live evidence only)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = "SELECT * FROM j2_thesis_evidence WHERE note_id = ? AND user_id = ?"
        if not include_removed:
            sql += " AND removed_at IS NULL"
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql, (note_id, user_id)).fetchall()
        return [_row_to_evidence(r) for r in rows]
    finally:
        if owned:
            conn.close()


def remove_evidence(
    user_id: str, evidence_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Soft-delete (stamps removed_at) -- never a hard DELETE on user action,
    so the changelog can still see it happened (checkpoint decision 22c/25).
    Returns None if not found / not this user's / already removed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_thesis_evidence WHERE id = ? AND user_id = ? AND removed_at IS NULL",
            (evidence_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        now = _now_iso()
        conn.execute(
            "UPDATE j2_thesis_evidence SET removed_at = ? WHERE id = ? AND user_id = ?",
            (now, evidence_id, user_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM j2_thesis_evidence WHERE id = ?", (evidence_id,)).fetchone()
        return _row_to_evidence(row)
    finally:
        if owned:
            conn.close()
