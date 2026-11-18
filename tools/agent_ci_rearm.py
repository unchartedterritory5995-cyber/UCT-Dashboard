"""Re-arm the merge-tree evidence run for ONE named agent/** PR into master (P2b, 2026-11-17).

A PR's pull_request run proves refs/pull/N/merge AS IT WAS when the run started. When master moves, that tree is no
longer what a merge would land, and nothing re-runs it (a base move fires no pull_request event). P2 waited for GitHub
to refresh refs/pull/N/merge; GitHub does NOT refresh it while master moves fast (measured 2026-11-17: every one of ~40
open PRs had a stale merge ref), so P2 could produce no evidence at all. P2b builds the merge itself:

    python tools/agent_ci_rearm.py --pr <n> [--dry-run]

MECHANISM:
  1. READ pulls/<n> and master's tip (gh api GETs). Refuse anything but one open same-repo agent/** PR into master.
  2. `git fetch` exactly those two commits (master tip, PR head) by sha, then
       T = git merge-tree --write-tree <master tip> <PR head>      (exit 1 = conflict: refuse, nothing pushed)
       C = git commit-tree T -p <master tip> -p <PR head>          (fixed identity + date: same inputs, same C)
     and re-read C: its parents must be exactly [master tip, PR head] and its tree T, or refuse.
  3. Push C to the TOOL-OWNED ref `refs/agent-ci-evidence/pr-<n>` (force-update of that one ref only). The refspec is
     built here from the integer PR number, never from user input, and is re-checked against
     `+<40-hex>:refs/agent-ci-evidence/pr-<n>` before the push runs. The ref is NOT under refs/heads/ or refs/tags/,
     so no workflow's push / create / pull_request trigger can fire on it (rail: tests/test_agent_ci_evidence.py,
     derived from .github/workflows/*.yml), and it keeps C reachable so every job can fetch it by sha.
  4. `gh workflow run agent-ci.yml --ref master -f pr=<n> -f merge_sha=C` ONCE. Every job checks out exactly C.
  The run ALWAYS uses agent-ci.yml as it is on MASTER (the reviewed copy): there is no --ref option (AUDIT F2), and
  verify --accept-dispatch refuses a dispatch run whose workflow came from anywhere else. Its concurrency group is the
  PR's own (`agent-ci-pr-<n>`), so it supersedes an older evidence run of the same PR and never touches another PR's run.
  Verify afterwards with: python tools/agent_ci_evidence.py verify --pr <n> --tree <T> --accept-dispatch

REF NAMESPACE: refs/agent-ci-evidence/** is owned by this tool. One ref per PR; only this tool writes it; it never
writes any other ref (never master, production, agent/*, refs/pull/*, handoff/*). Deleting a stale one is harmless.

It never loops over PRs, never retries a push or a dispatch, and never touches the PR or its branch. Exit 0 =
dispatched (or would be, with --dry-run); 2 = refused (nothing pushed or dispatched); 1 = the push or dispatch failed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REFUSED, FAILED = 2, 1
WORKFLOW_REF = "master"   # F2: never configurable
EVIDENCE_NS = "refs/agent-ci-evidence/"
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
REFSPEC_RE = re.compile(r"\+([0-9a-f]{40}):refs/agent-ci-evidence/pr-([1-9][0-9]*)\Z")
#: commit-tree identity: fixed, so the same (master tip, PR head) always yields the same evidence commit
COMMIT_ENV = {"GIT_AUTHOR_NAME": "agent-ci-evidence", "GIT_AUTHOR_EMAIL": "agent-ci-evidence@invalid",
              "GIT_COMMITTER_NAME": "agent-ci-evidence", "GIT_COMMITTER_EMAIL": "agent-ci-evidence@invalid",
              "GIT_AUTHOR_DATE": "1700000000 +0000", "GIT_COMMITTER_DATE": "1700000000 +0000"}


class Refused(RuntimeError):
    pass


def check(pr: dict, repo: str, base_tip: str | None) -> tuple[bool, str]:
    """Pure: may PR `pr` (the pulls/<n> JSON) be re-armed now? GitHub's own test merge is NOT consulted (it goes stale)."""
    head, base = pr.get("head") or {}, pr.get("base") or {}
    if pr.get("state") != "open" or pr.get("merged"):
        return False, f"PR #{pr.get('number')} is not open"
    if base.get("ref") != "master":
        return False, f"PR #{pr.get('number')} targets {base.get('ref')!r}; evidence runs exist only for PRs into master"
    if (head.get("repo") or {}).get("full_name") != repo or not str(head.get("ref") or "").startswith("agent/"):
        return False, f"PR #{pr.get('number')} head is not a same-repo agent/** branch"
    if not SHA_RE.match(str(base_tip or "")) or not SHA_RE.match(str(head.get("sha") or "")):
        return False, f"master tip {base_tip!r} / PR head {head.get('sha')!r} is not a full commit sha"
    return True, f"master@{base_tip} + head {head.get('sha')}"


