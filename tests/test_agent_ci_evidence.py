"""P2 merge-tree evidence (tools/agent_ci_evidence.py, tools/agent_ci_rearm.py): PASS only for the newest completed
pull_request (or, opted in, re-arm) agent ci run of THIS PR whose 18 records agree on a merge commit of the CURRENT base
tip + PR head with the expected tree. Every fail-closed branch is driven from one PASS fixture
(tests/fixtures/agent_ci_evidence/pass_run.json) by changing ONE thing."""
from __future__ import annotations

import copy
import json
import pathlib
import re
import subprocess
import types

import pytest

from tools import agent_ci_evidence as ev
from tools import agent_ci_rearm as rearm
from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "agent_ci_evidence" / "pass_run.json").read_text(encoding="utf-8"))
DOC = acr.load_agent_ci(ROOT)
KEYS = ev.required_keys(DOC)
BOTH = (ev.PR_EVENT, ev.DISPATCH_EVENT)
PROTECTED = ev.protected_patterns(ROOT)


def _fx():
    return copy.deepcopy(FIXTURE)


def _decide(fx, accept=(ev.PR_EVENT,), busy=False, keys=None, ref_sha="d" * 40):
    return ev.decide(fx["pr"], fx["base_tip"], fx["runs"], KEYS if keys is None else keys, fx["expected_tree"], accept, busy,
                     fx["changed_paths"], PROTECTED, ref_sha)


def _code(result):
    verdict, reason, _ = result
    return verdict if verdict == "PASS" else reason.split(":", 1)[0]


def _run(fx):
    return fx["runs"][0]


def _recs(fx):
    return _run(fx)["records"]


# ---- the required job set ---------------------------------------------------------------------------------------
def test_required_keys_cover_the_eighteen_required_jobs_one_to_one():
    assert list(KEYS) == acr.required_jobs(DOC) and len(KEYS) == 18
    assert len(set(KEYS.values())) == 18
    assert {k for k in KEYS.values() if k.startswith("browser-")} == {f"browser-{i}" for i in range(1, 13)}
    assert {k for k in KEYS.values() if k.startswith("capability-regression-clock-")} == {
        f"capability-regression-clock-{c}" for c in ("post", "rth-1", "rth-2")}
    assert set(_recs(FIXTURE)) == set(KEYS.values()), "the fixture no longer matches agent-ci.yml's jobs"


# ---- PASS -------------------------------------------------------------------------------------------------------
def test_the_fixture_passes_and_reports_the_evidence():
    verdict, reason, evidence = _decide(_fx())
    assert verdict == "PASS", reason
    assert evidence["tree"] == FIXTURE["expected_tree"] and evidence["base_sha"] == FIXTURE["base_tip"]
    assert evidence["head_sha"] == FIXTURE["pr"]["head_sha"] and evidence["jobs"] == evidence["records"] == 18
    assert evidence["merge_sha"] == "d" * 40 and evidence["event"] == "pull_request"


def test_newest_run_is_judged_and_an_older_red_one_is_ignored():
    fx = _fx()
    old = copy.deepcopy(_run(fx))
    old.update(id=1, conclusion="failure", created_at="2026-11-17T09:00:00Z")
    fx["runs"].insert(0, old)
    assert _code(_decide(fx)) == "PASS"


def test_failed_test_names_are_carried_for_an_offender_compare():
    fx = _fx()
    _recs(fx)["browser-3"]["failed"] = {"vitest": ["app/src/agent/x.test.js > a b"]}
    assert _decide(fx)[2]["failed_tests"]["vitest"] == ["app/src/agent/x.test.js > a b"]


# ---- every fail-closed branch -------------------------------------------------------------------------------------
def _mut(fn):
    fx = _fx()
    fn(fx)
    return fx


CASES = {
    # the PR itself
    "pr-closed": (lambda f: f["pr"].update(state="closed"), "pr-not-open"),
    "pr-into-agent-int": (lambda f: f["pr"].update(base_ref="agent/int"), "pr-not-master"),
    "pr-fork-head": (lambda f: f["pr"].update(head_repo="fork/r"), "pr-not-agent-head"),
    "pr-non-agent-head": (lambda f: f["pr"].update(head_ref="charts/x"), "pr-not-agent-head"),
    # the run
    "no-run": (lambda f: f.update(runs=[]), "no-run"),
    "only-a-push-run": (lambda f: _run(f).update(event="push"), "no-run"),
    "dispatch-not-accepted-by-default": (lambda f: _run(f).update(event="repository_dispatch"), "no-run"),
    "workflow-dispatch-is-never-a-run": (lambda f: _run(f).update(event="workflow_dispatch"), "no-run"),
    "run-in-progress": (lambda f: _run(f).update(status="in_progress", conclusion=None), "run-in-progress"),
    "run-queued": (lambda f: _run(f).update(status="queued", conclusion=None), "run-in-progress"),
    "newer-run-in-progress": (lambda f: f["runs"].append(dict(copy.deepcopy(_run(f)), id=9, status="in_progress",
                                                               conclusion=None, created_at="2026-11-17T11:00:00Z")), "run-in-progress"),
    "missing-job": (lambda f: _run(f)["jobs"].pop(4), "missing-job"),
    "no-jobs": (lambda f: _run(f).update(jobs=[]), "missing-job"),
    "job-failed": (lambda f: _run(f)["jobs"][0].update(conclusion="failure"), "job-not-success"),
    "job-skipped": (lambda f: _run(f)["jobs"][12].update(conclusion="skipped"), "job-not-success"),
    "job-rerun-one-attempt-red": (lambda f: _run(f)["jobs"].append({"name": _run(f)["jobs"][1]["name"], "conclusion": "cancelled"}), "job-not-success"),
    "run-not-success": (lambda f: _run(f).update(conclusion="cancelled"), "job-not-success"),
    # the artifacts / records
    "missing-artifact": (lambda f: _recs(f).pop("union"), "missing-artifact"),
    "unreadable-artifact": (lambda f: _recs(f).update(server=None), "missing-artifact"),
    "no-records": (lambda f: _run(f).update(records=None), "missing-artifact"),
    "wrong-schema": (lambda f: _recs(f)["server"].update(schema="other/v0"), "missing-artifact"),
    "record-for-another-job": (lambda f: _recs(f)["server"].update(job_key="browser-1"), "missing-artifact"),
    "record-from-push-event": (lambda f: _recs(f)["browser-2"].update(event="push"), "non-pr-event"),
    "record-for-another-pr": (lambda f: _recs(f)["browser-2"].update(pr=1699), "record-mismatch"),
    "record-from-another-run": (lambda f: _recs(f)["browser-2"].update(run_id=1), "record-mismatch"),
    "record-reports-error": (lambda f: _recs(f)["browser-2"].update(errors=["checked-out HEAD is not the merge"]), "record-mismatch"),
    "records-disagree-on-tree": (lambda f: _recs(f)["browser-5"].update(tree="f" * 40), "record-mismatch"),
    "records-disagree-on-sha": (lambda f: _recs(f)["browser-5"].update(sha="f" * 40), "record-mismatch"),
    # the merge ref
    "not-a-merge-commit": (lambda f: [r.update(parents=["b" * 40]) for r in _recs(f).values()], "wrong-parents"),
    "stale-base": (lambda f: f.update(base_tip="a" * 40), "stale-base"),
    "stale-head": (lambda f: f["pr"].update(head_sha="a" * 40), "stale-head"),
    # the tree
    "tree-mismatch": (lambda f: f.update(expected_tree="a" * 40), "tree-mismatch"),
    # F1: the PR's own diff
    "diff-unknown": (lambda f: f.update(changed_paths=None), "self-protected-diff"),
}


@pytest.mark.parametrize("case", sorted(CASES))
def test_every_fail_closed_branch(case):
    mutate, code = CASES[case]
    verdict, reason, evidence = _decide(_mut(mutate))
    assert verdict == "FAIL" and evidence == {}, (case, verdict, reason)
    assert _code((verdict, reason, evidence)) == code, (case, reason)


def test_no_required_jobs_never_passes():
    assert _code(_decide(_fx(), keys={})) == "missing-job"


def test_a_run_whose_api_event_is_not_a_pr_event_fails_even_if_accepted():
    """Defence in depth: the caller's accept list cannot widen the event guard to a push / schedule run."""
    fx = _mut(lambda f: _run(f).update(event="push"))
    for r in _recs(fx).values():
        r["event"] = "push"
    assert _code(_decide(fx, accept=("pull_request", "push"))) == "non-pr-event"


# ---- --accept-dispatch (a re-arm run) ----------------------------------------------------------------------------
#: a repository_dispatch run's head_sha is the DEFAULT branch's commit that ran the workflow (master's tip, or an
#: ancestor of it by verify time) -- never the commit under test
WF_SHA = "a" * 40


def _dispatch_fx():
    fx = _fx()
    _run(fx)["event"] = "repository_dispatch"
    _run(fx).update(head_branch="master", path=".github/workflows/agent-ci.yml", head_sha=WF_SHA, head_on_master=True)
    for r in _recs(fx).values():
        r["event"], r["ref"] = "repository_dispatch", "refs/heads/master"
    return fx


def test_a_rearm_run_passes_only_when_opted_in():
    assert _code(_decide(_dispatch_fx())) == "no-run"
    assert _code(_decide(_dispatch_fx(), accept=BOTH)) == "PASS"


def test_a_busy_dispatch_fails_closed_when_rearm_runs_are_accepted():
    assert _code(_decide(_dispatch_fx(), accept=BOTH, busy=True)) == "run-in-progress"
    assert _code(_decide(_fx(), accept=(ev.PR_EVENT,), busy=True)) == "PASS"   # ignored when dispatch is not accepted


@pytest.mark.parametrize("over", [{"head_branch": "agent/pl/x"}, {"head_branch": None}, {"head_branch": "Master"},
                                  {"path": ".github/workflows/agent-ci-benchmark.yml"}, {"path": None},
                                  {"path": ".github/workflows/agent-ci.yml@refs/heads/agent/pl/x"}])
def test_F2_a_rearm_run_counts_only_from_masters_agent_ci_yml(over):
    fx = _dispatch_fx()
    _run(fx).update(over)
    assert _code(_decide(fx, accept=BOTH)) == "dispatch-ref", over


def test_F2_the_dispatch_ref_guard_does_not_touch_pull_request_runs():
    fx = _fx()
    _run(fx).update(head_branch="agent/pl/x", path=None)   # a PR run's head_branch is the PR branch
    assert _code(_decide(fx, accept=BOTH)) == "PASS"


