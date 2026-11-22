"""agent-ci-required (tools/agent_ci_required.py): the one required Agent status is success ONLY for a PR that touches
no Agent path, or whose exact head SHA has a completed, all-green agent ci PUSH run. Everything else fails closed.
MERGE QUEUE (2026-11-22; inert until a queue exists): the same status on a merge group's commit (test_MQ_* at the end)."""
from __future__ import annotations

import json
import pathlib
import subprocess
import types

import pytest
import yaml

from tools import agent_ci_evidence as ev
from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC = acr.load_agent_ci(ROOT)
PATHS = acr.agent_paths(DOC)
JOBS = acr.required_jobs(DOC)

#: C3: the exact job set, verified against agent-ci.yml. A change here is a deliberate, reviewed change.
#: 2026-11-16: the browser shards went 4 -> 8 (GitHub Pro, 40 concurrent jobs), so nine jobs became thirteen.
#: 2026-11-17: 8 -> 12 browser shards and capreg @ rth as two legs (rth-1, rth-2), so thirteen jobs became eighteen.
EXPECTED_JOBS = {
    "UCT Agent server tests (production dependency set)",
    *(f"UCT Agent browser tests (shard {i}/12)" for i in range(1, 13)),
    "UCT Agent capability regression (deterministic, no model) @ post",
    "UCT Agent capability regression (deterministic, no model) @ rth-1",
    "UCT Agent capability regression (deterministic, no model) @ rth-2",
    "UCT Agent capability regression (deterministic, no model)",
    "Shards cover every Agent test file (equivalence rail)",
}
AGENT_FILE = "app/src/agent/nl/router.js"
OTHER_FILE = "README.md"


def _run(status="completed", conclusion="success", jobs=None, **override):
    jobs = [{"name": n, "conclusion": "success"} for n in JOBS] if jobs is None else jobs
    return {"id": 1, "status": status, "conclusion": conclusion, "jobs": jobs, **override}


def _decide(changed, run):
    return acr.decide(changed, PATHS, run, JOBS)


# ---- C2 / C3: one authority -------------------------------------------------------------------------------------
def test_paths_are_agent_ci_push_paths_read_at_run_time():
    raw = yaml.safe_load((ROOT / ".github" / "workflows" / "agent-ci.yml").read_text(encoding="utf-8"))
    assert PATHS == (raw.get("on") or raw[True])["push"]["paths"]


def test_required_jobs_are_exactly_the_eighteen_agent_jobs():
    assert len(JOBS) == 18 and set(JOBS) == EXPECTED_JOBS, JOBS


def test_the_workflow_runs_the_tool_and_watches_the_right_workflow():
    wf = yaml.safe_load((ROOT / ".github" / "workflows" / "agent-ci-required.yml").read_text(encoding="utf-8"))
    on = wf.get("on") or wf[True]
    assert on["workflow_run"]["workflows"] == [DOC["name"]] and on["workflow_run"]["types"] == ["completed"]
    assert set(on["pull_request"]["types"]) == {"opened", "synchronize", "reopened"}
    assert wf["permissions"] == {"statuses": "write", "actions": "read", "contents": "read", "pull-requests": "read"}
    steps = " ".join(s.get("run") or "" for s in wf["jobs"]["status"]["steps"])
    assert "tools/agent_ci_required.py" in steps and "npm" not in steps and "pytest" not in steps


# ---- path matching (GitHub filter semantics) ----------------------------------------------------------------------
@pytest.mark.parametrize("path,hit", [
    ("app/src/agent/x/y.js", True), ("app/src/components/chart/builder/agentMutations.js", True),
    ("api/routers/uct_agent_x.py", True), ("api/routers/sub/uct_agent.py", False), ("tools/agent_ci_required.py", True),
    (".github/workflows/agent-ci.yml", True), ("app/src/pages/charts/grid/a/b.jsx", True),
    ("app/src/components/StockChart.jsx", True), ("app/src/components/StockChartX.jsx", False), (OTHER_FILE, False),
])
def test_matches(path, hit):
    assert acr.matches(path, PATHS) is hit


def test_negated_pattern_last_match_wins():
    assert acr.matches("a/b.py", ["a/**", "!a/b.py"]) is False
    assert acr.matches("a/b.py", ["!a/b.py", "a/**"]) is True


# ---- C6: the decision ---------------------------------------------------------------------------------------------
def test_no_agent_paths_is_success_without_any_run():
    assert _decide([OTHER_FILE], None) == "success"
    assert _decide([], None) == "success"


def test_agent_paths_and_green_run_with_all_jobs_is_success():
    assert _decide([OTHER_FILE, AGENT_FILE], _run()) == "success"


def test_unknown_diff_fails_closed():
    assert _decide(None, None) == "pending"
    assert _decide(None, _run(conclusion="failure")) == "failure"


