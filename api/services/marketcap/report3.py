"""PRODUCTION BEFORE -> V1 FIRST SHADOW -> V1 CORRECTED SHADOW, from two universe audits and two magnitude scans.

    python -m api.services.marketcap.report3 --first-audit A1.json --corrected-audit A2.json \
        --first-scan S1.json --corrected-scan S2.json --out three_columns.json
"""
from __future__ import annotations

import argparse
import json

METRICS = ("securities", "zero_history", "complete_inception", "current_available", "missing_sessions", "valued_sessions",
           "median_coverage", "internal_gap_rate", "internal_gap_securities", "internal_gap_sessions")
COHORTS = ("all", "domestic", "foreign", "adr", "multi_class", "ticker_reuse", "ipo_era", "pre_edgar", "unresolved_structure")


def run(a1: dict, a2: dict, s1: dict, s2: dict) -> dict:
    out = {"cohorts": {}}
    for c in COHORTS:
        if c not in a1.get("cohorts", {}) or c not in a2.get("cohorts", {}):
            continue
        out["cohorts"][c] = {m: {"before": a1["cohorts"][c]["before"].get(m), "first_v1": a1["cohorts"][c]["v1"].get(m),
                                 "corrected_v1": a2["cohorts"][c]["v1"].get(m)} for m in METRICS}
    out["unexplained"] = {"first_v1": a1.get("unexplained"), "corrected_v1": a2.get("unexplained")}

    def tenx(s):
        bc = s.get("by_class", {})
        return {"all_10x_outliers": sum(bc.values()), **bc}
    out["ten_x"] = {"first_v1": tenx(s1), "corrected_v1": tenx(s2),
                    "history_sessions_10x_vs_production": {"first_v1": s1.get("history_10x_vs_production", {}).get("sessions"),
                                                           "corrected_v1": s2.get("history_10x_vs_production", {}).get("sessions")}}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--first-audit", "--corrected-audit", "--first-scan", "--corrected-scan", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    L = lambda p: json.load(open(p))
    res = run(L(a.first_audit), L(a.corrected_audit), L(a.first_scan), L(a.corrected_scan))
    json.dump(res, open(a.out, "w"), indent=1)
    for c, ms in res["cohorts"].items():
        print(c, {m: (v["before"], v["first_v1"], v["corrected_v1"]) for m, v in ms.items()
                  if m in ("zero_history", "complete_inception", "current_available", "missing_sessions", "median_coverage", "internal_gap_rate")})
    print("10x", res["ten_x"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
