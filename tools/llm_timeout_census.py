"""AST census: every LLM client constructed WITHOUT an explicit `timeout=`.

WHY THIS EXISTS. `anthropic` and `openai` both default to a 600 s read timeout.
A client built without `timeout=` on a request path can therefore hold one of
the web pod's 64 shared anyio worker threads for ten minutes — the 2026-07-01
thread-exhaustion outage, re-armed. The 2026-08-09 performance audit found 11
such clients still live, one of them behind an endpoint with no auth dependency.

WHY AN AST AND NOT A GREP. Every one of the live sites is a FUNCTION-LOCAL
`import anthropic` — it reads like a normal import while binding a private copy
inside a call frame (this repo's `lesson_from_import_severs_a_module_from_its_
guards`). And the binding can be renamed: `from anthropic import Anthropic as
Claude` never spells "anthropic.Anthropic" anywhere. Only the syntax tree can
answer "which names in this module construct an SDK client".

WHAT COUNTS AS A CONSTRUCTION
    A call of a name bound to an SDK client class, however it was bound:
      import anthropic            -> anthropic.Anthropic(...)
      import anthropic as A       -> A.AsyncAnthropic(...)
      from anthropic import OpenAI as C  -> C(...)
    at module level or inside any function/method.

WHAT COUNTS AS BOUNDED
    The construction passes a `timeout=` keyword whose value is not the literal
    `None`. **The census does not care what the value is.** That is deliberate:
    a scheduler-thread pass may legitimately need 300 s (the Desk insights
    chapters pass does, and a shared 60 s default once broke it), while a
    request-path call should be tens of seconds. Enforcing a NUMBER would either
    break the former or under-protect the latter; enforcing that the author
    STATED one catches the whole defect class either way.

    `timeout=None` is reported. It is the SDK's spelling of "no timeout", i.e.
    the defect wearing the fix's clothes.

    `Anthropic(**opts)` is reported. The census cannot see inside the splat, and
    an unreadable site is treated as unbounded — silence here is how eleven
    accumulated.

The census reports FILE:LINE and NAME. A count would pass on a swap: fix one,
add another, the number never moves.
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from typing import Iterable

# SDK top-level modules whose attributes may be client classes.
SDK_MODULES = frozenset({"anthropic", "openai"})

# Client classes. Every one of these accepts `timeout=` and every one defaults
# to 600 s without it.
CLIENT_NAMES = frozenset({
    "Anthropic", "AsyncAnthropic",
    "AnthropicBedrock", "AsyncAnthropicBedrock",
    "AnthropicVertex", "AsyncAnthropicVertex",
    "OpenAI", "AsyncOpenAI",
    "AzureOpenAI", "AsyncAzureOpenAI",
})

TIMEOUT_KW = "timeout"

# Production surface. `tools/` is operator-run and off the request path; tests
# construct fakes on purpose.
DEFAULT_ROOTS = ("api",)

_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


@dataclass(frozen=True)
class Construction:
    """One LLM client construction site."""
    path: str            # repo-relative, forward slashes
    line: int
    col: int
    expr: str            # as written, e.g. "anthropic.Anthropic" or "Claude"
    scope: str           # enclosing def chain, or "<module>"
    bounded: bool        # an explicit, non-None `timeout=` is present
    reason: str          # why it is unbounded ("" when bounded)
    local_import: bool   # the SDK import is inside a function

    def __str__(self) -> str:  # pragma: no cover - formatting only
        kind = "function-local import" if self.local_import else "module import"
        tail = f" [{self.reason}]" if self.reason else ""
        return f"{self.path}:{self.line}:{self.col} {self.expr}(...) (in {self.scope}, {kind}){tail}"


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(base, root)):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


class _ModuleCensus(ast.NodeVisitor):
    def __init__(self, tree: ast.AST, relpath: str):
        self.tree = tree
        self.relpath = relpath
        self.parents: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        # bound name -> was the binding import function-local
        self.sdk_modules: dict[str, bool] = {}   # "anthropic" / "A"
        self.client_names: dict[str, bool] = {}  # "Anthropic" / "Claude"
        self.found: list[Construction] = []

    # ── phase 1: what names are bound to an SDK, and where ──────────────────
    def _collect_bindings(self) -> None:
        for node in ast.walk(self.tree):
            local = self._enclosing_func(node) is not None
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top = alias.name.split(".")[0]
                    if top in SDK_MODULES:
                        bound = alias.asname or top
                        self.sdk_modules[bound] = self.sdk_modules.get(bound, False) or local
            elif isinstance(node, ast.ImportFrom):
                top = (node.module or "").split(".")[0]
                if top not in SDK_MODULES:
                    continue
                for alias in node.names:
                    bound = alias.asname or alias.name
                    if alias.name in CLIENT_NAMES:
                        self.client_names[bound] = self.client_names.get(bound, False) or local
                    elif alias.name in SDK_MODULES:      # from anthropic import types...
                        self.sdk_modules[bound] = self.sdk_modules.get(bound, False) or local

    # ── phase 2: every construction, bounded or not ─────────────────────────
    def _collect(self) -> None:
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            hit = self._client_expr(node.func)
            if hit is None:
                continue
            expr, local = hit
            bounded, reason = self._timeout_of(node)
            self.found.append(Construction(
                path=self.relpath, line=node.lineno, col=node.col_offset,
                expr=expr, scope=self._scope_of(node),
                bounded=bounded, reason=reason, local_import=local,
            ))

    def _client_expr(self, func) -> tuple[str, bool] | None:
        """(source expression, import-was-function-local) or None."""
        if isinstance(func, ast.Attribute) and func.attr in CLIENT_NAMES:
            base = func.value
            if isinstance(base, ast.Name) and base.id in self.sdk_modules:
                if self._shadowed(base, base.id):
                    return None
                return f"{base.id}.{func.attr}", self.sdk_modules[base.id]
            return None
        if isinstance(func, ast.Name) and func.id in self.client_names:
            if self._shadowed(func, func.id):
                return None
            return func.id, self.client_names[func.id]
        return None

    @staticmethod
    def _timeout_of(call: ast.Call) -> tuple[bool, str]:
        splat = False
        for kw in call.keywords:
            if kw.arg is None:
                splat = True
                continue
            if kw.arg == TIMEOUT_KW:
                if isinstance(kw.value, ast.Constant) and kw.value.value is None:
                    return False, "timeout=None is the SDK's spelling of 'no timeout'"
                return True, ""
        if splat:
            # ASCII on purpose: this string is printed to a Windows console.
            return False, "timeout hidden behind **kwargs - unreadable, so unbounded"
        return False, "no timeout= - the SDK default is a 600s read timeout"

    # ── scope helpers ───────────────────────────────────────────────────────
    def _shadowed(self, node: ast.AST, name: str) -> bool:
        """A parameter of the same name means this Load is not the SDK.

        A false positive here trains people to add names to an ignore list,
        which is how a real rail dies.
        """
        fn = self._enclosing_func(node)
        while fn is not None:
            a = fn.args
            params = [*a.posonlyargs, *a.args, *a.kwonlyargs]
            if getattr(a, "vararg", None):
                params.append(a.vararg)
            if getattr(a, "kwarg", None):
                params.append(a.kwarg)
            if any(p.arg == name for p in params) and not self._imports_here(fn, name):
                return True
            fn = self._enclosing_func(fn)
        return False

    @staticmethod
    def _imports_here(fn, name: str) -> bool:
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

    def run(self) -> list[Construction]:
        self._collect_bindings()
        if not self.sdk_modules and not self.client_names:
            return []
        self._collect()
        return self.found


# Memoized on each file's own stat — a cache that could go stale would be a rail
# that stops seeing new bypasses.
_CACHE: dict[tuple, tuple[Construction, ...]] = {}


def _stat_key(path: str):
    try:
        st = os.stat(path)
        return (os.path.abspath(path), st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def _analyze(path: str, rel: str) -> tuple[Construction, ...]:
    key = _stat_key(path)
    if key is None:
        return ()
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    try:
        with open(path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), filename=rel)
    except (OSError, SyntaxError):
        return ()
    out = tuple(_ModuleCensus(tree, rel).run())
    _CACHE[key] = out
    return out


def constructions(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
                  include_tests: bool = False) -> list[Construction]:
    """EVERY LLM client construction under `roots` — the denominator.

    Exposed so a rail can prove the census is finding anything at all. "0
    unbounded" is only good news when the denominator is non-zero.
    """
    out: list[Construction] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if not include_tests and _is_test_file(path):
                continue
            out.extend(_analyze(path, _rel(path, base)))
    out.sort(key=lambda c: (c.path, c.line, c.col))
    return out


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
           include_tests: bool = False) -> list[Construction]:
    """Only the UNBOUNDED constructions."""
    return [c for c in constructions(base, roots, include_tests) if not c.bounded]


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import sys

    base = repo_root()
    allc = constructions(base)
    bad = [c for c in allc if not c.bounded]
    print(f"LLM client constructions under api/: {len(allc)}")
    for c in allc:
        mark = "OK " if c.bounded else "!! "
        print(f"  {mark}{c}")
    print()
    print(f"UNBOUNDED: {len(bad)}")
    for c in bad:
        print(f"    {c}")
    sys.exit(1 if bad else 0)
