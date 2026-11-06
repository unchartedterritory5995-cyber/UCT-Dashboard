#!/usr/bin/env python3
"""Monthly CI cost model for the $100/month target. Stdlib only, no network, reproducible.

  python tools/ci_cost_model.py                      # markdown tables to stdout
  python tools/ci_cost_model.py --json               # the same results as JSON

Reads docs/ci/ci-cost-inputs.json (measured, produced by tools/ci_cost_measure.py). Every other number
is in ASSUMPTIONS below, each tagged M (measured), P (published price) or E (estimate). A forecast, not
a bill: nothing here says what any month actually cost.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUTS = ROOT / "docs" / "ci" / "ci-cost-inputs.json"

HOSTED_RATE = 0.006          # P  Linux 2-core, USD/min
SELF_HOSTED_FUTURE = 0.002   # P  announced then postponed; not charged today
INCLUDED_USD = 12.0          # E  GitHub Free, INFERRED from the 403s on branch protection and rulesets
EUR_USD = 1.15               # E  no page gave USD; one third-party page implied 1.12
VPS_EUR = 52.00              # P  netcup RS 2000 G12.5, 1-month term, Manassas: 46.81 + 5.19, incl. 19% VAT
VPS_EUR_24M = 39.79          # P  the same on a 24-month term: 34.60 + 5.19
AWS_SPOT_HOUR = 0.203        # P  c7a.2xlarge us-east-1, third-party tracker, varies hourly
AWS_INTERRUPT_RERUN = 0.05   # E  AWS says "<5%" on average across all types
AWS_BOOT_MIN = 3.0           # E  launch plus registering a just-in-time runner
AWS_GB_MONTH = 0.08          # P  gp3, from memory of AWS pricing, unverified here
AWS_DISK_GB = 60.0           # E  held only while running, so prorated
AWS_IPV4_HOUR = 0.005        # P  from memory of AWS pricing, unverified here
GATE_MIN = (15.0, 20.0)      # E  8-vCPU serial heavy job, from the brief; see the proxy benchmark
PREMERGE_PER_GATE = 1.0      # E  one merge-deciding check per PR; every gate run is one merge
PC_ADVISORY_MIN = 8.1        # M  full Agent suite, 8 workers, owner's PC
PC_WATTS_INCREMENTAL = (80.0, 225.0)   # E  above idle. The sampler saw about 2.2 of 8 pinned threads busy on average
PC_RAIL_WATTS = 30.0         # E  a rail is one or two threads, so far less than a full suite
KWH_USD = 0.1816             # P  EIA US residential average, Aug 2026; the owner's own rate is unknown
KWH_USD_HIGH = 0.35          # E  a high-cost state
MAINT_HOURS = {              # E  per month, excluding the one-off build
    "A today after #877": 0.5, "B(a) PC+VPS pre-merge": 3.0, "B(b) PC+VPS gate only": 2.5,
    "C PC+hosted gate": 1.5, "D PC+AWS spot": 4.0,
}
MAINT_USD_HOUR = 25.0        # E  placeholder so maintenance has a dollar line; the owner should set this
FULL_SUITE_HOSTED_LEFT = 10.0  # E  plan and publish jobs that must stay hosted if the nightly shards move
CANCEL_SAVES = 0.5           # E  a superseded rail run is stopped about halfway through
OUTAGE_DAYS = 3.0            # E  VPS down, owner switches the gate to hosted by hand
WATCHDOG_HOSTED_MIN = 0.0    # E  a step inside the hosted gate job: seconds, already rounded into that job


def load() -> dict:
    return json.loads(INPUTS.read_text(encoding="utf-8"))


def job_minutes(shape: dict, needle: str) -> float:
    return sum(row["mean"] for name, row in shape["jobs"].items() if needle in name.lower())


def unit_costs(data: dict) -> dict:
    """Hosted minutes per run, measured from the gate's own job data."""
    shape = data["gate_shape"]
    heavy = (4 * job_minutes(shape, "browser tests") + job_minutes(shape, "equivalence rail")
             + job_minutes(shape, "pine runtime"))
    gate_job = job_minutes(shape, "deploy-correctness")
    verdict = job_minutes(shape, "verdict")
    return {
        "heavy": heavy, "gate_job": gate_job, "verdict": verdict,
        "gate_total": heavy + gate_job + verdict,
        "split_saving": 3.0,   # M 2.8 min of server tests leave the gate job, which then rounds to 6
    }


def day_profile(data: dict, day: str) -> dict:
    row = data["nov"]["days"][day]
    return {key: float(val) for key, val in row.items()}


