"""Which machine runs which job is a deliberate, reviewed fact. These rails read the REAL workflows.

AUDIT's rules (2026-11-06): the owner's PC never appears in a workflow. The VPS may run the gate's heavy jobs if the
hosted verdict requires each to succeed. Promotion, the verdict, deploy-correctness, every secret and every write stay
GitHub-hosted. No automatic fallback, and no repository variable can move a job at all.
A failure here means a job moved. Update the pinned sets below only with AUDIT's review, in the same commit.
"""
from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
import sys

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
sys.path.insert(0, str(ROOT / "tools"))
import promotion_gate as pg  # noqa: E402

HOSTED = "ubuntu-latest"
GATE_LANE = ("${{ github.event_name == 'workflow_dispatch' && (github.ref != 'refs/heads/master' "
             "|| inputs.lane == 'hosted-fallback') && 'ubuntu-latest' || 'uct-vps-gate' }}")
DISPATCH_LANE = "${{ github.event_name == 'workflow_dispatch' && inputs.lane == 'hosted-fallback' && 'ubuntu-latest' || 'uct-vps' }}"
SHADOW_LANE = ("${{ github.event_name == 'workflow_dispatch' && inputs.lane != 'hosted-fallback' && 'uct-vps' "
               "|| inputs.lane == 'vps' && 'uct-vps' || 'ubuntu-latest' }}")

#: The five rails AUDIT allows on the VPS. A push to master stays hosted until the switch commit.
VPS_RAILS = {"wisdom-rails.yml": "rails", "term018-guards.yml": "static", "optionsflow-guard.yml": "guard",
             "notebook-bytes.yml": "bytes", "notebook-a11y.yml": "a11y"}
#: Advisory, and allowed on the VPS on the master side only. Their PR legs stay hosted.
MASTER_SIDE = {"notebook-budgets.yml": "latency", "preference-allowlist.yml": "allowlist",
               "flow-worker-deploy-coverage.yml": "coverage"}
SHADOW_ONLY = "${{ inputs.lane == 'vps' && 'uct-vps' || 'ubuntu-latest' }}"
#: AUDIT: these never move.
HOSTED_RAILS = {"vite-build-args.yml", "notebook-latency.yml", "clock-parity-fixture.yml", "indicators-security-suite.yml"}
GATE_HEAVY = ("agent-server", "agent-browser", "agent-browser-union", "pine-runtime")

#: Every job not listed runs on the literal `ubuntu-latest`.
ROUTED = {
    **{("master-deploy-gate.yml", j): GATE_LANE for j in GATE_HEAVY},
    **{("agent-ci.yml", j): DISPATCH_LANE for j in ("server", "browser", "capability-regression-clock", "union")},
    **{("full-suite-report.yml", j): DISPATCH_LANE for j in ("vitest", "pytest", "collect_profile")},
    **{(f, j): SHADOW_LANE for f, j in VPS_RAILS.items()},
    **{(f, j): SHADOW_ONLY for f, j in MASTER_SIDE.items()},
}


def _text(name):
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def _workflows():
    return [(f.name, yaml.safe_load(f.read_text(encoding="utf-8")), f.read_text(encoding="utf-8"))
            for f in sorted(WORKFLOWS.glob("*.y*ml"))]


def _jobs():
    return [(name, job_id, job) for name, doc, _ in _workflows() for job_id, job in doc["jobs"].items()]


def _gate():
    return yaml.safe_load(_text("master-deploy-gate.yml"))


def _verdict_step():
    return next(s for s in _gate()["jobs"]["verdict"]["steps"] if s.get("name") == "Every gate job succeeded")


def _on(doc):
    return doc.get("on", doc.get(True))


def test_every_job_runs_where_it_is_pinned():
    wrong = []
    for name, job_id, job in _jobs():
        if "uses" in job:        # a call into a pinned workflow, which has no runs-on of its own
            continue
        want = ROUTED.get((name, job_id), HOSTED)
        if job.get("runs-on") != want:
            wrong.append(f"{name}:{job_id} runs-on {job.get('runs-on')!r}")
    assert not wrong, "jobs not on their pinned machine:\n" + "\n".join(wrong)


def test_the_routing_table_names_only_real_jobs():
    real = {(name, job_id) for name, job_id, _ in _jobs()}
    assert set(ROUTED) <= real, sorted(set(ROUTED) - real)


@pytest.mark.parametrize("job_id", ["gate", "verdict"])
def test_the_gate_core_stays_hosted_as_a_literal(job_id):
    assert _gate()["jobs"][job_id]["runs-on"] == HOSTED


def test_promotion_stays_hosted_as_a_literal():
    assert {j["runs-on"] for j in yaml.safe_load(_text("promote-production.yml"))["jobs"].values()} == {HOSTED}


