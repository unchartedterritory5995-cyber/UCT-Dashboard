"""agent ci `affected` decision (AUDIT design A, 2026-11-17): rails + end-to-end runs of the workflow's decision step.

agent-ci's PR filter takes `app/**`; its `affected` job runs the MERGE-BASE copy of tools/agent_ci_affected.py (+ the walker
tools/agent_vitest_deps.mjs) on the PR's import graph, and the heavy jobs run only on affected == 'true'. These rails hold:

* the walker: finds the seeds and known dependencies, parses everything it reaches, agrees with tools/import_edges.mjs;
* the floor: MIN_CLOSURE sits between 60% and 100% of today's closure (a broken walk falls below it -> affected=true);
* the decision on the REAL tree: a known dependency is affected, a known non-dependency is not;
* END TO END, in a throwaway git repo, by running the workflow's own `Decide` step script with bash: a PR adding a new
  import into the closure, a PR deleting a dependency, a walker-touching PR and a PR that rewrites the decision script
  are affected; a PR touching only a non-dependency is not; a broken base walker and a below-floor closure fail closed;
* the workflow shape: heavy jobs need `affected` and run only on 'true'; the step sources its code from the merge-base.
Needs Node + app/node_modules (acorn) and git; FAILS, never skips, without them.
"""
from __future__ import annotations

import functools
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

import pytest
import yaml

from tools import agent_ci_affected as aca
from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "agent-ci.yml"
DOC = yaml.safe_load(WF.read_text(encoding="utf-8"))
PATTERNS = acr.agent_paths(DOC)
FILTERS = re.search(r"(?m)^  AGENT_VITEST_PATHS: (.+)$", WF.read_text(encoding="utf-8").split("\njobs:")[0]).group(1).split()

KNOWN_DEP = "app/src/data/barStore/index.js"           # <- the charts workspace the Agent page tests mount
KNOWN_NON_DEP = "app/src/pages/Admin.jsx"              # the admin page: no Agent browser test loads it
KNOWN_DEPS = {
    "app/src/test-setup.js",                                         # vite.config.js test.setupFiles
    "app/src/pages/charts/ChartsWorkspace.jsx",
    KNOWN_DEP,
    "app/src/components/chart/engine/ast/pine.js",
    "app/src/hooks/useUserDefinitions.js",
    "app/src/agent/qa/capabilityRegression/baseline/corpus.json",    # a json import
}
HEAVY = ("server", "browser", "capability-regression-clock", "capability-regression", "union")


def _node() -> str:
    node = shutil.which("node")
    assert node, "node is not on PATH: this rail needs Node and app/node_modules (acorn) — it does not skip"
    return node


@functools.lru_cache(maxsize=1)
def walked() -> dict:
    out = subprocess.run([_node(), str(ROOT / "tools" / "agent_vitest_deps.mjs")], cwd=ROOT, capture_output=True,
                         text=True, encoding="utf-8")
    assert out.returncode == 0, f"tools/agent_vitest_deps.mjs failed (is app/node_modules installed?):\n{out.stderr[-2000:]}"
    return json.loads(out.stdout)


@functools.lru_cache(maxsize=1)
def real_closure() -> frozenset:
    return frozenset(aca.walk(ROOT, ROOT / "app", FILTERS))


# ---- the walker ---------------------------------------------------------------------------------------------------
def test_the_walk_finds_the_seeds_and_the_known_deps():
    w = walked()
    assert len(w["seeds"]) >= 400, f"only {len(w['seeds'])} Agent browser test files found: the seed walk is broken"
    assert w["setup"] == ["app/src/test-setup.js"], w["setup"]
    missing = KNOWN_DEPS - set(w["deps"])
    assert not missing, f"the walk lost known dependencies (fix the walker, not this list): {sorted(missing)}"
    assert not w["unparsed"], w["unparsed"]


