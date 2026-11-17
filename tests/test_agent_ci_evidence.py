"""P2 merge-tree evidence (tools/agent_ci_evidence.py, tools/agent_ci_rearm.py): PASS only for the newest completed
pull_request (or, opted in, re-arm) agent ci run of THIS PR whose 13 records agree on a merge commit of the CURRENT base
tip + PR head with the expected tree. Every fail-closed branch is driven from one PASS fixture
(tests/fixtures/agent_ci_evidence/pass_run.json) by changing ONE thing."""
from __future__ import annotations

import copy
import json
import pathlib
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


def _decide(fx, accept=(ev.PR_EVENT,), busy=False, keys=None):
    return ev.decide(fx["pr"], fx["base_tip"], fx["runs"], KEYS if keys is None else keys, fx["expected_tree"], accept, busy,
                     fx["changed_paths"], PROTECTED)


def _code(result):
    verdict, reason, _ = result
    return verdict if verdict == "PASS" else reason.split(":", 1)[0]


def _run(fx):
    return fx["runs"][0]


def _recs(fx):
    return _run(fx)["records"]


# ---- the required job set ---------------------------------------------------------------------------------------
def test_required_keys_cover_the_thirteen_required_jobs_one_to_one():
    assert list(KEYS) == acr.required_jobs(DOC) and len(KEYS) == 13
    assert len(set(KEYS.values())) == 13
    assert {k for k in KEYS.values() if k.startswith("browser-")} == {f"browser-{i}" for i in range(1, 9)}
    assert set(_recs(FIXTURE)) == set(KEYS.values()), "the fixture no longer matches agent-ci.yml's jobs"


# ---- PASS -------------------------------------------------------------------------------------------------------
def test_the_fixture_passes_and_reports_the_evidence():
    verdict, reason, evidence = _decide(_fx())
    assert verdict == "PASS", reason
    assert evidence["tree"] == FIXTURE["expected_tree"] and evidence["base_sha"] == FIXTURE["base_tip"]
    assert evidence["head_sha"] == FIXTURE["pr"]["head_sha"] and evidence["jobs"] == evidence["records"] == 13
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
    "dispatch-not-accepted-by-default": (lambda f: _run(f).update(event="workflow_dispatch"), "no-run"),
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
    "not-a-merge-commit": (lambda f: [r.update(parents=["b" * 40]) for r in _recs(f).values()], "stale-merge-ref"),
    "stale-base": (lambda f: f.update(base_tip="a" * 40), "stale-merge-ref"),
    "stale-head": (lambda f: f["pr"].update(head_sha="a" * 40), "stale-merge-ref"),
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
def _dispatch_fx():
    fx = _fx()
    _run(fx)["event"] = "workflow_dispatch"
    _run(fx).update(head_branch="master", path=".github/workflows/agent-ci.yml")
    for r in _recs(fx).values():
        r["event"], r["ref"] = "workflow_dispatch", "refs/heads/master"
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
}


@pytest.mark.parametrize("cls", sorted(SELF_PROTECTED_EXAMPLES))
def test_F1_each_self_protected_path_class_fails_closed(cls):
    for path in SELF_PROTECTED_EXAMPLES[cls]:
        fx = _fx()
        fx["changed_paths"] = fx["changed_paths"] + [path]
        verdict, reason, _ = _decide(fx)
        assert _code((verdict, reason, None)) == "self-protected-diff" and path in reason, (cls, path, reason)


def test_F1_ordinary_agent_paths_are_not_self_protected():
    ok = ["app/src/agent/a.js", "tools/agent_vitest_shards.py", "tools/agent_ownership_check.py", "tests/test_uct_agent_x.py",
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


def test_F1_cli_fails_closed_when_the_protected_list_is_unreadable(tmp_path, capsys):
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "agent-ci.yml").write_text((ROOT / ".github/workflows/agent-ci.yml").read_text(encoding="utf-8"), encoding="utf-8")
    assert ev.main(["verify", "--pr", "1700", "--tree", "e" * 40, "--root", str(tmp_path)]) == 1   # no app/ config
    assert "self-protected-diff" in capsys.readouterr().out


