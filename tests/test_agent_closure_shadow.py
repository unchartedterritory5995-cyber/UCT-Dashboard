"""tools/agent_closure_shadow.py — the closure shadow evaluator (SHADOW ONLY, gates nothing; AUDIT-owned).

ONE mutation-proof test per hole class. Each builds a throwaway git repo shaped like this one (agent-ci.yml with
AGENT_VITEST_PATHS, app/vite.config.js, tests/test_uct_agent*.py), commits T0, edits ONE closure member reached only
through that hole class, commits T1, and requires the verdict to NOT be `carry`.

The mutation check runs the same scenario with the matching resolver feature switched off
(AGENT_CLOSURE_DISABLE=<feature>) and requires the verdict to BECOME `carry` — i.e. the hole test would go red.
So every feature is load-bearing for exactly the test that names it.

The real-history checks run against the real repo at the pinned shas from 2026-11-16/17 (skipped if absent).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import agent_closure_shadow as cs  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or cs._app_node_modules(ROOT) is None,
    reason="node + app/node_modules/@babel/parser are required by the JS extractor",
)

WORKFLOW = """name: agent ci
env:
  AGENT_VITEST_PATHS: src/agent src/pages/Page.agent.test.jsx
  AGENT_SHARDS: '8'
"""

VITE = """import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.js' },
})
"""

BASE = {
    ".github/workflows/agent-ci.yml": WORKFLOW,
    "app/package.json": '{"name":"fixture"}\n',
    "app/vite.config.js": VITE,
    "app/src/test-setup.js": "export const setup = 1\n",
    "app/src/lib/used.js": "export const used = 1\n",
    "app/src/lib/unrelated.js": "export const unrelated = 1\n",
    "app/src/agent/base.test.js": "import { used } from '../lib/used.js'\ntest('b', () => expect(used).toBe(1))\n",
    "app/src/pages/Page.agent.test.jsx": "import { used } from '../lib/used.js'\ntest('p', () => {})\n",
    "api/__init__.py": "",
    "api/main.py": "app = None\n",
    "api/other.py": "X = 1\n",
    "api/services/__init__.py": "",
    "api/services/uct_agent/__init__.py": "",
    "api/services/uct_agent/core.py": "def f():\n    return 1\n",
    "tests/__init__.py": "",
    "tests/test_uct_agent_base.py": "from api.services.uct_agent import core\n\ndef test_core():\n    assert core.f() == 1\n",
    "tools/__init__.py": "",
    "tools/agent_ci_required.py": "print(1)\n",
    "docs/other.md": "other\n",
}


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def _write(repo: Path, files: dict[str, str]) -> None:
    for rel, body in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8", newline="\n")


def make_repo(tmp_path: Path, scenario: dict[str, str]) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@example.invalid")
    _git(repo, "config", "user.name", "t")
    _git(repo, "config", "core.autocrlf", "false")
    _write(repo, {**BASE, **scenario})
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "T0")
    return repo, _git(repo, "rev-parse", "HEAD")


def move_master(repo: Path, edits: dict[str, str]) -> str:
    _write(repo, edits)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "T1")
    return _git(repo, "rev-parse", "HEAD")


def verdict(repo, t0, t1, pr_files=(), disable: str | None = None) -> dict:
    old = os.environ.get("AGENT_CLOSURE_DISABLE")
    try:
        # an AGENT_CLOSURE_DISABLE set OUTSIDE the suite is honoured, so the literal mutation run
        # (`AGENT_CLOSURE_DISABLE=<feature> pytest -k test_hole_class_is_not_carry`) turns the matching test red
        if disable:
            os.environ["AGENT_CLOSURE_DISABLE"] = disable
        return cs.evaluate(repo, t0, t1, pr=1, pr_files=list(pr_files), use_gh=False)
    finally:
        if old is None:
            os.environ.pop("AGENT_CLOSURE_DISABLE", None)
        else:
            os.environ["AGENT_CLOSURE_DISABLE"] = old


# ---- hole classes: (feature switched off by the mutation check, scenario files at T0, Δ edit, PR files) ----------
HOLES = {
    "text-read source": ("js-read-source", {
        "app/src/pages/Work.jsx": "export default function Work() { return null }\n",
        "app/src/agent/srcRead.test.js": (
            "import { readFileSync } from 'node:fs'\nimport path from 'node:path'\n"
            "const SRC = readFileSync(path.resolve(globalThis.process.cwd(), 'src/pages/Work.jsx'), 'utf8')\n"
            "test('reads source', () => expect(SRC).toContain('Work'))\n"),
    }, {"app/src/pages/Work.jsx": "export default function Work() { return 1 }\n"}, ()),
    "JSON/golden read": ("js-read-data", {
        "app/src/agent/fixtures/cases.json": '{"a":1}\n',
        "app/src/agent/dataRead.test.js": (
            "import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\n"
            "const HERE = path.dirname(fileURLToPath(import.meta.url))\n"
            "const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'cases.json'), 'utf8'))\n"
            "test('cases', () => expect(CASES.a).toBe(1))\n"),
    }, {"app/src/agent/fixtures/cases.json": '{"a":2}\n'}, ()),
    "vi.mock target": ("mock", {
        "app/src/lib/mocked.js": "export const m = 1\n",
        "app/src/agent/mocked.test.js": (
            "import { vi } from 'vitest'\nvi.mock('../lib/mocked.js', async (orig) => ({ ...(await orig()) }))\n"
            "test('m', () => {})\n"),
    }, {"app/src/lib/mocked.js": "export const m = 2\n"}, ()),
    "import.meta.glob": ("glob", {
        "app/src/catalog/a.js": "export default 'a'\n",
        "app/src/agent/glob.test.js": (
            "const mods = import.meta.glob('../catalog/*.js', { eager: true })\n"
            "test('g', () => expect(Object.keys(mods).length).toBe(1))\n"),
    }, {"app/src/catalog/a.js": "export default 'A'\n"}, ()),
    "computed specifier -> full": ("uncertain", {
        "app/src/agent/computed.test.js": (
            "test('c', async () => { const name = globalThis.MOD; await import(name) })\n"),
    }, {"app/src/lib/unrelated.js": "export const unrelated = 2\n"}, ()),
    "Python importlib": ("py-importlib", {
        "api/services/dyn.py": "V = 1\n",
        "tests/test_uct_agent_imp.py": (
            "import importlib\n\ndef test_dyn():\n"
            "    assert importlib.import_module('api.services.' + 'dyn').V == 1\n"),
    }, {"api/services/dyn.py": "V = 2\n"}, ()),
    "subprocess to tools/": ("py-exec", {
        "tools/gen_thing.py": "print('ok')\n",
        "tests/test_uct_agent_exec.py": (
            "import subprocess, sys\n\ndef test_tool():\n"
            "    subprocess.run([sys.executable, 'tools/gen_thing.py'], check=True)\n"),
    }, {"tools/gen_thing.py": "print('changed')\n"}, ()),
    "open() of a repo path": ("py-read", {
        "docs/agent/policy.md": "rule\n",
        "tests/test_uct_agent_open.py": (
            "from pathlib import Path\nROOT = Path(__file__).resolve().parents[1]\n\n"
            "def test_policy():\n    with open(ROOT / 'docs' / 'agent' / 'policy.md', encoding='utf-8') as fh:\n"
            "        assert 'rule' in fh.read()\n"),
    }, {"docs/agent/policy.md": "rule 2\n"}, ()),
    "CSS module": ("css", {
        "app/src/agent/base.css": ".base { color: red }\n",
        "app/src/agent/Button.module.css": ".btn { composes: base from './base.css'; }\n",
        "app/src/agent/css.test.jsx": "import s from './Button.module.css'\ntest('css', () => expect(s).toBeTruthy())\n",
    }, {"app/src/agent/base.css": ".base { color: blue }\n"}, ()),
    "generated manifest": ("manifest-mention", {
        "contract/baseline.lock.json": '{"v":1}\n',
        "tests/test_uct_agent_manifest.py": (
            "import subprocess\n\ndef test_lock():\n"
            "    subprocess.run(['jq', '-e', '.v', 'contract/baseline.lock.json'], check=False)\n"),
    }, {"contract/baseline.lock.json": '{"v":2}\n'}, ()),
    "alias import": ("alias", {
        "app/src/lib/aliased.js": "export const a = 1\n",
        "app/src/agent/alias.test.js": "import { a } from '@/lib/aliased.js'\ntest('a', () => expect(a).toBe(1))\n",
    }, {"app/src/lib/aliased.js": "export const a = 2\n"}, ()),
    "dotted registry (importlib in product code)": ("dotted", {
        "api/services/plugin.py": "def run():\n    return 1\n",
        "api/services/registry.py": (
            "import importlib\nTABLE = {'p': 'api.services.plugin:run'}\n\n"
            "def call(target):\n    mod, _, fn = target.partition(':')\n"
            "    return getattr(importlib.import_module(mod), fn)()\n"),
        "tests/test_uct_agent_registry.py": (
            "from api.services import registry\n\ndef test_reg():\n"
            "    assert registry.call(registry.TABLE['p']) == 1\n"),
    }, {"api/services/plugin.py": "def run():\n    return 2\n"}, ()),
    "always-sensitive file": ("sensitive", {}, {"api/main.py": "app = 1\n"}, ()),
    "PR's own file": ("pr-own", {}, {"app/src/lib/unrelated.js": "export const unrelated = 3\n"},
                      ("app/src/lib/unrelated.js",)),
}
assert {h[0] for h in HOLES.values()} == set(cs.FEATURES), "every resolver feature has exactly one hole test"


@pytest.fixture(scope="module")
def scenarios(tmp_path_factory):
    out = {}
    for name, (_feature, files, edit, pr) in HOLES.items():
        d = tmp_path_factory.mktemp("hole")
        repo, t0 = make_repo(d, files)
        t1 = move_master(repo, edit)
        out[name] = (repo, t0, t1, pr)
    return out


@pytest.mark.parametrize("hole", list(HOLES))
def test_hole_class_is_not_carry(scenarios, hole):
    repo, t0, t1, pr = scenarios[hole]
    rec = verdict(repo, t0, t1, pr)
    assert rec["verdict"] != "carry", json.dumps(rec["reasons"], indent=1)


@pytest.mark.parametrize("hole", list(HOLES))
def test_mutation_disabling_the_feature_turns_the_hole_test_red(scenarios, hole):
    """The feature is load-bearing: off, the same Δ is (wrongly) carried — so the hole test above goes red."""
    feature = HOLES[hole][0]
    repo, t0, t1, pr = scenarios[hole]
    rec = verdict(repo, t0, t1, pr, disable=feature)
    assert rec["verdict"] == "carry", f"{feature} off but verdict stayed {rec['verdict']}: {rec['reasons']}"


def test_mutation_counts_cover_every_feature():
    assert len(HOLES) == len(cs.FEATURES) == 14


# ---- controls -------------------------------------------------------------------------------------------------
def test_unrelated_delta_is_carry(tmp_path):
    repo, t0 = make_repo(tmp_path, {})
    t1 = move_master(repo, {"app/src/lib/unrelated.js": "export const unrelated = 9\n", "docs/other.md": "x\n",
                            "api/other.py": "X = 2\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict"] == "carry", rec["reasons"]
    assert set(rec["reasons"]) == {"app/src/lib/unrelated.js", "docs/other.md", "api/other.py"}


def test_static_import_gives_related_with_the_seed_paths(tmp_path):
    repo, t0 = make_repo(tmp_path, {})
    t1 = move_master(repo, {"app/src/lib/used.js": "export const used = 2\n",
                            "api/services/uct_agent/core.py": "def f():\n    return 2\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict"].startswith("related:"), rec
    rel = set(rec["verdict"].split(":", 1)[1].split(","))
    assert rel == {"app/src/agent/base.test.js", "app/src/pages/Page.agent.test.jsx", "tests/test_uct_agent_base.py"}
    assert any("app/src/agent/base.test.js -> app/src/lib/used.js" in r for r in rec["reasons"]["app/src/lib/used.js"])


def test_setup_file_closure_reaches_every_js_seed(tmp_path):
    repo, t0 = make_repo(tmp_path, {"app/src/test-setup.js": "import './lib/setupHelper.js'\n",
                                    "app/src/lib/setupHelper.js": "export const h = 1\n"})
    t1 = move_master(repo, {"app/src/lib/setupHelper.js": "export const h = 2\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict"].startswith("related:") and "app/src/agent/base.test.js" in rec["verdict"]


def test_unresolvable_relative_import_is_full(tmp_path):
    repo, t0 = make_repo(tmp_path, {"app/src/agent/missing.test.js": "import x from './nope.js'\n"})
    t1 = move_master(repo, {"docs/other.md": "y\n"})
    assert verdict(repo, t0, t1)["verdict"] == "full"


def test_unbounded_read_at_repo_root_is_full(tmp_path):
    repo, t0 = make_repo(tmp_path, {"tests/test_uct_agent_any.py": (
        "from pathlib import Path\nROOT = Path(__file__).resolve().parents[1]\n\n"
        "def read(rel):\n    return (ROOT / rel).read_text()\n\n"
        "def test_x(request):\n    read(request.param)\n")})
    t1 = move_master(repo, {"docs/other.md": "y\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict"] == "full", rec


def test_seeds_come_from_the_workflow(tmp_path):
    repo, t0 = make_repo(tmp_path, {"app/src/elsewhere/x.test.js": "import '../lib/unrelated.js'\n"})
    t1 = move_master(repo, {"app/src/lib/unrelated.js": "export const unrelated = 5\n"})
    assert verdict(repo, t0, t1)["verdict"] == "carry"  # not in AGENT_VITEST_PATHS


def test_log_record_report_roundtrip(tmp_path):
    repo, t0 = make_repo(tmp_path, {})
    t1 = move_master(repo, {"app/src/lib/unrelated.js": "export const unrelated = 7\n"})
    log = tmp_path / "shadow.log"
    rec = verdict(repo, t0, t1)
    cs.append_log(rec, log)
    row = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
    for k in ("time", "pr", "t0", "t1", "delta", "verdict", "reasons", "full_carry_result"):
        assert k in row
    assert row["full_carry_result"] is None
    assert cs.record(log, t1[:10], 1, 0, "new fail", ["app/src/agent/x.test.js"]) == 1
    dd = cs.disagreements(cs.read_log(log))
    assert sorted(d["which"] for d in dd) == ["relaxed", "strict"] and {d["verdict"] for d in dd} == {"carry"}
    assert cs.record(log, t1[:10], 0, 0, "again", []) == 0  # already recorded


def test_report_ignores_failures_inside_the_related_set():
    rows = [{"verdict": "related:a.test.js", "full_carry_result": {"vitest_new_fails": 1, "pytest_new_fails": 0,
                                                                     "failed_files": ["a.test.js"]}},
            {"verdict": "full", "full_carry_result": {"vitest_new_fails": 3, "pytest_new_fails": 0}}]
    assert cs.disagreements(rows) == []


# ---- real history (2026-11-16/17 deltas; AUDIT's answers) ------------------------------------------------------
REAL = [
    ("49284c433e", "bd5e54c76c", "ChartSettingsIndicators/pinePresentation via agent/guide",
     "app/src/components/chart/engine/pinePresentation.js", "app/src/agent/AgentPanel.test.jsx"),
    ("6ef1b7ea72", "0f9f7e42c1", "barStore/prefetch", "app/src/data/barStore/prefetch.js", "app/src/agent/AgentPanel.test.jsx"),
    # AUDIT's answer for this delta was `carry` (not in the IMPORT closure). It IS in the closure: eight Agent tests walk
    # app/src with readdirSync and read every product .js/.jsx as TEXT (agentGuideControls collects every aria-label /
    # title; agentNoLookbehindStrings scans every product file for lookbehind regexes), so commit.js is observed.
    # Reported to AUDIT as a disagreement with the premise, not papered over.
    ("0f9f7e42c1", "339021698b", "journal-2-0 importer (text-read by app/src walkers)",
     "app/src/pages/journal-2-0/lib/importer/commit.js", "app/src/agent/agentGuideControls.test.js"),
    ("6cb90aafa4", "c1cef77d04", "objectCanvas.js reachable via Agent tests",
     "app/src/components/chart/engine/objectCanvas.js", "app/src/agent/AgentPanel.test.jsx"),
]


def _have(sha):
    return subprocess.run(["git", "-C", str(ROOT), "cat-file", "-e", sha + "^{commit}"], capture_output=True).returncode == 0


@pytest.mark.skipif(os.environ.get("AGENT_CLOSURE_REAL") != "1", reason="set AGENT_CLOSURE_REAL=1 (minutes per delta)")
@pytest.mark.parametrize("t0,t1,why,member,seed", REAL)
def test_real_history(t0, t1, why, member, seed):
    if not (_have(t0) and _have(t1)):
        pytest.skip("pinned shas not in this clone")
    cache = os.environ.get("AGENT_CLOSURE_CACHE")
    rec = cs.evaluate(ROOT, t0, t1, pr=None, pr_files=[], use_gh=False, cache_dir=Path(cache) if cache else None)
    print(t0, t1, rec["verdict"][:200], rec["global_reasons"][:3])
    assert rec["verdict"] != "carry", (why, rec["reasons"])
    assert not rec.get("uncertain_seeds"), rec.get("uncertain_seeds")
    assert any(r.startswith(f"reached from {seed} ") for r in rec["reasons"][member]), rec["reasons"][member]


def test_a_file_read_as_text_is_a_member_but_its_imports_are_not_followed(tmp_path):
    """agentNoLookbehind-style: a seed reads another test file's SOURCE. That file is observed (Δ on it -> related),
    but it is not executed, so what IT imports is not in the reading seed's closure."""
    repo, t0 = make_repo(tmp_path, {
        "app/src/other/thing.test.js": "import '../lib/unrelated.js'\n",
        "app/src/agent/readsTest.test.js": (
            "import fs from 'node:fs'\nimport path from 'node:path'\n"
            "const S = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/other/thing.test.js'), 'utf8')\n"
            "test('t', () => expect(S).toBeTruthy())\n"),
    })
    t1 = move_master(repo, {"app/src/lib/unrelated.js": "export const unrelated = 4\n"})
    assert verdict(repo, t0, t1)["verdict"] == "carry"
    repo2, t0b = make_repo(tmp_path / "b", {
        "app/src/other/thing.test.js": "import '../lib/unrelated.js'\n",
        "app/src/agent/readsTest.test.js": (
            "import fs from 'node:fs'\nimport path from 'node:path'\n"
            "const S = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/other/thing.test.js'), 'utf8')\n"
            "test('t', () => expect(S).toBeTruthy())\n"),
    })
    t1b = move_master(repo2, {"app/src/other/thing.test.js": "import '../lib/used.js'\n"})
    assert verdict(repo2, t0b, t1b)["verdict"] == "related:app/src/agent/readsTest.test.js"


