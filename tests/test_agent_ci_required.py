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
    # 2026-11-22: pull_request -> pull_request_target, master only. The status is posted with a GitHub App whose key
    # lives in an environment only master may use, and a `pull_request` job runs on refs/pull/N/merge. The types are
    # the ones they were. Shape and safety rails: tests/test_ci_agent_merge_ref.py (pr_stage_violations).
    assert "pull_request" not in on and on["pull_request_target"]["branches"] == ["master"]
    assert set(on["pull_request_target"]["types"]) == {"opened", "synchronize", "reopened"}
    # the workflow's own token no longer writes anything (it was statuses: write): the App's token posts
    assert wf["permissions"] == {"contents": "read"}
    assert wf["jobs"]["status"]["permissions"] == {"actions": "read", "contents": "read", "pull-requests": "read"}
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
#    merge group's commit only for an Agent change, and the verdict (decided and posted by the trusted FOLLOWER,
#    agent-ci-queue-verdict.yml, which recomputes that scope) is success ONLY for "no Agent path" or "every Agent job
#    green in this run". A PR that needs Agent evidence AND edits a self-protected path is ALWAYS failure; one that touches
#    no Agent path needs none, whatever else it touches. The workflow's own shape: tests/test_ci_agent_merge_ref.py.
PROTECTED = ev.protected_patterns(ROOT)
WORKFLOW_FILE = ".github/workflows/web-start.yml"      # self-protected (any workflow) and NOT an Agent path
CALL = acr.QUEUE_CALL_JOB + " / "


def test_MQ_the_scope_code_for_each_kind_of_diff():
    assert acr.SCOPE_CODES == ("no-agent-paths", "agent-paths", "self-protected", "unknown")
    assert not acr.matches(WORKFLOW_FILE, PATHS) and not acr.matches(OTHER_FILE, PROTECTED)
    assert acr.decide_scope([OTHER_FILE], PATHS, PROTECTED) == (acr.SCOPE_CLEAR, "no Agent paths changed")
    assert acr.decide_scope([], PATHS, PROTECTED)[0] == acr.SCOPE_CLEAR
    assert acr.decide_scope([OTHER_FILE, AGENT_FILE], PATHS, PROTECTED) == (acr.SCOPE_AGENT, "Agent paths changed")
    # NO Agent path: no Agent evidence is needed, whether or not a self-protected path is touched (as on a pull request
    # today, where self-protected-diff exists only inside `verify`). The detail says so, and it is what the status shows.
    assert acr.decide_scope([WORKFLOW_FILE], PATHS, PROTECTED) == (
        acr.SCOPE_CLEAR, "no Agent paths changed (1 self-protected path(s) touched, no Agent evidence needed)")
    assert acr.decide_scope([OTHER_FILE, WORKFLOW_FILE, "requirements.txt", "app/package.json"], PATHS, PROTECTED) == (
        acr.SCOPE_CLEAR, "no Agent paths changed (3 self-protected path(s) touched, no Agent evidence needed)")
    # an Agent path AND a self-protected path: its own run could vouch for itself
    assert acr.decide_scope([AGENT_FILE, WORKFLOW_FILE], PATHS, PROTECTED) == (
        acr.SCOPE_PROTECTED, "1 self-protected path(s), e.g. " + WORKFLOW_FILE)
    assert acr.decide_scope([AGENT_FILE, WORKFLOW_FILE], PATHS, [])[0] == acr.SCOPE_AGENT       # control: the list is what decides
    # an unreadable DIFF is never clear; an unreadable protected LIST is `unknown` only for a diff that needs Agent evidence
    for changed, protected in ((None, PROTECTED), (None, None), (None, []), ([AGENT_FILE], None), ([OTHER_FILE, AGENT_FILE], None)):
        assert acr.decide_scope(changed, PATHS, protected)[0] == acr.SCOPE_UNKNOWN, (changed, protected is None)
    # ... and a diff with NO Agent path needs no Agent evidence whatever that list says, even unreadable (2026-11-22: an
    # unreadable list failed EVERY entry, the pull request that repairs it included, so one bad config froze the queue)
    unreadable = "no Agent paths changed (the self-protected path list is unreadable, no Agent evidence needed)"
    for changed in ([OTHER_FILE], [], [WORKFLOW_FILE, "app/vite.config.js"]):
        assert acr.decide_scope(changed, PATHS, None) == (acr.SCOPE_CLEAR, unreadable), changed
    assert acr.decide_queue("success", acr.SCOPE_CLEAR, unreadable, "skipped", None, []) == ("success", unreadable)
    # every detail the scope stage can write survives the one-line job-output filter unchanged (it is cut at 100)
    for changed, protected in (([OTHER_FILE], None), ([WORKFLOW_FILE] * 250, PROTECTED), ([AGENT_FILE], None), (None, None)):
        detail = acr.decide_scope(changed, PATHS, protected)[1]
        assert acr._safe(detail) == detail, detail


#: self-protected paths that are ALSO Agent paths: an edit to one needs Agent evidence all by itself. The second and
#: third are the queue's own judge and the pull-request side's: Agent paths since 2026-11-22 (AUDIT F2 on #2501, "every
#: workflow that holds statuses: write or decides an Agent verdict belongs on that list").
PROTECTED_AND_AGENT = [
    ".github/workflows/agent-ci.yml", ".github/workflows/agent-ci-queue.yml", ".github/workflows/agent-ci-required.yml",
    ".github/workflows/agent-ci-queue-verdict.yml",
    "tests/test_ci_agent_merge_ref.py", "tests/test_agent_ci_required.py", "tests/test_agent_ci_evidence.py",    # AUDIT review 2
    "tools/agent_ci_required.py", "tools/agent_ci_evidence.py", "tools/agent_ci_rearm.py",
    "tools/agent_suite_lock.py", "tools/agent_vitest_shards.py", "tools/agent_vitest_shard_timings.json",
]
#: self-protected paths that are NOT Agent paths: alone they need no Agent evidence
PROTECTED_NOT_AGENT = [
    WORKFLOW_FILE, ".github/workflows/new.yml", ".github/workflows/gate-static-rails-pr.yml",
    ".github/actions/pine-heavy-setup/action.yml",
    "app/package.json", "app/package-lock.json", "app/vite.config.js", "app/scripts/chartLibraryPatch.mjs",
    "app/src/test-setup.js", "app/src/lib/marketClock/calendarCompact.js",
    "pytest.ini", "conftest.py", "tests/conftest.py", "requirements.txt", "api/requirements.txt",
]


def test_MQ_the_two_lists_of_self_protected_examples_are_what_they_say():
    """Control for the two rails below: each example IS self-protected, and the split is the real path lists' split."""
    for path in PROTECTED_AND_AGENT + PROTECTED_NOT_AGENT:
        assert acr.matches(path, PROTECTED), path
    assert [p for p in PROTECTED_AND_AGENT if not acr.matches(p, PATHS)] == []
    assert [p for p in PROTECTED_NOT_AGENT if acr.matches(p, PATHS)] == []


@pytest.mark.parametrize("path", PROTECTED_AND_AGENT + PROTECTED_NOT_AGENT)
def test_MQ_a_self_protected_path_beside_an_agent_path_is_never_agent_paths(path):
    """Design 3.4, as corrected 2026-11-22: in a merge group the workflow, the tools, the test config and the
    dependencies come from the merge group's commit. A queued PR that NEEDS Agent evidence and edits one of them could
    vouch for itself: `self-protected`, never `agent-paths` and never clear."""
    for diff in ([AGENT_FILE, path], [path, AGENT_FILE, OTHER_FILE], [path, "api/services/uct_agent/x.py"]):
        code, detail = acr.decide_scope(diff, PATHS, PROTECTED)
        assert code == acr.SCOPE_PROTECTED and path in detail and "self-protected" in detail, (diff, code, detail)


@pytest.mark.parametrize("path", PROTECTED_AND_AGENT)
def test_MQ_a_self_protected_agent_path_needs_agent_evidence_all_by_itself(path):
    for diff in ([path], [OTHER_FILE, path]):
        assert acr.decide_scope(diff, PATHS, PROTECTED)[0] == acr.SCOPE_PROTECTED, diff


@pytest.mark.parametrize("path", PROTECTED_NOT_AGENT)
def test_MQ_a_self_protected_path_with_no_agent_path_needs_no_agent_evidence(path):
    """Today's rule on a pull request (self-protected-diff exists only inside `verify`, i.e. only for a PR that needs
    Agent evidence), kept in the queue: 35 of 718 merges on 2026-11-17..21 were of this kind. The status still says so."""
    for diff in ([path], [OTHER_FILE, path]):
        assert acr.decide_scope(diff, PATHS, PROTECTED) == (
            acr.SCOPE_CLEAR, "no Agent paths changed (1 self-protected path(s) touched, no Agent evidence needed)"), diff


def test_MQ_ordinary_agent_paths_are_not_self_protected():
    """Control for the rail above: the protected list does not swallow the Agent's own code."""
    for path in ("app/src/agent/a.js", "tools/agent_ownership_check.py", "tests/test_uct_agent_x.py", "docs/agent/program/INTEGRATION.md",
                 "app/src/pages/charts/ChartsWorkspace.jsx", "api/services/uct_agent/x.py"):
        assert acr.decide_scope([path], PATHS, PROTECTED)[0] == acr.SCOPE_AGENT, path


# ---- the verdict ----------------------------------------------------------------------------------------------------
def _listed(names=None, conclusion="success", prefix=CALL):
    """A merge-group run's jobs as the API lists them: the called Agent jobs under "agent / ", plus the run's own scope job."""
    return [{"name": prefix + n, "conclusion": conclusion} for n in (JOBS if names is None else names)] + \
           [{"name": "agent-ci-queue scope", "conclusion": "success"}]


def _verdict(scope_result="success", code=acr.SCOPE_AGENT, agent="success", jobs=None, detail="Agent paths changed", required=JOBS):
    return acr.decide_queue(scope_result, code, detail, agent, _listed() if jobs is None else jobs, required)


def test_MQ_the_two_ways_to_success():
    skipped_call = [{"name": acr.QUEUE_CALL_JOB, "conclusion": "skipped"}, {"name": "agent-ci-queue scope", "conclusion": "success"}]
    assert _verdict(code=acr.SCOPE_CLEAR, agent="skipped", jobs=skipped_call, detail="no Agent paths changed") == ("success", "no Agent paths changed")
    # the scope stage's sentence is the status description, so "self-protected path(s) touched" is visible on the commit;
    # it survives the job-output sanitiser unchanged; and a detail that is not that sentence never becomes a success text
    touched = acr.decide_scope([WORKFLOW_FILE, "requirements.txt"], PATHS, PROTECTED)[1]
    assert touched == "no Agent paths changed (2 self-protected path(s) touched, no Agent evidence needed)" and acr._safe(touched) == touched
    assert _verdict(code=acr.SCOPE_CLEAR, agent="skipped", jobs=skipped_call, detail=touched) == ("success", touched)
    for odd in ("", None, "all 18 Agent jobs passed", "x" * 300):
        assert _verdict(code=acr.SCOPE_CLEAR, agent="skipped", jobs=skipped_call, detail=odd) == ("success", "no Agent paths changed")
    assert len(_verdict(code=acr.SCOPE_CLEAR, agent="skipped", jobs=skipped_call, detail="no Agent paths changed " + "x" * 300)[1]) == 140
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


