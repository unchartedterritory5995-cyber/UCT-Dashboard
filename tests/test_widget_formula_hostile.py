"""Task 10.2: hostile input never escapes as anything but a FormulaError, and the module cannot
execute text.

* Every hostile vector in the shared file compiles or raises `FormulaError` with the exact code
  and position the file states, never another class, never `RecursionError`, each in under 50 ms.
* A seeded soup of 2,000 random formulas over the dialect's own token alphabet: the same promise.
* `__proto__`, `constructor` and friends are ordinary unknown names, never a lookup.
* An AST walk of `widget_formula.py` proves no dynamic execution, with a planted control that the
  same walk must catch.
"""
from __future__ import annotations

import ast
import random
import time
from pathlib import Path

import pytest

from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine.plan import PlanError
from tests.test_widget_formula_vectors import DOC, FIELDS, build, decode

BUDGET_S = 0.050


def _attempt(expr: str):
    """(compiled | None, error | None, seconds). Any exception other than FormulaError escapes."""
    t0 = time.perf_counter()
    try:
        c = wf.compile_formula(expr, FIELDS)
        return c, None, time.perf_counter() - t0
    except wf.FormulaError as e:
        return None, e, time.perf_counter() - t0


def _best_of_three(expr: str):
    """The 50 ms bound is about the algorithm, not a busy box: take the fastest of three runs."""
    runs = [_attempt(expr) for _ in range(3)]
    return min(runs, key=lambda r: r[2])


@pytest.mark.parametrize("v", DOC["hostile"], ids=[f"{i}:{v['name']}" for i, v in
                                                     enumerate(DOC["hostile"])])
def test_hostile_strings_raise_only_formula_error(v):
    expr = build(v)
    c, e, secs = _best_of_three(expr)
    assert secs < BUDGET_S, f"{secs * 1000:.1f} ms"
    if v["ok"]:
        assert e is None, (e.code, e.pos, e.sentence)
        assert c.canonical == v["canonical"]
    else:
        assert c is None, c.canonical
        assert (e.code, e.pos) == (v["code"], v["pos"])
        assert isinstance(e, PlanError) and str(e) == e.sentence
        assert not any(slot in e.sentence for slot in ("{x}", "{label}", "{Fn}", "{n}", "{what}"))


def test_hostile_vectors_cover_the_named_classes():
    """Non-vacuity: the hostile list really carries what the brief names."""
    exprs = [build(v) for v in DOC["hostile"]]
    joined = "\n".join(e for e in exprs if len(e) < 5000)
    for needle in ('"', "--", ";", "$.", "%", "_", "\\", "\u0000", "‮", "［",
                   "__proto__", "constructor", "toString", chr(0xD800)):
        assert needle in joined, needle
    assert any(e == "(" * 10000 for e in exprs)
    assert any(len(e) >= 1_000_000 for e in exprs)


def test_hostile_rows_cannot_reach_a_prototype():
    """A row is read by key, so a row carrying `__proto__` or `constructor` is just data."""
    c = wf.compile_formula("[setup] = \"x\"", FIELDS)
    for row in ({"__proto__": {"setup": "x"}}, {"constructor": "x"}, {"setup": "__proto__"}):
        assert wf.eval_row(c, row) in (None, False)


# ---------------------------------------------------------------------------------------------

ALPHABET = (
    ["[net]", "[risk $]", "[r]", "[setup]", "[had_stop]", "[day]", "[mistake]", "[hold minutes]",
     "[nope]", "[", "]", "[__proto__]"]
    + ["0", "1", "2.5", "-", "+", "*", "/", "=", "<>", "<", "<=", ">", ">=", "(", ")", ",",
       "\"Gap\"", "\"\"", "\"", "TRUE", "false", " ", "\n", "\t"]
    + list(wf.FUNCTIONS) + ["sumif", "ROUND", "foo", "1e5", ".", "$", "%", "'", "‮",
                            "［", "\U0001F600", "\u0000"]
)


_LEAVES = ["[net]", "[risk $]", "[r]", "[hold minutes]", "1", "2.5", "0", "-1"]
_BOOLS = ["[had_stop]", "TRUE", "false"]


def _grammar(rng: random.Random, depth: int) -> str:
    """A mostly-valid number formula, so the soup reaches the type checker and the evaluator
    and not only the tokenizer."""
    if depth <= 0 or rng.random() < 0.3:
        return rng.choice(_LEAVES)
    pick = rng.random()
    if pick < 0.3:
        return f"{_grammar(rng, depth - 1)} {rng.choice('+-*/')} {_grammar(rng, depth - 1)}"
    if pick < 0.45:
        return f"({_grammar(rng, depth - 1)})"
    if pick < 0.6:
        cond = f"{_grammar(rng, depth - 1)} {rng.choice(['=', '<>', '<', '<=', '>', '>='])} 0"
        return f"If({rng.choice([cond, rng.choice(_BOOLS)])}, {_grammar(rng, depth - 1)}, {_grammar(rng, depth - 1)})"
    if pick < 0.75:
        return f"{rng.choice(['Min', 'Max'])}({_grammar(rng, depth - 1)}, {_grammar(rng, depth - 1)})"
    if pick < 0.85:
        return f"{rng.choice(['Abs', 'Round', '-'])}({_grammar(rng, depth - 1)})"
    return f"SumIf({_grammar(rng, 0)}, {_grammar(rng, 0)} > 0)"


