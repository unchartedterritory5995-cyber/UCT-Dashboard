"""AST census: every site that reaches yfinance WITHOUT going through the guard.

Why an AST and not a grep. The defect this exists to catch is invisible to a
grep for "yfinance": `earnings_enrichment.py` carried three FUNCTION-LOCAL
`import yfinance as _yf` statements, so it read as a normal importer while
binding a PRIVATE copy of the module inside three call frames — escaping
`yf_util.bounded_call`'s pool and timeout, escaping the rate-limit handling,
and escaping every test stub (this repo's
`lesson_from_import_severs_a_module_from_its_guards`). A grep for the import
matches 26 modules and cannot tell you which of them actually reach the
library unguarded; only the call graph can.

WHAT COUNTS AS A REACH
    Any load of a name bound to yfinance:
      import yfinance                 -> "yfinance"
      import yfinance as yf           -> "yf"
      from yfinance import Ticker     -> "Ticker"
    at module level OR inside any function/method (the private-copy case).

WHAT COUNTS AS GUARDED
    The reach is lexically inside a callable that is handed to the guard:
      yf_util.bounded_call(lambda: yf.Ticker(t).info, None)
      bounded_call(_work, {})            # _work resolved to its def
      bounded_call(functools.partial(_work, t), {})
    ...or inside a module-local function whose EVERY call site is itself
    guarded (`earnings_estimates._yf_corporate_actions` is called exactly once,
    from inside a guarded lambda). That transitive rule is sound within a
    module and is what keeps the census from demanding a redundant second wrap.

    The guard is `yf_util.bounded_call`. `ALIAS_NAMES` are accepted ONLY
    because `assert_aliases_delegate` proves, from their own ASTs, that they
    call it — they own no pool and no policy. That check is what stops someone
    silencing this census by adding a name to the list.

The census reports by FILE:LINE and by NAME. A count would pass on a swap.
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from typing import Iterable

# THE guard. Defined exactly once, in api/services/yf_util.py.
GUARD_NAME = "bounded_call"

# Names accepted as the guard because they DELEGATE to it. Kept as SHORT as
# possible: an alias is the census's only soft spot, so a name goes here only
# when a module genuinely hands its yfinance-touching callable to that name
# instead of to `bounded_call`.
#   massive._bounded_yf        — `_bounded_yf(_work, {})` at massive.py:446/474
#   yfinance_pool.run_in_pool  — `run_in_pool(_do, …)` in research/{estimates,
#                                financials,ownership}.py
# `yfinance_pool.fetch_history` is deliberately NOT here: its own yfinance reach
# sits inside `_do_fetch`, which it hands to `bounded_call`, so the census
# already clears it — and none of its callers import yfinance themselves.
#
# `alias_delegation` proves each of these is a real WRAPPER: it must pass its
# own first parameter through to `bounded_call`. A data function that merely
# happens to call the guard somewhere in its body does NOT qualify, or the list
# would be a one-word way to silence a real bypass.
ALIAS_NAMES = frozenset({"_bounded_yf", "run_in_pool"})

GUARD_NAMES = frozenset({GUARD_NAME}) | ALIAS_NAMES

GUARD_MODULE = "api/services/yf_util.py"

# Production surface. `tools/` is operator-run and off the request path;
# tests stub the guard on purpose.
DEFAULT_ROOTS = ("api",)

_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


@dataclass(frozen=True)
class Reach:
    """One unguarded use of a yfinance binding."""
    path: str          # repo-relative, forward slashes
    line: int
    col: int
    name: str          # the bound name as used, e.g. "yf" or "_yf" or "Ticker"
    expr: str          # the smallest source expression, e.g. "yf.Ticker"
    scope: str         # enclosing def/lambda chain, e.g. "get_implied_move"
    local_import: bool  # True when the yfinance import is inside a function

    def __str__(self) -> str:  # pragma: no cover - formatting only
        kind = "function-local import" if self.local_import else "module import"
        return f"{self.path}:{self.line}:{self.col} {self.expr} (in {self.scope}, {kind})"


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    abs_root = os.path.join(base, root)
    for dirpath, dirnames, filenames in os.walk(abs_root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


class _ModuleCensus(ast.NodeVisitor):
    """Single-pass-per-module census over one parsed module."""

    def __init__(self, tree: ast.AST, relpath: str):
        self.tree = tree
        self.relpath = relpath
        self.parents: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        # name -> True when the binding import statement is function-local
        self.bindings: dict[str, bool] = {}
        self.guarded_regions: set[ast.AST] = set()
        self.reaches: list[Reach] = []

    # ── phase 1: what names are bound to yfinance, and where ────────────────
    def _collect_bindings(self) -> None:
        for node in ast.walk(self.tree):
            local = self._enclosing_func(node) is not None
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if self._is_reachable_yf_module(alias.name):
                        bound = alias.asname or alias.name.split(".")[0]
                        self.bindings[bound] = self.bindings.get(bound, False) or local
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if self._is_reachable_yf_module(mod):
                    for alias in node.names:
                        bound = alias.asname or alias.name
                        self.bindings[bound] = self.bindings.get(bound, False) or local

    @staticmethod
    def _is_reachable_yf_module(mod: str) -> bool:
        """True for a yfinance module whose names can make a REQUEST.

        `yfinance.exceptions` holds exception classes only — naming
        `YFRateLimitError` is how the guard HANDLES a 429, not a way to fetch.
        Counting it would make the guard module itself the census's loudest
        offender and push everyone toward matching the exception by string.
        """
        if mod == "yfinance.exceptions" or mod.startswith("yfinance.exceptions."):
            return False
        return mod == "yfinance" or mod.startswith("yfinance.")

    # ── phase 2: which callables are handed to the guard ────────────────────
    def _collect_guarded_regions(self) -> None:
        # Every locally-defined function, by name, so `bounded_call(_work, ...)`
        # can be resolved back to its `def`.
        defs_by_name: dict[str, list[ast.AST]] = {}
        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defs_by_name.setdefault(node.name, []).append(node)

        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            if self._called_name(node.func) not in GUARD_NAMES:
                continue
            fn_arg = node.args[0] if node.args else self._kwarg(node, "fn")
            for region in self._resolve_callable(fn_arg, defs_by_name):
                self.guarded_regions.add(region)

        self._propagate_guard(defs_by_name)

    def _propagate_guard(self, defs_by_name) -> None:
        """Transitive closure: a module-local helper that is ONLY ever called
        from inside a guarded region is itself guarded.

        `earnings_estimates._yf_corporate_actions` is the live case — its one
        call site is `bounded_call(lambda: _yf_corporate_actions(t), …)`, so
        demanding a second wrap inside it would add a nested guard for nothing.
        Deliberately conservative: skipped when the name is ambiguous (two defs)
        or when the helper is never called (then there is nothing to trust).
        """
        # Index call sites by callee name ONCE — `engine.py` is 2,700 lines and
        # re-walking it per candidate per round turned the rail into a minute.
        calls_by_name: dict[str, list[ast.Call]] = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call):
                calls_by_name.setdefault(self._called_name(node.func), []).append(node)

        candidates = {n: d[0] for n, d in defs_by_name.items() if len(d) == 1}
        changed = True
        while changed:
            changed = False
            for name, fdef in list(candidates.items()):
                sites = [
                    n for n in calls_by_name.get(name, ())
                    if not self._within(n, fdef)       # ignore recursion
                ]
                if sites and all(self._is_guarded(s) for s in sites):
                    self.guarded_regions.add(fdef)
                    del candidates[name]
                    changed = True

    def _within(self, node: ast.AST, ancestor: ast.AST) -> bool:
        cur = self.parents.get(node)
        while cur is not None:
            if cur is ancestor:
                return True
            cur = self.parents.get(cur)
        return False

    def _resolve_callable(self, arg, defs_by_name) -> list[ast.AST]:
        if arg is None:
            return []
        if isinstance(arg, ast.Lambda):
            return [arg]
        if isinstance(arg, ast.Name):
            return list(defs_by_name.get(arg.id, []))
        if isinstance(arg, ast.Attribute):
            return list(defs_by_name.get(arg.attr, []))
        if isinstance(arg, ast.Call):
            # functools.partial(_work, ticker) and friends
            inner = self._called_name(arg.func)
            if inner in {"partial", "functools.partial"} and arg.args:
                return self._resolve_callable(arg.args[0], defs_by_name)
        return []

    @staticmethod
    def _kwarg(call: ast.Call, name: str):
        for kw in call.keywords:
            if kw.arg == name:
                return kw.value
        return None

    @staticmethod
    def _called_name(func) -> str:
        if isinstance(func, ast.Name):
            return func.id
        if isinstance(func, ast.Attribute):
            return func.attr
        return ""

    # ── phase 3: every reach, guarded or not ────────────────────────────────
    def _collect_reaches(self) -> None:
        for node in ast.walk(self.tree):
            if not (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)):
                continue
            if node.id not in self.bindings:
                continue
            if self._shadowed(node):
                continue
            if self._is_guarded(node):
                continue
            self.reaches.append(
                Reach(
                    path=self.relpath,
                    line=node.lineno,
                    col=node.col_offset,
                    name=node.id,
                    expr=self._expr_of(node),
                    scope=self._scope_of(node),
                    local_import=self.bindings[node.id],
                )
            )

    def _shadowed(self, node: ast.Name) -> bool:
        """A parameter or local assignment of the same name in the enclosing
        function means this Load is NOT the yfinance module."""
        fn = self._enclosing_func(node)
        while fn is not None:
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                a = fn.args
                params = [*a.posonlyargs, *a.args, *a.kwonlyargs]
                if a.vararg:
                    params.append(a.vararg)
                if a.kwarg:
                    params.append(a.kwarg)
                if any(p.arg == node.id for p in params):
                    # unless the function itself re-imports yfinance under it
                    if not self._imports_here(fn, node.id):
                        return True
            elif isinstance(fn, ast.Lambda):
                a = fn.args
                params = [*a.posonlyargs, *a.args, *a.kwonlyargs]
                if any(p.arg == node.id for p in params):
                    return True
            fn = self._enclosing_func(fn)
        return False

    def _imports_here(self, fn, name: str) -> bool:
        for n in ast.walk(fn):
            if isinstance(n, ast.Import):
                for alias in n.names:
                    if (alias.asname or alias.name.split(".")[0]) == name:
                        return True
            elif isinstance(n, ast.ImportFrom):
                for alias in n.names:
                    if (alias.asname or alias.name) == name:
                        return True
        return False

    def _is_guarded(self, node: ast.AST) -> bool:
        cur = node
        while cur is not None:
            if cur in self.guarded_regions:
                return True
            cur = self.parents.get(cur)
        return False

    def _enclosing_func(self, node: ast.AST):
        cur = self.parents.get(node)
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                return cur
            cur = self.parents.get(cur)
        return None

    def _scope_of(self, node: ast.AST) -> str:
        chain = []
        cur = self._enclosing_func(node)
        while cur is not None:
            chain.append("<lambda>" if isinstance(cur, ast.Lambda) else cur.name)
            cur = self._enclosing_func(cur)
        return ".".join(reversed(chain)) or "<module>"

    def _expr_of(self, node: ast.AST) -> str:
        parent = self.parents.get(node)
        if isinstance(parent, ast.Attribute):
            return f"{node.id}.{parent.attr}"
        return node.id

    def run(self) -> list[Reach]:
        self._collect_bindings()
        if not self.bindings:
            return []
        self._collect_guarded_regions()
        self._collect_reaches()
        return self.reaches


# Per-file memo keyed by (path, mtime_ns, size) — the whole census is ~6s of
# pure `ast.parse` over api/**, and several rails call it. Keyed on the file's
# own stat so an edited file is always re-analysed: a cache that could go stale
# would be a rail that stops seeing new bypasses.
_ANALYSIS_CACHE: dict[tuple, tuple[bool, tuple[Reach, ...]]] = {}
_PARSE_CACHE: dict[tuple, tuple] = {}


def _stat_key(path: str):
    try:
        st = os.stat(path)
        return (os.path.abspath(path), st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def _parse(path: str, rel: str):
    """(tree, source_lines) or (None, ()) — memoized on the file's own stat."""
    key = _stat_key(path)
    if key is None:
        return None, ()
    hit = _PARSE_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        out = (ast.parse(src, filename=rel), tuple(src.splitlines()))
    except (OSError, SyntaxError):
        out = (None, ())
    _PARSE_CACHE[key] = out
    return out