# ---- F1: a PR that edits what its own run executes never passes on its own run ----------------------------------
SELF_PROTECTED_EXAMPLES = {
    "workflow": [".github/workflows/agent-ci.yml", ".github/workflows/agent-ci-required.yml", ".github/workflows/new.yml"],
    "ci tools": ["tools/agent_ci_evidence.py", "tools/agent_ci_required.py", "tools/agent_ci_rearm.py", "tools/agent_ci_new.py"],
    "suite lock": ["tools/agent_suite_lock.py"],
    "app package": ["app/package.json", "app/package-lock.json"],
    "vite config": ["app/vite.config.js", "app/vite.device.config.mjs", "app/vite.config.lab.mjs"],
    "vitest config": ["app/vitest.config.ts", "app/vitest.workspace.config.js"],
    "vitest setupFiles": ["app/src/test-setup.js"],
    "pytest.ini": ["pytest.ini"],
    "conftest": ["conftest.py", "tests/conftest.py", "api/services/uct_agent/conftest.py"],
    "requirements": ["requirements.txt", "requirements-dev.txt", "api/requirements.txt"],
    # F4
    "shard planner": ["tools/agent_vitest_shards.py"],
    "shard timings": ["tools/agent_vitest_shard_timings.json"],
    "app scripts": ["app/scripts/chartLibraryPatch.mjs", "app/scripts/new-helper.mjs"],
    "config imports (derived)": ["app/src/lib/marketClock/calendarCompact.js", "app/src/components/chart/engine/ast/manifestProse.js"],
}


@pytest.mark.parametrize("cls", sorted(SELF_PROTECTED_EXAMPLES))
def test_F1_each_self_protected_path_class_fails_closed(cls):
    for path in SELF_PROTECTED_EXAMPLES[cls]:
        fx = _fx()
        fx["changed_paths"] = fx["changed_paths"] + [path]
        verdict, reason, _ = _decide(fx)
        assert _code((verdict, reason, None)) == "self-protected-diff" and path in reason, (cls, path, reason)


def test_F1_ordinary_agent_paths_are_not_self_protected():
    ok = ["app/src/agent/a.js", "tools/agent_ownership_check.py", "app/src/lib/marketClock/other.js", "tests/test_uct_agent_x.py",
          "app/src/pages/charts/ChartsWorkspace.jsx", "docs/agent/program/INTEGRATION.md", "app/src/agent/vite.config.js",
          "tests/fixtures/agent_ci_evidence/pass_run.json", "app/src/test-setup.test.js"]
    assert ev.self_protected_hits(ok, PROTECTED) == []


def test_F1_setup_files_are_read_from_the_config(tmp_path):
    assert "app/src/test-setup.js" in ev.vitest_setup_files(ROOT)          # the real config's setupFiles
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "vitest.config.ts").write_text("export default {test: {setupFiles: ['./a/s1.js', \"./b/s2.ts\"]}}", encoding="utf-8")
    assert ev.vitest_setup_files(tmp_path) == ["app/a/s1.js", "app/b/s2.ts"]
    (tmp_path / "app" / "vite.config.js").write_text("const S = ['x']; export default {test: {setupFiles: S}}", encoding="utf-8")
    with pytest.raises(ValueError):                                         # a shape it cannot read fails closed
        ev.vitest_setup_files(tmp_path)
    (tmp_path / "app" / "vite.config.js").write_text("export default {test: {setupFiles: [SETUP_A, './ok.js']}}", encoding="utf-8")
    with pytest.raises(ValueError):                                         # an identifier inside the list fails closed
        ev.vitest_setup_files(tmp_path)
    (tmp_path / "app" / "vite.config.js").write_text("export default {test: {setupFiles: [SETUP_A]}}", encoding="utf-8")
    with pytest.raises(ValueError):                                         # a list with no literal at all fails closed
        ev.vitest_setup_files(tmp_path)
    with pytest.raises(ValueError):                                         # no setupFiles at all fails closed
        ev.vitest_setup_files(tmp_path / "nowhere")


def test_F1_conditional_setup_files_protect_both_branches(tmp_path):
    # #1690 made master's vite.config.js pick setupFiles with `cond ? [...] : '...'`: both branches are protected.
    real = ev.vitest_setup_files(ROOT)
    assert "app/src/test-setup.js" in real
    if "UCT_READ_CAPTURE_DIR" in (ROOT / "app" / "vite.config.js").read_text(encoding="utf-8"):
        assert "app/src/test-read-capture.js" in real
    (tmp_path / "app").mkdir()
    cfg = tmp_path / "app" / "vite.config.js"
    cfg.write_text("export default {test: {setupFiles: process.env.X\n  ? ['./a.js', './b.js']\n  : './a.js',\n pool: 'forks'}}", encoding="utf-8")
    assert ev.vitest_setup_files(tmp_path) == ["app/a.js", "app/b.js"]
    cfg.write_text("export default {test: {setupFiles: !flag ? './c.js' : ['./d.js']}}", encoding="utf-8")
    assert ev.vitest_setup_files(tmp_path) == ["app/c.js", "app/d.js"]
    for bad in [
        "export default {test: {setupFiles: f('x') ? ['./a.js'] : './b.js'}}",          # condition holds a string
        "export default {test: {setupFiles: c ? ['./a.js'] : S}}",                     # a branch is an identifier
        "export default {test: {setupFiles: c ? S : './b.js'}}",
        "export default {test: {setupFiles: c1 ? './a.js' : c2 ? './b.js' : './c.js'}}",  # nested conditional
        "export default {test: {setupFiles: c ? ['./a.js'] : ['./b.js'].concat(X)}}",  # something follows a branch
        "export default {test: {setupFiles: ['./a.js'].concat(X)}}",                   # something follows a literal
        "export default {test: {setupFiles: ['./a.js'] + X}}",
        "export default {test: {setupFiles: ['./a.js'], other: 1}, x: {setupFiles: S}}",  # a second, unreadable one
    ]:
        cfg.write_text(bad, encoding="utf-8")
        with pytest.raises(ValueError):
            ev.vitest_setup_files(tmp_path)


def test_F4_config_imports_are_derived_transitively_and_fail_closed(tmp_path):
    real = ev.config_imports(ROOT)
    assert "app/scripts/chartLibraryPatch.mjs" in real and "app/vite.config.js" in real   # vite.config.js -> ./scripts/...
    assert "app/src/lib/marketClock/calendarCompact.js" in real                          # ... -> what that script imports
    app = tmp_path / "app"
    (app / "lib").mkdir(parents=True)
    (app / "vite.config.js").write_text("/* lazy import(name) edges,\n   import x from './gone.js' */\n// import x from './commented.js'\n"
                                        "import a from './lib/a'\nimport 'react'\n", encoding="utf-8")   # comments never count
    (app / "lib" / "a.mjs").write_text("export { b } from './b.js'\nconst c = require('../c.cjs')\n", encoding="utf-8")
    (app / "lib" / "b.js").write_text("export const b = 1 // see https://x.y/import(z)\n", encoding="utf-8")
    (app / "c.cjs").write_text("module.exports = 1\n", encoding="utf-8")
    assert ev.config_imports(tmp_path) == ["app/c.cjs", "app/lib/a.mjs", "app/lib/b.js"]
    (app / "lib" / "b.js").write_text("import x from './missing.js'\n", encoding="utf-8")
    with pytest.raises(ValueError, match="resolves to no file"):                       # unresolvable: fail closed
        ev.config_imports(tmp_path)
    (app / "lib" / "b.js").write_text("const m = await import(name)\n", encoding="utf-8")
    with pytest.raises(ValueError, match="non-literal"):                               # computed import: fail closed
        ev.config_imports(tmp_path)
    (app / "lib" / "b.js").write_text("import x from '../../../outside.js'\n", encoding="utf-8")
    (tmp_path.parent / "outside.js").write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="leaves the repository"):
        ev.config_imports(tmp_path)


def test_F4_protected_patterns_include_the_derived_imports():
    pats = ev.protected_patterns(ROOT)
    assert "app/src/lib/marketClock/calendarCompact.js" in pats and "app/src/test-setup.js" in pats


def test_F1_cli_fails_closed_when_the_protected_list_is_unreadable(tmp_path, capsys):
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "agent-ci.yml").write_text((ROOT / ".github/workflows/agent-ci.yml").read_text(encoding="utf-8"), encoding="utf-8")
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(tmp_path)]) == 1   # no app/ config
    assert "self-protected-diff" in capsys.readouterr().out


def test_a_rearm_record_under_a_pr_run_is_refused():
    fx = _fx()
    _recs(fx)["union"]["event"] = "repository_dispatch"
    assert _code(_decide(fx, accept=BOTH)) == "non-pr-event"


@pytest.mark.parametrize("accept", [BOTH, (ev.PR_EVENT,), (ev.PR_EVENT, "workflow_dispatch"), ("workflow_dispatch",)])
def test_P2c_a_workflow_dispatch_run_never_passes_whatever_the_caller_accepts(accept):
    """AUDIT #6: ONE re-arm path. A workflow_dispatch run (or record) is refused even if a caller lists it."""
    fx = _dispatch_fx()
    _run(fx)["event"] = "workflow_dispatch"
    for r in _recs(fx).values():
        r["event"] = "workflow_dispatch"
    assert _decide(fx, accept=accept, ref_sha=M)[0] == "FAIL"
    assert BOTH == ("pull_request", "repository_dispatch")


