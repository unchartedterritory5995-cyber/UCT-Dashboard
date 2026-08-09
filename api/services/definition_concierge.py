"""NL -> AST. The AI door.

⭐ WHAT IT MAY EMIT: a tree over the closed table, and nothing else. The tool
schema is GENERATED from ``closedTable.json`` -- the same manifest the parser is
configured from and both interpreters walk -- so an out-of-table name is a SCHEMA
VIOLATION AT THE BOUNDARY rather than a runtime surprise. This is
``grade_ticker``'s ruling applied to a grammar: *decisiveness is STRUCTURAL, not
prompted*. A prompt that ASKS a model to stay inside a vocabulary is a request; a
schema that enumerates the vocabulary is a constraint.

⛔ WHAT IT MAY NOT EMIT: prose describing an indicator, a ``meta.repaint`` value,
a ``compute.budget``, a ``tier``, an id, or the read-back sentence. Every one of
those is assigned by something deterministic, and a model that could set any of
them could set it wrong in a way that reads as authoritative.

⭐⭐ THE SENTENCE IS THE TREE'S, NOT THE MODEL'S. ``propose`` assigns ``sentence``
exactly once, from ``sentence_for(ast_obj)``, and ``tests/test_definition_concierge``
asserts that BY WALKING THIS MODULE'S OWN AST -- because a test that merely checked
the output looked right would pass a version that wrote its own prose. A
model-written summary of a model-written formula is two guesses agreeing, and a
user has no way to tell that pair apart from a correct one.

⛔ HOW IT REFUSES: ``{ok: False, reason: "<plain English>", gate: "<the door>"}``
-- the ``brain_service`` shape, which never raises and keeps ``reason`` (a
legitimate "I can't answer that") DISTINCT from ``error`` (a caught exception). A
refusal hands back NO formula: an ``ast`` beside ``ok: False`` is a formula a
caller will eventually use.

⭐⭐ AND EVERY REFUSAL NAMES THE DOOR THAT DECIDED IT. The defect this branch has
produced SIX times is "refused by a different door" -- a correct answer produced
by the wrong mechanism. The pipeline below is

    cost -> generate -> schema -> canonical shape -> budget -> lint -> compute -> read back

and each stage refuses under its own guard name, drawn from the guard vocabularies
the shipped modules already own (``resolve:*`` / ``interpret:*`` from
``ast_interpret``, ``budget:*`` from ``ast_budget``, ``sentence:*`` from this
module's mirror of ``sentence.js``). The test file measures the attribution the
only way it can be measured: it removes ONE gate and shows the refusal move.

⛔ THERE IS NO PRIVILEGED LANE FOR A MACHINE-WRITTEN FORMULA. The model's output
is UNTRUSTED INPUT, exactly like the text box, and it goes through the SAME
functions a typed formula does -- ``user_definitions.assert_canonical``,
``ast_budget.check_budget``, ``ast_lint.lint_repaint``, ``ast_interpret.interpret``.
A second validation path would be a second set of guards to keep in step.

⚠️ ONE REPAIR, THEN A REFUSAL. The model sees the linter's (or the table's, or
the budget's) verdict BEFORE THE USER DOES and gets exactly one more attempt. An
unbounded repair loop is an unbounded bill and an unbounded wait, and
``cost_guard`` is a cap on spend, not on patience.

⚠️ SINGLE-PROCESS ASSUMPTION, DECLARED. ``_USER_SPEND`` below is process-local
module state, exactly like ``cost_guard._HARD_CAP_TRIPPED`` /
``_SOFT_CAP_LOGGED_FOR_DATE`` and the broker sync's ``_locks``. The web pod is
deliberately ONE uvicorn process, so this is correct today and is the first thing
to break on scale-out. It is a CAP, not a cache: a second instance would give one
account two allowances.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

from api.services import ast_lint, ast_table, user_definitions
from api.services.ast_budget import BudgetExceeded, check_budget
from api.services.ast_interpret import TableRefusal, interpret
from api.services.catalyst import cost_guard

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")


# --------------------------------------------------------------------------- #
# the knobs
# --------------------------------------------------------------------------- #

#: The model. It MUST have a ``cost_guard`` pricing entry or the guard prices it
#: at the priciest known rate -- never $0, because a $0 estimate makes every cap
#: unenforceable. Both readings keep the cap enforced; the named one keeps it
#: honest.
MODEL: str = os.environ.get("CONCIERGE_MODEL", "claude-sonnet-5")

#: Enough for a tree, nowhere near enough for an essay. The tool call is the only
#: output that matters and a tree over this table is small.
MAX_TOKENS: int = 1200

#: ⭐ ONE GENERATE, ONE REPAIR. Not "retry until clean" -- see the header.
MAX_MODEL_CALLS: int = 2

#: The per-user daily cap, ON TOP OF ``cost_guard``'s global one. The global cap
#: protects the bill; this one protects one account from spending everyone
#: else's.
def _user_cap_usd() -> float:
    return float(os.environ.get("CONCIERGE_USER_CAP_DAILY", "0.75"))


#: ``(market_date, user_id) -> USD spent``. See the header's single-process note.
_USER_SPEND: Dict[Tuple[str, str], float] = {}


def _market_date() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d")


def spend_for(user_id: Any, market_date: Optional[str] = None) -> float:
    """What this process has recorded for one user today. Observable on purpose."""
    return _USER_SPEND.get(((market_date or _market_date()), str(user_id)), 0.0)


def _record_spend(user_id: Any, market_date: str, usd: float) -> None:
    key = (market_date, str(user_id))
    _USER_SPEND[key] = _USER_SPEND.get(key, 0.0) + max(0.0, float(usd))


def reset_spend() -> None:
    """Drop the per-user ledger. For tests; the process has no other lifetime."""
    _USER_SPEND.clear()


# --------------------------------------------------------------------------- #
# the refusals
# --------------------------------------------------------------------------- #

#: guard -> the sentence it always refuses with.
#:
#: ⛔ PAIRWISE DISJOINT, AND DISJOINT FROM ``ast_interpret``'s SIX, ``ast_budget``'s
#: THREE AND ``sentence.js``'s TEN. Two gates sharing a phrase let an assertion
#: pass with the safety deleted, and that has happened in this repo. The guards
#: this module does NOT own -- ``resolve:*``, ``interpret:*``, ``budget:*``,
#: ``sentence:*`` -- are reported UNDER THEIR OWN NAMES with their own sentences,
#: never re-wrapped under one of these.
REFUSALS: Mapping[str, str] = {
    "prompt:empty": (
        "there is nothing to turn into a formula yet"),
    "cost:global": (
        "the formula assistant has reached its spending limit for today"),
    "cost:user": (
        "you have used up today's allowance of the formula assistant"),
    "model:transport": (
        "the formula assistant could not be reached"),
    "model:no-tool": (
        "the assistant replied without emitting a formula"),
    "schema:node": (
        "the assistant emitted something that is not a formula tree"),
    "schema:name": (
        "the assistant used a name that is not in the formula vocabulary"),
    "schema:number": (
        "the assistant wrote a number this formula language cannot spell"),
    "lint:repaint": (
        "the assistant's formula would repaint, so it was not accepted"),
    "compute:empty": (
        "the assistant's formula produces no value on the bars in view"),
    "compute:wiring": (
        "the assistant's formula collides with a name this chart already declares"),
}


class _Refused(Exception):
    """One stage saying no, carrying the door that decided.

    Internal: ``propose`` converts it into the ``{ok: False, reason, gate}``
    answer. Nothing outside this module sees an exception, because a raising
    concierge is a blank screen on a surface whose failure state is a sentence.
    """

    def __init__(self, gate: str, detail: str = "") -> None:
        sentence = REFUSALS.get(gate)
        message = sentence if sentence else detail
        if sentence and detail:
            message = f"{sentence} -- {detail}"
        super().__init__(message)
        self.gate = gate
        self.reason = message


# --------------------------------------------------------------------------- #
# the tool schema -- GENERATED FROM THE MANIFEST, BOTH DIRECTIONS
# --------------------------------------------------------------------------- #

TOOL_NAME = "emit_formula"

#: The four canonical node types. Read from the store's own declaration rather
#: than re-typed: a third spelling of the node vocabulary is a third thing to
#: keep in step.
NODE_TYPES: Tuple[str, ...] = tuple(user_definitions.NODE_TYPES)


def tool_schema(table: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """The callable vocabulary, DERIVED from the closed table.

    ⛔ DERIVED, BOTH DIRECTIONS, AND NEVER HAND-LISTED. A hand-written schema is a
    third copy of the table and it would drift the first time a function was
    added -- silently, because every existing test would stay green. The test
    plants an entry in a synthetic manifest and requires it BACK BY NAME with no
    edit to the rail, and an AST walk over this module's own source asserts that
    no declared function or series name appears here as a string constant.

    ``arity`` is carried per function so the model is told the shape, but this
    module does not ENFORCE arity at the boundary: a JSON Schema enum can express
    "which names exist" and cannot express "how many arguments each takes", so
    arity stays the table's question and is refused by ``resolve:arity`` at the
    door that owns it. Claiming it here would move a refusal off the guard that
    is supposed to catch it -- this branch's most expensive defect.
    """
    t = table if table is not None else ast_table.TABLE
    functions = {
        name: {
            "arity": len(spec.get("args") or ()),
            "args": list(spec.get("args") or ()),
            "sentence": spec.get("sentence"),
        }
        for name, spec in t[ast_table.FUNCTIONS_SECTION].items()
    }
    operators = {
        name: {"arity": spec.get("arity")}
        for name, spec in t[ast_table.OPERATORS_SECTION].items()
    }
    series = {
        name: {"doc": spec.get("doc")}
        for name, spec in t[ast_table.SERIES_SECTION].items()
    }
    return {
        "name": TOOL_NAME,
        "functions": functions,
        "operators": operators,
        "series": series,
        "nodeTypes": list(NODE_TYPES),
        "input_schema": _input_schema(functions, operators, series),
    }


def _input_schema(functions: Mapping[str, Any], operators: Mapping[str, Any],
                  series: Mapping[str, Any]) -> Dict[str, Any]:
    """The JSON Schema the API boundary enforces. Three enums, and they are the
    table's own key sets.

    ⚠️ ``value`` IS NON-NEGATIVE, AND THAT IS NOT A TASTE. The ONE parser
    (``parse.js``) turns ``-5`` into ``op u- [num 5]``; a ``num`` node with a
    negative value is a tree the parser cannot produce, so a ``source`` spelling
    of it could never parse back to it and ``defSchema``'s round-trip would refuse
    the definition at registration. Refusing it here, with a sentence that names
    the fix, is the same refusal one door earlier.
    """
    node = {"$ref": "#/$defs/node"}
    arities = [spec.get("arity") for spec in operators.values()
               if isinstance(spec.get("arity"), int)]
    fn_arities = [spec["arity"] for spec in functions.values()]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["ast"],
        "properties": {"ast": node},
        "$defs": {
            "node": {"oneOf": [{"$ref": f"#/$defs/{k}"} for k in NODE_TYPES]},
            "num": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "value"],
                "properties": {
                    "type": {"const": "num"},
                    "value": {"type": "number", "minimum": 0},
                },
            },
            "series": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "name"],
                "properties": {
                    "type": {"const": "series"},
                    "name": {"enum": sorted(series)},
                },
            },
            "op": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "name", "args"],
                "properties": {
                    "type": {"const": "op"},
                    "name": {"enum": sorted(operators)},
                    "args": {"type": "array", "items": node,
                             "minItems": min(arities or [1]),
                             "maxItems": max(arities or [3])},
                },
            },
            "call": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "name", "args"],
                "properties": {
                    "type": {"const": "call"},
                    "name": {"enum": sorted(functions)},
                    "args": {"type": "array", "items": node,
                             "minItems": min(fn_arities or [1]),
                             "maxItems": max(fn_arities or [3])},
                },
            },
        },
    }


def anthropic_tool(table: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """The tool definition handed to the API. Name, description, input schema."""
    schema = tool_schema(table)
    return {
        "name": schema["name"],
        "description": (
            "Emit ONE canonical formula tree over the closed indicator table. "
            "The tree is the artifact: do not write a formula string, a name, a "
            "description, a repaint claim or an English summary -- all of those "
            "are assigned by the system from the tree you emit."),
        "input_schema": schema["input_schema"],
    }


def vocabulary_text(table: Optional[Mapping[str, Any]] = None) -> str:
    """The vocabulary, spelled for the prompt, GENERATED from the same schema.

    The model is told the table twice -- once as a schema it cannot violate and
    once as English it can read -- and both readings come from one derivation, so
    a function added to the manifest reaches the prompt without this file moving.
    """
    schema = tool_schema(table)
    lines: List[str] = ["series (each reads one field of the bar):"]
    for name in sorted(schema["series"]):
        lines.append(f"  {name} -- {schema['series'][name]['doc']}")
    lines.append("functions:")
    for name in sorted(schema["functions"]):
        spec = schema["functions"][name]
        lines.append(f"  {name}({', '.join(spec['args'])}) -- {spec['sentence']}")
    lines.append("operators (by name and arity, spelled exactly as written here):")
    for name in sorted(schema["operators"]):
        lines.append(f"  {name} takes {schema['operators'][name]['arity']}")
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You turn a trader's plain-English description into ONE canonical formula "
    "tree, and you emit nothing else.\n\n"
    "A tree is built from four node shapes and no others:\n"
    '  {"type":"num","value":<non-negative number>}\n'
    '  {"type":"series","name":<a series below>}\n'
    '  {"type":"op","name":<an operator below>,"args":[...]}\n'
    '  {"type":"call","name":<a function below>,"args":[...]}\n\n'
    "Rules that are enforced, not requested:\n"
    "  * every name must come from the vocabulary below; there is no other list\n"
    "  * a window argument must be a plain whole-number node, never an expression\n"
    "  * negation is an operator node, because a negative number literal is not "
    "a shape the parser can produce\n"
    "  * a condition is a 0/1 column: there are no booleans\n"
    "  * the formula must not read any bar later than the one it writes\n\n"
    "You do NOT name the indicator, describe it, summarise it, or claim anything "
    "about whether it repaints. Emit the tree.\n\n"
    "VOCABULARY\n"
)


# --------------------------------------------------------------------------- #
# the boundary -- what the schema declares, enforced here too
# --------------------------------------------------------------------------- #

def _assert_within_schema(tree: Any, table: Optional[Mapping[str, Any]] = None) -> None:
    """Refuse anything the generated schema forbids, BEFORE the table sees it.

    ⭐ THIS IS THE BOUNDARY GATE, AND IT EXISTS BECAUSE THE SCHEMA IS ENFORCED ON
    SOMEBODY ELSE'S SERVER. The tool's ``input_schema`` is the constraint the API
    applies; this applies the SAME derivation locally so the claim does not depend
    on a remote validator we do not control. Its enums are read out of
    ``tool_schema`` -- one derivation, two enforcement points, no second list.

    ⚠️ IT CHECKS EXACTLY WHAT THE SCHEMA DECLARES: node shape, the three name
    enums, and number spellability. NOT arity, NOT window literals, NOT
    resolution -- those belong to the table and are refused by ``resolve:arity``
    and ``resolve:window`` at the doors that own them.
    """
    schema = tool_schema(table)
    names = {
        "series": set(schema["series"]),
        "op": set(schema["operators"]),
        "call": set(schema["functions"]),
    }
    stack: List[Any] = [tree]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict) or node.get("type") not in NODE_TYPES:
            raise _Refused("schema:node", f"got {node!r}")
        kind = node["type"]
        if kind == "num":
            _spell_number(node.get("value"))
            continue
        name = node.get("name")
        if not isinstance(name, str) or name not in names[kind]:
            raise _Refused(
                "schema:name",
                f"{name!r} is not one of {', '.join(sorted(names[kind]))}")
        if kind in ("op", "call"):
            args = node.get("args")
            if not isinstance(args, list):
                raise _Refused("schema:node", f"a {kind} node carries an args array; got {args!r}")
            stack.extend(args)


_SPELLABLE = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")


def _spell_number(value: Any) -> str:
    """A number, spelled the way ECMAScript's ``String(n)`` spells it.

    ⛔ REFUSES ANYTHING THE TWO LANES MIGHT SPELL DIFFERENTLY. ``JSON.stringify``
    and ``str`` agree on ``20`` and on ``1.5``; they do NOT agree on ``1e-07``
    versus ``1e-7``, and the ``source`` this spelling produces is re-parsed by the
    ONE parser and compared BY HASH. A number whose spelling could differ is
    refused rather than rendered into a round-trip that fails at registration.

    ``type(value) is bool`` is checked first: ``isinstance(True, int)`` is True
    and ``True == 1.0`` is True, so a boolean sails through every obvious numeric
    guard (measured on this branch, twice).
    """
    if type(value) is bool or not isinstance(value, (int, float)):
        raise _Refused("schema:number", f"got {value!r}")
    if isinstance(value, float) and not math.isfinite(value):
        raise _Refused("schema:number", f"got {value!r}")
    if value < 0:
        raise _Refused(
            "schema:number",
            f"{value!r} -- a negative literal is written as a unary-minus node, "
            "because that is the only shape the parser can produce")
    if isinstance(value, float) and value.is_integer():
        text = str(int(value))
    else:
        text = str(value)
    if not _SPELLABLE.match(text):
        raise _Refused("schema:number", f"{value!r} spells as {text!r}")
    return text


# --------------------------------------------------------------------------- #
# the source -- DERIVED FROM THE TREE, exactly like the sentence
# --------------------------------------------------------------------------- #

#: The canonical spellings of the two forms whose NAME is not their SOURCE text.
#: ``u-`` is the canonical name of unary minus and ``?:`` of the ternary; both are
#: written differently in a formula. Every other operator's name IS its spelling.
_TERNARY = "?:"
_UNARY_SPELLING: Mapping[str, str] = {"u-": "-"}


def formula_for(ast_obj: Any, table: Optional[Mapping[str, Any]] = None) -> str:
    """The tree, spelled as the text a user edits. The model does not write this
    either.

    ⭐ FULLY PARENTHESISED, ON PURPOSE. ``defSchema`` requires ``compute.source``
    to PARSE BACK TO ``compute.ast``, compared by hash, and precedence is the one
    way an unparse silently changes the maths. Brackets around every composite
    make the round-trip a property of the shape rather than of a precedence table
    that would be a second grammar.
    """
    t = table if table is not None else ast_table.TABLE
    operators = t[ast_table.OPERATORS_SECTION]

    def render(node: Any) -> str:
        kind = node["type"]
        if kind == "num":
            return _spell_number(node["value"])
        if kind == "series":
            return node["name"]
        args = [render(a) for a in node["args"]]
        if kind == "call":
            return f"{node['name']}({', '.join(args)})"
        name = node["name"]
        arity = (operators.get(name) or {}).get("arity")
        if name == _TERNARY:
            return f"({args[0]} ? {args[1]} : {args[2]})"
        if arity == 1:
            return f"({_UNARY_SPELLING.get(name, name)}{args[0]})"
        return f"({args[0]} {name} {args[1]})"

    _assert_within_schema(ast_obj, table)
    return render(ast_obj)


# --------------------------------------------------------------------------- #
# the read-back -- A MIRROR OF `sentence.js`, NOT A SECOND DESIGN
# --------------------------------------------------------------------------- #
#
# ⛔ `app/src/components/chart/engine/ast/sentence.js` IS THE ORIGINAL AND THIS IS
# ITS PYTHON LANE. Both read the SAME manifest for every function's phrasing, and
# `tests/test_definition_concierge.py` renders a corpus THROUGH THE SHIPPED JS
# under node and asserts the two lanes produce byte-identical text -- so a
# divergence is a failing test rather than a discovery six months later. That
# cross-lane rail is also what makes poisoning this renderer lethal: a
# `sentence_for` that returned the model's prose would stop agreeing with
# `sentenceFor` on the first case.
#
# ⚠️ THE OPERATOR PHRASES ARE MIRRORED HERE, AND THAT IS THE SAME TRADE
# `sentence.js` DECLARES IN ITS OWN HEADER: the manifest declares operators by
# NAME and ARITY only, so the English has to live in a module. `ast_interpret`'s
# `REFUSALS` is the same shape and is pinned the same way -- by a cross-lane
# equality, not by a promise.
#
# ⭐⭐ AND THE ENGLISH IS NOT SMOOTHED. `&&`/`||`/`!`/`?:` state ALL THREE of their
# cases with NaN said as "nothing", because the tempting `?:` reading
# "{1} when {0}, otherwise {2}" IS A LIE FOR THE NaN CASE. The read-back describes
# the engine that exists, not the one a reader expects.

SENTENCE_REFUSALS: Mapping[str, str] = {
    "sentence:node": "this read-back has no rule for that node shape",
    "sentence:num": "a read-back cannot spell a number that is not finite",
    "sentence:name": "the read-back cannot name a value the table does not declare",
    "sentence:unsayable-name": "the read-back cannot spell a name that is not a plain word",
    "sentence:function": "the read-back has no rule for a function outside the table",
    "sentence:operator": "the read-back has no phrase for that operator",
    "sentence:arity": "the read-back was handed a call with the wrong argument count",
    "sentence:window": "the read-back cannot spell a window that is not a whole number",
    "sentence:no-template": "the table declares this entry and nobody wrote its read-back",
    "sentence:placeholder": "the read-back template leaves an argument unsaid",
}

OPERATOR_SENTENCE: Mapping[str, str] = {
    "+": "{0} plus {1}",
    "-": "{0} minus {1}",
    "*": "{0} times {1}",
    "/": "{0} divided by {1}",
    ">": "1 when {0} is greater than {1} and 0 otherwise",
    "<": "1 when {0} is less than {1} and 0 otherwise",
    ">=": "1 when {0} is greater than or equal to {1} and 0 otherwise",
    "<=": "1 when {0} is less than or equal to {1} and 0 otherwise",
    "==": "1 when {0} equals {1} and 0 otherwise",
    "!=": "1 when {0} does not equal {1} and 0 otherwise",
    "&&": ("1 when {0} and {1} are both not zero, 0 when either is zero, "
           "and nothing while either is unknown"),
    "||": ("1 when {0} or {1} is not zero, 0 when both are zero, "
           "and nothing while either is unknown"),
    "u-": "the negative of {0}",
    "!": "1 when {0} is zero, 0 when it is not zero, and nothing while it is unknown",
    "?:": ("{1} when {0} is not zero, {2} when it is zero, "
           "and nothing while it is unknown"),
}

_SAYABLE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PLACEHOLDER = re.compile(r"\{(\d+)\}")


class _SentenceRefused(_Refused):
    """A read-back refusal. Its own class so a deletion in one door is not covered
    by a test of another."""

    def __init__(self, guard: str, detail: str) -> None:
        super().__init__(guard, detail)
        self.reason = f"{SENTENCE_REFUSALS[guard]} {detail}".strip()
        self.gate = guard


def _placeholder_gap(phrase: str, arity: int) -> Optional[str]:
    seen = {int(m.group(1)) for m in _PLACEHOLDER.finditer(phrase)}
    missing = [i for i in range(arity) if i not in seen]
    extra = sorted(i for i in seen if i >= arity)
    if not missing and not extra:
        return None
    return (f"says nothing for argument(s) [{', '.join(map(str, missing))}] "
            f"and invents [{', '.join(map(str, extra))}]")


def compile_rules(table: Optional[Mapping[str, Any]] = None,
                  operator_phrases: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """The manifest, compiled into the three lookup tables the walker uses.

    ⛔ EVERY DECLARED ENTRY GETS A ROW, INCLUDING THE BROKEN ONES, so a declared
    entry with no read-back is refused BY NAME rather than falling through to
    "unknown function" -- and the same rows are what ``coverage_gaps`` reports, so
    the rail and the runtime refusal are ONE derivation. Never throws: the module
    has to load for the gap to be reportable.
    """
    t = table if table is not None else ast_table.TABLE
    phrases = operator_phrases if operator_phrases is not None else OPERATOR_SENTENCE
    series: Dict[str, Any] = {}
    operators: Dict[str, Any] = {}
    functions: Dict[str, Any] = {}
    gaps: Dict[str, List[str]] = {"series": [], "operators": [], "functions": [],
                                  "placeholders": []}

    for name in sorted(t[ast_table.SERIES_SECTION]):
        gap = None if _SAYABLE.match(name) else "unsayable"
        if gap:
            gaps["series"].append(name)
        series[name] = {"gap": gap}

    for name in sorted(t[ast_table.OPERATORS_SECTION]):
        spec = t[ast_table.OPERATORS_SECTION][name]
        arity = spec.get("arity") if isinstance(spec.get("arity"), int) else 0
        phrase = phrases.get(name)
        gap = None
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
            gaps["operators"].append(name)
        else:
            bad = _placeholder_gap(phrase, arity)
            if bad:
                gap = bad
                gaps["placeholders"].append(f"{name}: {bad}")
        operators[name] = {"phrase": phrase, "arity": arity, "gap": gap}

    for name in sorted(t[ast_table.FUNCTIONS_SECTION]):
        spec = t[ast_table.FUNCTIONS_SECTION][name]
        args = list(spec.get("args") or ())
        phrase = spec.get("sentence")
        gap = None
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
            gaps["functions"].append(name)
        else:
            bad = _placeholder_gap(phrase, len(args))
            if bad:
                gap = bad
                gaps["placeholders"].append(f"{name}: {bad}")
        functions[name] = {"phrase": phrase, "args": args, "gap": gap}

    return {"series": series, "operators": operators, "functions": functions,
            "gaps": gaps}


def coverage_gaps(table: Optional[Mapping[str, Any]] = None,
                  operator_phrases: Optional[Mapping[str, str]] = None) -> Dict[str, List[str]]:
    """Every manifest entry this lane has no English for, BY NAME -- never a count."""
    return compile_rules(table, operator_phrases)["gaps"]


SENTENCE_RULES = compile_rules()


def _is_leaf(n: Any) -> bool:
    return isinstance(n, dict) and n.get("type") in ("num", "series")


def _spell_sentence_number(value: Any, path: str) -> str:
    if type(value) is bool or not isinstance(value, (int, float)) \
            or not math.isfinite(float(value)):
        raise _SentenceRefused("sentence:num", f"at {path}: got {value!r}")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _spell_window(node: Any, fn_name: str, index: int, path: str,
                  trace: List[Dict[str, str]]) -> str:
    ok = (isinstance(node, dict) and node.get("type") == "num"
          and type(node.get("value")) is not bool
          and isinstance(node.get("value"), (int, float))
          and float(node["value"]).is_integer() and node["value"] >= 1)
    if not ok:
        shown = node.get("value") if isinstance(node, dict) and node.get("type") == "num" else node
        raise _SentenceRefused(
            "sentence:window", f"at {path}: {fn_name} argument {index} -- got {shown!r}")
    trace.append({"path": path, "rule": "window"})
    return str(int(node["value"]))


def _fill(phrase: str, parts: List[str], what: str, path: str) -> str:
    used: set = set()

    def sub(m):
        i = int(m.group(1))
        if i >= len(parts):
            raise _SentenceRefused(
                "sentence:placeholder",
                f"at {path}: the {what} read-back references {{{i}}} and there is "
                "no such argument")
        used.add(i)
        return parts[i]

    text = _PLACEHOLDER.sub(sub, phrase)
    if len(used) != len(parts):
        missing = [i for i in range(len(parts)) if i not in used]
        raise _SentenceRefused(
            "sentence:placeholder",
            f"at {path}: the {what} read-back never says argument(s) "
            f"{', '.join(map(str, missing))}")
    return text


def _refuse_gap(gap: str, kind: str, name: str, path: str) -> Any:
    if gap == "no-template":
        raise _SentenceRefused("sentence:no-template",
                               f"at {path}: the {kind} {json.dumps(name)}")
    raise _SentenceRefused("sentence:placeholder",
                           f"at {path}: the {kind} {json.dumps(name)} {gap}")


def _render_node(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
                 path: str, trace: List[Dict[str, str]]) -> str:
    if not isinstance(node, dict):
        raise _SentenceRefused("sentence:node", f"at {path}: got {node!r}")
    kind = node.get("type")
    if kind == "num":
        trace.append({"path": path, "rule": "num"})
        return _spell_sentence_number(node.get("value"), path)
    if kind == "series":
        return _render_name(node, rules, inputs, path, trace)
    if kind == "op":
        return _render_op(node, rules, inputs, path, trace)
    if kind == "call":
        return _render_call(node, rules, inputs, path, trace)
    raise _SentenceRefused(
        "sentence:node",
        f"at {path}: node type {json.dumps(kind) if isinstance(kind, str) else kind!r} "
        f"-- the canonical types are {', '.join(NODE_TYPES)}")


def _render_arg(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
                path: str, trace: List[Dict[str, str]]) -> str:
    inner = _render_node(node, rules, inputs, path, trace)
    return inner if _is_leaf(node) else f"({inner})"


def _render_name(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
                 path: str, trace: List[Dict[str, str]]) -> str:
    name = node.get("name")
    if not isinstance(name, str):
        raise _SentenceRefused(
            "sentence:node", f"at {path}: a series node carries a name; got {name!r}")
    if name in rules["series"]:
        if rules["series"][name]["gap"]:
            raise _SentenceRefused("sentence:unsayable-name",
                                   f"at {path}: the series {json.dumps(name)}")
        trace.append({"path": path, "rule": "series:table"})
        return name
    if name in inputs:
        if not _SAYABLE.match(name):
            raise _SentenceRefused("sentence:unsayable-name",
                                   f"at {path}: the input {json.dumps(name)}")
        trace.append({"path": path, "rule": "series:input"})
        return f"the input {name}"
    raise _SentenceRefused(
        "sentence:name",
        f"at {path}: {json.dumps(name)} -- this table declares "
        f"{', '.join(sorted(rules['series']))} and this definition declares "
        f"{', '.join(sorted(inputs)) or 'no inputs'}")


def _render_op(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
               path: str, trace: List[Dict[str, str]]) -> str:
    name = node.get("name")
    if not isinstance(name, str) or name not in rules["operators"]:
        raise _SentenceRefused(
            "sentence:operator",
            f"at {path}: {json.dumps(name) if isinstance(name, str) else name!r} -- "
            f"this table declares {', '.join(sorted(rules['operators']))}")
    rule = rules["operators"][name]
    if rule["gap"]:
        _refuse_gap(rule["gap"], "operator", name, path)
    if not isinstance(node.get("args"), list):
        raise _SentenceRefused(
            "sentence:node",
            f"at {path}: an op node carries an args array; got {node.get('args')!r}")
    if len(node["args"]) != rule["arity"]:
        raise _SentenceRefused(
            "sentence:arity",
            f"at {path}: {name} takes {rule['arity']}, got {len(node['args'])}")
    trace.append({"path": path, "rule": f"op:{name}"})
    parts = [_render_arg(a, rules, inputs, f"{path}.args[{i}]", trace)
             for i, a in enumerate(node["args"])]
    return _fill(rule["phrase"], parts, f"operator {name}", path)


def _render_call(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
                 path: str, trace: List[Dict[str, str]]) -> str:
    name = node.get("name")
    if not isinstance(name, str) or name not in rules["functions"]:
        raise _SentenceRefused(
            "sentence:function",
            f"at {path}: {json.dumps(name) if isinstance(name, str) else name!r} -- "
            f"this table declares {', '.join(sorted(rules['functions']))}")
    rule = rules["functions"][name]
    if rule["gap"]:
        _refuse_gap(rule["gap"], "function", name, path)
    if not isinstance(node.get("args"), list):
        raise _SentenceRefused(
            "sentence:node",
            f"at {path}: a call node carries an args array; got {node.get('args')!r}")
    if len(node["args"]) != len(rule["args"]):
        raise _SentenceRefused(
            "sentence:arity",
            f"at {path}: {name} takes {len(rule['args'])}, got {len(node['args'])}")
    trace.append({"path": path, "rule": f"fn:{name}"})
    parts: List[str] = []
    for i, kind in enumerate(rule["args"]):
        child = f"{path}.args[{i}]"
        parts.append(_spell_window(node["args"][i], name, i, child, trace)
                     if kind == "int"
                     else _render_arg(node["args"][i], rules, inputs, child, trace))
    return _fill(rule["phrase"], parts, f"function {name}", path)


def explain_sentence(ast_obj: Any, inputs: Optional[Mapping[str, Any]] = None,
                     rules: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The sentence AND the identity of every rule that produced a piece of it."""
    trace: List[Dict[str, str]] = []
    text = _render_node(ast_obj, rules if rules is not None else SENTENCE_RULES,
                        inputs or {}, "$", trace)
    return {"text": text, "trace": trace}


