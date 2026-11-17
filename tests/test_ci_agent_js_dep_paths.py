"""agent-ci paths cover every NON-Agent frontend file the Agent BROWSER tests load (AUDIT 2026-11-17).

The browser half of tests/test_ci_agent_dep_paths.py (#1521, the server suite). agent-ci's `paths:` filter decides
whether a PR runs the Agent suites before merge; the browser suites (AGENT_VITEST_PATHS) import the charts workspace,
the bar store, the Pine engine, ... so a PR changing one of those changed an Agent test's verdict without running it,
and the first run was the post-merge master deploy gate.

This rail DERIVES the dependency set — tools/agent_vitest_deps.mjs walks the import graph with acorn (the resolution of
tools/import_edges.mjs, plus vi.mock seams, json/css imports, vite test.setupFiles and test.alias) from every vitest file
the AGENT_VITEST_PATHS filters select, TRANSITIVELY — and asserts agent-ci's push AND pull_request paths match each file.
The derived list is exact files, not directory globs: measured 2026-11-17, every directory glob that covers the closure
also triggers 30-59 more non-Agent PR runs per 14 days than the file list does (the closure is ~44% of app/src's
non-test code, scattered across directories), so the file list is the tightest honest filter.

Also asserted: the walk agrees with tools/import_edges.mjs (no module that walker reaches from the same seeds is missing
here), no reached file fails to parse (fail closed), a known-dependency floor (cannot pass by finding nothing), and no
STALE exact app/ entry (a file no Agent browser test loads any more only costs runs).

Limits: files a test READS at run time (fs.readFileSync / fetch of a path) are not imports — docs/ reads are held by
tests/test_ci_agent_docs_paths.py; bare npm packages (package.json / lockfile changes) are not covered here; computed
specifiers (`import(variable)`) are not resolved. Needs Node + app/node_modules (acorn): it FAILS, never skips, without.

`python tests/test_ci_agent_js_dep_paths.py` prints the missing entries, ready to paste into BOTH lists.
"""
from __future__ import annotations

import functools
import json
import pathlib
import re
import shutil
import subprocess
import tempfile

from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC = acr.load_agent_ci(ROOT)
PUSH_PATHS = acr.agent_paths(DOC)
PR_PATHS = list(((acr._on(DOC).get("pull_request") or {}).get("paths")) or [])
TOOL = ROOT / "tools" / "agent_vitest_deps.mjs"

#: A floor, so the walk can never pass by finding nothing. Each is loaded by a named Agent browser test today.
KNOWN_DEPS = {
    "app/src/test-setup.js",                                   # vite.config.js test.setupFiles (every test file)
    "app/src/pages/charts/ChartsWorkspace.jsx",                # ChartsWorkspace.thisChart.test.jsx
    "app/src/data/barStore/index.js",                          # <- the charts workspace
    "app/src/components/chart/engine/ast/pine.js",             # <- the indicator engine the Agent drives
    "app/src/hooks/useUserDefinitions.js",
    "app/src/agent/qa/capabilityRegression/baseline/corpus.json",   # a json import (capreg corpus)
}
MIN_SEEDS = 400


def _node() -> str:
    node = shutil.which("node")
    assert node, "node is not on PATH: this rail needs Node and app/node_modules (acorn) — it does not skip"
    return node


@functools.lru_cache(maxsize=1)
def walk() -> dict:
    out = subprocess.run([_node(), str(TOOL)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert out.returncode == 0, f"tools/agent_vitest_deps.mjs failed (is app/node_modules installed?):\n{out.stderr[-2000:]}"
    return json.loads(out.stdout)


def _edges_closure() -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        edges = pathlib.Path(tmp) / "edges.json"
        made = subprocess.run([_node(), str(ROOT / "tools" / "import_edges.mjs")], cwd=ROOT, capture_output=True,
                              text=True, encoding="utf-8")
        assert made.returncode == 0, made.stderr[-2000:]
        edges.write_text(made.stdout, encoding="utf-8")
        out = subprocess.run([_node(), str(TOOL), "--closure-from-edges", str(edges)], cwd=ROOT, capture_output=True,
                             text=True, encoding="utf-8")
        assert out.returncode == 0, out.stderr[-2000:]
        return json.loads(out.stdout)


@functools.lru_cache(maxsize=None)
def _re(pattern: str):
    return acr._glob_re(pattern)


def _matches(path: str, patterns: tuple[str, ...]) -> bool:
    """acr.matches (GitHub order semantics: the last matching pattern decides, `!` excludes), compiled once."""
    hit = False
    for p in patterns:
        neg = p.startswith("!")
        if _re(p[1:] if neg else p).match(path):
            hit = not neg
    return hit


def uncovered(patterns: list[str], deps: dict | None = None) -> dict[str, list[str]]:
    deps = walk()["deps"] if deps is None else deps
    pats = tuple(patterns)
    return {d: r for d, r in sorted(deps.items()) if not _matches(d, pats)}


def test_the_walk_finds_the_seeds_and_the_known_deps():
    w = walk()
    assert len(w["seeds"]) >= MIN_SEEDS, f"only {len(w['seeds'])} Agent browser test files found: the seed walk is broken"
    assert w["setup"] == ["app/src/test-setup.js"], w["setup"]
    missing = KNOWN_DEPS - set(w["deps"])
    assert not missing, f"the Agent browser import walk lost known dependencies (fix the walker, not this list): {sorted(missing)}"


def test_no_reached_file_fails_to_parse():
    assert not walk()["unparsed"], f"files the Agent browser tests load but acorn cannot parse (their imports are unknown): {walk()['unparsed']}"


def test_the_walk_agrees_with_import_edges():
    w = walk()
    mine = set(w["deps"]) | set(w["seeds"])
    lost = [f for f in _edges_closure() if f not in mine]
    assert not lost, f"tools/import_edges.mjs reaches these from the same seeds but agent_vitest_deps.mjs does not: {lost[:20]}"


def test_every_file_the_agent_browser_tests_load_is_an_agent_ci_path():
    assert PR_PATHS, "agent-ci.yml pull_request trigger has no paths list"
    for label, patterns in (("push", PUSH_PATHS), ("pull_request", PR_PATHS)):
        bad = uncovered(patterns)
        assert not bad, (f"{len(bad)} files the Agent browser tests load but outside agent-ci.yml's {label} paths "
                         "(a PR changing one never runs Agent CI before merge). Add each to BOTH lists "
                         "(`python tests/test_ci_agent_js_dep_paths.py` prints them):\n"
                         + "\n".join(f"  - '{d}'  <- {', '.join(r[:2])}" for d, r in list(bad.items())[:60]))


def test_no_stale_exact_frontend_entry():
    w = walk()
    loaded = set(w["deps"]) | set(w["seeds"])
    stale = [p for p in PUSH_PATHS if p.startswith("app/") and not re.search(r"[*?!\[]", p) and p not in loaded]
    assert not stale, f"exact app/ entries in agent-ci.yml paths that no Agent browser test loads any more (remove from BOTH lists): {stale}"


if __name__ == "__main__":                                  # print the missing entries, ready to paste
    for d in uncovered(PUSH_PATHS):
        print(f"      - '{d}'")