def test_the_walk_agrees_with_import_edges():
    with tempfile.TemporaryDirectory() as tmp:
        edges = pathlib.Path(tmp) / "edges.json"
        made = subprocess.run([_node(), str(ROOT / "tools" / "import_edges.mjs")], cwd=ROOT, capture_output=True,
                              text=True, encoding="utf-8")
        assert made.returncode == 0, made.stderr[-2000:]
        edges.write_text(made.stdout, encoding="utf-8")
        out = subprocess.run([_node(), str(ROOT / "tools" / "agent_vitest_deps.mjs"), "--closure-from-edges", str(edges)],
                             cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        assert out.returncode == 0, out.stderr[-2000:]
    mine = set(walked()["deps"]) | set(walked()["seeds"])
    lost = [f for f in json.loads(out.stdout) if f not in mine]
    assert not lost, f"tools/import_edges.mjs reaches these from the same seeds but agent_vitest_deps.mjs does not: {lost[:20]}"


def test_the_floor_is_derived_from_the_live_closure():
    n = len(real_closure())
    assert 0.6 * n <= aca.MIN_CLOSURE <= n, f"MIN_CLOSURE={aca.MIN_CLOSURE} must sit in [60%, 100%] of today's closure ({n})"


# ---- the decision on the real tree --------------------------------------------------------------------------------
def test_a_known_dependency_is_affected():
    affected, reason = aca.decide([KNOWN_DEP], PATTERNS, lambda: real_closure())
    assert affected and KNOWN_DEP in reason, reason


def test_a_known_non_dependency_is_not_affected():
    assert KNOWN_NON_DEP not in real_closure()
    affected, reason = aca.decide([KNOWN_NON_DEP], PATTERNS, lambda: real_closure())
    assert affected is False and "none in the" in reason, reason


@pytest.mark.parametrize("path", list(acr.SELF_PROTECTED))
def test_every_self_protected_file_is_affected(path):
    affected, reason = aca.decide([path], PATTERNS, lambda: frozenset())
    assert affected and "self-protected" in reason, reason


def test_the_self_protected_list_covers_the_decision_code():
    for f in ("tools/agent_vitest_deps.mjs", "tools/agent_ci_affected.py", "tools/agent_ci_required.py",
              ".github/workflows/agent-ci.yml", ".github/workflows/agent-ci-required.yml"):
        assert f in acr.SELF_PROTECTED, f


def test_an_agent_path_besides_the_catch_all_is_affected_without_walking():
    def boom():
        raise AssertionError("walked")
    for p in ("app/src/agent/nl/router.js", "api/main.py", "tests/test_uct_agent_x.py"):
        assert aca.decide([p], PATTERNS, boom)[0] is True, p


@pytest.mark.parametrize("err", [RuntimeError("walker exit 1"), subprocess.TimeoutExpired("node", 120), ValueError("bad json")])
def test_a_walker_error_fails_closed(err):
    def broken():
        raise err
    affected, reason = aca.decide([KNOWN_NON_DEP], PATTERNS, broken)
    assert affected is True and reason.startswith("fail closed"), reason


def test_unknown_or_empty_diff_fails_closed():
    assert aca.decide(None, PATTERNS, lambda: real_closure())[0] is True
    assert aca.decide([], PATTERNS, lambda: real_closure())[0] is True


# ---- the workflow shape -------------------------------------------------------------------------------------------
def _decide_step() -> dict:
    steps = DOC["jobs"]["affected"]["steps"]
    return next(s for s in steps if s.get("id") == "decide")


def test_heavy_jobs_need_the_decision_and_run_only_on_true():
    for k in HEAVY:
        job = DOC["jobs"][k]
        needs = job.get("needs")
        needs = [needs] if isinstance(needs, str) else needs
        assert "affected" in needs, k
        assert str(job["if"]).endswith("&& needs.affected.outputs.affected == 'true'"), (k, job["if"])
    assert DOC["jobs"]["affected"]["name"] == acr.DECISION_JOB


def test_the_decision_step_runs_merge_base_code_never_the_prs():
    run = _decide_step()["run"]
    assert 'MB="$(git merge-base "$BASE_SHA" "$HEAD_SHA"' in run
    assert 'git show "$MB:$f" > "$CODE/$f"' in run
    for f in ("tools/agent_ci_affected.py", "tools/agent_ci_required.py", "tools/agent_vitest_deps.mjs"):
        assert f in run.split("for f in", 1)[1].split(";", 1)[0], f
    calls = re.findall(r'"\$PY" (\S+agent_ci_affected\.py"?)', run)
    assert calls == ['"$CODE/tools/agent_ci_affected.py"'], calls
    steps = DOC["jobs"]["affected"]["steps"]
    names = [s.get("name", "") for s in steps]
    assert any(n.startswith(acr.NOT_AFFECTED_STEP) for n in names), names


# ---- end to end: the workflow's own decide step, in a throwaway repo ------------------------------------------------
def _bash() -> str:
    for c in (r"C:\Program Files\Git\bin\bash.exe", shutil.which("bash")):
        if c and os.path.exists(c):
            return c
    raise AssertionError("bash not found")


def _git(repo, *args):
    out = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def _write(repo: pathlib.Path, rel: str, text: str):
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")


MINI = {
    "app/package.json": "{}\n",
    "app/vite.config.js": "export default { test: { setupFiles: './src/test-setup.js' } }\n",
    "app/src/test-setup.js": "export const ready = true\n",
    "app/src/agent/a.test.js": "import { a } from '../lib/a.js'\ntest('a', () => a())\n",
    "app/src/lib/a.js": "import { b } from './b.js'\nexport const a = () => b\n",
    "app/src/lib/b.js": "export const b = 1\n",
    "app/src/other/c.js": "export const c = 1\n",
}


def _mini_repo(tmp: pathlib.Path, floor: int = 3, base_walker_broken: bool = False) -> pathlib.Path:
    repo = tmp / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@example.invalid")
    _git(repo, "config", "user.name", "t")
    _git(repo, "config", "core.autocrlf", "false")
    for rel, text in MINI.items():
        _write(repo, rel, text)
    _write(repo, ".github/workflows/agent-ci.yml", WF.read_text(encoding="utf-8"))
    affected_src = (ROOT / "tools" / "agent_ci_affected.py").read_text(encoding="utf-8")
    affected_src, n = re.subn(r"(?m)^MIN_CLOSURE = \d+$", f"MIN_CLOSURE = {floor}", affected_src)
    assert n == 1
    _write(repo, "tools/agent_ci_affected.py", affected_src)
    _write(repo, "tools/agent_ci_required.py", (ROOT / "tools" / "agent_ci_required.py").read_text(encoding="utf-8"))
    walker = (ROOT / "tools" / "agent_vitest_deps.mjs").read_text(encoding="utf-8")
    _write(repo, "tools/agent_vitest_deps.mjs", "throw new Error('broken walker')\n" + walker if base_walker_broken else walker)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "checkout", "-q", "-b", "pr")
    return repo


