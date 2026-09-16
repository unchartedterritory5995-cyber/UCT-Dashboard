"""Refuse a commit whose staged paths fall outside the committing programme's scope.

Session 12, Workstream D. ⚰️ WRITTEN BECAUSE THE RULE ALREADY EXISTED AND WAS BROKEN
ANYWAY. `lesson_uct_dashboard_shared_worktree` says never `git add -A` in this repo. On
2026-09-15 a breadth commit used it and swept in two joystick docs, silently normalising
another programme's deliberate raw `\\x01` bytes to nothing. A rule that lives only in
prose is a rule that survives until somebody is in a hurry.

✅ INSTALLED 2026-09-16, IN WARN MODE, by owner ruling (SD-1.1 A2.2 / SD-1.4 D3.4).
⚰️ This block used to read "THIS IS A CHECKER, NOT AN INSTALLED HOOK, AND THAT IS
DELIBERATE … wiring it is the owner's." That was true and correctly cautious — the shared
`core.hooksPath` holds another programme's `pre-commit` (credential scan) and `pre-push`
(deploy guard), and installing a third thing there changes every worktree for every
programme. The owner supplied the decision; the sentence is corrected here rather than
left to contradict the world, which is this repo's most-repeated documentation defect.

It is PREPENDED to that shared `pre-commit` and wrapped in `|| true`, so it observes and
can never refuse anybody's commit. Promotion to ENFORCE is gated on the trial criterion
below, not on anyone's judgement that it looks fine.

⛔ AND IT IS NOT THE FIRST SCOPE MECHANISM HERE. `app/src/hub/rule12Paths.test.js` already
does this for the joystick programme — as a TEST, identifying the change set from the DIFF
rather than from the branch name, because a name is typed and a diff is evidence. This
follows that shape rather than inventing a second idiom.

    python tools/git_scope.py                 # check what is staged
    python tools/git_scope.py --self-check    # prove it can refuse
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
SCOPE_DIR = REPO / ".git-scope"
#: ⛔ An EXPLICIT env var, and it is logged. A silent override is the same as no rule.
OVERRIDE = "UCT_SKIP_GIT_SCOPE"
OVERRIDE_LOG = REPO / "logs" / "git-scope-override.log"
#: ⛔ WARN mode writes here and NEVER refuses — the 24 h trial's whole record.
#: ⛔⛔ FIXED PATH, OUTSIDE EVERY WORKTREE (SD-1.5 E1.1). It was `REPO / "logs"`,
#: where REPO is this file's own location — so each worktree kept a SEPARATE trial log
#: and the criterion's ">=2 workstreams" had to be inferred from which files existed.
#: Same defect as the sampler pool (SD-1.2 B3.1), found the same night. One file, and
#: the worktree is a FIELD, so "2 workstreams" is counted from the data.
HEARTBEAT_LOG = pathlib.Path(os.environ.get(
    "GIT_SCOPE_HEARTBEAT", "C:/Users/Patrick/uct-git-scope/heartbeat.jsonl"))
WARN_LOG = HEARTBEAT_LOG


def _git(*args) -> str:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True,
                       encoding="utf-8", errors="replace")
    return p.stdout if p.returncode == 0 else ""


def current_branch() -> str:
    """⛔ `rev-parse --abbrev-ref HEAD` FAILS ON AN UNBORN BRANCH — a branch with no
    commits yet — and returns empty, which this tool would read as "no branch" and let
    everything through. A pre-commit hook runs precisely when a commit does not exist
    yet, so that is not an edge case here, it is the first call. `symbolic-ref` answers
    on an unborn branch; keep both, in that order."""
    b = _git("symbolic-ref", "--short", "HEAD").strip()
    return b or _git("rev-parse", "--abbrev-ref", "HEAD").strip()


def staged_paths() -> list[str]:
    """⛔ Diff against HEAD when it exists, and against the EMPTY TREE when it does not —
    otherwise the first commit in a repository stages everything invisibly."""
    if _git("rev-parse", "--verify", "HEAD").strip():
        out = _git("diff", "--cached", "--name-only", "--diff-filter=d")
    else:
        out = _git("diff", "--cached", "--name-only", "--diff-filter=d",
                   "4b825dc642cb6eb9a060e54bf8d69288fbee4904")   # the empty tree
    return [l.strip().replace("\\", "/") for l in out.splitlines() if l.strip()]


def load_scopes() -> dict:
    """{scope-name: {"branches": [prefix...], "allow": [path prefix...]}}"""
    scopes = {}
    if not SCOPE_DIR.is_dir():
        return scopes
    for f in sorted(SCOPE_DIR.glob("*.json")):
        try:
            scopes[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[git-scope] ⛔ {f.name} is not valid JSON: {e}", file=sys.stderr)
            raise
    return scopes


def scope_for(branch: str, scopes: dict):
    """The scope whose branch prefixes match, or None.

    ⛔ AN UNMATCHED BRANCH IS NOT A VIOLATION. Most branches in this repo belong to
    programmes that have declared nothing, and refusing those would make the check
    intolerable within a day — which is how a guard gets bypassed. Silence here is the
    honest answer: this tool only enforces scopes that were written down.
    """
    for name, s in scopes.items():
        for p in s.get("branches", []):
            if branch == p or branch.startswith(p):
                return name, s
    return None, None


def violations(branch: str, paths: list[str], scopes: dict) -> tuple:
    name, s = scope_for(branch, scopes)
    if s is None:
        return None, []
    allow = tuple(s.get("allow", []))
    if not allow:
        return name, []
    bad = [p for p in paths if not p.startswith(allow)]
    return name, bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true",
                    help="prove the refusal can fire, without touching the index")
    ap.add_argument("--warn", action="store_true",
                    help="observe only: record what WOULD have been refused and exit 0")
    args = ap.parse_args(argv)

    scopes = load_scopes()

    if args.self_check:
        # ⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD.
        fake = {"demo": {"branches": ["breadth/"],
                         "allow": ["api/services/breadth_", "tools/breadth_"]}}
        name, bad = violations("breadth/sampler",
                               ["tools/breadth_sampler.py",
                                "docs/plans/joystick/RESUME.md"], fake)
        ok_refuse = bad == ["docs/plans/joystick/RESUME.md"]
        name2, bad2 = violations("breadth/sampler", ["tools/breadth_sampler.py"], fake)
        ok_pass = bad2 == []
        name3, bad3 = violations("feat/something-else",
                                 ["docs/plans/joystick/RESUME.md"], fake)
        ok_silent = name3 is None and bad3 == []
        print(f"  refuses an out-of-scope path : {ok_refuse}")
        print(f"  passes an in-scope path      : {ok_pass}")
        print(f"  silent on an undeclared branch: {ok_silent}")
        return 0 if (ok_refuse and ok_pass and ok_silent) else 1

    if os.environ.get(OVERRIDE, "").strip():
        OVERRIDE_LOG.parent.mkdir(parents=True, exist_ok=True)
        with OVERRIDE_LOG.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(f"{_git('rev-parse', '--abbrev-ref', 'HEAD').strip()} "
                     f"{' '.join(staged_paths())}\n")
        print(f"[git-scope] ⚠️ OVERRIDDEN via {OVERRIDE} — logged to "
              f"{OVERRIDE_LOG.relative_to(REPO)}")
        return 0

    branch, paths = current_branch(), staged_paths()
    name, bad = violations(branch, paths, scopes) if paths else (None, [])

    if args.warn:
        # ⛔⛔ OBSERVE ONLY, AND A HEARTBEAT ON EVERY INVOCATION.
        #
        # This runs inside ANOTHER programme's shared pre-commit hook, so it must not be
        # able to refuse anybody's commit while it is being trialled: it records and exits
        # 0, always.
        #
        # ⛔ IT LOGS EVEN WHEN THERE IS NOTHING TO REPORT, and that is the load-bearing
        # part. Session 13 measured that appending this call after the credential scan's
        # `exit 0` makes it never run — and a never-run trial produces an EMPTY log, which
        # under a "zero false positives" criterion reads as a pass. A check that promotes
        # itself on silence is worse than no check. With a heartbeat, "it ran and saw
        # nothing" and "it never ran" stop being the same observation.
        #
        # The promotion criterion is therefore about PRESENCE, not absence (SD-1.1 A2.2):
        # >= 20 heartbeats from >= 2 workstreams over >= 24 h with zero WOULD-REFUSE rows.
        verdict = ("no-scope" if name is None else
                   "in-scope" if not bad else "WOULD-REFUSE")
        WARN_LOG.parent.mkdir(parents=True, exist_ok=True)
        # ⛔ ONE SHARED FILE, so the WORKTREE IS A FIELD. The criterion asks for
        # ">= 2 workstreams"; with a per-worktree log that had to be inferred from which
        # files happened to exist, which is not a count of anything. JSON so the trial is
        # counted rather than eyeballed.
        with WARN_LOG.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({
                "ts": datetime.datetime.now().isoformat(timespec="seconds"),
                "worktree": REPO.name,
                "worktree_path": str(REPO),
                "branch": branch or "(unborn)",
                "scope": name or "UNMATCHED",
                "staged": len(paths),
                "verdict": verdict,
                "outside": bad,
            }, sort_keys=True) + "\n")
        if bad:
            print(f"[git-scope] ⚠️ WARN ONLY — branch '{branch}' is scoped to '{name}' and "
                  f"{len(bad)} staged path(s) fall outside it. The commit is NOT blocked.")
            for p in bad:
                print(f"    {p}")
            print(f"  recorded to {WARN_LOG}")
        return 0

    if not paths:
        return 0
    if name is None:
        return 0
    if not bad:
        print(f"[git-scope] {branch}: {len(paths)} staged path(s), all inside '{name}'")
        return 0

    print(f"[git-scope] ⛔ REFUSING THE COMMIT. Branch '{branch}' is scoped to '{name}', "
          f"and these staged paths are outside it:", file=sys.stderr)
    for p in bad:
        print(f"    {p}", file=sys.stderr)
    print(f"\n  Stage by name instead of `git add -A`. If this is deliberate:\n"
          f"    {OVERRIDE}=1 git commit …   (logged)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