def post_877_day(data: dict, raw: dict, scale: float) -> dict:
    """One measured day with #877's three changes applied, because the hour since the merge is too little to measure."""
    keep = 1.0 - data["filter_replay"]["skip_rate_upper_bound"]
    agent = raw.get("min:agent", 0.0) * keep * (1.0 - data["post_leg"]["share_removed"])
    rails = raw.get("min:rails", 0.0) * (1.0 - data["superseded"]["share"] * CANCEL_SAVES)
    return {
        "gates": raw.get("runs:gate", 0.0) * scale, "agent_runs": raw.get("runs:agent", 0.0) * keep * scale,
        "agent_min": agent * scale, "rails_min": rails * scale,
        "other_min": raw.get("min:other_heavy", 0.0), "promote_min": raw.get("min:promote", 0.0) * scale,
        "pr_share": data["rails_nov5"]["by_event"].get("pull_request", 0.0) / sum(data["rails_nov5"]["by_event"].values()),
    }


def profiles(data: dict) -> dict:
    """Normal day = October's mean gate count, Nov-5 shape scaled to it. Busy day = Nov 5 as measured."""
    gates = [val.get("runs:gate", 0.0) for val in data["oct"]["days"].values()]
    normal_gates = statistics.fmean(gates)
    busy = {key: float(val) for key, val in data["nov"]["days"]["2026-11-05"].items()}
    scale = normal_gates / busy["runs:gate"]
    return {"busy": post_877_day(data, busy, 1.0), "normal": post_877_day(data, busy, scale),
            "normal_gates": normal_gates}


def day_cost(arch: str, day: dict, unit: dict, split: bool, gate_min: float, levers: float = 0.0) -> dict:
    """One day's hosted minutes, self-hosted minutes, PC minutes and AWS dollars. `levers` is the share of rail
    minutes leaving hosted. PR rails go to the PC, master rails to the VPS, and the nightly shards to the PC."""
    gates = day["gates"]
    gate_job = unit["gate_job"] - (unit["split_saving"] if split else 0.0)
    core = (gate_job + unit["verdict"]) * gates + day["promote_min"]
    rails = day["rails_min"] * (1.0 - levers)
    other = min(day["other_min"], FULL_SUITE_HOSTED_LEFT) if levers else day["other_min"]
    fixed = rails + other
    agent = day["agent_min"]
    out = {"hosted": 0.0, "vps_min": 0.0, "pc_min": 0.0, "pc_rail_min": 0.0, "aws_usd": 0.0, "aws_min": 0.0}
    if levers:
        moved = day["rails_min"] * levers
        pr_part = min(moved, day["rails_min"] * day["pr_share"])
        out["pc_rail_min"] = pr_part
        out["vps_min"] = moved - pr_part
        out["pc_min"] += day["other_min"] - other
    if arch == "A today after #877":
        out["hosted"] = unit["gate_total"] * gates + day["promote_min"] + fixed + agent
    elif arch == "C PC+hosted gate":
        out["hosted"] = unit["gate_total"] * gates + day["promote_min"] + fixed
        out["pc_min"] += day["agent_runs"] * PC_ADVISORY_MIN
    elif arch.startswith("B"):
        out["hosted"] = core + fixed
        out["pc_min"] += day["agent_runs"] * PC_ADVISORY_MIN
        checks = gates * (PREMERGE_PER_GATE if "(a)" in arch else 0.0)
        out["vps_min"] += (gates + checks) * gate_min
    elif arch == "D PC+AWS spot":
        out["hosted"] = core + fixed + gates          # one launcher minute per gate
        out["pc_min"] += day["agent_runs"] * PC_ADVISORY_MIN
        minutes = gates * (gate_min + AWS_BOOT_MIN) * (1 + AWS_INTERRUPT_RERUN)
        hours = minutes / 60
        out["aws_min"] = minutes
        out["aws_usd"] = hours * (AWS_SPOT_HOUR + AWS_IPV4_HOUR) + AWS_DISK_GB * AWS_GB_MONTH * hours / 720
    return out


MONTHS = {
    "normal month": {"busy": 0, "normal": 30},
    "mixed month (6 Nov-5 days)": {"busy": 6, "normal": 24},
    "sustained busy month (22 Nov-5 days)": {"busy": 22, "normal": 8},
}
ARCHES = ["A today after #877", "B(a) PC+VPS pre-merge", "B(b) PC+VPS gate only", "C PC+hosted gate", "D PC+AWS spot"]


