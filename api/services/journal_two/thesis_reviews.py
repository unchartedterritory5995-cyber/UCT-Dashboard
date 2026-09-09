"""Wave O — the finance-native review loop.

A REVIEW is the record that, at a point in time, the member deliberately
reconsidered a thesis and said what they concluded. It is not a task, not a
reminder, and not another copy of the thesis.

⛔⛔ WHY IT NEEDS ITS OWN STORAGE. Wave G's thesis changelog is a COMPUTED READ
with no write path — every event it shows traces back to a row some other
system already had to write. Deciding that a thesis STILL HOLDS writes nothing
anywhere, so it is the one fact in this domain that cannot be derived. That is
also why §22's "do not merge the two histories" is structural rather than a
discipline: the changelog cannot absorb a review, because it only surfaces what
it can derive. They answer different questions —

    changelog : WHAT changed in the thesis.
    review    : WHEN and WHY the member reconsidered it, and what they decided.

⛔⛔ FIVE SEMANTIC FACTS, NEVER COLLAPSED (§3):

    source claim      "Gross margin normalizes toward the mid-70s."
    member annotation "I think management is too optimistic."
    evidence stance   OPPOSING
    UCT review signal "new opposing evidence since last review"
    member decision   "thesis unchanged"

This module owns exactly ONE of them — the last. It reads the others and never
writes them.

⛔⛔ COMPLETING A REVIEW NEVER MUTATES THE THESIS (§4/§9). There is no code path
here that writes a note, a property or a version. `complete()` records what the
member decided; if that decision was to change the thesis, the member changes it
through the canonical Wave G/E path and this records the version it landed on.
An outcome of `revised` with no thesis change is a member who said one thing and
did another — that is their business, and this refuses to invent the edit for
them.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

STATUS_DRAFT = "draft"
STATUS_COMPLETED = "completed"

# ⛔ A DELIBERATELY SMALL VOCABULARY (§7). No conviction percentages, no
# strength scores — evidence quality and independence differ, and a number
# derived from counting rows would read as a measurement while being an
# opinion nobody formed. These four are the decisions a member actually makes.
OUTCOME_NO_CHANGE = "no_change"
OUTCOME_REVISED = "revised"
OUTCOME_INVALIDATED = "invalidated"
OUTCOME_DEFERRED = "deferred"
OUTCOMES = (OUTCOME_NO_CHANGE, OUTCOME_REVISED, OUTCOME_INVALIDATED,
            OUTCOME_DEFERRED)

#: Why a review happened. Recorded so the history can answer "what prompted
#: this", and so a queue entry can explain itself (§16).
REASON_SCHEDULED = "scheduled"      # its review date came due
REASON_MANUAL = "manual"            # the member opened one themselves
REASONS = (REASON_SCHEDULED, REASON_MANUAL)


class ThesisReviewError(ValueError):
    """A review operation that must not be performed, stated rather than
    silently absorbed."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "noteId": r["note_id"],
        "status": r["status"],
        "reviewReason": r["review_reason"],
        "outcome": r["outcome"],
        # ⛔ NAMED `memberNote`, NOT `note`/`summary`. This is the member's own
        # writing and every downstream surface has to keep it distinguishable
        # from a source claim (§26). A neutral name is how that distinction
        # gets lost three consumers later.
        "memberNote": r["member_note"],
        "priorVersionId": r["prior_version_id"],
        "resultingVersionId": r["resulting_version_id"],
        "nextReviewAt": r["next_review_at"],
        "createdAt": r["created_at"],
        "completedAt": r["completed_at"],
    }


def _owned_thesis(conn: sqlite3.Connection, user_id: str, note_id: str) -> dict[str, Any]:
    """⛔ TENANT SCOPING BEFORE ANYTHING ELSE, and non-confirming (§57). A note
    another member owns is indistinguishable here from one that does not exist,
    so nothing in this module can become an existence oracle."""
    from api.services.journal_two.notes import get_note
    note = get_note(user_id, note_id, conn=conn)
    if note is None:
        raise ThesisReviewError("Thesis not found")
    return note


def _latest_version_id(conn: sqlite3.Connection, user_id: str,
                       note_id: str) -> str | None:
    """The immutable version row that represents what the thesis says now.

    ⛔ A REFERENCE, NEVER A COPY (§24). `j2_note_versions` rows are immutable
    and carry ids, so pointing at one preserves "what did it say then" without
    freezing text here — and without duplicating any external source content.
    """
    try:
        r = conn.execute(
            "SELECT id FROM j2_note_versions WHERE user_id = ? AND note_id = ?"
            " ORDER BY created_at DESC LIMIT 1", (user_id, note_id)).fetchone()
    except sqlite3.OperationalError:
        return None
    return r["id"] if r else None


# ── Opening a review ─────────────────────────────────────────────────────────

