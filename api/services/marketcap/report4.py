"""PRODUCTION -> V1 FIRST SHADOW -> V1 CORRECTED SHADOW -> V1 FINAL ADJUDICATED, from three universe audits, three
magnitude scans and the final adjudication summary.

    python -m api.services.marketcap.report4 --audits A1.json A2.json A3.json --scans S1.json S2.json S3.json \
        --history-adj H2.json H3.json --adjudication adjudication_summary.json --out four_columns.json
"""
from __future__ import annotations

import argparse
import json

from .report3 import COHORTS, METRICS

COLS = ("first_v1", "corrected_v1", "final_adjudicated_v1")


def run(audits: list, scans: list, hist: list, adj: dict | None, cols: tuple = COLS) -> dict:
    COLS = tuple(cols)
    out = {"columns": ("production",) + COLS, "cohorts": {}}
    for c in COHORTS:
        if not all(c in a.get("cohorts", {}) for a in audits):
            continue
        out["cohorts"][c] = {m: {"production": audits[0]["cohorts"][c]["before"].get(m),
                                 **{k: a["cohorts"][c]["v1"].get(m) for k, a in zip(COLS, audits)}} for m in METRICS}
    out["unexplained"] = {k: a.get("unexplained") for k, a in zip(COLS, audits)}

    def tenx(s):
        bc = s.get("by_class", {})
        return {"all_10x_outliers_vs_massive": sum(bc.values()), **bc}
    out["ten_x_current_vs_massive"] = {k: tenx(s) for k, s in zip(COLS, scans)}
    out["ten_x_history_vs_production_sessions"] = {k: s.get("history_10x_vs_production", {}).get("sessions") for k, s in zip(COLS, scans)}
    out["history_adjudication"] = {k: (h or {}).get("verdict_sessions", (h or {}).get("by_verdict")) for k, h in zip(COLS[1:], hist)}
    out["adjudication"] = adj
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audits", nargs=3, required=True)
    ap.add_argument("--scans", nargs=3, required=True)
    ap.add_argument("--history-adj", nargs=2, required=True)
    ap.add_argument("--adjudication")
    ap.add_argument("--labels", nargs=3, default=list(COLS))
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    L = lambda p: json.load(open(p))
    res = run([L(p) for p in a.audits], [L(p) for p in a.scans], [L(p) for p in a.history_adj],
              L(a.adjudication) if a.adjudication else None, a.labels)
    json.dump(res, open(a.out, "w"), indent=1)
    for c, ms in res["cohorts"].items():
        print(c, {m: tuple(v.values()) for m, v in ms.items()
                  if m in ("zero_history", "complete_inception", "current_available", "missing_sessions", "median_coverage",
                           "internal_gap_rate")})
    print("10x current", res["ten_x_current_vs_massive"])
    print("10x history sessions", res["ten_x_history_vs_production_sessions"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
