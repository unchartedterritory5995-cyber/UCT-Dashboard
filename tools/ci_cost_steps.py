#!/usr/bin/env python3
"""Step-level timings for the two questions job totals cannot answer. Stdlib only, read-only.

  python tools/ci_cost_steps.py --snapshot nov.json --out steps.json

1. What is the hosted `gate` job after only the Agent server tests step leaves it? Each run's job is re-rounded.
2. What would hosted rails save by sharing a job? AUDIT allows that only for identical trigger shapes, so this also
   compares the `on:` blocks. A hypothetical saving for rails that do not qualify is labelled as such.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_cost_report as ccr  # noqa: E402

GATE = "master deploy gate"
GATE_JOB = "deploy-correctness"
SERVER_STEP = re.compile(r"UCT Agent server tests|tests/test_uct_agent", re.I)
SETUP_STEP = re.compile(r"^(Set up job|Run actions/|Post |Complete job|Install)", re.I)
#: Hosted after the rulings and allowed to consolidate: not vite-build-args, notebook-latency or clock-parity-fixture.
ELIGIBLE = {"notebook budgets": "notebook-budgets.yml", "preference allow-list": "preference-allowlist.yml",
            "flow-worker deploy coverage": "flow-worker-deploy-coverage.yml"}
SAMPLE = 15


def seconds(step: dict) -> float:
    start, end = ccr.parse_ts(step.get("started_at")), ccr.parse_ts(step.get("completed_at"))
    return (end - start).total_seconds() if start and end else 0.0


def job_steps(gh: ccr.Gh, repo: str, run_id: int) -> list[dict]:
    return gh(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100&filter=latest").get("jobs") or []


def rerounded_gate(jobs: list[dict]) -> dict | None:
    for job in jobs:
        if GATE_JOB in (job.get("name") or "") and job.get("conclusion") == "success":
            start, end = ccr.parse_ts(job["started_at"]), ccr.parse_ts(job["completed_at"])
            total = (end - start).total_seconds()
            server = sum(seconds(step) for step in job.get("steps") or [] if SERVER_STEP.search(step.get("name") or ""))
            return {"total_s": total, "server_s": server, "before": math.ceil(total / 60),
                    "after": math.ceil(max(total - server, 1.0) / 60)}
    return None


def rail_shape(jobs: list[dict]) -> dict | None:
    for job in jobs:
        if job.get("conclusion") != "success" or not ccr.was_billable(job):
            continue
        start, end = ccr.parse_ts(job["started_at"]), ccr.parse_ts(job["completed_at"])
        total = (end - start).total_seconds()
        steps = job.get("steps") or []
        setup = sum(seconds(step) for step in steps if SETUP_STEP.search(step.get("name") or ""))
        return {"total_s": total, "setup_s": setup, "billed": math.ceil(total / 60)}
    return None


def trigger_groups(root: pathlib.Path) -> dict:
    """Workflow files grouped by their exact `on:` block text, order of paths ignored."""
    groups: dict[str, list[str]] = {}
    for name in ELIGIBLE.values():
        text = (root / ".github" / "workflows" / name).read_text(encoding="utf-8")
        block = re.search(r"^on:\n(.*?)(?=^\S)", text, re.M | re.S)
        lines = [line.strip() for line in (block.group(1) if block else "").splitlines()
                 if line.strip() and not line.strip().startswith("#")]
        groups.setdefault("\n".join(sorted(lines)), []).append(name)
    return {"groups": list(groups.values()), "any_identical": any(len(val) > 1 for val in groups.values())}


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repo-root", default=str(pathlib.Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    with open(args.snapshot, encoding="utf-8") as handle:
        snapshot = json.load(handle)
    repo = snapshot["repo"]
    runs = [run for run in snapshot["runs"] if run.get("conclusion") == "success"]
    gates = [run for run in runs if run["name"] == GATE and run["created_at"] >= "2026-11-05"][:40]
    rails = {name: [run for run in runs if run["name"] == name and run["event"] == "push"][-SAMPLE:] for name in ELIGIBLE}

    def read(run: dict) -> list[dict]:
        return job_steps(ccr.gh_api, repo, run["id"])

    with ThreadPoolExecutor(max_workers=4) as pool:
        gate_rows = [row for row in map(rerounded_gate, pool.map(read, gates)) if row]
        rail_rows = {name: [row for row in map(rail_shape, pool.map(read, rows)) if row] for name, rows in rails.items()}
    out = {
        "gate_runs": len(gate_rows),
        "gate_before_min": statistics.fmean(row["before"] for row in gate_rows),
        "gate_after_min": statistics.fmean(row["after"] for row in gate_rows),
        "server_step_min": statistics.fmean(row["server_s"] for row in gate_rows) / 60,
        "rails": {name: {"n": len(rows), "billed": statistics.fmean(r["billed"] for r in rows),
                         "total_s": statistics.fmean(r["total_s"] for r in rows),
                         "setup_s": statistics.fmean(r["setup_s"] for r in rows)} for name, rows in rail_rows.items()},
        "triggers": trigger_groups(pathlib.Path(args.repo_root)),
    }
    billed = sum(row["billed"] for row in out["rails"].values())
    work = sum(row["total_s"] - row["setup_s"] for row in out["rails"].values())
    setup = max(row["setup_s"] for row in out["rails"].values())
    out["hypothetical_one_job_min"] = math.ceil((work + setup) / 60)
    out["hypothetical_saving_min_if_all_fired_together"] = billed - out["hypothetical_one_job_min"]
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(out, handle, indent=1)
        handle.write("\n")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