def _analyze(path: str, rel: str) -> tuple[bool, tuple[Reach, ...]]:
    """(imports_yfinance, unguarded_reaches) for one file."""
    key = _stat_key(path)
    if key is None:
        return False, ()
    hit = _ANALYSIS_CACHE.get(key)
    if hit is not None:
        return hit
    tree, _ = _parse(path, rel)
    if tree is None:
        return False, ()
    c = _ModuleCensus(tree, rel)
    c.run()   # populates .bindings and .reaches
    result = (bool(c.bindings), tuple(c.reaches))
    _ANALYSIS_CACHE[key] = result
    return result


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
           include_tests: bool = False) -> list[Reach]:
    """Every unguarded yfinance reach under `roots`, sorted by file then line."""
    out: list[Reach] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if not include_tests and _is_test_file(path):
                continue
            out.extend(_analyze(path, _rel(path, base))[1])
    out.sort(key=lambda r: (r.path, r.line, r.col))
    return out


def importers(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
              include_tests: bool = False) -> list[str]:
    """Every module that imports yfinance at all — guarded or not. The
    denominator the census is a subset of."""
    found: list[str] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if not include_tests and _is_test_file(path):
                continue
            rel = _rel(path, base)
            if _analyze(path, rel)[0]:
                found.append(rel)
    return sorted(found)