AHEAD_FILES = {"app/src/agent/ahead.js": "x\n", ".github/workflows/ahead.yml": "name: x\n"}


def _queue_repo(tmp_path, pr_files, pr_delete=(), with_config=True, number=7, ahead_files=None, landed=True):
    """What GitHub builds for one queued PR, and what the scope job has on disk.
    origin: start -> `base` (an ENTRY AHEAD that itself edits an Agent path and a workflow, or `ahead_files`), start ->
    the PR's head, and the merge group commit = merge(base, head) on gh-readonly-queue/master/pr-<N>-<base>.
    landed=True: the entry ahead has landed, master is at `base`. landed=False: it is still in the queue, on its own
    queue branch, and master is at `start` (a STACKED entry: its base is not on master yet).
    work: a depth-1 clone of master only, as actions/checkout leaves the default branch; it does not hold the merge group.
    The clone takes a plain path with --no-local (2026-11-22, AUDIT F4): a file:///C:/... URL is refused by some Git for
    Windows builds, and without --no-local a local clone ignores --depth and copies every object, the merge group too."""
    origin = tmp_path / "origin"
    origin.mkdir(parents=True)
    _git(origin, "init", "-q", "-b", "master")
    _git(origin, "config", "uploadpack.allowAnySHA1InWant", "true")
    _git(origin, "config", "uploadpack.allowFilter", "true")          # as GitHub's server does
    start_files = {"README.md": "r\n", "old-name.txt": "same body\n", ".github/workflows/agent-ci.yml": AGENT_CI_TEXT,
                   "app/src/agent/a.js": "a\n", "app/src/test-setup.js": "s\n"}
    if with_config:
        start_files["app/vitest.config.js"] = VITEST_CONFIG
    start = _commit(origin, "start", start_files)
    _git(origin, "checkout", "-q", "-b", "feature")
    head = _commit(origin, "the queued PR", pr_files, pr_delete)
    _git(origin, "checkout", "-q", "master")
    if not landed:
        _git(origin, "checkout", "-q", "-b", f"gh-readonly-queue/master/pr-{number - 1}-{start}")
    base = _commit(origin, "an entry ahead in the queue", AHEAD_FILES if ahead_files is None else ahead_files)
    ref = f"gh-readonly-queue/master/pr-{number}-{base}"
    _git(origin, "checkout", "-q", "-b", ref)
    _git(origin, "merge", "-q", "--no-ff", "-m", "merge group", "feature")
    merge = _git(origin, "rev-parse", "HEAD")
    _git(origin, "checkout", "-q", "master")
    work = tmp_path / "work"
    subprocess.run(["git", "clone", "-q", "--no-local", "--depth=1", "--branch", "master", str(origin), str(work)],
                   check=True, capture_output=True)
    assert _git(work, "rev-parse", "HEAD") == (base if landed else start)
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
    # a ONE-parent commit sitting right on its base (what a squash or rebase queue would build) is not a merge group
    # either: the rule is "a two-parent merge whose first parent is base_sha", not "whose parent is base_sha"
    assert read(r.start, r.head) is None and read(r.start, r.base) is None
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
    # an Agent path AND a self-protected path: its own run could vouch for itself
    ({".github/workflows/agent-ci.yml": AGENT_CI_TEXT + "# edited\n"}, "self-protected"),      # both at once
    ({"app/src/agent/a.js": "a2\n", "requirements.txt": "x\n"}, "self-protected"),
    ({"app/src/agent/a.js": "a2\n", ".github/workflows/other.yml": "name: y\n"}, "self-protected"),
    ({"app/src/agent/a.js": "a2\n", "app/src/test-setup.js": "s2\n"}, "self-protected"),    # derived from master's vitest config
    ({"app/src/agent/a.js": "a2\n", "app/vitest.config.js": "export default {test: {setupFiles: ['./src/other.js']}}\n"}, "self-protected"),
    # a self-protected path and NO Agent path: no Agent evidence needed
    ({".github/workflows/other.yml": "name: y\n"}, "no-agent-paths"),
    ({"app/src/test-setup.js": "s2\n", "requirements.txt": "x\n"}, "no-agent-paths"),
])
def test_MQ_scope_end_to_end_on_a_real_merge_group(tmp_path, pr_files, code):
    r = _queue_repo(tmp_path, pr_files)
    doc = acr.load_agent_ci(r.work)
    out = acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, r.merge)
    assert (out["code"], out["pr"]) == (code, 7), out
    touched = [f for f in pr_files if acr.matches(f, ev.protected_patterns(r.work))]
    if code == "no-agent-paths":
        want = f" ({len(touched)} self-protected path(s) touched, no Agent evidence needed)" if touched else ""
        assert out["detail"] == "no Agent paths changed" + want, out
    # each way the event can fail to describe this merge group is `unknown`, never the code above
    assert acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, r.base)["code"] == "unknown"          # GITHUB_SHA is another commit
    assert acr.queue_scope(r.work, doc, r.merge, r.base, r.ref, "")["code"] == "unknown"
    assert acr.queue_scope(r.work, doc, r.merge, r.start, r.ref, r.merge)["code"] == "unknown"        # not its first parent
    assert acr.queue_scope(r.work, doc, r.head, r.base, r.ref, r.head)["code"] == "unknown"           # not a merge group
    for ref in ("refs/heads/master", "refs/heads/feature", "refs/pull/7/merge", "", None):
        got = acr.queue_scope(r.work, doc, r.merge, r.base, ref, r.merge)
        assert (got["code"], got["pr"]) == ("unknown", None), ref


def test_MQ_an_unreadable_protected_list_fails_only_an_entry_that_needs_agent_evidence(tmp_path):
    """master with no vite / vitest config under root: the derived protected list cannot be read. An entry that touches
    an Agent path is `unknown` (fail closed). An entry that touches none is not held up by it, and says so."""
    r = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"}, with_config=False)
    out = acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)
    assert out["code"] == "unknown" and out["detail"] == "the self-protected path list could not be read", out
    r = _queue_repo(tmp_path / "plain", {"README.md": "r2\n", "app/vitest.config.js": VITEST_CONFIG}, with_config=False)   # the repair
    out = acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)
    assert (out["code"], out["detail"]) == (
        "no-agent-paths", "no Agent paths changed (the self-protected path list is unreadable, no Agent evidence needed)"), out


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


def test_MQ_an_output_is_one_plain_line_whatever_a_file_is_called(tmp_path, monkeypatch):
    """The detail names a path from the queued PR, and a job output is a `key=value` LINE: a newline in a file name must
    never become a second output (e.g. a forged `code=`)."""
    hostile = "1 self-protected path(s), e.g. a\ncode=no-agent-paths\r\npr=1<<EOF$(id)`id`\x00 x"
    out = tmp_path / "o.txt"
    acr.write_outputs({"code": "self-protected", "pr": 7, "detail": hostile}, out)
    lines = out.read_bytes().decode("utf-8").split("\n")
    assert lines[:2] == ["code=self-protected", "pr=7"] and lines[3:] == [""] and lines[2].startswith("detail=1 self-protected path(s), e.g. a?code")
    assert not set(lines[2]) & set("\r\n\x00$`<> ") and len(lines[2]) <= len("detail=") + 100
    assert acr._safe("AUDIT's (x), y: z/a.b_c-d@e+f") == "AUDIT's (x), y: z/a.b_c-d@e+f"        # control: ordinary text is kept
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)      # (inside Actions the variable is set: never write to the real one)
    acr.write_outputs({"code": "x"}, None)                                                       # no GITHUB_OUTPUT: writes nothing
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "env.txt"))
    acr.write_outputs({"code": "x"}, None)
    assert (tmp_path / "env.txt").read_text(encoding="utf-8") == "code=x" + chr(10)


# ---- THE TRUSTED FOLLOWER (AUDIT F1 on #2501): agent-ci-queue-verdict.yml, `--stage follow` ------------------------------
# It runs master's copy of the tool on master and posts with a GitHub App's token. It reads NOTHING the merge group's run
# says about itself: it recomputes the scope from the commit and re-reads the run's jobs.
import datetime  # noqa: E402

UTC = datetime.timezone.utc
#: Wednesday 2026-11-18 17:00 UTC = 12:00 in New York: a weekday, outside both freeze windows
OPEN_CLOCK = datetime.datetime(2026, 11, 18, 17, 0, tzinfo=UTC)
RUN_ID = 55


def _et(y, mo, d, h, mi, s=0):
    """An instant given as New York wall-clock time (the freeze windows' own terms), as an aware UTC datetime."""
    import zoneinfo
    return datetime.datetime(y, mo, d, h, mi, s, tzinfo=zoneinfo.ZoneInfo("America/New_York")).astimezone(UTC)


@pytest.mark.parametrize("at,window", [
    ((9, 19, 59), None), ((9, 20, 0), "09:20-09:45 ET"), ((9, 30, 0), "09:20-09:45 ET"), ((9, 45, 0), "09:20-09:45 ET"), ((9, 45, 1), None),
    ((12, 0, 0), None),
    ((15, 29, 59), None), ((15, 30, 0), "15:30-16:15 ET"), ((16, 0, 0), "15:30-16:15 ET"), ((16, 15, 0), "15:30-16:15 ET"), ((16, 15, 1), None),
    ((0, 0, 0), None), ((23, 59, 59), None), ((21, 30, 0), None),          # 09:30 PM is not 09:30
])
def test_MQ_the_freeze_windows_at_their_edges(at, window):
    for day in (16, 17, 18, 19, 20):                                       # Monday .. Friday, 2026-11-16..20
        assert acr.freeze_window(_et(2026, 11, day, *at)) == window, (day, at)
    for day in (21, 22):                                                   # Saturday, Sunday: never frozen
        assert acr.freeze_window(_et(2026, 11, day, *at)) is None, (day, at)
    assert acr.FREEZE_WINDOWS == (((9, 20), (9, 45)), ((15, 30), (16, 15))) and acr.FREEZE_TZ == "America/New_York"


def test_MQ_the_freeze_windows_follow_new_yorks_clock_across_a_daylight_saving_change():
    """The windows are wall-clock times in New York, so the UTC instant moves by an hour when the clocks change (US:
    2026-03-08 and 2026-11-01). The same UTC time of day is inside the window on one side and outside on the other."""
    utc = lambda y, mo, d, h, mi: datetime.datetime(y, mo, d, h, mi, tzinfo=UTC)   # noqa: E731
    # Friday 2026-03-06 is EST (UTC-5): 09:20 ET = 14:20Z. Monday 2026-03-09 is EDT (UTC-4): 09:20 ET = 13:20Z.
    assert acr.freeze_window(utc(2026, 3, 6, 13, 30)) is None and acr.freeze_window(utc(2026, 3, 6, 14, 30)) == "09:20-09:45 ET"
    assert acr.freeze_window(utc(2026, 3, 9, 13, 30)) == "09:20-09:45 ET" and acr.freeze_window(utc(2026, 3, 9, 14, 30)) is None
    # Friday 2026-10-30 is EDT: 15:30 ET = 19:30Z. Monday 2026-11-02 is EST: 15:30 ET = 20:30Z.
    assert acr.freeze_window(utc(2026, 10, 30, 19, 45)) == "15:30-16:15 ET" and acr.freeze_window(utc(2026, 10, 30, 20, 45)) is None
    assert acr.freeze_window(utc(2026, 11, 2, 19, 45)) is None and acr.freeze_window(utc(2026, 11, 2, 20, 45)) == "15:30-16:15 ET"
    # the instant decides, whatever zone it is written in: 09:30 in New York given as Tokyo time
    tokyo = datetime.timezone(datetime.timedelta(hours=9))
    assert acr.freeze_window(_et(2026, 11, 18, 9, 30).astimezone(tokyo)) == "09:20-09:45 ET"
    # a Friday evening in New York that is already Saturday in UTC is still a weekday; a Sunday evening that is Monday in UTC is not
    assert acr.freeze_window(datetime.datetime(2026, 11, 21, 0, 0, tzinfo=UTC)) is None             # Fri 19:00 ET, outside
    assert acr.freeze_window(_et(2026, 11, 22, 15, 45)) is None                                    # Sunday afternoon
    with pytest.raises(ValueError):
        acr.freeze_window(datetime.datetime(2026, 11, 18, 9, 30))        # a naive clock cannot be placed
    assert acr._utcnow().tzinfo is not None


