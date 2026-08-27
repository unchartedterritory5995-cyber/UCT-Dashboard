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

from api.services import (ast_freshness, ast_lint, ast_table, concept_vocabulary,
                          scan_definition, user_definitions)
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
MODEL: str = os.environ.get("CONCIERGE_MODEL", "claude-opus-5")

#: A ceiling on THINKING PLUS the tool call. Opus 5 thinks by default when
#: ``thinking`` is omitted and ``max_tokens`` caps both, so 1200 — sized for the
#: tool call ALONE — would truncate a thought mid-tree into a repair call and a
#: refusal. The call itself stays small (the largest starter tree the firm ships
#: serialises to under 500 bytes), so nearly all of this is thinking headroom.
#: ⛔ A TRUNCATION GUARD, NOT A COST LEVER: tokens are billed as GENERATED, and
#: the spend is bounded by ``cost_guard`` and by the per-user cap below.
MAX_TOKENS: int = 8192

#: ⭐ ONE GENERATE, ONE REPAIR. Not "retry until clean" -- see the header.
MAX_MODEL_CALLS: int = 2

#: ⛔ HTTP ATTEMPTS PER MODEL CALL, AND THE REASON IS THE LEDGER, NOT LATENCY.
#: A call that TIMES OUT has already generated (and been billed for) tokens, but
#: returns no ``usage``, so ``cost_guard.record`` below never sees them. The SDK
#: default of 2 retries makes that up to THREE billed attempts the ledger counts
#: as zero -- and, because the 60 s timeout is PER ATTEMPT, up to 180 s of wall
#: clock. At 1200 tokens a timeout was barely reachable; at 8192 with default
#: adaptive thinking it is not. 0 retries = exactly one attempt off the ledger.
#:
#: ⛔ THE TIMEOUT IS NOT THE LEVER HERE. ``desk_session_insights`` buys headroom
#: with ``with_options(timeout=300)``, but that runs on a SCHEDULER thread. This
#: is the REQUEST PATH, where an unbounded external call pins one of the single
#: web pod's 64 shared anyio workers -- the 2026-07-01 outage class, and the
#: reason `tests/test_llm_timeout_census.py` exists. The shared client's 60 s
#: stays; only the attempt COUNT moves.
#:
#: The trade: a transient 429/503 is no longer retried for free. It also is not
#: BILLED (nothing generated), and a member's own retry is ledgered and
#: cap-checked -- which an SDK retry is not.
MAX_HTTP_RETRIES: int = 0

#: The per-user daily cap, ON TOP OF ``cost_guard``'s global one. The global cap
#: protects the bill; this one protects one account from spending everyone
#: else's.
#:
#: ⚠️ RE-DERIVE THIS WHENEVER THE MODEL OR THE CEILING MOVES — W0.4 moved BOTH
#: and the cap was inherited, not rechecked. Measured 2026-08-26 against the real
#: ``estimate_cost`` and the real prompt (SYSTEM_PROMPT + ``vocabulary_text()`` +
#: the tool JSON = 17,724 chars ≈ 4.4k input tokens):
#:
#:   before  claude-sonnet-5 @ 1200  ->  $0.0313/call, $0.063 worst case (2 calls)
#:   after   claude-opus-5   @ 8192  ->  $0.2270/call, $0.454 worst case (2 calls)
#:
#: Price is 1.67× on BOTH legs and the ceiling is 6.83×, so a worst-case proposal
#: is 7.25× dearer: it now costs 60% of one member's daily allowance, and $0.75
#: admits ~1.7 of them where it admitted ~12. The VALUE below is the owner's call
#: and is unchanged here; this note exists so the next reader sees the arithmetic
#: rather than inheriting it a second time.
#:
#: ⛔ AND IT IS A FLOOR TEST, NOT A RESERVATION. The loop head asks whether spend
#: ALREADY EXCEEDS the cap, so a member at $0.74 may still start a proposal that
#: lands them at $1.19 — 159% of the cap. That overshoot was $0.80 before this
#: change. Nothing here reserves the cost of the call it is about to authorise.
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
    "kind:unknown": (
        "the assistant was asked for a kind of formula it does not draft"),
    "scan:not-a-condition": (
        "a screen needs a yes-or-no condition and this expression produces a number"),
}

#: ⭐ THE TWO THINGS ONE PIPELINE CAN DRAFT, DECLARED ONCE. An indicator is a
#: column; a scan is ``<ast> != 0`` on the last confirmed bar (E-A1), so the only
#: difference between them is ONE stage inside ``_validate``. The router reads
#: this tuple rather than re-typing the two words, because a second list of kinds
#: is a second thing to keep in step -- and an unrecognised kind REFUSES rather
#: than defaulting, since a scan request quietly validated as an indicator is a
#: scan whose condition check never ran.
KINDS: Tuple[str, ...] = ("indicator", "scan")
INDICATOR_KIND, SCAN_KIND = KINDS


class _Refused(Exception):
    """One stage saying no, carrying the door that decided.

    Internal: ``propose`` converts it into the ``{ok: False, reason, gate}``
    answer. Nothing outside this module sees an exception, because a raising
    concierge is a blank screen on a surface whose failure state is a sentence.
    """

    def __init__(self, gate: str, detail: str = "") -> None:
        #: ⚠️ `phrase`, NEVER `sentence`. In this module the word `sentence`
        #: means the READ-BACK and a rail asserts that every assignment to it is
        #: `sentence_for(ast_obj)` — in every function, because the cheapest way
        #: to add a second read-back is a second local that happens to share the
        #: name. A refusal's English is a phrase, not a read-back.
        phrase = REFUSALS.get(gate)
        message = phrase if phrase else detail
        if phrase and detail:
            message = f"{phrase} -- {detail}"
        super().__init__(message)
        self.gate = gate
        self.reason = message


# --------------------------------------------------------------------------- #
# the tool schema -- GENERATED FROM THE MANIFEST, BOTH DIRECTIONS
# --------------------------------------------------------------------------- #

TOOL_NAME = "emit_formula"

#: The canonical node types. Read from the store's own declaration rather
#: than re-typed: a third spelling of the node vocabulary is a third thing to
#: keep in step. ⚰️ This said "The four" while the tuple it reads had held five
#: since 291c9d8a's `offset` — a hand-typed count beside the derivation that
#: owns it, and the very module that kept refusing the fifth type it declared.
NODE_TYPES: Tuple[str, ...] = tuple(user_definitions.NODE_TYPES)


#: ⭐ WHICH NODE TYPE A SECTION'S NAMES RIDE -- the ONLY thing this module has to
#: know about a section, and the only reason two of them are named at all.
#:
#: Exactly two sections declare CALLABLE entries, and a callable node is the one
#: shape that carries an ``args`` array; every other name-bearing section is a
#: LEAF and is spelled with the ``series`` node. That is the MANIFEST'S OWN
#: ruling rather than a convention invented here -- ``_scalars_node`` says *"A
#: SCALAR RIDES THE `series` NODE TYPE AND THE CANONICAL VOCABULARY STAYS FOUR"*
#: -- so a FIFTH section arrives as a leaf vocabulary with no edit in this file,
#: and a name in it that the table cannot resolve is refused by ``resolve:*`` at
#: the door that owns resolution.
#:
#: ⛔ THE KEYS ARE ``ast_table``'s STRUCTURE CONSTANTS, NOT TYPED WORDS. Section
#: names are structure; the ENTRY names inside them are vocabulary, and this
#: module never spells one (asserted by an AST scan over this file).
_CALLABLE_SECTIONS: Mapping[str, str] = {
    ast_table.OPERATORS_SECTION: "op",
    ast_table.FUNCTIONS_SECTION: "call",
}

#: The node type every other declared name rides. See ``_CALLABLE_SECTIONS``.
_LEAF_NODE = "series"


def _name_sections(table: Mapping[str, Any]) -> Dict[str, Mapping[str, Any]]:
    """Every section whose entries are NAMES a tree may reference, OFF THE
    MANIFEST.

    ⛔ THE UNDERSCORE PREFIX IS THE MANIFEST'S OWN CONVENTION for a note (``_``,
    ``_shape``, ``_canonical``, ``_scalars_excluded``, ...) and ``tableVersion``
    is a scalar value rather than a mapping. Everything else that maps names to
    specs is a vocabulary section, and treating it as one is what makes a fourth
    section -- and a fifth -- arrive as DATA.

    ⚠️ ITERATING FOUR SECTIONS BY NAME WOULD PASS EVERY EXISTING RAIL. The
    anti-copy scan forbids the NAMES; a hand-list of SECTIONS is the same defect
    one level up, and the test plants a fifth section in a synthetic manifest and
    requires its entries back.
    """
    return {k: v for k, v in table.items()
            if not k.startswith("_") and isinstance(v, Mapping)}


def _names_by_node_type(sections: Mapping[str, Mapping[str, Any]]) -> Dict[str, List[str]]:
    """``{node type -> sorted names}``, derived from the sections above."""
    out: Dict[str, set] = {t: set() for t in (_LEAF_NODE, *_CALLABLE_SECTIONS.values())}
    for section, entries in sections.items():
        out[_CALLABLE_SECTIONS.get(section, _LEAF_NODE)] |= set(entries)
    return {node_type: sorted(names) for node_type, names in out.items()}


