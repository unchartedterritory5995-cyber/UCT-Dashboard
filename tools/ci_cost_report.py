#!/usr/bin/env python3
"""GitHub Actions cost report for this repository. Stdlib only, read-only.

  python tools/ci_cost_report.py fetch  --since 2026-11-01 --out snap.json   # gh api GETs only
  python tools/ci_cost_report.py report --snapshot snap.json                 # offline from JSON
  python tools/ci_cost_report.py report --live --since 2026-11-01            # fetch, then report

WHAT THE NUMBERS ARE. These are ESTIMATES derived from job timestamps with GitHub's published rule
(each job rounds UP to a whole minute, priced by runner). They are not the invoice. The invoice lives
behind GET /users/{user}/settings/billing/usage, which needs the `user` token scope, so this tool does
not call it. To compare against the real figure run, once, in your own terminal:

  gh auth refresh -h github.com -s user && gh api /users/unchartedterritory5995-cyber/settings/billing/usage > usage.json
  python tools/ci_cost_report.py report --snapshot snap.json --billing usage.json

WHY NOT /actions/runs/{id}/timing. Its `billable` block returns total_ms 0 for every job (measured
2026-11-06), so it is unusable, and a report that summed it would say the bill is zero.

NOT BILLED, and excluded here: skipped jobs, and jobs that never got a runner (empty runner_name, zero
steps). The second group is what a budget hard stop looks like: the job fails in seconds with the
annotation "The job was not started because recent account payments have failed or your spending
limit needs to be increased". Measured on run 42145747733, 2026-11-06.

STORAGE. Artifacts are billed too ($0.25/GB-month over the plan's allowance) and count against the same
budget. `fetch --artifacts` sums them (one call per 100 artifacts). Cache is only billed if the repo's
cache limit was raised above the included 10 GB.

SAMPLED JOB DATA. `fetch --sample-every N` reads jobs for every Nth run in each stratum
(workflow|event|conclusion). `report` scales each stratum by runs_total / runs_sampled and labels the
result ESTIMATED. Workflows named with --census are always read in full.

The forecast is a run rate, not a month's actual cost: spend so far + rate x time left. With
--rate-from the rate comes only from runs after that instant, so a cost change is not diluted by the
days before it. Short windows are flagged LOW CONFIDENCE.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import math
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable

DEFAULT_REPO = "unchartedterritory5995-cyber/UCT-Dashboard"
DEFAULT_BUDGET = 100.0
DEFAULT_ALERT_FRACTION = 0.75
DEFAULT_QUEUE_ALERT_MIN = 30.0
DEFAULT_INCLUDED_USD = 0.0  # Free is $12 (2,000 min), Pro is $18 (3,000 min): pass --included-usd
MIN_CONFIDENT_DAYS = 3.0
SCHEMA = 1
ARTIFACT_USD_PER_GB_MONTH = 0.25
ARTIFACT_INCLUDED_GB = {"free": 0.5, "pro": 1.0}
STOP_LOOKBACK_DAYS = 7

# USD per minute, from GitHub's Actions runner pricing. Matched on labels; first hit wins.
RATES: list[tuple[str, float]] = [
    ("ubuntu-slim", 0.002),
    ("macos", 0.062),
    ("windows", 0.010),
    ("arm", 0.005),
    ("ubuntu", 0.006),
]
DEFAULT_HOSTED_RATE = 0.006
RUN_KEYS = ("id", "name", "event", "status", "conclusion", "created_at", "run_started_at",
            "updated_at", "head_branch", "head_sha", "run_attempt")
JOB_KEYS = ("id", "run_id", "name", "status", "conclusion", "created_at", "started_at",
            "completed_at", "runner_name", "runner_group_name", "labels", "run_attempt")

Gh = Callable[[str], Any]


def parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def fmt_ts(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_day(value: str) -> dt.datetime:
    if "T" in value:
        parsed = parse_ts(value)
        assert parsed is not None
        return parsed
    return dt.datetime.fromisoformat(value + "T00:00:00+00:00")


def is_self_hosted(job: dict) -> bool:
    labels = [str(x).lower() for x in job.get("labels") or []]
    if "self-hosted" in labels:
        return True
    group = job.get("runner_group_name") or ""
    return bool(group) and group != "GitHub Actions"


def rate_for(job: dict, self_hosted_rate: float = 0.0) -> float:
    if is_self_hosted(job):
        return self_hosted_rate
    labels = " ".join(str(x).lower() for x in job.get("labels") or [])
    for needle, rate in RATES:
        if needle in labels:
            return rate
    return DEFAULT_HOSTED_RATE


def was_billable(job: dict) -> bool:
    """False for skipped jobs and for jobs no runner ever took."""
    if job.get("conclusion") == "skipped":
        return False
    return bool(job.get("runner_name"))


def billed_minutes(job: dict) -> int:
    if not was_billable(job):
        return 0
    start, end = parse_ts(job.get("started_at")), parse_ts(job.get("completed_at"))
    if start is None or end is None:
        return 0
    seconds = (end - start).total_seconds()
    if seconds <= 0:
        return 0
    return math.ceil(seconds / 60)


def queue_minutes(job: dict, now: dt.datetime) -> float | None:
    """Minutes from job creation to a runner taking it. A job still queued counts up to `now`."""
    created = parse_ts(job.get("created_at"))
    if created is None:
        return None
    if job.get("status") in ("queued", "waiting", "pending", "requested"):
        return max(0.0, (now - created).total_seconds() / 60)
    if not was_billable(job):
        return None
    start = parse_ts(job.get("started_at"))
    if start is None:
        return None
    return max(0.0, (start - created).total_seconds() / 60)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(fraction * len(ordered)) - 1))]


# ---------------------------------------------------------------------------------- fetching
def gh_api(path: str) -> Any:
    """One GET through the gh CLI. `--method GET` is explicit so this can never write."""
    for attempt in range(4):
        proc = subprocess.run(["gh", "api", "--method", "GET", path], capture_output=True,
                              text=True, encoding="utf-8", errors="replace")
        if proc.returncode == 0:
            return json.loads(proc.stdout or "null")
        if attempt == 3:
            raise RuntimeError(f"gh api failed for {path}: {proc.stderr.strip()[:300]}")
        time.sleep(2 * (attempt + 1))
    return None


def trim(record: dict, keys: Iterable[str]) -> dict:
    return {key: record.get(key) for key in keys}


def list_runs(gh: Gh, repo: str, start: dt.datetime, end: dt.datetime,
              per_page: int = 100) -> list[dict]:
    """All runs created in [start, end]. The API stops at 1,000 per query, so a window over that
    is halved rather than truncated."""
    window = f"{fmt_ts(start)}..{fmt_ts(end)}"
    base = f"repos/{repo}/actions/runs?per_page={per_page}&created={window}"
    first = gh(f"{base}&page=1")
    total = int(first.get("total_count") or 0)
    if total > 1000 and (end - start).total_seconds() > 60:
        middle = start + (end - start) / 2
        right = middle + dt.timedelta(seconds=1)
        return list_runs(gh, repo, start, middle, per_page) + list_runs(gh, repo, right, end, per_page)
    rows = list(first.get("workflow_runs") or [])
    page = 2
    while len(rows) < total and page <= 11:
        batch = gh(f"{base}&page={page}").get("workflow_runs") or []
        if not batch:
            break
        rows.extend(batch)
        page += 1
    return rows


def stratum(run: dict) -> str:
    return f"{run.get('name')}|{run.get('event')}|{run.get('conclusion') or run.get('status')}"


def choose_sample(runs: list[dict], every: int, census: set[str]) -> list[dict]:
    """Every Nth run per stratum, evenly through time; censused workflows and unfinished runs in full."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for run in sorted(runs, key=lambda r: r.get("created_at") or ""):
        groups[stratum(run)].append(run)
    chosen = []
    for rows in groups.values():
        full = every <= 1 or rows[0].get("name") in census or rows[0].get("status") != "completed"
        chosen.extend(rows if full else rows[every // 2::every] or rows[:1])
    return chosen


def rate_remaining(gh: Gh) -> int:
    try:
        return int(gh("rate_limit")["resources"]["core"]["remaining"])
    except (KeyError, TypeError, ValueError, RuntimeError):
        return -1


def fetch_jobs(gh: Gh, repo: str, run_id: int) -> list[dict]:
    jobs: list[dict] = []
    page = 1
    while True:
        # filter=all: a re-run attempt is billed too, and filter=latest would hide the earlier ones.
        got = gh(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100&filter=all&page={page}")
        batch = got.get("jobs") or []
        jobs.extend(trim(job, JOB_KEYS) for job in batch)
        if len(jobs) >= int(got.get("total_count") or 0) or not batch:
            return jobs
        page += 1


def fetch_snapshot(gh: Gh, repo: str, since: dt.datetime, until: dt.datetime, sample_every: int = 1,
                   census: Iterable[str] = (), workers: int = 4, reserve: int = 1500,
                   progress: Callable[[str], None] = lambda _: None,
                   prior: dict | None = None, artifacts: bool = False) -> dict:
    runs = [trim(run, RUN_KEYS) for run in list_runs(gh, repo, since, until)]
    runs = list({run["id"]: run for run in runs}.values())
    progress(f"{len(runs)} runs listed")
    jobs_by_run: dict[str, list[dict]] = {}
    known = (prior or {}).get("jobs_by_run") or {}
    prior_runs = {run["id"]: run for run in (prior or {}).get("runs") or []}
    wanted = choose_sample(runs, sample_every, set(census))
    todo = []
    for run in wanted:
        key = str(run["id"])
        same = prior_runs.get(run["id"], {}).get("updated_at") == run.get("updated_at")
        if key in known and same:
            jobs_by_run[key] = known[key]
        else:
            todo.append(run)
    progress(f"{len(wanted)} runs chosen for job data, {len(todo)} to read")
    stopped_early = False
    for offset in range(0, len(todo), 100):
        left = rate_remaining(gh)
        if 0 <= left < reserve:
            # Other sessions share this token. Stop and say so rather than starve them.
            stopped_early = True
            progress(f"stopped: {left} API calls left, reserve {reserve}")
            break
        batch = todo[offset:offset + 100]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda r: fetch_jobs(gh, repo, r["id"]), batch))
        for run, jobs in zip(batch, results):
            jobs_by_run[str(run["id"])] = jobs
        progress(f"jobs read for {min(offset + 100, len(todo))}/{len(todo)}")
    storage = fetch_storage(gh, repo, artifacts)
    return {
        "schema": SCHEMA,
        "repo": repo,
        "since": fmt_ts(since),
        "until": fmt_ts(until),
        "fetched_at": fmt_ts(dt.datetime.now(dt.timezone.utc)),
        "sample_every": sample_every,
        "census": sorted(census),
        "stopped_early": stopped_early,
        "runs": runs,
        "jobs_by_run": jobs_by_run,
        "storage": storage,
    }


def fetch_storage(gh: Gh, repo: str, artifacts: bool = False) -> dict:
    out: dict[str, Any] = {}
    try:
        usage = gh(f"repos/{repo}/actions/cache/usage")
        out["cache_bytes"] = usage.get("active_caches_size_in_bytes")
    except RuntimeError:
        out["cache_bytes"] = None
    if artifacts:
        out.update(fetch_artifact_totals(gh, repo))
    return out


def fetch_artifact_totals(gh: Gh, repo: str) -> dict:
    """Live artifact bytes. Stops at the first failing page and says the total is partial."""
    total, count, page, partial = 0, 0, 1, False
    while True:
        try:
            got = gh(f"repos/{repo}/actions/artifacts?per_page=100&page={page}")
        except RuntimeError:
            partial = True
            break
        batch = got.get("artifacts") or []
        for item in batch:
            if not item.get("expired"):
                total += int(item.get("size_in_bytes") or 0)
                count += 1
        if len(batch) < 100:
            break
        page += 1
    return {"artifact_bytes": total, "artifact_count": count, "artifact_partial": partial}


def artifact_month_usd(storage: dict, plan: str = "free") -> float:
    size = float(storage.get("artifact_bytes") or 0) / 1e9
    return max(0.0, size - ARTIFACT_INCLUDED_GB.get(plan, 0.5)) * ARTIFACT_USD_PER_GB_MONTH


# ---------------------------------------------------------------------------------- analysis
def scale_factors(snapshot: dict) -> dict[str, float]:
    """runs_total / runs_with_job_data per stratum."""
    have = snapshot.get("jobs_by_run") or {}
    totals: dict[str, int] = defaultdict(int)
    sampled: dict[str, int] = defaultdict(int)
    for run in snapshot.get("runs") or []:
        totals[stratum(run)] += 1
        if str(run["id"]) in have:
            sampled[stratum(run)] += 1
    return {key: totals[key] / sampled[key] for key in totals if sampled[key]}


def uncovered_runs(snapshot: dict) -> int:
    factors = scale_factors(snapshot)
    return sum(1 for run in snapshot.get("runs") or [] if stratum(run) not in factors)


def analyze(snapshot: dict, self_hosted_rate: float = 0.0, now: dt.datetime | None = None) -> dict:
    now = now or parse_ts(snapshot.get("fetched_at")) or dt.datetime.now(dt.timezone.utc)
    factors = scale_factors(snapshot)
    runs = {str(run["id"]): run for run in snapshot.get("runs") or []}
    by_workflow: dict[str, dict] = defaultdict(lambda: {"minutes": 0.0, "usd": 0.0, "runs": 0})
    by_job: dict[str, dict] = defaultdict(lambda: {"minutes": 0.0, "usd": 0.0, "jobs": 0})
    by_runner = {"hosted": {"minutes": 0.0, "usd": 0.0}, "self-hosted": {"minutes": 0.0, "usd": 0.0}}
    by_day: dict[str, dict] = defaultdict(lambda: {"minutes": 0.0, "usd": 0.0})
    points: list[tuple[dt.datetime, float, float]] = []
    queues: dict[str, list[float]] = {"hosted": [], "self-hosted": []}
    queued_self: list[dict] = []
    stopped: list[dt.datetime] = []
    rounding = 0.0
    for run in runs.values():
        by_workflow[run.get("name") or "?"]["runs"] += 1
    for run_id, jobs in (snapshot.get("jobs_by_run") or {}).items():
        run = runs.get(run_id)
        if run is None:
            continue
        factor = factors.get(stratum(run), 1.0)
        workflow = run.get("name") or "?"
        for job in jobs:
            kind = "self-hosted" if is_self_hosted(job) else "hosted"
            wait = queue_minutes(job, now)
            if wait is not None:
                queues[kind].append(wait)
            if kind == "self-hosted" and job.get("status") in ("queued", "waiting", "pending"):
                queued_self.append({"workflow": workflow, "job": job.get("name"), "minutes": wait or 0.0})
            if job.get("conclusion") == "failure" and not was_billable(job):
                stopped.append(parse_ts(job.get("completed_at")) or now)
            minutes = billed_minutes(job)
            if not minutes:
                continue
            usd = minutes * rate_for(job, self_hosted_rate)
            end = parse_ts(job.get("completed_at")) or now
            start = parse_ts(job.get("started_at")) or end
            rounding += (minutes - (end - start).total_seconds() / 60) * factor
            by_workflow[workflow]["minutes"] += minutes * factor
            by_workflow[workflow]["usd"] += usd * factor
            label = f"{workflow} / {job_family(job.get('name') or '?')}"
            by_job[label]["minutes"] += minutes * factor
            by_job[label]["usd"] += usd * factor
            by_job[label]["jobs"] += 1
            by_runner[kind]["minutes"] += minutes * factor
            by_runner[kind]["usd"] += usd * factor
            day = fmt_ts(end)[:10]
            by_day[day]["minutes"] += minutes * factor
            by_day[day]["usd"] += usd * factor
            points.append((end, minutes * factor, usd * factor))
    total_usd = sum(row["usd"] for row in by_workflow.values())
    total_minutes = sum(row["minutes"] for row in by_workflow.values())
    return {
        "by_workflow": dict(by_workflow),
        "by_job": dict(by_job),
        "by_runner": by_runner,
        "by_day": dict(by_day),
        "points": points,
        "queues": queues,
        "queued_self": queued_self,
        "stopped_jobs": sum(1 for at in stopped if (now - at).days < STOP_LOOKBACK_DAYS),
        "first_stop": fmt_ts(min(stopped)) if stopped else None,
        "rounding_minutes": rounding,
        "total_usd": total_usd,
        "total_minutes": total_minutes,
        "sampled": any(factor > 1.0 for factor in factors.values()),
        "uncovered_runs": uncovered_runs(snapshot),
    }


def job_family(name: str) -> str:
    """Matrix legs of one job share a line: 'shard 3/4' and 'shard 1/4' are the same cost item."""
    out = []
    skip = False
    for char in name:
        if char.isdigit() and not skip:
            out.append("N")
            skip = True
        elif not char.isdigit():
            out.append(char)
            skip = False
    return "".join(out)


def forecast(result: dict, now: dt.datetime, rate_from: dt.datetime | None,
             month_start: dt.datetime, included_usd: float = 0.0) -> dict:
    """Month-end run rate. MTD spend + rate x remaining; never claims the month's actual cost."""
    days_in_month = calendar.monthrange(month_start.year, month_start.month)[1]
    month_end = month_start + dt.timedelta(days=days_in_month)
    points = [p for p in result["points"] if p[0] >= month_start]
    spent = sum(p[2] for p in points)
    basis_start = rate_from or month_start
    basis_days = max((now - basis_start).total_seconds() / 86400, 1e-9)
    basis_usd = sum(p[2] for p in points if p[0] >= basis_start)
    rate = basis_usd / basis_days
    remaining = max((month_end - now).total_seconds() / 86400, 0.0)
    gross = spent + rate * remaining
    return {
        "spent_gross": spent,
        "spent_net": max(0.0, spent - included_usd),
        "rate_per_day": rate,
        "basis_days": basis_days,
        "days_in_month": days_in_month,
        "gross": gross,
        "net": max(0.0, gross - included_usd),
        "low_confidence": basis_days < MIN_CONFIDENT_DAYS,
    }


def alerts(result: dict, cast: dict, budget: float, fraction: float, queue_limit: float) -> list[str]:
    limit = budget * fraction
    lines = []
    if cast["net"] >= limit:
        note = " (LOW CONFIDENCE: short window)" if cast["low_confidence"] else ""
        lines.append(f"ALERT: forecast ${cast['net']:.2f} >= ${limit:.2f} "
                     f"({fraction:.0%} of ${budget:.0f}){note}")
    if cast["spent_net"] >= limit:
        lines.append(f"ALERT: spend ${cast['spent_net']:.2f} >= ${limit:.2f} "
                     f"({fraction:.0%} of ${budget:.0f})")
    for row in result["queued_self"]:
        if row["minutes"] > queue_limit:
            lines.append(f"ALERT: self-hosted job queued {row['minutes']:.0f} min > {queue_limit:.0f}: "
                         f"{row['workflow']} / {row['job']}")
    if result["stopped_jobs"]:
        lines.append(f"ALERT: {result['stopped_jobs']} failed job(s) in the last {STOP_LOOKBACK_DAYS} days "
                     "never got a runner (budget stop or capacity, read the run annotation)")
    return lines


def compare_invoice(billing: dict, result: dict, year: int, month: int) -> str:
    """Line up the owner's billing usage export with this tool's estimate."""
    items = billing.get("usageItems") or billing.get("usage_items") or []
    actions = [item for item in items if str(item.get("product", "")).lower() == "actions"]
    in_month = [item for item in actions if str(item.get("date", "")).startswith(f"{year}-{month:02d}")]
    gross = sum(float(item.get("grossAmount") or 0) for item in in_month)
    net = sum(float(item.get("netAmount") or 0) for item in in_month)
    ratio = (result["total_usd"] / gross) if gross else 0.0
    return f"invoice data: gross ${gross:.2f}, net ${net:.2f}; estimate/gross = {ratio:.2f}"


def render(snapshot: dict, result: dict, cast: dict, lines_alert: list[str], top: int = 12) -> str:
    out = [f"CI cost report  {snapshot.get('repo')}  {snapshot.get('since')} to {snapshot.get('until')}"]
    basis = "ESTIMATED from a sample of job data" if result["sampled"] else "census of job data"
    out.append(f"Basis: job timestamps, per-job round-up, list prices; {basis}. Not the invoice.")
    if result["uncovered_runs"]:
        out.append(f"WARNING: {result['uncovered_runs']} run(s) sit in strata with no job data; "
                   "their cost is NOT in these totals.")
    if snapshot.get("stopped_early"):
        out.append("WARNING: fetch stopped early at the API reserve; job data is partial.")
    hosted, selfh = result["by_runner"]["hosted"], result["by_runner"]["self-hosted"]
    out.append(f"Total: {result['total_minutes']:,.0f} billed min, ${result['total_usd']:,.2f} "
               f"(hosted {hosted['minutes']:,.0f} min ${hosted['usd']:,.2f}; "
               f"self-hosted {selfh['minutes']:,.0f} min ${selfh['usd']:,.2f})")
    out.append(f"Round-up overhead: {result['rounding_minutes']:,.0f} min")
    out.append("")
    out.append("By workflow")
    rows = sorted(result["by_workflow"].items(), key=lambda kv: -kv[1]["usd"])
    for name, row in rows[:top]:
        out.append(f"  ${row['usd']:>9,.2f} {row['minutes']:>9,.0f} min {row['runs']:>6} runs  {name}")
    out.append("By job")
    rows = sorted(result["by_job"].items(), key=lambda kv: -kv[1]["usd"])
    for name, row in rows[:top]:
        out.append(f"  ${row['usd']:>9,.2f} {row['minutes']:>9,.0f} min  {name}")
    out.append("By day (job end, UTC)")
    for day, row in sorted(result["by_day"].items()):
        out.append(f"  {day} ${row['usd']:>9,.2f} {row['minutes']:>9,.0f} min")
    out.append("Queue time, minutes (job created to runner)")
    for kind, values in result["queues"].items():
        if values:
            out.append(f"  {kind}: p50 {percentile(values, .5):.1f}  p95 {percentile(values, .95):.1f}  "
                       f"max {max(values):.1f}  n={len(values)}")
    out.append("")
    conf = "  LOW CONFIDENCE" if cast["low_confidence"] else ""
    out.append(f"Month to date: ${cast['spent_gross']:,.2f} gross, ${cast['spent_net']:,.2f} after allowance")
    out.append(f"Forecast (run rate, not an actual): ${cast['net']:,.2f} net, ${cast['gross']:,.2f} gross, at "
               f"${cast['rate_per_day']:,.2f}/day from {cast['basis_days']:.2f} day(s) of data{conf}")
    storage = snapshot.get("storage") or {}
    if storage.get("cache_bytes"):
        out.append(f"Actions cache: {storage['cache_bytes'] / 1e9:.1f} GB")
    if storage.get("artifact_count"):
        partial = " PARTIAL" if storage.get("artifact_partial") else ""
        out.append(f"Artifacts{partial}: {storage['artifact_count']:,}, {storage['artifact_bytes'] / 1e9:.1f} GB, "
                   f"about ${artifact_month_usd(storage):.2f}/month if held all month (not in the forecast above)")
    out.extend(lines_alert or ["OK: no alert"])
    return "\n".join(out)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    def add_fetch_args(cmd: argparse.ArgumentParser) -> None:
        cmd.add_argument("--repo", default=DEFAULT_REPO)
        cmd.add_argument("--since", help="UTC day or instant; default first of this month")
        cmd.add_argument("--until", help="UTC day or instant; default now")
        cmd.add_argument("--sample-every", type=int, default=1, help="read jobs for every Nth run per stratum")
        cmd.add_argument("--census", action="append", default=[], help="workflow name always read in full")
        cmd.add_argument("--workers", type=int, default=4)
        cmd.add_argument("--reserve", type=int, default=1500, help="stop at this many API calls left")
        cmd.add_argument("--resume", help="earlier snapshot; unchanged runs reuse its job data")
        cmd.add_argument("--artifacts", action="store_true", help="also sum artifact storage")

    fetch_cmd = sub.add_parser("fetch", help="write a JSON snapshot")
    add_fetch_args(fetch_cmd)
    fetch_cmd.add_argument("--out", required=True)

    report_cmd = sub.add_parser("report", help="print the report")
    add_fetch_args(report_cmd)
    report_cmd.add_argument("--snapshot", help="offline: read this JSON")
    report_cmd.add_argument("--live", action="store_true", help="fetch first")
    report_cmd.add_argument("--billing", help="owner's billing usage JSON, to compare")
    report_cmd.add_argument("--budget", type=float, default=DEFAULT_BUDGET)
    report_cmd.add_argument("--alert-fraction", type=float, default=DEFAULT_ALERT_FRACTION)
    report_cmd.add_argument("--queue-alert-min", type=float, default=DEFAULT_QUEUE_ALERT_MIN)
    report_cmd.add_argument("--included-usd", type=float, default=DEFAULT_INCLUDED_USD)
    report_cmd.add_argument("--self-hosted-rate", type=float, default=0.0,
                            help="0.002 prices the postponed per-minute charge")
    report_cmd.add_argument("--rate-from", help="forecast from runs after this instant only")
    report_cmd.add_argument("--month", help="YYYY-MM, default the month of the data's end")
    report_cmd.add_argument("--now", help="fix the clock (tests and replays)")
    report_cmd.add_argument("--exit-nonzero-on-alert", action="store_true")
    return parser


def resolve_window(args: argparse.Namespace) -> tuple[dt.datetime, dt.datetime]:
    now = dt.datetime.now(dt.timezone.utc)
    since = parse_day(args.since) if args.since else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    until = parse_day(args.until) if args.until else now
    return since, until


def run_fetch(args: argparse.Namespace, gh: Gh) -> dict:
    since, until = resolve_window(args)
    prior = None
    if getattr(args, "resume", None):
        with open(args.resume, encoding="utf-8") as handle:
            prior = json.load(handle)
    return fetch_snapshot(gh, args.repo, since, until, args.sample_every, args.census, args.workers,
                          args.reserve, lambda msg: print(msg, file=sys.stderr, flush=True), prior,
                          args.artifacts)


def main(argv: list[str] | None = None, gh: Gh = gh_api) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "fetch":
        snapshot = run_fetch(args, gh)
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle)
        print(f"wrote {args.out}: {len(snapshot['runs'])} runs, {len(snapshot['jobs_by_run'])} with job data")
        return 0
    if args.snapshot:
        with open(args.snapshot, encoding="utf-8") as handle:
            snapshot = json.load(handle)
    elif args.live:
        snapshot = run_fetch(args, gh)
    else:
        print("report needs --snapshot FILE or --live", file=sys.stderr)
        return 2
    now = parse_day(args.now) if args.now else (parse_ts(snapshot.get("until")) or dt.datetime.now(dt.timezone.utc))
    result = analyze(snapshot, args.self_hosted_rate, now)
    if args.month:
        year, month = (int(part) for part in args.month.split("-"))
    else:
        year, month = now.year, now.month
    month_start = dt.datetime(year, month, 1, tzinfo=dt.timezone.utc)
    rate_from = parse_day(args.rate_from) if args.rate_from else None
    cast = forecast(result, now, rate_from, month_start, args.included_usd)
    lines = alerts(result, cast, args.budget, args.alert_fraction, args.queue_alert_min)
    print(render(snapshot, result, cast, lines))
    if args.billing:
        with open(args.billing, encoding="utf-8") as handle:
            print(compare_invoice(json.load(handle), result, year, month))
    return 1 if lines and args.exit_nonzero_on_alert else 0


if __name__ == "__main__":
    raise SystemExit(main())