class _RunApi:
    """The follower's READ side: the run's own description, then its jobs. Records every call; never posts."""
    def __init__(self, described=None, jobs=None, fail=None):
        self.described, self.jobs, self.fail, self.calls = described, jobs, fail, []

    def get(self, path):
        self.calls.append(path)
        if self.fail and self.fail in path:
            raise acr.ApiError(f"GET {path}: HTTP 502")
        if path == f"actions/runs/{RUN_ID}":
            return self.described
        assert path.startswith(f"actions/runs/{RUN_ID}/jobs?filter=latest&per_page=100&page="), path
        return {"jobs": _listed() if self.jobs is None else self.jobs}

    def call(self, *a, **k):
        raise AssertionError("the read token never posts")


def _follow(r, api=None, now=OPEN_CLOCK, ref=None, sha=None, log=None):
    return acr.follow_verdict(r.work, api or _RunApi(), RUN_ID, sha or r.merge, ref or r.ref, now, log=log or (lambda m: None))


def test_MQ_the_follower_recomputes_the_scope_and_needs_nothing_of_the_run_for_a_plain_entry(tmp_path):
    r = _queue_repo(tmp_path, {"README.md": "r2\n", ".github/workflows/other.yml": "name: y\n"})
    api = _RunApi(fail="actions/")                                # every API read would fail: none is made
    assert _follow(r, api) == ("success", "no Agent paths changed (1 self-protected path(s) touched, no Agent evidence needed)")
    assert api.calls == []
    assert _git(r.work, "rev-parse", "HEAD") == r.base and (r.work / "README.md").read_text(encoding="utf-8") == "r\n"   # nothing checked out
    # ... inside a freeze window too: the windows are for entries that need Agent evidence
    assert _follow(r, api, now=_et(2026, 11, 18, 9, 30))[0] == "success"


def test_MQ_the_follower_judges_an_agent_entry_by_the_runs_jobs(tmp_path):
    r = _queue_repo(tmp_path, {"app/src/agent/a.js": "a2\n"})
    lines = []
    assert _follow(r, log=lines.append) == ("success", "all 18 Agent jobs passed on the merge group's commit")
    assert any("recomputed scope for PR 7: agent-paths" in ln for ln in lines)
    for jobs, word in ((_listed(JOBS[1:]), "missing"), (_listed(conclusion="failure"), "not success"), (_listed(prefix=""), "missing"),
                       ([], "missing"), (_listed(prefix="other / "), "missing")):
        state, reason = _follow(r, _RunApi(jobs=jobs))
        assert state == "failure" and word in reason, (reason, word)
    state, reason = _follow(r, _RunApi(fail="/jobs"))
    assert state == "failure" and "could not read this run's jobs" in reason


def test_MQ_a_merge_group_run_that_lied_about_its_own_scope_changes_nothing(tmp_path):
    """AUDIT F1. The queued PR rewrote agent-ci-queue.yml's jobs (or its run simply says so): its `scope` job is green,
    its `agent` call was "skipped", the run concluded success. The follower reads none of that. The diff touches an
    Agent path, so it wants the 18 jobs, finds none, and fails."""
    r = _queue_repo(tmp_path, {"app/src/agent/a.js": "a2\n"})
    lied = [{"name": "agent-ci-queue scope", "conclusion": "success"}, {"name": "agent", "conclusion": "skipped"},
            {"name": "agent-ci-required verdict", "conclusion": "success"}]
    described = {"path": ".github/workflows/agent-ci-queue.yml", "event": "merge_group", "head_sha": r.merge,
                 "head_branch": r.ref[len("refs/heads/"):], "conclusion": "success", "status": "completed"}
    api = _RunApi(described=described, jobs=lied)
    a = types.SimpleNamespace(sha=r.merge, head_ref=r.ref[len("refs/heads/"):], run_event="merge_group", run_id=RUN_ID, root=str(r.work))
    state, reason = acr.follow(api, a, OPEN_CLOCK, log=lambda m: None)
    assert state == "failure" and "18 required Agent job(s) missing" in reason, reason
    # control: the same call with the real 18 green jobs is a success
    assert acr.follow(_RunApi(described=described), a, OPEN_CLOCK, log=lambda m: None)[0] == "success"
    # ... and follow_verdict takes no scope code, detail or conclusion from anyone: it has no such parameter
    import inspect
    assert list(inspect.signature(acr.follow_verdict).parameters) == ["root", "api", "run_id", "head_sha", "head_ref", "now", "run", "log"]


@pytest.mark.parametrize("pr_files,word", [
    ({".github/workflows/agent-ci.yml": AGENT_CI_TEXT + "# edited\n"}, "AUDIT's local evidence decides"),
    ({"app/src/agent/a.js": "a2\n", "requirements.txt": "x\n"}, "AUDIT's local evidence decides"),
])
def test_MQ_the_follower_fails_an_agent_entry_that_edits_what_its_own_run_executes(tmp_path, pr_files, word):
    r = _queue_repo(tmp_path, pr_files)
    api = _RunApi()
    state, reason = _follow(r, api)
    assert state == "failure" and word in reason and "self-protected path(s), e.g." in reason, reason
    assert api.calls == []                                        # all 18 jobs green would change nothing: they are not read


# ---- the entries AHEAD: every self-protected path byte-identical between the commit and the master it is built on ------
def test_MQ_an_agent_entry_behind_an_unlanded_machinery_edit_is_failed(tmp_path):
    """An entry ahead in the group edited a workflow and package.json. This entry's OWN diff is one Agent file, so its
    scope is `agent-paths`; but its jobs ran with the entry ahead's machinery, which master does not have."""
    ahead = {".github/workflows/ahead.yml": "name: x\n", "app/package.json": "{}\n", "README.md": "ahead\n"}
    r = _queue_repo(tmp_path / "stacked", {"app/src/agent/a.js": "a2\n"}, ahead_files=ahead, landed=False)
    api = _RunApi()
    state, reason = _follow(r, api)
    assert (state, reason) == ("failure", "2 self-protected path(s) differ from master, e.g. .github/workflows/ahead.yml"
                                          "; an entry ahead edits the Agent CI machinery: AUDIT decides") and len(reason) <= 140
    # a long path is cut, the sentence that says who decides is not
    long = {".github/workflows/" + "x" * 60 + ".yml": "name: x\n"}
    rl = _queue_repo(tmp_path / "long", {"app/src/agent/a.js": "a2\n"}, ahead_files=long, landed=False)
    cut = _follow(rl)[1]
    assert len(cut) == 140 and cut.endswith("; an entry ahead edits the Agent CI machinery: AUDIT decides") and cut.startswith("1 self-protected")
    assert api.calls == []                                        # decided before the jobs are read
    # control 1: the same entry once the one ahead has LANDED on master (master's machinery is then that machinery)
    r = _queue_repo(tmp_path / "landed", {"app/src/agent/a.js": "a2\n"}, ahead_files=ahead, landed=True)
    assert _follow(r)[0] == "success"
    # control 2: an entry ahead that edits nothing self-protected does not hold this one up
    r = _queue_repo(tmp_path / "plain-ahead", {"app/src/agent/a.js": "a2\n"}, ahead_files={"README.md": "ahead\n", "app/src/agent/ahead.js": "x\n"}, landed=False)
    assert _follow(r)[0] == "success"
    # control 3: an entry that needs NO Agent evidence is not held up by the edit ahead of it
    r = _queue_repo(tmp_path / "no-agent", {"docs/x.md": "x\n"}, ahead_files=ahead, landed=False)
    assert _follow(r)[0] == "success"


def test_MQ_master_base_is_the_master_commit_the_group_is_built_on(tmp_path):
    r = _queue_repo(tmp_path / "stacked", {"app/src/agent/a.js": "a2\n"}, landed=False)       # master = start; base_sha = the entry ahead
    assert _follow(r)[0] == "failure"                               # (brings the commits in; AHEAD_FILES holds a workflow)
    git = acr._git_reader(r.work, log=lambda m: None)
    assert acr.master_base(git, r.merge) == r.start != r.base       # NOT the first parent: that is an unlanded entry
    assert acr.master_base(git, r.base) == r.start                  # the entry ahead is built on master itself
    assert acr.master_base(git, "f" * 40) is None                   # unreadable chain
    assert acr.master_base(git, r.start) is None                    # master's tip itself: no commit AFTER it on its chain here
    hits = acr.machinery_edits(git, r.start, r.merge, PROTECTED)
    assert hits == [".github/workflows/ahead.yml"] and acr.machinery_edits(git, r.base, r.merge, PROTECTED) == []
    assert acr.machinery_edits(git, "f" * 40, r.merge, PROTECTED) is None
    r2 = _queue_repo(tmp_path / "landed", {"app/src/agent/a.js": "a2\n"}, landed=True)        # master = the entry ahead
    assert _follow(r2)[0] == "success"
    git2 = acr._git_reader(r2.work, log=lambda m: None)
    assert acr.master_base(git2, r2.merge) == r2.base
    # a depth that does not reach master: not found, never guessed
    assert acr.master_base(git, r.merge, depth=2) is None and acr.master_base(git, r.merge, depth=3) == r.start
    assert acr.FOLLOW_DEPTH == 50 and acr.FOLLOW_MASTER_REF == "refs/agent-ci-verdict/master" and acr.QUEUE_BASE_BRANCH == "master"


def test_MQ_the_follower_fails_closed_on_everything_it_cannot_read(tmp_path, monkeypatch):
    r = _queue_repo(tmp_path, {"app/src/agent/a.js": "a2\n"})
    assert _follow(r)[0] == "success"                                # control: this repository can be judged
    assert _follow(r, sha="f" * 40) == ("failure", "fail closed: the merge group's commit and master could not be fetched")
    assert _follow(r, sha=r.head) == ("failure", "fail closed: the merge group's commit is not a two-parent merge")      # a PR head
    assert _follow(r, sha=r.base) == ("failure", "fail closed: the merge group's commit is not a two-parent merge")      # squash / rebase shape
    state, reason = _follow(r, ref="refs/heads/master")
    assert state == "failure" and "names no queued pull request" in reason
    monkeypatch.setattr(acr, "master_base", lambda *a, **k: None)
    assert _follow(r) == ("failure", "fail closed: the master commit this merge group is built on was not found within 50 commits")
    monkeypatch.undo()
    monkeypatch.setattr(acr, "machinery_edits", lambda *a, **k: None)
    assert _follow(r) == ("failure", "fail closed: the Agent CI machinery could not be compared with master's")
    monkeypatch.undo()
    assert _follow(r)[0] == "success"


