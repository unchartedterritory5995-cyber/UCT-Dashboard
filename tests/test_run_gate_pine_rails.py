"""The PR job runs the gate's Pine runtime rails, read from the gate, never retyped (2026-11-15)."""
import yaml

from tools import run_gate_pine_rails as R


def test_it_reads_the_gates_pytest_commands_including_the_two_that_broke_master():
    files = " ".join(" ".join(c) for c in R.gate_commands())
    assert "tests/test_pine_runtime_deploy_gate.py" in files      # the unnamed-test census
    assert "tests/test_pine_runtime_service_smoke.py" in files    # the engine-fixture rail


def test_a_gate_without_the_job_cannot_be_judged(tmp_path, monkeypatch):
    p = tmp_path / "gate.yml"
    p.write_text(yaml.safe_dump({"jobs": {"other": {"steps": [{"run": "echo hi"}]}}}), encoding="utf-8")
    assert R.gate_commands(str(p)) == []
    monkeypatch.setattr(R, "GATE", str(p))
    assert R.main(["--list"]) == 2


def test_the_pr_workflow_triggers_on_what_broke_master_and_runs_the_reader():
    wf = yaml.safe_load(open(".github/workflows/pine-gate-rails-pr.yml", encoding="utf-8"))
    on = wf.get(True) or wf.get("on")
    paths = on["pull_request"]["paths"]
    for p in ("tests/test_pine_runtime_*.py", "tests/fixtures/pine_runtime/**",
              "app/src/components/chart/engine/**", ".github/workflows/master-deploy-gate.yml"):
        assert p in paths, p
    runs = " ".join(str(s.get("run") or "") for s in wf["jobs"]["pine-gate-rails"]["steps"])
    assert "tools/run_gate_pine_rails.py" in runs
