"""E-3 — the sweep is ABSENT from the request path, and the gate is REACHABILITY.

🔴 THE 524 CLASS, AND WHY A BOUND IS NOT ENOUGH.

`main.py` sets `limiter.total_tokens = 64` and the Signature routes are `sync def`,
so each holds one of 64 shared anyio threads for its full duration. A universe
screen is ~2-8 s of pure-Python CPU (GT §2.3, LOCAL) and it is GIL-bound (GT
§2.4), so it degrades EVERY handler on the pod for those seconds — not just its
own slot. `/confluence-scan` was a ten-minute request on one anyio worker; that is
the 2026-07-01 outage.

E-3's rule is STRONGER than `/confluence-scan`'s four bounds, which bound a
REQUEST. Here a member request NEVER triggers an evaluation at all, so the honest
instrument is a REACHABILITY CENSUS: walk every mounted route's endpoint, build
the call graph by AST, and assert `scan_evaluator`'s entry points appear in NO
handler's transitive closure.

⛔ THE COUNT OF HANDLERS WALKED IS ASSERTED. A hand-listed path set let two paid
Signature endpoints ride uncovered in Phase C, and a census that walked ZERO
routes would pass this the same way.

⛔ AST, NEVER GREP. `lesson_probe_names_must_be_derived_not_typed`: a grep on this
branch reported five call sites and all five were prose.

⚠️ THE GRAPH IS BUILT ONCE AND THE QUESTION IS ASKED BACKWARDS. Walking a forward
closure per handler re-parses the whole `api/` tree for every one of ~300
endpoints. Instead the call graph is built once, the functions that TOUCH the
subject are marked, and the mark is propagated along reversed edges to a fixpoint
— so "can this handler reach it" is a set membership. Same answer, one pass.
"""
from __future__ import annotations

import ast as pyast
import collections
import pathlib

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_API = _ROOT / "api"

#: The module whose entry points must be unreachable, and the entry points.
_SUBJECT = "api.services.screener.scan_evaluator"
_ENTRY_POINTS = ("evaluate_one", "run_sweep", "sweep_job", "definitions_to_sweep")


# ═══ the module index, DERIVED from the filesystem ══════════════════════════

def _module_files() -> dict:
    out = {}
    for path in _API.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(_ROOT).with_suffix("")
        parts = list(rel.parts)
        if parts[-1] == "__init__":
            parts = parts[:-1]
        out[".".join(parts)] = path
    return out


_MODULES = _module_files()
_PARSED: dict = {}
_INFO: dict = {}


def _parse(name: str, overlay: dict):
    if name in overlay:
        return pyast.parse(overlay[name])
    if name in _PARSED:
        return _PARSED[name]
    path = _MODULES.get(name)
    tree = None
    if path is not None:
        try:
            tree = pyast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):        # pragma: no cover
            tree = None
    _PARSED[name] = tree
    return tree


def _resolve_from(node: pyast.ImportFrom, pkg: str) -> str:
    """`from . import x` and `from ..y import z`, resolved against the package."""
    if not node.level:
        return node.module or ""
    parts = pkg.split(".")
    base = parts[: len(parts) - (node.level - 1)] if node.level > 1 else parts
    return ".".join([p for p in base if p] + ([node.module] if node.module else []))


def _alias_map(nodes, pkg: str) -> dict:
    """``{local name: dotted target}`` for a batch of import statements."""
    out = {}
    for node in nodes:
        if isinstance(node, pyast.Import):
            for a in node.names:
                out[a.asname or a.name.split(".")[0]] = (
                    a.name if a.asname else a.name.split(".")[0])
        elif isinstance(node, pyast.ImportFrom):
            base = _resolve_from(node, pkg)
            for a in node.names:
                if a.name == "*":
                    continue
                out[a.asname or a.name] = f"{base}.{a.name}" if base else a.name
    return out


