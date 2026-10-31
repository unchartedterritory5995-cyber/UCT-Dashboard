"""A table name declared after documents existed may not break one -- the Python lane.

The JS twin is ``app/src/components/chart/engine/ast/interpret.inputCompat.test.js``;
both read ``tests/fixtures/ast/input_compat_saved_documents.json`` and the frozen
roster ``tests/fixtures/ast/table_functions_before_saved_documents.json``.

``ast_interpret`` raises on an input whose key equals a table name. Pine coverage
Phase 1 declared ``acos``, ``alma``, ``percentileNearestRank`` and ``rci``; for the
names in ``closedTable.json::_functions_added_after_saved_documents`` the member's
input wins (an alert armed on such a document keeps evaluating), the function of
that name is unreachable inside the document, and every older name keeps the
strict check.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "ast"
COMPAT = json.loads((FIX / "input_compat_saved_documents.json").read_text(encoding="utf-8"))
BEFORE = json.loads((FIX / "table_functions_before_saved_documents.json").read_text(encoding="utf-8"))


def _renamed(node, src, dst):
    if not isinstance(node, dict):
        return node
    out = dict(node)
    if out.get("type") == "series" and out.get("name") == src:
        out["name"] = dst
    if isinstance(out.get("args"), list):
        out["args"] = [_renamed(a, src, dst) for a in out["args"]]
    return out


def _same(a, b):
    return len(a) == len(b) and all(
        (isinstance(x, float) and math.isnan(x) and isinstance(y, float) and math.isnan(y)) or x == y
        for x, y in zip(a, b))


@pytest.mark.parametrize("doc", COMPAT["saved"], ids=[d["input"] for d in COMPAT["saved"]])
def test_a_saved_document_whose_input_took_a_later_table_name_still_computes(doc):
    assert doc["input"] in ast_interpret.SHADOWABLE_BY_INPUT
    ours = ast_interpret.interpret(doc["ast"], COMPAT["bars"], {doc["input"]: doc["value"]})
    control = ast_interpret.interpret(_renamed(doc["ast"], doc["input"], COMPAT["control_key"]),
                                      COMPAT["bars"], {COMPAT["control_key"]: doc["value"]})
    assert _same(list(ours), list(control)), (list(ours), list(control))
    assert any(isinstance(x, (int, float)) and math.isfinite(x) for x in ours)


def test_every_compat_name_has_a_saved_document():
    assert sorted(d["input"] for d in COMPAT["saved"]) == sorted(ast_interpret.SHADOWABLE_BY_INPUT)


@pytest.mark.parametrize("name", COMPAT["old_names"])
def test_an_older_table_name_still_raises(name):
    assert name not in ast_interpret.SHADOWABLE_BY_INPUT
    with pytest.raises(ValueError, match="shadows a table name"):
        ast_interpret.interpret({"type": "series", "name": "close"}, COMPAT["bars"], {name: 1})


def test_the_function_of_that_name_is_unreachable_inside_the_document():
    d = COMPAT["call_refused"]
    with pytest.raises(ast_interpret.TableRefusal) as err:
        ast_interpret.interpret(d["ast"], COMPAT["bars"], {d["input"]: d["value"]})
    assert err.value.guard == "resolve:function"
    assert repr(d["input"]) in str(err.value)
    col = ast_interpret.interpret(d["ast"], COMPAT["bars"])
    assert any(isinstance(x, (int, float)) and math.isfinite(x) for x in col)


def test_every_table_function_is_frozen_before_or_in_the_compat_set():
    frozen = set(BEFORE["names"])
    functions = ast_interpret.TABLE["functions"]
    unaccounted = sorted(n for n in functions
                         if n not in frozen and n not in ast_interpret.SHADOWABLE_BY_INPUT)
    assert not unaccounted, (
        f"{unaccounted}: add each to closedTable.json::_functions_added_after_saved_documents.names")
    assert not (ast_interpret.SHADOWABLE_BY_INPUT & frozen)
    assert ast_interpret.SHADOWABLE_BY_INPUT <= set(functions)
    assert len(BEFORE["names"]) == 79
