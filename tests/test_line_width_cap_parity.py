"""ONE plot-width ceiling, client and server.

The browser's `defSchema.LINE_WIDTH_HARD_MAX` and the server's
`presentation_schema.LINE_WIDTH_HARD_MAX` refuse the same widths, by ONE fixture both
suites read: `tests/fixtures/line_width_cap.json` (the vitest twin is
`app/src/components/chart/engine/__tests__/lineWidthCapParity.test.js`).
"""
import json
import pathlib

import pytest

from api.services import presentation_schema as ps

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "line_width_cap.json").read_text(encoding="utf-8"))


def doc(case):
    width = case["width"] if case["as"] == "literal" else "$lineWidth"
    return {
        "inputs": [{"key": "lineWidth", "type": "int", "default": case["width"] if case["as"] == "input" else 2}],
        "plots": [{"key": "value", "style": "line", "color": "#2962FF", "width": width}],
    }


def test_one_value_on_both_sides():
    assert ps.LINE_WIDTH_HARD_MAX == FIXTURE["max"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[f"{c['width']}-{c['as']}" for c in FIXTURE["cases"]])
def test_the_ceiling(case):
    codes = [e["code"] for e in ps.presentation_errors(doc(case))]
    assert ("plot-width" not in codes) == case["ok"], codes


def test_a_stored_row_already_over_the_ceiling_is_grandfathered_not_refused():
    over = doc({"width": 10000, "as": "literal"})
    refused, kept = ps.new_presentation_errors(over, stored=over)
    assert refused == [] and [e["code"] for e in kept] == ["plot-width"]