def _soup(rng: random.Random) -> str:
    kind = rng.random()
    if kind < 0.4:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 40)))
    expr = _grammar(rng, rng.randint(1, 6))
    if kind < 0.7:
        return expr
    # A valid formula with one random edit: the near-misses a member actually types.
    i = rng.randint(0, len(expr))
    if rng.random() < 0.5:
        return expr[:i] + rng.choice(ALPHABET) + expr[i:]
    return expr[:i] + expr[i + 1:]


def test_random_token_soup_2000():
    rng = random.Random(102)
    outcomes = {"ok": 0, "err": 0}
    codes: set[str] = set()
    for _ in range(2000):
        expr = _soup(rng)
        try:
            c = wf.compile_formula(expr, FIELDS)
        except wf.FormulaError as e:
            outcomes["err"] += 1
            codes.add(e.code)
            assert 0 <= e.pos <= len(expr), (expr, e.pos)
            assert e.code in wf.ERRORS and e.sentence
            continue
        outcomes["ok"] += 1
        # A soup formula that compiles also evaluates, and never to NaN or Infinity.
        row = decode(DOC["rowsets"]["book"][0])
        out = wf.eval_row(c, row) if c.kind == "row" else wf.eval_group(c, [row, row])
        assert out is None or isinstance(out, (bool, str)) or (
            isinstance(out, float) and out == out and out not in (float("inf"), float("-inf")))
        assert wf.compile_formula(c.canonical, FIELDS).canonical == c.canonical
    # Non-vacuity: the soup is not all one answer.
    assert outcomes["ok"] > 400 and outcomes["err"] > 800, outcomes
    assert len(codes) >= 10, codes


def test_proto_and_constructor_are_unknown_fields():
    for name in ("__proto__", "constructor", "toString", "hasOwnProperty", "valueOf",
                 "prototype", "__class__", "__dict__"):
        with pytest.raises(wf.FormulaError) as ei:
            wf.compile_formula(f"[{name}]", FIELDS)
        assert ei.value.code == "unknown_field" and ei.value.pos == 0
        assert ei.value.sentence == f"[{name}] isn't a field here."
    for name in ("constructor", "toString", "valueOf", "eval", "exec", "getattr", "Function"):
        with pytest.raises(wf.FormulaError) as ei:
            wf.compile_formula(f"{name}(1)", FIELDS)
        assert ei.value.code == "unknown_function"


def test_deep_nesting_is_refused_by_the_counter_not_the_stack():
    """The depth counter answers first: the parser never recurses past MAX_DEPTH."""
    import sys
    old = sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(400)  # far below what an unbounded descent of 1,999 would need
        for expr in ("(" * 1999, "Abs(" * 499, "If(TRUE, " * 200):
            with pytest.raises(wf.FormulaError) as ei:
                wf.compile_formula(expr, FIELDS)
            assert ei.value.code in ("too_deep", "too_long"), ei.value.code
        # 32 levels still compile under the same tight limit.
        wf.compile_formula("Abs(" * 32 + "1" + ")" * 32, FIELDS)
    finally:
        sys.setrecursionlimit(old)


def test_recursion_error_is_a_too_deep_backstop(monkeypatch):
    def boom(*_a, **_k):
        raise RecursionError
    monkeypatch.setattr(wf, "_check", boom)
    with pytest.raises(wf.FormulaError) as ei:
        wf.compile_formula("1", FIELDS)
    assert ei.value.code == "too_deep"


def test_non_string_input_is_a_formula_error():
    for bad in (None, 5, ["1"], {"expr": "1"}, b"1"):
        with pytest.raises(wf.FormulaError) as ei:
            wf.compile_formula(bad, FIELDS)
        assert ei.value.code == "empty"


# ---------------------------------------------------------------------------------------------

FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "globals",
                   "locals", "vars", "delattr"}
FORBIDDEN_MODULES = {"importlib", "subprocess", "os", "sys", "pickle", "marshal", "ctypes",
                     "builtins", "socket", "sqlite3", "io", "pathlib", "time", "random"}
ALLOWED_IMPORTS = {"__future__", "math", "bisect", "dataclasses", "datetime", "typing",
                   "api.services.journal_two.widget_engine.plan"}


def _violations(source: str) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name in FORBIDDEN_CALLS:
                found.append(f"call {name} at line {node.lineno}")
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in FORBIDDEN_MODULES or a.name not in ALLOWED_IMPORTS:
                    found.append(f"import {a.name}")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] in FORBIDDEN_MODULES or node.module not in ALLOWED_IMPORTS:
                found.append(f"from {node.module} import")
        elif isinstance(node, ast.Name) and node.id in ("__builtins__", "__import__"):
            found.append(f"name {node.id}")
    return found


def test_no_dynamic_execution():
    source = Path(wf.__file__).read_text(encoding="utf-8")
    assert _violations(source) == []


def test_the_no_eval_walk_catches_a_planted_call():
    planted = [
        "def f(s):\n    return eval(s)\n",
        "import importlib\n",
        "def f(o, n):\n    return getattr(o, n)\n",
        "from os import path\n",
        "x = __builtins__\n",
        "def f(s):\n    return compile(s, 'x', 'eval')\n",
    ]
    for snippet in planted:
        assert _violations(snippet), snippet
    assert _violations("import math\nx = math.floor(1.5)\n") == []
