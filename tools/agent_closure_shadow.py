"""UCT Agent — closure shadow evaluator (P1). SHADOW ONLY: gates nothing, writes only its own log. AUDIT-owned.

Question it answers: master moved T0 -> T1 while an approved Agent PR waits. Can Δ = diff(T0, T1) change the
Agent's test evidence?

    carry                  Δ is disjoint from the Agent test closure and from ALWAYS-SENSITIVE
    related:<test files>   only these test files can observe Δ (re-run them)
    full                   re-run everything

    python tools/agent_closure_shadow.py evaluate --pr N --t0 SHA --t1 SHA [--tree DIR] [--log PATH]
    python tools/agent_closure_shadow.py record   --t1 SHA --vitest-fails N --pytest-fails N [--failed-files ...] --notes ...
    python tools/agent_closure_shadow.py report   [--log PATH]
    python tools/agent_closure_shadow.py watch    [--interval 300] [--once]   # the unattended shadow loop

CLOSURE = everything the Agent tests can observe, transitively:
  seeds    AGENT_VITEST_PATHS (read from .github/workflows/agent-ci.yml — the one authority), tests/test_uct_agent*.py,
           the vitest setupFiles and every conftest.py (they run for every test)
  JS       static import / re-export / dynamic import() / require / vi.mock-family targets / import.meta.glob (expanded)
           / ?raw / new URL(…, import.meta.url) / fs reads of repo paths (text-read source, JSON, goldens, locks)
           / child_process calls of repo scripts / CSS @import + composes + url() / vite aliases (read from the config)
  Python   import / from-import (absolute + relative, parent packages' __init__), importlib.import_module, __import__,
           runpy / spec_from_file_location, subprocess calls of tools/*.py, open() / Path.read_text() / glob / listdir
  extra    generated manifests (*.golden.json, *.lock.json, coverage.json, *_requests.json, *manifest*.json) whose
           basename appears in the text of any closure file are members even when the read path cannot be traced
The graph is built from git objects (no checkout) at T0, T1 and the PR head, and the three are unioned.

FAIL-CLOSED: any specifier or read path the resolver cannot bound, in any file on a seed's path, makes that seed's
closure uncertain -> full. Parse errors, a missing Node/@babel/parser, an unreadable PR -> full.

The JS extractor is tools/agent_closure_graph.mjs (@babel/parser from app/node_modules). Python is ast. Stdlib only.

Mutation switches (for the tests only): AGENT_CLOSURE_DISABLE=feature[,feature] turns a resolver feature off; see
FEATURES. Every feature has a test that goes red when it is off (tests/test_agent_closure_shadow.py).
"""
from __future__ import annotations

import argparse
import ast
import datetime as _dt
import fnmatch
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path

TOOL_VERSION = "closure-shadow/1"
DEFAULT_LOG = Path(os.environ.get("AGENT_CLOSURE_SHADOW_LOG") or r"C:/w/agent-closure-shadow.log")
HERE = Path(__file__).resolve().parent
HOLE = "\u0001"
TMP = "\u0003TMP"
UNSET = "\u0004UNSET"
R = "/R"

# The graph always records the product-code relaxations (runtime_io / runtime_dynamic sites); every evaluation
# reports BOTH verdicts: strict (those sites are fatal) and relaxed (they are recorded only).
# AGENT_CLOSURE_STRICT_PRODUCT=1 makes the headline `verdict` field the strict one.
STRICT_PRODUCT = os.environ.get("AGENT_CLOSURE_STRICT_PRODUCT") == "1"
DOTTED_RE = re.compile(r"^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+)(?::[A-Za-z_]\w*)?$")

FEATURES = (
    "js-read-source",   # fs reads of .js/.jsx/.ts/.py/... (tests that read source as TEXT)
    "js-read-data",     # fs reads of JSON / goldens / locks / docs
    "mock",             # vi.mock / doMock / importActual / importMock targets
    "glob",             # import.meta.glob + vite's dynamic-import-vars globs
    "uncertain",        # fail-closed on computed specifiers / unbounded reads
    "py-importlib",     # importlib.import_module / __import__ with literal args
    "py-exec",          # subprocess / runpy / spec_from_file_location of repo scripts
    "py-read",          # open() / Path.read_text() / glob / listdir of repo paths
    "css",              # CSS @import / composes / url()
    "manifest-mention", # generated manifests named in a closure file's text
    "alias",            # vite resolve.alias / test.alias
    "dotted",           # 'pkg.mod' / 'pkg.mod:fn' literals naming repo modules (registries feeding importlib)
    "sensitive",        # ALWAYS-SENSITIVE -> full
    "pr-own",           # Δ ∩ the PR's own diff -> full
)


def _disabled() -> set[str]:
    return {x.strip() for x in (os.environ.get("AGENT_CLOSURE_DISABLE") or "").split(",") if x.strip()}


# ---- ALWAYS-SENSITIVE -----------------------------------------------------------------------------------------
SENSITIVE_RULES: list[tuple[str, str]] = [
    ("api/main.py", "api/main.py"),
    ("**/conftest.py", "conftest.py"),
    ("conftest.py", "conftest.py"),
    ("pytest.ini", "pytest config"),
    ("**/pytest.ini", "pytest config"),
    ("setup.cfg", "setup.cfg"),
    ("pyproject.toml", "pyproject.toml"),
    ("**/package.json", "package.json"),
    ("package.json", "package.json"),
    ("**/package-lock.json", "package-lock.json"),
    ("package-lock.json", "package-lock.json"),
    ("**/vite.config.*", "vite config"),
    ("vite.config.*", "vite config"),
    ("**/vitest.config.*", "vitest config"),
    ("vitest.config.*", "vitest config"),
    (".github/workflows/agent-ci.yml", "agent-ci workflow"),
    ("tools/agent_ci_*.py", "agent ci tool"),
    ("tools/agent_suite_lock.py", "suite lock"),
    ("requirements*.txt", "python dependency set"),
]


def sensitive_reason(path: str, setup_files: set[str]) -> str | None:
    if path in setup_files:
        return "vitest setupFiles"
    for pat, why in SENSITIVE_RULES:
        if fnmatch.fnmatchcase(path, pat) or (pat.startswith("**/") and fnmatch.fnmatchcase(path, pat[3:])):
            return why
    return None


MANIFEST_RE = re.compile(r"(\.golden\.json|\.lock\.json|(^|/)coverage\.json|_requests\.json|manifest[^/]*\.json)$")
JS_EXT = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx")
SRC_EXT = JS_EXT + (".py", ".css", ".scss", ".html", ".vue", ".svelte")
VITEST_TEST_RE = re.compile(r"\.(test|spec)\.(c|m)?[jt]sx?$")
CSS_EXT = (".css", ".scss", ".less")
QUERY_RE = re.compile(r"[?#].*$")


# ---- git object access --------------------------------------------------------------------------------------
class Tree:
    """Read-only view of one revision via `git ls-tree` + `git cat-file --batch` (no checkout)."""

    def __init__(self, repo: Path, sha: str):
        self.repo = Path(repo)
        self.sha = _git(repo, "rev-parse", sha).strip()
        out = _git(repo, "ls-tree", "-r", "--name-only", "-z", self.sha)
        self.files = set(x for x in out.split("\0") if x)
        self.dirs: set[str] = set()
        for f in self.files:
            d = posixpath.dirname(f)
            while d and d not in self.dirs:
                self.dirs.add(d)
                d = posixpath.dirname(d)
        self._cache: dict[str, str | None] = {}
        self._sorted = sorted(self.files)

    def read_many(self, paths: list[str]) -> dict[str, str | None]:
        need = [p for p in paths if p not in self._cache]
        if need:
            p = subprocess.run(["git", "-C", str(self.repo), "cat-file", "--batch"],
                               input="".join(f"{self.sha}:{x}\n" for x in need).encode("utf-8"),
                               capture_output=True, check=True)
            buf = p.stdout
            i = 0
            for x in need:
                nl = buf.index(b"\n", i)
                header = buf[i:nl].decode("utf-8", "replace")
                i = nl + 1
                if header.endswith("missing"):
                    self._cache[x] = None
                    continue
                size = int(header.rsplit(" ", 1)[1])
                self._cache[x] = buf[i:i + size].decode("utf-8", "replace")
                i += size + 1
        return {x: self._cache[x] for x in paths}

    def read(self, path: str) -> str | None:
        return self.read_many([path])[path]

    def under(self, d: str) -> list[str]:
        pre = d.rstrip("/") + "/"
        import bisect
        i = bisect.bisect_left(self._sorted, pre)
        out = []
        while i < len(self._sorted) and self._sorted[i].startswith(pre):
            out.append(self._sorted[i])
            i += 1
        return out


def _git(repo, *args) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True,
                          encoding="utf-8", errors="replace").stdout


# ---- seeds --------------------------------------------------------------------------------------------------
def agent_vitest_paths(tree: Tree) -> list[str]:
    wf = tree.read(".github/workflows/agent-ci.yml")
    if wf is None:
        raise RuntimeError("agent-ci.yml missing")
    m = re.search(r"^\s*AGENT_VITEST_PATHS:\s*['\"]?([^'\"\n]+)['\"]?\s*$", wf, re.M)
    if not m:
        raise RuntimeError("AGENT_VITEST_PATHS not found in agent-ci.yml")
    return m.group(1).split()


def workflow_env_names(tree: Tree) -> set[str]:
    """Every env var name the agent-ci workflow could set. Any other env var is UNSET in the Agent run, so a path
    derived from it is not repo state (a test that reads it is skipped or reads its default)."""
    wf = tree.read(".github/workflows/agent-ci.yml") or ""
    return set(re.findall(r"\b([A-Z][A-Z0-9_]{2,})\b", wf))


def seeds_for(tree: Tree) -> tuple[list[str], list[str]]:
    js: list[str] = []
    for p in agent_vitest_paths(tree):
        full = "app/" + p.strip("/")
        if full in tree.files:
            js.append(full)
        elif full in tree.dirs:
            js.extend(f for f in tree.under(full) if VITEST_TEST_RE.search(f) and "/node_modules/" not in f)
        else:
            # vitest treats a CLI path as a filter: a prefix of file paths
            js.extend(f for f in tree._sorted if f.startswith(full) and VITEST_TEST_RE.search(f))
    py = sorted(f for f in tree.files if re.fullmatch(r"tests/test_uct_agent[^/]*\.py", f))
    return sorted(set(js)), py


# ---- path patterns ------------------------------------------------------------------------------------------
def _norm(p: str) -> str:
    out: list[str] = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if out and HOLE not in out[-1]:
                out.pop()
            continue
        out.append(seg)
    return "/".join(out)


UNBOUNDED_DIRS = {"", "app"}


def expand_pattern(tree: Tree, pattern: str, glob_syntax: bool = False) -> tuple[list[str], str | None]:
    """Pattern rooted at /R -> (repo files, uncertainty reason or None). Exact paths that do not exist still count:
    a Δ that ADDS that file is then reached."""
    if not pattern.startswith(R + "/") and pattern != R:
        return [], None
    rel = pattern[len(R) + 1:] if pattern != R else ""
    if glob_syntax or HOLE in rel or any(c in rel for c in "*?["):
        rel_h = rel
        if HOLE in rel_h:
            pre = rel_h.split(HOLE, 1)[0]
        else:
            pre = re.split(r"[*?\[{]", rel_h, 1)[0]
        base = _norm(pre.rsplit("/", 1)[0]) if "/" in pre else ""
        if base in UNBOUNDED_DIRS:
            return [], f"read pattern {rel.replace(HOLE, '<?>')!r} is not bounded below the repo/app root"
        rx = _pattern_regex(_norm_keep(rel_h))
        cand = tree.under(base) if base in tree.dirs else []
        return [f for f in cand if rx.match(f)], None
    rel = _norm(rel)
    if rel in tree.dirs:
        return tree.under(rel), None
    return [rel], None


