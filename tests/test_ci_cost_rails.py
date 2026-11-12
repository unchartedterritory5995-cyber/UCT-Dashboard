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
    # 2026-11-12: must post its status on EVERY PR into agent/int|master (a path filter = no status = a required check
    # that never arrives); the job is a few API calls on a two-file sparse checkout, no node, no tests, <1 min
    "agent-ci-required.yml": "the one required Agent status must exist on every PR; a few API calls, <1 min",
}


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
    """The 70% leak. The push trigger must carry the PR trigger's paths list, entry for entry."""
    on = _on(_load(WORKFLOWS / "agent-ci.yml"))
    push, pr = on["push"].get("paths"), on["pull_request"].get("paths")
    assert pr, "agent-ci.yml's pull_request trigger lost its paths list"
    assert push == pr, f"agent-ci.yml push.paths and pull_request.paths differ:\n push={push}\n pr={pr}"


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
