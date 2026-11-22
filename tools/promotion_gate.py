"""Decide whether a master commit may be fast-forwarded onto `production`.

⭐ WHY THIS EXISTS RATHER THAN RAILWAY'S "Wait for CI". That toggle waits on ALL
checks for a commit — every advisory rail included — so switching it on converts
`flow-worker deploy coverage`, which exits 0 *specifically so it can never block a
deploy*, back into a deploy block for essentially every backend change. And it was
measured not to gate at all: eight consecutive `web` deploys on 2026-09-14 between
19:10Z and 21:30Z each started 99–141 s BEFORE their check suite finished, including
`7707b2241`, created after the toggle was already ON.

⛔ THE GATING SET IS DERIVED FROM THE WORKFLOW DIRECTORY, NEVER FROM THE GITHUB UI.
GitHub lists 9 workflows for this repo while `.github/workflows/` holds 7 — two are
ghosts with run history and no file. A file-less workflow cannot run on a new commit,
so the directory is the only honest source. Every file must carry a
`# promotion-gate: yes|no` marker in its first `_MARKER_SCAN_LINES` lines; an
UNCLASSIFIED workflow REFUSES the promotion rather than being silently ignored,
because "nobody decided" and "decided not to gate" are different facts.

⛔ A GATING WORKFLOW THAT IS DISABLED REFUSES THE PROMOTION. Path-filtered workflows
legitimately do not run on every commit, so "no run for this SHA" cannot be treated
as a failure — which leaves a hole: a workflow disabled in the UI also produces no
run, and would read as "not relevant here". Requiring `state == "active"` closes it
without re-implementing GitHub's path matching in this file.

    python tools/promotion_gate.py --runs runs.json --workflows wf.json --sha <sha>
    python tools/promotion_gate.py --self-check
"""
from __future__ import annotations

import argparse
import json
import os
import sys

WORKFLOW_DIR = ".github/workflows"

#: Only the head of a file is scanned, so a marker cannot hide in the middle of a
#: job where a reviewer would never see it.
_MARKER_SCAN_LINES = 40

_MARKER = "# promotion-gate:"

#: The one workflow that must have RUN for every master commit. It has no path
#: filter on master, so its absence is never "not relevant" — it is a signal that
#: something is wrong with the gate itself.
ALWAYS_RUNS = "master deploy gate"

#: A run counts for promotion only if it ran on this branch, from one of these events. See decide().
MASTER_BRANCH = "master"
COUNTED_EVENTS = frozenset({"push", "workflow_dispatch"})

PROMOTE, WAIT, REFUSE = "PROMOTE", "WAIT", "REFUSE"


def classify(text: str) -> str | None:
    """`"yes"`, `"no"`, or None when the file declares nothing."""
    for line in text.splitlines()[:_MARKER_SCAN_LINES]:
        s = line.strip()
        if s.startswith(_MARKER):
            v = s[len(_MARKER):].strip().lower()
            # `no — reason` / `yes  # because` both resolve on the first token.
            head = v.split()[0].strip(",;.") if v.split() else ""
            if head in ("yes", "no"):
                return head
            return None
    return None


def read_workflow_dir(root: str = ".") -> tuple[dict[str, str], list[str]]:
    """`({workflow name: "yes"|"no"}, [unclassified file names])`.

    The NAME is what GitHub reports on a run, so the mapping has to come from the
    file's own `name:` line — matching on filename would silently stop matching the
    moment somebody renames the workflow's display name.
    """
    d = os.path.join(root, WORKFLOW_DIR)
    out: dict[str, str] = {}
    unclassified: list[str] = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith((".yml", ".yaml")):
            continue
        with open(os.path.join(d, fn), "r", encoding="utf-8") as fh:
            text = fh.read()
        verdict = classify(text)
        if verdict is None:
            unclassified.append(fn)
            continue
        name = _name_of(text) or fn
        out[name] = verdict
    return out, unclassified


def _name_of(text: str) -> str | None:
    for line in text.splitlines():
        if line.startswith("name:"):
            return line[5:].strip().strip("'\"")
    return None


