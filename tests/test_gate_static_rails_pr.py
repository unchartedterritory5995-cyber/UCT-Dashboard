"""The pull-request copy of the master deploy gate's static checks stays a copy: gate-static-rails-pr.yml.

WHY (2026-11-20). Three times in one day a PR's own CI was green and the master deploy gate went red right after the
merge, on a cheap static check only the gate ran (tools/check_repo_hygiene.py on #2146's fixtures,
tests/test_no_shadowed_definitions.py on #2217's second `_INTRADAY_TFS`). A red gate holds every member-facing deploy.
`.github/workflows/gate-static-rails-pr.yml` runs those checks on the PR, before the merge.

A copy drifts like any other second list (lesson_a_gate_list_drifts_like_any_other_artifact): a gate step added next
month, or a command edited in one file and not the other, would quietly reopen the gap. So:
  * every gate-job step that runs a command is MIRRORED (a PR step with the same NAME running the same command, byte
    for byte) or is in GATE_ONLY with its reason;
  * every PR step that runs a command is a mirror or is in PR_ONLY with its reason; neither list may go stale;
  * the PR workflow never runs on a push (the gate owns master) and is classified `promotion-gate: no`. It also
    answers a merge queue's `merge_group` event, because its job is the required check on master.
The controls at the bottom plant each kind of drift and require the judge to name it.

Run ONLY this file:  python -m pytest tests/test_gate_static_rails_pr.py -q
Stdlib + PyYAML: it reads two workflow files and imports tools/promotion_gate.py (stdlib).
"""
from __future__ import annotations

import copy
import importlib.util
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
GATE, GATE_JOB = "master-deploy-gate.yml", "gate"
PR, PR_JOB = "gate-static-rails-pr.yml", "static"

#: gate steps the PR job leaves to the gate, by step name, each with its reason. A NEW gate step must land in the PR
#: job (same name, same command) or here.
GATE_ONLY = {
    "Production is where the last promotion left it":
        "reads the production branch and the last promotion record: master state, not a property of a PR",
    "Secret scan over the whole range (since production)":
        "its range is production..master; a PR's own change is the 'files this push changed' scan, which is mirrored",
    "Every VITE_* reaches the build and has a ledger row":
        "vite-build-args.yml runs the same two files on every PR that changes what they read",
    "Discord render replies match the golden":
        "a render test (matplotlib, FastAPI and two more packages), not a static check",
    "The production dependency set imports and boots the server":
        "builds the production venv from requirements.txt and boots the server: not a static check",
    "UCT Agent server tests (production dependency set)":
        "agent-ci.yml's server job runs them on every PR that touches the Agent",
}
#: PR steps the gate does not run, by step name, each with its reason.
PR_ONLY = {
    "Tools that import api.* pin the shared-data-root census":
        "tests/test_tools_pin_the_root.py went red on master 2026-11-20 (#2152, #2157) and only the nightly ran it",
    "The capture queue's reviewed dispositions":
        "tests/test_queue_dispositions.py went red on master 2026-11-20 and was found by a train's remote run",
    "Every corporate-action site is registered with a state":
        "tests/test_corp_actions_census.py was red on master 2026-09-29..2026-11-20 (13 unregistered sites) and "
        "only the report-only nightly ran it",
    "Every test file lands in a lane, a queued domain, or EXEMPT":
        "tests/test_domain_test_census.py, the lane census (2026-11-20: 2,741 of 3,450 test files ran in no lane); "
        "a PR adding a test file is the one that must say where it runs",
    "The Agent CI workflows, queue verdict and evidence tools keep their rails":
        "tests/test_ci_agent_merge_ref.py, tests/test_agent_ci_required.py and tests/test_agent_ci_evidence.py hold the "
        "Agent CI workflows, the merge-queue verdict and the evidence tools to their rules, and no pull-request job ran "
        "them (agent ci's server job runs tests/test_uct_agent*.py only): #2501's 176 new tests were checked by nothing",
    "Every CI mutant manifest still names text that exists":
        "tests/test_ci_mutant_manifests.py: a manifest in ci/mutants is run only on dispatch, so an edit to a target "
        "file left 45 of 849 mutants (2026-11-23) with a `from` that matched nothing, and no job said so",
    "This job mirrors the gate's static steps":
        "this file",
}


