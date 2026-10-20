"""NL-1 hybrid action selection — the server half (owner 2026-10-20).

The browser (app/src/agent/nl1/selection.js) sends a ROUTED NL-1 request: the fixed core first (`routing.stable`),
the other selected groups after it, every other group named. Holds the server to:
  • the 60-action limit is unchanged for NL-1 — a routed request is refused whole above it;
  • routed requests are honoured for NL-1 (need_groups in the schema, the unselected groups named), and the
    selection decides only what the model SEES: an action the request did not carry never runs;
  • the system prompt is cache blocks, most stable first: [core + rules + glossary] [reference] [the rest];
    the first is byte-identical whatever else the request carries;
  • NO SUBSTITUTION is in the routed rules; the whole-catalog prompt is unchanged;
  • a request for more groups plans nothing and is never repaired first (the browser's reroute takes the call);
  • `routing.stable` is only a layout hint: malformed values are ignored, and never change what may run;
  • flag OFF: a routed NL-1 request is served exactly as the legacy request.
No paid call: every model response is a fake."""
import json
import os

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import _resp, caller_of
from tests.test_uct_agent_nl1 import CATALOG, CTX, TF15, nl1_env

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = json.load(open(os.path.join(HERE, "fixtures", "nl1_assemble_parity.json"), encoding="utf-8"))
BY_NAME = {c["name"]: c for c in CATALOG}


def routed(selected_extra: list[str]):
    """A routed NL-1 request as the browser assembles it (the parity fixture's case for core + these groups)."""
    want = sorted([*PARITY["core"], *selected_extra])
    case = next(c for c in PARITY["cases"] if sorted(c["selected"]) == want)
    return [BY_NAME[n] for n in case["names"]], case["routing"]


CORE_LAYOUTS = routed(["layouts"])
REF = {"indicatorCatalog": [{"defId": "rsi", "name": "RSI"}]}


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(turn.NL1_ENV, "1")              # the SHIPPED limit (60): no lift anywhere in this file


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(turn.NL1_ENV, raising=False)


def run(caps, routing, env, **kw):
    c = caller_of(*[_resp(e) for e in (env if isinstance(env, list) else [env])])
    out = turn.run_turn(message=kw.pop("message", "flip the left one to 15m"), context=kw.pop("context", CTX), history=[],
                        capabilities=caps, routing=routing, caller=c, interpreter="nl1", **kw)
    return out, c


def test_the_limit_is_still_60_and_a_routed_request_over_it_is_refused_whole(flag_on):
    assert turn.MAX_CAPABILITIES == 60 and turn.MAX_CAPABILITIES_NL1 == 60
    caps, routing = CORE_LAYOUTS
    extra = [c for c in CATALOG if c not in caps][: 61 - len(caps)]
    with pytest.raises(turn.TurnError, match="too many actions"):
        run(caps + extra, routing, nl1_env("answer", reply="ok"))
    out, _ = run(caps + extra[:-1], routing, nl1_env("answer", reply="ok"))     # exactly 60: served
    assert out["envelope"]["disposition"] == "answer"


def test_a_routed_nl1_request_is_three_cache_blocks_core_first(flag_on):
    caps, routing = CORE_LAYOUTS
    _, c = run(caps, routing, nl1_env("apply", [TF15]), reference=REF)
    system = c.calls[0]["system"]
    assert len(system) == 3 and all(b["cache_control"] == {"type": "ephemeral"} for b in system)
    first, ref, rest = (b["text"] for b in system)
    core = caps[:routing["stable"]]
    for cap in core:
        assert f"- {cap['name']}(" in first and f"- {cap['name']}(" not in rest
    for cap in caps[routing["stable"]:]:
        assert f"- {cap['name']}(" in rest and f"- {cap['name']}(" not in first
    assert "UNDERSTANDING THE MEMBER" in first and "UCT'S OWN MEANINGS" in first and "NO SUBSTITUTION" in first
    assert "REFERENCE DATA" in ref
    assert "OTHER ACTION GROUPS" in rest and "- lists:" in rest and "- layouts:" not in rest.split("OTHER ACTION GROUPS")[1]
    schema = c.calls[0]["output_config"]["format"]["schema"]
    assert "need_groups" in schema["required"]
    asked = schema["properties"]["need_groups"]["anyOf"][1]["items"]["enum"]
    assert set(asked) == {g["id"] for g in routing["groups"]} - set(routing["selected"])
    assert schema["properties"]["ops"]["items"]["properties"]["action"]["enum"] == [c["name"] for c in caps]


def test_the_core_block_is_byte_identical_whatever_else_the_request_carries(flag_on):
    seen = []
    for extra, msg in ((["layouts"], "open swing"), (["lists", "alerts"], "add AMD to momentum"), ([], "15m")):
        caps, routing = routed(extra)
        _, c = run(caps, routing, nl1_env("answer", reply="ok"), message=msg, reference=REF)
        seen.append(c.calls[0]["system"])
    assert seen[0][0] == seen[1][0] == seen[2][0]                    # the cached prefix
    assert seen[0][1] == seen[1][1] == seen[2][1]                    # the reference data after it
    assert seen[0][2] != seen[1][2]                                  # only the last block varies


