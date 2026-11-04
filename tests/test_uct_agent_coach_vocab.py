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


# ── retention: a Brain-led coach answer is never replayed as text (owner decision; #735 review B-1) ──────────────────

PASSAGE = "The team treats a close back inside the base as the first sign the idea is wrong."


def _knowledge_rows(text):
    return [{"role": "member", "text": "coach me on a failed breakout", "data": None},
            {"role": "outcome", "text": text, "data": {"kind": "answered", "actions": ["coach.explain"], "knowledge": True}}]


def test_the_marker_literal_is_735s_frame_ref():
    assert turn.KNOWLEDGE_REF == "<uct_knowledge_ref/>"
    assert turn.KNOWLEDGE_REF in BRAIN                      # the browser writes the same literal


@pytest.mark.parametrize("text", [
    "<uct_knowledge_ref/> UCT showed the member an answer from its approved knowledge here.",
    f"From UCT's playbook — Failed breakouts: {PASSAGE} (UCT Playbook)",       # flag only, no marker in the text
])
def test_a_replayed_brain_led_coach_row_keeps_web_research_blocked(text):
    """train2 integration: KN-1's frame.seen() recognises the coach's stored row, so research stays blocked after a
    Brain-led coach answer (the replay carries frame.REF)."""
    from api.services.uct_agent.knowledge import frame as kn_frame
    assert kn_frame.REF == turn.KNOWLEDGE_REF
    msgs = turn.history_messages(_knowledge_rows(text))
    assert kn_frame.seen(msgs)
    plain = [{"role": "member", "text": "what is a breakout", "data": None},
             {"role": "outcome", "text": "A breakout is…", "data": {"kind": "answered", "actions": ["coach.explain"]}}]
    assert not kn_frame.seen(turn.history_messages(plain))


@pytest.mark.parametrize("text", [
    "<uct_knowledge_ref/> UCT showed the member an answer from its approved knowledge here. Cited: knowledge base entry #12.",
    f"From UCT's playbook — Failed breakouts: {PASSAGE} (UCT Playbook)",       # an older / buggy browser kept the text
])
def test_a_later_turn_never_replays_brain_text_v1_and_v2(text):
    from api.services.uct_agent import turn_v2
    import inspect
    msgs = turn.history_messages(_knowledge_rows(text))      # v1, and v2 (turn_v2 builds history with this function)
    assert "t1.history_messages(history)" in inspect.getsource(turn_v2)
    blob = json.dumps(msgs)
    assert PASSAGE not in blob and "Failed breakouts" not in blob
    assert turn.KNOWLEDGE_REF in blob


def test_a_later_model_request_never_contains_brain_text(monkeypatch):
    monkeypatch.setenv(coach.FLAG_ENV, "1")
    seen = {}

    def caller(**kw):
        seen["messages"] = kw["messages"]
        e = {"disposition": "answer", "reply": "What would you like to look at next?", "question": None, "ops": [],
             "unsupported_category": None, "research": None}
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    for ctx in (CTX, {"charts": CTX["charts"]}):            # a later coach turn and a later ordinary turn
        turn.run_turn(message="and then?", context=ctx, history=_knowledge_rows(f"From UCT's playbook: {PASSAGE}"),
                      capabilities=CAPS, caller=caller)
        assert PASSAGE not in json.dumps(seen["messages"])


def test_751_only_a_real_template_citation_switches_the_definition_check_off():
    """#751 B-1: "From UCT's playbook" (a passage -- possibly team commentary), "approved playbook", "Setup Library" are not
    a citation of a definition; only coach.explain's own setup.playbook template header is."""
    for reply in ("From UCT's playbook — Watching a cup: A cup and handle is a rounded base with a short dip.",
                  "Per the approved playbook, a VCP is a base whose pullbacks contract.",
                  "See the Setup Library: the EP refers to a big news gap.",
                  "UCT team commentary that mentions Cup with Handle (not UCT's definition of it) — A cup and handle is a rounded base."):
        assert setups.uncited_setup_definitions(reply), reply
    cited = "VCP — from UCT's setup template (the approved playbook):\nWhat it is: a base whose pullbacks contract."
    assert setups.uncited_setup_definitions(cited) == []
