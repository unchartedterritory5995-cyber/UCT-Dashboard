"""Wave O §12 — WHAT CHANGED SINCE YOUR LAST REVIEW, deterministically.

⛔⛔ FACTS ONLY. NEVER SIGNIFICANCE.

    "2 opposing evidence items added since your last review"   ← a fact
    "your thesis has weakened materially"                      ← an opinion

This module may only produce the first kind. Everything here is counted from a
timestamp that already exists because the member did something, and nothing here
scores, ranks by importance, or implies a direction. The member reads the facts
and decides what they mean — that separation is the whole product (§4/§13).

⛔ CHRONOLOGY IS THE MEMBER'S RESEARCH, NOT THE SOURCE'S (§39). "New evidence"
means the RELATIONSHIP became part of this thesis after the last review —
`j2_thesis_evidence.created_at`. It deliberately does NOT mean the underlying
article changed, was re-fetched, or was re-indexed: an old Reuters piece that
got re-crawled is not news to a member who attached it months ago.

⛔ AND REMOVED IS TWO DIFFERENT FACTS (§40):

    member removed the relationship   → they changed their mind
    the source itself was purged      → the world changed under them

Collapsing those into "evidence removed" would tell the member they did
something they did not do. Wave N's target-availability check is what separates
them, and it is reused here rather than re-derived.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import thesis_reviews as tr

SUPPORTS = "supports"
OPPOSES = "opposes"


def _evidence_between(conn: sqlite3.Connection, user_id: str, note_id: str,
                      column: str, since: str | None) -> list[sqlite3.Row]:
    """Evidence rows whose `column` timestamp is after `since`.

    ⛔ `since is None` means THERE IS NO PRIOR REVIEW, which is not the same as
    "since the beginning of time". The caller must not turn a first-ever review
    into "47 new evidence items" — see `changes_since_last_review`, which
    refuses to compute a comparison that has no anchor (§35).
    """
    if since is None:
        return []
    return conn.execute(
        f"SELECT id, target_type, target_id, stance, caption, created_at, removed_at"
        f" FROM j2_thesis_evidence"
        f" WHERE user_id = ? AND note_id = ? AND {column} IS NOT NULL"
        f"   AND {column} > ?"
        f" ORDER BY {column} ASC",
        (user_id, note_id, since),
    ).fetchall()


def _thesis_edits_since(conn: sqlite3.Connection, user_id: str, note_id: str,
                        since: str | None) -> int:
    """How many immutable version rows this thesis gained since the anchor.

    A version row is written by the canonical note-save path, so this counts
    real thesis edits without this module ever reading or diffing content.
    """
    if since is None:
        return 0
    try:
        r = conn.execute(
            "SELECT COUNT(*) c FROM j2_note_versions"
            " WHERE user_id = ? AND note_id = ? AND created_at > ?",
            (user_id, note_id, since)).fetchone()
    except sqlite3.OperationalError:
        return 0
    return int(r["c"] if isinstance(r, sqlite3.Row) else r[0])


def changes_since_last_review(user_id: str, note_id: str, *,
                              conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """The deterministic diff between the last completed review and now.

    Returns `{"hasPriorReview": False}` and nothing else when there is no
    anchor. ⛔ THE EMPTY STATE IS A DIFFERENT SENTENCE (§35): a thesis never
    reviewed has not had "no changes since last review" — it has had no review,
    and saying the former to a first-time member is a small lie that makes the
    feature look broken.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        last = tr.last_completed(user_id, note_id, conn=conn)
        if last is None or not last.get("completedAt"):
            return {"hasPriorReview": False}
        since = last["completedAt"]

        added = _evidence_between(conn, user_id, note_id, "created_at", since)
        # Something added AND removed since the anchor is not still "added".
        added_live = [r for r in added if not r["removed_at"]]
        removed = _evidence_between(conn, user_id, note_id, "removed_at", since)

        # ⛔ MEMBER-REMOVED vs SOURCE-PURGED. `removed_at` on the EDGE is the
        # member's own act. A target that no longer resolves is the source
        # having gone away underneath a relationship the member never touched.
        # Reuses the same `_target_exists` that guards attachment, so "does this
        # still exist" has one answer in the product.
        from api.services.journal_two.thesis_evidence import _target_exists
        purged = []
        for r in conn.execute(
            "SELECT id, target_type, target_id, stance FROM j2_thesis_evidence"
            " WHERE user_id = ? AND note_id = ? AND removed_at IS NULL",
            (user_id, note_id),
        ).fetchall():
            if not _target_exists(user_id, r["target_type"], r["target_id"], conn=conn):
                purged.append(r)

        def _n(rows, stance):
            return sum(1 for r in rows if r["stance"] == stance)

        return {
            "hasPriorReview": True,
            "since": since,
            "lastReviewId": last["id"],
            "lastOutcome": last["outcome"],
            "addedSupporting": _n(added_live, SUPPORTS),
            "addedOpposing": _n(added_live, OPPOSES),
            # ⛔ Two separate counts, never summed into "evidence removed".
            "removedByMember": len(removed),
            "sourcesNoLongerAvailable": len(purged),
            "thesisEdits": _thesis_edits_since(conn, user_id, note_id, since),
        }
    finally:
        if owned:
            conn.close()


def review_attention(user_id: str, note_id: str, *,
                     conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Why this thesis might deserve a look — as CAUSES, never a priority score.

    ⛔⛔ §16: if UCT marks something as needing review, the member must
    understand WHY. So this returns the reasons themselves in member-facing
    words, and there is deliberately no `priority: "high"` field for a surface
    to render instead of the explanation. An opaque badge is exactly what makes
    a review queue feel like somebody else's homework.

    ⛔ AND NEW OPPOSING EVIDENCE IS NOT "THESIS INVALID" (§13). It is
    "this may deserve attention". The wording here is the product's whole
    posture toward the member's judgement.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ch = changes_since_last_review(user_id, note_id, conn=conn)
        reasons: list[dict[str, Any]] = []
        if ch.get("addedOpposing"):
            n = ch["addedOpposing"]
            reasons.append({
                "code": "new_opposing_evidence", "count": n,
                "text": f"{n} opposing evidence item{'s' if n != 1 else ''} "
                        f"added since your last review"})
        if ch.get("addedSupporting"):
            n = ch["addedSupporting"]
            reasons.append({
                "code": "new_supporting_evidence", "count": n,
                "text": f"{n} supporting evidence item{'s' if n != 1 else ''} "
                        f"added since your last review"})
        if ch.get("sourcesNoLongerAvailable"):
            n = ch["sourcesNoLongerAvailable"]
            reasons.append({
                "code": "sources_unavailable", "count": n,
                "text": f"{n} evidence source{'s' if n != 1 else ''} "
                        f"no longer available"})
        if ch.get("thesisEdits"):
            n = ch["thesisEdits"]
            reasons.append({
                "code": "thesis_edited", "count": n,
                "text": f"the thesis was edited {n} time{'s' if n != 1 else ''} "
                        f"since your last review"})
        if not ch.get("hasPriorReview"):
            reasons.append({
                "code": "never_reviewed", "count": 0,
                "text": "no completed review yet"})
        return {"noteId": note_id, "reasons": reasons, "changes": ch}
    finally:
        if owned:
            conn.close()