@pytest.mark.parametrize("run,expected", [
    (None, "pending"),                                                         # no push run for the head SHA
    ({"error": "HTTP 502"}, "failure"),                                        # API error
    (_run(status="in_progress", conclusion=None), "pending"),                  # still running
    (_run(status="queued", conclusion=None), "pending"),
    (_run(conclusion="failure"), "failure"),                                   # run red even with jobs green
    (_run(conclusion="cancelled"), "failure"),
])
def test_run_states_never_success(run, expected):
    assert _decide([AGENT_FILE], run) == expected


@pytest.mark.parametrize("bad", ["failure", "skipped", "cancelled", None, "neutral"])
def test_any_required_job_not_success_is_failure(bad):
    for name in JOBS:
        jobs = [{"name": n, "conclusion": bad if n == name else "success"} for n in JOBS]
        assert _decide([AGENT_FILE], _run(jobs=jobs)) == "failure", name


def test_missing_job_is_failure():
    for name in JOBS:
        jobs = [{"name": n, "conclusion": "success"} for n in JOBS if n != name]
        assert _decide([AGENT_FILE], _run(jobs=jobs)) == "failure", name
    assert _decide([AGENT_FILE], _run(jobs=[])) == "failure"


def test_no_required_jobs_never_success():
    assert acr.decide([AGENT_FILE], PATHS, _run(), []) == "failure"


def test_combine_worst_wins():
    assert acr.combine(["success", "pending"]) == "pending"
    assert acr.combine(["success", "failure", "pending"]) == "failure"
    assert acr.combine(["success"]) == "success"
    assert acr.combine([]) == "pending"


# ---- evaluate() over a fake API (no network) ------------------------------------------------------------------------
class FakeApi:
    def __init__(self, files=None, runs=None, jobs=None, fail=None, ref="agent/pl/x"):
        self.files, self.runs, self.jobs, self.fail, self.ref = files or [], runs, jobs, fail, ref

    def get(self, path):
        if self.fail and self.fail in path:
            raise acr.ApiError(f"GET {path}: HTTP 500")
        if path.startswith("pulls/") and "/files" not in path:
            return {"head": {"ref": self.ref}}
        if path.startswith("pulls/"):
            page = int(path.rsplit("page=", 1)[1])
            return [{"filename": f} for f in self.files[(page - 1) * 100: page * 100]]
        if path.startswith("actions/workflows/"):
            return {"workflow_runs": self.runs or []}
        if path.startswith("actions/runs/"):
            return {"jobs": self.jobs if self.jobs is not None else [{"name": n, "conclusion": "success"} for n in JOBS]}
        raise AssertionError(path)


SHA = "a" * 40
GREEN = {"id": 7, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success", "created_at": "t"}


def test_evaluate_paths():
    assert acr.evaluate(FakeApi(files=[OTHER_FILE]), SHA, [1], DOC)[0] == "success"
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[GREEN]), SHA, [1], DOC)[0] == "success"
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[]), SHA, [1], DOC)[0] == "pending"
    other_sha = dict(GREEN, head_sha="b" * 40)
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[other_sha]), SHA, [1], DOC)[0] == "pending"
    pr_event = dict(GREEN, event="pull_request")   # same-repo PR runs skip every job by design: never counts
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[pr_event]), SHA, [1], DOC)[0] == "pending"
    skipped = [{"name": n, "conclusion": "skipped"} for n in JOBS]
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[GREEN], jobs=skipped), SHA, [1], DOC)[0] == "failure"


def test_evaluate_api_errors_fail_closed():
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], fail="actions/"), SHA, [1], DOC)[0] == "failure"
    assert acr.evaluate(FakeApi(fail="pulls/"), SHA, [1], DOC)[0] == "failure"


def test_evaluate_no_pr_or_truncated_diff_needs_the_run():
    assert acr.evaluate(FakeApi(runs=[]), SHA, [], DOC)[0] == "pending"
    assert acr.evaluate(FakeApi(runs=[GREEN]), SHA, [], DOC)[0] == "success"
    huge = [f"docs/{i}.md" for i in range(acr.MAX_PR_FILES)]
    assert acr.evaluate(FakeApi(files=huge, runs=[]), SHA, [1], DOC)[0] == "pending"


def test_newest_push_run_wins():
    old_red = dict(GREEN, id=6, conclusion="failure", created_at="s")
    api = FakeApi(files=[AGENT_FILE], runs=[old_red, GREEN])
    assert acr.evaluate(api, SHA, [1], DOC)[0] == "success"


