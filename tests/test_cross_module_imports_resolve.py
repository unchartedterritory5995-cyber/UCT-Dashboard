"""Every name imported from one `api.*` module by another must EXIST there.

⛔ THIS RAIL EXISTS BECAUSE THE SAME DEFECT SHIPPED TEN TIMES AND WAS SILENT
EVERY TIME. Found 2026-08-26 (X24, then X33). A module imports a name from a
sibling that has never existed; the `ImportError` lands in a bare
`except Exception: pass` a few lines below; the feature quietly does nothing
forever, and no test, no linter and no code review notices — because the code
LOOKS right and the suite stays green.

What it actually cost, measured:

  * `bars_prewarm.py`, `deep_history_warm.py`, `main.py`  — three warmers
    importing a non-existent auth.db door, so **the chart prewarm ring, the
    deep-history warmer and the main tracked-symbol sweep have never once read
    a member watchlist or ticker tag.** Charts for the symbols members actually
    watch have been colder than intended, silently, for as long as the code
    existed.
  * `call_recap_warmer.py` — the same defect in a third spelling
    (`auth_db.get_conn`), so call recaps never warmed a tracked symbol either.
  * `routers/push.py` — the same defect with **no `except` at all**, so
    `GET /api/push/journal-export` raised `ImportError` and answered **500 on
    every call**.

⭐ THE POINT OF DERIVING THE QUESTION RATHER THAN GREPPING FOR A NAME. The ten
instances were spelled `get_db_path`, `get_conn`, `get_auth_connection`,
`all_tracked_symbols`, `get_bars`, … — a grep for any one of them finds at most
two. The question that finds all of them is *"does the name this module imports
exist in the module it names?"*, and only the module can answer it.

⚠️ WHY AST AND NOT `importlib`. Importing every module here would execute
module-level code across the whole backend — schedulers, DB opens, vendor
sockets — inside the test suite. The AST answers the question without running
anything. See `lesson_probe_names_must_be_derived_not_typed`.

⚠️ THE ANALYSIS IS DELIBERATELY OVER-PERMISSIVE, so a pass is cheap and a
failure is real. A module's "bindings" include every name bound anywhere in it
(including inside `try`/`if`), and `from pkg import submodule` is honoured. Both
choices lose recall and gain precision: this rail must never cry wolf, because a
rail people learn to ignore is worse than no rail
(`lesson_a_gate_list_drifts_like_any_other_artifact`).
"""
from __future__ import annotations

import ast
import pathlib

API = pathlib.Path(__file__).resolve().parents[1] / "api"

#: ⛔ PRE-EXISTING AND STILL DEAD, each one a feature that silently does nothing.
#: Declared so this rail can be GREEN today and bite on anything NEW — never as
#: an exemption. Queued as **X33**. Shrink this list; never grow it.
#:
#: Every entry needs a real replacement decided by whoever owns the module:
#:   main.py::all_tracked_symbols        -> `watchlist_service` exposes no such
#:                                          function; the closest is
#:                                          `sync_flagged_items`, which is a
#:                                          WRITE. Needs a product decision, not
#:                                          a rename — so it is queued, not
#:                                          guessed at here.
#:   pattern_backtest.py x2, voice_tool_impls.py x3 — same shape, different
#:                                          owners.
KNOWN_DEAD: set[tuple[str, str]] = {
    ("api/main.py", "all_tracked_symbols"),
    ("api/services/pattern_backtest.py", "get_bars"),
    ("api/services/pattern_backtest.py", "_ensure_pattern_detectors_loaded"),
    ("api/services/voice_tool_impls.py", "get_recent_flow"),
    ("api/services/voice_tool_impls.py", "get_recent_dark_pool"),
    # ⛔ `get_macro_events` RESOLVED and its entry was deleted 2026-09-01.
    # A KNOWN_DEAD list that keeps a name which now imports fine is a false
    # claim about the codebase, and this rail exists to delete such claims
    # rather than carry them.
}


