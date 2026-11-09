"""W9-T14a -- ONE history window (design 3.4, rulings R10 and R13).

`api/services/bars_window.HISTORY_WINDOW_BARS` is the only place the server's
"last N daily bars" is a number. Every consumer imports it. Parsed by AST, never
grepped (a grep counts prose).

R10: W5-T14's own `scan_evaluator._MAX_BARS` is REMOVED, not aliased.
R13: `snapshot_builder.DEEP_BARS` is a DIFFERENT quantity (the all-time-high
lookback behind `dist_ath_pct` / `new_ath`) and must NOT be folded in: it keeps
its own named literal, so a window change cannot redefine "all-time high".
"""
from __future__ import annotations

import ast
import importlib
import pathlib

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_WINDOW = "api/services/bars_window.py"

#: module path -> the names that must be bound to the bare name HISTORY_WINDOW_BARS
#: (an empty tuple: the module reads it inline and declares no constant of its own).
_CONSUMERS = {
    "api/services/screener/scan_evaluator.py": (),
    "api/routers/screener_backtest.py": ("MAX_BARS_PER_SYMBOL",),
    "api/services/indicator_alert_evaluator.py": ("BARS_MAX",),
    "api/services/alert_user_series.py": ("_SYMBOL_MAX_BARS", "RUNTIME_WINDOW_DATE"),
    # W9-T14: the strategy backtest route reads the window inline (design 3.4, "the T14 route")
    "api/routers/pine_strategy_backtest.py": (),
    # W9-T11-F1: the chart lane reads the window through this endpoint (design 3.4, section 9 item 6)
    "api/routers/pine_history_window.py": (),
}
_DEEP = "api/services/screener/snapshot_builder.py"
_LITERAL = 5000


def _tree(rel: str) -> ast.Module:
    return ast.parse((_ROOT / rel).read_text(encoding="utf-8"), filename=rel)


def _int_literals(tree: ast.AST, value: int) -> list[int]:
    return [n.lineno for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and type(n.value) is int and n.value == value]


def _assigns(tree: ast.AST, name: str) -> list[ast.AST]:
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id == name for t in n.targets):
                out.append(n)
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id == name:
            out.append(n)
    return out


def _imports_window_name(tree: ast.AST) -> bool:
    return any(isinstance(n, ast.ImportFrom) and n.module == "api.services.bars_window"
               and any(a.name == "HISTORY_WINDOW_BARS" and a.asname is None for a in n.names)
               for n in ast.walk(tree))


def test_the_window_module_holds_exactly_one_assignment_of_the_literal():
    tree = _tree(_WINDOW)
    all_assigns = [n for n in ast.walk(tree) if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign))]
    assert len(all_assigns) == 1, [a.lineno for a in all_assigns]
    (only,) = _assigns(tree, "HISTORY_WINDOW_BARS")
    assert isinstance(only.value, ast.Constant) and only.value.value == _LITERAL
    assert len(_int_literals(tree, _LITERAL)) == 1


@pytest.mark.parametrize("rel", sorted(_CONSUMERS))
def test_a_consumer_imports_the_window_and_never_restates_the_integer(rel):
    tree = _tree(rel)
    assert _imports_window_name(tree), f"{rel} must `from api.services.bars_window import HISTORY_WINDOW_BARS`"
    assert _int_literals(tree, _LITERAL) == [], (rel, _int_literals(tree, _LITERAL))


@pytest.mark.parametrize("rel,names", sorted(_CONSUMERS.items()))
def test_a_consumers_constants_are_bound_to_the_name_not_a_number(rel, names):
    tree = _tree(rel)
    for name in names:
        found = _assigns(tree, name)
        assert len(found) == 1, (rel, name, len(found))
        v = found[0].value
        assert isinstance(v, ast.Name) and v.id == "HISTORY_WINDOW_BARS", (rel, name, ast.dump(v))


def test_the_sweeps_private_copy_is_gone_not_aliased():
    tree = _tree("api/services/screener/scan_evaluator.py")
    assert _assigns(tree, "_MAX_BARS") == []
    assert not any(isinstance(n, ast.Name) and n.id == "_MAX_BARS" for n in ast.walk(tree))
    used = [n for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id == "HISTORY_WINDOW_BARS"
            and isinstance(n.ctx, ast.Load)]
    assert len(used) >= 2, "the sweep must READ the window where it sized its bars"


def test_DEEP_BARS_is_a_different_quantity_and_keeps_its_own_literal():
    """R13. Folding it in would let a window change redefine 'all-time high'."""
    tree = _tree(_DEEP)
    (deep,) = _assigns(tree, "DEEP_BARS")
    # its OWN literal (an int, not a name): its value is the screener owner's to move
    assert isinstance(deep.value, ast.Constant) and type(deep.value.value) is int
    assert not _imports_window_name(tree)
    assert not any(isinstance(n, ast.Name) and n.id == "HISTORY_WINDOW_BARS" for n in ast.walk(tree))


def test_at_runtime_every_consumer_sees_the_one_value():
    from api.services import bars_window
    assert bars_window.HISTORY_WINDOW_BARS == _LITERAL
    for rel, names in _CONSUMERS.items():
        mod = importlib.import_module(rel[:-3].replace("/", "."))
        assert mod.HISTORY_WINDOW_BARS is bars_window.HISTORY_WINDOW_BARS
        for n in names:
            assert getattr(mod, n) == bars_window.HISTORY_WINDOW_BARS
