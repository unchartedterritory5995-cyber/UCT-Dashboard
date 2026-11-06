#!/usr/bin/env python3
"""Setup versus test time per job, from real job steps. Stdlib only, read-only (gh api GET).

  python tools/ci_cost_setup.py --snapshot nov.json --out setup.json

Classifies each step as checkout, toolchain (setup-node/python), install (npm ci / pip), test or other, for the
master gate's Agent shards and for the rails. Says what dependency caching and fewer shards could save once each
job is re-rounded to whole minutes.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import statistics
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_cost_report as ccr  # noqa: E402
import ci_cost_steps as steps  # noqa: E402

KINDS = [("install", re.compile(r"npm ci|pip install|Install|dependenc", re.I)),
         ("checkout", re.compile(r"checkout", re.I)),
         ("toolchain", re.compile(r"setup-node|setup-python", re.I)),
         ("overhead", re.compile(r"^(Set up job|Complete job|Post )", re.I))]
RAILS = ["term018 guards", "wisdom rails", "notebook bytes", "notebook budgets", "preference allow-list",
         "flow-worker deploy coverage", "vite build args", "indicators security suite", "Notebook accessibility"]


def kind(name: str) -> str:
    for label, pattern in KINDS:
        if pattern.search(name):
            return label
    return "test"


def breakdown(job: dict) -> dict:
    out: dict[str, float] = defaultdict(float)
    for step in job.get("steps") or []:
        out[kind(step.get("name") or "")] += steps.seconds(step)
    start, end = ccr.parse_ts(job["started_at"]), ccr.parse_ts(job["completed_at"])
    out["total"] = (end - start).total_seconds()
    return dict(out)


def summarize(rows: list[dict]) -> dict:
    keys = {key for row in rows for key in row}
    return {key: statistics.fmean(row.get(key, 0.0) for row in rows) for key in sorted(keys)} | {"n": len(rows)}


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with open(args.snapshot, encoding="utf-8") as handle:
        snap = json.load(handle)
    repo = snap["repo"]
    ok = [run for run in snap["runs"] if run.get("conclusion") == "success"]
    gates = [run for run in ok if run["name"] == "master deploy gate" and run["created_at"] >= "2026-11-05"][:25]
    rails = {name: [run for run in ok if run["name"] == name and run["event"] == "push"][-10:] for name in RAILS}

    def read(run: dict) -> list[dict]:
        return steps.job_steps(ccr.gh_api, repo, run["id"])

    with ThreadPoolExecutor(max_workers=4) as pool:
        gate_jobs = [job for jobs in pool.map(read, gates) for job in jobs if job.get("conclusion") == "success"]
        rail_jobs = {name: [job for jobs in pool.map(read, rows) for job in jobs if job.get("conclusion") == "success"]
                     for name, rows in rails.items()}
    shards = [breakdown(job) for job in gate_jobs if "browser tests (shard" in job["name"]]
    union = [breakdown(job) for job in gate_jobs if "equivalence rail" in job["name"]]
    out = {"shard": summarize(shards), "union": summarize(union),
           "rails": {name: summarize([breakdown(job) for job in jobs]) for name, jobs in rail_jobs.items() if jobs}}
    shard = out["shard"]
    test_s = shard.get("test", 0.0)
    setup_s = shard["total"] - test_s
    cached_install = 20.0     # E: an npm cache restore of node_modules keyed on the lockfile, about 20 s
    out["shard_billed_now"] = math.ceil(shard["total"] / 60)
    out["shard_billed_cached"] = math.ceil((shard["total"] - shard.get("install", 0.0) + cached_install) / 60)
    work = 4 * test_s
    for count in (1, 2, 3, 4):
        per = work / count + setup_s - shard.get("install", 0.0) + cached_install
        out[f"shards_{count}_cached_min"] = count * math.ceil(per / 60)
        out[f"shards_{count}_wall_min"] = per / 60
    out["shards_4_now_min"] = 4 * math.ceil(shard["total"] / 60)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(out, handle, indent=1)
        handle.write("\n")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
