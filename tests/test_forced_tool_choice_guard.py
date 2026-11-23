"""A MODEL THAT REJECTS A FORCED TOOL CALL IS REFUSED BY NAME, BEFORE ANY CALL.

Every assistant call here forces its tool (`tool_choice={"type": "tool", ...}`), and the model is one environment
variable (`CONCIERGE_MODEL`). Some Claude models reject a forced call with a 400. Pointed at one, every assistant
turn would pay a round trip to be refused, and the member would read a generic "not available" with nothing naming
the cause. Found by reading, 2026-11-23, before it happened.

Ruled the same day: the turn is refused under its own gate with its own sentence BEFORE any call and any charge;
never a fall back to `tool_choice: auto` (an unmeasured configuration must not reach members silently); and
`/api/health` says the setting is incompatible, and says only that.

Held here:
  * the table and its source (so it can be re-read), and the limit the table has;
  * THE CODE DEFAULTS, read from the modules' own syntax: no default model is on the table;
  * EVERY forced call in the backend, read from the syntax tree: a sixth one fails this file until it is named, and
    the three assistant turns check the guard before they reach their call;
  * with a listed model, the formula assistant, the conversation door and the script turn each refuse by name and
    the HTTP layer is never touched; with today's model the same requests reach it (the control);
  * the startup check: one named error in the log, one key on `/api/health`, absent when all is well.
No model is called and nothing reaches the network.
"""
from __future__ import annotations

import ast
import logging
from pathlib import Path

import pytest

from api.services import definition_concierge as concierge_module
from api.services import forced_tool_choice as F
from api.services import script_conversation as sc
from tests.test_definition_concierge import USER, bars, concierge  # noqa: F401 -- `concierge` is a fixture
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    _B, FakeClient, call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import A_PATCH, ACCEPTS, CHART, FORMULA_REQUEST, TABLE_REQUEST, lane  # noqa: F401 -- `lane` is a fixture

ROOT = Path(__file__).resolve().parents[1]
GATE = "internal:assistant-model"
LISTED = "claude-opus-5-5"
#: every forced tool call in the backend: (file, function). The first three are the assistant's and are GUARDED.
ASSISTANT_CALLS = {("api/services/definition_concierge.py", "_call_model"),
                   ("api/services/definition_conversation.py", "_call_model"),
                   ("api/services/script_conversation.py", "_call_model")}
OTHER_FORCED_CALLS = {("api/services/indicator_from_image.py", "candidates_from_image"),
                      ("api/services/screener/nl_compile.py", "_call")}


def _tree(rel):
    return ast.parse((ROOT / rel).read_text(encoding="utf-8"))


# ── the table ──

def test_the_table_is_the_six_models_of_its_source_and_says_where_to_read_it_again():
    assert F.REJECTED_BY == {"claude-fable-5-2", "claude-mythos-5-2", "claude-opus-5-5", "claude-sonnet-5-5",
                             "claude-fable-5-1", "claude-mythos-5-1"}
    assert F.SOURCE == "https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools"
    assert F.SECTION == "Controlling Claude's output > Forcing tool use" and F.READ_ON == "2026-11-23"
    said = " ".join(F.__doc__.split())
    for part in (F.SOURCE, 'section "Controlling Claude\'s output" > "Forcing tool use"',
                 "A model released after that date is NOT listed here", "must read that section again",
                 "NEVER A FALL BACK TO `tool_choice: auto`"):
        assert part in said, part


@pytest.mark.parametrize("model_id,said", [
    ("claude-opus-5-5", True), ("claude-sonnet-5-5", True), ("claude-fable-5-2", True), ("claude-mythos-5-1", True),
    ("anthropic.claude-opus-5-5", True), ("us.anthropic.claude-sonnet-5-5", True), ("claude-opus-5-5@20260401", True),
    ("claude-opus-5-5-20260401", True), ("  Claude-Opus-5-5 ", True),
    ("claude-opus-5", False), ("claude-opus-4-8", False), ("claude-sonnet-5", False), ("claude-haiku-5-5", False),
    ("claude-fable-5", False), ("claude-fable-5-10", False), ("", False), (None, False), (55, False),
])
def test_a_model_id_names_a_listed_model_or_it_does_not(model_id, said):
    assert F.rejects(model_id) is said


