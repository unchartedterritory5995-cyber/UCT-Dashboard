"""Hosted checks on the self-hosted lane. Runs on GitHub-hosted runners only.

A job on an offline runner does not fail: it stays queued for up to 24 hours, and `timeout-minutes` does not count
queue time. Left alone that holds the serial `master-deploy` queue for a day.

    python3 tools/ci_queue_watch.py online --label uct-vps
        One-shot, for a step inside the gate. Asks once and exits; it never waits. Needs CI_RUNNER_READ_TOKEN, because
        GITHUB_TOKEN cannot read runners.

    python3 tools/ci_queue_watch.py watch --labels uct-vps --minutes 45 --cancel-workflow "master deploy gate"
        For a scheduled hosted job. Reports every job on those labels queued that long, and cancels the run if its
        workflow is named by --cancel-workflow, so the run concludes and its verdict goes red. Writes nothing else.
        Promotion is refused as a target in code, whatever the arguments say. Needs GH_TOKEN with `actions: write`.

Exit 0 proved, 1 not proved. An API error or a missing token is exit 1, never a pass.
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


def online_runners(doc: dict, label: str) -> list:
    if not isinstance(doc.get("runners"), list):
        raise Unproved("the runners API returned no runner list")
    out = []
    for r in doc["runners"]:
        labels = {x.get("name") for x in r.get("labels") or []}
        if label in labels and r.get("status") == "online":
            out.append(r.get("name"))
    return out


def check_online(*, repo: str, label: str, token: str, get=fetch) -> list:
    """Exactly one API call. Online runners for `label`, or Unproved."""
    if not token:
        raise Unproved("CI_RUNNER_READ_TOKEN is not set, so nothing can prove a runner is online")
    names = online_runners(get(f"{API}/repos/{repo}/actions/runners?per_page=100", token), label)
    if not names:
        raise Unproved(f"no runner labelled {label} is online, so this gate's heavy jobs would sit queued")
    return names


def _age_minutes(stamp: str, now: dt.datetime) -> float:
    return (now - dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds() / 60


def stale_jobs(runs: list, jobs_for, labels: set, minutes: float, now: dt.datetime) -> list:
    """`(run, job name, minutes queued)` for every job on these labels queued for at least `minutes`."""
    stale = []
    for run in runs:
        for job in jobs_for(run["id"]):
            if job.get("status") in ("queued", "waiting", "pending") and labels & set(job.get("labels") or []):
                age = _age_minutes(job.get("created_at") or run["created_at"], now)
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
    o = sub.add_parser("online")
    o.add_argument("--label", required=True)
    w = sub.add_parser("watch")
    w.add_argument("--labels", required=True)
    w.add_argument("--minutes", type=float, default=45)
    w.add_argument("--cancel-workflow", action="append", default=[])
    for s in (o, w):
        s.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    a = p.parse_args(argv)
    try:
        if not a.repo:
            raise Unproved("no repository given")
        if a.mode == "online":
            names = check_online(repo=a.repo, label=a.label, token=os.environ.get("CI_RUNNER_READ_TOKEN", ""))
            print(f"runner check: {len(names)} runner(s) labelled {a.label} online")
            return 0
        out = watch(repo=a.repo, labels=set(a.labels.split(",")), minutes=a.minutes, cancel=set(a.cancel_workflow),
                    token=os.environ.get("GH_TOKEN", ""))
        for run, job, age in out["stale"]:
            action = "cancelled" if run["id"] in out["cancelled"] else "not cancelled"
            print(f"::error title=Self-hosted job stuck in queue::{job} in {run.get('name')} (run {run['id']}) queued "
                  f"{age} min; run {action}. Is the runner up? See infra/ci-runner/AUDIT-NOTES.md, 'Outage'.")
        print(f"queue watch: {len(out['stale'])} job(s) stuck, {len(out['cancelled'])} run(s) cancelled")
        return 1 if out["stale"] else 0
    except (Unproved, urllib.error.URLError, ValueError, OSError) as err:
        print(f"::error title=Runner check not proved::{err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
