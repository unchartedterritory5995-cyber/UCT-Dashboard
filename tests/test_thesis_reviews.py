"""Wave O — the review loop's domain rules, before any UI exists.

⛔ THE INVARIANT THIS WHOLE FILE DEFENDS: completing a review records what the
MEMBER decided. It never decides anything itself, and it never touches the
thesis. UCT surfaces evidence and dates; the member owns the judgement (§4).

⛔ TIME IS FIXED, NEVER READ FROM THE CLOCK (§58). Every "since last review"
assertion below is measured against a timestamp this file wrote, so a boundary
case is a decision the test made rather than a race it happened to win.
"""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import thesis_review_changes as trc
from api.services.journal_two import thesis_reviews as tr
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

A = "u-rev-a"
B = "u-rev-b"

# Fixed instants. The anchor sits BETWEEN them so "before" and "after" are
# properties of the data, not of how fast the suite ran.
T_BEFORE = "2026-01-10T00:00:00+00:00"
T_ANCHOR = "2026-02-01T00:00:00+00:00"
T_AFTER = "2026-03-05T00:00:00+00:00"


def _thesis(user: str = A, title: str = "NVDA thesis"):
    return notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


def _evidence(user: str, note_id: str, stance: str, *, created_at: str,
              removed_at: str | None = None) -> str:
    """An evidence edge with a CHOSEN timestamp — the service always stamps
    'now', and this file is about behaviour at time boundaries."""
    ex = _capture(user, note_id)
    ev = te.add_evidence(user, note_id, target_type="document_excerpt",
                         target_id=ex, stance=stance)
    conn = get_connection()
    try:
        conn.execute("UPDATE j2_thesis_evidence SET created_at = ?, removed_at = ?"
                     " WHERE id = ?", (created_at, removed_at, ev["id"]))
        conn.commit()
    finally:
        conn.close()
    return ev["id"]


def _capture(user: str, note_id: str) -> str:
    tok = "zq" + uuid.uuid4().hex[:8]
    res = wcs.capture_web_source(user, note_id, {
        "tier": wc.TIER_PASSAGE, "url": f"https://www.reuters.com/{tok}",
        "title": "Reuters: NVDA margins",
        "passage": f"Gross margin {tok} normalizes toward the mid-70s.",
        "annotation": "I think management is too optimistic."})
    return res["excerpt"]["id"]


def _complete_at(user: str, review_id: str, when: str, outcome: str) -> None:
    tr.complete(user, review_id, outcome=outcome)
    conn = get_connection()
    try:
        conn.execute("UPDATE j2_thesis_reviews SET completed_at = ? WHERE id = ?",
                     (when, review_id))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture()
def thesis():
    auth_db.init_db()
    return _thesis()


class TestOpeningAReview:
    def test_it_starts_as_a_draft_not_a_decision(self, thesis):
        r = tr.open_review(A, thesis["id"])
        assert r["status"] == tr.STATUS_DRAFT
        assert r["completedAt"] is None
        assert r["outcome"] is None

    def test_opening_twice_RESUMES_rather_than_minting_a_second(self, thesis):
        # ⛔ §38. A surface may call this on render; a review obligation must
        # not accumulate every time somebody looks at the page.
        a = tr.open_review(A, thesis["id"])
        b = tr.open_review(A, thesis["id"])
        assert a["id"] == b["id"]
        assert len(tr.list_reviews(A, thesis["id"])) == 1

    def test_the_DATABASE_enforces_one_open_draft(self, thesis):
        # ⭐ The guard is a partial unique index, not a service that remembers
        # to check — so a second writer racing the first still cannot win.
        tr.open_review(A, thesis["id"])
        conn = get_connection()
        try:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO j2_thesis_reviews (id, user_id, note_id, status,"
                    " created_at) VALUES (?,?,?,?,?)",
                    (uuid.uuid4().hex, A, thesis["id"], "draft", T_AFTER))
                conn.commit()
        finally:
            conn.close()

    def test_it_records_what_the_thesis_said_when_the_review_opened(self, thesis):
        # A reference to an immutable version row, never a copy of the text.
        notes_svc.update_note(A, thesis["id"], {"title": "NVDA thesis v2"})
        r = tr.open_review(A, thesis["id"])
        assert r["priorVersionId"], "the review cannot say what it was reviewing"

    def test_a_foreign_thesis_fails_non_confirmingly(self, thesis):
        # ⛔ §57: B must not learn that A's note exists.
        with pytest.raises(tr.ThesisReviewError) as e:
            tr.open_review(B, thesis["id"])
        assert "not found" in str(e.value).lower()


