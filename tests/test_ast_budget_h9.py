"""H9 (2026-10-04) - ``series_refs`` counts BASE series, not clock columns or a
recurrence's own binding.

The Python half of ``budget.js::NOT_A_BASE_SERIES``. Both lanes read the SAME
fixture (``tests/fixtures/ast_budget/h9_series_refs.json``; the JS rail is
``app/src/components/chart/engine/ast/h9HostBudget.test.js``), so a count that
moves in one lane and not the other is red in exactly one of them.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api.services import ast_budget  # noqa: E402

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "ast_budget" / "h9_series_refs.json").read_text("utf-8"))


def test_every_shared_case_answers_its_expected_count():
    assert len(FIXTURE["cases"]) > 5
    for case in FIXTURE["cases"]:
        assert ast_budget.series_refs(case["tree"]) == case["expected"], case["name"]


def test_the_fixture_records_a_moved_count():
    assert any(c["before"] != c["expected"] for c in FIXTURE["cases"])


def test_the_mtf_key_levels_shape_is_inside_the_series_cap():
    case = next(c for c in FIXTURE["cases"] if c["name"].startswith("mtf-key-levels"))
    assert case["before"] > ast_budget.DEFAULT_BUDGET["maxSeriesRefs"]
    result = ast_budget.budget_result(case["tree"])
    assert result["ok"] is True
    assert result["measured"]["maxSeriesRefs"] == 4


def test_an_undeclared_name_is_still_counted():
    assert ast_budget.series_refs({"type": "series", "name": "globalThis"}) == 1


def test_nine_data_or_undeclared_names_still_refuse_budget_series():
    names = ["open", "high", "low", "close", "volume", "k1", "k2", "k3", "k4"]
    tree = {"type": "series", "name": names[0]}
    for n in names[1:]:
        tree = {"type": "op", "name": "+", "args": [tree, {"type": "series", "name": n}]}
    result = ast_budget.budget_result(tree)
    assert result["ok"] is False
    assert result["guard"] == "budget:series"