def evidence_ref(number: int) -> str:
    """The ONE ref this tool may write for PR <number>."""
    if type(number) is not int or number <= 0:
        raise Refused(f"not a PR number: {number!r}")
    return f"{EVIDENCE_NS}pr-{number}"


def push_argv(repo: str, number: int, commit: str) -> list[str]:
    return ["git", "push", "--quiet", f"https://github.com/{repo}.git", f"+{commit}:{evidence_ref(number)}"]


def assert_push_is_own_ref(argv: list[str], number: int, commit: str) -> None:
    """Hard refuse, whatever produced the argv: exactly one refspec, `+<commit>:refs/agent-ci-evidence/pr-<number>`,
    no option that widens the push (--all / --mirror / --tags / --delete / --prune / extra refspecs)."""
    if argv[:2] != ["git", "push"]:
        raise Refused(f"not a git push: {argv[:2]}")
    opts = [a for a in argv[2:] if a.startswith("-")]
    if opts != ["--quiet"]:
        raise Refused(f"push options {opts} are not allowed")
    pos = [a for a in argv[2:] if not a.startswith("-")]
    if len(pos) != 2:
        raise Refused(f"exactly one remote and one refspec allowed, got {pos}")
    m = REFSPEC_RE.match(pos[1])
    if not m or m.group(1) != commit or int(m.group(2)) != number or pos[1].split(":", 1)[1] != evidence_ref(number):
        raise Refused(f"refspec {pos[1]!r} is not +<evidence commit>:{evidence_ref(number)}")


def dispatch_argv(repo: str, number: int, merge_sha: str) -> list[str]:
    return ["gh", "workflow", "run", "agent-ci.yml", "-R", repo, "--ref", WORKFLOW_REF, "-f", f"pr={number}", "-f", f"merge_sha={merge_sha}"]


