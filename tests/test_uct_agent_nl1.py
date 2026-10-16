"""NL-1 (model-first interpretation) — the server half, behind UCT_AGENT_NL1 (OFF by default).

Holds the server to:
  • flag OFF: an NL-1 request is served exactly as a legacy request (the 60-action limit, routing,
    the legacy prompt and schema) — production is unchanged until the owner turns NL-1 on;
  • flag ON: the WHOLE catalog (the real 91-action golden manifest) is read compact, never routed;
    NL-1's rules and UCT's glossary (data) join ONE stable, cache-controlled system prompt;
  • the envelope's new fields are gated here: a choice ref the browser never offered is nulled, and a
    `correction` survives only on a plan that changes something when the request carried the last change;
  • every legacy guard still runs first (unknown action refused, unknown target → question, claims stripped).
No paid call: every model response is a fake (tests.test_uct_agent.caller_of).
"""
import json
import os

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import _resp, caller_of

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "..", "app", "src", "agent", "contract", "manifest.golden.json")
CATALOG = json.load(open(GOLDEN, encoding="utf-8"))["capabilities"]
CTX = {"surface": "charts",
       "charts": [{"ref": "c1", "label": "Left chart (NVDA)", "symbol": "NVDA"},
                  {"ref": "c2", "label": "Right chart (AMD)", "symbol": "AMD"}]}
MEM = {"conversation_memory": {"last_change": ["chart.setTimeframe"],
                               "last_change_detail": [{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "5"}}]}}


def nl1_env(disposition, ops=(), reply="", question=None, correction=None):
    """A model envelope in NL-1's compact op form ({action, target, args_json})."""
    return {"disposition": disposition, "reply": reply, "question": question, "unsupported_category": None,
            "research": None, "title": None, "correction": correction,
            "ops": [{"action": o["action"], "target": o["target"], "args_json": json.dumps(o["args"])} for o in ops]}


TF15 = {"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "15"}}


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(turn.NL1_ENV, "1")


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(turn.NL1_ENV, raising=False)


def test_the_flag_is_off_unless_set_to_1(monkeypatch):
    monkeypatch.delenv(turn.NL1_ENV, raising=False)
    assert turn.nl1_enabled() is False
    for v in ("0", "true", "yes", ""):
        monkeypatch.setenv(turn.NL1_ENV, v)
        assert turn.nl1_enabled() is False
    monkeypatch.setenv(turn.NL1_ENV, "1")
    assert turn.nl1_enabled() is True


def test_flag_off_an_nl1_request_keeps_the_production_limit(flag_off):
    assert len(CATALOG) > turn.MAX_CAPABILITIES
    with pytest.raises(turn.TurnError, match="too many actions"):
        turn.run_turn(message="flip it to 15m", context=CTX, history=[], capabilities=CATALOG,
                      caller=caller_of(_resp(nl1_env("apply", [TF15]))), interpreter="nl1")


def test_flag_off_an_nl1_request_is_served_as_legacy(flag_off):
    small = CATALOG[:8]
    c = caller_of(_resp({"disposition": "answer", "reply": "hi", "question": None, "ops": [],
                         "unsupported_category": None, "research": None, "title": None}))
    out = turn.run_turn(message="hello", context=CTX, history=[], capabilities=small, caller=c, interpreter="nl1")
    kw = c.calls[0]
    assert "UNDERSTANDING THE MEMBER" not in kw["system"][0]["text"]
    assert "correction" not in kw["output_config"]["format"]["schema"]["properties"]
    assert "correction" not in out["envelope"] and "interpreter" not in out["usage"]
    # byte-identical to the request without the field
    c2 = caller_of(_resp({"disposition": "answer", "reply": "hi", "question": None, "ops": [],
                          "unsupported_category": None, "research": None, "title": None}))
    turn.run_turn(message="hello", context=CTX, history=[], capabilities=small, caller=c2)
    assert c2.calls[0]["system"] == kw["system"] and c2.calls[0]["output_config"] == kw["output_config"]


def test_flag_on_reads_the_whole_catalog_compact_with_rules_and_glossary(flag_on):
    c = caller_of(_resp(nl1_env("apply", [TF15])))
    out = turn.run_turn(message="flip the left one to 15m", context=CTX, history=[], capabilities=CATALOG,
                        caller=c, interpreter="nl1", routing={"version": 1, "groups": [{"id": "charts", "title": "x"}, {"id": "lists", "title": "y"}], "selected": ["charts"]})
    kw = c.calls[0]
    sysprompt = kw["system"][0]["text"]
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    for cap in CATALOG:                                  # every action is visible to the model
        assert f"- {cap['name']}(" in sysprompt
    assert "UNDERSTANDING THE MEMBER" in sysprompt and "UCT'S OWN MEANINGS" in sysprompt
    assert "OTHER ACTION GROUPS" not in sysprompt         # routing ignored: NL-1 is never routed
    schema = kw["output_config"]["format"]["schema"]
    assert "correction" in schema["required"] and "need_groups" not in schema["properties"]
    assert out["envelope"]["ops"] == [TF15] and out["usage"]["interpreter"] == "nl1"


def test_flag_on_the_system_prompt_is_one_stable_prefix_across_turns(flag_on):
    """Caching only pays if the catalog prefix is byte-identical whatever the member says or the board holds."""
    seen = []
    for msg, ctx in (("15m", CTX), ("add rsi and go weekly", {**CTX, "charts": CTX["charts"][:1]}), ("what's ADR?", {"surface": "charts"})):
        c = caller_of(_resp(nl1_env("answer", reply="ok")))
        turn.run_turn(message=msg, context=ctx, history=[], capabilities=CATALOG, caller=c, interpreter="nl1")
        seen.append(c.calls[0]["system"])
    assert seen[0] == seen[1] == seen[2]


def test_flag_on_still_has_a_limit(flag_on):
    too_many = [{**CATALOG[0], "name": f"chart.fake{i}"} for i in range(turn.MAX_CAPABILITIES_NL1 + 1)]
    with pytest.raises(turn.TurnError, match="too many actions"):
        turn.run_turn(message="x", context=CTX, history=[], capabilities=too_many,
                      caller=caller_of(_resp(nl1_env("answer", reply="ok"))), interpreter="nl1")


def test_choices_carry_only_refs_the_browser_offered(flag_on):
    q = {"text": "Which chart?", "choices": [{"label": "Left chart (NVDA)", "ref": "c1"}, {"label": "Right chart (AMD)", "ref": "c2"},
                                             {"label": "Some other chart", "ref": "c9"}]}
    out = turn.run_turn(message="switch to weekly", context=CTX, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("clarify", question=q))), interpreter="nl1")
    assert out["envelope"]["question"]["choices"] == [
        {"label": "Left chart (NVDA)", "ref": "c1"}, {"label": "Right chart (AMD)", "ref": "c2"}, {"label": "Some other chart", "ref": None}]


