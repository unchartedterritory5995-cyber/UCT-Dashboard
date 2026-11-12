"""agent-ci-required (tools/agent_ci_required.py): the one required Agent status is success ONLY for a PR that touches
no Agent path, or whose exact head SHA has a completed, all-green agent ci PUSH run. Everything else fails closed."""
from __future__ import annotations

import pathlib

import pytest
import yaml

from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC = acr.load_agent_ci(ROOT)
PATHS = acr.agent_paths(DOC)
JOBS = acr.required_jobs(DOC)

#: C3: the exact job set, verified against agent-ci.yml. A change here is a deliberate, reviewed change.
EXPECTED_JOBS = {
    "UCT Agent server tests (production dependency set)",
    "UCT Agent browser tests (shard 1/4)",
    "UCT Agent browser tests (shard 2/4)",
    "UCT Agent browser tests (shard 3/4)",
    "UCT Agent browser tests (shard 4/4)",
    "UCT Agent capability regression (deterministic, no model) @ post",
    "UCT Agent capability regression (deterministic, no model) @ rth",
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


def test_required_jobs_are_exactly_the_nine_agent_jobs():
    assert len(JOBS) == 9 and set(JOBS) == EXPECTED_JOBS, JOBS


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
    def __init__(self, files=None, runs=None, jobs=None, fail=None):
        self.files, self.runs, self.jobs, self.fail = files or [], runs, jobs, fail

    def get(self, path):
        if self.fail and self.fail in path:
            raise acr.ApiError(f"GET {path}: HTTP 500")
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


# ── (2026-11-12, AUDIT gap) the agent ci PUSH trigger must cover every branch a PR can come from, or agent-ci-required
#    stays pending forever for a PR from charts/* / fix/* / feat/* that touches an Agent path ─────────────────────────
def _push_branches():
    doc = yaml.safe_load((pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/agent-ci.yml").read_text(encoding="utf-8"))
    on = doc.get("on", doc.get(True))
    return on["push"]["branches"]


@pytest.mark.parametrize("branch", ["agent/pl/x", "charts/p3-legacy", "fix/rs-line-polish", "feat/rs-universe", "land/abc", "perf/batch", "docs/x"])
def test_agent_ci_push_covers_every_pr_branch(branch):
    assert acr.matches(branch, _push_branches()), f"{branch} gets no agent ci push run → agent-ci-required pending forever"


@pytest.mark.parametrize("branch", ["master", "production"])
def test_agent_ci_push_leaves_master_and_production_to_the_gate(branch):
    assert not acr.matches(branch, _push_branches())