def test_no_variable_can_move_any_job():
    for name, job_id, job in _jobs():
        assert "vars." not in str(job.get("runs-on")), (name, job_id)


def test_the_gate_workflow_reads_no_variable_at_all():
    assert "vars." not in _text("master-deploy-gate.yml")


def test_the_owners_pc_is_in_no_workflow():
    """AUDIT reads ALL of a PR's checks and stops on anything not SUCCESS or SKIPPED, so a PC check could stop the
    queue, and one with a matching name could satisfy it. The PC therefore reports nowhere on GitHub."""
    for name, _, text in _workflows():
        assert "uct-pc" not in text, name


def test_the_hosted_rails_never_move():
    for name in HOSTED_RAILS:
        doc = yaml.safe_load(_text(name))
        assert {j["runs-on"] for j in doc["jobs"].values()} == {HOSTED}, name


def test_the_rail_markers_and_names_are_unchanged():
    want = {"wisdom-rails.yml": "wisdom rails", "term018-guards.yml": "term018 guards", "optionsflow-guard.yml": "Options Flow guard",
            "notebook-bytes.yml": "notebook bytes", "notebook-a11y.yml": "Notebook accessibility",
            "vite-build-args.yml": "vite build args", "notebook-latency.yml": "notebook latency",
            "clock-parity-fixture.yml": "Clock parity fixture"}
    for name, title in want.items():
        assert pg.classify(_text(name)) == "yes", name
        assert yaml.safe_load(_text(name))["name"] == title, name


def test_a_rail_that_starts_using_a_secret_must_go_back_to_hosted():
    """AUDIT ruling 2. Reads the whole file, so a secret at workflow level counts too."""
    for name in {**VPS_RAILS, **MASTER_SIDE}:
        assert "secrets." not in _text(name), f"{name} reads a secret: it must return to hosted"


def test_flow_worker_coverage_can_never_become_a_gate():
    """Owner ruling b9acfddbd: it exits 0 on a red, so it can never block a deploy. Moving machines must not change that."""
    text = _text("flow-worker-deploy-coverage.yml")
    assert pg.classify(text) == "no"
    assert yaml.safe_load(text)["jobs"]["coverage"]["steps"][-1]["run"].rstrip().endswith("exit 0")


def test_the_three_advisory_workflows_keep_their_pr_triggers():
    for name in MASTER_SIDE:
        assert pg.classify(_text(name)) == "no", name
        assert "pull_request" in _on(yaml.safe_load(_text(name))), name


def test_no_job_on_a_self_hosted_lane_can_see_a_secret():
    for name, job_id, job in _jobs():
        if (name, job_id) in ROUTED:
            body = yaml.safe_dump(job)
            assert "secrets." not in body and "github.token" not in body, (name, job_id)


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


def test_no_automatic_fallback_exists():
    """The only path to hosted is a manual dispatch input, so nothing here tests a result or a runner's state."""
    for expr in set(ROUTED.values()):
        assert not re.search(r"\b(needs|steps|job|runner|failure|cancelled)\b", expr.replace("github.event_name", "")), expr


def test_the_fallback_input_defaults_to_the_vps():
    lane = _on(_gate())["workflow_dispatch"]["inputs"]["lane"]
    assert lane["default"] == "vps" and lane["options"] == ["vps", "hosted-fallback"]


# ---- AUDIT B3: reserved gate capacity

def test_only_the_gate_can_use_the_reserved_label():
    for name, job_id, job in _jobs():
        if "uct-vps-gate" in str(job.get("runs-on")):
            assert name == "master-deploy-gate.yml" and job_id in GATE_HEAVY, (name, job_id)


def test_no_gate_job_uses_the_shared_label():
    for job_id in GATE_HEAVY:
        assert "'uct-vps'" not in _gate()["jobs"][job_id]["runs-on"], job_id


def test_the_watch_covers_both_labels():
    run = yaml.safe_load(_text("ci-queue-watch.yml"))["jobs"]["watch"]["steps"][-1]["run"]
    assert "--labels uct-vps-gate,uct-vps " in run


# ---- AUDIT B4: a branch dispatch is refused in the queue and in every job

def test_a_branch_dispatch_cannot_join_the_master_queue():
    conc = _gate()["concurrency"]
    assert conc["cancel-in-progress"] is False
    assert conc["group"] == ("${{ github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/master' "
                             "&& format('refused-dispatch-{0}', github.run_id) || 'master-deploy' }}")


