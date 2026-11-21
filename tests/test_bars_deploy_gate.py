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