@dataclass(frozen=True)
class SeveredImport:
    """A `from …yf_util import bounded_call` — the import style that binds a
    private copy and escapes every monkeypatch of the guard."""
    path: str
    line: int
    text: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} {self.text}"


def severed_guard_imports(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> list[SeveredImport]:
    """Every place under `roots` that FROM-imports out of yf_util instead of
    importing the module.

    This is not stylistic. `from api.services.yf_util import bounded_call`
    binds the function object into the caller's namespace at import time, so a
    later `monkeypatch.setattr(yf_util, "bounded_call", spy)` reaches the
    module attribute and NOT the caller — which is exactly how a guard, and
    every test that tries to prove the guard binds, gets severed
    (`lesson_from_import_severs_a_module_from_its_guards`).
    """
    out: list[SeveredImport] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            tree, lines = _parse(path, rel)
            if tree is None:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                mod = node.module or ""
                if mod.endswith("yf_util"):
                    text = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ""
                    out.append(SeveredImport(rel, node.lineno, text))
    out.sort(key=lambda s: (s.path, s.line))
    return out


def _is_pass_through_wrapper(fdef) -> bool:
    """True when `fdef` hands ITS OWN first parameter to `bounded_call`.

    Merely containing a `bounded_call(...)` somewhere is not enough. A data
    function like `ticker_meta._from_yfinance` calls the guard on an internal
    lambda — adding its name to ALIAS_NAMES would then be accepted, and every
    CALL of it anywhere would read as "guarded". This check is what makes the
    alias list unusable as a silencer: only a real pass-through wrapper, whose
    caller's callable is the thing that gets bounded, qualifies.
    """
    args = fdef.args
    positional = [*args.posonlyargs, *args.args]
    if not positional:
        return False
    first = positional[0].arg
    for n in ast.walk(fdef):
        if not isinstance(n, ast.Call):
            continue
        if _ModuleCensus._called_name(n.func) != GUARD_NAME:
            continue
        passed = n.args[0] if n.args else _ModuleCensus._kwarg(n, "fn")
        if isinstance(passed, ast.Name) and passed.id == first:
            return True
    return False


def alias_delegation(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> dict[str, list[tuple[str, int, bool]]]:
    """For every accepted alias, locate its def(s) and report whether it is a
    genuine pass-through wrapper over `bounded_call`.
    Returns {alias: [(path, line, delegates)]}."""
    found: dict[str, list[tuple[str, int, bool]]] = {a: [] for a in ALIAS_NAMES}
    for root in roots:
        for path in _iter_py_files(root, base):
            if _is_test_file(path):
                continue
            rel = _rel(path, base)
            tree, _ = _parse(path, rel)
            if tree is None:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if node.name not in ALIAS_NAMES:
                    continue
                found[node.name].append(
                    (rel, node.lineno, _is_pass_through_wrapper(node)))
    return found


def guard_definitions(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> list[tuple[str, int]]:
    """Every `def bounded_call` under `roots` — there must be exactly one, in
    `yf_util`. Two definitions is the "second guard wearing a nicer hat" case."""
    out: list[tuple[str, int]] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if _is_test_file(path):
                continue
            rel = _rel(path, base)
            tree, _ = _parse(path, rel)
            if tree is None:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                        and node.name == GUARD_NAME:
                    out.append((rel, node.lineno))
    return sorted(out)


def guarded_reaches(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
                    include_tests: bool = False) -> list[str]:
    """Modules that reach yfinance and are ALREADY guarded — i.e. the modules
    a behavioural "the guard binds" test should exist for. Derived, not typed:
    `importers` minus the files the census still flags."""
    bad = {r.path for r in census(base, roots, include_tests)}
    return [m for m in importers(base, roots, include_tests) if m not in bad]


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import sys

    base = repo_root()
    imps = importers(base)
    rs = census(base)
    print(f"modules importing yfinance under api/: {len(imps)}")
    for m in imps:
        print(f"    {m}")
    print()
    print(f"UNGUARDED reaches: {len(rs)}")
    by_file: dict[str, list[Reach]] = {}
    for r in rs:
        by_file.setdefault(r.path, []).append(r)
    for path, group in by_file.items():
        print(f"  {path}  ({len(group)})")
        for r in group:
            kind = "LOCAL-IMPORT" if r.local_import else "module-import"
            print(f"      :{r.line}  {r.expr:<28} in {r.scope}   [{kind}]")

    sev = severed_guard_imports(base)
    print()
    print(f"SEVERED guard imports (from …yf_util import …): {len(sev)}")
    for s in sev:
        print(f"    {s}")

    print()
    print("guard definitions:", guard_definitions(base))
    print("alias delegation:")
    for alias, sites in alias_delegation(base).items():
        print(f"    {alias}: {sites}")

    sys.exit(1 if (rs or sev) else 0)
