"""Re-arm the merge-tree evidence run for ONE named agent/** PR into master (P2, 2026-11-17).

A PR's pull_request run proves refs/pull/N/merge AS IT WAS when the run started. When master moves, that tree is no
longer what a merge would land, and nothing re-runs it (a base move fires no pull_request event). This tool starts
ONE fresh evidence run of the same jobs, for exactly the PR you name, on its CURRENT merge commit:

    python tools/agent_ci_rearm.py --pr <n> [--ref master] [--dry-run]

MECHANISM (documented GitHub behaviour, no commit is made and the PR is not touched):
  1. GET pulls/<n> until GitHub has (re)computed the test merge (`mergeable` is no longer null; a GET is what makes
     GitHub compute it) AND merge_commit_sha's parents are exactly [current base tip, current PR head]. A conflict
     (`mergeable: false`) or a merge ref that is still stale after --timeout seconds: refuse, dispatch nothing.
  2. `gh workflow run agent-ci.yml --ref <ref> -f pr=<n> -f merge_sha=<that merge commit>` ONCE. agent-ci.yml's
     workflow_dispatch trigger checks out that exact commit in every job (one commit for the whole run, even if master
     moves mid-run) and uploads the same evidence records a pull_request run does, named for PR <n>.
  The run uses agent-ci.yml AS IT IS ON --ref (default master, i.e. the reviewed copy; workflow_dispatch exists only
  once this change is on that ref). Its concurrency group is the PR's own (`agent-ci-pr-<n>`), so it supersedes an
  older evidence run of the same PR and never touches another PR's run.
  Verify afterwards with: python tools/agent_ci_evidence.py verify --pr <n> --tree <tree> --accept-dispatch

It never loops over PRs, never retries a dispatch, and refuses anything but one open same-repo agent/** PR into
master. Exit 0 = dispatched (or would be, with --dry-run); 2 = refused (nothing dispatched); 1 = the dispatch failed.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

REFUSED, FAILED = 2, 1


def check(pr: dict, repo: str, base_tip: str | None, merge_parents: list[str] | None) -> tuple[bool, str]:
    """Pure: may PR `pr` (the pulls/<n> JSON) be re-armed now? merge_parents = parents of its merge_commit_sha."""
    head, base = pr.get("head") or {}, pr.get("base") or {}
    if pr.get("state") != "open" or pr.get("merged"):
        return False, f"PR #{pr.get('number')} is not open"
    if base.get("ref") != "master":
        return False, f"PR #{pr.get('number')} targets {base.get('ref')!r}; evidence runs exist only for PRs into master"
    if (head.get("repo") or {}).get("full_name") != repo or not str(head.get("ref") or "").startswith("agent/"):
        return False, f"PR #{pr.get('number')} head is not a same-repo agent/** branch"
    if pr.get("mergeable") is False:
        return False, "the PR has a merge conflict: there is no merge commit to test"
    if pr.get("mergeable") is None or not pr.get("merge_commit_sha"):
        return False, "GitHub has not computed the test merge yet"
    if merge_parents != [base_tip, head.get("sha")]:
        return False, f"merge ref is stale: parents {merge_parents} != [base tip {base_tip}, head {head.get('sha')}]"
    return True, f"merge ref {pr['merge_commit_sha']} = {base.get('ref')}@{base_tip} + head {head.get('sha')}"


def dispatch_argv(repo: str, ref: str, number: int, merge_sha: str) -> list[str]:
    return ["gh", "workflow", "run", "agent-ci.yml", "-R", repo, "--ref", ref, "-f", f"pr={number}", "-f", f"merge_sha={merge_sha}"]


def _get(path: str):
    p = subprocess.run(["gh", "api", "-X", "GET", path], capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        raise RuntimeError(f"GET {path}: {p.stderr.strip()[:200]}")
    return json.loads(p.stdout or "null")


def main(argv=None, get=_get, run=subprocess.run, sleep=time.sleep, now=time.monotonic) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pr", type=int, action="append", required=True, help="the ONE PR to re-arm (given once)")
    ap.add_argument("--ref", default="master", help="the ref whose agent-ci.yml runs (default master)")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "unchartedterritory5995-cyber/UCT-Dashboard"))
    ap.add_argument("--timeout", type=int, default=120, help="seconds to wait for GitHub to refresh the merge ref")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if len(a.pr) != 1 or a.pr[0] <= 0:
        print(f"REFUSED: exactly one positive --pr is required, got {a.pr}")
        return REFUSED
    a.pr = a.pr[0]
    deadline, ok, why, pr = now() + max(a.timeout, 0), False, "", {}
    try:
        while True:   # READS only: wait for GitHub's test merge to catch up with the base tip and the head
            pr = get(f"repos/{a.repo}/pulls/{a.pr}") or {}
            ref = (pr.get("base") or {}).get("ref")
            tip = ((get(f"repos/{a.repo}/git/ref/heads/{ref}") or {}).get("object") or {}).get("sha") if ref else None
            parents = None
            if pr.get("merge_commit_sha") and pr.get("mergeable") is not None:
                parents = [p.get("sha") for p in (get(f"repos/{a.repo}/commits/{pr['merge_commit_sha']}") or {}).get("parents", [])]
            ok, why = check(pr, a.repo, tip, parents)
            retryable = not ok and ("not computed" in why or "stale" in why)
            if ok or not retryable or now() >= deadline:
                break
            sleep(5)
    except (RuntimeError, ValueError) as e:
        print(f"REFUSED: {e}")
        return REFUSED
    if not ok:
        print(f"REFUSED PR #{a.pr}: {why}")
        return REFUSED
    argv_ = dispatch_argv(a.repo, a.ref, a.pr, pr["merge_commit_sha"])
    print(f"OK PR #{a.pr}: {why}")
    print(("DRY-RUN would run: " if a.dry_run else "dispatch: ") + " ".join(argv_))
    if a.dry_run:
        return 0
    p = run(argv_, capture_output=True, text=True)   # exactly once; never retried
    if p.returncode != 0:
        print(f"FAILED: {(p.stderr or p.stdout or '').strip()[:300]}")
        return FAILED
    print(f"dispatched. verify: python tools/agent_ci_evidence.py verify --pr {a.pr} --tree <expected tree> --accept-dispatch")
    return 0


if __name__ == "__main__":
    sys.exit(main())
