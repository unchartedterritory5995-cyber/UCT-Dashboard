"""THE CENSUS OF EVERY SERVER ``interpret`` CALL, each with a declared comparison role (engine 78 (#1858),
coordinator ruling D1). Twin of ``app/src/components/chart/engine/pineCompareCensus.test.js``.

A Pine document compares within TradingView's epsilon only when its evaluation carries ``pineCompare``
(``ast_interpret.binary_for``). Every server lane builds its own opts, so a lane that forgot it would evaluate
a Pine script with IEEE and nothing else would notice. Every call site is found by an AST walk, never a text
search, and:
  * ``pine``     the module evaluates Pine documents and must carry the rule: it names
                 ``pine_compare_opts_for`` / ``lane_opts_for`` / ``semantics_opts_for``;
  * ``inherits`` the call passes its caller's opts through (a nested evaluation, an engine its router feeds);
  * ``native``   the call evaluates a member-typed or generated native formula, never a Pine document.
"""
from __future__ import annotations

import ast
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

DECLARED = {
    "api/services/alert_user_series.py": ("pine", 2),
    "api/services/definition_record.py": ("pine", 2),
    "api/services/screener/scan_evaluator.py": ("pine", 2),
    "api/routers/screener_backtest.py": ("pine", 1),
    "api/services/screener/backtest.py": ("inherits", 1),
    # U-DAILY (e96): +2, a daily read's child on the daily bars and the tree with its leaves, both on the caller's opts
    "api/services/ast_interpret.py": ("inherits", 6),
    "api/services/definition_concierge.py": ("native", 1),
    # SETH (#2491): the fixed LIBRARY's hand-built screen trees (the persisted native shape), never a Pine document
    "api/services/setup_history_calc.py": ("native", 1),
}
LANE_NAMES = {"ast_interpret", "_lane", "_ai", "A"}


def _calls(tree: ast.AST) -> int:
    n = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Name) and f.id in ("interpret", "interpret_trees"):
            n += 1
        elif (isinstance(f, ast.Attribute) and f.attr in ("interpret", "interpret_trees")
              and isinstance(f.value, ast.Name) and f.value.id in LANE_NAMES):
            n += 1
    return n


def _census() -> dict:
    found = {}
    for p in sorted((ROOT / "api").rglob("*.py")):
        src = p.read_text("utf-8")
        if "interpret" not in src:
            continue
        n = _calls(ast.parse(src))
        if n:
            found[p.relative_to(ROOT).as_posix()] = n
    return found


def test_the_census_is_exactly_the_declared_table():
    assert _census() == {k: v[1] for k, v in DECLARED.items()}


def _uses_pine_rule(src: str) -> bool:
    """A CALL to one of the rule's readers, not a mention (an import or a comment is what a lost call leaves)."""
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)
            if name in ("pine_compare_opts_for", "lane_opts_for", "semantics_opts_for"):
                return True
    return False


def test_every_pine_lane_carries_the_documents_comparison_rule():
    for path, (role, _) in DECLARED.items():
        if role == "pine":
            assert _uses_pine_rule((ROOT / path).read_text("utf-8")), path


def test_the_census_can_fail():
    """The detector finds a call it is shown (a census that answers {} for everything proves nothing)."""
    assert _calls(ast.parse("from api.services import ast_interpret\nast_interpret.interpret(t, b)\n")) == 1
    assert _calls(ast.parse("x.interpret(t)\n")) == 0
