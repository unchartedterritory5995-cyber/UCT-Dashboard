"""Should this scheduled full-suite run go ahead, or has today's already happened? (R4, 2026-11-18)

WHY. The nightly full suite (`.github/workflows/full-suite-report.yml`) had ONE cron, 07:30 UTC, and
GitHub's scheduler did not keep it: measured over 11-12..11-17 the run was created 6.9 to 9.7 h late,
and on 11-18 none had been created by 12:46 UTC. One trigger a day, delivered late or not at all, is
not "at least daily". The workflow now has three crons, and this decides, as the run's first job,
whether a run is still owed:

  * a run that was NOT started by the clock (workflow_dispatch) always runs: a person asked for it;
  * a scheduled run is SKIPPED when a master record whose pytest shards actually ran was published
    on `ci-results` within the last LATCH_HOURS (it exits at once, ~10 s, no suite, no publish);
  * otherwise it runs.

⛔ A record whose plan failed (no shard ran: 11-16, 11-17) does NOT count as today's run, so the next
cron retries at the cost of one plan job. A run whose shards ran and failed DOES count: re-running a
suite that ran is the cost the latch exists to avoid.
⛔ No new permission: it reads `ci-results` with git, using the token the checkout already holds
(contents: read). The run in progress, if any, is ahead of this one in the workflow's concurrency
group, so by the time this job runs, that run has published and is seen here.

    python tools/full_suite_latch.py --event schedule --github-output "$GITHUB_OUTPUT"
    python tools/full_suite_latch.py --self-check
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys

OK, FAIL = 0, 1
#: a scheduled run is skipped when a master run that ran its shards published within this many hours.
#: Three crons ~6 h apart and a run of a few hours: a day is never skipped, and no day runs twice.
LATCH_HOURS = 20
#: how many of the newest ci-results commits (one per published record) are read.
LOOKBACK = 40
REF = "refs/remotes/origin/ci-results"
_SUBJECT = re.compile(r"^ci run (\d+) attempt (\d+) on (\S+) ")


def _parse(ts):
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except (TypeError, ValueError):
        return None


def decide(event: str, records: list, now: dt.datetime, hours: float = LATCH_HOURS) -> tuple:
    """(run?, why). `records`: [{"run", "branch", "finished", "shards_total"}], any order."""
    if event != "schedule":
        return True, "%s: not started by the clock, so it always runs" % (event or "no event")
    seen = []
    for r in records:
        at = _parse(r.get("finished"))
        if r.get("branch") != "master" or at is None:
            continue
        if not (r.get("shards_total") or 0) > 0:
            continue                       # the plan failed: nothing ran, so it is not today's run
        if now - at <= dt.timedelta(hours=hours):
            seen.append((at, r))
    if seen:
        at, r = max(seen, key=lambda x: x[0])
        return False, ("run %s (master, %s pytest shards ran) published %.1f h ago, inside %d h: "
                       "today's full run exists" % (r.get("run"), r.get("shards_total"),
                                                    (now - at).total_seconds() / 3600, hours))
    return True, "no master run that ran its pytest shards published in the last %d h" % hours


def _git(*args) -> str:
    p = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError("git %s failed: %s" % (" ".join(args[:3]), (p.stderr or p.stdout).strip()[:300]))
    return p.stdout


def records_from_git(fetch: bool = True, lookback: int = LOOKBACK) -> list:
    """The newest published master records, read from ci-results commit subjects + their summary.json."""
    if fetch:
        _git("fetch", "--quiet", "--no-tags", "--depth=%d" % lookback, "origin", "+refs/heads/ci-results:" + REF)
    out = []
    for line in _git("log", "-n", str(lookback), "--format=%s", REF).splitlines():
        m = _SUBJECT.match(line)
        if not m or m.group(3) != "master" or m.group(2) != "1":
            continue
        rid = m.group(1)
        try:
            s = json.loads(_git("show", "%s:results/%s/summary.json" % (REF, rid)))
        except (RuntimeError, ValueError):
            continue                       # an unreadable record is not evidence of a run
        out.append({"run": rid, "branch": s.get("branch"), "finished": s.get("finished"),
                    "shards_total": (s.get("pytest") or {}).get("shards_total") or 0})
    return out


def _self_check() -> int:
    now = _parse("2026-11-18T15:00:00Z")
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print("  %-66s -> %-6s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    ran = {"run": "1", "branch": "master", "finished": "2026-11-17T20:00:00Z", "shards_total": 33}
    show("a hand-dispatched run always runs", decide("workflow_dispatch", [ran], now)[0], True)
    show("no record at all -> run", decide("schedule", [], now)[0], True)
    show("a master run that ran its shards 19 h ago -> SKIP", decide("schedule", [ran], now)[0], False)
    old = dict(ran, finished="2026-11-17T18:00:00Z")
    show("  ...21 h ago -> run (the line is %d h)" % LATCH_HOURS, decide("schedule", [old], now)[0], True)
    planfail = dict(ran, shards_total=0)
    show("a record whose plan failed (no shard ran) does NOT count -> run",
         decide("schedule", [planfail], now)[0], True)
    feat = dict(ran, branch="feat/x")
    show("a record from another branch does not count -> run", decide("schedule", [feat], now)[0], True)
    show("an unreadable finish time does not count -> run",
         decide("schedule", [dict(ran, finished="garbage")], now)[0], True)
    show("the newest qualifying record is the one named",
         "run 1 " in decide("schedule", [old, ran], now)[1], True)
    show("a parse of the publisher's own subject line",
         bool(_SUBJECT.match("ci run 44131757008 attempt 1 on master (fbe013280903)")), True)
    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--event", default="")
    ap.add_argument("--github-output", help="append run=true|false here (the job's output)")
    ap.add_argument("--hours", type=float, default=LATCH_HOURS)
    ap.add_argument("--no-fetch", action="store_true", help="read the ci-results ref already present")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    now = dt.datetime.now(dt.timezone.utc)
    if a.event != "schedule":
        run, why = decide(a.event, [], now, a.hours)
    else:
        try:
            run, why = decide(a.event, records_from_git(fetch=not a.no_fetch), now, a.hours)
        except RuntimeError as e:
            # ⛔ Unreadable is not "already ran": a latch that cannot see must let the suite run.
            run, why = True, "ci-results could not be read (%s): running, the safe direction" % e
    print("full-suite latch: %s (%s)" % ("RUN" if run else "SKIP", why))
    if a.github_output:
        with open(a.github_output, "a", encoding="utf-8") as fh:
            fh.write("run=%s\n" % ("true" if run else "false"))
    return OK


if __name__ == "__main__":
    sys.exit(main())