def test_a_recursive_directory_walk_reaches_every_file_under_it(tmp_path):
    """agentGuideControls-style: a seed walks a directory with readdirSync and reads every file it finds."""
    repo, t0 = make_repo(tmp_path, {
        "app/src/pages/deep/a/b/Leaf.jsx": "export const L = 1\n",
        "app/src/agent/walk.test.js": (
            "import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\n"
            "const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages')\n"
            "const files = []\n"
            ";(function walk(dir) {\n  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {\n"
            "    const p = path.join(dir, e.name)\n    if (e.isDirectory()) walk(p)\n    else files.push(p)\n  }\n})(SRC)\n"
            "const source = files.map(f => fs.readFileSync(f, 'utf8')).join(' ')\n"
            "test('w', () => expect(source).toBeTruthy())\n"),
    })
    t1 = move_master(repo, {"app/src/pages/deep/a/b/Leaf.jsx": "export const L = 2\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict"] == "related:app/src/agent/walk.test.js", (rec["reasons"], rec.get("uncertain_seeds"))
    assert not rec.get("uncertain_seeds")


def test_empty_delta_is_carry(tmp_path):
    repo, t0 = make_repo(tmp_path, {})
    assert verdict(repo, t0, t0)["verdict"] == "carry"


def test_cli_evaluate_record_report(tmp_path, capsys):
    repo, t0 = make_repo(tmp_path, {})
    t1 = move_master(repo, {"app/src/lib/used.js": "export const used = 3\n"})
    log = tmp_path / "shadow.log"
    assert cs.main(["--repo", str(repo), "--log", str(log), "evaluate", "--pr", "0", "--t0", t0, "--t1", t1]) == 0
    row = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
    assert row["verdict"].startswith("related:") and row["full_carry_result"] is None and row["pr"] is None
    assert cs.main(["--log", str(log), "record", "--t1", t1[:12], "--vitest-fails", "1", "--pytest-fails", "0",
                    "--failed-files", "app/src/agent/base.test.js", "--notes", "inside related"]) == 0
    capsys.readouterr()
    assert cs.main(["--log", str(log), "report"]) == 0
    assert "0 disagreement(s)" in capsys.readouterr().out


# ---- AUDIT ruling 2026-11-17: every line carries BOTH verdicts (strict + relaxed) ---------------------------------
LOADER = {
    "api/services/plugins.py": (
        "import importlib\n\ndef load(name):\n    return importlib.import_module(name)\n"),
    "tests/test_uct_agent_plugins.py": (
        "from api.services import plugins\n\ndef test_load():\n    assert plugins.load('json')\n"),
}
DUAL_FIELDS = ("verdict", "verdict_strict", "verdict_relaxed", "relaxed_deciding_items", "delta_range",
               "related_count_strict", "related_count_relaxed", "runtime_s", "full_carry_result", "source")


def test_dual_verdict_line_when_a_relaxed_item_decides(tmp_path):
    """A product module's computed import_module is a relaxed item: strict -> full, relaxed -> carry, and the line
    names the site that decided the relaxed verdict."""
    repo, t0 = make_repo(tmp_path, LOADER)
    t1 = move_master(repo, {"api/other.py": "X = 3\n"})
    log = tmp_path / "shadow.log"
    cs.append_log(verdict(repo, t0, t1), log)
    row = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
    for k in DUAL_FIELDS:
        assert k in row, k
    assert row["verdict_strict"] == "full" and row["verdict_relaxed"] == "carry" and row["verdict"] == "carry"
    assert row["delta_range"] == f"{t0[:10]}..{t1[:10]}"
    assert row["related_count_strict"] == 0 and row["related_count_relaxed"] == 0
    assert row["relaxed_deciding_items"]["count"] == 1
    assert row["relaxed_deciding_items"]["sites"][0].startswith("api/services/plugins.py:4: import_module()")
    assert isinstance(row["runtime_s"], float)


def test_dual_verdict_line_when_no_relaxed_item_matters(tmp_path):
    repo, t0 = make_repo(tmp_path, {})
    t1 = move_master(repo, {"app/src/lib/used.js": "export const used = 4\n"})
    rec = verdict(repo, t0, t1)
    assert rec["verdict_strict"] == rec["verdict_relaxed"] == rec["verdict"]
    assert rec["related_count_strict"] == rec["related_count_relaxed"] == 2
    assert rec["relaxed_deciding_items"] == {"count": 0, "seeds": 0, "sites": []}


def test_strict_env_makes_the_headline_verdict_strict(tmp_path, monkeypatch):
    repo, t0 = make_repo(tmp_path, LOADER)
    t1 = move_master(repo, {"api/other.py": "X = 4\n"})
    monkeypatch.setenv("AGENT_CLOSURE_STRICT_PRODUCT", "1")
    rec = verdict(repo, t0, t1)
    assert rec["verdict"] == rec["verdict_strict"] == "full" and rec["verdict_relaxed"] == "carry"


def test_report_checks_strict_and_relaxed_separately():
    rows = [{"verdict": "carry", "verdict_relaxed": "carry", "verdict_strict": "full",
             "relaxed_deciding_items": {"count": 1},
             "full_carry_result": {"vitest_new_fails": 0, "pytest_new_fails": 1, "failed_files": ["tests/x.py"]}}]
    dd = cs.disagreements(rows)
    assert [d["which"] for d in dd] == ["relaxed"] and dd[0]["relaxed_deciding_items"] == 1


def test_watch_evaluates_each_new_tip_against_the_last_and_writes_only_the_log(tmp_path):
    repo, c0 = make_repo(tmp_path / "w", {})
    c1 = move_master(repo, {"app/src/lib/used.js": "export const used = 5\n"})
    _git(repo, "update-ref", "refs/remotes/origin/master", c1)
    out = tmp_path / "out"
    out.mkdir()
    log = out / "shadow.log"
    before = _git(repo, "status", "--porcelain")
    r1 = cs.watch_once(repo, log, fetch=False)
    assert r1["source"] == "watch" and (r1["t0"], r1["t1"]) == (c0, c1)      # first run: tip^1..tip
    assert cs.watch_once(repo, log, fetch=False) is None                     # tip unchanged: nothing
    c2 = move_master(repo, {"docs/other.md": "z\n"})
    c3 = move_master(repo, {"api/other.py": "X = 9\n"})
    _git(repo, "update-ref", "refs/remotes/origin/master", c3)
    r2 = cs.watch_once(repo, log, fetch=False)
    assert (r2["t0"], r2["t1"]) == (c1, c3) and r2["delta"] == ["api/other.py", "docs/other.md"]
    assert r2["verdict_strict"] == r2["verdict_relaxed"] == "carry"
    rows = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    assert [r["delta_range"] for r in rows] == [f"{c0[:10]}..{c1[:10]}", f"{c1[:10]}..{c3[:10]}"]
    assert sorted(p.name for p in out.iterdir()) == ["shadow.log"]           # no other files
    assert _git(repo, "status", "--porcelain") == before                     # the repo is untouched
    assert c2  # (intermediate tip, folded into the range)


def test_watch_once_cli(tmp_path, capsys):
    repo, c0 = make_repo(tmp_path, {})
    c1 = move_master(repo, {"docs/other.md": "w\n"})
    _git(repo, "update-ref", "refs/remotes/origin/master", c1)
    log = tmp_path / "shadow.log"
    # no remote named origin in the fixture: the fetch fails quietly and the tick still evaluates the local ref
    assert cs.main(["--repo", str(repo), "--log", str(log), "watch", "--once"]) == 0
    assert json.loads(log.read_text(encoding="utf-8"))["source"] == "watch"


# ---- AUDIT 2026-11-17: free / total PHYSICAL memory (MB) at the start of every evaluate and watch tick ----------
def _mem_ok(row):
    free, total = row["mem_free_mb"], row["mem_total_mb"]
    return isinstance(free, int) and isinstance(total, int) and 0 < free <= total


def test_every_line_records_free_and_total_physical_memory(tmp_path):
    repo, c0 = make_repo(tmp_path, {})
    c1 = move_master(repo, {"docs/other.md": "m\n"})
    log = tmp_path / "shadow.log"
    cs.append_log(verdict(repo, c0, c1), log)                      # evaluate
    _git(repo, "update-ref", "refs/remotes/origin/master", c1)
    assert cs.watch_once(repo, log, fetch=False) is not None        # watch tick
    rows = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    assert [r["source"] for r in rows] == ["evaluate", "watch"]
    assert all(_mem_ok(r) for r in rows), [(r["mem_free_mb"], r["mem_total_mb"]) for r in rows]


def test_memory_unreadable_is_null_never_a_failure(tmp_path, monkeypatch):
    import builtins
    import importlib.util
    if importlib.util.find_spec("psutil") is not None:
        pytest.skip("psutil present: the fallback paths are not reached")
    monkeypatch.setattr(cs.os, "name", "posix")                    # skip the Windows API path
    real_open = builtins.open

    def no_proc(path, *a, **k):
        if str(path) == "/proc/meminfo":
            raise OSError("no /proc here")
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", no_proc)
    assert cs.memory_mb() == {"mem_free_mb": None, "mem_total_mb": None}
