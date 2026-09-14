"""Environment check 1 for the Terminal-Next weekly autonomous run.

⛔⛔ **"MATCHES ORIGIN" IS NOT "MATCHES `origin/<branch>`".**

`feat/s7-price-level` **publishes to master** — `git push origin feat/s7-price-level:master` —
so `origin/feat/s7-price-level` is a stale ref the branch outruns permanently. Measured
2026-09-13: `git status -sb` read **`ahead 99`** while **every commit on HEAD was already in
`origin/master`** (`git log origin/master..HEAD` was empty). A check written against
`origin/<branch>` therefore reports a clean, fully-published tree as UNPUBLISHED WORK, and §1 of
the weekly prompt treats a failed check as a FULL STOP. The run would refuse to start, every
week, on a tree that is perfectly fine.

⭐ The honest question is **containment in the tree's PUBLISH REF**:

    git merge-base --is-ancestor HEAD <publish-ref>

⛔ **THE PUBLISH REF IS DECLARED, NEVER GUESSED.** Deriving it ("use `origin/<branch>` if it
exists, else `origin/master`") would silently pick the stale ref for exactly the branch this bug
is about — `origin/feat/s7-price-level` does exist. An undeclared branch is **UNDECLARED**, a
third state, not a pass and not a failure.

⛔ **AND `--is-ancestor` FAILING IS NOT THE SAME AS "NOT AN ANCESTOR".** It exits `0` for yes and
`1` for no, but it also exits non-zero when the ref does not resolve, when the object is missing,
or when git is not on PATH. Collapsing those into "not contained" would report a broken
measurement as unpublished work — the same shape as the cp1252 bug that reported an encoding
failure as an auth problem. Exit codes here are three, deliberately:

    0  PASS         every declared tree is clean and contained
    1  FAIL         measured: a tree is dirty, or holds commits its publish ref does not
    2  UNREADABLE   the question could not be asked (undeclared branch, unresolvable ref, no git)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

#: The tree -> publish-ref map. ⛔ DECLARED. A branch absent from this table is UNDECLARED
#: and stops the run; adding a tree is a deliberate, reviewable act.
PUBLISH_REF = {
    "feat/s7-price-level": "origin/master",
    "terminal-research": "origin/terminal-research",
}

TREES = {
    "feat/s7-price-level": r"C:\Users\Patrick\uct-worktrees\s7-price-level",
    "terminal-research": r"C:\Users\Patrick\uct-worktrees\terminal-research",
}

PASS, FAIL, UNREADABLE = 0, 1, 2


def _git(cwd, *args):
    """Run git and hand back (returncode, stdout). Never raises for a non-zero exit."""
    try:
        r = subprocess.run(["git", "-C", str(cwd)] + list(args),
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
    except FileNotFoundError:
        return 127, "git not found on PATH"
    except subprocess.TimeoutExpired:
        return 124, "git timed out"
    return r.returncode, (r.stdout or "").strip() or (r.stderr or "").strip()


def check_tree(path, *, declared=PUBLISH_REF):
    """Return (state, branch, ref, detail) for one worktree. state in PASS/FAIL/UNREADABLE."""
    rc, branch = _git(path, "rev-parse", "--abbrev-ref", "HEAD")
    if rc != 0:
        return UNREADABLE, None, None, "cannot read HEAD: %s" % branch

    ref = declared.get(branch)
    if ref is None:
        return (UNREADABLE, branch, None,
                "UNDECLARED branch %r — add it to PUBLISH_REF or run it by hand" % branch)

    # ⛔ Resolve the ref FIRST. Without this an unresolvable ref reads as "not contained".
    rc, out = _git(path, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
    if rc != 0:
        return UNREADABLE, branch, ref, "publish ref %s does not resolve (fetched?)" % ref

    rc, out = _git(path, "status", "--porcelain")
    if rc != 0:
        return UNREADABLE, branch, ref, "cannot read status: %s" % out
    if out:
        n = len(out.splitlines())
        return FAIL, branch, ref, "working tree is DIRTY (%d path%s): %s" % (
            n, "" if n == 1 else "s", ", ".join(out.splitlines()[:5]))

    rc, out = _git(path, "merge-base", "--is-ancestor", "HEAD", ref)
    if rc == 0:
        return PASS, branch, ref, "HEAD is contained in %s" % ref
    if rc != 1:
        return UNREADABLE, branch, ref, "merge-base could not answer (exit %d): %s" % (rc, out)

    _, names = _git(path, "log", "--oneline", "%s..HEAD" % ref)
    lines = [l for l in names.splitlines() if l][:10]
    return (FAIL, branch, ref,
            "HEAD is NOT contained in %s — %d unpublished commit%s: %s" % (
                ref, len(lines), "" if len(lines) == 1 else "s", " | ".join(lines)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tree", action="append", default=None,
                    help="path to check (repeatable); default = the declared trees")
    ap.add_argument("--self-check", action="store_true",
                    help="prove this check can FAIL, then exit")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    if a.self_check:
        return _self_check()

    paths = a.tree or list(TREES.values())
    worst = PASS
    for p in paths:
        state, branch, ref, detail = check_tree(p)
        label = {PASS: "PASS", FAIL: "FAIL", UNREADABLE: "UNREADABLE"}[state]
        print("[env-check-1] %-10s %s (%s -> %s) %s" % (
            label, os.path.basename(str(p).rstrip(chr(92) + "/")), branch, ref, detail))
        worst = max(worst, state)
    print("[env-check-1] %s" % {PASS: "OK — every tree clean and published",
                                FAIL: "STOP — a measured failure above",
                                UNREADABLE: "STOP — could not be measured"}[worst])
    return worst


def _self_check():
    """⛔ A check nobody has seen fail is not a check."""
    import tempfile, pathlib
    ok = True
    with tempfile.TemporaryDirectory() as td:
        repo = pathlib.Path(td) / "r"
        repo.mkdir()
        for args in (("init", "-q", "-b", "main"),
                     ("config", "user.email", "x@y.z"),
                     ("config", "user.name", "x")):
            _git(repo, *args)
        (repo / "f").write_text("1", encoding="utf-8")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "one")
        _git(repo, "update-ref", "refs/remotes/origin/master", "HEAD")
        declared = {"main": "origin/master"}

        state, _, _, d = check_tree(repo, declared=declared)
        print("  contained        -> %s (%s)" % (state, d))
        ok &= (state == PASS)

        (repo / "f").write_text("2", encoding="utf-8")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "unpushed")
        state, _, _, d = check_tree(repo, declared=declared)
        print("  unpushed commit  -> %s (%s)" % (state, d))
        ok &= (state == FAIL)

        state, _, _, d = check_tree(repo, declared={})
        print("  undeclared       -> %s (%s)" % (state, d))
        ok &= (state == UNREADABLE)
    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return PASS if ok else FAIL


if __name__ == "__main__":
    raise SystemExit(main())
