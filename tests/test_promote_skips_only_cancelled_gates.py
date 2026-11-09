"""promote-production skips its job for a CANCELLED gate, and for nothing else.

Why: a cancelled gate is a pile-up artifact (a newer master push superseded it, and the next gate covers the
commit), so failing the promotion run only mailed the owner a false "failed". But the step that fails on a
non-green gate is also what stops every later step from running, so the fix must be a job-level skip scoped to
`cancelled` exactly. These rails pin both halves: the skip names only `cancelled`, and the step still exits 1.
"""
import pathlib
import re

import yaml

WF = pathlib.Path(__file__).resolve().parents[1] / ".github" / "workflows" / "promote-production.yml"


def _job():
    return yaml.safe_load(WF.read_text(encoding="utf-8"))["jobs"]["promote"]


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _skips(job_if: str, event: str, conclusion: str) -> bool:
    """Evaluate the job-level `if` for one (event, conclusion) pair. Only the two operands it may use are bound;
    anything else in the expression makes this raise, so a widened condition cannot pass by accident."""
    expr = _norm(job_if)
    expr = expr.replace("github.event_name", repr(event)).replace("github.event.workflow_run.conclusion", repr(conclusion))
    expr = expr.replace("||", " or ").replace("&&", " and ")
    return not eval(expr, {"__builtins__": {}}, {})  # noqa: S307 -- operands are our own literals


def test_the_job_skips_exactly_a_cancelled_workflow_run():
    job_if = _job().get("if")
    assert job_if, "promote job lost its job-level `if` (cancelled gates would mail a false failure again)"
    assert _skips(job_if, "workflow_run", "cancelled") is True
    for conclusion in ("success", "failure", "timed_out", "startup_failure", "action_required", "neutral", "stale", "skipped"):
        assert _skips(job_if, "workflow_run", conclusion) is False, f"job would be skipped for a `{conclusion}` gate"
    for event in ("workflow_dispatch", "schedule"):
        assert _skips(job_if, event, "") is False, f"job would be skipped on `{event}`"


def test_the_gate_step_still_fails_on_any_non_green_gate():
    """The skip must not be achieved by softening this step: its exit 1 is what stops the poll and the fast-forward."""
    steps = _job()["steps"]
    step = next(s for s in steps if s.get("name") == "The triggering gate must have succeeded")
    assert _norm(step["if"]) == "github.event_name == 'workflow_run' && github.event.workflow_run.conclusion != 'success'"
    assert re.search(r"(?m)^\s*exit 1\s*$", step["run"]), "the gate step no longer exits 1 on a non-green gate"


def test_the_control_a_widened_skip_is_caught():
    """CONTROL: the evaluator must say a skip-on-anything-but-success condition is wrong, or rail 1 proves nothing."""
    widened = "github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'"
    assert _skips(widened, "workflow_run", "failure") is True
