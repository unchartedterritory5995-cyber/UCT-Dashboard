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

from api.services import ast_interpret, ast_lint

TABLE_PATH = (pathlib.Path(__file__).resolve().parents[1]
              / "app/src/components/chart/engine/ast/closedTable.json")
# ⚠️ `parse.js`, not `interpret.js`: the grammar lives with the TABLE so the
# repaint linter can read it without importing an evaluator — a boundary
# `lint.test.js` enforces ("its import graph is one module wide").
JS_PATH = (pathlib.Path(__file__).resolve().parents[1]
           / "app/src/components/chart/engine/ast/parse.js")

TABLE = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
FUNCTIONS = TABLE["functions"]


def _js_lookback_pattern() -> str:
    """The regex the shipped grammar declares, read off `parse.js`.

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
    assert m, "could not find LOOKBACK_RE's pattern in parse.js"
    return m.group(1)


def test_the_two_lanes_declare_the_same_grammar():
    """⛔ THREE COPIES, NOT TWO — AND THE THIRD IS WHY THIS CASE GREW.

    `parse.js::LOOKBACK_RE` and `ast_interpret._LOOKBACK_RE` were compared here
    from the start. `ast_lint._ARG_REF` is a THIRD hand-written copy of the same
    grammar — the linter may not import either of the others (its import set is
    pinned to the standard library), so it must hold its own — and it was never
    read here. It stayed on the narrow `^arg(\\d+)$` for the whole life of the
    `2*argN` grammar, which made the Python repaint linter answer `repaints` for
    `adx(high, low, close, 14)` while every other reader answered 28. Two agreeing
    copies is precisely what made the third invisible.
    """
    js = _js_lookback_pattern()
    py = ast_interpret._LOOKBACK_RE.pattern
    lint = ast_lint._ARG_REF.pattern
    # Normalise the anchors/escapes each language spells differently.
    norm = lambda s: (s.replace(r"\Z", "").replace("$", "").replace("^", "")
                      .replace("(?:", "(").replace("\\d", "d").replace(" ", ""))
    assert norm(js) == norm(py), (
        "the lanes accept different lookback shapes\n"
        f"  js: {js}\n  py: {py}")
    assert norm(lint) == norm(py), (
        "the Python LINTER accepts a different lookback shape from the Python "
        "INTERPRETER, so one of them bounds a window the other does not\n"
        f"  lint: {lint}\n  interpret: {py}")


def test_every_reader_resolves_a_MULTIPLIED_window_to_the_same_number():
    """⛔ THE PATTERNS MATCHING IS NOT THE SAME CLAIM AS THE READERS AGREEING.

    A copy could carry the right pattern and read the wrong capture group — which
    is exactly the shape of the bug, one level down. So this asks both readers for
    the NUMBER, on the shipped declaration that carries a multiplier.
    """
    tree = {"type": "call", "name": "adx", "args": [
        {"type": "series", "name": "high"},
        {"type": "series", "name": "low"},
        {"type": "series", "name": "close"},
        {"type": "num", "value": 14},
    ]}
    assert ast_interpret.max_lookback(tree) == 28
    assert ast_lint.max_lookback(tree) == 28
    assert ast_lint.lint_repaint(tree)["mode"] == "non-repainting", (
        "the repaint linter cannot bound a multiplied window, so it brands a "
        "correct indicator `repaints` — which `definition_concierge` refuses "
        "outright (`lint:repaint`) and `user_definitions.lint_verdict` STORES, "
        "leaving an alert that saved in the browser and can never arm. "
        "⛔ NOT `canSaveFormula`: that is the browser's gate on the browser's "
        "linter, and it would have permitted the save")


@pytest.mark.parametrize("name,spec", sorted(FUNCTIONS.items()))
def test_every_declared_lookback_is_readable_by_the_python_lane(name, spec):
    """⛔ NON-VACUITY: every shipped declaration must parse, or the sweep below is
    measuring an empty set.

    ⚠️ IT ASKS THE READERS, NOT THE REGEX. `lookback: "session"` is a legal
    declaration that no regex here matches — it names a window rather than
    measuring one — so a probe pinned to `_LOOKBACK_RE` would have gone red on the
    first session-anchored entry to ship, for a declaration both lanes read
    perfectly well.
    """
    lb = spec.get("lookback")
    if isinstance(lb, (int, float)):
        return
    if lb == ast_interpret.SESSION_LOOKBACK:
        assert ast_lint._resolve_declaration(lb, []) == ast_interpret.SESSION_MAX_BARS
        return
    assert ast_interpret._LOOKBACK_RE.fullmatch(str(lb)), (
        f"{name} declares lookback {lb!r}, which this lane cannot read")
    assert ast_lint._ARG_REF.match(str(lb)), (
        f"{name} declares lookback {lb!r}, which the repaint LINTER cannot read — "
        "it will brand every tree calling it `repaints`")


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