def _norm_keep(p: str) -> str:
    # normalise ./ and ../ but keep glob syntax
    return _norm(p)


def _pattern_regex(p: str) -> re.Pattern:
    out = []
    i = 0
    while i < len(p):
        c = p[i]
        if c == HOLE:
            out.append(".*")
        elif c == "*":
            if p[i:i + 3] == "**/":
                out.append("(?:.*/)?")
                i += 3
                continue
            if p[i:i + 2] == "**":
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "{":
            j = p.find("}", i)
            if j > i:
                out.append("(?:" + "|".join(re.escape(x) for x in p[i + 1:j].split(",")) + ")")
                i = j + 1
                continue
            out.append(re.escape(c))
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "(?:/.*)?$")


# ---- JS ----------------------------------------------------------------------------------------------------
def _app_node_modules(repo: Path) -> Path | None:
    for cand in (os.environ.get("AGENT_CLOSURE_NODE_MODULES"), str(Path(repo) / "app" / "node_modules"),
                 str(HERE.parent / "app" / "node_modules")):
        if cand and (Path(cand) / "@babel" / "parser").exists():
            return Path(cand)
    return None


JSON_IMPORT_RE = re.compile(r"""from\s+['"](\.{1,2}/[^'"]+\.json)['"]""")


def run_js_extractor(repo: Path, files: dict[str, str], configs: dict[str, str], tree: "Tree | None" = None,
                     env_names: "set[str] | None" = None) -> dict:
    nm = _app_node_modules(repo)
    node = shutil.which("node")
    if not nm or not node:
        raise RuntimeError("node or @babel/parser unavailable")
    json_modules: dict[str, str] = {}
    if tree is not None:
        want = set()
        for path, txt in files.items():
            for spec in JSON_IMPORT_RE.findall(txt or ""):
                want.add(_norm(posixpath.join(posixpath.dirname(path), spec)))
        for k, v in tree.read_many(sorted(want)).items():
            if v is not None:
                json_modules[k] = v
    payload = {"appDir": str(nm.resolve().parent), "cwd": "app", "jsonModules": json_modules,
               "envNames": sorted(env_names or ()),
               "files": [{"path": k, "content": v} for k, v in files.items()],
               "configs": [{"path": k, "content": v} for k, v in configs.items()]}
    p = subprocess.run([node, str(HERE / "agent_closure_graph.mjs")], input=json.dumps(payload).encode("utf-8"),
                       capture_output=True, timeout=600)
    if p.returncode != 0:
        raise RuntimeError("js extractor failed: " + p.stderr.decode("utf-8", "replace")[-400:])
    return json.loads(p.stdout.decode("utf-8"))


JS_TRY = ("", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json", "/index.js", "/index.jsx", "/index.ts",
          "/index.tsx", "/index.mjs")


def resolve_js(tree: Tree, importer: str, spec: str, aliases: list[tuple[str, str]], dis: set[str]
               ) -> tuple[str | None, bool, str | None]:
    """-> (repo path or None for external, follow?, uncertainty reason)."""
    raw = spec
    text_only = bool(re.search(r"\?(raw|url)\b", spec))
    spec = QUERY_RE.sub("", spec)
    if spec.startswith(("node:", "virtual:", "http:", "https:", "data:")):
        return None, False, None
    base = None
    if spec.startswith("./") or spec.startswith("../") or spec in (".", ".."):
        base = _norm(posixpath.join(posixpath.dirname(importer), spec))
    elif spec.startswith("/"):
        base = _norm("app" + spec)  # vite root = app
    else:
        if "alias" not in dis:
            for find, repl in aliases:
                if spec == find or spec.startswith(find.rstrip("/") + "/"):
                    if HOLE in repl or not repl.startswith(R + "/"):
                        return None, False, f"alias {find!r} has a replacement the resolver cannot evaluate"
                    base = _norm(repl[len(R) + 1:] + spec[len(find):])
                    break
        if base is None:
            return None, False, None  # bare package -> external (package.json / lock are ALWAYS-SENSITIVE)
    for suf in JS_TRY:
        if base + suf in tree.files:
            return base + suf, not text_only, None
    if base in tree.files:
        return base, not text_only, None
    return None, False, f"cannot resolve {raw!r}"


