"""Where the GitHub Actions queue goes: runner minutes, waste and waiting, per workflow. READ-ONLY.

    python tools/ci_queue_report.py --hours 3
    python tools/ci_queue_report.py --since 2026-11-16T20:06:00Z --until 2026-11-16T23:06:00Z

WHY (2026-11-16). The account runs 40 jobs at once, shared by every session, first come first served. That
afternoon the 40 slots were full for three hours with 50-130 jobs waiting, and nobody could say what the
queue was waiting on: the Actions page lists runs, not what fills the slots. This prints, for a window:

  * per workflow: runs, jobs, RUNNER MINUTES and their share, the minutes spent in runs a newer push then
    cancelled, and how long a job waited for a runner (median / p90 / max);
  * a timeline: jobs running and jobs waiting, per 10 minutes (running pinned at the cap = saturated).

HOW IT STAYS CHEAP. The REST budget (5,000 requests an hour) is ONE budget for every session on the account,
and a job list costs one request per run. So each workflow is SAMPLED first; only a workflow with a sampled
run of 3 or more jobs is read in full, and a single-job workflow is scaled up from its sample (its row is
marked `~`). A run still in flight counts its minutes up to now. Refuses to start when the budget left is
under what it needs plus a margin. Needs `gh` logged in. Standard library only.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import random
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor


def _this_repo(fallback: str) -> str:
    """owner/name of this repository: $GITHUB_REPOSITORY in Actions, else this checkout's origin remote.

    Derived, never hardcoded, so moving the repository to another owner needs no edit here. `fallback`
    is used only when neither answers (no git, no origin)."""
    env = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if env:
        return env
    try:
        url = subprocess.run(["git", "-C", str(pathlib.Path(__file__).resolve().parent), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        url = ""
    m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else fallback


REPO = _this_repo("unchartedterritory5995-cyber/UCT-Dashboard")
SAMPLE = 8                 # runs read per workflow before deciding whether to read it in full
FULL_AT = 3                # a workflow with a sampled run of this many jobs is read in full
BUDGET_MARGIN = 1000       # requests left for every other session after this run
F = "%Y-%m-%dT%H:%M:%SZ"


def ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def family(name: str) -> str:
    """`remote tests: <session> <ref>` is one workflow, whatever follows the colon."""
    return name.split(":", 1)[0].strip()


def job_records(run: dict, jobs: list, weight: float, now: dt.datetime) -> list:
    """One record per job that was meant to run. `started` is None while it still waits for a runner."""
    out = []
    for j in jobs:
        if j.get("conclusion") == "skipped":
            continue
        waiting = j.get("status") == "queued" or not j.get("started_at")
        out.append({"family": family(run["name"]), "weight": weight, "created": ts(j["created_at"]),
                    "started": None if waiting else ts(j["started_at"]),
                    "ended": None if waiting else (ts(j["completed_at"]) if j.get("completed_at") else now),
                    "cancelled_run": run.get("conclusion") == "cancelled"})
    return out


def summarize(records: list, now: dt.datetime) -> list:
    """Rows per workflow, largest share of runner minutes first."""
    acc = collections.defaultdict(lambda: {"jobs": 0.0, "minutes": 0.0, "cancelled": 0.0, "waits": []})
    for r in records:
        a = acc[r["family"]]
        a["jobs"] += r["weight"]
        if r["started"] is None:
            a["waits"].append((now - r["created"]).total_seconds() / 60)
            continue
        a["waits"].append(max(0.0, (r["started"] - r["created"]).total_seconds() / 60))
        minutes = (r["ended"] - r["started"]).total_seconds() / 60 * r["weight"]
        a["minutes"] += minutes
        if r["cancelled_run"]:
            a["cancelled"] += minutes
    total = sum(a["minutes"] for a in acc.values()) or 1.0
    rows = []
    for fam, a in acc.items():
        w = sorted(a["waits"])
        rows.append({"family": fam, "jobs": a["jobs"], "minutes": a["minutes"], "share": a["minutes"] / total,
                     "cancelled": a["cancelled"], "wait_p50": w[len(w) // 2], "wait_p90": w[int(len(w) * 0.9)],
                     "wait_max": w[-1]})
    return sorted(rows, key=lambda r: -r["minutes"])


def timeline(records: list, start: dt.datetime, end: dt.datetime, step_min: int = 10) -> list:
    """[(bucket start, mean jobs running, mean jobs waiting)], sampled once a minute."""
    out, t = [], start
    while t < end:
        running, waiting, n = 0.0, 0.0, 0
        for k in range(step_min):
            u = t + dt.timedelta(minutes=k)
            if u >= end:
                break
            n += 1
            for r in records:
                if r["created"] > u:
                    continue
                if r["started"] is None or u < r["started"]:
                    waiting += r["weight"]
                elif u < r["ended"]:
                    running += r["weight"]
        out.append((t, running / max(n, 1), waiting / max(n, 1)))
        t += dt.timedelta(minutes=step_min)
    return out


def self_check() -> int:
    """The arithmetic can tell a saturated window from an idle one, and a sample is scaled, not dropped."""
    t0 = ts("2026-01-01T00:00:00Z")
    m = lambda k: t0 + dt.timedelta(minutes=k)   # noqa: E731
    rec = lambda fam, c, s, e, w=1.0, x=False: {"family": fam, "weight": w, "created": m(c),   # noqa: E731
                                                  "started": None if s is None else m(s),
                                                  "ended": None if e is None else m(e), "cancelled_run": x}
    recs = [rec("heavy", 0, 5, 15), rec("heavy", 0, 0, 30, x=True), rec("light", 0, 1, 2, w=10.0), rec("heavy", 20, None, None)]
    rows = {r["family"]: r for r in summarize(recs, m(40))}
    ok = [abs(rows["heavy"]["minutes"] - 40) < 1e-9, abs(rows["heavy"]["cancelled"] - 30) < 1e-9,
          abs(rows["light"]["minutes"] - 10) < 1e-9, abs(rows["light"]["jobs"] - 10) < 1e-9,
          abs(rows["heavy"]["share"] - 0.8) < 1e-9, rows["heavy"]["wait_max"] == 20,       # the job still waiting
          timeline(recs, m(0), m(10))[0][1] > 1.0, timeline(recs, m(30), m(40))[0][1] == 0.0,
          timeline(recs, m(30), m(40))[0][2] == 1.0]
    print("self-check:", "PASS" if all(ok) else f"FAIL {ok}")
    return 0 if all(ok) else 1


def gh(path: str) -> dict:
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(f"gh api {path} failed: {r.stderr.strip()[:300]}")
    return json.loads(r.stdout)


def list_runs(repo: str, a: dt.datetime, b: dt.datetime) -> list:
    """Every run created in [a, b]. The API answers at most 1,000 per query, so a busy window is halved."""
    q = f"{a.strftime(F)}..{b.strftime(F)}"
    first = gh(f"repos/{repo}/actions/runs?created={q}&per_page=100&page=1")
    n = first.get("total_count", 0)
    if n > 1000 and (b - a).total_seconds() > 120:
        mid = a + (b - a) / 2
        return list_runs(repo, a, mid) + list_runs(repo, mid + dt.timedelta(seconds=1), b)
    runs, page = first.get("workflow_runs", []), 1
    while len(runs) < min(n, 1000):
        page += 1
        more = gh(f"repos/{repo}/actions/runs?created={q}&per_page=100&page={page}").get("workflow_runs", [])
        if not more:
            break
        runs += more
    return runs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--hours", type=float, default=3.0)
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    now = dt.datetime.now(dt.timezone.utc)
    end = ts(a.until) if a.until else now
    start = ts(a.since) if a.since else end - dt.timedelta(hours=a.hours)
    runs = [r for r in list_runs(a.repo, start, end) if r.get("conclusion") != "skipped"]
    if not runs:
        print("no runs in the window")
        return 0
    by = collections.defaultdict(list)
    for r in runs:
        by[family(r["name"])].append(r)
    left = gh("rate_limit")["resources"]["core"]["remaining"]
    worst = len(runs)                                  # the upper bound: every workflow read in full
    if left < worst + BUDGET_MARGIN:
        print(f"REFUSED: {left} API requests left this hour; this report may need {worst} and leaves "
              f"{BUDGET_MARGIN} for the other sessions. Try again after the hourly reset, or a shorter window.")
        return 2

    def jobs_of(run):
        return run, gh(f"repos/{a.repo}/actions/runs/{run['id']}/jobs?per_page=100&filter=all").get("jobs", [])

    rng = random.Random(7)
    records, scaled = [], set()
    with ThreadPoolExecutor(6) as ex:
        for fam, fruns in by.items():
            sample = rng.sample(fruns, min(SAMPLE, len(fruns)))
            got = list(ex.map(jobs_of, sample))
            # the LARGEST sampled run decides: a gate superseded while pending has no jobs at all, and a mean
            # over a sample full of those would scale a 14-job workflow as if it were a one-job one
            most_jobs = max((len(j) for _, j in got), default=0)
            rest = [r for r in fruns if r not in sample]
            if rest and most_jobs >= FULL_AT:
                got += list(ex.map(jobs_of, rest))
                weight = 1.0
            else:
                weight = len(fruns) / len(sample)
                if weight > 1:
                    scaled.add(fam)
            for run, jobs in got:
                records += job_records(run, jobs, weight, now)
    rows = summarize(records, now)
    total = sum(r["minutes"] for r in rows)
    span = (end - start).total_seconds() / 60
    print(f"{a.repo}  {start.strftime(F)} .. {end.strftime(F)}  ({len(runs)} runs, {len(by)} workflows)")
    print(f"{'workflow':34} {'runs':>5} {'jobs':>6} {'runner-min':>10} {'share':>6} {'cancelled':>9} {'wait p50':>8} {'p90':>6} {'max':>6}")
    for r in rows:
        mark = "~" if r["family"] in scaled else " "
        print(f"{r['family'][:33]:33}{mark} {len(by[r['family']]):5} {r['jobs']:6.0f} {r['minutes']:10.0f} {100 * r['share']:5.0f}% "
              f"{r['cancelled']:9.0f} {r['wait_p50']:8.1f} {r['wait_p90']:6.1f} {r['wait_max']:6.1f}")
    cancelled = sum(r["cancelled"] for r in rows)
    print(f"total {total:.0f} runner-minutes in {span:.0f} minutes = {total / span:.1f} jobs running on average; "
          f"{cancelled:.0f} ({100 * cancelled / max(total, 1):.0f}%) in runs a newer push cancelled")
    print("(~ = scaled from a sample of %d runs; waits are minutes from job created to runner started)" % SAMPLE)
    print(f"\n{'from':>6} {'running':>8} {'waiting':>8}   (10-minute means; running pinned at the account's job cap = saturated."
          " The first rows read LOW: a job created before the window is not in it)")
    for t, running, waiting in timeline(records, start, end):
        print(f"{t.strftime('%H:%M'):>6} {running:8.1f} {waiting:8.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