# ── the code defaults, from the modules' own syntax ──

def _defaults_of(rel, variables):
    """{variable: default} for every `os.environ.get("<variable>", "<default>")` in the file."""
    found = {}
    for node in ast.walk(_tree(rel)):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and len(node.args) == 2
                and all(isinstance(a, ast.Constant) and isinstance(a.value, str) for a in node.args) and node.args[0].value in variables):
            found[node.args[0].value] = node.args[1].value
    return found


def test_THE_CODE_DEFAULTS_no_default_model_rejects_the_forced_call_it_is_used_for():
    defaults = {
        **{("concierge", k): v for k, v in _defaults_of("api/services/definition_concierge.py", {"CONCIERGE_MODEL"}).items()},
        **{("image", k): v for k, v in _defaults_of("api/services/indicator_from_image.py", {"INDICATOR_VISION_MODEL"}).items()},
        **{("screener", k): v for k, v in _defaults_of("api/services/screener/nl_compile.py", {"CONCIERGE_MODEL"}).items()},
    }
    assert set(defaults) == {("concierge", "CONCIERGE_MODEL"), ("image", "INDICATOR_VISION_MODEL"), ("screener", "CONCIERGE_MODEL")}
    for where, default in defaults.items():
        assert default and not F.rejects(default), (where, default)
    # CONTROL: the check can fail. A listed id in the same place is seen.
    assert F.rejects(LISTED)


# ── every forced call, from the syntax tree ──

def _forced_calls():
    sites = set()
    for path in sorted((ROOT / "api").rglob("*.py")):
        if "__pycache__" in path.parts or "node_modules" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(fn):
                if not isinstance(node, ast.Call):
                    continue
                for k in node.keywords:
                    if k.arg == "tool_choice" and isinstance(k.value, ast.Dict):
                        kinds = {v.value for key, v in zip(k.value.keys, k.value.values)
                                 if isinstance(key, ast.Constant) and key.value == "type" and isinstance(v, ast.Constant)}
                        if kinds & {"tool", "any"}:
                            sites.add((path.relative_to(ROOT).as_posix(), fn.name))
    return sites


def test_EVERY_forced_tool_call_in_the_backend_is_named_here():
    """A sixth forced call fails this until it is named, and its model is in `forced_tool_choice.configured`."""
    assert _forced_calls() == ASSISTANT_CALLS | OTHER_FORCED_CALLS
    # each call's model is one the startup check reads
    assert len(F.configured()) == 3 and {model_id for _what, model_id in F.configured()} == {"claude-opus-5"}


@pytest.mark.parametrize("rel,turn", [("api/services/definition_concierge.py", "propose"),
                                      ("api/services/definition_conversation.py", "_converse_turn"),
                                      ("api/services/script_conversation.py", "script_turn")])