def _doc(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def _steps(name: str, job: str) -> list[dict]:
    return _doc(name)["jobs"][job]["steps"]


def commands(steps: list[dict]) -> dict[str, str]:
    """{step name: its `run` text} for every step that runs a command, except a failure note (`if: failure()`)."""
    out: dict[str, str] = {}
    for s in steps:
        if "run" not in s or str(s.get("if", "")).strip() == "failure()":
            continue
        name = s.get("name")
        assert name, f"a step with no name runs {str(s['run'])[:60]!r}: the mirror is matched by step name"
        assert name not in out, f"two steps are named {name!r}: the mirror is matched by step name"
        out[name] = s["run"]
    return out


def problems(gate_steps: list[dict], pr_steps: list[dict], gate_only: dict = GATE_ONLY,
             pr_only: dict = PR_ONLY) -> list[str]:
    """Every way the PR job and the gate job disagree, one line each; empty when the PR job is a faithful copy."""
    gate, pr = commands(gate_steps), commands(pr_steps)
    out = []
    for name, run in gate.items():
        if name in gate_only:
            if name in pr:
                out.append(f"{name!r} is GATE_ONLY and the PR job runs it as well: delete one")
        elif name not in pr:
            out.append(f"the gate step {name!r} is neither run by the PR job nor GATE_ONLY with a reason")
        elif pr[name] != run:
            out.append(f"the PR step {name!r} does not run the gate's command byte for byte")
    for name in pr:
        if name not in gate and name not in pr_only:
            out.append(f"the PR step {name!r} is neither a gate step nor PR_ONLY with a reason")
    out += [f"stale GATE_ONLY entry: the gate has no step {n!r}" for n in gate_only if n not in gate]
    out += [f"stale PR_ONLY entry: the PR job has no step {n!r}" for n in pr_only if n not in pr]
    out += [f"{n!r} is PR_ONLY but the gate runs it now: make it a mirror" for n in pr_only if n in gate]
    out += [f"{n!r} carries no reason" for n, why in {**gate_only, **pr_only}.items() if not str(why).strip()]
    return out


# ── the real files ────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_pr_job_runs_every_static_gate_step_as_the_gate_runs_it():
    bad = problems(_steps(GATE, GATE_JOB), _steps(PR, PR_JOB))
    assert not bad, "\n".join(bad)


def test_the_mirror_is_not_vacuous_and_holds_the_checks_that_went_red():
    gate, pr = commands(_steps(GATE, GATE_JOB)), commands(_steps(PR, PR_JOB))
    mirrored = {n for n in pr if n in gate}
    assert len(gate) >= 12 and len(mirrored) >= 7, (len(gate), sorted(mirrored))
    for name, needle in (("Line endings match the stored blobs", "tools/check_repo_hygiene.py"),
                         ("No module shadows its own definitions", "tests/test_no_shadowed_definitions.py"),
                         # 2026-11-22: was GATE_ONLY for its 68 s; #1658 merged with an undeclared flag and the gate went red
                         ("Visibility flags are declared (offline)", "tests/test_visibility_flag_ledger.py"),
                         ("Install the gate's dependencies", "pip install"),
                         ("Tools that import api.* pin the shared-data-root census", "tests/test_tools_pin_the_root.py"),
                         ("The capture queue's reviewed dispositions", "tests/test_queue_dispositions.py"),
                         ("The Agent CI workflows, queue verdict and evidence tools keep their rails", "tests/test_agent_ci_required.py"),
                         ("The Agent CI workflows, queue verdict and evidence tools keep their rails", "tests/test_ci_agent_merge_ref.py"),
                         ("The Agent CI workflows, queue verdict and evidence tools keep their rails", "tests/test_agent_ci_evidence.py"),
                         ("This job mirrors the gate's static steps", "tests/test_gate_static_rails_pr.py")):
        assert needle in pr.get(name, ""), f"the PR job no longer runs {needle} as {name!r}"


def test_the_pr_workflow_never_runs_on_a_push_and_never_gates_promotion():
    doc = _doc(PR)
    on = doc.get("on", doc.get(True))
    # merge_group (2026-11-22): the job is the required check on master, and a merge queue needs its verdict on
    # the merge group. Still never a push: the gate owns master.
    assert set(on) == {"pull_request", "merge_group"}, (
        f"{PR} runs for pull requests and merge groups, never on a push (the gate owns master): {sorted(on)}")
    assert on["pull_request"] == {"branches": ["master"]} and not on["merge_group"], on
    spec = importlib.util.spec_from_file_location("promotion_gate_for_the_pr_mirror", ROOT / "tools" / "promotion_gate.py")
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)
    assert pg.classify((WORKFLOWS / PR).read_text(encoding="utf-8")) == "no"
    assert set(doc["jobs"]) == {PR_JOB}, sorted(doc["jobs"])


