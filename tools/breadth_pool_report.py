"""Report a breadth reader sampling pool: p50, p95 with an EXACT CI, and why n >= 59.

    python tools/breadth_pool_report.py                 # the default pool
    python tools/breadth_pool_report.py --self-check

⛔ A POOL IS A POPULATION, NOT A FILE. Rows are only comparable when they came from the
same deployed code on the same reader configuration, so this groups by
(sha, flag_observed) and refuses to pool across groups silently. `flag_observed` is read
from the pod's OWN phase keys, never from what the operator believed was set.

⭐ WHY 59. The largest value in a sample of n exceeds the true 95th percentile with
probability 1 - 0.95^n. At n = 20 that is only 64% — a p95 "estimate" there is mostly the
sampler's luck. At n = 59, 1 - 0.95^59 = 95.3%, which is the first n at which the sample
maximum bounds the p95 at 95% confidence. Below 59 this prints NOT ESTIMABLE and says how
many more rows are needed, rather than printing a number that reads like a measurement.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import statistics
import sys

DEFAULT_POOL = pathlib.Path("C:/Users/Patrick/uct-breadth-pool/breadth-samples.jsonl")
P95_N_FOR_95PC_CONFIDENCE = 59
ANALYSIS_UPTIME_FLOOR = 600

#: Timing keys that are COUNTS or BYTES, not milliseconds. Ranking these beside real
#: phases reports a counter as a duration. Listed explicitly: a pattern guess ("anything
#: starting io_") missed rf_bytes, rf_rows and rf_stmts on the first attempt.
NON_DURATION_KEYS = frozenset({
    "io_rchar", "io_read_bytes", "io_syscr", "merged_dates",
    "rf_bytes", "rf_busy_retries", "rf_conn_reused", "rf_pagecache",
    "rf_rows", "rf_stmts",
})
COLLECTION_UPTIME_FLOOR = 300


def load(path: pathlib.Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def deep_ok(rows):
    return [r for r in rows if r.get("ok") and r.get("kind") == "deep_cold"
            and isinstance(r.get("timing"), dict)
            and isinstance(r["timing"].get("total"), (int, float))]


def spearman(xs, ys) -> float | None:
    """Rank correlation without scipy. None when it cannot be computed."""
    n = len(xs)
    if n < 3:
        return None

    def ranks(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return None if den == 0 else num / den


def p95_with_confidence(values: list[float]) -> dict:
    """The sample max bounds the p95 at 1 - 0.95^n confidence. Honest below n=59."""
    n = len(values)
    s = sorted(values)
    conf = 1.0 - 0.95 ** n if n else 0.0
    out = {"n": n, "max": s[-1] if s else None, "confidence": conf,
           "estimable": n >= P95_N_FOR_95PC_CONFIDENCE,
           "need_more": max(0, P95_N_FOR_95PC_CONFIDENCE - n)}
    if s:
        idx = min(n - 1, max(0, math.ceil(0.95 * n) - 1))
        out["p95_point"] = s[idx]
    return out


def uptime_effect(rows) -> dict:
    """SD-1.7 H0.2: is a >=300 s row comparable to a >=600 s row, or not?"""
    xs = [r.get("uptime_s") or 0 for r in rows]
    ys = [r["timing"]["total"] for r in rows]
    rho = spearman(xs, ys)
    lo = [r["timing"]["total"] for r in rows
          if COLLECTION_UPTIME_FLOOR <= (r.get("uptime_s") or 0) < ANALYSIS_UPTIME_FLOOR]
    hi = [r["timing"]["total"] for r in rows
          if (r.get("uptime_s") or 0) >= ANALYSIS_UPTIME_FLOOR]
    res = {"rho": rho, "n_300_600": len(lo), "n_ge600": len(hi),
           "median_300_600": statistics.median(lo) if lo else None,
           "median_ge600": statistics.median(hi) if hi else None}
    if res["median_300_600"] is not None and res["median_ge600"]:
        res["pct_diff"] = abs(res["median_300_600"] - res["median_ge600"]) / res["median_ge600"] * 100
    else:
        res["pct_diff"] = None
    # The rule is a CONJUNCTION and needs both buckets populated; anything short of that
    # is "cannot tell", which must not read as "no effect".
    res["no_effect_provable"] = bool(
        rho is not None and abs(rho) < 0.3
        and res["pct_diff"] is not None and res["pct_diff"] < 20
        and len(lo) >= 8 and len(hi) >= 8)
    return res


def describe(group_rows, label) -> dict:
    vals = [r["timing"]["total"] for r in group_rows]
    s = sorted(vals)
    p95 = p95_with_confidence(vals)
    phases = collections.Counter()
    for r in group_rows:
        for k in (r.get("phase_keys") or list(r.get("timing") or {})):
            phases[k] += 1
    # Mean time per phase, for the floor question.
    # ⛔ NOT EVERY TIMING KEY IS A DURATION. `rf_bytes` is a byte count, `rf_rows` a row
    # count, `io_syscr` a syscall count. The first version of this ranked them beside real
    # phases and duly reported "rf_bytes=4523328.0 ms" as the heaviest phase — a counter
    # presented as a measurement, which is the false-instrument class this programme keeps
    # finding. The exclusion list is explicit and named rather than pattern-guessed.
    means = {}
    for k in phases:
        if k in NON_DURATION_KEYS:
            continue
        xs = [r["timing"][k] for r in group_rows
              if isinstance(r.get("timing", {}).get(k), (int, float))]
        if xs:
            means[k] = statistics.fmean(xs)
    return {"label": label, "n": len(vals),
            "p50": statistics.median(s) if s else None,
            "min": s[0] if s else None, "max": s[-1] if s else None,
            "p95": p95, "phase_means": means,
            "uptime": uptime_effect(group_rows)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=str(DEFAULT_POOL))
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    rows = deep_ok(load(pathlib.Path(a.pool)))
    if not rows:
        print("no usable rows -- an empty pool is a failed read until proven otherwise")
        return 2

    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r.get("sha"), r.get("flag_observed"))].append(r)

    print(f"pool: {a.pool}")
    print(f"usable deep_cold rows: {len(rows)}   groups: {len(groups)}\n")
    for key, g in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        d = describe(g, f"sha={key[0]} flag={key[1]}")
        print(f"=== {d['label']}  n={d['n']} ===")
        print(f"  p50 {d['p50']:.1f} ms   min {d['min']:.1f}   max {d['max']:.1f}")
        p = d["p95"]
        if p["estimable"]:
            print(f"  p95 <= {p['max']:.1f} ms at {p['confidence']*100:.1f}% confidence (n={p['n']})")
        else:
            print(f"  p95 NOT ESTIMABLE at n={p['n']} "
                  f"(sample max bounds p95 at only {p['confidence']*100:.0f}% confidence; "
                  f"need {p['need_more']} more rows for 95%)")
            if p.get("p95_point"):
                print(f"      point estimate {p['p95_point']:.1f} ms -- descriptive only, not a bound")
        u = d["uptime"]
        rho_s = "n/a" if u["rho"] is None else f"{u['rho']:+.2f}"
        print(f"  uptime: rho={rho_s}  n(300-600)={u['n_300_600']}  n(>=600)={u['n_ge600']}"
              + (f"  medians {u['median_300_600']:.1f}/{u['median_ge600']:.1f} "
                 f"({u['pct_diff']:.1f}% apart)" if u["pct_diff"] is not None else ""))
        print(f"  no uptime effect provable: {u['no_effect_provable']}")
        top = sorted(d["phase_means"].items(), key=lambda kv: -kv[1])[:6]
        print("  heaviest phases (mean ms): "
              + ", ".join(f"{k}={v:.1f}" for k, v in top if not k.startswith("io_")))
        print()
    return 0


def self_check() -> int:
    ok = True
    # n=59 is the first n at which the sample max bounds p95 at >=95%.
    if not (p95_with_confidence([1.0] * 58)["estimable"] is False
            and p95_with_confidence([1.0] * 59)["estimable"] is True):
        print("FAIL: the n>=59 boundary is wrong"); ok = False
    c58 = 1 - 0.95 ** 58
    c59 = 1 - 0.95 ** 59
    if not (c58 < 0.95 <= c59):
        print(f"FAIL: confidence maths ({c58:.4f}, {c59:.4f})"); ok = False
    # Spearman recovers a known monotone relationship and a known null.
    if not (spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) > 0.99):
        print("FAIL: spearman on a monotone pair"); ok = False
    if abs(spearman([1, 2, 3, 4], [3, 1, 4, 2])) > 0.9:
        print("FAIL: spearman on a scrambled pair"); ok = False
    # A one-sided bucket must NOT read as "no effect".
    u = uptime_effect([{"uptime_s": 900, "timing": {"total": 100.0}} for _ in range(20)])
    if u["no_effect_provable"]:
        print("FAIL: an absent 300-600 bucket must not prove absence of an effect"); ok = False
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