def test_a_rearm_record_under_a_pr_run_is_refused():
    fx = _fx()
    _recs(fx)["union"]["event"] = "workflow_dispatch"
    assert _code(_decide(fx, accept=BOTH)) == "non-pr-event"


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
        if "runs?event=workflow_dispatch" in path:
            return {"workflow_runs": self.dispatch}
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

    def download(self, run_id, name, dest):
        key = name[len(f"{ev.ARTIFACT_PREFIX}{self.fx['pr']['number']}-"):]
        pathlib.Path(dest).mkdir(parents=True)
        (pathlib.Path(dest) / "evidence.json").write_text(json.dumps(_recs(self.fx)[key]), encoding="utf-8")


def _gather_decide(api, accept_dispatch=False):
    fx = api.fx
    pr, tip, runs, busy, changed = ev.gather(api, fx["pr"]["number"], KEYS, accept_dispatch)
    return ev.decide(pr, tip, runs, KEYS, fx["expected_tree"], BOTH if accept_dispatch else (ev.PR_EVENT,), busy, changed, PROTECTED)


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
    busy = {"id": 77, "event": "workflow_dispatch", "status": "in_progress", "created_at": "2026-11-17T12:00:00Z"}
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
    monkeypatch.setattr(ev, "gather", lambda api, n, keys, accept_dispatch: (fx["pr"], fx["base_tip"], fx["runs"], False, fx["changed_paths"]))


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


def test_build_record_for_a_rearm_dispatch_binds_the_input_merge_sha():
    env = dict(PR_ENV, GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_SHA="a" * 40, GITHUB_REF="refs/heads/master")
    payload = {"inputs": {"pr": "1700", "merge_sha": M}}
    assert ev.build_record("server", env, payload, M, "e" * 40, [B, H])["errors"] == []
    wrong = ev.build_record("server", env, payload, "f" * 40, "e" * 40, [B, H])   # checked out something else
    assert wrong["errors"] and "not the event's merge commit" in wrong["errors"][0]
    bad_pr = ev.build_record("server", env, {"inputs": {"pr": "1; rm -rf /", "merge_sha": M}}, M, "e" * 40, [B, H])
    assert bad_pr["errors"] and bad_pr["pr"] is None


def test_build_record_marks_an_unreadable_report_and_a_non_merge(tmp_path):
    rec = ev.build_record("browser-1", PR_ENV, PR_PAYLOAD, M, "e" * 40, [B], vitest=[str(tmp_path / "missing.json")])
    assert rec["reports_unreadable"] == [str(tmp_path / "missing.json")]
    assert rec["base_sha"] is None and rec["head_sha"] is None   # verify() refuses it as stale-merge-ref


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


# ---- the re-arm dispatcher ------------------------------------------------------------------------------------------
REPO = "o/r"


def _pr_json(**over):
    pr = {"number": 1700, "state": "open", "merged": False, "mergeable": True, "merge_commit_sha": M,
          "head": {"sha": H, "ref": "agent/pl/x", "repo": {"full_name": REPO}}, "base": {"ref": "master", "repo": {"full_name": REPO}}}
    pr.update(over)
    return pr


@pytest.mark.parametrize("over,parents,ok,why", [
    ({}, [B, H], True, "merge ref"),
    ({"state": "closed"}, [B, H], False, "not open"),
    ({"merged": True}, [B, H], False, "not open"),
    ({"base": {"ref": "agent/int"}}, [B, H], False, "targets"),
    ({"head": {"sha": H, "ref": "charts/x", "repo": {"full_name": REPO}}}, [B, H], False, "agent/**"),
    ({"head": {"sha": H, "ref": "agent/x", "repo": {"full_name": "fork/r"}}}, [B, H], False, "agent/**"),
    ({"mergeable": False}, [B, H], False, "conflict"),
    ({"mergeable": None}, None, False, "not computed"),
    ({}, ["a" * 40, H], False, "stale"),
    ({}, [B, "a" * 40], False, "stale"),
    ({}, [B], False, "stale"),
])
def test_rearm_check(over, parents, ok, why):
    got, reason = rearm.check(_pr_json(**over), REPO, B, parents)
    assert got is ok and why in reason, reason