# ── controls: each kind of drift is named ────────────────────────────────────────────────────────────────────────

def test_the_judge_names_each_kind_of_drift():
    gate, pr = _steps(GATE, GATE_JOB), _steps(PR, PR_JOB)
    assert problems(gate, pr) == []      # the controls below start from a clean pair

    new_gate = copy.deepcopy(gate) + [{"name": "A new gate check", "run": "python -m pytest tests/test_x.py -q"}]
    assert problems(new_gate, pr) == [
        "the gate step 'A new gate check' is neither run by the PR job nor GATE_ONLY with a reason"]

    edited = copy.deepcopy(pr)
    next(s for s in edited if s.get("name") == "No module shadows its own definitions")["run"] += " -x"
    assert problems(gate, edited) == [
        "the PR step 'No module shadows its own definitions' does not run the gate's command byte for byte"]

    dropped = [s for s in pr if s.get("name") != "Line endings match the stored blobs"]
    assert problems(gate, dropped) == [
        "the gate step 'Line endings match the stored blobs' is neither run by the PR job nor GATE_ONLY with a reason"]

    extra = copy.deepcopy(pr) + [{"name": "Something else", "run": "true"}]
    assert problems(gate, extra) == ["the PR step 'Something else' is neither a gate step nor PR_ONLY with a reason"]

    stale = {**GATE_ONLY, "A step the gate removed": "gone"}
    assert problems(gate, pr, gate_only=stale) == ["stale GATE_ONLY entry: the gate has no step 'A step the gate removed'"]

    both = {**GATE_ONLY, "Line endings match the stored blobs": "left to the gate"}
    assert problems(gate, pr, gate_only=both) == [
        "'Line endings match the stored blobs' is GATE_ONLY and the PR job runs it as well: delete one"]

    mute = {**PR_ONLY, "The capture queue's reviewed dispositions": " "}
    assert problems(gate, pr, pr_only=mute) == ["\"The capture queue's reviewed dispositions\" carries no reason"]


def test_a_failure_note_is_not_a_check_and_a_nameless_command_is_refused():
    assert commands([{"name": "Explain a failure", "if": "failure()", "run": "echo x"}]) == {}
    assert commands([{"uses": "actions/checkout@v4"}]) == {}
    try:
        commands([{"run": "python tools/check_repo_hygiene.py"}])
    except AssertionError as exc:
        assert "no name" in str(exc)
    else:
        raise AssertionError("a step with no name was accepted: the mirror could not match it")