def month_cost(arch: str, mix: dict, prof: dict, unit: dict, split: bool, gate_min: float,
               storage_usd: float, vps_count: int = 1, self_hosted_rate: float = 0.0,
               outage: bool = False, watts: float = 120.0, kwh: float = KWH_USD, levers: float = 0.0,
               vps_eur: float = VPS_EUR) -> dict:
    totals = {"hosted": 0.0, "vps_min": 0.0, "pc_min": 0.0, "pc_rail_min": 0.0, "aws_usd": 0.0, "aws_min": 0.0}
    levers = 0.0 if arch[0] == "A" else levers    # today has nowhere to move anything to
    for kind, days in mix.items():
        row = day_cost(arch, prof[kind], unit, split, gate_min, levers)
        for key in totals:
            totals[key] += row[key] * days
    if outage and arch.startswith("B"):
        # Manual fallback: for OUTAGE_DAYS the heavy jobs run hosted at busy-day volume, and no check runs on the VPS.
        totals["hosted"] += unit["heavy"] * prof["busy"]["gates"] * OUTAGE_DAYS
    hosted_usd = totals["hosted"] * HOSTED_RATE
    net_hosted = max(0.0, hosted_usd - INCLUDED_USD)
    vps_usd = vps_eur * EUR_USD * vps_count if arch.startswith("B") else 0.0
    power = (totals["pc_min"] / 60 * watts + totals["pc_rail_min"] / 60 * PC_RAIL_WATTS) / 1000 * kwh
    self_min = totals["vps_min"] + totals["pc_min"] + totals["pc_rail_min"] + totals["aws_min"]
    surcharge = self_min * self_hosted_rate
    maint = MAINT_HOURS[arch] * MAINT_USD_HOUR
    cash = net_hosted + vps_usd + power + totals["aws_usd"] + surcharge + storage_usd + maint
    return {**totals, "hosted_usd": hosted_usd, "net_hosted": net_hosted, "vps_usd": vps_usd, "power_usd": power,
            "surcharge": surcharge, "storage_usd": storage_usd, "maint_hours": MAINT_HOURS[arch], "total": cash - maint,
            "total_with_maint": cash, "self_min": self_min}


def simulate(arrivals: list[float], service_min: float, servers: int = 1, premerge: bool = False) -> dict:
    """FIFO replay of real gate arrivals. With `premerge`, each arrival first runs a check of the same length
    on the same queue, and its gate joins the queue only when that check finishes (the merge happens then)."""
    free = [0.0] * servers
    events = sorted((at * 60, 0) for at in arrivals)    # minutes, stage
    waits = []
    last_end = 0.0
    while events:
        at, stage = events.pop(0)
        index = min(range(servers), key=lambda i: free[i])
        start = max(at, free[index])
        end = start + service_min
        free[index] = end
        waits.append(start - at)
        last_end = max(last_end, end)
        if premerge and stage == 0:
            events.append((end, 1))
            events.sort()
    return {
        "jobs": len(waits),
        "wait_p50": statistics.median(waits) if waits else 0.0,
        "wait_p95": sorted(waits)[max(0, int(len(waits) * 0.95) - 1)] if waits else 0.0,
        "wait_max": max(waits) if waits else 0.0,
        "drained_hours": last_end / 60,
        "busy_hours": len(waits) * service_min / 60,
    }


def gates_at_budget(arch: str, prof: dict, unit: dict, split: bool, storage: float, levers: float,
                    budget: float = 100.0) -> float:
    """Average gate runs a day a 30-day month can hold at `budget` cash, everything scaled with the gate count."""
    low, high = 0.0, 200.0
    base = prof["normal"]
    for _ in range(40):
        mid = (low + high) / 2
        ratio = mid / base["gates"]
        day = {**base, "gates": mid, "agent_runs": base["agent_runs"] * ratio, "agent_min": base["agent_min"] * ratio,
               "rails_min": base["rails_min"] * ratio, "promote_min": base["promote_min"] * ratio}
        cost = month_cost(arch, {"d": 30}, {"d": day}, unit, split, GATE_MIN[1], storage, levers=levers)["total"]
        low, high = (mid, high) if cost < budget else (low, mid)
    return low