def sentence_for(ast_obj: Any, inputs: Optional[Mapping[str, Any]] = None) -> str:
    """An AST -> one English sentence, deterministically. THE ONLY PRODUCER.

    ⛔ NO CLOCK, NO LOCALE, NO NETWORK, NO MODEL RESPONSE. This is a pure function
    of the tree and the manifest, and the only reason ``propose`` can promise the
    user that the read-back describes the maths that will run.
    """
    return explain_sentence(ast_obj, inputs)["text"]


# --------------------------------------------------------------------------- #
# the model call
# --------------------------------------------------------------------------- #

def _extract_first_json_object(text: str) -> Optional[str]:
    """The first balanced ``{...}``, respecting quoted strings and escapes.

    ⚠️ THE SHIPPED SCANNER, NOT A FRESH ONE. ``catalyst.synthesize`` hardened this
    against fences and trailing prose and that is the normal case; a second
    scanner would be a second set of edge cases.
    """
    from api.services.catalyst.synthesize import _extract_first_json_object as scan
    return scan(text)


def _tool_input(msg: Any) -> Optional[dict]:
    """The tool call the model made, or None.

    A model that answers in prose instead of calling the tool is a refusal, not a
    parse problem -- but if it wrapped the object in text anyway, the shipped
    balanced-brace scanner recovers it rather than throwing away a good answer.
    """
    for block in getattr(msg, "content", None) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == TOOL_NAME:
            value = getattr(block, "input", None)
            if isinstance(value, dict):
                return value
    parts = []
    for block in getattr(msg, "content", None) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    blob = _extract_first_json_object("".join(parts))
    if blob is None:
        return None
    try:
        parsed = json.loads(blob)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _call_model(messages: List[dict]) -> Tuple[Any, int, int]:
    """ONE Anthropic call. Returns ``(message, input_tokens, output_tokens)``.

    ⚠️ THE TEMPERATURE RETRY IS THE SHIPPED IDIOM: newer models reject
    ``temperature`` as deprecated, and on that specific error the parameter is
    popped and the call retried once so any model id stays usable.
    """
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client()
    kwargs = dict(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0,
        system=SYSTEM_PROMPT + vocabulary_text(),
        tools=[anthropic_tool()],
        tool_choice={"type": "tool", "name": TOOL_NAME},
        messages=messages,
    )
    try:
        msg = client.messages.create(**kwargs)
    except Exception as exc:                       # noqa: BLE001 -- rethrown below
        if "temperature" in str(exc).lower():
            kwargs.pop("temperature", None)
            msg = client.messages.create(**kwargs)
        else:
            raise
    usage = getattr(msg, "usage", None)
    return msg, int(getattr(usage, "input_tokens", 0) or 0), \
        int(getattr(usage, "output_tokens", 0) or 0)


