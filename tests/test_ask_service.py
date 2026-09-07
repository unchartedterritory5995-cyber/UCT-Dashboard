"""Wave K Slice 6 — rails for the one Ask pipeline.

The properties that matter once four features become one:
  - the scope shown to the member is the scope that was searched
  - ranking internals never cross the wire
  - a follow-up re-retrieves, and never from the assistant's own words
  - "no answer" costs nothing and cannot be talked out of
  - telemetry carries counts, never content
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_service as asvc


def _note(text, *, label="NVDA thesis", nid="n1", rel=ev.QUERY_MATCH):
    e = ev.from_note({"id": nid, "user_id": "u1", "title": label},
                     snippet=text, location={"from": 1, "to": 9,
                                             "fingerprint": "abc:12"},
                     citation_validity=ev.CITE_EXACT, score=3.0)
    e["relevance"] = rel
    return e


class TestScopeIsWhatWasSearched:
    def test_every_scope_has_a_label_and_a_refusal(self):
        for scope in asvc.SCOPES:
            spec = asvc._SCOPES[scope]
            assert spec["label"]("NVDA", {})
            assert spec["refusal"]("NVDA", {}).startswith("I couldn't find")

    def test_the_security_scope_names_the_security(self):
        assert asvc._SCOPES[asvc.SECURITY]["label"]("nvda", {}) == "NVDA research"
        assert "NVDA" in asvc._SCOPES[asvc.SECURITY]["refusal"]("nvda", {})

    def test_the_document_scope_names_the_document_when_known(self):
        label = asvc._SCOPES[asvc.DOCUMENT]["label"](
            "d1", {"coverage": {"name": "10-Q.pdf"}})
        assert label == "This document (10-Q.pdf)"

    def test_an_unknown_scope_is_refused_not_defaulted(self):
        # Silently falling back to a wider scope would answer from a corpus
        # the member never asked about.
        with pytest.raises(ValueError):
            asvc.retrieve("u1", "everything", None, "q")

    def test_a_scope_that_needs_a_target_refuses_without_one(self):
        with pytest.raises(ValueError):
            asvc.retrieve("u1", asvc.DOCUMENT, None, "q")


class TestRankingInternalsNeverCrossTheWire:
    FORBIDDEN = ("tier", "tier_name", "norm_score", "score", "lineage_key",
                 "absorbed", "user_id", "relevance", "source_id")

    def test_the_projection_drops_every_ranking_field(self):
        item = _note("body")
        item.update({"tier": 4, "tier_name": "lexical", "norm_score": 0.5,
                     "lineage_key": "note:n1", "absorbed": []})
        out = asvc.public_source(1, item)
        blob = json.dumps(out)
        for field in self.FORBIDDEN:
            assert f'"{field}"' not in blob, f"{field} reached the client"

    def test_the_projection_keeps_what_the_member_needs(self):
        out = asvc.public_source(3, _note("margins fell"))
        assert out["n"] == 3
        assert out["type"] == ev.NOTE
        assert out["label"] == "NVDA thesis"
        assert out["citation"] == ev.CITE_EXACT
        assert out["snippet"] == "margins fell"
        assert out["navigation"]["note_id"] == "n1"
        assert out["location"]["fingerprint"] == "abc:12"

    def test_a_long_snippet_is_capped(self):
        out = asvc.public_source(1, _note("x" * 5000))
        assert len(out["snippet"]) == asvc._SNIPPET_CAP

    def test_structured_payloads_survive_intact(self):
        # §15: value/unit/period/temporal_mode must reach the member, or a
        # snapshot reads as a current price.
        fact = ev.from_fact({"id": "f1", "user_id": "u1", "note_id": "n1",
                             "entity_id": "E:NVDA", "ticker": "NVDA",
                             "fact_type": "price", "value_number": 142.83,
                             "unit": "usd_per_share", "currency": "USD",
                             "period": None, "temporal_mode": "snapshot",
                             "observed_at": "2026-09-04T14:00:00Z",
                             "source_as_of": None, "source": "massive",
                             "rights_class": "independent", "caption": None})
        out = asvc.public_source(1, fact)
        assert out["payload"]["value_number"] == 142.83
        assert out["payload"]["unit"] == "usd_per_share"


class TestFollowUpsReGround:
    def test_a_follow_up_retrieves_with_the_members_prior_question(self):
        q = asvc._retrieval_query(
            "what about the risks?",
            [{"q": "summarise my NVDA thesis", "a": "Your thesis is bullish."}])
        assert "NVDA thesis" in q
        assert "what about the risks?" in q

    def test_the_assistants_previous_answer_never_steers_retrieval(self):
        # ⛔ Model output is not evidence. If it could steer retrieval, one
        # hallucinated noun becomes the corpus query for the rest of a thread.
        q = asvc._retrieval_query(
            "and the risks?",
            [{"q": "my thesis", "a": "Your thesis mentions QUANTUM COMPUTING."}])
        assert "QUANTUM" not in q

    def test_no_history_means_the_question_alone(self):
        assert asvc._retrieval_query("margins", None) == "margins"

    def test_the_retrieval_query_is_bounded(self):
        q = asvc._retrieval_query("x" * 400, [{"q": "y" * 400, "a": "z"}])
        assert len(q) <= 600


class TestCoverageNoticeOnlyWhenItMatters:
    def test_a_clean_corpus_produces_no_notice(self):
        assert asvc.coverage_notice(asvc.NOTEBOOK, {"coverage": {
            "notes_searchable": 10, "documents_not_searchable": 0}}) is None

    def test_unsearchable_documents_are_declared(self):
        msg = asvc.coverage_notice(asvc.NOTEBOOK, {"coverage": {
            "documents_not_searchable": 2}})
        assert "2 attached documents couldn't be searched" in msg

    def test_one_document_is_singular(self):
        msg = asvc.coverage_notice(asvc.NOTEBOOK, {"coverage": {
            "documents_not_searchable": 1}})
        assert "1 attached document couldn't" in msg

    @pytest.mark.parametrize("status,fragment", [
        ("pending", "still being processed"),
        ("no_text", "No readable text"),
        ("processing_failed", "couldn't be processed"),
    ])
    def test_a_document_scope_declares_its_own_state(self, status, fragment):
        msg = asvc.coverage_notice(asvc.DOCUMENT, {"coverage": {
            "exists": True, "status": status}})
        assert fragment in msg

    def test_an_empty_note_says_so(self):
        msg = asvc.coverage_notice(asvc.NOTE, {"coverage": {
            "exists": True, "has_text": False}})
        assert "doesn't have any text" in msg


class TestStreamingNeverEmitsAHalfHandle:
    @pytest.mark.parametrize("chunk,safe,held", [
        ("margins fell [1", "margins fell ", "[1"),
        ("margins fell [1]", "margins fell [1]", ""),
        ("margins fell [", "margins fell ", "["),
        ("no handles here", "no handles here", ""),
        ("a [123456 long", "a [123456 long", ""),  # too long to be a handle
    ])
    def test_hold_back(self, chunk, safe, held):
        assert asvc.hold_back(chunk) == (safe, held)

    def test_a_handle_is_never_split_across_two_emissions(self):
        # Streamed one character at a time, the rendered text must never
        # contain a bracket that is not yet a complete handle.
        emitted, buffered = "", ""
        for ch in "margins fell [1] sharply":
            buffered += ch
            safe, buffered = asvc.hold_back(buffered)
            emitted += safe
            assert "[" not in emitted or "]" in emitted
        assert emitted + buffered == "margins fell [1] sharply"


class TestCitationResolution:
    def test_a_valid_handle_resolves_to_the_source_that_was_sent(self):
        prepared = {"items": [_note("a", nid="n1"), _note("b", nid="n2")]}
        out = asvc.resolve_answer("margins fell [2].", prepared)
        assert out["cited"] == [2]
        assert out["hallucinated_citation"] is False

    def test_an_invented_handle_is_reported_and_not_resolved(self):
        prepared = {"items": [_note("a")]}
        out = asvc.resolve_answer("as stated [7]", prepared)
        assert out["cited"] == []
        assert out["invalid"] == [7]
        assert out["hallucinated_citation"] is True


class TestTelemetryCarriesCountsNeverContent:
    def test_no_member_content_appears_anywhere(self):
        prepared = {
            "sources": [asvc.public_source(1, _note("margins compressed in Q3",
                                                    label="SECRET NVDA THESIS"))],
            "items": [], "answerable": 1, "independent_sources": 1,
            "no_answer": False, "coverage_notice": None,
        }
        out = asvc.telemetry(asvc.NOTE, prepared, started=0.0, settled=True,
                             answered=True, resolved={"cited": [1],
                                                      "hallucinated_citation": False})
        blob = json.dumps(out).lower()
        for secret in ("margins", "compressed", "secret", "thesis", "nvda"):
            assert secret not in blob

    def test_it_carries_what_operating_the_feature_needs(self):
        prepared = {"sources": [1, 2, 3], "items": [], "answerable": 2,
                    "independent_sources": 2, "no_answer": False,
                    "coverage_notice": "some limit"}
        out = asvc.telemetry(asvc.NOTEBOOK, prepared, started=0.0, settled=True,
                             answered=True)
        assert out["scope"] == "notebook"
        assert out["sources"] == 3 and out["answerable"] == 2
        assert out["hadCoverageNotice"] is True
        assert out["elapsedMs"] >= 0
