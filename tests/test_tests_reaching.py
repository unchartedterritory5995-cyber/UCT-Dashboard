"""The reachability tool must not answer "nothing" by accident.

⛔ THE FAILURE MODE IS THE TOOL'S OWN PURPOSE INVERTED. `tools/tests_reaching.py`
exists because three things sat RED on master this session while the tests for
the edited files were green. If its graph fails to build, it returns a short
list — which reads as "small blast radius, you are fine" and is the most
dangerous output it could produce. Every case here exists to make a silent
empty answer impossible.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from tools import tests_reaching as tr

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def graph():
    return tr.build_graph()


def test_the_graph_is_not_vacuous(graph):
    """⛔ NON-VACUITY. A parse failure or a wrong root gives an empty graph and
    therefore an empty, reassuring answer."""
    importers, paths = graph
    assert len(paths) > 1500, f"only {len(paths)} modules — the walk is not finding the repo"
    edges = sum(len(v) for v in importers.values())
    assert edges > 10_000, f"only {edges} import edges — the AST walk is not resolving imports"


def test_a_widely_imported_module_reaches_many_tests(graph):
    importers, paths = graph
    tests, _ = tr.reaching([ROOT / "api/routers/screener.py"], importers, paths)
    assert len(tests) > 40, (
        f"the screener router reaches only {len(tests)} tests — implausibly few")


def test_it_finds_the_pin_that_this_tool_exists_for(graph):
    """⭐ THE REGRESSION CASE. Adding `GET /api/screener/structures` broke
    `test_scan_screener_auth.py`'s route-count pin and nobody noticed, because
    the pin lives in a file that merely IMPORTS the router. That is precisely
    the hop this tool has to make."""
    importers, paths = graph
    tests, _ = tr.reaching([ROOT / "api/routers/screener.py"], importers, paths)
    assert "tests.test_scan_screener_auth" in tests


def test_a_leaf_module_reaches_only_the_sweep_rails(graph):
    """⛔ THE DISCRIMINATION CONTROL. If everything reached everything, the tool
    would be a slow way to say "run the whole suite". A module nothing imports
    must come back with no IMPORTERS at all — only the sweeps."""
    importers, paths = graph
    tests, _ = tr.reaching([ROOT / "tools/tests_reaching.py"], importers, paths)
    sweeps = tr.sweep_rails(paths)
    assert set(tests) <= sweeps, (
        f"a module nothing imports reached non-sweep tests: {sorted(set(tests) - sweeps)}")


def test_filesystem_sweep_rails_are_always_included(graph):
    """⛔⛔ THE BLIND SPOT THAT WOULD HAVE MADE THIS TOOL WORSE THAN USELESS.
    `test_feature_flag_ledger.py` does not import the module whose flag broke
    it — it reads the source tree. An import graph says "unreachable", which is
    exactly backwards for a rail that can reach every file."""
    importers, paths = graph
    sweeps = tr.sweep_rails(paths)
    assert "tests.test_feature_flag_ledger" in sweeps
    tests, _ = tr.reaching([ROOT / "api/services/history_prewarm.py"], importers, paths)
    assert "tests.test_feature_flag_ledger" in tests, (
        "the rail that caught this session's third miss is not in the answer")


def test_the_sweep_set_is_neither_empty_nor_everything(graph):
    """An over-broad sweep rule would quietly turn every answer into the whole
    suite, which is the same as having no tool."""
    _, paths = graph
    sweeps = tr.sweep_rails(paths)
    all_tests = {m for m, p in paths.items()
                 if m.startswith("tests.") or p.name.startswith("test_")}
    assert 10 < len(sweeps) < len(all_tests) * 0.5, (
        f"{len(sweeps)} sweep rails out of {len(all_tests)} tests — the rule is "
        f"either finding nothing or swallowing the suite")


def test_relative_imports_resolve(tmp_path):
    """`from .x import y` must become a real dotted name, or a whole package's
    internal edges vanish and the graph silently under-reports."""
    pkg = ROOT / "api" / "services" / "screener"
    found = False
    for f in pkg.glob("*.py"):
        if "from ." in f.read_text(encoding="utf-8"):
            imps = tr._imports_of(f)
            assert any(i.startswith("api.services") for i in imps), (
                f"{f.name} has relative imports that resolved to nothing: {sorted(imps)[:5]}")
            found = True
            break
    if not found:
        pytest.skip("no relative imports in this package to check")
