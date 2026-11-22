"""The master deploy gate RUNS the bars rails, as its own parallel job, and cannot quietly stop.

⚰️ 2026-11-17: `tests/test_bar_contract.py` went red on master on a DATE (a wall-clock read behind
a pinned seam) and stayed red unseen, because no gate ran it. Bars are the CRITICAL path.

Reads the REAL workflow (never a copy). Fails if the `bars-rails` job disappears, waits on another
job (serial), becomes conditional or optional, stops running `tools/bars_gate_rails.py`'s list, or
leaves the verdict; and if the list loses a REQUIRED file, carries a stale or unexplained exclusion,
or could run empty (pytest with no paths would run the whole tests/ tree). This file matches
`tests/test_bars_*.py`, so the gate runs its own rail.
"""
from __future__ import annotations

import importlib.util
import pathlib
import subprocess
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "master-deploy-gate.yml"
TOOL = REPO / "tools" / "bars_gate_rails.py"
JOB = "bars-rails"
RUN_STEP = "Bars rails (tools/bars_gate_rails.py)"


def _tool():
    spec = importlib.util.spec_from_file_location("bars_gate_rails", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _doc() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_the_job_is_its_own_parallel_unconditional_job_and_the_verdict_waits_for_it():
    doc = _doc()
    job = doc["jobs"][JOB]
    assert set(job) <= {"name", "runs-on", "timeout-minutes", "steps"}, set(job)   # no needs:, no if:, no continue-on-error
    for step in job["steps"]:
        assert "if" not in step and "continue-on-error" not in step, step.get("name")
    verdict = doc["jobs"]["verdict"]
    assert JOB in verdict["needs"] and verdict["if"] == "always()"
    text = " ".join(s.get("run", "") for s in verdict["steps"])
    assert text.count("needs.bars-rails.result") >= 2, "the verdict must test the result, not only print it"
    assert "bars-rails=" in text
    for other in ("gate", "agent-browser", "agent-browser-union", "pine-runtime"):
        assert other in verdict["needs"], f"{other} left the verdict"


def test_the_job_runs_exactly_the_tools_list_and_cannot_run_empty():
    steps = [s for s in _doc()["jobs"][JOB]["steps"] if s.get("name") == RUN_STEP]
    assert len(steps) == 1, f"{len(steps)} steps named {RUN_STEP!r}"
    run = steps[0]["run"]
    assert "set -euo pipefail" in run
    assert 'files="$(python tools/bars_gate_rails.py)"' in run
    assert 'test -n "$files"' in run                      # an empty list fails, never "pytest" with no paths
    assert "python -m pytest $files" in run


def test_the_job_installs_what_a_clean_runner_installs():
    """"Green on a clean runner" means `remote-tests.yml`'s setup: requirements, Node, /data."""
    text = "\n".join(s.get("run", "") for s in _doc()["jobs"][JOB]["steps"])
    assert "pip install --quiet -r requirements.txt" in text
    assert "npm ci" in text and "/data" in text


def test_the_declared_list_has_no_problems_and_holds_every_required_rail():
    tool = _tool()
    assert tool.problems() == []
    files = tool.gated()
    for r in tool.REQUIRED:
        assert r in files, r
    assert "tests/test_bars_deploy_gate.py" in files      # the gate runs this rail too
    assert all(f.startswith("tests/") and f.endswith(".py") for f in files)


def test_the_tool_prints_the_list_and_fails_closed():
    out = subprocess.run([sys.executable, str(TOOL)], capture_output=True, text=True, cwd=REPO, timeout=60)
    assert out.returncode == 0 and out.stdout.split() == _tool().gated()


def test_problems_can_fire(tmp_path):
    """Each check proved able to fail, on a fake tree."""
    tool = _tool()
    t = tmp_path / "tests"
    t.mkdir()
    assert any("empty" in p for p in tool.problems(tmp_path, {}))
    # every file the tool names or requires, read off the tool (a typed copy here went stale the day NAMED grew)
    for name in sorted({pathlib.Path(n).name for n in tool.NAMED + tool.REQUIRED} | {"test_bars_x.py"}):
        (t / name).write_text("", encoding="utf-8")
    assert tool.problems(tmp_path, {}) == []
    assert any("REQUIRED file is excluded" in p
               for p in tool.problems(tmp_path, {"tests/test_bar_contract.py": "red"}))
    assert any("stale exclusion" in p for p in tool.problems(tmp_path, {"tests/test_bars_gone.py": "red"}))
    assert any("without a reason" in p for p in tool.problems(tmp_path, {"tests/test_bars_x.py": " "}))
    (t / "test_index_developing_bar.py").unlink()
    found = tool.problems(tmp_path, {})
    assert any("NAMED file is missing" in p for p in found) and any("REQUIRED file is not gated" in p for p in found)


# ── the pull-request copy (2026-11-22) ────────────────────────────────────────────────────────────
PR_WORKFLOW = REPO / ".github" / "workflows" / "bars-rails-pr.yml"


def _pr_doc() -> dict:
    return yaml.safe_load(PR_WORKFLOW.read_text(encoding="utf-8"))


def copy_problems(gate_job: dict, pr_job: dict) -> list[str]:
    """Every way the pull-request job differs from the gate's bars-rails job; empty when it is a faithful copy."""
    out = []
    if pr_job.get("steps") != gate_job.get("steps"):
        out.append("the pull-request job's steps are not the gate job's steps")
    if pr_job.get("timeout-minutes") != gate_job.get("timeout-minutes"):
        out.append("the pull-request job's timeout is not the gate job's")
    extra = set(pr_job) - {"name", "runs-on", "timeout-minutes", "steps"}
    if extra:
        out.append(f"the pull-request job carries keys the gate job may not: {sorted(extra)}")
    return out


def test_the_pull_request_job_is_the_gate_job_step_for_step():
    """Twelve of the 48 red gate runs of 2026-11-14..22 were this job, and no pull request had run it: #2365 merged
    with every check green and the gate went red on the file it changed. bars-rails-pr.yml runs the same steps
    before the merge; a copy that drifts reopens the gap without anyone seeing it."""
    pr = _pr_doc()
    assert set(pr["jobs"]) == {JOB}, sorted(pr["jobs"])
    assert copy_problems(_doc()["jobs"][JOB], pr["jobs"][JOB]) == []
    spec = importlib.util.spec_from_file_location("promotion_gate_for_the_bars_pr_copy", REPO / "tools" / "promotion_gate.py")
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)
    assert pg.classify(PR_WORKFLOW.read_text(encoding="utf-8")) == "no"      # a PR check never gates a promotion


