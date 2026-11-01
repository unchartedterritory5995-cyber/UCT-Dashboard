"""WS-C (2026-10-31): the census capability `conditional-ta`.

A `ta.*` call WRITTEN inside a block that does not run on every bar (an if /
else / switch arm, a for / while body) or inside a user function's body keeps
its history per call site in Pine. The census names that capability so the
R1 grading gate (WS-I) can hold a script to it: a script that uses it must
declare it. The detector is a regex over the comment- and string-stripped code
(the tuple shape every FEATURES row has), made block-aware by indentation.
"""
from __future__ import annotations

import re
import time

import pytest

from tools.pine_coverage import coverage_map as cm

FID = "conditional-ta"


def _found(src: str) -> bool:
    code, _ = cm.strip_code(src)
    row = [r for r in cm.FEATURES if r[0] == FID]
    assert len(row) == 1, "exactly one conditional-ta row"
    _fid, _label, rx, fl = row[0]
    return bool(re.search(rx, code, fl))


POSITIVE = {
    "if block": "if close > open\n    x := ta.sma(close, 3)\n",
    "else arm": "if c\n    x := 1\nelse\n    x := ta.ema(close, 3)\n",
    "else if": "if c\n    x := 1\nelse if d\n    x := ta.rsi(close, 14)\n",
    "nested deeper": "if c\n    if d\n        x := ta.highest(high, 3)\n",
    "after a blank line in the block": "if c\n    y = 1\n\n    x := ta.sma(close, 3)\n",
    "value if": "x = if c\n    ta.sma(close, 3)\n",
    "switch arm": "x = switch m\n    \"a\" => ta.sma(close, 3)\n    => close\n",
    "for body": "for i = 0 to 3\n    s += ta.change(close)\n",
    "while body": "while i < 3\n    s += ta.sma(close, 3)\n    i += 1\n",
    "multi-line UDF body": "f(x) =>\n    r = ta.sma(x, 3)\n    r\n",
    "single-line UDF": "f(x) => ta.sma(x, 3)\n",
    "method body": "method m(float x) =>\n    ta.ema(x, 3)\n",
    "v4 bare name in a block": "//@version=4\nif close > open\n    x := sma(close, 3)\n",
    "tabs": "if c\n\tx := ta.sma(close, 3)\n",
}

NEGATIVE = {
    "top level only": "x = ta.sma(close, 3)\nplot(x)\n",
    "in the if CONDITION only": "if ta.crossover(a, b)\n    x := 1\n",
    "for bound only": "for i = 0 to ta.highest(3)\n    x := i\n",
    "top level after a block": "if c\n    x := 1\ny = ta.sma(close, 3)\n",
    "a continuation line at top level": "plot(a,\n     color = ta.sma(close, 3) > 0 ? color.red : na)\n",
    "commented out": "if c\n    // x := ta.sma(close, 3)\n    x := 1\n",
    "in a string": "if c\n    label.new(bar_index, high, \"ta.sma(close, 3)\")\n",
    "a method on a value (array.sum)": "if c\n    x := a.sum()\n",
    "a namespaced non-ta call": "if c\n    x := math.max(a, b)\n",
    "a ta VARIABLE (no call)": "if c\n    x := ta.tr\n",
}


@pytest.mark.parametrize("name", sorted(POSITIVE))
def test_conditional_ta_is_found(name):
    assert _found(POSITIVE[name]), name


@pytest.mark.parametrize("name", sorted(NEGATIVE))
def test_conditional_ta_is_not_found(name):
    assert not _found(NEGATIVE[name]), name


def test_it_is_a_census_capability_through_usage_of():
    """`usage_of` is what the census writes, and it reads FEATURES."""
    inv = cm.Inventory({"functions": [{"name": "ta.sma"}]})
    assert FID in cm.usage_of(POSITIVE["if block"], inv)["features"]
    assert FID not in cm.usage_of(NEGATIVE["top level only"], inv)["features"]


def test_the_scan_stays_linear_on_a_long_block():
    """Each alternative is deterministic, so a header over a long block whose
    last line has no call is rejected in linear time (no backtracking blow-up)."""
    body = "".join("    x%d := close * %d\n" % (i, i) for i in range(4000))
    src = "if c\n" + body + "y = 1\n"
    t = time.perf_counter()
    assert not _found(src)
    assert time.perf_counter() - t < 2.0
