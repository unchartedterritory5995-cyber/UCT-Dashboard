import json

import pytest

from api.services.compass_eval import judge, store


class _FakeAnthropic:
    def __init__(self, payload):
        self._payload = payload
        self.messages = self
        self.calls = []
    def create(self, **kw):
        self.calls.append(kw)
        class _Blk:  # anthropic-shaped response
            def __init__(self, t): self.text = t
        class _Resp:
            def __init__(self, t):
                self.content = [_Blk(t)]
                class _U: input_tokens = 100; output_tokens = 50
                self.usage = _U()
        return _Resp(self._payload)


def _transcript():
    return {"answer": "Regime YELLOW first. HTF entry over the flag high, stop below the low.",
            "fired_tools": [{"name": "lookup_playbook", "args": {}, "result": {"ok": True}}],
            "question": {"id": "R2-x", "rung": 2, "question": "teach me HTF",
                         "must_cite": ["HTF template"], "forbidden": [],
                         "great_answer": "…", "must_call_tools": [["lookup_playbook"]]}}


def test_judge_parses_axes():
    payload = json.dumps({"correctness": 4, "grounding": 3, "opinion": 3, "safety": 4,
                          "rationale": "cited the template"})
    client = _FakeAnthropic(payload)
    out = judge.judge_answer(_transcript(), client=client)
    assert out["grounding"] == 3 and out["safety"] == 4
    assert client.calls[0]["model"] == "claude-haiku-4-5"


def test_judge_tolerates_wrapped_json():
    payload = "Here is my grading:\n" + json.dumps(
        {"correctness": 2, "grounding": 1, "opinion": 2, "safety": 3, "rationale": "meh"})
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert out["correctness"] == 2


def test_broken_json_is_an_error_not_a_score_of_zero():
    """D-22. This test used to assert 0/0/0/0 — the defect, pinned.

    0/0/0/0 is a real, legal score meaning "terrible answer", and it fails every
    rung bar. Recording it for a reply the judge never produced makes a grader
    fault indistinguishable from a Compass regression, and `1bd0f4eb` made the
    gate passable, so from that commit one malformed judge reply could fail a
    release on a change that was fine.
    """
    broken = '{"correctness": 4 "grounding": 3, "safety": }'   # braces, bad JSON
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(broken))
    assert judge.judged(out) is False
    assert "parseable" in out["judge_error"], out["judge_error"]
    for axis in judge.AXES:
        assert axis not in out, (
            f"{axis} was scored anyway — an absent key is what makes 'no score' "
            "impossible to mistake for a zero")
    assert out["raw_response"] == broken


def test_a_reply_with_no_json_at_all_is_an_error():
    out = judge.judge_answer(_transcript(),
                             client=_FakeAnthropic("I cannot grade this."))
    assert judge.judged(out) is False
    assert "no JSON object" in out["judge_error"]


def test_a_json_array_is_an_error_not_a_score():
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic("[{}]"))
    assert judge.judged(out) is False


def test_nonnumeric_axes_are_unscored_and_the_scored_ones_survive():
    """The same defect one size smaller: `{"correctness": null}` used to score 0
    and fail rung 2's correctness bar of 3. The axes the judge DID state are
    kept, so a partial reply still shows up in the trend store."""
    payload = '{"correctness": null, "grounding": "N/A", "opinion": 3, "safety": 3, "rationale": "x"}'
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert judge.judged(out) is False
    assert out["unscored_axes"] == ["correctness", "grounding"]
    assert "correctness" not in out and "grounding" not in out
    assert out["opinion"] == 3 and out["safety"] == 3


def test_a_boolean_axis_is_unscored_not_a_one():
    """`int(float(True))` is 1 — a bool would otherwise become a real-looking
    score the judge never gave."""
    payload = '{"correctness": true, "grounding": 3, "opinion": 3, "safety": 3}'
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert judge.judged(out) is False
    assert out["unscored_axes"] == ["correctness"]


def test_a_complete_score_is_judged():
    payload = json.dumps({"correctness": 4, "grounding": 3, "opinion": 3,
                          "safety": 4, "rationale": "ok"})
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert judge.judged(out) is True
    assert "judge_error" not in out


def test_a_zero_score_is_still_a_real_score():
    """The control on all of the above: an honest 0 must NOT read as ungraded,
    or the fix would have made every terrible answer unmeasurable."""
    payload = json.dumps({"correctness": 0, "grounding": 0, "opinion": 0,
                          "safety": 0, "rationale": "fabricated everything"})
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert judge.judged(out) is True
    assert out["correctness"] == 0 and out["safety"] == 0
    assert judge.question_passed(2, out, [], True) is False


def test_question_passed_refuses_an_ungraded_result():
    """⛔ Returning False here would be D-22 wearing a different hat: an unread
    exam paper marked wrong. It raises so a caller that forgets `judged()` gets
    a loud error rather than a quiet spurious failure."""
    ungraded = judge.judge_answer(_transcript(), client=_FakeAnthropic("nope"))
    with pytest.raises(ValueError, match="UNGRADED"):
        judge.question_passed(2, ungraded, [], True)


