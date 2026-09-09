"""Wave N §4/§5 — one passage, one live relationship, and a changed mind.

§4 asks for the duplicate case driven BOTH ways: through the picker, and as a
direct adversarial mutation. "UI and server should agree."

⚰️ THEY DID NOT. The picker disables an already-attached candidate
(`disabled={c.alreadyAttached}`), and `add_evidence` had no duplicate guard at
all — a second POST for the same (note, target) simply inserted a second live
row. The member could not do it; anything that was not the picker could. And a
thesis holding one passage twice reports **two** supporting/opposing counts for
one source, which is §6's "curation cannot manufacture corroboration" arriving
through a different door.

⛔ WHAT MUST STAY LEGAL: the SAME passage attached to a DIFFERENT thesis (that
is the whole point of a shared research corpus — `with_stance` says so in
`ask_evidence`), and RE-attaching after removal.

§5 is an investigation, not a feature: determine what the existing architecture
does for supports → opposes and prove it. It has no in-place stance update —
the path is remove-then-add, which keeps ONE live edge, leaves the underlying
passage untouched, and records BOTH events in the changelog. That is a
defensible answer to "the source object remains one source"; this pins it so it
cannot drift into silently mutating an edge or leaving two behind.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import evidence_candidates as ec
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-dup-a"
B = "u-dup-b"
SOURCE = "Gross margin {tok} normalizes toward the mid-70s next year."


def _tok() -> str:
    return "zq" + uuid.uuid4().hex[:8]


def _thesis(user: str, title: str):
    return notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


@pytest.fixture()
def attached():
    auth_db.init_db()
    n = _thesis(A, "NVDA thesis")
    tok = _tok()
    res = wcs.capture_web_source(A, n["id"], {
        "tier": wc.TIER_PASSAGE, "url": "https://www.reuters.com/markets/nvda",
        "title": "Reuters: NVDA margins", "passage": SOURCE.format(tok=tok),
        "annotation": "I think management is too optimistic.",
    })
    ex_id = res["excerpt"]["id"]
    ev = te.add_evidence(A, n["id"], target_type="document_excerpt",
                         target_id=ex_id, stance="opposes")
    return {"note": n, "tok": tok, "excerpt_id": ex_id, "evidence": ev}


class TestTheDuplicateControl:
    def test_the_picker_reports_it_is_already_attached(self, attached):
        c = ec.list_candidates(A, attached["note"]["id"])[0]
        assert c["alreadyAttached"] is True

    def test_and_the_SERVER_refuses_the_same_mutation(self, attached):
        # ⛔ THE ADVERSARIAL CONTROL. The UI is not a security boundary and it
        # is not the only client; a guard that lives only in a disabled button
        # is not a guard.
        with pytest.raises(te.ThesisEvidenceValidationError):
            te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                            target_id=attached["excerpt_id"], stance="opposes")

    def test_a_refused_duplicate_leaves_exactly_one_live_edge(self, attached):
        try:
            te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                            target_id=attached["excerpt_id"], stance="supports")
        except te.ThesisEvidenceValidationError:
            pass
        live = te.list_note_evidence(A, attached["note"]["id"])
        rows = [e for e in live if e["targetId"] == attached["excerpt_id"]]
        assert len(rows) == 1, f"one passage holds {len(rows)} live edges on one thesis"

    def test_a_DIFFERENT_stance_is_still_not_a_second_edge(self, attached):
        # A thesis cannot be both supported and opposed by the same sentence.
        with pytest.raises(te.ThesisEvidenceValidationError):
            te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                            target_id=attached["excerpt_id"], stance="supports")


class TestWhatMustStayLegal:
    def test_the_same_passage_on_a_DIFFERENT_thesis(self, attached):
        # ⭐ THE CONTROL THAT STOPS THE GUARD FROM BEING TOO WIDE. One source
        # legitimately bears on several theses — that is the point of a shared
        # research corpus.
        other = _thesis(A, "NVDA bear case")
        ev = te.add_evidence(A, other["id"], target_type="document_excerpt",
                             target_id=attached["excerpt_id"], stance="supports")
        assert ev["stance"] == "supports"

    def test_re_attaching_after_removal(self, attached):
        te.remove_evidence(A, attached["evidence"]["id"])
        assert ec.list_candidates(A, attached["note"]["id"])[0]["alreadyAttached"] is False
        again = te.add_evidence(A, attached["note"]["id"],
                                target_type="document_excerpt",
                                target_id=attached["excerpt_id"], stance="supports")
        assert again["stance"] == "supports"

    def test_another_members_thesis_is_unaffected(self, attached):
        # The guard must be scoped by tenant like everything else, and must not
        # become a cross-tenant existence oracle either: B's attempt fails
        # because B cannot see the target, not because A attached it.
        nb = _thesis(B, "someone else's thesis")
        with pytest.raises(te.ThesisEvidenceValidationError) as e:
            te.add_evidence(B, nb["id"], target_type="document_excerpt",
                            target_id=attached["excerpt_id"], stance="supports")
        assert "already" not in str(e.value).lower()


class TestChangingYourMind:
    """§5 — what the EXISTING architecture does, proven rather than assumed."""

    def test_there_is_no_in_place_stance_update(self):
        # Recorded as a fact about the service, so a later wave that adds one
        # does it deliberately instead of discovering this by accident.
        assert not hasattr(te, "update_evidence")
        assert not hasattr(te, "set_stance")

    def test_remove_then_add_leaves_ONE_live_edge_with_the_new_stance(self, attached):
        te.remove_evidence(A, attached["evidence"]["id"])
        te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                        target_id=attached["excerpt_id"], stance="supports")
        live = te.list_note_evidence(A, attached["note"]["id"])
        rows = [e for e in live if e["targetId"] == attached["excerpt_id"]]
        assert len(rows) == 1
        assert rows[0]["stance"] == "supports"

    def test_the_underlying_passage_is_untouched_by_the_change(self, attached):
        before = ec.list_candidates(A, attached["note"]["id"])[0]
        te.remove_evidence(A, attached["evidence"]["id"])
        te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                        target_id=attached["excerpt_id"], stance="supports")
        after = ec.list_candidates(A, attached["note"]["id"])[0]
        # ⛔ SOURCE ≠ MEMBER NOTE ≠ STANCE. A changed judgement must not rewrite
        # what the publisher said or what the member wrote.
        assert after["text"] == before["text"]
        assert after["annotation"] == before["annotation"]

    def test_BOTH_events_survive_in_the_history(self, attached):
        te.remove_evidence(A, attached["evidence"]["id"])
        te.add_evidence(A, attached["note"]["id"], target_type="document_excerpt",
                        target_id=attached["excerpt_id"], stance="supports")
        history = te.list_note_evidence(A, attached["note"]["id"], include_removed=True)
        mine = [e for e in history if e["targetId"] == attached["excerpt_id"]]
        assert len(mine) == 2, "the earlier judgement vanished from the record"
        assert {e["stance"] for e in mine} == {"opposes", "supports"}
        assert sum(1 for e in mine if e["removedAt"]) == 1