def _bindings(tree: ast.AST) -> set[str]:
    """Every name this module binds, anywhere — deliberately over-broad.

    ⚰️ IT WAS SILENTLY NARROW, AND IT CRIED WOLF FOR WEEKS. `ast.Assign` only collected
    `ast.Name` targets, so **tuple unpacking bound nothing** — `A, B, C = ...` contributed
    no names at all. Two real, importable modules were reported as unresolved imports:
    `freshness.py:33` (`HOLIDAY, WEEKEND, PRE, RTH, POST, OVERNIGHT = ...`) and
    `runtime.py:34` (`INTERACTIVE, BACKGROUND = ...`). Both resolve at runtime — proved by
    importing them — so this rail's red was **its own blind spot reported as the codebase's
    defect**, and it was carried in ledger rows as "a pre-existing non-Wisdom failure".

    ⛔ THE DANGEROUS FIX IS THE OBVIOUS ONE. Adding those two names to `KNOWN_DEAD` makes
    the rail green by permanently blinding it at exactly the two names it was wrong about —
    the shape this repo has paid for repeatedly (`lesson_a_gate_list_drifts_like_any_other_artifact`).
    The collector is what was broken, so the collector is what changed.

    ⭐ A docstring claiming "deliberately over-broad" is not evidence that it is. That
    sentence is why nobody re-derived it; `test_the_collector_sees_tuple_unpacking` below is.
    """
    out: set[str] = set()

    def _names(target: ast.AST) -> None:
        """One target, however it is shaped — a bare name, or a (possibly nested) tuple/list."""
        if isinstance(target, ast.Name):
            out.add(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                _names(element)
        elif isinstance(target, ast.Starred):
            _names(target.value)

    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(n.name)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                _names(t)
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            out.add(n.target.id)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            out.update((a.asname or a.name.split(".")[0]) for a in (n.names or []))
    return out


def _module_surface(dotted: str) -> tuple[set[str] | None, set[str]]:
    """(`names it binds`, `submodules it contains`). `None` = unresolvable.

    ⛔ `None` means "do not judge", never "nothing is there" — an absent answer
    is not a negative one (`lesson_a_second_authority_over_one_value`).
    """
    rel = dotted.replace(".", "/")
    as_file = API.parent / f"{rel}.py"
    as_pkg = API.parent / rel
    if as_file.exists():
        try:
            return _bindings(ast.parse(as_file.read_text(encoding="utf-8"))), set()
        except SyntaxError:
            return None, set()
    init = as_pkg / "__init__.py"
    if init.exists():
        subs = {p.stem for p in as_pkg.glob("*.py")}
        subs |= {p.name for p in as_pkg.iterdir()
                 if p.is_dir() and (p / "__init__.py").exists()}
        try:
            return _bindings(ast.parse(init.read_text(encoding="utf-8"))), subs
        except SyntaxError:
            return None, subs
    return None, set()


def _dead_imports() -> list[tuple[str, str, str, int]]:
    surface: dict[str, tuple[set[str] | None, set[str]]] = {}
    dead: list[tuple[str, str, str, int]] = []
    for path in sorted(API.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        rel = path.relative_to(API.parent).as_posix()
        for node in ast.walk(tree):
            if not (isinstance(node, ast.ImportFrom)
                    and node.level == 0
                    and node.module
                    and node.module.startswith("api.")):
                continue
            if node.module not in surface:
                surface[node.module] = _module_surface(node.module)
            names, subs = surface[node.module]
            if names is None:
                continue
            for alias in (node.names or []):
                if alias.name == "*":
                    continue
                if alias.name not in names and alias.name not in subs:
                    dead.append((rel, alias.name, node.module, node.lineno))
    return dead


def test_no_module_imports_a_name_its_target_does_not_define():
    """🔴 A dead cross-module import is a feature that silently does nothing."""
    dead = _dead_imports()
    fresh = [d for d in dead if (d[0], d[1]) not in KNOWN_DEAD]
    assert not fresh, (
        "these modules import names that do not exist in the module they name — "
        "each one is a feature that will silently do nothing, or a route that "
        "will 500:\n  "
        + "\n  ".join(f"{f}:{ln}  from {m} import {n}" for f, n, m, ln in fresh))


def test_the_sweep_actually_READ_something():
    """⛔ THE NON-VACUITY CONTROL. The assertion above passes trivially if the
    walk found no imports at all — a rail that cannot fail is this repo's most
    expensive shape. So pin the floor: this backend has hundreds of
    intra-`api` imports and dozens of resolvable target modules.
    """
    seen_imports = 0
    seen_modules: set[str] = set()
    for path in sorted(API.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.ImportFrom) and node.level == 0
                    and node.module and node.module.startswith("api.")):
                seen_imports += len(node.names or [])
                seen_modules.add(node.module)
    assert seen_imports >= 500, seen_imports
    assert len(seen_modules) >= 100, len(seen_modules)


def test_every_KNOWN_DEAD_entry_is_still_dead():
    """⛔ THE LIST MUST NOT ROT. A declared exception that has quietly been
    fixed is a lie the next reader inherits — and this wave has already paid
    for a stale count that sat next to a real rail and reddened it for
    cosmetic reasons. So an entry that is no longer dead FAILS: delete it.
    """
    still = {(f, n) for f, n, _m, _ln in _dead_imports()}
    healed = sorted(KNOWN_DEAD - still)
    assert not healed, (
        "these KNOWN_DEAD entries resolve now — delete them from the list "
        f"instead of leaving a false claim behind: {healed}")


def test_the_collector_sees_tuple_unpacking_and_still_refuses_what_is_not_bound():
    """CONTROL on `_bindings`, and it exists because the collector was wrong for weeks.

    ⚰️ `A, B = ...` bound NOTHING, so two importable modules were reported as unresolved
    imports and the red was carried as "a pre-existing failure someone else owns". A rail
    whose subject list is silently narrow is worse than no rail: it reads as coverage while
    accusing innocent code, and the obvious way to quiet it (KNOWN_DEAD) blinds it for good.

    ⛔ The second half is the one that keeps this honest. A collector that returned every
    identifier it ever saw would also satisfy the first half — and would make the whole rail
    vacuous, since nothing could ever be reported missing.
    """
    tree = ast.parse(
        "PLAIN = 1\n"
        "A, B, C = 'a', 'b', 'c'\n"
        "[D, E] = (4, 5)\n"
        "F, *G = (6, 7, 8)\n"
        "(H, (I, J)) = (9, (10, 11))\n"
        "K: int = 12\n"
        "def fn(): pass\n"
        "class Cls: pass\n"
        "import os\n"
        "from pathlib import Path as P\n"
    )
    got = _bindings(tree)
    for name in ("PLAIN", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
                 "fn", "Cls", "os", "P"):
        assert name in got, f"_bindings lost {name!r}: {sorted(got)}"
    # ...and it is a BINDING collector, not a token scraper.
    for never in ("int", "pathlib", "Path", "a", "b"):
        assert never not in got, f"_bindings invented {never!r}: {sorted(got)}"
