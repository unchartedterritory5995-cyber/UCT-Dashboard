"""Wave O §27/§46/§56 — the consumer audit's two hard requirements.

⛔⛔ THE PERMANENT DOCTRINE, AND IT HAS FOUND A DEFECT EVERY WAVE: when a new
content type becomes eligible for an existing domain, every downstream consumer
that interprets it must be checked. Wave O adds a REVIEW. These cover the two
consumers with explicit contractual requirements — export (§46) and lifecycle
(§56) — and the tenant control (§57).

⛔ EXPORT IS THE ONE ARTEFACT THAT LEAVES UCT. A review is the most
irreplaceable thing the Notebook holds: unlike a note or a capture it exists
nowhere else and cannot be reconstructed from anything. Losing it on the way out
would be losing years of decision history.
"""
from __future__ import annotations

import sqlite3
import uuid
import zipfile

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import notes_export
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import thesis_review_changes as trc
from api.services.journal_two import thesis_reviews as tr
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-revlife-a"
B = "u-revlife-b"


def _thesis(user: str = A, title: str = "NVDA thesis"):
    return notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


def _reviewed(user: str, note_id: str, *, outcome=tr.OUTCOME_NO_CHANGE,
              member_note="Margins still track my model.", next_at=None):
    r = tr.open_review(user, note_id)
    return tr.complete(user, r["id"], outcome=outcome, member_note=member_note,
                       next_review_at=next_at)


def _front_matter(user: str, note_id: str) -> str:
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
        return notes_export._front_matter(row, extra={
            "thesis_reviews": notes_export._resolve_reviews_by_note(
                conn, user, [note_id]).get(note_id, []),
        })
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def _db():
    auth_db.init_db()


class TestExport:
    def test_a_completed_review_travels(self):
        n = _thesis()
        _reviewed(A, n["id"], next_at="2026-06-01")
        fm = _front_matter(A, n["id"])
        assert "thesis_reviews:" in fm
        assert "outcome: no_change" in fm
        assert "Margins still track my model." in fm
        assert "next_review: 2026-06-01" in fm

    def test_the_member_note_is_labelled_as_THEIRS(self):
        # ⛔ §26. In an export that anything may read, a neutral key would make
        # the member's own words indistinguishable from a source's.
        n = _thesis()
        _reviewed(A, n["id"])
        assert "member_note:" in _front_matter(A, n["id"])

    def test_a_DRAFT_never_appears_in_the_export(self):
        # ⛔ A draft is work in progress, not a decision. Exporting one puts
        # words in the member's mouth in the artefact they keep forever.
        n = _thesis()
        r = tr.open_review(A, n["id"])
        tr.save_draft(A, r["id"], member_note="half a thought I never finished")
        fm = _front_matter(A, n["id"])
        assert "half a thought" not in fm
        assert "thesis_reviews:" not in fm

    def test_it_references_thesis_versions_rather_than_inlining_them(self):
        n = _thesis()
        notes_svc.update_note(A, n["id"], {"title": "NVDA thesis v2"})
        _reviewed(A, n["id"])
        fm = _front_matter(A, n["id"])
        assert "thesis_version_before:" in fm or "thesis_version_after:" in fm

    def test_it_copies_no_source_text(self):
        # ⛔ §24/§46 — never freeze third-party article content into an export.
        n = _thesis()
        tok = "zq" + uuid.uuid4().hex[:8]
        res = wcs.capture_web_source(A, n["id"], {
            "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/x",
            "title": "Reuters: NVDA margins",
            "passage": f"Gross margin {tok} normalizes toward the mid-70s.",
            "annotation": "mine"})
        te.add_evidence(A, n["id"], target_type="document_excerpt",
                        target_id=res["excerpt"]["id"], stance="opposes")
        _reviewed(A, n["id"])
        fm = _front_matter(A, n["id"])
        assert tok not in fm, "the review export inlined a publisher's passage"

    def test_multiple_reviews_export_in_chronological_order(self):
        n = _thesis()
        _reviewed(A, n["id"], member_note="first look")
        _reviewed(A, n["id"], outcome=tr.OUTCOME_INVALIDATED,
                  member_note="second look")
        fm = _front_matter(A, n["id"])
        assert fm.index("first look") < fm.index("second look")

    def test_another_members_reviews_are_never_resolved(self):
        n = _thesis()
        _reviewed(A, n["id"], member_note="A's private reasoning")
        assert _front_matter(B, n["id"]).count("A's private reasoning") == 0

    def test_the_real_single_note_export_carries_it(self):
        # ⭐ THE END-TO-END FORM. The resolver returning rows proves nothing if
        # the archive writer drops them.
        n = _thesis(title="NVDA zip thesis")
        _reviewed(A, n["id"], member_note="it goes in the zip")
        built = notes_export.build_single_note_export(A, n["id"])
        assert built is not None, "the single-note export produced nothing"
        content, filename, _media = built
        text = content.decode("utf-8", "replace")
        if filename.endswith(".zip"):
            import io as _io
            with zipfile.ZipFile(_io.BytesIO(content)) as z:
                md = next(x for x in z.namelist() if x.endswith(".md"))
                text = z.read(md).decode("utf-8")
        assert "it goes in the zip" in text
        assert "thesis_reviews:" in text


