#!/usr/bin/env python3
"""Hosted-only CI variants: no rented server. Stdlib only, no network, reproducible.

  python tools/ci_cost_hosted.py           # markdown
  python tools/ci_cost_hosted.py --json

AUDIT's rules held throughout: the PC is advisory only; the named merge-candidate set runs once per PR or Agent
batch, on hosted; the gate, verdict, promote and every rail stay hosted and unchanged unless a variant says so.
Reads docs/ci/ci-cost-inputs.json through tools/ci_cost_model.py, so the measured units are shared.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_cost_model as base  # noqa: E402

RATE = base.HOSTED_RATE
DAYS = base.DAYS
TARGET = 200.0
BLACKSMITH_2VCPU = 0.004     # P docs.blacksmith.sh; same $/vCPU at every size; free 3,000 2-vCPU min per org
BLACKSMITH_FREE_USD = 3000 * BLACKSMITH_2VCPU
PRO_USD = 4.0                # E third-party page; GitHub's own pricing page did not show Pro
PRO_EXTRA_ALLOWANCE = 6.0    # P $18 included compute on Pro against $12 on Free
SHARD_SHARE = 4 * 14.09 / 61.66   # M share of the heavy jobs that is the four browser shards


def units(data: dict) -> dict:
    unit = base.unit_costs(data)
    rails = unit["rails_hosted"] + unit["rails_movable"]
    wall = data["wall"]
    return {
        **unit, "rails": rails,
        "gate_core": unit["heavy"] + unit["gate_whole"] + unit["verdict"] + unit["promote"],
        "agent_candidate": unit["agent_run"] + rails,
        "gate_wall": wall["master deploy gate|push"]["p50"],
        "candidate_wall": wall["agent ci|push"]["p50"],
        "promote_wall": wall["promote to production|workflow_run"]["p50"],
    }


def coalesce(arrivals: list[float], every_min: float, wall: float) -> dict:
    """Gate runs on the master tip, one at a time, at most one start per `every_min`. Returns runs and latencies."""
    pushes = sorted(at * 60 for at in arrivals)
    runs, latency = 0, []
    last_start, busy_until = -1e9, -1e9
    index = 0
    while index < len(pushes):
        start = max(pushes[index], last_start + every_min, busy_until)
        covered = [p for p in pushes[index:] if p <= start]
        end = start + wall
        latency.extend(end - p for p in covered)
        index += len(covered)
        runs += 1
        last_start, busy_until = start, end
    return {"runs": runs, "latency_p50": statistics.median(latency), "latency_p90": sorted(latency)[int(len(latency) * 0.9)],
            "latency_max": max(latency)}


def reuse_rate(arrivals_by_day: dict, window: float) -> float:
    """Share of Agent gates whose tree equals what the candidate tested: no other master push in the `window`
    minutes before the merge. Assumes the queue tests the whole batch tree and lands it as one push."""
    hits = total = 0
    for day, rows in arrivals_by_day.items():
        if day > "2026-11-05":
            continue
        times = sorted((at * 60, kind) for at, kind in rows)
        for at, kind in times:
            if not kind.startswith("agent"):
                continue
            total += 1
            if not any(at - window <= other < at and other != at for other, _ in times):
                hits += 1
    return hits / total if total else 0.0


def month(day: base.Day, unit: dict, k: float = 3.0, gates: float | None = None, reuse: float = 0.0,
          blacksmith: bool = False, pro: bool = False) -> dict:
    """Variant a and its add-ons. `gates` overrides the gate run count (coalescing)."""
    merges = day.gates(k)
    runs = merges if gates is None else gates
    agent_candidates = day.heavy_candidates(k)
    shard_min = unit["heavy"] * SHARD_SHARE
    agent_gates = agent_candidates * (runs / merges)
    hosted = (runs * unit["gate_core"] + merges * unit["rails"]          # gate per run; rails still on every push
              + agent_candidates * unit["agent_candidate"] + day.n_pr * unit["rails"])
    hosted -= agent_gates * reuse * unit["heavy"]
    third = 0.0
    if blacksmith:
        moved = (runs - agent_gates * reuse) * shard_min + agent_candidates * shard_min
        hosted -= moved
        third = max(0.0, moved * BLACKSMITH_2VCPU * 30 - BLACKSMITH_FREE_USD) / 30
    hosted_month = hosted * DAYS + base.fixed_hosted_month(unit)
    allowance = base.INCLUDED_USD + (PRO_EXTRA_ALLOWANCE if pro else 0.0)
    github = max(0.0, hosted_month * RATE - allowance) + (PRO_USD if pro else 0.0)
    power = (day.agent_pushes * base.PC_SUITE_MIN + base.NIGHTLY_MOVED_MIN) * DAYS / 60 * base.PC_WATTS / 1000 * base.KWH_USD
    total = github + third * DAYS + power + 0.33
    return {"hosted_min": hosted_month, "github": github, "third_party": third * DAYS, "power": power, "total": total,
            "gate_runs": runs}


def run() -> dict:
    data = base.load()
    unit = units(data)
    prof = base.profiles(data)
    by_day = data["gate_kinds"]["arrivals_by_day"]
    results: dict = {"unit": unit, "rows": {}, "coalesce": {}, "reuse": {}}
    window = unit["candidate_wall"]
    rate = reuse_rate(by_day, window)
    results["reuse"] = {"window_min": window, "rate": rate, "rate_30min": reuse_rate(by_day, 30.0),
                        "rate_60min": reuse_rate(by_day, 60.0)}
    days5 = [d for d in by_day if d <= "2026-11-05"]
    for n in (0, 30, 60, 120):
        normal = [coalesce([at for at, _ in by_day[d]], n, unit["gate_wall"]) for d in days5]
        busy = coalesce([at for at, _ in by_day["2026-11-05"]], n, unit["gate_wall"])
        results["coalesce"][n] = {
            "normal_runs": statistics.fmean(row["runs"] for row in normal), "nov5_runs": busy["runs"],
            "nov5_latency_p50": busy["latency_p50"], "nov5_latency_p90": busy["latency_p90"],
            "nov5_latency_max": busy["latency_max"],
            "normal_latency_p50": statistics.median(row["latency_p50"] for row in normal),
        }
    scenarios = {"normal": prof["nov15"], "nov5": prof["nov5"]}
    for label, day in scenarios.items():
        key = "normal_runs" if label == "normal" else "nov5_runs"
        ratio = lambda n: results["coalesce"][n][key] / results["coalesce"][0][key]  # noqa: E731
        merges = day.gates(3.0)
        rows = {
            "a hosted, PC advisory, candidate runs": month(day, unit),
            "a, real batch size 1.64": month(day, unit, k=1.64),
            "b N=30": month(day, unit, gates=merges * ratio(30)),
            "b N=60": month(day, unit, gates=merges * ratio(60)),
            "b N=120": month(day, unit, gates=merges * ratio(120)),
            "c tree reuse (30-min window)": month(day, unit, reuse=results["reuse"]["rate_30min"]),
            "d Blacksmith shards": month(day, unit, blacksmith=True),
            "e Pro": month(day, unit, pro=True),
            "b N=60 + e": month(day, unit, gates=merges * ratio(60), pro=True),
            "b N=120 + e": month(day, unit, gates=merges * ratio(120), pro=True),
            "b N=120 + d + e": month(day, unit, gates=merges * ratio(120), blacksmith=True, pro=True),
            "floor: no gates at all": month(day, unit, gates=0.0),
        }
        results["rows"][label] = rows
    return results


def render(results: dict) -> str:
    out = ["| Variant | Normal $ | Every day Nov 5 $ | Gate runs/day normal / Nov 5 |", "|---|---|---|---|"]
    for name in results["rows"]["normal"]:
        a, b = results["rows"]["normal"][name], results["rows"]["nov5"][name]
        out.append(f"| {name} | {a['total']:,.0f} | {b['total']:,.0f} | {a['gate_runs']:.1f} / {b['gate_runs']:.1f} |")
    out += ["", "| N min | Gate runs normal / Nov 5 | Promotion latency Nov 5 p50 / p90 / max min | Normal p50 |", "|---|---|---|---|"]
    for n, row in results["coalesce"].items():
        out.append(f"| {n} | {row['normal_runs']:.1f} / {row['nov5_runs']} | {row['nov5_latency_p50']:.0f} / "
                   f"{row['nov5_latency_p90']:.0f} / {row['nov5_latency_max']:.0f} | {row['normal_latency_p50']:.0f} |")
    out += ["", "Tree reuse: " + json.dumps({k: round(v, 3) for k, v in results["reuse"].items()})]
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    results = run()
    print(json.dumps(results, indent=1, default=str) if args.json else render(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
