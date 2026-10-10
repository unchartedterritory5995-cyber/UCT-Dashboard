"""S6 repaint-warning remediation — the window the member acknowledges is the window the server stores.

The browser's acknowledgement now states ``lintRepaint(tree).forward`` (``authoring/repaintWarning.js``),
e.g. ``pivothigh(high, 5, 5)`` reads 5 bars ahead. The server stamps its own per-plot verdict at save
time (``user_definitions.lint_verdict`` -> ``ast_lint.lint_definition``). These cases pin that the
Python linter measures the SAME window for the SAME trees, so the warning a member approved, the badge
persisted with the definition, and the gate that admitted it describe one fact. The JS side pins the
same numbers in ``app/src/components/chart/builder/repaintWarning.test.js``.
"""
from __future__ import annotations

import pytest

from api.services import ast_lint as al


def _s(name):
    return {"type": "series", "name": name}


def _c(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _n(value):
    return {"type": "num", "value": value}


CASES = [
    # (tree, forward, mode) — the JS linter's values for the same trees
    (_c("pivothigh", _s("high"), _n(5), _n(5)), 5, "preview-repaints"),
    (_c("pivothigh", _s("high"), _n(5), _n(1)), 1, "preview-repaints"),
    (_c("pivotlow", _s("low"), _n(3), _n(1)), 1, "preview-repaints"),
    (_c("sma", _c("pivothigh", _s("high"), _n(4), _n(4)), _n(3)), 4, "preview-repaints"),
    (_c("ema", _s("close"), _n(20)), 0, "non-repainting"),
]


@pytest.mark.parametrize("tree,forward,mode", CASES)
def test_the_server_measures_the_window_the_member_acknowledged(tree, forward, mode):
    verdict = al.lint_repaint(tree)
    assert verdict["forward"] == forward
    assert verdict["mode"] == mode


def test_a_mixed_definition_stores_each_plot_with_its_own_window():
    defn = {
        "id": "u_test_mixed", "version": 1,
        "compute": {"kind": "ast", "ast": CASES[0][0], "scanPlot": "ph",
                    "trees": {"ph": CASES[0][0], "avg": CASES[4][0], "pl": CASES[2][0]}},
        "plots": [{"key": "ph"}, {"key": "avg"}, {"key": "pl"}],
        "inputs": [],
    }
    rows = {r["plotKey"]: r for r in al.lint_definition(defn)["plots"]}
    assert {k: (r["mode"], r["forward"]) for k, r in rows.items()} == {
        "ph": ("preview-repaints", 5),
        "avg": ("non-repainting", 0),
        "pl": ("preview-repaints", 1),
    }