def test_every_gate_job_refuses_a_branch_dispatch():
    for job_id, job in _gate()["jobs"].items():
        step = next((s for s in job["steps"] if s.get("name") == "Refuse a dispatch that is not on master"), None)
        assert step is not None, job_id
        assert step["if"] == "github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/master'"
        assert step["run"].rstrip().endswith("exit 1"), job_id


def test_the_refusal_comes_first_in_every_job_that_runs_code():
    for job_id, job in _gate()["jobs"].items():
        if job_id != "verdict":
            assert job["steps"][0].get("name") == "Refuse a dispatch that is not on master", job_id


def test_a_branch_dispatch_never_reaches_the_reserved_slots():
    assert "github.ref != 'refs/heads/master' || inputs.lane == 'hosted-fallback'" in GATE_LANE


# ---- the named set runs once, by hand, at the exact SHA

@pytest.mark.parametrize("name", ["agent-ci.yml", *VPS_RAILS, "vite-build-args.yml", "notebook-latency.yml", "clock-parity-fixture.yml"])
def test_the_named_set_never_runs_on_a_pr_push(name):
    on = _on(yaml.safe_load(_text(name)))
    assert "pull_request" not in on and "workflow_dispatch" in on, sorted(on)


def test_no_workflow_triggers_on_a_label():
    """A `labeled` trigger skips the check for every other label, and AUDIT's queue accepts SKIPPED, so a PR could
    clear the named set with nothing having run. Dispatch has no such state."""
    for name, doc, _ in _workflows():
        pr = _on(doc).get("pull_request") if isinstance(_on(doc), dict) else None
        assert "labeled" not in str((pr or {}).get("types")), name


def test_the_shadow_cannot_touch_promotion():
    doc = yaml.safe_load(_text("ci-vps-shadow.yml"))
    assert pg.classify(_text("ci-vps-shadow.yml")) == "no"
    assert {j["uses"].rsplit("/", 1)[1] for j in doc["jobs"].values()} == {*VPS_RAILS, *MASTER_SIDE}
    assert all(j["with"]["lane"] == "vps" for j in doc["jobs"].values())


def test_each_shadow_call_has_its_own_concurrency_group():
    """github.workflow is the caller's in a called workflow, so without the tag all five would share one group."""
    tags = [j["with"]["tag"] for j in yaml.safe_load(_text("ci-vps-shadow.yml"))["jobs"].values()]
    assert len(set(tags)) == len(tags)
    for name in {**VPS_RAILS, **MASTER_SIDE}:
        assert "${{ inputs.tag }}" in yaml.safe_load(_text(name))["concurrency"]["group"], name


# ---- the gate

def test_every_heavy_gate_job_has_a_timeout_and_cannot_be_skipped():
    jobs = _gate()["jobs"]
    for job_id in GATE_HEAVY:
        job = jobs[job_id]
        assert isinstance(job.get("timeout-minutes"), int), job_id
        assert "if" not in job and "continue-on-error" not in job, job_id


def test_existing_timeouts_were_not_quietly_raised():
    """Weaker hardware may run these near their limits; that is a finding to raise, never a number to change here."""
    jobs = _gate()["jobs"]
    assert (jobs["agent-browser"]["timeout-minutes"], jobs["agent-browser-union"]["timeout-minutes"],
            jobs["pine-runtime"]["timeout-minutes"], jobs["agent-server"]["timeout-minutes"]) == (30, 15, 30, 20)


def test_no_gate_job_is_longer_than_the_watch_limit():
    """A running job resets the watch's clock, so a healthy lane stays clear only if every job ends within 45 minutes."""
    jobs = _gate()["jobs"]
    assert max(jobs[j]["timeout-minutes"] for j in GATE_HEAVY) < 45


def test_the_server_step_left_gate_and_deploy_correctness_did_not():
    gate = [s.get("name") for s in _gate()["jobs"]["gate"]["steps"]]
    assert "UCT Agent server tests (production dependency set)" not in gate
    for kept in ("Production is where the last promotion left it", "Secret scan (files this push changed)",
                 "The production dependency set imports and boots the server", "CI cost rails"):
        assert kept in gate, kept


def test_the_server_job_uses_no_secret_and_proves_its_commit():
    job = _gate()["jobs"]["agent-server"]
    assert "secrets." not in yaml.safe_dump(job)
    step = next(s for s in job["steps"] if s.get("name") == "UCT Agent server tests (production dependency set)")
    first = step["run"].splitlines()[0]
    assert first == 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', first


def test_the_server_job_has_full_history():
    """At depth 2 two F-16 rails skip on a missing commit and the job still reads green, so a shallower checkout is
    a silent loss of coverage. Measured 2026-11-06: 3652 passed, 2 skipped, against hosted's 3654 passed."""
    checkout = next(s for s in _gate()["jobs"]["agent-server"]["steps"] if "uses" in s)
    assert checkout["uses"].startswith("actions/checkout@") and checkout["with"]["fetch-depth"] == 0