# ---- gather() over a fake gh (no network) --------------------------------------------------------------------------
class FakeGh:
    def __init__(self, fx, *, extra_runs=(), dispatch_runs=(), artifacts=None, fail=None):
        self.fx, self.extra, self.dispatch, self.fail = fx, list(extra_runs), list(dispatch_runs), fail
        self.artifacts = artifacts
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        if self.fail and self.fail in path:
            raise ev.ApiError(f"GET {path}: HTTP 502")
        pr, run = self.fx["pr"], _run(self.fx)
        if path == f"pulls/{pr['number']}":
            return {"number": pr["number"], "state": pr["state"], "head": {"sha": pr["head_sha"], "ref": pr["head_ref"], "repo": {"full_name": pr["head_repo"]}},
                    "base": {"ref": pr["base_ref"], "repo": {"full_name": pr["repo"]}}}
        if path.startswith("git/ref/heads/"):
            return {"object": {"sha": self.fx["base_tip"]}}
        if "runs?event=pull_request" in path:
            assert f"branch={pr['head_ref']}" in path
            return {"workflow_runs": [dict(run, head_branch=pr["head_ref"], pull_requests=[{"number": pr["number"]}])] + self.extra}
        if "runs?event=repository_dispatch" in path:
            return {"workflow_runs": self.dispatch}
        if "runs?event=workflow_dispatch" in path:
            raise AssertionError("verify must not list workflow_dispatch runs (P2c: one re-arm path)")
        if path.startswith("compare/"):
            base = path[len("compare/"):].split("...", 1)[0]
            return self.compare if self.compare is not None else {"status": "ahead", "merge_base_commit": {"sha": base}}
        if "/files?" in path:
            page = int(path.rsplit("page=", 1)[1])
            files = self.fx["changed_paths"] or []
            return [{"filename": f} for f in files[(page - 1) * 100: page * 100]]
        if path.endswith("/artifacts?per_page=100"):
            rid = int(path.split("/")[2])
            names = self.artifacts if self.artifacts is not None else [f"{ev.ARTIFACT_PREFIX}{pr['number']}-{k}" for k in _recs(self.fx)]
            return {"artifacts": [{"name": n, "expired": False} for n in names] if rid == run["id"] else []}
        if "/jobs?" in path:
            return {"jobs": run["jobs"]}
        raise AssertionError(path)

    def remote_ref(self, ref):
        self.calls.append(f"ls-remote {ref}")
        return self.ref_sha.get(ref) if isinstance(self.ref_sha, dict) else self.ref_sha

    ref_sha = None
    compare = None

    def download(self, run_id, name, dest):
        key = name[len(f"{ev.ARTIFACT_PREFIX}{self.fx['pr']['number']}-"):]
        pathlib.Path(dest).mkdir(parents=True)
        (pathlib.Path(dest) / "evidence.json").write_text(json.dumps(_recs(self.fx)[key]), encoding="utf-8")


def _gather_decide(api, accept_dispatch=False):
    fx = api.fx
    pr, tip, runs, busy, changed, ref_sha = ev.gather(api, fx["pr"]["number"], KEYS, accept_dispatch)
    return ev.decide(pr, tip, runs, KEYS, fx["expected_tree"], BOTH if accept_dispatch else (ev.PR_EVENT,), busy, changed, PROTECTED, ref_sha)


def test_gather_reads_the_run_and_its_records_and_passes():
    assert _code(_gather_decide(FakeGh(_fx()))) == "PASS"


def test_gather_ignores_runs_of_another_pr_on_the_same_branch():
    fx = _fx()
    other = dict(copy.deepcopy(_run(fx)), id=5, status="in_progress", created_at="2026-11-17T12:00:00Z",
                 pull_requests=[{"number": 1}], head_branch="agent/pl/x")
    assert _code(_gather_decide(FakeGh(fx, extra_runs=[other]))) == "PASS"


def test_gather_missing_and_expired_artifacts_fail_closed():
    fx = _fx()
    names = [f"{ev.ARTIFACT_PREFIX}1700-{k}" for k in _recs(fx) if k != "browser-7"]
    assert _code(_gather_decide(FakeGh(fx, artifacts=names))) == "missing-artifact"
    assert _code(_gather_decide(FakeGh(fx, artifacts=[]))) == "missing-artifact"


def test_gather_any_in_progress_dispatch_is_busy():
    busy = {"id": 77, "event": "repository_dispatch", "status": "in_progress", "created_at": "2026-11-17T12:00:00Z"}
    assert _code(_gather_decide(FakeGh(_fx(), dispatch_runs=[busy]), accept_dispatch=True)) == "run-in-progress"


def test_gather_reads_the_pr_diff_and_a_workflow_edit_fails_closed():
    fx = _fx()
    fx["changed_paths"] = fx["changed_paths"] + [".github/workflows/agent-ci.yml"]
    assert _code(_gather_decide(FakeGh(fx))) == "self-protected-diff"
    fx["changed_paths"] = [f"docs/{i}.md" for i in range(3000)]           # truncated list: unknown, never assumed clean
    assert _code(_gather_decide(FakeGh(fx))) == "self-protected-diff"


def test_gather_api_error_propagates_as_api_error():
    with pytest.raises(ev.ApiError):
        _gather_decide(FakeGh(_fx(), fail="/jobs?"))


def test_verify_cli_turns_an_api_error_into_fail(monkeypatch, capsys):
    monkeypatch.setattr(ev, "GhApi", lambda repo: FakeGh(_fx(), fail="git/ref"))
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(ROOT)]) == 1
    assert capsys.readouterr().out.startswith("FAIL PR #1700: api-error")


def _stub_gather(monkeypatch, fx):
    monkeypatch.setattr(ev, "GhApi", lambda repo: None)
    monkeypatch.setattr(ev, "gather", lambda api, n, keys, accept_dispatch: (fx["pr"], fx["base_tip"], fx["runs"], False, fx["changed_paths"],
                                                                            "d" * 40 if accept_dispatch else None))


def test_F3_cli_refuses_a_dispatch_only_run_without_the_flag(monkeypatch, capsys):
    """E4: the CLI default must accept pull_request runs ONLY; a re-arm needs --accept-dispatch."""
    _stub_gather(monkeypatch, _dispatch_fx())
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(ROOT)]) == 1
    assert capsys.readouterr().out.startswith("FAIL PR #1700: no-run")
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(ROOT), "--accept-dispatch"]) == 0
    assert capsys.readouterr().out.startswith("PASS PR #1700")


def test_F3_cli_passes_the_diff_and_protected_list_to_decide(monkeypatch, capsys):
    fx = _fx()
    fx["changed_paths"] = fx["changed_paths"] + ["app/src/test-setup.js"]
    _stub_gather(monkeypatch, fx)
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(ROOT)]) == 1
    assert "self-protected-diff" in capsys.readouterr().out


def test_verify_cli_pass_and_bad_tree_argument(monkeypatch, capsys):
    monkeypatch.setattr(ev, "GhApi", lambda repo: FakeGh(_fx()))
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(ROOT)]) == 0
    assert capsys.readouterr().out.startswith("PASS PR #1700")
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 7, "--root", str(ROOT)]) == 1


# ---- record (the CI half) -----------------------------------------------------------------------------------------
JUNIT = """<?xml version="1.0"?><testsuites><testsuite name="pytest">
<testcase classname="tests.test_uct_agent_a" name="test_ok"/>
<testcase classname="tests.test_uct_agent_a" name="test_bad"><failure message="x"/></testcase>
<testcase classname="tests.test_uct_agent_b.TestK" name="test_err"><error message="y"/></testcase>
<testcase classname="tests.test_uct_agent_b" name="test_skip"><skipped/></testcase>
</testsuite></testsuites>"""
VITEST = {"testResults": [
    {"name": "/home/runner/work/r/r/app/src/agent/a.test.js", "status": "failed",
     "assertionResults": [{"status": "passed", "fullName": "ok"}, {"status": "failed", "fullName": "suite breaks"}]},
    {"name": "/home/runner/work/r/r/app/src/agent/b.test.js", "status": "failed", "assertionResults": []},
    {"name": "/home/runner/work/r/r/app/src/agent/c.test.js", "status": "passed", "assertionResults": [{"status": "passed", "fullName": "x"}]},
]}


def test_parsers(tmp_path):
    (tmp_path / "j.xml").write_text(JUNIT, encoding="utf-8")
    assert ev.junit_failures(str(tmp_path / "j.xml")) == ["tests.test_uct_agent_a::test_bad", "tests.test_uct_agent_b.TestK::test_err"]
    (tmp_path / "v.json").write_text(json.dumps(VITEST), encoding="utf-8")
    assert ev.vitest_failures(str(tmp_path / "v.json")) == ["app/src/agent/a.test.js > suite breaks", "app/src/agent/b.test.js"]
    log = "PASSED tests/a.py::ok\nFAILED tests/a.py::bad - AssertionError: x\nERROR tests/b.py::boom\n"
    assert ev.rA_failures(log) == ["tests/a.py::bad", "tests/b.py::boom"]


