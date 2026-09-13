"""Wave K Slice 3 — rails for ranking and the evidence budget.

The properties here are the ones an answer can get wrong quietly:
  - a weak lexical brush placed above an exact structured record
  - a curation boost that also inflates the corroboration count
  - entity context promoted into evidence that backs a claim
  - a diversity rule that evicts the single most authoritative source
  - an unbounded packet, or an order that is not reproducible

Each rail is written so that deleting the guard it names makes it RED —
several assert the NEGATIVE ordering that the naive implementation produced,
so they cannot pass for the wrong reason.
"""
from __future__ import annotations

import random

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_ranking as rk

Q = ev.QUERY_MATCH
CTX = ev.ENTITY_CONTEXT


# ── Builders (the real envelope constructors, never hand-rolled dicts) ───────

def note(nid, score, *, title="Untitled note", text="note body", rel=Q):
    e = ev.from_note({"id": nid, "user_id": "u1", "title": title},
                     snippet=text, location=None,
                     citation_validity=ev.CITE_NOTE_ONLY, score=score)
    e["relevance"] = rel
    return e


def page(doc, pn, *, score=0.5, text="page text", rel=Q):
    e = ev.from_document_page(
        {"document_id": doc, "page_number": pn, "user_id": "u1",
         "name": "deck.pdf", "text_origin": "native"},
        snippet=text, score=score)
    e["relevance"] = rel
    return e


def excerpt(eid, *, doc="d1", pn=2, score=0.7, text="saved passage", rel=Q):
    e = ev.from_excerpt({"id": eid, "user_id": "u1", "document_id": doc,
                         "page_number": pn, "document_name": "deck.pdf",
                         "captured_text": text, "quote_prefix": "",
                         "quote_suffix": "", "annotation": None},
                        anchor_ok=True, score=score)
    e["relevance"] = rel
    return e


def fact(fid, *, score=0.8, rel=Q):
    e = ev.from_fact({"id": fid, "user_id": "u1", "note_id": "n1",
                      "entity_id": "E:NVDA", "ticker": "NVDA",
                      "fact_type": "price", "value_number": 142.83,
                      "unit": "usd_per_share", "currency": "USD",
                      "period": None, "temporal_mode": "snapshot",
                      "observed_at": None, "source_as_of": None,
                      "source": "massive", "rights_class": "independent",
                      "caption": None}, score=score)
    e["relevance"] = rel
    return e


def thesis(nid, *, title="NVDA thesis", score=0.9, rel=Q):
    e = ev.from_thesis_state({"id": nid, "user_id": "u1", "title": title,
                              "ticker": "NVDA"},
                             properties={"builtin:thesis_status": "active"},
                             evidence_counts={"supports": 2, "opposes": 1},
                             score=score)
    e["relevance"] = rel
    return e


def ids(items):
    return [i["source_id"] for i in items]


# ── 1. Exact structured / entity matches outrank weak lexical noise ─────────

class TestStructuredBeatsLexicalNoise:
    def test_a_structured_record_outranks_the_strongest_lexical_match(self):
        # NON-VACUOUS: two notes, so the winning note normalizes to 1.0 while
        # the lone thesis record normalizes to the neutral floor. Drop the
        # tier from the sort key and the note wins on magnitude alone.
        items = [note("n9", 999.0), note("n8", 1.0), thesis("t1")]
        ranked = rk.rank(items, "what is my thesis")
        assert ranked[0]["source_id"] == "t1"
        assert ranked[0]["tier_name"] == "structured"
        assert ranked[1]["norm_score"] > ranked[0]["norm_score"]

    def test_a_financial_fact_is_structured_too(self):
        ranked = rk.rank([note("n1", 50.0), note("n2", 1.0), fact("f1")], "price")
        assert ranked[0]["source_id"] == "f1"

    def test_a_title_the_member_chose_outranks_a_stronger_body_match(self):
        items = [note("n1", 90.0, title="Random musings"),
                 note("n2", 0.1, title="NVDA margin pressure")]
        ranked = rk.rank(items, "NVDA margin pressure")
        assert ids(ranked) == ["n2", "n1"]
        assert ranked[0]["tier_name"] == "title"

    def test_a_one_letter_title_is_a_coincidence_not_a_title_match(self):
        ranked = rk.rank([note("n1", 1.0, title="a")], "a longer question")
        assert ranked[0]["tier_name"] == "lexical"