# ---- Python ------------------------------------------------------------------------------------------------
class PyEval:
    """Abstract evaluator for path expressions in one Python file. Values are strings with HOLEs (or TMP)."""

    MAXV = 64

    def __init__(self, path: str, src: str, tree: Tree, loader):
        self.path = path
        self.tree = tree
        self.loader = loader  # (module dotted, importer) -> repo file or None
        self.mod = ast.parse(src)
        self.src = src
        self.file_abs = R + "/" + path
        self.binds: dict[str, list] = {}
        self.funcs: dict[str, list] = {}
        self.calls: dict[str, list] = {}
        self.imports: dict[str, tuple[str, str]] = {}
        self.busy: set = set()
        self.memo: dict = {}
        self.inflight: set = set()
        self.cuts = 0
        self.bind_scope: dict[str, list] = {}
        self.mod_alias: dict[str, str] = {}
        self.env: dict[str, list] = {}
        self.mcalls: dict[str, list] = {}
        self.env_dyn: list = []
        self.class_attrs: dict[str, list] = {}
        self.parents: dict = {}
        for n in ast.walk(self.mod):
            for c in ast.iter_child_nodes(n):
                self.parents[c] = n
        self._collect()
        for nm, bs in self.binds.items():  # bindings added without a scope (params, parametrize) belong to "any"
            sc = self.bind_scope.setdefault(nm, [])
            sc.extend(["any"] * (len(bs) - len(sc)))

    def _scope(self, node):
        p = self.parents.get(node)
        while p is not None and not isinstance(p, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            p = self.parents.get(p)
        return p

    def _pbind(self, name, b, fn):
        """A parameter binding: scoped to its own function."""
        self.binds.setdefault(name, []).append(b)
        sc = self.bind_scope.setdefault(name, [])
        sc.extend(["any"] * (len(self.binds[name]) - 1 - len(sc)))
        sc.append(fn)

    def _bind_target(self, t, src):
        if isinstance(t, ast.Name):
            self.binds.setdefault(t.id, []).append(src)
            self.bind_scope.setdefault(t.id, []).append(self._scope(t))
        elif isinstance(t, (ast.Tuple, ast.List)):
            for i, e in enumerate(t.elts):
                self._bind_target(e, ("idx", src, i))
        elif isinstance(t, ast.Starred):
            self._bind_target(t.value, ("hole",))

    def _collect(self):
        for n in ast.walk(self.mod):
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    self._bind_target(t, ("expr", n.value))
            elif isinstance(n, (ast.AnnAssign, ast.AugAssign)) and n.value is not None:
                self._bind_target(n.target, ("expr", n.value) if isinstance(n, ast.AnnAssign) else ("hole",))
            elif isinstance(n, ast.NamedExpr):
                self._bind_target(n.target, ("expr", n.value))
            elif isinstance(n, (ast.For, ast.AsyncFor)):
                self._bind_target(n.target, ("elem", ("expr", n.iter)))
            elif isinstance(n, ast.comprehension):
                self._bind_target(n.target, ("elem", ("expr", n.iter)))
            elif isinstance(n, (ast.With, ast.AsyncWith)):
                for it in n.items:
                    if it.optional_vars is not None:
                        self._bind_target(it.optional_vars, ("hole",))
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.funcs.setdefault(n.name, []).append(n)
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                self.calls.setdefault(n.func.id, []).append(n)
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                self.mcalls.setdefault(n.func.attr, []).append(n)  # obj.method(...): bound to methods by name
            elif isinstance(n, ast.ClassDef):
                for st in n.body:  # class attributes: `obj.attr` of an instance falls back to these
                    if isinstance(st, ast.Assign):
                        for t in st.targets:
                            names = [t] if isinstance(t, ast.Name) else list(t.elts) if isinstance(t, ast.Tuple) else []
                            for i, e in enumerate(names):
                                if isinstance(e, ast.Name):
                                    self.class_attrs.setdefault(e.id, []).append(
                                        ("expr", st.value) if isinstance(t, ast.Name) else ("idx", ("expr", st.value), i))
            elif isinstance(n, ast.ImportFrom):
                for a in n.names:
                    self.imports[a.asname or a.name] = ("." * n.level + (n.module or ""), a.name)
            elif isinstance(n, ast.Import):
                for a in n.names:
                    self.mod_alias[a.asname or a.name.split(".")[0]] = a.name if a.asname else a.name.split(".")[0]
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("setenv", "setdefault", "putenv")                     and len(n.args) >= 2:
                if isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str):
                    self.env.setdefault(n.args[0].value, []).append(n.args[1])
                else:
                    self.env_dyn.append((n.args[0], n.args[1]))  # key is a constant elsewhere: resolved on first use
            elif isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Subscript)                     and _is_environ(n.targets[0].value) and isinstance(n.targets[0].slice, ast.Constant):
                self.env.setdefault(str(n.targets[0].slice.value), []).append(n.value)
            elif isinstance(n, ast.ExceptHandler) and n.name:
                self.binds.setdefault(n.name, []).append(("hole",))
            elif isinstance(n, ast.Lambda):
                for a in n.args.args:
                    self.binds.setdefault(a.arg, []).append(("hole",))
        for name, defs in self.funcs.items():
            for fn in defs:
                params = [a.arg for a in fn.args.posonlyargs + fn.args.args]
                kwonly = [a.arg for a in fn.args.kwonlyargs]
                # pytest.mark.parametrize("a,b", [...])
                for d in fn.decorator_list:
                    if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr == "parametrize" \
                            and len(d.args) >= 2 and isinstance(d.args[0], ast.Constant) and isinstance(d.args[0].value, str):
                        names = [x.strip() for x in d.args[0].value.split(",") if x.strip()]
                        rows = ("elem", ("expr", d.args[1]))
                        for i, nm in enumerate(names):
                            self._pbind(nm, ("idx", rows, i) if len(names) > 1 else rows, fn)
                calls = self.calls.get(name, [])
                defaults = fn.args.defaults
                for i, p in enumerate(params):
                    if p in ("self", "cls"):
                        continue
                    if p in ("tmp_path", "tmpdir", "tmp_path_factory"):
                        self._pbind(p, ("tmp",), fn)
                        continue
                    di = i - (len(params) - len(defaults))
                    if di >= 0:
                        self._pbind(p, ("expr", defaults[di]), fn)
                    found = False
                    for c in calls:
                        if i < len(c.args) and not isinstance(c.args[i], ast.Starred):
                            self._pbind(p, ("expr", c.args[i]), fn)
                            found = True
                        for kw in c.keywords:
                            if kw.arg == p:
                                self._pbind(p, ("expr", kw.value), fn)
                                found = True
                    if not found and p in self.funcs and p != name:
                        self._pbind(p, ("fixture", p), fn)
                    elif not found and "sys.argv" in self.src and not calls:
                        self._pbind(p, ("argv", i), fn)  # a CLI entry point: its args come from argv
                    elif not found and p not in self.binds and di < 0:
                        self._pbind(p, ("hole",), fn)
                for p in kwonly:
                    self._pbind(p, ("hole",), fn)
                if fn.args.vararg:
                    # *args: the extra positional arguments at each call (a method's calls are obj.name(...))
                    is_method = isinstance(self.parents.get(fn), ast.ClassDef)
                    sites = self.mcalls.get(name, []) if is_method else calls
                    fixed = len(params) - (1 if is_method and params and params[0] in ("self", "cls") else 0)
                    for c in sites:
                        extra = c.args[fixed:]
                        self._pbind(fn.args.vararg.arg, ("expr", ast.Tuple(elts=list(extra), ctx=ast.Load())), fn)
                    if not sites:
                        self._pbind(fn.args.vararg.arg, ("hole",), fn)
                if fn.args.kwarg:
                    self._pbind(fn.args.kwarg.arg, ("hole",), fn)

    # values: str | ("arr", [vals]) | ("tuple", [vals]) | None(hole)
    def _cap(self, vs):
        if len(vs) > 1:
            seen, out = set(), []
            for v in vs:
                k = repr(v)
                if k not in seen:
                    seen.add(k)
                    out.append(v)
            vs = out
        return vs if len(vs) <= self.MAXV else [None]

    def strs(self, vs) -> list[str]:
        out = []
        for v in vs:
            out.append(v if isinstance(v, str) else HOLE)
        return list(dict.fromkeys(out))

    def elems(self, vs):
        out = []
        for v in vs:
            if isinstance(v, tuple) and v[0] in ("arr", "tuple"):
                out.extend(v[1])
            elif isinstance(v, tuple) and v[0] == "dict":
                out.extend(k for k in v[1] if isinstance(k, str))
                if None in v[1] or any(not isinstance(k, str) for k in v[1]):
                    out.append(None)
            else:
                out.append(None)
        return self._cap(out)

    def _bind(self, b, depth):
        k = b[0]
        if k == "expr":
            return self.ev(b[1], depth)
        if k == "elem":
            return self.elems(self._bind(b[1], depth))
        if k == "idx":
            rows = self._bind(b[1], depth)
            out = []
            for r in rows:
                if isinstance(r, tuple) and r[0] in ("arr", "tuple") and len(r[1]) > b[2]:
                    out.append(r[1][b[2]])
                else:
                    out.append(None)
            return self._cap(out)
        if k == "wrap":
            return [("arr", [v]) for v in self._bind(b[1], depth)]
        if k == "argv":
            off = self._argv_offset()
            return self._argv(None if off is None else off + b[1])
        if k == "tmp":
            return [TMP]
        if k == "fixture":
            return self._returns(b[1], depth)
        return [None]

    def _returns(self, fname, depth):
        key = ("fn", fname)
        if key in self.busy:
            self.cuts += 1
            return []
        self.busy.add(key)
        try:
            out = []
            for fn in self.funcs.get(fname, []):
                rets, ys, gen = [], [], False
                for n in _walk_own(fn):
                    if isinstance(n, ast.Return) and n.value is not None:
                        rets.extend(self.ev(n.value, depth + 1))
                    elif isinstance(n, (ast.Yield, ast.YieldFrom)):
                        gen = True
                        if n.value is not None:
                            v = self.ev(n.value, depth + 1)
                            ys.extend(self.elems(v) if isinstance(n, ast.YieldFrom) else v)
                if gen and any(isinstance(d, (ast.Name, ast.Attribute, ast.Call)) and "fixture" in ast.unparse(d)
                               for d in fn.decorator_list):
                    out.extend(ys)  # a yield fixture hands its yielded value to the test
                elif gen:
                    out.append(("arr", self._cap(ys or [None])))
                else:
                    out.extend(rets)
            return self._cap(out or [None])
        finally:
            self.busy.discard(key)

    def name(self, nm, depth, use=None):
        if nm == "__file__":
            return [self.file_abs]
        if nm in ("__name__", "__package__"):
            dotted = self.path[:-3].replace("/", ".")
            if dotted.endswith(".__init__"):
                dotted = dotted[: -len(".__init__")]
                return [dotted]
            return [dotted if nm == "__name__" else dotted.rsplit(".", 1)[0]]
        bs = self.binds.get(nm)
        key = (nm, None)
        if bs and use is not None:
            # lexical scope chain: the innermost enclosing function that binds the name wins
            scopes = self.bind_scope.get(nm, [])
            sc = self._scope(use)
            picked = None
            while sc is not None:
                local = [b for b, s2 in zip(bs, scopes) if s2 is sc]
                if local:
                    picked = local
                    key = (nm, id(sc))
                    break
                sc = self._scope(sc)
            if picked is None:
                picked = [b for b, s2 in zip(bs, scopes) if s2 is None or s2 == "any"]
            bs = picked or bs
        if key in self.busy:  # the SAME variable (name + scope) refers back to itself
            self.cuts += 1
            return []  # least fixpoint: a binding that refers back to itself adds no new value
        if not bs and nm in self.imports:
            return self._imported(nm, depth)
        if not bs:
            return [None]
        self.busy.add(key)
        try:
            out = []
            for b in bs:
                out.extend(self._bind(b, depth + 1))
            return self._cap(out) if out else []
        finally:
            self.busy.discard(key)

    def _argv(self, pos: "int | None" = None):
        """The argument strings this script is run with, from the exec call sites seen so far (unknown if none).
        pos = one argv position (sys.argv[pos]); None = any position."""
        runs = getattr(self.loader, "argv_by_script", {}).get(self.path)
        if not runs:
            return [None]
        out = []
        for argv in runs:
            if pos is None:
                out.extend(argv)
            elif pos < len(argv):
                out.append(argv[pos])
        return self._cap(out) if out else [UNSET]

    def _argv_offset(self):
        """k when the module dispatches `f(*sys.argv[k:])`: parameter i of f is sys.argv[k + i]."""
        for n in ast.walk(self.mod):
            if isinstance(n, ast.Starred) and isinstance(n.value, ast.Subscript) and isinstance(n.value.slice, ast.Slice)                     and isinstance(n.value.value, ast.Attribute) and n.value.value.attr == "argv"                     and isinstance(n.value.slice.lower, ast.Constant) and n.value.slice.upper is None:
                return n.value.slice.lower.value
        return None

    def _resolve_env_dyn(self):
        while self.env_dyn:
            k, v = self.env_dyn.pop()
            for kname in self.strs(self.ev(k)):
                if HOLE not in kname:
                    self.env.setdefault(kname, []).append(v)

    def _env(self, key, default, depth):
        for other in list(getattr(self.loader, "evals", {}).values()):
            if other is not None and other.env_dyn:
                other._resolve_env_dyn()
        """os.environ[K] / .get(K, d) / getenv: the values this file sets K to (setenv / environ[K] = v) + the default.
        Unset anywhere in the file -> unknown."""
        keys = self.strs(self.ev(key, depth + 1)) if key is not None else []
        if not keys or any(HOLE in k for k in keys):
            return [None]
        vals = []
        for kname in keys:
            vals.extend(v for node in self.env.get(kname, []) for v in self.ev(node, depth + 1))
            # a test sets the env (monkeypatch.setenv) that the PRODUCT module it calls then reads
            for other in list(getattr(self.loader, "evals", {}).values()):
                if other is not None and other is not self and kname in other.env:
                    vals.extend(v for node in other.env[kname] for v in other.ev(node, depth + 1))
            if kname in getattr(self.loader, "wf_env", {kname}):
                vals.append(None)  # the CI workflow may set it: unknown
        if default is not None:
            vals += self.ev(default, depth + 1)
        if not vals:
            vals.append(UNSET)
        return self._cap(vals)

    def _module_of(self, node) -> "PyEval | None":
        """`X` in `X.attr` when X names a repo module (import a.b as X / from a import b as X)."""
        if not isinstance(node, ast.Name) or node.id in self.binds:
            return None
        dotted = None
        if node.id in self.mod_alias:
            dotted = self.mod_alias[node.id]
        elif node.id in self.imports:
            mod, attr = self.imports[node.id]
            dotted = (mod + ("." if mod and not mod.endswith(".") else "") + attr)
        if not dotted:
            return None
        files = self.loader.module_file(dotted, self.path)
        if not files:
            return None
        return self.loader.evaluator(files[-1])

    def _imported(self, nm, depth):
        mod, attr = self.imports[nm]
        target = self.loader(mod, self.path)
        if not target or depth > 6:
            return [None]
        other = self.loader.evaluator(target)
        if other is None:
            return [None]
        return other.name(attr, depth + 1)

    def ev(self, n, depth=0):
        if n is None or depth > 16:
            return [None]
        k = id(n)
        if k in self.memo:
            return self.memo[k]
        if k in self.inflight:
            self.cuts += 1
            return []  # least fixpoint: a cycle back to this node adds nothing
        self.inflight.add(k)
        before = self.cuts
        try:
            r = self._ev(n, depth)
        finally:
            self.inflight.discard(k)
        if self.cuts == before:  # a value computed while a cycle was cut is partial: never memoised
            self.memo[k] = r
        return r

    def _ev(self, n, depth):
        if isinstance(n, ast.Constant):
            return [n.value] if isinstance(n.value, str) else []  # None / numbers / bools carry no path
        if isinstance(n, ast.JoinedStr):
            lists = []
            for v in n.values:
                if isinstance(v, ast.Constant):
                    lists.append([str(v.value)])
                elif isinstance(v, ast.FormattedValue):
                    lists.append(self.strs(self.ev(v.value, depth + 1)))
            return self._cross(lists, "".join)
        if isinstance(n, ast.Name):
            if n.id not in self.binds:
                mod = self._module_of(n)
                if mod is not None:
                    return [("module", mod.path)]
                if n.id in self.funcs:
                    return [("fn", n.id)]
            return self.name(n.id, depth, n)
        if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
            els = []
            for e in n.elts:
                if isinstance(e, ast.Starred):
                    els.extend(self.elems(self.ev(e.value, depth + 1)))
                else:
                    els.extend(self.ev(e, depth + 1))
            return [("tuple" if isinstance(n, ast.Tuple) else "arr", self._cap(els))]
        if isinstance(n, ast.Dict):
            d: dict = {}
            for k, v in zip(n.keys, n.values):
                if isinstance(k, ast.Constant):
                    d[k.value] = self.ev(v, depth + 1)
                else:
                    d.setdefault(None, []).extend(self.ev(v, depth + 1))
            return [("dict", d)]
        if isinstance(n, ast.BinOp):
            if isinstance(n.op, ast.Div):
                return self._cross([self.strs(self.ev(n.left, depth + 1)), self.strs(self.ev(n.right, depth + 1))],
                                   lambda a: _pjoin(a[0], a[1]))
            if isinstance(n.op, ast.Add):
                l, r = self.ev(n.left, depth + 1), self.ev(n.right, depth + 1)
                if any(isinstance(x, tuple) for x in l + r):
                    return [("arr", self._cap(self.elems(l) + self.elems(r)))]
                return self._cross([self.strs(l), self.strs(r)], "".join)
            if isinstance(n.op, ast.Mod):
                return [HOLE]
            return [None]
        if isinstance(n, ast.IfExp):
            return self._cap(self.ev(n.body, depth + 1) + self.ev(n.orelse, depth + 1))
        if isinstance(n, ast.BoolOp):
            return self._cap([v for x in n.values for v in self.ev(x, depth + 1)])
        if isinstance(n, ast.Subscript) and _is_environ(n.value):
            return self._env(n.slice, None, depth)
        if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Attribute) and n.value.attr == "argv":
            if isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, int):
                return self._argv(n.slice.value)
            return self._argv() if not isinstance(n.slice, ast.Slice) else [("arr", self._argv())]
        if isinstance(n, ast.Attribute) and n.attr == "argv" and isinstance(n.value, ast.Name) and n.value.id == "sys":
            return [("arr", self._argv())]
        if isinstance(n, ast.Subscript):
            base = n.value
            if isinstance(base, ast.Attribute) and base.attr == "parents":
                idx = n.slice
                k = idx.value if isinstance(idx, ast.Constant) and isinstance(idx.value, int) else None
                out = []
                for s in self.strs(self.ev(base.value, depth + 1)):
                    out.append(_pdir(s, (k + 1) if k is not None else None))
                return out
            vs = self.ev(base, depth + 1)
            key = n.slice.value if isinstance(n.slice, ast.Constant) else None
            out = []
            for v in vs:
                if isinstance(v, tuple) and v[0] == "dict":
                    if key is not None and key in v[1]:
                        out.extend(v[1][key])
                    else:
                        out.extend(x for xs in v[1].values() for x in xs)
                elif isinstance(v, tuple) and v[0] in ("arr", "tuple") and isinstance(key, int) and v[0] == "tuple"                         and -len(v[1]) <= key < len(v[1]):
                    out.append(v[1][key])
                else:
                    out.extend(self.elems([v]))
            return self._cap(out or [None])
        if isinstance(n, (ast.ListComp, ast.GeneratorExp, ast.SetComp)):
            return [("arr", self._cap(self.ev(n.elt, depth + 1)))]
        if isinstance(n, ast.Attribute):
            other = self._module_of(n.value)
            if other is None:
                mods = [v for v in self.ev(n.value, depth + 1) if isinstance(v, tuple) and v[0] == "module"]
                if mods:
                    out = []
                    for _, mp in mods:
                        o = self.loader.evaluator(mp)
                        if n.attr == "__file__":
                            out.append(R + "/" + mp)
                        elif o is not None:
                            out.extend(o.name(n.attr, depth + 1))
                        else:
                            out.append(None)
                    return self._cap(out)
            if other is not None:
                if n.attr == "__file__":
                    return [other.file_abs]
                return other.name(n.attr, depth + 1)
            if n.attr in ("parent",):
                return [_pdir(s, 1) for s in self.strs(self.ev(n.value, depth + 1))]
            if n.attr in ("path",):  # DirEntry.path
                base = self.ev(n.value, depth + 1)
                return [v if isinstance(v, str) else None for v in base]
            if n.attr in ("name", "stem", "suffix"):
                return [None]
            if n.attr in self.class_attrs:
                out = []
                for b in self.class_attrs[n.attr]:
                    out.extend(self._bind(b, depth + 1))
                return self._cap(out) or [None]
            return [None]
        if isinstance(n, ast.Call):
            return self._call(n, depth)
        if isinstance(n, ast.Starred):
            return self.ev(n.value, depth + 1)
        return [None]

    def _cross(self, lists, fn):
        acc = [[]]
        for l in lists:
            acc = [a + [x] for a in acc for x in l]
            if len(acc) > self.MAXV:
                return [HOLE]
        return list(dict.fromkeys(fn(a) for a in acc))

    def _call(self, n: ast.Call, depth):
        f = n.func
        fname = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
        recv = f.value if isinstance(f, ast.Attribute) else None
        args = n.args
        if fname in ("Path", "PurePath", "PosixPath", "WindowsPath", "PurePosixPath"):
            if not args:
                return ["."]
            return self._cross([self.strs(self.ev(a, depth + 1)) for a in args], lambda a: _pjoin(*a))
        if fname in ("cwd", "getcwd", "home") and fname != "home":
            return [R]
        if fname in ("mkdtemp", "gettempdir", "TemporaryDirectory", "mktemp", "mkdir") and fname != "mkdir":
            return [TMP]
        if fname in ("resolve", "absolute", "expanduser", "as_posix") and recv is not None:
            return self.ev(recv, depth + 1)
        if fname in ("str", "fspath", "Path") and args:
            return self.ev(args[0], depth + 1)
        if fname == "joinpath" and recv is not None:
            return self._cross([self.strs(self.ev(recv, depth + 1))] + [self.strs(self.ev(a, depth + 1)) for a in args],
                               lambda a: _pjoin(*a))
        if fname == "join" and isinstance(recv, ast.Attribute) and recv.attr == "path":
            return self._cross([self.strs(self.ev(a, depth + 1)) for a in args], lambda a: _pjoin(*a))
        if fname in ("dirname",) and args:
            return [_pdir(s, 1) for s in self.strs(self.ev(args[0], depth + 1))]
        if fname == "relpath":
            return [HOLE]
        if fname in ("abspath", "realpath", "normpath") and args:
            return self.ev(args[0], depth + 1)
        if fname in ("items", "values", "keys") and recv is not None and not args:
            out = []
            for v in self.ev(recv, depth + 1):
                if isinstance(v, tuple) and v[0] == "dict":
                    for k, vs in v[1].items():
                        if fname == "keys":
                            out.append(k if isinstance(k, str) else None)
                        elif fname == "values":
                            out.extend(vs)
                        else:
                            out.extend(("tuple", [k if isinstance(k, str) else None, x]) for x in vs)
                else:
                    out.append(None)
            return [("arr", self._cap(out))]
        if fname in ("sorted", "list", "tuple", "set", "reversed") and args:
            return [("arr", self.elems(self.ev(args[0], depth + 1)))]
        if fname in ("glob", "rglob", "iterdir") and recv is not None and not (isinstance(recv, ast.Name) and recv.id == "glob"):
            base = self.strs(self.ev(recv, depth + 1))
            pat = self.strs(self.ev(args[0], depth + 1)) if args else [""]
            sep = "/**/" if fname == "rglob" else "/"
            return [("arr", self._cap([_pjoin(b, HOLE) if fname == "iterdir" else b + sep + p.replace("*", HOLE)
                                       for b in base for p in pat]))]
        if fname == "listdir" and args:
            return [("arr", [HOLE])]
        if fname == "scandir" and args:  # DirEntry: .path is under the directory
            return [("arr", [_pjoin(s, HOLE) for s in self.strs(self.ev(args[0], depth + 1))])]
        if fname == "walk" and args:  # (dirpath, dirnames, filenames)
            return [("arr", [("tuple", [_pjoin(s, HOLE) if s != HOLE else HOLE, None, None])
                             for s in self.strs(self.ev(args[0], depth + 1))] + [("tuple", [s, None, None])
                                                                                 for s in self.strs(self.ev(args[0], depth + 1))])]
        if fname in ("glob", "iglob") and args:
            return [("arr", [s.replace("*", HOLE) for s in self.strs(self.ev(args[0], depth + 1))])]
        if fname in ("with_suffix", "with_name", "with_stem") and recv is not None:
            return [_pjoin(_pdir(s, 1), HOLE) for s in self.strs(self.ev(recv, depth + 1))]
        if (fname == "getenv" or (fname == "get" and recv is not None and _is_environ(recv))) and args:
            return self._env(args[0], args[1] if len(args) > 1 else None, depth)
        if fname in ("partition", "rpartition", "split", "rsplit") and recv is not None:
            out = []
            sep = self.strs(self.ev(args[0], depth + 1)) if args else [None]
            for v in self.strs(self.ev(recv, depth + 1)):
                if HOLE in v or len(sep) != 1 or (sep[0] is not None and HOLE in sep[0]):
                    out.append(("tuple", [None]))
                elif fname in ("partition", "rpartition"):
                    out.append(("tuple", list(getattr(v, fname)(sep[0]))))
                else:
                    out.append(("tuple", list(getattr(v, fname)(sep[0]))))
            return self._cap(out)
        if fname in ("strip", "lstrip", "rstrip", "lower", "upper") and recv is not None and not args:
            return [getattr(v, fname)() if HOLE not in v else HOLE for v in self.strs(self.ev(recv, depth + 1))]
        if fname == "format":
            return [HOLE]
        if isinstance(f, ast.Attribute):
            other = self._module_of(f.value)
            if other is not None and f.attr in other.funcs and depth < 8:
                return other._returns(f.attr, depth + 1)
        if isinstance(f, ast.Name) and f.id not in self.binds and f.id in self.imports and f.id not in self.funcs:
            mod, attr = self.imports[f.id]
            target = self.loader(mod, self.path)
            other = self.loader.evaluator(target) if target else None
            if other is not None and attr in other.funcs and depth < 8:
                return other._returns(attr, depth + 1)
        if isinstance(f, ast.Name) and f.id in self.binds:
            # a name bound to a function VALUE (a factory fixture's returned closure): call what it holds
            out = []
            for v in self.name(f.id, depth, f):
                if isinstance(v, tuple) and v[0] == "fn":
                    out.extend(self._returns(v[1], depth))
                else:
                    out.append(None)
            return self._cap(out)
        if isinstance(f, ast.Name) and f.id in self.funcs:
            return self._returns(f.id, depth)
        return [None]


