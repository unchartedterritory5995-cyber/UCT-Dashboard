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


def tail(out, keep=3, width=300) -> str:
    """The last few non-empty lines of a command's output, on ONE line.

    ⚰️ **E CP16 — `run()` returned the output and every caller threw it away.** Run #13's
    rebase returned **128** and the log recorded only `rebase rc=128`, so the failure was
    named but not explained — and git had already printed the reason.

    ⭐ The TAIL, not the head: git puts `fatal: …` last, after any progress chatter. One
    line, because it rides a `::error::` annotation, and bounded because a diagnostic that
    floods the channel is a diagnostic nobody reads.
    """
    lines = [l.strip() for l in str(out or "").splitlines() if l.strip()]
    if not lines:
        return "(no output)"
    return " | ".join(lines[-keep:])[:width]


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
        # ⛔ E CP14 - explicit refspec: the rebase below needs the TRACKING ref,
        # and a bare `git fetch origin <b>` is only guaranteed to write FETCH_HEAD.
        rc, out = run(["git", "fetch", "origin",
                       "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch)],
                      runner=runner)
        log.append("attempt %d: fetch rc=%d" % (i, rc))
        # ⛔ E CP13 — AN UNREADABLE UPSTREAM IS NOT A CONFLICT. `git rebase origin/<b>`
        # returns non-zero both when two publishers collided AND when the ref simply does
        # not resolve — and `git fetch origin <b>` writes FETCH_HEAD, which under a
        # single-branch refspec need not create `refs/remotes/origin/<b>` at all.
        # ⭐ The old code called every non-zero rebase "two publishers wrote one path",
        # which is a confident diagnosis of a cause it had not established. The two states
        # are now separated and each says only what it knows.
        rc_ref, _ = run(["git", "rev-parse", "--verify", "--quiet",
                         "origin/" + branch], runner=runner)
        if rc_ref != 0:
            log.append("attempt %d: ⛔ UPSTREAM-UNREADABLE — `origin/%s` does not resolve "
                       "after fetch. NOT a conflict, and not published." % (i, branch))
            return FAIL, log
        rc, out = run(["git", "rebase", "origin/" + branch], runner=runner)
        log.append("attempt %d: rebase rc=%d" % (i, rc))
        if rc == 1:
            # ⛔ A rebase CONFLICT is rc 1, and only rc 1. It means two runs wrote the SAME
            # path, which the per-run-directory layout is supposed to make impossible.
            log.append("attempt %d: ⛔ REBASE CONFLICT — two publishers wrote one path; "
                       "this should be impossible once latest.json is gone" % i)
            log.append("attempt %d: git said: %s" % (i, tail(out)))
            return FAIL, log
        if rc != 0:
            # ⚰️ E CP16 — RUN #13 RETURNED 128 AND THIS CODE CALLED IT A CONFLICT.
            # git exits 128 on a FATAL error (a refused state, a bad argument, an
            # unreadable repo) and 1 on a conflict. ⛔ Calling 128 "two publishers wrote one
            # path" is the same defect E CP13 split UPSTREAM-UNREADABLE out of, committed
            # again one branch over: a confident sentence about a cause nobody established.
            # ⭐ git already knows what went wrong and says so — the only reason nobody
            # could read it is that this function threw the text away.
            log.append("attempt %d: ⛔ REBASE FATAL (rc=%d, NOT a conflict — a conflict is "
                       "rc 1). git said: %s" % (i, rc, tail(out)))
            return FAIL, log
        rc, out = run(["git", "push", "origin", branch], runner=runner)
        log.append("attempt %d: push rc=%d" % (i, rc))
        if rc == 0:
            log.append("published on attempt %d" % i)
            return OK, log
        log.append("attempt %d: push rejected. git said: %s" % (i, tail(out)))
        if i < attempts:
            sleep(backoff)
    log.append("⛔ %d attempts exhausted — NOT published. Exiting non-zero so the run "
               "cannot read as successful." % attempts)
    return FAIL, log


def annotation(rc, log) -> str:
    """The whole push trace as ONE workflow annotation line.

    ⛔⛔ **E CP15 — THE TRACE WENT TO STDOUT, WHICH IS 403 TO A READER WITH NO ACCOUNT.**
    E CP14 made the publish step name its failing *command* in the annotations channel —
    measured to answer anonymously — and run #12 duly reported
    `python "/tmp/ci_publish.py" --branch ci-results (exit 1)`. That names the command and
    **not which of three branches it took**: UPSTREAM-UNREADABLE, REBASE CONFLICT, or
    attempts exhausted. Those lines existed all along, in the one place nobody can read.

    ⭐ ONE annotation, not one per line: GitHub caps annotations per step, and a trace
    truncated at the cap loses its tail — which is exactly where the verdict is. `%0A` is
    the workflow-command newline escape, so this renders multi-line inside a single
    annotation and cannot be clipped by the cap.
    """
    flat = "%0A".join(str(l).replace("\r", " ").replace("\n", " ") for l in log)
    return "::%s title=ci-publish::%s" % ("error" if rc else "notice", flat)


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

    # 4a — ⚰️ E CP16: rc 128 is a FATAL git error, not a conflict, and git's own text
    # must reach the log. Run #13 recorded `rebase rc=128` and nothing else.
    def fatal_runner(cmd):
        if cmd[1] == "rebase":
            return (128, "First, rewinding head...\nfatal: cannot rebase: You have "
                         "unstaged changes.\n")
        return (0, "")
    rc_f, log_f = push_with_retry(runner=fatal_runner, sleep=lambda s: None)
    show("rc 128 exits 1", rc_f, FAIL)
    show("...and is NOT called a conflict", any("REBASE CONFLICT" in l for l in log_f), False)
    show("...it is called FATAL and says the rc", any("REBASE FATAL (rc=128" in l for l in log_f), True)
    show("...and git's OWN sentence reaches the log",
         any("cannot rebase: You have unstaged changes." in l for l in log_f), True)

    def conflict_text_runner(cmd):
        return (1, "CONFLICT (add/add): Merge conflict in results/x\n") if cmd[1] == "rebase" else (0, "")
    rc_ct, log_ct = push_with_retry(runner=conflict_text_runner, sleep=lambda s: None)
    show("rc 1 IS a conflict", any("REBASE CONFLICT" in l for l in log_ct), True)
    # ⛔ NON-VACUITY: the two rcs must not produce the same sentence.
    show("fatal and conflict are distinguishable",
         set(l for l in log_f if "⛔" in l) != set(l for l in log_ct if "⛔" in l), True)
    show("tail() takes the LAST lines, where git puts `fatal:`",
         tail("progress\nmore progress\nfatal: the real reason"),
         "progress | more progress | fatal: the real reason")
    show("tail() of nothing is NAMED, not empty", tail(""), "(no output)")

    # 4b — ⛔ E CP13: an unresolvable upstream is its OWN state, never "a conflict"
    def no_upstream(cmd):
        return (1, "") if cmd[1] == "rev-parse" else (0, "")
    rc_u, log_u = push_with_retry(runner=no_upstream, sleep=lambda s: None)
    show("upstream that does not resolve exits 1", rc_u, FAIL)
    show("...and is named UPSTREAM-UNREADABLE",
         any("UPSTREAM-UNREADABLE" in l for l in log_u), True)
    show("...and is NOT called a rebase conflict",
         any("REBASE CONFLICT" in l for l in log_u), False)
    # ⛔ NON-VACUITY for this pair: the two failures must not print the same sentence.
    show("conflict and unreadable-upstream are distinguishable",
         set(l.split(":")[-1] for l in log if "⛔" in l)
         != set(l.split(":")[-1] for l in log_u if "⛔" in l), True)

    # 4c — ⛔ E CP15: the trace must leave through the channel a stranger can read.
    rc_c, log_c = push_with_retry(runner=conflict_runner, sleep=lambda s: None)
    ann_c = annotation(rc_c, log_c)
    rc_ok, log_ok = push_with_retry(runner=make_runner([0]), sleep=lambda s: None)
    ann_ok = annotation(rc_ok, log_ok)
    show("a failure annotates at ERROR level", ann_c.startswith("::error "), True)
    show("a success annotates at NOTICE level", ann_ok.startswith("::notice "), True)
    show("the annotation is ONE line (the per-step cap cannot clip it)",
         len(ann_c.splitlines()), 1)
    show("...and it carries the VERDICT line, not just the first attempt",
         "REBASE CONFLICT" in ann_c, True)
    show("...and every log line survives into it",
         ann_c.count("%0A"), len(log_c) - 1)
    # ⛔ NON-VACUITY: the two levels must actually differ, or the check proves nothing.
    show("error and notice are distinguishable", ann_c[:9] != ann_ok[:9], True)

    # 5 — ⚰️ E CP13: THIS SCRIPT MUST STILL EXIST WHEN IT IS CALLED.
    # `ci-results` carries README.md + results/** and no `tools/` at all, so
    # `git checkout ci-results` deletes this file from the working tree. E CP9 added
    # `python tools/ci_publish.py` as the last line AFTER that checkout; run #10 died
    # there in 2 s with all 19 other jobs green. ⭐ The publisher asserts the condition
    # of its own reachability, because no other validator could see this.
    def publish_step_body(text):
        i = text.index("- name: Publish onto the orphan ci-results branch")
        return text[i:]

    def invocations_after_checkout(body):
        """Every `python <path>` that runs after the branch switch wipes the tree."""
        k = body.find("git checkout ci-results")
        if k < 0:
            return None  # UNREADABLE, never "none found"
        out = []
        for line in body[k:].splitlines():
            t = line.strip()
            if t.startswith("python ") and "--self-check" not in t:
                out.append(t.split()[1].strip('"').strip("'"))
        return out

    wf = pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/full-suite-report.yml"
    if wf.is_file():
        body = publish_step_body(wf.read_text(encoding="utf-8"))
        calls = invocations_after_checkout(body)
        show("the publish step is READABLE (not a silent zero)", calls is not None, True)
        show("at least one python call runs after the checkout (non-vacuity)",
             bool(calls), True)
        show("...and none of them is under tools/, which the checkout deletes",
             [c for c in (calls or []) if not c.startswith("/tmp")], [])
        # CONTROL: the pre-fix spelling must be caught by this very check.
        broken = body.replace('python "/tmp/ci_publish.py"', "python tools/ci_publish.py")
        show("control: the run-#10 spelling IS flagged",
             [c for c in invocations_after_checkout(broken) if not c.startswith("/tmp")],
             ["tools/ci_publish.py"])
    else:
        print("  [workflow not found — UNREADABLE, not a pass]")
        ok = False

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
    print(annotation(rc, log))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