def _fake_gh(prs):
    """GET responses: pulls/N yields each of `prs` in turn (the last repeats); base tip B; merge commit parents [B, H]."""
    seq = list(prs)
    calls = []

    def get(path):
        calls.append(path)
        if path.endswith("/pulls/1700"):
            return seq.pop(0) if len(seq) > 1 else seq[0]
        if "/git/ref/heads/" in path:
            return {"object": {"sha": B}}
        if "/commits/" in path:
            return {"parents": [{"sha": B}, {"sha": H}]}
        raise AssertionError(path)
    return get, calls


class _Clock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_rearm_dispatches_exactly_once_for_the_named_pr_only(capsys):
    get, _ = _fake_gh([_pr_json(mergeable=None), _pr_json()])
    runs, clock = [], _Clock()
    rc = rearm.main(["--pr", "1700", "--repo", REPO], get=get, run=lambda argv, **k: runs.append(argv) or types.SimpleNamespace(returncode=0, stdout="", stderr=""),
                    sleep=clock.sleep, now=clock.now)
    assert rc == 0 and runs == [rearm.dispatch_argv(REPO, 1700, M)]
    assert runs[0] == ["gh", "workflow", "run", "agent-ci.yml", "-R", REPO, "--ref", "master", "-f", "pr=1700", "-f", f"merge_sha={M}"]


def test_rearm_refuses_without_dispatching():
    for prs in ([_pr_json(state="closed")], [_pr_json(mergeable=False)], [_pr_json(base={"ref": "agent/int"})]):
        get, _ = _fake_gh(prs)
        runs = []
        assert rearm.main(["--pr", "1700", "--repo", REPO], get=get, run=lambda a, **k: runs.append(a), sleep=lambda s: None) == rearm.REFUSED
        assert runs == []


def test_rearm_stale_merge_ref_times_out_and_never_dispatches():
    get, calls = _fake_gh([_pr_json(mergeable=None)])
    runs, clock = [], _Clock()
    rc = rearm.main(["--pr", "1700", "--repo", REPO, "--timeout", "20"], get=get, run=lambda a, **k: runs.append(a),
                    sleep=clock.sleep, now=clock.now)
    assert rc == rearm.REFUSED and runs == [] and clock.t <= 25   # bounded wait, reads only


def test_rearm_dry_run_and_a_failed_dispatch_is_not_retried():
    get, _ = _fake_gh([_pr_json()])
    runs = []
    assert rearm.main(["--pr", "1700", "--repo", REPO, "--dry-run"], get=get, run=lambda a, **k: runs.append(a)) == 0 and runs == []
    calls = []
    fail = lambda a, **k: calls.append(a) or types.SimpleNamespace(returncode=1, stdout="", stderr="HTTP 422")
    assert rearm.main(["--pr", "1700", "--repo", REPO], get=get, run=fail) == rearm.FAILED and len(calls) == 1


def test_F2_rearm_has_no_ref_option_and_always_dispatches_master():
    get, _ = _fake_gh([_pr_json()])
    for argv in (["--ref", "agent/pl/x"], ["--ref", "master"], ["--ref=agent/pl/x"]):
        with pytest.raises(SystemExit):
            rearm.main(["--pr", "1700", "--repo", REPO, *argv], get=get, run=lambda a, **k: pytest.fail("dispatched"))
    argv = rearm.dispatch_argv(REPO, 1700, M)
    assert argv[argv.index("--ref") + 1] == "master" and argv.count("--ref") == 1


def test_F2_rearm_hard_refuses_a_non_master_workflow_ref(monkeypatch):
    get, _ = _fake_gh([_pr_json()])
    monkeypatch.setattr(rearm, "WORKFLOW_REF", "agent/pl/x")
    runs = []
    assert rearm.main(["--pr", "1700", "--repo", REPO], get=get, run=lambda a, **k: runs.append(a)) == rearm.REFUSED and runs == []


def test_rearm_takes_exactly_one_pr():
    with pytest.raises(SystemExit):
        rearm.main([], get=lambda p: None)
    for argv in (["--pr", "1700", "--pr", "1700"], ["--pr", "1700", "--pr", "1699"], ["--pr", "0"]):   # never two, never 0
        get, calls = _fake_gh([_pr_json()])
        runs = []
        assert rearm.main([*argv, "--repo", REPO], get=get, run=lambda a, **k: runs.append(a)) == rearm.REFUSED, argv
        assert runs == [] and calls == [], argv   # refused before a single read
