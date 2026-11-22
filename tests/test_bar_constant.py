"""COND-TA: the one bar-constant rule's Python twin (`api/services/bar_constant.py`) gives the same
answer as the browser's `barConstantTree` on every case of the shared fixture
(`tests/fixtures/ast/bar_constant_cases.json`, also read by `barConstant.test.js`), and the
Pine-import hold asks it: a `?:` whose test is bar-constant is not a structural candidate."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import bar_constant as bc
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "ast" / "bar_constant_cases.json").read_text(encoding="utf-8"))["cases"]


def test_there_are_cases_both_ways():
    assert sum(c["constant"] for c in CASES) >= 5 and sum(not c["constant"] for c in CASES) >= 5


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_shared_fixture(case):
    assert bc.bar_constant_tree(case["tree"]) is case["constant"]


def test_the_hold_skips_a_bar_constant_test_and_keeps_a_varying_one():
    sma = {"type": "call", "name": "sma", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 3}]}
    na = {"type": "op", "name": "/", "args": [{"type": "num", "value": 0}, {"type": "num", "value": 0}]}
    weekly = {"type": "op", "name": "?:", "args": [{"type": "op", "name": "!", "args": [{"type": "series", "name": "isweekly"}]}, sma, na]}
    varying = {"type": "op", "name": "?:", "args": [{"type": "op", "name": ">", "args": [{"type": "series", "name": "close"}, {"type": "series", "name": "open"}]}, sma, na]}
    assert svc.conditional_history_candidate({"compute": {"ast": weekly}}) is False
    assert svc.conditional_history_candidate({"compute": {"ast": varying}}) is True
    # a varying ternary NESTED inside a constant one's arm is still found
    nested = {"type": "op", "name": "?:", "args": [{"type": "series", "name": "isweekly"}, varying, na]}
    assert svc.conditional_history_candidate({"compute": {"ast": nested}}) is True
