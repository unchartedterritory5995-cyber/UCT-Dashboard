"""A hosted watch on the self-hosted lanes. Runs on GitHub-hosted runners only.

A job on an offline runner does not fail: it stays queued for up to 24 hours, and `timeout-minutes` does not count
queue time. Left alone that holds the serial `master-deploy` queue for a day.

    python3 tools/ci_queue_watch.py watch --labels uct-vps-gate,uct-vps --minutes 45 --cancel-workflow "master deploy gate"

For a scheduled hosted job, with GH_TOKEN holding `actions: write`. It reports every stuck job, and cancels the run if its
workflow is named by --cancel-workflow, so the run concludes and its verdict goes red. It writes nothing else. Promotion is
refused as a target in code, whatever the arguments say.

STUCK means a job on a label has been queued that long AND nothing on that label moved in that time. So a job waiting behind
a busy, healthy runner is not stuck, and a healthy gate cannot be cancelled however long its queue: the label's own running
jobs reset the clock. It reads no runner state, deliberately (AUDIT Q2): a token that can read runners needs admin on the
repo. An offline runner shows up as this silence, and the output says so.

Exit 0 clear, 1 stuck or not proved. An API error or a missing token is exit 1, never a pass.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
#: Never cancelled, whatever a caller passes.
NEVER_CANCEL = {"promote to production"}


class Unproved(Exception):
    """The check could not establish what it exists to establish."""


def _request(method: str, url: str, token: str):
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


def fetch(url: str, token: str) -> dict:
    return _request("GET", url, token)


def post(url: str, token: str) -> dict:
    return _request("POST", url, token)


def _stamp(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def lane_activity(jobs: list, labels: set, now: dt.datetime) -> dict:
    """The last moment each label moved: now if a job is running on it, else its latest job start or finish."""
    latest: dict = {}
    for job in jobs:
        for label in labels & set(job.get("labels") or []):
            moments = [now] if job.get("status") == "in_progress" else []
            moments += [_stamp(job[k]) for k in ("started_at", "completed_at") if job.get(k)]
            if moments:
                latest[label] = max([*moments, *([latest[label]] if label in latest else [])])
    return latest


def stale_jobs(runs: list, jobs_for, labels: set, minutes: float, now: dt.datetime) -> list:
    """`(run, job name, minutes silent)` for each job queued at least `minutes` on a label that has not moved in as long."""
    jobs_by_run = [(run, jobs_for(run["id"])) for run in runs]
    activity = lane_activity([j for _, jobs in jobs_by_run for j in jobs], labels, now)
    stale = []
    for run, jobs in jobs_by_run:
        for job in jobs:
            on = labels & set(job.get("labels") or [])
            if job.get("status") not in ("queued", "waiting", "pending") or not on:
                continue
            since = [_stamp(job.get("created_at") or run["created_at"])] + [activity[x] for x in on if x in activity]
            age = (now - max(since)).total_seconds() / 60
            if age >= minutes:
                stale.append((run, job.get("name"), round(age)))
    return stale


def watch(*, repo: str, labels: set, minutes: float, cancel: set, token: str, get=fetch, send=post, now=None) -> dict:
    """`{"stale": [...], "cancelled": [run ids]}`. A run is cancelled at most once, and only if named."""
    if not token:
        raise Unproved("GH_TOKEN is not set")
    forbidden = cancel & NEVER_CANCEL
    if forbidden:
        raise Unproved(f"refusing to cancel {sorted(forbidden)}: this watcher never touches promotion")
    now = now or dt.datetime.now(dt.timezone.utc)
    runs, seen = [], set()
    for status in ("queued", "in_progress", "waiting", "pending"):
        doc = get(f"{API}/repos/{repo}/actions/runs?status={status}&per_page=100", token)
        if not isinstance(doc.get("workflow_runs"), list):
            raise Unproved("the runs API returned no run list")
        for run in doc["workflow_runs"]:
            if run["id"] not in seen:
                seen.add(run["id"])
                runs.append(run)

    def jobs_for(run_id):
        doc = get(f"{API}/repos/{repo}/actions/runs/{run_id}/jobs?per_page=100", token)
        if not isinstance(doc.get("jobs"), list):
            raise Unproved("the jobs API returned no job list")
        return doc["jobs"]

    stale = stale_jobs(runs, jobs_for, labels, minutes, now)
    cancelled = []
    for run, _, _ in stale:
        name = run.get("name")
        if name in cancel and name not in NEVER_CANCEL and run["id"] not in cancelled:
            send(f"{API}/repos/{repo}/actions/runs/{run['id']}/cancel", token)
            cancelled.append(run["id"])
    return {"stale": stale, "cancelled": cancelled}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    w = sub.add_parser("watch")
    w.add_argument("--labels", required=True)
    w.add_argument("--minutes", type=float, default=45)
    w.add_argument("--cancel-workflow", action="append", default=[])
    w.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    a = p.parse_args(argv)
    try:
        if not a.repo:
            raise Unproved("no repository given")
        out = watch(repo=a.repo, labels=set(a.labels.split(",")), minutes=a.minutes, cancel=set(a.cancel_workflow),
                    token=os.environ.get("GH_TOKEN", ""))
        for run, job, age in out["stale"]:
            action = "run cancelled" if run["id"] in out["cancelled"] else "run left alone"
            print(f"::error title=RUNNER LOOKS OFFLINE::{job} in {run.get('name')} (run {run['id']}) is queued and nothing on "
                  f"its label has moved for {age} min; {action}. See infra/ci-runner/AUDIT-NOTES.md, 'Outage'.")
        state = "RUNNER LOOKS OFFLINE" if out["stale"] else "no stuck job"
        print(f"queue watch: {state}: {len(out['stale'])} job(s) stuck, {len(out['cancelled'])} run(s) cancelled "
              f"(labels {a.labels}; runner state is inferred from the queue, not read)")
        return 1 if out["stale"] else 0
    except (Unproved, urllib.error.URLError, ValueError, OSError) as err:
        print(f"::error title=Queue watch not proved::{err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
