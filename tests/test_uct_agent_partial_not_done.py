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
