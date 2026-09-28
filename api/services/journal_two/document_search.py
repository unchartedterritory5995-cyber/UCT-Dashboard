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


#: Wave 10 (lane 10A, clause 14b): how many ranked pages the first read takes per page
#: the caller asked for. The slack is room for pages whose note is in the Trash, which the
#: ranked read cannot see (it touches the FTS table alone); a window that loses more than
#: this to the Trash falls back to the exact one-pass read below.
_RANK_WINDOW = 2

_FTS = "j2_note_document_pages_fts"

#: Phase 1: this member's matching pages in rank order, from the FTS table ALONE. The
#: tie-break by rowid makes the order total: with no statistics every page of a templated
#: document can score the same, and "which 20 of the tied pages" must not depend on how a
#: sorter happens to break ties in one plan but not another.
_RANKED_SQL = (
    f"SELECT rowid FROM {_FTS}"
    f" WHERE {_FTS} MATCH ? AND user_id = ?"
    f" ORDER BY bm25({_FTS}) ASC, rowid ASC"
    " LIMIT ?"
)


def _projection(conn) -> str:
    """The ONE select list both reads return, so the fast read and the exact read cannot
    drift apart in what a hit carries."""
    return (
        f"SELECT {_FTS}.rowid AS _rank_rowid,"
        f" {_FTS}.document_id AS document_id,"
        f" {_FTS}.page_number AS page_number,"
        f" snippet({_FTS}, 3, '<mark>', '</mark>', '…', 12) AS snippet,"
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
        f" FROM {_FTS}"
        f" JOIN j2_note_documents d ON d.id = {_FTS}.document_id"
        " JOIN j2_notes n ON n.id = d.note_id"
        " LEFT JOIN j2_note_document_pages p"
        f"        ON p.document_id = {_FTS}.document_id"
        f"       AND p.page_number = {_FTS}.page_number"
    )


def _hits(rows) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        d = dict(r)
        d.pop("_rank_rowid", None)
        out.append(d)
    return out


def search_document_pages(
    user_id: str, q: str, *, limit: int = 20, conn=None,
) -> list[dict[str, Any]]:
    """Tenant-scoped page-level search. Excludes documents belonging to a
    trashed note (checkpoint decision: same dynamic semantics as every
    other Notebook surface — restoring the note brings its documents back
    into search automatically, no separate un-trash step for them).

    ⭐ Wave 10 (lane 10A, clause 14b): TWO reads, not one. The one-pass read joined the
    document, the note and the page, and built a snippet, for EVERY matching page before
    its sort could keep twenty: a common term over 10,000 documents (9,075 matching pages)
    walked 9,075 note rows (a note's `deleted_at` sits past its body, on an overflow page)
    and tokenised 9,075 snippets to return twenty. Now the rank is read from the FTS table
    alone (`_RANKED_SQL`), and only the ranked rowids are joined and snippeted: 134 -> 47 ms
    p50 on that library, same process (docs/notebook/perf-budgets.md §7). The answer is the
    one-pass read's (`_one_pass`): the same filter, the same order, the same projection
    (`_projection`). When the Trash takes more of the ranked window than its slack, the
    exact one-pass read answers instead (railed: tests/test_journal_two_notes_read_plans.py)."""
    expr = fts_match_expr(q)
    if expr is None:
        return []
    lim = max(1, min(50, int(limit)))
    owned = conn is None
    conn = conn or get_connection()
    try:
        window = lim * _RANK_WINDOW
        ranked = [r[0] for r in conn.execute(_RANKED_SQL, (expr, user_id, window)).fetchall()]
        if not ranked:
            return []
        marks = ",".join("?" * len(ranked))
        # ⛔ `+rowid`, not `rowid`: a bare `rowid IN (...)` is pushed into the FTS scan as a
        # per-rowid seek (`INDEX 0:=M…`), 9.8 ms against 2.2 ms for the MATCH-only scan that
        # filters its rows (10,000 documents; the same finding as `_snippets_for`, §5).
        rows = conn.execute(
            _projection(conn)
            + f" WHERE {_FTS} MATCH ? AND +{_FTS}.rowid IN ({marks})"
            " AND n.deleted_at IS NULL",
            (expr, *ranked),
        ).fetchall()
        by_rowid = {r["_rank_rowid"]: r for r in rows}
        kept = [by_rowid[rid] for rid in ranked if rid in by_rowid]
        if len(kept) >= lim or len(ranked) < window:
            # Either the window held enough live pages, or it held EVERY match there is.
            return _hits(kept[:lim])
        # The Trash took more of the window than its slack: the exact one-pass read.
        return _one_pass(conn, expr, user_id, lim)
    finally:
        if owned:
            conn.close()


def _one_pass(conn, expr: str, user_id: str, lim: int) -> list[dict[str, Any]]:
    """The exact read: every matching live page joined, snippeted and sorted, in one
    statement. It is the definition the two-read path must reproduce, the fallback when
    the Trash crowds the ranked window, and the reference the differential rail compares
    against (tests/test_journal_two_notes_read_plans.py)."""
    rows = conn.execute(
        _projection(conn)
        + f" WHERE {_FTS} MATCH ?"
        f" AND {_FTS}.user_id = ?"
        " AND n.deleted_at IS NULL"
        f" ORDER BY bm25({_FTS}) ASC, {_FTS}.rowid ASC"
        " LIMIT ?",
        (expr, user_id, lim),
    ).fetchall()
    return _hits(rows)