# ── (2026-11-12, AUDIT option B) a PR from a NON-agent/** branch (charts/*, fix/*, feat/* …) that touches an Agent path is
#    proven by its own PULL_REQUEST agent-ci run (path-filtered on the PR's own diff — merging master never starts one);
#    agent/** heads keep push-run evidence. Without this the required status would stay pending forever for them.
@pytest.mark.parametrize("ref,event", [("agent/pl/x", "push"), ("agent/int", "push"), ("charts/p3-legacy", "pull_request"),
                                       ("fix/rs-line-polish", "pull_request"), ("feat/x", "pull_request"), (None, "pull_request")])
def test_evidence_event_by_head_branch(ref, event):
    assert acr.evidence_event(ref) == event


def test_non_agent_head_is_proven_by_its_pull_request_run():
    pr_green = dict(GREEN, event="pull_request")
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[pr_green], ref="charts/p3"), SHA, [1], DOC)[0] == "success"
    # a push run alone does not prove a non-agent head (it is the PR run that ran the PR's own diff)
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[GREEN], ref="charts/p3"), SHA, [1], DOC)[0] == "pending"
    skipped = [{"name": n, "conclusion": "skipped"} for n in JOBS]
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[pr_green], jobs=skipped, ref="fix/x"), SHA, [1], DOC)[0] == "failure"
    # a non-agent PR whose OWN diff touches no Agent path is success with no run at all (merging master never pays)
    assert acr.evaluate(FakeApi(files=[OTHER_FILE], runs=[], ref="charts/p3"), SHA, [1], DOC)[0] == "success"


def test_agent_head_never_accepts_a_pull_request_run():
    pr_green = dict(GREEN, event="pull_request")
    assert acr.evaluate(FakeApi(files=[AGENT_FILE], runs=[pr_green], ref="agent/pl/x"), SHA, [1], DOC)[0] == "pending"


