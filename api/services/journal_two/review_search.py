"""Wave O6 - lexical search over the member's COMPLETED thesis reviews.

⚰️ THE DEFECT THIS CLOSES. Wave O gave the member a place to record what they
decided about a thesis and why. Nothing could find it again. A member who
wrote "I was wrong about the datacenter build-out slowing" in a review and
searched for "datacenter" three months later got notes, document pages and
saved excerpts -- everything except their own conclusion. A judgement you
cannot retrieve is a judgement you did not keep.

⛔⛔ A FOURTH SECTION, NOT A FOURTH SCORE. Notes, document pages and saved
excerpts are already three separate FTS tables answered by three separate
queries and rendered as three separate lists, precisely because a page a word
happens to appear on and a passage the member deliberately kept are not
comparable hits. A review is a fourth kind again -- the member's own
conclusion, written after the fact -- and it gets its own section for the same
reason. Nothing here is ever merged into another list's ranking.

⛔ NO NEW FTS TABLE, AND THAT IS A MEASUREMENT NOT A SHORTCUT. FTS5 earns its
keep on corpora where a scan is untenable: a migrated library is tens of
thousands of notes, a filing is thousands of pages. A member's completed
reviews are a few dozen rows at the top of the range -- the O6 perf harness
measures this query against a seeded corpus. Adding a fifth FTS table plus its
sync triggers to scan what SQLite scans in well under a millisecond buys a
second copy of the member's words that can drift out of date.

⛔ AND NOTHING HERE WRITES REVIEW PROSE ANYWHERE ELSE (§2). The review stays
the only copy of itself. Search reaches it where it lives.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.notes_search import fts_match_expr

# A query's words past this point stop narrowing and start costing; the same
# cap the Ask side applies, for the same reason.
MAX_TERMS = 6
# Characters of context around the first hit. Long enough to carry a sentence,
# short enough that a sidebar row stays a row.
SNIPPET_WINDOW = 90


def match_terms(q: str) -> list[str]:
    """The words a review must contain to be a hit.

    Tokenised through `fts_match_expr` -- the SAME translation every other
    Notebook search already goes through -- so "$NVDA" and quoted phrases split
    here exactly as they do for notes. Reviews are not in FTS, so the
    expression is used for its tokenisation only and its operators are stripped.
    """
    expr = fts_match_expr(q)
    if not expr:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in expr.replace(" OR ", " ").replace(" AND ", " ").split():
        word = raw.strip().strip('"').rstrip("*").strip('"').strip()
        if word and word.lower() not in seen:
            seen.add(word.lower())
            out.append(word)
    return out[:MAX_TERMS]


def member_note_clause(terms: list[str]) -> tuple[str, list[Any]]:
    """⛔ THE ONE DEFINITION OF "THIS REVIEW MATCHES" (the SQL half).

    Term-AND over the member's own words, which is how every other Notebook
    search behaves. Ask and Search extract their terms differently on purpose
    -- a typed query has no stopwords to strip, a question is mostly stopwords
    -- but they must never disagree about what matching MEANS, so the clause
    itself has a single owner.

    The column is named unqualified so a caller may alias its table however it
    likes; both callers select from a shape where `member_note` is unambiguous.
    """
    sql = ""
    params: list[Any] = []
    for term in terms[:MAX_TERMS]:
        sql += " AND lower(member_note) LIKE ?"
        params.append(f"%{term.lower()}%")
    return sql, params


def is_missing_review_table(exc: sqlite3.OperationalError) -> bool:
    """"That table does not exist" rather than a real failure.

    ⛔ NARROW ON PURPOSE, for the same reason `_no_capture_tables` is: several
    suites build a minimal schema of exactly the tables they exercise, and
    "there are no reviews" is the correct answer there -- not a 500. But
    swallowing every OperationalError would turn a corruption or a locked
    database into a confident "you never reviewed this", which is the failure
    `lesson_a_swallowed_error_becomes_a_confident_finding` names.
    """
    msg = str(exc).lower()
    return msg.startswith("no such table") and "j2_thesis_reviews" in msg


def _snippet(text: str, terms: list[str]) -> str:
    """A window around the first hit, with every hit in it marked.

    Emits the same literal `<mark>`/`</mark>` delimiters SQLite's own
    `snippet()` does, because the client renders all four search sections
    through one split-and-render helper. Nothing is HTML-escaped here and
    nothing should be: that helper renders every non-delimiter chunk as a plain
    string child, which React escapes itself.
    """
    body = " ".join((text or "").split())
    if not body:
        return ""
    lowered = body.lower()
    hits = [i for i in (lowered.find(t.lower()) for t in terms) if i >= 0]
    if not hits:
        # Reachable when a term matched a column this snippet does not read.
        # Showing the opening of the review is honest; inventing a highlight is
        # not.
        cut = SNIPPET_WINDOW * 2
        return body[:cut] + ("…" if len(body) > cut else "")
    start = max(0, min(hits) - SNIPPET_WINDOW // 2)
    end = min(len(body), start + SNIPPET_WINDOW * 2)
    window = body[start:end]
    # Longest first, so "datacenter" is not marked as "data" + "center".
    pattern = "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True))
    window = re.sub(f"({pattern})", r"<mark>\1</mark>", window, flags=re.IGNORECASE)
    return ("…" if start > 0 else "") + window + ("…" if end < len(body) else "")


def search_reviews(user_id: str, q: str, *, limit: int = 20,
                   conn=None) -> list[dict[str, Any]]:
    """Tenant-scoped search over completed reviews.

    ⛔ COMPLETED ONLY. A draft is the member mid-thought; surfacing one as a
    finding would show them a conclusion they have not reached.

    ⛔ TENANCY IS ASSERTED TWICE -- on the review and on the note it belongs to.
    They are the same fact today, and a join is exactly where that stops being
    true quietly.

    ⛔ A REVIEW OF A TRASHED THESIS DOES NOT APPEAR, and comes back when the
    note is restored -- the same dynamic semantics document and excerpt search
    already have, rather than a second deletion model.
    """
    terms = match_terms(q)
    if not terms:
        return []
    clause, clause_params = member_note_clause(terms)
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT r.id AS review_id, r.note_id AS note_id,"
            " r.member_note AS member_note, r.outcome AS outcome,"
            " r.completed_at AS completed_at, r.review_reason AS review_reason,"
            " n.title AS note_title, n.ticker AS ticker"
            " FROM j2_thesis_reviews r"
            " JOIN j2_notes n ON n.id = r.note_id"
            " WHERE r.user_id = ? AND n.user_id = ?"
            " AND r.status = 'completed' AND n.deleted_at IS NULL"
            f"{clause}"
            # ⛔ NEWEST FIRST, TIE-BROKEN BY id. There is no relevance score to
            # sort by here, and inventing one (term counts, note length) would
            # rank the member's own conclusions by a number they never agreed
            # to. Recency is the honest order for a decision log, and `id`
            # makes it deterministic when two reviews share a second.
            " ORDER BY r.completed_at DESC, r.id DESC LIMIT ?",
            (user_id, user_id, *clause_params, max(1, min(50, int(limit)))),
        ).fetchall()
    except sqlite3.OperationalError as e:
        if not is_missing_review_table(e):
            raise
        return []
    finally:
        if owned:
            conn.close()
    return [{**dict(r), "snippet": _snippet(r["member_note"], terms)} for r in rows]
