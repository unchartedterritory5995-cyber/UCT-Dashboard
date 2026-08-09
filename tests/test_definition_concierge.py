"""Phase D Task 13 — the NL→AST concierge: it emits trees, it never writes the
sentence, and it knows how to refuse.

⭐ THE ONE CLAIM THIS FILE EXISTS TO PROVE STRUCTURALLY: the read-back a user
confirms is `sentenceFor(ast)` — deterministic, derived from the tree — and the
model cannot write it. A test that merely checked the output *looked* right would
pass a version that wrote its own prose, so the rail walks `propose`'s OWN AST and
requires `sentence` to be assigned from exactly that call. A second, independent
rail renders the same trees through the SHIPPED `sentence.js` under node and
requires byte equality, so poisoning the Python renderer is lethal too.

⭐⭐ AND THE SECOND CLAIM IS ATTRIBUTION. The defect this branch has produced SIX
times — twice inside harnesses built to catch it — is "refused by a different
door": a correct answer produced by the wrong mechanism. Every refusal case below
therefore does two runs: one with the gate, one with that gate ALONE removed, and
**the difference is the measurement**. A case that only asserted `ok is False`
would be satisfied by a pipeline that refuses everything.

⛔ NO LIVE MODEL CALLS. The boundary that is stubbed is the CLIENT
(`engine._get_anthropic_client`), not `_call_model` — so the real request kwargs,
the real tool-use extraction, the real temperature retry and the real token
accounting all run. Stubbing `_call_model` would have hidden every one of them
(`lesson_injected_dependency_hides_the_fetch`: 996 green tests shipped a feature
that ran in 0 of 24 charts because every test handed in a fake).
"""
from __future__ import annotations

import ast as pyast
import importlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Mapping

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import ast_table

ROOT = Path(__file__).resolve().parents[1]
AST_DIR = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
SENTENCE_JS = AST_DIR / "sentence.js"
PARSE_JS = AST_DIR / "parse.js"
PARITY_BARS = ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json"

USER = "u1"


# ═══ 0. the store the cost guard writes to ═════════════════════════════════

@pytest.fixture
def concierge(monkeypatch, tmp_path):
    """The module under test, with `cost_guard`'s SQLite store on a tmp path.

    ⚠️ THE REAL `cost_guard` RUNS. It is not stubbed anywhere in this file: the
    plan's instruction is *"the existing surface, CALLED — not a new one"*, and a
    stubbed guard would make every cap assertion below a statement about the stub.
    Only the DB it writes to moves.
    """
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()

    from api.services import definition_concierge as mod
    mod.reset_spend()
    yield mod
    mod.reset_spend()
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


# ═══ 1. a model that is not a model ════════════════════════════════════════