def _get(path: str):
    p = subprocess.run(["gh", "api", "-X", "GET", path], capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        raise RuntimeError(f"GET {path}: {p.stderr.strip()[:200]}")
    return json.loads(p.stdout or "null")


def build_merge(run, repo: str, number: int, tip: str, head: str) -> tuple[str, str]:
    """(tree T, evidence commit C) for tip + head, computed locally. Raises Refused on a conflict or any mismatch."""
    def git(*args, env=None):
        p = run(["git", *args], capture_output=True, text=True, env=env)
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    rc, _, err = git("fetch", "--no-tags", "--quiet", f"https://github.com/{repo}.git", tip, head)
    if rc != 0:
        raise Refused(f"cannot fetch master tip / PR head: {err[:200]}")
    for sha in (tip, head):
        rc, got, _ = git("rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}")
        if rc != 0 or got != sha:
            raise Refused(f"{sha} is not a local commit after the fetch")
    rc, out, err = git("merge-tree", "--write-tree", "--no-messages", tip, head)
    if rc == 1:
        raise Refused(f"merge conflict between master@{tip} and PR head {head}: there is no merge tree to test")
    tree = out.splitlines()[0].strip() if out else ""
    if rc != 0 or not SHA_RE.match(tree):
        raise Refused(f"git merge-tree failed (exit {rc}): {err[:200]}")
    rc, commit, err = git("commit-tree", tree, "-p", tip, "-p", head, "-m",
                          f"agent-ci evidence: PR #{number} = master@{tip} + {head}", env={**os.environ, **COMMIT_ENV})
    if rc != 0 or not SHA_RE.match(commit):
        raise Refused(f"git commit-tree failed (exit {rc}): {err[:200]}")
    rc, body, _ = git("cat-file", "-p", commit)
    hdr = body.split("\n\n", 1)[0].splitlines() if rc == 0 else []
    parents = [ln.split()[1] for ln in hdr if ln.startswith("parent ")]
    trees = [ln.split()[1] for ln in hdr if ln.startswith("tree ")]
    if parents != [tip, head] or trees != [tree]:
        raise Refused(f"evidence commit {commit} has parents {parents} / tree {trees}, not [{tip}, {head}] / {tree}")
    return tree, commit


def main(argv=None, get=_get, run=subprocess.run) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pr", type=int, action="append", required=True, help="the ONE PR to re-arm (given once)")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "unchartedterritory5995-cyber/UCT-Dashboard"))
    ap.add_argument("--dry-run", action="store_true", help="build the merge locally; push and dispatch nothing")
    a = ap.parse_args(argv)
    if len(a.pr) != 1 or a.pr[0] <= 0:
        print(f"REFUSED: exactly one positive --pr is required, got {a.pr}")
        return REFUSED
    n = a.pr[0]
    try:
        pr = get(f"repos/{a.repo}/pulls/{n}") or {}
        ref = (pr.get("base") or {}).get("ref")
        tip = ((get(f"repos/{a.repo}/git/ref/heads/{ref}") or {}).get("object") or {}).get("sha") if ref == "master" else None
        ok, why = check(pr, a.repo, tip)
        if not ok:
            raise Refused(f"PR #{n}: {why}")
        head = pr["head"]["sha"]
        tree, commit = build_merge(run, a.repo, n, tip, head)
        push_ = push_argv(a.repo, n, commit)
        assert_push_is_own_ref(push_, n, commit)
        disp = dispatch_argv(a.repo, n, commit)
        if disp[disp.index("--ref") + 1] != "master":   # F2: hard refuse, whatever produced the argv
            raise Refused("the re-arm workflow ref must be master")
    except (Refused, RuntimeError, ValueError, KeyError, TypeError) as e:
        print(f"REFUSED: {e}"[:400])
        return REFUSED
    print(f"OK PR #{n}: {why}\n  merge tree {tree}\n  evidence commit {commit} -> {evidence_ref(n)}")
    print(("DRY-RUN would run: " if a.dry_run else "push: ") + " ".join(push_))
    print(("DRY-RUN would run: " if a.dry_run else "dispatch: ") + " ".join(disp))
    if a.dry_run:
        return 0
    p = run(push_, capture_output=True, text=True)   # exactly once; never retried
    if p.returncode != 0:
        print(f"FAILED push (nothing dispatched): {(p.stderr or p.stdout or '').strip()[:300]}")
        return FAILED
    p = run(disp, capture_output=True, text=True)   # exactly once; never retried
    if p.returncode != 0:
        print(f"FAILED dispatch: {(p.stderr or p.stdout or '').strip()[:300]}")
        return FAILED
    print(f"dispatched. verify: python tools/agent_ci_evidence.py verify --pr {n} --tree {tree} --accept-dispatch")
    return 0


if __name__ == "__main__":
    sys.exit(main())