def _walk_own(fn):
    """ast.walk over a function body without descending into nested functions/lambdas/classes."""
    todo = list(ast.iter_child_nodes(fn))
    while todo:
        n = todo.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            todo.extend(ast.iter_child_nodes(n))


def _is_environ(node) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "environ") or (isinstance(node, ast.Name) and node.id == "environ")


def _pjoin(*parts: str) -> str:
    acc = ""
    for p in parts:
        if p.startswith("/") or p.startswith(TMP):
            acc = p
        elif not acc:
            acc = p
        else:
            acc = acc.rstrip("/") + "/" + p
    if acc.startswith(TMP):
        return TMP
    if acc.startswith("/"):
        return "/" + _norm(acc)
    return acc


def _pdir(s: str, k: int | None) -> str:
    if s.startswith(TMP):
        return TMP
    if k is None or s.startswith(HOLE):
        return HOLE
    if not s.startswith("/"):
        s = R + "/" + s
    parts = ("/" + _norm(s)).split("/")
    for _ in range(k):
        if len(parts) > 1 and HOLE in parts[-1]:
            return "/".join(parts[:-1]) + "/" + HOLE
        if len(parts) > 1:
            parts = parts[:-1]
    out = "/".join(parts)
    return out or "/"


class PyLoader:
    def __init__(self, tree: Tree, extra_roots: dict[str, list[str]]):
        self.tree = tree
        self.extra_roots = extra_roots
        self.evals: dict[str, PyEval | None] = {}

    def module_file(self, dotted: str, importer: str) -> list[str]:
        """dotted (may be relative: '..x.y') -> repo files that execute on import (package __init__s + module)."""
        level = len(dotted) - len(dotted.lstrip("."))
        name = dotted[level:]
        roots: list[str]
        if level:
            base = posixpath.dirname(importer)
            for _ in range(level - 1):
                base = posixpath.dirname(base)
            roots = [base]
        else:
            roots = [""] + [posixpath.dirname(importer)] + self.extra_roots.get(importer, [])
        parts = name.split(".") if name else []
        for root in roots:
            hits = []
            cur = root
            ok = True
            for i, part in enumerate(parts):
                cur = posixpath.join(cur, part) if cur else part
                init = cur + "/__init__.py"
                if i < len(parts) - 1:
                    if init in self.tree.files:
                        hits.append(init)
                    elif cur in self.tree.dirs:
                        pass  # namespace package
                    else:
                        ok = False
                        break
                else:
                    if cur + ".py" in self.tree.files:
                        hits.append(cur + ".py")
                    elif init in self.tree.files:
                        hits.append(init)
                    elif cur in self.tree.dirs:
                        pass
                    else:
                        ok = False
            if not parts and level:
                init = posixpath.join(root, "__init__.py")
                if init in self.tree.files:
                    return [init]
                return []
            if ok and (hits or (parts and posixpath.join(root, *parts) in self.tree.dirs)):
                return hits
        return []

    def is_repo_top(self, dotted: str, importer: str) -> bool:
        top = dotted.lstrip(".").split(".")[0]
        if dotted.startswith("."):
            return True
        for root in [""] + [posixpath.dirname(importer)] + self.extra_roots.get(importer, []):
            p = posixpath.join(root, top) if root else top
            if p in self.tree.dirs or p + ".py" in self.tree.files:
                return True
        return False

    def __call__(self, dotted: str, importer: str) -> str | None:
        fs = self.module_file(dotted, importer)
        return fs[-1] if fs else None

    def evaluator(self, path: str) -> PyEval | None:
        if path not in self.evals:
            src = self.tree.read(path)
            try:
                self.evals[path] = PyEval(path, src, self.tree, self) if src is not None else None
            except SyntaxError:
                self.evals[path] = None
        return self.evals[path]


