"""Wave J — lexical search over saved document excerpts (captured_text +
annotation).

A THIRD, separate FTS5 table/query from both `j2_notes_fts` and
`j2_note_document_pages_fts` (Wave I's own precedent: never blend
differently-scaled/sourced result types into one arbitrary score — a caller
wanting "search everything" runs all three and sections the results
Notes / Documents / Evidence, never merges them).

Reuses `fts_match_expr` (notes_search.py) for the same injection-safe
MATCH-expression construction every other Notebook search already relies
on — one authority, not a fourth copy of that translation.
"""
from __future__ import annotations

from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.notes_search import fts_match_expr


def search_excerpts(user_id: str, q: str, *, limit: int = 20, conn=None) -> list[dict[str, Any]]:
    """Tenant-scoped excerpt search. Excludes excerpts saved into a trashed
    note (same dynamic semantics as document search: restoring the note
    brings its excerpts back into search automatically)."""
    expr = fts_match_expr(q)
    if expr is None:
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT j2_note_excerpts_fts.excerpt_id AS excerpt_id,"
            " snippet(j2_note_excerpts_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet,"
            " e.note_id AS note_id, e.document_id AS document_id, e.page_number AS page_number,"
            " e.annotation AS annotation, d.name AS document_name, n.title AS note_title"
            " FROM j2_note_excerpts_fts"
            " JOIN j2_note_excerpts e ON e.id = j2_note_excerpts_fts.excerpt_id"
            " JOIN j2_note_documents d ON d.id = e.document_id"
            " JOIN j2_notes n ON n.id = e.note_id"
            " WHERE j2_note_excerpts_fts MATCH ?"
            " AND j2_note_excerpts_fts.user_id = ?"
            " AND n.deleted_at IS NULL"
            " ORDER BY bm25(j2_note_excerpts_fts) ASC"
            " LIMIT ?",
            (expr, user_id, max(1, min(50, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        if owned:
            conn.close()