def _superseded(runs: list[dict]) -> list[dict]:
    """One gating workflow's runs, minus any `cancelled` run a LATER fully green run of that same workflow supersedes.

    A cancelled run proved nothing either way, so a later green run on the same commit answers what it left open. That is
    the manual fallback's only way to rescue a commit whose runs were cancelled during a runner outage. Every gating
    workflow gets the rule, because the queue watch can cancel any of them: one left out would refuse forever.

    ⛔ NEVER A FAILURE. A failure is evidence about this commit, so any other non-success conclusion stays and refuses.
    ⛔ ORDER IS NOT GUESSED. A run with no `created_at` supersedes nothing and is superseded by nothing, so an unreadable
    answer keeps the old refusal. Runs for one SHA come from the API, which carries this field.
    """
    green = [r["created_at"] for r in runs if r.get("status") == "completed" and r.get("conclusion") == "success"
             and r.get("created_at")]
    if not green:
        return runs
    newest_green = max(green)
    kept = []
    for r in runs:
        stamp = r.get("created_at")
        if r.get("status") == "completed" and r.get("conclusion") == "cancelled" and stamp and stamp < newest_green:
            continue
        kept.append(r)
    return kept


def decide(*, gating: list[str], runs: list[dict], workflows: list[dict]) -> tuple[str, str]:
    """`(PROMOTE|WAIT|REFUSE, one-line reason)` for ONE commit.

    `runs` are the workflow runs whose head_sha is the candidate — each
    `{"name", "status", "conclusion"}`. `workflows` is the repository's workflow
    list — each `{"name", "state"}`.

    ⛔ An empty `runs` list is a REFUSAL, never a promotion. An empty result is a
    failed invocation until proven otherwise, and the flattering reading of "no runs
    came back" is exactly the one that ships an ungated commit.
    """
    if not gating:
        return REFUSE, "no gating checks were resolved — the workflow directory produced an empty set"
    if not runs:
        return REFUSE, "no workflow runs were found for this commit — treating an empty result as a failed query"

    state = {w.get("name"): (w.get("state") or "") for w in workflows}
    disabled = [n for n in gating if state.get(n, "active") != "active"]
    if disabled:
        return REFUSE, "gating workflow(s) are not active: %s" % ", ".join(sorted(disabled))

    # ⛔ THE RUNS QUERY FILTERS BY COMMIT ONLY. A run dispatched on a branch sitting at master's tip has master's SHA, so
    # read as-is it would count: a refused branch dispatch would REFUSE master's commit, and a green one could pass it.
    # Only runs ON MASTER speak for master. A gating run with no branch cannot be placed, so it refuses rather than
    # being dropped: dropping it would turn an unreadable answer into "not relevant".
    # ⛔ THE BRANCH NAME ALONE IS NOT ENOUGH. A fork's branch can be named `master`, and its pull_request run then reports
    # head_branch == master at this SHA. The repo's own master runs come only from a push or a dispatch.
    named = [r for r in runs if r.get("name") in gating]
    unplaced = sorted({r.get("name") for r in named if not r.get("head_branch")
                       or (r.get("head_branch") == MASTER_BRANCH and not r.get("event"))})
    if unplaced:
        return REFUSE, "gating run(s) carry no head_branch or event, so they cannot be placed on master: %s" % ", ".join(unplaced)

    by_name: dict[str, list[dict]] = {}
    for r in named:
        if r.get("head_branch") == MASTER_BRANCH and r.get("event") in COUNTED_EVENTS:
            by_name.setdefault(r.get("name"), []).append(r)

    if ALWAYS_RUNS in gating and ALWAYS_RUNS not in by_name:
        return REFUSE, "%r did not run on master for this commit; it has no path filter on master, so its absence is a fault" % ALWAYS_RUNS

    pending, failed = [], []
    for name in gating:
        for r in _superseded(by_name.get(name, [])):
            if (r.get("status") or "") != "completed":
                pending.append(name)
            elif (r.get("conclusion") or "") != "success":
                failed.append("%s=%s" % (name, r.get("conclusion")))

    if failed:
        return REFUSE, "gating check(s) did not succeed: %s" % ", ".join(sorted(set(failed)))
    if pending:
        return WAIT, "waiting on gating check(s): %s" % ", ".join(sorted(set(pending)))
    ran = [n for n in gating if n in by_name]
    return PROMOTE, "every gating check that ran succeeded (%s)" % ", ".join(sorted(ran))


# ── self-check: the decision table, proved able to fail ───────────────────────