M, B, H = "d" * 40, "b" * 40, "c" * 40
PR_ENV = {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_SHA": M, "GITHUB_REF": "refs/pull/1700/merge", "GITHUB_RUN_ID": "55", "GITHUB_RUN_ATTEMPT": "1"}
PR_PAYLOAD = {"pull_request": {"number": 1700, "base": {"sha": B}, "head": {"sha": H}}}


def test_build_record_for_a_pull_request_run(tmp_path):
    (tmp_path / "j.xml").write_text(JUNIT, encoding="utf-8")
    rec = ev.build_record("server", PR_ENV, PR_PAYLOAD, M, "e" * 40, [B, H], junit=str(tmp_path / "j.xml"))
    assert rec["errors"] == [] and rec["pr"] == 1700 and rec["run_id"] == 55 and rec["event"] == "pull_request"
    assert (rec["base_sha"], rec["head_sha"], rec["tree"]) == (B, H, "e" * 40)
    assert rec["failed"]["pytest"] == ["tests.test_uct_agent_a::test_bad", "tests.test_uct_agent_b.TestK::test_err"]


DISPATCH_ENV = dict(PR_ENV, GITHUB_EVENT_NAME="repository_dispatch", GITHUB_SHA="a" * 40, GITHUB_REF="refs/heads/master")
DISPATCH_PAYLOAD = {"action": "agent-ci-evidence", "client_payload": {"pr": 1700, "merge_sha": M}}


def test_build_record_for_a_rearm_dispatch_binds_the_payload_merge_sha():
    rec = ev.build_record("server", DISPATCH_ENV, DISPATCH_PAYLOAD, M, "e" * 40, [B, H])
    assert rec["errors"] == [] and rec["pr"] == 1700 and rec["event"] == "repository_dispatch" and rec["sha"] == M
    wrong = ev.build_record("server", DISPATCH_ENV, DISPATCH_PAYLOAD, "f" * 40, "e" * 40, [B, H])   # checked out something else
    assert wrong["errors"] and "not the event's merge commit" in wrong["errors"][0] and wrong["sha"] == "f" * 40
    as_str = dict(DISPATCH_PAYLOAD, client_payload={"pr": "1700", "merge_sha": M})               # a string pr is the same PR
    assert ev.build_record("server", DISPATCH_ENV, as_str, M, "e" * 40, [B, H])["pr"] == 1700


def test_P2c_the_record_sha_is_the_checkout_never_github_sha_or_the_payload():
    """AUDIT #2: GITHUB_SHA is master's TIP on a repository_dispatch. A job that checked out the tip (a ref fallback)
    records the tip and an error; the record never copies GITHUB_SHA or the payload's merge_sha into `sha`."""
    tip = DISPATCH_ENV["GITHUB_SHA"]
    on_tip = ev.build_record("server", DISPATCH_ENV, DISPATCH_PAYLOAD, tip, "e" * 40, [B, H])
    assert on_tip["sha"] == tip and on_tip["errors"], on_tip
    env_says_m = dict(DISPATCH_ENV, GITHUB_SHA=M)               # even if GITHUB_SHA happened to name M, HEAD decides
    assert ev.build_record("server", env_says_m, DISPATCH_PAYLOAD, "f" * 40, "e" * 40, [B, H])["errors"]
    no_payload_sha = dict(DISPATCH_PAYLOAD, client_payload={"pr": 1700})
    rec = ev.build_record("server", dict(DISPATCH_ENV, GITHUB_SHA=M), no_payload_sha, M, "e" * 40, [B, H])
    assert rec["errors"], "a dispatch record must never fall back to GITHUB_SHA as the expected commit"


@pytest.mark.parametrize("payload", [
    {"action": "agent-ci-evidence", "client_payload": {"pr": "1; rm -rf /", "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": True, "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": 1700.0, "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": [1700], "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": "1700\n", "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": "01700", "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": 12345678, "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": 0, "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": None, "merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"merge_sha": M}},
    {"action": "agent-ci-evidence", "client_payload": {"pr": 1700, "merge_sha": [M]}},
    {"action": "agent-ci-evidence", "client_payload": "pr=1700"},
    {"action": "agent-ci-evidence"},
    {"action": "other-type", "client_payload": {"pr": 1700, "merge_sha": M}},
    {"client_payload": {"pr": 1700, "merge_sha": M}},
    {"inputs": {"pr": "1700", "merge_sha": M}},                       # a workflow_dispatch-shaped event
])
def test_P2c_build_record_refuses_a_hostile_or_foreign_payload(payload):
    rec = ev.build_record("server", DISPATCH_ENV, payload, M, "e" * 40, [B, H])
    assert rec["errors"], payload


@pytest.mark.parametrize("pr", [1, 42, 1701, 9999999, "42"])
def test_P2c_the_record_pr_is_client_payload_pr_and_nothing_else(pr):
    """AUDIT #5: the PR a re-arm record names comes from client_payload.pr alone (verify then matches it, and the
    artifact name, to the PR being verified); no other field of the event can supply or override it."""
    event = {"action": "agent-ci-evidence", "number": 1700, "pull_request": {"number": 1700},
             "client_payload": {"pr": pr, "merge_sha": M, "number": 1700, "pull_request": 1700}}
    rec = ev.build_record("server", DISPATCH_ENV, event, M, "e" * 40, [B, H])
    assert rec["errors"] == [] and rec["pr"] == int(pr)


def test_P2c_a_workflow_dispatch_record_is_not_a_rearm_record():
    env = dict(DISPATCH_ENV, GITHUB_EVENT_NAME="workflow_dispatch")
    rec = ev.build_record("server", env, {"inputs": {"pr": "1700", "merge_sha": M}}, M, "e" * 40, [B, H])
    assert rec["pr"] is None and rec["errors"]


def test_build_record_marks_an_unreadable_report_and_a_non_merge(tmp_path):
    rec = ev.build_record("browser-1", PR_ENV, PR_PAYLOAD, M, "e" * 40, [B], vitest=[str(tmp_path / "missing.json")])
    assert rec["reports_unreadable"] == [str(tmp_path / "missing.json")]
    assert rec["base_sha"] is None and rec["head_sha"] is None   # verify() refuses it as wrong-parents


def test_record_cli_on_a_real_merge_commit(tmp_path, monkeypatch):
    """`record` end to end on a throwaway repo: HEAD is a two-parent merge; parents come from the commit object."""
    def git(*a):
        return subprocess.run(["git", "-C", str(tmp_path), *a], check=True, capture_output=True, text=True).stdout.strip()
    git("init", "-q", "-b", "m")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "base")
    git("checkout", "-q", "-b", "h")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "head")
    head = git("rev-parse", "HEAD")
    git("checkout", "-q", "m")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "base2")
    base = git("rev-parse", "HEAD")
    git("-c", "user.email=a@b", "-c", "user.name=a", "merge", "-q", "--no-ff", "-m", "merge", "h")
    merge = git("rev-parse", "HEAD")
    payload = tmp_path / "event.json"
    payload.write_text(json.dumps({"pull_request": {"number": 3, "base": {"sha": base}, "head": {"sha": head}}}), encoding="utf-8")
    for k, v in dict(PR_ENV, GITHUB_SHA=merge, GITHUB_EVENT_PATH=str(payload)).items():
        monkeypatch.setenv(k, v)
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "ev" / "evidence.json"
    assert ev.main(["record", "--job-key", "union", "--out", str(out)]) == 0
    rec = json.loads(out.read_text(encoding="utf-8"))
    assert rec["parents"] == [base, head] and rec["sha"] == merge and rec["tree"] == git("rev-parse", "HEAD^{tree}")




# ---- P2b: a re-arm run on the tool's OWN merge commit (refs/agent-ci-evidence/pr-<N>) ----------------------------
def test_P2b_a_rearm_run_on_the_tools_merge_commit_passes():
    verdict, reason, evidence = _decide(_dispatch_fx(), accept=BOTH, ref_sha=M)
    assert verdict == "PASS", reason
    assert (evidence["base_sha"], evidence["head_sha"], evidence["tree"], evidence["event"]) == (B, H, "e" * 40, "repository_dispatch")


P2B_CASES = {
    # AUDIT #2: a forged commit with the RIGHT parents but the wrong tree never passes (content, not ref name / author)
    "forged-right-parents-wrong-tree": (lambda f: f.update(expected_tree="a" * 40), "tree-mismatch"),
    "stale-base": (lambda f: f.update(base_tip="a" * 40), "stale-base"),
    "moved-head": (lambda f: f["pr"].update(head_sha="a" * 40), "stale-head"),
    "one-parent": (lambda f: [r.update(parents=[B]) for r in _recs(f).values()], "wrong-parents"),
    "three-parents": (lambda f: [r.update(parents=[B, H, "a" * 40]) for r in _recs(f).values()], "wrong-parents"),
    "no-parents": (lambda f: [r.update(parents=None) for r in _recs(f).values()], "wrong-parents"),
    "swapped-parents": (lambda f: [r.update(parents=[H, B]) for r in _recs(f).values()], "stale-base"),
    # unsanctioned ref / branch: only master's agent-ci.yml, dispatched (records from refs/heads/master), counts
    "dispatch-from-evidence-ref": (lambda f: _run(f).update(head_branch="agent-ci-evidence/pr-1700"), "dispatch-ref"),
    "dispatch-from-pr-branch": (lambda f: _run(f).update(head_branch="agent/pl/x"), "dispatch-ref"),
    "record-ran-from-evidence-ref": (lambda f: _recs(f)["union"].update(ref="refs/agent-ci-evidence/pr-1700"), "dispatch-ref"),
    "record-ran-from-a-branch": (lambda f: _recs(f)["server"].update(ref="refs/heads/agent/pl/x"), "dispatch-ref"),
    "push-run-on-the-evidence-ref": (lambda f: _run(f).update(event="push", head_branch="agent-ci-evidence/pr-1700"), "no-run"),
    # P2c (AUDIT #5): the workflow commit must be on master's history NOW
    "workflow-commit-not-on-master": (lambda f: _run(f).update(head_on_master=False), "dispatch-ref"),
    "workflow-commit-unknown": (lambda f: _run(f).pop("head_on_master"), "dispatch-ref"),
    "workflow-commit-truthy-not-true": (lambda f: _run(f).update(head_on_master="yes"), "dispatch-ref"),
    "wrong-workflow-path": (lambda f: _run(f).update(path=".github/workflows/agent-ci-benchmark.yml"), "dispatch-ref"),
    "workflow-from-another-ref": (lambda f: _run(f).update(path=".github/workflows/agent-ci.yml@refs/heads/agent/pl/x"), "dispatch-ref"),
    # the records name master's tip (GITHUB_SHA), not the tool's commit: the evidence ref (M) refuses it
    "records-echo-masters-tip": (lambda f: [r.update(sha=WF_SHA) for r in _recs(f).values()], "evidence-ref"),
    "one-record-on-masters-tip": (lambda f: _recs(f)["browser-4"].update(sha=WF_SHA), "record-mismatch"),
    "record-from-workflow-dispatch": (lambda f: _recs(f)["server"].update(event="workflow_dispatch"), "non-pr-event"),
    "record-for-another-pr": (lambda f: _recs(f)["union"].update(pr=1701), "record-mismatch"),
    "record-without-pr": (lambda f: _recs(f)["union"].update(pr=None), "record-mismatch"),
}


@pytest.mark.parametrize("case", sorted(P2B_CASES))
def test_P2b_every_rearm_fail_path(case):
    mutate, code = P2B_CASES[case]
    fx = _dispatch_fx()
    mutate(fx)
    verdict, reason, evidence = _decide(fx, accept=BOTH, ref_sha=M)
    assert verdict == "FAIL" and evidence == {} and _code((verdict, reason, None)) == code, (case, reason)


@pytest.mark.parametrize("ref_sha", [None, "", "a" * 40, M[:39], M.upper(), "refs/heads/master"])
def test_P2b_a_rearm_commit_counts_only_while_the_tools_ref_points_at_it(ref_sha):
    assert _code(_decide(_dispatch_fx(), accept=BOTH, ref_sha=ref_sha)) == "evidence-ref"


def test_P2b_the_evidence_ref_guard_does_not_touch_pull_request_runs():
    assert _code(_decide(_fx(), accept=BOTH, ref_sha=None)) == "PASS"