class TestCompletingAReview:
    def test_it_records_the_decision(self, thesis):
        r = tr.open_review(A, thesis["id"])
        done = tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE,
                           member_note="Margins still track my model.")
        assert done["status"] == tr.STATUS_COMPLETED
        assert done["outcome"] == tr.OUTCOME_NO_CHANGE
        assert done["completedAt"]
        assert done["memberNote"] == "Margins still track my model."

    def test_NO_CHANGE_leaves_the_thesis_completely_untouched(self, thesis):
        # ⛔⛔ THE LOAD-BEARING CONTROL (§4/§53). A review is not an edit.
        before = notes_svc.get_note(A, thesis["id"])
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        after = notes_svc.get_note(A, thesis["id"])
        assert after["title"] == before["title"]
        assert after["propertiesJson"] == before["propertiesJson"]
        assert after["updatedAt"] == before["updatedAt"]

    def test_even_INVALIDATED_does_not_set_the_thesis_status(self, thesis):
        # ⛔ The strongest form of the same rule. A member saying "this is
        # invalidated" in a review is a statement; changing the thesis is an
        # act, and it goes through the canonical property path where the
        # changelog can see it.
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_INVALIDATED)
        props = notes_svc.get_note(A, thesis["id"])["propertiesJson"] or {}
        assert props.get("builtin:thesis_status") != "invalidated"

    def test_the_occurrence_survives_even_when_nothing_changed(self, thesis):
        # This is what a task app cannot represent: deciding NOT to change
        # something writes nothing anywhere else.
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        assert tr.last_completed(A, thesis["id"])["outcome"] == tr.OUTCOME_NO_CHANGE

    def test_a_completed_review_cannot_be_edited(self, thesis):
        # ⛔ §8: it is historical evidence of what was decided THEN.
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE, member_note="first")
        with pytest.raises(tr.ThesisReviewError):
            tr.save_draft(A, r["id"], member_note="rewritten later")
        assert tr.last_completed(A, thesis["id"])["memberNote"] == "first"

    def test_it_cannot_be_completed_twice(self, thesis):
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        with pytest.raises(tr.ThesisReviewError):
            tr.complete(A, r["id"], outcome=tr.OUTCOME_REVISED)

    def test_an_unknown_outcome_is_REFUSED_not_stored(self, thesis):
        r = tr.open_review(A, thesis["id"])
        with pytest.raises(tr.ThesisReviewError):
            tr.complete(A, r["id"], outcome="84% conviction")

    def test_another_member_cannot_complete_it(self, thesis):
        r = tr.open_review(A, thesis["id"])
        with pytest.raises(tr.ThesisReviewError):
            tr.complete(B, r["id"], outcome=tr.OUTCOME_NO_CHANGE)


class TestDraftIsNotHistory:
    def test_a_draft_never_becomes_a_completed_review_by_saving(self, thesis):
        # ⛔ §34: autosave must not manufacture a decision the member never made.
        r = tr.open_review(A, thesis["id"])
        tr.save_draft(A, r["id"], member_note="half a thought",
                      outcome=tr.OUTCOME_REVISED)
        assert tr.last_completed(A, thesis["id"]) is None
        again = tr.list_reviews(A, thesis["id"])[0]
        assert again["status"] == tr.STATUS_DRAFT
        assert again["completedAt"] is None

    def test_the_draft_keeps_the_members_work(self, thesis):
        r = tr.open_review(A, thesis["id"])
        tr.save_draft(A, r["id"], member_note="half a thought")
        assert tr.list_reviews(A, thesis["id"])[0]["memberNote"] == "half a thought"