class TestLifecycle:
    def test_trashing_the_thesis_keeps_its_reviews_recoverable(self):
        # Trash is reversible, so the decision history must survive it —
        # deleting here would make restore a data-loss event dressed as an undo.
        n = _thesis()
        _reviewed(A, n["id"], member_note="before the trash")
        notes_svc.delete_note(A, n["id"])
        notes_svc.restore_note(A, n["id"])
        assert tr.last_completed(A, n["id"])["memberNote"] == "before the trash"

    def test_purging_the_thesis_removes_its_reviews(self):
        # ⛔ No orphaned review rows pointing at a note that no longer exists.
        n = _thesis()
        _reviewed(A, n["id"])
        notes_svc.delete_note(A, n["id"])
        conn = get_connection()
        try:
            conn.execute("UPDATE j2_notes SET deleted_at = '2000-01-01T00:00:00+00:00'"
                         " WHERE id = ?", (n["id"],))
            conn.commit()
        finally:
            conn.close()
        assert notes_svc.purge_expired_deleted_notes() >= 1
        conn = get_connection()
        try:
            left = conn.execute(
                "SELECT COUNT(*) FROM j2_thesis_reviews WHERE note_id = ?",
                (n["id"],)).fetchone()[0]
        finally:
            conn.close()
        assert left == 0

    def test_a_review_survives_its_evidence_being_purged(self):
        # ⛔ §56: the history stays truthful. The review said what the member
        # decided; the source going away later does not un-decide it.
        n = _thesis()
        tok = "zq" + uuid.uuid4().hex[:8]
        res = wcs.capture_web_source(A, n["id"], {
            "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/y",
            "title": "Reuters: NVDA margins",
            "passage": f"Gross margin {tok} normalizes.", "annotation": "mine"})
        ex = res["excerpt"]["id"]
        te.add_evidence(A, n["id"], target_type="document_excerpt",
                        target_id=ex, stance="opposes")
        _reviewed(A, n["id"], member_note="decided while that source existed")
        conn = get_connection()
        try:
            conn.execute("DELETE FROM j2_note_excerpts WHERE id = ?", (ex,))
            conn.commit()
        finally:
            conn.close()
        assert tr.last_completed(A, n["id"])["memberNote"] == \
            "decided while that source existed"
        # And the change block reports it as unavailable rather than crashing
        # or silently resurrecting it.
        ch = trc.changes_since_last_review(A, n["id"])
        assert ch["hasPriorReview"] is True
        assert ch["sourcesNoLongerAvailable"] == 1

    def test_reading_a_review_after_a_purge_never_raises(self):
        n = _thesis()
        _reviewed(A, n["id"])
        conn = get_connection()
        try:
            conn.execute("DELETE FROM j2_note_excerpts WHERE note_id = ?", (n["id"],))
            conn.commit()
        finally:
            conn.close()
        assert isinstance(tr.list_reviews(A, n["id"]), list)
        assert isinstance(trc.review_attention(A, n["id"])["reasons"], list)