def test_P2b_gather_reads_the_tools_ref_only_with_accept_dispatch():
    fx = _dispatch_fx()
    disp = dict(copy.deepcopy(_run(fx)), id=_run(fx)["id"], created_at="2026-11-17T12:00:00Z")
    disp.pop("head_on_master")                                                # gather() must compute it, never trust it
    fx["runs"][0] = dict(_run(fx), event="pull_request", head_branch="agent/pl/x", path=None)   # the PR run (older)
    for r in _recs(fx).values():
        r["event"], r["ref"] = "repository_dispatch", "refs/heads/master"   # records belong to the newer dispatch run
    api = FakeGh(fx, dispatch_runs=[disp])
    api.ref_sha = {ev.evidence_ref(1700): M}
    assert _code(_gather_decide(api, accept_dispatch=True)) == "PASS"
    assert "ls-remote refs/agent-ci-evidence/pr-1700" in api.calls
    api.ref_sha = {ev.evidence_ref(1700): "a" * 40}                      # a later re-arm overwrote it
    assert _code(_gather_decide(api, accept_dispatch=True)) == "evidence-ref"
    api.ref_sha = {}                                                     # deleted
    assert _code(_gather_decide(api, accept_dispatch=True)) == "evidence-ref"
    plain = FakeGh(_fx())
    _gather_decide(plain)
    assert not any(c.startswith("ls-remote") for c in plain.calls)


@pytest.mark.parametrize("compare", [{"status": "diverged", "merge_base_commit": {"sha": "9" * 40}},
                                     {"status": "behind", "merge_base_commit": {"sha": B}},
                                     # inconsistent answers: BOTH the status and the merge base must say "ancestor"
                                     {"status": "behind", "merge_base_commit": {"sha": WF_SHA}},
                                     {"status": "diverged", "merge_base_commit": {"sha": WF_SHA}},
                                     {"merge_base_commit": {"sha": WF_SHA}},
                                     {"status": "ahead", "merge_base_commit": {"sha": "9" * 40}},
                                     {"status": "ahead"}, {}, None])
def test_P2c_gather_refuses_a_dispatch_run_whose_workflow_commit_is_not_on_master(compare):
    """AUDIT #5: the dispatch run's head_sha (the workflow commit that ran) must be an ancestor of master's tip NOW,
    read by gather() through a read-only compare, never taken from the run listing."""
    fx = _dispatch_fx()
    disp = dict(copy.deepcopy(_run(fx)), created_at="2026-11-17T12:00:00Z")
    disp.pop("head_on_master")
    fx["runs"][0] = dict(_run(fx), event="pull_request", head_branch="agent/pl/x", path=None)
    api = FakeGh(fx, dispatch_runs=[disp])
    api.ref_sha = {ev.evidence_ref(1700): M}
    api.compare = compare if compare is not None else {"status": "identical", "merge_base_commit": {"sha": WF_SHA}}
    want = "PASS" if compare is None else "dispatch-ref"
    assert _code(_gather_decide(api, accept_dispatch=True)) == want, compare
    assert f"compare/{WF_SHA}...{B}?per_page=1" in api.calls
    for bad_head in (None, "", "short", WF_SHA.upper()):
        api2 = FakeGh(fx, dispatch_runs=[dict(disp, head_sha=bad_head)])
        api2.ref_sha = {ev.evidence_ref(1700): M}
        assert _code(_gather_decide(api2, accept_dispatch=True)) == "dispatch-ref", bad_head
        assert not any(c.startswith("compare/") for c in api2.calls)


def test_P2b_self_protection_is_still_the_prs_diff_vs_its_merge_base(monkeypatch):
    """AUDIT #5: building our own merge commit never narrows self-protection. The changed-path list is pulls/N/files
    (the PR vs its merge base with master), whatever the evidence commit's own diff is, and a protected path there
    FAILs even when the re-arm evidence is otherwise perfect."""
    fx = _dispatch_fx()
    fx["changed_paths"] = fx["changed_paths"] + ["tools/agent_ci_rearm.py"]
    api = FakeGh(fx, dispatch_runs=[dict(copy.deepcopy(_run(fx)), created_at="2026-11-17T12:00:00Z")])
    api.ref_sha = M
    seen = []
    real = acr.pr_changed_paths
    monkeypatch.setattr(acr, "pr_changed_paths", lambda a, n: seen.append(n) or real(a, n))
    assert _code(_gather_decide(api, accept_dispatch=True)) == "self-protected-diff"
    assert seen == [1700] and any(c.startswith("pulls/1700/files") for c in api.calls)
    assert not any(M in c or "/commits/" in c for c in api.calls), "the diff must not come from the evidence commit"
    # the one compare call is the dispatch run's WORKFLOW commit vs master's tip (ancestry, AUDIT #5), never a diff
    assert not [c for c in api.calls if "compare/" in c and c != f"compare/{WF_SHA}...{B}?per_page=1"]
    # and decide() takes the list as given: an empty evidence-commit diff cannot launder a protected PR diff
    assert _code(_decide(fx, accept=BOTH, ref_sha=M)) == "self-protected-diff"


# ---- rail: NOTHING fires on, or watches, refs/agent-ci-evidence/** (derived from .github/workflows/*.yml) -------------
WF_DIR = ROOT / ".github" / "workflows"
REF_TRIGGERS = ("push", "create", "delete", "pull_request", "pull_request_target")


def _on(doc):
    on = doc.get(True, doc.get("on"))
    if isinstance(on, str):
        return {on: None}
    if isinstance(on, list):
        return {k: None for k in on}
    return on or {}


def _fires(trigger: str, cfg, full_ref: str) -> bool:
    """GitHub semantics: push / create / delete fire only for refs/heads/** and refs/tags/**; a pull_request's head is
    always a branch. Branch / tag filters are GitHub globs (`*` stops at `/`, `**` crosses it)."""
    cfg = cfg if isinstance(cfg, dict) else {}
    if full_ref.startswith("refs/heads/"):
        name, inc, exc, other = full_ref[len("refs/heads/"):], "branches", "branches-ignore", ("tags", "tags-ignore")
    elif full_ref.startswith("refs/tags/") and trigger in ("push", "create", "delete"):
        name, inc, exc, other = full_ref[len("refs/tags/"):], "tags", "tags-ignore", ("branches", "branches-ignore")
    else:
        return False
    if trigger in ("create", "delete"):
        return True
    if trigger in ("pull_request", "pull_request_target"):
        return inc == "branches"   # the evidence ref can never be a PR head; a branch of that name could (base filters aside)
    if inc in cfg:
        return acr.matches(name, list(cfg[inc]))
    if exc in cfg:
        return not acr.matches(name, list(cfg[exc]))
    return not any(k in cfg for k in other)   # only the other kind is filtered: this kind never fires


def _workflows():
    import yaml
    out = {}
    for f in sorted([*WF_DIR.glob("*.yml"), *WF_DIR.glob("*.yaml")]):
        out[f.name] = yaml.safe_load(f.read_text(encoding="utf-8"))
    assert len(out) > 20, "found too few workflows: the rail is not reading .github/workflows"
    return out


def _firing(full_ref):
    return sorted((name, t) for name, doc in _workflows().items() for t, cfg in _on(doc).items()
                  if t in REF_TRIGGERS and _fires(t, cfg, full_ref))


def test_P2b_rail_no_workflow_trigger_fires_on_the_evidence_ref():
    assert rearm.EVIDENCE_NS == ev.EVIDENCE_NS == "refs/agent-ci-evidence/"
    for n in (1, 1700, 99999):
        assert rearm.evidence_ref(n) == ev.evidence_ref(n)
        assert _firing(rearm.evidence_ref(n)) == [], rearm.evidence_ref(n)


def test_P2b_rail_the_matcher_is_live_and_a_branch_name_would_have_fired():
    """Why the evidence ref is NOT a branch: several workflows push-trigger on every branch (derived, not typed)."""
    assert ("agent-ci.yml", "push") in _firing("refs/heads/agent/pl/x")
    assert ("master-deploy-gate.yml", "push") in _firing("refs/heads/master")
    assert ("agent-ci.yml", "push") not in _firing("refs/heads/agent-ci-evidence/pr-1700")   # agent/** would not match...
    assert _firing("refs/heads/agent-ci-evidence/pr-1700"), "...but unfiltered push triggers would"


def test_P2b_rail_nothing_else_watches_the_evidence_namespace():
    """Only agent-ci.yml may NAME refs/agent-ci-evidence (comments / input description), and no workflow reads it."""
    for name in _workflows():
        text = (WF_DIR / name).read_text(encoding="utf-8")
        if name == "agent-ci.yml":
            hits = [ln for ln in text.splitlines() if "agent-ci-evidence/" in ln]
            assert hits and all(ln.lstrip().startswith(("#", "description:")) for ln in hits), hits
        else:
            assert "agent-ci-evidence/" not in text, f"{name} watches the tool-owned evidence ref namespace"
    writers = sorted(p.name for p in (ROOT / "tools").glob("*.py") if "agent-ci-evidence/" in p.read_text(encoding="utf-8", errors="replace"))
    assert writers == ["agent_ci_evidence.py", "agent_ci_rearm.py"], writers


# ---- the re-arm tool (P2b): builds the merge itself, pushes ONLY its own ref, dispatches once -------------------------
REPO = "o/r"


def _git(repo, *a, env=None):
    return subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True, env=env).stdout.strip()


