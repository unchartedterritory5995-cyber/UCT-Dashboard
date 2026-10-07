"""One machine-readable summary of the corrected shadow (everything the final report quotes).

    python -m api.services.marketcap.final_summary --reports C:/mcapdata/reports/CORRECTED --data C:/mcapdata --out summary.json
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
from collections import Counter


def run(reports: str, data: str) -> dict:
    L = lambda n: json.load(open(os.path.join(reports, n)))
    build = open(os.path.join(reports, "build_path.txt")).read().strip()
    B = sqlite3.connect(build)
    man = dict(B.execute("SELECT key, value FROM manifest"))
    out = {"build": build, "manifest": {k: v for k, v in man.items() if not k.startswith("bug:")}}
    # split evidence
    out["split_evidence"] = {
        "applied_splits": B.execute("SELECT COUNT(*), COUNT(DISTINCT cik) FROM split_gap WHERE status='APPLIED'").fetchone(),
        "applied_by_source": dict(B.execute("SELECT source, COUNT(*) FROM split_gap WHERE status='APPLIED' GROUP BY source").fetchall()),
        "held_gaps": dict((s, (n, c)) for s, n, c in B.execute("SELECT status, COUNT(*), COUNT(DISTINCT cik) FROM split_gap WHERE status LIKE 'HELD%' GROUP BY status")),
        "held_sessions_issuers": B.execute("SELECT SUM(n_days), COUNT(DISTINCT cik) FROM gap_run WHERE reason='HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED'").fetchone(),
        "applied_by_decade": dict(B.execute("SELECT substr(d,1,3)||'0s', COUNT(*) FROM split_gap WHERE status='APPLIED' GROUP BY 1").fetchall()),
    }
    sv = sqlite3.connect(os.path.join(data, "splitev.db"))
    out["split_evidence"]["evidence_store"] = {
        "statements_by_source": dict(sv.execute("SELECT CASE WHEN source LIKE 'XBRL%' THEN 'XBRL' ELSE source END, COUNT(*) FROM split_evidence GROUP BY 1").fetchall()),
        "issuers_with_evidence": sv.execute("SELECT COUNT(DISTINCT cik) FROM split_evidence").fetchone()[0],
        "text_documents_fetched": dict(sv.execute("SELECT status, COUNT(*) FROM text_done GROUP BY status").fetchall())}
    # lineage
    lin = sqlite3.connect(os.path.join(data, "lineage.db"))
    out["lineage"] = {
        "filings_classified": dict((f"{k}/{s}", n) for k, s, n in lin.execute("SELECT kind, status, COUNT(*) FROM lineage GROUP BY kind, status")),
        "successor_issuers": lin.execute("SELECT COUNT(DISTINCT succ_cik) FROM lineage").fetchone()[0],
        "applied_in_build": [dict(zip(("cik", "kind", "status", "effective", "pred_cik", "accn", "days", "note"), r))
                             for r in B.execute("SELECT * FROM lineage_applied")],
        "pure_resolved": [r for r in lin.execute("SELECT succ_cik, pred_cik, pred_name, effective FROM lineage WHERE kind='PURE_REORGANIZATION' AND status='OK'")],
    }
    la = out["lineage"]["applied_in_build"]
    out["lineage"]["applied_summary"] = dict(Counter(f"{x['kind']}/{x['status']}" for x in la))
    out["lineage"]["sessions_by_kind"] = dict(sum((Counter({f"{x['kind']}/{x['status']}": x["days"]}) for x in la), Counter()))
    # reasons
    out["missing_sessions_by_reason"] = dict(B.execute("SELECT reason, SUM(n_days) FROM gap_run GROUP BY reason ORDER BY 2 DESC").fetchall())
    out["observations_by_status"] = dict(B.execute("SELECT validation_status, COUNT(*) FROM observation GROUP BY 1 ORDER BY 2 DESC").fetchall())
    out["current_state_sources"] = dict(B.execute("""SELECT s.source_type, COUNT(*) FROM state_run s JOIN coverage c
        ON s.issuer_id='cik:'||c.cik AND s.end=c.last_day GROUP BY 1""").fetchall())
    for n in ("magnitude_scan.json", "final_checks.json", "three_columns.json", "stale15.json", "history_adjudication.json"):
        try:
            j = L(n)
        except FileNotFoundError:
            continue
        if n == "magnitude_scan.json":
            out["ten_x"] = {"by_class": j["by_class"], "dispositions": j.get("blocker_disposition_counts"),
                            "history": {k: v for k, v in j["history_10x_vs_production"].items() if k != "top"},
                            "non_old_outliers": [r for r in j["outliers"] if r["class"] != "OLD_LAST_VALUE"]}
        elif n == "final_checks.json":
            out["final_checks"] = {k: v for k, v in j.items() if k != "named"}
        elif n == "three_columns.json":
            out["three_columns"] = j
        elif n == "stale15.json":
            out["stale15"] = {k: v for k, v in j.items() if k != "rows"}
        else:
            out["history_adjudication"] = {k: v for k, v in j.items() if k != "per_security"}
    g = L("golden.json")
    out["golden"] = {"passed": sum(r["pass"] for r in g), "total": len(g), "failed": [(r["case"], r["check"], r["evidence"]) for r in g if not r["pass"]]}
    a = L("arm_before_after.json")
    out["arm"] = {k: a.get(k) for k in ("legit_sessions", "before_valued_legit", "v1_valued_legit", "before_contaminated", "v1_before_listing",
                                        "v1_missing_legit", "max_rel_diff_where_both")}
    au = L("universe_audit.json")
    out["anomalies"] = {k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk not in ("examples", "list")})
                        for k, v in au.get("anomalies", {}).items()}
    out["contamination"] = au.get("contamination")
    out["stale_internal_subreasons"] = au.get("stale_internal_subreasons")
    out["unexplained"] = au.get("unexplained")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--reports", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = run(a.reports, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps(res, indent=1, default=str)[:20000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