def test_agent_ci_jobs_run_on_pull_request_for_non_agent_heads():
    """agent-ci.yml: every Agent job's `if:` lets a same-repo PR from a non-agent/** head run (the evidence above), and the
    push trigger stays agent/** only (option A's every-branch push would pay a full run whenever a branch merges master)."""
    doc = yaml.safe_load((pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/agent-ci.yml").read_text(encoding="utf-8"))
    on = doc.get("on", doc.get(True))
    assert on["push"]["branches"] == ["agent/**"]
    conds = {name: str(job.get("if", "")) for name, job in doc["jobs"].items()}
    gated = {n: c for n, c in conds.items() if "github.event.pull_request.head.repo.full_name" in c}
    assert len(gated) == 5, gated
    for n, c in gated.items():
        assert "!startsWith(github.head_ref, 'agent/')" in c, n


# ── MERGE QUEUE (2026-11-22; inert until a queue exists on master). .github/workflows/agent-ci-queue.yml posts this same
#    status on a merge group's commit: `scope` reads the queued PR's OWN diff with master's code, the Agent jobs run on the
#    merge group's commit only for an Agent change, and `verdict` is success ONLY for "no Agent path" or "every Agent job
#    green in this run". A self-protected path is ALWAYS failure. The workflow's own shape: tests/test_ci_agent_merge_ref.py.
PROTECTED = ev.protected_patterns(ROOT)
WORKFLOW_FILE = ".github/workflows/web-start.yml"      # self-protected (any workflow) and NOT an Agent path
CALL = acr.QUEUE_CALL_JOB + " / "


def test_MQ_the_scope_code_for_each_kind_of_diff():
    assert acr.SCOPE_CODES == ("no-agent-paths", "agent-paths", "self-protected", "unknown")
    assert not acr.matches(WORKFLOW_FILE, PATHS) and not acr.matches(OTHER_FILE, PROTECTED)
    assert acr.decide_scope([OTHER_FILE], PATHS, PROTECTED) == (acr.SCOPE_CLEAR, "no Agent paths changed")
    assert acr.decide_scope([], PATHS, PROTECTED)[0] == acr.SCOPE_CLEAR
    assert acr.decide_scope([OTHER_FILE, AGENT_FILE], PATHS, PROTECTED) == (acr.SCOPE_AGENT, "Agent paths changed")
    # an unreadable diff or protected list is never "clear", whatever the other one says
    for changed, protected in ((None, PROTECTED), ([OTHER_FILE], None), ([AGENT_FILE], None), (None, None)):
        assert acr.decide_scope(changed, PATHS, protected)[0] == acr.SCOPE_UNKNOWN, (changed, protected is None)


@pytest.mark.parametrize("path", [
    WORKFLOW_FILE, ".github/workflows/agent-ci.yml", ".github/workflows/agent-ci-queue.yml", ".github/workflows/new.yml",
    "tools/agent_ci_required.py", "tools/agent_ci_evidence.py", "tools/agent_suite_lock.py", "tools/agent_vitest_shards.py",
    "tools/agent_vitest_shard_timings.json", "app/package.json", "app/package-lock.json", "app/vite.config.js",
    "app/scripts/chartLibraryPatch.mjs", "app/src/test-setup.js", "app/src/lib/marketClock/calendarCompact.js",
    "pytest.ini", "conftest.py", "tests/conftest.py", "requirements.txt", "api/requirements.txt",
])
def test_MQ_a_self_protected_path_decides_whatever_else_the_diff_holds(path):
    """Design 3.4: in a merge group the workflow, the tools, the test config and the dependencies come from the merge
    group's commit. A queued PR that edits one could vouch for itself, so it is never `agent-paths` and never clear."""
    for diff in ([path], [OTHER_FILE, path], [AGENT_FILE, path], [path, AGENT_FILE, OTHER_FILE]):
        code, detail = acr.decide_scope(diff, PATHS, PROTECTED)
        assert code == acr.SCOPE_PROTECTED and path in detail and "self-protected" in detail, (diff, code, detail)


def test_MQ_ordinary_agent_paths_are_not_self_protected():
    """Control for the rail above: the protected list does not swallow the Agent's own code."""
    for path in ("app/src/agent/a.js", "tools/agent_ownership_check.py", "tests/test_uct_agent_x.py", "docs/agent/program/INTEGRATION.md",
                 "app/src/pages/charts/ChartsWorkspace.jsx", "api/services/uct_agent/x.py"):
        assert acr.decide_scope([path], PATHS, PROTECTED)[0] == acr.SCOPE_AGENT, path


# ---- the verdict ----------------------------------------------------------------------------------------------------
def _listed(names=None, conclusion="success", prefix=CALL):
    """A merge-group run's jobs as the API lists them: the called Agent jobs under "agent / ", plus the run's own two."""
    return [{"name": prefix + n, "conclusion": conclusion} for n in (JOBS if names is None else names)] + \
           [{"name": "agent-ci-queue scope", "conclusion": "success"}, {"name": "agent-ci-required verdict", "conclusion": None}]


def _verdict(scope_result="success", code=acr.SCOPE_AGENT, agent="success", jobs=None, detail="Agent paths changed", required=JOBS):
    return acr.decide_queue(scope_result, code, detail, agent, _listed() if jobs is None else jobs, required)


def test_MQ_the_two_ways_to_success():
    skipped_call = [{"name": acr.QUEUE_CALL_JOB, "conclusion": "skipped"}, {"name": "agent-ci-queue scope", "conclusion": "success"}]
    assert _verdict(code=acr.SCOPE_CLEAR, agent="skipped", jobs=skipped_call, detail="no Agent paths changed") == ("success", "no Agent paths changed")
    assert _verdict() == ("success", "all 18 Agent jobs passed on the merge group's commit")


def test_MQ_the_verdict_is_success_for_exactly_those_two_and_never_pending():
    """Every combination of the scope job's result, its code, the Agent call's result and the job list: 6 x 7 x 6 x 6."""
    one_red = [{"name": CALL + n, "conclusion": "failure" if n == JOBS[3] else "success"} for n in JOBS]
    job_lists = {"green": _listed(), "one red": one_red, "one missing": _listed(JOBS[1:]), "none": [], "error": {"error": "HTTP 502"}, "unread": None}
    results = ("success", "failure", "cancelled", "skipped", "", None)
    seen = {"success": 0, "failure": 0}
    for scope_result in results:
        for code in (*acr.SCOPE_CODES, "", "bogus", None):
            for agent in results:
                for label, jobs in job_lists.items():
                    state, reason = acr.decide_queue(scope_result, code, "d", agent, jobs, JOBS)
                    want = scope_result == "success" and (
                        (code == acr.SCOPE_CLEAR and agent == "skipped") or (code == acr.SCOPE_AGENT and agent == "success" and label == "green"))
                    assert state == ("success" if want else "failure"), (scope_result, code, agent, label, state, reason)
                    assert reason and len(reason) <= 140, (scope_result, code, agent, label, reason)
                    seen[state] += 1
    assert seen == {"success": 6 + 1, "failure": 6 * 7 * 6 * 6 - 7}, seen


@pytest.mark.parametrize("code", [acr.SCOPE_PROTECTED, acr.SCOPE_UNKNOWN])
def test_MQ_self_protected_and_unknown_fail_even_when_every_agent_job_is_green(code):
    state, reason = _verdict(code=code, detail="2 self-protected path(s), e.g. .github/workflows/agent-ci.yml")
    assert state == "failure"
    if code == acr.SCOPE_PROTECTED:
        assert reason == "2 self-protected path(s), e.g. .github/workflows/agent-ci.yml; its own run could vouch for itself: AUDIT's local evidence decides"
        # a long path is cut, the sentence that says who decides is not
        long = acr.decide_queue("success", code, "1 self-protected path(s), e.g. " + "app/scripts/" + "x" * 300, "skipped", [], JOBS)[1]
        assert len(long) == 140 and long.endswith("AUDIT's local evidence decides")


@pytest.mark.parametrize("bad", ["failure", "skipped", "cancelled", None, "neutral", "timed_out"])
def test_MQ_any_called_job_not_success_is_failure(bad):
    for name in JOBS:
        jobs = [{"name": CALL + n, "conclusion": bad if n == name else "success"} for n in JOBS]
        assert _verdict(jobs=jobs)[0] == "failure", name
    # ... also when a second entry for the same job is green (a re-run listed twice): any non-success decides
    twice = _listed() + [{"name": CALL + JOBS[0], "conclusion": bad}]
    assert _verdict(jobs=twice)[0] == "failure"


def test_MQ_a_missing_called_job_is_failure():
    for name in JOBS:
        state, reason = _verdict(jobs=_listed([n for n in JOBS if n != name]))
        assert state == "failure" and "missing" in reason, name
    assert _verdict(jobs=[])[0] == "failure"
    assert _verdict(required=[])[0] == "failure"             # agent-ci.yml named no job at all


def test_MQ_jobs_count_only_under_the_calling_jobs_name():
    """The API lists a called job as "agent / <name>". The same names bare, under another caller, or the skipped call
    itself are not the Agent jobs of this run."""
    assert _verdict(jobs=_listed(prefix=""))[0] == "failure"
    assert _verdict(jobs=_listed(prefix="other / "))[0] == "failure"
    assert _verdict(jobs=_listed(prefix="agent/"))[0] == "failure"
    assert _verdict(jobs=[{"name": acr.QUEUE_CALL_JOB, "conclusion": "success"}])[0] == "failure"
    assert _verdict(jobs=_listed(prefix=CALL))[0] == "success"                                   # control


@pytest.mark.parametrize("jobs", [None, {"error": "HTTP 502"}, {}, "x"])
def test_MQ_an_unreadable_job_list_is_failure(jobs):
    state, reason = acr.decide_queue("success", acr.SCOPE_AGENT, "d", "success", jobs, JOBS)
    assert state == "failure" and "could not read" in reason


@pytest.mark.parametrize("agent", ["failure", "cancelled", "skipped", "", None])
def test_MQ_the_calls_own_result_must_be_success_too(agent):
    assert _verdict(agent=agent)[0] == "failure"


@pytest.mark.parametrize("agent", ["success", "failure", "cancelled", "", None])
def test_MQ_no_agent_paths_with_an_agent_call_that_was_not_skipped_is_failure(agent):
    assert _verdict(code=acr.SCOPE_CLEAR, agent=agent)[0] == "failure"


# ---- the queued PR's own diff, from git objects (a throwaway repository; no network) ------------------------------------
def _git(repo, *a):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a", *a],
                          check=True, capture_output=True, text=True).stdout.strip()


def _commit(repo, msg, files=(), delete=()):
    for rel, body in dict(files).items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body.encode("utf-8"))
    for rel in delete:
        (repo / rel).unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "--allow-empty", "-m", msg)
    return _git(repo, "rev-parse", "HEAD")