def test_an_action_the_request_did_not_carry_never_runs(flag_on):
    caps, routing = CORE_LAYOUTS
    hidden = {"action": "widget.add", "target": "c1", "args": {}}
    assert "widget.add" not in {c["name"] for c in caps}
    # the model names it (twice: the server's one repair does not make it real) → refused, nothing is planned
    with pytest.raises(turn.TurnError, match="unreadable|doesn't exist"):
        run(caps, routing, [nl1_env("apply", [hidden]), nl1_env("apply", [hidden])])


def test_asking_for_groups_plans_nothing_and_is_never_repaired_first(flag_on):
    caps, routing = CORE_LAYOUTS
    env = {**nl1_env("apply", [{"action": "chart.setTimeframe", "target": "nope", "args": {"timeframe": "15"}}]),
           "need_groups": ["workspace"]}
    out, c = run(caps, routing, env)
    assert len(c.calls) == 1                                          # no server repair: the reroute takes call 2
    e = out["envelope"]
    assert e["need_groups"] == ["workspace"] and e["ops"] == [] and e["disposition"] == "clarify"
    assert e.get("correction") is None


def test_a_group_that_was_not_named_cannot_be_asked_for(flag_on):
    caps, routing = CORE_LAYOUTS
    out, _ = run(caps, routing, {**nl1_env("apply", [TF15]), "need_groups": ["layouts", "nope"]})
    assert "need_groups" not in out["envelope"] and out["envelope"]["ops"] == [TF15]   # layouts was SENT, nope never existed


@pytest.mark.parametrize("stable", [True, -1, 0, 10_000, "41", None, 3.5])
def test_a_malformed_stable_count_is_ignored_and_changes_nothing_that_may_run(flag_on, stable):
    caps, routing = CORE_LAYOUTS
    out, c = run(caps, {**routing, "stable": stable}, nl1_env("apply", [TF15]))
    text = "".join(b["text"] for b in c.calls[0]["system"])
    for cap in caps:                                                  # every carried action is still listed once
        assert text.count(f"- {cap['name']}(") == 1
    assert out["envelope"]["ops"] == [TF15]


def test_an_unrouted_nl1_request_keeps_the_whole_catalog_prompt(flag_on, monkeypatch):
    small = CORE_LAYOUTS[0][:30]
    _, c = run(small, None, nl1_env("answer", reply="ok"))
    system = c.calls[0]["system"]
    assert len(system) == 1
    assert "NO SUBSTITUTION" not in system[0]["text"] and "Every action UCT has is listed above" in system[0]["text"]


def test_routed_rules_differ_from_the_whole_catalog_rules_only_in_the_catalog_sentence():
    assert turn.NL1_ROUTED_RULES != turn.NL1_RULES
    assert turn.NL1_ROUTED_RULES.replace(turn._NL1_ROUTED_CATALOG, turn._NL1_WHOLE_CATALOG) == turn.NL1_RULES
    for words in ("ADD a chart", "never change an existing chart", "delete", "rename", "edit an indicator", "watchlist"):
        assert words in turn._NL1_ROUTED_CATALOG


def test_flag_off_a_routed_nl1_request_is_served_exactly_as_legacy(flag_off):
    caps, routing = CORE_LAYOUTS
    legacy_env = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None,
                  "research": None, "title": None, "need_groups": None}
    c1 = caller_of(_resp(legacy_env))
    turn.run_turn(message="hello", context=CTX, history=[], capabilities=caps, routing=routing, caller=c1, interpreter="nl1")
    c2 = caller_of(_resp(legacy_env))
    turn.run_turn(message="hello", context=CTX, history=[], capabilities=caps, routing=routing, caller=c2)
    assert c1.calls[0]["system"] == c2.calls[0]["system"] and c1.calls[0]["output_config"] == c2.calls[0]["output_config"]
    assert len(c1.calls[0]["system"]) == 1 and "UNDERSTANDING THE MEMBER" not in c1.calls[0]["system"][0]["text"]


def test_the_legacy_prompt_is_unchanged_by_the_catalog_refactor():
    """_system_prompt_core now builds its lines with _catalog_lines: the legacy text must be the same as before."""
    caps = turn.validate_manifest(CATALOG[:20])
    text = turn._system_prompt_core(caps, True)
    assert text.startswith(turn._SYSTEM_HEAD) and text.endswith(turn._SYSTEM_TAIL)
    assert text.count("- ") >= 20 and turn._COMPACT_OPS_RULE in text
    assert turn._system_prompt_core(caps[:5], False).find(turn._COMPACT_OPS_RULE) == -1
