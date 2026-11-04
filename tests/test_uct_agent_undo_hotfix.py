"""HOTFIX 2026-11-03 (live T2): "Undo the last change you made to my charts." reached the planner, which had no Undo
action and answered "I can't undo changes from UCT Agent — only from UCT itself. Click Undo in the app…".

The browser now lists agent.undo (its own one-action `undo` routing group, named by any Undo word; executed only by
the browser's own Undo). The server:
  * tells the model (prompt tail) that undoing its own change is agent.undo and never to claim it is impossible;
  * treats a reply calling Undo unavailable while agent.undo is in the manifest as a FALSE capability claim (W1.1 R-04);
  * leaves an honest "can't be undone" (a permanent action) alone.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn

GOLDEN = Path(__file__).resolve().parents[1] / "app" / "src" / "agent" / "contract" / "manifest.golden.json"


def _env(disp, reply="", ops=None):
    return {"disposition": disp, "reply": reply, "question": None, "ops": ops or [], "unsupported_category": None}


LIVE_T2 = ("I can't undo changes from UCT Agent — only from UCT itself. Click Undo in the app (Ctrl+Z or Cmd+Z), "
           "and that will reverse the last change (NVDA to Weekly).")
NAMES = {"agent.capabilities", "agent.undo", "chart.setTimeframe"}


def test_agent_undo_is_in_the_golden_manifest_as_a_browser_only_query_with_no_undo_of_its_own():
    caps = json.loads(GOLDEN.read_text(encoding="utf-8"))
    caps = caps.get("capabilities", caps) if isinstance(caps, dict) else caps
    u = next(c for c in caps if c["name"] == "agent.undo")
    assert u["domain"] == "agent" and u["query"] is True and u["undo"] == "none"
    assert set(u["args"]["required"]) == {"scope", "about"}
    # never a local-only lookup (its outcome is UCT's own Undo receipt, safe to replay) and never a data read
    assert "agent.undo" not in turn.LOCAL_ONLY_ACTIONS and "agent.undo" not in turn.DATA_READ_ACTIONS


def test_the_prompt_tells_the_model_to_plan_agent_undo_and_never_to_claim_it_cannot():
    tail = turn._SYSTEM_TAIL
    # (the prompt names no capability of its own — test_the_server_names_no_capability_of_its_own — the manifest does)
    assert "undoes your own last change" in tail and "Never say you cannot undo" in tail


@pytest.mark.parametrize("reply", [
    LIVE_T2,
    "I can't undo from here — UCT's Undo is in the app itself (Ctrl+Z or Cmd+Z).",
    "Undoing changes isn't available in UCT Agent yet; use UCT's Undo button.",
])
def test_the_live_undo_refusal_is_a_false_claim_when_agent_undo_is_listed(reply):
    c = turn.false_capability_claim(_env("answer", reply), NAMES)
    assert c and c["family"] == "undo" and c["where"] == "caps"
    assert "agent.undo" in c["error"]


@pytest.mark.parametrize("e", [
    # an honest permanent-action limit ("can't be undone") is never a claim
    _env("answer", "Deleting a saved layout is permanent — it can't be undone from here."),
    # a member without agent.undo (an older browser): the limit is honest
    _env("answer", LIVE_T2),
])
def test_honest_undo_limits_are_left_alone(e):
    names = NAMES if "permanent" in e["reply"] else {"chart.setTimeframe"}
    assert turn.false_capability_claim(e, names) is None


def test_a_claim_while_the_undo_group_was_not_sent_becomes_a_reroute():
    c = turn.false_capability_claim(_env("answer", LIVE_T2), {"chart.setTimeframe"}, {"undo", "lists"})
    assert c and c["family"] == "undo" and c["where"] == "group" and c["groups"] == ["undo"]


def test_a_planned_agent_undo_passes_the_server_gate_unchanged():
    e = _env("apply", "", [{"action": "agent.undo", "target": "a1", "args": {"scope": "last", "about": None}}])
    out = turn.sanitize_envelope(e, {"a1"}, NAMES)
    assert out["disposition"] == "apply"
    assert [o["action"] for o in out["ops"]] == ["agent.undo"]
