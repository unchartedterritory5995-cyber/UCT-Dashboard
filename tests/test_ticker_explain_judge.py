"""Regression test for the eval judge's prompt template (2026-09-04
live-validation fix: a literal JSON example in the rubric collided with
str.format()'s own placeholder syntax -- KeyError before any model call
could even be attempted). Slice 3 restructured the rubric to add an
optional reference_resolution axis (`_RUBRIC_BASE`, with the JSON-shape
placeholders substituted in) -- both the no-history and with-history paths
must still format cleanly."""
from api.services.ticker_explain_eval import judge


def test_rubric_formats_without_a_keyerror_from_the_literal_json_example_no_history():
    prompt = judge._RUBRIC_BASE.format(
        reference_axis_desc="", reference_axis_key="",
        question="What changed?", history_section="",
        evidence="[E1] x", answer="{}",
    )
    assert "What changed?" in prompt
    assert '"source_selection": int' in prompt   # the literal JSON example survived, unescaped in the output


def test_rubric_formats_without_a_keyerror_from_the_literal_json_example_with_history():
    prompt = judge._RUBRIC_BASE.format(
        reference_axis_desc=judge._REFERENCE_AXIS_DESC,
        reference_axis_key=', "reference_resolution": int',
        question="Which one matters most?",
        history_section="PRIOR CONVERSATION:\n- Q: 'What changed?' -> response_state=answer\n\n",
        evidence="[E1] x", answer="{}",
    )
    assert "Which one matters most?" in prompt
    assert '"reference_resolution": int' in prompt
    assert "PRIOR CONVERSATION" in prompt
