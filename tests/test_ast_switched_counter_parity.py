"""C12s -- a SWITCHED recurrence in the Python lane, held to the JS lane's own output.

``var int n = 0`` + ``n := c ? n + 1 : 0`` is admitted by the translator as a
switched recurrence (``interpret.js::switchedVarSeed``): its window starts from an
UNKNOWN state and a bar is published only where the value came out known. A tree
that reads one is then published only where its answer does not move under the
probe values (the ROOT AGREEMENT), so ``n == 4`` is withheld where ``n`` is unknown
rather than a confident 0.

⛔ THE FIXTURE IS THE ONE AUTHORITY. ``switchedCounter.test.js`` reads the same
file, so a lane that drifts fails against the OTHER LANE'S OWN OUTPUT rather than
against a number retyped here.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "switched_counter_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _bars(n: int) -> list:
    out = []
    for i in range(n):
        c = 100 + math.sin(i / 9) * 8 + i * 0.06
        out.append({"o": c - 0.3, "h": c + 0.8, "l": c - 0.8, "c": c, "v": 100000})
    return out


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got = ai.interpret(case["ast"], _bars(doc["bars"]), {}, opts=case.get("opts"))
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other produced nothing"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) < 1e-9, f"{case['name']} bar {i}: {a} vs {b}"


def test_the_fixture_is_not_vacuous():
    cases = {c["name"]: c["expected"] for c in _doc()["cases"]}
    counter = cases["counter-w20"]
    assert sum(1 for v in counter if v is None) > 10
    assert sum(1 for v in counter if v is not None) > 200
    assert {0, 1} <= set(v for v in cases["counter-eq-4"] if v is not None)
    assert None in cases["counter-eq-4"]


def test_the_mark_is_nan_to_a_reader_that_does_not_know_it():
    seed = {"type": "op", "name": "*", "args": [
        {"type": "op", "name": "/", "args": [{"type": "num", "value": 0}, {"type": "num", "value": 0}]},
        {"type": "num", "value": 5}]}
    assert ai.switched_seed_of(seed) == {"type": "num", "value": 5}
    assert all(v is None for v in ai.interpret(seed, _bars(3), {}))
    # a plain 0/0 seed (``var float x = na``) is NOT the mark
    assert ai.switched_seed_of(seed["args"][0]) is None


def test_the_agreement_changes_the_answer_so_it_is_not_decoration():
    """⛔ CONTROL. Without the agreement the unknown bars of ``n == 4`` read a
    confident 0 -- which is exactly what the agreement exists to withhold."""
    cases = {c["name"]: c["expected"] for c in _doc()["cases"]}
    agreed, raw = cases["counter-eq-4"], cases["counter-no-agreement"]
    assert any(a is None and r == 0 for a, r in zip(agreed, raw))