PY_READ_METHODS = {"read_text", "read_bytes", "open", "iterdir", "exists", "is_file", "is_dir", "stat", "glob", "rglob",
                   "walk", "lstat", "samefile", "readlink"}
PY_READ_FUNCS = {"listdir", "scandir", "walk", "exists", "isfile", "isdir", "getsize", "getmtime", "iglob", "copy",
                 "copyfile", "copy2", "copytree", "load_workbook", "read_csv"}
PY_EXEC_FUNCS = {"run", "call", "check_call", "check_output", "Popen", "system", "create_subprocess_exec",
                 "create_subprocess_shell", "getoutput", "getstatusoutput"}


def analyze_py(path: str, loader: PyLoader, dis: set[str], harvest: bool = False) -> tuple[list[dict], list[dict]]:
    """-> (refs, uncertain). A ref is {kind, target(s) or pattern, follow, line}."""
    refs: list[dict] = []
    unc: list[dict] = []
    ev = loader.evaluator(path)
    if ev is None:
        src = loader.tree.read(path)
        if src is None:
            return refs, unc
        return refs, [{"why": "python parse error", "line": 0}]
    tree = loader.tree

    def read_pat(node, kind, line, follow=False):
        vals = ev.strs(ev.ev(node)) or [HOLE]  # nothing derivable = unknown
        for s in vals:
            if s.startswith(TMP) or UNSET in s:
                continue
            if not s.startswith("/"):
                if s.startswith(HOLE):
                    unc.append({"why": f"{kind}: path is computed from a value the resolver cannot bound: "
                                       f"{ast.unparse(node)[:80]}", "line": line})
                    continue
                s = R + "/" + s  # pytest runs from the repo root
            if not s.startswith(R + "/"):
                if s.startswith(HOLE) or s.startswith("/" + HOLE):
                    unc.append({"why": f"{kind}: path is computed from a value the resolver cannot bound", "line": line})
                continue
            refs.append({"kind": kind, "pattern": s, "follow": follow, "line": line})

    def absent(dotted, kind, line):
        # a repo module that does not exist at this revision (an optional import under try/except): the Δ that ADDS it
        # must reach this importer, so the candidate files are members even though they are absent
        if dotted.startswith("."):
            return False
        rel = dotted.replace(".", "/")
        for cand in (rel + ".py", rel + "/__init__.py"):
            refs.append({"kind": kind, "target": cand, "follow": False, "line": line})
        return True

    def module_ref(dotted, kind, line):
        files = loader.module_file(dotted, path)
        if files:
            for f in files:
                refs.append({"kind": kind, "target": f, "follow": True, "line": line})
        elif loader.is_repo_top(dotted, path):
            if not absent(dotted, kind, line):
                unc.append({"why": f"cannot resolve python module {dotted!r}", "line": line})

    if harvest and "py-read" not in dis:
        # PATH HARVEST (product modules): any repo path anchored at __file__ / a repo root constant, wherever it is
        # built (an argument to a cross-module loader, a module constant), is an edge — so a read through a helper in
        # another module is not lost when that helper's own read site is only a parameter.
        for n in ast.walk(ev.mod):
            vals = []
            if isinstance(n, ast.Assign):
                vals = [n.value]
            elif isinstance(n, ast.Call):
                vals = list(n.args) + [k.value for k in n.keywords]
            for v in vals:
                if isinstance(v, (ast.Constant,)):
                    continue
                for s in ev.strs(ev.ev(v)):
                    if not s.startswith(R + "/") or HOLE in s:
                        continue
                    rel = _norm(s[len(R) + 1:])
                    if rel in tree.files:  # exact existing files only: a directory or a pattern is not a harvest
                        refs.append({"kind": "path", "target": rel, "follow": False, "line": getattr(n, "lineno", 0)})
    # DOTTED HARVEST: 'api.services.x' / 'api.services.x:fn' string literals naming a repo module (registries that
    # feed importlib) are followed edges
    for n in ast.walk(ev.mod):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) < 200:
            m = DOTTED_RE.match(n.value)
            if m and "dotted" not in dis and loader.is_repo_top(m.group(1), path):
                for f in loader.module_file(m.group(1), path):
                    refs.append({"kind": "dotted", "target": f, "follow": True, "line": getattr(n, "lineno", 0)})
    for n in ast.walk(ev.mod):
        line = getattr(n, "lineno", 0)
        if isinstance(n, ast.Import):
            for a in n.names:
                module_ref(a.name, "import", line)
        elif isinstance(n, ast.ImportFrom):
            dotted = "." * n.level + (n.module or "")
            base = loader.module_file(dotted, path)
            if base or (n.level and not n.module):
                for f in base:
                    refs.append({"kind": "import", "target": f, "follow": True, "line": line})
            elif loader.is_repo_top(dotted, path):
                if not absent(dotted, "import", line):
                    unc.append({"why": f"cannot resolve python module {dotted!r}", "line": line})
            for a in n.names:
                if a.name == "*":
                    continue
                sub = dotted + ("." if dotted and not dotted.endswith(".") else "") + a.name
                subs = loader.module_file(sub, path)
                for f in subs:
                    refs.append({"kind": "import", "target": f, "follow": True, "line": line})
                if not subs and base and base[-1].endswith("__init__.py"):
                    pkg_dir = posixpath.dirname(base[-1])
                    for cand in (f"{pkg_dir}/{a.name}.py", f"{pkg_dir}/{a.name}/__init__.py"):
                        refs.append({"kind": "import", "target": cand, "follow": False, "line": line})
        elif isinstance(n, ast.Call):
            f = n.func
            fname = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            recv = f.value if isinstance(f, ast.Attribute) else None
            if fname in ("import_module", "__import__"):
                if "py-importlib" in dis:
                    continue
                if not n.args:
                    continue
                vals = ev.strs(ev.ev(n.args[0]))
                for v in vals:
                    if HOLE in v:
                        pre = v.split(HOLE, 1)[0]
                        if pre.count(".") >= 2 and not pre.startswith("."):
                            # f"api.services.{mod}" — bounded like vite's dynamic-import vars: every module under it
                            d = R + "/" + pre.rsplit(".", 1)[0].replace(".", "/")
                            for pat in (d + "/*.py", d + "/*/__init__.py"):
                                refs.append({"kind": "importlib", "pattern": pat, "follow": True, "line": line,
                                             "no_tests": True})
                        else:
                            unc.append({"why": f"{fname}() with a computed module name", "line": line})
                    else:
                        pkg = None
                        if v.startswith(".") and len(n.args) > 1:
                            pk = ev.strs(ev.ev(n.args[1]))
                            pkg = pk[0] if pk and HOLE not in pk[0] else None
                            if pkg is None:
                                unc.append({"why": "relative import_module with a computed package", "line": line})
                                continue
                            v = pkg + v if v.startswith(".") else v
                        module_ref(v, "importlib", line)
                continue
            if fname in ("run_path", "spec_from_file_location", "SourceFileLoader", "run_module"):
                if "py-exec" in dis:
                    continue
                if fname == "run_module" and n.args:
                    for v in ev.strs(ev.ev(n.args[0])):
                        if HOLE in v:
                            unc.append({"why": "runpy.run_module with a computed name", "line": line})
                        else:
                            module_ref(v, "exec", line)
                    continue
                arg = n.args[1] if fname in ("spec_from_file_location", "SourceFileLoader") and len(n.args) > 1 else \
                    (n.args[0] if n.args else None)
                if arg is None:
                    for kw in n.keywords:
                        if kw.arg in ("location", "path", "path_name"):
                            arg = kw.value
                if arg is not None:
                    read_pat(arg, "exec", line, follow=True)
                continue
            if fname in PY_EXEC_FUNCS and (isinstance(recv, ast.Name) and recv.id in ("subprocess", "os", "asyncio")
                                           or isinstance(f, ast.Name) and fname in ("check_output", "check_call", "Popen")):
                if "py-exec" in dis:
                    continue
                toks: list[str] = []
                for a in list(n.args) + [k.value for k in n.keywords if k.arg in ("args",)]:
                    for v in ev.ev(a):
                        items = v[1] if isinstance(v, tuple) else [v]
                        for it in items:
                            s = it if isinstance(it, str) else HOLE
                            toks.extend(s.split())
                for k, sc in enumerate(toks):
                    if not sc.endswith(".py") or sc.startswith(HOLE):
                        continue
                    rel = _norm(sc[len(R) + 1:]) if sc.startswith(R + "/") else _norm(sc)
                    loader.argv_by_script = getattr(loader, "argv_by_script", {})
                    loader.argv_by_script.setdefault(rel, []).append(toks[k:])  # sys.argv as the script sees it
                for i, t in enumerate(toks):
                    if t == "-m" and i + 1 < len(toks) and HOLE not in toks[i + 1]:
                        module_ref(toks[i + 1], "exec", line)
                    elif re.search(r"\.(py|mjs|js|cjs|sh)$", t) or "tools/" in t:
                        if t.startswith(HOLE):
                            unc.append({"why": "subprocess runs a script whose path cannot be bounded", "line": line})
                        else:
                            read_pat(ast.Constant(t), "exec", line, follow=t.endswith(".py"))
                continue
            if "py-read" in dis:
                continue
            mode = None
            if len(n.args) > 1 and isinstance(n.args[1], ast.Constant) and isinstance(n.args[1].value, str):
                mode = n.args[1].value
            for kw in n.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    mode = kw.value.value
            write_only = mode is not None and not ("r" in mode or "+" in mode)
            if fname == "open" and isinstance(f, ast.Name) and n.args:
                if not write_only:
                    read_pat(n.args[0], "read", line)
            elif fname == "open" and isinstance(recv, ast.Name) and recv.id in ("io", "codecs") and n.args:
                read_pat(n.args[0], "read", line)
            elif fname == "open" and recv is not None and write_only and not n.args[:0]:
                pass
            elif fname in PY_READ_METHODS and recv is not None and not (isinstance(recv, ast.Attribute) and
                                                                        ast.unparse(recv) == "os.path")                     and not (isinstance(recv, ast.Name) and recv.id in
                                                                        ("os", "glob", "shutil", "json", "sys", "re",
                                                                         "ast", "io", "codecs", "subprocess", "tempfile")):
                if fname in ("glob", "rglob") and n.args:
                    for b in ev.strs(ev.ev(recv)):
                        for p in ev.strs(ev.ev(n.args[0])):
                            sep = "/**/" if fname == "rglob" else "/"
                            read_pat(ast.Constant(b + sep + p.replace("*", HOLE)), "read", line)
                elif fname == "walk" and isinstance(recv, ast.Name) and recv.id == "os":
                    pass
                else:
                    read_pat(recv, "read", line)
            elif fname in PY_READ_FUNCS and n.args and (
                    (isinstance(recv, ast.Name) and recv.id in ("os", "glob", "shutil", "pd", "pandas", "openpyxl"))
                    or (isinstance(recv, ast.Attribute) and recv.attr == "path")
                    or (isinstance(f, ast.Name) and f.id not in ev.funcs and f.id not in ev.binds
                        and ev.imports.get(f.id, ("",))[0] in ("os", "os.path", "glob", "shutil"))):
                if fname in ("glob", "iglob"):
                    read_pat(ast.Constant(ev.strs(ev.ev(n.args[0]))[0].replace("*", HOLE)) if len(ev.strs(ev.ev(n.args[0]))) == 1
                             else n.args[0], "read", line)
                else:
                    read_pat(n.args[0], "read", line)
            elif fname == "glob" and isinstance(recv, ast.Name) and recv.id == "glob" and n.args:
                for p in ev.strs(ev.ev(n.args[0])):
                    read_pat(ast.Constant(p.replace("*", HOLE)), "read", line)
            elif fname in ("insert", "append") and isinstance(recv, ast.Attribute) and recv.attr == "path" \
                    and isinstance(recv.value, ast.Name) and recv.value.id == "sys":
                arg = n.args[-1] if n.args else None
                for s in ev.strs(ev.ev(arg)):
                    if s.startswith(R + "/") and HOLE not in s:
                        loader.extra_roots.setdefault(path, []).append(_norm(s[len(R) + 1:]))
                    elif s == R:
                        loader.extra_roots.setdefault(path, []).append("")
                    elif not s.startswith(TMP) and (HOLE in s or not s.startswith("/")):
                        unc.append({"why": "sys.path entry the resolver cannot evaluate", "line": line})
                    # else: an absolute path outside the repo is not repo state
    return refs, unc


