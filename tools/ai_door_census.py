"""AST census: every module under api/ that calls a model API (TERM-078, FB-I1-04).

WHY THIS EXISTS. A member-visible meter and a population cap are only honest if
the list of AI doors they describe is COMPLETE. The corpus (F-01 PROD-C1,
R-18) records the exposure as "per-user AI caps summing to ~$610-650/member/
month" with no single place that says which doors exist -- and a hand list of
doors is the artifact that goes stale first. This derives the list from the
syntax tree every run; `api/services/ai_doors.py` classifies each entry, and
`tests/test_ai_doors_census.py` fails BY NAME on a module this finds that the
table does not describe (and on a table entry this no longer finds).

WHAT COUNTS AS A MODEL CALL SITE (three shapes, all read from the AST):
  * construct -- an SDK client construction, exactly as
    `tools/llm_timeout_census.py` resolves it (renamed and function-local
    imports included). Reused, never re-implemented.
  * invoke    -- a call whose callee is an attribute chain ending in a model
    method: `.messages.create`, `.messages.stream`, `.messages.batches.create`,
    `.chat.completions.create`, `.responses.create`, `.embeddings.create`,
    `.audio.transcriptions.create`, `.audio.translations.create`,
    `.audio.speech.create` (and its streaming variant), `.images.generate`.
    The receiver is deliberately NOT resolved: a shared client handed in from
    another module (`engine._get_anthropic_client()`) is still a model call.
  * host      -- a string literal naming a model API host
    (`api.anthropic.com`, `api.openai.com`, `api.perplexity.ai`): raw HTTP to a
    model, which no SDK shape above can see.

ONE HOP THROUGH A SHARED CLIENT. A module the table classifies as a
`shared-client` (a wrapper other modules call instead of the SDK, e.g.
`perplexity_search.web_search`) has its MODEL-BEARING functions derived here --
every top-level function holding a site, closed over same-module calls and over
module constants naming a host -- and every OTHER module that calls one of them
is a census entry too, with shape `via:<module>`. Without the hop, a new member
route calling `perplexity_search.web_search` would never appear.

The census reports PATH:LINE and SHAPE, never a bare count: a count passes on a
swap (one door removed, one added, the number never moves).
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from typing import Iterable

try:  # imported as `tools.ai_door_census` by tests, or run as a script
    from tools import llm_timeout_census as _ltc
except ImportError:  # pragma: no cover - script entry point
    import llm_timeout_census as _ltc  # type: ignore

DEFAULT_ROOTS = ("api",)

# Attribute-chain TAILS that invoke a model. Matched against the callee's
# dotted attribute names, last names last.
INVOKE_TAILS: tuple[tuple[str, ...], ...] = (
    ("messages", "create"),
    ("messages", "stream"),
    ("batches", "create"),          # client.messages.batches.create
    ("completions", "create"),      # client.chat.completions.create
    ("responses", "create"),
    ("responses", "stream"),
    ("embeddings", "create"),
    ("transcriptions", "create"),
    ("translations", "create"),
    ("speech", "create"),
    ("with_streaming_response", "create"),   # audio.speech.with_streaming_response.create
    ("images", "generate"),
)

MODEL_HOSTS = ("api.anthropic.com", "api.openai.com", "api.perplexity.ai")

_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py") or base == "conftest.py"


@dataclass(frozen=True)
class Site:
    path: str        # repo-relative, forward slashes
    line: int
    shape: str       # construct | invoke | host | via:<module path>
    expr: str        # what was matched, as written
    func: str        # enclosing TOP-LEVEL function (or "<module>")

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} {self.shape} {self.expr} (in {self.func})"


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(base, root)):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


def _dotted_tail(func: ast.AST) -> tuple[str, ...]:
    """`a.b.c.d` -> ("b", "c", "d") as attribute names (the base is dropped)."""
    names: list[str] = []
    cur = func
    while isinstance(cur, ast.Attribute):
        names.append(cur.attr)
        cur = cur.value
    return tuple(reversed(names))


def _top_level_of(tree: ast.Module) -> dict[ast.AST, str]:
    """node -> name of the TOP-LEVEL def/class-method chain head it sits in."""
    owner: dict[ast.AST, str] = {}
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            name = stmt.name
        else:
            name = "<module>"
        for n in ast.walk(stmt):
            owner[n] = name
    return owner


def _host_in(value: object) -> str | None:
    if isinstance(value, str):
        for h in MODEL_HOSTS:
            if h in value:
                return h
    return None


class _Module:
    def __init__(self, tree: ast.Module, rel: str):
        self.tree = tree
        self.rel = rel
        self.owner = _top_level_of(tree)

    def direct_sites(self) -> list[Site]:
        out: list[Site] = []
        for c in _ltc._ModuleCensus(self.tree, self.rel).run():
            out.append(Site(self.rel, c.line, "construct", c.expr,
                            (c.scope.split(".")[0] if c.scope != "<module>" else "<module>")))
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call):
                tail = _dotted_tail(node.func)
                for want in INVOKE_TAILS:
                    if len(tail) >= len(want) and tail[-len(want):] == want:
                        out.append(Site(self.rel, node.lineno, "invoke",
                                        "." + ".".join(tail), self.owner.get(node, "<module>")))
                        break
            elif isinstance(node, ast.Constant):
                h = _host_in(node.value)
                if h:
                    out.append(Site(self.rel, node.lineno, "host", h,
                                    self.owner.get(node, "<module>")))
        out.sort(key=lambda s: (s.line, s.shape, s.expr))
        return out

    def model_functions(self, sites: list[Site]) -> set[str]:
        """Top-level functions that reach a model call inside this module:
        those holding a site, those loading a module constant that names a
        host, closed over same-module calls by bare name."""
        tops = {s.name: s for s in self.tree.body
                if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))}
        bearing = {s.func for s in sites if s.func in tops}
        host_consts = set()
        for stmt in self.tree.body:
            if isinstance(stmt, ast.Assign) and _host_in(getattr(stmt.value, "value", None)):
                host_consts.update(t.id for t in stmt.targets if isinstance(t, ast.Name))
        for name, fn in tops.items():
            if any(isinstance(n, ast.Name) and n.id in host_consts for n in ast.walk(fn)):
                bearing.add(name)
        changed = True
        while changed:
            changed = False
            for name, fn in tops.items():
                if name in bearing:
                    continue
                for n in ast.walk(fn):
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in bearing:
                        bearing.add(name)
                        changed = True
                        break
        return bearing


# Memoized on each file's own stat (the llm_timeout_census pattern) -- a cache
# that could go stale would be a rail that stops seeing a new door.
_PARSE_CACHE: dict[tuple, tuple] = {}


def _parse(path: str, rel: str) -> ast.Module | None:
    return _parsed(path, rel)[0]


def _parsed(path: str, rel: str) -> tuple:
    """(tree | None, direct sites) for one file, cached on (path, mtime, size)."""
    try:
        st = os.stat(path)
        key = (os.path.abspath(path), rel, st.st_mtime_ns, st.st_size)
    except OSError:
        return None, []
    hit = _PARSE_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        with open(path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), filename=rel)
    except (OSError, SyntaxError, ValueError):
        out = (None, [])
    else:
        out = (tree, _Module(tree, rel).direct_sites())
    _PARSE_CACHE[key] = out
    return out


def _module_name(rel: str) -> str:
    mod = rel[:-3] if rel.endswith(".py") else rel
    if mod.endswith("/__init__"):
        mod = mod[: -len("/__init__")]
    return mod.replace("/", ".")


def _calls_into(tree: ast.Module, target_mod: str, funcs: set[str]) -> list[tuple[int, str, ast.AST]]:
    """(line, expr, call node) for every call into `target_mod`'s `funcs`."""
    parent_pkg, _, leaf = target_mod.rpartition(".")
    mod_aliases: set[str] = set()
    func_aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == target_mod and a.asname:
                    mod_aliases.add(a.asname)
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            for a in node.names:
                if node.module == parent_pkg and a.name == leaf:
                    mod_aliases.add(a.asname or a.name)
                elif node.module == target_mod and a.name in funcs:
                    func_aliases[a.asname or a.name] = a.name
    out: list = []
    if not mod_aliases and not func_aliases:
        return out
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if (isinstance(f, ast.Attribute) and f.attr in funcs
                and isinstance(f.value, ast.Name) and f.value.id in mod_aliases):
            out.append((node.lineno, f"{f.value.id}.{f.attr}", node))
        elif isinstance(f, ast.Name) and f.id in func_aliases:
            out.append((node.lineno, f.id, node))
    return out


