"""⭐⭐ BOTH LANES READ A DECLARED LOOKBACK THE SAME WAY — MEASURED, NOT ASSUMED.

`lookback` used to be "a constant, or ONE named argument". It now also accepts a
whole MULTIPLE of an argument (``2*arg3``), which is what let `adx` be declared at
all: its first value lands on bar ``2 * period - 1`` and the old grammar could only
say ``arg3``, which UNDER-states the window.

⛔ UNDER-STATING IS THE ONE DIRECTION THAT CORRUPTS. A window declared too large
costs extra NaN at the left edge; one declared too small makes the caller fetch
fewer bars than the maths needs and answer from data it never had. `lookback` is
not decoration — `alert_user_series.lookback_for_alert` turns it into
``bars_wanted`` for LIVE alert evaluation, and the repaint linter and the budget
walker both sum it.

⛔ SO THE HAZARD IS A LANE THAT READS `2*arg3` AS `arg3`. That lane would fetch
half the bars and still return numbers — silently, on every ADX alert. A regex
typo in either implementation produces exactly that, which is why this file
compares the two ON THE SHIPPED MANIFEST rather than on hand-written examples.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import ast_interpret

TABLE_PATH = (pathlib.Path(__file__).resolve().parents[1]
              / "app/src/components/chart/engine/ast/closedTable.json")
JS_PATH = (pathlib.Path(__file__).resolve().parents[1]
           / "app/src/components/chart/engine/ast/interpret.js")

TABLE = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
FUNCTIONS = TABLE["functions"]


def _js_lookback_pattern() -> str:
    """The regex `interpret.js::ownLookback` actually uses, read off the source.

    ⛔ DERIVED, NEVER RETYPED. A copy of the pattern here would agree with itself
    forever while the shipped one drifted — the second-authority defect this repo
    repeats most.
    """
    src = JS_PATH.read_text(encoding="utf-8")
    # ⚠️ Reads the EXPORTED constant, not the call site. The pattern was inlined
    # at `ownLookback` until it was hoisted to `LOOKBACK_RE` so `parse.test.js`
    # could stop keeping its own copy — and this probe broke, correctly, the
    # moment it did. A probe pinned to one call site measures a location; this
    # one measures the declaration.
    m = re.search(r"export const LOOKBACK_RE = /\^(.+?)/\s*$", src, re.M)
    assert m, "could not find LOOKBACK_RE's pattern in interpret.js"
    return m.group(1)


def test_the_two_lanes_declare_the_same_grammar():
    """The JS pattern and the Python pattern accept the same shapes."""
    js = _js_lookback_pattern()
    py = ast_interpret._LOOKBACK_RE.pattern
    # Normalise the anchors/escapes each language spells differently.
    norm = lambda s: (s.replace(r"\Z", "").replace("$", "")
                      .replace("(?:", "(").replace("\\d", "d").replace(" ", ""))
    assert norm(js) == norm(py), (
        "the lanes accept different lookback shapes\n"
        f"  js: {js}\n  py: {py}")


@pytest.mark.parametrize("name,spec", sorted(FUNCTIONS.items()))
def test_every_declared_lookback_is_readable_by_the_python_lane(name, spec):
    """⛔ NON-VACUITY: every shipped declaration must parse, or the sweep below is
    measuring an empty set."""
    lb = spec.get("lookback")
    if isinstance(lb, (int, float)):
        return
    assert ast_interpret._LOOKBACK_RE.fullmatch(str(lb)), (
        f"{name} declares lookback {lb!r}, which this lane cannot read")


def test_a_multiple_is_read_as_a_multiple_not_as_the_bare_argument():
    """🔴 THE HAZARD, DIRECTLY. `2*arg3` must be TWICE the argument."""
    node = {"type": "call", "name": "adx", "args": [
        {"type": "series", "name": "high"},
        {"type": "series", "name": "low"},
        {"type": "series", "name": "close"},
        {"type": "num", "value": 14},
    ]}
    doubled = ast_interpret._own_lookback(node, {"lookback": "2*arg3"})
    bare = ast_interpret._own_lookback(node, {"lookback": "arg3"})
    assert bare == 14
    assert doubled == 28, (
        "a multiple was read as the bare argument — an ADX alert would fetch half "
        "the bars its maths needs and still answer")


def test_adx_is_declared_and_asks_for_twice_its_period():
    """The whole point of the grammar change, checked on the shipped manifest."""
    assert "adx" in FUNCTIONS, "adx is no longer declared"
    assert FUNCTIONS["adx"]["lookback"] == "2*arg3"
    tree = {"type": "call", "name": "adx", "args": [
        {"type": "series", "name": "high"},
        {"type": "series", "name": "low"},
        {"type": "series", "name": "close"},
        {"type": "num", "value": 14},
    ]}
    # ⭐ Through the PUBLIC measurement the budget and the alert sizer both use.
    assert ast_interpret.max_lookback(tree) == 28


def test_an_unreadable_lookback_still_refuses():
    """⛔ THE CONTROL. A grammar that accepted anything would pass every case
    above while letting a typo'd declaration through as some silent default."""
    node = {"type": "call", "name": "x", "args": [{"type": "num", "value": 5}]}
    for bad in ("arg1+arg2", "2*", "*arg1", "period", "arg", "2*argX"):
        with pytest.raises(Exception):
            ast_interpret._own_lookback(node, {"lookback": bad})
