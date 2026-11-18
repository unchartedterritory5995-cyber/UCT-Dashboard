"""The server's Pine comparison (``api/services/pine_compare.py``) against TradingView's own readings.

The vectors are SHARED with the browser's rail (``app/src/components/chart/engine/pineCompare.test.js``):
one table, two implementations. Engine 78 (#1858), Q-FCMP / Q-FCMP2.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import ast_interpret as A
from api.services import pine_compare as P

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "ast" / "pine_compare_vectors.json").read_text("utf-8"))
NAN = float("nan")


def _v(x):
    return NAN if x is None else float(x)


def _code(t, a, b):
    return int(t["=="](a, b) + 2 * t["!="](a, b) + 4 * t["<"](a, b) + 8 * t["<="](a, b)
               + 16 * t[">"](a, b) + 32 * t[">="](a, b))


def test_the_server_reads_the_browsers_declarations():
    decl = P.read_pine_compare_declarations()
    assert decl == (P.PINE_EQ_EPSILON, P.PINE_EQ_INCLUSIVE)
    assert 0 < P.PINE_EQ_EPSILON < 1e-6


def test_an_unreadable_declaration_reads_as_none(tmp_path):
    assert P.read_pine_compare_declarations(tmp_path / "missing.js") is None
    bad = tmp_path / "pineCompare.js"
    bad.write_text("export const PINE_EQ_EPSILON = 1e-10\nexport const PINE_EQ_EPSILON = 2e-10\n"
                   "export const PINE_EQ_INCLUSIVE = true\n", "utf-8")
    assert P.read_pine_compare_declarations(bad) is None


def test_every_runtime_image_ships_the_js_declaration():
    """The import FAILS without the JS file (``pine_compare.py``'s header), so every image that runs Python
    must carry it: the web image is ``COPY . /app`` and the nixpacks services build from the checkout, the
    rule ``test_F2_every_runtime_image_ships_the_js_file`` pins for ``scriptEngineVersion.js``."""
    js = ROOT / "app" / "src" / "components" / "chart" / "engine" / "pineCompare.js"
    assert js.is_file()
    ignore = (ROOT / ".dockerignore")
    if ignore.is_file():
        for line in ignore.read_text("utf-8").splitlines():
            line = line.strip()
            assert line not in ("app", "app/", "app/src", "app/src/", "app/src/components", "*.js"), line


def test_the_fixture_can_tell_the_two_rules_apart():
    vs = FIXTURE["vectors"]
    assert len(vs) > 100
    exact_wrong = [v for v in vs if (_code(P.EXACT_CMP, _v(v["a"]), _v(v["b"])) != v["code"]
                                     if "code" in v else P.EXACT_CMP["=="](_v(v["a"]), _v(v["b"])) != v["eq"])]
    assert len(exact_wrong) > 30


@pytest.mark.parametrize("v", FIXTURE["vectors"], ids=[v["id"] for v in FIXTURE["vectors"]])
def test_q_fcmp_vectors(v):
    a, b = _v(v["a"]), _v(v["b"])
    if "code" in v:
        assert _code(P.PINE_CMP, a, b) == v["code"]
    else:
        assert P.PINE_CMP["=="](a, b) == v["eq"]


def test_na_falsifies_all_six_and_infinity_equals_itself():
    for op, f in P.PINE_CMP.items():
        assert f(NAN, NAN) == 0.0 and f(NAN, 1.0) == 0.0 and f(1.0, NAN) == 0.0, op
    assert P.pine_eq(math.inf, math.inf) and not P.pine_eq(-math.inf, math.inf)
    assert P.pine_compare_ambiguous(0.0, 1e-10) and not P.pine_compare_ambiguous(0.0, 1.0000000000000002e-10)
    assert not P.pine_compare_ambiguous("a", "a") and not P.pine_compare_ambiguous(True, 1)


def _tree(op, a, b):
    return {"type": "op", "name": op, "args": [{"type": "num", "value": a}, {"type": "num", "value": b}]}


BARS = [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}, {"t": 2, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]


def test_a_pine_document_compares_with_the_epsilon_and_a_native_one_exactly():
    pine = A.semantics_opts_for({"meta": {"recurrenceOrigin": "pine", "doorVersion": 9, "pineVersion": 6}})
    assert pine == {"pineCompare": True}
    assert A.binary_for(pine) is A._BINARY_PINE
    assert A.interpret(_tree("==", 1.00000000000003, 1.0), BARS, opts=pine) == [1.0, 1.0]
    assert A.interpret(_tree(">", 1.00000000000003, 1.0), BARS, opts=pine) == [0.0, 0.0]
    assert A.interpret(_tree("<=", 1e-10, 0.0), BARS, opts=pine) == [1.0, 1.0]
    assert A.semantics_opts_for({"meta": {}}) == {}
    assert A.binary_for({}) is A._BINARY
    assert A.interpret(_tree("==", 1.00000000000003, 1.0), BARS, opts={}) == [0.0, 0.0]
    assert A.interpret(_tree(">", 1.00000000000003, 1.0), BARS, opts={}) == [1.0, 1.0]


def test_an_apply_import_is_pine_maths():
    assert A.semantics_opts_for({"meta": {"importedFrom": {"dialect": "pine", "via": "apply"}}}) == {"pineCompare": True}
    assert A.pine_compare_opts_for({"meta": {"recurrenceOrigin": "pine"}}) == {"pineCompare": True}
    assert A.pine_compare_opts_for({"meta": {"semantics": 2}}) == {}


def test_the_interval_form_is_sound_on_a_grid():
    offs = [-3e-10, -1.0000000000000002e-10, -1e-10, -9e-11, -5e-11, -1e-11, -3e-14, 0.0,
            3e-14, 1e-11, 5e-11, 9e-11, 1e-10, 1.0000000000000002e-10, 3e-10]
    pts = [1.0 + d for d in offs]
    boxes = [(pts[i], pts[j]) for i in range(len(pts)) for j in range(i, len(pts))]
    checked = 0
    for table in (P.PINE_CMP, P.EXACT_CMP):
        for op in (">", "<", ">=", "<=", "==", "!="):
            for A_ in boxes[::7]:
                for B_ in boxes[::5]:
                    xs = [p for p in pts if A_[0] <= p <= A_[1]]
                    ys = [p for p in pts if B_[0] <= p <= B_[1]]
                    answers = {table[op](x, y) for x in xs for y in ys}
                    can_t, can_f = P.compare_range(op, A_, B_, table)
                    if 1.0 in answers:
                        assert can_t, (op, A_, B_)
                    if 0.0 in answers:
                        assert can_f, (op, A_, B_)
                    checked += 1
    assert checked > 1000
    assert P.compare_slack(A._BINARY) == 0.0
    assert P.compare_slack(A._BINARY_PINE) == 2 * P.PINE_EQ_EPSILON


def test_a_bind_time_fold_declines_an_ambiguous_pair():
    from api.services import ast_bind
    op = lambda name, a, b: {"type": "op", "name": name, "args": [{"type": "num", "value": a}, {"type": "num", "value": b}]}  # noqa: E731
    for name, a, b in (("==", 1.00000000000003, 1.0), (">", 0.0, 1e-10)):
        with pytest.raises(ast_bind.NotFoldable):
            ast_bind.fold_scalar(op(name, a, b), {})
    assert ast_bind.fold_scalar(op("==", 1.0, 1.0), {}) == 1.0
    assert ast_bind.fold_scalar(op("<", 0.0, 1.0000000000000002e-10), {}) == 1.0