# ── 2. Curation boosts relevance, never corroboration ───────────────────────

class TestCurationBoost:
    def test_a_saved_excerpt_outranks_a_raw_page(self):
        ranked = rk.rank([page("d1", 7), excerpt("e1", pn=2)], "margins")
        assert ids(ranked) == ["e1", "d1#p7"]
        assert ranked[0]["tier_name"] == "curated"

    def test_a_thesis_attached_excerpt_outranks_a_merely_saved_one(self):
        attached = ev.with_stance(excerpt("e1", pn=2), "supports", None, "n1")
        ranked = rk.rank([excerpt("e2", pn=5), attached], "margins")
        assert ids(ranked) == ["e1", "e2"]
        assert ranked[0]["tier_name"] == "attached"

    def test_the_boost_does_not_buy_a_second_corroborating_source(self):
        # The member saved ONE quote from page 2. The page also matched.
        out = rk.packet([page("d1", 2), excerpt("e1", pn=2)], "margins")
        assert len(out["evidence"]) == 1
        assert out["independent_sources"] == 1

    def test_two_distinct_passages_are_two_sources(self):
        out = rk.packet([note("n1", 3.0), excerpt("e1", pn=2)], "margins")
        assert out["independent_sources"] == 2


# ── 3. Page + excerpt lineage dedupes correctly ─────────────────────────────

class TestLineageDedupe:
    def test_a_page_and_the_excerpt_saved_from_it_collapse(self):
        out = rk.packet([page("d1", 2), excerpt("e1", doc="d1", pn=2)], "q")
        assert ids(out["evidence"]) == ["e1"]
        assert out["evidence"][0]["absorbed"][0]["source_id"] == "d1#p2"

    def test_the_curated_record_is_the_survivor(self):
        out = rk.packet([excerpt("e1", doc="d1", pn=2), page("d1", 2)], "q")
        assert out["evidence"][0]["source_type"] == ev.DOCUMENT_EXCERPT

    def test_a_different_page_of_the_same_document_stays_separate(self):
        out = rk.packet([page("d1", 2), excerpt("e1", doc="d1", pn=3)], "q")
        assert out["independent_sources"] == 2

    def test_the_same_page_of_a_different_document_stays_separate(self):
        out = rk.packet([page("d1", 2), page("d2", 2)], "q")
        assert out["independent_sources"] == 2


# ── 4. entity_context never upgrades into answer evidence ───────────────────

class TestContextNeverBecomesEvidence:
    def test_context_ranks_below_every_answer_tier(self):
        ranked = rk.rank([thesis("t1", rel=CTX), note("n1", 0.1)], "q")
        assert ids(ranked) == ["n1", "t1"]
        assert ranked[1]["tier_name"] == "context"

    def test_context_is_absent_from_answer_evidence(self):
        out = rk.packet([note("n1", 3.0), fact("f1", rel=CTX)], "q")
        assert ids(out["evidence"]) == ["n1", "f1"]
        assert ids(out["answer_evidence"]) == ["n1"]

    def test_context_does_not_count_toward_independent_sources(self):
        out = rk.packet([note("n1", 3.0), fact("f1", rel=CTX),
                         thesis("t1", rel=CTX)], "q")
        assert out["independent_sources"] == 1

    def test_a_stance_marked_context_item_is_still_context(self):
        # with_stance raises curation to 2 -- the tier must not read that as
        # member curation and promote it into an answer tier.
        marked = ev.with_stance(fact("f1", rel=CTX), "supports", "why", "n1")
        out = rk.packet([note("n1", 3.0), marked], "q")
        assert marked["curation"] == 2
        assert ids(out["answer_evidence"]) == ["n1"]

    def test_an_unlabelled_item_is_not_answer_evidence(self):
        # Fail closed: a caller that forgets to label its results makes the
        # system say it found nothing, never invent a confident answer.
        unlabelled = note("n1", 3.0)
        del unlabelled["relevance"]
        out = rk.packet([unlabelled], "q")
        assert out["evidence"] and out["answer_evidence"] == []
        assert out["no_answer"] is True