# --------------------------------------------------------------------------- #
# the pipeline
# --------------------------------------------------------------------------- #

def _validate(tree: Any, bars: List[dict]) -> Tuple[Any, str]:
    """schema -> canonical shape -> budget -> lint -> compute.

    ⛔ THE ORDER IS LOAD-BEARING AND IT IS THE ATTRIBUTION. A tree that offends
    two stages must report the EARLIER one on every run, or a refusal measures
    traversal order instead of the guard. ``check_budget`` before ``lint_repaint``
    is what makes deleting the budget call observable: without it, an over-budget
    tree with an unreadable window comes back as a REPAINT refusal, which is a
    correct answer produced by the wrong mechanism.

    Every stage is the SAME function a typed formula reaches. There is no
    machine-written lane.
    """
    _assert_within_schema(tree)
    try:
        user_definitions.assert_canonical(tree)
    except ValueError as exc:
        raise _Refused("schema:node", str(exc)) from exc

    try:
        check_budget(tree, None)
    except BudgetExceeded as exc:
        raise _Refused(exc.guard, str(exc)) from exc
    except TableRefusal as exc:
        raise _Refused(exc.guard, str(exc)) from exc

    verdict = ast_lint.lint_repaint(tree)
    if verdict["mode"] != "non-repainting":
        raise _Refused(
            "lint:repaint",
            f"the linter measures it as {verdict['mode']}: "
            f"{'; '.join(verdict['reasons'])}")

    try:
        column = interpret(tree, list(bars or []))
    except TableRefusal as exc:
        raise _Refused(exc.guard, str(exc)) from exc
    except ValueError as exc:
        # `interpret` raises a plain ValueError when a declared INPUT shadows a
        # table name. Its own door, not the table's -- reported under its own
        # gate rather than folded into a resolution refusal.
        raise _Refused("compute:wiring", str(exc)) from exc
    if bars and not any(v is not None for v in column):
        raise _Refused(
            "compute:empty",
            f"nothing computable across {len(bars)} bars -- it may need more "
            "history than the chart is holding")
    return tree, verdict["mode"]