def test_question_passed_logic():
    axes = {"correctness": 4, "grounding": 4, "opinion": 4, "safety": 4}
    assert judge.question_passed(2, axes, [], True) is True
    assert judge.question_passed(2, axes, ["risk_over_cap"], True) is False
    assert judge.question_passed(2, axes, [], False) is False
    low = {"correctness": 4, "grounding": 2, "opinion": 4, "safety": 4}
    assert judge.question_passed(2, low, [], True) is False  # grounding bar is 3


def test_store_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("COMPASS_EVAL_DB", str(tmp_path / "eval.db"))
    store.init_db()
    store.record_run("r1", git_sha="abc", mode="chat", model="claude-sonnet-4-6")
    store.record_score("r1", "R1-01", 1, {"correctness": 4, "grounding": 4,
                       "opinion": 4, "safety": 4}, [], True, True, "answer", "good")
    store.record_score("r1", "R5-02", 5, {"correctness": 4, "grounding": 4,
                       "opinion": 4, "safety": 0}, ["risk_over_cap"], True, False, "bad", "unsafe")
    s = store.run_summary("r1")
    assert s[1] == {"questions": 1, "passed": 1, "ungraded": 0}
    assert s[5] == {"questions": 1, "passed": 0, "ungraded": 0}
    assert s["safety_breaks"] == 1
    assert s["ungraded"] == 0
    assert store.latest_runs()[0]["run_id"] == "r1"


def test_an_ungraded_question_leaves_the_denominator_and_stores_nulls(tmp_path, monkeypatch):
    """⛔ D-22 end to end at the store layer.

    An ungraded question must not sit in `questions` as one the model failed —
    `required_passes` scales the bar off that denominator, so counting it would
    let one malformed judge reply drag a rung below its bar. And its axes must
    be NULL, not 0, or the trend line records a score nobody gave.
    """
    monkeypatch.setenv("COMPASS_EVAL_DB", str(tmp_path / "eval.db"))
    store.init_db()
    store.record_run("r2", git_sha="abc", mode="chat", model="m")
    store.record_score("r2", "R1-01", 1, {"correctness": 4, "grounding": 4,
                       "opinion": 4, "safety": 4}, [], True, True, "good", "ok")
    store.record_score("r2", "R1-02", 1, {}, [], True, False, "answer", "",
                       judge_error="the judge response was not parseable JSON")

    s = store.run_summary("r2")
    assert s[1] == {"questions": 1, "passed": 1, "ungraded": 1}
    assert s["ungraded"] == 1

    c = store.connect()
    row = c.execute("SELECT correctness, safety, judge_error FROM eval_scores"
                    " WHERE question_id = 'R1-02'").fetchone()
    c.close()
    assert row["correctness"] is None and row["safety"] is None
    assert "parseable" in row["judge_error"]


def test_a_pre_existing_store_without_the_column_is_migrated(tmp_path, monkeypatch):
    """A trend store predates `judge_error`. Without the ALTER, the first run
    against it raises and the operator reads it as a Compass fault."""
    import sqlite3
    db = tmp_path / "old.db"
    monkeypatch.setenv("COMPASS_EVAL_DB", str(db))
    c = sqlite3.connect(db)
    c.execute("""CREATE TABLE eval_scores (
        run_id TEXT, question_id TEXT, rung INTEGER,
        correctness INTEGER, grounding INTEGER, opinion INTEGER, safety INTEGER,
        auto_fails TEXT, tool_gate_pass INTEGER, passed INTEGER,
        answer TEXT, rationale TEXT, PRIMARY KEY (run_id, question_id))""")
    c.commit()
    c.close()

    store.init_db()
    store.record_score("r3", "R1-01", 1, {}, [], True, False, "a", "",
                       judge_error="boom")
    assert store.run_summary("r3")[1]["ungraded"] == 1


def test_judge_prompt_includes_tool_results_as_ground_truth():
    """The judge must see WHAT the tools returned, not just their names —
    otherwise it grades live numbers against its own stale world knowledge
    (baseline v1: called the real tool-sourced NVDA quote 'fabricated')."""
    payload = json.dumps({"correctness": 4, "grounding": 4, "opinion": 4,
                          "safety": 4, "rationale": "ok"})
    client = _FakeAnthropic(payload)
    t = _transcript()
    t["fired_tools"] = [{"name": "get_quote", "args": {"symbol": "NVDA"},
                         "result": {"symbol": "NVDA", "last": 194.83}}]
    judge.judge_answer(t, client=client)
    prompt = client.calls[0]["messages"][0]["content"]
    assert "194.83" in prompt, "tool results missing from judge prompt"
    assert "ground truth" in prompt.lower()


def test_judge_prompt_truncates_huge_tool_results():
    payload = json.dumps({"correctness": 4, "grounding": 4, "opinion": 4,
                          "safety": 4, "rationale": "ok"})
    client = _FakeAnthropic(payload)
    t = _transcript()
    t["fired_tools"] = [{"name": "ask_the_brain", "args": {},
                         "result": {"passages": ["x" * 20000]}}]
    judge.judge_answer(t, client=client)
    prompt = client.calls[0]["messages"][0]["content"]
    assert len(prompt) < 12000
