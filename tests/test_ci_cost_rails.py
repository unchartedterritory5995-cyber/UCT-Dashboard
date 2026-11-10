"""CI cost rails: the trigger shapes that keep the GitHub Actions bill from creeping back.

Measured 2026-11-06 (owner): the repo went private, so every Actions minute is billed, and the account hit its
$300 Actions budget on 11-06, five days into the month. 6,819 runs on 11-01..11-06. The sampled split:

    agent ci            ~70%  789 runs x ~76 min (552 of them PUSHES to agent/** with no path filter)
    master deploy gate  ~10%  176 runs x ~48 min (deliberate: the full Agent suite on every master push)
    12 small rails      ~20%  ~700-970 runs each; every superseded PR push ran to completion

Each rail below names one of those leaks. A failure here is not "the CI is wrong"; it is "this change makes CI
cost more, so make it a deliberate, reviewed change": update the pinned set with a reason, in the same commit.

Standard library + PyYAML (in requirements.txt). YAML 1.1 parses the `on:` key as the boolean True.
"""
from __future__ import annotations

import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
MASTER = {"master", "main"}

#: Pushes to non-master branches with NO path filter. Each is cheap or single-branch; a new one is a deliberate change.
UNFILTERED_BRANCH_PUSH_OK = {
    "agent-ci-benchmark.yml": "one dedicated branch (ci/agent-shard-benchmark), pushed by hand",
    "wisdom-rails.yml": "stdlib-only rails, ~5 min, the wisdom program's own branches",
}
#: PR-triggered workflows with NO path filter: repo-wide rails whose subject is the whole tree.
UNFILTERED_PR_OK = {
    "term018-guards.yml": "every guard in api/ is its subject; ~3 min",
    "wisdom-rails.yml": "the ban rails scan the whole tree; ~5 min",
    "secret-scan.yml": "a key can land in ANY file of a public repo; scans only the PR's own commits, ~1 min",
    # REQUIRED CHECKS (2026-11-10, AUDIT-approved design; docs/agent/program/PR-required-checks.md). A required check
    # from a workflow skipped by `pull_request.paths` waits "Expected" forever, so these five run on every PR. Their
    # real jobs are gated by an in-run `changes` job matching the PR diff against `on.push.paths` (kept, so push cost
    # is unchanged): ~30 s of `changes` + `required` when a PR is irrelevant. REQUIRED_AGGREGATORS pins the shape.
    "vite-build-args.yml": "required-check aggregator; real jobs gated by `changes` on push.paths; ~30 s when irrelevant",
    "notebook-bytes.yml": "required-check aggregator; real jobs gated by `changes` on push.paths; ~30 s when irrelevant",
    "notebook-a11y.yml": "required-check aggregator; real jobs gated by `changes` on push.paths; ~30 s when irrelevant",
    "notebook-latency.yml": "required-check aggregator; real jobs gated by `changes` on push.paths; ~30 s when irrelevant",
    "agent-ci.yml": "required-check aggregator; the ~55 job-min suite gated by `changes` on push.paths; ~30 s when irrelevant",
}

#: REQUIRED CHECKS (2026-11-10). The 8 contexts the `master requires CI` branch ruleset requires: file -> (job id,
#: the check-run name GitHub reports). Renaming any of these blocks every PR until the ruleset is edited to match.
REQUIRED_CONTEXTS = {
    "term018-guards.yml": ("static", "term018 guards (required)"),
    "wisdom-rails.yml": ("rails", "wisdom rails (required)"),
    "secret-scan.yml": ("gitleaks", "secret scan (required)"),
    "vite-build-args.yml": ("required", "vite build args (required)"),
    "notebook-bytes.yml": ("required", "notebook bytes (required)"),
    "notebook-a11y.yml": ("required", "notebook a11y (required)"),
    "notebook-latency.yml": ("required", "notebook latency (required)"),
    "agent-ci.yml": ("required", "agent ci (required)"),
}
#: The path-filtered ones: each has a `changes` job and a `required` aggregator around its real jobs.
REQUIRED_AGGREGATORS = {f for f, (job, _) in REQUIRED_CONTEXTS.items() if job == "required"}
#: A real job that does not gate on `needs.changes.outputs.relevant` itself, and the exact `if:` it carries instead.
#: capability-regression keeps its literal `needs: capability-regression-clock` (tests/test_uct_agent_capreg_baseline.py
#: pins that string) and is skipped exactly when the clock legs are.
GATED_INDIRECTLY = {
    ("agent-ci.yml", "capability-regression"): "always() && needs.capability-regression-clock.result != 'skipped'",
}
RELEVANT_IF = "needs.changes.outputs.relevant == 'true'"


