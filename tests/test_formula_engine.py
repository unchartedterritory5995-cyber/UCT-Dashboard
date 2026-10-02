"""Wave 11 (lane 11B): the server's formula engine.

* Every case in the SHARED vector file (`lib/formula/formulaVectors.json`) — the
  client's `formulaEngine.vectors.test.js` reads the same file, so the two
  engines are held to one set of answers rather than to each other.
* ⛔ The no-eval rule, by AST: the engine module may never call eval / exec /
  compile / __import__ / getattr / setattr / globals / locals / vars, and may
  never import a module that can execute text. A control proves the scan sees a
  planted call.
* Engine properties the vectors cannot state compactly: refs, display/stored
  conversion, and the error position and message a member reads.
"""
from __future__ import annotations

import ast
import json
import math
from pathlib import Path

import pytest

from api.services.journal_two import formula_engine as fe

REPO = Path(__file__).resolve().parents[1]
VECTORS = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "formula" / "formulaVectors.json"
ENGINE_SRC = Path(fe.__file__)

DOC = json.loads(VECTORS.read_text(encoding="utf-8"))
CASES = DOC["cases"]


def _build(case: dict) -> str:
    if "gen" in case:
        return "".join(text * count for text, count in case["gen"])
    return case["expr"]


def run_case(case: dict, compiled: bool = False) -> dict:
    """The engine's answer for one vector: {"value": n} or {"error": code}.
    `compiled=True` runs it through `compile_ast` (the form the server uses over
    thousands of notes) instead of the tree walk."""
    text = _build(case)
    values = case.get("values", {})
    try:
        if "names" in case:
            text = fe.to_stored(text, dict(case["names"]))
        node = fe.parse(text)

        def lookup(kind, key):
            if kind != "id" or key not in values:
                raise fe.FormulaEvalError("unknown_ref", "unknown")
            v = values[key]
            if v is None:
                raise fe.FormulaEvalError("missing", "empty")
            return v

        if compiled:
            return {"value": fe.compile_ast(node)(lookup)}
        return {"value": fe.evaluate(node, lookup)}
    except (fe.FormulaError, fe.FormulaEvalError) as e:
        return {"error": e.code}


def test_the_vector_file_is_read_and_is_not_trivially_small():
    # NON-VACUITY: a parametrize over an empty list passes by running nothing.
    assert len(CASES) >= 120
    assert {"value", "error"} <= {k for c in CASES for k in c["expect"]}
    assert DOC["limits"] == {"maxLength": fe.MAX_LENGTH, "maxTokens": fe.MAX_TOKENS, "maxDepth": fe.MAX_DEPTH,
                             "maxNumberChars": fe.MAX_NUMBER_CHARS, "maxRoundPlaces": fe.MAX_ROUND_PLACES}


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_vector(case):
    got = run_case(case)
    want = case["expect"]
    if "value" in want:
        assert "value" in got, f"{case['name']}: expected {want['value']}, got error {got.get('error')}"
        assert math.isfinite(got["value"])
        assert got["value"] == want["value"], f"{case['name']}: {got['value']!r} != {want['value']!r}"
        assert math.copysign(1.0, got["value"]) == 1.0 or got["value"] != 0, "minus zero leaked"
    else:
        assert got == {"error": want["error"]}, case["name"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_vector_compiled_form_agrees(case):
    """The compiled closures are a second form of the SAME engine: every vector
    must give the identical answer through both."""
    assert run_case(case, compiled=True) == run_case(case)


# ── ⛔ the no-eval rule ──────────────────────────────────────────────────────

FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "delattr",
                   "globals", "locals", "vars", "open", "input", "breakpoint"}
FORBIDDEN_IMPORTS = {"importlib", "subprocess", "os", "sys", "pickle", "marshal", "code", "codeop",
                     "builtins", "ctypes", "runpy"}


def forbidden_constructs(source: str) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)
            if name in FORBIDDEN_CALLS and not (name == "compile" and isinstance(f, ast.Attribute)):
                found.append(f"call {name}() at line {node.lineno}")
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in FORBIDDEN_IMPORTS:
                    found.append(f"import {a.name} at line {node.lineno}")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] in FORBIDDEN_IMPORTS:
                found.append(f"from {node.module} import at line {node.lineno}")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__") and node.attr not in ("__init__",):
            found.append(f"dunder attribute .{node.attr} at line {node.lineno}")
    return found


def test_the_engine_never_evaluates_text():
    assert forbidden_constructs(ENGINE_SRC.read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("planted", [
    "eval(text)", "exec(text)", "compile(text, 'x', 'eval')", "__import__('os')",
    "getattr(node, text)", "import os", "from importlib import import_module", "x.__class__",
])
def test_CONTROL_the_scan_sees_a_planted_call(planted):
    src = ENGINE_SRC.read_text(encoding="utf-8") + f"\n\ndef _planted(text, node, x):\n    {planted}\n"
    assert forbidden_constructs(src), f"the scan missed {planted!r}"


def test_the_engine_reads_no_attribute_named_by_the_member():
    # Belt and braces beside the AST scan: a hostile word reaches no Python object.
    for word in ("__class__", "__globals__", "__builtins__", "constructor", "__proto__", "__subclasses__"):
        with pytest.raises(fe.FormulaError) as e:
            fe.parse(word)
        assert e.value.code == "unknown_name"


# ── engine properties beyond the vectors ─────────────────────────────────────

def test_refs_of_lists_each_reference_once_in_order():
    node = fe.parse("{@b} + {@a} * {@b} - if({@c} > 0, {@a}, 1)")
    assert fe.refs_of(node) == [("id", "b"), ("id", "a"), ("id", "c")]


def test_to_stored_keeps_everything_outside_the_braces():
    assert fe.to_stored("( {Exit} - {Entry} ) / 2", {"exit": "x1", "entry": "e1"}) == "( {@x1} - {@e1} ) / 2"


def test_a_parse_error_says_where_in_words():
    with pytest.raises(fe.FormulaError) as e:
        fe.parse("1 + * 2")
    assert e.value.code == "syntax"
    assert "character 5" in e.value.message


def test_an_unknown_word_tells_the_member_how_to_name_a_property():
    with pytest.raises(fe.FormulaError) as e:
        fe.parse("Entry - Stop")
    assert "{Entry}" in e.value.message


def test_round_half_away_matches_the_decimal_a_person_sees():
    for x, n, want in [(2.675, 2, 2.68), (1.45, 1, 1.5), (-0.5, 0, -1.0), (0.125, 2, 0.13), (1e-7, 7, 1e-7)]:
        assert fe._round_half_away(x, n) == want, (x, n)