def run() -> dict:
    data = load()
    unit = unit_costs(data)
    prof = profiles(data)
    storage = data.get("artifact_month_usd", 0.0)
    rails = data["rails_nov5"]["by_event"]
    pr_share = rails.get("pull_request", 0.0) / sum(rails.values())
    full_share = 1.0 - (data["rails_nov5"]["must_stay_min"] + rails.get("schedule", 0.0)) / sum(rails.values())
    results: dict = {"unit": unit, "profiles": prof, "pr_rail_share": pr_share, "months": {}, "queues": {},
                     "gates_at_100": {}, "full_share": full_share}
    for arch in ARCHES:
        for split in ((False, True) if arch[0] in "BD" else (False,)):
            for levers in ((0.0, pr_share, full_share) if arch[0] == "B" else (0.0, pr_share) if arch[0] != "A" else (0.0,)):
                tag = {0.0: "", pr_share: " + L1 L2", full_share: " + L1 L2 L3"}[levers]
                name = arch + (" split" if split else "") + tag
                results["gates_at_100"][name] = gates_at_budget(arch, prof, unit, split, storage, levers)
    for month, mix in MONTHS.items():
        rows = {}
        for arch in ARCHES:
            for split in ((False, True) if arch.startswith("B") or arch.startswith("D") else (False,)):
                name = arch + (" split" if split else "")
                top = full_share if arch.startswith("B") else pr_share
                common = (arch, mix, prof, unit, split, GATE_MIN[1], storage)
                rows[name] = {
                    "base": month_cost(*common),
                    "levers": month_cost(*common, levers=pr_share),
                    "full": month_cost(*common, levers=top),
                    "full_24m": month_cost(*common, levers=top, vps_eur=VPS_EUR_24M),
                    "fast": month_cost(arch, mix, prof, unit, split, GATE_MIN[0], storage, levers=top),
                    "outage": month_cost(*common, levers=top, outage=True),
                    "future_002": month_cost(*common, levers=top, self_hosted_rate=SELF_HOSTED_FUTURE),
                    "power_high": month_cost(*common, levers=top, watts=PC_WATTS_INCREMENTAL[1], kwh=KWH_USD_HIGH),
                }
        common = ("B(a) PC+VPS pre-merge", mix, prof, unit, True, GATE_MIN[1], storage)
        rows["B(a) PC+2 VPS split"] = {
            "base": month_cost(*common, vps_count=2),
            "levers": month_cost(*common, vps_count=2, levers=pr_share),
            "full": month_cost(*common, vps_count=2, levers=full_share),
            "full_24m": month_cost(*common, vps_count=2, levers=full_share, vps_eur=VPS_EUR_24M),
        }
        results["months"][month] = rows
    arrivals = data["gate_arrivals_nov5"]
    for minutes in GATE_MIN:
        results["queues"][f"gate only, 1 VPS, {minutes:.0f} min"] = simulate(arrivals, minutes)
        results["queues"][f"check + gate, 1 VPS, {minutes:.0f} min"] = simulate(arrivals, minutes, 1, True)
        results["queues"][f"check + gate, 2 VPS, {minutes:.0f} min"] = simulate(arrivals, minutes, 2, True)
    return results


def render(results: dict) -> str:
    out = ["Hosted minutes per gate run: " + ", ".join(f"{k} {v:.1f}" for k, v in results["unit"].items()),
           f"Normal day: {results['profiles']['normal_gates']:.1f} gates. PR share of rail minutes: {results['pr_rail_share']:.0%}.", ""]
    for month, rows in results["months"].items():
        out += [f"### {month}", "",
                "| Architecture | Hosted min (as specified) | As specified $ | L1+L2 $ | All levers $ | All, 24-month VPS $ | All, 15-min gate $ "
                "| All + 3-day outage $ | All + $0.002/min $ | All + high power $ | All + maint $ | Maint h |",
                "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for name, row in rows.items():
            base = row["base"]
            cell = lambda key, field="total": f"{row[key][field]:,.0f}" if key in row else "n/a"  # noqa: E731
            out.append(f"| {name} | {base['hosted']:,.0f} | {base['total']:,.0f} | {cell('levers')} | **{cell('full')}** | {cell('full_24m')} | "
                       f"{cell('fast')} | {cell('outage')} | {cell('future_002')} | {cell('power_high')} | {cell('full', 'total_with_maint')} | "
                       f"{base['maint_hours']:.1f} |")
        out.append("")
    out += ["### Average gate runs a day that fit in $100 cash", "", "| Architecture | Gates/day |", "|---|---|"]
    out += [f"| {name} | {value:.1f} |" for name, value in results["gates_at_100"].items()]
    out += ["", "### Queue replay of the real Nov 5 gate arrivals", "",
            "| Case | Jobs | Busy h | Drained at h | Wait p50 min | p95 min | Max min |", "|---|---|---|---|---|---|---|"]
    for name, row in results["queues"].items():
        out.append(f"| {name} | {row['jobs']} | {row['busy_hours']:.1f} | {row['drained_hours']:.1f} | "
                   f"{row['wait_p50']:.0f} | {row['wait_p95']:.0f} | {row['wait_max']:.0f} |")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    results = run()
    print(json.dumps(results, indent=1) if args.json else render(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
