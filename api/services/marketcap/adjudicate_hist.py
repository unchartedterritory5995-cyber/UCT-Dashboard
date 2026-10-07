"""Evidence dossier for the HISTORICAL >= 10x V1-vs-production cohort (one row per security).

    python -m api.services.marketcap.adjudicate_hist --build B.db --baseline BASELINE.db --data C:/mcapdata \
        --cohort hist51_raw.json --out hist_cases.json

Per security and interval: the sessions V1 still serves / withholds (with the reasons), the ratio V1/production on the
served sessions, the share basis on each side (V1 = normalized shares in force; production = production cap / close),
and -- for an ADS -- every depositary ratio statement on file (12(b) title / filing text: accession, filing date,
snippet) with the ratio each served state used. Units of an ADS cap:

    V1   = (N_ord(as_of) * F(as_of) / R(t)) * P_ADS_adj(t)       F, P on the same split basis, R ordinary per ADS
    prod = N_ord * P_ADS                                          ordinary shares priced at the ADS price

so prod / V1 = R exactly when production carries no conversion: the comparison outlier IS the depositary ratio.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import statistics
from collections import Counter


def _ds(d: int) -> str:
    s = str(d)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def dossier(build: str, baseline: str, data: str, cohort: list) -> list[dict]:
    B, S = sqlite3.connect(build), sqlite3.connect(baseline)
    adr = sqlite3.connect(f"{data}/adr.db")
    cov = sqlite3.connect(f"{data}/covers.db")
    out = []
    for t, cik, s, e, n, verdict, _q, kind, _st, _tags in cohort:
        iss = f"cik:{cik}"
        base = dict(S.execute("SELECT d, cap FROM base_daily WHERE ticker=? AND d BETWEEN ? AND ?", (t, s, e)))
        v1 = dict(B.execute("SELECT d, cap FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?", (cik, s, e)))
        served = sorted(d for d in base if d in v1 and base[d] > 0)
        held = sorted(d for d in base if d not in v1)
        reasons = Counter()
        for d in held:
            r = B.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", (cik, d, d)).fetchone()
            reasons[r[0] if r else "NO_BAR_OR_OUTSIDE"] += 1
        ratios = [v1[d] / base[d] for d in served]
        ten = [d for d in served if abs(math.log10(v1[d] / base[d])) >= 1]
        states = []
        for ck, st_s, st_e, sh, accn, as_of, src in B.execute(
                "SELECT class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run WHERE issuer_id=? "
                "AND end >= ? AND start <= ? ORDER BY start", (iss, _ds(s), _ds(e))):
            o = B.execute("SELECT raw_value, normalized_value, tag, form, split_basis FROM observation WHERE issuer_id=? AND "
                          "accession=? AND class_key=? AND as_of=? LIMIT 1", (iss, accn, ck, as_of)).fetchone()
            m = re.search(r"/ADS([\d.]+)@([\d-]+)", (o[2] if o else "") or "")
            states.append({"class": ck, "start": st_s, "end": st_e, "shares": sh, "accession": accn, "as_of": as_of,
                           "source": src, "raw": o and o[0], "normalized": o and o[1], "tag": o and o[2], "form": o and o[3],
                           "basis": o and o[4], "ads_ratio_used": float(m.group(1)) if m else None,
                           "ads_ratio_accession": m.group(2) if m else None})
        stmts = [dict(zip(("accession", "filing_date", "status", "ratio", "snippet"), r))
                 for r in adr.execute("SELECT accn, filing_date, status, ratio, substr(snippet,1,220) FROM adr_ratio WHERE cik=? "
                                      "ORDER BY filing_date", (cik,))]
        titles = [dict(zip(("accession", "title"), r)) for r in cov.execute(
            "SELECT accn, substr(text,1,220) FROM cover_fact WHERE cik=? AND concept='dei:Security12bTitle'", (cik,))]
        regimes = [dict(zip(("start", "end", "classes", "kind", "reason", "note"), r)) for r in B.execute(
            "SELECT start, end, classes, kind, reason, note FROM regime WHERE issuer_id=? AND end >= ? AND start <= ?",
            (iss, _ds(s), _ds(e)))]
        out.append({
            "ticker": t, "cik": cik, "interval": [s, e], "cohort_sessions": n, "first_continuity_verdict": verdict, "kind": kind,
            "now_served": len(served), "now_held": len(held), "held_reasons": dict(reasons),
            "now_ge_10x": len(ten),
            "v1_over_prod": {"min": min(ratios), "median": statistics.median(ratios), "max": max(ratios)} if ratios else None,
            "v1_range": [min(v1[d] for d in served), max(v1[d] for d in served)] if served else None,
            "prod_range": [min(base[d] for d in served), max(base[d] for d in served)] if served else None,
            "states": states, "regimes": regimes, "ads_ratio_statements": stmts, "titles_12b": titles,
        })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--cohort", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = dossier(a.build, a.baseline, a.data, json.load(open(a.cohort)))
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    for r in res:
        q = r["v1_over_prod"]
        used = sorted({x["ads_ratio_used"] for x in r["states"] if x["ads_ratio_used"]})
        print(f"{r['ticker']:6s} {r['kind'] or '':6s} served {r['now_served']:4d} held {r['now_held']:4d} >=10x {r['now_ge_10x']:4d} "
              f"v1/prod {q and round(q['median'], 5)} ads_used {used} stmts {[(x['filing_date'], x['ratio']) for x in r['ads_ratio_statements']][:6]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
