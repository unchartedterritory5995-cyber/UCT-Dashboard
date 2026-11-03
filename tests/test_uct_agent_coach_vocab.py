"""Wave 3 review B4 (w3-a, 2026-11-03) -- owner decision N5 on the server: the setup names (48 canonical templates and
their spelled-out forms, identical to the browser's coach/brain.js), longest-form matching, and the deterministic check
that replaces a MODEL-written coach reply which defines a named setup without citing UCT's playbook. No model, no network."""
from __future__ import annotations

import json
import re
import types
from pathlib import Path

import pytest

from api.services.uct_agent import coach, turn
from api.services.uct_agent.coach import concepts, guard, setups

REPO = Path(__file__).resolve().parents[1]
BRAIN = (REPO / "app" / "src" / "agent" / "coach" / "brain.js").read_text(encoding="utf-8")


def _js_templates() -> list[str]:
    body = BRAIN.split("export const SETUP_TEMPLATES = [", 1)[1].split("]", 1)[0]
    return re.findall(r"'([^']+)'", body)


def _js_aliases() -> dict[str, tuple[str, ...]]:
    body = BRAIN.split("export const SETUP_ALIASES = {", 1)[1].split("\n}", 1)[0]
    out = {}
    for key, vals in re.findall(r"('[^']+'|[A-Za-z0-9]+):\s*\[([^\]]*)\]", body):
        out[key.strip("'")] = tuple(re.findall(r"'([^']+)'", vals))
    return out


def test_the_server_lists_equal_the_browser_lists():
    assert list(setups.TEMPLATES) == _js_templates()
    assert len(setups.TEMPLATES) == 48
    assert setups.ALIASES == _js_aliases()
    assert set(setups.ALIASES) <= set(setups.TEMPLATES)
    amb = BRAIN.split("export const SETUP_AMBIGUOUS = {", 1)[1].split("}", 1)[0]
    js_amb = {k: tuple(re.findall(r"'([^']+)'", v)) for k, v in re.findall(r"'([^']+)':\s*\[([^\]]*)\]", amb)}
    assert setups.AMBIGUOUS == js_amb


def test_an_ambiguous_form_resolves_to_neither_template():
    """agent-kn: "high tight flag" is an alias of BOTH HTF and Tight Flag (setup.playbook refuses it as ambiguous)."""
    assert setups.setup_match("teach me the high tight flag") == {"ambiguous": ["HTF", "Tight Flag"], "form": "high tight flag"}
    assert setups.setup_named("high tight flags") is None
    assert setups.setup_named("a tight flag") == "Tight Flag" and setups.setup_named("an HTF") == "HTF"
    assert setups.uncited_setup_definitions("The high tight flag is when a stock doubles quickly.") == ["HTF / Tight Flag"]


@pytest.mark.parametrize("text,name", [
    ("teach me the high tight flag", None), ("a tight flag", "Tight Flag"), ("power earnings gaps", "PEG"),
    ("what is an episodic pivot", "EP"), ("volatility contraction pattern", "VCP"), ("undercut and rally", "U&R"),
    ("a follow-through day", "FTD"), ("cup and handle", "Cup with Handle"), ("head and shoulders", "Head & Shoulders"),
    ("a stage 2 breakout", "Stage 2 Breakout"), ("step by step", None), ("a peg in the ground", None), ("relative strength", None),
])
def test_setup_named_longest_form_wins(text, name):
    assert setups.setup_named(text) == name


@pytest.mark.parametrize("reply", [
    "A VCP is a base where each pullback is smaller than the last. What do you see?",
    "The high tight flag is when a stock doubles quickly and then pauses.",
    "Power earnings gap: an earnings gap that holds its open. What is your plan?",
    "EPs are basically big gaps on news.",
    "Cup and handle means a rounded base followed by a short pullback.",
])
def test_an_uncited_setup_definition_is_found(reply):
    assert setups.uncited_setup_definitions(reply)


@pytest.mark.parametrize("reply", [
    "Whether this is a VCP depends on UCT's template; ask me to teach it.",
    "Check the VCP template before you decide what you are looking at.",
    "VCP — from UCT's setup template (the approved playbook):\nWhat it is: a base whose pullbacks contract.",
    "Breakouts can fail; volume is one input. What level are you watching?",
    "The episode taught you something about patience.",
])
def test_no_false_alarm_on_mentions_or_cited_teaching(reply):
    assert setups.uncited_setup_definitions(reply) == []


def test_the_replacement_is_itself_clean():
    assert guard.check(setups.DEFINITION_FIXED, []) == []
    assert setups.uncited_setup_definitions(setups.DEFINITION_FIXED) == []


def test_no_concept_doc_names_a_setup_in_any_form():
    for c in concepts.load(force=True):
        for part in re.split(r"[.\n]", f"{c['title']}. {c['text']}. {', '.join(c['aliases'])}"):
            assert setups.setup_match(part) is None, (c["id"], part)


CAPS = [{"name": "coach.explain", "domain": "coach", "target": "coach", "summary": "Explain a trading concept.", "hints": None,
         "risk": "local", "reversible": True, "query": True,
         "args": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"], "additionalProperties": False}}]
CTX = {"charts": [{"ref": "c1", "label": "Chart (NVDA)", "symbol": "NVDA"}],
       "coach": [{"ref": "k1", "label": "Trading coach", "consent": "unknown"}]}


def _scripted(reply):
    def call(**_kw):
        e = {"disposition": "answer", "reply": reply, "question": None, "ops": [], "unsupported_category": None, "research": None}
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    return call


def test_a_model_written_setup_definition_is_replaced(monkeypatch):
    monkeypatch.setenv(coach.FLAG_ENV, "1")
    out = turn.run_turn(message="teach me the vcp", context=CTX, history=[], capabilities=CAPS,
                        caller=_scripted("A VCP is a base where each pullback may be smaller than the last. What do you see?"))
    assert out["envelope"]["reply"] == setups.DEFINITION_FIXED
    assert out["usage"]["coach_guard"] == ["definition"]
    ok = turn.run_turn(message="teach me the vcp", context=CTX, history=[], capabilities=CAPS,
                       caller=_scripted("I can teach it from UCT's setup template when the playbook is available. What drew you to it?"))
    assert ok["usage"]["coach_guard"] == []
