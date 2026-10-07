"""INFORMATION ONLY (owner decision D: the 15-month ceiling stays): the annual-filer cohort that goes stale.

    python -m api.services.marketcap.stale15 --build B.db --audit-rows rows.json.gz --out stale15.json

For every security with an INTERNAL SHARE_STATE_STALE run whose audit sub-reason is the annual filing cycle exceeding
the ceiling: the filing regime (foreign / domestic, the periodic forms filed), the typical and maximum interval
between consecutive authoritative share observations (distinct as-of dates of usable counts), and by how many
calendar days each stale run missed (the run's length): <= 30, <= 60, <= 90, > 90.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import statistics
from collections import Counter
from datetime import date


def _d(i: int) -> date:
    return date(i // 10000, i // 100 % 100, i % 100)


def run(build: str, rows_path: str) -> dict:
    B = sqlite3.connect(build)
    rows = json.load(gzip.open(rows_path, "rt"))
    annual = {r["cik"] for r in rows if (r.get("stale_internal_subreasons") or {}).get("ANNUAL_FILER_CYCLE_EXCEEDS_15M_CEILING")}
    out, miss = [], Counter()
    regime = Counter()
    for cik in sorted(annual):
        cov = B.execute("SELECT primary_ticker, foreign_filer, first_value FROM coverage WHERE cik=?", (cik,)).fetchone()
        if not cov:
            continue
        asofs = sorted({a for (a,) in B.execute("SELECT DISTINCT as_of FROM observation WHERE issuer_id=? AND validation_status "
                                                 "IN ('ACCEPTED','ACCEPTED_RESTATED_BASIS')", (f"cik:{cik}",))})
        gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(asofs, asofs[1:])]
        forms = Counter(f for (f,) in B.execute("SELECT form FROM observation WHERE issuer_id=? AND validation_status "
                                                "IN ('ACCEPTED','ACCEPTED_RESTATED_BASIS')", (f"cik:{cik}",)))
        reg = ("FOREIGN" if cov[1] else "DOMESTIC") + ":" + ("ANNUAL_ONLY" if not any(f.startswith(("10-Q", "6-K")) for f in forms) else "HAS_INTERIM")
        regime[reg] += 1
        runs = []
        for s, e, n in B.execute("SELECT start, end, n_days FROM gap_run WHERE cik=? AND reason='SHARE_STATE_STALE'", (cik,)):
            if cov[2] and s > int(cov[2].replace("-", "")):
                cal = (_d(e) - _d(s)).days + 1
                runs.append(cal)
                miss["<=30" if cal <= 30 else "<=60" if cal <= 60 else "<=90" if cal <= 90 else ">90"] += 1
        out.append({"ticker": cov[0], "cik": cik, "regime": reg, "forms": dict(forms.most_common(6)),
                    "median_interval_days": statistics.median(gaps) if gaps else None, "max_interval_days": max(gaps) if gaps else None,
                    "stale_runs_calendar_days": runs})
    med = [x["median_interval_days"] for x in out if x["median_interval_days"]]
    return {"securities": len(out), "regime": dict(regime), "stale_runs_by_miss": dict(miss),
            "median_of_median_interval_days": statistics.median(med) if med else None,
            "max_interval_days": max((x["max_interval_days"] or 0) for x in out) if out else None, "rows": out}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--audit-rows", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.build, a.audit_rows)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
