#!/usr/bin/env python3
"""Merge the two Options Flow validation-gate datasets into one report.

INPUT 1 -- the scheduled cloud run's ledger sample: rolls_steady[] rows as
           returned by /api/flow/aggregate-health.
INPUT 2 -- the locally collected authenticated member-path page loads.

⛔ IT NEVER INVENTS A CELL. Every statistic prints its own n, an absent field
prints UNAVAILABLE, and a percentage is never shown without the counts it came
from. `bucket_bound_s` is carried through but is DIAGNOSTIC-ONLY and is never
reduced to a point estimate -- it is a bound, and the one time this programme
treated it as a measurement it overstated its own numbers by an unknown 0-60 s.

⛔ IT REFUSES TO MIX THE TWO POPULATIONS. Startup rolls are excluded from every
steady-state statistic by construction rather than by a filter the caller may
forget, and a row carrying no `kind` is REFUSED rather than assumed steady.

⛔ QUANTILES ARE NEAREST-RANK, NOT INTERPOLATED. With a handful of rolls an
interpolated p95 reports a number no roll produced, which is precisely the
"predictions filling missing cells" this gate forbids.

Usage:
    python tools/flow_gate_merge.py --rolls rolls.json --loads loads.json
    python tools/flow_gate_merge.py --rolls rolls.json --json
"""
import argparse
import json
import sys

STEADY = "steady_state_roll"
STARTUP = "startup_catchup"
UNAVAILABLE = "UNAVAILABLE"


def _pct(numer, denom):
    """A percentage NEVER appears without the counts behind it."""
    if not denom:
        return "%s (n=0)" % UNAVAILABLE
    return "%.1f%% (%d/%d)" % (100.0 * numer / denom, numer, denom)


def _quantiles(values, name):
    """p50/p95/max over the values actually present. Missing is not zero."""
    vals = sorted(v for v in values if isinstance(v, (int, float))
                  and not isinstance(v, bool))
    n = len(vals)
    if n == 0:
        return {"field": name, "n": 0, "p50": UNAVAILABLE,
                "p95": UNAVAILABLE, "max": UNAVAILABLE}

    def q(p):
        k = max(1, min(n, int(round(p * n + 0.5))))
        return vals[k - 1]

    return {"field": name, "n": n, "p50": q(0.50), "p95": q(0.95), "max": vals[-1]}


def split_rolls(rows):
    """Partition by the ledger's OWN classification, de-duplicated by version
    because the sampler polls and rows repeat across polls."""
    steady, startup, refused = [], [], []
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            refused.append({"row": r, "why": "not-an-object"})
            continue
        v = r.get("version")
        if v in seen:
            continue
        seen.add(v)
        kind = r.get("kind")
        if kind == STEADY:
            steady.append(r)
        elif kind == STARTUP:
            startup.append(r)
        else:
            refused.append({"row": r, "why": "unclassified kind=%r" % (kind,)})
    return steady, startup, refused


def summarise_rolls(steady, startup, refused):
    out = {
        "steady_rolls_n": len(steady),
        "startup_rolls_excluded_n": len(startup),
        "refused_rows": refused,
        "observed_s": _quantiles([r.get("observed_s") for r in steady], "observed_s"),
        "prepare_ms": _quantiles([r.get("prepare_ms") for r in steady], "prepare_ms"),
        "handoff_ms": _quantiles([r.get("handoff_ms") for r in steady], "handoff_ms"),
        "pass2_skipped": _pct(sum(1 for r in steady if r.get("pass2_skipped")),
                              len(steady)),
        "bucket_bound_s_present_n": sum(
            1 for r in steady if isinstance(r.get("bucket_bound_s"), (int, float))),
        "observed_s_note": ("detector first sighting -> first-paint publication; "
                            "NOT exact detection latency"),
        "bucket_bound_s_note": "diagnostic-only bound; never a point estimate",
    }
    return out


def summarise_loads(loads):
    """Page loads carry their own classification. This deliberately does NOT
    derive a fallback RATE from them -- a handful of loads cannot establish one
    and the ledger sample owns that statistic."""
    if not loads:
        return {"loads_n": 0,
                "note": "%s - no member-path loads supplied" % UNAVAILABLE}
    counted = [l for l in loads if not l.get("excluded")]
    excluded = [l for l in loads if l.get("excluded")]
    prepared = [l for l in counted if l.get("classification") == "prepared"]
    fallback = [l for l in counted if l.get("classification") == "fallback"]
    other = [l for l in counted
             if l.get("classification") not in ("prepared", "fallback")]
    return {
        "loads_supplied_n": len(loads),
        "loads_counted_n": len(counted),
        "excluded_n": len(excluded),
        "excluded_reasons": sorted({str(l.get("excluded")) for l in excluded}),
        "prepared_n": len(prepared),
        "fallback_n": len(fallback),
        "unclassified_n": len(other),
        "raw_tape_incidence": _pct(len(fallback), len(prepared) + len(fallback)),
        "client_processFlowData_incidence": _pct(
            sum(1 for l in counted if l.get("client_processFlowData")), len(counted)),
        "first_paint_ms_prepared": _quantiles(
            [l.get("first_paint_ms") for l in prepared], "first_paint_ms(prepared)"),
        "first_paint_ms_fallback": _quantiles(
            [l.get("first_paint_ms") for l in fallback], "first_paint_ms(fallback)"),
        "note": ("incidence here describes THESE loads only; the ledger sample "
                 "owns the population rate"),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rolls", required=True,
                    help="JSON: a list of ledger rows, or the whole "
                         "aggregate-health object")
    ap.add_argument("--loads", help="JSON list of member-path load observations")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    a = ap.parse_args(argv)

    with open(a.rolls, encoding="utf-8") as fh:
        raw = json.load(fh)
    if isinstance(raw, dict):
        rows = list(raw.get("rolls_steady") or []) + list(raw.get("rolls_startup") or [])
    else:
        rows = raw
    steady, startup, refused = split_rolls(rows)

    loads = []
    if a.loads:
        with open(a.loads, encoding="utf-8") as fh:
            loads = json.load(fh)

    report = {"ledger": summarise_rolls(steady, startup, refused),
              "member_path": summarise_loads(loads)}

    if a.json:
        print(json.dumps(report, indent=2))
        return 0

    L = report["ledger"]
    print("=== OPTIONS FLOW GATE -- MERGED EVIDENCE ===")
    print()
    print("-- ledger (steady state only) --")
    print("  steady rolls sampled      %d" % L["steady_rolls_n"])
    print("  startup rolls EXCLUDED    %d" % L["startup_rolls_excluded_n"])
    if L["refused_rows"]:
        print("  REFUSED (unclassified)    %d  <- counted nowhere"
              % len(L["refused_rows"]))
    for k in ("observed_s", "prepare_ms", "handoff_ms"):
        q = L[k]
        print("  %-12s n=%-4d p50=%s p95=%s max=%s"
              % (q["field"], q["n"], q["p50"], q["p95"], q["max"]))
    print("  pass2_skipped             %s" % L["pass2_skipped"])
    print("  observed_s IS             %s" % L["observed_s_note"])
    print("  bucket_bound_s IS         %s" % L["bucket_bound_s_note"])
    print()
    print("-- authenticated member path --")
    for k, v in report["member_path"].items():
        print("  %-34s %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