# ── the gate's engine and bars rails, in the merge queue (2026-11-23) ───────────────────────────────────────────────
# gate-rails-queue.yml runs the gate's two test jobs on every merge group and reports ONE check, which the queue's
# ruleset can require; gate-rails-queue-pr.yml posts the same name on a pull request's head. If the queue's jobs
# drift from the gate's, "green in the queue" stops meaning "green in the gate", which is the whole point.
QUEUE, QUEUE_PR, QUEUE_CHECK = "gate-rails-queue.yml", "gate-rails-queue-pr.yml", "merge queue gate rails"
#: queue job -> the gate job it must equal in every key below
QUEUE_MIRRORS = {"engine": "whole-app-engine-rails", "bars": "bars-rails"}
QUEUE_SAME_KEYS = ("runs-on", "timeout-minutes", "env", "steps")


def _triggers(doc: dict):
    return doc.get("on", doc.get(True))


def queue_problems(gate_doc: dict, queue_doc: dict, pr_doc: dict) -> list[str]:
    out = []
    gate_jobs, jobs = gate_doc.get("jobs") or {}, queue_doc.get("jobs") or {}
    on = _triggers(queue_doc)
    if not (isinstance(on, dict) and set(on) == {"merge_group"} and not on["merge_group"]):
        out.append(f"{QUEUE} runs for merge groups only, unfiltered: {on!r}")
    if set(jobs) != {*QUEUE_MIRRORS, "verdict"}:
        out.append(f"{QUEUE} has the jobs {sorted(jobs)}, not {sorted({*QUEUE_MIRRORS, 'verdict'})}")
    for q, g in QUEUE_MIRRORS.items():
        if q not in jobs or g not in gate_jobs:
            out.append(f"the queue job {q!r} or the gate job {g!r} is gone")
            continue
        for key in QUEUE_SAME_KEYS:
            if jobs[q].get(key) != gate_jobs[g].get(key):
                out.append(f"the queue job {q!r} differs from the gate job {g!r} in {key!r}")
        extra = sorted(set(jobs[q]) - {"name", *QUEUE_SAME_KEYS})
        if extra:
            out.append(f"the queue job {q!r} carries {extra}: a condition or a dependency can skip it, and skipped passes")
        if jobs[q].get("name") == gate_jobs[g].get("name"):
            out.append(f"the queue job {q!r} has the gate job's name: two check runs of one name on the commit that lands")
    verdict = jobs.get("verdict") or {}
    if verdict.get("name") != QUEUE_CHECK:
        out.append(f"the verdict job is named {verdict.get('name')!r}, not {QUEUE_CHECK!r}")
    if sorted(verdict.get("needs") or []) != sorted(QUEUE_MIRRORS):
        out.append(f"the verdict needs {verdict.get('needs')!r}, not both rails")
    if str(verdict.get("if", "")).strip() != "always()":
        out.append("the verdict is not `if: always()`: a failed rail would SKIP it, and skipped passes")
    steps = verdict.get("steps") or []
    env = (steps[0].get("env") or {}) if len(steps) == 1 and isinstance(steps[0], dict) else {}
    run = str(steps[0].get("run", "")) if env else ""
    for q in QUEUE_MIRRORS:
        names = [k for k, v in env.items() if str(v).replace(" ", "") == "${{needs.%s.result}}" % q]
        tested = len(names) == 1 and any(line.strip() == f'test "${names[0]}" = "success"' for line in run.splitlines())
        if not tested:
            out.append(f"the verdict does not test that the job {q!r} succeeded")
    pr_on, pr_jobs = _triggers(pr_doc), pr_doc.get("jobs") or {}
    if pr_on != {"pull_request": {"branches": ["master"]}}:
        out.append(f"{QUEUE_PR} runs on every pull request into master, unfiltered, and on nothing else: {pr_on!r}")
    if len(pr_jobs) != 1 or [j.get("name") for j in pr_jobs.values()] != [QUEUE_CHECK]:
        out.append(f"{QUEUE_PR} has one job, named {QUEUE_CHECK!r}: {[j.get('name') for j in pr_jobs.values()]}")
    for j in pr_jobs.values():
        if "if" in j or "needs" in j:
            out.append(f"{QUEUE_PR}'s job carries a condition or a dependency: it could be skipped, or fail a pull request")
        if any("uses" in s for s in (j.get("steps") or [])):
            out.append(f"{QUEUE_PR}'s job uses an action: it posts a name and runs nothing")
    return out