TEST_SIDE_RE = re.compile(r"(^|/)(tests?|__tests__|__fixtures__|testing|test_utils|fixtures)/|(^|/)conftest\.py$|"
                          r"(^|/)test_[^/]*\.py$|_test\.py$")


def is_test_side(path: str) -> bool:
    """Test-side Python: every unbounded read here is fail-closed. Product modules' unbounded reads are runtime I/O."""
    return bool(TEST_SIDE_RE.search(path))


# ---- graph --------------------------------------------------------------------------------------------------
class Graph:
    def __init__(self, tree: Tree, js_seeds, py_seeds):
        self.tree = tree
        self.edges: dict[str, dict[str, str]] = {}   # node -> {target: kind}
        self.uncertain: dict[str, list[dict]] = {}
        self.js_seeds = js_seeds
        self.py_seeds = py_seeds
        self.setup_files: set[str] = set()
        self.notes: list[str] = []
        self.runtime_io: list[str] = []
        self.runtime_dynamic: list[str] = []


def build_graph(repo: Path, sha: str) -> Graph:
    dis = _disabled()
    tree = Tree(repo, sha)
    js_seeds, py_seeds = seeds_for(tree)
    g = Graph(tree, js_seeds, py_seeds)
    wf_env = workflow_env_names(tree)
    # vite config: aliases + setupFiles
    cfg_path = next((p for p in ("app/vitest.config.js", "app/vitest.config.mjs", "app/vitest.config.ts",
                                 "app/vite.config.js", "app/vite.config.mjs", "app/vite.config.ts") if p in tree.files), None)
    aliases: list[tuple[str, str]] = []
    first = True
    pending_js: deque = deque()
    expanded: set[str] = set()
    loader = PyLoader(tree, {})
    loader.wf_env = wf_env
    exec_side: set[str] = set()  # scripts a test-side file RUNS are test-side too

    def test_side(p: str) -> bool:
        return is_test_side(p)
    conftests = sorted(f for f in tree.files if f.endswith("conftest.py") and (f == "conftest.py" or f.startswith("tests/")))
    py_queue: deque = deque(py_seeds + conftests)
    for s in js_seeds:
        pending_js.append(s)

    def add_edge(a, b, kind):
        e = g.edges.setdefault(a, {})
        if b not in e or (e[b] in LEAF_KINDS and kind not in LEAF_KINDS):
            e[b] = kind  # an import beats a text read of the same file

    def add_unc(node, why, line=0):
        if "uncertain" in dis:
            return
        g.uncertain.setdefault(node, []).append({"why": why, "line": line})

    while pending_js or py_queue or first:
        batch = []
        while pending_js:
            f = pending_js.popleft()
            if f in expanded:
                continue
            expanded.add(f)
            if f.endswith(JS_EXT) or f.endswith(CSS_EXT):
                batch.append(f)
        contents = tree.read_many(batch) if batch else {}
        configs = {}
        if first and cfg_path:
            configs[cfg_path] = tree.read(cfg_path)
        if batch or configs:
            if os.environ.get("AGENT_CLOSURE_DEBUG"):
                print(f"[closure] js batch {len(batch)} py-queue {len(py_queue)}", file=sys.stderr, flush=True)
            out = run_js_extractor(repo, {k: v for k, v in contents.items() if v is not None}, configs, tree, wf_env)
            if first and cfg_path:
                c = out["configs"][cfg_path]
                for a in c["aliases"]:
                    aliases.append((a["find"], a["replacement"]))
                for u in c["uncertain"]:
                    g.notes.append("config: " + u)
                for sf in c["setupFiles"]:
                    if sf.startswith(R + "/"):
                        rel = _norm(sf[len(R) + 1:])
                        hit = next((rel + s for s in JS_TRY if rel + s in tree.files), rel)
                        g.setup_files.add(hit)
                        g.js_seeds_setup = True
                        pending_js.append(hit)
                aliases.sort(key=lambda x: -len(x[0]))
            for f, res in out["results"].items():
                g.edges.setdefault(f, {})
                for u in res["uncertain"]:
                    if "glob" in dis and "import.meta.glob" in u["why"]:
                        continue
                    if u.get("viteIgnore") and not VITEST_TEST_RE.search(f):
                        # `import(/* @vite-ignore */ url)` in product code: a runtime URL import vite does not
                        # bundle (e.g. the chunk-retry of an already-built chunk) — recorded, not fatal
                        g.runtime_dynamic.append(f"{f}:{u['line']}: {u['why']} (@vite-ignore)")
                        continue
                    if "mock" in dis and u["why"].startswith("vi."):
                        continue
                    add_unc(f, u["why"], u["line"])
                for r in res["refs"]:
                    k = r["kind"]
                    if k in ("import", "reexport", "dynamic", "require", "mock", "css"):
                        if k == "mock" and "mock" in dis:
                            continue
                        if k == "css" and "css" in dis:
                            continue
                        tgt, follow, why = resolve_js(tree, f, r["spec"], aliases, dis)
                        if why:
                            add_unc(f, why, r["line"])
                        if tgt:
                            add_edge(f, tgt, k)
                            if follow:
                                pending_js.append(tgt)
                    elif k in ("glob", "url", "read", "exec"):
                        if k == "glob" and "glob" in dis:
                            continue
                        files, why = expand_pattern(tree, r["pattern"], glob_syntax=bool(r.get("glob")))
                        if r.get("negate"):
                            continue
                        if why:
                            add_unc(f, why, r["line"])
                        for t in files:
                            is_src = t.endswith(SRC_EXT)
                            if k == "read":
                                if is_src and "js-read-source" in dis:
                                    continue
                                if not is_src and "js-read-data" in dis:
                                    continue
                            add_edge(f, t, k)
                            if k == "glob" or (k == "exec" and t.endswith(JS_EXT)):
                                pending_js.append(t)
                            elif k == "exec" and t.endswith(".py"):
                                py_queue.append(t)
        first = False
        # python
        while py_queue:
            f = py_queue.popleft()
            if f in expanded:
                continue
            expanded.add(f)
            if not f.endswith(".py"):
                continue
            g.edges.setdefault(f, {})
            if os.environ.get("AGENT_CLOSURE_DEBUG"):
                print(f"[closure] py {f}", file=sys.stderr, flush=True)
            refs, unc = analyze_py(f, loader, dis, harvest=not test_side(f))
            for u in unc:
                if not test_side(f) and (
                        u["why"].startswith(("import_module()", "__import__()", "sys.path entry", "runpy.run_module",
                                             "subprocess runs", "exec:"))):
                    # product code's runtime plugin loading (module names from registries / config): recorded, not
                    # fatal; the dotted-name harvest below still makes every literal 'pkg.mod' in the closure a member
                    g.runtime_dynamic.append(f"{f}:{u['line']}: {u['why']}")
                    continue
                if u["why"].startswith("read:") and not test_side(f):
                    # product code's runtime I/O (DB files, /data caches, env-configured dirs): recorded, not fatal.
                    # Anchored repo paths in product code are still edges (read sites + the path harvest).
                    g.runtime_io.append(f"{f}:{u['line']}")
                    continue
                add_unc(f, u["why"], u["line"])
            for r in refs:
                if "target" in r:
                    targets = [r["target"]]
                else:
                    targets, why = expand_pattern(tree, r["pattern"])
                    if r.get("no_tests"):  # a runtime importlib over a package never imports its test modules
                        targets = [t for t in targets if not is_test_side(t)]
                    if why and r.get("soft"):
                        targets, why = [], None
                    if why and not test_side(f):
                        g.runtime_io.append(f"{f}:{r['line']}")
                        why = None
                    if why:
                        add_unc(f, why, r["line"])
                for t in targets:
                    if r["kind"] == "read" and "py-read" in dis:
                        continue
                    add_edge(f, t, r["kind"])
                    if r["kind"] == "exec" and test_side(f):
                        exec_side.add(t)
                    if r["follow"] and t.endswith(".py"):
                        py_queue.append(t)
                    elif r["kind"] in ("exec",) and t.endswith(JS_EXT):
                        pending_js.append(t)
    # generated manifests named in any closure file's text
    if "manifest-mention" not in dis:
        manifests = [f for f in tree.files if MANIFEST_RE.search(f)]
        by_base: dict[str, list[str]] = {}
        for m in manifests:
            by_base.setdefault(posixpath.basename(m), []).append(m)
        nodes = [n for n in g.edges if n.endswith(SRC_EXT)]
        texts = tree.read_many(nodes)
        for n, txt in texts.items():
            if not txt:
                continue
            for base, ms in by_base.items():
                if base in txt:
                    for m in ms:
                        add_edge(n, m, "manifest")
    return g