def test_the_pull_request_job_runs_when_a_gated_file_or_what_it_reads_changes():
    """The path list is held to the tool's own patterns and names, so a rail added to tools/bars_gate_rails.py
    under a new pattern cannot be gated on master and silently skipped on the pull request."""
    doc = _pr_doc()
    on = doc.get("on", doc.get(True))
    assert set(on) == {"pull_request"}, f"bars-rails-pr.yml runs on pull requests only (the gate owns master): {sorted(on)}"
    trigger = on["pull_request"]
    assert trigger.get("branches") == ["master"]
    paths = set(trigger.get("paths") or [])
    tool = _tool()
    for needed in (*tool.PATTERNS, *tool.NAMED, "api/**", "services/**", "tools/**", "requirements.txt",
                   ".github/workflows/bars-rails-pr.yml", ".github/workflows/master-deploy-gate.yml"):
        assert needed in paths, f"bars-rails-pr.yml does not run when {needed} changes"


def test_copy_problems_can_fire():
    """Each kind of drift, planted on the real gate job, is named."""
    import copy
    gate_job = _doc()["jobs"][JOB]
    assert copy_problems(gate_job, copy.deepcopy(gate_job)) == []
    edited = copy.deepcopy(gate_job)
    edited["steps"][-1]["run"] = edited["steps"][-1]["run"].replace("$files", "tests/test_bar_contract.py")
    assert any("steps" in p for p in copy_problems(gate_job, edited))
    dropped = copy.deepcopy(gate_job)
    dropped["steps"].pop(0)
    assert any("steps" in p for p in copy_problems(gate_job, dropped))
    slow = copy.deepcopy(gate_job)
    slow["timeout-minutes"] = 360
    assert any("timeout" in p for p in copy_problems(gate_job, slow))
    optional = copy.deepcopy(gate_job)
    optional["continue-on-error"] = True
    assert any("keys" in p for p in copy_problems(gate_job, optional))
