"""Pre-flight for the weekly auth.db restore drill (scorecard clause 7a), and its loud failure.

Called by `restore_drill_weekly.cmd` BEFORE the drill runs. Wave 14, lane OPS.

WHY THIS EXISTS. On 2026-10-04 the scheduled drill fired at 09:00 and its checkout
(`C:\\Users\\Patrick\\uct-worktrees\\notebook-soak-ref`) did not exist. The old wrapper's `cd /d`
failed, the wrapper carried on from the Task Scheduler's default directory (`C:\\Windows\\System32`),
and `python tools\\authdb_restore_drill.py` died with `[Errno 2]`. The run log got one Python
traceback line and `DRILL exit=2`, the same exit code as an honest INCONCLUSIVE drill, and nothing
reached the soak's drill folder or any alert. It was the second time: the checkout was also gone
on 2026-10-01. See `docs/notebook/wave14-ops.md` for why it vanishes.

What this does, in order, and it stops at the first failure:

  1. the checkout directory exists;
  2. it holds `tools/authdb_restore_drill.py`;
  3. it is a git checkout whose TOP LEVEL is that directory, not some parent repo;
  4. its HEAD is on the expected ref's history (`origin/master` by default), so the drill
     never runs from a feature branch somebody left checked out there.

Pass: prints `PREFLIGHT OK ...` and exits 0. Fail: prints `PREFLIGHT FAIL: <why>`, writes a
`# auth.db restore drill - FAIL` report into the soak's drill folder (so `nb_soak.py` says the
week FAILED instead of "no drill report"), sends the alert through the soak's own channel
(`nb_soak.send`: the Discord webhook in NB_SOAK_DISCORD_WEBHOOK, else the desktop balloon), and
exits 4. Exit 4 is never a code the drill itself returns, so the run log and the task's Last
Result tell a pre-flight abort apart from a drill verdict.

`--fail WHY` skips the checks and does only the failure half; the wrapper uses it for faults it
detects itself (a `cd` that fails after the checks passed).

RD_NO_ALERT=1 suppresses the send (tests only) and says so on stdout. This file imports nothing
from `api.*` and never touches a store; it reads git metadata and writes one markdown file.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXIT_PREFLIGHT = 4
DRILL_TOOL = Path("tools") / "authdb_restore_drill.py"


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=60)


def check(repo: Path, ref: str) -> str | None:
    """None when the checkout is fit to run the drill, else one sentence saying why not."""
    if not repo.is_dir():
        return f"checkout missing: {repo} does not exist"
    if not (repo / DRILL_TOOL).is_file():
        return f"checkout incomplete: {repo / DRILL_TOOL} does not exist"
    try:
        top = _git(repo, "rev-parse", "--show-toplevel")
    except (OSError, subprocess.SubprocessError) as e:
        return f"git could not be run against {repo}: {type(e).__name__}: {e}"
    if top.returncode != 0:
        return f"not a git checkout: {repo} ({top.stderr.strip()[:200]})"
    try:
        same = Path(top.stdout.strip()).resolve() == repo.resolve()
    except OSError:
        same = False
    if not same:
        return f"not a checkout root: {repo} sits inside {top.stdout.strip()}"
    head = _git(repo, "rev-parse", "--short=10", "HEAD").stdout.strip() or "?"
    if _git(repo, "rev-parse", "--verify", "--quiet", ref + "^{commit}").returncode != 0:
        return f"expected ref {ref} does not resolve in {repo}"
    anc = _git(repo, "merge-base", "--is-ancestor", "HEAD", ref)
    if anc.returncode != 0:
        return f"wrong ref: HEAD {head} in {repo} is not on {ref}'s history"
    return None


def describe(repo: Path, ref: str) -> str:
    head = _git(repo, "rev-parse", "--short=10", "HEAD").stdout.strip()
    behind = _git(repo, "rev-list", "--count", f"HEAD..{ref}").stdout.strip()
    return f"HEAD {head} on {ref} ({behind or '?'} commit(s) behind it)"


def fail_report(why: str, now: dt.datetime) -> str:
    """The drill's own headline grammar, so `nb_soak.parse_drill` reads it as a FAIL."""
    return (
        "# auth.db restore drill - FAIL\n\n"
        f"- run at: {now.isoformat(timespec='seconds')}\n"
        "- stage: PRE-FLIGHT -- the drill did NOT run; nothing was downloaded or checked\n"
        f"- why: {why}\n"
        "- written by: tools/restore_drill_guard.py (via restore_drill_weekly.cmd)\n\n"
        "Re-run the wrapper by hand once the checkout is back (see docs/notebook/wave14-ops.md);\n"
        "a PASS later in the same 7-day block clears the week.\n"
    )


def fail(why: str, drills: Path | None, now: dt.datetime | None = None, send=None) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    print(f"PREFLIGHT FAIL: {why}", flush=True)
    if drills is not None:
        try:
            drills.mkdir(parents=True, exist_ok=True)
            path = drills / f"drill-{now.date().isoformat()}-preflight.md"
            tmp = path.with_suffix(".md.tmp")
            tmp.write_text(fail_report(why, now), encoding="utf-8")
            os.replace(tmp, path)
            print(f"PREFLIGHT FAIL report: {path}", flush=True)
        except OSError as e:
            print(f"PREFLIGHT FAIL report NOT written: {type(e).__name__}: {e}", flush=True)
    text = f"Restore drill ABORTED before it ran: {why}"
    if os.environ.get("RD_NO_ALERT") == "1":
        print(f"ALERT suppressed (RD_NO_ALERT=1): {text}", flush=True)
        return EXIT_PREFLIGHT
    try:
        if send is None:
            sys.path.insert(0, str(HERE))
            import nb_soak  # noqa: E402 -- the copy beside this file, the soak's own alert path
            send = nb_soak.send
        send([("drill:preflight", text)], (os.environ.get("NB_SOAK_DISCORD_WEBHOOK") or "").strip())
        print("ALERT sent", flush=True)
    except Exception as e:  # noqa: BLE001 -- the log line above is the floor; say the alert failed
        print(f"ALERT NOT sent: {type(e).__name__}: {e}", flush=True)
    return EXIT_PREFLIGHT


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--ref", default="origin/master")
    ap.add_argument("--drills", default=None, help="the soak's drill folder (NB_SOAK_DRILLS)")
    ap.add_argument("--fail", default=None, metavar="WHY", help="skip the checks; report WHY")
    a = ap.parse_args(argv)
    repo, drills = Path(a.repo), (Path(a.drills) if a.drills else None)
    why = a.fail or check(repo, a.ref)
    if why:
        return fail(why, drills)
    print(f"PREFLIGHT OK: {repo} {describe(repo, a.ref)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