def test_a_correction_needs_a_plan_and_the_last_change(flag_on):
    corr = {"replaces": "last_change"}
    # with the last change in the request and a plan: kept
    out = turn.run_turn(message="no I meant 15", context={**CTX, **MEM}, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("apply", [TF15], correction=corr))), interpreter="nl1")
    assert out["envelope"]["correction"] == corr
    # no last change in the request: dropped (nothing the browser could reverse)
    out = turn.run_turn(message="no I meant 15", context=CTX, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("apply", [TF15], correction=corr))), interpreter="nl1")
    assert out["envelope"]["correction"] is None
    # an answer never reverses anything
    out = turn.run_turn(message="no I meant 15", context={**CTX, **MEM}, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("answer", reply="Sure.", correction=corr))), interpreter="nl1")
    assert out["envelope"]["correction"] is None and out["envelope"]["ops"] == []


def test_legacy_guards_still_run_first(flag_on):
    # an unknown target → a question, never a guess (and no correction rides along)
    bad = {"action": "chart.setTimeframe", "target": "c9", "args": {"timeframe": "W"}}
    out = turn.run_turn(message="weekly", context={**CTX, **MEM}, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("apply", [bad], correction={"replaces": "last_change"}))), interpreter="nl1")
    assert out["envelope"]["disposition"] == "clarify" and out["envelope"]["ops"] == [] and out["envelope"]["correction"] is None
    # a plan's reply claiming it is done is blanked (UCT's receipt is the only record)
    out = turn.run_turn(message="15m", context=CTX, history=[], capabilities=CATALOG,
                        caller=caller_of(_resp(nl1_env("apply", [TF15], reply="Done."))), interpreter="nl1")
    assert out["envelope"]["reply"] == ""
    # an action that doesn't exist refuses the whole plan
    ghost = {"action": "broker.buy", "target": "c1", "args": {}}
    with pytest.raises(turn.TurnError):
        turn.run_turn(message="buy 100 NVDA", context=CTX, history=[], capabilities=CATALOG,
                      caller=caller_of(_resp(nl1_env("apply", [ghost]))), interpreter="nl1")


def test_the_glossary_is_data_and_every_entry_names_its_source():
    g = json.load(open(os.path.join(HERE, "..", "api", "services", "uct_agent", "nl1_glossary.json"), encoding="utf-8"))
    assert g["terms"] and all(t.get("words") and t.get("means") and t.get("source") for t in g["terms"])
