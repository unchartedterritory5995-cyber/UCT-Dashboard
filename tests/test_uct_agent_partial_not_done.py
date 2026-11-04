"""W2 audit (live 2026-11-04): "Change the SPY chart to weekly and email me a screenshot of it." applied the weekly change
and silently dropped the email part. A PARTLY possible request keeps its one-word `unsupported_category` beside its ops
(sanitize_envelope), so the browser can say — in a FIXED sentence keyed on it (app/src/agent/notDone.js), never model
prose — which part was not done. The prompt tells the model to set it.
"""
from __future__ import annotations

from api.services.uct_agent import turn

NAMES = {"agent.capabilities", "chart.setTimeframe"}
OP = {"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "W"}}


def _env(disp, ops, cat, reply=""):
    return {"disposition": disp, "reply": reply, "question": None, "ops": ops, "unsupported_category": cat}


def test_an_apply_with_ops_keeps_the_unsupported_area_of_the_part_it_cannot_do():
    out = turn.sanitize_envelope(_env("apply", [OP], "email"), {"c1"}, NAMES)
    assert out["disposition"] == "apply"
    assert [o["action"] for o in out["ops"]] == ["chart.setTimeframe"]
    assert out["unsupported_category"] == "email"


def test_a_propose_with_ops_keeps_it_too_and_it_is_bounded():
    out = turn.sanitize_envelope(_env("propose", [OP], "x" * 100), {"c1"}, NAMES)
    assert out["unsupported_category"] == "x" * 40


def test_talk_never_carries_it_and_unsupported_still_does():
    assert turn.sanitize_envelope(_env("answer", [], "email", "RSI measures momentum."), {"c1"}, NAMES)["unsupported_category"] is None
    assert turn.sanitize_envelope(_env("unsupported", [], "email", "I can't email that."), {"c1"}, NAMES)["unsupported_category"] == "email"


def test_the_prompt_tells_the_model_to_name_the_part_it_cannot_do():
    p = turn._SYSTEM_HEAD
    assert "PARTLY POSSIBLE" in p and "unsupported_category" in p


# ── W2 audit (train-3 review): an ANSWER that carries agent.undo ─────────────────────────────────────
UNDO = {"action": "agent.undo", "target": "a1", "args": {"scope": "last", "about": None}}
UNAMES = {"agent.capabilities", "agent.undo", "chart.setTimeframe"}


def _promote(reply, ops, msg, names=UNAMES, refs=("a1", "c1")):
    return turn.sanitize_envelope(turn.promote_talk_reads(_env("answer", ops, None, reply), msg, names), set(refs), names)


def test_an_answer_carrying_exactly_agent_undo_becomes_an_apply_when_the_member_said_undo():
    for msg in ("undo that", "please undo", "Undo the last change you made to my charts.", "take that back", "put my layout back"):
        out = _promote("Undoing that now.", [UNDO], msg)
        assert out["disposition"] == "apply", msg
        assert [o["action"] for o in out["ops"]] == ["agent.undo"]
        assert out["reply"] == ""


def test_a_question_about_undo_is_never_promoted():
    # review #771 (3): the model's [agent.undo] on "how does undo work?" is dropped — the answer is served, nothing runs
    for msg in ("how does undo work?", "can you undo a trade?", "what does undo do", "undo?", None):
        out = _promote("Undo takes back the Agent's last change.", [UNDO], msg)
        assert out["disposition"] == "answer" and out["ops"] == [], msg


def test_nothing_else_is_ever_promoted():
    # a write on an answer stays talk (ops dropped); undo + a write on an answer stays talk too
    out = _promote("Switching to weekly.", [OP], "switch to weekly", names=NAMES, refs=("c1",))
    assert out["disposition"] == "answer" and out["ops"] == []
    out = _promote("Done.", [UNDO, OP], "undo that")
    assert out["disposition"] == "answer" and out["ops"] == []
    # agent.undo not in this request's manifest → the op is dropped and the answer served (no error)
    out = _promote("Use Undo.", [UNDO], "undo that", names=NAMES, refs=("a1",))
    assert out["disposition"] == "answer" and out["ops"] == []
