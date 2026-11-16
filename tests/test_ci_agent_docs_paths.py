"""agent-ci paths cover every docs/ file the Agent suites READ (AUDIT 2026-11-16).

tests/test_uct_agent_capreg_baseline.py reads docs/agent/COMPATIBILITY-DECISIONS.md: adding or deleting a `### BASELINE:`
decision there changes that test's verdict. When such a file is outside agent-ci.yml's `paths`, a docs-only push never
runs Agent CI and agent-ci-required waits on a run that never comes. This rail DISCOVERS the docs/ reads (Python by AST,
the browser tests by their path.join / resolve / literal calls) and asserts each read file is matched by agent-ci's
push paths (the same list agent-ci-required reads at run time; tests/test_ci_cost_rails.py holds push == pull_request).
"""
from __future__ import annotations

import ast
import pathlib
import re
import subprocess

from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATHS = acr.agent_paths(acr.load_agent_ci(ROOT))

#: Python sources whose file reads decide an Agent CI verdict: the server suite, the agent tools it drives, and the
#: Agent server code those tests run (e.g. coach/concepts.py, knowledge/policy.py read docs/ at import or call time).
PY_SOURCES = ("tests/test_uct_agent*.py", "tools/agent_*.py", "api/services/uct_agent/**/*.py")
#: Browser test sources (agent-ci's AGENT_VITEST_PATHS roots that read files).
JS_SOURCES = ("app/src/agent/**/*.js", "app/src/agent/**/*.jsx", "app/src/agent/**/*.mjs")

#: A floor, so discovery can never pass by finding nothing. Each is read by a named suite today.
KNOWN_READS = {
    "docs/agent/COMPATIBILITY-DECISIONS.md",            # test_uct_agent_capreg_baseline.py + capreg inventory.test.js
    "docs/agent/program/contracts/MD-1-phrasings.md",   # test_uct_agent_qa_quote_outcome.py + the md2 browser tests
    "docs/agent/program/OWNERSHIP.md",                  # tools/agent_ownership_check.py
    "docs/agent/coach/VOCABULARY-MAP.md",               # agentCoachVocab.test.js
    "docs/agent/knowledge/policy.json",                 # api/services/uct_agent/knowledge/policy.py
}


def _tracked_under(rel: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "--", rel], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [f for f in out.splitlines() if f]


def _expand(parts: list[str]) -> set[str]:
    """A discovered docs/ path (constant parts, '*' for a computed part) -> the tracked files it can read."""
    const = []
    for p in parts:
        if p == "*":
            break
        const.extend(s for s in p.replace("\\", "/").split("/") if s and s != ".")
    if not const or const[0] != "docs":
        return set()
    rel = "/".join(const)
    return set(_tracked_under(rel))              # a file -> itself; a directory -> every tracked file under it


def _py_chain(n) -> list[str] | None:
    if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div):
        return (_py_chain(n.left) or ["*"]) + (_py_chain(n.right) or ["*"])
    if isinstance(n, ast.Constant) and isinstance(n.value, str):
        return [n.value]
    return None


def _py_reads(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = {id(node.body[0].value) for node in ast.walk(tree)
                  if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                  and node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant)}
    found, in_chain = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div) and id(node) not in in_chain:
            in_chain.update(id(s) for s in ast.walk(node))
            parts = _py_chain(node) or []
            starts = [i for i, p in enumerate(parts) if p.strip("/") == "docs" or p.startswith("docs/")]
            if starts:
                found |= _expand(parts[starts[0]:])
    for node in ast.walk(tree):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings
                and id(node) not in in_chain and node.value.startswith("docs/")):
            found |= _expand([node.value])
    return found


_JS_CALL = re.compile(r"(?:path\.)?(?:join|resolve)\(([^()]*)\)")
_JS_STR = re.compile(r"""['"`]([^'"`]*)['"`]|([A-Za-z_$][\w$.]*)""")
_JS_LITERAL = re.compile(r"""['"`]((?:\.\./)*docs/[^'"`\s]+)['"`]""")


def _js_reads(path: pathlib.Path) -> set[str]:
    found = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s.startswith(("//", "*", "/*")):
            continue
        for m in _JS_CALL.finditer(line):
            parts = [q if q is not None else "*" for q, _ in _JS_STR.findall(m.group(1))]
            idx = [i for i, p in enumerate(parts) if p.strip("/").split("/")[-1] == "docs" or "docs/" in p]
            if idx:
                first = parts[idx[0]]
                parts[idx[0]] = first[first.index("docs"):]
                found |= _expand(parts[idx[0]:])
        for m in _JS_LITERAL.finditer(line):
            found |= _expand([m.group(1)[m.group(1).index("docs"):]])
    return found


def discovered_reads() -> dict[str, set[str]]:
    """{docs file: {the source files that read it}}."""
    out: dict[str, set[str]] = {}
    for pattern in PY_SOURCES:
        for f in sorted(ROOT.glob(pattern)):
            for d in _py_reads(f):
                out.setdefault(d, set()).add(f.relative_to(ROOT).as_posix())
    for pattern in JS_SOURCES:
        for f in sorted(ROOT.glob(pattern)):
            for d in _js_reads(f):
                out.setdefault(d, set()).add(f.relative_to(ROOT).as_posix())
    return out


READS = discovered_reads()


def test_discovery_finds_the_known_reads():
    missing = KNOWN_READS - set(READS)
    assert not missing, f"the docs/ read discovery lost known reads (fix the scanner, not this list): {sorted(missing)}"


def test_the_capreg_baseline_decisions_file_is_discovered_from_that_test_and_is_an_agent_ci_path():
    readers = READS.get("docs/agent/COMPATIBILITY-DECISIONS.md", set())
    assert "tests/test_uct_agent_capreg_baseline.py" in readers, readers
    assert acr.matches("docs/agent/COMPATIBILITY-DECISIONS.md", PATHS), \
        "docs/agent/COMPATIBILITY-DECISIONS.md decides the capreg baseline verdict but agent-ci.yml's paths do not run on it"


def test_every_docs_file_an_agent_suite_reads_is_an_agent_ci_path():
    bad = {d: sorted(r) for d, r in sorted(READS.items()) if not acr.matches(d, PATHS)}
    assert not bad, ("docs/ files read by the Agent suites but outside agent-ci.yml's push/pull_request paths (a docs-only "
                     "change to one never runs Agent CI). Add each to BOTH lists:\n"
                     + "\n".join(f"  {d}  <- {', '.join(r)}" for d, r in bad.items()))
