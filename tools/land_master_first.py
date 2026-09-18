"""Land a branch on master MASTER-FIRST, and refuse if the parents come out wrong.

WHY DIRECTION MATTERS, measured rather than asserted. The master deploy gate scans
`git diff HEAD^ HEAD` — the FIRST parent. So:

    master-first (checkout master; merge branch)  -> ^1 = old master, ^2 = branch
                                                     the gate scans OUR files
    branch-first (checkout branch; merge master)  -> ^1 = branch
                                                     the gate scans MASTER's files

Measured on this repo with a controlled A/B: master-first put **2 files** in front of
the gate, branch-first put **62**. Every landing this programme made before SD-1.2 B1.1
was scanned on the wrong side.

⛔ `git checkout master` CANNOT BE USED HERE. `master` is checked out in another
workstream's worktree, and git refuses a second checkout of the same branch — the
literal form in B1.1 fails on every landing. Detaching at `origin/master` produces an
identical commit graph without touching that worktree.

⛔ THE CHECK IS NOT ADVISORY. A wrong-direction merge that reached master would be
invisible until somebody read the gate's file list, which nobody does on a green run.
It refuses the push instead.
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

MAIN_REPO_DEFAULT = r"C:\Users\Patrick\uct-dashboard"


def check_direction(p1: str, p2: str, before: str, tip: str) -> tuple[bool, str]:
    """Is this merge master-first? Pure, so it can be tested without a repository.

    `before` is master's tip BEFORE the merge; `tip` is the branch being landed.
    """
    if p1 == before and p2 == tip:
        return True, f"master-first: ^1={p1[:9]} (old master)  ^2={p2[:9]} (branch)"
    if p1 == tip and p2 == before:
        return False, (f"BRANCH-FIRST: ^1={p1[:9]} is the branch tip and ^2={p2[:9]} is "
                       f"master. The gate would scan master's side of the merge, not ours.")
    return False, (f"UNRECOGNISED PARENTS: ^1={p1[:9]} ^2={p2[:9]}; expected "
                   f"^1={before[:9]} ^2={tip[:9]}. Refusing rather than guessing.")


def merge_is_noop(head: str, before: str) -> bool:
    """True when the merge moved nothing — the branch was ALREADY on master.

    Pure, so it can be tested without a repository.

    ⛔ This is the case that used to fall through to UNRECOGNISED PARENTS.
    `git merge --no-ff` on an already-merged branch prints "Already up to date."
    and exits 0 WITHOUT moving HEAD, so HEAD^1/HEAD^2 are then MASTER'S OWN
    parents and check_direction reports a phantom problem against a healthy
    repository. Measured 2026-09-16: it cost a session hours of hunting for a
    worktree collision that did not exist. Worse, when master's tip is not
    itself a merge, HEAD^2 does not resolve and git() exits 2.
    """
    return head == before


def git(root, *a, check=True):
    r = subprocess.run(["git", "-C", str(root), *a],
                       capture_output=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        print(f"git {' '.join(a)} -> {r.returncode}\n{r.stdout}{r.stderr}", file=sys.stderr)
        sys.exit(2)
    return r.stdout.strip(), r.returncode


def land(branch: str, main: str, workdir: str, push: bool = True) -> int:
    wt = pathlib.Path(workdir)
    if wt.exists():
        git(main, "worktree", "remove", "--force", str(wt), check=False)
    git(main, "fetch", "-q", "origin", "master", branch)
    before, _ = git(main, "rev-parse", "origin/master")
    tip, _ = git(main, "rev-parse", branch)
    print(f"origin/master {before[:9]}   {branch} {tip[:9]}")

    # Already landed? Answer BEFORE building a worktree: the merge below would be a
    # no-op and its HEAD^1/HEAD^2 would describe master, not this landing.
    _, rc_anc = git(main, "merge-base", "--is-ancestor", tip, before, check=False)
    if rc_anc == 0:
        print(f"  ALREADY LANDED: {tip[:9]} is an ancestor of origin/master {before[:9]}.")
        print("Nothing to do — nothing pushed.")
        return 0

    git(main, "worktree", "add", "-q", "--detach", str(wt), before)
    try:
        out, rc = git(wt, "-c", "commit.gpgsign=false",
                      "merge", "--no-ff", "--no-edit", branch, check=False)
        if rc != 0:
            git(wt, "merge", "--abort", check=False)
            print(f"MERGE FAILED rc={rc}\n{out}")
            return 3

        head, _ = git(wt, "rev-parse", "HEAD")
        if merge_is_noop(head, before):
            print(f"  ALREADY LANDED: the merge moved nothing (HEAD still {head[:9]}).")
            print("Nothing to do — nothing pushed.")
            return 0

        p1, _ = git(wt, "rev-parse", "HEAD^1")
        p2, _ = git(wt, "rev-parse", "HEAD^2")
        ok, why = check_direction(p1, p2, before, tip)
        scanned, _ = git(wt, "diff", "--name-only", "HEAD^", "HEAD")
        files = [f for f in scanned.splitlines() if f]
        print(f"  {why}")
        print(f"  the gate would scan {len(files)} file(s): {files}")
        if not ok:
            print("REFUSING — nothing pushed.")
            return 4
        if not push:
            print("(--no-push) direction verified; nothing pushed.")
            return 0
        out, rc = git(wt, "push", "origin", "HEAD:master", check=False)
        print(out)
        if rc == 0:
            landed, _ = git(wt, "rev-parse", "HEAD")
            print(f"LANDED {landed[:9]}")
        return 0 if rc == 0 else 5
    finally:
        git(main, "worktree", "remove", "--force", str(wt), check=False)


def self_check() -> int:
    before, tip, other = "a" * 40, "b" * 40, "c" * 40
    cases = [
        ((before, tip), True, "master-first"),
        ((tip, before), False, "BRANCH-FIRST"),
        ((other, tip), False, "UNRECOGNISED"),
        ((before, other), False, "UNRECOGNISED"),
    ]
    ok = True
    for (p1, p2), want, marker in cases:
        got, why = check_direction(p1, p2, before, tip)
        if got is not want or marker.lower() not in why.lower():
            print(f"FAIL ^1={p1[:4]} ^2={p2[:4]}: got {got} {why!r}")
            ok = False
    # the already-merged case: the merge moves nothing and HEAD stays at master.
    for head, want in ((before, True), (tip, False), (other, False)):
        if merge_is_noop(head, before) is not want:
            print(f"FAIL merge_is_noop(head={head[:4]}, before={before[:4]})")
            ok = False

    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _make_stdio_utf8_safe() -> None:
    """⚰️ Measured 2026-09-18: a landing crashed AFTER a real `git push` had already run,
    inside `print(out)`, because the pre-push guard's own refusal text carries characters
    (this repo's own ⛔/⭐ house style) this Windows console's legacy cp1252 codepage
    cannot encode. The subprocess READ side was already safe (`git()` decodes with
    errors="replace"); the crash was on the WRITE side. Reconfigured once, here, rather than
    wrapping each print call, so a FUTURE print (e.g. inside `git()`'s own error branch,
    which is the FAILURE-diagnosis path and therefore the one most important to see) is
    covered too, not just the one that happened to crash first."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def main(argv=None) -> int:
    _make_stdio_utf8_safe()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("branch", nargs="?")
    ap.add_argument("--main", default=MAIN_REPO_DEFAULT)
    ap.add_argument("--workdir", default=r"C:\Users\Patrick\uct-worktrees\_land")
    ap.add_argument("--no-push", action="store_true",
                    help="merge and verify the direction, then throw it away")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    if not a.branch:
        ap.error("a branch is required unless --self-check")
    return land(a.branch, a.main, a.workdir, push=not a.no_push)


if __name__ == "__main__":
    sys.exit(main())