@pytest.mark.parametrize("at,window", [((9, 20), "09:20-09:45 ET"), ((9, 45), "09:20-09:45 ET"), ((15, 30), "15:30-16:15 ET"), ((16, 15), "15:30-16:15 ET")])
def test_MQ_an_agent_entry_is_failed_inside_a_freeze_window_and_a_plain_one_is_not(tmp_path, at, window):
    r = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"})
    api = _RunApi()
    state, reason = _follow(r, api, now=_et(2026, 11, 18, *at))
    assert (state, reason) == ("failure", f"deploy freeze window {window} on weekdays: an Agent entry does not land in it; queue it again afterwards")
    assert len(reason) <= 140 and api.calls == []
    assert _follow(r, now=_et(2026, 11, 18, at[0], at[1]) + datetime.timedelta(hours=1))[0] == "success"        # control: an hour later
    assert _follow(r, now=_et(2026, 11, 21, *at))[0] == "success"                                             # control: a Saturday
    plain = _queue_repo(tmp_path / "plain", {"README.md": "r2\n"})
    assert _follow(plain, now=_et(2026, 11, 18, *at))[0] == "success"


# ---- follow(): which runs are judged at all ------------------------------------------------------------------------------------
def _args(r, **over):
    base = dict(sha=r.merge, head_ref=r.ref[len("refs/heads/"):], run_event="merge_group", run_id=RUN_ID, root=str(r.work))
    return types.SimpleNamespace(**{**base, **over})


def _described(r, **over):
    return {"path": ".github/workflows/agent-ci-queue.yml", "event": "merge_group", "head_sha": r.merge,
            "head_branch": r.ref[len("refs/heads/"):], "name": "agent ci queue", **over}


def test_MQ_follow_posts_nothing_for_a_run_that_is_not_the_queue_workflows_merge_group_run(tmp_path):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    quiet = lambda m: None                                       # noqa: E731
    assert acr.follow(_RunApi(described=_described(r)), _args(r), OPEN_CLOCK, log=quiet) == ("success", "no Agent paths changed")   # control
    # the payload does not describe a merge group's run: nothing is read, nothing is posted
    for over in (dict(run_event="pull_request"), dict(run_event="push"), dict(run_event="workflow_dispatch"), dict(run_event=""),
                 dict(sha="refs/heads/master"), dict(sha=r.merge[:39]), dict(sha=""), dict(sha=None), dict(run_id=None), dict(run_id=0)):
        api = _RunApi(described=_described(r))
        assert acr.follow(api, _args(r, **over), OPEN_CLOCK, log=quiet) is None, over
        assert api.calls == [], over
    # the API describes the run otherwise: ANOTHER workflow file that names itself "agent ci queue", another event,
    # another commit, another branch, or nothing at all
    for over in (dict(path=".github/workflows/impostor.yml"), dict(path=".github/workflows/agent-ci-queue.yml@refs/heads/x"), dict(path=None),
                 dict(event="pull_request"), dict(head_sha=r.base), dict(head_branch="master"), dict(head_branch="refs/heads/" + r.ref)):
        assert acr.follow(_RunApi(described=_described(r, **over)), _args(r), OPEN_CLOCK, log=quiet) is None, over
    for nothing in (None, {}, {"message": "Not Found"}):
        assert acr.follow(_RunApi(described=nothing), _args(r), OPEN_CLOCK, log=quiet) is None


def test_MQ_follow_posts_a_failure_for_the_queue_workflows_run_it_cannot_judge(tmp_path, monkeypatch):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    quiet = lambda m: None                                       # noqa: E731
    # the run itself could not be read (after the retries the Api makes)
    assert acr.follow(_RunApi(fail="actions/runs"), _args(r), OPEN_CLOCK, log=quiet) == ("failure", "fail closed: the merge group's run could not be read")
    # it IS agent-ci-queue.yml's merge-group run, but on a queue branch that names no pull request into master
    other = "gh-readonly-queue/agent/int/pr-7-" + r.base
    assert acr.follow(_RunApi(described=_described(r, head_branch=other)), _args(r, head_ref=other), OPEN_CLOCK, log=quiet) == (
        "failure", "fail closed: the merge group's branch names no pull request into master")
    # anything that breaks while deciding is a failure to POST, never a crash that leaves no status
    for where in ("follow_verdict", "load_agent_ci", "queue_scope", "decide_queue", "commit_parents"):
        lines = []
        monkeypatch.setattr(acr, where, lambda *a, _w=where, **k: (_ for _ in ()).throw(RuntimeError("kaboom " + _w)))
        assert acr.follow(_RunApi(described=_described(r)), _args(r), OPEN_CLOCK, log=lines.append) == (
            "failure", "the verdict could not be computed (RuntimeError): fail closed"), where
        assert any("kaboom " + where in ln for ln in lines)        # the detail is in the job log, never in the status
        monkeypatch.undo()
    assert acr.follow(_RunApi(described=_described(r)), _args(r), OPEN_CLOCK, log=quiet)[0] == "success"


# ---- the stage as the workflow runs it: two tokens, one of which can post -------------------------------------------------
class _TwoTokens:
    """Stands in for acr.Api: each instance remembers its token; reads answer from a _RunApi, POSTs are recorded."""
    def __init__(self, reads, fail_post=False):
        self.reads, self.fail_post, self.made = reads, fail_post, []

    def __call__(self, token, repo, base=None, attempts=1):
        assert repo == "o/r" and attempts == acr.RETRY_ATTEMPTS == 3
        outer = self

        class One:
            def __init__(self):
                self.token, self.posted = token, []

            def get(self, path):
                assert token == "read-token", "only the read-only workflow token reads"
                return outer.reads.get(path)

            def call(self, method, path, body=None):
                assert method == "POST" and token == "app-token", "only the App's token posts"
                if outer.fail_post:
                    raise acr.ApiError(f"POST {path}: HTTP 403")
                self.posted.append((path, body))
        one = One()
        self.made.append(one)
        return one

    @property
    def posted(self):
        return [p for one in self.made for p in one.posted]