class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeClient:
    """Answers a scripted list, and RECORDS every call's kwargs.

    ⛔ IT REFUSES AN UNARMED CALL rather than looping. A fake that kept answering
    would make "the repair loop is bounded" unfalsifiable — the exact shape of a
    control that cannot fail.
    """

    def __init__(self, answers: List[Any]) -> None:
        self.answers = list(answers)
        self.calls: List[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.answers:
            raise AssertionError(
                f"the concierge called the model {len(self.calls)} times and the "
                f"test armed {len(self.calls) - 1}")
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def model(monkeypatch):
    """Arm the CLIENT. `_call_model` itself is never stubbed — see the header."""
    def arm(answers):
        client = FakeClient(answers)
        monkeypatch.setattr("api.services.engine._get_anthropic_client",
                            lambda: client, raising=True)
        return client
    return arm


def tool_use(tree, *, tool_id="tu_1", in_tokens=120, out_tokens=40, name=None):
    from api.services import definition_concierge as mod
    block = _Block(type="tool_use", id=tool_id,
                   name=name or mod.TOOL_NAME, input={"ast": tree})
    return _Block(content=[block], stop_reason="tool_use",
                  usage=_Block(input_tokens=in_tokens, output_tokens=out_tokens))


def text_only(text, *, in_tokens=100, out_tokens=20):
    return _Block(content=[_Block(type="text", text=text)], stop_reason="end_turn",
                  usage=_Block(input_tokens=in_tokens, output_tokens=out_tokens))


# ═══ 2. trees, DERIVED from the manifest ═══════════════════════════════════
#
# ⛔ NOTHING BELOW HAND-LISTS A TABLE NAME. Every corpus tree is built from
# `ast_table.TABLE`'s own key sets, so a function added to the manifest is
# covered by the totality cases without this file moving — and the anti-copy scan
# in section 3 asserts the concierge cannot cheat the same way.

TABLE = ast_table.TABLE
SERIES = sorted(TABLE[ast_table.SERIES_SECTION])
OPERATORS = sorted(TABLE[ast_table.OPERATORS_SECTION])
FUNCTIONS = sorted(TABLE[ast_table.FUNCTIONS_SECTION])
#: The fourth section. Read, never listed — `ast_table.scalar_names` is the one
#: derivation and a fifty-fifth scalar joins these cases the day it is declared.
SCALARS = sorted(ast_table.scalar_names(TABLE))

FIRST_SERIES = SERIES[0]
#: A function of (series, int) — used for the "ordinary answer" cases. Chosen by
#: shape from the manifest, not by name.
WINDOWED = next(f for f in FUNCTIONS
                if list(TABLE[ast_table.FUNCTIONS_SECTION][f]["args"]) == ["series", "int"])
#: ⚠️ BY SHAPE, NOT BY INDEX. `OPERATORS[0]` sorts to `!`, which is UNARY — the
#: first draft of this file built two-argument trees out of it and the read-back
#: refused them by arity. Picking by declared arity is the same discipline the
#: rest of this file applies to names.
BINARY_OP = next(o for o in OPERATORS
                 if TABLE[ast_table.OPERATORS_SECTION][o]["arity"] == 2)


def s(name=None) -> dict:
    return {"type": "series", "name": name or FIRST_SERIES}


def n(value) -> dict:
    return {"type": "num", "value": value}


def windowed(period: int = 20, fn: str = None) -> dict:
    return {"type": "call", "name": fn or WINDOWED, "args": [s(), n(period)]}


def minimal_call(fn: str) -> dict:
    kinds = list(TABLE[ast_table.FUNCTIONS_SECTION][fn]["args"])
    return {"type": "call", "name": fn,
            "args": [n(5) if k == "int" else s() for k in kinds]}


def minimal_op(name: str) -> dict:
    arity = TABLE[ast_table.OPERATORS_SECTION][name]["arity"]
    return {"type": "op", "name": name, "args": [s() for _ in range(arity)]}


# ═══ 2b. OPERANDS OF EVERY KIND THE MANIFEST CAN DECLARE ═══════════════════
#
# 🔴 A PARITY RAIL WHOSE CORPUS CANNOT REACH THE DIVERGENT CASE IS NOT A PARITY
# RAIL. `minimal_op` builds every operand out of `s()` — a BAR FIELD, which
# declares no `yields` and is therefore a NUMBER — so not one case in the corpus
# was a logical node whose operands were all CONDITIONS. `e6f1de2f` taught
# `sentence.js` a second phrase for exactly that shape; the two lanes began
# telling a member different English for `(close > open) && (close < high)`; and
# the cross-lane rail below stayed GREEN through all of it, because no case it
# owned could reach the branch. Green was luck, not coverage.
#
# ⛔ SO THE OPERANDS ARE FOUND IN THE MANIFEST, NEVER A HAND-PICKED PAIR.
# `_declared_yield_kinds` reads the `yields` values the manifest actually
# declares and `_entry_yielding` finds the first entry declaring each. Every one
# of those is then built over BOTH leaf kinds, so `passthrough` — whose kind is
# the JOIN of its arms — appears settled to a number AND settled to a condition
# without this file ever spelling the word. A fourth kind, or a renamed one,
# lands in the corpus the day the manifest declares it.
#
# ⚠️ AND THE COVERAGE OF THE SET IS ASSERTED, NOT ASSUMED
# (`test_the_cross_lane_corpus_REACHES_every_operand_kind`). A corpus that
# quietly stopped reaching a kind would put this rail straight back where it
# was: permanently green over the one case it cannot see.

#: The distinct `yields` values THE MANIFEST DECLARES, read off it. Not
#: `ast_table.YIELDS` — that is the set the resolver knows how to answer, and the
#: question here is which of them any entry actually claims.
def _declared_yield_kinds(table: Mapping[str, Any] = None) -> List[str]:
    t = table if table is not None else TABLE
    kinds = set()
    for section in (ast_table.OPERATORS_SECTION, ast_table.FUNCTIONS_SECTION,
                    ast_table.SCALARS_SECTION):
        for spec in (t.get(section) or {}).values():
            value = (spec or {}).get("yields")
            if isinstance(value, str):
                kinds.add(value)
    return sorted(kinds)


def _entry_yielding(kind: str, table: Mapping[str, Any] = None):
    """The first declared OPERATOR, then FUNCTION, whose `yields` is `kind`.

    ⚠️ SCALARS ARE NOT SEARCHED FOR AN *OPERAND*, and the reason has changed.
    It used to be that this lane could not SAY one; that divergence is closed
    (section 5b), and the 54 are now in `corpus()` as leaves in their own right.
    What this function picks is the operand that fills EVERY value position of
    every entry, and a scalar there would multiply the corpus by 54 to probe the
    same two `yields` branches a declared operator already reaches.
    """
    t = table if table is not None else TABLE
    for section in (ast_table.OPERATORS_SECTION, ast_table.FUNCTIONS_SECTION):
        for name in sorted(t.get(section) or {}):
            if ((t[section][name] or {}).get("yields")) == kind:
                return section, name
    return None, None


def _entry_tree(section: str, name: str, operand: dict,
                table: Mapping[str, Any] = None) -> dict:
    """One declared entry, filled with a chosen operand at every value position."""
    return _entry_tree_cycle(section, name, [operand], table)


def _entry_tree_cycle(section: str, name: str, operands: List[dict],
                      table: Mapping[str, Any] = None) -> dict:
    """…and the same, with the operands CYCLED across the value positions.

    ⭐ THIS IS HOW A MIXED SHAPE IS BUILT WITHOUT NAMING ONE. An entry with two or
    more value positions gets a different operand in each, so `?:` — whose kind is
    the JOIN of its arms — appears with arms that DISAGREE. `every` and `some`
    give the same answer for uniform arms, so a corpus built only from uniform
    ones cannot tell a join from a disjunction; measured, by a surviving mutation.

    ⚠️ BOUNDED THE SAME WAY `_probe_args` IS: an arity a manifest declares as a
    fraction or something enormous builds an EMPTY argument list rather than
    allocating until the box dies.
    """
    t = table if table is not None else TABLE
    spec = t[section][name] or {}
    pick = lambda i: dict(operands[i % len(operands)])       # noqa: E731
    if section == ast_table.OPERATORS_SECTION:
        arity = spec.get("arity")
        count = arity if isinstance(arity, int) and not isinstance(arity, bool) \
            and 0 <= arity <= 16 else 0
        return {"type": "op", "name": name, "args": [pick(i) for i in range(count)]}
    args, slot = [], 0
    for kind in list(spec.get("args") or ()):
        if kind == "int":
            args.append(n(5))
            continue
        args.append(pick(slot))
        slot += 1
    return {"type": "call", "name": name, "args": args}


#: ⚠️ THE THREE LITERALS ARE STRUCTURE, NOT VOCABULARY — the same distinction
#: `scan_definition` draws when it spells the four node types and no table name.
#: Both lanes declare the same rule about a `num` leaf ("a condition iff it is 0
#: or 1, the two values a 0/1 column holds"), so the corpus has to carry a leaf
#: on each side of it and one clear of it. Which KIND each of them is, is never
#: asserted here — it is measured, by the two lanes, in the cross-check.
_LITERAL_OPERANDS = (0, 1, 2)


def operand_exemplars(table: Mapping[str, Any] = None) -> Dict[str, dict]:
    """One operand tree per kind an operand can be, DERIVED from the manifest."""
    t = table if table is not None else TABLE
    #: The two leaves a value position can hold: a bar field (declares no
    #: `yields`, so it is a price) and the first entry the manifest declares as
    #: a condition, over bar fields. Both FOUND, neither named.
    leaves: Dict[str, dict] = {"field": s()}
    for kind in _declared_yield_kinds(t):
        section, name = _entry_yielding(kind, t)
        if section is not None:
            leaves.setdefault(f"yields-{kind}", _entry_tree(section, name, s(), t))

    out: Dict[str, dict] = {f"literal-{v}": n(v) for v in _LITERAL_OPERANDS}
    out["field"] = s()
    ordered = [leaves[key] for key in sorted(leaves)]
    for kind in _declared_yield_kinds(t):
        section, name = _entry_yielding(kind, t)
        if section is None:
            continue
        for leaf_id, leaf in sorted(leaves.items()):
            out[f"{kind}-over-{leaf_id}"] = _entry_tree(section, name, leaf, t)
        # ⭐ AND ONE WITH THE LEAVES DISAGREEING ACROSS THE POSITIONS. See
        # `_entry_tree_cycle`: uniform arms cannot tell `every` from `some`.
        if len(ordered) > 1:
            out[f"{kind}-mixed"] = _entry_tree_cycle(section, name, ordered, t)
            out[f"{kind}-mixed-reversed"] = _entry_tree_cycle(
                section, name, list(reversed(ordered)), t)
    return out


def _binary_operators(table: Mapping[str, Any] = None) -> List[str]:
    t = table if table is not None else TABLE
    return [name for name in sorted(t[ast_table.OPERATORS_SECTION])
            if (t[ast_table.OPERATORS_SECTION][name] or {}).get("arity") == 2]


def corpus() -> Dict[str, dict]:
    """One minimal tree per DECLARED entry, plus composites. Derived, so a new
    manifest entry lands here automatically.

    ⭐ AND ONE TREE PER (DECLARED ENTRY × OPERAND KIND), which is the half that
    was missing. See section 2b: the chrome of a logical operator now depends on
    what its operands YIELD, so a corpus that only ever passes bar fields probes
    one of two branches and reports parity about the other.
    """
    out: Dict[str, dict] = {}
    for name in SERIES:
        out[f"series::{name}"] = s(name)
    # ⭐ AND THE FOURTH SECTION, WHICH USED TO BE PINNED OUT OF THIS CORPUS. The
    # Python lane could not say a scalar until E-5 taught `compile_rules` and
    # `_render_name` the section, so every one of these cases would have been a
    # known divergence and the rail carried a name list instead. Now the 54 are
    # rendered by BOTH lanes and compared byte for byte — which is the strongest
    # available statement that the closure is real and not just green.
    for name in SCALARS:
        out[f"scalar::{name}"] = s(name)
    for name in OPERATORS:
        out[f"op::{name}"] = minimal_op(name)
    for name in FUNCTIONS:
        out[f"fn::{name}"] = minimal_call(name)

    exemplars = operand_exemplars()
    for name in OPERATORS:
        for operand_id, operand in exemplars.items():
            out[f"op::{name}::{operand_id}"] = _entry_tree(
                ast_table.OPERATORS_SECTION, name, operand)
    for name in FUNCTIONS:
        for operand_id, operand in exemplars.items():
            out[f"fn::{name}::{operand_id}"] = _entry_tree(
                ast_table.FUNCTIONS_SECTION, name, operand)

    # ⭐ AND THE MIXED PAIR, WHICH IS ITS OWN BRANCH. `above_50sma && close` is
    # the coercion actually happening, so the scaffolding must STAY — a lane that
    # smoothed a mixed pair would be wrong in the opposite direction, and both
    # orders are carried because "every operand" is not "some operand".
    field = exemplars["field"]
    conditions = [tree for key, tree in sorted(exemplars.items())
                  if key.startswith("bool-over-")]
    for name in _binary_operators():
        for i, other in enumerate(conditions):
            out[f"op::{name}::mixed-{i}-field-first"] = {
                "type": "op", "name": name, "args": [dict(field), dict(other)]}
            out[f"op::{name}::mixed-{i}-field-second"] = {
                "type": "op", "name": name, "args": [dict(other), dict(field)]}

    out["composite::nested"] = {
        "type": "op", "name": BINARY_OP,
        "args": [windowed(20), minimal_call(FUNCTIONS[0])]}
    out["composite::literal"] = n(20)
    return out


#: ⭐⭐ A TREE THE LINTER BRANDS `repaints` AND EVERY OTHER STAGE ACCEPTS — and
#: finding one is itself a finding.
#:
#: With the SHIPPED manifest no table-legal tree has a forward reach at all (Task
#: 8's declared property: every `lookback` is ≥ 0 or `"argK"`), so `repaints` is
#: only reachable through the linter's FAIL-CLOSED branch: a window it cannot
#: BOUND. The obvious construction — a computed window like `5 != 5` — never
#: reaches the linter, because `check_budget` → `max_lookback` refuses it at
#: `resolve:window` first.
#:
#: ⚠️ SO THIS IS THE PINNED DIVERGENCE, AND IT IS A REAL ONE. An INTEGRAL FLOAT
#: window (`5.0`) is accepted by `ast_interpret._window_literal`
#: (`float(v).is_integer()`) and computes normally, while
#: `ast_lint._resolve_declaration` requires `isinstance(value, int)` and answers
#: UNKNOWN → `repaints`. Measured, not assumed (the assertions below run all three
#: modules). It is safe in the fail-closed direction and it is out of reach of the
#: ONE parser — `jsep('5.0')` yields the number 5 — but a MODEL emitting JSON can
#: write `5.0`, which is exactly why the concierge needs the lint gate to be
#: reachable. A fix on either side breaks this case, which is the point of pinning
#: it: the two modules must move together or say why.
def repainting_tree() -> dict:
    return {"type": "call", "name": WINDOWED, "args": [s(), n(5.0)]}


#: A tree that is BOTH over the node budget AND unreadable to the linter. Section
#: 6 uses it to prove the budget stage runs BEFORE the lint stage: delete the
#: budget call and the same input comes back as a REPAINT refusal — a correct
#: answer from the wrong door.
def over_budget_and_repainting() -> dict:
    leaf = repainting_tree()
    tree = dict(leaf)
    for _ in range(40):
        tree = {"type": "op", "name": BINARY_OP, "args": [tree, repainting_tree()]}
    return tree


def bars() -> List[dict]:
    payload = json.loads(PARITY_BARS.read_text(encoding="utf-8"))
    return [dict(b) for b in payload["bars"]]


# ═══ 3. THE TOOL SCHEMA IS GENERATED FROM THE MANIFEST ═════════════════════

def test_the_TOOL_SCHEMA_is_generated_from_the_manifest_and_lists_every_arity(concierge):
    """⭐ THE CLOSED TABLE IS THE TOOL SCHEMA, so an out-of-table call is a SCHEMA
    VIOLATION at the API boundary rather than a runtime surprise.

    `grade_ticker`'s ruling applied to a grammar: *decisiveness is STRUCTURAL, not
    prompted*. A prompt that ASKS a model to stay inside a vocabulary is a request;
    a schema that ENUMERATES the vocabulary is a constraint.
    """
    schema = concierge.tool_schema()
    assert set(schema["functions"]) == set(TABLE[ast_table.FUNCTIONS_SECTION])
    assert set(schema["operators"]) == set(TABLE[ast_table.OPERATORS_SECTION])
    # ⭐ EVERY SECTION THE MANIFEST DECLARES IS CARRIED, KEY FOR KEY — the schema
    # reads the section LIST off the file, so this comparison is over whatever
    # the manifest declares rather than over three names typed here.
    assert {section: set(entries) for section, entries in schema["sections"].items()} \
        == {section: set(TABLE[section]) for section in _declared_sections(TABLE)}
    for name, spec in TABLE[ast_table.FUNCTIONS_SECTION].items():
        assert schema["functions"][name]["arity"] == len(spec["args"])
    for name, spec in TABLE[ast_table.OPERATORS_SECTION].items():
        assert schema["operators"][name]["arity"] == spec["arity"]

    # …and the JSON Schema the API enforces carries the same key sets as ENUMS. A
    # schema whose enums drifted from the table would be a constraint on a
    # vocabulary nobody runs.
    #
    # ⭐ THE `series` ENUM IS SERIES **AND** SCALARS, because a scalar rides the
    # `series` node type — the manifest's own `_scalars_node` ruling, and the
    # reason `propose` can now be handed `rs_rank > 80` at all.
    defs = schema["input_schema"]["$defs"]
    assert defs["series"]["properties"]["name"]["enum"] == sorted(set(SERIES) | set(SCALARS))
    assert defs["op"]["properties"]["name"]["enum"] == OPERATORS
    assert defs["call"]["properties"]["name"]["enum"] == FUNCTIONS
    assert len(SERIES) + len(OPERATORS) + len(FUNCTIONS) == 31, (
        "the manifest declares 31 bar entries; if that moved, this file's "
        "totality cases moved with it and the change should be deliberate")
    assert len(ast_table.declared_names(TABLE)) == 31 + len(SCALARS) == 85, (
        "the closed table declares 85 names across four sections; the enums "
        "above are that same set, partitioned by node type")


def test_a_PLANTED_manifest_entry_reaches_the_schema_BY_NAME_with_no_edit_here(concierge):
    """⛔ DERIVED, BOTH DIRECTIONS. A hand-written schema is a third copy of the
    table and it would drift the first time a function was added — silently,
    because every existing test would stay green. So the rail plants an entry in a
    SYNTHETIC manifest and requires it back by name: a hand-list cannot answer.
    """
    planted = {
        ast_table.SERIES_SECTION: dict(TABLE[ast_table.SERIES_SECTION]),
        ast_table.OPERATORS_SECTION: dict(TABLE[ast_table.OPERATORS_SECTION]),
        ast_table.FUNCTIONS_SECTION: dict(TABLE[ast_table.FUNCTIONS_SECTION]),
    }
    planted[ast_table.FUNCTIONS_SECTION]["zzPlantedFn"] = {
        "args": ["series", "series", "int"], "lookback": 0,
        "sentence": "the planted reading of {0}, {1} and {2}"}
    planted[ast_table.SERIES_SECTION]["zzPlantedSeries"] = {"field": "c", "doc": "planted"}
    planted[ast_table.OPERATORS_SECTION]["zz~"] = {"arity": 2}

    schema = concierge.tool_schema(planted)
    assert "zzPlantedFn" in schema["functions"]
    assert schema["functions"]["zzPlantedFn"]["arity"] == 3
    assert "zzPlantedSeries" in schema["input_schema"]["$defs"]["series"]["properties"]["name"]["enum"]
    assert "zz~" in schema["input_schema"]["$defs"]["op"]["properties"]["name"]["enum"]
    # …and the prompt's English half comes from the SAME derivation, so the model
    # is never told a smaller vocabulary than the schema enforces.
    assert "zzPlantedFn" in concierge.vocabulary_text(planted)


def _clone_table(table: Mapping[str, Any] = None) -> Dict[str, Any]:
    """A MUTABLE copy of the manifest, one level deep. The shipped table is
    frozen (`MappingProxyType`), so a plant needs its own dictionaries; the
    entries themselves are never edited, so one level is enough."""
    t = table if table is not None else TABLE
    return {k: (dict(v) if isinstance(v, Mapping) else v) for k, v in t.items()}


def _every_name_enum(schema: Any) -> List[List[str]]:
    """Every `enum` list anywhere in a JSON Schema, found BY SHAPE.

    ⛔ NOT `$defs['series']['properties']['name']['enum']`. A path typed here
    would decide in advance WHICH enum a new section is allowed to reach, and the
    whole claim is that this file does not know and does not need to: the schema
    reads its section list off the manifest, so a section that arrives after this
    test was written must still turn up somewhere in the vocabulary the boundary
    enforces.
    """
    out: List[List[str]] = []
    stack: List[Any] = [schema]
    while stack:
        node = stack.pop()
        if isinstance(node, Mapping):
            values = node.get("enum")
            if isinstance(values, list):
                out.append([str(v) for v in values])
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return out


def test_a_PLANTED_SCALAR_reaches_the_tool_schema_BY_NAME_with_no_edit_here(concierge):
    """⭐ THE FOURTH SECTION ARRIVES AS DATA. The schema's enums are the table's
    own key sets, so the scalars section must reach the model's vocabulary
    WITHOUT a line of that module changing — and the only way to prove that is a
    SYNTHETIC manifest carrying a name no source file contains.

    ⛔ AND THE PROMPT'S ENGLISH HALF COMES FROM THE SAME DERIVATION. A schema that
    enforces a vocabulary the prompt never mentions produces a model that guesses
    and a boundary that refuses — technically correct, uselessly.
    """
    planted = _clone_table()
    planted[ast_table.SCALARS_SECTION] = dict(planted.get(ast_table.SCALARS_SECTION, {}))
    planted[ast_table.SCALARS_SECTION]["zzPlantedScalar"] = {
        "source": {"store": "screener_rows", "column": "zz"},
        "as_of": {"column": "snapshot_date", "grain": "date"},
        "cadence": "nightly", "yields": "num", "sentence": "the planted value"}

    schema = concierge.tool_schema(planted)
    enums = _every_name_enum(schema["input_schema"])
    assert any("zzPlantedScalar" in e for e in enums), (
        "the scalars section did not reach a single enum — the schema is not "
        "reading the manifest's sections, it is reading three of them by name")
    assert "zzPlantedScalar" in concierge.vocabulary_text(planted)
    # …and the manifest's own English for it, not a name echoed back.
    assert "the planted value" in concierge.vocabulary_text(planted)

    # The control: the same walk over a manifest WITHOUT the plant must not find
    # it, or the assertion above passes against any string at all.
    assert not any("zzPlantedScalar" in e
                   for e in _every_name_enum(concierge.tool_schema()["input_schema"]))
    assert "zzPlantedScalar" not in concierge.vocabulary_text()


def test_the_SECTION_LIST_is_read_from_the_manifest_not_typed_here(concierge):
    """⛔ THE ANTI-COPY SCAN, EXTENDED TO SECTIONS.
    `test_no_declared_FUNCTION_or_SERIES_name_is_a_string_constant_in_this_module`
    already forbids the NAMES. A fourth hard-coded `for name, spec in
    t["scalars"].items()` block would pass that rail and still be a hand-list —
    of SECTIONS rather than of entries.

    So: plant a FIFTH section in a synthetic manifest and require its entries
    back. A module that enumerates four sections by name cannot answer.
    """
    planted = _clone_table()
    planted["zzPlantedSection"] = {"zzFromFifth": {"doc": "planted"}}
    enums = _every_name_enum(concierge.tool_schema(planted)["input_schema"])
    assert any("zzFromFifth" in e for e in enums), (
        "a fifth section's entries reached no enum — the section list is typed "
        "in the module rather than read off the manifest")
    assert "zzFromFifth" in concierge.vocabulary_text(planted)

    # The control, both halves.
    assert not any("zzFromFifth" in e
                   for e in _every_name_enum(concierge.tool_schema()["input_schema"]))
    # …and the manifest's own annotation convention is still respected: an
    # underscore key is a NOTE, not a vocabulary, so it must NOT arrive as one.
    noted = _clone_table()
    noted["_zzPlantedNote"] = {"zzFromNote": {"doc": "a note, not a section"}}
    assert not any("zzFromNote" in e
                   for e in _every_name_enum(concierge.tool_schema(noted)["input_schema"])), (
        "an `_`-prefixed note was read as a vocabulary section — the manifest is "
        "full of them and every one would become a name the model may emit")


def test_no_declared_FUNCTION_or_SERIES_name_is_a_string_constant_in_this_module(concierge):
    """⛔ THE ANTI-COPY SCAN, BY AST AND NEVER BY GREP. A reader does not spell the
    names; a copy necessarily does. Full-equality against string CONSTANTS, so a
    docstring that mentions a word in prose cannot trip it and a hand-list cannot
    hide in one.

    ⚠️ OPERATOR NAMES ARE EXEMPT AND THAT IS DECLARED, NOT AN OVERSIGHT. The
    manifest gives operators a name and an arity and NO read-back phrase, so the
    English has to live in a module — `sentence.js` says exactly this in its own
    header. Those phrases are keyed by operator name and are pinned instead by the
    cross-lane equality in section 4, which is a stronger rail than absence.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    constants = {node.value for node in pyast.walk(pyast.parse(src))
                 if isinstance(node, pyast.Constant) and isinstance(node.value, str)}
    forbidden = (set(TABLE[ast_table.FUNCTIONS_SECTION])
                 | set(TABLE[ast_table.SERIES_SECTION]))
    assert not (constants & forbidden), (
        f"{sorted(constants & forbidden)} appear as string constants — the schema "
        "must READ the manifest, not copy it")

    # The positive control: the same walk over a synthetic hand-copy DOES find
    # them, so a broken scan cannot report a clean file.
    hand = pyast.parse(f"FUNCTIONS = [{', '.join(repr(f) for f in FUNCTIONS[:3])}]")
    found = {node.value for node in pyast.walk(hand)
             if isinstance(node, pyast.Constant) and isinstance(node.value, str)}
    assert found & forbidden == set(FUNCTIONS[:3])


# ═══ 4. THE CONCIERGE NEVER PRODUCES THE SENTENCE ══════════════════════════

def _assigns_to(fn: pyast.FunctionDef, target: str) -> List[str]:
    out = []
    for node in pyast.walk(fn):
        if isinstance(node, pyast.Assign):
            names = [t.id for t in node.targets if isinstance(t, pyast.Name)]
            if names == [target]:
                out.append(pyast.unparse(node.value))
    return out


def _function(module_src: str, name: str) -> pyast.FunctionDef:
    tree = pyast.parse(module_src)
    return next(node for node in pyast.walk(tree)
                if isinstance(node, pyast.FunctionDef) and node.name == name)


def test_the_concierge_NEVER_produces_the_sentence_ON_EITHER_KIND(concierge):
    """⛔ THE READ-BACK COMES FROM `sentenceFor(ast)` AND FROM NOWHERE ELSE.

    A model-written summary of a model-written formula is two guesses agreeing,
    and a user has no way to tell that pair apart from a correct one. ⭐ SO IT IS
    ASSERTED STRUCTURALLY: `propose`'s own AST is walked and `sentence` must be
    assigned from EXACTLY `sentence_for(ast_obj)`. A behavioural test cannot see
    this — a model that happened to write the right sentence would satisfy it.

    🔴 RE-ASSERTED STRUCTURALLY AFTER THE EXTENSION. `propose` now takes a `kind`,
    and the cheapest way to add a scan path is a second return statement — with a
    second `sentence`. So the rail is not "one assignment" but "EVERY assignment
    to `sentence`, in every function of this module, is `sentence_for(ast_obj)`".

    ⭐ AND THE VOCABULARY MAKES IT MORE LOAD-BEARING, NOT LESS. A member who says
    "trending stocks" is shown the firm's expansion read back FROM THE TREE and
    confirms or corrects it BEFORE anything is saved. The AI proposes; the tree is
    the truth; the sentence is derived from the tree.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    sources = _assigns_to(_function(src, "propose"), "sentence")
    assert sources and set(sources) == {"sentence_for(ast_obj)"}, (
        f"`sentence` was assigned from {sources} — the read-back is derived from "
        "the tree on every path, or it is derived on none of them")

    tree = pyast.parse(src)
    for fn in (node for node in pyast.walk(tree)
               if isinstance(node, pyast.FunctionDef)):
        for assigned in _assigns_to(fn, "sentence"):
            assert assigned == "sentence_for(ast_obj)", (
                f"{fn.name} assigns sentence from {assigned}")


def test_the_structural_rail_REPORTS_A_SYNTHETIC_OFFENDER_BY_NAME():
    """⚠️ THE CONTROL, AND WITHOUT IT THE RAIL IS VACUOUS. A gate is real only if
    something fails on it, and the rail above passes trivially against a module
    with no `propose` at all. So a synthetic module that assigns `sentence` from
    the MODEL RESPONSE must be reported by the offending EXPRESSION — not merely
    "something is wrong" — and the clean twin must come back clean IN THE SAME
    TEST, or the walk could be reporting everything.
    """
    poisoned = (
        "def propose(prompt, *, user_id, bars=None, kind='scan'):\n"
        "    answer = call_model(prompt)\n"
        "    ast_obj = answer['ast']\n"
        "    sentence = answer['summary']\n"
        "    return {'sentence': sentence}\n")
    assert _assigns_to(_function(poisoned, "propose"), "sentence") == ["answer['summary']"]

    clean = (
        "def propose(prompt, *, user_id, bars=None, kind='scan'):\n"
        "    ast_obj = 1\n"
        "    sentence = sentence_for(ast_obj)\n"
        "    return {'sentence': sentence}\n")
    assert _assigns_to(_function(clean, "propose"), "sentence") == ["sentence_for(ast_obj)"]


def test_sentence_for_reads_only_the_tree_and_the_manifest(concierge):
    """⛔ THE SECOND HALF OF THE SAME CLAIM. `sentence = sentence_for(ast_obj)` is
    worth nothing if `sentence_for` can see the model. Its call graph is walked
    and every function it can reach must be a renderer or a manifest read — no
    model call, no HTTP, no client.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    tree = pyast.parse(src)
    by_name = {node.name: node for node in pyast.walk(tree)
               if isinstance(node, pyast.FunctionDef)}

    reachable, stack = set(), ["sentence_for"]
    while stack:
        name = stack.pop()
        if name in reachable or name not in by_name:
            continue
        reachable.add(name)
        for node in pyast.walk(by_name[name]):
            if isinstance(node, pyast.Call) and isinstance(node.func, pyast.Name):
                stack.append(node.func.id)

    banned = {"_call_model", "propose", "_tool_input", "_repair_turns",
              "_get_anthropic_client"}
    assert not (reachable & banned), (
        f"`sentence_for` can reach {sorted(reachable & banned)} — the read-back "
        "must be a pure function of the tree")
    assert "_render_node" in reachable, (
        "the scan found no renderer at all, so it proves nothing")
    # ⭐ AND THE `yields` QUESTION IS DELEGATED, NOT ANSWERED HERE. `_is_condition`
    # has to be ON that call graph or the chrome is deciding by some other means;
    # the WIRE itself is proved behaviourally in the next case.
    assert "_is_condition" in reachable, (
        "`sentence_for` never asks whether an operand is already a condition — "
        "the logical chrome cannot be consulting `yields` at all")


def test_the_chrome_DELEGATES_the_yields_question_and_the_wire_is_LIVE(concierge, monkeypatch):
    """⛔ THE WIRE, CUT IN BOTH DIRECTIONS — because two components that are each
    correct can be joined by nothing at all, and every component test stays green
    while they are.

    `scan_definition.is_boolean_tree` is the lane's ONE resolver of the manifest's
    `yields` over a tree. The read-back CALLS it; it does not reimplement it. So
    replacing that function must move the read-back's chrome — if it does not, the
    concierge has grown a third resolver (or bound the name at import and severed
    itself from the module, which is the same defect wearing a different hat).

    ⚠️ THE STUB IS A CONSTANT, NOT A NEGATION. Answering "everything is a
    condition" and "nothing is" are two different wires, and a chrome consulting a
    private copy would follow neither.
    """
    from api.services import scan_definition

    def sr(name):
        return {"type": "series", "name": name}

    conditions = {"type": "op", "name": "&&", "args": [
        {"type": "op", "name": ">", "args": [sr("close"), sr("open")]},
        {"type": "op", "name": "<", "args": [sr("close"), sr("high")]}]}
    numbers = {"type": "op", "name": "&&", "args": [sr("close"), sr("volume")]}

    smoothed = concierge.sentence_for(conditions)
    scaffolded = concierge.sentence_for(numbers)
    assert smoothed != scaffolded and "not zero" not in smoothed, (
        "the shipped chrome is not distinguishing the two forms at all")
    assert "not zero" in scaffolded, "the `num` control lost its coercion"

    monkeypatch.setattr(scan_definition, "is_boolean_tree", lambda *a, **k: False)
    assert "not zero" in concierge.sentence_for(conditions), (
        "the resolver was replaced with `nothing is a condition` and the read-back "
        "smoothed anyway — the chrome is not asking `scan_definition`")

    monkeypatch.setattr(scan_definition, "is_boolean_tree", lambda *a, **k: True)
    assert "not zero" not in concierge.sentence_for(numbers), (
        "the resolver was replaced with `everything is a condition` and the "
        "read-back scaffolded anyway — the chrome is not asking `scan_definition`")


def test_the_chrome_reads_the_MANIFEST_the_RULES_were_compiled_from(concierge):
    """⛔ A PLANTED `yields` MOVES THE SENTENCE, IN BOTH DIRECTIONS — which is
    what makes the decision the MANIFEST's and not this module's.

    ⚠️ AND IT IS THE MANIFEST THE RULES WERE COMPILED FROM, not the shipped one.
    A chrome that always classified against `ast_table.TABLE` would answer a
    planted table's tree with the shipped table's `yields`, silently, and every
    case above would stay green because the shipped table is what they use.
    `sentence.js` gets this right by carrying `yields` on the compiled rows; this
    lane carries the manifest itself and hands it to the one resolver.

    ⭐ THE OPERATORS ARE FOUND BY THEIR DECLARATION, never named: the subject is
    the first binary operator the manifest calls a condition, and the control is
    the first it calls a number.
    """
    from api.services import scan_definition

    ops = ast_table.OPERATORS_SECTION

    def first_binary(kind):
        return next(name for name in sorted(TABLE[ops])
                    if TABLE[ops][name].get("arity") == 2
                    and TABLE[ops][name].get("yields") == kind)

    joiner = next(name for name in sorted(concierge.OPERATOR_SENTENCE_CONDITIONS)
                  if TABLE[ops][name].get("arity") == 2)
    a_condition = first_binary(scan_definition._KIND_BOOL)
    a_number = first_binary(scan_definition._KIND_NUM)

    def joined(operand_op):
        def leaf():
            return {"type": "op", "name": operand_op, "args": [s("close"), s("open")]}
        return {"type": "op", "name": joiner, "args": [leaf(), leaf()]}

    shipped = concierge.compile_rules(TABLE)
    assert "not zero" not in concierge.explain_sentence(
        joined(a_condition), {}, shipped)["text"], "the shipped chrome does not smooth"
    assert "not zero" in concierge.explain_sentence(
        joined(a_number), {}, shipped)["text"], "the `num` control lost its coercion"

    # ⭐ NOW MOVE THE DECLARATION AND NOTHING ELSE, and the sentences swap. Only
    # the operators section is rebuilt; every other section is the shipped object.
    flipped = dict(TABLE)
    flipped[ops] = dict(TABLE[ops])
    flipped[ops][a_condition] = dict(TABLE[ops][a_condition],
                                     yields=scan_definition._KIND_NUM)
    flipped[ops][a_number] = dict(TABLE[ops][a_number],
                                  yields=scan_definition._KIND_BOOL)
    planted = concierge.compile_rules(flipped)

    assert "not zero" in concierge.explain_sentence(
        joined(a_condition), {}, planted)["text"], (
        f"`{a_condition}` was re-declared as a number and the read-back still "
        "smoothed — the chrome is reading the shipped manifest, not this one")
    assert "not zero" not in concierge.explain_sentence(
        joined(a_number), {}, planted)["text"], (
        f"`{a_number}` was re-declared as a condition and the read-back still "
        "scaffolded — the chrome is reading the shipped manifest, not this one")


# ═══ 5. THE CROSS-LANE RAIL: the Python read-back IS `sentence.js`'s ════════
#
# ⛔ THE SHIPPED JS IS RUN, NOT DESCRIBED. A regex over `sentence.js` cannot tell
# a deleted line from a renamed one, and the claim here is about the TEXT two
# lanes produce. The hook is the same two customisations
# `tests/test_user_definitions.py` and `tools/ast_conformance.py` already carry.

_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try {
        const r = await nextResolve(specifier + ext, context)
        if (r) return r
      } catch { /* fall through */ }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const sentence = await import(pathToFileURL(payload.sentence).href)
const parse = await import(pathToFileURL(payload.parse).href)

const rows = {}
for (const c of payload.cases) {
  const row = {}
  try { row.sentence = sentence.sentenceFor(c.ast) }
  catch (err) { row.sentenceGuard = String(err && err.guard || err.message) }
  try { row.hash = parse.astHash(c.ast) }
  catch (err) { row.hashError = String(err && err.message || err) }
  const parsed = parse.parseFormula(c.source)
  if (parsed.ok) {
    try { row.sourceHash = parse.astHash(parsed.ast) }
    catch (err) { row.sourceHashError = String(err && err.message || err) }
  } else {
    row.parseError = parsed.error
  }
  rows[c.id] = row
}

// ⭐ THE OTHER CROSS-LANE QUESTION: what a tree's values CAN BE. `yieldsOf` is
// the JS resolver the chrome consults; `scan_definition.is_boolean_tree` is the
// Python one. Two implementations of one question, so the answers are carried
// back here and compared rather than trusted to agree.
const kinds = {}
for (const c of (payload.kindCases || [])) {
  try { kinds[c.id] = sentence.yieldsOf(c.ast) }
  catch (err) { kinds[c.id] = `ERROR ${String(err && err.message || err)}` }
}

process.stdout.write(JSON.stringify({
  ok: true,
  rows,
  kinds,
  operatorSentence: sentence.OPERATOR_SENTENCE,
  operatorSentenceConditions: sentence.OPERATOR_SENTENCE_CONDITIONS,
  refusals: sentence.REFUSALS,
  coverageGaps: sentence.coverageGaps(),
}))
"""


class LaneUnavailable(RuntimeError):
    """The node lane could not run. NOT a skip: a lane that cannot run has not
    agreed with anything, and three of this file's claims are only checkable
    there."""


def _js(payload: dict) -> dict:
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    tmpdir = tempfile.mkdtemp(prefix="concierge_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w",
                         encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [exe, os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps(payload), capture_output=True, text=True,
            encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise LaneUnavailable(
            f"the JS lane printed something that is not JSON: {exc}; "
            f"stdout was {proc.stdout[:400]!r}") from exc


def kind_corpus() -> Dict[str, dict]:
    """The trees the two `yields` RESOLVERS are compared over.

    ⛔ WIDER THAN THE SENTENCE CORPUS, ON PURPOSE. Classifying a tree is not
    saying it: both lanes can answer "what can this produce" for a tree naming a
    declared SCALAR, and the scalars section is exactly where the two
    resolutions are shaped differently — `yieldsOf` looks a name up BY NODE TYPE
    (a `series` node consults the scalars table), while `ast_table.yields_of`
    scans operators → functions → scalars flat. So the scalars are IN here even
    though they are pinned out of the sentence corpus.
    """
    out: Dict[str, dict] = dict(corpus())
    scalars = sorted(ast_table.scalar_names(TABLE))
    for name in scalars:
        out[f"scalar::{name}"] = s(name)
    #: …and inside every declared entry, so a scalar's kind has to PROPAGATE and
    #: not merely be reported at the root.
    for name in scalars:
        for section in (ast_table.OPERATORS_SECTION, ast_table.FUNCTIONS_SECTION):
            for entry in sorted(TABLE[section]):
                out[f"{section}::{entry}::scalar::{name}"] = _entry_tree(
                    section, entry, s(name))
    return out


@pytest.fixture(scope="module")
def js_lane():
    """ONE node process for every cross-lane claim in this file. Seven boots for
    seven assertions is 280 ms of nothing."""
    from api.services import definition_concierge as mod
    cases = []
    for case_id, tree in corpus().items():
        cases.append({"id": case_id, "ast": tree, "source": mod.formula_for(tree)})
    kind_cases = [{"id": cid, "ast": tree} for cid, tree in kind_corpus().items()]
    result = _js({"sentence": str(SENTENCE_JS), "parse": str(PARSE_JS),
                  "cases": cases, "kindCases": kind_cases})
    return {"result": result, "cases": {c["id"]: c for c in cases}}


def test_the_python_read_back_is_BYTE_IDENTICAL_to_sentence_js(concierge, js_lane):
    """⭐⭐ THE RAIL THAT MAKES POISONING `sentence_for` LETHAL. `sentence.js` is
    the original; this is its Python lane; both read the same manifest for every
    function's phrasing. A renderer that returned the model's prose — or that
    smoothed `?:` into "otherwise" — stops agreeing on the first case.

    ⛔ ALL 31 DECLARED ENTRIES, DERIVED. The floor is a NAME LIST, never a count:
    a count survives a rename, and this branch has already watched `(d.plots ||
    [])` answer `[]` for a renamed field and void a whole clause.
    """
    rows = js_lane["result"]["rows"]
    covered = sorted(rows)
    expected = sorted(corpus())
    assert covered == expected, "a case left the corpus without leaving this list"

    disagreements = []
    for case_id, tree in corpus().items():
        js_text = rows[case_id].get("sentence") or rows[case_id].get("sentenceGuard")
        # ⚠️ A REFUSAL IS AN ANSWER AND IS COMPARED AS ONE. Letting the exception
        # rise would end the run at the first divergent case with a traceback
        # instead of a NAMED list — and a lane that refuses what the other says is
        # the loudest divergence there is, not an error in the harness.
        try:
            py_text = concierge.sentence_for(tree)
        except Exception as exc:                  # noqa: BLE001 — reported, not raised
            py_text = f"REFUSED {getattr(exc, 'gate', type(exc).__name__)}"
        if js_text != py_text:
            disagreements.append((case_id, js_text, py_text))
    assert disagreements == [], (
        "the two read-back lanes disagree — one of them is telling the user a "
        f"different story about the same formula. {len(disagreements)} case(s), "
        f"first four: {disagreements[:4]}")

    # Non-vacuity: every declared entry really was rendered, by name.
    for name in FUNCTIONS:
        assert rows[f"fn::{name}"]["sentence"]
    for name in OPERATORS:
        assert rows[f"op::{name}"]["sentence"]
    for name in SERIES:
        assert rows[f"series::{name}"]["sentence"]


def test_the_cross_lane_corpus_REACHES_every_operand_kind(js_lane):
    """🔴 THE RAIL ON THE RAIL. A parity corpus that cannot reach a branch reports
    parity about the other one, and that is not a weaker guarantee — it is a
    green light with nothing behind it. This one shipped: every operand in the
    corpus was a bar field, so the `bool` branch of the logical chrome was
    unreached and the lanes diverged under a passing test.

    ⛔ THE KINDS ARE COUNTED FROM THE LANE'S OWN ANSWER, not from the names this
    file used when it built them. `yieldsOf` is asked about every case, and the
    settled kinds it reports must cover the whole set — so a corpus that quietly
    stopped producing conditions says so here rather than three tests later.
    """
    kinds = js_lane["result"]["kinds"]
    assert kinds, "the JS lane classified nothing — the kind corpus never ran"

    reached = sorted({v for v in kinds.values() if not str(v).startswith("ERROR")})
    #: The kinds a NODE can settle on: every declared kind that is not the
    #: join-only one. Derived from the manifest and the shipped resolver's own
    #: constant, never typed.
    from api.services import scan_definition
    settled = sorted(k for k in ast_table.YIELDS
                     if k != scan_definition._KIND_PASSTHROUGH)
    assert reached == settled, (
        f"the corpus only ever reaches {reached}; a node can settle on {settled}. "
        "A branch nothing reaches is a branch this rail cannot report on.")

    # ⛔ AND EVERY OPERAND IS ROOTED IN A DECLARATION, WHICH IS THE HALF THE KIND
    # COUNT ABOVE CANNOT SEE. Three literals and a bar field already span `num`
    # and `bool`, so a builder that stopped consulting `yields` altogether would
    # keep this test green while every derived operand collapsed onto one entry.
    # Measured: that mutation SURVIVED until this block existed.
    exemplars = operand_exemplars()
    for kind in _declared_yield_kinds():
        key = f"{kind}-over-field"
        assert key in exemplars, (
            f"no operand was built from an entry the manifest declares `{kind}` — "
            "the exemplars are not being derived from `yields`")
        root = exemplars[key]
        section = (ast_table.OPERATORS_SECTION if root["type"] == "op"
                   else ast_table.FUNCTIONS_SECTION)
        assert TABLE[section][root["name"]].get("yields") == kind, (
            f"the `{kind}` operand is rooted at `{root['name']}`, which the "
            f"manifest declares `{TABLE[section][root['name']].get('yields')}`")

    # …and it reaches them where it MATTERS: at the operands of a logical form,
    # which is the only place the chrome's decision is made.
    logical = [name for name in OPERATORS
               if TABLE[ast_table.OPERATORS_SECTION][name].get("yields")
               == scan_definition._KIND_BOOL
               and TABLE[ast_table.OPERATORS_SECTION][name].get("arity") == 2]
    assert logical, "the manifest declares no binary condition-valued operator"
    for name in logical:
        all_bool = [cid for cid, tree in corpus().items()
                    if cid.startswith(f"op::{name}::")
                    and tree.get("args")
                    and all(scan_definition.is_boolean_tree(a) for a in tree["args"])]
        mixed = [cid for cid, tree in corpus().items()
                 if cid.startswith(f"op::{name}::")
                 and tree.get("args")
                 and len({scan_definition.is_boolean_tree(a) for a in tree["args"]}) > 1]
        assert all_bool, f"no case gives `{name}` operands that are ALL conditions"
        assert mixed, f"no case gives `{name}` a MIXED pair, so the control is missing"


def test_the_two_YIELDS_resolvers_agree_and_the_answer_is_ONE(js_lane):
    """⛔ TWO IMPLEMENTATIONS OF ONE QUESTION, CROSS-CHECKED RATHER THAN A THIRD.

    `sentence.js::yieldsOf` and `api/services/scan_definition.py::is_boolean_tree`
    both resolve the manifest's `yields` over a tree, they were written to agree,
    and until now nothing compared them — a SECOND AUTHORITY OVER ONE VALUE, this
    repo's most repeated defect. The honest repair is not a third resolver: the
    Python read-back CALLS `is_boolean_tree` rather than growing its own, and this
    rail is what keeps the remaining two in step.

    ⚠️ THE SHAPES REALLY DO DIFFER, WHICH IS WHY THIS IS WORTH RUNNING. The JS
    lookup is BY NODE TYPE (a `series` node consults the scalars table);
    `ast_table.yields_of` scans operators → functions → scalars flat. They can
    only disagree for a name declared in two sections at once — so the corpus
    carries every scalar, at the root and inside every declared entry.
    """
    from api.services import scan_definition
    kinds = js_lane["result"]["kinds"]
    trees = kind_corpus()
    assert sorted(kinds) == sorted(trees), (
        "the JS lane did not classify the corpus this lane built")

    disagreements = []
    for case_id, tree in trees.items():
        js_bool = kinds[case_id] == scan_definition._KIND_BOOL
        try:
            py_bool = scan_definition.is_boolean_tree(tree)
        except Exception as exc:                  # noqa: BLE001 — reported, not raised
            py_bool = f"REFUSED {type(exc).__name__}: {exc}"
        if js_bool != py_bool:
            disagreements.append((case_id, kinds[case_id], py_bool))
    assert disagreements == [], (
        "the two `yields` resolvers classify the same tree differently — one of "
        "them decides whether a read-back drops its `!= 0` and the other decides "
        f"whether a tree may run as a screen. {len(disagreements)} case(s), first "
        f"four: {disagreements[:4]}")

    # ⚠️ NON-VACUITY, BOTH WAYS. An agreement in which every answer is `num` is
    # satisfied by two resolvers that both do nothing.
    said_bool = [cid for cid in trees if kinds[cid] == scan_definition._KIND_BOOL]
    said_num = [cid for cid in trees if kinds[cid] == scan_definition._KIND_NUM]
    assert said_bool and said_num, (
        f"the resolvers agreed on one answer for everything: "
        f"{len(said_bool)} bool / {len(said_num)} num")


def test_the_operator_phrases_and_the_read_back_refusals_are_ONE_VOCABULARY(js_lane, concierge):
    """⚠️ THE MIRROR IS PINNED, NOT PROMISED. `ast_interpret.REFUSALS` is pinned to
    `interpret.js`'s the same way and for the same reason: a lane that refuses for
    a different stated reason tells the user a different story about the same
    formula.
    """
    assert dict(concierge.OPERATOR_SENTENCE) == js_lane["result"]["operatorSentence"]
    assert dict(concierge.SENTENCE_REFUSALS) == js_lane["result"]["refusals"]
    # ⭐ AND THE SECOND PHRASE TOO, FOR THE SAME REASON AND WITH TEETH: a form
    # smoothed in one lane and scaffolded in the other is one member reading two
    # stories about one formula, which is exactly what shipped and what the
    # widened corpus above now catches at the TEXT. This catches it at the TABLE,
    # one step earlier, and names the operator.
    assert (dict(concierge.OPERATOR_SENTENCE_CONDITIONS)
            == js_lane["result"]["operatorSentenceConditions"])
    # ⚠️ NON-VACUITY: an empty table on both sides would satisfy the equality and
    # mean no operator ever smooths.
    assert concierge.OPERATOR_SENTENCE_CONDITIONS, "the conditions table is empty"
    assert set(concierge.OPERATOR_SENTENCE_CONDITIONS) <= set(concierge.OPERATOR_SENTENCE), (
        "a conditions phrase names an operator that has no base phrase")


def test_the_SOURCE_the_concierge_derives_PARSES_BACK_to_the_tree(js_lane):
    """⭐ THE ROUND-TRIP, THROUGH THE ONE PARSER. `defSchema` requires
    `compute.source` to parse back to `compute.ast`, compared BY HASH — so a
    `source` the concierge derives that did NOT round-trip would be refused at
    registration, and the user would see a definition that will not save.

    The model does not write the source either. It is spelled from the tree, fully
    parenthesised, so the round-trip is a property of the shape rather than of a
    precedence table that would be a second grammar.
    """
    rows = js_lane["result"]["rows"]
    broken = {cid: row for cid, row in rows.items()
              if row.get("parseError") or row.get("sourceHash") != row.get("hash")}
    assert broken == {}, f"these sources do not parse back to their trees: {broken}"
    assert len(rows) == len(corpus()) >= 31


# ═══ 5b. COVERAGE: ONE AUTHORITY, PROBED — AND THE TWO LANES COMPARED ══════
#
# ⛔⛔ THERE IS NO `coverage_gaps` IN THE PYTHON LANE ANY MORE, AND THAT IS THE
# POINT OF THIS SECTION. There was: a hand-maintained, fully DECLARATIVE mirror
# of `sentence.js::coverageGaps` that reported `{series, operators, functions,
# placeholders}` and had NO scalars row at all — so the two lanes answered one
# question differently in KIND as well as in content, nothing cross-checked them,
# and whichever one a future engineer consulted they would have believed it.
#
# 🔴 THE BLINDNESS IT CARRIED IS THE ONE THAT ALREADY COST THIS PROJECT. A rail
# derived from the same DECLARATION the walker reads can only report the gaps the
# walker already knows how to have. `coverageGaps()` therefore reported NOTHING
# for all 54 scalars while `definition_concierge.propose` refused every proposal
# naming one — and it took two agents hitting it from opposite sides to find,
# because the component whose job was to report it structurally could not.
# Measured again here before this section was written: with `_render_name`'s
# series branch deleted the Python walker refuses `close`, and the old rail
# still said `series: []`.
#
# So the second implementation is GONE, not converted — a second probe in a
# second language for a question no runtime asks is a liability with no upside —
# and the two claims it used to make are made below instead:
#
#   1. the walker is PROBED (`_python_gaps`): one minimal tree per declared
#      entry, in every section THE MANIFEST declares, and the ones that REFUSE
#      are reported BY NAME. The gap is the runtime refusal itself.
#   2. the two lanes are COMPARED: `coverageGaps()` under node against that
#      probe, section for section and name for name, with the one known
#      divergence PINNED and DERIVED so it goes red the day it closes.
#   3. the deletion is ASSERTED, over the filesystem and under the name read off
#      `sentence.js`'s own export list.

#: ⛔ THE ONE ARGUMENT THE PROBE EVER PASSES — A LITERAL, NEVER ANOTHER SECTION'S
#: NAME. If the operators probe borrowed `close`, deleting `_render_name`'s
#: series branch would light up the operators AND functions rows too, and a rail
#: that names three sections when one broke is as useless as one that names none.
#: (That isolation is asserted below, not assumed.) `1` is also a legal `int`
#: window — a whole number ≥ 1 — so one constant serves every argument position
#: the manifest is able to declare. It mirrors `sentence.js::PROBE_ARG`
#: deliberately: the cross-lane rail compares the two answers, so a probe built
#: differently would surface as a divergence rather than hide one.
PROBE_ARG = {"type": "num", "value": 1}


def _probe_args(count: Any) -> List[dict]:
    """⚠️ BOUNDED, BECAUSE A MANIFEST IS DATA. An arity declared as a fraction, a
    negative or something enormous would otherwise allocate until the box died.
    Outside the bound the argument list is EMPTY, the walker refuses on the arity
    mismatch, and the entry is NAMED — a reported gap, never a hang."""
    ok = (isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 16)
    return [dict(PROBE_ARG) for _ in range(count if ok else 0)]


def _probe_tree(section: str, name: str, spec: Any) -> Any:
    """The minimal tree for ONE declared entry, by section.

    ⛔ AN UNKNOWN SECTION RETURNS `None`, AND THE WALKER REFUSES IT. A fifth
    section reaching the manifest is probed with a shape this function does not
    have, so every one of its entries lands in the report and somebody has to
    teach the probe. Returning something plausible would make the new section
    silently green on the day it arrives — the exact defect this rail exists to
    end, reintroduced one level up.
    """
    if section in (ast_table.SERIES_SECTION, ast_table.SCALARS_SECTION):
        # ⭐ BOTH RIDE THE `series` NODE — a scalar is a fourth VOCABULARY, not a
        # fifth node type — and the two still report separately.
        return {"type": "series", "name": name}
    if section == ast_table.OPERATORS_SECTION:
        return {"type": "op", "name": name, "args": _probe_args((spec or {}).get("arity"))}
    if section == ast_table.FUNCTIONS_SECTION:
        return {"type": "call", "name": name,
                "args": _probe_args(len(list((spec or {}).get("args") or ())))}
    return None


def _declared_sections(table: Mapping[str, Any]) -> List[str]:
    """The manifest's own name-bearing sections, READ OFF THE MANIFEST.

    ⛔ NOT A LIST TYPED HERE — and deliberately not `ast_table.SECTIONS` either.
    The whole value of the fifth-section floor is that a section reaching the
    manifest is probed without this file moving; reading a constant that also has
    to be edited would make this rail exactly as blind as the one it replaced.
    The two derivations are cross-checked below, which is the useful direction:
    a section added to the file but not to `ast_table.SECTIONS` is a red test.

    `_`-prefixed keys are the manifest's own annotations and `tableVersion` is a
    string, so neither reaches this list.
    """
    return sorted(k for k, v in table.items()
                  if isinstance(v, Mapping) and not k.startswith("_"))


def _python_gaps(table: Any = None, phrases: Any = None) -> Dict[str, List[str]]:
    """Every declared entry THIS WALKER refuses, by section, BY NAME.

    ⭐⭐ THE WALKER'S OWN ANSWER, NOT A SECOND BOOKKEEPING PASS. `explain_sentence`
    is the shipped renderer `propose` calls; an entry is a gap when rendering its
    minimal tree REFUSES, whatever the reason. `Exception` is caught rather than
    `_SentenceRefused` on purpose — a walker that dies on a declared entry has
    failed to cover it just as surely as one that refuses politely, and narrowing
    the catch would let a TypeError read as coverage.
    """
    from api.services import definition_concierge as mod
    t = table if table is not None else TABLE
    rules = mod.compile_rules(t, phrases)
    out: Dict[str, List[str]] = {}
    for section in _declared_sections(t):
        refused = []
        for name in sorted(t[section]):
            try:
                mod.explain_sentence(_probe_tree(section, name, t[section][name]), {}, rules)
            except Exception:                     # noqa: BLE001 — ANY refusal is a gap
                refused.append(name)
        out[section] = refused
    return out


def _named(gaps: Mapping[str, List[str]]) -> str:
    """⚠️ THE NAMES, BUILT INTO THE MESSAGE. pytest elides a long set with `...`,
    and a rail whose entire job is to name the broken entry must not depend on the
    differ's display budget. Measured this week: a real failure printed
    `{'api/service..._rule_record'}` and was readable only because there happened
    to be exactly one element."""
    rows = [f"{section} ({len(names)}): {', '.join(names)}"
            for section, names in sorted(gaps.items()) if names]
    return " | ".join(rows) if rows else "(nothing)"


#: ✅ THE PIN IS GONE, AND IT WAS DELETED BY ITS OWN FAILURE MESSAGE.
#:
#: `9c4f1f74` pinned ONE divergence here: `sentence.js` could say the manifest's
#: fourth section and this lane could not, so all 54 scalars refused at
#: `sentence:name` — and `tool_schema`'s enums were the same three sections, so
#: `propose` refused a scalar-naming proposal at `schema:name` a door earlier.
#: The pin was derived rather than typed, and it was written to fail in BOTH
#: directions: E-5 taught `compile_rules`/`_render_name` the scalars and taught
#: `tool_schema` to read its section list off the manifest, and both rails below
#: went RED naming all 54 and saying *"the divergence has CLOSED, so DELETE the
#: pin"*. That is what a pin is for, and it is why the correct response was to
#: remove it rather than widen it.
#:
#: ⛔ NOTHING REPLACES IT. The lanes now agree in both directions, and the
#: assertions below say so with no exception list — so a NEW divergence, in
#: either direction, is a red test that names it.
def _diff(left: Mapping[str, List[str]], right: Mapping[str, List[str]]) -> Dict[str, List[str]]:
    """Names in `left` that `right` does not carry, by section."""
    out = {}
    for section, names in left.items():
        extra = [n for n in names if n not in set(right.get(section) or ())]
        if extra:
            out[section] = extra
    return out


def test_every_DECLARED_SECTION_is_PROBED_and_the_gaps_are_named(concierge):
    """⛔ TOTALITY, MEASURED BY RENDERING, WITH THE SECTION LIST READ OFF THE
    MANIFEST. Not "is a phrase declared?" — that question is what let a whole
    section ride unreported. Every declared entry's minimal tree is walked, and a
    refusal is a gap.

    ⭐ THE FIFTH-SECTION FLOOR IS THE REASON THE LIST IS DERIVED. A section added
    to `closedTable.json` gets a row here on the day it lands, and because
    `_probe_tree` has no shape for it, every one of its entries arrives NAMED
    rather than silently green.
    """
    gaps = _python_gaps()

    assert sorted(gaps) == _declared_sections(TABLE), (
        "the probe did not walk every section the manifest declares")
    assert set(gaps) == set(ast_table.SECTIONS), (
        "two derivations of 'which sections declare names' disagree — the "
        f"manifest says {sorted(gaps)}, `ast_table.SECTIONS` says "
        f"{sorted(ast_table.SECTIONS)}")

    # ⛔ NO EXCEPTION LIST. Every declared entry in every declared section must
    # render, and that includes the 54 scalars this lane could not say until E-5
    # taught it the fourth section.
    surprises = {section: names for section, names in gaps.items() if names}
    assert surprises == {}, (
        "the Python read-back REFUSES declared entries nothing expected it to "
        f"— reported BY NAME: {_named(surprises)}")

    # ⚠️ NON-VACUITY. A probe that rendered nothing would satisfy every assertion
    # above. The floor is `declared_names` — every name in every section, derived
    # rather than typed — and it is 85 today against the 31 bar entries
    # `ast_conformance --coverage` asserts.
    rendered = sum(len(TABLE[s]) - len(gaps[s]) for s in gaps)
    assert rendered == len(ast_table.declared_names(TABLE)) >= 31, (
        f"the probe only rendered {rendered} entries, so it proves nothing")
    assert rendered > len(SERIES) + len(OPERATORS) + len(FUNCTIONS), (
        "the probe rendered only the bar entries — the scalars section is not "
        "being walked, which is the exact blindness this rail was rebuilt for")


def test_a_PLANTED_unsayable_entry_is_NAMED_and_the_sayable_twin_is_CLEAN(concierge):
    """⚠️ THE POSITIVE CONTROL, AND THE ISOLATION CLAIM IN THE SAME BREATH. A rail
    that reports nothing for a NEW reason is the same rail, so a planted entry
    that did not exist when this was written must come back BY NAME with no edit
    here — and the same plant made sayable must come back clean, or "a plant is
    reported" would be satisfied by a walker that refuses everything unfamiliar.

    ⛔ AND ONE PLANT PER SECTION AT ONCE, so each row must name ONLY ITS OWN. That
    is what proves `PROBE_ARG` is a literal: a probe that borrowed `close` would
    make the broken series light up the operators and functions rows too.
    """
    broken = {
        ast_table.SERIES_SECTION: dict(TABLE[ast_table.SERIES_SECTION],
                                       **{"zzz planted field": {"field": "c"}}),
        ast_table.OPERATORS_SECTION: dict(TABLE[ast_table.OPERATORS_SECTION],
                                          **{"zz~": {"arity": 2}}),
        ast_table.FUNCTIONS_SECTION: dict(TABLE[ast_table.FUNCTIONS_SECTION],
                                          **{"zzNoPhrase": {"args": ["series"], "lookback": 0}}),
    }
    gaps = _python_gaps(broken)
    assert gaps == {ast_table.SERIES_SECTION: ["zzz planted field"],
                    ast_table.OPERATORS_SECTION: ["zz~"],
                    ast_table.FUNCTIONS_SECTION: ["zzNoPhrase"]}, (
        "each section must name ONLY its own plant — reported: " + _named(gaps))

    # And each really is a refusal of the walker's, named in the message.
    rules = concierge.compile_rules(broken)
    for section, name in ((ast_table.SERIES_SECTION, "zzz planted field"),
                          (ast_table.OPERATORS_SECTION, "zz~"),
                          (ast_table.FUNCTIONS_SECTION, "zzNoPhrase")):
        with pytest.raises(Exception) as caught:
            concierge.explain_sentence(
                _probe_tree(section, name, broken[section][name]), {}, rules)
        assert name in str(caught.value), (
            f"the {section} refusal did not name {name!r}: {caught.value}")

    # ⭐ THE CONTROL THE OTHER WAY, in the same test: the same three plants, made
    # sayable, report NO gap. Without it the rail could be reporting everything.
    clean = {
        ast_table.SERIES_SECTION: dict(TABLE[ast_table.SERIES_SECTION],
                                       **{"zzz_planted_field": {"field": "c"}}),
        ast_table.OPERATORS_SECTION: dict(TABLE[ast_table.OPERATORS_SECTION],
                                          **{"zz~": {"arity": 2}}),
        ast_table.FUNCTIONS_SECTION: dict(
            TABLE[ast_table.FUNCTIONS_SECTION],
            **{"zzNoPhrase": {"args": ["series"], "lookback": 0,
                              "sentence": "the planted read of {0}"}}),
    }
    clean_gaps = _python_gaps(
        clean, dict(concierge.OPERATOR_SENTENCE, **{"zz~": "{0} zz {1}"}))
    assert clean_gaps == {ast_table.SERIES_SECTION: [],
                          ast_table.OPERATORS_SECTION: [],
                          ast_table.FUNCTIONS_SECTION: []}, (
        "a sayable plant was reported as a gap: " + _named(clean_gaps))


def test_the_two_coverage_LANES_agree_and_the_ONE_divergence_is_PINNED(js_lane, concierge):
    """⭐⭐ THE CROSS-LANE RAIL — THE THING THAT WAS MISSING. Two lanes answering
    the same question with nothing comparing them is this repo's most expensive
    defect shape, and it is worse than either being wrong alone: whichever one a
    future engineer consults, they believe it.

    `coverageGaps()` is run through the SHIPPED `sentence.js` under node — never
    described, never regex'd — and compared against this lane's probe, section for
    section and name for name.

    ⛔ AND THERE IS NO LONGER ANY PERMITTED DISAGREEMENT. The one divergence this
    rail used to pin — 54 scalars the JS lane could say and this one could not —
    is closed, so both directions assert `{}` and a new divergence in either is a
    red test that says which names moved.
    """
    js = js_lane["result"]["coverageGaps"]
    assert isinstance(js, dict) and js, "the JS lane returned no coverage report at all"

    # `placeholders` is not a section — it is a per-template reason keyed
    # `name: why`, and this lane keeps no such list. The SECTIONS are compared.
    js_sections = {k: list(v) for k, v in js.items() if k != "placeholders"}
    py = _python_gaps()
    assert sorted(js_sections) == sorted(py), (
        "the two lanes do not even report the same SECTIONS — "
        f"sentence.js says {sorted(js_sections)}, this lane probes {sorted(py)}")

    only_js = _diff(js_sections, py)
    assert only_js == {}, (
        "`sentence.js` reports entries as unsayable that this lane renders "
        f"happily — the JS walker refuses what the Python one says: {_named(only_js)}")

    only_py = _diff(py, js_sections)
    assert only_py == {}, (
        "this lane refuses entries `sentence.js` says happily — the Python "
        f"walker refuses what the JS one renders, BY NAME: {_named(only_py)}")

    # ⚠️ NON-VACUITY, AND IT IS WHAT THE DELETED PIN USED TO PROVIDE. Two lanes
    # that both reported nothing at all would satisfy every equality above. So
    # the section both lanes were blind to is named here — it must be present in
    # both reports, empty in both, and non-empty in the manifest.
    for lane, report in (("sentence.js", js_sections), ("this lane", py)):
        assert report.get(ast_table.SCALARS_SECTION) == [], (
            f"{lane} no longer says the manifest's scalars: "
            f"{report.get(ast_table.SCALARS_SECTION)}")
    assert len(ast_table.scalar_names(TABLE)) >= 54, (
        "the manifest declares no scalars — the section both lanes were once "
        "blind to is empty, so this comparison proves nothing")


def test_NO_python_module_declares_a_SECOND_coverage_gaps():
    """⛔ THE DELETION, ASSERTED — BY AST, OVER THE FILESYSTEM, UNDER A DERIVED
    NAME. A `coverage_gaps` growing back in any server-side module re-creates the
    second authority this section exists to remove, and it would do it silently:
    every test above would stay green.

    ⭐ NEITHER HALF IS TYPED. The NAME is read off `sentence.js`'s own export list
    and snake-cased, so a rename in the JS lane moves this rail with it; the
    MODULE SET is every `.py` under `api/`, walked off disk, so a new file is
    covered the day it is written. A grep would also have found the docstrings
    that DISCUSS the deletion — this counts `FunctionDef`s.
    """
    exported = re.findall(r"export function ([A-Za-z_$][A-Za-z0-9_$]*)",
                          SENTENCE_JS.read_text(encoding="utf-8"))
    matches = [e for e in exported if e.lower() == "coveragegaps"]
    assert matches == ["coverageGaps"], (
        f"`sentence.js` no longer exports the coverage rail under a recognisable "
        f"name — it exports {sorted(exported)}; this rail has lost its subject")
    forbidden = re.sub(r"(?<!^)(?=[A-Z])", "_", matches[0]).lower()
    assert forbidden == "coverage_gaps", forbidden

    offenders, walked, anchors = [], 0, []
    for path in sorted((ROOT / "api").rglob("*.py")):
        try:
            tree = pyast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):        # not ours to police
            continue
        walked += 1
        rel = path.relative_to(ROOT).as_posix()
        for node in pyast.walk(tree):
            if isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
                if node.name == forbidden:
                    offenders.append(f"{rel}:{node.lineno}")
                elif node.name == "compile_rules":
                    anchors.append(rel)

    assert offenders == [], (
        f"a second `{forbidden}` has grown back server-side, BY FILE: "
        f"{', '.join(offenders)}. `sentence.js::coverageGaps` is the ONE "
        "authority; the Python claims are the probe and the cross-lane rail above")

    # ⚠️ NON-VACUITY, BOTH WAYS: the walk must have visited real modules AND found
    # the very file the deleted function lived in. A scan over nothing reports
    # nothing, which is indistinguishable from a clean tree.
    assert walked > 100, f"the walk only parsed {walked} modules under api/"
    assert anchors == ["api/services/definition_concierge.py"], (
        f"the walk did not reach the module the deletion happened in: {anchors}")


# ═══ 6. THE PIPELINE, AND WHICH GATE REFUSED ═══════════════════════════════

def test_an_ORDINARY_answer_comes_back_as_a_tree_a_source_and_the_trees_sentence(
        concierge, model):
    tree = windowed(20)
    client = model([tool_use(tree)])
    res = concierge.propose("average the close over twenty bars", user_id=USER, bars=bars())

    assert res["ok"] is True, res
    assert res["ast"] == tree
    assert res["sentence"] == concierge.sentence_for(tree)
    assert res["source"] == concierge.formula_for(tree)
    assert res["repaint"] == "non-repainting"
    assert res["tokens"] == {"input": 120, "output": 40}
    assert res["attempts"] == 1
    assert len(client.calls) == 1

    # ⭐ THE REQUEST IS THE SCHEMA, NOT A REQUEST. `tool_choice` FORCES the tool, so
    # "answer with a tree" is a constraint rather than an instruction the model may
    # decline — and the tool handed over is the derived one.
    sent = client.calls[0]
    assert sent["tool_choice"] == {"type": "tool", "name": concierge.TOOL_NAME}
    assert sent["tools"] == [concierge.anthropic_tool()]
    assert sent["model"] == concierge.MODEL
    assert sent["tools"][0]["input_schema"]["$defs"]["call"]["properties"]["name"]["enum"] \
        == FUNCTIONS


def test_an_OUT_OF_TABLE_name_is_refused_AT_THE_SCHEMA_BOUNDARY_not_at_runtime(
        concierge, model, monkeypatch):
    """⭐⭐ THE ATTRIBUTION CASE, AND IT IS THE ONE THIS BRANCH KEEPS GETTING WRONG.

    An out-of-table function name is refused by the SCHEMA — the boundary — not by
    the table's `resolve:function`. Both refuse; only one is the mechanism this
    task claims. So the same input is run TWICE and **the difference is the
    measurement**: with the boundary gate the door is `schema:name`, and with that
    ONE gate removed the same tree is still refused — by `resolve:function`, one
    door later. A test asserting only `ok is False` would have passed either way.
    """
    alien = {"type": "call", "name": "zzNotInTheTable", "args": [s(), n(5)]}

    model([tool_use(alien), tool_use(alien)])
    refused = concierge.propose("do something exotic", user_id=USER, bars=bars())
    assert refused["ok"] is False
    assert refused["gate"] == "schema:name", refused
    assert "ast" not in refused

    # …now remove THAT GATE ALONE.
    monkeypatch.setattr(concierge, "_assert_within_schema", lambda tree, table=None: None)
    model([tool_use(alien), tool_use(alien)])
    moved = concierge.propose("do something exotic", user_id=USER, bars=bars())
    assert moved["ok"] is False
    assert moved["gate"] == "resolve:function", (
        "with the boundary removed the refusal must arrive from the table's own "
        f"door — got {moved['gate']}")


def test_a_proposal_that_does_not_PARSE_is_refused_and_never_stored(concierge, model):
    """⛔ THE MODEL'S OUTPUT IS UNTRUSTED INPUT, exactly like the text box. A tree
    that is not one of the four canonical shapes is refused by the SAME
    `assert_canonical` the store runs, and nothing is written: `propose` has no
    store call at all, which is asserted structurally below.
    """
    not_a_tree = {"type": "num", "value": 1, "extra": 2}
    model([tool_use(not_a_tree), tool_use(not_a_tree)])
    res = concierge.propose("something", user_id=USER, bars=bars())
    assert res["ok"] is False and res["gate"] == "schema:node"
    assert "ast" not in res


def test_the_BUDGET_is_consulted_BEFORE_the_linter_which_is_how_M6_is_visible(
        concierge, model, monkeypatch):
    """⭐ ORDER IS ATTRIBUTION. The corpus tree here is over the node budget AND
    unreadable to the linter. With `check_budget` in place it is a `budget:nodes`
    refusal; with that ONE call removed the SAME input comes back as a REPAINT
    refusal — the right answer from the wrong door, which is this branch's most
    expensive defect and the only behavioural way to see a skipped budget check
    (`interpret` runs one of its own, so deleting this call is otherwise silent).
    """
    tree = over_budget_and_repainting()

    model([tool_use(tree), tool_use(tree)])
    res = concierge.propose("something enormous", user_id=USER, bars=bars())
    assert res["ok"] is False and res["gate"] == "budget:nodes", res

    monkeypatch.setattr(concierge, "check_budget", lambda tree, budget=None: None)
    model([tool_use(tree), tool_use(tree)])
    moved = concierge.propose("something enormous", user_id=USER, bars=bars())
    assert moved["ok"] is False and moved["gate"] == "lint:repaint", (
        "with the concierge's own budget call gone the refusal arrives from the "
        f"linter — got {moved['gate']}")


def test_a_proposal_that_LINTS_repainting_gets_ONE_repair_and_then_a_REFUSAL(
        concierge, model):
    """⭐ THE PIPELINE IS generate → parse → lint → compute → read back, and the
    MODEL sees the linter's verdict BEFORE THE USER DOES.

    An LLM that emits a formula the linter then brands `repaints` is a bad
    experience. One that ships it with the badge attached is worse, because the
    badge reads as a disclosure and the brand's whole claim is that badges are
    machine-assigned rather than self-disclosed (spec §1.3).

    ⛔ AND THE SECOND FAILURE IS A REFUSAL, NOT A THIRD ATTEMPT. An unbounded
    repair loop is an unbounded bill and an unbounded wait, and `cost_guard` is a
    cap on spend, not on patience.

    ⚠️ SEE `repainting_tree`'s NOTE for why this particular tree: with the shipped
    manifest the only reachable route to a repaint verdict is the linter's
    fail-closed branch, and the obvious construction is refused one door earlier.
    """
    repainting = repainting_tree()
    client = model([tool_use(repainting, tool_id="a"), tool_use(repainting, tool_id="b")])

    res = concierge.propose("show me tomorrow's close", user_id=USER, bars=bars())

    assert len(client.calls) == 2, "the repair attempt did not happen, or happened twice"
    assert res["ok"] is False
    assert "repaint" in res["reason"].lower()
    assert "ast" not in res, "a refusal must not hand back a formula anyway"

    # ⭐ AND THE REPAIR TURN CARRIES THE LINTER'S VERDICT, as a real tool_result on
    # the FAILED tool call — so the model is correcting its own answer rather than
    # guessing again from the English.
    second = client.calls[1]["messages"]
    assert second[0]["role"] == "user"
    assert second[-2]["content"][0]["type"] == "tool_use"
    result_block = second[-1]["content"][0]
    assert result_block["type"] == "tool_result"
    assert result_block["is_error"] is True
    assert "lint:repaint" in result_block["content"]
    assert result_block["tool_use_id"] == "a"


def test_the_REPAINT_refusal_is_the_LINTERS_and_disappears_when_the_LINTER_alone_goes(
        concierge, model, monkeypatch):
    """⭐⭐ ATTRIBUTION FOR THE LINT GATE. The case above proves a refusal happened;
    this proves WHICH mechanism produced it. Neuter `lint_repaint` alone and the
    SAME tree, through the SAME pipeline, comes back accepted — so the refusal was
    the linter's and not the budget's, the table's or the compute's.

    ⛔ AND THE MEASUREMENT IS BOTH RUNS. A test that only removed the guard and
    watched the refusal vanish could not tell a real gate from a pipeline that
    refuses everything; a test that only kept it could not tell the linter from
    any other door.
    """
    from api.services import ast_lint
    tree = repainting_tree()

    model([tool_use(tree), tool_use(tree)])
    refused = concierge.propose("show me tomorrow's close", user_id=USER, bars=bars())
    assert refused["ok"] is False and refused["gate"] == "lint:repaint"

    monkeypatch.setattr(ast_lint, "lint_repaint",
                        lambda t, opts=None: {"mode": "non-repainting", "reasons": [],
                                              "forward": 0, "back": 0})
    model([tool_use(tree)])
    accepted = concierge.propose("show me tomorrow's close", user_id=USER, bars=bars())
    assert accepted["ok"] is True, accepted
    assert accepted["repaint"] == "non-repainting"


def test_the_repair_SUCCEEDS_when_the_second_answer_is_clean(concierge, model):
    """The control for the case above: two calls is a BOUND, not a verdict. If the
    repair could never succeed, "one repair" would be a slower way of refusing."""
    bad = {"type": "call", "name": "zzNotInTheTable", "args": [s()]}
    good = windowed(20)
    client = model([tool_use(bad, tool_id="a"), tool_use(good, tool_id="b")])
    res = concierge.propose("average it", user_id=USER, bars=bars())
    assert res["ok"] is True and res["attempts"] == 2
    assert len(client.calls) == 2
    assert res["sentence"] == concierge.sentence_for(good)


def test_a_model_that_answers_in_PROSE_is_refused_and_the_scanner_recovers_JSON(
        concierge, model):
    """⚠️ THE SHIPPED BALANCED-BRACE SCANNER, NOT A FRESH ONE. A model that wraps
    its object in fences or appends prose is the normal case and
    `catalyst.synthesize`'s scanner is the one this repo has already hardened. A
    model that answers with no object at all is a refusal that names its door.
    """
    tree = windowed(20)
    fenced = "Here you go:\n```json\n" + json.dumps({"ast": tree}) + "\n```\nHope that helps."
    model([text_only(fenced)])
    ok = concierge.propose("average it", user_id=USER, bars=bars())
    assert ok["ok"] is True and ok["ast"] == tree

    model([text_only("I would rather not."), text_only("Still no.")])
    res = concierge.propose("average it", user_id=USER, bars=bars())
    assert res["ok"] is False and res["gate"] == "model:no-tool"
    assert "ast" not in res


def test_a_formula_that_computes_NOTHING_on_the_bars_in_view_is_refused(concierge, model):
    """⛔ THE COMPUTE STAGE IS NOT DECORATION. A window wider than the chart's
    history returns an all-warmup column: nothing draws, nothing errors, and the
    user sees a chip that looks like it is still loading. That is spec §6's state
    4, and it is refused here instead.

    ⚠️ A SHORT BAR WINDOW, DELIBERATELY. The lookback budget caps at 500 bars, so a
    window wide enough to starve the 579-bar parity fixture would be refused by
    `budget:lookback` first — the wrong door for this claim. Thirty bars against a
    hundred-bar window is inside every other gate and outside this one.
    """
    real_bars = bars()[:30]
    too_wide = windowed(100)
    model([tool_use(too_wide), tool_use(too_wide)])
    res = concierge.propose("average it over a very long window", user_id=USER, bars=real_bars)
    assert res["ok"] is False and res["gate"] == "compute:empty", res

    # The control: the SAME shape with a window the bars can carry succeeds, so
    # the refusal is about the window and not about the stage existing.
    fits = windowed(20)
    model([tool_use(fits)])
    assert concierge.propose("average it", user_id=USER, bars=real_bars)["ok"] is True


def test_EVERY_refusal_names_a_door_and_hands_back_NO_formula(concierge, model):
    """⛔ THE SHAPE, ACROSS EVERY GATE THIS MODULE CAN REACH. `{ok: False, reason,
    gate}` — `brain_service`'s shape — and never an `ast`, because a formula beside
    a refusal is a formula somebody eventually uses.
    """
    real_bars = bars()[:30]
    cases = {
        "schema:name": {"type": "call", "name": "zzNope", "args": [s(), n(5)]},
        "schema:node": {"type": "num", "value": 1, "extra": 2},
        "schema:number": n(-5),
        "resolve:arity": {"type": "call", "name": WINDOWED, "args": [s()]},
        "resolve:window": {"type": "call", "name": WINDOWED, "args": [s(), s()]},
        "lint:repaint": repainting_tree(),
        "compute:empty": windowed(100),
        "budget:nodes": over_budget_and_repainting(),
    }
    seen = 0
    for gate, tree in cases.items():
        model([tool_use(tree), tool_use(tree)])
        res = concierge.propose("x", user_id=USER, bars=real_bars)
        assert res["ok"] is False, (gate, res)
        assert res["gate"] == gate, (gate, res)
        assert "ast" not in res and "source" not in res and "sentence" not in res
        assert isinstance(res["reason"], str) and res["reason"].strip()
        seen += 1
    assert seen == len(cases) == 8, "a case left the sweep without leaving this count"

    # ⛔ AND THE SENTENCES ARE PAIRWISE DISJOINT ACROSS EVERY GUARD SET THIS
    # PIPELINE CAN REPORT. Two gates sharing a phrase let an assertion pass with
    # the safety deleted, and that has happened in this repo.
    from api.services import ast_budget, ast_interpret  # noqa: PLC0415
    everything = (list(concierge.REFUSALS.values())
                  + list(concierge.SENTENCE_REFUSALS.values())
                  + list(ast_interpret.REFUSALS.values())
                  + list(ast_budget.REFUSALS.values()))
    assert len(set(everything)) == len(everything)
    for i, a in enumerate(everything):
        for j, b in enumerate(everything):
            assert i == j or a not in b, f"{a!r} is a substring of {b!r}"


def _refusal_returns(fn: pyast.FunctionDef) -> List[Dict[str, Any]]:
    """Every `return {...}` in `fn` whose dict says `"ok": False`, with its keys."""
    out = []
    for node in pyast.walk(fn):
        if not isinstance(node, pyast.Return) or not isinstance(node.value, pyast.Dict):
            continue
        pairs = list(zip(node.value.keys, node.value.values))
        keys = [k.value for k, _ in pairs if isinstance(k, pyast.Constant)]
        refuses = any(isinstance(k, pyast.Constant) and k.value == "ok"
                      and isinstance(v, pyast.Constant) and v.value is False
                      for k, v in pairs)
        if refuses:
            out.append({"keys": keys, "src": pyast.unparse(node)})
    return out


def test_NO_refusal_RETURN_carries_a_formula_asserted_over_propose_s_OWN_SOURCE(concierge):
    """⛔ THE STRUCTURAL HALF OF "a refusal hands back no formula", AND IT COVERS
    EVERY EXIT.

    The behavioural sweep above reaches eight refusal paths; `propose` has more
    exits than that (the cost caps, the transport failure, the empty prompt), and a
    behavioural case can only ever assert about the paths it happens to walk. So
    every `return {... "ok": False ...}` in the function is enumerated and none may
    carry an `ast`, a `source` or a `sentence`. A formula beside a refusal is a
    formula somebody eventually uses — and the somebody is a `save` call two tasks
    from now.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    returns = _refusal_returns(_function(src, "propose"))
    assert len(returns) >= 5, (
        f"only {len(returns)} refusal exits found — the scan is not seeing the "
        "function it thinks it is")
    for row in returns:
        assert "reason" in row["keys"] and "gate" in row["keys"], row["src"]
        for forbidden in ("ast", "source", "sentence", "repaint"):
            assert forbidden not in row["keys"], (
                f"a refusal exit carries {forbidden!r}: {row['src']}")

    # The positive control: the same walk over a synthetic module that DOES hand
    # one back finds it, so a broken scan cannot report a clean function.
    poisoned = (
        "def propose(p):\n"
        "    if bad:\n"
        "        return {'ok': False, 'gate': 'g', 'reason': 'r', 'ast': tree}\n"
        "    return {'ok': True, 'ast': tree}\n")
    caught = _refusal_returns(_function(poisoned, "propose"))
    assert len(caught) == 1 and "ast" in caught[0]["keys"]


# ═══ 7. THE COST PATH ══════════════════════════════════════════════════════

def test_the_cost_guard_is_CONSULTED_before_the_call_and_RECORDED_after(
        concierge, model, monkeypatch):
    """⚠️ THE EXISTING SURFACE, CALLED — not a new one.
    `cost_guard.may_synthesize(date)` / `estimate_cost(model, in, out)` /
    `record(...)`. Its unknown-model rule is load-bearing: an unrecognised model is
    priced at the PRICIEST known rate, never $0, because a $0 estimate makes every
    cap unenforceable.

    ⭐ THE ORDER IS THE ASSERTION, AND IT IS MEASURED BY CALL COUNT. A cap checked
    AFTER the spend is not a cap: with `may_synthesize` refusing, the model must be
    called ZERO times. A test that only checked the answer was a refusal would pass
    a pipeline that paid for it first.
    """
    from api.services.catalyst import cost_guard, store

    client = model([tool_use(windowed(20))])
    res = concierge.propose("average it", user_id=USER, bars=bars())
    assert res["ok"] is True
    logged = store.cost_stats_for_date(concierge._market_date())
    assert logged["call_count"] == 1
    assert logged["total_input_tokens"] == 120 and logged["total_output_tokens"] == 40
    assert logged["total_cost_usd"] == pytest.approx(
        cost_guard.estimate_cost(concierge.MODEL, 120, 40))
    assert res["cost_usd"] == pytest.approx(logged["total_cost_usd"])
    assert concierge.spend_for(USER) == pytest.approx(logged["total_cost_usd"])
    assert len(client.calls) == 1

    # …and the guard is asked BEFORE the spend.
    monkeypatch.setattr(cost_guard, "may_synthesize", lambda market_date: False)
    client = model([tool_use(windowed(20))])
    refused = concierge.propose("average it", user_id=USER, bars=bars())
    assert refused["ok"] is False and refused["gate"] == "cost:global"
    assert len(client.calls) == 0, (
        "the model was called before the cap was consulted — a cap checked after "
        "the spend is not a cap")


def test_a_PER_USER_daily_cap_sits_on_top_of_the_global_one(concierge, model, monkeypatch):
    """⚠️ THE GLOBAL CAP PROTECTS THE BILL; THE PER-USER CAP PROTECTS ONE ACCOUNT
    FROM SPENDING EVERYONE ELSE'S. `cost_guard`'s cap is a whole-day, whole-system
    number, so without this one member can exhaust it before anybody else opens the
    builder.
    """
    monkeypatch.setenv("CONCIERGE_USER_CAP_DAILY", "0.0001")
    client = model([tool_use(windowed(20)), tool_use(windowed(20))])

    first = concierge.propose("average it", user_id=USER, bars=bars())
    assert first["ok"] is True and len(client.calls) == 1

    second = concierge.propose("average it again", user_id=USER, bars=bars())
    assert second["ok"] is False and second["gate"] == "cost:user"
    assert len(client.calls) == 1, "the cap was consulted after the spend"

    # …and it is PER USER: a different account is unaffected.
    third = concierge.propose("average it", user_id="u2", bars=bars())
    assert third["ok"] is True and len(client.calls) == 2


def test_the_repair_call_is_ALSO_metered_and_the_cap_is_rechecked(concierge, model):
    """⛔ THE SECOND CALL COSTS MONEY TOO. A loop that consulted the cap only on
    the first pass would be a cap on one call, not on a proposal."""
    bad = {"type": "call", "name": "zzNope", "args": [s()]}
    model([tool_use(bad, in_tokens=100, out_tokens=10),
           tool_use(bad, in_tokens=200, out_tokens=20)])
    res = concierge.propose("x", user_id=USER, bars=bars())
    assert res["ok"] is False

    from api.services.catalyst import store
    logged = store.cost_stats_for_date(concierge._market_date())
    assert logged["call_count"] == 2
    assert logged["total_input_tokens"] == 300 and logged["total_output_tokens"] == 30
    assert concierge.spend_for(USER) == pytest.approx(logged["total_cost_usd"])


def test_the_model_is_priced_by_the_guard_and_an_unknown_id_is_NEVER_free(concierge):
    """⚠️ THE UNKNOWN-MODEL RULE IS LOAD-BEARING and it belongs to `cost_guard`, so
    it is asserted against `cost_guard` — not re-implemented here."""
    from api.services.catalyst import cost_guard
    assert cost_guard.estimate_cost(concierge.MODEL, 1_000_000, 0) > 0, (
        f"{concierge.MODEL} has no pricing entry — the cap would run on the "
        "fallback rate rather than on the real one")
    assert cost_guard.estimate_cost("zz-not-a-model", 1_000_000, 0) > 0


def test_a_transport_failure_is_a_REFUSAL_and_never_an_exception(concierge, model):
    model([RuntimeError("connection reset")])
    res = concierge.propose("average it", user_id=USER, bars=bars())
    assert res["ok"] is False and res["gate"] == "model:transport"
    assert "ast" not in res


def test_the_temperature_retry_is_the_SHIPPED_idiom(concierge, model):
    """⚠️ NEWER MODELS REJECT `temperature` AS DEPRECATED and the shipped call pops
    it and retries once. Reproduced here because a concierge that died on that 400
    would be dead the day the default model id moves."""
    class Fussy(FakeClient):
        def create(self, **kwargs):
            self.calls.append(kwargs)
            if "temperature" in kwargs:
                raise RuntimeError("temperature: unsupported parameter")
            return tool_use(windowed(20))

    client = Fussy([])
    import api.services.engine as engine_mod
    original = engine_mod._get_anthropic_client
    engine_mod._get_anthropic_client = lambda: client
    try:
        res = concierge.propose("average it", user_id=USER, bars=bars())
    finally:
        engine_mod._get_anthropic_client = original
    assert res["ok"] is True
    assert len(client.calls) == 2
    assert "temperature" in client.calls[0] and "temperature" not in client.calls[1]


# ═══ 8. NO SECOND VALIDATION PATH, AND NOTHING IS STORED ═══════════════════

def test_the_concierge_reaches_the_guards_THROUGH_THE_SAME_FUNCTIONS_a_typed_formula_does(
        concierge):
    """⛔ NO PRIVILEGED LANE FOR A MACHINE-WRITTEN FORMULA. A second validation path
    would be a second set of guards to keep in step, and it would drift the first
    time one side moved. Asserted by an import/AST scan: the four checks are
    IMPORTED from the shipped modules and CALLED BY NAME inside `_validate`.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    tree = pyast.parse(src)

    imported: Dict[str, str] = {}
    for node in pyast.walk(tree):
        if isinstance(node, pyast.ImportFrom):
            for alias in node.names:
                imported[alias.asname or alias.name] = node.module or ""
    assert imported.get("check_budget") == "api.services.ast_budget"
    assert imported.get("interpret") == "api.services.ast_interpret"
    assert imported.get("TableRefusal") == "api.services.ast_interpret"
    assert imported.get("BudgetExceeded") == "api.services.ast_budget"

    validate = _function(src, "_validate")
    called = set()
    for node in pyast.walk(validate):
        if isinstance(node, pyast.Call):
            fn = node.func
            if isinstance(fn, pyast.Name):
                called.add(fn.id)
            elif isinstance(fn, pyast.Attribute):
                called.add(fn.attr)
    for name in ("check_budget", "interpret", "lint_repaint", "assert_canonical",
                 "_assert_within_schema"):
        assert name in called, f"`_validate` never calls {name}"

    # …and there is no second implementation hiding in this module.
    assert "def lint_repaint" not in src and "def check_budget" not in src
    assert "def interpret" not in src


def test_a_PROPOSAL_is_never_written_to_the_store(concierge):
    """⛔ A PROPOSAL IS A SUGGESTION THE USER HAS NOT CONFIRMED. Persisting it would
    make a model-authored formula a definition the alert lane could bind to, with
    nobody having said yes. The store is reachable from this module (its
    `assert_canonical` is the shape check) so absence is asserted by NAME, not by
    the import being missing.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    tree = pyast.parse(src)
    attrs = {node.attr for node in pyast.walk(tree) if isinstance(node, pyast.Attribute)}
    for writer in ("save", "soft_delete", "new_def_id"):
        assert writer not in attrs, f"the concierge calls the store's {writer}"
    assert "assert_canonical" in attrs, "the scan found no store call at all"


def test_the_concierge_never_assigns_a_badge_an_id_or_a_budget(concierge, model):
    """⛔ WHAT IT MAY NOT EMIT. A model that could set `meta.repaint`, an id, a tier
    or a `compute.budget` could set it wrong in a way that reads as authoritative.
    The answer carries a `repaint` and it is the LINTER'S measurement — asserted
    against `ast_lint` directly rather than against a copy."""
    from api.services import ast_lint
    tree = windowed(20)
    model([tool_use(tree)])
    res = concierge.propose("average it", user_id=USER, bars=bars())
    assert res["repaint"] == ast_lint.lint_repaint(tree)["mode"]
    for forbidden in ("id", "tier", "budget", "meta", "definition", "plots"):
        assert forbidden not in res


# ═══ 8b. A SCAN IS A CONDITION — the ONE stage `kind` changes ══════════════
#
# ⭐ A SCAN IS `<ast> != 0` ON THE LAST CONFIRMED BAR (E-A1). A tree that yields a
# NUMBER is a perfectly good indicator and a wrong answer to "find me stocks
# where…": handed back as a screen it would match every symbol whose average is
# not zero, which is all of them. So `kind="scan"` adds exactly one stage, INSIDE
# `_validate`, and that stage CALLS E-2's classifier rather than re-deriving it.


def a_condition() -> dict:
    """A tree the MANIFEST declares as a condition, found rather than named."""
    section, name = _entry_yielding("bool")
    assert section is not None, "the manifest declares no condition-yielding entry"
    return _entry_tree(section, name, s())


def test_a_SCAN_proposal_that_yields_a_NUMBER_is_refused(concierge, model):
    """⭐ THE STAGE, AND THE GATE IT REFUSES UNDER. `sma(close, 20)` is a fine
    indicator; as a screen it is `sma(close,20) != 0`, true for every symbol in
    the universe — a wrong answer that looks like a working feature.
    """
    number = windowed(20)
    assert concierge.scan_definition.is_boolean_tree(number) is False, (
        "the chosen tree is not a NUMBER — this case would prove nothing")
    model([tool_use(number), tool_use(number)])
    res = concierge.propose("find me stocks in an uptrend", user_id=USER,
                            bars=bars()[:30], kind="scan")
    assert res["ok"] is False
    assert res["gate"] == "scan:not-a-condition"
    assert "ast" not in res and "source" not in res


def test_an_INDICATOR_proposal_is_UNAFFECTED_by_the_scan_stage(concierge, model):
    """⚠️ THE CONTROL FOR THE STAGE ABOVE, AND IT IS THE WHOLE ATTRIBUTION. The
    SAME tree, asked for as an indicator, is accepted. A stage that refused both
    would be a regression wearing a gate's clothes; a stage that accepted both
    would not be a stage.
    """
    model([tool_use(windowed(20))])
    res = concierge.propose("a twenty bar average", user_id=USER, bars=bars()[:30])
    assert res["ok"] is True, res
    assert res["kind"] == "indicator"


def test_a_SCAN_that_IS_a_condition_is_accepted_and_the_ENVELOPE_says_what_it_is(
        concierge, model):
    """⭐ THE POSITIVE HALF, AND THE HONEST ENVELOPE. The answer carries `kind`,
    the repaint verdict AND the freshness verdict — both measured by the shipped
    readers, because the repaint linter answers a TRUE zero for a scalar leaf and
    a screen branded only `non-repainting` would say nothing about the nightly
    snapshot underneath it.
    """
    from api.services import ast_freshness
    tree = a_condition()
    model([tool_use(tree)])
    res = concierge.propose("stocks where that holds", user_id=USER,
                            bars=bars()[:30], kind="scan")
    assert res["ok"] is True, res
    assert res["kind"] == "scan"
    assert res["ast"] == tree
    assert res["sentence"] == concierge.sentence_for(tree)
    assert res["freshness"] == ast_freshness.freshness_for(tree)["mode"]

    # …and a bars-only screen has NO cadence ceiling, because bars stream.
    assert res["cadence"] is None, (
        "a screen reading no scalar claimed a data cadence it does not have")

    # …while a scalar-bearing screen says its ceiling, read off E-3's function
    # rather than typed here.
    from api.services.screener.scan_evaluator import cadence_ceiling
    scalar_tree = {"type": "op", "name": _binary_operators()[0],
                   "args": [s(SCALARS[0]), n(1)]}
    model([tool_use(scalar_tree)])
    scan = concierge.propose("a scalar screen", user_id=USER, bars=bars()[:30],
                             kind="scan")
    assert scan["ok"] is True, scan
    assert scan["cadence"] == cadence_ceiling(scalar_tree)
    assert scan["freshness"] == ast_freshness.freshness_for(scalar_tree)["mode"]
    assert scan["cadence"], "the scalar screen reported no ceiling at all"


def test_an_UNKNOWN_kind_is_REFUSED_rather_than_quietly_treated_as_an_indicator(
        concierge, model):
    """⛔ A SCAN REQUEST SPELLED WRONG MUST NOT BECOME AN INDICATOR. Defaulting
    would mean the condition stage never ran and nothing said so — the model
    answers, the tree validates, and a member screens on a price column. The
    model is never called, which is asserted by call count.
    """
    client = model([tool_use(windowed(20))])
    res = concierge.propose("anything", user_id=USER, bars=bars()[:30], kind="scanner")
    assert res["ok"] is False and res["gate"] == "kind:unknown"
    assert "ast" not in res
    assert client.calls == [], "an unrecognised kind was paid for before it was refused"
    for kind in concierge.KINDS:
        assert kind in res["reason"], "the refusal does not say what the kinds are"


def test_the_condition_check_is_E2s_FUNCTION_and_there_is_no_second_PYTHON_copy(concierge):
    """⛔ ONE FACT, ONE IMPLEMENTATION PER LANE. The manifest declares what an
    entry's values can be so that nobody hand-lists comparators; E-2 then wrote
    the ONE Python derivation (`scan_definition.is_boolean_tree`). A second
    Python walk here would satisfy that to the letter and re-create `williams_r`
    vs `williamsR` inside one language.

    AST, not grep: the concierge's scan stage must CALL it.

    🔴 AND THE CALL IS LOCATED IN `_validate`, NOT ANYWHERE IN THE MODULE — which
    is a correction this file's own mutation gauntlet forced. The first version
    of this rail asked "does some call in this module end in `is_boolean_tree`",
    and the answer was YES for a reason that has nothing to do with scans: the
    read-back's logical chrome asks the same classifier which phrase to use. So a
    mutation that replaced the SCAN STAGE with a hand-list of comparators
    SURVIVED, with the rail meant to catch it green. A gate satisfied by an
    unrelated call site is a gate that cannot fail.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    stage = {pyast.unparse(node.func)
             for node in pyast.walk(_function(src, "_validate"))
             if isinstance(node, pyast.Call)}
    assert any(c.endswith("is_boolean_tree") for c in stage), (
        "the scan stage inside `_validate` does not call E-2's classifier — a "
        f"second derivation is hiding in {sorted(stage)}")

    # …and the module reaches it through the MODULE, never a `from … import`. A
    # `from api.services.scan_definition import is_boolean_tree` would sever the
    # call from the module's own guards (`lesson_from_import_severs_a_module_
    # from_its_guards`).
    assert any(c.endswith(".is_boolean_tree") for c in stage), (
        "the classifier was imported by name rather than reached through its "
        f"module: {sorted(stage)}")

    # …and no local re-derivation: no function in this module may read the
    # manifest's own `yields` declaration directly.
    constants = {node.value for node in pyast.walk(pyast.parse(src))
                 if isinstance(node, pyast.Constant) and isinstance(node.value, str)}
    field = "yields"
    assert field not in constants, (
        f"this module spells {field!r} — it is resolving the manifest's kind "
        "declaration itself instead of asking the one function that owns it")
    # The positive control for the scan above: the field really is what the
    # manifest declares, so its absence here is a meaningful absence.
    assert any(field in (spec or {}) for spec in TABLE[ast_table.OPERATORS_SECTION].values())


def test_the_scan_path_takes_NO_SECOND_VALIDATION_ROUTE(concierge):
    """⛔ ONE PIPELINE. `_validate` must remain the ONLY validator, with the scan
    stage INSIDE it rather than beside it — a stage in `propose` would be a
    second set of gates to keep in step, and the ORDER of the stages is the
    attribution every refusal case in this file depends on.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    validators = [node.name for node in pyast.walk(pyast.parse(src))
                  if isinstance(node, pyast.FunctionDef)
                  and any(c in pyast.unparse(node)
                          for c in ("check_budget", "lint_repaint"))]
    assert validators == ["_validate"], (
        f"{validators} all reach a guard — a second validation path is a second "
        "set of gates to keep in step")

    # …and the scan stage is in THAT function, after the budget and before the
    # linter. The order is the attribution: a condition check that ran first
    # would report `scan:not-a-condition` for an over-budget tree.
    #
    # ⛔ THE ORDER IS READ OFF THE CALLS, NOT OFF THE TEXT. `pyast.unparse`
    # includes the docstring, which names all three stages in prose — a
    # `str.index` comparison would have been measuring a comment.
    where = {}
    for node in pyast.walk(_function(src, "_validate")):
        if isinstance(node, pyast.Call):
            name = pyast.unparse(node.func).rsplit(".", 1)[-1]
            if name in ("check_budget", "is_boolean_tree", "lint_repaint"):
                where.setdefault(name, node.lineno)
    assert sorted(where) == ["check_budget", "is_boolean_tree", "lint_repaint"], (
        f"`_validate` does not call all three stages: found {sorted(where)}")
    assert where["check_budget"] < where["is_boolean_tree"] < where["lint_repaint"], (
        f"the stages run in the wrong order: {where}")


# ═══ 8c. THE FIRM'S OWN WORDS — resolved HERE, never guessed by the model ═══
#
# ⭐⭐ AMENDMENT 1's KNOWLEDGE LAYER, SEEN FROM THE PIPELINE. A generic model asked
# what "trending" means guesses, and guesses differently next Tuesday.
# `conceptVocabulary.json` is the FIRM'S answer — every concept citing an artifact
# the firm already ships, every citation looked up rather than trusted — and these
# cases assert that a member's sentence meets it BEFORE the model sees anything.


def _a_grounded_word() -> str:
    """The first word the shipped vocabulary grounds. Read, never typed."""
    from api.services import concept_vocabulary
    words = sorted(concept_vocabulary.concepts())
    assert words, "the vocabulary grounds no words at all"
    return words[0]


def _a_refused_word() -> str:
    from api.services import concept_vocabulary
    words = sorted(concept_vocabulary.refused())
    assert words, "the vocabulary declares no refusals — the honest half is empty"
    return words[0]


def test_the_FIRMS_WORD_is_EXPANDED_HERE_and_the_model_is_TOLD_not_asked(
        concierge, model):
    """⭐ THE OWNER'S BAR, MEASURED. *"'trending stocks' language would imply above
    some MAs… just knowledge like that to interpret the language."* The firm
    already answers "trending", and the model must be TOLD that answer rather
    than asked for one.

    ⛔ SO THE EXPANSION IS IN THE SYSTEM PROMPT, AND IT IS THE VOCABULARY FILE'S
    `source` BYTE FOR BYTE — never a paraphrase written here and never the bare
    word left for the model to interpret.
    """
    from api.services import concept_vocabulary
    word = _a_grounded_word()
    expansion = concept_vocabulary.resolve(word)
    assert expansion["ok"], expansion

    client = model([tool_use(a_condition())])
    res = concierge.propose(f"find me {word} stocks", user_id=USER,
                            bars=bars()[:30], kind="scan")
    assert res["ok"] is True, res

    system = client.calls[0]["system"]
    assert expansion["source"] in system, (
        "the firm's expansion never reached the model — it was handed the word "
        "and asked to guess")
    assert word in system

    # The control: a prompt with none of the firm's words carries no expansion,
    # so "the source is in the prompt" is not satisfied by a constant block.
    model([tool_use(windowed(20))])
    plain = concierge.propose("a twenty bar average", user_id=USER, bars=bars()[:30])
    assert plain["ok"] is True
    assert plain["concepts"] == []


def test_a_REFUSED_word_is_REFUSED_BY_NAME_and_NOTHING_IS_APPROXIMATED(
        concierge, model):
    """🔴 A WRONG SCAN THAT LOOKS RIGHT IS WORSE THAN A REFUSAL. "cheap" has no
    defensible definition — the firm's own screen that uses the word bundles
    three measures — so inventing a P/E threshold would be an unmeasured accuracy
    claim wearing a helpful face (spec §1.6).

    ⛔ AND THE REFUSAL NAMES THE WORD, so a member can say what they meant
    instead of being handed somebody's guess. No nearest match, no partial
    expansion, and NOT ONE TOKEN SPENT.
    """
    from api.services import concept_vocabulary
    word = _a_refused_word()
    client = model([tool_use(a_condition())])
    res = concierge.propose(f"find me {word} stocks", user_id=USER,
                            bars=bars()[:30], kind="scan")

    assert res["ok"] is False
    assert res["gate"] == concept_vocabulary.GATE_AMBIGUOUS
    assert word in res["reason"], (
        "the refusal does not name the word it could not ground")
    for forbidden in ("ast", "source", "sentence", "concepts"):
        assert forbidden not in res, f"a refusal handed back {forbidden}"
    assert client.calls == [], "the model was paid for a word the firm refuses"

    # ⛔ THE CONTROL FOR "NEVER APPROXIMATED": the refused word must not be a
    # grounded one under another spelling, or the case above would be about a
    # missing entry rather than a declared refusal.
    assert concept_vocabulary.resolve(word)["ok"] is False
    assert word not in concept_vocabulary.concepts()


def test_a_concept_EXPANDS_and_the_TREE_is_stored_with_the_WORD_as_PROVENANCE(
        concierge, model):
    """🔴 VERSIONING, MADE STRUCTURAL. If "trending" changes definition, scans
    already built on it MUST NOT silently change meaning. So the concept expands
    into a TREE and the answer carries the tree; the WORD travels beside it as
    provenance with the vocabulary version that expanded it. A stored
    `{"concept": "trending"}` would make every saved scan a late binding to a
    vocabulary that moves, and `compute.fn` would stop meaning the maths.
    """
    from api.services import concept_vocabulary
    word = _a_grounded_word()
    tree = a_condition()
    model([tool_use(tree)])
    res = concierge.propose(f"{word} stocks", user_id=USER, bars=bars()[:30],
                            kind="scan")

    assert res["ok"] is True, res
    assert res["concepts"] == [{"word": word,
                                "version": concept_vocabulary.version()}]
    # ⛔ NO LATE BINDING ANYWHERE IN THE TREE — by SHAPE, over the whole document.
    assert "concept" not in json.dumps(res["ast"])
    assert res["ast"] == tree
    # …and the read-back is the TREE's, so what the member confirms is the maths.
    assert res["sentence"] == concierge.sentence_for(tree)


def test_NO_WINRATE_NUMBER_REACHES_ANY_SURFACE_BEFORE_E6(concierge, model):
    """⛔ `setup_winrate` IS A CLAIM. Until E-6 can back it and design §8.3 says
    what a published record may SAY, the vocabulary carries PROVENANCE (which
    playbook attributes a concept) and never a percentage. A number on a surface
    gets screenshotted.
    """
    word = _a_grounded_word()
    model([tool_use(a_condition())])
    res = concierge.propose(f"{word} stocks", user_id=USER, bars=bars()[:30],
                            kind="scan")
    assert res["ok"] is True, res
    payload = json.dumps(res)
    assert not re.search(r"\d+(\.\d+)?\s*%", payload), (
        f"a percentage reached the proposal payload: {payload[:400]}")
    assert "win_rate" not in payload and "winrate" not in payload

    # The positive control: the regex really does catch one, so its silence above
    # is a measurement rather than a broken pattern.
    assert re.search(r"\d+(\.\d+)?\s*%", json.dumps({"x": "62.5%"}))


def test_the_PHASES_ACCEPTANCE_TREE_goes_through_propose_END_TO_END(concierge, model):
    """⭐ `rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)` — the phase's own
    acceptance formula, TWO SCALARS and a function call, through the AI door.

    🔴 THIS WAS REFUSED AT `schema:name` UNTIL THIS TASK: the tool schema's enums
    were three sections, so the model could not legally name a scalar, and the
    Python read-back could not have said one if it had. Every stage is asserted
    here through the shipped functions — schema, condition, linter, read-back and
    source round-trip — because "it returns ok" is satisfied by a pipeline that
    skipped all of them.
    """
    from api.services import ast_lint
    # ⚠️ THE ONE PLACE THIS FILE SPELLS TABLE NAMES, AND IT IS DELIBERATE: this
    # tree IS the phase's stated acceptance criterion, quoted. Every name is
    # asserted DECLARED first, so a rename lands here as a red test naming it
    # rather than as a tree that silently stopped being the acceptance case.
    gt, both, avg = ">", "&&", "sma"
    named = {gt, both, avg, "close", "rs_rank", "adr_pct"}
    assert named <= ast_table.declared_names(TABLE), (
        f"the acceptance formula names {sorted(named - ast_table.declared_names(TABLE))}, "
        "which the closed table no longer declares")
    tree = {"type": "op", "name": both, "args": [
        {"type": "op", "name": both, "args": [
            {"type": "op", "name": gt, "args": [s("rs_rank"), n(80)]},
            {"type": "op", "name": gt, "args": [s("adr_pct"), n(4)]}]},
        {"type": "op", "name": gt, "args": [
            s("close"), {"type": "call", "name": avg, "args": [s("close"), n(50)]}]}]}

    model([tool_use(tree)])
    res = concierge.propose("trending leaders with room, above the 50 day",
                            user_id=USER, bars=bars()[:60], kind="scan")

    assert res["ok"] is True, res
    assert res["kind"] == "scan"
    assert res["ast"] == tree
    assert res["repaint"] == ast_lint.lint_repaint(tree)["mode"] == "non-repainting"
    assert res["freshness"] == "as-of-snapshot", (
        "a screen reading two nightly scalars claimed live data")
    assert res["cadence"] == "nightly"
    assert res["sentence"] == concierge.sentence_for(tree)
    # …and the two scalar phrases are the MANIFEST'S, quoted from it rather than
    # retyped here — the sentence is a join of declarations, not prose.
    for name in ("rs_rank", "adr_pct"):
        assert TABLE[ast_table.SCALARS_SECTION][name]["sentence"] in res["sentence"]
    # …and the source the concierge derives parses back to the same tree.
    assert res["source"] == concierge.formula_for(tree)


# ═══ 9. THE ROUTE — paid, derived, and it stores nothing ═══════════════════

@pytest.fixture
def app(concierge):
    a = FastAPI()
    a.include_router(router_mod.router)
    return a


def test_the_propose_route_is_MOUNTED_and_PAID_GATED_like_every_other(app, concierge, model):
    """⚠️ EVERYTHING IS PAID (owner ruling), AND THE COVERAGE IS DERIVED FROM
    `router.routes` WITH THE COUNT ASSERTED — Phase C Task 13 measured a shipped
    test hand-listing three paths while the router had five, so two paid endpoints
    rode with no auth coverage. `tests/test_user_definitions.py` owns that sweep and
    its `EXPECTED_ROUTE_COUNT` moved 5 → 6 for this route; this asserts the same
    thing from the other side so neither file can be the only one that knows.
    """
    routes = [r for r in router_mod.router.routes if getattr(r, "methods", None)]
    assert len(routes) == 6
    propose = [r for r in routes if r.path.endswith("/propose")]
    assert len(propose) == 1 and propose[0].methods == {"POST"}
    assert router_mod.require_paid in [d.call for d in propose[0].dependant.dependencies]

    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "free1", "role": "user", "plan": "free"}
    c = TestClient(app)
    r = c.post("/api/user-definitions/propose", json={"prompt": "average the close"})
    assert r.status_code == 402
    assert r.json()["detail"] == "Custom indicators require a paid plan"


def test_a_PAID_user_gets_the_concierges_answer_and_a_refusal_is_a_200(app, concierge, model):
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    c = TestClient(app)

    tree = windowed(20)
    model([tool_use(tree)])
    ok = c.post("/api/user-definitions/propose",
                json={"prompt": "average the close over twenty bars", "bars": bars()})
    assert ok.status_code == 200
    body = ok.json()
    assert body["ok"] is True and body["ast"] == tree
    assert body["sentence"] == concierge.sentence_for(tree)

    alien = {"type": "call", "name": "zzNope", "args": [s()]}
    model([tool_use(alien), tool_use(alien)])
    refused = c.post("/api/user-definitions/propose", json={"prompt": "x"})
    assert refused.status_code == 200, (
        "a refusal is a legitimate answer, not a transport failure")
    assert refused.json()["ok"] is False
    assert refused.json()["gate"] == "schema:name"
    assert "ast" not in refused.json()

    over = c.post("/api/user-definitions/propose",
                  json={"prompt": "x", "bars": [{} for _ in range(6000)]})
    assert over.status_code == 400 and "at most" in over.json()["detail"]


def test_the_ROUTE_carries_the_KIND_and_defaults_to_the_PIPELINES_own(
        app, concierge, model):
    """⛔ THE WIRE, NOT THE COMPONENT. `_validate`'s scan stage is unreachable
    unless the request says which question it is answering, and a route that
    dropped `kind` would leave every rail in section 8b green over a stage that
    never fires — the built-tested-green-and-unreachable shape this phase keeps
    measuring.

    ⭐ AND THE DEFAULT IS READ OFF THE PIPELINE. A body with no `kind` is every
    caller that shipped before scans existed; spelling the default in the router
    would be a second declaration of it.
    """
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    c = TestClient(app)
    number = windowed(20)

    # The SAME tree, the SAME route, and only `kind` differs.
    model([tool_use(number), tool_use(number)])
    scan = c.post("/api/user-definitions/propose",
                  json={"prompt": "find me stocks", "kind": "scan",
                        "bars": bars()[:30]}).json()
    assert scan["ok"] is False and scan["gate"] == "scan:not-a-condition"

    model([tool_use(number)])
    indicator = c.post("/api/user-definitions/propose",
                       json={"prompt": "average it", "kind": "indicator",
                             "bars": bars()[:30]}).json()
    assert indicator["ok"] is True and indicator["kind"] == "indicator"

    model([tool_use(number)])
    omitted = c.post("/api/user-definitions/propose",
                     json={"prompt": "average it", "bars": bars()[:30]}).json()
    assert omitted["ok"] is True
    assert omitted["kind"] == concierge.INDICATOR_KIND

    # …and an unrecognised kind is the PIPELINE's refusal, not a 422 from a
    # second list of kinds maintained at the edge.
    model([tool_use(number)])
    bogus = c.post("/api/user-definitions/propose",
                   json={"prompt": "x", "kind": "screener", "bars": []})
    assert bogus.status_code == 200
    assert bogus.json()["gate"] == "kind:unknown"