def _load(path: pathlib.Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    on = doc.get("on", doc.get(True)) or {}
    if isinstance(on, str):
        return {on: {}}
    if isinstance(on, list):
        return {k: {} for k in on}
    return {k: (v or {}) for k, v in on.items()}


def _workflows():
    files = sorted(WORKFLOWS.glob("*.y*ml"))
    assert len(files) >= 10, f"only {len(files)} workflow files found under {WORKFLOWS}: wrong directory?"
    return [(f.name, _load(f)) for f in files]


def _filtered(trigger: dict) -> bool:
    return bool(trigger.get("paths") or trigger.get("paths-ignore"))


def test_agent_ci_push_and_pr_run_on_the_same_paths():
    """The 70% leak. One list decides both: push.paths filters pushes and (since 2026-11-10) the `changes` job matches
    every PR diff against that same push.paths, so no Agent run is unfiltered.
    REQUIRED CHECKS re-expression: this used to assert push.paths == pull_request.paths. The PR trigger now has no
    list by design (a required check from a path-skipped workflow never reports), so the same intent is asserted on
    the `changes` job instead."""
    doc = _load(WORKFLOWS / "agent-ci.yml")
    on = _on(doc)
    assert on["push"].get("paths"), "agent-ci.yml's push trigger lost its paths list"
    assert not _filtered(on["pull_request"]), "agent-ci.yml's PR trigger is path-filtered again: its required check would never report"
    env = _changes_env(doc)
    assert env["WORKFLOW_FILE"] == ".github/workflows/agent-ci.yml", env
    # the event clause the five jobs carried (push || fork PR), plus same-repo PRs into master (the one `if:` change)
    assert env["SAME_REPO_PR_BASES"] == "master", env


def test_no_branch_push_trigger_runs_without_a_path_filter():
    """A push trigger on branches other than master fires on every commit an agent session pushes."""
    bad = []
    for name, doc in _workflows():
        push = _on(doc).get("push")
        if push is None:
            continue
        branches = set(push.get("branches") or ["**"])
        if branches <= MASTER or _filtered(push) or name in UNFILTERED_BRANCH_PUSH_OK:
            continue
        bad.append(f"{name}: push.branches={sorted(branches)}")
    assert not bad, "branch push triggers with no path filter (add `paths:` or pin with a reason):\n" + "\n".join(bad)


def test_unfiltered_pr_workflows_are_exactly_the_pinned_set():
    unfiltered = {name for name, doc in _workflows() if "pull_request" in _on(doc) and not _filtered(_on(doc)["pull_request"])}
    assert unfiltered == set(UNFILTERED_PR_OK), (
        f"PR workflows with no path filter: {sorted(unfiltered)}; pinned: {sorted(UNFILTERED_PR_OK)}. "
        "Add `paths:` or pin it in UNFILTERED_PR_OK with a reason.")


def test_every_pr_workflow_cancels_its_superseded_pr_runs():
    """An agent session that pushes three times to a PR must not pay for the first two runs to finish."""
    bad = []
    for name, doc in _workflows():
        if "pull_request" not in _on(doc):
            continue
        conc = doc.get("concurrency")
        cancel = conc.get("cancel-in-progress") if isinstance(conc, dict) else None
        if not (cancel is True or (isinstance(cancel, str) and "pull_request" in cancel)):
            bad.append(f"{name}: concurrency={conc!r}")
    assert not bad, "PR-triggered workflows that let superseded runs finish:\n" + "\n".join(bad)


def test_no_workflow_cancels_a_master_push_run():
    """The other direction, and the one that matters for deploys: promotion reads EVERY master run for a SHA, and
    the master deploy gate's `cancel-in-progress: false` is its whole mechanism. A literal `true` on a workflow
    that runs on master pushes would cancel a gating run."""
    bad = []
    for name, doc in _workflows():
        push = _on(doc).get("push")
        if push is None:
            continue
        branches = set(push.get("branches") or ["**"])
        if not (branches & MASTER or "**" in branches):
            continue
        conc = doc.get("concurrency")
        if isinstance(conc, dict) and conc.get("cancel-in-progress") is True:
            bad.append(name)
    assert not bad, f"workflows that would cancel a master push run: {bad}"


def test_the_capreg_post_leg_does_not_rerun_what_the_shards_run():
    """The vitest capreg suite at the post clock already runs inside agent-ci's browser shards; only the rth leg
    runs it again (that clock is covered nowhere else). Re-adding it to the post leg is ~15 min per run."""
    job = _load(WORKFLOWS / "agent-ci.yml")["jobs"]["capability-regression-clock"]
    vitest = [s for s in job["steps"] if "vitest run src/agent/qa/capabilityRegression" in (s.get("run") or "")]
    assert len(vitest) == 1, vitest
    assert vitest[0].get("if") == "matrix.clock == 'rth'", vitest[0]
    shards = " ".join(s.get("run") or "" for s in _load(WORKFLOWS / "agent-ci.yml")["jobs"]["browser"]["steps"])
    assert "$AGENT_VITEST_PATHS" in shards, "the shards no longer run the Agent paths, so the post leg is the only post-clock run"


# ── REQUIRED CHECKS (2026-11-10): the aggregators cannot be weakened silently ──────────────────────────────────────

def _changes_env(doc: dict) -> dict:
    steps = [s for s in doc["jobs"]["changes"]["steps"] if s.get("id") == "match"]
    assert len(steps) == 1, steps
    return steps[0]["env"]


def _needs(job: dict) -> list:
    n = job.get("needs") or []
    return [n] if isinstance(n, str) else list(n)


def _aggregator_problems(name: str, doc: dict) -> list[str]:
    """Everything wrong with one aggregated workflow; [] = sound. Pure, so the mutants below can feed it."""
    bad = []
    jobs = doc.get("jobs") or {}
    on = _on(doc)
    if not (on.get("push") or {}).get("paths"):
        bad.append("on.push.paths is empty: `changes` has nothing to match (it fails safe, so every PR runs everything)")
    if "pull_request" not in on or _filtered(on["pull_request"]):
        bad.append("the PR trigger is missing or path-filtered: the required check would wait 'Expected' forever")
    elif "master" not in (on["pull_request"].get("branches") or ["master"]):
        bad.append("the PR trigger does not cover PRs into master")
    req, ch = jobs.get("required"), jobs.get("changes")
    if not isinstance(req, dict) or not isinstance(ch, dict):
        return bad + ["no `required` or no `changes` job"]
    if req.get("if") != "always()":
        bad.append(f"required.if is {req.get('if')!r}, not 'always()': a skipped aggregator reports SUCCESS")
    others = set(jobs) - {"required"}
    needs = _needs(req)
    if set(needs) != others or len(needs) != len(set(needs)):
        bad.append(f"required.needs {sorted(needs)} != every other job {sorted(others)}")
    run = " ".join(str(s.get("run") or "") for s in req.get("steps") or [])
    expect = run.split("verdict --expect", 1)[1].split()[0].split(",") if "verdict --expect" in run else None
    if expect is None or set(expect) != set(needs) or "changes" not in expect:
        bad.append(f"the verdict's --expect {expect} differs from required.needs {sorted(needs)}")
    if "toJSON(needs)" not in str([s.get("env") for s in req.get("steps") or []]):
        bad.append("the verdict does not read toJSON(needs)")
    if ch.get("if") or ch.get("needs"):
        bad.append("the `changes` job is conditional or waits on something")
    try:
        env = _changes_env(doc)
        if env.get("WORKFLOW_FILE") != f".github/workflows/{name}":
            bad.append(f"changes matches {env.get('WORKFLOW_FILE')!r}, not its own file")
        if env.get("EVENT") != "${{ github.event_name }}":
            bad.append("changes does not pass the real event (a push must always be relevant)")
    except (AssertionError, KeyError, TypeError) as exc:
        bad.append(f"no `match` step in changes: {exc!r}")
    for j, job in jobs.items():
        if j in ("required", "changes"):
            continue
        want = GATED_INDIRECTLY.get((name, j))
        if want is not None:
            if job.get("if") != want:
                bad.append(f"{j}.if is {job.get('if')!r}, pinned {want!r}")
        elif "changes" not in _needs(job) or job.get("if") != RELEVANT_IF:
            bad.append(f"{j} does not gate on `changes` (needs={_needs(job)}, if={job.get('if')!r})")
    return bad


def test_required_aggregators_cannot_be_weakened():
    """REQUIRED CHECKS (new rail, AUDIT C3): each aggregated workflow has an always-reporting `required` job whose needs
    is EVERY other job, a `changes` job on the workflow's own push.paths, and every real job gated on it."""
    bad = {f: p for f in sorted(REQUIRED_AGGREGATORS) if (p := _aggregator_problems(f, _load(WORKFLOWS / f)))}
    assert not bad, bad


def test_the_aggregator_rail_can_fail():
    """CONTROL (new, AUDIT C3 mutants): drop any one job from `needs`, drop or change `if: always()`, put paths back
    on the PR trigger, ungate a real job, desync --expect. Each must turn the rail red."""
    import copy
    base = _load(WORKFLOWS / "agent-ci.yml")
    assert _aggregator_problems("agent-ci.yml", base) == []

    def mutant(fn):
        m = copy.deepcopy(base)
        fn(m)
        return _aggregator_problems("agent-ci.yml", m)

    for victim in [j for j in base["jobs"] if j != "required"]:
        assert mutant(lambda m: m["jobs"]["required"].__setitem__(
            "needs", [j for j in _needs(m["jobs"]["required"]) if j != victim])), f"dropping {victim} went unnoticed"
    assert mutant(lambda m: m["jobs"]["required"].__setitem__("if", "success()"))
    assert mutant(lambda m: m["jobs"]["required"].pop("if"))
    assert mutant(lambda m: m[True]["pull_request"].__setitem__("paths", ["app/src/agent/**"]))
    assert mutant(lambda m: m[True]["pull_request"].__setitem__("branches", ["agent/int"]))
    assert mutant(lambda m: m["jobs"]["server"].__setitem__("if", "always()"))
    assert mutant(lambda m: m["jobs"]["union"].__setitem__("needs", ["browser"]))
    assert mutant(lambda m: m["jobs"]["capability-regression"].__setitem__("if", "always()"))
    assert mutant(lambda m: m["jobs"]["required"]["steps"][-1].__setitem__(
        "run", "python3 tools/ci_paths_match.py verdict --expect changes,server"))
    assert mutant(lambda m: m["jobs"]["changes"]["steps"][-1]["env"].__setitem__("EVENT", "pull_request"))
    assert mutant(lambda m: m[True]["push"].pop("paths"))


def test_the_eight_required_contexts_exist_and_are_unique():
    """REQUIRED CHECKS (new rail): the ruleset requires these names exactly. Each is on its pinned job, and no other
    job in ANY workflow reports the same name (`bookworm` is two workflows' job name: a required name is never shared)."""
    names: dict[str, list[str]] = {}
    for f, doc in _workflows():
        for j, job in (doc.get("jobs") or {}).items():
            names.setdefault(str((job or {}).get("name") or j), []).append(f"{f}:{j}")
    for f, (job, ctx) in REQUIRED_CONTEXTS.items():
        doc = _load(WORKFLOWS / f)
        assert doc["jobs"][job].get("name") == ctx, (f, job, doc["jobs"][job].get("name"))
        assert names[ctx] == [f"{f}:{job}"], (ctx, names[ctx])
    known = {c for _, c in REQUIRED_CONTEXTS.values()}
    stray = sorted(n for n in names if n.endswith("(required)") and n not in known)
    assert not stray, f"a `(required)` name the ruleset does not know: {stray}"


def test_the_changes_step_is_one_template():
    """REQUIRED CHECKS (new rail): the shell around the matcher is what turns a matcher crash into relevant=true. It is
    the same text in all five workflows (only env values differ), so the copy tests/test_ci_paths_match.py executes
    is the copy CI runs."""
    runs = {f: [s for s in _load(WORKFLOWS / f)["jobs"]["changes"]["steps"] if s.get("id") == "match"][0]["run"]
            for f in sorted(REQUIRED_AGGREGATORS)}
    assert len(set(runs.values())) == 1, runs
    only = next(iter(runs.values()))
    assert only.splitlines()[0] == "relevant=true" and "grep -qx 'relevant=false' decision.txt" in only, only
