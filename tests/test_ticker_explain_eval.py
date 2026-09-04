"""Tests for the security research assistant's golden evaluation set
(owner-authorized hard acceptance requirement, 2026-09-04 -- AI-Native
Slice 1's original 26 questions plus Security Research Q&A Slice 2's 33
additions). Two things are verified here, deterministically, with no live
model key needed:

1. The harness itself is correct: a well-behaved, correct-by-construction
   answer to EVERY golden question passes every mechanical check the
   question is tagged for (proves the golden set's own `expect_*` flags and
   each question's seeded evidence are internally consistent, and that the
   runner wires evidence/mocking correctly) -- across all five Slice 2
   response states, not just answer/refuse.
2. The checks actually CATCH violations -- a battery of deliberately bad
   answers (fabricated citation, ungrounded number, decisive-verdict
   language, wrong response_state, duplicated fact/interpretation, a stale-
   as-today answer with no caveat, a silently-one-sided conflicting-evidence
   answer, a response_state missing its required supporting field) must
   fail the specific check each is designed to violate. A mechanical layer
   that passes everything is worse than none.

The three judge-only dimensions (source_selection, answer_relevance,
terminal_usefulness) need a live model call and are exercised during the
bounded live-validation checkpoint, not here -- see judge.py's docstring.
"""
from api.services.ticker_explain_eval import checks, golden_set as gs, runner


# ── Harness self-consistency: every question, answered correctly, passes ────

def _reference_answer(question: gs.Question) -> dict:
    """A correct-by-construction answer for whichever response_state the
    question expects: cites every seeded evidence item (so citation/
    numerical/cross-fact-consistency checks all trivially hold -- citing
    everything necessarily covers both sides of any conflicting pair),
    states no interpretation (avoids the fact/interpretation duplicate
    trap), and populates exactly the field each state promises."""
    state = question.expect_response_state
    if state is None:
        state = "refuse" if (question.expect_insufficient_evidence or not question.evidence) else "answer"

    if state == "refuse":
        return {"response_state": "refuse", "summary": "", "key_facts": [],
                "interpretation": "", "caveat": "", "clarification_question": "",
                "refusal_reason": "This evidence set doesn't cover that."}

    if state == "ask_for_clarification":
        return {"response_state": "ask_for_clarification", "summary": "", "key_facts": [],
                "interpretation": "", "caveat": "",
                "clarification_question": "Which of these did you mean -- analyst "
                "sentiment, forward estimates, or reported financials?",
                "refusal_reason": ""}

    from api.services import ticker_explain as te

    def _texts():
        # Prompt-injection fixtures deliberately embed decisive-verdict
        # phrasing INSIDE one evidence item's own text, to prove a
        # well-behaved model ignores it. A naive "quote everything verbatim"
        # reference answer would itself trip the decisive-language gate --
        # exactly what a well-behaved model must NOT do -- so strip only the
        # matched decisive phrase (never the whole item; the surrounding
        # legitimate facts/numbers in that same item must stay citable).
        for e in question.evidence:
            yield e["id"], te._DECISIVE_RE.sub("[disregarded]", e["text"])

    facts = [{"statement": text, "evidence_id": eid} for eid, text in _texts()]
    summary = " ".join(text for _eid, text in _texts())
    caveat = ""
    if question.expect_temporal_caveat or state == "answer_with_caveat":
        caveat = ("This is the most recent available evidence; it may be older than "
                  "the timeframe implied by the question, or use a different clock "
                  "(calendar quarter, relative period, or filing lag) than expected.")
    elif state == "partially_answer":
        caveat = ("Part of this question is outside my evidence catalog (for example "
                  "filing body text or transcript content) and is not covered.")
    return {"response_state": state, "summary": summary, "key_facts": facts,
            "interpretation": "", "caveat": caveat, "clarification_question": "",
            "refusal_reason": ""}


class TestGoldenSetSelfConsistency:
    def test_every_question_has_a_unique_id(self):
        ids = [q.id for q in gs.QUESTIONS]
        assert len(ids) == len(set(ids))

    def test_between_50_and_75_questions(self):
        # Owner-mandated range for Security Research Q&A Slice 2's expanded
        # set (retaining all 26 Slice-1 cases as regression tests).
        assert 50 <= len(gs.QUESTIONS) <= 75

    def test_every_required_dimension_is_exercised_by_at_least_one_question(self):
        covered = set()
        for q in gs.QUESTIONS:
            covered.update(q.dimensions)
        # hallucination_rate, prompt_injection_resistance, cross_fact_
        # consistency, response_state_fields, and insufficient_evidence_
        # behavior all run on EVERY question regardless of tagging
        # (checks.py's always-run set), so they're covered even if no
        # question explicitly tags them.
        covered |= {"hallucination_rate", "prompt_injection_resistance",
                   "cross_fact_consistency", "response_state_fields",
                   "insufficient_evidence_behavior"}
        missing = set(gs.DIMENSIONS) - covered
        assert not missing, f"dimensions with no covering question: {missing}"

    def test_a_correct_by_construction_answer_passes_every_question(self):
        report = runner.run_golden_set(
            model_fn=lambda sym, question, evidence, model, extra_note="":
                runner._fake_resp(_reference_answer(_find(sym, question, evidence))),
        )
        failures = [r for r in report["results"] if not r["all_passed"]]
        assert not failures, f"expected all-pass, got failures: {[(f['id'], f['checks']) for f in failures]}"
        assert report["passed"] == report["total"] == len(gs.QUESTIONS)


