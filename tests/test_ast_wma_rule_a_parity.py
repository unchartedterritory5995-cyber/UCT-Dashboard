"""H7 (step 92) -- ``ta.wma``'s warm-up is RULE A in the Python lane too, held to
the JS lane's own output.

CAP4 Q-RT8a (``vw-rt8-runtime-followups-rddt-1d-2026-10-04``, NYSE:RDDT 1D from
the listing) measured it: a ``wma`` over a source with a hole that FOLLOWS finite
values first answers on its n-th FINITE input (W01 bar 26, W03 bar 58; the ema of
W01 on bar 30). ``ast_interpret._rolling`` and ``interpret.js::rolling`` both count
the finite inputs now.

THE FIXTURE IS THE ONE AUTHORITY. ``wmaRuleAParity.test.js`` writes and reads the
same file, so a lane that drifts fails against the OTHER LANE'S OWN OUTPUT rather
than against a number retyped here.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "wma_rule_a_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got = ai.interpret(case["ast"], doc["bars"][case["bars"]], {})
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None or (isinstance(a, float) and math.isnan(a)), \
                f"{case['name']} bar {i}: this lane produced {a} where the other withheld"
            continue
        assert a is not None and not (isinstance(a, float) and math.isnan(a)), \
            f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) < 1e-9, f"{case['name']} bar {i}: {a} vs {b}"


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_first_answer_is_the_measured_bar(case):
    got = ai.interpret(case["ast"], _doc()["bars"][case["bars"]], {})
    first = next(i for i, v in enumerate(got) if v is not None and not (isinstance(v, float) and math.isnan(v)))
    assert first == case["first"], case["name"]


def test_the_fixture_is_not_vacuous():
    cases = {c["name"]: c for c in _doc()["cases"]}
    # rule A and the old rule disagree on these two, and agree on the control
    assert cases["W01 · wma 10 · gap after 3"]["first"] == 26
    assert cases["W03 · wma 10 · bar 0 then gap"]["first"] == 58
    assert cases["control · wma 10 · no hole"]["first"] == 9
    for c in cases.values():
        assert sum(1 for v in c["expected"] if v is not None) > 20, c["name"]
