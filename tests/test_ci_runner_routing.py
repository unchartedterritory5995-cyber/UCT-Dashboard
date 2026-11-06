"""Which machine runs which job is a deliberate, reviewed fact. These rails read the REAL workflows.

AUDIT's rules (2026-11-06): the owner's PC is advisory only and may never decide a merge. The VPS may run the gate's
heavy jobs if the hosted verdict requires each one to succeed. Promotion, the verdict, deploy-correctness, every
secret and every write stay GitHub-hosted. No automatic fallback; a variable can never move a merge-deciding job.
A failure here means a job moved. Update the pinned sets below only with AUDIT's review, in the same commit.
"""
from __future__ import annotations

import pathlib
import re
import sys

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
sys.path.insert(0, str(ROOT / "tools"))
import promotion_gate as pg  # noqa: E402

HOSTED = "ubuntu-latest"
GATE_LANE = ("${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/master' "
             "&& inputs.lane == 'hosted-fallback' && 'ubuntu-latest' || 'uct-vps' }}")
DISPATCH_LANE = "${{ github.event_name == 'workflow_dispatch' && inputs.lane == 'hosted-fallback' && 'ubuntu-latest' || 'uct-vps' }}"
PR_VPS = "${{ github.event_name == 'pull_request' && 'uct-vps' || 'ubuntu-latest' }}"
PC_ADVISORY = "${{ github.event_name == 'pull_request' && vars.UCT_PC_ADVISORY == 'on' && 'uct-pc' || 'ubuntu-latest' }}"

#: Every job not listed runs on the literal `ubuntu-latest`.
ROUTED = {
    ("master-deploy-gate.yml", "agent-browser"): GATE_LANE,
    ("master-deploy-gate.yml", "agent-browser-union"): GATE_LANE,
    ("master-deploy-gate.yml", "pine-runtime"): GATE_LANE,
    ("agent-ci.yml", "server"): DISPATCH_LANE,
    ("agent-ci.yml", "browser"): DISPATCH_LANE,
    ("agent-ci.yml", "capability-regression-clock"): DISPATCH_LANE,
    ("agent-ci.yml", "union"): DISPATCH_LANE,
    ("full-suite-report.yml", "vitest"): DISPATCH_LANE,
    ("full-suite-report.yml", "pytest"): DISPATCH_LANE,
    ("full-suite-report.yml", "collect_profile"): DISPATCH_LANE,
    ("clock-parity-fixture.yml", "fixture"): PR_VPS,
    ("notebook-a11y.yml", "a11y"): PR_VPS,
    ("notebook-bytes.yml", "bytes"): PR_VPS,
    ("notebook-latency.yml", "ratio"): PR_VPS,
    ("notebook-latency.yml", "write-protection"): PR_VPS,
    ("optionsflow-guard.yml", "guard"): PR_VPS,
    ("term018-guards.yml", "static"): PR_VPS,
    ("vite-build-args.yml", "build-args"): PR_VPS,
    ("wisdom-rails.yml", "rails"): PR_VPS,
    ("notebook-budgets.yml", "latency"): PC_ADVISORY,
    ("preference-allowlist.yml", "allowlist"): PC_ADVISORY,
    ("flow-worker-deploy-coverage.yml", "coverage"): PC_ADVISORY,
}
#: The only workflows allowed anywhere near the PC. None gates promotion, and AUDIT must not read them by name.
ADVISORY_ON_PC = {"notebook-budgets.yml", "preference-allowlist.yml", "flow-worker-deploy-coverage.yml"}


def _workflows():
    return [(f.name, yaml.safe_load(f.read_text(encoding="utf-8")), f.read_text(encoding="utf-8"))
            for f in sorted(WORKFLOWS.glob("*.y*ml"))]


def _jobs():
    return [(name, job_id, job) for name, doc, _ in _workflows() for job_id, job in doc["jobs"].items()]


def _gate():
    return yaml.safe_load((WORKFLOWS / "master-deploy-gate.yml").read_text(encoding="utf-8"))


