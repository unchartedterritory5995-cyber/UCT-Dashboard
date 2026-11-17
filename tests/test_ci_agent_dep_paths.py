"""agent-ci paths cover every NON-Agent Python module the Agent server suite imports (AUDIT 2026-11-17).

Incident 2026-11-17: PR #1509 changed api/services/indicator_from_image.py. tests/test_uct_agent_limits_two_processes.py
runs tests/spend_limits_process_worker.py, which imports that module, but the file was outside agent-ci.yml's `paths`, so
the PR never ran Agent CI and the Agent suite first failed in the post-merge master deploy gate.

This rail DERIVES the dependency set by a static scan and asserts agent-ci's push AND pull_request paths match each file:

* sources: every tests/test_uct_agent*.py, tests/conftest.py (pytest loads it for every Agent test) and, transitively,
  each tests/ helper they reach — by import (`tests.x`, a bare `x` with tests/x.py) or by a path to it
  (`ROOT / "tests" / "x.py"`, e.g. a subprocess worker);
* from each source (module level AND function-local): `import a.b`, `from a.b import c` (c tried as a submodule),
  `__import__("a.b")` / `importlib.import_module("a.b")` and `mock.patch("a.b.attr")` / `monkeypatch.setattr("a.b.attr", …)`
  string targets, and `ROOT / "api" / "x.py"`-style path chains;
* each first-party module resolves to its file (longest existing prefix: a.b.py or a/b/__init__.py) plus the
  package __init__.py files Python executes on the way.

Limits (deliberate, keep it small): depth 1 into first-party code — a module the Agent tests import is covered, the
modules IT imports are not (api/main.py is covered; a router it mounts is not unless a test imports that router). Dynamic
names (f-strings, variables) are not resolved. Agent server code itself (api/services/uct_agent/**) is already covered.
"""
from __future__ import annotations

import ast
import pathlib

from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC = acr.load_agent_ci(ROOT)
PUSH_PATHS = acr.agent_paths(DOC)
PR_PATHS = list(((acr._on(DOC).get("pull_request") or {}).get("paths")) or [])

SEEDS = ("tests/test_uct_agent*.py",)
ALWAYS = ("tests/conftest.py",)
#: first-party top-level packages whose modules can be imported by a test
FIRST_PARTY = ("api", "tools", "tests", "scripts")
_IMPORT_FUNCS = {"__import__", "import_module"}
_TARGET_FUNCS = {"patch", "setattr", "delattr"}

#: A floor, so the scan can never pass by finding nothing. Each is imported by a named Agent test today.
KNOWN_DEPS = {
    "tests/spend_limits_process_worker.py",           # test_uct_agent_limits_two_processes.py (subprocess path)
    "api/services/indicator_from_image.py",           # <- tests/spend_limits_process_worker.py (function-local import)
    "api/middleware/auth_middleware.py",              # dependency override in most Agent router tests
    "api/services/screener/filters.py",
    "api/main.py",
}


def _module_file(parts: list[str]) -> list[str]:
    """Dotted parts -> [module file, *package __init__ files] for the longest existing prefix; [] if not first-party."""
    if not parts or parts[0] not in FIRST_PARTY:
        return []
    for n in range(len(parts), 0, -1):
        base = ROOT.joinpath(*parts[:n])
        target = base.with_suffix(".py") if base.with_suffix(".py").is_file() else base / "__init__.py"
        if target.is_file():
            files = [target.relative_to(ROOT).as_posix()]
            for k in range(1, n):
                init = ROOT.joinpath(*parts[:k], "__init__.py")
                if init.is_file():
                    files.append(init.relative_to(ROOT).as_posix())
            return files
    return []


def _resolve(name: str, src: pathlib.Path) -> list[str]:
    parts = name.split(".")
    if parts[0] not in FIRST_PARTY and (ROOT / "tests" / f"{parts[0]}.py").is_file():
        parts = ["tests", *parts]                    # a bare import of a tests/ helper (tests/ is on sys.path)
    return _module_file(parts)


def _chain(n) -> list[str] | None:
    if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div):
        return (_chain(n.left) or ["*"]) + (_chain(n.right) or ["*"])
    if isinstance(n, ast.Constant) and isinstance(n.value, str):
        return [n.value]
    return None


def _file_deps(src: pathlib.Path) -> set[str]:
    tree = ast.parse(src.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out.update(_resolve(a.name, src))
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            for a in node.names:                     # `from pkg import sub` imports pkg/sub.py when it is a module
                out.update(_resolve(f"{node.module}.{a.name}", src) or _resolve(node.module, src))
        elif isinstance(node, ast.Call) and node.args:
            f = node.func
            fname = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
            arg = node.args[0]
            if fname in (_IMPORT_FUNCS | _TARGET_FUNCS) and isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                if fname in _IMPORT_FUNCS or "." in arg.value:
                    out.update(_resolve(arg.value, src))
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            parts = [p for p in (_chain(node) or []) if p != "*"]
            for i, p in enumerate(parts):
                if p in FIRST_PARTY and parts[-1].endswith(".py"):
                    rel = "/".join(parts[i:])
                    if (ROOT / rel).is_file():
                        out.add(rel)
                    break
    return out


def scan() -> dict[str, set[str]]:
    """{first-party file the Agent server suite imports: {the scanned sources that import it}}."""
    seeds = [p.relative_to(ROOT).as_posix() for pat in SEEDS for p in sorted(ROOT.glob(pat))]
    queue, seen = [*seeds, *ALWAYS], set()
    deps: dict[str, set[str]] = {}
    while queue:
        rel = queue.pop()
        if rel in seen:
            continue
        seen.add(rel)
        for dep in _file_deps(ROOT / rel):
            deps.setdefault(dep, set()).add(rel)
            # follow tests/ helpers transitively (they are part of the suite); stop at first-party code (depth 1)
            if dep.startswith("tests/") and dep not in seen:
                queue.append(dep)
    return deps


DEPS = scan()


def uncovered(patterns: list[str]) -> dict[str, list[str]]:
    return {d: sorted(r) for d, r in sorted(DEPS.items()) if not acr.matches(d, patterns)}


def test_scan_finds_the_known_deps():
    missing = KNOWN_DEPS - set(DEPS)
    assert not missing, f"the Agent import scan lost known dependencies (fix the scanner, not this list): {sorted(missing)}"


def test_the_incident_module_is_found_through_the_subprocess_worker():
    assert "tests/spend_limits_process_worker.py" in DEPS["api/services/indicator_from_image.py"]


def test_push_and_pull_request_paths_are_the_lists_this_rail_reads():
    assert PR_PATHS, "agent-ci.yml pull_request trigger has no paths list"


def test_every_module_the_agent_server_suite_imports_is_an_agent_ci_path():
    for label, patterns in (("push", PUSH_PATHS), ("pull_request", PR_PATHS)):
        bad = uncovered(patterns)
        assert not bad, (f"first-party files the Agent server suite imports but outside agent-ci.yml's {label} paths "
                         "(a PR changing one never runs Agent CI before merge). Add each to BOTH lists:\n"
                         + "\n".join(f"  - '{d}'  <- {', '.join(r)}" for d, r in bad.items()))


if __name__ == "__main__":                            # print the missing entries, ready to paste
    for d in uncovered(PUSH_PATHS):
        print(f"      - '{d}'")
