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


# DUP-RECEIPT (11-05, owner): the browser step runs `npx vitest run $AGENT_VITEST_PATHS` — ONE list (the workflow's
# top-level env, the same as agent-ci.yml's) shared by the shard run, the `vitest list` equivalence rail and the repro
# hints: src/agent, the builder's agentMutations, and the page tests that drive the Agent outside src/agent
AGENT_PAGE_TESTS = [
    "src/components/chart/builder/studio/agentRoute.test.jsx",
    "src/components/StockChart.timeRangeSync.test.jsx",
    "src/pages/breadth/breadthTabHookOrder.test.jsx",
    "src/pages/charts/ChartsWorkspace.layoutUndoAgent.test.jsx",
    "src/pages/charts/ChartsWorkspace.previousLayout.test.jsx",
    "src/pages/charts/ChartsWorkspace.thisChart.test.jsx",
    "src/pages/charts/widgets/ChartWidget.agent.test.jsx",
    "src/pages/charts/widgets/TradeExchangeNewsWidget.terminal.test.jsx",
]


def _agent_vitest_paths(workflow: pathlib.Path = WORKFLOW) -> list[str]:
    """The workflow's top-level `AGENT_VITEST_PATHS` (its `env:` block, before `jobs:`), split into paths."""
    head = workflow.read_text(encoding="utf-8").split("\njobs:")[0]
    m = re.search(r"(?m)^  AGENT_VITEST_PATHS: (.+)$", head)
    assert m, f"{workflow.name} has no top-level AGENT_VITEST_PATHS"
    return m.group(1).split()


def test_the_agent_vitest_paths_hold_the_agent_suite_and_every_agent_driving_page_test():
    for wf in (WORKFLOW, REPO / ".github" / "workflows" / "agent-ci.yml"):
        paths = _agent_vitest_paths(wf)
        assert paths[:2] == ["src/agent", "src/components/chart/builder/agentMutations"], (wf.name, paths)
        assert sorted(paths[2:]) == sorted(AGENT_PAGE_TESTS), (wf.name, paths)
    assert _agent_vitest_paths(WORKFLOW) == _agent_vitest_paths(REPO / ".github" / "workflows" / "agent-ci.yml")   # ONE list
    for p in AGENT_PAGE_TESTS:
        assert (REPO / "app" / p).is_file(), f"{p} is listed but does not exist — renamed? (an absent path runs nothing)"


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
    assert "npx vitest run $AGENT_VITEST_PATHS" in body       # the one list (env), never a narrower literal
    paths = _agent_vitest_paths()
    assert "src/agent" in paths
    assert "src/components/chart/builder/agentMutations" in paths   # the Indicators interface the Agent writes through
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
    ok = lambda n: {"name": n, "status": "completed", "conclusion": "success", "head_branch": "master", "event": "push"}
    failed = [{"name": gate_name, "status": "completed", "conclusion": "failure", "head_branch": "master", "event": "push"}]
    verdict, why = pg.decide(gating=gating, runs=failed, workflows=wf)
    assert verdict == pg.REFUSE and gate_name in why
    # …and the same commit with a green gate WOULD promote (the refusal is the failure's doing)
    assert pg.decide(gating=gating, runs=[ok(gate_name)], workflows=wf)[0] == pg.PROMOTE
    # a gate still running is never promoted either
    running = [{"name": gate_name, "status": "in_progress", "conclusion": None, "head_branch": "master", "event": "push"}]
    assert pg.decide(gating=gating, runs=running, workflows=wf)[0] == pg.WAIT
    # a CANCELLED gate refuses, and a gate that never ran for the commit (MISSING) refuses — it is
    # the always-runs check, so its absence is a fault, never "not relevant"
    cancelled = [{"name": gate_name, "status": "completed", "conclusion": "cancelled", "head_branch": "master", "event": "push"}]
    assert pg.decide(gating=gating, runs=cancelled, workflows=wf)[0] == pg.REFUSE
    assert pg.decide(gating=gating, runs=[], workflows=wf)[0] == pg.REFUSE
    other = [ok(n) for n in gating if n != gate_name]
    assert pg.decide(gating=gating, runs=other, workflows=wf)[0] == pg.REFUSE


def _promotion_class(path: pathlib.Path) -> str | None:
    """The `# promotion-gate: yes|no` marker tools/promotion_gate.py reads (first token after the
    marker, within the file's head), or None when the file declares nothing."""
    for line in path.read_text(encoding="utf-8").splitlines()[:40]:
        if line.startswith("# promotion-gate:"):
            head = line.split(":", 1)[1].strip().split()[0] if line.split(":", 1)[1].strip() else ""
            return head if head in ("yes", "no") else None
    return None


def test_no_OTHER_workflow_is_an_agent_gate():
    """One Agent GATE, inside the always-runs job. A separate promotion-gate workflow for the Agent
    suites is NOT equivalent: promotion treats an absent run of a non-always-runs gating workflow
    as "not relevant" and promotes — so a run that never started would let an untested Agent out
    (the reconciled "UCT Agent guard" workflow, removed 2026-10-11).

    Amended 2026-11-02 (owner-approved, Wave 1): a workflow that runs the Agent suites but is
    classified `# promotion-gate: no` is ADDITIVE CI, not a gate — promotion never consults it, so
    it cannot create the hole above. Such workflows are allowed, and pinned by name below so a new
    one is a deliberate change. Any workflow naming the Agent suites that is `yes` or unclassified
    is still refused: the gate's own Agent steps remain the only promotion-deciding Agent run."""
    others = [w for w in (REPO / ".github" / "workflows").glob("*.y*ml") if w.name != WORKFLOW.name]
    naming = [w for w in others if re.search(r"test_uct_agent|vitest run src/agent|AGENT_VITEST_PATHS", w.read_text(encoding="utf-8"))]
    offenders = [w.name for w in naming if _promotion_class(w) != "no"]
    assert offenders == [], f"Agent suites gated outside {WORKFLOW.name}: {offenders}"
    additive = sorted(w.name for w in naming)
    assert additive == ["agent-ci-benchmark.yml", "agent-ci.yml"], additive   # additive Agent CI, by name
    for w in naming:   # additive CI never pretends to gate: no `promotion-gate: yes`, and it never runs on master pushes
        text = w.read_text(encoding="utf-8")
        on = text.split("\njobs:")[0]
        push = re.search(r"(?ms)^\s+push:\s*\n\s+branches:\s*\[([^\]]*)\]", on)
        assert push is not None, f"{w.name}: no push.branches block to inspect"
        assert not re.search(r"(^|[,\s'\"])master([,\s'\"]|$)", push.group(1)), f"{w.name} must not run on master pushes (PRs into master are fine; they never decide promotion)"


def test_the_gate_still_runs_the_agent_suites_itself():
    """The amendment above must never be read as 'the Agent suites moved to agent-ci'. The gate's
    own server and browser steps are the mandatory coverage; this pins them next to the exemption."""
    assert "pytest tests/test_uct_agent*.py" in _step(SERVER_STEP)["body"]
    assert "npx vitest run $AGENT_VITEST_PATHS" in _step(BROWSER_STEP)["body"]
    assert "src/agent" in _agent_vitest_paths()