def _follow_cli(monkeypatch, r, api, extra=(), **over):
    monkeypatch.setattr(acr, "Api", api)
    monkeypatch.setattr(acr, "_utcnow", lambda: OPEN_CLOCK)
    monkeypatch.setenv("GITHUB_TOKEN", "read-token")
    monkeypatch.setenv(acr.VERDICT_TOKEN_ENV, "app-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.delenv("TARGET_URL", raising=False)
    a = _args(r, **over)
    return acr.main(["--event", "merge_group", "--stage", "follow", f"--sha={a.sha}", f"--run-id={a.run_id}", f"--head-ref={a.head_ref}",
                     f"--run-event={a.run_event}", "--root", a.root, *extra])


def test_MQ_the_follow_stage_posts_one_status_with_the_app_token(tmp_path, monkeypatch, capsys):
    r = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"})
    api = _TwoTokens(_RunApi(described=_described(r)))
    assert _follow_cli(monkeypatch, r, api) == 0
    assert api.posted == [(f"statuses/{r.merge}", {"state": "success", "context": "agent-ci-required",
                                                   "description": "all 18 Agent jobs passed on the merge group's commit"})]
    assert [one.token for one in api.made] == ["read-token", "app-token"]
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["stage"] == "follow"
    red = _TwoTokens(_RunApi(described=_described(r), jobs=_listed(JOBS[:-1])))
    assert _follow_cli(monkeypatch, r, red) == 1                       # the job is red when the status is
    assert [b["state"] for _, b in red.posted] == ["failure"]
    frozen = _TwoTokens(_RunApi(described=_described(r)))
    monkeypatch.setattr(acr, "Api", frozen)
    monkeypatch.setattr(acr, "_utcnow", lambda: _et(2026, 11, 18, 9, 30))
    assert acr.main(["--event", "merge_group", "--stage", "follow", f"--sha={r.merge}", f"--run-id={RUN_ID}",
                     f"--head-ref={r.ref[len('refs/heads/'):]}", "--run-event=merge_group", "--root", str(r.work)]) == 1
    assert frozen.posted[0][1]["description"].startswith("deploy freeze window 09:20-09:45 ET")
    dry = _TwoTokens(_RunApi(described=_described(r)))
    assert _follow_cli(monkeypatch, r, dry, extra=["--dry-run"]) == 0 and dry.posted == []


def test_MQ_the_follow_stage_posts_nothing_and_exits_2_for_a_run_that_is_not_ours(tmp_path, monkeypatch):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    for over, described in ((dict(run_event="pull_request"), _described(r)), (dict(), _described(r, path=".github/workflows/impostor.yml")),
                            (dict(sha="0" * 39), _described(r))):
        api = _TwoTokens(_RunApi(described=described))
        assert _follow_cli(monkeypatch, r, api, **over) == 2, over
        assert api.posted == [] and [one.token for one in api.made] == ["read-token"]      # the App's token was never even wrapped
    ours = _TwoTokens(_RunApi(described=_described(r)))
    assert _follow_cli(monkeypatch, r, ours) == 0 and len(ours.posted) == 1                # control


def test_MQ_only_a_failed_post_leaves_a_judged_commit_without_a_status(tmp_path, monkeypatch):
    r = _queue_repo(tmp_path, {"app/src/agent/a.js": "a2\n"})
    unread = _TwoTokens(_RunApi(fail="actions/runs"))
    assert _follow_cli(monkeypatch, r, unread) == 1
    assert unread.posted == [(f"statuses/{r.merge}", {"state": "failure", "context": "agent-ci-required",
                                                      "description": "fail closed: the merge group's run could not be read"})]
    with pytest.raises(acr.ApiError):
        _follow_cli(monkeypatch, r, _TwoTokens(_RunApi(described=_described(r)), fail_post=True))


def test_MQ_the_verdict_stage_is_gone_and_the_tool_has_one_place_that_posts_in_a_merge_group(monkeypatch):
    """The in-group `verdict` job is deleted with its stage: a status posted from inside a merge group proves nothing
    (AUDIT F1), so the capability is removed rather than switched off."""
    with pytest.raises(SystemExit):
        acr.main(["--event", "merge_group", "--stage", "verdict", "--sha", SHA, "--run-id", "55"])
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.setattr(acr, "Api", lambda *a, **k: pytest.fail("no API object without a stage"))
    assert acr.main(["--event", "merge_group", "--sha", SHA, "--run-id", "55"]) == 2
    src = (ROOT / "tools" / "agent_ci_required.py").read_text(encoding="utf-8")
    # two places post, a merge group's commit and a pull request's head, and BOTH take the App's token from the environment
    posts = sorted(ln.strip() for ln in src.splitlines() if '.call("POST"' in ln)
    assert len(posts) == 2 and "queue_verdict" not in src and 'api.call("POST"' not in src
    assert posts[0].startswith("Api(app_token, repo, base)") and posts[1].startswith("Api(post_token, repo, base,")
    assert "post_token = os.environ[VERDICT_TOKEN_ENV]" in src and 'app_token = os.environ.get(VERDICT_TOKEN_ENV, "")' in src
    assert src.count("os.environ[VERDICT_TOKEN_ENV]") + src.count("os.environ.get(VERDICT_TOKEN_ENV") == 2      # and nowhere else


def test_MQ_the_pull_request_and_workflow_run_paths_are_the_ones_they_were(monkeypatch, capsys):
    """Adding the merge_group stages changed no existing call: the same two commands still evaluate through the same
    functions, a merge_group flag does nothing to them, and they still make ONE attempt per API call."""
    class Api(FakeApi):
        def __init__(self, token, repo, base=None, **more):
            assert more == {}, f"the pull_request / workflow_run paths construct the API as before: {more}"
            super().__init__(files=[AGENT_FILE], runs=[GREEN])
            self.token, self.posted = token, []
            made.append(self)

        def get(self, path):
            if path == f"commits/{SHA}/pulls":           # workflow_run: which open PRs have this head
                return [{"number": 1, "state": "open", "head": {"sha": SHA}}, {"number": 2, "state": "closed", "head": {"sha": SHA}}]
            return super().get(path)

        def call(self, method, path, body=None):
            assert self.token == "app-token", "only the App's token posts agent-ci-required (2026-11-22)"
            self.posted.append((method, path, body))
    made, scanned = [], []
    monkeypatch.setattr(acr, "Api", Api)
    # the head's workflow tree is scanned in both legs (its own tests are further down); here it is clean
    monkeypatch.setattr(acr, "head_workflow_problems", lambda root, sha, **kw: scanned.append((str(root), sha)) or [])
    monkeypatch.setenv("GITHUB_TOKEN", "read-token")
    monkeypatch.setenv(acr.VERDICT_TOKEN_ENV, "app-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.delenv("TARGET_URL", raising=False)
    assert acr.main(["--event", "pull_request", "--sha", SHA, "--pr", "1", "--root", str(ROOT), "--stage", "follow", "--run-event", "merge_group", "--run-id", "5"]) == 0
    assert scanned == [(str(ROOT), SHA)]
    want = [("POST", f"statuses/{SHA}", {"state": "success", "context": "agent-ci-required",
                                         "description": "agent ci run passed all 18 required jobs"})]
    assert [m.token for m in made] == ["read-token", "app-token"] and made[0].posted == [] and made[1].posted == want
    # workflow_run (an agent ci run completed): the open PRs for the SHA are looked up, then the same evaluation
    assert acr.main(["--event", "workflow_run", "--sha", SHA, "--root", str(ROOT), "--stage", "scope", "--base", SHA, "--head-ref", "x"]) == 0
    assert [m.token for m in made[2:]] == ["read-token", "app-token"] and made[2].posted == [] and made[3].posted == want
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["prs"] == [1]
    # without the App's token (an older copy of the workflow, on a branch that has not taken master's) NOTHING is posted,
    # and GITHUB_TOKEN is never used in its place; the job says so
    for missing in (None, ""):
        monkeypatch.delenv(acr.VERDICT_TOKEN_ENV, raising=False)
        if missing is not None:
            monkeypatch.setenv(acr.VERDICT_TOKEN_ENV, missing)
        n = len(made)
        assert acr.main(["--event", "pull_request", "--sha", SHA, "--pr", "1", "--root", str(ROOT)]) == 0
        assert [m.token for m in made[n:]] == ["read-token"] and made[-1].posted == []
        assert f"::warning::{acr.VERDICT_TOKEN_ENV} is not set: no agent-ci-required status is posted for {SHA}" in capsys.readouterr().out
    assert acr.main(["--event", "pull_request", "--sha", SHA, "--pr", "1", "--root", str(ROOT), "--dry-run"]) == 0      # a dry run needs none
    assert acr.run_jobs(FakeApi(), 9) == [{"name": n, "conclusion": "success"} for n in JOBS]


def test_MQ_run_jobs_reads_every_page():
    """The job list both sides read (a PR head's run, and a merge group's own run): every page, name + conclusion only."""
    class Paged:
        pages: list = []

        def get(self, path):
            assert path.startswith("actions/runs/9/jobs?filter=latest&per_page=100&page="), path
            page = int(path.rsplit("page=", 1)[1])
            self.pages.append(page)
            return {"jobs": [{"name": f"j{page}-{i}", "conclusion": "success", "id": i} for i in range({1: 100, 2: 100, 3: 5}[page])]}
    api = Paged()
    jobs = acr.run_jobs(api, 9)
    assert len(jobs) == 205 and api.pages == [1, 2, 3] and jobs[0] == {"name": "j1-0", "conclusion": "success"}
    assert jobs[-1] == {"name": "j3-4", "conclusion": "success"}


# ---- 2026-11-22, the independent review of #2501 and AUDIT F2 / F4 ----------------------------------------------------------
def test_MQ_the_queues_judges_are_agent_paths():
    """AUDIT F2: an edit to the workflow that decides the queue's verdict, or to the pull-request side's, is an Agent
    change. Being workflows they are self-protected too, so alone each is `self-protected`: AUDIT decides."""
    for wf in (".github/workflows/agent-ci-queue.yml", ".github/workflows/agent-ci-required.yml"):
        assert acr.matches(wf, PATHS) and (ROOT / wf).is_file(), wf
        assert acr.decide_scope([wf], PATHS, PROTECTED) == (acr.SCOPE_PROTECTED, "1 self-protected path(s), e.g. " + wf)
    raw = yaml.safe_load((ROOT / ".github" / "workflows" / "agent-ci.yml").read_text(encoding="utf-8"))
    on = raw.get("on") or raw[True]
    assert on["push"]["paths"] == on["pull_request"]["paths"] == PATHS            # both lists, held equal
    assert not acr.matches(".github/workflows/gate-static-rails-pr.yml", PATHS)   # control: not every workflow is one


@pytest.mark.parametrize("path,agent,protected", [
    ("app/src/agent/a\nb.js", True, False), ("docs/agent/program/x\ny/z.md", True, False), ("app/src/pages/charts/grid/a\n/b.jsx", True, False),
    (".github/workflows/a\nb.yml", False, True), ("tests/x\ny/conftest.py", False, True), ("api/x\n/requirements-dev.txt", False, True),
    ("app/scripts/a\nb.mjs", False, True),
    ("docs/a\nb.md", False, False), ("api/routers/sub\n/uct_agent.py", False, False),      # controls: a newline matches nothing by itself
])
def test_MQ_a_double_star_crosses_a_newline_in_a_path(path, agent, protected):
    """A file name may hold a newline. `**` compiled without re.S stopped at it, so such a path matched NO `**` pattern:
    neither an Agent path nor a self-protected one. re.S only widens what matches (`*` and `?` already crossed it)."""
    assert acr.matches(path, PATHS) is agent and acr.matches(path, PROTECTED) is protected, path
    assert acr.matches(path.replace("\n", "_"), PATHS) is agent and acr.matches(path.replace("\n", "_"), PROTECTED) is protected
    if agent:
        assert acr.decide_scope([path], PATHS, PROTECTED)[0] == acr.SCOPE_AGENT
        assert acr.decide_scope([path, ".github/workflows/a\nb.yml"], PATHS, PROTECTED)[0] == acr.SCOPE_PROTECTED


def test_MQ_a_single_star_still_stops_at_a_slash():
    assert acr._glob_re("a/*").match("a/b\nc") and not acr._glob_re("a/*").match("a/b/c") and not acr._glob_re("a/?").match("a//")
    assert acr._glob_re("a/**").match("a/b\n/c\n") and not acr._glob_re("a/**").match("b/a/c")


# ---- stacked entries: the protected list's sources on master against the tree the entry is built on -------------------------
STACKED_CONFIG = "import './lib/extra.js'\nexport default {test: {setupFiles: ['./src/test-setup.js']}}\n"


@pytest.mark.parametrize("ahead,agent_code", [
    (dict(AHEAD_FILES), "agent-paths"),                                                      # control: nothing the list reads
    ({"app/vitest.config.js": STACKED_CONFIG, "app/lib/extra.js": "export {}\n"}, "unknown"),   # a config is edited ahead
    ({"app/vite.lab.config.mjs": VITEST_CONFIG}, "unknown"),                                 # a config is ADDED ahead
])
def test_MQ_an_entry_stacked_on_a_config_edit_is_unknown_when_it_needs_agent_evidence(tmp_path, ahead, agent_code):
    """The derived protected list is read from master's tip. An entry AHEAD that edits a vite / vitest config changes
    what the entry behind it runs with, and master does not have it yet: for an Agent-path entry the answer is
    `unknown`. An entry that touches no Agent path is not affected. Once the entry ahead has LANDED there is no gap."""
    r = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"}, ahead_files=ahead, landed=False)
    out = acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)
    assert out["code"] == agent_code, out
    if agent_code == "unknown":
        assert out["detail"] == "the protected list's sources differ between master and this entry's base (or are unreadable)"
        assert acr._safe(out["detail"]) == out["detail"]
    r = _queue_repo(tmp_path / "plain", {"README.md": "r2\n"}, ahead_files=ahead, landed=False)
    assert acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)["code"] == "no-agent-paths"
    r = _queue_repo(tmp_path / "landed", {"app/src/agent/a.js": "a2\n"}, ahead_files=ahead, landed=True)
    assert acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)["code"] == "agent-paths"


def test_MQ_a_comparison_git_could_not_make_is_unknown_for_an_agent_entry(tmp_path, monkeypatch):
    """Only a comparison that says "the same" lets an Agent entry through: one that could not be made is not that."""
    r = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"})
    plain = _queue_repo(tmp_path / "plain", {"README.md": "r2\n"})
    scope = lambda q: acr.queue_scope(q.work, acr.load_agent_ci(q.work), q.merge, q.base, q.ref, q.merge)["code"]   # noqa: E731
    assert scope(r) == "agent-paths" and scope(plain) == "no-agent-paths"            # control
    for answer, code in ((None, "unknown"), (True, "unknown"), (False, "agent-paths")):
        monkeypatch.setattr(acr, "protected_sources_differ", lambda *a, _x=answer, **k: _x)
        assert scope(r) == code and scope(plain) == "no-agent-paths", answer


def test_MQ_the_protected_sources_are_the_configs_and_every_file_they_import(tmp_path):
    ahead = {"app/vitest.config.js": STACKED_CONFIG, "app/lib/extra.js": "export {}\n"}
    r = _queue_repo(tmp_path / "a", {"app/src/agent/a.js": "a2\n"}, ahead_files=ahead, landed=True)     # master imports ./lib/extra.js
    assert ev.config_imports(r.work) == ["app/lib/extra.js"]
    lines = []
    diff = lambda sha, imported: acr.protected_sources_differ(r.work, sha, imported, log=lines.append)   # noqa: E731
    assert acr.merge_group_changed_paths(r.work, r.base, r.merge) is not None                              # brings the commits in
    assert diff(r.base, ["app/lib/extra.js"]) is False and lines == []                                     # HEAD is the base
    # the PR head was cut from `start`: against it the config AND the file it imports differ
    assert diff(r.head, ["app/lib/extra.js"]) is True and "app/lib/extra.js" in lines[-1] and "app/vitest.config.js" in lines[-1]
    assert diff(r.head, []) is True                              # the config glob alone sees it
    # an imported file is compared only because the list names it: a file no config imports is not a source
    assert acr.protected_sources_differ(r.work, r.merge, ["app/src/agent/a.js"], log=lines.append) is True
    assert acr.protected_sources_differ(r.work, r.merge, [], log=lines.append) is False
    for bad in ("f" * 40, "HEAD", "", None, r.base[:39], "--output=x"):
        assert diff(bad, []) is None, bad
    assert acr.CONFIG_PATHSPECS == (":(glob)app/vite*.config.*", ":(glob)app/vitest*.config.*")


