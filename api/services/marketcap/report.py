"""Coverage / validation report over one build (Gate H).

    python -m api.services.marketcap.report --build builds/MCAP_V1-....db [--baseline mc_sim.json] --out report.json

Two coverage definitions (owner ruling):
  ABSOLUTE INCEPTION     valued days / legitimate listed days (first legitimate issuer trading day -> present)
  AUTHORITATIVE EVIDENCE valued days / days from the first valued day -> present
Every non-valued listed day carries exactly one reason code; `unexplained` counts BUG / missing reasons.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict

BUCKETS = [("100%", 1.0, 1.0001), ("99-<100", 0.99, 1.0), ("95-<99", 0.95, 0.99), ("75-<95", 0.75, 0.95),
           ("50-<75", 0.5, 0.75), ("<50", 1e-9, 0.5), ("0%", -1, 1e-9)]
GOLDEN = ["ARM", "AMD", "MU", "AAPL", "KO", "NVDA", "META", "GOOG", "GOOGL", "ABNB", "PLTR", "COIN", "SHOP", "V",
          "TSM", "SONY", "TM", "SAP", "NVS", "BRK-B", "BRK-A", "RIO", "GSK", "SHEL", "BABA", "ASML", "HSBC"]


def bucket(x: float | None) -> str:
    if x is None:
        return "none"
    for name, lo, hi in BUCKETS:
        if lo <= x < hi:
            return name
    return "none"


def run(build: str) -> dict:
    db = sqlite3.connect(build)
    man = dict(db.execute("SELECT key, value FROM manifest"))
    rows = db.execute("SELECT cik, primary_ticker, foreign_filer, first_bar, listing_start, first_value, last_day, listed_days, "
                      "valued_days, evidence_span_days, evidence_span_valued, internal_gap_days, unexplained_days, structure, reasons "
                      "FROM coverage").fetchall()
    out = {"build": man.get("build_id"), "issuers_with_coverage": len(rows), "bugs": {k: v for k, v in man.items() if k.startswith("bug:")}}
    for cohort, flag in (("foreign", 1), ("domestic", 0)):
        sub = [r for r in rows if r[2] == flag]
        out[cohort] = {
            "issuers": len(sub),
            "absolute_inception": dict(Counter(bucket(r[8] / r[7] if r[7] else None) for r in sub)),
            "authoritative_evidence": dict(Counter(bucket(r[10] / r[9] if r[9] else None) for r in sub)),
            "internal_gap_issuers": sum(1 for r in sub if r[11]),
            "internal_gap_days": sum(r[11] for r in sub),
            "unexplained_days": sum(r[12] for r in sub),
            "listed_days": sum(r[7] for r in sub), "valued_days": sum(r[8] for r in sub),
        }
    reasons = Counter()
    internal = Counter()
    for r in rows:
        for k, v in json.loads(r[14] or "{}").items():
            reasons[k] += v
    for cik, s, e, reason, n in db.execute("SELECT g.cik, g.start, g.end, g.reason, g.n_days FROM gap_run g JOIN coverage c ON c.cik=g.cik "
                                           "WHERE c.first_value IS NOT NULL AND g.start > CAST(REPLACE(c.first_value,'-','') AS INTEGER)"):
        internal[reason] += n
    out["reason_days_all_listed"] = dict(reasons.most_common())
    out["internal_gap_reason_days"] = dict(internal.most_common())
    out["structures"] = dict(Counter(s for r in rows for s in json.loads(r[13] or "[]")).most_common())
    g = {}
    for t in GOLDEN:
        r = next((x for x in rows if x[1] == t), None)
        if r is None:
            g[t] = None
            continue
        last = db.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (r[0],)).fetchone()
        g[t] = {"cik": r[0], "listing_start": r[4], "first_value": r[5], "absolute": round(r[8] / r[7], 4) if r[7] else None,
                "evidence": round(r[10] / r[9], 4) if r[9] else None, "internal_gaps": r[11], "structure": json.loads(r[13]),
                "last_cap": last, "reasons": json.loads(r[14])}
    out["golden"] = g
    pre = [r for r in rows if json.loads(r[14] or "{}").get("PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE")]
    out["pre_edgar"] = {"issuers": len(pre),
                        "days": sum(json.loads(r[14])["PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"] for r in pre),
                        "by_first_bar_decade": dict(Counter((r[3] or "")[:3] + "0s" for r in pre))}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.build)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: res[k] for k in ("build", "issuers_with_coverage", "foreign", "domestic")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