def _cache_key(sha: str) -> str:
    import hashlib
    h = hashlib.sha256()
    src = (HERE / "agent_closure_shadow.py").read_text(encoding="utf-8")
    h.update(src.split("\ndef _cache_key(", 1)[0].encode("utf-8"))  # only the graph-building half
    h.update((HERE / "agent_closure_graph.mjs").read_bytes())
    h.update(json.dumps([sorted(_disabled())]).encode())
    return f"{sha}-{h.hexdigest()[:16]}.json"


def build_graph_cached(repo: Path, sha: str, cache_dir: "Path | None") -> Graph:
    """build_graph, memoised on disk by (commit, tool source hash, switches) when a cache dir is given."""
    full = _git(repo, "rev-parse", sha).strip()
    if cache_dir is None and _MEM_GRAPHS is not None:
        if full not in _MEM_GRAPHS:
            while len(_MEM_GRAPHS) >= 3:
                _MEM_GRAPHS.pop(next(iter(_MEM_GRAPHS)))
            _MEM_GRAPHS[full] = build_graph(repo, full)
        return _MEM_GRAPHS[full]
    if cache_dir is None:
        return build_graph(repo, full)
    p = Path(cache_dir) / _cache_key(full)
    if p.exists():
        d = json.loads(p.read_text(encoding="utf-8"))
        g = Graph(None, d["js_seeds"], d["py_seeds"])
        g.edges, g.uncertain, g.setup_files = d["edges"], d["uncertain"], set(d["setup_files"])
        g.notes, g.runtime_io, g.runtime_dynamic = d["notes"], d["runtime_io"], d["runtime_dynamic"]
        return g
    g = build_graph(repo, full)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"js_seeds": g.js_seeds, "py_seeds": g.py_seeds, "edges": g.edges,
                               "uncertain": g.uncertain, "setup_files": sorted(g.setup_files), "notes": g.notes,
                               "runtime_io": g.runtime_io, "runtime_dynamic": g.runtime_dynamic}), encoding="utf-8")
    os.replace(tmp, p)
    return g


LEAF_KINDS = {"read", "url", "manifest", "path"}


def _site_file(site: str) -> str:
    return site.split(":", 1)[0]


def seed_closures(g: Graph, soft_out: "dict | None" = None) -> tuple[dict[str, dict[str, str | None]], dict[str, list]]:
    """-> ({seed: {node: parent}}, {seed: [uncertain (node, why)]}). With soft_out, also fills
    {seed: [relaxed site]} — the runtime_io / runtime_dynamic sites in files the seed EXECUTES (strict-fatal)."""
    soft_by_file: dict[str, list[str]] = {}
    for site in list(g.runtime_io) + list(g.runtime_dynamic):
        soft_by_file.setdefault(_site_file(site), []).append(site)
    seeds = list(g.js_seeds) + list(g.py_seeds)
    common = sorted(g.setup_files) + sorted(f for f in g.edges if f.endswith("conftest.py"))
    res: dict[str, dict[str, str | None]] = {}
    unc: dict[str, list] = {}
    for s in seeds:
        par: dict[str, str | None] = {s: None}
        starts = [s] + [c for c in common if (c.endswith(".py")) == s.endswith(".py")]
        for c in starts[1:]:
            par.setdefault(c, s)
        # A file reached only as TEXT (read / new URL / manifest / path harvest) is observed, not executed: it is a
        # member, but its own imports and reads are not followed and its uncertainty does not count.
        expanded: set[str] = set(starts)
        q = deque(starts)
        while q:
            n = q.popleft()
            for t, kind in g.edges.get(n, {}).items():
                if t not in par:
                    par[t] = n
                if kind not in LEAF_KINDS and t not in expanded:
                    expanded.add(t)
                    if t != s:
                        par[t] = n  # the reported path is the executing one
                    q.append(t)
        res[s] = par
        u = [(n, x["why"]) for n in expanded for x in g.uncertain.get(n, [])]
        if u:
            unc[s] = u
        if soft_out is not None:
            sites = [x for n in expanded for x in soft_by_file.get(n, [])]
            if sites:
                soft_out[s] = sites
    return res, unc


def _path_to(par: dict[str, str | None], node: str) -> list[str]:
    out = [node]
    while par.get(out[-1]) is not None and len(out) < 40:
        out.append(par[out[-1]])
    return list(reversed(out))


# ---- evaluate -----------------------------------------------------------------------------------------------
def delta_files(repo: Path, t0: str, t1: str) -> list[str]:
    out = _git(repo, "diff", "--name-status", "-M", "-z", t0, t1)
    toks = [x for x in out.split("\0") if x != ""]
    files: list[str] = []
    i = 0
    while i < len(toks):
        st = toks[i]
        if st.startswith(("R", "C")):
            files += [toks[i + 1], toks[i + 2]]
            i += 3
        else:
            files.append(toks[i + 1])
            i += 2
    return sorted(set(files))


def pr_info(repo: Path, pr: int) -> tuple[list[str] | None, str | None, str | None]:
    """-> (PR files, head sha, error)."""
    try:
        p = subprocess.run(["gh", "pr", "view", str(pr), "--json", "files,headRefOid"], capture_output=True,
                           encoding="utf-8", cwd=str(repo), timeout=60)
        if p.returncode != 0:
            return None, None, "gh pr view failed: " + p.stderr.strip()[:200]
        d = json.loads(p.stdout)
        files = [f["path"] for f in d.get("files") or []]
        head = d.get("headRefOid")
        if head:
            q = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", head + "^{commit}"], capture_output=True)
            if q.returncode != 0:
                subprocess.run(["git", "-C", str(repo), "fetch", "--quiet", "--no-tags", "origin", f"pull/{pr}/head"],
                               capture_output=True, timeout=120)
                q = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", head + "^{commit}"], capture_output=True)
                if q.returncode != 0:
                    return files, None, "PR head commit not available locally"
        return files, head, None
    except Exception as e:  # noqa: BLE001 — fail closed
        return None, None, f"PR lookup error: {e}"


def vitest_related(tree_dir: Path, t0: str, t1: str, paths: list[str]) -> tuple[list[str] | None, str | None]:
    head = _git(tree_dir, "rev-parse", "HEAD").strip()
    if _git(tree_dir, "rev-parse", t1).strip() != head:
        return None, f"tree HEAD {head[:10]} is not T1"
    out = tree_dir / "app" / ".closure-shadow-vitest.json"
    npx = shutil.which("npx") or "npx"
    p = subprocess.run([npx, "vitest", "list", *paths, "--changed", t0, "--filesOnly", f"--json={out}"],
                       cwd=str(tree_dir / "app"), capture_output=True, encoding="utf-8", errors="replace",
                       timeout=1800, shell=os.name == "nt")
    try:
        if not out.exists():
            if "No test files found" in (p.stdout + p.stderr):
                return [], None
            return None, "vitest list failed: " + (p.stderr or p.stdout)[-300:]
        data = json.loads(out.read_text(encoding="utf-8") or "[]")
    finally:
        try:
            out.unlink()
        except OSError:
            pass
    files = set()
    for item in data:
        fp = item.get("file") if isinstance(item, dict) else item
        if fp:
            rel = Path(fp).resolve().relative_to(tree_dir.resolve()).as_posix()
            files.add(rel)
    return sorted(files), None