# ---- an unreadable diff says WHICH step failed, in the job log and nowhere else ----------------------------------------------
def test_MQ_an_unreadable_diff_names_the_failed_step_in_the_job_log_only(tmp_path, monkeypatch, capsys):
    r = _queue_repo(tmp_path, {"README.md": "r2\n"})
    lines = []
    read = lambda base, head, **kw: acr.merge_group_changed_paths(r.work, base, head, log=lines.append, **kw)   # noqa: E731
    assert read(r.base, r.merge) == ["README.md"] and lines == []                 # control: a good read logs nothing
    assert read(r.base, "f" * 40) is None
    assert "fetching the merge group" in lines[-1] and "git fetch exited" in lines[-1] and len(lines[-1]) > 60   # git's own words
    assert read(r.start, r.merge) is None
    assert "not a two-parent merge whose first parent is " + r.start in lines[-1] and r.base in lines[-1]
    assert read(r.base, "HEAD") is None and "not a 40-hex commit" in lines[-1]
    assert read(r.base, r.merge, fetch=False, run=lambda *a, **k: (_ for _ in ()).throw(OSError("no git"))) is None
    assert "could not run: OSError: no git" in lines[-1]
    for step, needle in (("cat-file", "reading the merge group's commit"), ("diff", "comparing base_sha with head_sha")):
        def failing(argv, _s=step, **kw):
            p = subprocess.run(argv, **kw)
            return types.SimpleNamespace(returncode=3, stdout=p.stdout, stderr=b"fatal: boom") if _s in argv else p
        assert read(r.base, r.merge, run=failing) is None
        assert needle in lines[-1] and f"git {step} exited 3: fatal: boom" in lines[-1], lines[-1]
    # through the scope stage: the reason is on stderr; the outputs and stdout carry only the fixed sentence
    out = tmp_path / "github_output.txt"
    monkeypatch.setenv("GITHUB_SHA", "f" * 40)
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    capsys.readouterr()
    ref = "refs/heads/gh-readonly-queue/master/pr-7-" + "f" * 40
    assert acr.main(["--event", "merge_group", "--stage", "scope", "--sha=" + "f" * 40, f"--base={r.base}", f"--head-ref={ref}", "--root", str(r.work)]) == 0
    io = capsys.readouterr()
    assert "[agent-ci-queue] the queued PR's diff, fetching the merge group: git fetch exited" in io.err
    assert out.read_text(encoding="utf-8") == "code=unknown\npr=7\ndetail=the queued PR's own diff could not be read\n"
    assert "fetch" not in io.out and "exited" not in io.out


# ---- the API is asked three times in a merge group, and only when asking again can help --------------------------------------
class _Answer:
    def __init__(self, body=b'{"ok": true}'):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


def _http(code):
    import io
    import urllib.error
    return urllib.error.HTTPError("https://api.github.invalid/x", code, "status %d" % code, {}, io.BytesIO(b""))


def _api(script, attempts=3):
    """A real acr.Api whose transport plays `script` (an exception is raised, anything else is the response body)."""
    import urllib.error  # noqa: F401
    calls, slept = [], []

    def opener(req, timeout=None):
        calls.append((req.get_method(), req.full_url))
        step = script[len(calls) - 1]
        if isinstance(step, BaseException):
            raise step
        return _Answer(step)
    return acr.Api("t", "o/r", "https://api.github.invalid", attempts=attempts, sleep=slept.append, opener=opener), calls, slept


def test_MQ_a_transport_error_a_5xx_and_a_429_are_tried_again():
    import urllib.error
    for first in (urllib.error.URLError("connection reset"), TimeoutError("timed out"), _http(500), _http(502), _http(503), _http(599), _http(429)):
        api, calls, slept = _api([first, _http(502), b'{"jobs": []}'])
        assert api.get("actions/runs/55/jobs?page=1") == {"jobs": []}, first
        assert len(calls) == 3 and slept == [2, 5], (first, calls, slept)
    api, calls, slept = _api([_http(503), b'{"id": 1}'])
    assert api.call("POST", "statuses/" + SHA, {"state": "success"}) == {"id": 1}
    assert calls == [("POST", "https://api.github.invalid/repos/o/r/statuses/" + SHA)] * 2 and slept == [2]
    assert acr.RETRY_ATTEMPTS == 3 and acr.RETRY_PAUSE_S == (2, 5)


def test_MQ_three_failures_are_an_api_error_and_no_fourth_try():
    api, calls, slept = _api([_http(503), _http(503), _http(503), b'{"never": "read"}'])
    with pytest.raises(acr.ApiError, match="503"):
        api.call("POST", "statuses/" + SHA, {"state": "success"})
    assert len(calls) == 3 and slept == [2, 5]


@pytest.mark.parametrize("code", [400, 401, 403, 404, 409, 410, 422, 428, 451, 499])
def test_MQ_a_4xx_that_says_no_is_never_asked_again(code):
    api, calls, slept = _api([_http(code), b'{"never": "read"}'])
    with pytest.raises(acr.ApiError, match=str(code)):
        api.call("POST", "statuses/" + SHA, {"state": "success"})
    assert len(calls) == 1 and slept == []
    assert acr.retryable(_http(code)) is False and acr.retryable(_http(429)) is True and acr.retryable(ValueError("x")) is False


def test_MQ_an_unparsable_answer_is_not_asked_again_and_one_attempt_is_one_attempt():
    api, calls, slept = _api([b"<html>not json", b'{"never": "read"}'])
    with pytest.raises(acr.ApiError):
        api.get("actions/runs/55/jobs")
    assert len(calls) == 1 and slept == []
    api, calls, slept = _api([_http(502), b'{"never": "read"}'], attempts=1)      # the pull_request / workflow_run paths
    with pytest.raises(acr.ApiError):
        api.get("pulls/1")
    assert len(calls) == 1 and slept == []
    assert acr.Api("t", "o/r", attempts=0).attempts == 1 and acr.Api("t", "o/r").attempts == 1      # the default: as before


# ---- AUDIT review 2 of #2501, finding 1: who may reach the App is decided by the TOOL, over the whole workflow tree --------
W = ".github/workflows/"
CLEAN = "name: x\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n"


def _wf(job_extra="", top_extra="", steps="      - run: 'true'\n"):
    return f"name: x\non: push\n{top_extra}jobs:\n  build:\n    runs-on: ubuntu-latest\n{job_extra}    steps:\n{steps}"


def _tree_now(root=ROOT) -> dict:
    """The workflow tree this test runs in, as the tool reads one: {path: bytes}. The tool reads git OBJECTS, which
    hold these files with LF. A checkout made with core.autocrlf=true (Git for Windows' default) holds the same
    blobs with CRLF, so the working tree's bytes are brought back to the blobs' line ends here (AUDIT review 3 of
    #2501, finding A: one rail below matched "\n" against the raw bytes and failed on such a checkout)."""
    files = {p.relative_to(root).as_posix(): p.read_bytes().replace(b"\r\n", b"\n")
             for p in sorted((root / ".github" / "workflows").iterdir()) if p.suffix in (".yml", ".yaml")}
    assert len(files) > 20, "found too few workflows: this is not the repository's tree"
    return files


def test_MQ_the_rails_read_the_tree_with_the_blobs_line_ends_and_the_scan_does_not_depend_on_them(tmp_path):
    """Finding A's rail, on any runner: a CRLF checkout of 21 workflows is read back as LF by _tree_now, and the scan
    itself gives one answer for a tree whatever its line ends (a blob COMMITTED with CRLF is judged like any other)."""
    folder = tmp_path / ".github" / "workflows"
    folder.mkdir(parents=True)
    for i in range(21):
        (folder / f"w{i}.yml").write_bytes(CLEAN.replace("\n", "\r\n").encode("utf-8"))
    got = _tree_now(tmp_path)
    assert len(got) == 21 and set(got.values()) == {CLEAN.encode("utf-8")}
    crlf = {path: raw.replace(b"\n", b"\r\n") for path, raw in _tree_now().items()}
    assert any(b"\r\n" in raw for raw in crlf.values()) and acr.workflow_problems(crlf) == []
    sneaky = _wf("    environment: ${{ vars.E }}\n").replace("\n", "\r\n")
    assert acr.workflow_problems({**crlf, W + "new.yml": sneaky}) == ["new.yml: job build declares an environment"]


def test_MQ_todays_workflow_tree_has_zero_findings():
    """The predicate must not cost today's tree anything: every workflow on master parses with unique keys, none but the
    two posters has an `environment` key at any depth, none calls a reusable workflow from another repository, and none
    names the App's variables or the context in a YAML string (a workflow FILE name is not the context)."""
    files = _tree_now()
    assert acr.workflow_problems(files) == []
    assert set(acr.POSTER_JOBS) <= set(files)
    # control: the same tree with one intruder is not clean, and the finding names the file and the job
    assert acr.workflow_problems({**files, W + "new.yml": _wf("    environment: x\n")}) == ["new.yml: job build declares an environment"]
    # the mentions that exist today outside comments, and are NOT findings: the Agent `paths:` entries that name the
    # workflow FILE, and the tool invoked by path (underscores: not the context)
    agent_ci = files[W + "agent-ci.yml"].decode("utf-8")
    assert "- '.github/workflows/agent-ci-required.yml'" in agent_ci and "tools/agent_ci_required.py" in files[W + "agent-ci-queue.yml"].decode("utf-8")


@pytest.mark.parametrize("label,text", [
    # AUDIT's three evasions of the old string-matching rail: all of them are the KEY, whatever the value
    ("the literal name", _wf("    environment: agent-ci-verdict\n")),
    ("a name an expression computes", _wf("    environment: ${{ format('agent-ci-{0}', 'verdict') }}\n")),
    ("a name read from a variable", _wf("    environment: ${{ vars.ENV_NAME }}\n")),
    ("the object form", _wf("    environment:\n      name: ${{ vars.ENV_NAME }}\n      url: https://x\n")),
    ("another environment altogether", _wf("    environment: production\n")),
    ("an empty value", _wf("    environment:\n")),
    ("a quoted key", _wf('    "environment": x\n')),
    ("a key in another case", _wf("    Environment: x\n")),
    ("flow style", "on: push\njobs: {build: {runs-on: ubuntu-latest, environment: x, steps: [{run: 'true'}]}}\n"),
    ("through an anchor", "x: &e {environment: prod}\non: push\njobs:\n  build:\n    <<: *e\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n"),
])
def test_MQ_an_environment_key_outside_the_posters_is_a_finding_whatever_its_value(label, text):
    got = acr.workflow_problems({W + "new.yml": text})
    assert got and all(g.startswith("new.yml: ") for g in got) and any("environment" in g for g in got), (label, got)
    assert acr.workflow_problems({W + "new.yml": text.replace("nvironment", "nvironmental")}) == [], label     # control: another key is not that key


def test_MQ_an_environment_key_at_any_depth_is_refused_not_told_apart():
    """A step input or an env var NAMED environment is refused too: the scan does not try to tell it from a job's key."""
    got = acr.workflow_problems({W + "new.yml": _wf(steps="      - uses: some/action@v1\n        with:\n          environment: staging\n")})
    assert got == ["new.yml: an `environment` key at jobs.build.steps.0.with"]
    assert acr.workflow_problems({W + "new.yml": _wf(top_extra="environment: x\n")}) == ["new.yml: an `environment` key at the top"]
    # ... but a VALUE that is the word, or a key that merely contains it, is not the key
    assert acr.workflow_problems({W + "new.yml": _wf("    env:\n      DEPLOY_ENVIRONMENT: environment\n")}) == []


