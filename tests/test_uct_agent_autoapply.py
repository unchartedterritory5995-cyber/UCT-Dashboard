"""UCT Agent AUTO-APPLY (live test 2026-10-28) -- the SERVER half of the approval policy.

An explicitly requested, reversible workspace change is applied at once; anything the manifest marks
`risk: confirm` or `reversible: false` is always proposed. The server ENFORCES that (turn.enforce_approval):
whatever the model says, an `apply` that carries a guarded action reaches the browser as a `propose` --
except the actions in EXPLICIT_OK_ACTIONS, whose no-card path the browser decides from the member's own
words (and whose confirmIf still applies). The browser applies the same rule again (policy.decideMode).
No model is called here.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "app/src/agent/contract/manifest.contract.json").read_text(encoding="utf-8"))
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
# the server's own validation (at most one request's worth at a time), over the whole golden catalog
CAPS = [c for i in range(0, len(GOLDEN["capabilities"]), 50) for c in turn.validate_manifest(GOLDEN["capabilities"][i:i + 50])]
GUARDED = sorted(c["name"] for c in CAPS if c.get("risk") == "confirm" or c.get("reversible") is False)


def _env(disposition, *actions):
    return {"disposition": disposition, "reply": "", "question": None, "unsupported_category": None,
            "ops": [{"action": a, "target": "t1", "args": {}} for a in actions]}


def test_the_explicit_ok_list_is_the_shared_contract_one():
    assert sorted(turn.EXPLICIT_OK_ACTIONS) == sorted(CONTRACT["approval"]["explicitOk"]) == ["indicator.saveDraft"]


def test_the_guarded_actions_are_a_deliberate_list():
    # ⛔ changing this list changes what UCT asks before doing -- the browser rail
    # (agentOperatorLive.test.jsx L3) pins the same list
    assert GUARDED == ["alert.create", "alert.delete", "chart.applyTemplate", "chart.resetDefaults", "chartSetup.copyLook",
                       "chartSetup.deleteTemplate", "definition.delete", "definition.duplicate", "drawing.clear",
                       "indicator.discardDraft", "indicator.remove", "indicator.saveDraft", "layout.create", "layout.delete",
                       "layout.duplicate", "layout.rename", "layout.saveAs", "layout.saveCurrent", "screener.deleteSaved",
                       "screener.duplicateSaved", "screener.renameSaved", "screener.saveAs", "watchlist.clear",
                       "watchlist.create", "watchlist.delete", "watchlist.rename"]


@pytest.mark.parametrize("action", [a for a in GUARDED if a not in turn.EXPLICIT_OK_ACTIONS])
def test_an_apply_with_a_guarded_action_is_always_a_proposal(action):
    out = turn.enforce_approval(_env("apply", "chart.setTimeframe", action), CAPS)
    assert out["disposition"] == "propose"
    assert [o["action"] for o in out["ops"]] == ["chart.setTimeframe", action]        # nothing dropped, nothing added


def test_ordinary_reversible_workspace_changes_stay_applied():
    ordinary = ["chartGrid.set", "widget.add", "widget.arrange", "widget.resize", "chart.setSymbol", "chart.setTimeframe",
                "indicator.add", "indicatorStyle.set", "indicatorStyle.placeIn", "pane.move", "indicatorCopy.copyTo", "indicator.draft"]
    names = {c["name"] for c in CAPS}
    assert set(ordinary) <= names
    assert not set(ordinary) & set(GUARDED)
    assert turn.enforce_approval(_env("apply", *ordinary), CAPS)["disposition"] == "apply"


def test_the_explicit_words_path_is_left_to_the_browser_and_nothing_is_ever_made_less_guarded():
    assert turn.enforce_approval(_env("apply", "indicator.draft", "indicator.saveDraft"), CAPS)["disposition"] == "apply"
    assert turn.enforce_approval(_env("propose", "chart.setTimeframe"), CAPS)["disposition"] == "propose"
    for talk in ("answer", "clarify", "unsupported"):
        assert turn.enforce_approval({**_env(talk), "ops": []}, CAPS)["disposition"] == talk
    # no manifest (or an unreadable envelope) never loosens anything
    assert turn.enforce_approval(_env("apply", "watchlist.delete"), None)["disposition"] == "apply"
    assert turn.enforce_approval(None, CAPS) is None


def test_the_prompt_says_explicit_multi_step_requests_are_applied():
    p = turn.system_prompt(turn.validate_manifest(GOLDEN["capabilities"][:20]))
    assert "however many steps, charts or widgets it takes" in p
    assert "never propose just because a request has several parts" in p
    assert "or touches several targets" not in p
    assert "(and that is a propose)" not in p


def test_the_prompt_says_creating_a_custom_indicator_is_applied():
    # live production bug 2026-10-28: the model PROPOSED "create a custom indicator that ..." and the member had to
    # approve the instruction they had just given (the browser also applies the explicit creation whatever the model says)
    p = turn.system_prompt(turn.validate_manifest(GOLDEN["capabilities"][:20]))
    assert "A request to CREATE a custom indicator" in p
    assert "is apply: ONE indicator.draft on the NEW-draft entry with the member's words verbatim" in p
    # the server boundary leaves the creation's build + Save as the browser decides (indicator.saveDraft is explicitOk)
    assert turn.enforce_approval(_env("apply", "indicator.draft"), CAPS)["disposition"] == "apply"
    assert turn.enforce_approval(_env("apply", "indicator.draft", "indicator.saveDraft"), CAPS)["disposition"] == "apply"


def test_phase2_the_model_is_told_what_recent_indicators_and_my_other_charts_mean():
    """PHASE 2 (2026-10-29): the browser sends conversation_memory.recent_indicators (the latest adding change's
    indicators, in order, with their target ref and instance id). The prompt says how "the first one", "the fast one",
    "those" and "my other charts" read against them — the model resolves the same references the instant path does."""
    from api.services.uct_agent import turn
    p = turn._system_prompt_core([])
    assert "`recent_indicators` are the indicators UCT's latest adding change put on charts, in that order" in p
    assert '"the fast one" is the shortest length' in p
    assert '"My other charts", "the others", "the rest" mean every chart in <workspace_context> except the one(s) this conversation is about' in p
