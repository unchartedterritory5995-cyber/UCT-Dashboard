"""Wave O6 — can the member find, and be answered from, what they DECIDED?

⚰️ THE DEFECT. Wave O shipped a place to record a judgement about a thesis and
nothing that could retrieve one. Search found notes, document pages and saved
excerpts — everything the member had READ — and never their own conclusion.
Ask could describe the current thesis and never say what they decided last
time. Both were green the whole way: the review loop's own suites all passed,
because none of them asked a consumer a question.

⛔⛔ WHAT THIS FILE ACTUALLY HAS TO PROVE, and why each half can fail alone:

  1. RETRIEVABILITY  — a completed review comes back from Search and from the
     Ask scopes that can truthfully hold one.
  2. CHRONOLOGY      — "last" and "previous" resolve to ROWS, deterministically,
     and never depend on a model inferring recency from unordered text (§9).
  3. AUTHORSHIP      — a review is labelled as the MEMBER's, carries its own
     lineage, and never counts as corroboration of a claim (§14/§15).
  4. SCOPE           — a question about NVDA cannot reach an AAPL review, and no
     tenant can reach another's (§10).

⛔ TIME IS FIXED, NEVER READ FROM THE CLOCK. Every ordering assertion below is
measured against timestamps this file wrote, so "which one is last" is a
property of the data rather than of how fast the suite ran.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import review_search as rs
from api.services.journal_two import thesis_reviews as tr

A = "u-recall-a"
B = "u-recall-b"

T1 = "2026-01-10T00:00:00+00:00"
T2 = "2026-02-14T00:00:00+00:00"
T3 = "2026-03-20T00:00:00+00:00"


def _thesis(user: str | None = None, *, title: str = "NVDA thesis",
            ticker: str | None = "NVDA"):
    """⛔ THE TENANT IS READ AT CALL TIME, NEVER DEFAULTED.

    `user: str = A` would bind whatever `A` held when this function was
    DEFINED, so the per-test rebinding below would silently not apply to any
    caller that omitted the argument -- every note landing back in one shared
    tenant while the fixture looked like it was isolating them. That exact
    mistake cost Wave O a debugging session.
    """
    return notes_svc.create_note(user or A, {
        "title": title, "ticker": ticker, "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })


def _reviewed(user: str, note_id: str, *, when: str, note: str,
              outcome: str = "no_change", review_id: str | None = None) -> str:
    """One COMPLETED review at a chosen instant.

    The service always stamps 'now'; this file is entirely about behaviour at
    time boundaries, so the timestamp is written afterwards. `review_id` lets a
    test choose the id too — the tie-break case needs to control it.
    """
    r = tr.open_review(user, note_id)
    tr.complete(user, r["id"], outcome=outcome, member_note=note)
    conn = get_connection()
    try:
        if review_id:
            conn.execute("UPDATE j2_thesis_reviews SET id = ? WHERE id = ?",
                         (review_id, r["id"]))
        conn.execute("UPDATE j2_thesis_reviews SET completed_at = ? WHERE id = ?",
                     (when, review_id or r["id"]))
        conn.commit()
    finally:
        conn.close()
    return review_id or r["id"]


@pytest.fixture()
def db():
    """A FRESH TENANT PER TEST.

    ⛔⛔ The sandbox database is shared across this module, and almost every
    assertion here is a COUNT ("one hit", "nothing"). With a module-level user
    id, row 1 of test two is row 3 of the file, and the failures land on
    whichever test happens to run last -- which reads as a flaky suite rather
    than as the fixture defect it is. Rebinding the module globals is the same
    fix Wave O's own review-queue suite needed, and for the same reason.
    """
    global A, B
    auth_db.init_db()
    tok = uuid.uuid4().hex[:8]
    A, B = f"u-recall-a-{tok}", f"u-recall-b-{tok}"


# ── 1. Retrievability: Search ────────────────────────────────────────────────

class TestSearchCanFindAReview:
    def test_a_completed_review_is_findable_by_what_the_member_wrote(self, db):
        n = _thesis()
        rid = _reviewed(A, n["id"], when=T1,
                        note="I was wrong about the datacenter buildout slowing.")
        hits = rs.search_reviews(A, "datacenter")
        assert [h["review_id"] for h in hits] == [rid]
        assert hits[0]["note_id"] == n["id"]
        assert hits[0]["note_title"] == "NVDA thesis"

    def test_the_snippet_marks_the_term_the_member_searched(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T1,
                  note="Margins held up better than I expected all quarter.")
        [hit] = rs.search_reviews(A, "margins")
        assert "<mark>Margins</mark>" in hit["snippet"]

    def test_a_DRAFT_is_never_a_search_result(self, db):
        # ⛔ A draft is the member mid-thought. Surfacing one as a finding shows
        # them a conclusion they have not reached.
        n = _thesis()
        r = tr.open_review(A, n["id"])
        tr.save_draft(A, r["id"], member_note="datacenter demand looks soft")
        assert rs.search_reviews(A, "datacenter") == []

    def test_a_review_of_a_TRASHED_thesis_disappears_and_comes_back(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T1, note="datacenter demand still compounding")
        assert len(rs.search_reviews(A, "datacenter")) == 1
        notes_svc.delete_note(A, n["id"])
        assert rs.search_reviews(A, "datacenter") == []
        notes_svc.restore_note(A, n["id"])
        assert len(rs.search_reviews(A, "datacenter")) == 1

    def test_ANOTHER_TENANT_never_appears(self, db):
        mine = _thesis(A)
        theirs = _thesis(B)
        _reviewed(A, mine["id"], when=T1, note="datacenter thesis intact")
        _reviewed(B, theirs["id"], when=T1, note="datacenter thesis broken")
        assert len(rs.search_reviews(A, "datacenter")) == 1
        assert rs.search_reviews(A, "datacenter")[0]["note_id"] == mine["id"]

    def test_every_term_must_match_not_just_one(self, db):
        # Term-AND, the same as every other Notebook search. An OR here would
        # make a long question match essentially every review the member owns.
        n = _thesis()
        _reviewed(A, n["id"], when=T1, note="datacenter demand is fine")
        assert rs.search_reviews(A, "datacenter demand") != []
        assert rs.search_reviews(A, "datacenter litigation") == []

    def test_an_empty_query_returns_nothing_rather_than_everything(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T1, note="anything at all")
        assert rs.search_reviews(A, "   ") == []


# ── 2. Chronology: "last" and "previous" are rows, not guesses ───────────────

class TestChronologyIsDeterministic:
    def test_ordinals_number_the_history_newest_first(self, db):
        n = _thesis()
        oldest = _reviewed(A, n["id"], when=T1, note="first look at margins")
        middle = _reviewed(A, n["id"], when=T2, note="second look at margins")
        newest = _reviewed(A, n["id"], when=T3, note="third look at margins")
        rows = ar._review_history(_conn(), A, [n["id"]], per_thesis=None,
                                  q=None, limit=10)
        assert [(r["id"], r["ordinal"], r["total"]) for r in rows] == [
            (newest, 1, 3), (middle, 2, 3), (oldest, 3, 3)]

    def test_the_LABEL_states_the_position_so_nothing_has_to_infer_it(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T1, note="first look at margins")
        _reviewed(A, n["id"], when=T3, note="latest look at margins")
        items = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                      per_thesis=5)
        labels = [i["label"] for i in items]
        assert any(l.startswith("Your most recent thesis review") for l in labels)
        assert any(l.startswith("Your previous thesis review") for l in labels)

    def test_a_TEXT_FILTER_does_not_renumber_the_history(self, db):
        # ⛔⛔ THE DEFECT THIS BLOCKS. If the LIKE clauses ran inside the window
        # subquery, the ordinal would be the row's position among the reviews
        # that happen to share vocabulary with the question — so a two-year-old
        # review would be labelled "your most recent" the moment it was the
        # only one matching. That is a lie told confidently, in the member's
        # own voice.
        n = _thesis()
        old = _reviewed(A, n["id"], when=T1, note="the datacenter story is intact")
        _reviewed(A, n["id"], when=T3, note="nothing new to say")
        [row] = ar._review_history(_conn(), A, [n["id"]], per_thesis=None,
                                   q="datacenter", limit=10)
        assert row["id"] == old
        assert row["ordinal"] == 2, "the older review is still the PREVIOUS one"
        assert row["total"] == 2

    def test_two_reviews_completed_in_the_same_second_still_order_the_same_way(self, db):
        # Recency alone is not an order when two rows share a timestamp, and a
        # coin-flip "last" is worse than no answer.
        n = _thesis()
        _reviewed(A, n["id"], when=T2, note="alpha take on margins", review_id="r-aaa")
        _reviewed(A, n["id"], when=T2, note="beta take on margins", review_id="r-bbb")
        seen = set()
        for _ in range(5):
            rows = ar._review_history(_conn(), A, [n["id"]], per_thesis=None,
                                      q=None, limit=10)
            seen.add(tuple(r["id"] for r in rows))
        assert seen == {("r-bbb", "r-aaa")}

    def test_each_thesis_is_numbered_in_ITS_OWN_history(self, db):
        # ⛔ Reviews of different theses are different sequences. Numbering them
        # in one run would make "my last review" mean something the member has
        # no concept of.
        nv = _thesis(title="NVDA thesis", ticker="NVDA")
        ap = _thesis(title="AAPL thesis", ticker="AAPL")
        _reviewed(A, nv["id"], when=T1, note="nvda margins one")
        latest_nv = _reviewed(A, nv["id"], when=T3, note="nvda margins two")
        only_ap = _reviewed(A, ap["id"], when=T2, note="aapl margins one")
        rows = ar._review_history(_conn(), A, [nv["id"], ap["id"]],
                                  per_thesis=1, q=None, limit=10)
        assert {r["id"] for r in rows} == {latest_nv, only_ap}
        assert all(r["ordinal"] == 1 for r in rows)

    def test_the_newest_review_of_EVERY_thesis_survives_a_talkative_neighbour(self, db):
        # ⚰️ The first cut limited the chronology query to `len(note_ids)` rows
        # and deduped afterwards, so a thesis with three reviews consumed the
        # whole budget and a thesis with one was silently never retrieved.
        loud = _thesis(title="NVDA thesis")
        quiet = _thesis(title="AAPL thesis", ticker="AAPL")
        for when in (T1, T2, T3):
            _reviewed(A, loud["id"], when=when, note=f"margins note {when}")
        expected = _reviewed(A, quiet["id"], when=T1, note="margins note aapl")
        rows = ar._review_history(_conn(), A, [loud["id"], quiet["id"]],
                                  per_thesis=1, q=None, limit=10)
        assert expected in {r["id"] for r in rows}


# ── 3. Authorship: the member's judgement, never a source's claim ────────────

class TestAReviewIsTheMembersOwnVoice:
    def test_it_is_labelled_as_the_members_review_not_as_a_document(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T3, note="margins are the whole thesis now")
        [item] = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                       per_thesis=1)
        assert item["source_type"] == ev.THESIS_REVIEW
        assert item["label"].startswith("Your")
        assert "review" in item["label"].lower()

    def test_it_does_not_corroborate_a_claim(self, db):
        # ⛔ §15 — CURATION IS NOT CORROBORATION. A member writing "margins are
        # fine" in a review is not a second source saying margins are fine, and
        # counting it as one would inflate the confidence of an answer using
        # exactly the member's own words as its evidence.
        n = _thesis()
        _reviewed(A, n["id"], when=T3, note="margins are fine")
        [item] = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                       per_thesis=1)
        assert item["corroborates"] is False
        assert ev.independent_source_count([item]) == 0

    def test_it_carries_its_own_lineage_so_it_never_collapses_into_the_thesis(self, db):
        n = _thesis()
        rid = _reviewed(A, n["id"], when=T3, note="margins are fine")
        [item] = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                       per_thesis=1)
        assert item["lineage_key"] == f"review:{rid}"

    def test_it_navigates_to_the_review_itself_not_the_top_of_the_note(self, db):
        n = _thesis()
        rid = _reviewed(A, n["id"], when=T3, note="margins are fine")
        [item] = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                       per_thesis=1)
        assert item["navigation"] == {"kind": "review", "note_id": n["id"],
                                      "review_id": rid}

    def test_the_prompt_is_told_the_position_and_the_decision(self, db):
        # ⛔ §9 — the chronology reaches the model as DATA. Without these keys
        # it is handed several member notes that look alike and asked which is
        # "last", which is the inference this retrieval exists to remove.
        from api.services.journal_two import ask_prompt as ap
        n = _thesis()
        _reviewed(A, n["id"], when=T3, note="margins are fine", outcome="revised")
        [item] = ar._reviews_for_notes(_conn(), A, [n["id"]], "margins", 10,
                                       per_thesis=1)
        rendered = ap.render_source(1, item)
        assert "review_ordinal: 1" in rendered
        assert "outcome: revised" in rendered
        assert "type: thesis_review" in rendered


# ── 4. Scope: the security constraint is structural ──────────────────────────

class TestScope:
    def test_a_question_about_NVDA_does_not_reach_an_AAPL_review(self, db):
        # ⛔ §10. Both reviews use the same word. The ONLY thing separating them
        # is the note-membership scope, which is why this test would go red the
        # moment that filter is removed rather than merely reordering results.
        nv = _thesis(title="NVDA thesis", ticker="NVDA")
        ap = _thesis(title="AAPL thesis", ticker="AAPL")
        _reviewed(A, nv["id"], when=T2, note="margins are the whole thesis")
        aapl = _reviewed(A, ap["id"], when=T3, note="margins are the whole thesis")
        items = ar._reviews_for_notes(_conn(), A, [nv["id"]], "margins", 10,
                                      per_thesis=2)
        assert aapl not in {i["source_id"] for i in items}
        assert items, "the NVDA review itself must still be retrieved"

    def test_another_tenants_review_is_unreachable_even_by_note_id(self, db):
        theirs = _thesis(B)
        _reviewed(B, theirs["id"], when=T3, note="margins collapsed")
        assert ar._reviews_for_notes(_conn(), A, [theirs["id"]], "margins", 10,
                                     per_thesis=2) == []

    def test_none_note_ids_means_this_members_whole_notebook_not_everyones(self, db):
        mine = _thesis(A)
        theirs = _thesis(B)
        _reviewed(A, mine["id"], when=T2, note="margins holding")
        _reviewed(B, theirs["id"], when=T3, note="margins holding")
        items = ar._reviews_for_notes(_conn(), A, None, "margins", 10,
                                      per_thesis=0)
        assert len(items) == 1
        assert items[0]["user_id"] == A


# ── 5. The Ask scopes actually consume it ────────────────────────────────────

class TestTheAskScopesConsumeReviews:
    def test_ask_current_note_answers_from_this_thesiss_reviews(self, db):
        n = _thesis()
        _reviewed(A, n["id"], when=T3,
                  note="I concluded the datacenter buildout is still early.")
        out = ar.retrieve_note(A, n["id"], "what did I decide in my last review?")
        reviews = [e for e in out["evidence"]
                   if e["source_type"] == ev.THESIS_REVIEW]
        assert reviews, "the note scope must retrieve this thesis's own reviews"
        assert out["query_matches"] >= 1
        assert out["no_answer"] is False

    def test_ask_security_research_answers_from_that_securitys_reviews(self, db):
        n = _thesis(title="NVDA thesis", ticker="NVDA")
        _reviewed(A, n["id"], when=T3,
                  note="Datacenter demand still looks early to me.")
        out = ar.retrieve_entity_research(A, "NVDA", "datacenter")
        assert any(e["source_type"] == ev.THESIS_REVIEW for e in out["evidence"])

    def test_ask_my_notebook_finds_a_review_by_its_words(self, db):
        n = _thesis(title="Some thesis", ticker=None)
        _reviewed(A, n["id"], when=T3,
                  note="The kimberlite grades were the thing I got wrong.")
        out = ar.retrieve(A, "kimberlite grades")
        assert any(e["source_type"] == ev.THESIS_REVIEW for e in out["evidence"])

    def test_ask_my_notebook_does_NOT_floor_every_answer_with_review_history(self, db):
        # ⛔ "The latest review of every thesis you own" is a FLOOR, and a floor
        # is how an unrelated question comes back answered with the member's
        # research. Chronology joins only once the question has narrowed to a
        # security; a question that reaches nothing must still reach nothing.
        n = _thesis(title="Some thesis", ticker=None)
        _reviewed(A, n["id"], when=T3, note="margins are fine")
        out = ar.retrieve(A, "zebra husbandry techniques")
        assert not any(e["source_type"] == ev.THESIS_REVIEW
                       for e in out["evidence"])
        assert out["no_answer"] is True

    def test_a_document_scope_is_not_given_reviews(self, db):
        # ⛔ NOT APPLICABLE, recorded as a decision rather than an omission. Ask
        # Document is scoped to ONE source object; a review is about a thesis,
        # and a document does not have one.
        import inspect
        src = inspect.getsource(ar.retrieve_document)
        assert "_reviews_for_notes" not in src


def _conn():
    from api.services.auth_db import get_connection as gc
    import sqlite3 as _sq
    c = gc()
    c.row_factory = _sq.Row
    return c
