"""Wave I — lexical search over extracted PDF page text.

Deliberately a SEPARATE FTS5 table/query from `j2_notes_fts`
(`notes_search.py`), per the governing directive's own explicit instruction:
never join extracted document text into the notes index in a way that
destroys source identity, and never blend two differently-scaled/sourced
result types into one arbitrary score. A caller wanting "search everything"
runs both and sections the results (Notes / Documents), never merges them.

Reuses `fts_match_expr` (notes_search.py) for the exact same
injection-safe MATCH-expression construction notes search already relies
on — one authority, not a second copy of that translation.
"""
from __future__ import annotations

from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.notes_search import fts_match_expr
from api.services.journal_two.web_capture import capture_columns


def search_document_pages(
    user_id: str, q: str, *, limit: int = 20, conn=None,
) -> list[dict[str, Any]]:
    """Tenant-scoped page-level search. Excludes documents belonging to a
    trashed note (checkpoint decision: same dynamic semantics as every
    other Notebook surface — restoring the note brings its documents back
    into search automatically, no separate un-trash step for them)."""
    expr = fts_match_expr(q)
    if expr is None:
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT j2_note_document_pages_fts.document_id AS document_id,"
            " j2_note_document_pages_fts.page_number AS page_number,"
            " snippet(j2_note_document_pages_fts, 3, '<mark>', '</mark>', '…', 12) AS snippet,"
            " d.note_id AS note_id, d.name AS name, d.attachment_url AS attachment_url"
            # ⛔ WAVE M: THE RESULT MUST SAY WHAT IT IS. `page_number` on a
            # captured web source is a CAPTURE ORDINAL, not a page: a second
            # passage clipped from one article becomes "2", and the sidebar was
            # rendering that as "· p.2" — a page of a document that has no
            # pages, implying a completeness the member never captured.
            # `source_kind` already distinguishes them at write time; it simply
            # was never selected, so the surface could not tell the truth.
            f"{capture_columns(conn)}"
            ", n.title AS note_title"
            # ⛔ WAVE P2 §21: PROVENANCE COMES FROM THE CANONICAL PAGE, NOT THE
            # INDEX. The member needs to know a hit was READ FROM A SCANNED
            # PAGE, because exact values there deserve a look at the original.
            # `text_origin` deliberately is NOT added to the FTS mirror: that
            # table is written by triggers under a storage contract this wave
            # may not touch, and a new column there would mean a migration plus
            # a full reindex to answer a question the canonical row already
            # holds. LEFT JOIN on the page's PRIMARY KEY, so it can add a fact
            # but never a row.
            ", p.text_origin AS text_origin"
            " FROM j2_note_document_pages_fts"
            " JOIN j2_note_documents d ON d.id = j2_note_document_pages_fts.document_id"
            " JOIN j2_notes n ON n.id = d.note_id"
            " LEFT JOIN j2_note_document_pages p"
            "        ON p.document_id = j2_note_document_pages_fts.document_id"
            "       AND p.page_number = j2_note_document_pages_fts.page_number"
            " WHERE j2_note_document_pages_fts MATCH ?"
            " AND j2_note_document_pages_fts.user_id = ?"
            " AND n.deleted_at IS NULL"
            " ORDER BY bm25(j2_note_document_pages_fts) ASC"
            " LIMIT ?",
            (expr, user_id, max(1, min(50, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        if owned:
            conn.close()
