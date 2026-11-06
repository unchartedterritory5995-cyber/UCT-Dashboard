"""Hosted checks that a self-hosted lane is really there. Runs on GitHub-hosted runners only.

A job on an offline runner does not fail, it stays queued for up to 24 hours, and `timeout-minutes` does not
count queue time. Left alone that holds the serial `master-deploy` queue for a day. Two modes close that:

    python3 tools/ci_runner_watchdog.py gate --label uct-vps --minutes 10
        Passes once a runner carrying the label is online; fails with a clear message if none appears in
        time. Needs CI_RUNNER_READ_TOKEN: GITHUB_TOKEN cannot read runners (the API wants Administration: read).

    python3 tools/ci_runner_watchdog.py queue --labels uct-vps,uct-pc --minutes 30
        Fails if any job for those labels has been queued that long. Uses GH_TOKEN (`actions: read`) only.

Exit 0 proved, 1 not proved. There is no third state: an API error or a missing token is exit 1, never a pass.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"


class Unproved(Exception):
    """The check could not establish what it exists to establish."""


def fetch(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}",
                                               "Accept": "application/vnd.github+json",
                                               "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def online_runners(doc: dict, label: str) -> list:
    if not isinstance(doc.get("runners"), list):
        raise Unproved("the runners API returned no runner list")
    out = []
    for r in doc["runners"]:
        labels = {x.get("name") for x in r.get("labels") or []}
        if label in labels and r.get("status") == "online":
            out.append(r.get("name"))
    return out


def wait_for_runner(*, repo: str, label: str, minutes: float, token: str, get=fetch, sleep=time.sleep,
                    clock=time.monotonic, poll_s: int = 20) -> list:
    """The online runners for `label`, or Unproved at the deadline. An API error retries until the deadline, then
    fails: a transient blip must not turn a gate red, and a permanent one must not turn it green."""
    if not token:
        raise Unproved("CI_RUNNER_READ_TOKEN is not set, so nothing can prove a runner is online")
    deadline = clock() + minutes * 60
    last_error = None
    while True:
        try:
            names = online_runners(get(f"{API}/repos/{repo}/actions/runners?per_page=100", token), label)
            if names:
                return names
            last_error = None
        except (urllib.error.URLError, ValueError, Unproved, OSError) as err:
            last_error = f"{type(err).__name__}: {err}"
        if clock() >= deadline:
            detail = f" Last API error: {last_error}." if last_error else ""
            raise Unproved(f"no runner labelled {label} came online within {minutes:g} minutes.{detail} "
                           "The heavy jobs would sit queued, so this gate fails instead.")
        sleep(poll_s)


def _age_minutes(stamp: str, now: dt.datetime) -> float:
    return (now - dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds() / 60


def stale_jobs(runs: list, jobs_for, labels: set, minutes: float, now: dt.datetime) -> list:
    """`(job name, run id, minutes queued)` for every job on these labels queued for at least `minutes`."""
    stale = []
    for run in runs:
        for job in jobs_for(run["id"]):
            if job.get("status") in ("queued", "waiting", "pending") and labels & set(job.get("labels") or []):
                age = _age_minutes(job.get("created_at") or run["created_at"], now)
                if age >= minutes:
                    stale.append((job.get("name"), run["id"], round(age)))
    return stale


def queue_check(*, repo: str, labels: set, minutes: float, token: str, get=fetch, now=None) -> list:
    if not token:
        raise Unproved("GH_TOKEN is not set")
    now = now or dt.datetime.now(dt.timezone.utc)
    runs = []
    for status in ("queued", "in_progress", "waiting", "pending"):
        doc = get(f"{API}/repos/{repo}/actions/runs?status={status}&per_page=100", token)
        if not isinstance(doc.get("workflow_runs"), list):
            raise Unproved("the runs API returned no run list")
        runs += doc["workflow_runs"]

    def jobs_for(run_id):
        doc = get(f"{API}/repos/{repo}/actions/runs/{run_id}/jobs?per_page=100", token)
        if not isinstance(doc.get("jobs"), list):
            raise Unproved("the jobs API returned no job list")
        return doc["jobs"]

    seen, unique = set(), []
    for r in runs:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    return stale_jobs(unique, jobs_for, labels, minutes, now)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    g = sub.add_parser("gate")
    g.add_argument("--label", required=True)
    g.add_argument("--minutes", type=float, default=10)
    q = sub.add_parser("queue")
    q.add_argument("--labels", required=True)
    q.add_argument("--minutes", type=float, default=30)
    for s in (g, q):
        s.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    a = p.parse_args(argv)
    try:
        if not a.repo:
            raise Unproved("no repository given")
        if a.mode == "gate":
            names = wait_for_runner(repo=a.repo, label=a.label, minutes=a.minutes,
                                    token=os.environ.get("CI_RUNNER_READ_TOKEN", ""))
            print(f"runner watchdog: {len(names)} runner(s) labelled {a.label} online")
            return 0
        stale = queue_check(repo=a.repo, labels=set(a.labels.split(",")), minutes=a.minutes,
                            token=os.environ.get("GH_TOKEN", ""))
        for name, run_id, age in stale:
            print(f"::error title=Self-hosted job stuck in queue::{name} (run {run_id}) has been queued {age} min. "
                  "Is the runner up? See infra/ci-runner/AUDIT-NOTES.md, 'Outage'.")
        print(f"queue watch: {len(stale)} job(s) queued at least {a.minutes:g} min on {a.labels}")
        return 1 if stale else 0
    except (Unproved, urllib.error.URLError, ValueError, OSError) as err:
        print(f"::error title=Runner check not proved::{err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
