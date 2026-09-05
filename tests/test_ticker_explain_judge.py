"""Regression test for the eval judge's prompt template (2026-09-04
live-validation fix: a literal JSON example in the rubric collided with
str.format()'s own placeholder syntax -- KeyError before any model call
could even be attempted)."""
from api.services.ticker_explain_eval import judge


def test_rubric_formats_without_a_keyerror_from_the_literal_json_example():
    prompt = judge._RUBRIC.format(question="What changed?", evidence="[E1] x", answer="{}")
    assert "What changed?" in prompt
    assert '"source_selection": int' in prompt   # the literal JSON example survived, unescaped in the output