def open_review(user_id: str, note_id: str, *, reason: str = REASON_MANUAL,
                conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Start (or resume) the ONE open draft for this thesis.

    ⛔ IDEMPOTENT BY CONSTRUCTION (§38). Opening a review is something a surface
    does on render, so this must not mint an obligation every time. An existing
    draft is RETURNED, not duplicated — and the database enforces that with a
    partial unique index rather than trusting this function to remember.
    """
    if reason not in REASONS:
        raise ThesisReviewError(f"Unknown review reason: {reason!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        _owned_thesis(conn, user_id, note_id)
        existing = conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE user_id = ? AND note_id = ?"
            " AND status = ?", (user_id, note_id, STATUS_DRAFT)).fetchone()
        if existing is not None:
            return _row(existing)
        rid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO j2_thesis_reviews"
            " (id, user_id, note_id, status, review_reason, created_at,"
            "  prior_version_id)"
            " VALUES (?,?,?,?,?,?,?)",
            (rid, user_id, note_id, STATUS_DRAFT, reason, _now(),
             _latest_version_id(conn, user_id, note_id)))
        conn.commit()
        return _row(conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE id = ?", (rid,)).fetchone())
    finally:
        if owned:
            conn.close()


def save_draft(user_id: str, review_id: str, *, member_note: str | None = None,
               outcome: str | None = None, next_review_at: str | None = None,
               conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Update a DRAFT in place — the member's work in progress.

    ⛔ A DRAFT IS NOT A COMPLETED REVIEW (§34). This never sets `completed_at`,
    so an autosave can never turn into a historical decision the member did not
    make. `complete()` is the only door.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        r = conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE id = ? AND user_id = ?",
            (review_id, user_id)).fetchone()
        if r is None:
            raise ThesisReviewError("Review not found")
        if r["status"] != STATUS_DRAFT:
            # ⛔ §8: a completed review is historical evidence of what the
            # member decided then. Editing it would rewrite the past.
            raise ThesisReviewError("A completed review cannot be edited")
        if outcome is not None and outcome not in OUTCOMES:
            raise ThesisReviewError(f"Unknown outcome: {outcome!r}")
        sets, params = [], []
        if member_note is not None:
            sets.append("member_note = ?"); params.append(member_note)
        if outcome is not None:
            sets.append("outcome = ?"); params.append(outcome)
        if next_review_at is not None:
            sets.append("next_review_at = ?")
            params.append(next_review_at or None)
        if sets:
            params += [review_id, user_id]
            conn.execute(
                f"UPDATE j2_thesis_reviews SET {', '.join(sets)}"
                " WHERE id = ? AND user_id = ?", params)
            conn.commit()
        return _row(conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE id = ?", (review_id,)).fetchone())
    finally:
        if owned:
            conn.close()


def complete(user_id: str, review_id: str, *, outcome: str,
             member_note: str | None = None, next_review_at: str | None = None,
             conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Record that the member reconsidered this thesis and what they concluded.

    ⛔⛔ THIS DOES NOT TOUCH THE THESIS. No property write, no version write, no
    status change — not even for `invalidated`. If the member decided the thesis
    changes, they change it through the canonical Wave G/E path and this records
    the version it landed on. A review that could silently set
    `builtin:thesis_status` would make UCT the author of an investment judgement
    (§4), and it would do it inside a form whose visible subject is a note field.

    ⭐ THE OCCURRENCE AND THE MUTATION ARE SEPARATE FACTS (§53). A review whose
    outcome is `no_change` still records that the member looked — which is the
    entire point of a review loop, and the thing a task app cannot represent.
    """
    if outcome not in OUTCOMES:
        raise ThesisReviewError(f"Unknown outcome: {outcome!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        r = conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE id = ? AND user_id = ?",
            (review_id, user_id)).fetchone()
        if r is None:
            raise ThesisReviewError("Review not found")
        if r["status"] == STATUS_COMPLETED:
            raise ThesisReviewError("This review is already completed")
        note_id = r["note_id"]
        # The version the thesis is ON at completion. If the member revised it
        # during the review this differs from `prior_version_id`, and that
        # difference is the honest record of whether anything actually changed
        # — derived, never asserted by the form.
        resulting = _latest_version_id(conn, user_id, note_id)
        conn.execute(
            "UPDATE j2_thesis_reviews SET status = ?, outcome = ?,"
            " member_note = COALESCE(?, member_note),"
            " next_review_at = COALESCE(?, next_review_at),"
            " resulting_version_id = ?, completed_at = ?"
            " WHERE id = ? AND user_id = ?",
            (STATUS_COMPLETED, outcome, member_note, next_review_at, resulting,
             _now(), review_id, user_id))
        conn.commit()
        return _row(conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE id = ?", (review_id,)).fetchone())
    finally:
        if owned:
            conn.close()


# ── Reading ──────────────────────────────────────────────────────────────────

def list_reviews(user_id: str, note_id: str, *, include_draft: bool = True,
                 limit: int = 50,
                 conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """This thesis's review history, newest first."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        sql = ("SELECT * FROM j2_thesis_reviews WHERE user_id = ? AND note_id = ?")
        params: list[Any] = [user_id, note_id]
        if not include_draft:
            sql += " AND status = ?"
            params.append(STATUS_COMPLETED)
        sql += " ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ?"
        params.append(max(1, min(200, int(limit))))
        return [_row(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        if owned:
            conn.close()


def last_completed(user_id: str, note_id: str,
                   conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """The most recent COMPLETED review — the anchor every "since last review"
    comparison is measured from."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        r = conn.execute(
            "SELECT * FROM j2_thesis_reviews WHERE user_id = ? AND note_id = ?"
            " AND status = ? ORDER BY completed_at DESC LIMIT 1",
            (user_id, note_id, STATUS_COMPLETED)).fetchone()
        return _row(r) if r else None
    finally:
        if owned:
            conn.close()
