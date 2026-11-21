"""Q-BH0 (engine 92): a Pine v6 bool's history before history begins reads ``false``, in the Python lane.

TradingView's captures ``vw-v6-bool-history-bar0-{spy,rddt}-1d-2026-11-19`` (committed) draw ``b[1] == false`` as 1 on
bar 0 (and ``b[2] == false`` on bars 0 and 1): a v6 bool is never ``na`` ("To Pine Script version 6": "Boolean values
cannot be na"). The columnar lane writes a v6 bool's written ``x[k]`` as ``na(close[k]) ? 0 : x[k]``
(``app/.../ast/pine.js::v6BoolHistory``): false exactly on the first ``k`` bars, the read itself on every later bar. No
new node type and no new rule here: this lane evaluates ``?:``, ``na`` and ``close[k]`` as ``interpret.js``
does, and this rail holds it to that.

THE FIXTURE IS THE ONE AUTHORITY: ``tests/fixtures/ast/v6_bool_history_parity.json`` holds the bars, the trees and the
values; the JS rail (``vendorHarness.qbh0BoolHistory.test.js``) checks that the translator writes those very trees and
that ``interpret.js`` computes those values.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "v6_bool_history_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _na(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))


@pytest.mark.parametrize("case", sorted(_doc()["cases"]))
def test_the_python_lane_computes_the_fixture_values_bar_for_bar(case):
    doc = _doc()
    c = doc["cases"][case]
    got = list(ai.interpret(c["ast"], doc["bars"], {}))
    want = c["expected"]
    assert len(got) == len(want)
    for i, (a, b) in enumerate(zip(got, want)):
        if b is None:
            assert _na(a), f"{case} bar {i}: this lane drew {a} where the other draws na"
            continue
        assert not _na(a), f"{case} bar {i}: this lane drew na where the other draws {b}"
        assert a == b, f"{case} bar {i}: {a} vs {b}"


def test_the_rule_is_false_only_before_history_and_the_v5_read_keeps_na():
    """Non-vacuous: the v6 tree differs from the v5 read exactly on the bars before history begins."""
    doc = _doc()
    v6 = list(ai.interpret(doc["cases"]["v6_k1"]["ast"], doc["bars"], {}))
    v5 = list(ai.interpret(doc["cases"]["v5_k1"]["ast"], doc["bars"], {}))
    assert v6[0] == 0 and _na(v5[0])
    assert v6[1:] == v5[1:]
