"""Day-to-day magnitude adjudication of a (final) build: the original V1-specific cap-step cohort and every >= 10x step the
build still serves, each with its evidence and a disposition. VALIDATION ONLY.

    python -m api.services.marketcap.step_records --build FINAL.db --baseline BASE.db --data C:/mcapdata \
        --cohort cap_steps_unadjudicated.json --dossier steps_dossier_accepted.json --out-dir DIR

Dispositions (exactly one per case):
  PROVEN_CORRECT             both share states are corroborated by another filing AND the move is bridged by issuer
                             counts or a capital-event filing (offering / merger / tender / registration) lies between --
                             a real capital change, served
  FIXED                      the state that made the step was a semantic defect (isolated extreme state, pre-combination
                             shell, another security's symbol history, a count below the listed-security minimum, an ADS
                             count on another filing's ratio, a ledger split inside a trading break) and is no longer served
  HELD_WITH_EXPLICIT_REASON  the step is withheld because its evidence is insufficient (unproven extreme step, a split-like
                             move the ledger lacks, an unresolved ledger split)
  UNKNOWN_BUT_VALUED         served with neither -- must be 0
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
from collections import Counter
from datetime import date, timedelta

from .build import CAPITAL_EVENT_FORMS

DEFECT_HOLDS = ("ISOLATED_EXTREME_STATE", "HELD_LEDGER_SPLIT_IN_TRADING_BREAK")
DEFECT_REASONS = ("TICKER_REUSE_DIFFERENT_ISSUER", "SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED", "SUSPICIOUS_SHARE_COUNT",
                  "PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY")


def _ds(i: int) -> str:
    s = str(i)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def steps(B, px, cik, t):
    caps = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d", (cik,)).fetchall()
    cl = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
    out = []
    for (a, ca), (b, cb) in zip(caps, caps[1:]):
        if cl.get(a) and cl.get(b) and ca > 0 and cb > 0:
            q = math.log(cb / ca) - math.log(cl[b] / cl[a])
            if abs(q) >= math.log(10):
                out.append((a, b, math.exp(q), ca, cb))
    return out


def evidence(B, inp, cik, a, b):
    iss = f"cik:{cik}"

    def runs_at(d):
        ds = _ds(d)
        return B.execute("SELECT class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run WHERE issuer_id=? "
                         "AND start<=? AND end>=?", (iss, ds, ds)).fetchall()
    ra, rb = runs_at(a), runs_at(b)
    obs = B.execute("SELECT class_key, as_of, normalized_value, accession, form, validation_status FROM observation "
                    "WHERE issuer_id=? AND normalized_value > 0", (iss,)).fetchall()

    def corr(r):
        x = date.fromisoformat(r[5])
        return [o[3] for o in obs if o[0] == r[0] and o[3] != r[4] and abs((date.fromisoformat(o[1]) - x).days) <= 400
                and abs(math.log(o[2] / r[3])) < math.log(1.5) and o[5] not in ("REJECTED_SOURCE_CONFLICT", "REJECTED_INVALID_UNIT")]
    ev = {"before": [list(r) + [sorted(set(corr(r)))[:5]] for r in ra], "after": [list(r) + [sorted(set(corr(r)))[:5]] for r in rb]}
    if ra and rb:
        lo, hi = max(r[5] for r in ra), min(r[5] for r in rb)
        ev["capital_event_filings"] = [(f, fm, ac) for ac, fm, f in inp.execute(
            "SELECT accn, form, filing_date FROM filing WHERE cik=? AND filing_date > ? AND filing_date <= ?", (cik, lo, hi))
            if fm in CAPITAL_EVENT_FORMS][:20]
        after_forms = [o[4] for o in obs if o[3] == rb[0][4]]
        if after_forms and after_forms[0] in CAPITAL_EVENT_FORMS:
            ev["capital_event_filings"].append((rb[0][5], after_forms[0], rb[0][4]))
        if len(ra) == 1 and len(rb) == 1 and ra[0][0] == rb[0][0]:
            mids = sorted((o[1], o[2]) for o in obs if o[0] == ra[0][0] and lo <= o[1] <= hi and o[5] in ("ACCEPTED", "ACCEPTED_RESTATED_BASIS"))
            vals = [ra[0][3]] + [v for _d, v in mids] + [rb[0][3]]
            ev["bridged"] = all(abs(math.log(y / x)) < math.log(10) for x, y in zip(vals, vals[1:]))
            ev["path"] = [round(v) for v in vals][:20]
        else:
            ev["bridged"] = False
        ev["corroborated"] = all(r[-1] for r in ev["before"] + ev["after"])
    return ev


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--cohort", "--dossier", "--out-dir"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    B, S = sqlite3.connect(a.build), sqlite3.connect(a.baseline)
    px, inp = sqlite3.connect(f"{a.data}/prices.db"), sqlite3.connect(f"{a.data}/inputs.db")
    tick = dict(B.execute("SELECT primary_ticker, cik FROM coverage"))
    accepted = {(c["ticker"], c["d0"], c["d1"]): c for c in json.load(open(a.dossier))}

    def classify_served(cik, t, d0, d1, q):
        ev = evidence(B, inp, cik, d0, d1)
        p0 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, d0)).fetchone()
        p1 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, d1)).fetchone()
        c0 = B.execute("SELECT cap FROM cap_daily WHERE cik=? AND d=?", (cik, d0)).fetchone()[0]
        c1 = B.execute("SELECT cap FROM cap_daily WHERE cik=? AND d=?", (cik, d1)).fetchone()[0]
        shared = bool(p0 and p1 and p0[0] and p1[0] and abs(math.log((c1 / c0) / (p1[0] / p0[0]))) < math.log(2))
        real = ev.get("corroborated") and (ev.get("bridged") or ev.get("capital_event_filings"))
        disp = "PROVEN_CORRECT" if real else "UNKNOWN_BUT_VALUED"
        return disp, ("REAL_CAPITAL_CHANGE" if real else "UNEXPLAINED"), ev, shared

    # 1. the original cohort
    cohort = []
    for t, d0, d1, q, cls, r0, r1, _g in json.load(open(a.cohort)):
        cik = tick.get(t)
        held0 = B.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", (cik, d0, d0)).fetchone()
        held1 = B.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", (cik, d1, d1)).fetchone()
        notes = [n for (n,) in B.execute("SELECT snippet FROM split_gap WHERE cik=? AND status IN ('HELD_EXTREME_STEP', "
                                         "'HELD_LEDGER_SPLIT_IN_TRADING_BREAK')", (cik,))]
        lin = B.execute("SELECT kind, status, effective, note FROM lineage_applied WHERE cik=?", (cik,)).fetchall()
        still = [s for s in steps(B, px, cik, t) if s[0] == d0 and s[1] == d1]
        rec = {"ticker": t, "cik": cik, "d0": d0, "d1": d1, "accepted_unexplained_ratio": q, "accepted_class": cls,
               "accepted_dossier": accepted.get((t, d0, d1)), "held_d0": held0 and held0[0], "held_d1": held1 and held1[0],
               "rule_notes": notes[:6], "lineage_applied": lin}
        if still:
            disp, rule, ev, shared = classify_served(cik, t, d0, d1, still[0][2])
            rec.update({"disposition": disp, "rule": rule, "evidence": ev, "production_shared": shared})
        else:
            reasons = {held0 and held0[0], held1 and held1[0]} - {None}
            defect = any(any(k in n for k in DEFECT_HOLDS) for n in notes) or bool(reasons & set(DEFECT_REASONS)) \
                or any(x[0] in ("SYMBOL_SWITCH",) for x in lin) or any(x[1] not in ("OWN_REGISTRANT_HISTORY",) and x[0] == "AMBIGUOUS" for x in lin)
            if not reasons:
                rec.update({"disposition": "FIXED", "rule": "STATE_CORRECTED", "evidence": evidence(B, inp, cik, d0, d1)})
            else:
                rec.update({"disposition": "FIXED" if defect else "HELD_WITH_EXPLICIT_REASON",
                            "rule": "DEFECTIVE_STATE_REFUSED" if defect else "INSUFFICIENT_EVIDENCE_WITHHELD",
                            "withheld_reasons": sorted(reasons)})
        cohort.append(rec)
    # 2. every >= 10x step the build still serves
    served = []
    for t, cik in tick.items():
        if not t:
            continue
        for d0, d1, q, _c0, _c1 in steps(B, px, cik, t):
            disp, rule, ev, shared = classify_served(cik, t, d0, d1, q)
            served.append({"ticker": t, "cik": cik, "d0": d0, "d1": d1, "unexplained_ratio": q, "production_shared": shared,
                           "disposition": disp, "rule": rule, "evidence": ev,
                           "in_original_cohort": any(r["ticker"] == t and r["d0"] == d0 and r["d1"] == d1 for r in cohort)})
    # all consecutive valued-day pairs with a >= 10x cap move, price-explained or not
    total = expl = 0
    for t, cik in tick.items():
        if not t:
            continue
        caps = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d", (cik,)).fetchall()
        cl = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
        for (x, cx), (y, cy) in zip(caps, caps[1:]):
            if cx > 0 and cy > 0 and abs(math.log(cy / cx)) >= math.log(10):
                total += 1
                if cl.get(x) and cl.get(y) and abs(math.log(cy / cx) - math.log(cl[y] / cl[x])) < math.log(10):
                    expl += 1
    v1_specific = [s for s in served if not s["production_shared"]]
    summ = {
        "build": a.build,
        "original_cohort": {"total": len(cohort), "by_disposition": dict(Counter(r["disposition"] for r in cohort)),
                            "by_rule": dict(Counter(r["rule"] for r in cohort))},
        "day_to_day_scan": {
            "total_10x_cap_steps": total, "price_explained": expl, "unexplained_by_price": len(served),
            "production_shared": sum(s["production_shared"] for s in served), "v1_specific": len(v1_specific),
            "v1_specific_proven_correct": sum(s["disposition"] == "PROVEN_CORRECT" for s in v1_specific),
            "v1_specific_held": sum(r["disposition"] == "HELD_WITH_EXPLICIT_REASON" for r in cohort),
            "v1_specific_fixed": sum(r["disposition"] == "FIXED" for r in cohort),
            "unknown_but_valued": sum(s["disposition"] == "UNKNOWN_BUT_VALUED" for s in served)},
    }
    json.dump(cohort, open(os.path.join(a.out_dir, "cap_step_cohort.json"), "w"), indent=1, default=str)
    json.dump(served, open(os.path.join(a.out_dir, "cap_steps_served.json"), "w"), indent=1, default=str)
    json.dump(summ, open(os.path.join(a.out_dir, "cap_step_summary.json"), "w"), indent=1, default=str)
    print(json.dumps(summ, indent=1, default=str))
    for s in served:
        if s["disposition"] == "UNKNOWN_BUT_VALUED":
            print("UNKNOWN", s["ticker"], s["d0"], s["d1"], round(s["unexplained_ratio"], 3))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
