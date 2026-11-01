"""I2 WS1: lifted thinkScript weekly/monthly trees in the Python lane, held to the
JS lane's own output.

⛔ THE FIXTURE IS THE ONE AUTHORITY. ``app/.../periodLift.test.js`` writes and reads
``tests/fixtures/ast/period_lift_parity.json``. This file holds THIS lane to it at
1e-9, so a lane that drifts fails against the other lane's output, never against a
number retyped here. The JS file also checks itself against independently
aggregated weekly/monthly references, so the fixture is not two lanes agreeing on
a shared mistake. These are the trees alerts and screens evaluate server-side.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "period_lift_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _col(tree):
    got = ai.interpret(tree, _doc()["bars"], {})
    return [None if (v is None or (isinstance(v, float) and not math.isfinite(v))) else float(v) for v in got]


@pytest.mark.parametrize("k", range(6))
def test_each_lifted_tree_matches_the_other_lane_bar_for_bar(k):
    case = _doc()["cases"][k]
    got = _col(case["ast"])
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['source']} bar {i}: this lane produced {a} where the other produced nothing"
            continue
        assert a is not None, f"{case['source']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) < 1e-9 * max(1.0, abs(b)), f"{case['source']} bar {i}: {a} vs {b}"


def test_the_fixture_covers_both_period_forms_and_is_not_holes():
    doc = _doc()
    assert len(doc["cases"]) == 6
    kinds = {c["ast"]["type"] for c in doc["cases"]}
    assert {"tf", "tf_live"} <= kinds | {a["type"] for c in doc["cases"] for a in c["ast"].get("args", []) if isinstance(a, dict)}
    for case in doc["cases"]:
        assert sum(1 for v in case["expected"] if v is not None) > 150
