"""Wave N §10 — trash, restore, purge, with a captured passage as evidence.

The sequence the directive names, and it is the one nobody runs: capture →
attach → trash the owning note → look at the thesis → restore → look again →
permanently delete → look again.

⛔ WHAT MUST BE TRUE, whatever the policy turns out to be:
  · no uncaught error on ANY of those reads,
  · no dangling id rendered as if it were a source,
  · no silent resurrection after a permanent delete,
  · account purge clears every trace.

⭐ AND THE POLICY IS NOT INVENTED HERE. Wave J/M already chose DYNAMIC
semantics for trashed material — `document_search`, `excerpt_search`,
`evidence_candidates` and every Ask scope join `j2_notes` and require
`deleted_at IS NULL`, so trashing the owning note removes its material from
search and from the candidate list, and restoring brings it back with no
separate un-trash step. These pin that the THESIS side agrees, because a
thesis that keeps quoting a passage its member has thrown away is the same
class of lie as a page number that does not exist.
"""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import account_purge
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import evidence_candidates as ec
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import notes_export
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-life-a"
SOURCE = "Gross margin {tok} normalizes toward the mid-70s next year."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


def _note(user: str, title: str):
    return notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


@pytest.fixture()
def split():
    """The interesting shape: the passage lives in a RESEARCH note, and the
    thesis is a DIFFERENT note. Trashing the research must not be silently
    invisible in the thesis, and trashing the thesis must not orphan the
    research."""
    auth_db.init_db()
    research = _note(A, "NVDA research")
    thesis = _note(A, "NVDA thesis")
    tok = _tok()
    res = wcs.capture_web_source(A, research["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins", "passage": SOURCE.format(tok=tok),
        "annotation": "I think management is too optimistic.",
    })
    ex_id = res["excerpt"]["id"]
    ev = te.add_evidence(A, thesis["id"], target_type="document_excerpt",
                         target_id=ex_id, stance="opposes",
                         caption="cuts against the long case")
    return {"research": research, "thesis": thesis, "tok": tok,
            "excerpt_id": ex_id, "evidence": ev}


def _thesis_evidence(note_id: str) -> list[dict]:
    return te.list_note_evidence(A, note_id)


def _export_labels(note_id: str) -> list[str]:
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        by_note = notes_export._resolve_thesis_evidence_by_note(conn, A, [note_id])
    finally:
        conn.close()
    return [r["targetLabel"] for r in by_note.get(note_id, [])]


class TestTrashingTheResearchThePassageLivesIn:
    def test_the_candidate_list_stops_offering_it(self, split):
        notes_svc.delete_note(A, split["research"]["id"])
        assert ec.list_candidates(A, split["research"]["id"]) == []

    def test_Ask_stops_retrieving_it(self, split):
        notes_svc.delete_note(A, split["research"]["id"])
        got = ar.retrieve(A, split["tok"])
        found = [i for i in got["evidence"]
                 if i["source_type"] in ("document_page", "document_excerpt")]
        assert found == [], "a trashed passage is still answering questions"

    def test_the_thesis_read_does_not_RAISE(self, split):
        # ⛔ The floor. Whatever the policy, a member opening their thesis
        # after emptying a folder must not meet a 500.
        notes_svc.delete_note(A, split["research"]["id"])
        rows = _thesis_evidence(split["thesis"]["id"])
        assert isinstance(rows, list)

    def test_the_edge_itself_SURVIVES_the_trash(self, split):
        # ⭐ THE DELIBERATE HALF. Trash is reversible, so the relationship must
        # be too — deleting the edge here would make restore a data-loss event
        # dressed up as an undo.
        notes_svc.delete_note(A, split["research"]["id"])
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["targetId"] == split["excerpt_id"]]
        assert len(rows) == 1
        assert rows[0]["stance"] == "opposes"

    def test_the_EXPORT_still_names_a_real_source_not_a_bare_id(self, split):
        # ⛔ NO DANGLING ID RENDERED AS A SOURCE. If the label resolution
        # dropped the row, the export would carry a hex string where a
        # citation belongs.
        notes_svc.delete_note(A, split["research"]["id"])
        labels = _export_labels(split["thesis"]["id"])
        assert labels, "the attached evidence vanished from the export entirely"
        for lab in labels:
            assert split["excerpt_id"] not in lab, (
                f"a raw excerpt id is being shown as a citation: {lab!r}")


class TestRestore:
    def test_everything_comes_back_with_no_separate_step(self, split):
        notes_svc.delete_note(A, split["research"]["id"])
        notes_svc.restore_note(A, split["research"]["id"])
        assert ec.list_candidates(A, split["research"]["id"])
        got = ar.retrieve(A, split["tok"])
        assert [i for i in got["evidence"]
                if i["source_type"] in ("document_page", "document_excerpt")]

    def test_the_relationship_is_the_SAME_one_not_a_new_one(self, split):
        notes_svc.delete_note(A, split["research"]["id"])
        notes_svc.restore_note(A, split["research"]["id"])
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["targetId"] == split["excerpt_id"]]
        assert len(rows) == 1
        assert rows[0]["id"] == split["evidence"]["id"], (
            "restore minted a second relationship for one passage")


