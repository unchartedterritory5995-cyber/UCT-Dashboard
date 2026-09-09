"""Wave N — what a member may attach to a thesis, and what it truthfully IS.

⚰️ THE DEFECT THIS CLOSES. A captured web passage exists, `thesis_evidence`
accepts it as a `document_excerpt` target (proven: it attaches, the stance lands
on the edge, the source text is untouched) — and **the member could never pick
it**, because the picker's candidate list came from `list_note_excerpts`, which
joins `j2_note_excerpt_refs`. That sidecar is REBUILT FROM `documentExcerpt`
NODES IN THE NOTE BODY (`notes._sync_note_excerpt_refs`). A capture never embeds
one, so it had no ref and was invisible. BUILT + GREEN + MEMBER-UNREACHABLE.

⛔⛔ THE FIX IS NOT TO FABRICATE A `documentExcerpt` NODE so the old list can see
it. That would lie to the data model to satisfy a UI: it would put a card in the
member's prose they never wrote, and make "is this excerpt in my note's text"
permanently unanswerable. A captured web passage is its own semantic object.

⭐ THE CORRECTION IS THE QUESTION, NOT THE PLUMBING. `list_note_excerpts` asks
"which excerpts are embedded in this note's body?" — a real question the editor
needs, still correct, untouched. Attachability asks a DIFFERENT one: "which
research material does this note OWN that could serve as evidence?" Ownership is
`e.note_id`, which a capture has had all along.

⛔ AND EVERY CANDIDATE CARRIES ITS SOURCE KIND, so the picker can say what it is
rather than repeating Wave M's `· p.N` defect one surface later — the picker was
formatting `${documentName} · p.${pageNumber}` for every candidate, which is a
THIRD formatter over the same truth.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import web_capture as wc

# The evidence target type these candidates are attached as. Deliberately the
# EXISTING one — Wave G's `thesis_evidence.TARGET_TYPES` already accepts
# `document_excerpt`, and a captured passage IS one. Inventing a second taxonomy
# would fork the evidence model to describe a difference the stance never cares
# about.
EVIDENCE_TYPE_EXCERPT = "document_excerpt"


def _row_to_candidate(row: sqlite3.Row, attached: set[str]) -> dict[str, Any]:
    kind = row["source_kind"] or wc.SOURCE_KIND_ATTACHMENT
    is_web = kind == wc.SOURCE_KIND_WEB
    return {
        "id": row["id"],
        "evidenceType": EVIDENCE_TYPE_EXCERPT,
        # ⛔ The picker MUST NOT decide this for itself; it is a stored fact.
        "sourceKind": kind,
        "noteId": row["note_id"],
        "sourceTitle": row["document_name"],
        "sourceUrl": row["source_url"],
        # ⛔ A page number ONLY where real pagination exists. For a web capture
        # `page_number` is a capture ordinal and is not exposed at all — not as
        # a page, not as a "capture number", which is equally meaningless to a
        # member (Wave M).
        "pageNumber": None if is_web else row["page_number"],
        # Source claim and member interpretation stay two fields, all the way to
        # the picker. Concatenating them is how a member's opinion becomes a
        # publisher's quotation.
        "text": row["captured_text"],
        "annotation": row["annotation"],
        "coverage": "selected_passage" if is_web else "document_page",
        "alreadyAttached": row["id"] in attached,
    }


def list_candidates(
    user_id: str, note_id: str, *, q: str | None = None, limit: int = 50,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Evidence this note OWNS, whether or not its body references it.

    ⛔ TENANT SCOPING IS INSIDE THE QUERY, never a filter afterwards, and the
    note itself must not be trashed — a member should not be offered evidence
    out of their own bin.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        # Which candidates are already live evidence on THIS note? Computed
        # once, so the picker can show state instead of letting the member
        # discover it by being refused.
        attached = {
            r["target_id"] for r in conn.execute(
                "SELECT target_id FROM j2_thesis_evidence"
                " WHERE note_id = ? AND user_id = ? AND target_type = ?"
                " AND removed_at IS NULL",
                (note_id, user_id, EVIDENCE_TYPE_EXCERPT),
            ).fetchall()
        }

        sql = (
            "SELECT e.id, e.note_id, e.page_number, e.captured_text, e.annotation,"
            " d.name AS document_name, d.source_kind AS source_kind,"
            " d.source_url AS source_url"
            " FROM j2_note_excerpts e"
            " JOIN j2_note_documents d ON d.id = e.document_id"
            " JOIN j2_notes n ON n.id = e.note_id"
            " WHERE e.note_id = ? AND e.user_id = ? AND n.deleted_at IS NULL"
        )
        params: list[Any] = [note_id, user_id]
        if q and q.strip():
            # A plain LIKE, deliberately: the candidate set is one note's own
            # material, so this is a filter over a small list rather than a
            # search engine. Wave M's FTS surfaces stay the place to SEARCH.
            like = f"%{q.strip()}%"
            sql += " AND (e.captured_text LIKE ? OR e.annotation LIKE ? OR d.name LIKE ?)"
            params += [like, like, like]
        sql += " ORDER BY e.created_at DESC LIMIT ?"
        params.append(max(1, min(200, int(limit))))

        try:
            rows = conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError as e:
            # A database without the capture columns has no candidates, not an
            # error. Narrow on purpose — anything else re-raises rather than
            # becoming a confident empty list.
            if "no such" not in str(e).lower():
                raise
            return []
        return [_row_to_candidate(r, attached) for r in rows]
    finally:
        if owned:
            conn.close()
