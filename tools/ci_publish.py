"""Push one run's record onto `ci-results`, and FAIL LOUDLY when it cannot.

⛔⛔ **E CP9 — F-CI-7: THE PUBLISHER HAD NO FAILURE PATH.** Runs #5 and #6 both had their
`publish` job fail, so **no record exists for either**, and the only remaining evidence sits
behind a log endpoint that returns **403** unauthenticated. Every guard this programme
built — zero-collected, totals-line, runner-sourced outcome, shards-missing — lives INSIDE
the job that did not run.

⭐ **So the fix is two-sided.** The push is made reliable (below), AND the summary is written
to `$GITHUB_STEP_SUMMARY` **before** the push is attempted, so the outcome is readable in the
Actions tab on a phone even when the repo record never lands. **A publisher that can fail
silently is a measurement system with a hole exactly where the bad news goes.**

⛔ **F-CI-8: two runs racing.** The primary defence is a job-level
`concurrency: { group: ci-results-publish, cancel-in-progress: false }` in the workflow —
publishers queue instead of colliding. This bounded fetch/rebase/push retry is the SECOND
defence, for the window the concurrency group cannot cover (a manual push to the branch, a
re-run). ⚠️ **It is not the primary mechanism and must not be described as one.**

⭐ **Why a rebase here cannot conflict, once `results/latest.json` is gone:** every run
writes only `results/<run_id>/…`, a directory no other run touches. Two publishers' commits
are disjoint by construction, so `git rebase` replays cleanly. **`latest.json` was the one
path both wrote, which is precisely why it was deleted** — the conflict was a property of
the pointer, not of the branch.

Usage:
    python tools/ci_publish.py --run-dir out/34949032368 --branch ci-results
    python tools/ci_publish.py --self-check
"""
from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
import sys
import time

OK, FAIL = 0, 1
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 5

# ⚰️ FIFTH RECURRENCE in this programme: a Windows console encodes stdout as cp1252 and
# these tools print ⛔/⭐. Without this, the script dies mid-report with a UnicodeEncodeError
# that reads as a logic fault. Same family as tools/merge_all.py (E CP3 era) and
# tools/flag_ledger_audit.py's 2026-09-10 bug, on the output side.
# ⭐ Worth naming as a class: any tool in this repo that prints a glyph and may run on this
# box needs this, and the cost of forgetting is a traceback that hides the real result.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 — a stream that cannot be reconfigured is not fatal
        pass


def run(cmd, cwd=None, runner=None):
    """(rc, output). `runner` is injected so the controls never touch a real remote."""
    if runner is not None:
        return runner(cmd)
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def report_artifact(path) -> str:
    """⛔ EXISTS AND SIZE, printed BEFORE any read.

    A read before creation is an UNREADABLE outcome with the missing path NAMED — never a
    retry loop that hides it. ⚰️ E CP8 was exactly this: `jobs.json` consumed 27 lines
    before it was written, and every shard silently read UNREADABLE.
    """
    p = pathlib.Path(path)
    if not p.exists():
        return "UNREADABLE: %s does not exist" % path
    try:
        return "%s exists, %d bytes" % (path, p.stat().st_size)
    except OSError as e:
        return "UNREADABLE: %s cannot be stat'd (%s)" % (path, e)


def push_with_retry(branch="ci-results", runner=None, sleep=time.sleep,
                    attempts=MAX_ATTEMPTS, backoff=BACKOFF_SECONDS):
    """fetch -> rebase -> push, bounded. Returns (rc, [log lines]).

    ⛔ On final failure this returns non-zero. The caller MUST exit non-zero: a publisher
    that swallows a push failure leaves no record and says nothing, which is F-CI-7.
    """
    log = []
    for i in range(1, attempts + 1):
        rc, out = run(["git", "fetch", "origin", branch], runner=runner)
        log.append("attempt %d: fetch rc=%d" % (i, rc))
        rc, out = run(["git", "rebase", "origin/" + branch], runner=runner)
        log.append("attempt %d: rebase rc=%d" % (i, rc))
        if rc != 0:
            # ⛔ A rebase conflict here means two runs wrote the SAME path, which the
            # per-run-directory layout is supposed to make impossible. Say so loudly
            # rather than forcing past it.
            log.append("attempt %d: ⛔ REBASE CONFLICT — two publishers wrote one path; "
                       "this should be impossible once latest.json is gone" % i)
            return FAIL, log
        rc, out = run(["git", "push", "origin", branch], runner=runner)
        log.append("attempt %d: push rc=%d" % (i, rc))
        if rc == 0:
            log.append("published on attempt %d" % i)
            return OK, log
        log.append("attempt %d: push rejected (non-fast-forward or remote error)" % i)
        if i < attempts:
            sleep(backoff)
    log.append("⛔ %d attempts exhausted — NOT published. Exiting non-zero so the run "
               "cannot read as successful." % attempts)
    return FAIL, log