def test_MQ_a_secret_cannot_be_read_without_the_key_so_the_key_is_the_check():
    """`secrets[format(...)]` and `toJSON(secrets)` in a non-poster file are NOT findings, on purpose: GitHub hands an
    environment's secrets and variables only to a job that DECLARES the environment, and the App's key and id exist at
    environment level only (AUDIT confirmed neither exists at repository level). So such a job reads nothing of the
    App's, and the moment it declares an environment, under any spelling, rule (a) refuses it."""
    sneaky = ("    env:\n      A: ${{ secrets[format('AGENT_CI_{0}_APP_PRIVATE_KEY', 'VERDICT')] }}\n      B: ${{ toJSON(secrets) }}\n"
              "      C: ${{ vars[format('AGENT_CI_{0}_APP_ID', 'VERDICT')] }}\n")
    assert acr.workflow_problems({W + "new.yml": _wf(sneaky)}) == []
    got = acr.workflow_problems({W + "new.yml": _wf(sneaky + "    environment: ${{ format('agent-ci-{0}', 'verdict') }}\n")})
    assert got == ["new.yml: job build declares an environment"]


@pytest.mark.parametrize("uses,bad", [
    ("someone/repo/.github/workflows/x.yml@main", True), ("northstar-quarry/other/.github/workflows/x.yml@" + "a" * 40, True),
    ("northstar-quarry/UCT-Dashboard/.github/workflows/agent-ci.yml@master", True),      # this repository BY NAME: another ref's copy
    ("../.github/workflows/x.yml", True), (".github/workflows/x.yml", True),
    ("${{ vars.WF }}", True), ("", True), ("./.github/actions/x", True),
    ("./.github/workflows/agent-ci.yml", False), ("./.github/workflows/new.yml", False),
    # AUDIT review 3 of #2501, finding B: the right prefix, then a path that is not one file IN the folder. The first
    # row was pinned here as allowed until 2026-11-23.
    ("./.github/workflows/../../elsewhere.yml", "path"), ("./.github/workflows/../actions/x/action.yml", "path"),
    ("./.github/workflows/sub/x.yml", "path"),            # a `/` and no `..`
    ("./.github/workflows/..", "path"), ("./.github/workflows/x..yml", "path"), ("./.github/workflows/..\\..\\x.yml", "path"),   # a `..` and no `/`
])
def test_MQ_a_job_may_call_a_reusable_workflow_only_from_this_repositorys_tree(uses, bad):
    text = f"on: push\njobs:\n  call:\n    uses: '{uses}'\n"
    got = acr.workflow_problems({W + "new.yml": text})
    assert bool(got) is bool(bad), (uses, got)
    if bad == "path":
        assert got == [f"new.yml: job call calls a reusable workflow by a path that is not a file directly in .github/workflows ({uses[:50]})"], got
    elif bad:
        assert got[0].startswith("new.yml: job call calls a reusable workflow outside this repository's tree"), got
    # a STEP's `uses` is an action, not a workflow: free, unless it names a workflows path
    step = "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: '%s'\n"
    assert acr.workflow_problems({W + "new.yml": step % "actions/checkout@v4"}) == []
    assert acr.workflow_problems({W + "new.yml": step % "./.github/actions/pine-heavy-setup"}) == []
    assert acr.workflow_problems({W + "new.yml": step % "someone/repo/.github/workflows/x.yml@main"})
    assert acr.workflow_problems({W + "new.yml": step % "./.github/workflows/../actions/x"}) == [
        "new.yml: job a calls a reusable workflow by a path that is not a file directly in .github/workflows (./.github/workflows/../actions/x)"]


@pytest.mark.parametrize("label,text,finding", [
    ("the token's env name in a script", _wf(steps="      - run: echo $AGENT_CI_VERDICT_TOKEN\n"), "new.yml: names AGENT_CI_VERDICT_* outside a comment"),
    ("the variable", _wf("    env:\n      X: ${{ vars.AGENT_CI_VERDICT_APP_ID }}\n"), "new.yml: names AGENT_CI_VERDICT_* outside a comment"),
    ("the secret, in another case", _wf("    env:\n      X: ${{ secrets.agent_ci_verdict_app_private_key }}\n"), "new.yml: names AGENT_CI_VERDICT_* outside a comment"),
    ("the name as a KEY", _wf("    env:\n      AGENT_CI_VERDICT_TOKEN: x\n"), "new.yml: names AGENT_CI_VERDICT_* outside a comment"),
    ("the context in a script", _wf(steps="      - run: gh api repos/o/r/statuses/$SHA -f context=agent-ci-required\n"), "new.yml: names the context agent-ci-required outside a comment"),
    ("the context as a job name", "on: push\njobs:\n  a:\n    name: agent-ci-required\n    runs-on: x\n    steps: []\n", "new.yml: names the context agent-ci-required outside a comment"),
    ("the context in a shell comment inside a script", _wf(steps="      - run: |\n          true   # posts agent-ci-required\n"), "new.yml: names the context agent-ci-required outside a comment"),
    ("the context next to the file name", _wf(steps="      - run: echo agent-ci-required.yml agent-ci-required\n"), "new.yml: names the context agent-ci-required outside a comment"),
])
def test_MQ_the_backstop_names(label, text, finding):
    assert acr.workflow_problems({W + "new.yml": text}) == [finding], label
    # the posters themselves say all of this, and may
    for poster in acr.POSTER_JOBS:
        assert finding.replace("new.yml", poster.rsplit("/", 1)[1]) not in acr.workflow_problems({**_tree_now(), W + "new.yml": CLEAN}), poster


@pytest.mark.parametrize("label,text", [
    ("a YAML comment", "# agent-ci-required AGENT_CI_VERDICT_TOKEN environment: agent-ci-verdict\n" + CLEAN),
    ("an inline YAML comment", CLEAN.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest   # agent-ci-required, AGENT_CI_VERDICT_APP_ID")),
    ("the workflow FILE name in a paths list", "on:\n  push:\n    paths: ['.github/workflows/agent-ci-required.yml']\njobs:\n  a:\n    runs-on: x\n    steps: []\n"),
    ("the file name in a script's own comment", _wf(steps="      - run: pip install pyyaml   # pinned, as agent-ci-required.yml pins it\n")),
    ("the tool, invoked by path", _wf(steps="      - run: python tools/agent_ci_required.py --event merge_group --stage scope\n")),
    ("a neighbour's name", _wf(steps="      - run: echo agent-ci-queue-verdict agent_ci_verdict agent-ci-require\n")),
])
def test_MQ_what_the_backstop_does_not_count(label, text):
    assert acr.workflow_problems({W + "new.yml": text}) == [], label


@pytest.mark.parametrize("label,raw,word", [
    ("not YAML", "jobs: {a: [}\n", "does not parse as YAML"),
    ("a tab for indentation", "on: push\njobs:\n\tbuild: {}\n", "does not parse as YAML"),
    ("two documents", CLEAN + "---\n" + CLEAN, "does not parse as YAML"),
    ("the same key twice", "on: push\njobs:\n  a: {runs-on: x, environment: prod, steps: []}\njobs:\n  a: {runs-on: x, steps: []}\n", "does not parse as YAML"),
    ("the same key twice, nested", "on: push\njobs:\n  a:\n    runs-on: x\n    runs-on: y\n    steps: []\n", "does not parse as YAML"),
    ("a python object tag", "on: push\njobs: !!python/object/apply:os.system ['true']\n", "does not parse as YAML"),
    ("not text", b"\xff\xfe\x00\x01", "does not parse as YAML"),
    ("unreadable", None, "could not be read as a regular file"),
    ("too large", "TOO-LARGE", "larger than this scan reads"),
])
def test_MQ_a_workflow_file_the_scan_cannot_read_is_a_finding_that_names_it(label, raw, word):
    if raw == "TOO-LARGE":                      # (built here: a megabyte is no test id)
        raw = "#" + " " * acr.MAX_WORKFLOW_BYTES + "\n" + CLEAN
    got = acr.workflow_problems({W + "ok.yml": CLEAN, W + "broken.yml": raw})
    assert len(got) == 1 and got[0].startswith("broken.yml: ") and word in got[0], (label, got)
    assert acr.workflow_problems({W + "ok.yml": CLEAN}) == []                               # control


def test_MQ_a_file_with_no_jobs_is_inert_and_a_nest_of_anchors_is_walked_once():
    for inert in ("", "name: x\n", "- a\n- b\n", "just a string\n", "on: push\njobs: []\n"):
        assert acr.workflow_problems({W + "new.yml": inert}) == [], inert
    bomb = "a: &a [x, x]\n" + "".join(f"{chr(98 + i)}: &{chr(98 + i)} [*{chr(97 + i)}, *{chr(97 + i)}]\n" for i in range(24)) + "jobs: {}\n"
    assert acr.workflow_problems({W + "new.yml": bomb}) == []           # 2**25 leaves if every alias were walked again
    assert acr.workflow_problems({W + f"w{i}.yml": CLEAN for i in range(acr.MAX_WORKFLOW_FILES + 1)}) == [
        f"{acr.MAX_WORKFLOW_FILES + 1} workflow files: more than this scan reads ({acr.MAX_WORKFLOW_FILES})"]


def test_MQ_in_a_poster_only_the_poster_job_may_name_the_environment_and_only_literally():
    files = _tree_now()
    for path, job in acr.POSTER_JOBS.items():
        name, text = path.rsplit("/", 1)[1], files[path].decode("utf-8")
        assert f"    environment: {acr.VERDICT_ENVIRONMENT}\n" in text
        cases = {
            "an expression": (text.replace("    environment: agent-ci-verdict\n", "    environment: ${{ vars.E }}\n"), f"{name}: job {job}'s environment is not the literal agent-ci-verdict"),
            "the object form": (text.replace("    environment: agent-ci-verdict\n", "    environment:\n      name: agent-ci-verdict\n"), f"{name}: job {job}'s environment is not the literal agent-ci-verdict"),
            "a second job": (text + "  second:\n    runs-on: ubuntu-latest\n    environment: agent-ci-verdict\n    steps:\n      - run: 'true'\n",
                             f"{name}: an `environment` key outside the poster job {job} (at jobs.second)"),
            "a step input": (text.replace("          python-version: '3.12'\n", "          python-version: '3.12'\n          environment: x\n"),
                             f"{name}: an `environment` key outside the poster job {job} (at jobs.{job}.steps.1.with)"),
            "a remote reusable workflow": (text + "  call:\n    uses: someone/repo/.github/workflows/x.yml@main\n",
                                           f"{name}: job call calls a reusable workflow outside this repository's tree (someone/repo/.github/workflows/x.yml@main)"),
        }
        for label, (mutated, finding) in cases.items():
            assert mutated != text, (name, label)
            assert acr.workflow_problems({**files, path: mutated}) == [finding], (name, label)
    # a file with a poster's NAME in another folder is not a poster
    assert acr.workflow_problems({W + "sub/agent-ci-required.yml": _wf("    environment: agent-ci-verdict\n")})


def test_MQ_the_status_text_names_the_file_and_the_job_and_keeps_its_last_sentence():
    one = acr.workflow_verdict(["new.yml: job build declares an environment"])
    assert one == "new.yml: job build declares an environment: only the two posters may reach the verdict App"
    many = acr.workflow_verdict(["a.yml: job x declares an environment", "b.yml: does not parse as YAML (ScannerError)"])
    assert many == "2 workflow problems, e.g. a.yml: job x declares an environment: only the two posters may reach the verdict App"
    long = acr.workflow_verdict(["w" * 300 + ".yml: job build declares an environment"])
    assert len(long) == 140 and long.endswith(": only the two posters may reach the verdict App")


# ---- the same judge, reading a commit's tree from git objects ------------------------------------------------------------------
FORMAT_ENV = "name: sneaky\non: push\njobs:\n  mint:\n    runs-on: ubuntu-latest\n    environment: ${{ format('agent-ci-{0}', 'verdict') }}\n    steps:\n      - run: 'true'\n"
REMOTE_CALL = "name: far\non: push\njobs:\n  far:\n    uses: someone/repo/.github/workflows/x.yml@main\n"
CLIMBING_CALL = "name: up\non: push\njobs:\n  up:\n    uses: ./.github/workflows/../../other/x.yml\n"


def test_MQ_a_commits_workflow_tree_is_read_from_git_objects_and_nothing_is_checked_out(tmp_path):
    r = _queue_repo(tmp_path, {"README.md": "r2\n", ".github/workflows/sneaky.yml": FORMAT_ENV, ".github/workflows/sub/deep.yaml": CLEAN,
                               ".github/workflows/notes.txt": "environment: x\n"})
    lines = []
    assert acr.head_workflow_problems(r.work, r.merge, log=lines.append) == ["sneaky.yml: job mint declares an environment"]
    assert acr.head_workflow_problems(r.work, r.head) == ["sneaky.yml: job mint declares an environment"]       # the PR head itself
    assert acr.head_workflow_problems(r.work, r.base) == []                                                    # control: master's tree
    assert not (r.work / ".github" / "workflows" / "sneaky.yml").exists() and _git(r.work, "rev-parse", "HEAD") == r.base
    git = acr._git_reader(r.work, log=lines.append)
    files = acr.workflow_files_at(git, r.merge)
    assert sorted(files) == [".github/workflows/agent-ci.yml", ".github/workflows/ahead.yml", ".github/workflows/sneaky.yml", ".github/workflows/sub/deep.yaml"]
    assert files[".github/workflows/sneaky.yml"] == FORMAT_ENV.encode() and files[".github/workflows/agent-ci.yml"] == AGENT_CI_TEXT.encode("utf-8")
    # unreadable is a finding, never an empty list
    assert acr.head_workflow_problems(r.work, "f" * 40) == ["the workflow files of ffffffffffff could not be fetched"]
    assert acr.head_workflow_problems(r.work, "f" * 40, fetch=False) == ["the workflow files of ffffffffffff could not be listed"]
    for bad in ("", None, "HEAD", r.merge[:39], "--upload-pack=x"):
        assert acr.head_workflow_problems(r.work, bad) == ["the commit to scan is not a 40-hex id"], bad
    assert acr.workflow_files_at(git, "f" * 40) is None

    def no_blobs(argv, **kw):                      # the tree lists, but no content can be read
        p = subprocess.run(argv, **kw)
        return types.SimpleNamespace(returncode=1, stdout=b"", stderr=b"fatal: no blob") if "cat-file" in argv and "blob" in argv else p
    got = acr.head_workflow_problems(r.work, r.merge, fetch=False, run=no_blobs, log=lines.append)
    assert got == [f"{n}: could not be read as a regular file" for n in ("agent-ci.yml", "ahead.yml", "deep.yaml", "sneaky.yml")]


def test_MQ_a_symlink_among_the_workflows_is_not_a_regular_file(tmp_path):
    origin = tmp_path / "o"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "master")
    blob = subprocess.run(["git", "-C", str(origin), "hash-object", "-w", "--stdin"], input=b"../../elsewhere.yml", check=True, capture_output=True).stdout.decode().strip()
    _git(origin, "update-index", "--add", "--cacheinfo", f"120000,{blob},.github/workflows/link.yml")
    _git(origin, "commit", "-q", "-m", "a link")
    sha = _git(origin, "rev-parse", "HEAD")
    assert acr.head_workflow_problems(origin, sha, fetch=False) == ["link.yml: could not be read as a regular file"]