class TestPermanentDelete:
    def _purge(self, note_id: str) -> None:
        # Age the trash past the retention window and run the real sweep —
        # not a hand-written DELETE, so this exercises the code that actually
        # runs at 03:20 ET.
        notes_svc.delete_note(A, note_id)
        conn = get_connection()
        try:
            conn.execute("UPDATE j2_notes SET deleted_at = '2000-01-01T00:00:00+00:00'"
                         " WHERE id = ?", (note_id,))
            conn.commit()
        finally:
            conn.close()
        assert notes_svc.purge_expired_deleted_notes() >= 1

    def test_the_underlying_passage_is_really_gone(self, split):
        self._purge(split["research"]["id"])
        conn = get_connection()
        try:
            left = conn.execute(
                "SELECT COUNT(*) FROM j2_note_excerpts WHERE id = ?",
                (split["excerpt_id"],)).fetchone()[0]
        finally:
            conn.close()
        assert left == 0, "the passage outlived the note it was captured into"

    def test_the_thesis_does_not_RESURRECT_it(self, split):
        # ⛔ NO SILENT RESURRECTION. The edge may or may not remain as a row;
        # what must never happen is the thesis presenting a source that no
        # longer exists as if it did.
        self._purge(split["research"]["id"])
        labels = _export_labels(split["thesis"]["id"])
        for lab in labels:
            assert "Reuters" not in lab, (
                f"a purged source is still being cited: {lab!r}")
            assert split["excerpt_id"] not in lab, (
                f"a raw id survived as a citation: {lab!r}")

    def test_reading_the_thesis_after_a_purge_does_not_RAISE(self, split):
        self._purge(split["research"]["id"])
        assert isinstance(_thesis_evidence(split["thesis"]["id"]), list)
        assert isinstance(_export_labels(split["thesis"]["id"]), list)

    def test_and_it_cannot_be_re_attached(self, split):
        self._purge(split["research"]["id"])
        with pytest.raises(te.ThesisEvidenceValidationError):
            te.add_evidence(A, split["thesis"]["id"],
                            target_type="document_excerpt",
                            target_id=split["excerpt_id"], stance="supports")


class TestTrashingTheThesisItself:
    def test_the_research_and_its_passage_are_untouched(self, split):
        notes_svc.delete_note(A, split["thesis"]["id"])
        cands = ec.list_candidates(A, split["research"]["id"])
        assert len(cands) == 1, "trashing a thesis took its evidence's source with it"
        assert cands[0]["id"] == split["excerpt_id"]

    def test_and_the_passage_is_free_to_serve_another_thesis(self, split):
        notes_svc.delete_note(A, split["thesis"]["id"])
        other = _note(A, "NVDA bear case")
        ev = te.add_evidence(A, other["id"], target_type="document_excerpt",
                             target_id=split["excerpt_id"], stance="supports")
        assert ev["stance"] == "supports"


class TestAccountPurge:
    def test_it_clears_the_edge_the_passage_and_the_document(self, split):
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            account_purge.purge_user_data(A, conn)
            conn.commit()
            for table, col in (("j2_thesis_evidence", "user_id"),
                               ("j2_note_excerpts", "user_id"),
                               ("j2_note_documents", "user_id"),
                               ("j2_notes", "user_id")):
                left = conn.execute(
                    f"SELECT COUNT(*) c FROM {table} WHERE {col} = ?", (A,)).fetchone()["c"]
                assert left == 0, f"{table} still holds {left} rows after an account purge"
        finally:
            conn.close()


class TestTheRowSaysWhetherItsSourceStillExists:
    """⛔⛔ §10/§20 — GHOST EVIDENCE, and why the client cannot judge it.

    The edge surviving a purge is deliberate (`db.py` where the cascade is
    written). What was missing is the row SAYING so: the thesis rendered its
    caption unchanged and a click 404'd in silence. And the client cannot work
    it out for itself — an excerpt captured into ANOTHER note is equally
    unresolvable from this note, and that one is still real.
    """

    def test_a_live_target_reports_available(self, split):
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["targetId"] == split["excerpt_id"]]
        assert rows[0]["targetAvailable"] is True

    def test_a_TRASHED_target_is_still_available_because_trash_is_reversible(self, split):
        notes_svc.delete_note(A, split["research"]["id"])
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["targetId"] == split["excerpt_id"]]
        assert rows[0]["targetAvailable"] is True, (
            "a recoverable note was reported as permanently gone")

    def test_a_PURGED_target_reports_unavailable(self, split):
        TestPermanentDelete()._purge(split["research"]["id"])
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["targetId"] == split["excerpt_id"]]
        assert len(rows) == 1, "the edge vanished — restore/history would lose it"
        assert rows[0]["targetAvailable"] is False

    def test_a_note_target_answers_too(self, split):
        # The field is not excerpt-only: a linked-note evidence row can be
        # orphaned the same way, and one answer covers every target type
        # because it comes from `_target_exists`.
        other = _note(A, "supporting note")
        ev = te.add_evidence(A, split["thesis"]["id"], target_type="note",
                             target_id=other["id"], stance="supports")
        rows = [e for e in _thesis_evidence(split["thesis"]["id"])
                if e["id"] == ev["id"]]
        assert rows[0]["targetAvailable"] is True