def sites(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
          shared_clients: Iterable[str] = ()) -> list[Site]:
    """EVERY model call site under `roots` (tests excluded), plus one hop
    through each module named in `shared_clients`."""
    shared = set(shared_clients)
    parsed: dict[str, ast.Module] = {}
    out: list[Site] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if _is_test_file(path):
                continue
            rel = _rel(path, base)
            tree, direct = _parsed(path, rel)
            if tree is None:
                continue
            parsed[rel] = tree
            out.extend(direct)
    for sc in sorted(shared):
        tree = parsed.get(sc)
        if tree is None:
            continue
        m = _Module(tree, sc)
        funcs = m.model_functions([s for s in out if s.path == sc])
        if not funcs:
            continue
        target = _module_name(sc)
        for rel, other in parsed.items():
            if rel == sc:
                continue
            hits = _calls_into(other, target, funcs)
            if not hits:
                continue
            owner = _top_level_of(other)
            for line, expr, node in hits:
                out.append(Site(rel, line, f"via:{sc}", expr, owner.get(node, "<module>")))
    out.sort(key=lambda s: (s.path, s.line, s.shape))
    return out


def modules(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
            shared_clients: Iterable[str] = ()) -> dict[str, list[Site]]:
    """path -> its sites. The census's unit is the MODULE."""
    by: dict[str, list[Site]] = {}
    for s in sites(base, roots, shared_clients):
        by.setdefault(s.path, []).append(s)
    return by


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import sys

    sys.path.insert(0, repo_root())
    from api.services import ai_doors

    found = modules(repo_root(), shared_clients=ai_doors.shared_client_paths())
    print(f"modules with a model call site under api/: {len(found)}")
    for path, ss in sorted(found.items()):
        door = ai_doors.DOORS.get(path)
        tag = f"{door.kind:<13}" if door else "UNLISTED     "
        print(f"  {tag} {path}  ({len(ss)} sites: {', '.join(sorted({s.shape for s in ss}))})")
    missing = sorted(set(found) - set(ai_doors.DOORS))
    stale = sorted(set(ai_doors.DOORS) - set(found))
    print(f"\nUNLISTED: {missing}\nSTALE: {stale}")
    sys.exit(1 if (missing or stale) else 0)
