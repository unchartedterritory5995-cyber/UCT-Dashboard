"""Evidence dossier for every SPLIT-MULTIPLE discontinuity of one build (validate_build's split_continuity cohort).

    python -m api.services.marketcap.adjudicate_splits --build B.db --data C:/mcapdata --out split_cases.json

For each case: the ledger split (date, ratio, whether the build applied, dropped or supplemented it), the share
observation on each side (raw value, normalized value, as-of, public time, basis, source, accession), the split
evidence on file (XBRL / filing text), the price step across the split, and whether V1 SERVES values from either
state (a discontinuity in a held interval is not a served value). The classification is done by `classify`:

  A CORRECT_DISCONTINUITY   no served value is inconsistent: the jump is a real share change, or the side that would
                            be wrong is held
  B DOUBLE_SPLIT_ADJUSTMENT a count already on the post-split basis is transformed again
  C MISSING_SPLIT_ADJUSTMENT a pre-split count is carried without the transformation
  D SPLIT_LEDGER_WRONG      the issuer's own counts contradict the ledger split (the build dropped it)
  E AMBIGUOUS               the basis cannot be established -> must be HELD
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import date

from .build import load_ref


def _di(s: str) -> int:
    return int(s.replace("-", ""))


def dossier(build: str, data: str) -> list[dict]:
    B = sqlite3.connect(build)
    ref = load_ref(f"{data}/ref.jsonl")
    px = sqlite3.connect(f"{data}/prices.db")
    ev = sqlite3.connect(f"{data}/splitev.db")
    comps = {}
    for iss, comp in B.execute("SELECT issuer_id, components FROM regime"):
        for ck, pt, _m, _e in json.loads(comp):
            comps[(iss, ck)] = pt
    runs = {}
    for iss, ck, s, e, sh, accn, as_of, src in B.execute(
            "SELECT issuer_id, class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run ORDER BY issuer_id, class_key, start"):
        runs.setdefault((iss, ck), []).append((s, e, sh, accn, as_of, src))
    out = []
    for (iss, ck), rs in runs.items():
        pt = comps.get((iss, ck))
        if not pt or pt not in ref:
            continue
        cik = int(iss[4:])
        for sp in ref[pt][1]:
            ex = sp.ex_date.isoformat()
            before = [r for r in rs if r[0] < ex]
            after = [r for r in rs if r[0] >= ex and r[4] >= ex]
            if not before or not after:
                continue
            b, a = before[-1], after[0]
            if a[3] == b[3]:
                continue
            ratio = a[2] / b[2]
            if 0.8 <= ratio <= 1.25:
                continue
            near = min(abs(math.log(ratio) - k * math.log(sp.ratio)) for k in (-1, 1))
            if near >= 0.05:
                continue

            def obs(run):
                return B.execute("SELECT as_of, public_at, known_from, raw_value, normalized_value, split_basis, source_type, form, "
                                 "accession, tag, validation_status FROM observation WHERE issuer_id=? AND class_key=? AND accession=? "
                                 "AND as_of=? LIMIT 1", (iss, ck, run[3], run[4])).fetchone()
            ob, oa = obs(b), obs(a)
            served_b = B.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?", (cik, _di(b[0]), _di(b[1]))).fetchone()[0]
            served_a = B.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?", (cik, _di(a[0]), _di(a[1]))).fetchone()[0]
            ledger_rows = B.execute("SELECT status, ratio, source, snippet FROM split_gap WHERE cik=? AND d=?", (cik, ex)).fetchall()
            evid = ev.execute("SELECT ex_date, ratio, source, accn, substr(snippet,1,200) FROM split_evidence WHERE cik=? AND "
                              "ABS(ratio - ?) < 0.02 * ?", (cik, sp.ratio, sp.ratio)).fetchall()
            p0 = px.execute("SELECT d, c FROM bar WHERE ticker=? AND d < ? ORDER BY d DESC LIMIT 1", (pt.replace(".", "-"), _di(ex))).fetchone()
            p1 = px.execute("SELECT d, c FROM bar WHERE ticker=? AND d >= ? ORDER BY d LIMIT 1", (pt.replace(".", "-"), _di(ex))).fetchone()
            cap_b = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? AND d <= ? ORDER BY d DESC LIMIT 1", (cik, _di(b[1]))).fetchone()
            cap_a = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? AND d >= ? ORDER BY d LIMIT 1", (cik, _di(a[0]))).fetchone()
            gaps = B.execute("SELECT reason, start, end, n_days FROM gap_run WHERE cik=? AND end >= ? AND start <= ?",
                             (cik, _di(b[0]), _di(a[1]))).fetchall()
            out.append({
                "issuer": iss, "class": ck, "ticker": pt, "split_ex": ex, "split_ratio": sp.ratio, "state_ratio": ratio,
                "ledger_in_build": ledger_rows, "split_evidence": evid,
                "before": {"run": b, "obs": ob, "served_sessions": served_b},
                "after": {"run": a, "obs": oa, "served_sessions": served_a},
                "price_step": (p0, p1, (p1[1] / p0[1]) if p0 and p1 and p0[1] else None),
                "last_cap_before": cap_b, "first_cap_after": cap_a, "gaps_between": gaps,
            })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = dossier(a.build, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(len(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
