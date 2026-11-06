#!/usr/bin/env python3
"""Monthly CI cost model under AUDIT's rulings of 2026-11-06. Stdlib only, no network, reproducible.

  python tools/ci_cost_model.py                      # markdown tables to stdout
  python tools/ci_cost_model.py --json               # the same results as JSON

Reads docs/ci/ci-cost-inputs.json (measured, produced by tools/ci_cost_measure.py). Every other number is in the
constants below, each tagged M (measured), P (published price) or E (estimate). A forecast, not a bill.

Cost is linear in four daily counts, because AUDIT wants the owner told what $100 depends on:
  n_pr      non-Agent gates merged through a PR. Unbatchable. Each also gets a light merge-candidate run.
  n_direct  non-Agent gates pushed straight to master. Unbatchable. No PR, so no merge-candidate run.
  a_batch   Agent PRs that may share a gate. `k` is PRs per batch, 1 to 3.
  a_solo    Agent PRs never batched: spend, limits, schema, workflow or gate changes.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
from dataclasses import dataclass

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUTS = ROOT / "docs" / "ci" / "ci-cost-inputs.json"

HOSTED_RATE = 0.006          # P  Linux 2-core, USD/min
SELF_HOSTED_FUTURE = 0.002   # P  announced then postponed; not charged today
INCLUDED_USD = 12.0          # E  GitHub Free, INFERRED from the 403s on branch protection and rulesets
EUR_USD = 1.15               # E  no page gave USD; one third-party page implied 1.12
VPS_TERMS = {"1-month": 52.00, "12-month": 45.89, "24-month": 39.79}  # P netcup RS 2000 G12.5 + Manassas 5.19, incl. VAT
AWS_SPOT_HOUR = 0.203        # P  c7a.2xlarge us-east-1, third-party tracker, varies hourly
AWS_IPV4_HOUR = 0.005        # P  from memory of AWS pricing, unverified here
AWS_INTERRUPT_RERUN = 0.05   # E  AWS says "<5%" on average across all types
AWS_BOOT_MIN = 3.0           # E  launch plus registering a just-in-time runner
GATE_MIN = (15.0, 20.0)      # E  8-vCPU serial heavy job, see the proxy benchmark
PC_SUITE_MIN = 8.1           # M  full Agent suite, 8 workers, owner's PC
PC_WATTS = 120.0             # E  above idle; the sampler saw about 2.2 of 8 pinned threads busy
PC_WATTS_HIGH = 225.0        # E
PC_RAIL_WATTS = 30.0         # E  a rail is one or two threads
KWH_USD = 0.1816             # P  EIA US residential average, Aug 2026; the owner's own rate is unknown
KWH_USD_HIGH = 0.35          # E  a high-cost state
MAINT_HOURS = {"A": 0.5, "B1": 3.0, "B2": 4.0, "C": 1.5, "D": 4.0}  # E per month, excluding the one-off build
MAINT_USD_HOUR = 25.0        # E  placeholder; the owner should set this
OUTAGE_DAYS = 3.0            # E  VPS down at Nov-5 pace, switched to hosted by hand. No automatic fallback.
WEEKDAYS = 21.7              # E  per month
WATCHER_RUNS_DAY = (27.0, 14.0)    # E  every 15 or 30 min across 09:30-16:30 ET; each bills one minute
CATCH_UP_PROMOTES = 3.0      # M  crons that fire each weekday
NIGHTLY_HOSTED_LEFT = 10.0   # E  full-suite plan and publish stay hosted; the report-only shards move to the PC
NIGHTLY_MOVED_MIN = 381.0    # M  Nov 5 nightly minutes, less the hosted part
SCHEDULED_RAILS_MIN = 8.0    # M  Nov 5
DAYS = 30.0
TARGET_USD = 200.0           # owner: under $200/month total, GitHub plus infrastructure
BATCH_HOLD_MIN = 60.0        # E  the longest AUDIT's queue holds an Agent PR to fill a batch
QUEUE_CANCEL_MIN = 45.0      # AUDIT ruling 6

#: AUDIT rulings. Anything not named stays hosted: vite build args, notebook latency, clock parity, indicators security.
MOVABLE_RAILS = {"wisdom rails", "term018 guards", "Options Flow guard", "notebook bytes", "Notebook accessibility",
                 "preference allow-list", "flow-worker deploy coverage", "notebook budgets"}
CLOCK_PARITY = "Clock parity fixture"


@dataclass(frozen=True)
class Day:
    n_pr: float
    n_direct: float
    a_batch: float
    a_solo: float
    agent_pushes: float = 123.0  # M Nov 1-5 mean after the path-filter replay; only affects PC power and A

    def gates(self, k: float) -> float:
        return self.n_pr + self.n_direct + self.a_solo + self.a_batch / k

    def heavy_candidates(self, k: float) -> float:
        return self.a_solo + self.a_batch / k


def load() -> dict:
    return json.loads(INPUTS.read_text(encoding="utf-8"))


def job_minutes(shape: dict, needle: str) -> float:
    return sum(row["mean"] for name, row in shape["jobs"].items() if needle in name.lower())


def unit_costs(data: dict) -> dict:
    """Hosted minutes per job of work, all measured."""
    shape = data["gate_shape"]
    steps = data["steps"]
    rails = data["rails_nov5"]["master_by_workflow"]
    gates = sum(data["gate_kinds"]["by_day"]["2026-11-05"].values())
    movable = sum(val for name, val in rails.items() if name in MOVABLE_RAILS) / gates
    hosted = sum(val for name, val in rails.items() if name not in MOVABLE_RAILS) / gates
    heavy = (4 * job_minutes(shape, "browser tests") + job_minutes(shape, "equivalence rail")
             + job_minutes(shape, "pine runtime"))
    post_cut = 1.0 - data["post_leg"]["share_removed"]
    per_run = data["per_run_nov"]
    nov5 = data["nov"]["days"]["2026-11-05"]
    return {
        "heavy": heavy,
        "gate_whole": steps["gate_before_min"], "gate_split": steps["gate_after_min"],
        "verdict": job_minutes(shape, "verdict"),
        "promote": per_run["promote to production|workflow_run|success"]["mean"],
        "rails_hosted": hosted, "rails_movable": movable,
        "clock_parity": rails.get(CLOCK_PARITY, 0.0) / gates,
        "agent_run": per_run["agent ci|push|success"]["mean"] * post_cut,
        "pr_rails_per_gate": data["rails_nov5"]["by_event"]["pull_request"] / gates,
        "agent_min_per_push": nov5["min:agent"] / nov5["runs:agent"] * post_cut,
    }


def fixed_hosted_month(unit: dict, watcher_runs: float = WATCHER_RUNS_DAY[0]) -> float:
    return (WEEKDAYS * (CATCH_UP_PROMOTES * unit["promote"] + watcher_runs)
            + DAYS * (NIGHTLY_HOSTED_LEFT + SCHEDULED_RAILS_MIN))


def month_cost(arch: str, day: Day, unit: dict, k: float = 3.0, term: str = "1-month", storage: float = 0.33,
               gate_min: float = 20.0, self_hosted_rate: float = 0.0, watts: float = PC_WATTS,
               kwh: float = KWH_USD) -> dict:
    """One 30-day month of `day`, plus the fixed items, under the rulings."""
    gates = day.gates(k)
    heavy = day.heavy_candidates(k)
    candidates = heavy + day.n_pr
    rail_runs = gates + candidates        # the full named set: once at the candidate, again on the master push
    if arch == "A":
        # Today: nothing moved, nothing batched, no candidate run; PR pushes and every Agent push run hosted.
        merges = day.n_pr + day.n_direct + day.a_solo + day.a_batch
        per_day = (merges * (unit["heavy"] + unit["gate_whole"] + unit["verdict"] + unit["promote"]
                             + unit["rails_hosted"] + unit["rails_movable"] + unit["pr_rails_per_gate"])
                   + day.agent_pushes * unit["agent_min_per_push"] + SCHEDULED_RAILS_MIN + NIGHTLY_MOVED_MIN
                   + NIGHTLY_HOSTED_LEFT)
        hosted_month = per_day * DAYS + WEEKDAYS * CATCH_UP_PROMOTES * unit["promote"]
        return finish(arch, hosted_month, 0.0, 0.0, 0.0, 0.0, 0.0, term, 0, storage, self_hosted_rate, watts, kwh)
    hosted = gates * (unit["gate_split"] + unit["verdict"] + unit["promote"]) + rail_runs * unit["rails_hosted"]
    vps = 0.0
    aws_usd = 0.0
    aws_min = 0.0
    if arch in ("B1", "B2"):
        vps = (gates + heavy) * gate_min + rail_runs * unit["rails_movable"]
    elif arch == "C":
        hosted += (gates * (unit["heavy"] + unit["gate_whole"] - unit["gate_split"]) + heavy * unit["agent_run"]
                   + rail_runs * unit["rails_movable"])
    elif arch == "D":
        hosted += gates + rail_runs * unit["rails_movable"]     # one launcher minute per gate
        aws_min = (gates + heavy) * (gate_min + AWS_BOOT_MIN) * (1 + AWS_INTERRUPT_RERUN)
        aws_usd = aws_min / 60 * (AWS_SPOT_HOUR + AWS_IPV4_HOUR)
    pc_suite = day.agent_pushes * PC_SUITE_MIN + NIGHTLY_MOVED_MIN
    pc_rail = gates * unit["pr_rails_per_gate"]
    count = {"B1": 1, "B2": 2}.get(arch, 0)
    hosted_month = hosted * DAYS + fixed_hosted_month(unit)
    return finish(arch, hosted_month, vps * DAYS, pc_suite * DAYS, pc_rail * DAYS, aws_usd * DAYS, aws_min * DAYS,
                  term, count, storage, self_hosted_rate, watts, kwh)


def finish(arch: str, hosted: float, vps_min: float, pc_min: float, pc_rail_min: float, aws_usd: float, aws_min: float,
           term: str, count: int, storage: float, rate: float, watts: float, kwh: float) -> dict:
    hosted_usd = hosted * HOSTED_RATE
    net = max(0.0, hosted_usd - INCLUDED_USD)
    vps_usd = VPS_TERMS[term] * EUR_USD * count
    power = (pc_min / 60 * watts + pc_rail_min / 60 * PC_RAIL_WATTS) / 1000 * kwh
    self_min = vps_min + pc_min + pc_rail_min + aws_min
    total = net + vps_usd + power + aws_usd + storage + self_min * rate
    return {"hosted_min": hosted, "hosted_usd": hosted_usd, "vps_min": vps_min, "aws_min": aws_min, "net_hosted": net, "vps_usd": vps_usd, "aws_usd": aws_usd,
            "power_usd": power, "surcharge": self_min * rate, "self_min": self_min, "total": total,
            "maint_hours": MAINT_HOURS[arch], "total_with_maint": total + MAINT_HOURS[arch] * MAINT_USD_HOUR}


def blend(profile: dict, mix: dict) -> Day:
    days = sum(mix.values())
    return Day(*(sum(getattr(profile[key], name) * count for key, count in mix.items()) / days
                 for name in ("n_pr", "n_direct", "a_batch", "a_solo", "agent_pushes")))


def profiles(data: dict) -> dict:
    by_day = data["gate_kinds"]["by_day"]
    span = [by_day[f"2026-11-0{index}"] for index in range(1, 6)]

    def mean(kind: str) -> float:
        return sum(row.get(kind, 0) for row in span) / len(span)

    keep = 1.0 - data["filter_replay"]["skip_rate_upper_bound"]
    nov5 = by_day["2026-11-05"]
    oct_mean = statistics.fmean(val.get("runs:gate", 0.0) for val in data["oct"]["days"].values())
    pr_share = mean("non-agent-pr") / (mean("non-agent-pr") + mean("non-agent-direct"))
    return {
        "nov15": Day(mean("non-agent-pr"), mean("non-agent-direct"), mean("agent-batchable"), mean("agent-solo")),
        "nov5": Day(nov5.get("non-agent-pr", 0), nov5.get("non-agent-direct", 0), nov5.get("agent-batchable", 0),
                    nov5.get("agent-solo", 0), data["nov"]["days"]["2026-11-05"]["runs:agent"] * keep),
        "oct": Day(oct_mean * pr_share, oct_mean * (1 - pr_share), 0.0, 0.0, 0.0),
    }


MONTHS = {
    "Normal (Nov 1-5 mean, 34.2 merges/day)": {"nov15": 30},
    "October pace, no Agent merges (25.7/day)": {"oct": 30},
    "Mixed (6 Nov-5 days)": {"nov5": 6, "nov15": 24},
    "Sustained busy (22 Nov-5 days)": {"nov5": 22, "nov15": 8},
    "Every day Nov 5 (54/day)": {"nov5": 30},
}


def simulate(arrivals: list, service: float, servers: int = 1, hold: float = 0.0, step: float = 0.25) -> dict:
    """Replay real arrivals through the serial heavy slot. Every Agent PR gets a heavy merge-candidate run, then a gate
    once it passes. Up to 3 batchable PRs share one candidate and one gate. A non-Agent arrival is a gate at once.
    `hold` is how long a lone batchable PR may wait for company; 0 means batches form only from what is waiting."""
    pending = sorted(arrivals)
    held: list[float] = []
    queue: list[tuple[float, str, list[float]]] = []    # enqueued, kind, the arrivals it carries
    busy: list[tuple[float, str, list[float]] | None] = [None] * servers
    waits: list[float] = []
    gate_waits: list[float] = []
    latency: list[float] = []
    counts = {"gate": 0, "candidate": 0}
    t = 0.0
    last = 0.0
    while pending or held or queue or any(busy):
        while pending and pending[0][0] * 60 <= t:
            at, kind = pending.pop(0)
            minute = at * 60
            if kind == "agent-batchable":
                held.append(minute)
            elif kind == "agent-solo":
                queue.append((minute, "candidate", [minute]))
            else:
                queue.append((minute, "gate", []))
        idle = any(slot is None for slot in busy)
        if held and (len(held) >= 3 or (hold > 0.0 and t - held[0] >= hold) or (hold == 0.0 and idle)):
            queue.append((t, "candidate", held[:3]))     # no GitHub run exists while the merge queue holds a PR
            del held[:3]
        for index, slot in enumerate(busy):
            if slot is not None and slot[0] <= t:
                end, kind, carried = slot
                busy[index] = None
                last = max(last, end)
                if kind == "candidate":
                    queue.append((end, "gate", carried))
                else:
                    latency.extend(end - minute for minute in carried)
        queue.sort(key=lambda row: row[0])
        for index, slot in enumerate(busy):
            if slot is None and queue:
                enqueued, kind, carried = queue.pop(0)
                waits.append(t - enqueued)
                if kind == "gate":
                    gate_waits.append(t - enqueued)
                counts[kind] += 1
                busy[index] = (t + service, kind, carried)
        t += step
    ordered = sorted(waits)
    return {
        "gates": counts["gate"], "candidates": counts["candidate"], "jobs": len(waits),
        "busy_hours": len(waits) * service / 60, "drained_hours": last / 60,
        "wait_p50": statistics.median(waits), "wait_p95": ordered[max(0, int(len(ordered) * 0.95) - 1)],
        "wait_max": max(waits), "over_45": sum(wait > QUEUE_CANCEL_MIN for wait in gate_waits),
        "agent_latency_p95": sorted(latency)[max(0, int(len(latency) * 0.95) - 1)] if latency else 0.0,
    }


def limit_scale(day: Day, unit: dict, k: float, term: str, budget: float = TARGET_USD, with_maint: bool = False,
                arch: str = "B1") -> float:
    """The multiple of `day` (merge counts scaled together) at which the month costs `budget`."""
    low, high = 0.0, 50.0
    field = "total_with_maint" if with_maint else "total"
    for _ in range(50):
        mid = (low + high) / 2
        scaled = Day(day.n_pr * mid, day.n_direct * mid, day.a_batch * mid, day.a_solo * mid, day.agent_pushes)
        low, high = (mid, high) if month_cost(arch, scaled, unit, k, term)[field] < budget else (low, mid)
    return low


def run() -> dict:
    data = load()
    unit = unit_costs(data)
    prof = profiles(data)
    storage = data["artifact_month_usd"]
    results: dict = {"unit": unit, "days": {key: vars(val) for key, val in prof.items()}, "months": {}, "limits": {},
                     "queues": {}, "grid": {}, "items": {}}
    for label, mix in MONTHS.items():
        day = blend(prof, mix)
        rows: dict = {"A": {"today": month_cost("A", day, unit, storage=storage)},
                      "C": {"k3": month_cost("C", day, unit, 3.0, storage=storage)},
                      "D": {"k3": month_cost("D", day, unit, 3.0, storage=storage)}}
        for arch in ("B1", "B2"):
            rows[arch] = {f"k{k:.0f} {term}": month_cost(arch, day, unit, k, term, storage)
                          for k in (1.0, 3.0) for term in VPS_TERMS}
        results["months"][label] = rows
    normal = prof["nov15"]
    busy = prof["nov5"]
    per_day = (month_cost("C", busy, unit, 3.0)["hosted_usd"] - month_cost("B1", busy, unit, 3.0)["hosted_usd"]) / DAYS
    results["items"] = {
        "outage_3_days_nov5_pace": per_day * OUTAGE_DAYS,
        "watcher_15_min": WATCHER_RUNS_DAY[0] * WEEKDAYS * HOSTED_RATE,
        "watcher_30_min": WATCHER_RUNS_DAY[1] * WEEKDAYS * HOSTED_RATE,
        "clock_parity_upside_normal": unit["clock_parity"] * 2 * normal.gates(3.0) * DAYS * HOSTED_RATE,
        "fixed_hosted_month": fixed_hosted_month(unit) * HOSTED_RATE,
        "one_gate_a_day_for_a_month": (unit["gate_split"] + unit["verdict"] + unit["promote"] + unit["rails_hosted"])
        * HOSTED_RATE * DAYS,
        "one_candidate_a_day_for_a_month": unit["rails_hosted"] * HOSTED_RATE * DAYS,
    }
    results["sensitivity"] = {
        name: {key: month_cost("B1", blend(prof, mix), unit, 3.0, "24-month", storage, **kwargs)["total"]
               for key, mix in MONTHS.items()}
        for name, kwargs in (("future_002", {"self_hosted_rate": SELF_HOSTED_FUTURE}),
                             ("power_high", {"watts": PC_WATTS_HIGH, "kwh": KWH_USD_HIGH}))
    }
    results["sensitivity"]["future_002_vps_only"] = {
        key: (row := month_cost("B1", blend(prof, mix), unit, 3.0, "24-month", storage))["total"]
        + row["vps_min"] * SELF_HOSTED_FUTURE for key, mix in MONTHS.items()}
    replay = simulate(data["gate_kinds"]["nov5_arrivals"], 20.0, 1, BATCH_HOLD_MIN)
    batched = replay["candidates"] - int(busy.a_solo)
    results["replay_k"] = busy.a_batch / batched
    results["nov5_at_replay_k"] = {
        f"{arch} {term}": month_cost(arch, busy, unit, results["replay_k"], term, storage)["total"]
        for arch in ("B1", "B2") for term in VPS_TERMS}
    results["limits_by_vps"] = {
        f"{arch} {term}": limit_scale(normal, unit, 3.0, term, arch=arch) * normal.gates(3.0)
        for arch in ("B1", "B2") for term in VPS_TERMS}
    share = normal.n_pr / (normal.n_pr + normal.n_direct)
    non_agent_only = Day(share, 1 - share, 0.0, 0.0, normal.agent_pushes)
    for term in VPS_TERMS:
        for k in (1.0, 3.0):
            scale = limit_scale(normal, unit, k, term)
            results["limits"][f"{term}, batch {k:.0f}"] = {
                "all_non_agent": limit_scale(non_agent_only, unit, k, term),
                "nov_mix_scale": scale, "nov_mix_gates": scale * normal.gates(k),
                "nov_mix_merges": scale * (normal.n_pr + normal.n_direct + normal.a_batch + normal.a_solo),
            }
        scale = limit_scale(normal, unit, 3.0, term, with_maint=True)
        results["limits"][f"{term}, batch 3, with maintenance"] = {
            "all_non_agent": limit_scale(non_agent_only, unit, 3.0, term, with_maint=True),
            "nov_mix_scale": scale, "nov_mix_gates": scale * normal.gates(3.0),
            "nov_mix_merges": scale * (normal.n_pr + normal.n_direct + normal.a_batch + normal.a_solo),
        }
    agent_solo = normal.a_solo / (normal.a_solo + normal.a_batch)
    for non_agent in (0, 5, 10, 15, 20, 25, 30):
        for agent in (0, 9, 18, 29):
            day = Day(non_agent * share, non_agent * (1 - share), agent * (1 - agent_solo), agent * agent_solo,
                      normal.agent_pushes)
            results["grid"][f"{non_agent}|{agent}"] = month_cost("B1", day, unit, 3.0, "24-month", storage)["total"]
    arrivals = data["gate_kinds"]["nov5_arrivals"]
    for service in GATE_MIN:
        for servers in (1, 2):
            for hold, tag in ((0.0, "no hold"), (BATCH_HOLD_MIN, "60-min hold")):
                results["queues"][f"{servers} VPS, {service:.0f} min, {tag}"] = simulate(arrivals, service, servers, hold)
    return results


def render(results: dict) -> str:
    out = ["Unit minutes: " + ", ".join(f"{key} {val:.2f}" for key, val in results["unit"].items()),
           "Days: " + json.dumps({key: {k: round(v, 1) for k, v in val.items()} for key, val in results["days"].items()}), ""]
    out += ["### USD per month, cash, every ruling applied", "",
            "| Month | A today | C no VPS | D AWS spot | 1 VPS, no batching, 1-mo | 1 VPS, batch 3, 1-mo | 12-mo | 24-mo "
            "| 2 VPS, batch 3, 1-mo | 12-mo | 24-mo |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for label, rows in results["months"].items():
        one = rows["B1"]
        out.append(f"| {label} | {rows['A']['today']['total']:,.0f} | {rows['C']['k3']['total']:,.0f} | {rows['D']['k3']['total']:,.0f} | "
                   f"{one['k1 1-month']['total']:,.0f} | {one['k3 1-month']['total']:,.0f} | {one['k3 12-month']['total']:,.0f} | "
                   f"{one['k3 24-month']['total']:,.0f} | {rows['B2']['k3 1-month']['total']:,.0f} | "
                   f"{rows['B2']['k3 12-month']['total']:,.0f} | {rows['B2']['k3 24-month']['total']:,.0f} |")
    out += ["", "### 1 VPS, batch 3, 24-month: USD by non-Agent gates and Agent PRs per day", "",
            "| Non-Agent gates/day | 0 Agent | 9 Agent | 18 Agent | 29 Agent |", "|---|---|---|---|---|"]
    for non_agent in (0, 5, 10, 15, 20, 25, 30):
        cells = " | ".join(f"{results['grid'][f'{non_agent}|{agent}']:,.0f}" for agent in (0, 9, 18, 29))
        out.append(f"| {non_agent} | {cells} |")
    out += ["", "### Gates a day under the target, cash", "",
            "| VPS term, batching | All non-Agent | Nov mix: gates after batching | Nov mix: merges | Share of Nov 1-5 |", "|---|---|---|---|---|"]
    for name, row in results["limits"].items():
        out.append(f"| {name} | {row['all_non_agent']:.1f} | {row['nov_mix_gates']:.1f} | {row['nov_mix_merges']:.1f} | {row['nov_mix_scale']:.0%} |")
    out += ["", "### Nov 5 replay, heavy jobs on the serial slot", "",
            "| Case | Gates | Candidates | Busy h | Drained h | Wait p50 | p95 | Max | Over 45 min | Agent merge p95 min |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for name, row in results["queues"].items():
        out.append(f"| {name} | {row['gates']} | {row['candidates']} | {row['busy_hours']:.1f} | {row['drained_hours']:.1f} | "
                   f"{row['wait_p50']:.0f} | {row['wait_p95']:.0f} | {row['wait_max']:.0f} | {row['over_45']} | {row['agent_latency_p95']:.0f} |")
    out += ["", f"Replay batch size at a 60-min hold: {results['replay_k']:.2f}; every-day-Nov-5 month at that size: "
            + json.dumps({key: round(val) for key, val in results["nov5_at_replay_k"].items()})]
    out += ["Gates a day at the target, batch 3: " + json.dumps({key: round(val, 1) for key, val in results["limits_by_vps"].items()})]
    out += ["", "Items: " + ", ".join(f"{key} ${val:.2f}" for key, val in results["items"].items())]
    out += ["Sensitivity, 1 VPS batch 3 24-mo: " + json.dumps(
        {key: {k: round(v) for k, v in row.items()} for key, row in results["sensitivity"].items()})]
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