@pytest.mark.parametrize("pr_files,finding", [
    ({"README.md": "r2\n", ".github/workflows/sneaky.yml": FORMAT_ENV}, "sneaky.yml: job mint declares an environment"),
    ({"docs/x.md": "x\n", ".github/workflows/far.yml": REMOTE_CALL}, "far.yml: job far calls a reusable workflow outside this repository's tree (someone/repo/.github/workflows/x.yml@main)"),
    ({".github/workflows/broken.yml": "jobs: {a: [}\n"}, "broken.yml: does not parse as YAML (ParserError)"),
    # AUDIT review 3, finding B: the probe that was not caught
    ({"other/x.yml": CLEAN, ".github/workflows/up.yml": CLIMBING_CALL}, "up.yml: job up calls a reusable workflow by a path that is not a file directly in .github/workflows (./.github/workflows/../../other/x.yml)"),
])
def test_MQ_the_follower_fails_every_entry_whose_tree_could_reach_the_app_a_plain_one_included(tmp_path, pr_files, finding):
    """AUDIT's two new rows: an expression-named environment, and a remote reusable workflow, each in an entry that
    touches NO Agent path. Under the old rule both landed as no-agent-paths."""
    r = _queue_repo(tmp_path / "plain", pr_files)
    assert acr.queue_scope(r.work, acr.load_agent_ci(r.work), r.merge, r.base, r.ref, r.merge)["code"] == "no-agent-paths"     # still what the scope says
    api = _RunApi(fail="actions/")
    assert _follow(r, api) == ("failure", acr.workflow_verdict([finding])) and api.calls == []
    # an entry queued BEHIND that one (it has not landed) carries the file in its tree, and is failed too
    behind = _queue_repo(tmp_path / "behind", {"docs/y.md": "y\n"}, ahead_files={k: v for k, v in pr_files.items() if k.startswith(".github/")}, landed=False)
    assert _follow(behind) == ("failure", acr.workflow_verdict([finding]))
    # ... an Agent entry behind it as well, before any job is read
    agent = _queue_repo(tmp_path / "agent", {"app/src/agent/a.js": "a2\n"}, ahead_files={k: v for k, v in pr_files.items() if k.startswith(".github/")}, landed=False)
    api = _RunApi()
    assert _follow(agent, api) == ("failure", acr.workflow_verdict([finding])) and api.calls == []
    # control: the same plain entry without the file is a success
    clean = _queue_repo(tmp_path / "clean", {k: v for k, v in pr_files.items() if not k.startswith(".github/")} or {"docs/z.md": "z\n"})
    assert _follow(clean)[0] == "success"


def test_MQ_the_pull_request_side_fails_a_head_whose_tree_could_reach_the_app(tmp_path, monkeypatch, capsys):
    """The same judge on a pull request's head, so such a pull request cannot even enter the queue: failure whatever its
    diff touches, in both legs (the pull-request event and the re-evaluation after an agent ci run)."""
    r = _queue_repo(tmp_path, {"README.md": "r2\n", ".github/workflows/sneaky.yml": FORMAT_ENV})
    made = []

    class Api(FakeApi):
        def __init__(self, token, repo, base=None, **more):
            super().__init__(files=[OTHER_FILE], runs=[])          # the API's view: a diff with no Agent path -> success by itself
            self.token, self.posted = token, []
            made.append(self)

        def get(self, path):
            return [{"number": 1, "state": "open", "head": {"sha": path.split("/")[1]}}] if path.startswith("commits/") else super().get(path)

        def call(self, method, path, body=None):
            assert self.token == "app-token"
            self.posted.append((path, body))
    monkeypatch.setattr(acr, "Api", Api)
    monkeypatch.setenv("GITHUB_TOKEN", "read-token")
    monkeypatch.setenv(acr.VERDICT_TOKEN_ENV, "app-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.delenv("TARGET_URL", raising=False)
    want = {"state": "failure", "context": "agent-ci-required",
            "description": "sneaky.yml: job mint declares an environment: only the two posters may reach the verdict App"}
    assert acr.main(["--event", "pull_request", "--sha", r.head, "--pr", "1", "--root", str(r.work)]) == 0
    assert made[-1].posted == [(f"statuses/{r.head}", want)]
    assert "[agent-ci-queue] workflow tree: sneaky.yml: job mint declares an environment" in capsys.readouterr().err
    assert acr.main(["--event", "workflow_run", "--sha", r.head, "--root", str(r.work)]) == 0
    assert made[-1].posted == [(f"statuses/{r.head}", want)]
    # control: master's own head, same API answers, is the success the diff earns
    assert acr.main(["--event", "pull_request", "--sha", r.base, "--pr", "1", "--root", str(r.work)]) == 0
    assert made[-1].posted == [(f"statuses/{r.base}", {"state": "success", "context": "agent-ci-required", "description": "no Agent paths changed"})]
    # a head that cannot be fetched is a failure too, never the diff's success
    assert acr.main(["--event", "pull_request", "--sha", "f" * 40, "--pr", "1", "--root", str(r.work)]) == 0
    assert made[-1].posted[0][1]["state"] == "failure" and "could not be fetched" in made[-1].posted[0][1]["description"]
    assert not (r.work / ".github" / "workflows" / "sneaky.yml").exists()                       # nothing of the PR was checked out


def test_MQ_the_rail_files_and_local_actions_are_self_protected_and_the_rails_are_agent_paths():
    """AUDIT review 2, findings 2 and 4. The three rail files: Agent paths AND self-protected, so an edit is
    `self-protected` (only self-protected it would land freely; only an Agent path it would be judged by Agent jobs that
    never run these files). `.github/actions/**`: self-protected now, before any Agent job uses a local action."""
    for rail in ("tests/test_ci_agent_merge_ref.py", "tests/test_agent_ci_required.py", "tests/test_agent_ci_evidence.py"):
        assert acr.matches(rail, PATHS) and acr.matches(rail, list(ev.SELF_PROTECTED)) and (ROOT / rail).is_file(), rail
        assert acr.decide_scope([rail], PATHS, PROTECTED) == (acr.SCOPE_PROTECTED, "1 self-protected path(s), e.g. " + rail)
        assert acr.decide_scope([OTHER_FILE, rail], PATHS, PROTECTED)[0] == acr.SCOPE_PROTECTED
    for action in (".github/actions/pine-heavy-setup/action.yml", ".github/actions/new/run.sh"):
        assert acr.matches(action, list(ev.SELF_PROTECTED)) and not acr.matches(action, PATHS), action
        assert acr.decide_scope([action], PATHS, PROTECTED)[0] == acr.SCOPE_CLEAR
        assert acr.decide_scope([action, AGENT_FILE], PATHS, PROTECTED)[0] == acr.SCOPE_PROTECTED
    # control: a neighbour is neither, and `.github/workflows/**` as a whole is NOT an Agent path (AUDIT: no)
    for other in ("tests/test_ci_cost_rails.py", "tests/test_gate_static_rails_pr.py", ".github/CODEOWNERS"):
        assert not acr.matches(other, list(ev.SELF_PROTECTED)) and not acr.matches(other, PATHS), other
    assert not acr.matches(".github/workflows/web-start.yml", PATHS) and not [p for p in PATHS if p in (".github/workflows/**", ".github/**")]