def memory_mb() -> dict:
    """{'mem_free_mb', 'mem_total_mb'} of the box's PHYSICAL memory, or nulls when it cannot be read (never raises).
    psutil when installed; else GlobalMemoryStatusEx on Windows; else /proc/meminfo."""
    try:
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        return {"mem_free_mb": int(vm.available // 2**20), "mem_total_mb": int(vm.total // 2**20)}
    except Exception:  # noqa: BLE001
        pass
    try:
        if os.name == "nt":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
                return {"mem_free_mb": int(st.ullAvailPhys // 2**20), "mem_total_mb": int(st.ullTotalPhys // 2**20)}
        else:
            kv = {}
            for ln in open("/proc/meminfo", encoding="utf-8"):
                k, v = ln.split(":", 1)
                kv[k] = int(v.split()[0])
            return {"mem_free_mb": kv["MemAvailable"] // 1024, "mem_total_mb": kv["MemTotal"] // 1024}
    except Exception:  # noqa: BLE001
        pass
    return {"mem_free_mb": None, "mem_total_mb": None}


def evaluate(repo: Path, t0: str, t1: str, pr: int | None, pr_files: list[str] | None = None,
             pr_head: str | None = None, tree_dir: Path | None = None, use_gh: bool = True,
             cache_dir: "Path | None" = None) -> dict:
    dis = _disabled()
    repo = Path(repo)
    t0f = _git(repo, "rev-parse", t0).strip()
    t1f = _git(repo, "rev-parse", t1).strip()
    import time as _time
    started = _time.monotonic()
    mem = memory_mb()  # at the START of the evaluation
    rec: dict = {"time": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"), "tool": TOOL_VERSION,
                 "pr": pr, "t0": t0f, "t1": t1f, "pr_head": None, "delta": [], "verdict": None, "reasons": {},
                 "global_reasons": [], "related_graph": [], "related_vitest": None, "vitest_disagreement": None,
                 "stats": {}, "disabled_features": sorted(dis), "full_carry_result": None, "source": "evaluate",
                 **mem}
    delta = delta_files(repo, t0f, t1f)
    rec["delta"] = delta
    rec["delta_range"] = f"{t0f[:10]}..{t1f[:10]}"
    if pr is not None and pr_files is None and use_gh:
        pr_files, pr_head, err = pr_info(repo, pr)
        if err:
            rec["global_reasons"].append("fail-closed: " + err)
    if pr is not None and pr_files is None:
        rec["global_reasons"].append("fail-closed: PR file list unavailable")
    rec["pr_head"] = pr_head
    revs = [("T1", t1f), ("T0", t0f)] + ([("PR", pr_head)] if pr_head else [])
    graphs = []
    try:
        for label, sha in revs:
            graphs.append((label, build_graph_cached(repo, sha, cache_dir)))
    except Exception as e:  # noqa: BLE001 — fail closed
        rec["global_reasons"].append(f"fail-closed: graph build failed: {e}")
    reached: dict[str, list] = {}
    uncertain_seeds: dict[str, list] = {}
    soft_seeds: dict[str, list] = {}
    setup_files: set[str] = set()
    stats = {}
    for label, g in graphs:
        soft: dict = {}
        clos, unc = seed_closures(g, soft)
        for sd, sites in soft.items():
            soft_seeds.setdefault(sd, []).extend(f"{label}:{x}" for x in sites)
        setup_files |= g.setup_files
        members = set()
        for s, par in clos.items():
            members |= set(par)
        stats[label] = {"js_seeds": len(g.js_seeds), "py_seeds": len(g.py_seeds), "closure_files": len(members),
                        "uncertain_seeds": len(unc), "runtime_io_sites": len(g.runtime_io),
                        "runtime_dynamic_sites": len(g.runtime_dynamic)}
        for s, u in unc.items():
            uncertain_seeds.setdefault(s, []).extend(f"{label}:{n}: {w}" for n, w in u[:3])
        for d in delta:
            for s, par in clos.items():
                if d in par:
                    reached.setdefault(d, [])
                    if not any(x["seed"] == s for x in reached[d]):
                        reached[d].append({"seed": s, "rev": label, "path": _path_to(par, d)})
        for n in g.notes:
            rec["global_reasons"].append(f"{label}: {n}")
    rec["stats"] = stats
    full = bool([r for r in rec["global_reasons"] if r.startswith("fail-closed")])
    strict_extra = sorted(set(soft_seeds) - set(uncertain_seeds))  # seeds uncertain ONLY under strict
    if uncertain_seeds:
        full = True
        sample = sorted(uncertain_seeds)[:5]
        rec["global_reasons"].append(f"fail-closed: {len(uncertain_seeds)} seed closure(s) uncertain")
        rec["uncertain_seeds"] = {s: uncertain_seeds[s][:3] for s in sample}
        rec["uncertain_seed_count"] = len(uncertain_seeds)
    pr_set = set(pr_files or [])
    related: set[str] = set()
    for d in delta:
        rs = []
        why = sensitive_reason(d, setup_files) if "sensitive" not in dis else None
        if why:
            rs.append(f"always-sensitive: {why}")
            full = True
        if d in pr_set and "pr-own" not in dis:
            rs.append("in the PR's own diff")
            full = True
        for x in reached.get(d, [])[:5]:
            rs.append(f"reached from {x['seed']} ({x['rev']}): " + " -> ".join(x["path"]))
        if reached.get(d):
            related |= {x["seed"] for x in reached[d]}
            if len(reached[d]) > 5:
                rs.append(f"... and {len(reached[d]) - 5} more seeds")
        if not rs:
            rs.append("not in the closure")
        rec["reasons"][d] = rs
    rec["related_graph"] = sorted(related)
    if tree_dir is not None and not full and delta:
        try:
            paths = agent_vitest_paths(Tree(repo, t1f))
            vt, err = vitest_related(Path(tree_dir), t0f, t1f, paths)
        except Exception as e:  # noqa: BLE001
            vt, err = None, str(e)
        if err:
            rec["related_vitest"] = {"error": err}
        else:
            rec["related_vitest"] = vt
            g_js = {x for x in related if not x.endswith(".py")}
            v = set(vt or [])
            if v != g_js:
                rec["vitest_disagreement"] = {"vitest_only": sorted(v - g_js), "graph_only": sorted(g_js - v)}
            related |= v
    def decide(is_full: bool) -> str:
        if not delta and not [r for r in rec["global_reasons"] if r.startswith("fail-closed: graph")]:
            return "carry"  # nothing moved
        if is_full:
            return "full"
        return "related:" + ",".join(sorted(related)) if related else "carry"

    relaxed = decide(full)
    strict = decide(full or bool(strict_extra))
    if not delta:
        rec["global_reasons"].append("empty delta")
    rec["verdict_relaxed"] = relaxed
    rec["verdict_strict"] = strict
    rec["verdict"] = strict if os.environ.get("AGENT_CLOSURE_STRICT_PRODUCT") == "1" else relaxed
    count = lambda v: len(v.split(":", 1)[1].split(",")) if v.startswith("related:") else 0  # noqa: E731
    rec["related_count_relaxed"] = count(relaxed)
    rec["related_count_strict"] = count(strict)
    # the relaxed items that DECIDED the relaxed verdict: the runtime sites executed by seeds that are uncertain
    # only under strict — present exactly when the two verdicts differ
    deciding: list[str] = []
    if strict != relaxed:
        seen: set[str] = set()
        for sd in strict_extra:
            for x in soft_seeds[sd]:
                site = x.split(":", 1)[1]
                if site not in seen:
                    seen.add(site)
                    deciding.append(site)
    rec["relaxed_deciding_items"] = {"count": len(deciding), "seeds": len(strict_extra) if deciding else 0,
                                     "sites": sorted(deciding)[:50]}
    rec["runtime_s"] = round(_time.monotonic() - started, 1)
    return rec


def append_log(rec: dict, log: Path) -> None:
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, sort_keys=True) + "\n")


def read_log(log: Path) -> list[dict]:
    if not log.exists():
        return []
    out = []
    for ln in log.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln:
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
    return out


def record(log: Path, t1: str, vitest_fails: int, pytest_fails: int, notes: str, failed_files: list[str],
           pr: int | None = None) -> int:
    rows = read_log(log)
    n = 0
    for r in rows:
        if r.get("t1", "").startswith(t1) and (pr is None or r.get("pr") == pr) and r.get("full_carry_result") is None:
            r["full_carry_result"] = {"vitest_new_fails": vitest_fails, "pytest_new_fails": pytest_fails,
                                      "failed_files": failed_files, "notes": notes,
                                      "recorded": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
            n += 1
    if n:
        tmp = log.with_suffix(log.suffix + ".tmp")
        tmp.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
        os.replace(tmp, log)
    return n


def disagreements(rows: list[dict]) -> list[dict]:
    """Rows whose carry/related verdict a full carry contradicted — checked for the strict AND the relaxed verdict."""
    out = []
    for r in rows:
        fc = r.get("full_carry_result")
        if not fc:
            continue
        fails = int(fc.get("vitest_new_fails") or 0) + int(fc.get("pytest_new_fails") or 0)
        if not fails:
            continue
        kinds = [("strict", r.get("verdict_strict")), ("relaxed", r.get("verdict_relaxed"))]
        if not any(v for _, v in kinds):
            kinds = [("verdict", r.get("verdict"))]  # a line from before the dual verdict
        for kind, v in kinds:
            v = v or ""
            if not v or v == "full":
                continue
            related = set(v.split(":", 1)[1].split(",")) if v.startswith("related:") else set()
            ff = fc.get("failed_files") or []
            outside = [f for f in ff if f not in related]
            if not ff or outside:
                out.append({"which": kind, "pr": r.get("pr"), "t0": r.get("t0"), "t1": r.get("t1"),
                            "verdict": v[:200], "new_fails": fails,
                            "failed_outside_related": outside or "(failed files not recorded)",
                            "relaxed_deciding_items": (r.get("relaxed_deciding_items") or {}).get("count"),
                            "notes": fc.get("notes")})
    return out


# ---- watch: the unattended shadow loop -------------------------------------------------------------------------
_MEM_GRAPHS: "dict | None" = None  # watch keeps the last few graphs in memory (no disk writes)


def last_watched_tip(log: Path) -> "str | None":
    for r in reversed(read_log(log)):
        if r.get("source") == "watch" and not r.get("error") and r.get("t1"):
            return r["t1"]
    return None


def watch_once(repo: Path, log: Path, remote: str = "origin", branch: str = "master",
               cache_dir: "Path | None" = None, fetch: bool = True) -> "dict | None":
    """Evaluate the NEW master tip against the last evaluated one (T0 = last watched T1; first run: the tip's first
    parent). Git is read-only apart from `git fetch <remote> <branch>`. Appends one line to `log`; nothing else."""
    mem = memory_mb()  # at the START of the tick
    if fetch:
        subprocess.run(["git", "-C", str(repo), "fetch", "--quiet", "--no-tags", remote, branch],
                       capture_output=True, timeout=300)
    tip = _git(repo, "rev-parse", f"refs/remotes/{remote}/{branch}").strip()
    last = last_watched_tip(log)
    if last == tip:
        return None
    t0 = last or _git(repo, "rev-parse", tip + "^1").strip()
    try:
        rec = evaluate(repo, t0, tip, pr=None, pr_files=[], use_gh=False, cache_dir=cache_dir)
    except Exception as e:  # noqa: BLE001 — logged, the loop goes on; T0 does not advance
        rec = {"time": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"), "tool": TOOL_VERSION,
               "t0": t0, "t1": tip, "error": f"{type(e).__name__}: {e}"[:500]}
    rec["source"] = "watch"
    rec.update(mem)
    append_log(rec, log)
    return rec


def watch(repo: Path, log: Path, interval: int, once: bool = False, cache_dir: "Path | None" = None,
          remote: str = "origin", branch: str = "master") -> int:
    global _MEM_GRAPHS
    import time as _time
    if cache_dir is None:
        _MEM_GRAPHS = {}
    while True:
        try:
            rec = watch_once(repo, log, remote, branch, cache_dir)
            if rec is not None:
                print(json.dumps({k: rec.get(k) for k in ("time", "delta_range", "verdict_strict", "verdict_relaxed",
                                                          "related_count_strict", "related_count_relaxed",
                                                          "runtime_s", "error")})[:600], flush=True)
        except Exception as e:  # noqa: BLE001 — e.g. a fetch that timed out; try again next tick
            print(f"watch: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        if once:
            return 0
        _time.sleep(max(30, interval))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default=str(HERE.parent))
    ap.add_argument("--log", default=str(DEFAULT_LOG))
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("evaluate")
    e.add_argument("--pr", type=int, required=True, help="PR number (0 = no PR: history validation)")
    e.add_argument("--t0", required=True)
    e.add_argument("--t1", required=True)
    e.add_argument("--tree", help="a checkout whose HEAD is T1 with node_modules, for vitest's related graph")
    e.add_argument("--no-log", action="store_true")
    e.add_argument("--cache", help="directory to memoise per-commit graphs in (optional)")
    r = sub.add_parser("record")
    r.add_argument("--t1", required=True)
    r.add_argument("--pr", type=int)
    r.add_argument("--vitest-fails", type=int, required=True)
    r.add_argument("--pytest-fails", type=int, required=True)
    r.add_argument("--failed-files", nargs="*", default=[])
    r.add_argument("--notes", default="")
    sub.add_parser("report")
    w = sub.add_parser("watch", help="evaluate each NEW master tip against the last evaluated one, forever")
    w.add_argument("--interval", type=int, default=300, help="seconds between fetches (min 30)")
    w.add_argument("--once", action="store_true", help="one tick and exit (for an external loop / scheduler)")
    w.add_argument("--cache", help="optional on-disk graph cache; default keeps graphs in memory only")
    w.add_argument("--remote", default="origin")
    w.add_argument("--branch", default="master")
    a = ap.parse_args(argv)
    log = Path(a.log)
    if a.cmd == "evaluate":
        pr = a.pr or None
        rec = evaluate(Path(a.repo), a.t0, a.t1, pr, pr_files=[] if pr is None else None,
                       tree_dir=Path(a.tree) if a.tree else None, cache_dir=Path(a.cache) if a.cache else None)
        if not a.no_log:
            append_log(rec, log)
        print(json.dumps({"verdict_strict": rec["verdict_strict"][:300], "verdict_relaxed": rec["verdict_relaxed"][:300],
                          "delta_range": rec["delta_range"], "runtime_s": rec["runtime_s"],
                          "global": rec["global_reasons"], "stats": rec["stats"]}, indent=1))
        return 0
    if a.cmd == "watch":
        return watch(Path(a.repo), log, a.interval, a.once, Path(a.cache) if a.cache else None, a.remote, a.branch)
    if a.cmd == "record":
        n = record(log, a.t1, a.vitest_fails, a.pytest_fails, a.notes, a.failed_files, a.pr)
        print(f"recorded {n} evaluation(s)")
        return 0 if n else 1
    rows = read_log(log)
    dd = disagreements(rows)
    recorded = sum(1 for x in rows if x.get("full_carry_result"))
    print(f"{len(rows)} evaluations, {recorded} with a full-carry result, {len(dd)} disagreement(s)")
    for d in dd:
        print(json.dumps(d))
    return 0


if __name__ == "__main__":
    sys.exit(main())
