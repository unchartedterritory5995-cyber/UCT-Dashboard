"""Rails for tools/live_check.py: the "is everything live?" report.

The tool's own --self-check holds the verdict table (stuck / on the way / hand / can't check / live, the glob
rules, the alert rule). These rails make that table part of the suite, prove it can FAIL (a self-check that
cannot fail proves nothing), and pin the two workflow properties that matter: it never gates a deploy, and it
never reads Railway variables in this public repo's Actions logs.
"""
from __future__ import annotations

import importlib.util
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "live-check.yml"


def _tool():
    spec = importlib.util.spec_from_file_location("_live_check_under_test", ROOT / "tools" / "live_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_self_check_passes(capsys):
    assert _tool().self_check() == 0, capsys.readouterr().out


def test_self_check_can_fail_when_the_stuck_threshold_is_broken(capsys):
    # control: with an unreachable threshold an unpromoted commit is never "stuck", and the table must notice
    mod = _tool()
    mod.PROMOTE_STUCK_MIN = 10 ** 9
    assert mod.self_check() == 1
    assert "BAD unpromoted 3h, no hold -> STUCK" in capsys.readouterr().out


def test_self_check_can_fail_when_cant_check_reads_as_live(capsys):
    # control: a missing source must never be reported as live
    mod = _tool()
    mod.exit_code = lambda rows: 0
    assert mod.self_check() == 1
    assert "BAD no Railway -> CAN'T CHECK, exit 2" in capsys.readouterr().out


def test_workflow_never_gates_a_deploy():
    head = "\n".join(WORKFLOW.read_text(encoding="utf-8").splitlines()[:5])
    assert "# promotion-gate: no" in head


def _commands(doc):
    return [s.get("run", "") for job in doc["jobs"].values() for s in job["steps"]]


def test_workflow_never_reads_railway_variables():
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    runs = _commands(doc)
    assert any("tools/live_check.py" in r and "--post" in r for r in runs), "the check step is missing"
    assert not any("--flag-values" in r for r in runs)


def test_workflow_sparse_checkout_carries_every_file_the_tool_reads():
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    checkout = next(s for s in doc["jobs"]["check"]["steps"] if str(s.get("uses", "")).startswith("actions/checkout"))
    listed = set(checkout["with"]["sparse-checkout"].split())
    src = (ROOT / "tools" / "live_check.py").read_text(encoding="utf-8")
    freeze = (ROOT / "tools" / "deploy_freeze.py").read_text(encoding="utf-8")
    assert '"deploy_freeze.py"' in src and "tools/deploy_freeze.py" in listed
    assert '"feature_flags.json"' in src and "docs/feature_flags.json" in listed
    assert '"measurement_window.py"' in freeze and "api/services/measurement_window.py" in listed


def test_a_red_report_does_not_end_the_step_before_its_exit_is_read():
    # Actions runs `bash -e`: a bare `code=$?` after the command is never reached when the report exits 1 or 2
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    step = next(r for r in _commands(doc) if "tools/live_check.py" in r and "--post" in r)
    call = next(line for line in step.splitlines() if "tools/live_check.py" in line and not line.strip().startswith("#"))
    assert call.rstrip().endswith("|| code=$?"), call


def test_runs_queue_instead_of_cancelling_each_other():
    # a skipped promotion run cancelled the first real run while cancel-in-progress was true
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert doc["concurrency"]["cancel-in-progress"] is False