def test_the_queue_runs_the_gates_engine_and_bars_jobs_exactly_and_one_verdict_names_them():
    bad = queue_problems(_doc(GATE), _doc(QUEUE), _doc(QUEUE_PR))
    assert not bad, "\n".join(bad)
    spec = importlib.util.spec_from_file_location("promotion_gate_for_the_queue_rails", ROOT / "tools" / "promotion_gate.py")
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)
    for name in (QUEUE, QUEUE_PR):
        assert pg.classify((WORKFLOWS / name).read_text(encoding="utf-8")) == "no", name
    # not vacuous: the two mirrored jobs really run the two lists
    q = _doc(QUEUE)["jobs"]
    assert "tools/ci_whole_app_rails.py --print-list" in str(q["engine"]["steps"])
    assert "tools/bars_gate_rails.py" in str(q["bars"]["steps"])


def test_the_queue_judge_names_each_kind_of_drift():
    gate, queue, pr = _doc(GATE), _doc(QUEUE), _doc(QUEUE_PR)
    assert queue_problems(gate, queue, pr) == []

    def drift(label, word, edit_gate=None, edit_queue=None, edit_pr=None):
        g, q, p = copy.deepcopy(gate), copy.deepcopy(queue), copy.deepcopy(pr)
        for fn, doc in ((edit_gate, g), (edit_queue, q), (edit_pr, p)):
            if fn:
                fn(doc)
        got = queue_problems(g, q, p)
        assert got and any(word in line for line in got), (label, got)

    drift("the gate gains a bars step the queue lacks", "differs from the gate job 'bars-rails' in 'steps'",
          edit_gate=lambda d: d["jobs"]["bars-rails"]["steps"].append({"name": "new", "run": "true"}))
    drift("the queue's engine command is edited", "differs from the gate job 'whole-app-engine-rails' in 'steps'",
          edit_queue=lambda d: d["jobs"]["engine"]["steps"][-1].update(run="true"))
    drift("the queue's bars timeout is raised", "in 'timeout-minutes'",
          edit_queue=lambda d: d["jobs"]["bars"].update({"timeout-minutes": 60}))
    drift("a rail gets a condition", "skipped passes", edit_queue=lambda d: d["jobs"]["bars"].update({"if": "false"}))
    drift("the verdict loses always()", "always()", edit_queue=lambda d: d["jobs"]["verdict"].pop("if"))
    drift("the verdict stops needing bars", "not both rails", edit_queue=lambda d: d["jobs"]["verdict"].update(needs=["engine"]))
    drift("the verdict stops testing bars", "does not test that the job 'bars' succeeded",
          edit_queue=lambda d: d["jobs"]["verdict"]["steps"][0].update(
              run=d["jobs"]["verdict"]["steps"][0]["run"].replace('test "$BARS" = "success"', "true")))
    drift("the verdict is renamed", "is named", edit_queue=lambda d: d["jobs"]["verdict"].update(name="other"))
    drift("the queue workflow gains a pull_request trigger", "merge groups only",
          edit_queue=lambda d: _triggers(d).update(pull_request={"branches": ["master"]}))
    drift("a queue job takes the gate job's name", "two check runs of one name",
          edit_queue=lambda d: d["jobs"]["bars"].update(name=gate["jobs"]["bars-rails"]["name"]))
    drift("the PR notice gets a path filter", "unfiltered",
          edit_pr=lambda d: _triggers(d)["pull_request"].update(paths=["api/**"]))
    drift("the PR notice is renamed", "has one job, named",
          edit_pr=lambda d: next(iter(d["jobs"].values())).update(name="other"))
    drift("the PR notice gets a condition", "could be skipped",
          edit_pr=lambda d: next(iter(d["jobs"].values())).update({"if": "false"}))
    drift("the PR notice starts checking out code", "runs nothing",
          edit_pr=lambda d: next(iter(d["jobs"].values()))["steps"].append({"uses": "actions/checkout@v4"}))