def _module_info(name: str, overlay: dict) -> dict:
    """``{aliases, functions}`` — module-level import aliases and every function.

    ⚠️ MODULE-LEVEL IMPORTS ARE SEPARATED FROM FUNCTION-LOCAL ONES. This repo
    imports lazily inside functions constantly (`bars_fetch` is heavy, the
    interpreter/budget pair is an import cycle), so a census that read only the
    top of a file would miss the most common shape a handler would use.
    """
    if not overlay and name in _INFO:
        return _INFO[name]
    tree = _parse(name, overlay)
    if tree is None:
        info = {"aliases": {}, "functions": {}}
    else:
        inside = set()
        functions = {}
        for fn in pyast.walk(tree):
            if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
                functions.setdefault(fn.name, fn)
                for n in pyast.walk(fn):
                    inside.add(id(n))
        top = [n for n in pyast.walk(tree)
               if isinstance(n, (pyast.Import, pyast.ImportFrom))
               and id(n) not in inside]
        pkg = name.rsplit(".", 1)[0] if "." in name else name
        info = {"aliases": _alias_map(top, pkg), "functions": functions}
    if not overlay:
        _INFO[name] = info
    return info


def _dotted(func) -> str:
    parts = []
    node = func
    while isinstance(node, pyast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, pyast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return ""


def _longest_module_prefix(dotted: str, overlay: dict):
    parts = dotted.split(".")
    for i in range(len(parts), 0, -1):
        head = ".".join(parts[:i])
        if head in _MODULES or head in overlay:
            return head, parts[i:]
    return None, []


def _refs_and_callees(module: str, func: str, overlay: dict) -> tuple:
    """``(api names this function references, (module, func) it calls)``.

    IMPORTS **and** CALLS: an import at the top of this function's module, an
    import inside the function itself, and every call whose callee resolves into
    an `api.*` module.
    """
    info = _module_info(module, overlay)
    node = info["functions"].get(func)
    if node is None:
        return set(), set()
    pkg = module.rsplit(".", 1)[0] if "." in module else module
    aliases = dict(info["aliases"])
    aliases.update(_alias_map(
        [n for n in pyast.walk(node)
         if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg))

    refs = {t for t in aliases.values() if t.startswith("api.")}
    callees = set()
    for call in [n for n in pyast.walk(node) if isinstance(n, pyast.Call)]:
        dotted = _dotted(call.func)
        if not dotted:
            continue
        parts = dotted.split(".")
        head, rest = parts[0], parts[1:]
        if not rest and head in info["functions"]:
            callees.add((module, head))
            continue
        target = aliases.get(head)
        if target is None:
            continue
        full = ".".join([target] + rest)
        if not full.startswith("api."):
            continue
        refs.add(full)
        mod, attr = _longest_module_prefix(full, overlay)
        if mod and attr:
            callees.add((mod, attr[0]))
    return refs, callees


def _touches_subject(refs) -> bool:
    return any(r == _SUBJECT or r.startswith(_SUBJECT + ".") for r in refs)


_REACHERS: set = set()
_GRAPH: dict = {}


def _build_graph():
    """Every `api.*` function's refs and callees, then the BACKWARD closure of
    everything that can reach the subject."""
    if _GRAPH:
        return
    for module in _MODULES:
        if module == _SUBJECT:
            continue
        for func in _module_info(module, {})["functions"]:
            _GRAPH[(module, func)] = _refs_and_callees(module, func, {})
    callers = collections.defaultdict(set)
    frontier = []
    for node, (refs, callees) in _GRAPH.items():
        for callee in callees:
            callers[callee].add(node)
        if _touches_subject(refs):
            frontier.append(node)
    _REACHERS.update(frontier)
    while frontier:
        node = frontier.pop()
        for caller in callers.get(node, ()):
            if caller not in _REACHERS:
                _REACHERS.add(caller)
                frontier.append(caller)


def _endpoints_from_router_routes() -> list:
    """Every mounted route's endpoint, as ``(module, function, path)``.

    ⛔ DERIVED FROM THE ROUTE TABLE, NEVER TYPED. A route that is not mounted
    answers 200 SPA HTML rather than 404, so "the endpoint exists" has to be
    checked against `app.routes` — the artifact the server actually dispatches on.
    """
    from api.main import app

    out = []
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        module = getattr(endpoint, "__module__", "")
        name = getattr(endpoint, "__name__", "")
        if not module.startswith("api.") or not name:
            continue
        out.append((module, name, getattr(route, "path", "")))
    return out


def _transitive_imports_and_calls(handler, overlay=None) -> bool:
    """Can this handler reach the subject? ⛔ The answer, not a set — the set was
    a per-handler forward closure that re-parsed `api/` three hundred times."""
    overlay = overlay or {}
    _build_graph()
    module, func = handler[0], handler[1]
    seen = set()
    stack = [(module, func)]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        if node in _REACHERS:
            return True
        refs, callees = (_refs_and_callees(node[0], node[1], overlay)
                         if node[0] in overlay else _GRAPH.get(node, (set(), set())))
        if _touches_subject(refs):
            return True
        stack.extend(callees)
    return False


# ═══ the gate ═══════════════════════════════════════════════════════════════

def test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes():
    """🔴 M8. A member request never triggers an evaluation — not bounded on the
    request path, ABSENT from it."""
    handlers = _endpoints_from_router_routes()
    assert len(handlers) > 100, f"the census walked {len(handlers)} handlers"

    offenders = [f"{h[2]} -> {h[0]}::{h[1]}" for h in handlers
                 if _transitive_imports_and_calls(h)]
    assert not offenders, (
        "these route handlers can reach the universe sweep:\n  "
        + "\n  ".join(offenders)
        + "\nA universe screen is 2-8 s of GIL-bound pure-Python CPU on a pod "
          "with 64 shared anyio threads. That is the 2026-07-01 outage.")


@pytest.mark.parametrize("source,expected", [
    # a DIRECT call from the handler
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.evaluate_one({}, 'D')\n", True),
    # the import alone, at module level — still in this module's namespace
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return 1\n", True),
    # a LAZY import inside the handler, which a module-level scan would miss
    ("def handler():\n"
     "    from api.services.screener.scan_evaluator import run_sweep\n"
     "    return run_sweep([])\n", True),
    # ⛔ TRANSITIVE — through a helper in the same module
    ("def _helper():\n"
     "    from api.services.screener import scan_evaluator\n"
     "    return scan_evaluator.run_sweep([])\n"
     "def handler():\n"
     "    return _helper()\n", True),
    # prose and a namesake must NOT trip it
    ("# scan_evaluator.evaluate_one is the door\n"
     "SCAN = 'scan_evaluator.evaluate_one'\n"
     "def handler():\n"
     "    return SCAN\n", False),
    ("from api.services import engine as scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.get_movers()\n", False),
])
def test_the_census_SEES_a_planted_handler_and_IGNORES_the_namesake(source, expected):
    """⚠️ THE POSITIVE CONTROL, IN FOUR SHAPES. Phase C Task 1 measured the
    failure this prevents: a fixture written in a shape the scanner structurally
    could not match left the scan asserting nothing while staying green.

    ⛔ AND THE NAMESAKE CASE IS THE OTHER HALF. A census that fires on the WORD
    `scan_evaluator` is a grep wearing an AST's clothes — E-6 hit exactly this
    with `indicator_alert_service.record_evaluation`.
    """
    planted = "api.routers.__planted_for_this_test__"
    hit = _transitive_imports_and_calls((planted, "handler", "/planted"),
                                        overlay={planted: source})
    assert hit is expected


def test_the_census_walks_the_SAME_route_table_the_server_dispatches_on():
    """⛔ The handler count is an ASSERTION, not a log line. A census that walked
    zero routes — or that could not READ the handlers it walked — would pass the
    gate above exactly the way a correct one does."""
    from api.main import app

    _build_graph()
    handlers = _endpoints_from_router_routes()
    mounted = [r for r in app.routes if getattr(r, "endpoint", None) is not None]
    assert 100 < len(handlers) <= len(mounted)
    assert _REACHERS, (
        "nothing in api/ was found to reach the sweep — not even the scheduler "
        "job that is supposed to. The graph is empty and the gate is vacuous.")
    unreadable = [h for h in handlers if (h[0], h[1]) not in _GRAPH]
    assert not unreadable, (
        f"{len(unreadable)} handlers are absent from the AST graph, so the gate "
        f"says nothing about them, e.g. {unreadable[:5]}")


def test_the_evaluator_module_is_not_imported_by_any_ROUTER_at_all():
    """⛔ THE BLUNTER HALF, AND IT IS DELIBERATE. `api/routers/` is the request
    path; the sweep has no business in its namespace even unused. E-2 shipped with
    `api/routers/` untouched for the same reason and said so."""
    offenders = []
    for name in sorted(_MODULES):
        if not name.startswith("api.routers."):
            continue
        tree = _parse(name, {})
        if tree is None:                                 # pragma: no cover
            continue
        pkg = name.rsplit(".", 1)[0]
        for node in pyast.walk(tree):
            if isinstance(node, pyast.Import):
                if any(a.name.startswith(_SUBJECT) for a in node.names):
                    offenders.append(name)
            elif isinstance(node, pyast.ImportFrom):
                base = _resolve_from(node, pkg)
                if base.startswith(_SUBJECT) or any(
                        f"{base}.{a.name}" == _SUBJECT for a in node.names):
                    offenders.append(name)
    assert not offenders, f"routers importing the sweep: {sorted(set(offenders))}"


def test_the_ONLY_production_caller_of_the_sweep_is_the_SCHEDULER():
    """⭐ THE DOOR HAS EXACTLY ONE PRODUCTION CALL SITE AND IT IS A CRON JOB.

    Phase C's zero-to-one idiom: a door deliberately shut, with the shut asserted.
    Here it is ONE and the one is NAMED — so a second caller (a route, a warmer, a
    startup hook) fails BY NAME rather than arriving unnoticed.
    """
    sites = set()
    for name, path in sorted(_MODULES.items()):
        if name == _SUBJECT:
            continue
        tree = _parse(name, {})
        if tree is None:                                 # pragma: no cover
            continue
        pkg = name.rsplit(".", 1)[0] if "." in name else name
        aliases = _alias_map(
            [n for n in pyast.walk(tree)
             if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg)
        # ⚠️ THE INNERMOST ENCLOSING FUNCTION WINS. `ast.walk` is breadth-first,
        # so an outer function is seen before the one nested inside it and a plain
        # assignment leaves the nested name in place. E-6's writer census uses
        # `setdefault` (outermost) and would have reported `register_screener_jobs`
        # here — true, but not the name a reader would go looking for.
        enclosing = {}
        for fn in pyast.walk(tree):
            if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
                for n in pyast.walk(fn):
                    enclosing[id(n)] = fn.name
        for call in [n for n in pyast.walk(tree) if isinstance(n, pyast.Call)]:
            dotted = _dotted(call.func)
            if not dotted:
                continue
            parts = dotted.split(".")
            target = aliases.get(parts[0])
            if target is None:
                continue
            full = ".".join([target] + parts[1:])
            if (full.startswith(_SUBJECT + ".")
                    and full.rsplit(".", 1)[-1] in _ENTRY_POINTS):
                rel = path.relative_to(_ROOT).as_posix()
                sites.add(f"{rel}::{enclosing.get(id(call), '<module>')}")
    assert sites == {"api/main.py::_run_scan_sweep"}, (
        f"the sweep's production call sites are {sorted(sites)} — exactly one is "
        "expected, and it is the scheduler job")