def tool_schema(table: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """The callable vocabulary, DERIVED from the closed table.

    ⛔ DERIVED, BOTH DIRECTIONS, AND NEVER HAND-LISTED. A hand-written schema is a
    third copy of the table and it would drift the first time a function was
    added -- silently, because every existing test would stay green. The test
    plants an entry in a synthetic manifest and requires it BACK BY NAME with no
    edit to the rail, and an AST walk over this module's own source asserts that
    no declared function or series name appears here as a string constant.

    ⭐ AND THE SECTION LIST IS READ OFF THE MANIFEST TOO (``_name_sections``), so
    the fourth section -- the 54 per-symbol ``scalars`` -- reaches the model's
    vocabulary AND the API boundary's enums with no line of this module moving.
    Until that landed, ``propose`` refused every scalar-naming proposal at
    ``schema:name`` a door before the read-back could even be asked.

    ``arity`` is carried per function so the model is told the shape, but this
    module does not ENFORCE arity at the boundary: a JSON Schema enum can express
    "which names exist" and cannot express "how many arguments each takes", so
    arity stays the table's question and is refused by ``resolve:arity`` at the
    door that owns it. Claiming it here would move a refusal off the guard that
    is supposed to catch it -- this branch's most expensive defect.
    """
    t = table if table is not None else ast_table.TABLE
    sections = _name_sections(t)
    names = _names_by_node_type(sections)
    functions = {
        name: {
            "arity": len(spec.get("args") or ()),
            "args": list(spec.get("args") or ()),
            "sentence": spec.get("sentence"),
        }
        for name, spec in (sections.get(ast_table.FUNCTIONS_SECTION) or {}).items()
    }
    operators = {
        name: {"arity": spec.get("arity")}
        for name, spec in (sections.get(ast_table.OPERATORS_SECTION) or {}).items()
    }
    return {
        "name": TOOL_NAME,
        "sections": {k: dict(v) for k, v in sections.items()},
        "names": names,
        "functions": functions,
        "operators": operators,
        "nodeTypes": list(NODE_TYPES),
        "input_schema": _input_schema(names, functions, operators),
    }


def _input_schema(names: Mapping[str, List[str]], functions: Mapping[str, Any],
                  operators: Mapping[str, Any]) -> Dict[str, Any]:
    """The JSON Schema the API boundary enforces. One enum per node type, and
    each is the union of the manifest's own key sets for that shape.

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
                    "name": {"enum": list(names[_LEAF_NODE])},
                },
            },
            "op": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "name", "args"],
                "properties": {
                    "type": {"const": "op"},
                    "name": {"enum": list(names["op"])},
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
                    "name": {"enum": list(names["call"])},
                    "args": {"type": "array", "items": node,
                             "minItems": min(fn_arities or [1]),
                             "maxItems": max(fn_arities or [3])},
                },
            },
            # ⭐ THE FIFTH SHAPE CARRIES NO NAME — the bar count IS the node
            # (`parse.js::readOffset`'s ruling), so there is no enum to derive:
            # `EXPR[N]` has no slot for an expression, which is what keeps "the
            # offset is a literal" true by construction in the schema exactly
            # as it is in the store. ⚰️ Until this entry landed, `oneOf` above
            # emitted a DANGLING `#/$defs/offset` ref — the roster said five
            # while the definitions said four.
            #
            # ⚠️ `minimum` IS 1, NOT THE STORE'S 0, AND THAT IS THE `num` RULING
            # APPLIED AGAIN: the ONE parser FOLDS `x[0]` to `x` (one column,
            # one `astHash`), so a zero-bar offset is a tree no `source` can
            # parse back to and the round-trip would refuse the definition at
            # registration. Refusing it here, one door earlier, is the same
            # refusal with a repair turn attached. The READ-BACK still renders
            # a stored zero as the bar itself — `renderOffset`'s own leniency,
            # mirrored — because the walker's job is whatever the store holds.
            "offset": {
                "type": "object", "additionalProperties": False,
                "required": ["type", "value", "args"],
                "properties": {
                    "type": {"const": "offset"},
                    "value": {"type": "integer", "minimum": 1},
                    "args": {"type": "array", "items": node,
                             "minItems": 1, "maxItems": 1},
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


#: A line of prose per section, so the English half reads like a vocabulary
#: rather than a dump. ⚠️ THE BLURBS ARE PROSE AND THE NAMES ARE DATA: a section
#: with no blurb still gets its header and every one of its entries, which is why
#: a planted fifth section reaches the prompt as well as the schema.
_SECTION_BLURB: Mapping[str, str] = {
    ast_table.SERIES_SECTION: " (each reads one field of the bar)",
    ast_table.SCALARS_SECTION: (" (ONE number per symbol, from the nightly "
                                "screener snapshot -- the same value at every bar)"),
    ast_table.OPERATORS_SECTION: " (by name and arity, spelled exactly as written here)",
}


def _entry_line(name: str, spec: Mapping[str, Any]) -> str:
    """One vocabulary line, from whatever the manifest declares about the entry.

    ⛔ SHAPE FIRST, THEN THE ENGLISH, AND BOTH ARE THE MANIFEST'S. A callable
    entry declares ``args`` or an ``arity``; every entry may declare a
    ``sentence`` or a ``doc``. Nothing here knows what a particular section
    means, which is what lets a new one be described without an edit.
    """
    args = list(spec.get("args") or ())
    arity = spec.get("arity")
    if args:
        head = f"{name}({', '.join(str(a) for a in args)})"
    elif isinstance(arity, int) and not isinstance(arity, bool):
        head = f"{name} takes {arity}"
    else:
        head = name
    gloss = spec.get("sentence") or spec.get("doc")
    return f"  {head} -- {gloss}" if isinstance(gloss, str) and gloss else f"  {head}"


def vocabulary_text(table: Optional[Mapping[str, Any]] = None) -> str:
    """The vocabulary, spelled for the prompt, GENERATED from the same schema.

    The model is told the table twice -- once as a schema it cannot violate and
    once as English it can read -- and both readings come from one derivation, so
    a function added to the manifest reaches the prompt without this file moving.

    ⛔ AND THE TWO HALVES WALK THE SAME SECTION LIST. A schema that enforced a
    vocabulary the prompt never mentioned would produce a model that guesses and
    a boundary that refuses -- technically correct, uselessly. The planted-scalar
    rail asserts the plant reaches BOTH.
    """
    schema = tool_schema(table)
    lines: List[str] = []
    for section in sorted(schema["sections"]):
        entries = schema["sections"][section]
        lines.append(f"{section}{_SECTION_BLURB.get(section, '')}:")
        for name in sorted(entries):
            lines.append(_entry_line(name, entries[name]))
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You turn a trader's plain-English description into ONE canonical formula "
    "tree, and you emit nothing else.\n\n"
    "A tree is built from these node shapes and no others:\n"
    '  {"type":"num","value":<non-negative number>}\n'
    '  {"type":"series","name":<a series or scalar below>}\n'
    '  {"type":"op","name":<an operator below>,"args":[...]}\n'
    '  {"type":"call","name":<a function below>,"args":[...]}\n'
    '  {"type":"offset","value":<whole bars back, 1 or more>,"args":[<one node>]}\n\n'
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

#: What the tree has to BE, per kind. ⚠️ THIS IS A HINT AND NOT THE GATE. The
#: gate is ``scan_definition.is_boolean_tree`` inside ``_validate``; telling the
#: model up front only saves a repair round. A prompt that ASKS is a request; the
#: stage that refuses is the constraint.
_KIND_BRIEF: Mapping[str, str] = {
    INDICATOR_KIND: (
        "\nThis one is an INDICATOR: a column of numbers drawn on a chart.\n"),
    SCAN_KIND: (
        "\nThis one is a SCREEN: the tree must be a yes-or-no CONDITION, because "
        "a screen keeps the symbols where it is not zero. An expression that "
        "produces a price or an average is an indicator, not a screen -- compare "
        "it to something.\n"),
}

#: The header above the words the FIRM has already defined. ⛔ THE MODEL NEVER
#: SEES A CONCEPT IT MAY REINTERPRET: resolution happened against the vocabulary
#: file before this text was built, so what arrives is the expansion, not the
#: word to be guessed at.
CONCEPT_HEADER = (
    "\nTHE FIRM'S OWN WORDS, ALREADY RESOLVED. The member used the words below "
    "and the system has expanded each one against the firm's reviewed "
    "vocabulary. Use the formula given, exactly as given; do not reinterpret the "
    "word and do not substitute your own thresholds.\n")


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
    names = {node_type: set(spelled)
             for node_type, spelled in tool_schema(table)["names"].items()}
    stack: List[Any] = [tree]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict) or node.get("type") not in NODE_TYPES:
            raise _Refused("schema:node", f"got {node!r}")
        kind = node["type"]
        if kind == "num":
            _spell_number(node.get("value"))
            continue
        if kind == "offset":
            # ⭐ NO NAME TO CHECK — the bar count IS the node. What the schema
            # declares is exactly this: a whole number of bars, ONE OR MORE,
            # over one child. `type(...) is bool` first, as everywhere: a
            # boolean sails through every obvious numeric guard. Zero is
            # refused for the `num`-negative reason — the parser FOLDS `x[0]`
            # to `x`, so a zero-bar node is a tree no source parses back to.
            value = node.get("value")
            if (type(value) is bool
                    or not (isinstance(value, int)
                            or (isinstance(value, float) and math.isfinite(value)
                                and value.is_integer()))
                    or value < 1):
                raise _Refused(
                    "schema:number",
                    f"{value!r} -- a bar offset is a plain whole number of "
                    "bars backwards, at least one, written on the node itself; "
                    "a zero-bar offset is spelled as the bar itself")
            args = node.get("args")
            if not isinstance(args, list) or len(args) != 1:
                raise _Refused(
                    "schema:node",
                    f"an offset node carries exactly one child; got {args!r}")
            stack.extend(args)
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
        if kind == "offset":
            # ⭐ THE ONE POSTFIX FORM — `close[1]`, `(close - low)[1]`,
            # `sma(close, 20)[2]`. A composite child is already bracketed by
            # its own branch, so appending `[n]` round-trips by shape; the
            # count is an int by the boundary gate above, spelled the way
            # `String(n)` spells it.
            return f"{render(node['args'][0])}[{int(node['value'])}]"
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
#
# ⭐⭐ …EXCEPT WHERE THE `!= 0` SAYS NOTHING, WHICH IS `sentence.js`'s SECOND
# PHRASE AND IS MIRRORED HERE FOR THE SAME REASON THE FIRST ONE IS. `close &&
# volume` really does coerce two prices, and a member reading "close and volume"
# would be reading a semantics this engine does not have. But a condition is a 0/1
# column only because the table has no boolean type — an implementation detail of
# the REPRESENTATION — so when EVERY operand already yields `bool` the coercion is
# vacuous and the scaffolding explains the representation to somebody who asked
# about the maths. `OPERATOR_SENTENCE_CONDITIONS` is that second phrase.
#
# ⛔ AND THE QUESTION "IS THIS OPERAND ALREADY A CONDITION" IS NOT ANSWERED HERE.
# `scan_definition.is_boolean_tree` has resolved the manifest's `yields` over a
# tree since E-2 and is the lane's ONE answer; a resolver written here would be a
# THIRD implementation of one value — this repo's most repeated defect, and the
# very thing `sentence.js::yieldsOf` already came close to being. The two that
# remain are cross-checked case for case in `tests/test_definition_concierge.py`.

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

#: operator name -> its English WHEN EVERY OPERAND IS ALREADY A CONDITION.
#:
#: ⭐ A JOIN, NOT A SECOND VOCABULARY: every word an operand contributes is still
#: the manifest's own phrasing and this table adds the one word that joins them.
#:
#: ⛔ AND IT IS PINNED TO `sentence.js::OPERATOR_SENTENCE_CONDITIONS` BY EQUALITY,
#: exactly as `OPERATOR_SENTENCE` and `SENTENCE_REFUSALS` are — a lane that
#: smoothed a form the other lane still scaffolds tells one member two stories.
#:
#: ⚠️ `sentence.js` ALSO CARRIES `CONDITIONS_FORM_DECLINED` — `!` and `?:` with
#: the reason nobody wrote them a join — AND IT IS DELIBERATELY NOT MIRRORED. It
#: changes no behaviour: it exists so `sentence.test.js` can assert the two tables
#: PARTITION the operators whose base phrase talks about zero. Copying prose that
#: nothing here reads would be a second copy to keep in step for no gain, and the
#: table that DOES decide what this lane says is pinned across the two lanes.
OPERATOR_SENTENCE_CONDITIONS: Mapping[str, str] = {
    "&&": "{0} and {1}",
    "||": "{0} or {1}",
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


#: ⚠️ NOT A SECTION, AND MARKED AS ONE ISN'T. The compiled rules carry the
#: manifest they were compiled from so `_render_op` can hand it to
#: ``scan_definition.is_boolean_tree`` — a rule set built from a PLANTED table
#: must be classified against that table, or a test's manifest would be read back
#: with the shipped one's `yields`. The ``_`` prefix is the manifest's own
#: annotation convention, and every consumer that walks sections already skips it.
_TABLE_KEY = "_table"


def compile_rules(table: Optional[Mapping[str, Any]] = None,
                  operator_phrases: Optional[Mapping[str, str]] = None,
                  condition_phrases: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """The manifest, compiled into the FOUR lookup tables the walker uses.

    ⛔ EVERY DECLARED ENTRY GETS A ROW, INCLUDING THE BROKEN ONES, so a declared
    entry with no read-back is refused BY NAME (``sentence:no-template``) rather
    than falling through to "unknown function", which would read like the table
    never declared it. Never throws: the module has to load for a bad manifest to
    be diagnosable at all.

    ⛔⛔ AND IT REPORTS NO ``gaps`` LIST, DELIBERATELY -- THERE IS NO SECOND
    COVERAGE AUTHORITY IN THIS LANE. There WAS one: a ``coverage_gaps`` here,
    hand-maintained and fully DECLARATIVE, answering the same question
    ``sentence.js::coverageGaps`` answers -- and with no scalars row at all, so
    the two lanes answered one question differently in KIND as well as in
    content, and nothing was red. Nothing server-side ever consumed it: an AST
    walk over every ``.py`` in the repo (never a grep) found ONE definition and
    THREE call sites, all three in its own test file. A second authority over one
    value is this repo's most repeated defect, so the copy is DELETED rather than
    reimplemented, and the two claims it used to make now live where they can
    actually fail, in ``tests/test_definition_concierge.py``:

      * *"this lane has English for every declared entry"* is measured by PROBING
        THIS WALKER -- one minimal tree per declared entry, in every section the
        MANIFEST declares, and the ones that REFUSE are named. The gap is the
        runtime refusal itself, so it cannot be blind to a section the walker has
        no branch for. That blindness is not hypothetical: the declarative rail
        was permanently green over all fifty-four scalars, which were exactly the
        names this lane could not say until the fourth section landed above.
      * *"the two lanes agree about what is unsayable"* is a CROSS-LANE rail in
        the same file -- ``coverageGaps()`` run under node, against that probe,
        section for section and name for name, with the one known divergence
        PINNED and derived so it goes red the day it closes.

    ⛔ DO NOT ADD A ``coverage_gaps`` BACK HERE. A rail asserts its absence across
    every module under ``api/``, and the name it looks for is read off
    ``sentence.js``'s own export list rather than typed.

    ⚠️ THE PER-ENTRY ``gap`` FIELD BELOW IS NOT BOOKKEEPING AND STAYS. It is what
    makes ``_render_name``/``_render_op``/``_render_call`` REFUSE; only the list
    that summarised those fields a second time is gone.
    """
    t = table if table is not None else ast_table.TABLE
    phrases = operator_phrases if operator_phrases is not None else OPERATOR_SENTENCE
    conditions = (condition_phrases if condition_phrases is not None
                  else OPERATOR_SENTENCE_CONDITIONS)
    series: Dict[str, Any] = {}
    clock: Dict[str, Any] = {}
    scalars: Dict[str, Any] = {}
    operators: Dict[str, Any] = {}
    functions: Dict[str, Any] = {}

    for name in sorted(t[ast_table.SERIES_SECTION]):
        gap = None if _SAYABLE.match(name) else "unsayable"
        series[name] = {"gap": gap}

    # ⭐ THE FIFTH SECTION (closed table v2), AND IT IS SAID LIKE A SCALAR RATHER
    # THAN LIKE A SERIES. A series is spoken AS ITS OWN NAME; a clock value has a
    # declared `sentence` -- "the hour of the bar on a 24-hour clock, 0 to 23, in
    # New York time" -- because `hour` alone in a read-back is a word a member
    # cannot check the maths against, and `dayofweek` says nothing about whether
    # Sunday is 1. `sentence.js::compileRules` makes exactly these two decisions
    # and the two lanes are compared entry for entry by
    # `test_the_two_coverage_LANES_agree_and_the_ONE_divergence_is_PINNED`.
    #
    # ⚠️ Arity zero, so `_placeholder_gap(phrase, 0)` is the same derived check the
    # scalars get. `.get(...) or {}` because a synthetic probe manifest may declare
    # fewer sections, exactly as the scalars block below does.
    clock_table = t.get(ast_table.CLOCK_SECTION) or {}
    for name in sorted(clock_table):
        phrase = (clock_table[name] or {}).get("sentence")
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
        else:
            gap = _placeholder_gap(phrase, 0)
        clock[name] = {"phrase": phrase, "gap": gap}

    # ⭐ THE FOURTH SECTION, AND THE PHRASE IS THE MANIFEST'S. Unlike a series --
    # which is SAID AS ITS OWN NAME, so an unsayable name is what breaks it -- a
    # scalar is said as its declared `sentence`, so the NAME never reaches the
    # text and only the phrase can be missing. `sentence.js::compileRules` makes
    # exactly these two decisions and the two lanes are compared entry for entry.
    #
    # ⚠️ ITS ARITY IS ZERO, so `_placeholder_gap(phrase, 0)` is the same derived
    # check the functions get: a `{0}` copied into a scalar's declaration
    # references an argument that does not exist and is a gap, not a sentence.
    #
    # ⚠️ `.get(...) or {}` BECAUSE A SYNTHETIC MANIFEST MAY DECLARE THREE
    # SECTIONS. Several rails hand this a hand-built probe table on purpose, and
    # a `KeyError` there would make the probe impossible to write.
    scalar_table = t.get(ast_table.SCALARS_SECTION) or {}
    for name in sorted(scalar_table):
        phrase = (scalar_table[name] or {}).get("sentence")
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
        else:
            gap = _placeholder_gap(phrase, 0)
        scalars[name] = {"phrase": phrase, "gap": gap}

    for name in sorted(t[ast_table.OPERATORS_SECTION]):
        spec = t[ast_table.OPERATORS_SECTION][name]
        arity = spec.get("arity") if isinstance(spec.get("arity"), int) else 0
        phrase = phrases.get(name)
        gap = None
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
        else:
            gap = _placeholder_gap(phrase, arity)
        # ⭐⭐ THE SECOND PHRASE IS CARRIED EVEN WHEN IT IS BROKEN, AND IT DOES NOT
        # SET `gap` — `sentence.js` makes the same two decisions for the same two
        # reasons. ⛔ NO QUIET FALLBACK: a malformed conditions phrase must not
        # degrade to the base form, which would be a read-back silently answering
        # a different question, so it is carried and `_fill` refuses it BY NAME.
        # And setting `gap` here would make the BASE tree refuse too, for a defect
        # in a phrase it never uses.
        conditions_phrase = None
        if name in conditions:
            declared = conditions[name]
            conditions_phrase = declared if isinstance(declared, str) else ""
        operators[name] = {"phrase": phrase, "arity": arity, "gap": gap,
                           "conditions_phrase": conditions_phrase}

    for name in sorted(t[ast_table.FUNCTIONS_SECTION]):
        spec = t[ast_table.FUNCTIONS_SECTION][name]
        args = list(spec.get("args") or ())
        phrase = spec.get("sentence")
        gap = None
        if not isinstance(phrase, str) or phrase == "":
            gap = "no-template"
        else:
            gap = _placeholder_gap(phrase, len(args))
        functions[name] = {"phrase": phrase, "args": args, "gap": gap}

    return {"series": series, "clock": clock, "scalars": scalars,
            "operators": operators, "functions": functions, _TABLE_KEY: t}


SENTENCE_RULES = compile_rules()


def _is_leaf(n: Any) -> bool:
    return isinstance(n, dict) and n.get("type") in ("num", "series")


def _is_condition(node: Any, rules: Dict[str, Any]) -> bool:
    """Does this operand ALREADY produce 0/1? The shipped classifier's answer.

    ⛔ THE CALL IS THE POINT. ``scan_definition.is_boolean_tree`` resolves the
    manifest's ``yields`` over a tree and has done since E-2; a resolution
    written here would be a second one in this language and a third overall.
    ``sentence.js::yieldsOf`` is the JS lane's, the two are compared case for
    case by ``test_the_two_YIELDS_resolvers_agree_and_the_answer_is_ONE``, and
    that comparison is only meaningful while there are exactly two.

    ⛔ AND IT FAILS CLOSED TO "not a condition". ``is_boolean_tree`` raises on a
    tree that is not made of canonical nodes; answering "condition" there would
    DELETE the ``!= 0`` from a sentence where the coercion is real, which is the
    defect this mirror is fixing, inverted. The walker refuses the malformed
    operand by name a moment later, so this is a floor, not a swallow.
    """
    try:
        return bool(scan_definition.is_boolean_tree(node, rules.get(_TABLE_KEY)))
    except Exception:                              # noqa: BLE001 — see the docstring
        return False


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
    if kind == "offset":
        return _render_offset(node, rules, inputs, path, trace)
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
    # ⭐ THE TABLE'S PER-SYMBOL SCALARS, CONSULTED SECOND AND BEFORE THE INPUTS --
    # the same order, for the same reason, as the branch above and as
    # `lint.js::astReach`. The words are the manifest's: read, never written.
    #
    # ⛔ NOT A FALLBACK TO THE COLUMN NAME. A scalar the table declares and
    # nobody wrote English for is refused BY NAME, because `market_cap` in a
    # sentence is a read-back the member cannot check the maths against.
    # ⭐ THE TABLE'S CLOCK, CONSULTED AFTER THE SERIES AND BEFORE THE SCALARS --
    # the same order, for the same reason, as `renderName` and `lint.js::astReach`.
    # ⛔ NOT A FALLBACK TO THE COLUMN NAME: a clock entry the table declares and
    # nobody wrote English for is refused BY NAME, because `dayofweek` in a
    # sentence is a read-back the member cannot check the maths against.
    clock_rules = rules.get("clock") or {}
    if name in clock_rules:
        rule = clock_rules[name]
        if rule["gap"]:
            _refuse_gap(rule["gap"], "clock value", name, path)
        trace.append({"path": path, "rule": "series:clock"})
        return rule["phrase"]
    scalar_rules = rules.get("scalars") or {}
    if name in scalar_rules:
        rule = scalar_rules[name]
        if rule["gap"]:
            _refuse_gap(rule["gap"], "scalar", name, path)
        trace.append({"path": path, "rule": "series:scalar"})
        return rule["phrase"]
    if name in inputs:
        if not _SAYABLE.match(name):
            raise _SentenceRefused("sentence:unsayable-name",
                                   f"at {path}: the input {json.dumps(name)}")
        trace.append({"path": path, "rule": "series:input"})
        return f"the input {name}"
    raise _SentenceRefused(
        "sentence:name",
        f"at {path}: {json.dumps(name)} -- this table declares "
        f"{', '.join(sorted(rules['series']))}, its clock is "
        f"{', '.join(sorted(clock_rules)) or 'none'}, its scalars are "
        f"{', '.join(sorted(scalar_rules)) or 'none'}, and this definition declares "
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
    # ⭐ THE ONE PLACE THE CHROME CONSULTS `yields`, and it asks the OPERAND
    # TREES rather than a list of names — so a fifty-fifth scalar is covered the
    # day it declares one. Every operand already being a condition is what makes
    # the `!= 0` vacuous; ONE `num` operand anywhere and the coercion is real, so
    # the base phrase stands. `sentence.js::renderOp` makes the same call in the
    # same place, and the two texts are pinned byte-for-byte.
    #
    # ⚠️ THE TRACE SAYS WHICH FORM SPOKE. "The sentence is correct" is satisfiable
    # by the wrong branch agreeing today; "it came from `op:&&:conditions`, and a
    # `num` operand moves it back to `op:&&`" is not.
    as_conditions = (rule.get("conditions_phrase") is not None
                     and len(node["args"]) > 0
                     and all(_is_condition(a, rules) for a in node["args"]))
    trace.append({"path": path,
                  "rule": f"op:{name}:conditions" if as_conditions else f"op:{name}"})
    parts = [_render_arg(a, rules, inputs, f"{path}.args[{i}]", trace)
             for i, a in enumerate(node["args"])]
    return _fill(rule["conditions_phrase"] if as_conditions else rule["phrase"],
                 parts, f"operator {name}", path)


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


def _render_offset(node: Any, rules: Dict[str, Any], inputs: Mapping[str, Any],
                   path: str, trace: List[Dict[str, str]]) -> str:
    """``close[1]`` -> ``close 1 bar ago``. ``sma(close, 20)[2]`` -> ``(the
    20-bar simple moving average of close) 2 bars ago``.

    ⭐ THE PHRASE IS WRITTEN HERE AND NOT IN THE MANIFEST — ``renderOffset``
    makes the same call for the same reason: ``closedTable.json`` declares a
    phrase per NAME (a series, an operator, a function), and an offset names
    nothing; the bar count IS the node. There is no manifest entry for it to be
    a second copy of.

    ⛔ ``0`` READS AS THE BAR ITSELF, NOT "0 bars ago". ``close[0]`` is
    ``close`` — the identity Pine spells the same way — and "close 0 bars ago"
    is English that makes a reader stop and work out whether it means today or
    yesterday. The store's canonical floor is ``value >= 0``
    (``parse.js::readOffset``), so this walker mirrors the JS lane's guard
    exactly rather than inventing a tighter one.
    """
    value = node.get("value")
    args = node.get("args")
    if not isinstance(args, list) or len(args) != 1:
        shown = len(args) if isinstance(args, list) else repr(args)
        raise _SentenceRefused(
            "sentence:arity",
            f"at {path}: an offset reads exactly one child column, got {shown}")
    ok = (type(value) is not bool
          and (isinstance(value, int)
               or (isinstance(value, float) and math.isfinite(value)
                   and value.is_integer()))
          and value >= 0)
    if not ok:
        raise _SentenceRefused(
            "sentence:window",
            f"at {path}: a bar offset counts whole bars backwards; got {value!r}")
    trace.append({"path": path, "rule": "offset"})
    inner = _render_arg(node["args"][0], rules, inputs, f"{path}.args[0]", trace)
    count = int(value)
    if count == 0:
        return inner
    return f"{inner} {count} bar{'' if count == 1 else 's'} ago"


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


def _call_model(messages: List[dict], briefing: str = "") -> Tuple[Any, int, int]:
    """ONE Anthropic call. Returns ``(message, input_tokens, output_tokens)``.

    ``briefing`` is what this pipeline decided BEFORE the call -- which kind of
    formula is being drafted, and what the firm's own words in the prompt mean.
    Both are resolved here, against files, so the model is TOLD rather than
    asked to guess.

    ⛔ NO SAMPLING PARAMETER. Claude 5 models REMOVED ``temperature``/``top_p``/
    ``top_k`` — they answer 400. This call used to send ``temperature=0`` and pop
    it on that error, which made every proposal TWO HTTP round-trips: the 400, then
    the real call. Sending nothing is the same determinism for one round-trip, and
    it leaves no pop-and-retry branch that no longer has a way to fire.

    ⛔ ``thinking``/``output_config`` ARE DELIBERATELY ABSENT. Opus 5 thinks by
    default, which is what ``MAX_TOKENS`` is now sized for; naming either one would
    400 the moment ``CONCIERGE_MODEL`` pointed at a model that does not take it.
    """
    from api.services.engine import _get_anthropic_client
    # ``with_options`` returns a configured copy; the shared client's bounded
    # timeout is preserved (see MAX_HTTP_RETRIES for why the count, not the
    # clock, is what moves).
    client = _get_anthropic_client().with_options(max_retries=MAX_HTTP_RETRIES)
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT + vocabulary_text() + briefing,
        tools=[anthropic_tool()],
        tool_choice={"type": "tool", "name": TOOL_NAME},
        messages=messages,
    )
    usage = getattr(msg, "usage", None)
    return msg, int(getattr(usage, "input_tokens", 0) or 0), \
        int(getattr(usage, "output_tokens", 0) or 0)


# --------------------------------------------------------------------------- #
# the firm's words -- RESOLVED HERE, AGAINST THE FILE, BEFORE THE MODEL RUNS
# --------------------------------------------------------------------------- #
#
# ⭐⭐ THIS IS THE KNOWLEDGE LAYER, AND IT IS THE WHOLE DIFFERENCE BETWEEN A
# TRANSLATOR AND A PRODUCT. A generic model asked what "trending" means guesses,
# and guesses differently next Tuesday. `conceptVocabulary.json` is the FIRM'S
# answer -- 21 words, each citing an artifact the firm already ships, each
# citation looked up rather than trusted -- and this is where a member's sentence
# meets it.
#
# ⛔ THE MODEL NEVER SEES A WORD IT MAY REINTERPRET. Resolution happens below,
# against the file; what reaches the model is the EXPANDED SOURCE. The
# interpretation is then visible to the member too, because `sentence_for` reads
# the resulting TREE back into English before anything is saved.
#
# ⛔ AND AN UNGROUNDABLE WORD IS REFUSED BY NAME, NEVER APPROXIMATED. There is no
# nearest match and no partial expansion: "cheap" comes back saying "cheap",
# because a wrong scan that looks right is worse than a refusal (spec §1.6) and a
# member who is told which word failed can say what they meant.
#
# ⭐⭐ AND THE FIRM'S WORDS ARE NOT THE ONLY WORDS. Two different requests were
# conflated until this task, and conflating them is what made the door narrow:
#
#   1. A FIRM CONCEPT -- "trending", "closing strong". These carry the firm's
#      judgement and its thresholds, so they stay GROUNDED AND CITED, and a word
#      the firm will not ground stays refused BY NAME. The model never invents one.
#   2. A PLAIN COMPOSITION over the manifest -- "rsi14 above 70 and volume over
#      two million". NO FIRM JUDGEMENT IS INVOLVED: the member named the table's
#      own entries and supplied every number. That needs no grounding, and
#      REFUSING IT WAS THE DEFECT.
#
# ⛔ SO THE SECOND PATH IS BUILT, AND THE SAFETY PROPERTY IS UNCHANGED: the model
# still emits a TREE validated against the manifest and still cannot author the
# read-back. What changed is only which ENGLISH reaches it.
#
# ⭐ AND EVERYTHING BELOW IS DERIVED AT RUN TIME FROM THE MANIFEST AND THE
# VOCABULARY FILE -- never a hand-list. Measured twice this week: a hand-list that
# agrees with today's manifest leaves 825 of 826 and 908 of 909 cases green with
# only the AST source rail red. The rail is carried and widened (it now forbids
# SCALAR names and VOCABULARY words as string constants too), and the reachability
# rail below is behavioural: every declared name must be reachable BY ITS OWN NAME
# and by the manifest's own phrase for it, so a fourteenth indicator function joins
# the plain-language door the day it is declared, with no line of this file moving.

# --------------------------------------------------------------------------- #
# morphology -- RULES OVER ENGLISH, NEVER A THESAURUS OF THE FIRM'S WORDS
# --------------------------------------------------------------------------- #
#
# ⛔ THE DISTINCTION THAT MAKES THIS LEGITIMATE. A thesaurus would say "leaders
# means leader" -- a second authority over what the firm's words mean, exactly the
# defect the vocabulary file exists to prevent. What is written here is ENGLISH
# INFLECTION: suffix rules that know nothing about trading, applied to BOTH sides,
# so the terms being matched still come only from the manifest and the vocabulary.
#
# ⚠️ AND AMBIGUITY IS NEVER ARBITRATED BY TASTE. Two entries can stem to one key
# (`highest` and `high` both reach "high"), so a run is resolved by MINIMUM TOTAL
# MORPHOLOGICAL DISTANCE -- the steps the member's word took plus the steps the
# declared form took. "highs" is one step from `high` and two from `highest`, so
# the nearer one wins; a genuine TIE is reported as a collision and matches
# NOTHING, because picking one of two equals would be this module inventing a
# meaning.

#: The shortest thing a suffix rule may leave behind. Below this, stripping is
#: noise. It is 3 because the manifest declares three-letter bar fields, and a
#: plural rule that could not turn "lows" into one of them would leave the most
#: ordinary word a trader writes unmatched. The two-letter columns (`ps`, `pb`)
#: are protected by the rules' own length floors, not by this.
_MIN_STEM = 3

#: (suffix, the shortest word it may fire on, its replacement, de-double after).
#: Ordered longest-intent first; applied at most once per pass.
_SUFFIX_RULES: Tuple[Tuple[str, int, str, bool], ...] = (
    ("ies", 5, "y", False),
    ("sses", 6, "ss", False),
    ("shes", 6, "sh", False),
    ("ches", 6, "ch", False),
    ("xes", 5, "x", False),
    ("ship", 7, "", False),
    ("ness", 7, "", False),
    #: ⚠️ `-er`/`-est` DE-DOUBLE LIKE `-ing`/`-ed`, because English doubles the
    #: consonant before all four. Without it "gappers" stemmed to "gapp" and the
    #: firm's own screen name `Gappers holding gains` reached nothing.
    ("ing", 6, "", True),
    ("est", 6, "", True),
    ("ed", 5, "", True),
    ("er", 5, "", True),
    ("ly", 5, "", False),
    ("s", 4, "", False),
    ("e", 4, "", False),
)

#: A word never stems past this many passes. "leaderships" needs three
#: (s -> ship -> er); the bound is what stops a pathological rule cycling.
_STEM_PASSES = 4

#: Endings the plural rule must not touch: they are not plurals.
_NOT_PLURAL = ("ss", "us", "is")

_DOUBLED = re.compile(r"([b-df-hj-np-tv-z])\1$")


def _stem_once(word: str) -> str:
    for suffix, floor, repl, dedouble in _SUFFIX_RULES:
        if len(word) < floor or not word.endswith(suffix):
            continue
        if suffix == "s" and word.endswith(_NOT_PLURAL):
            continue
        stem = word[: len(word) - len(suffix)] + repl
        if len(stem) < _MIN_STEM:
            continue
        return _DOUBLED.sub(r"\1", stem) if dedouble else stem
    return word


def stem(word: str) -> Tuple[str, int]:
    """``(the stem, how many rules fired)``.

    The step count is not bookkeeping: it is the DISTANCE that decides a
    collision, and without it "highs" would be an unresolvable tie between the
    bar field and the window function.
    """
    current, steps = word, 0
    for _ in range(_STEM_PASSES):
        nxt = _stem_once(current)
        if nxt == current:
            break
        current, steps = nxt, steps + 1
    return current, steps


# --------------------------------------------------------------------------- #
# the text a member typed
# --------------------------------------------------------------------------- #

_WORD = re.compile(r"[a-z0-9_]+")
#: ⚠️ REPLACED BY TWO SPACES, NOT BY NOTHING, and that is load-bearing: every
#: transform below is LENGTH-PRESERVING, so an offset into the normalised text is
#: an offset into what the member actually typed and `matched_as` can be their own
#: casing rather than a lower-cased approximation of it.
_POSSESSIVE = re.compile(r"'s(?![a-z0-9])")
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_HAS_PLACEHOLDER = re.compile(r"\{\d+\}")
#: Words a declared phrase may open with that carry no meaning to match on.
#: Grammar, not vocabulary -- and stripped from the DECLARED form only, never
#: from the member's text, which is matched as contiguous runs wherever they sit.
_LEADING_GRAMMAR = ("the", "a", "an", "whether")


def _hay(text: Any) -> str:
    """The member's text, folded for matching WITHOUT changing its length.

    ⚠️ THE HYPHEN IS LEFT ALONE, DELIBERATELY. It splits words anyway (``_WORD``
    does not admit it), so folding it to a space bought nothing -- and it cost the
    MINUS SIGN: two of the manifest's own columns are honestly negative
    (`williamsR`, `pct_vs_ema20`), and a member writing "under -80" had the sign
    silently deleted from their own threshold.
    """
    return _POSSESSIVE.sub("  ", str(text or "").lower())


def _token_spans(hay: str) -> List[Tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in _WORD.finditer(hay)]


def _form_tokens(form: Any) -> Tuple[str, ...]:
    """A DECLARED phrase, reduced to the words a member would have to write."""
    words = [m.group(0) for m in _WORD.finditer(_hay(form))]
    while words and words[0] in _LEADING_GRAMMAR:
        words.pop(0)
    return tuple(words)


def _stem_key(words: Tuple[str, ...]) -> Tuple[Tuple[str, ...], int]:
    stems, cost = [], 0
    for word in words:
        root, steps = stem(word)
        stems.append(root)
        cost += steps
    return tuple(stems), cost


# --------------------------------------------------------------------------- #
# the lexicon -- DERIVED, BOTH HALVES, AT RUN TIME
# --------------------------------------------------------------------------- #

#: What a matched phrase turned out to be. ⛔ Structure, not vocabulary.
#:
#: ⭐ `EXCLUDED_ENTRY` IS "ABSENT MUST STAY ABSENT", APPLIED TO LANGUAGE. The
#: manifest does not merely list what the table HAS: `_scalars_excluded` lists
#: what it deliberately does NOT have, each with the reason, and the two are
#: declared to be a PARTITION of the screener's columns. So a member who says
#: "sector" has named something real that this grammar cannot express, and the
#: honest answer is the manifest's own sentence about it — not silence.
CONCEPT_ENTRY, REFUSED_ENTRY, TABLE_ENTRY, EXCLUDED_ENTRY = (
    "concept", "refused", "table", "excluded")

#: Which lane answered a proposal. ⚠️ NOT one of the manifest's names -- the
#: fourth reads "unanchored" rather than the obvious word because that word is a
#: declared bar field and the anti-copy rail would report it, correctly.
PLAN_PATHS: Tuple[str, ...] = ("concept", "composition", "mixed", "unanchored")

#: ⚠️ STRUCTURE, NOT VOCABULARY. ``_surface_forms`` opens a declared name's
#: underscores into spaces because a member writes the words, not the joiner; the
#: shape registries join their machine keys with a hyphen instead, and this is
#: that same one character. It is the separator, never a name.
_KEY_SEP = "-"

#: ⚠️ STRUCTURE AGAIN, NOT VOCABULARY. A shape registry writes a
#: direction variant by parenthesising the direction — the name is outside
#: the brackets and the qualifier is inside. Stripping the bracketed part is
#: the same move as opening a camel hump: it recovers the words a member
#: actually writes.
_QUALIFIER = re.compile(r"\([^)]*\)")


def _surface_forms(name: str, spec: Mapping[str, Any]) -> List[str]:
    """Every way a member might write ONE declared entry, off its declaration.

    ⛔ THREE DERIVATIONS AND NO INVENTED SYNONYM: the name itself, the name with
    its structure spelled out (underscores and camel humps become spaces), and
    the manifest's OWN English for it.

    ⚠️ A PHRASE CARRYING AN ARGUMENT PLACEHOLDER IS SKIPPED. A function's
    read-back is a template (``the {1}-bar average of {0}``); stripping the holes
    out of it yields a phrase nobody would ever type and would index a fragment
    against a real entry. Functions stay reachable by NAME, which is what a member
    writes anyway, and the reachability rail asserts exactly that split rather
    than assuming it.
    """
    forms = [name, name.replace("_", " "), _CAMEL.sub(" ", name)]
    gloss = spec.get("sentence") if isinstance(spec, Mapping) else None
    if not isinstance(gloss, str) or not gloss:
        gloss = spec.get("doc") if isinstance(spec, Mapping) else None
    if isinstance(gloss, str) and gloss and not _HAS_PLACEHOLDER.search(gloss):
        forms.append(gloss)
    return forms


def _excluded(table: Mapping[str, Any]) -> Mapping[str, str]:
    """``{column -> why the table does not carry it}``, the manifest's own words.

    ⛔ READ THROUGH ``ast_table``'s STRUCTURE CONSTANT, never the literal key.
    The section names are structure and this module owns none of them.
    """
    block = table.get(ast_table.EXCLUDED_KEY)
    return block if isinstance(block, Mapping) else {}


def _filter_labels() -> List[Tuple[str, str, str]]:
    """``(key, label, column)`` for every filter the screener ships.

    Imported lazily so this module stays cheap at import, and it RAISES rather
    than returning nothing: a registry whose shape had moved would otherwise make
    this door quietly narrower with every rail still green.
    """
    from api.services.screener import filters as screener_filters  # noqa: PLC0415
    out = [(key, entry.get("label"), entry.get("column"))
           for key, entry in screener_filters.FILTERS.items()
           if isinstance(entry.get("label"), str) and entry.get("label")
           and isinstance(entry.get("column"), str)]
    if not out:
        raise ValueError(
            "the screener's filter registry yielded no labelled columns; its "
            "shape changed and the firm's own wording for every column would "
            "silently stop reaching the plain-language door")
    return out


def _named_shape_phrases() -> List[Tuple[str, str]]:
    """``(column, phrase)`` for every named bar shape the screener filters on.

    ⭐ WHY THIS EXISTS AT ALL. The screener ships filters over two whole
    libraries of named bar shapes, and until this landed NO AI door in the product
    could anchor one of their names. Measured 2026-08-27: of the candle library's
    own labels, 62 came back with ``concepts``, ``terms``, ``not_understood`` and
    ``unavailable`` ALL empty. ⛔ AND THAT IS THE WORST OF THE FOUR OUTCOMES,
    NOT THE MILDEST — the phrasing reached the model as bare English wearing
    the appearance of a normal request, so nothing marked the miss. An
    over-refusal is at least visible to whoever reads the refusal; a silent
    non-understanding is visible to nobody.

    ⭐⭐ TWO REGISTRIES, BECAUSE THE FIRM WROTE TWO. ``candle_catalog``
    names what the bar IS in the Japanese vocabulary; ``bar_character`` names what
    the bar DID, and its own header opens by explaining why that had to be a
    second registry rather than more candle labels. They are the same question
    about the same bar, they sit in the same filter category, and a member has no
    idea which library a word came out of. Reading one and not the other would
    leave this door fluent in half a vocabulary — measured: three of the
    firm's own starter screens are worded entirely out of the second one.

    ⛔ NOTHING HERE IS TYPED, IN EITHER HALF. The NAMES come from the
    registries that own them — each one's own header calls itself the single
    place its names live — and the COLUMN each name is stored in is ASKED OF
    THE SCREENER'S FILTER REGISTRY rather than asserted: a preset's stored value
    is decoded through the catalog's own ``decode_matches`` and kept only when it
    names a shape a registry declares. So a shape registered tomorrow is sayable
    with no edit here, and a library the screener stops filtering on stops being
    promised. A hand-typed copy of these names would be this repo's most repeated
    defect — a second authority over one value — at library scale.

    ⚠️ FIRST DECLARATION WINS, AND IT IS LOAD-BEARING RATHER THAN TIDY.
    Four separate filters ship the candle library (today, the recent five
    sessions, the weekly bar, the monthly bar). Indexing a name under each of
    their columns would put FOUR identities at one distance under one phrase, and
    ``_resolve_run`` answers a tie with silence — every candle name would have
    gone straight back to being invisible, which is the defect this function
    exists to remove. So the registry's own declaration order decides, and the
    answer is the screener's rather than one made here.

    ⚠️ THE SURFACE FORMS, AND THE ONE THAT IS DELIBERATELY MISSING. The
    display label; the machine key with its hyphens opened out, exactly as
    ``_surface_forms`` opens a declared name's underscores; and the label with a
    parenthesised direction qualifier removed, because a library that writes
    ``Hikkake Confirmed (Bull)`` is spelling the direction, not the name, and a
    member says the name. The ``desc`` is NOT indexed: it is a paragraph of
    ordinary English, and indexing prose would let a fragment of somebody's
    description match a whole request.

    ⭐ AND THE CLASSIFICATION WORDS THE CATALOG DECLARES ON EVERY PATTERN
    — the ``kind`` field, which is how the library itself says reversal /
    continuation / indecision / plain. The screener ships no filter on it, so a
    member who asks for "a reversal candle" has named something the registry
    really does declare and no column stores; that is precisely the
    ``EXCLUDED_ENTRY`` contract, and saying so is better than silence.
    ⚠️ These are the widest words this function adds and the likeliest to
    be said by accident. They are here because they are DECLARED, not because two
    starter screens happen to need them, and an exact spelling is required before
    any of them is surfaced.

    ⚠️ THE OVER-CAPTURE QUESTION IS ANSWERED BY THE DERIVATION, NOT BY
    THIS PARAGRAPH. Every library name built out of an ordinary English word
    — star, harami, inside, engulfing, bar — exists only inside a
    multi-word form, so ``_matches``'s longest-first, non-overlapping pass can
    never spend one of those words on a shape when the member meant the ordinary
    word; and an ``EXCLUDED_ENTRY`` is surfaced only on an EXACT spelling, so no
    amount of stemming widens any of them. The rail measures both properties over
    the WHOLE of both libraries rather than over a handful of names somebody
    picked.

    ⭐ THE LEGACY SPELLINGS RIDE ALONG. The catalog carries a compatibility
    map for a stored value that changed spelling, and that old token is still
    written into the column, so it is still a word a member may say. It resolves
    to the same column as the shape it aliases.

    It RAISES rather than returning nothing, the ``_filter_labels`` idiom: a
    registry whose shape had moved would otherwise make this door quietly narrower
    with every rail still green.
    """
    from api.services.screener import bar_character  # noqa: PLC0415
    from api.services.screener import candle_catalog as catalog  # noqa: PLC0415
    from api.services.screener import filters as screener_filters  # noqa: PLC0415

    registries = (catalog.ALL_PATTERNS, bar_character.CASCADE)
    declared = {shape.key for registry in registries for shape in registry}

    column_of: Dict[str, str] = {}
    for entry in screener_filters.FILTERS.values():
        column = entry.get("column")
        if not isinstance(column, str) or not column:
            continue
        for preset in entry.get("presets") or ():
            stored = preset.get("value") if isinstance(preset, Mapping) else None
            if not isinstance(stored, str):
                continue
            for key in catalog.decode_matches(stored):
                if key in declared:
                    column_of.setdefault(key, column)

    out: List[Tuple[str, str]] = []
    kinds: Dict[str, str] = {}
    for registry in registries:
        #: ⭐ THE COLUMN IS A FACT ABOUT THE LIBRARY, NOT ABOUT ONE SHAPE, and
        #: asking it per-shape was WRONG in a way only the both-directions rail
        #: could see: a shape registered but not yet given a filter preset got no
        #: column, so it was silently dropped — the newest name in the library
        #: would be the one name this door could not say.
        column = next((column_of[shape.key] for shape in registry
                       if shape.key in column_of), None)
        if not column:
            continue
        for shape in registry:
            out.append((column, shape.label))
            out.append((column, shape.key.replace(_KEY_SEP, " ")))
            undirected = _QUALIFIER.sub(" ", shape.label)
            if _form_tokens(undirected) != _form_tokens(shape.label):
                out.append((column, undirected))
            classification = getattr(shape, "kind", None)
            # ⛔ `plain` IS ORDINARY ENGLISH AND IS EXCLUDED BY RULING, 2026-08-27.
            # The other three `kind` words -- `reversal`, `continuation`,
            # `indecision` -- are words a member only types when they mean
            # structure, so indexing them costs nothing and closes two starter
            # screens. `plain` is a filler adjective: indexing it made
            # "a plain english description" answer `unavailable: candle_matches`,
            # which is over-capture of exactly the kind the first PCF dialect
            # derivation was caught doing to `log10(close)`.
            #
            # ⚠️ Dropping the whole `kind` read would be the wrong trade -- it
            # reopens those two starters to buy back one adjective. And a named
            # constant here would NOT trip the anti-copy rail, because `plain` is
            # neither a catalog key nor a label; it is a classification value, so
            # this exclusion has to be stated where it is read.
            if isinstance(classification, str) and classification and classification != "plain":
                kinds.setdefault(classification, column)
    for key, legacy in catalog.LEGACY_ALIASES.items():
        column = column_of.get(key)
        if column:
            out.append((column, legacy.replace(_KEY_SEP, " ")))
    out.extend((column, classification) for classification, column in kinds.items())
    if not out:
        raise ValueError(
            "the screener's named bar-shape libraries reached no filter column; a "
            "registry or the filter registry moved, and every one of the firm's "
            "own shape names would silently stop reaching the plain-language door")
    return out


def build_lexicon(table: Optional[Mapping[str, Any]] = None,
                  vocab: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Every phrase this door understands, read off the manifest and the vocabulary.

    ⛔ NOTHING IS TYPED HERE. The sections come from ``_name_sections`` (the same
    derivation the tool schema uses, so a fifth section arrives as data), the
    entries come from the manifest, and the words come from
    ``conceptVocabulary.json``. ``closedTable.json`` is being extended with
    indicator functions by another owner as this ships; every one of them joins
    this lexicon on import with no edit here.

    ⚠️ THE OPERATOR VOCABULARY IS SKIPPED, BY NODE TYPE AND NOT BY SECTION NAME.
    An operator is GRAMMAR, not something a member names: its English lives in
    ``OPERATOR_SENTENCE``, pinned across the two lanes, and the model is handed the
    operator list in the schema. ⛔ AND THE TEST IS THE NODE TYPE RATHER THAN "does
    it tokenise to a word", which was the first draft and was WRONG BY ONE:
    ``u-`` — canonical unary minus — carries the word "u", so it indexed itself
    and a member who typed a stray "u" was told they had named an operator.

    Returns ``{"index": {stem tuple -> [entry]}, "max_words": n,
    "collisions": {stem tuple -> [identity]}}``.
    """
    t = table if table is not None else ast_table.TABLE
    v = vocab if vocab is not None else concept_vocabulary.VOCAB
    index: Dict[Tuple[str, ...], List[dict]] = {}

    def add(kind: str, key: str, section: Optional[str], form: Any) -> None:
        words = _form_tokens(form)
        if not words:
            return
        stems, cost = _stem_key(words)
        row = {"kind": kind, "key": key, "section": section,
               "words": words, "cost": cost}
        bucket = index.setdefault(stems, [])
        if not any(e["kind"] == kind and e["key"] == key and e["words"] == words
                   for e in bucket):
            bucket.append(row)

    for section, entries in _name_sections(t).items():
        if _CALLABLE_SECTIONS.get(section) == "op":
            continue
        for name, spec in entries.items():
            for form in _surface_forms(name, spec if isinstance(spec, Mapping) else {}):
                add(TABLE_ENTRY, name, section, form)

    #: ⭐ THE HALF THE TABLE DECLARES IT DOES **NOT** CARRY, read off the same
    #: manifest. `_scalars_totality` states that these and the scalars are a
    #: PARTITION of the screener's own column list, so this is not a list of
    #: things somebody thought of — a sixty-sixth column lands in one half or the
    #: other or the manifest's own rail goes red.
    for name in _excluded(t):
        add(EXCLUDED_ENTRY, name, None, name)

    #: ⭐ AND THE FIRM'S OWN UI WORDING FOR EACH COLUMN. `filters.py` is already an
    #: authority in this subsystem — `filter_preset` is one of the vocabulary's
    #: four citation kinds — and its labels are how the firm words a criterion in
    #: front of a member. "P/E (TTM)" reduces to no word the column name contains,
    #: so without this the most ordinary way to write `pe_ttm` reached nothing.
    #:
    #: ⛔ IT RAISES RATHER THAN NARROWING SILENTLY, the `firm_setups()` idiom: a
    #: registry that had moved would otherwise make this door quietly smaller
    #: while every rail stayed green.
    for key, label, column in _filter_labels():
        if column in _excluded(t):
            add(EXCLUDED_ENTRY, column, None, label)
        elif column in ast_table.declared_names(t):
            add(TABLE_ENTRY, column, ast_table.SCALARS_SECTION, label)

    #: ⭐ AND EVERY NAMED BAR SHAPE THE SCREENER FILTERS ON. See
    #: `_named_shape_phrases` for why: without this the door was silently blind
    #: to the firm's own candle and bar-character libraries — not refusing
    #: them, not naming them, just handing the words to the model as if they had
    #: been understood.
    #:
    #: ⛔ THE SAME TWO-WAY SPLIT AS THE FILTER LABELS ABOVE, AND FOR THE SAME
    #: REASON. Today the manifest declares these columns EXCLUDED and says why in
    #: its own words, so a candle name lands in `unavailable` carrying that
    #: sentence — which itself names the screener filter that does ship the
    #: pattern and the scalars a member CAN write instead. That is a refusal that
    #: names what would unblock it. If the table ever declares the column, the
    #: identical line grounds the same names as terms with no edit here.
    for column, phrase in _named_shape_phrases():
        if column in _excluded(t):
            add(EXCLUDED_ENTRY, column, None, phrase)
        elif column in ast_table.declared_names(t):
            add(TABLE_ENTRY, column, ast_table.SCALARS_SECTION, phrase)

    for word in concept_vocabulary.concepts(v):
        add(CONCEPT_ENTRY, word, None, word)
    for word in concept_vocabulary.refused(v):
        add(REFUSED_ENTRY, word, None, word)

    #: ⛔ A TIE IS EXACTLY "TWO IDENTITIES AT THE SAME DISTANCE", AND IT IS
    #: DERIVED FROM THE SCORING RULE RATHER THAN GUESSED AT. `_resolve_run` scores
    #: a non-exact run as ``run + entry + 1``, so the run's own cost cancels and
    #: two entries tie iff their costs are equal; an exact run scores 0, which two
    #: entries can only share by declaring the SAME words. Both cases are "the
    #: cheapest entry is not unique", so that is what is reported.
    #:
    #: ⚠️ NOT "any two identities under one stem". `highest` (cost 1) and `high`
    #: (cost 0) share a stem and are NOT a tie — the distance rule separates them,
    #: and calling that a collision would drop two perfectly readable words.
    collisions = {}
    for stems, rows in index.items():
        cheapest = min(e["cost"] for e in rows)
        identities = {(e["kind"], e["key"]) for e in rows if e["cost"] == cheapest}
        if len(identities) > 1:
            collisions[stems] = sorted(identities)
    return {"index": index,
            "max_words": max((len(k) for k in index), default=1),
            "collisions": collisions}


#: The shipped lexicon. Built once, at import, from the two files.
LEXICON: Dict[str, Any] = build_lexicon()


def _resolve_run(lexicon: Dict[str, Any], words: Tuple[str, ...]) -> Optional[dict]:
    """One contiguous run of the member's words -> the ONE entry it names, or None.

    ⛔ MINIMUM TOTAL DISTANCE, AND A TIE MATCHES NOTHING. See the morphology note:
    arbitrating a tie would be this module deciding what a word means.
    """
    stems, run_cost = _stem_key(words)
    rows = lexicon["index"].get(stems)
    if not rows:
        return None
    #: ⭐ AN EXACT SPELLING IS DISTANCE ZERO, WHATEVER ITS STEM COST. Without
    #: this, "highest" scored a tie between the window function it literally
    #: spells and the bar field it merely stems to, and a tie matches nothing —
    #: so the member's exact word would have been the one thing this door could
    #: not read.
    best: Dict[Tuple[str, str], dict] = {}
    for row in rows:
        ident = (row["kind"], row["key"])
        score = 0 if row["words"] == words else run_cost + row["cost"] + 1
        if ident not in best or score < best[ident]["score"]:
            best[ident] = {"score": score, "row": row}
    floor = min(entry["score"] for entry in best.values())
    winners = [entry["row"] for entry in best.values() if entry["score"] == floor]
    if len(winners) != 1:
        return None
    #: ⭐ MORPHOLOGY WIDENS WHAT YOU MAY SAY; IT DOES NOT WIDEN WHAT WE TELL YOU
    #: WE CANNOT DO. An absent column is surfaced only on an EXACT spelling,
    #: because "companies with rsi over 70" and "tickers over 50" are the most
    #: ordinary filler in the box and stemming them onto the identity columns
    #: would put a can't-do notice under half the requests in the product.
    if winners[0]["kind"] == EXCLUDED_ENTRY and winners[0]["words"] != words:
        return None
    return winners[0]


def _matches(prompt: str, lexicon: Dict[str, Any]) -> List[dict]:
    """Every phrase the member wrote that this door understands.

    LONGEST FIRST AND NON-OVERLAPPING, unchanged from E-5 and for its reason: a
    phrase the firm has defined wins over a shorter one inside it, so "leaders
    pulling back" is one concept rather than two halves of somebody else's, and
    "closing strong" is a grounded concept rather than the refused word "strong".
    """
    hay = _hay(prompt)
    spans = _token_spans(hay)
    taken = [False] * len(spans)
    found: List[dict] = []
    for width in range(min(lexicon["max_words"], len(spans)), 0, -1):
        for i in range(0, len(spans) - width + 1):
            if any(taken[i:i + width]):
                continue
            words = tuple(spans[j][0] for j in range(i, i + width))
            row = _resolve_run(lexicon, words)
            if row is None:
                continue
            for j in range(i, i + width):
                taken[j] = True
            found.append({"kind": row["kind"], "key": row["key"],
                          "section": row["section"],
                          "start": spans[i][1], "end": spans[i + width - 1][2],
                          "matched_as": str(prompt)[spans[i][1]:spans[i + width - 1][2]]})
    return sorted(found, key=lambda m: m["start"])


# --------------------------------------------------------------------------- #
# clauses -- THE UNIT A MEMBER CAN FIX
# --------------------------------------------------------------------------- #
#
# 🔴 A REFUSED WORD MUST NOT REFUSE THE WHOLE PROPOSAL. That was E-5's own
# measured limit and it is the same "absent must stay absent" principle applied to
# language: take what you understood, NAME the part you did not, and let the
# member fix that clause. A blanket refusal of "cheap stocks with pe_ttm under 15"
# throws away a request in which the member supplied every number themselves.
#
# ⛔ AND THE EXCLUSION IS THE SAFETY PROPERTY, NOT A COURTESY. The refused clause
# is removed BEFORE the model is called, so the model never sees "cheap" and
# cannot invent the firm's threshold for it. Telling the model "the member also
# said cheap but we could not ground it" would be handing it the invitation.

_CLAUSE_BREAK = re.compile(
    r"[,;\n]|(?<![a-z0-9_])(?:and|with|but|while|plus)(?![a-z0-9_])")


def _clauses(prompt: str, spans: List[dict]) -> List[Tuple[int, int]]:
    """The member's text, cut at the joins -- but never inside something we read.

    ⚠️ THE ORDER IS LOAD-BEARING: phrases and numbers are read over the WHOLE text
    first, and a break that falls inside one is not a break. Otherwise a future
    concept containing "and" would be cut in half by the splitter and then fail to
    ground -- and the THOUSANDS COMMA in "1,500,000" would cut one threshold into
    three clauses, which it did.
    """
    hay = _hay(prompt)
    cuts: List[Tuple[int, int]] = []
    for brk in _CLAUSE_BREAK.finditer(hay):
        if any(brk.start() < s["end"] and s["start"] < brk.end() for s in spans):
            continue
        cuts.append((brk.start(), brk.end()))
    out: List[Tuple[int, int]] = []
    cursor = 0
    for start, end in cuts + [(len(hay), len(hay))]:
        if start > cursor:
            out.append((cursor, start))
        cursor = end
    return [(a, b) for a, b in out if hay[a:b].strip()]


# --------------------------------------------------------------------------- #
# the member's own numbers
# --------------------------------------------------------------------------- #

#: Unit suffixes a trader writes. ⚠️ ENGLISH AND SI, NOT THE FIRM'S OPINION --
#: expanding "two million" is arithmetic, and the VALUE is still the member's.
_UNIT_SCALE: Mapping[str, float] = {
    "k": 1e3, "thousand": 1e3,
    "m": 1e6, "mm": 1e6, "mil": 1e6, "million": 1e6,
    "b": 1e9, "bn": 1e9, "billion": 1e9,
    "t": 1e12, "trillion": 1e12,
}
#: ⚠️ THE UNIT ALTERNATION IS BUILT FROM `_UNIT_SCALE`, NEVER `[a-z]+`. A greedy
#: word class swallowed the next word -- "70 and volume" matched as the number 70
#: with the unit "and", and the span then straddled a clause boundary and dropped
#: the member's threshold on the floor. Longest first so "million" wins over "m".
#: ⚠️ AND THE THOUSANDS COMMA MUST BE FOLLOWED BY THREE DIGITS. `[\d,]*` ate the
#: comma in "under 15, roe over 20", stretching the span across a clause boundary
#: so the member's own threshold fell outside every surviving clause and vanished.
_NUMBER = re.compile(
    r"(?<![a-z0-9_.])(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|"
    + "|".join(sorted(_UNIT_SCALE, key=lambda u: (-len(u), u)))
    + r")?(?![a-z0-9_])")


def _numbers_in(prompt: str, skip: List[dict]) -> List[dict]:
    """The numbers the MEMBER wrote, with their units expanded.

    ⛔ A NUMBER INSIDE A PHRASE WE ALREADY MATCHED IS NOT THE MEMBER'S THRESHOLD.
    "new 52w high" names a column; reporting 52 as a threshold the member chose
    would put a number in front of the model that nobody asked for.
    """
    out: List[dict] = []
    for hit in _NUMBER.finditer(_hay(prompt)):
        if any(hit.start() < m["end"] and m["start"] < hit.end() for m in skip):
            continue
        try:
            value = float(hit.group(1).replace(",", ""))
        except ValueError:                          # pragma: no cover - regex bounds it
            continue
        unit = (hit.group(2) or "").strip()
        if unit and unit != "%":
            scale = _UNIT_SCALE.get(unit)
            if scale is None:
                unit = ""
            else:
                value *= scale
        out.append({"wrote": str(prompt)[hit.start():hit.end()].strip(),
                    "value": int(value) if float(value).is_integer() else value,
                    "start": hit.start(), "end": hit.end()})
    return out


# --------------------------------------------------------------------------- #
# the plan -- ONE PURE FUNCTION, NO MODEL, NO CLOCK, NO NETWORK
# --------------------------------------------------------------------------- #

#: The header above the entries the MEMBER named. ⭐ ``CONCEPT_HEADER``'s
#: counterpart, and the difference between them is the whole point of this task:
#: that one carries the FIRM'S judgement and must be grounded and cited; this one
#: carries no judgement at all, because the member said the column's own name.
TERMS_HEADER = (
    "\nTHE MEMBER'S OWN WORDS, MATCHED TO THIS TABLE. Each line is something the "
    "member wrote and the entry of the vocabulary above that it names. Use those "
    "entries.\n")

NUMBERS_HEADER = (
    "\nTHE MEMBER'S OWN NUMBERS. Every number below was written by the member. "
    "Use each one exactly as given; do not round it, do not replace it with a "
    "threshold of your own, and do not add a threshold the member did not write.\n")


def plan(prompt: str, kind: str = INDICATOR_KIND, *,
         vocab: Optional[Mapping[str, Any]] = None,
         table: Optional[Mapping[str, Any]] = None,
         lexicon: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What this door understood, what it did not, and what the model will be told.

    ⭐ PURE. No model call, no clock, no network -- which is why the corpus rail
    can drive hundreds of real member phrasings through it for nothing, and why a
    refused word costs zero tokens.

    Returns::

        {"understood":  the text the model will be given,
         "concepts":    [{word, version}]        -- the firm's words, resolved
         "terms":       [{name, section, matched_as}] -- the manifest's own entries
         "numbers":     [{wrote, value}]         -- the member's thresholds
         "not_understood": [{phrase, clause, gate, reason}]
         "unavailable": [{phrase, name, reason}] -- a column this grammar
                        cannot express, NAMED rather than excised (see below)
         "path":        one of PLAN_PATHS,
         "briefing":    the text appended to the system prompt}

    ⛔ ``not_understood`` IS NOT A WARNING, IT IS AN EXCISION. Every clause named
    there has been REMOVED from ``understood``, so nothing in it reaches the
    model. That is what keeps "the model cannot invent a firm threshold" true
    while "the member's own number is the member's own" becomes true beside it.
    """
    lex = lexicon if lexicon is not None else (
        LEXICON if (table is None and vocab is None) else build_lexicon(table, vocab))
    text = str(prompt or "")
    found = _matches(text, lex)
    written = _numbers_in(text, found)
    clauses = _clauses(text, found + written)

    concepts_by_clause: Dict[int, List[dict]] = {}
    terms_by_clause: Dict[int, List[dict]] = {}
    refusals_by_clause: Dict[int, List[dict]] = {}
    unavailable: List[dict] = []
    excluded = _excluded(table if table is not None else ast_table.TABLE)

    def clause_of(match: dict) -> int:
        for i, (a, b) in enumerate(clauses):
            if match["start"] >= a and match["end"] <= b:
                return i
        return -1

    for match in found:
        index = clause_of(match)
        if match["kind"] == TABLE_ENTRY:
            terms_by_clause.setdefault(index, []).append(
                {"name": match["key"], "section": match["section"],
                 "matched_as": match["matched_as"]})
            continue
        # ⛔ AN ABSENT COLUMN IS NAMED, NOT EXCISED, and that is the one place
        # this differs from a refused word. A refused CONCEPT is an invitation:
        # the model can emit a threshold for "cheap" and the read-back will
        # describe it perfectly. An excluded column is not — it is TEXT, the
        # schema's enums do not contain it and this grammar has no string
        # literal, so there is no tree the model could emit that honours it.
        # Cutting the clause would throw away the rest of a request to prevent
        # something the boundary already prevents.
        if match["kind"] == EXCLUDED_ENTRY:
            unavailable.append(
                {"phrase": match["matched_as"], "name": match["key"],
                 "reason": excluded.get(match["key"], "")})
            continue
        answer = concept_vocabulary.resolve(match["key"], vocab=vocab, table=table)
        if answer["ok"]:
            concepts_by_clause.setdefault(index, []).append(
                {"word": answer["word"], "version": answer["version"],
                 "source": answer["source"]})
        else:
            refusals_by_clause.setdefault(index, []).append(
                {"phrase": match["matched_as"], "gate": answer["gate"],
                 "reason": answer["reason"]})

    kept = [i for i in range(len(clauses)) if i not in refusals_by_clause]
    not_understood: List[dict] = []
    for i in sorted(refusals_by_clause):
        clause_text = text[clauses[i][0]:clauses[i][1]].strip() if i >= 0 else text.strip()
        for item in refusals_by_clause[i]:
            not_understood.append({**item, "clause": clause_text})

    concepts = [c for i in kept for c in concepts_by_clause.get(i, [])]
    terms = [t for i in kept for t in terms_by_clause.get(i, [])]
    if -1 in kept or not refusals_by_clause:
        concepts += [c for c in concepts_by_clause.get(-1, []) if c not in concepts]
        terms += [t for t in terms_by_clause.get(-1, []) if t not in terms]

    #: ⛔ WHEN NOTHING WAS EXCISED THE MEMBER'S TEXT IS PASSED THROUGH VERBATIM.
    #: Re-joining clauses we did not touch would rewrite a request nobody asked us
    #: to rewrite, and the rewrite is invisible to the member.
    if refusals_by_clause:
        understood = ", ".join(
            text[clauses[i][0]:clauses[i][1]].strip() for i in kept
            if text[clauses[i][0]:clauses[i][1]].strip())
    else:
        understood = text.strip()

    survivor_spans = [clauses[i] for i in kept]
    numbers = [
        {"wrote": num["wrote"], "value": num["value"]}
        for num in written
        if not survivor_spans or any(a <= num["start"] and num["end"] <= b
                                     for a, b in survivor_spans)
    ]

    briefing = _KIND_BRIEF.get(kind, "")
    if concepts:
        briefing += CONCEPT_HEADER + "\n".join(
            f'  "{c["word"]}" means exactly: {c["source"]}' for c in concepts) + "\n"
    if terms:
        briefing += TERMS_HEADER + "\n".join(
            f'  "{t["matched_as"]}" -> {t["name"]}' for t in terms) + "\n"
    if numbers:
        briefing += NUMBERS_HEADER + "\n".join(
            f'  "{num["wrote"]}" -> {num["value"]}' for num in numbers) + "\n"

    if concepts and (terms or numbers):
        path = PLAN_PATHS[2]
    elif concepts:
        path = PLAN_PATHS[0]
    elif terms or numbers:
        path = PLAN_PATHS[1]
    else:
        path = PLAN_PATHS[3]

    return {
        "understood": understood,
        "concepts": [{"word": c["word"], "version": c["version"]} for c in concepts],
        "terms": terms,
        "numbers": numbers,
        "not_understood": not_understood,
        "unavailable": unavailable,
        "path": path,
        "briefing": briefing,
    }


# --------------------------------------------------------------------------- #
# the pipeline
# --------------------------------------------------------------------------- #

def _validate(tree: Any, bars: List[dict], kind: str) -> Tuple[Any, str]:
    """schema -> canonical shape -> budget -> IS IT A CONDITION -> lint -> compute.

    ⛔ THE ORDER IS LOAD-BEARING AND IT IS THE ATTRIBUTION. A tree that offends
    two stages must report the EARLIER one on every run, or a refusal measures
    traversal order instead of the guard. ``check_budget`` before ``lint_repaint``
    is what makes deleting the budget call observable: without it, an over-budget
    tree with an unreadable window comes back as a REPAINT refusal, which is a
    correct answer produced by the wrong mechanism.

    ⭐ THE SCAN STAGE LIVES INSIDE THIS FUNCTION, NOT BESIDE IT. ``_validate`` is
    the ONE validator -- a rail walks this module and asserts no other function
    reaches a guard -- so a scan check in ``propose`` would be a second
    validation path with a second set of gates to keep in step, which is the
    shape this whole module was written to retire.

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

    # ⭐ A SCAN IS `<ast> != 0` ON THE LAST CONFIRMED BAR (E-A1), so a tree that
    # produces a NUMBER is a perfectly good indicator and a wrong answer to "find
    # me stocks where...": handed back as a screen it would silently match every
    # symbol whose average is not zero, which is all of them.
    #
    # ⛔ `scan_definition.is_boolean_tree` IS CALLED, NEVER RE-DERIVED. It
    # resolves the manifest's own declaration over the tree and is E-2's single
    # Python implementation; a walk written here would be the same hand-list
    # arriving one function later, in the same language.
    if kind == SCAN_KIND and not scan_definition.is_boolean_tree(tree):
        raise _Refused(
            "scan:not-a-condition",
            "compare it to something, or save it as an indicator")

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


def _cadence_ceiling(tree: Any) -> Optional[str]:
    """How often re-running this tree can honestly say something new.

    ⛔ E-3's FUNCTION, CALLED. ``scan_evaluator.cadence_ceiling`` reads it off the
    manifest's own ``cadence`` declarations and is the ONE derivation; a
    "nightly" typed here would be a second authority the day a scalar declared
    something else. Imported inside the call because the screener package pulls
    in stores this module has no other use for.
    """
    from api.services.screener.scan_evaluator import cadence_ceiling
    return cadence_ceiling(tree)


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


def propose(prompt: str, *, user_id: Any, bars: Optional[List[dict]] = None,
            kind: str = INDICATOR_KIND) -> Dict[str, Any]:
    """English in, a canonical tree out -- or a refusal that names its door.

    ``kind`` is ``"indicator"`` (a column) or ``"scan"`` (a condition), and it
    changes exactly ONE stage inside ``_validate``. It is echoed back so the
    caller can see which question was answered.

    ``{ok: True, ast, source, sentence, repaint, freshness, cadence, kind,
    concepts, tokens, cost_usd, attempts, model}`` or ``{ok: False, reason,
    gate}``. NEVER raises, and a refusal carries NO ``ast``: a formula beside a
    refusal is a formula somebody uses.
    """
    if not isinstance(prompt, str) or not prompt.strip():
        return {"ok": False, "gate": "prompt:empty",
                "reason": REFUSALS["prompt:empty"]}
    if kind not in KINDS:
        return {"ok": False, "gate": "kind:unknown",
                "reason": f"{REFUSALS['kind:unknown']} -- {', '.join(KINDS)}"}

    # ⭐ THE LANGUAGE STAGE RUNS BEFORE A TOKEN IS SPENT. The firm's words are
    # resolved against the vocabulary file, the member's own words are matched
    # against the manifest, and any clause this door cannot honestly read is
    # EXCISED -- cheaper than a model call, and the honest answer either way.
    understanding = plan(prompt, kind)
    concepts_used = understanding["concepts"]
    briefing = understanding["briefing"]
    not_understood = understanding["not_understood"]
    understood = understanding["understood"]

    # ⛔ ONLY WHEN NOTHING SURVIVES IS THE WHOLE PROPOSAL REFUSED, and then it
    # names EVERY part it could not read rather than the first one it met. A
    # refused word used to refuse the request; now it refuses its own clause, and
    # a request that is nothing BUT refused clauses is a request with nothing left
    # to draft.
    if not understood:
        first = not_understood[0] if not_understood else None
        return {"ok": False,
                "gate": first["gate"] if first else "prompt:empty",
                "reason": first["reason"] if first else REFUSALS["prompt:empty"],
                "not_understood": not_understood,
                "unavailable": understanding["unavailable"]}

    market_date = _market_date()
    bars = list(bars or [])
    messages: List[dict] = [{"role": "user", "content": understood}]
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
            msg, in_tokens, out_tokens = _call_model(messages, briefing)
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
            ast_obj, repaint = _validate(tree, bars, kind)
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
            # ⛔ THE SECOND VERDICT, AND IT IS THE READER'S NOT A CLAIM MADE HERE.
            # The repaint linter answers a TRUE zero for a scalar leaf, so
            # `rs_rank > 80` is honestly `non-repainting` and its staleness would
            # go unsaid without this. Both are derived from the tree by the
            # shipped modules.
            "freshness": ast_freshness.freshness_for(ast_obj)["mode"],
            "cadence": _cadence_ceiling(ast_obj),
            "kind": kind,
            # ⭐ PROVENANCE, NEVER A LATE BINDING. The word and the vocabulary
            # version that expanded it; the maths is the TREE above.
            "concepts": concepts_used,
            # ⭐ AND THE OTHER HALF OF THE PROVENANCE: the manifest entries and
            # the thresholds the MEMBER named, plus the clauses this door could
            # not read and therefore never showed the model. A surface that
            # renders `not_understood` beside the read-back is telling a member
            # exactly which part of their sentence did not make it into the maths.
            "terms": understanding["terms"],
            "numbers": understanding["numbers"],
            "not_understood": not_understood,
            "unavailable": understanding["unavailable"],
            "understood": understood,
            "path": understanding["path"],
            "tokens": tokens,
            "cost_usd": round(cost_usd, 6),
            "attempts": attempts,
            "model": MODEL,
        }

    reason = last.reason if last else REFUSALS["model:no-tool"]
    gate = last.gate if last else "model:no-tool"
    # ⚠️ A PIPELINE REFUSAL STILL REPORTS WHAT THE LANGUAGE STAGE COULD NOT READ.
    # The two are different failures and a member needs both: "the assistant's
    # formula would repaint" AND "I never understood the words «cheap stocks»".
    return {"ok": False, "gate": gate, "reason": reason,
            "not_understood": not_understood,
            "unavailable": understanding["unavailable"]}
