"""Wave N — a captured passage must be ATTACHABLE, not merely acceptable.

⚰️ THE DEFECT. `thesis_evidence` accepts a captured passage as a
`document_excerpt` target and always did — the stance lands on the edge and the
source text is untouched. The member simply could never pick one, because the
picker's candidates came from `list_note_excerpts`, which joins
`j2_note_excerpt_refs` — a sidecar `notes._sync_note_excerpt_refs` REBUILDS FROM
`documentExcerpt` NODES IN THE NOTE BODY. A capture never embeds one.

BUILT + GREEN + MEMBER-UNREACHABLE.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import evidence_candidates as ec
from api.services.journal_two import note_excerpts
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-evid-a"
B = "u-evid-b"
SOURCE = "Gross margin {tok} normalizes toward the mid-70s next year."
MINE = "I think that is optimistic given HBM pricing."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


@pytest.fixture()
def note():
    auth_db.init_db()
    n = notes_svc.create_note(A, {
        "title": "NVDA thesis", "ticker": "NVDA",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    n["tok"] = _tok()
    wcs.capture_web_source(A, n["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins",
        "passage": SOURCE.format(tok=n["tok"]), "annotation": MINE,
    })
    return n


class TestTheGapItself:
    def test_the_captured_passage_is_INVISIBLE_to_the_old_body_refs_list(self, note):
        # ⭐ THE CONTROL THAT PROVES THE DEFECT WAS REAL. `list_note_excerpts`
        # is not broken — it answers "embedded in the body", and a capture is
        # not. Pinning it keeps the two questions distinguishable, so nobody
        # "fixes" this by making captures fake a documentExcerpt node.
        assert note_excerpts.list_note_excerpts(A, note["id"]) == []

    def test_but_it_IS_an_evidence_candidate(self, note):
        cands = ec.list_candidates(A, note["id"])
        assert len(cands) == 1, "a captured passage is still unreachable as evidence"
        assert note["tok"] in cands[0]["text"]


class TestCandidateTruth:
    def test_a_web_capture_reports_its_kind_and_source(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        assert c["sourceKind"] == wc.SOURCE_KIND_WEB
        assert c["sourceTitle"] == "Reuters: NVDA margins"
        assert "reuters.com" in c["sourceUrl"]
        assert c["coverage"] == "selected_passage"

    def test_a_web_capture_exposes_NO_page_number(self, note):
        # Its stored page_number is a capture ordinal. Wave M banned rendering
        # that as a page; this stops it reaching the picker at all, so the
        # surface cannot repeat the defect even by accident.
        assert ec.list_candidates(A, note["id"])[0]["pageNumber"] is None

    def test_source_claim_and_member_annotation_stay_two_fields(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        assert MINE == c["annotation"]
        assert MINE not in c["text"], (
            "the member's interpretation was folded into the quoted source")

    def test_it_is_offered_as_the_existing_evidence_target_type(self, note):
        # ⛔ NOT a new taxonomy. Wave G's TARGET_TYPES already accepts
        # document_excerpt, and a captured passage is one.
        assert ec.list_candidates(A, note["id"])[0]["evidenceType"] in te.TARGET_TYPES


class TestAttachability:
    def test_a_candidate_id_actually_attaches(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        ev = te.add_evidence(A, note["id"], target_type=c["evidenceType"],
                             target_id=c["id"], stance="opposes",
                             caption="cuts against my thesis")
        assert ev["stance"] == "opposes"

    def test_the_stance_lives_on_the_EDGE_not_the_source(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        te.add_evidence(A, note["id"], target_type=c["evidenceType"],
                        target_id=c["id"], stance="opposes")
        after = ec.list_candidates(A, note["id"])[0]
        # ⛔ SOURCE CLAIM ≠ MEMBER BELIEF ≠ EVIDENCE STANCE (§19). Attaching a
        # passage as opposing must not rewrite what the source said.
        assert after["text"] == c["text"]
        assert after["annotation"] == c["annotation"]
        assert "opposes" not in (after["text"] or "")

    def test_already_attached_state_is_reported(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        assert c["alreadyAttached"] is False
        te.add_evidence(A, note["id"], target_type=c["evidenceType"],
                        target_id=c["id"], stance="supports")
        assert ec.list_candidates(A, note["id"])[0]["alreadyAttached"] is True, (
            "the member would rediscover a duplicate by being refused")

    def test_removing_the_evidence_frees_the_candidate_again(self, note):
        c = ec.list_candidates(A, note["id"])[0]
        ev = te.add_evidence(A, note["id"], target_type=c["evidenceType"],
                        target_id=c["id"], stance="supports")
        te.remove_evidence(A, ev["id"])
        assert ec.list_candidates(A, note["id"])[0]["alreadyAttached"] is False


class TestFiltering:
    def test_a_query_filters_by_source_text(self, note):
        assert ec.list_candidates(A, note["id"], q=note["tok"])
        assert ec.list_candidates(A, note["id"], q="zzz-no-such-text") == []

    def test_a_query_also_matches_the_member_annotation_and_source_title(self, note):
        assert ec.list_candidates(A, note["id"], q="HBM")
        assert ec.list_candidates(A, note["id"], q="Reuters")


class TestTenantAndLifecycle:
    def test_another_member_gets_nothing(self, note):
        assert ec.list_candidates(B, note["id"]) == []

    def test_and_the_owner_still_does_CONTROL(self, note):
        assert ec.list_candidates(A, note["id"])

    def test_a_trashed_note_offers_no_evidence(self, note):
        notes_svc.delete_note(A, note["id"])
        assert ec.list_candidates(A, note["id"]) == []

    def test_restoring_brings_its_candidates_back(self, note):
        notes_svc.delete_note(A, note["id"])
        notes_svc.restore_note(A, note["id"])
        assert ec.list_candidates(A, note["id"])