def _commit(repo, msg, **files):
    for name, body in files.items():
        (repo / name).write_text(body, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", msg)
    return _git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A throwaway repo: base -> master tip (edits a.txt), base -> PR head (edits b.txt), plus a conflicting head."""
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q", "-b", "master")
    _commit(r, "base", **{"a.txt": "a\n", "b.txt": "b\n"})
    _git(r, "checkout", "-q", "-b", "agent/pl/x")
    head = _commit(r, "head", **{"b.txt": "b2\n"})
    _git(r, "checkout", "-q", "-b", "agent/pl/conflict", "master")
    clash = _commit(r, "clash", **{"a.txt": "zz\n"})
    _git(r, "checkout", "-q", "master")
    tip = _commit(r, "tip", **{"a.txt": "a2\n"})
    monkeypatch.chdir(r)
    return types.SimpleNamespace(path=r, tip=tip, head=head, clash=clash)


def _pr_json(head_sha, **over):
    pr = {"number": 1700, "state": "open", "merged": False,
          "head": {"sha": head_sha, "ref": "agent/pl/x", "repo": {"full_name": REPO}}, "base": {"ref": "master", "repo": {"full_name": REPO}}}
    pr.update(over)
    return pr


def _rearm(repo, argv=(), pr=None, tip=None, push_rc=0, dispatch_rc=0, fetch_rc=0, merge_tree_rc=None):
    """Run rearm.main with GitHub faked: GETs answer from `pr` / `tip`; fetch / push / gh are recorded, never executed;
    every other git command runs for real in the throwaway repo."""
    log = []
    pr = pr if pr is not None else _pr_json(repo.head)

    def get(path):
        log.append(("GET", path))
        if path == f"repos/{REPO}/pulls/1700":
            return pr
        if path == f"repos/{REPO}/git/ref/heads/master":
            return {"object": {"sha": tip or repo.tip}}
        raise AssertionError(path)

    def run(argv_, **kw):
        log.append(list(argv_))
        rc = {"fetch": fetch_rc, "push": push_rc}.get(argv_[1]) if argv_[0] == "git" else dispatch_rc
        if argv_[0] == "gh" or argv_[1] in ("fetch", "push"):
            return types.SimpleNamespace(returncode=rc, stdout="", stderr="boom" if rc else "")
        assert argv_[0] == "git" and argv_[1] in ("rev-parse", "merge-tree", "commit-tree", "cat-file"), argv_
        if argv_[1] == "merge-tree" and merge_tree_rc is not None:   # git itself failed (not a conflict)
            return types.SimpleNamespace(returncode=merge_tree_rc, stdout="", stderr="fatal: boom")
        return subprocess.run(argv_, capture_output=True, text=True, env=kw.get("env"))

    rc = rearm.main(["--pr", "1700", "--repo", REPO, *argv], get=get, run=run)
    pushes = [c for c in log if isinstance(c, list) and c[:2] == ["git", "push"]]
    gh = [c for c in log if isinstance(c, list) and c[0] == "gh"]
    return rc, pushes, gh, log


def test_P2b_rearm_builds_the_merge_pushes_its_own_ref_and_dispatches_once(repo, capsys):
    rc, pushes, gh, log = _rearm(repo)
    assert rc == 0, capsys.readouterr().out
    assert len(pushes) == 1 and len(gh) == 1
    c = pushes[0][-1].split(":")[0].lstrip("+")
    assert pushes[0] == ["git", "push", "--quiet", f"https://github.com/{REPO}.git", f"+{c}:refs/agent-ci-evidence/pr-1700"]
    assert gh[0] == ["gh", "api", "-X", "POST", f"repos/{REPO}/dispatches", "-f", "event_type=agent-ci-evidence",
                     "-F", "client_payload[pr]=1700", "-f", f"client_payload[merge_sha]={c}"]
    assert log.index(pushes[0]) < log.index(gh[0]), "dispatch before the commit is reachable"
    assert ["git", "fetch", "--no-tags", "--quiet", f"https://github.com/{REPO}.git", repo.tip, repo.head] in log
    assert ev.commit_parents  # the CI-side parent reader agrees with the tool:
    body = _git(repo.path, "cat-file", "-p", c)
    assert [ln.split()[1] for ln in body.splitlines() if ln.startswith("parent ")] == [repo.tip, repo.head]
    tree = _git(repo.path, "rev-parse", f"{c}^{{tree}}")
    assert tree == _git(repo.path, "merge-tree", "--write-tree", repo.tip, repo.head)
    assert _git(repo.path, "show", f"{c}:a.txt") == "a2" and _git(repo.path, "show", f"{c}:b.txt") == "b2"
    assert f"--tree {tree} --accept-dispatch" in capsys.readouterr().out
    # deterministic: the same (tip, head) yields the same evidence commit
    assert _rearm(repo)[1] == pushes


def test_P2b_rearm_refuses_a_merge_conflict_and_pushes_nothing(repo, capsys):
    rc, pushes, gh, log = _rearm(repo, pr=_pr_json(repo.clash))
    assert rc == rearm.REFUSED and pushes == [] and gh == []
    assert "merge conflict" in capsys.readouterr().out
    assert not any(isinstance(c, list) and c[1] == "commit-tree" for c in log)


def test_P2b_rearm_refuses_when_the_merge_is_not_a_two_parent_commit(repo, capsys):
    """PR head == master tip: commit-tree drops the duplicate parent; the re-read catches it."""
    rc, pushes, gh, _ = _rearm(repo, pr=_pr_json(repo.tip))
    assert rc == rearm.REFUSED and pushes == [] and gh == []
    assert "parents" in capsys.readouterr().out


def test_P2b_rearm_refuses_when_the_commits_cannot_be_fetched(repo, capsys):
    rc, pushes, gh, _ = _rearm(repo, fetch_rc=128)
    assert rc == rearm.REFUSED and pushes == [] and gh == []
    assert "cannot fetch" in capsys.readouterr().out
    rc, pushes, gh, log = _rearm(repo, tip="f" * 40)   # a tip the fetch did not bring
    assert rc == rearm.REFUSED and pushes == [] and gh == []
    assert "is not a local commit" in capsys.readouterr().out
    assert not any(isinstance(c, list) and c[1] == "merge-tree" for c in log)


def test_P2b_rearm_refuses_when_merge_tree_itself_fails(repo, capsys):
    rc, pushes, gh, log = _rearm(repo, merge_tree_rc=128)
    assert rc == rearm.REFUSED and pushes == [] and gh == []
    assert "merge-tree failed" in capsys.readouterr().out
    assert not any(isinstance(c, list) and c[1] == "commit-tree" for c in log)


@pytest.mark.parametrize("over", [{"state": "closed"}, {"merged": True}, {"base": {"ref": "agent/int"}},
                                  {"head": {"sha": "c" * 40, "ref": "charts/x", "repo": {"full_name": REPO}}},
                                  {"head": {"sha": "c" * 40, "ref": "agent/x", "repo": {"full_name": "fork/r"}}},
                                  {"head": {"sha": "short", "ref": "agent/x", "repo": {"full_name": REPO}}}])
def test_P2b_rearm_refuses_before_any_git_command(repo, over):
    rc, pushes, gh, log = _rearm(repo, pr=_pr_json(repo.head, **over))
    assert rc == rearm.REFUSED and not any(isinstance(c, list) for c in log)


def test_P2b_rearm_ignores_githubs_stale_test_merge(repo):
    """The P2 liveness gap: GitHub's merge_commit_sha / mergeable are stale or null. P2b never reads them."""
    rc, pushes, _, log = _rearm(repo, pr=_pr_json(repo.head, mergeable=None, merge_commit_sha="a" * 40))
    assert rc == 0 and len(pushes) == 1 and not any("/commits/" in str(c) for c in log)


def test_P2b_rearm_dry_run_builds_but_pushes_and_dispatches_nothing(repo, capsys):
    rc, pushes, gh, _ = _rearm(repo, ["--dry-run"])
    assert rc == 0 and pushes == [] and gh == []
    assert "DRY-RUN would run: git push" in capsys.readouterr().out


def test_P2b_a_failed_push_dispatches_nothing_and_a_failed_dispatch_is_not_retried(repo):
    rc, pushes, gh, _ = _rearm(repo, push_rc=1)
    assert rc == rearm.FAILED and len(pushes) == 1 and gh == []
    rc, pushes, gh, _ = _rearm(repo, dispatch_rc=1)
    assert rc == rearm.FAILED and len(pushes) == 1 and len(gh) == 1


# AUDIT #4: the push target is hard-coded; it can never be master, production, agent/*, refs/pull/*, handoff/* ...
FORBIDDEN_REFSPECS = [
    "+{c}:refs/heads/master", "+{c}:master", "+{c}:refs/heads/production", "+{c}:production",
    "+{c}:refs/heads/agent/pl/x", "+{c}:agent/pl/x", "+{c}:refs/pull/1700/merge", "+{c}:refs/pull/1700/head",
    "+{c}:refs/heads/handoff/x", "+{c}:handoff/x", "+{c}:refs/tags/v1",
    "+{c}:refs/agent-ci-evidence/pr-1701",            # another PR's evidence ref
    "+{c}:refs/agent-ci-evidence/pr-1700/x", "+{c}:refs/agent-ci-evidence/pr-01700", "+{c}:refs/agent-ci-evidence/master",
    "+{c}:refs/heads/agent-ci-evidence/pr-1700",      # a BRANCH of that name (push triggers would fire)
    "+{o}:refs/agent-ci-evidence/pr-1700",            # some other commit
    ":refs/agent-ci-evidence/pr-1700",                # a delete
    "+HEAD:refs/agent-ci-evidence/pr-1700", "{c}:refs/agent-ci-evidence/pr-1700 ",
]


@pytest.mark.parametrize("spec", FORBIDDEN_REFSPECS)
def test_P2b_the_push_guard_refuses_every_other_target(spec):
    c, o = "1" * 40, "2" * 40
    argv = ["git", "push", "--quiet", f"https://github.com/{REPO}.git", spec.format(c=c, o=o)]
    with pytest.raises(rearm.Refused):
        rearm.assert_push_is_own_ref(argv, 1700, c)


@pytest.mark.parametrize("argv", [
    ["git", "push", "--quiet", "--mirror", "u", "+{c}:refs/agent-ci-evidence/pr-1700"],
    ["git", "push", "--quiet", "--all", "u"],
    ["git", "push", "--quiet", "--tags", "u", "+{c}:refs/agent-ci-evidence/pr-1700"],
    ["git", "push", "--quiet", "--delete", "u", "refs/agent-ci-evidence/pr-1700"],
    ["git", "push", "--quiet", "--prune", "u", "+{c}:refs/agent-ci-evidence/pr-1700"],
    ["git", "push", "--quiet", "u", "+{c}:refs/agent-ci-evidence/pr-1700", "+{c}:refs/heads/master"],
    ["git", "push", "u", "+{c}:refs/agent-ci-evidence/pr-1700"],
    ["git", "fetch", "--quiet", "u", "+{c}:refs/agent-ci-evidence/pr-1700"],
])
def test_P2b_the_push_guard_refuses_widening_options_and_extra_refspecs(argv):
    c = "1" * 40
    with pytest.raises(rearm.Refused):
        rearm.assert_push_is_own_ref([a.format(c=c) for a in argv], 1700, c)


def test_P2b_the_push_target_comes_only_from_the_integer_pr_number():
    c = "1" * 40
    argv = rearm.push_argv(REPO, 1700, c)
    rearm.assert_push_is_own_ref(argv, 1700, c)   # the tool's own argv passes its own guard
    assert argv[-1] == f"+{c}:refs/agent-ci-evidence/pr-1700"
    for bad in ("1700", "1700:refs/heads/master", 0, -1, True, 1700.0, None):
        with pytest.raises(rearm.Refused):
            rearm.evidence_ref(bad)
    for opt in ("--ref", "--refspec", "--remote", "--evidence-ref", "--branch", "--force"):
        with pytest.raises(SystemExit):
            rearm.main(["--pr", "1700", "--repo", REPO, opt, "refs/heads/master"], get=lambda p: pytest.fail("read"),
                       run=lambda a, **k: pytest.fail("ran"))


def test_P2b_rearm_refuses_a_push_argv_aimed_elsewhere(repo, monkeypatch):
    """Whatever produced the argv (a future edit), the guard runs before anything is pushed."""
    monkeypatch.setattr(rearm, "push_argv", lambda repo_, n, c: ["git", "push", "--quiet", "u", f"+{c}:refs/heads/master"])
    rc, pushes, gh, _ = _rearm(repo)
    assert rc == rearm.REFUSED and pushes == [] and gh == []


def test_F2_rearm_has_no_ref_option_and_the_dispatch_names_no_ref_or_workflow(repo):
    """repository_dispatch ALWAYS runs the default branch's agent-ci.yml: there is no ref to pass, and none is passed."""
    for argv in (["--ref", "agent/pl/x"], ["--ref", "master"], ["--ref=agent/pl/x"]):
        with pytest.raises(SystemExit):
            rearm.main(["--pr", "1700", "--repo", REPO, *argv], get=lambda p: None, run=lambda a, **k: pytest.fail("ran"))
    argv = rearm.dispatch_argv(REPO, 1700, M)
    assert "--ref" not in argv and "workflow" not in argv and not any(a.startswith(("ref=", "-R")) for a in argv)
    rearm.assert_dispatch_is_own(argv, REPO, 1700, M)


# ---- P2c: the ONE repository_dispatch -----------------------------------------------------------------------------
P2C_EXPECTED_BODY = {"event_type": "agent-ci-evidence", "client_payload": {"pr": 1700, "merge_sha": M}}


def _gh_body(argv):
    """gh api's documented field encoding (gh 2.102.0 `gh api --help`): -f/--raw-field = a string; -F/--field = typed
    (true / false / null / integers become JSON values; `@file` reads a file, never produced here); `key[sub]=v` nests.
    Captured 2026-11-18 against a local 127.0.0.1 listener (GH_CONFIG_DIR empty, dummy GH_TOKEN; nothing reached GitHub):
    gh 2.102.0 sent exactly {"client_payload":{"merge_sha":"<C>","pr":1700},"event_type":"agent-ci-evidence"}."""
    body, rest = {}, argv[5:]
    assert len(rest) % 2 == 0, argv
    for flag, kv in zip(rest[::2], rest[1::2]):
        assert flag in ("-f", "-F"), argv
        key, val = kv.split("=", 1)
        if flag == "-F":
            assert not val.startswith("@")
            if val in ("true", "false", "null"):
                val = {"true": True, "false": False, "null": None}[val]
            elif re.fullmatch(r"-?[0-9]+", val):
                val = int(val)
        m = re.fullmatch(r"(\w+)\[(\w+)\]", key)
        if m:
            body.setdefault(m.group(1), {})[m.group(2)] = val
        else:
            body[key] = val
    return body


def test_P2c_the_dispatch_body_is_one_json_object_with_an_integer_pr():
    argv = rearm.dispatch_argv(REPO, 1700, M)
    assert argv[:5] == ["gh", "api", "-X", "POST", f"repos/{REPO}/dispatches"]
    body = _gh_body(argv)
    assert body == P2C_EXPECTED_BODY and type(body["client_payload"]["pr"]) is int
    # the record (and the workflow's validate step, tests/test_ci_agent_merge_ref.py) accept exactly this payload
    event = {"action": body["event_type"], "client_payload": body["client_payload"]}
    rec = ev.build_record("server", DISPATCH_ENV, event, M, "e" * 40, [B, H])
    assert rec["errors"] == [] and rec["pr"] == 1700


BAD_DISPATCH_ARGVS = {
    "gh-workflow-run": lambda r, n, c: ["gh", "workflow", "run", "agent-ci.yml", "-R", r, "--ref", "master", "-f", f"pr={n}", "-f", f"merge_sha={c}"],
    "other-event-type": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence-2", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "pr-as-raw-string": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-f", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "sha-typed": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-F", f"client_payload[merge_sha]={c}"],
    "other-commit": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={'f' * 40}"],
    "other-pr": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n + 1}", "-f", f"client_payload[merge_sha]={c}"],
    "extra-field": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}", "-f", "client_payload[ref]=x"],
    "input-file": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "--input", "-"],
    "header": lambda r, n, c: ["gh", "api", "-X", "POST", "-H", "X: y", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "other-endpoint": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/actions/workflows/agent-ci.yml/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "other-repo": lambda r, n, c: ["gh", "api", "-X", "POST", "repos/x/y/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "get-not-post": lambda r, n, c: ["gh", "api", "-X", "GET", f"repos/{r}/dispatches", "-f", "event_type=agent-ci-evidence", "-F", f"client_payload[pr]={n}", "-f", f"client_payload[merge_sha]={c}"],
    "reordered": lambda r, n, c: ["gh", "api", "-X", "POST", f"repos/{r}/dispatches", "-F", f"client_payload[pr]={n}", "-f", "event_type=agent-ci-evidence", "-f", f"client_payload[merge_sha]={c}"],
    "twice": lambda r, n, c: rearm.dispatch_argv(r, n, c) + rearm.dispatch_argv(r, n, c)[1:],
    "a-tuple": lambda r, n, c: tuple(rearm.dispatch_argv(r, n, c)) + ("--silent",),
}


@pytest.mark.parametrize("case", sorted(BAD_DISPATCH_ARGVS))
def test_P2c_the_dispatch_guard_refuses_every_other_shape(case):
    with pytest.raises(rearm.Refused):
        rearm.assert_dispatch_is_own(BAD_DISPATCH_ARGVS[case](REPO, 1700, M), REPO, 1700, M)


@pytest.mark.parametrize("case", ["gh-workflow-run", "other-event-type", "other-commit", "extra-field", "input-file"])
def test_P2c_rearm_refuses_a_dispatch_argv_aimed_elsewhere(repo, monkeypatch, case):
    """Whatever produced the argv (a future edit), the guard runs before anything is pushed or dispatched."""
    monkeypatch.setattr(rearm, "dispatch_argv", lambda r, n, c: list(BAD_DISPATCH_ARGVS[case](r, n, c)))
    rc, pushes, gh, _ = _rearm(repo)
    assert rc == rearm.REFUSED and pushes == [] and gh == []


def test_P2c_the_dispatch_guard_refuses_bad_numbers_commits_and_repos():
    for n in ("1700", True, 0, -1, 12345678, 1700.0, None):
        with pytest.raises(rearm.Refused):
            rearm.assert_dispatch_is_own(["gh"], REPO, n, M)
        with pytest.raises(rearm.Refused):   # even the tool's own argv shape for that number
            rearm.assert_dispatch_is_own(rearm.dispatch_argv(REPO, n, M), REPO, n, M)
    for c in (M.upper(), M[:39], "HEAD", "", None):
        with pytest.raises(rearm.Refused):
            rearm.assert_dispatch_is_own(rearm.dispatch_argv(REPO, 1700, M), REPO, 1700, c)
    for r in ("o/r/../x", "o", "o/r x", "https://github.com/o/r", "o/r/dispatches?x=1", ""):
        with pytest.raises(rearm.Refused):
            rearm.assert_dispatch_is_own(rearm.dispatch_argv(r, 1700, M), r, 1700, M)


def test_P2c_rearm_takes_no_payload_from_argv():
    """AUDIT #7: pr is the one --pr integer; merge_sha is ONLY the commit this run built. Nothing else is accepted."""
    for opt in ("--merge-sha", "--merge_sha", "--sha", "--commit", "--payload", "--client-payload", "--event-type",
                "--event_type", "--input", "--field", "-F", "-f", "--tree", "--workflow"):
        with pytest.raises(SystemExit):
            rearm.main(["--pr", "1700", "--repo", REPO, opt, "x"], get=lambda p: pytest.fail("read"),
                       run=lambda a, **k: pytest.fail("ran"))


def test_P2c_rearm_dispatches_exactly_the_commit_it_built_and_pushed(repo):
    rc, pushes, gh, log = _rearm(repo)
    assert rc == 0 and len(gh) == 1
    c = pushes[0][-1].split(":")[0].lstrip("+")
    assert _gh_body(gh[0]) == {"event_type": "agent-ci-evidence", "client_payload": {"pr": 1700, "merge_sha": c}}
    assert _git(repo.path, "rev-parse", f"{c}^1") == repo.tip and _git(repo.path, "rev-parse", f"{c}^2") == repo.head
    assert [a for a in log if isinstance(a, list) and a[0] == "gh"] == gh   # the ONLY gh process the tool started


def test_P2c_rearm_refuses_a_pr_beyond_the_workflows_bound():
    for pr in ("12345678", "0", "-3"):
        calls = []
        assert rearm.main(["--pr", pr, "--repo", REPO], get=lambda p: calls.append(p), run=lambda a, **k: calls.append(a)) == rearm.REFUSED
        assert calls == [], pr
    assert rearm.PR_RE.pattern == ev.PR_RE.pattern == r"[1-9][0-9]{0,6}\Z"


def _rearm_ast():
    import ast
    return ast.parse((ROOT / "tools" / "agent_ci_rearm.py").read_text(encoding="utf-8"))


def test_P2c_rail_the_rearm_tool_has_only_these_gh_calls_and_runs_each_side_effect_once():
    """AUDIT #7: the only gh argv shapes in the tool are the read-only GET and the ONE dispatch POST (+ its guard's
    expected copy); main() starts the push and the dispatch with exactly one `run(...)` each, outside any loop."""
    import ast
    tree = _rearm_ast()
    gh_lists = [n for n in ast.walk(tree) if isinstance(n, ast.List) and n.elts and isinstance(n.elts[0], ast.Constant) and n.elts[0].value == "gh"]
    shapes = sorted(tuple(e.value if isinstance(e, ast.Constant) else "?" for e in n.elts[:4]) for n in gh_lists)
    assert shapes == [("gh", "api", "-X", "GET"), ("gh", "api", "-X", "POST"), ("gh", "api", "-X", "POST")], shapes
    consts = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "workflow" not in consts and "run" not in consts and "--ref" not in consts
    assert "event_type=agent-ci-evidence" in consts                       # the guard's LITERAL event type
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    runs = [n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "run"]
    assert [ast.unparse(c.args[0]) for c in runs] == ["push_", "disp"], [ast.unparse(c) for c in runs]
    assert not [n for n in ast.walk(main) if isinstance(n, (ast.For, ast.While, ast.AsyncFor, ast.comprehension))], "a loop in main(): a retry?"
    for fn in (n for n in tree.body if isinstance(n, ast.FunctionDef)):
        assert not any(isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute) and x.func.attr in ("sleep", "retry")
                       for x in ast.walk(fn)), fn.name