def _self_check() -> int:
    g = [ALWAYS_RUNS, "vite build args"]
    wf = [{"name": ALWAYS_RUNS, "state": "active"}, {"name": "vite build args", "state": "active"}]
    ok = lambda n: {"name": n, "status": "completed", "conclusion": "success"}
    cases = [
        ("all green, path-filtered one absent", g, [ok(ALWAYS_RUNS)], wf, PROMOTE),
        ("all green, both ran", g, [ok(ALWAYS_RUNS), ok("vite build args")], wf, PROMOTE),
        ("a gating check failed", g,
         [ok(ALWAYS_RUNS), {"name": "vite build args", "status": "completed", "conclusion": "failure"}],
         wf, REFUSE),
        ("a gating check still running", g,
         [ok(ALWAYS_RUNS), {"name": "vite build args", "status": "in_progress", "conclusion": None}],
         wf, WAIT),
        ("an advisory red does not block", g,
         [ok(ALWAYS_RUNS), {"name": "flow-worker deploy coverage", "status": "completed",
                            "conclusion": "failure"}], wf, PROMOTE),
        ("the always-runs check never ran", g, [ok("vite build args")], wf, REFUSE),
        ("a gating workflow is disabled", g, [ok(ALWAYS_RUNS)],
         [{"name": ALWAYS_RUNS, "state": "disabled_manually"},
          {"name": "vite build args", "state": "active"}], REFUSE),
        ("no runs at all", g, [], wf, REFUSE),
        ("no gating set resolved", [], [ok(ALWAYS_RUNS)], wf, REFUSE),
        ("a failed branch run at master's SHA does not count", g,
         [ok(ALWAYS_RUNS), {"name": ALWAYS_RUNS, "status": "completed", "conclusion": "failure", "head_branch": "x"}],
         wf, PROMOTE),
        ("a green branch run does not stand in for master", g,
         [{"name": ALWAYS_RUNS, "status": "completed", "conclusion": "success", "head_branch": "x"}], wf, REFUSE),
        ("a gating run with no branch refuses", g,
         [dict(ok(ALWAYS_RUNS), head_branch=None)], wf, REFUSE),
        ("a fork PR on a branch named master does not count", g,
         [dict(ok(ALWAYS_RUNS), event="pull_request")], wf, REFUSE),
        ("a master run with no event refuses", g,
         [dict(ok(ALWAYS_RUNS), event=None)], wf, REFUSE),
        ("a later green gate supersedes a cancelled one", g,
         [dict(ok(ALWAYS_RUNS), created_at="2026-01-01T02:00:00Z"),
          {"name": ALWAYS_RUNS, "status": "completed", "conclusion": "cancelled", "created_at": "2026-01-01T01:00:00Z"}],
         wf, PROMOTE),
        ("a later green gate never supersedes a failure", g,
         [dict(ok(ALWAYS_RUNS), created_at="2026-01-01T02:00:00Z"),
          {"name": ALWAYS_RUNS, "status": "completed", "conclusion": "failure", "created_at": "2026-01-01T01:00:00Z"}],
         wf, REFUSE),
    ]
    bad = 0
    for label, gate, runs, works, want in cases:
        placed = [{"head_branch": MASTER_BRANCH, "event": "push", **r} for r in runs]
        got, why = decide(gating=gate, runs=placed, workflows=works)
        flag = "ok " if got == want else "FAIL"
        if got != want:
            bad += 1
        print("  %s %-38s -> %-7s %s" % (flag, label, got, why))
    print("self-check: %d case(s), %d failure(s)" % (len(cases), bad))
    return 1 if bad else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runs", help="JSON file: workflow runs for the candidate sha")
    p.add_argument("--workflows", help="JSON file: the repository's workflow list")
    p.add_argument("--root", default=".", help="repo root (default: cwd)")
    p.add_argument("--self-check", action="store_true", help="prove the decision table can fail")
    a = p.parse_args(argv)

    if a.self_check:
        return _self_check()

    gating_map, unclassified = read_workflow_dir(a.root)
    if unclassified:
        print("::error::UNCLASSIFIED workflow(s): %s" % ", ".join(unclassified))
        print("Add `%s yes` or `%s no — <reason>` near the top of each file." % (_MARKER, _MARKER))
        print("PROMOTION: REFUSE")
        return 2

    gating = sorted(n for n, v in gating_map.items() if v == "yes")
    advisory = sorted(n for n, v in gating_map.items() if v == "no")
    print("gating (%d): %s" % (len(gating), ", ".join(gating)))
    print("advisory (%d): %s" % (len(advisory), ", ".join(advisory)))

    if not a.runs or not a.workflows:
        print("PROMOTION: REFUSE (no --runs/--workflows supplied)")
        return 2

    with open(a.runs, "r", encoding="utf-8") as fh:
        runs = json.load(fh)
    with open(a.workflows, "r", encoding="utf-8") as fh:
        works = json.load(fh)
    runs = runs.get("workflow_runs", runs) if isinstance(runs, dict) else runs
    works = works.get("workflows", works) if isinstance(works, dict) else works

    verdict, why = decide(gating=gating, runs=runs, workflows=works)
    print("PROMOTION: %s — %s" % (verdict, why))
    return {PROMOTE: 0, WAIT: 3, REFUSE: 2}[verdict]


if __name__ == "__main__":
    sys.exit(main())
