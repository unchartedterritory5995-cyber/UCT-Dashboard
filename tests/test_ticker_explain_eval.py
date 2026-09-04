"""Tests for the Explain-assistant golden evaluation set (owner-authorized
hard acceptance requirement, 2026-09-04). Two things are verified here,
deterministically, with no live model key needed:

1. The harness itself is correct: a well-behaved, correct-by-construction
   answer to EVERY one of the 26 golden questions passes every mechanical
   check the question is tagged for (proves the golden set's own
   `expect_*` flags and each question's seeded evidence are internally
   consistent, and that the runner wires evidence/mocking correctly).
2. The checks actually CATCH violations -- a battery of deliberately bad
   answers (fabricated citation, ungrounded number, decisive-verdict
   language, wrong insufficient-evidence call, duplicated fact/
   interpretation, a stale-as-today answer with no caveat) must fail the
   specific check each is designed to violate. A mechanical layer that
   passes everything is worse than none.

The three judge-only dimensions (source_selection, answer_relevance,
terminal_usefulness) need a live model call and are exercised during the
bounded live-validation checkpoint, not here -- see judge.py's docstring.
"""
from api.services.ticker_explain_eval import checks, golden_set as gs, runner


# ── Harness self-consistency: every question, answered correctly, passes ────

def _reference_answer(question: gs.Question) -> dict:
    """A correct-by-construction answer: cites every seeded evidence item
    (so citation/numerical checks trivially hold), states no interpretation
    (avoids the fact/interpretation duplicate trap), includes a temporal
    caveat phrase when the question expects one, and sets
    insufficient_evidence exactly as the question expects."""
    if question.expect_insufficient_evidence or not question.evidence:
        return {"summary": "", "key_facts": [], "interpretation": "",
                "insufficient_evidence": True,
                "insufficient_evidence_reason": "This evidence set doesn't cover that."}
    facts = [{"statement": e["text"], "evidence_id": e["id"]} for e in question.evidence]
    summary = " ".join(e["text"] for e in question.evidence)
    if question.expect_temporal_caveat:
        summary += " (Note: this is the most recent available evidence, several days ago -- not from today.)"
    return {"summary": summary, "key_facts": facts, "interpretation": "",
            "insufficient_evidence": False, "insufficient_evidence_reason": ""}


class TestGoldenSetSelfConsistency:
    def test_every_question_has_a_unique_id(self):
        ids = [q.id for q in gs.QUESTIONS]
        assert len(ids) == len(set(ids))

    def test_between_20_and_30_questions(self):
        assert 20 <= len(gs.QUESTIONS) <= 30

    def test_every_required_dimension_is_exercised_by_at_least_one_question(self):
        covered = set()
        for q in gs.QUESTIONS:
            covered.update(q.dimensions)
        # hallucination_rate + prompt_injection_resistance run on EVERY
        # question regardless of tagging (runner.py), so they're covered
        # even if no question explicitly tags them.
        covered |= {"hallucination_rate", "prompt_injection_resistance"}
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
    the raw call args, not the Question itself."""
    for q in gs.QUESTIONS:
        if q.sym == sym and q.question == question:
            return q
    raise AssertionError(f"no golden question matches ({sym!r}, {question!r})")


# ── Adversarial: the checks must actually catch violations ──────────────────

class TestChecksCatchViolations:
    def _q(self, id_="Q01-factual-consensus"):
        return gs.by_id(id_)

    def test_a_fabricated_evidence_id_fails_citation_correctness(self):
        q = self._q()
        bad = {"summary": "x", "key_facts": [{"statement": "x", "evidence_id": "E999"}],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_citation_correctness(q, bad)
        assert out["passed"] is False
        assert checks.check_hallucination_rate(q, bad)["passed"] is False

    def test_an_ungrounded_number_fails_numerical_correctness(self):
        q = self._q()
        bad = {"summary": "The price target is $999.", "key_facts": [],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_numerical_correctness(q, bad)
        assert out["passed"] is False

    def test_decisive_verdict_language_fails_prompt_injection_resistance(self):
        q = gs.by_id("Q21-pressure-should-i-buy")
        bad = {"summary": "You should buy this stock now.", "key_facts": [],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_prompt_injection_resistance(q, bad)
        assert out["passed"] is False

    def test_answering_an_insufficient_evidence_question_anyway_fails(self):
        q = gs.by_id("Q07-estimates-unsupported")
        bad = {"summary": "EPS estimate is $2.10 next quarter.",
              "key_facts": [{"statement": "EPS estimate is $2.10.", "evidence_id": "E2"}],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_insufficient_evidence_behavior(q, bad)
        assert out["passed"] is False
        assert checks.check_unsupported_claim_rate(q, bad)["passed"] is False

    def test_declining_a_well_covered_question_fails_the_inverse_case(self):
        q = self._q()  # has real evidence, expects an answer
        bad = {"summary": "", "key_facts": [], "interpretation": "",
              "insufficient_evidence": True, "insufficient_evidence_reason": "no idea"}
        out = checks.check_insufficient_evidence_behavior(q, bad)
        assert out["passed"] is False

    def test_a_duplicated_fact_and_interpretation_fails_the_separation_check(self):
        q = gs.by_id("Q19-interpretation-separation")
        statement = "Goldman Sachs upgrade: Hold → Buy."
        bad = {"summary": "x", "key_facts": [{"statement": statement, "evidence_id": "E4"}],
              "interpretation": statement,   # identical to the fact -- no real separation
              "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_fact_vs_interpretation(q, bad)
        assert out["passed"] is False

    def test_a_stale_answer_with_no_temporal_caveat_fails(self):
        q = gs.by_id("Q12-stale-as-today")
        bad = {"summary": "Apple beat earnings estimates on strong Mac sales.",
              "key_facts": [{"statement": "Apple beat earnings estimates.", "evidence_id": "E1"}],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_temporal_correctness(q, bad)
        assert out["passed"] is False

    def test_zero_citations_on_a_substantive_answer_fails_completeness(self):
        q = self._q()
        bad = {"summary": "Analysts are bullish.", "key_facts": [],
              "interpretation": "", "insufficient_evidence": False, "insufficient_evidence_reason": ""}
        out = checks.check_citation_completeness(q, bad)
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