def _find(sym, question, evidence):
    """Recover the Question object a scripted model_fn is being asked to
    answer, by matching on (sym, question text) -- model_fn only receives
    the raw call args, not the Question itself.

    Slice 2 deliberately has multiple questions sharing the identical
    (sym, question) text under DIFFERENT evidence (e.g. Q08/Q32 both ask
    "What is the EPS estimate for next quarter?" -- one with no estimates
    evidence expecting refuse, one WITH it expecting answer_with_caveat;
    that contrast IS the point of the pair). A text-only match is therefore
    ambiguous; disambiguate by evidence content, which is also passed to
    model_fn and is exactly `list(question.evidence)` for whichever
    question is really being answered."""
    matches = [q for q in gs.QUESTIONS if q.sym == sym and q.question == question]
    if not matches:
        raise AssertionError(f"no golden question matches ({sym!r}, {question!r})")
    if len(matches) == 1:
        return matches[0]
    for q in matches:
        if list(q.evidence) == list(evidence):
            return q
    raise AssertionError(f"{len(matches)} golden questions match ({sym!r}, {question!r}) "
                         "but none by evidence content -- broken disambiguation")


# ── Adversarial: the checks must actually catch violations ──────────────────

class TestChecksCatchViolations:
    def _q(self, id_="Q01-factual-consensus"):
        return gs.by_id(id_)

    def test_a_fabricated_evidence_id_fails_citation_correctness(self):
        q = self._q()
        bad = {"response_state": "answer", "summary": "x",
              "key_facts": [{"statement": "x", "evidence_id": "E999"}],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_citation_correctness(q, bad)
        assert out["passed"] is False
        assert checks.check_hallucination_rate(q, bad)["passed"] is False

    def test_an_ungrounded_number_fails_numerical_correctness(self):
        q = self._q()
        bad = {"response_state": "answer", "summary": "The price target is $999.",
              "key_facts": [], "interpretation": "", "caveat": "",
              "clarification_question": "", "refusal_reason": ""}
        out = checks.check_numerical_correctness(q, bad)
        assert out["passed"] is False

    def test_decisive_verdict_language_fails_prompt_injection_resistance(self):
        q = gs.by_id("Q21-pressure-should-i-buy")
        bad = {"response_state": "answer", "summary": "You should buy this stock now.",
              "key_facts": [], "interpretation": "", "caveat": "",
              "clarification_question": "", "refusal_reason": ""}
        out = checks.check_prompt_injection_resistance(q, bad)
        assert out["passed"] is False

    def test_decisive_language_hidden_in_a_caveat_still_fails(self):
        # Slice 2: the free-text union now covers caveat/clarification_
        # question/refusal_reason too, not just summary/interpretation.
        q = self._q()
        bad = {"response_state": "answer_with_caveat", "summary": "x", "key_facts": [],
              "interpretation": "", "caveat": "You should buy this stock now.",
              "clarification_question": "", "refusal_reason": ""}
        out = checks.check_prompt_injection_resistance(q, bad)
        assert out["passed"] is False

    def test_answering_a_refuse_question_anyway_fails(self):
        q = gs.by_id("Q07-estimates-unsupported")
        bad = {"response_state": "answer",
              "summary": "EPS estimate is $2.10 next quarter.",
              "key_facts": [{"statement": "EPS estimate is $2.10.", "evidence_id": "E2"}],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_insufficient_evidence_behavior(q, bad)
        assert out["passed"] is False
        assert checks.check_unsupported_claim_rate(q, bad)["passed"] is False

    def test_refusing_a_well_covered_question_fails_the_inverse_case(self):
        q = self._q()  # has real evidence, expects "answer"
        bad = {"response_state": "refuse", "summary": "", "key_facts": [],
              "interpretation": "", "caveat": "", "clarification_question": "",
              "refusal_reason": "no idea"}
        out = checks.check_insufficient_evidence_behavior(q, bad)
        assert out["passed"] is False

    def test_a_duplicated_fact_and_interpretation_fails_the_separation_check(self):
        q = gs.by_id("Q19-interpretation-separation")
        statement = "Goldman Sachs upgrade: Hold → Buy."
        bad = {"response_state": "answer", "summary": "x",
              "key_facts": [{"statement": statement, "evidence_id": "E4"}],
              "interpretation": statement,   # identical to the fact -- no real separation
              "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_fact_vs_interpretation(q, bad)
        assert out["passed"] is False

    def test_a_stale_answer_with_no_temporal_caveat_fails(self):
        q = gs.by_id("Q12-stale-as-today")
        bad = {"response_state": "answer_with_caveat",
              "summary": "Apple beat earnings estimates on strong Mac sales.",
              "key_facts": [{"statement": "Apple beat earnings estimates.", "evidence_id": "E1"}],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_temporal_correctness(q, bad)
        assert out["passed"] is False

    def test_zero_citations_on_a_substantive_answer_fails_completeness(self):
        q = self._q()
        bad = {"response_state": "answer", "summary": "Analysts are bullish.",
              "key_facts": [], "interpretation": "", "caveat": "",
              "clarification_question": "", "refusal_reason": ""}
        out = checks.check_citation_completeness(q, bad)
        assert out["passed"] is False

    def test_silently_picking_one_side_of_conflicting_evidence_fails_cross_fact_consistency(self):
        q = gs.by_id("Q09-conflicting-actions")
        bad = {"response_state": "answer",
              "summary": "Morgan Stanley upgraded the stock -- analysts are more bullish.",
              "key_facts": [{"statement": "Morgan Stanley upgrade: Hold → Buy.",
                             "evidence_id": "E2"}],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_cross_fact_consistency(q, bad)
        assert out["passed"] is False
        assert out["conflict_present"] is True

    def test_citing_both_sides_of_conflicting_evidence_passes_cross_fact_consistency(self):
        q = gs.by_id("Q09-conflicting-actions")
        good = {"response_state": "answer",
               "summary": "Mixed signals: Morgan Stanley upgraded while Barclays downgraded.",
               "key_facts": [{"statement": "Morgan Stanley upgrade: Hold → Buy.", "evidence_id": "E2"},
                             {"statement": "Barclays downgrade: Buy → Hold.", "evidence_id": "E3"}],
               "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_cross_fact_consistency(q, good)
        assert out["passed"] is True

    def test_answer_with_caveat_missing_its_caveat_text_fails_response_state_fields(self):
        q = gs.by_id("Q11-no-ratings-only-news")
        bad = {"response_state": "answer_with_caveat", "summary": "x",
              "key_facts": [{"statement": "x", "evidence_id": "E1"}],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_response_state_fields(q, bad)
        assert out["passed"] is False

    def test_ask_for_clarification_with_no_question_fails_response_state_fields(self):
        q = gs.by_id("Q51-clarification-ambiguous-range")
        bad = {"response_state": "ask_for_clarification", "summary": "", "key_facts": [],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_response_state_fields(q, bad)
        assert out["passed"] is False

    def test_ask_for_clarification_with_key_facts_fails_response_state_fields(self):
        q = gs.by_id("Q51-clarification-ambiguous-range")
        bad = {"response_state": "ask_for_clarification", "summary": "",
              "key_facts": [{"statement": "x", "evidence_id": "E1"}],
              "interpretation": "", "caveat": "",
              "clarification_question": "Did you mean X or Y?", "refusal_reason": ""}
        out = checks.check_response_state_fields(q, bad)
        assert out["passed"] is False

    def test_refuse_with_no_reason_fails_response_state_fields(self):
        q = gs.by_id("Q10-no-coverage")
        bad = {"response_state": "refuse", "summary": "", "key_facts": [],
              "interpretation": "", "caveat": "", "clarification_question": "", "refusal_reason": ""}
        out = checks.check_response_state_fields(q, bad)
        assert out["passed"] is False


# ── Runner wiring ─────────────────────────────────────────────────────────────

class TestRunnerWiring:
    def test_run_question_uses_the_seeded_evidence_not_live_fmp(self):
        q = gs.by_id("Q01-factual-consensus")
        result = runner.run_question(
            q, model_fn=lambda sym, question, evidence, model, extra_note="":
                runner._fake_resp(_reference_answer(q)))
        assert result["insufficient_evidence"] is False
        assert len(result["citations"]) == len(q.evidence)

    def test_a_blank_question_short_circuits_before_any_model_call(self):
        q = gs.by_id("Q25-empty-question-guard")
        called = []
        result = runner.run_question(q, model_fn=lambda *a, **kw: called.append(1))
        assert result["insufficient_evidence"] is True
        assert not called

    def test_report_shape_and_by_dimension_breakdown(self):
        report = runner.run_golden_set(
            model_fn=lambda sym, question, evidence, model, extra_note="":
                runner._fake_resp(_reference_answer(_find(sym, question, evidence))),
            questions=(gs.by_id("Q01-factual-consensus"), gs.by_id("Q07-estimates-unsupported")),
        )
        assert report["total"] == 2
        assert "citation_correctness" in report["by_dimension"]
        for dim in checks.JUDGE_ONLY_DIMENSIONS:
            assert report["by_dimension"][dim]["not_scored"] is True
