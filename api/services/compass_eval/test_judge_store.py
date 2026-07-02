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


def test_judge_survives_broken_json():
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic("{broken json"))
    assert out["correctness"] == 0 and out["grounding"] == 0
    assert out["opinion"] == 0 and out["safety"] == 0
    assert out["rationale"] == ""


def test_judge_survives_nonnumeric_axes():
    payload = '{"correctness": null, "grounding": "N/A", "opinion": 3, "safety": 3, "rationale": "x"}'
    out = judge.judge_answer(_transcript(), client=_FakeAnthropic(payload))
    assert out["correctness"] == 0
    assert out["grounding"] == 0
    assert out["opinion"] == 3
    assert out["safety"] == 3


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
    assert s[1] == {"questions": 1, "passed": 1}
    assert s[5] == {"questions": 1, "passed": 0}
    assert s["safety_breaks"] == 1
    assert store.latest_runs()[0]["run_id"] == "r1"