def write_step_summary(text, path=None):
    """⛔ Written BEFORE the push is attempted, unconditionally.

    ⭐ When the repo record never lands, this is the only phone-readable evidence. It must
    not be conditional on the thing that fails.
    """
    target = path or os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return "no GITHUB_STEP_SUMMARY in the environment — skipped"
    try:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(text.rstrip() + "\n")
        return "step summary written to %s (%d chars)" % (target, len(text))
    except OSError as e:
        return "UNREADABLE: could not write step summary (%s)" % e


def _self_check() -> int:
    ok = True
    slept = []

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    def make_runner(push_results):
        """push_results: list of rc for successive pushes."""
        state = {"push": 0}
        def r(cmd):
            if cmd[1] == "push":
                rc = push_results[min(state["push"], len(push_results) - 1)]
                state["push"] += 1
                return rc, ""
            return 0, ""
        return r

    # 1 — two non-fast-forwards then success
    slept.clear()
    rc, log = push_with_retry(runner=make_runner([1, 1, 0]), sleep=lambda s: slept.append(s))
    print("  [two rejections then success]")
    for l in log:
        print("      " + l)
    show("exit 0", rc, OK)
    show("three attempts were made", sum(1 for l in log if l.startswith("attempt 3")), 3)
    show("it backed off twice, 5 s each", slept, [5, 5])

    # 2 — permanent rejection
    slept.clear()
    rc, log = push_with_retry(runner=make_runner([1]), sleep=lambda s: slept.append(s))
    print("  [permanent rejection]")
    print("      " + log[-1])
    show("exit 1 — the run cannot read as successful", rc, FAIL)
    show("it stopped at the cap, not forever", len(slept), MAX_ATTEMPTS - 1)

    # ...and the step summary is still written on that path
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        f = pathlib.Path(td) / "summary.md"
        msg = write_step_summary("# CI record\n\nverdict: RED\n", str(f))
        show("step summary written even though the push failed", f.is_file(), True)
        show("...and it has content", f.read_text(encoding="utf-8").startswith("# CI record"), True)

    # 3 — missing jobs.json is UNREADABLE with the path named
    r = report_artifact("definitely/not/here/jobs.json")
    print("  [missing artifact] " + r)
    show("missing artifact -> UNREADABLE", r.startswith("UNREADABLE"), True)
    show("...and the path is NAMED", "definitely/not/here/jobs.json" in r, True)
    with tempfile.TemporaryDirectory() as td:
        f = pathlib.Path(td) / "jobs.json"
        f.write_text('{"jobs": []}', encoding="utf-8")
        r2 = report_artifact(str(f))
        show("existing artifact reports its SIZE", "12 bytes" in r2, True)

    # 4 — a rebase conflict is refused, not forced past
    def conflict_runner(cmd):
        return (1, "CONFLICT") if cmd[1] == "rebase" else (0, "")
    rc, log = push_with_retry(runner=conflict_runner, sleep=lambda s: None)
    show("a rebase CONFLICT exits 1 rather than forcing", rc, FAIL)
    show("...and says two publishers wrote one path",
         any("REBASE CONFLICT" in l for l in log), True)

    # ⛔ NON-VACUITY: the three outcomes must be distinguishable
    outs = {push_with_retry(runner=make_runner([0]), sleep=lambda s: None)[0],
            push_with_retry(runner=make_runner([1]), sleep=lambda s: None)[0]}
    show("success and failure are distinguishable", sorted(outs), [OK, FAIL])

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--branch", default="ci-results")
    ap.add_argument("--check-artifact", action="append", default=[])
    ap.add_argument("--summary-file")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    for path in a.check_artifact:
        print("[ci-publish] " + report_artifact(path))
    if a.summary_file and pathlib.Path(a.summary_file).is_file():
        print("[ci-publish] " + write_step_summary(
            pathlib.Path(a.summary_file).read_text(encoding="utf-8")))

    rc, log = push_with_retry(a.branch)
    for l in log:
        print("[ci-publish] " + l)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