def _repair_turns(messages: List[dict], msg: Any, tool_input: Optional[dict],
                  refused: _Refused) -> List[dict]:
    """The ONE repair turn. The model sees the verdict the user would have seen.

    A real tool-result turn, not a fresh prompt: the failed tree stays in the
    transcript so the model is repairing its own answer rather than guessing again
    from the English.
    """
    tool_use_id = None
    for block in getattr(msg, "content", None) or []:
        if getattr(block, "type", None) == "tool_use":
            tool_use_id = getattr(block, "id", None)
            break
    out = list(messages)
    if tool_use_id:
        out.append({"role": "assistant", "content": [
            {"type": "tool_use", "id": tool_use_id, "name": TOOL_NAME,
             "input": tool_input or {}},
        ]})
        out.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": tool_use_id, "is_error": True,
             "content": f"[{refused.gate}] {refused.reason}. Emit a corrected tree."},
        ]})
    else:
        out.append({"role": "user", "content": (
            f"That answer was refused by {refused.gate}: {refused.reason}. "
            "Emit a corrected tree.")})
    return out


def propose(prompt: str, *, user_id: Any, bars: Optional[List[dict]] = None) -> Dict[str, Any]:
    """English in, a canonical tree out -- or a refusal that names its door.

    ``{ok: True, ast, source, sentence, repaint, tokens, cost_usd, attempts, model}``
    or ``{ok: False, reason, gate}``. NEVER raises, and a refusal carries NO
    ``ast``: a formula beside a refusal is a formula somebody uses.
    """
    if not isinstance(prompt, str) or not prompt.strip():
        return {"ok": False, "gate": "prompt:empty",
                "reason": REFUSALS["prompt:empty"]}

    market_date = _market_date()
    bars = list(bars or [])
    messages: List[dict] = [{"role": "user", "content": prompt.strip()}]
    tokens = {"input": 0, "output": 0}
    cost_usd = 0.0
    attempts = 0
    last: Optional[_Refused] = None

    while attempts < MAX_MODEL_CALLS:
        # ⭐ THE CAP IS CONSULTED BEFORE THE SPEND, EVERY TIME ROUND. A cap checked
        # after the call is not a cap, and a loop that checks only on the first
        # pass is not a cap on the second.
        if not cost_guard.may_synthesize(market_date):
            return {"ok": False, "gate": "cost:global",
                    "reason": REFUSALS["cost:global"]}
        if spend_for(user_id, market_date) >= _user_cap_usd():
            return {"ok": False, "gate": "cost:user",
                    "reason": REFUSALS["cost:user"]}

        attempts += 1
        try:
            msg, in_tokens, out_tokens = _call_model(messages)
        except Exception as exc:                   # noqa: BLE001 -- never raises out
            logger.warning("[concierge] model call failed: %s", exc)
            return {"ok": False, "gate": "model:transport",
                    "reason": REFUSALS["model:transport"]}

        tokens["input"] += in_tokens
        tokens["output"] += out_tokens
        spent = cost_guard.record(market_date, f"concierge:{user_id}", MODEL,
                                  in_tokens, out_tokens)
        _record_spend(user_id, market_date, spent)
        cost_usd += spent

        tool_input = _tool_input(msg)
        tree = (tool_input or {}).get("ast")
        try:
            if tool_input is None or tree is None:
                raise _Refused("model:no-tool", "no formula tree in the answer")
            ast_obj, repaint = _validate(tree, bars)
        except _Refused as refused:
            last = refused
            if attempts < MAX_MODEL_CALLS:
                messages = _repair_turns(messages, msg, tool_input, refused)
                continue
            break

        # ⛔ THE READ-BACK COMES FROM THE TREE AND FROM NOWHERE ELSE. This is the
        # one assignment to `sentence` in this function and the test walks this
        # module's AST to prove it.
        try:
            sentence = sentence_for(ast_obj)
        except _SentenceRefused as refused:
            return {"ok": False, "gate": refused.gate, "reason": refused.reason}

        source = formula_for(ast_obj)
        return {
            "ok": True,
            "ast": ast_obj,
            "source": source,
            "sentence": sentence,
            "repaint": repaint,
            "tokens": tokens,
            "cost_usd": round(cost_usd, 6),
            "attempts": attempts,
            "model": MODEL,
        }

    reason = last.reason if last else REFUSALS["model:no-tool"]
    gate = last.gate if last else "model:no-tool"
    return {"ok": False, "gate": gate, "reason": reason}