AGENT_CI_TEXT = (ROOT / ".github" / "workflows" / "agent-ci.yml").read_text(encoding="utf-8")
VITEST_CONFIG = "export default {test: {setupFiles: ['./src/test-setup.js']}}\n"


def _queue_repo(tmp_path, pr_files, pr_delete=(), with_config=True, number=7):
    """What GitHub builds for one queued PR, and what the scope job has on disk.
    origin: start -> `base` (master + an ENTRY AHEAD that itself edits an Agent path and a workflow), start -> the PR's
    head, and the merge group commit = merge(base, head) on gh-readonly-queue/master/pr-<N>-<base>. master stays at `base`.
    work: a depth-1 clone of master only, as actions/checkout leaves the default branch; it does not hold the merge group."""
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "master")
    _git(origin, "config", "uploadpack.allowAnySHA1InWant", "true")
    start_files = {"README.md": "r\n", "old-name.txt": "same body\n", ".github/workflows/agent-ci.yml": AGENT_CI_TEXT,
                   "app/src/agent/a.js": "a\n", "app/src/test-setup.js": "s\n"}
    if with_config:
        start_files["app/vitest.config.js"] = VITEST_CONFIG
    start = _commit(origin, "start", start_files)
    _git(origin, "checkout", "-q", "-b", "feature")
    head = _commit(origin, "the queued PR", pr_files, pr_delete)
    _git(origin, "checkout", "-q", "master")
    base = _commit(origin, "an entry ahead in the queue", {"app/src/agent/ahead.js": "x\n", ".github/workflows/ahead.yml": "name: x\n"})
    ref = f"gh-readonly-queue/master/pr-{number}-{base}"
    _git(origin, "checkout", "-q", "-b", ref)
    _git(origin, "merge", "-q", "--no-ff", "-m", "merge group", "feature")
    merge = _git(origin, "rev-parse", "HEAD")
    _git(origin, "checkout", "-q", "master")
    work = tmp_path / "work"
    subprocess.run(["git", "clone", "-q", "--depth=1", "--branch", "master", origin.as_uri(), str(work)], check=True, capture_output=True)
    assert _git(work, "rev-parse", "HEAD") == base
    assert subprocess.run(["git", "-C", str(work), "cat-file", "-e", merge], capture_output=True).returncode != 0   # not fetched yet
    return types.SimpleNamespace(origin=origin, work=work, start=start, base=base, head=head, merge=merge, ref="refs/heads/" + ref)


