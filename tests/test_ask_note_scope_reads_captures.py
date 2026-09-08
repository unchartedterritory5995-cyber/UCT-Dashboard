"""Ask Current Note must see what was CAPTURED into that note.

⚰️ THE DEFECT, found by the Slice 5 integrated E2E on 2026-09-08 and invisible
to every existing rail. `retrieve_note` read the note's `body_json` blocks and
nothing else, which was complete when a note's only content WAS its body. Wave L
made a capture land in a note as a document page plus an excerpt — so a note
whose content was three captured passages answered:

    "This note doesn't have any text yet."

The material was stored, FTS-indexed, and reachable from the NOTEBOOK scope (it
reported "6 document pages, 6 saved excerpts" searched). It was unreachable from
the one scope a member gets to by asking about the note in front of them.

⛔ THE SECOND VERSION OF THE SAME BUG is what these tests really pin. The first
fix retrieved the captured items and the answer STILL said "I couldn't find that
in this note" — because an evidence item with no `relevance` never becomes
answer evidence. Retrieval and relevance are two steps and both have to happen.
"""
from __future__ import annotations

import pytest

from api.services.journal_two import ask_retrieval as ar
from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import web_capture_store as wcs
from api.services.journal_two import web_capture as wc


USER = "u-ask-capture"
SOURCE = "Gross margin normalizes toward the mid-70s next year."
MINE = "I think that is optimistic given HBM pricing."


@pytest.fixture()
def note_with_capture():
    auth_db.init_db()
    note = notes_svc.create_note(USER, {
        "title": "NVDA thesis", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    # ⭐ The REAL capture entry point, not hand-written rows — so this breaks if
    # the write path stops producing the shape Ask reads.
    wcs.capture_web_source(USER, note["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://example.com/nvda",
        "title": "NVDA margins", "passage": SOURCE, "annotation": MINE,
    })
    return note


def _retrieve(note_id: str, query: str):
    return ar.retrieve_note(USER, note_id, query)


class TestTheNoteHasText:
    def test_a_note_holding_only_a_captured_passage_is_not_called_empty(self, note_with_capture):
        got = _retrieve(note_with_capture["id"], "gross margin")
        # `has_text` is what produces "This note doesn't have any text yet."
        # in ask_service — the member-visible half of the defect.
        assert got["coverage"]["has_text"] is True
        assert got["coverage"]["captured_pages"] >= 1
        assert got["coverage"]["captured_excerpts"] >= 1

    def test_coverage_counts_are_query_independent(self, note_with_capture):
        # ⛔ A refusal must be able to say "this note has captured material,
        # none of which mentions that" — which needs a count that does not
        # depend on the query having matched.
        got = _retrieve(note_with_capture["id"], "zebra husbandry techniques")
        assert got["coverage"]["captured_pages"] >= 1
        assert got["coverage"]["has_text"] is True


class TestItActuallyAnswers:
    def test_the_captured_passage_becomes_ANSWER_evidence(self, note_with_capture):
        got = _retrieve(note_with_capture["id"], "gross margin")
        # ⛔ THE SECOND BUG. Retrieval alone is not enough: without a relevance
        # tag the item is returned as a source and the answer still refuses.
        assert got["query_matches"] >= 1, (
            "the captured passage was retrieved but never counted as answering "
            "the question — check the relevance tagging, not the SQL")
        assert got["no_answer"] is False

    def test_the_source_text_is_present_as_evidence(self, note_with_capture):
        got = _retrieve(note_with_capture["id"], "gross margin")
        blob = str(got["evidence"])
        assert "mid-70s" in blob

    def test_a_question_the_note_cannot_answer_is_still_refused(self, note_with_capture):
        # ⛔ The fix must not turn Ask into a machine that always finds
        # something. No-answer stays possible, which is the whole §20 contract.
        got = _retrieve(note_with_capture["id"], "zebra husbandry techniques")
        assert got["no_answer"] is True
        assert got["query_matches"] == 0


class TestProvenanceSurvivesRetrieval:
    def test_the_members_annotation_is_not_inside_the_source_text(self, note_with_capture):
        got = _retrieve(note_with_capture["id"], "gross margin")
        for item in got["evidence"]:
            snippet = str(item.get("snippet") or "")
            if SOURCE[:20] in snippet:
                assert MINE not in snippet, (
                    "the member's annotation was folded into the quoted source "
                    "text — Ask could then attribute their opinion to the publisher")

    def test_tenant_scoping_holds(self, note_with_capture):
        other = ar.retrieve_note("someone-else", note_with_capture["id"], "gross margin")
        assert other["coverage"]["exists"] is False
        assert other["no_answer"] is True