def test_every_job_runs_where_it_is_pinned():
    wrong = []
    for name, job_id, job in _jobs():
        want = ROUTED.get((name, job_id), HOSTED)
        if job.get("runs-on") != want:
            wrong.append(f"{name}:{job_id} runs-on {job.get('runs-on')!r}")
    assert not wrong, "jobs not on their pinned machine:\n" + "\n".join(wrong)


def test_the_routing_table_names_only_real_jobs():
    real = {(name, job_id) for name, job_id, _ in _jobs()}
    assert set(ROUTED) <= real, sorted(set(ROUTED) - real)


@pytest.mark.parametrize("job_id", ["gate", "verdict", "runner-watchdog"])
def test_the_gate_core_stays_hosted_as_a_literal(job_id):
    assert _gate()["jobs"][job_id]["runs-on"] == HOSTED


def test_promotion_stays_hosted_as_a_literal():
    doc = yaml.safe_load((WORKFLOWS / "promote-production.yml").read_text(encoding="utf-8"))
    assert {j["runs-on"] for j in doc["jobs"].values()} == {HOSTED}


def test_no_variable_can_move_a_merge_deciding_job():
    """`vars.` in runs-on is allowed in one exact expression, compared to a literal, in advisory workflows. A wrong
    or unset value lands on hosted, and the value is never used as a label, so no value can name another machine."""
    for name, _, job in _jobs():
        expr = str(job.get("runs-on"))
        if "vars." in expr:
            assert expr == PC_ADVISORY and name in ADVISORY_ON_PC, (name, expr)


def test_the_gate_workflow_reads_no_variable_at_all():
    text = (WORKFLOWS / "master-deploy-gate.yml").read_text(encoding="utf-8")
    assert "vars." not in text, "a repository variable reached the master gate"


def test_the_pc_label_is_absent_from_everything_that_can_decide_a_merge():
    for name, _, text in _workflows():
        if name in ADVISORY_ON_PC or name == "ci-runner-watch.yml":
            continue
        assert "uct-pc" not in text, f"{name} names the owner's PC"


def test_every_pc_lane_workflow_is_advisory_for_promotion():
    for name in ADVISORY_ON_PC:
        assert pg.classify((WORKFLOWS / name).read_text(encoding="utf-8")) == "no", name


def test_a_master_push_never_routes_a_promotion_gating_rail_off_hosted():
    """The PR leg may use the VPS; these rails are read by promotion on master, and that leg stays hosted."""
    for (name, job_id), expr in ROUTED.items():
        if pg.classify((WORKFLOWS / name).read_text(encoding="utf-8")) == "yes" and name != "master-deploy-gate.yml":
            assert expr == PR_VPS, (name, job_id, expr)


def test_no_automatic_fallback_exists():
    """The only path back to hosted is a manual dispatch input. A step cannot pick a runner, so the expressions are
    the whole surface: nothing tests a job's result or a runner's state."""
    for expr in set(ROUTED.values()):
        assert not re.search(r"\b(needs|steps|job|runner|failure|cancelled)\b", expr.replace("github.event_name", "")), expr
    assert "hosted-fallback" not in PR_VPS + PC_ADVISORY


def test_the_fallback_input_defaults_to_the_vps_and_gates_only_master():
    on = _gate().get("on", _gate().get(True))
    lane = on["workflow_dispatch"]["inputs"]["lane"]
    assert lane["default"] == "vps" and lane["options"] == ["vps", "hosted-fallback"]
    assert "github.ref == 'refs/heads/master'" in GATE_LANE


def test_no_job_on_a_self_hosted_lane_can_see_a_secret():
    """Any job whose text reads secrets.* stays hosted. Includes `github.token` use in a step env."""
    for name, job_id, job in _jobs():
        if (name, job_id) in ROUTED:
            body = yaml.safe_dump(job)
            assert "secrets." not in body, (name, job_id)
            assert "github.token" not in body, (name, job_id)


def test_no_job_on_a_self_hosted_lane_can_write():
    for name, doc, _ in _workflows():
        for job_id, job in doc["jobs"].items():
            if (name, job_id) in ROUTED:
                perms = {**(doc.get("permissions") or {}), **(job.get("permissions") or {})}
                assert "write" not in perms.values(), (name, job_id, perms)


