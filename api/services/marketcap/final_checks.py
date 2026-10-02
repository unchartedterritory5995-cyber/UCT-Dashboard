"""Final hard-gate checks over one build (no lookahead, duplicates, ordering, named ADR / multi-class / current-diff cases).

    python -m api.services.marketcap.final_checks --build B.db --baseline BASE.db --data C:/mcapdata --out checks.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3


def run(build: str, baseline: str, data: str) -> dict:
    B = sqlite3.connect(build)
    S = sqlite3.connect(baseline)
    out = {}
    # LOOKAHEAD: every state run starts on/after the close its observation became usable (known_from)
    bad = B.execute("""SELECT COUNT(*) FROM state_run s JOIN observation o ON o.issuer_id=s.issuer_id AND o.accession=s.obs_accession
                       AND o.class_key=s.class_key AND o.as_of=s.as_of WHERE s.start < o.known_from""").fetchone()[0]
    out["lookahead_state_runs_before_known_from"] = bad
    out["state_runs"] = B.execute("SELECT COUNT(*) FROM state_run").fetchone()[0]
    # DUPLICATES / ORDERING
    out["duplicate_cap_days"] = B.execute("SELECT COUNT(*) FROM (SELECT cik, d, COUNT(*) n FROM cap_daily GROUP BY cik, d HAVING n > 1)").fetchone()[0]
    out["gap_runs_overlapping_values"] = B.execute("""SELECT COUNT(*) FROM gap_run g JOIN cap_daily c ON c.cik=g.cik AND c.d BETWEEN g.start AND g.end""").fetchone()[0]
    out["state_runs_inverted"] = B.execute("SELECT COUNT(*) FROM state_run WHERE end < start").fetchone()[0]
    out["observations_known_before_public"] = B.execute("SELECT COUNT(*) FROM observation WHERE known_from < substr(public_at,1,10) "
                                                       "AND substr(public_at,12,2) < '20'").fetchone()[0]
    out["bug_issuers"] = [k for (k,) in B.execute("SELECT key FROM manifest WHERE key LIKE 'bug:%'")]
    out["unexplained_days"] = B.execute("SELECT SUM(unexplained_days) FROM coverage").fetchone()[0]
    out["bug_reason_days"] = B.execute("SELECT COALESCE(SUM(n_days),0) FROM gap_run WHERE reason='BUG'").fetchone()[0]
    out["invalid_unit_used"] = B.execute("SELECT COUNT(*) FROM state_run s JOIN observation o ON o.accession=s.obs_accession "
                                         "AND o.issuer_id=s.issuer_id AND o.class_key=s.class_key AND o.as_of=s.as_of WHERE o.validation_status='REJECTED_INVALID_UNIT'").fetchone()[0]
    out["other_member_classes_in_state"] = B.execute("SELECT COUNT(DISTINCT issuer_id) FROM state_run WHERE class_key LIKE 'OTHER:%$%' "
                                                     "OR class_key LIKE '%AdrMember%'").fetchone()[0]
    # named cases: current V1 vs production vs Massive
    M = {}
    for line in open(f"{data}/ref.jsonl", encoding="utf-8"):
        t, d, _s, _e = json.loads(line)
        if d and d.get("market_cap"):
            M[t] = float(d["market_cap"])
    named = {}
    for t in ("SNY", "TAK", "KT", "LPL", "EVO", "PKX", "TCOM", "SONY", "FOXA", "CTVA", "BRK-B", "BNTX", "HOV", "UNF", "RUSHA",
              "AWX", "FLWS", "ASST", "UHAL", "GTN", "ARM", "GOOGL", "XOM", "NEXR", "PN", "SLE", "FXHO", "ZBAO"):
        r = B.execute("SELECT c.cik, c.last_day FROM coverage c WHERE c.primary_ticker=?", (t,)).fetchone()
        if not r:
            r2 = B.execute("SELECT cik FROM ticker_map WHERE ticker=? LIMIT 1", (t,)).fetchone()
            r = (r2[0], B.execute("SELECT last_day FROM coverage WHERE cik=?", (r2[0],)).fetchone()[0]) if r2 else None
        if not r:
            named[t] = None
            continue
        cik, last = r
        v = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,)).fetchone()
        b = S.execute("SELECT d, cap FROM base_daily WHERE ticker=? ORDER BY d DESC LIMIT 1", (t,)).fetchone()
        rg = B.execute("SELECT kind, reason, components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{cik}",)).fetchone()
        reason = B.execute("SELECT reason FROM gap_run WHERE cik=? ORDER BY end DESC LIMIT 1", (cik,)).fetchone()
        named[t] = {"v1_last": v, "before_last": b, "massive": M.get(t), "v1_vs_massive": (v[1] / M[t]) if v and t in M else None,
                    "before_vs_massive": (b[1] / M[t]) if b and t in M else None, "structure": rg[:2] if rg else None,
                    "components": json.loads(rg[2])[:4] if rg and rg[2] else None, "last_gap_reason": reason[0] if reason else None,
                    "v1_current": bool(v and last and v[0] >= int(last.replace("-", "")))}
    out["named"] = named
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = run(a.build, a.baseline, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in res.items() if k != "named"}, default=str))
    for t, x in res["named"].items():
        print(t, x and {k: x[k] for k in ("v1_vs_massive", "before_vs_massive", "structure", "last_gap_reason", "v1_current")})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