def test_MQ_the_diff_is_the_queued_prs_own_change_and_nothing_of_the_entries_ahead(tmp_path):
    r = _queue_repo(tmp_path, {"docs/new.md": "n\n", "README.md": "r2\n", "new-name.txt": "same body\n"}, pr_delete=["old-name.txt"])
    got = acr.merge_group_changed_paths(r.work, r.base, r.merge)
    # the rename lists BOTH names; the entry ahead's app/src/agent/ahead.js and workflow are not this PR's
    assert sorted(got) == ["README.md", "docs/new.md", "new-name.txt", "old-name.txt"]
    assert acr.decide_scope(got, PATHS, PROTECTED)[0] == acr.SCOPE_CLEAR
    # control: the diff a wrong base WOULD give holds the entry ahead (an Agent path and a workflow), which is why a
    # head whose first parent is not base_sha is refused, never diffed
    wider = _git(r.origin, "diff", "--no-renames", "--name-only", r.start, r.merge).split()
    assert "app/src/agent/ahead.js" in wider and ".github/workflows/ahead.yml" in wider
    assert acr.merge_group_changed_paths(r.work, r.start, r.merge) is None


def test_MQ_an_unreadable_diff_is_unknown_never_empty(tmp_path):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    read = lambda base, head, **kw: acr.merge_group_changed_paths(r.work, base, head, **kw)   # noqa: E731
    assert read(r.base, r.merge) == ["README.md"]                                # control: this repository can answer
    assert read(r.base, r.head) is None                                          # the PR head: one parent, not a merge group
    assert read(r.head, r.merge) is None                                         # the SECOND parent given as the base
    assert read(r.merge, r.base) is None                                         # swapped
    assert read(r.base, "f" * 40) is None                                        # a commit origin does not have: the fetch fails
    assert read("f" * 40, r.merge) is None
    calls = []

    def spy(argv, **kw):
        calls.append(argv)
        return subprocess.run(argv, **kw)
    for bad in ("", None, r.merge[:39], r.merge.upper(), r.merge + "\n", "--upload-pack=x", "HEAD", "refs/heads/master", 7, [r.merge]):
        assert acr.merge_group_changed_paths(r.work, r.base, bad, run=spy) is None, bad
        assert acr.merge_group_changed_paths(r.work, bad, r.merge, run=spy) is None, bad
    assert calls == [], "a value that is not a 40-hex commit must never reach git"
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge, run=spy) == ["README.md"] and len(calls) == 3   # fetch, cat-file, diff

    def broken(argv, **kw):
        raise OSError("no git here")
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge, run=broken) is None
    for fail in ("fetch", "cat-file", "diff"):
        def failing(argv, _f=fail, **kw):
            p = subprocess.run(argv, **kw)
            return types.SimpleNamespace(returncode=1, stdout=p.stdout) if _f in argv else p
        assert acr.merge_group_changed_paths(r.work, r.base, r.merge, run=failing) is None, fail


def test_MQ_without_the_fetch_the_merge_group_is_not_on_disk(tmp_path):
    """The scope job's checkout is master's, so the fetch is what brings the merge group in (its objects only)."""
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge, fetch=False) is None
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge) == ["README.md"]
    assert _git(r.work, "rev-parse", "HEAD") == r.base and (r.work / "README.md").read_text(encoding="utf-8") == "r\n"   # nothing checked out


def test_MQ_a_queued_pr_that_changes_nothing_is_an_empty_diff_not_an_unknown_one(tmp_path):
    r = _queue_repo(tmp_path, {})
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge) == []