def test_rearm_takes_exactly_one_pr():
    with pytest.raises(SystemExit):
        rearm.main([], get=lambda p: None)
    for argv in (["--pr", "1700", "--pr", "1700"], ["--pr", "1700", "--pr", "1699"], ["--pr", "0"]):   # never two, never 0
        calls = []
        assert rearm.main([*argv, "--repo", REPO], get=lambda p: calls.append(p), run=lambda a, **k: calls.append(a)) == rearm.REFUSED, argv
        assert calls == [], argv   # refused before a single read


# --- GhApi.remote_ref: exact-ref filter on `git ls-remote` output (AUDIT T2 #1696 survivor 2) -----------------
# ls-remote patterns match by trailing path components, so a foreign ref such as refs/x/refs/agent-ci-evidence/pr-7
# also matches the pattern. remote_ref must return only the EXACT ref, and None when it is absent or ambiguous.

def _ls_remote_returning(monkeypatch, stdout):
    def fake_run(argv, **kw):
        assert argv[:2] == ["git", "ls-remote"], argv
        return types.SimpleNamespace(returncode=0, stdout=stdout, stderr="")
    monkeypatch.setattr(ev.subprocess, "run", fake_run)


def test_remote_ref_returns_the_exact_ref_not_a_suffix_matching_foreign_ref(monkeypatch):
    ref = "refs/agent-ci-evidence/pr-7"
    _ls_remote_returning(monkeypatch, f"{'b' * 40}\trefs/x/{ref}\n{'a' * 40}\t{ref}\n")
    assert ev.GhApi("o/r").remote_ref(ref) == "a" * 40