def _decide_e2e(repo: pathlib.Path, tmp: pathlib.Path, edits: dict, deletes=()) -> tuple[str, str]:
    for rel, text in edits.items():
        _write(repo, rel, text)
    for rel in deletes:
        (repo / rel).unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "pr")
    rt = tmp / "rt"
    rt.mkdir(exist_ok=True)
    out = tmp / "github_output"
    out.write_text("", encoding="utf-8")
    env = dict(os.environ, EVENT="pull_request", BASE_SHA=_git(repo, "rev-parse", "master"), HEAD_SHA=_git(repo, "rev-parse", "pr"),
               RUNNER_TEMP=rt.as_posix(), GITHUB_OUTPUT=out.as_posix(), PYTHON=pathlib.Path(sys.executable).as_posix(),
               AFFECTED_DEPS_READY="1", AFFECTED_MODULES=(ROOT / "app").as_posix(), PYTHONPATH="")
    r = subprocess.run([_bash(), "-c", _decide_step()["run"]], cwd=repo, env=env, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    got = dict(line.split("=", 1) for line in out.read_text(encoding="utf-8").splitlines() if "=" in line)
    return got["affected"], got["reason"]


def test_e2e_a_non_dependency_change_is_not_affected(tmp_path):
    repo = _mini_repo(tmp_path)
    affected, reason = _decide_e2e(repo, tmp_path, {"app/src/other/c.js": "export const c = 2\n"})
    assert affected == "false" and "none in the" in reason, reason


def test_e2e_a_pr_adding_a_new_import_into_the_closure_is_affected(tmp_path):
    repo = _mini_repo(tmp_path)
    affected, reason = _decide_e2e(repo, tmp_path, {
        "app/src/lib/new.js": "export const n = 1\n",
        "app/src/lib/b.js": "import { n } from './new.js'\nexport const b = n\n"})
    assert affected == "true" and "2 changed file(s) in the" in reason, reason


def test_e2e_moving_a_non_dependency_into_the_closure_is_affected(tmp_path):
    """The import that pulls c.js in lives in the PR's tree only: the PR-side graph is what catches it."""
    repo = _mini_repo(tmp_path)
    affected, reason = _decide_e2e(repo, tmp_path, {
        "app/src/other/c.js": "export const c = 2\n",
        "app/src/lib/b.js": "import { c } from '../other/c.js'\nexport const b = c\n"})
    assert affected == "true" and "app/src/lib/b.js" in reason, reason


def test_e2e_deleting_a_dependency_is_affected(tmp_path):
    repo = _mini_repo(tmp_path)
    affected, reason = _decide_e2e(repo, tmp_path, {}, deletes=["app/src/lib/b.js"])
    assert affected == "true" and "app/src/lib/b.js" in reason, reason


def test_e2e_a_walker_touching_pr_is_affected(tmp_path):
    repo = _mini_repo(tmp_path)
    walker = (repo / "tools" / "agent_vitest_deps.mjs").read_text(encoding="utf-8")
    affected, reason = _decide_e2e(repo, tmp_path, {"tools/agent_vitest_deps.mjs": walker + "// touched\n",
                                                    "app/src/other/c.js": "export const c = 2\n"})
    assert affected == "true" and "self-protected file changed: tools/agent_vitest_deps.mjs" in reason, reason


def test_e2e_a_pr_rewriting_the_decision_script_cannot_decide_its_own_verdict(tmp_path):
    """The PR's copy says "not affected" for everything; the step must run the merge-base copy instead."""
    repo = _mini_repo(tmp_path)
    src = (repo / "tools" / "agent_ci_affected.py").read_text(encoding="utf-8")
    evil = src.replace('def decide(changed', 'def decide(*_a, **_k):\n    return False, "pwned"\n\n\ndef _real_decide(changed', 1)
    assert evil != src
    affected, reason = _decide_e2e(repo, tmp_path, {"tools/agent_ci_affected.py": evil,
                                                    "app/src/lib/b.js": "export const b = 2\n"})
    assert affected == "true" and "pwned" not in reason, reason


def test_e2e_a_broken_base_walker_fails_closed(tmp_path):
    repo = _mini_repo(tmp_path, base_walker_broken=True)
    affected, reason = _decide_e2e(repo, tmp_path, {"app/src/other/c.js": "export const c = 2\n"})
    assert affected == "true" and reason.startswith("fail closed"), reason


def test_e2e_a_closure_below_the_floor_fails_closed(tmp_path):
    repo = _mini_repo(tmp_path, floor=aca.MIN_CLOSURE)
    affected, reason = _decide_e2e(repo, tmp_path, {"app/src/other/c.js": "export const c = 2\n"})
    assert affected == "true" and "below the floor" in reason, reason


def test_e2e_no_decision_code_on_the_base_fails_closed(tmp_path):
    repo = _mini_repo(tmp_path)
    _git(repo, "checkout", "-q", "master")
    _git(repo, "rm", "-q", "tools/agent_ci_affected.py")
    _git(repo, "commit", "-q", "-m", "base without decision code")
    _git(repo, "checkout", "-q", "-B", "pr")
    affected, reason = _decide_e2e(repo, tmp_path, {"app/src/other/c.js": "export const c = 2\n"})
    assert affected == "true" and "no decision code" in reason, reason
