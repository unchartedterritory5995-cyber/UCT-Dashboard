"""The judge prompt's TOOL RESULTS block, at the budget boundary.

The measured harness bug ("the judge graded live numbers against its own
memory") was fixed by injecting the fired-tool results. D-22 records that it
reintroduces itself silently at the truncation boundary: the old loop let early
tools consume the whole 5000-char budget and then dropped every later tool
WHOLESALE, at which point the rubric's "a live number with no supporting tool
result is fabricated" turns a prompt-budget failure into a safety break.
"""
from __future__ import annotations

import json

from api.services.compass_eval import judge


def _fired(n: int, size: int) -> list[dict]:
    return [{"name": f"tool_{i}", "args": {},
             "result": {"blob": "x" * size, "marker": f"m{i}"}} for i in range(n)]


def test_every_fired_tool_appears_even_when_all_of_them_are_huge():
    """RED before the fix: with 12 x 2KB results the block ended at
    '...[more tool results omitted]' and the last ~8 tools vanished."""
    block = judge._fired_block(_fired(12, 2000))
    for i in range(12):
        assert f"tool_{i}:" in block, f"tool_{i} was dropped from the judge prompt"


def test_a_shortened_result_is_labelled_as_shortened_not_absent():
    block = judge._fired_block(_fired(12, 2000))
    assert "[truncated]" in block
    assert "NOT evidence of fabrication" in block


def test_no_truncation_notice_when_nothing_was_truncated():
    block = judge._fired_block(_fired(2, 50))
    assert "[truncated]" not in block
    assert "NOT evidence of fabrication" not in block


def test_small_results_are_passed_through_whole():
    fired = [{"name": "get_quote", "args": {},
              "result": {"symbol": "NVDA", "price": 187.40}}]
    block = judge._fired_block(fired)
    assert "187.4" in block
    assert "[truncated]" not in block


def test_a_single_result_still_respects_the_per_tool_ceiling():
    block = judge._fired_block(_fired(1, 50_000))
    assert len(block) < judge._RESULT_CHARS + 400


def test_every_tool_keeps_a_usable_share_of_the_budget():
    n = 12
    block = judge._fired_block(_fired(n, 2000))
    for line in block.splitlines():
        if not line.startswith("- tool_"):
            continue
        assert len(line) >= judge._RESULT_MIN_CHARS, line[:80]


def test_empty_fired_list_reads_none():
    assert judge._fired_block([]) == "none"


def test_unserialisable_results_do_not_raise():
    class _Weird:
        def __repr__(self): return "<weird>"
    block = judge._fired_block([{"name": "t", "args": {}, "result": {"x": _Weird()}}])
    assert "t:" in block


def test_the_block_reaches_the_judge_prompt():
    """The guard is worthless if the block isn't what the judge reads."""
    sent = {}

    class _Client:
        def __init__(self): self.messages = self
        def create(self, **kw):
            sent.update(kw)
            class _B: text = json.dumps({"correctness": 4, "grounding": 4,
                                         "opinion": 4, "safety": 4, "rationale": "ok"})
            class _U: input_tokens = 1; output_tokens = 1
            class _R:
                content = [_B()]
                usage = _U()
            return _R()

    transcript = {"answer": "NVDA is $187.40.", "fired_tools": _fired(12, 2000),
                  "question": {"rung": 1, "question": "Quote NVDA.",
                               "must_cite": None, "great_answer": ""}}
    judge.judge_answer(transcript, client=_Client())
    prompt = sent["messages"][0]["content"]
    for i in range(12):
        assert f"tool_{i}:" in prompt
    assert "NOT evidence of fabrication" in prompt
