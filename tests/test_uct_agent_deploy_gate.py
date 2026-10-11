"""The master deploy gate RUNS the UCT Agent's tests, and cannot quietly stop doing so.

The p25 Agent release reached production with no Agent test in `.github/workflows/master-deploy-gate.yml`.
This rail reads the REAL workflow (never a copy) and fails if the Agent steps disappear, become
conditional or optional, lose their tests, or stop matching the Agent test files that exist. It
lives inside the gate's own `tests/test_uct_agent*.py` glob, so it runs in the gate it guards.
"""
from __future__ import annotations

import glob
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "master-deploy-gate.yml"
SERVER_STEP = "UCT Agent server tests (production dependency set)"
BROWSER_STEP = "UCT Agent browser tests"
INSTALL_STEP = "Install the app's dependencies (for the UCT Agent browser tests)"


def _steps() -> list[dict]:
    """The gate job's steps as {name, body}: text between one `- name:`/`- uses:` and the next."""
    text = WORKFLOW.read_text(encoding="utf-8")
    starts = [m.start() for m in re.finditer(r"(?m)^      - (?:name|uses):", text)]
    out = []
    for i, s in enumerate(starts):
        body = text[s: starts[i + 1] if i + 1 < len(starts) else len(text)]
        m = re.match(r"      - name: (.+)", body)
        out.append({"name": m.group(1).strip() if m else body.splitlines()[0].strip(), "body": body})
    return out


def _step(fragment: str) -> dict:   # an EXACT step name
    hits = [s for s in _steps() if s["name"] == fragment]
    assert len(hits) == 1, f"the deploy gate has {len(hits)} steps named {fragment!r} — renamed or removed?"
    return hits[0]


@pytest.mark.parametrize("fragment", [SERVER_STEP, INSTALL_STEP, BROWSER_STEP])
def test_the_agent_steps_exist_and_are_never_conditional_or_optional(fragment):
    body = _step(fragment)["body"]
    assert not re.search(r"(?m)^\s+if:", body), f"{fragment!r} must always run (no `if:`)"
    assert "continue-on-error" not in body, f"{fragment!r} must be able to fail the gate"


def test_the_gate_runs_on_every_master_push_with_no_path_filter():
    text = WORKFLOW.read_text(encoding="utf-8")
    on = text.split("\njobs:")[0]
    assert re.search(r"push:\s*\n\s+branches: \[master, main\]", on)
    assert "paths:" not in on and "paths-ignore:" not in on


def test_the_server_step_covers_EVERY_agent_server_test_file():
    body = _step(SERVER_STEP)["body"]
    assert "pytest tests/test_uct_agent*.py" in body          # a glob: a new Agent test file is included
    files = sorted(glob.glob(str(REPO / "tests" / "test_uct_agent*.py")))
    assert len(files) >= 5, files                             # the suite really exists
    assert any(f.endswith("test_uct_agent_deploy_gate.py") for f in files)   # and holds this rail


def test_the_browser_step_runs_the_agent_suite_and_refuses_an_empty_one():
    body = _step(BROWSER_STEP)["body"]
    assert "npx vitest run src/agent" in body
    assert "agentMutations" in body                           # the Indicators interface the Agent writes through
    assert "--passWithNoTests" not in body and "passWithNoTests" not in body
    floor = int(re.search(r'-lt (\d+) \]', body).group(1))
    have = len(glob.glob(str(REPO / "app" / "src" / "agent" / "*.test.js"))) + len(glob.glob(str(REPO / "app" / "src" / "agent" / "*.test.jsx")))
    assert floor >= 30 and have >= floor, (floor, have)       # the floor is real, and today's suite clears it


def test_the_browser_step_comes_after_node_and_install():
    names = [s["name"] for s in _steps()]
    i_node = next(i for i, s in enumerate(_steps()) if "actions/setup-node" in s["body"])
    assert i_node < names.index(INSTALL_STEP) < names.index(BROWSER_STEP)


def test_a_FAILED_agent_step_refuses_PROMOTION_through_the_real_promotion_rules():
    """The Agent steps live inside `master deploy gate`; promotion (tools/promotion_gate.py, used by
    every promote trigger: after the gate, manual dispatch, the Wednesday schedule) refuses a commit
    whose gate did not succeed. Proved with the REAL workflow directory and the REAL decision code."""
    import sys
    sys.path.insert(0, str(REPO / "tools"))
    import promotion_gate as pg
    verdicts, unclassified = pg.read_workflow_dir(str(REPO))
    assert not unclassified, unclassified
    gate_name = re.search(r"(?m)^name:\s*(.+)$", WORKFLOW.read_text(encoding="utf-8")).group(1).strip()
    assert gate_name == pg.ALWAYS_RUNS and verdicts[gate_name] == "yes"     # the Agent tests run in THE gating job
    gating = [n for n, v in verdicts.items() if v == "yes"]
    wf = [{"name": n, "state": "active"} for n in verdicts]
    ok = lambda n: {"name": n, "status": "completed", "conclusion": "success"}
    failed = [{"name": gate_name, "status": "completed", "conclusion": "failure"}]
    verdict, why = pg.decide(gating=gating, runs=failed, workflows=wf)
    assert verdict == pg.REFUSE and gate_name in why
    # …and the same commit with a green gate WOULD promote (the refusal is the failure's doing)
    assert pg.decide(gating=gating, runs=[ok(gate_name)], workflows=wf)[0] == pg.PROMOTE
    # a gate still running is never promoted either
    running = [{"name": gate_name, "status": "in_progress", "conclusion": None}]
    assert pg.decide(gating=gating, runs=running, workflows=wf)[0] == pg.WAIT