@pytest.mark.parametrize("pr_files,code", [
    ({"README.md": "r2\n", "docs/x.md": "x\n"}, "no-agent-paths"),
    ({"app/src/agent/a.js": "a2\n"}, "agent-paths"),
    ({"README.md": "r2\n", "api/services/uct_agent/new.py": "x = 1\n"}, "agent-paths"),
    ({".github/workflows/other.yml": "name: y\n"}, "self-protected"),
    ({".github/workflows/agent-ci.yml": AGENT_CI_TEXT + "# edited\n"}, "self-protected"),
    ({"app/src/agent/a.js": "a2\n", "requirements.txt": "x\n"}, "self-protected"),
    ({"app/src/test-setup.js": "s2\n"}, "self-protected"),                    # derived from master's vitest config
    ({"app/vitest.config.js": "export default {test: {setupFiles: ['./src/other.js']}}\n"}, "self-protected"),
])
def test_MQ_scope_end_to_end_on_a_real_merge_group(tmp_path, pr_files, code):
    r = _queue_repo(tmp_path, pr_files)
    doc = acr.load_agent_ci(r.work)
    out = acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, r.merge)
    assert (out["code"], out["pr"]) == (code, 7), out
    # each way the event can fail to describe this merge group is `unknown`, never the code above
    assert acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, r.base)["code"] == "unknown"          # GITHUB_SHA is another commit
    assert acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, "")["code"] == "unknown"
    assert acr.queue_scope(r.work, doc, r.merge, r.start, r.ref, r.merge)["code"] == "unknown"        # not its first parent
    assert acr.queue_scope(r.work, doc, r.head, r.base, r.ref, r.head)["code"] == "unknown"           # not a merge group
    for ref in ("refs/heads/master", "refs/heads/feature", "refs/pull/7/merge", "", None):
        got = acr.queue_scope(r.work, doc, r.merge, r.base, ref, r.merge)
        assert (got["code"], got["pr"]) == ("unknown", None), ref


def test_MQ_scope_is_unknown_when_masters_protected_list_cannot_be_read(tmp_path):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"}, with_config=False)       # no vite / vitest config under root
    out = acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)
    assert out["code"] == "unknown" and "self-protected path list" in out["detail"], out


# ---- the two stages as the workflow runs them --------------------------------------------------------------------------
def test_MQ_the_scope_stage_writes_three_plain_outputs_and_needs_no_token(tmp_path, monkeypatch, capsys):
    r = _queue_repo(tmp_path, {"app/src/agent/a.js": "a2\n"})
    out = tmp_path / "github_output.txt"
    monkeypatch.setenv("GITHUB_SHA", r.merge)
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    for var in ("GITHUB_TOKEN", "GITHUB_REPOSITORY"):
        monkeypatch.delenv(var, raising=False)
    argv = ["--event", "merge_group", "--stage", "scope", f"--sha={r.merge}", f"--base={r.base}", f"--head-ref={r.ref}", "--root", str(r.work)]
    assert acr.main(argv) == 0
    assert out.read_text(encoding="utf-8") == "code=agent-paths\npr=7\ndetail=Agent paths changed\n"
    assert json.loads(capsys.readouterr().out)["code"] == "agent-paths"
    # a code that is a failure is still exit 0: the verdict stage is the one that judges and posts
    out.write_text("", encoding="utf-8")
    assert acr.main([*argv[:6], "--head-ref=refs/heads/master", "--root", str(r.work)]) == 0
    assert out.read_text(encoding="utf-8").splitlines()[:2] == ["code=unknown", "pr="]


def test_MQ_an_output_is_one_plain_line_whatever_a_file_is_called(tmp_path):
    """The detail names a path from the queued PR, and a job output is a `key=value` LINE: a newline in a file name must
    never become a second output (e.g. a forged `code=`)."""
    hostile = "1 self-protected path(s), e.g. a\ncode=no-agent-paths\r\npr=1<<EOF$(id)`id`\x00 x"
    out = tmp_path / "o.txt"
    acr.write_outputs({"code": "self-protected", "pr": 7, "detail": hostile}, out)
    lines = out.read_bytes().decode("utf-8").split("\n")
    assert lines[:2] == ["code=self-protected", "pr=7"] and lines[3:] == [""] and lines[2].startswith("detail=1 self-protected path(s), e.g. a?code")
    assert not set(lines[2]) & set("\r\n\x00$`<> ") and len(lines[2]) <= len("detail=") + 100
    assert acr._safe("AUDIT's (x), y: z/a.b_c-d@e+f") == "AUDIT's (x), y: z/a.b_c-d@e+f"        # control: ordinary text is kept
    acr.write_outputs({"code": "x"}, None)                                                       # no GITHUB_OUTPUT: prints only


class _StatusApi:
    """The verdict stage's API: this run's jobs (GET), then one status (POST)."""
    def __init__(self, jobs=None, fail_get=False, fail_post=False):
        self.jobs, self.fail_get, self.fail_post, self.posted = jobs, fail_get, fail_post, []

    def __call__(self, token, repo, base=None):          # stands in for the Api class
        assert (token, repo) == ("t", "o/r")
        return self

    def get(self, path):
        assert path.startswith("actions/runs/55/jobs?filter=latest&per_page=100&page="), path
        if self.fail_get:
            raise acr.ApiError(f"GET {path}: HTTP 502")
        return {"jobs": self.jobs if self.jobs is not None else _listed()}

    def call(self, method, path, body=None):
        assert method == "POST"
        if self.fail_post:
            raise acr.ApiError(f"POST {path}: HTTP 403")
        self.posted.append((path, body))