# ── 5. no_answer survives the presence of context ───────────────────────────

class TestNoAnswerWithContext:
    def test_a_packet_of_pure_context_reports_no_answer(self):
        out = rk.packet([thesis("t1", rel=CTX), fact("f1", rel=CTX)], "zebras")
        assert out["no_answer"] is True
        assert out["independent_sources"] == 0

    def test_the_context_is_still_returned_alongside_the_refusal(self):
        out = rk.packet([thesis("t1", rel=CTX)], "zebras")
        assert len(out["evidence"]) == 1
        assert out["no_answer"] is True

    def test_one_real_match_is_enough_to_lift_no_answer(self):
        out = rk.packet([thesis("t1", rel=CTX), note("n1", 0.2)], "q")
        assert out["no_answer"] is False


# ── 6. Diversity must not evict authority ───────────────────────────────────

class TestDiversityNeverEvictsAuthority:
    def test_forty_pages_cannot_push_out_the_structured_record(self):
        items = [page("d1", i) for i in range(40)] + [thesis("t1")]
        out = rk.packet(items, "what is my thesis")
        assert "t1" in ids(out["evidence"])
        assert out["evidence"][0]["source_id"] == "t1"

    def test_forty_pages_cannot_push_out_the_members_own_note(self):
        items = [page("d1", i) for i in range(40)] + [note("n1", 0.4)]
        out = rk.packet(items, "q")
        assert "n1" in ids(out["evidence"])
        assert sum(1 for i in out["evidence"]
                   if i["source_type"] == ev.DOCUMENT_PAGE) <= rk.MAX_PER_SOURCE_TYPE

    def test_the_cap_never_drops_the_first_of_a_tier_and_type(self):
        items = [page("d1", i) for i in range(10)] + [excerpt("e1", pn=99)]
        out = rk.packet(items, "q", max_per_type=1)
        assert ids(out["evidence"]) == ["e1", "d1#p0"]

    def test_a_zero_cap_cannot_silence_a_source_type(self):
        # The cap floor is the mechanism, not the default value: even asked
        # for zero per type, the best of each tier-and-type survives.
        items = [page("d1", i) for i in range(5)] + [note("n1", 0.4)]
        out = rk.packet(items, "q", max_per_type=0)
        assert ids(out["evidence"]) == ["n1", "d1#p0"]

    def test_the_cap_is_counted_inside_a_tier_not_across_tiers(self):
        # Excerpts (curated) and pages (lexical) are the same source family
        # but different tiers; one must not spend the others budget.
        items = [excerpt(f"e{i}", pn=100 + i) for i in range(3)] + \
                [page("d2", i) for i in range(3)]
        out = rk.packet(items, "q", max_per_type=3, max_items=8)
        assert len(out["evidence"]) == 6


# ── 7. The packet is bounded ────────────────────────────────────────────────

class TestBudgetBounds:
    def test_item_count_is_bounded(self):
        out = rk.packet([note(f"n{i}", float(i)) for i in range(50)], "q")
        assert len(out["evidence"]) <= rk.MAX_ITEMS

    def test_character_count_is_bounded(self):
        items = [note(f"n{i}", float(i), text="x" * 4000) for i in range(9)]
        out = rk.packet(items, "q")
        assert out["chars"] <= rk.MAX_CHARS

    def test_one_oversized_item_is_truncated_rather_than_dropped(self):
        out = rk.packet([note("n1", 1.0, text="y" * 20000)], "q")
        assert ids(out["evidence"]) == ["n1"]
        assert out["evidence"][0]["truncated"] is True
        assert out["chars"] == rk.MAX_CHARS

    def test_a_fragment_below_the_useful_floor_is_not_admitted(self):
        big = note("n1", 9.0, text="y" * (rk.MAX_CHARS - 100))
        small = note("n2", 1.0, text="z" * 500)
        out = rk.packet([big, small], "q")
        assert ids(out["evidence"]) == ["n1"]
        assert out["dropped"] == 1

    def test_a_later_item_that_still_fits_whole_is_admitted(self):
        big = note("n1", 9.0, text="y" * (rk.MAX_CHARS - 400))
        small = note("n2", 1.0, text="z" * 50)
        out = rk.packet([big, small], "q")
        assert ids(out["evidence"]) == ["n1", "n2"]

    def test_an_empty_candidate_set_is_an_empty_packet(self):
        out = rk.packet([], "q")
        assert out == {"evidence": [], "answer_evidence": [],
                       "independent_sources": 0, "no_answer": True,
                       "dropped": 0, "chars": 0}