def test_each_assistant_turn_asks_the_guard_before_it_reaches_its_call(rel, turn):
    fn = next(n for n in ast.walk(_tree(rel)) if isinstance(n, ast.FunctionDef) and n.name == turn)
    asked = [n.lineno for n in ast.walk(fn) if isinstance(n, ast.Call)
             and getattr(n.func, "attr", getattr(n.func, "id", None)) == "forced_tool_choice_unsupported"]
    called = [n.lineno for n in ast.walk(fn) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_call_model"]
    assert len(asked) == 1 and called and asked[0] < min(called), (turn, asked, called)


# ── with a listed model: refused by name, and the HTTP layer is never touched ──

def _refused_by_name(r, client):
    assert r["ok"] is False and r["gate"] == GATE and r["reason"] == concierge_module.REFUSALS[GATE], r
    assert client.calls == []                                         # nothing was sent
    assert "claude" not in r["reason"].lower() and "tool" not in r["reason"].lower()   # a member reads no model, no mechanism


def test_the_conversation_door_refuses_by_name_before_any_call(conv, clean_env, model, monkeypatch):
    monkeypatch.setattr(concierge_module, "MODEL", LISTED)
    client = model([])                                                # an armed call would FAIL: none may be made
    r = conv.converse(FORMULA_REQUEST, user_id="u1", view=empty_view(0), chart=CHART, admin=False, accepts=ACCEPTS)
    _refused_by_name(r, client)
    assert not r.get("cost_usd") and concierge_module.spend_for("u1", concierge_module._market_date()) == 0
    assert conv._INTERNAL_GATES >= {GATE}                             # ours to fix: never counted as the assistant's refusal


def test_CONTROL_with_todays_model_the_same_request_reaches_the_model(conv, clean_env, model):
    client = model([emits(A_PATCH)])
    r = conv.converse(FORMULA_REQUEST, user_id="u1", view=empty_view(0), chart=CHART, admin=False, accepts=ACCEPTS)
    assert r["ok"] is True and len(client.calls) == 1 and client.calls[0]["tool_choice"] == {"type": "tool", "name": conv.TOOL_NAME}


def test_the_script_turn_refuses_by_name_before_any_call(conv, clean_env, model, lane, monkeypatch):
    monkeypatch.setattr(concierge_module, "MODEL", LISTED)
    client = model([])
    r = conv.converse(TABLE_REQUEST, user_id="u1", view=empty_view(0), chart=CHART, admin=True, accepts=ACCEPTS)
    _refused_by_name(r, client)
    # and the script turn itself, asked directly
    direct = sc.script_turn(TABLE_REQUEST, user_id="u1", chart=CHART, cap_usd=1.0, calls=[], revision=0, contract=conv.PATCH_CONTRACT)
    _refused_by_name(direct, client)


def test_the_formula_assistant_refuses_by_name_before_any_call(concierge, model, monkeypatch):
    monkeypatch.setattr(concierge, "MODEL", LISTED)
    client = model([])
    r = concierge.propose("average the close over twenty bars", user_id=USER, bars=bars())
    _refused_by_name(r, client)


def test_the_guard_reads_the_model_that_is_configured_and_only_that(monkeypatch):
    assert concierge_module.forced_tool_choice_unsupported() is False        # today
    assert concierge_module.FORCED_TOOL_CHOICE_GATE == GATE and GATE in concierge_module.REFUSALS
    monkeypatch.setattr(concierge_module, "MODEL", LISTED)
    assert concierge_module.forced_tool_choice_unsupported() is True
    monkeypatch.setattr(concierge_module, "MODEL", "claude-opus-5")
    assert concierge_module.forced_tool_choice_unsupported() is False


# ── the startup check ──

def _health_setting():
    """`_assistant_model_setting` of api/main.py, run from its own source (the whole app is not started for it)."""
    fn = next(n for n in _tree("api/main.py").body if isinstance(n, ast.FunctionDef) and n.name == "_assistant_model_setting")
    space: dict = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "main_excerpt", "exec"), space)  # noqa: S102 -- this repository's own function
    return space["_assistant_model_setting"]


def test_the_server_says_so_once_in_its_log_and_on_health_and_nothing_when_all_is_well(monkeypatch, caplog):
    setting = _health_setting()
    with caplog.at_level(logging.ERROR, logger="api.services.forced_tool_choice"):
        assert F.startup_problem() is None and F.log_startup_problem() is None and setting() == {}
    assert caplog.records == []
    monkeypatch.setattr(concierge_module, "MODEL", "anthropic." + LISTED)
    assert F.incompatible() == ["the assistant (formula, conversation and script turns)"]
    with caplog.at_level(logging.ERROR, logger="api.services.forced_tool_choice"):
        assert F.log_startup_problem() == "incompatible"
    assert len(caplog.records) == 1 and "FORCED TOOL CHOICE UNSUPPORTED" in caplog.records[0].getMessage()
    assert F.SOURCE in caplog.records[0].getMessage()
    # /api/health: one key, and it says only that the setting is incompatible
    assert setting() == {"assistant_model": "incompatible"}


def test_health_carries_the_key_in_both_shapes_of_its_boot_summary_and_the_boot_logs_it():
    tree = _tree("api/main.py")
    summary = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_boot_summary")
    reads = [n for n in ast.walk(summary) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_assistant_model_setting"]
    assert len(reads) == 2                                             # before any boot mark exists, and after
    boot_log = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_boot_log")
    assert any(isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "log_startup_problem" for n in ast.walk(boot_log))
    health = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "health")
    assert any(isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_boot_summary" for n in ast.walk(health))