def test_no_job_on_a_self_hosted_lane_needs_a_container_runtime():
    for name, job_id, job in _jobs():
        if (name, job_id) in ROUTED:
            assert "container" not in job and "services" not in job, (name, job_id)


def test_every_heavy_gate_job_has_a_timeout_and_cannot_be_skipped():
    jobs = _gate()["jobs"]
    for job_id in ("agent-browser", "agent-browser-union", "pine-runtime"):
        job = jobs[job_id]
        assert isinstance(job.get("timeout-minutes"), int), job_id
        assert "if" not in job and "continue-on-error" not in job, job_id


def test_timeouts_were_not_quietly_raised():
    """Weaker hardware may run these near their limits; that is a finding to raise, never a number to change here."""
    jobs = _gate()["jobs"]
    assert (jobs["agent-browser"]["timeout-minutes"], jobs["agent-browser-union"]["timeout-minutes"],
            jobs["pine-runtime"]["timeout-minutes"]) == (30, 15, 30)


def test_the_verdict_requires_every_job_by_exact_success():
    verdict = _gate()["jobs"]["verdict"]
    assert verdict["needs"] == ["gate", "agent-browser", "agent-browser-union", "pine-runtime", "runner-watchdog"]
    assert verdict["if"] == "always()"
    run = verdict["steps"][0]["run"]
    for need in verdict["needs"]:
        assert f'[ "${{{{ needs.{need}.result }}}}" = success ]' in run, need


def test_job_names_are_unchanged():
    """Check names are what AUDIT and promotion read. The watchdog is the one addition."""
    assert {k: v.get("name") for k, v in _gate()["jobs"].items()} == {
        "gate": "deploy-correctness checks + Agent server tests",
        "agent-browser": "UCT Agent browser tests (shard ${{ matrix.shard }}/4)",
        "agent-browser-union": "Agent shards cover every Agent test file (equivalence rail)",
        "pine-runtime": "Pine runtime service rails (section 8)",
        "runner-watchdog": "VPS runner online (hosted watchdog)",
        "verdict": "master deploy gate verdict",
    }


def test_the_watchdog_cancels_rather_than_leaves_the_queue_held():
    job = _gate()["jobs"]["runner-watchdog"]
    steps = {s.get("name"): s for s in job["steps"]}
    assert "gh run cancel" in steps["End the run instead of leaving it queued"]["run"]
    assert steps["End the run instead of leaving it queued"]["if"] == "failure()"
    assert "ci_runner_watchdog.py gate --label uct-vps" in steps["A runner labelled uct-vps is online"]["run"]
    assert job["permissions"]["actions"] == "write" and "contents" in job["permissions"]


# ---- what promotion does with each way a self-hosted job can end, through the real decision code

def _decide(*runs):
    gating = [pg.ALWAYS_RUNS]
    wf = [{"name": pg.ALWAYS_RUNS, "state": "active"}]
    return pg.decide(gating=gating, runs=list(runs), workflows=wf)[0]


def _run(status, conclusion):
    return {"name": pg.ALWAYS_RUNS, "status": status, "conclusion": conclusion}


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out", "skipped", "startup_failure", "stale", None])
def test_no_conclusion_but_success_promotes(conclusion):
    assert _decide(_run("completed", conclusion)) == pg.REFUSE


@pytest.mark.parametrize("status", ["queued", "in_progress", "waiting", "pending"])
def test_a_queued_gate_waits_and_never_promotes(status):
    assert _decide(_run(status, None)) == pg.WAIT


def test_a_green_fallback_run_does_not_launder_a_cancelled_run_on_the_same_commit():
    """A fact AUDIT has to rule on (AUDIT-NOTES.md, 'Fallback'): today's promotion reads every run for a SHA, so a
    manual fallback that passes on a commit whose push run was cancelled still REFUSES. Safe, and it means the
    fallback cannot rescue that commit without a reviewed change to promotion_gate."""
    assert _decide(_run("completed", "cancelled"), _run("completed", "success")) == pg.REFUSE