class TestChangesSinceLastReview:
    def test_a_thesis_never_reviewed_says_SO_not_zero(self, thesis):
        # ⛔ §35: "nothing changed since last review" is a lie when there was
        # no last review, and it makes the feature read as broken.
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch == {"hasPriorReview": False}

    def test_evidence_added_AFTER_the_anchor_counts(self, thesis):
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["addedOpposing"] == 1
        assert ch["addedSupporting"] == 0

    def test_evidence_added_BEFORE_the_anchor_does_not(self, thesis):
        _evidence(A, thesis["id"], "opposes", created_at=T_BEFORE)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["addedOpposing"] == 0

    def test_supporting_and_opposing_are_never_collapsed(self, thesis):
        _evidence(A, thesis["id"], "supports", created_at=T_AFTER)
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert (ch["addedSupporting"], ch["addedOpposing"]) == (1, 2)

    def test_it_reports_COUNTS_and_never_a_derived_probability(self, thesis):
        # ⛔ §41: 5 supporting / 2 opposing is not "71% supported". Nothing in
        # the payload may look like a score.
        _evidence(A, thesis["id"], "supports", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        for k in ch:
            assert not any(w in k.lower() for w in
                           ("score", "pct", "percent", "conviction", "strength",
                            "confidence", "probability"))

    def test_member_removal_and_source_purge_are_TWO_facts(self, thesis):
        # ⛔ §40. "I changed my mind" and "the world moved under me" are
        # different events and must not both read as "evidence removed".
        _evidence(A, thesis["id"], "supports", created_at=T_BEFORE,
                  removed_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["removedByMember"] == 1
        assert ch["sourcesNoLongerAvailable"] == 0

    def test_a_purged_source_shows_up_as_unavailable_not_as_removed(self, thesis):
        ex = _capture(A, thesis["id"])
        ev = te.add_evidence(A, thesis["id"], target_type="document_excerpt",
                             target_id=ex, stance="supports")
        conn = get_connection()
        try:
            conn.execute("UPDATE j2_thesis_evidence SET created_at = ? WHERE id = ?",
                         (T_BEFORE, ev["id"]))
            conn.execute("DELETE FROM j2_note_excerpts WHERE id = ?", (ex,))
            conn.commit()
        finally:
            conn.close()
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["sourcesNoLongerAvailable"] == 1
        assert ch["removedByMember"] == 0

    def test_evidence_added_AND_removed_since_the_anchor_is_not_still_added(self, thesis):
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER, removed_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["addedOpposing"] == 0

    def test_the_anchor_is_the_last_COMPLETED_review_not_an_open_draft(self, thesis):
        r1 = tr.open_review(A, thesis["id"])
        _complete_at(A, r1["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        tr.open_review(A, thesis["id"])  # a draft opened now
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["addedOpposing"] == 1, (
            "an open draft moved the anchor and hid the change it exists to show")

    def test_another_members_evidence_is_never_counted(self, thesis):
        other = _thesis(B, "B's own thesis")
        _evidence(B, other["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        ch = trc.changes_since_last_review(A, thesis["id"])
        assert ch["addedOpposing"] == 0


class TestAttentionIsExplainable:
    def test_every_reason_carries_its_own_sentence(self, thesis):
        # ⛔ §16: no opaque HIGH PRIORITY. If UCT says look at this, it says why.
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        att = trc.review_attention(A, thesis["id"])
        assert att["reasons"]
        for reason in att["reasons"]:
            assert reason["text"].strip()
            assert reason["code"]

    def test_it_never_emits_a_priority_or_a_verdict(self, thesis):
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        att = trc.review_attention(A, thesis["id"])
        blob = str(att).lower()
        for banned in ("priority", "invalid", "weaken", "strengthen", "urgent"):
            assert banned not in blob, f"the attention payload interprets: {banned}"

    def test_new_opposing_evidence_reads_as_ATTENTION_not_as_a_verdict(self, thesis):
        # ⛔ §13. "may deserve attention" — never "thesis invalid".
        _evidence(A, thesis["id"], "opposes", created_at=T_AFTER)
        r = tr.open_review(A, thesis["id"])
        _complete_at(A, r["id"], T_ANCHOR, tr.OUTCOME_NO_CHANGE)
        att = trc.review_attention(A, thesis["id"])
        codes = [x["code"] for x in att["reasons"]]
        assert "new_opposing_evidence" in codes
        text = next(x["text"] for x in att["reasons"]
                    if x["code"] == "new_opposing_evidence")
        assert text == "1 opposing evidence item added since your last review"

    def test_a_never_reviewed_thesis_says_exactly_that(self, thesis):
        att = trc.review_attention(A, thesis["id"])
        assert [x["code"] for x in att["reasons"]] == ["never_reviewed"]
        assert att["reasons"][0]["text"] == "no completed review yet"


class TestHistory:
    def test_history_is_newest_first_and_keeps_completed_reviews(self, thesis):
        r1 = tr.open_review(A, thesis["id"])
        _complete_at(A, r1["id"], T_BEFORE, tr.OUTCOME_NO_CHANGE)
        r2 = tr.open_review(A, thesis["id"])
        _complete_at(A, r2["id"], T_AFTER, tr.OUTCOME_REVISED)
        hist = tr.list_reviews(A, thesis["id"])
        assert [h["id"] for h in hist] == [r2["id"], r1["id"]]
        assert [h["outcome"] for h in hist] == [tr.OUTCOME_REVISED,
                                                tr.OUTCOME_NO_CHANGE]

    def test_a_later_review_does_not_rewrite_an_earlier_one(self, thesis):
        r1 = tr.open_review(A, thesis["id"])
        tr.complete(A, r1["id"], outcome=tr.OUTCOME_NO_CHANGE,
                    member_note="held in Feb")
        r2 = tr.open_review(A, thesis["id"])
        tr.complete(A, r2["id"], outcome=tr.OUTCOME_INVALIDATED,
                    member_note="gave up in March")
        first = [h for h in tr.list_reviews(A, thesis["id"]) if h["id"] == r1["id"]][0]
        assert first["memberNote"] == "held in Feb"
        assert first["outcome"] == tr.OUTCOME_NO_CHANGE

    def test_another_member_sees_none_of_it(self, thesis):
        r = tr.open_review(A, thesis["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        assert tr.list_reviews(B, thesis["id"]) == []
        assert tr.last_completed(B, thesis["id"]) is None