def _verdict_cli(monkeypatch, api, code="agent-paths", scope="success", agent="success", detail="Agent paths changed", extra=()):
    monkeypatch.setattr(acr, "Api", api)
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.delenv("TARGET_URL", raising=False)
    return acr.main(["--event", "merge_group", "--stage", "verdict", f"--sha={SHA}", "--run-id=55", f"--scope-result={scope}",
                     f"--scope-code={code}", f"--scope-detail={detail}", f"--agent-result={agent}", "--root", str(ROOT), *extra])


def test_MQ_the_verdict_stage_posts_one_status_on_the_merge_groups_commit(monkeypatch):
    api = _StatusApi()
    assert _verdict_cli(monkeypatch, api) == 0
    assert api.posted == [(f"statuses/{SHA}", {"state": "success", "context": "agent-ci-required",
                                               "description": "all 18 Agent jobs passed on the merge group's commit"})]
    red = _StatusApi(jobs=_listed(JOBS[:-1]))
    assert _verdict_cli(monkeypatch, red) == 1                         # the run is red when the status is
    assert [b["state"] for _, b in red.posted] == ["failure"]
    clear = _StatusApi(fail_get=True)                                  # no Agent path: the job list is never read
    assert _verdict_cli(monkeypatch, clear, code="no-agent-paths", agent="skipped") == 0 and clear.posted[0][1]["state"] == "success"
    prot = _StatusApi()
    assert _verdict_cli(monkeypatch, prot, code="self-protected", agent="skipped", detail="1 self-protected path(s), e.g. pytest.ini") == 1
    assert prot.posted[0][1]["state"] == "failure" and "AUDIT's local evidence decides" in prot.posted[0][1]["description"]


def test_MQ_the_verdict_stage_fails_closed_on_api_errors(monkeypatch):
    unread = _StatusApi(fail_get=True)
    assert _verdict_cli(monkeypatch, unread) == 1
    assert unread.posted[0][1]["state"] == "failure" and "could not read" in unread.posted[0][1]["description"]
    # a status that cannot be POSTed is never reported as posted: the stage raises, the job is red, the commit has no status
    with pytest.raises(acr.ApiError):
        _verdict_cli(monkeypatch, _StatusApi(fail_post=True))
    dry = _StatusApi()
    assert _verdict_cli(monkeypatch, dry, extra=["--dry-run"]) == 0 and dry.posted == []


@pytest.mark.parametrize("argv", [
    ["--event", "merge_group", "--sha", SHA, "--run-id", "55"],                                        # no stage
    ["--event", "merge_group", "--stage", "verdict", "--sha", SHA],                                    # no run id
    ["--event", "merge_group", "--stage", "verdict", "--sha", SHA[:39], "--run-id", "55"],             # not a commit
    ["--event", "merge_group", "--stage", "verdict", "--sha", "refs/heads/master", "--run-id", "55"],
])
def test_MQ_a_verdict_call_that_names_no_commit_or_run_posts_nothing(monkeypatch, argv):
    api = _StatusApi()
    monkeypatch.setattr(acr, "Api", api)
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    assert acr.main([*argv, "--scope-result=success", "--scope-code=no-agent-paths", "--agent-result=skipped", "--root", str(ROOT)]) == 2
    assert api.posted == []


def test_MQ_the_pull_request_and_workflow_run_paths_are_the_ones_they_were(monkeypatch, capsys):
    """Adding the merge_group stages changed no existing call: the same two commands still evaluate through the same
    functions, and a merge_group flag does nothing to them."""
    class Api(FakeApi):
        def __init__(self, token, repo, base=None):
            super().__init__(files=[AGENT_FILE], runs=[GREEN])
            self.posted = []
            made.append(self)

        def call(self, method, path, body=None):
            self.posted.append((method, path, body))
    made = []
    monkeypatch.setattr(acr, "Api", Api)
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.delenv("TARGET_URL", raising=False)
    assert acr.main(["--event", "pull_request", "--sha", SHA, "--pr", "1", "--root", str(ROOT), "--stage", "verdict", "--scope-code", "self-protected"]) == 0
    assert made[-1].posted == [("POST", f"statuses/{SHA}", {"state": "success", "context": "agent-ci-required",
                                                            "description": "agent ci run passed all 18 required jobs"})]
    assert acr.run_jobs(FakeApi(), 9) == [{"name": n, "conclusion": "success"} for n in JOBS]
