"""C19 (2026-09-30) -- the node budget counts what the evaluator computes.

The Python half of ``ast/sharedBudget.test.js``. Integrator ruling: a shared
subtree counts once where the evaluator genuinely evaluates it once; a subtree
repeated but evaluated separately counts every time; the cap is not raised.

This lane has no cross-column pass memo, so the half it owns is:
  * the same units as the JS lane, off ONE fixture (``tests/fixtures/ast/c19_units.json``);
  * a unit it does NOT share (another ``tf``/``sym`` scope, a ``self`` under a
    second recurrence) counts every time -- and RUNS every time;
  * the step memo shares by SHAPE, so a tree read back from JSON (no shared
    objects) costs the one unit per shape it is charged.
"""
import json
import pathlib
import time

from api.services import ast_interpret

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "c19_units.json"


def _num(v):
    return {"type": "num", "value": v}


def _series(n):
    return {"type": "series", "name": n}


def _op(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def _accum(seed, body, w):
    return {"type": "call", "name": "accum", "args": [seed, body, _num(w)]}


def _bars(n=60):
    out = []
    for i in range(n):
        day = 1 + i
        month = 1 + (day - 1) // 28
        dd = 1 + (day - 1) % 28
        out.append({"t": "2024-%02d-%02d" % (month, dd), "o": 100.0 + i, "h": 101.0 + i,
                    "l": 99.0 + i, "c": 100.0 + i + (i % 3), "v": 1.0 + (i % 5)})
    return out


def test_the_fixture_is_not_vacuous():
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(doc["cases"]) >= 4
    assert any(c["units"] != c["distinct"] for c in doc["cases"])


def test_every_fixture_case_counts_the_same_units_as_the_js_lane():
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in doc["cases"]:
        assert ast_interpret.node_count(case["tree"]) == case["units"], case["name"]
        assert ast_interpret.structural_maps(case["tree"])[2] == case["distinct"], case["name"]


def _counting_max(monkeypatch):
    """Count the spine's evaluations: every step of a body written with ``max``
    calls ``_POINTWISE["max"]`` once, so the call count is runs x steps."""
    calls = {"n": 0}
    real = ast_interpret._POINTWISE["max"]

    def spy(*a):
        calls["n"] += 1
        return real(*a)
    monkeypatch.setitem(ast_interpret._POINTWISE, "max", spy)
    return calls


def _run_max(tree):
    return ast_interpret.interpret(tree, _bars(), {}, None, None, {"tf": "D"})


def _acc(src="close", w=20, seed=0):
    return _accum(_num(seed), {"type": "call", "name": "max", "args": [_series("self"), _series(src)]}, w)


def test_a_repeated_accumulator_is_one_set_of_units_and_ONE_run(monkeypatch):
    tree = _op("+", _acc(), _op("*", _acc(), _num(2)))
    assert ast_interpret.node_count(tree) == ast_interpret.node_count(_acc()) + 3
    calls = _counting_max(monkeypatch)
    _run_max(_acc())
    one = calls["n"]
    assert one > 0
    calls["n"] = 0
    _run_max(tree)
    assert calls["n"] == one


def test_the_same_accumulator_under_tf_counts_twice_and_RUNS_twice(monkeypatch):
    tree = _op("-", _acc(w=3), {"type": "tf", "value": "W", "args": [_acc(w=3)]})
    assert ast_interpret.node_count(tree) == 2 * ast_interpret.node_count(_acc(w=3)) + 2
    assert ast_interpret.node_count(tree) > ast_interpret.structural_maps(tree)[2]
    calls = _counting_max(monkeypatch)
    _run_max(_acc(w=3))
    one = calls["n"]
    calls["n"] = 0
    _run_max(tree)
    assert calls["n"] > one  # the weekly child ran its own recurrence


def test_an_operator_reading_self_under_two_recurrences_counts_twice_and_RUNS_twice(monkeypatch):
    # one body shape, `max(self, close)`, under two recurrences (different seeds)
    tree = _op("-", _acc(seed=0), _acc(seed=1))
    # the operator is a computation per recurrence: +1 over distinct; the bind
    # read `self` computes nothing and, like a literal, is one unit per shape
    assert ast_interpret.node_count(tree) == ast_interpret.structural_maps(tree)[2] + 1
    calls = _counting_max(monkeypatch)
    _run_max(_acc(seed=0))
    one = calls["n"]
    calls["n"] = 0
    _run_max(tree)
    assert calls["n"] == 2 * one


def test_a_dag_spine_read_back_from_json_steps_in_linear_time():
    # The C12r DAG from SHARED objects, read back from JSON: every path its own dict.
    # Charged one unit per shape, it must COST one evaluation per shape per step;
    # keyed on id() a step walked every path (2^12 per step here).
    s = _series("self")
    for _ in range(12):
        s = _op("/", _op("+", s, s), _num(2))
    # ⛔ a JSON round trip, NOT ``copy.deepcopy``: deepcopy keeps shared
    # references shared (its memo), so the DAG would survive the copy.
    tree = json.loads(json.dumps(_accum(_num(1), s, 60)))
    assert tree["args"][1]["args"][0]["args"][0] is not tree["args"][1]["args"][0]["args"][1]
    assert ast_interpret.node_count(tree) == ast_interpret.structural_maps(tree)[2]
    assert ast_interpret.node_count(tree) < 128
    bars = _bars(120)
    started = time.perf_counter()
    col = ast_interpret.interpret(tree, bars, {}, None, None, {"tf": "D"})
    elapsed = time.perf_counter() - started
    assert col[119] == 1
    assert elapsed < 20, elapsed