def test_every_gate_job_is_in_the_verdict_by_exact_success():
    verdict = _gate()["jobs"]["verdict"]
    others = set(_gate()["jobs"]) - {"verdict"}
    assert set(verdict["needs"]) == others
    assert verdict["if"] == "always()"
    for need in verdict["needs"]:
        assert f'[ "${{{{ needs.{need}.result }}}}" = success ]' in _verdict_step()["run"], need


def test_job_names_are_as_reviewed():
    """Check names are what AUDIT and promotion read. Ruling 1 made both changes."""
    assert {k: v.get("name") for k, v in _gate()["jobs"].items()} == {
        "gate": "deploy-correctness checks",
        "agent-server": "UCT Agent server tests (production dependency set)",
        "agent-browser": "UCT Agent browser tests (shard ${{ matrix.shard }}/4)",
        "agent-browser-union": "Agent shards cover every Agent test file (equivalence rail)",
        "pine-runtime": "Pine runtime service rails (section 8)",
        "verdict": "master deploy gate verdict",
    }


def test_no_token_can_read_runners_and_the_gate_needs_no_watchdog():
    """AUDIT Q2: reading runners needs admin, and a repo secret is readable from any branch's workflow."""
    text = _text("master-deploy-gate.yml")
    assert "CI_RUNNER_READ_TOKEN" not in text and "runner-watchdog" not in text
    assert "secrets." not in text


def test_the_queue_watch_is_scoped_to_the_gate():
    doc = yaml.safe_load(_text("ci-queue-watch.yml"))
    assert pg.classify(_text("ci-queue-watch.yml")) == "no"
    assert doc["permissions"] == {"contents": "read", "actions": "write"}
    assert {j["runs-on"] for j in doc["jobs"].values()} == {HOSTED}
    run = doc["jobs"]["watch"]["steps"][-1]["run"]
    assert '--cancel-workflow "master deploy gate"' in run
    assert "promote" not in run


# ---- AUDIT proof 6: the verdict step itself, executed

def _verdict(results: dict) -> int:
    bash = shutil.which("bash")
    if not bash or sys.platform == "win32":
        pytest.skip("needs a POSIX shell; runs in the gate and in the image")
    verdict = _gate()["jobs"]["verdict"]
    script = _verdict_step()["run"]
    for need in verdict["needs"]:
        script = script.replace(f"${{{{ needs.{need}.result }}}}", results.get(need, ""))
    assert "${{" not in script
    return subprocess.run([bash, "-c", script], capture_output=True, text=True).returncode


def _all_green():
    return {need: "success" for need in _gate()["jobs"]["verdict"]["needs"]}


def test_the_verdict_passes_only_when_all_are_green():
    assert _verdict(_all_green()) == 0


@pytest.mark.parametrize("result", ["failure", "cancelled", "skipped"])
@pytest.mark.parametrize("job_id", ["gate", *GATE_HEAVY])
def test_any_other_result_turns_the_verdict_red(job_id, result):
    """A deliberately failing server test is `agent-server` = failure."""
    assert _verdict({**_all_green(), job_id: result}) == 1


@pytest.mark.parametrize("job_id", ["gate", *GATE_HEAVY])
def test_a_missing_job_turns_the_verdict_red(job_id):
    results = _all_green()
    del results[job_id]
    assert _verdict(results) == 1


# ---- what promotion does with each ending, through the real decision code

def _decide(*runs):
    return pg.decide(gating=[pg.ALWAYS_RUNS], runs=list(runs), workflows=[{"name": pg.ALWAYS_RUNS, "state": "active"}])[0]


def _run(status, conclusion):
    return {"name": pg.ALWAYS_RUNS, "status": status, "conclusion": conclusion}


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out", "skipped", "startup_failure", "stale", None])
def test_no_conclusion_but_success_promotes(conclusion):
    assert _decide(_run("completed", conclusion)) == pg.REFUSE


@pytest.mark.parametrize("status", ["queued", "in_progress", "waiting", "pending"])
def test_a_queued_gate_waits_and_never_promotes(status):
    assert _decide(_run(status, None)) == pg.WAIT


def test_a_green_fallback_run_does_not_launder_a_cancelled_run_on_the_same_commit():
    """A fact AUDIT has to rule on (AUDIT-NOTES.md, 'Fallback'): promotion reads every run for a SHA, so a manual
    fallback that passes on a commit whose push run was cancelled still REFUSES. Safe, but it cannot rescue that commit."""
    assert _decide(_run("completed", "cancelled"), _run("completed", "success")) == pg.REFUSE