# ── 8. Ranking is deterministic ─────────────────────────────────────────────

class TestDeterminism:
    def _mixed(self):
        return [note("n1", 8.0), note("n2", 0.2), page("d1", 1), page("d1", 2),
                excerpt("e1", pn=9), fact("f1", rel=CTX), thesis("t1")]

    def test_the_same_input_ranks_identically_twice(self):
        items = self._mixed()
        assert ids(rk.rank(items, "q")) == ids(rk.rank(items, "q"))

    def test_ranking_is_stable_under_permutation(self):
        items = self._mixed()
        expected = ids(rk.rank(items, "q"))
        rng = random.Random(20260907)
        for _ in range(25):
            shuffled = items[:]
            rng.shuffle(shuffled)
            assert ids(rk.rank(shuffled, "q")) == expected

    def test_ranking_does_not_mutate_its_input(self):
        items = self._mixed()
        before = [dict(i) for i in items]
        rk.rank(items, "q")
        assert items == before


# ── 9. Score scales are normalized deliberately, not concatenated ───────────

class TestScoreNormalization:
    def test_normalization_happens_inside_a_source_type(self):
        ranked = rk.rank([note("n1", 8.0), note("n2", 4.0), note("n3", 0.0)], "q")
        by_id = {i["source_id"]: i["norm_score"] for i in ranked}
        assert by_id["n1"] == 1.0
        assert by_id["n3"] == rk.NORM_FLOOR
        assert by_id["n2"] == rk.NORM_FLOOR + (1.0 - rk.NORM_FLOOR) * 0.5

    def test_a_constant_scored_type_lands_on_the_floor_not_the_top(self):
        # Every page carries the same hand-picked 0.5. That is not evidence
        # of being the best of its type -- it is the absence of a signal.
        ranked = rk.rank([page("d1", i) for i in range(4)], "q")
        assert {i["norm_score"] for i in ranked} == {rk.NORM_FLOOR}

    def test_a_lone_item_of_a_type_gets_the_neutral_floor(self):
        ranked = rk.rank([note("n1", 8.0)], "q")
        assert ranked[0]["norm_score"] == rk.NORM_FLOOR

    def test_a_bm25_magnitude_is_never_weighed_against_a_page_constant(self):
        # n2 raw score 0.2 vs a page raw 0.5. Compared blindly the page wins;
        # normalized within type they tie at the floor and the DECLARED type
        # prior decides. This is the exact ordering the old sort got wrong.
        ranked = rk.rank([note("n1", 8.0), note("n2", 0.2), page("d1", 1)], "q")
        assert ids(ranked) == ["n1", "n2", "d1#p1"]

    def test_ties_resolve_by_the_declared_prior_not_the_alphabet(self):
        # "document_page" sorts before "note" alphabetically. If TYPE_PRIOR is
        # dropped from the sort key, this flips.
        ranked = rk.rank([page("d1", 1), note("n1", 5.0)], "q")
        assert ids(ranked) == ["n1", "d1#p1"]
        assert ranked[0]["norm_score"] == ranked[1]["norm_score"]

    def test_the_declared_prior_covers_every_source_type(self):
        assert set(rk.TYPE_PRIOR) == set(ev.SOURCE_TYPES)
