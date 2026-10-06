"""The post-boot research-panel warm: registered, bounded, and warming the functions the routes call.

No network: the warm loop is driven with fake surfaces, and the real surface list is only
IMPORTED (resolving each function), never called.
"""
from __future__ import annotations

import ast
from pathlib import Path

from api.services import research_panel_warm as rpw

REPO = Path(__file__).resolve().parents[1]
MAIN = REPO / "api" / "main.py"
RESEARCH_ROUTER = REPO / "api" / "routers" / "research.py"


def _main_tree() -> ast.Module:
    return ast.parse(MAIN.read_text(encoding="utf-8"))


def _called_names(node: ast.AST) -> set[str]:
    return {n.func.id for n in ast.walk(node)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}


def test_the_starter_is_defined_and_called_from_the_lifespan():
    tree = _main_tree()
    defs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    assert "_start_research_panel_warm_background" in defs
    lifespan = next(n for n in ast.walk(tree)
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    called = _called_names(lifespan)
    # Non-vacuity control: the probe sees a sibling warm starter in the same block.
    assert "_start_dashboard_warm_background" in called
    assert "_start_research_panel_warm_background" in called


def test_the_starter_imports_the_warm_function():
    tree = _main_tree()
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "_start_research_panel_warm_background")
    imported = {(n.module, a.name) for n in ast.walk(fn) if isinstance(n, ast.ImportFrom)
                for a in n.names}
    assert ("api.services.research_panel_warm", "warm_research_panels") in imported


def test_every_surface_resolves_to_a_real_function():
    names = [n for n, _ in rpw._surfaces()]
    assert names == ["estimates", "consensus", "financial_history",
                     "analyst_ratings", "ownership", "ratings"]


def test_the_warmed_functions_are_the_ones_the_research_routes_call():
    """A warmed entry is only useful if the route reads the same cache: warm the route's own
    function, never a private build."""
    tree = ast.parse(RESEARCH_ROUTER.read_text(encoding="utf-8"))
    # Every name the route LOADS (a call, or a function handed to ex.submit), never prose.
    used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    assert "get_snapshot" in used or "get_comparison" in used     # control: the probe sees names
    for fn in ("get_estimates", "get_consensus", "get_history",
               "get_analyst_ratings", "get_ownership", "get_ratings"):
        assert fn in used, fn


def test_the_priority_list_is_small_and_holds_no_funds():
    assert 0 < len(rpw.PRIORITY_SYMBOLS) <= 15
    assert not {"SPY", "QQQ", "IWM", "DIA"} & set(rpw.PRIORITY_SYMBOLS)
    assert "TSM" in rpw.PRIORITY_SYMBOLS


def test_warm_calls_every_surface_per_symbol_and_paces_between_symbols():
    calls, sleeps = [], []
    surfaces = [("a", lambda s: calls.append(("a", s))), ("b", lambda s: calls.append(("b", s)))]
    stats = rpw.warm_research_panels(["X", "Y", "Z"], pace_seconds=2.0, surfaces=surfaces,
                                     sleep=sleeps.append, clock=lambda: 0.0)
    assert calls == [("a", "X"), ("b", "X"), ("a", "Y"), ("b", "Y"), ("a", "Z"), ("b", "Z")]
    assert sleeps == [2.0, 2.0]          # between symbols, never before the first
    assert stats == {"symbols": 3, "ok": 6, "failed": 0, "stopped": None}


def test_a_failing_surface_costs_itself_not_the_pass():
    def boom(_s):
        raise RuntimeError("vendor down")
    seen = []
    stats = rpw.warm_research_panels(["X", "Y"], surfaces=[("bad", boom), ("ok", seen.append)],
                                     sleep=lambda _s: None, clock=lambda: 0.0)
    assert seen == ["X", "Y"]
    assert stats["failed"] == 2 and stats["ok"] == 2


def test_the_budget_stops_the_pass():
    t = iter([0.0, 0.0, 10.0, 999.0, 999.0])
    seen = []
    stats = rpw.warm_research_panels(["X", "Y", "Z"], budget_seconds=60.0,
                                     surfaces=[("s", seen.append)],
                                     sleep=lambda _s: None, clock=lambda: next(t))
    assert seen == ["X", "Y"]
    assert stats["stopped"] == "budget"
