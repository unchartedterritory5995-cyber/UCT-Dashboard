#!/usr/bin/env python3
"""Reduce a ci_cost_report snapshot to the measured inputs tools/ci_cost_model.py reads. Stdlib only.

  python tools/ci_cost_measure.py --nov nov.json --oct oct.json --out docs/ci/ci-cost-inputs.json

Also replays PR #877's path filter against `agent ci` pushes made before it, from local git, because the
minutes since the merge are far too few to measure its effect directly. The replay reads each head
commit's own diff: a multi-commit push is judged on its tip only, which undercounts matches, so the replay's
skip rate is an upper bound.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import fnmatch
import json
import pathlib
import statistics
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_cost_gates as gates  # noqa: E402
import ci_cost_report as ccr  # noqa: E402

CHANGE_877 = ccr.parse_day("2026-11-06T03:30:00Z")
GATE = "master deploy gate"
AGENT = "agent ci"
HEAVY = {AGENT, GATE, "full suite (report-only)", "promote to production", "agent ci benchmark"}
MUST_STAY_HOSTED = {"vite build args", "OCR Linux version cert", "indicators security suite", "Joystick device suite"}
POST_LEG_AFTER_MIN = 3  # estimate: checkout, Python and the baseline lock are all that leg keeps after #877


def per_run(snapshot: dict) -> dict:
    """Mean billed minutes per run, by workflow|event, for completed runs with job data."""
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    bucket: dict[str, list[int]] = collections.defaultdict(list)
    for run_id, jobs in snapshot["jobs_by_run"].items():
        run = runs.get(run_id)
        if run is None or run.get("status") != "completed":
            continue
        bucket[f"{run['name']}|{run['event']}|{run.get('conclusion')}"].append(
            sum(ccr.billed_minutes(job) for job in jobs))
    return {key: {"n": len(val), "mean": statistics.fmean(val)} for key, val in sorted(bucket.items())}


def gate_shape(snapshot: dict, since: dt.datetime) -> dict:
    """What one successful master gate run costs, job by job."""
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    rows: dict[str, list[int]] = collections.defaultdict(list)
    totals = []
    for run_id, jobs in snapshot["jobs_by_run"].items():
        run = runs.get(run_id)
        if not run or run["name"] != GATE or run.get("conclusion") != "success":
            continue
        if (ccr.parse_ts(run["created_at"]) or since) < since:
            continue
        for job in jobs:
            minutes = ccr.billed_minutes(job)
            if minutes:
                rows[ccr.job_family(job["name"])].append(minutes)
        totals.append(sum(ccr.billed_minutes(job) for job in jobs))
    return {
        "runs": len(totals),
        "total_mean": statistics.fmean(totals) if totals else 0,
        "total_p50": statistics.median(totals) if totals else 0,
        "jobs": {key: {"mean": statistics.fmean(val), "n": len(val)} for key, val in rows.items()},
    }


def daily(snapshot: dict) -> dict:
    """Billed minutes and run counts by day, split into the buckets the model prices."""
    result = ccr.analyze(snapshot)
    factors = ccr.scale_factors(snapshot)
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    days: dict[str, dict] = collections.defaultdict(lambda: collections.defaultdict(float))
    for run in runs.values():
        day = (run.get("created_at") or "")[:10]
        days[day][f"runs:{bucket_of(run['name'])}"] += 1
    for run_id, jobs in snapshot["jobs_by_run"].items():
        run = runs.get(run_id)
        if run is None:
            continue
        day = (run.get("created_at") or "")[:10]
        factor = factors.get(ccr.stratum(run), 1.0)
        days[day][f"min:{bucket_of(run['name'])}"] += sum(ccr.billed_minutes(job) for job in jobs) * factor
    return {"days": {key: dict(val) for key, val in sorted(days.items())}, "total_usd": result["total_usd"]}


def bucket_of(name: str) -> str:
    if name == GATE:
        return "gate"
    if name == AGENT:
        return "agent"
    if name == "promote to production":
        return "promote"
    if name in HEAVY:
        return "other_heavy"
    return "rails"


def spend_until(snapshot: dict, stop: dt.datetime) -> dict:
    """Cumulative estimate up to the budget stop, the one external anchor we have."""
    result = ccr.analyze(snapshot, now=stop)
    usd = sum(usd for at, _, usd in result["points"] if at <= stop)
    minutes = sum(mins for at, mins, _ in result["points"] if at <= stop)
    return {"usd": usd, "minutes": minutes}


def first_stop(snapshot: dict) -> str | None:
    stops = []
    for jobs in snapshot["jobs_by_run"].values():
        for job in jobs:
            if job.get("conclusion") == "failure" and not ccr.was_billable(job) and not job.get("steps"):
                if job.get("completed_at"):
                    stops.append(job["completed_at"])
    return min(stops) if stops else None


def gate_arrivals(snapshot: dict, day: str) -> list[float]:
    """Hours after midnight UTC at which gate runs were created on `day`."""
    out = []
    for run in snapshot["runs"]:
        if run["name"] == GATE and (run.get("created_at") or "").startswith(day):
            at = ccr.parse_ts(run["created_at"])
            assert at is not None
            out.append(at.hour + at.minute / 60 + at.second / 3600)
    return sorted(out)


def workflow_paths(root: pathlib.Path) -> list[str]:
    """The push `paths:` list from agent-ci.yml, read as text so this stays stdlib only."""
    text = (root / ".github" / "workflows" / "agent-ci.yml").read_text(encoding="utf-8")
    block = text.split("  push:", 1)[1].split("  pull_request:", 1)[0]
    return [line.strip()[3:-1] for line in block.splitlines() if line.strip().startswith("- '")]


def matches(path: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if pattern.endswith("/**"):
            if path.startswith(pattern[:-2]):
                return True
        elif fnmatch.fnmatchcase(path, pattern) and "/" not in path[len(pattern.rstrip("*")):]:
            return True
    return False


def replay_filter(snapshot: dict, root: pathlib.Path) -> dict:
    """Of the pre-#877 agent ci pushes, how many would the new path filter have skipped?"""
    patterns = workflow_paths(root)
    verdict = {"ran": 0, "skipped": 0, "unknown": 0}
    seen: dict[str, bool | None] = {}
    for run in snapshot["runs"]:
        if run["name"] != AGENT or run["event"] != "push":
            continue
        at = ccr.parse_ts(run["created_at"])
        if at is None or at >= CHANGE_877:
            continue
        sha = run["head_sha"]
        if sha not in seen:
            proc = subprocess.run(["git", "-C", str(root), "show", "--name-only", "--format=", "-m", "--first-parent", sha],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace")
            files = [line for line in proc.stdout.splitlines() if line.strip()]
            seen[sha] = None if proc.returncode else any(matches(path, patterns) for path in files)
        hit = seen[sha]
        verdict["unknown" if hit is None else ("ran" if hit else "skipped")] += 1
    known = verdict["ran"] + verdict["skipped"]
    verdict["skip_rate_upper_bound"] = verdict["skipped"] / known if known else 0.0
    return verdict


def superseded_share(snapshot: dict, window_min: float = 3.0) -> dict:
    """Share of pre-#877 rail PR minutes on runs a newer push to the same branch overtook within `window_min`,
    i.e. runs the new cancel rule would have stopped. The model gives them half their minutes back."""
    groups: dict[tuple, list[dict]] = collections.defaultdict(list)
    for run in snapshot["runs"]:
        if run["event"] == "pull_request" and bucket_of(run["name"]) == "rails":
            at = ccr.parse_ts(run["created_at"])
            if at is not None and at < CHANGE_877:
                groups[(run["name"], run["head_branch"])].append(run)
    overtaken = total = 0
    for rows in groups.values():
        rows.sort(key=lambda r: r["created_at"])
        for first, second in zip(rows, rows[1:]):
            gap = (ccr.parse_ts(second["created_at"]) - ccr.parse_ts(first["created_at"])).total_seconds() / 60
            total += 1
            if first["head_sha"] != second["head_sha"] and gap < window_min:
                overtaken += 1
        total += 1
    return {"overtaken": overtaken, "total": total, "share": overtaken / total if total else 0.0}


def post_leg_share(snapshot: dict) -> dict:
    """Share of agent ci minutes spent on the capreg `post` leg #877 cut down to its Python rail."""
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    legs = []
    agent = 0
    for run_id, jobs in snapshot["jobs_by_run"].items():
        run = runs.get(run_id)
        if not run or run["name"] != AGENT:
            continue
        for job in jobs:
            minutes = ccr.billed_minutes(job)
            agent += minutes
            if "@ post" in (job.get("name") or "") and minutes:
                legs.append(minutes)
    kept = POST_LEG_AFTER_MIN * len(legs)
    return {"legs": len(legs), "mean_min": statistics.fmean(legs) if legs else 0.0,
            "share_removed": (sum(legs) - kept) / agent if agent else 0.0}


def rails_split(snapshot: dict, day: str) -> dict:
    """One day's rail minutes by event: a PR run is the one a move off hosted could remove."""
    factors = ccr.scale_factors(snapshot)
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    minutes: dict[str, float] = collections.defaultdict(float)
    workflows: dict[str, float] = collections.defaultdict(float)
    must_stay = 0.0
    master: dict[str, float] = collections.defaultdict(float)
    for run_id, jobs in snapshot["jobs_by_run"].items():
        run = runs.get(run_id)
        if not run or bucket_of(run["name"]) != "rails" or not (run.get("created_at") or "").startswith(day):
            continue
        spent = sum(ccr.billed_minutes(job) for job in jobs) * factors.get(ccr.stratum(run), 1.0)
        minutes[run["event"]] += spent
        workflows[run["name"]] += spent
        if run["event"] == "push":
            master[run["name"]] += spent
        if run["event"] != "pull_request" and run["name"] in MUST_STAY_HOSTED:
            must_stay += spent
    return {"by_event": dict(minutes), "by_workflow": dict(sorted(workflows.items(), key=lambda kv: -kv[1])),
            "must_stay_min": must_stay, "master_by_workflow": dict(master)}


def gate_kinds(snapshot: dict, root: pathlib.Path) -> dict:
    """Gate runs by day and kind, the Nov 5 arrivals with their kinds, and Agent pushes per Agent merge."""
    rows = gates.gate_runs(snapshot, str(root))
    by_day: dict[str, dict] = collections.defaultdict(lambda: collections.defaultdict(int))
    for row in rows:
        by_day[row["created_at"][:10]][row["kind"]] += 1
    arrivals = []
    every: dict[str, list] = collections.defaultdict(list)
    for row in rows:
        at = ccr.parse_ts(row["created_at"])
        assert at is not None
        hour = at.hour + at.minute / 60 + at.second / 3600
        every[row["created_at"][:10]].append([hour, row["kind"]])
        if row["created_at"].startswith("2026-11-05"):
            arrivals.append([hour, row["kind"]])
    return {"by_day": {day: dict(val) for day, val in sorted(by_day.items())}, "nov5_arrivals": arrivals,
            "arrivals_by_day": dict(sorted(every.items()))}


def wall_minutes(snapshot: dict) -> dict:
    """Median wall time, run start to last update, for successful runs: what a merge or promotion waits for."""
    out: dict[str, list[float]] = collections.defaultdict(list)
    for run in snapshot["runs"]:
        if run.get("conclusion") != "success" or run["name"] not in (GATE, AGENT, "promote to production"):
            continue
        start, end = ccr.parse_ts(run.get("run_started_at")), ccr.parse_ts(run.get("updated_at"))
        if start and end:
            out[f"{run['name']}|{run['event']}"].append((end - start).total_seconds() / 60)
    return {key: {"n": len(val), "p50": statistics.median(val), "p90": sorted(val)[int(len(val) * 0.9)]}
            for key, val in out.items()}


def post_change(snapshot: dict) -> dict:
    """The actual runs after 03:30Z Nov 6. Reported, never extrapolated to a month."""
    out: dict[str, dict] = collections.defaultdict(lambda: {"runs": 0, "minutes": 0, "with_jobs": 0})
    runs = {str(run["id"]): run for run in snapshot["runs"]}
    last = None
    for run in runs.values():
        at = ccr.parse_ts(run["created_at"])
        if at is None or at < CHANGE_877:
            continue
        last = max(last, at) if last else at
        row = out[run["name"]]
        row["runs"] += 1
        jobs = snapshot["jobs_by_run"].get(str(run["id"]))
        if jobs is not None:
            row["with_jobs"] += 1
            row["minutes"] += sum(ccr.billed_minutes(job) for job in jobs)
    hours = (last - CHANGE_877).total_seconds() / 3600 if last else 0.0
    return {"hours": hours, "by_workflow": dict(out)}


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--nov", required=True)
    parser.add_argument("--oct", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repo-root", default=str(pathlib.Path(__file__).resolve().parents[1]))
    parser.add_argument("--stop", help="first budget stop instant; default the earliest stopped job")
    parser.add_argument("--post", help="census snapshot from the #877 cutoff, with artifact totals")
    parser.add_argument("--steps", help="output of tools/ci_cost_steps.py")
    parser.add_argument("--setup", help="output of tools/ci_cost_setup.py")
    args = parser.parse_args()
    with open(args.nov, encoding="utf-8") as handle:
        nov = json.load(handle)
    with open(args.oct, encoding="utf-8") as handle:
        oct_snapshot = json.load(handle)
    post = nov
    if args.post:
        with open(args.post, encoding="utf-8") as handle:
            post = json.load(handle)
    stop_text = args.stop or first_stop(nov)
    stop = ccr.parse_day(stop_text) if stop_text else None
    out = {
        "first_budget_stop": stop_text,
        "spend_to_stop": spend_until(nov, stop) if stop else None,
        "nov": daily(nov),
        "oct": daily(oct_snapshot),
        "per_run_nov": per_run(nov),
        "gate_shape": gate_shape(nov, ccr.parse_day("2026-11-05")),
        "filter_replay": replay_filter(nov, pathlib.Path(args.repo_root)),
        "post_877": post_change(post),
        "superseded": superseded_share(nov),
        "rails_nov5": rails_split(nov, "2026-11-05"),
        "gate_kinds": gate_kinds(nov, pathlib.Path(args.repo_root)),
        "wall": wall_minutes(nov),
        "post_leg": post_leg_share(nov),
        "gate_arrivals_nov5": gate_arrivals(nov, "2026-11-05"),
        "storage": post.get("storage"),
        "artifact_month_usd": ccr.artifact_month_usd(post.get("storage") or {}),
    }
    if args.setup:
        with open(args.setup, encoding="utf-8") as handle:
            out["setup"] = json.load(handle)
    if args.steps:
        with open(args.steps, encoding="utf-8") as handle:
            out["steps"] = json.load(handle)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(out, handle, indent=1)
        handle.write("\n")
    print(json.dumps({key: out[key] for key in ("first_budget_stop", "spend_to_stop", "filter_replay", "post_877",
                                                "superseded", "post_leg")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