def test_remote_ref_ignores_a_foreign_ref_alone(monkeypatch):
    ref = "refs/agent-ci-evidence/pr-7"
    _ls_remote_returning(monkeypatch, f"{'b' * 40}\trefs/x/{ref}\n")
    assert ev.GhApi("o/r").remote_ref(ref) is None


def test_remote_ref_is_none_when_the_exact_ref_is_listed_twice(monkeypatch):
    ref = "refs/agent-ci-evidence/pr-7"
    _ls_remote_returning(monkeypatch, f"{'a' * 40}\t{ref}\n{'c' * 40}\t{ref}\n")
    assert ev.GhApi("o/r").remote_ref(ref) is None


# ---- MERGE QUEUE (2026-11-22; inert until a queue exists): a merge_group record ------------------------------------------
# agent-ci-queue.yml calls agent-ci.yml on `merge_group`. GITHUB_SHA is then the commit under test (GitHub's merge group
# commit), and the PR is named only by the queue's branch. `verify` does not accept these records (design question 8.3).
QUEUE_REF = "refs/heads/gh-readonly-queue/master/pr-1700-" + "9" * 40
MG_ENV = dict(PR_ENV, GITHUB_EVENT_NAME="merge_group", GITHUB_SHA=M, GITHUB_REF=QUEUE_REF)
MG_PAYLOAD = {"merge_group": {"head_sha": M, "base_sha": B, "head_ref": QUEUE_REF, "base_ref": "refs/heads/master"}}
_Q = "refs/heads/gh-readonly-queue/master/pr-"


@pytest.mark.parametrize("ref,pr", [
    (QUEUE_REF, 1700), ("gh-readonly-queue/master/pr-1-" + "0" * 40, 1), (_Q + "9999999-" + "a" * 40, 9999999),
    # every other shape names NO pull request
    ("refs/heads/gh-readonly-queue/agent/int/pr-1700-" + "9" * 40, None),          # a queue on another base branch
    ("refs/heads/gh-readonly-queue/main/pr-1700-" + "9" * 40, None),
    (_Q + "01700-" + "9" * 40, None), (_Q + "0-" + "9" * 40, None), (_Q + "12345678-" + "9" * 40, None), (_Q + "-" + "9" * 40, None),
    (_Q + "1700-" + "9" * 39, None), (_Q + "1700-" + "9" * 41, None), (_Q + "1700-" + "G" * 40, None), (_Q + "1700", None),
    (QUEUE_REF + "\n", None), ("x" + QUEUE_REF, None), ("refs/tags/gh-readonly-queue/master/pr-1700-" + "9" * 40, None),
    ("refs/heads/agent/gh-readonly-queue/master/pr-1700-" + "9" * 40, None), ("refs/pull/1700/merge", None),
    ("refs/heads/master", None), ("", None), (None, None), (1700, None), ([QUEUE_REF], None), (QUEUE_REF.encode(), None),
])
def test_MQ_queue_pr_reads_only_a_master_queue_branch(ref, pr):
    assert ev.queue_pr(ref) == pr


def test_MQ_build_record_for_a_merge_group_run():
    rec = ev.build_record("server", MG_ENV, MG_PAYLOAD, M, "e" * 40, [B, H])
    assert rec["errors"] == [] and rec["pr"] == 1700 and rec["event"] == "merge_group" and rec["sha"] == M
    assert (rec["base_sha"], rec["head_sha"], rec["tree"], rec["ref"]) == (B, H, "e" * 40, QUEUE_REF)
    assert ev.MERGE_GROUP_EVENT == "merge_group" and ev.MERGE_GROUP_EVENT not in (ev.PR_EVENT, ev.DISPATCH_EVENT)


def _group(**over):
    return {"merge_group": dict(MG_PAYLOAD["merge_group"], **over)}


@pytest.mark.parametrize("env,payload,head,why", [
    (MG_ENV, MG_PAYLOAD, "f" * 40, "not the event's merge commit"),                              # checked out something else
    (dict(MG_ENV, GITHUB_SHA="f" * 40), MG_PAYLOAD, M, "not the event's merge commit"),          # GITHUB_SHA is not HEAD
    (dict(MG_ENV, GITHUB_SHA=""), MG_PAYLOAD, M, "not the event's merge commit"),
    (MG_ENV, _group(head_sha="f" * 40), M, "merge group's head_sha"),                            # the event names another commit
    (MG_ENV, _group(head_sha=None), M, "merge group's head_sha"),
    (MG_ENV, _group(head_ref="refs/heads/master"), M, "names no queued PR"),
    (MG_ENV, _group(head_ref=None), M, "names no queued PR"),
    (MG_ENV, {"merge_group": "x"}, M, "names no queued PR"),
    (MG_ENV, {}, M, "names no queued PR"),
    (MG_ENV, PR_PAYLOAD, M, "names no queued PR"),                                               # a pull_request-shaped event
    (MG_ENV, DISPATCH_PAYLOAD, M, "names no queued PR"),                                         # a re-arm payload
])
def test_MQ_build_record_fails_closed(env, payload, head, why):
    rec = ev.build_record("server", env, payload, head, "e" * 40, [B, H])
    assert any(why in e for e in rec["errors"]), (why, rec["errors"])
    assert rec["sha"] == head                                    # the record always says what was really checked out


def test_MQ_the_record_pr_is_the_queue_branch_and_nothing_else():
    """No other field of a merge_group event can supply or override the PR number."""
    event = {"number": 4242, "pull_request": {"number": 4242}, "client_payload": {"pr": 4242, "merge_sha": M},
             "merge_group": dict(MG_PAYLOAD["merge_group"], number=4242, pull_request={"number": 4242})}
    assert ev.build_record("server", MG_ENV, event, M, "e" * 40, [B, H])["pr"] == 1700
    event["merge_group"]["head_ref"] = "refs/heads/master"
    assert ev.build_record("server", MG_ENV, event, M, "e" * 40, [B, H])["pr"] is None


def test_MQ_a_merge_group_record_never_passes_verify():
    """Design question 8.3 is open: until AUDIT answers it, `verify` reads pull_request (/ rearm) evidence only. A
    merge_group record under a PR run, or a merge_group run, is refused whatever the caller accepts."""
    fx = _fx()
    assert _code(_decide(fx)) == "PASS"                          # control: the fixture passes until it is touched
    for rec in _recs(fx).values():
        rec["event"] = ev.MERGE_GROUP_EVENT
    assert _code(_decide(fx)) == "non-pr-event" and _code(_decide(fx, accept=BOTH)) == "non-pr-event"
    fx = _fx()
    _run(fx)["event"] = ev.MERGE_GROUP_EVENT
    assert _code(_decide(fx)) == "no-run" and _code(_decide(fx, accept=BOTH)) == "no-run"
    assert _code(_decide(fx, accept=(*BOTH, ev.MERGE_GROUP_EVENT))) == "non-pr-event"


def test_MQ_record_cli_on_a_real_merge_group_commit(tmp_path, monkeypatch):
    """`record` end to end, as a called agent-ci.yml job runs it in a merge group: HEAD is GitHub's two-parent merge."""
    def git(*a):
        return subprocess.run(["git", "-C", str(tmp_path), *a], check=True, capture_output=True, text=True).stdout.strip()
    git("init", "-q", "-b", "m")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "start")
    git("checkout", "-q", "-b", "h")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "the queued PR")
    head = git("rev-parse", "HEAD")
    git("checkout", "-q", "m")
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "an entry ahead")
    base = git("rev-parse", "HEAD")
    git("-c", "user.email=a@b", "-c", "user.name=a", "merge", "-q", "--no-ff", "-m", "merge group", "h")
    merge = git("rev-parse", "HEAD")
    ref = f"refs/heads/gh-readonly-queue/master/pr-3-{base}"
    payload = tmp_path / "event.json"
    payload.write_text(json.dumps({"merge_group": {"head_sha": merge, "base_sha": base, "head_ref": ref}}), encoding="utf-8")
    for k, v in dict(MG_ENV, GITHUB_SHA=merge, GITHUB_REF=ref, GITHUB_EVENT_PATH=str(payload)).items():
        monkeypatch.setenv(k, v)
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "ev" / "evidence.json"
    assert ev.main(["record", "--job-key", "union", "--out", str(out)]) == 0
    rec = json.loads(out.read_text(encoding="utf-8"))
    assert (rec["event"], rec["pr"], rec["sha"], rec["parents"], rec["errors"]) == ("merge_group", 3, merge, [base, head], [])
    # control: the same checkout under an event that names another commit exits 1 and says why
    payload.write_text(json.dumps({"merge_group": {"head_sha": base, "base_sha": base, "head_ref": ref}}), encoding="utf-8")
    assert ev.main(["record", "--job-key", "union", "--out", str(out)]) == 1
    assert "merge group's head_sha" in json.loads(out.read_text(encoding="utf-8"))["errors"][0]
