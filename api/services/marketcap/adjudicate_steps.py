"""Evidence dossier for every order-of-magnitude day-to-day cap step (final_checks.unexplained_10x_cap_steps) of a build.

    python -m api.services.marketcap.adjudicate_steps --build B.db --baseline BASE.db --data C:/mcapdata --out steps.json

For each step (previous valued session d0 -> next valued session d1, cap ratio >= 10x after removing the price move):
the state run on each side and the share OBSERVATION behind it (raw / normalized count, source, form, accession, tag,
snippet, public time), the split factors between the two as-of dates, the price and share contributions, the holds in
between, the issuer's ticker history (Massive events), lineage rows, ADS tags, class keys, and production on both days.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import date

from .build import load_ref


def _ds(d: int) -> str:
    s = str(d)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def dossier(build: str, baseline: str, data: str) -> list[dict]:
    B, S = sqlite3.connect(build), sqlite3.connect(baseline)
    px = sqlite3.connect(f"{data}/prices.db")
    ref = load_ref(f"{data}/ref.jsonl")
    lin = sqlite3.connect(f"{data}/lineage.db")
    inp = sqlite3.connect(f"{data}/inputs.db")
    tick = dict(B.execute("SELECT cik, primary_ticker FROM coverage"))
    out = []
    for cik, t in tick.items():
        caps = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d", (cik,)).fetchall()
        if len(caps) < 2:
            continue
        cl = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
        for (d0, c0), (d1, c1) in zip(caps, caps[1:]):
            if not (cl.get(d0) and cl.get(d1) and c0 > 0 and c1 > 0):
                continue
            q = math.log(c1 / c0) - math.log(cl[d1] / cl[d0])
            if abs(q) < math.log(10):
                continue

            def side(d):
                ds = _ds(d)
                runs = B.execute("SELECT class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run "
                                 "WHERE issuer_id=? AND start<=? AND end>=?", (f"cik:{cik}", ds, ds)).fetchall()
                res = []
                for ck, s, e, sh, accn, as_of, src in runs:
                    o = B.execute("SELECT raw_value, normalized_value, source_type, form, accession, tag, substr(snippet,1,240), "
                                  "public_at, known_from, split_basis, validation_status, note FROM observation WHERE issuer_id=? "
                                  "AND accession=? AND class_key=? AND as_of=? LIMIT 1", (f"cik:{cik}", accn, ck, as_of)).fetchone()
                    nserved = B.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?",
                                        (cik, int(s.replace("-", "")), int(e.replace("-", "")))).fetchone()[0]
                    res.append({"class": ck, "run": [s, e], "served_sessions": nserved, "shares": sh, "as_of": as_of,
                                "obs": dict(zip(("raw", "normalized", "source", "form", "accession", "tag", "snippet", "public_at",
                                                 "known_from", "basis", "status", "note"), o)) if o else None})
                return res
            r = ref.get(t)
            splits = [(s.ex_date.isoformat(), s.ratio) for s in (r[1] if r else []) if _ds(d0) < s.ex_date.isoformat() <= _ds(d1)]
            holds = B.execute("SELECT reason, start, end, n_days FROM gap_run WHERE cik=? AND start>? AND end<?", (cik, d0, d1)).fetchall()
            p0 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, d0)).fetchone()
            p1 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, d1)).fetchone()
            out.append({
                "ticker": t, "cik": cik, "d0": d0, "d1": d1, "cap0": c0, "cap1": c1, "close0": cl[d0], "close1": cl[d1],
                "cap_ratio": c1 / c0, "price_ratio": cl[d1] / cl[d0], "unexplained_ratio": math.exp(q),
                "before": side(d0), "after": side(d1), "ledger_splits_between": splits, "holds_between": holds,
                "ticker_events": [(e[0].isoformat() if e[0] else None, e[2]) for e in (r[0].events if r else [])],
                "massive_list_date": r[0].list_date.isoformat() if r and r[0].list_date else None,
                "cik_first_filing": inp.execute("SELECT MIN(filing_date) FROM filing WHERE cik=?", (cik,)).fetchone()[0],
                "lineage": lin.execute("SELECT kind, status, effective, pred_cik, accn FROM lineage WHERE succ_cik=?", (cik,)).fetchall(),
                "lineage_applied": B.execute("SELECT kind, status, effective, note FROM lineage_applied WHERE cik=?", (cik,)).fetchall(),
                "production": [p0 and p0[0], p1 and p1[0]],
            })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = dossier(a.build, a.baseline, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(len(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
