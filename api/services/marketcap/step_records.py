"""Day-to-day magnitude adjudication of a (final) build, BY THE BUILD'S OWN RULE (extreme_steps.py). VALIDATION ONLY.

    python -m api.services.marketcap.step_records --build FINAL.db --baseline BASE.db --data C:/mcapdata \
        --cohort cap_steps_unadjudicated.json --dossier steps_dossier_accepted.json --out-dir DIR

The validator does NOT re-implement the rule: it reconstructs each issuer's inputs from the build DB (cap_daily,
state_run, observation, the recorded step_context: known splits and capital-event filings) and calls the SAME
extreme_steps.steps(). Gate N (build/validator parity) passes only when
  * every recorded step_context and extreme_step row carries the validator's SEMANTICS_VERSION;
  * the steps the validator finds served == the steps the build recorded as served, with identical verdicts;
  * no served step is unproven.

Dispositions of the original V1-specific cohort (exactly one per case):
  PROVEN_CORRECT             still served and the shared rule proves it (bridged / qualifying capital event)
  FIXED                      the state that made the step was a semantic defect and is no longer served
  HELD_WITH_EXPLICIT_REASON  withheld because the evidence is insufficient
  UNKNOWN_BUT_VALUED         served but not proven -- must be 0
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
from collections import Counter, defaultdict
from datetime import date

from .extreme_steps import SEMANTICS_VERSION, STEP_FACTOR, steps as xsteps, usable_rows

DEFECT_HOLDS = ("ISOLATED_EXTREME_STATE", "HELD_LEDGER_SPLIT_IN_TRADING_BREAK")
DEFECT_REASONS = ("TICKER_REUSE_DIFFERENT_ISSUER", "SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED", "SUSPICIOUS_SHARE_COUNT",
                  "PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY")


def _d(i: int) -> date:
    return date(i // 10000, i // 100 % 100, i % 100)


def issuer_inputs(B, px, cik: int, ticker: str):
    iss = f"cik:{cik}"
    caps = {_d(d): c for d, c in B.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,))}
    pclose = {_d(d): c for d, c in px.execute("SELECT d, c FROM bar WHERE ticker=?", (ticker.replace(".", "-"),))}
    runs = defaultdict(list)
    for ck, s, e, sh, accn, as_of, src in B.execute("SELECT class_key, start, end, shares, obs_accession, as_of, source_type "
                                                    "FROM state_run WHERE issuer_id=? ORDER BY start", (iss,)):
        runs[(iss, ck)].append((s, e, sh, accn, as_of, src))
    rows = usable_rows(B.execute("SELECT * FROM observation WHERE issuer_id=?", (iss,)).fetchall())
    ctx = B.execute("SELECT semantics, iterations, withheld_days, known_splits, ev_forms FROM step_context WHERE cik=?", (cik,)).fetchone()
    return caps, pclose, dict(runs), rows, ctx


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--cohort", "--dossier", "--out-dir"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    B, S = sqlite3.connect(a.build), sqlite3.connect(a.baseline)
    px = sqlite3.connect(f"{a.data}/prices.db")
    tick = {t: c for c, t in B.execute("SELECT cik, primary_ticker FROM coverage") if t}
    accepted = {(c["ticker"], c["d0"], c["d1"]): c for c in json.load(open(a.dossier))}

    served, disagreements, iters, version_mismatch = [], [], Counter(), []
    for t, cik in tick.items():
        caps, pclose, runs, rows, ctx = issuer_inputs(B, px, cik, t)
        if ctx is None:
            if len(caps) > 1:
                disagreements.append({"ticker": t, "issue": "no step_context recorded"})
            continue
        sem, it, _wd, ks, evf = ctx
        iters[it] += 1
        if sem != SEMANTICS_VERSION:
            version_mismatch.append((t, sem))
        mine = {(_a, _b): v for _a, _b, v in xsteps(caps, pclose, runs, rows, [tuple(x) for x in json.loads(evf)], json.loads(ks))}
        recorded = {(_d(d0), _d(d1)): (vd, sm) for d0, d1, vd, sm in B.execute(
            "SELECT d0, d1, verdict, semantics FROM extreme_step WHERE cik=?", (cik,))}
        for key in set(mine) | set(recorded):
            mv = mine.get(key, {}).get("verdict")
            rv = recorded.get(key, (None, None))[0]
            if mv != rv:
                disagreements.append({"ticker": t, "d0": key[0].isoformat(), "d1": key[1].isoformat(), "validator": mv, "build": rv})
            if key in recorded and recorded[key][1] != SEMANTICS_VERSION:
                version_mismatch.append((t, recorded[key][1]))
        for (d0, d1), v in mine.items():
            p0 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, int(d0.strftime("%Y%m%d")))).fetchone()
            p1 = S.execute("SELECT cap FROM base_daily WHERE ticker=? AND d=?", (t, int(d1.strftime("%Y%m%d")))).fetchone()
            shared = bool(p0 and p1 and p0[0] and p1[0] and abs(math.log((caps[d1] / caps[d0]) / (p1[0] / p0[0]))) < math.log(2))
            served.append({"ticker": t, "cik": cik, "d0": int(d0.strftime("%Y%m%d")), "d1": int(d1.strftime("%Y%m%d")),
                           "unexplained_ratio": v["unexplained_ratio"], "production_shared": shared,
                           "disposition": "PROVEN_CORRECT" if v["verdict"] == "PROVEN" else "UNKNOWN_BUT_VALUED",
                           "evidence": {k: x for k, x in v.items() if not k.startswith("_")}})

    served_keys = {(s["ticker"], s["d0"], s["d1"]) for s in served}
    cohort = []
    for t, d0, d1, q, cls, _r0, _r1, _g in json.load(open(a.cohort)):
        cik = tick.get(t)
        held0 = B.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", (cik, d0, d0)).fetchone()
        held1 = B.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?", (cik, d1, d1)).fetchone()
        notes = [n for (n,) in B.execute("SELECT snippet FROM split_gap WHERE cik=? AND status IN ('HELD_EXTREME_STEP', "
                                         "'HELD_LEDGER_SPLIT_IN_TRADING_BREAK')", (cik,))]
        lin = B.execute("SELECT kind, status, effective, note FROM lineage_applied WHERE cik=?", (cik,)).fetchall()
        rec = {"ticker": t, "cik": cik, "d0": d0, "d1": d1, "accepted_unexplained_ratio": q, "accepted_class": cls,
               "accepted_dossier": accepted.get((t, d0, d1)), "held_d0": held0 and held0[0], "held_d1": held1 and held1[0],
               "rule_notes": notes[:8], "lineage_applied": lin}
        if (t, d0, d1) in served_keys:
            s = next(x for x in served if (x["ticker"], x["d0"], x["d1"]) == (t, d0, d1))
            rec.update({"disposition": s["disposition"], "rule": "SHARED_RULE_" + s["evidence"]["verdict"], "evidence": s["evidence"]})
        else:
            reasons = {held0 and held0[0], held1 and held1[0]} - {None}
            defect = any(any(k in n for k in DEFECT_HOLDS) for n in notes) or bool(reasons & set(DEFECT_REASONS)) \
                or any(x[0] == "SYMBOL_SWITCH" for x in lin) or any(x[0] == "AMBIGUOUS" and x[1] != "OWN_REGISTRANT_HISTORY" for x in lin)
            if not reasons:
                rec.update({"disposition": "FIXED", "rule": "STATE_CORRECTED"})
            else:
                rec.update({"disposition": "FIXED" if defect else "HELD_WITH_EXPLICIT_REASON",
                            "rule": "DEFECTIVE_STATE_REFUSED" if defect else "INSUFFICIENT_EVIDENCE_WITHHELD",
                            "withheld_reasons": sorted(reasons)})
        cohort.append(rec)

    total = expl = 0
    for t, cik in tick.items():
        caps = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d", (cik,)).fetchall()
        cl = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
        for (x, cx), (y, cy) in zip(caps, caps[1:]):
            if cx > 0 and cy > 0 and abs(math.log(cy / cx)) >= math.log(STEP_FACTOR):
                total += 1
                if cl.get(x) and cl.get(y) and abs(math.log(cy / cx) - math.log(cl[y] / cl[x])) < math.log(STEP_FACTOR):
                    expl += 1
    held_total = B.execute("SELECT COUNT(*) FROM split_gap WHERE status='HELD_EXTREME_STEP'").fetchone()[0]
    unknown = sum(s["disposition"] == "UNKNOWN_BUT_VALUED" for s in served)
    gate_n = {"semantics": SEMANTICS_VERSION, "version_mismatches": version_mismatch[:20], "disagreements": len(disagreements),
              "served_unproven": unknown, "pass": not version_mismatch and not disagreements and unknown == 0}
    summ = {
        "build": a.build,
        "convergence_iterations": {str(k): n for k, n in sorted(iters.items())},
        "original_cohort": {"total": len(cohort), "by_disposition": dict(Counter(r["disposition"] for r in cohort)),
                            "by_rule": dict(Counter(r["rule"] for r in cohort))},
        "day_to_day_scan": {
            "total_10x_cap_moves": total, "price_explained": expl, "unexplained_by_price_served": len(served),
            "production_shared": sum(s["production_shared"] for s in served),
            "v1_specific": sum(not s["production_shared"] for s in served),
            "proven": sum(s["disposition"] == "PROVEN_CORRECT" for s in served),
            "withheld_step_decisions": held_total,
            "cohort_held": sum(r["disposition"] == "HELD_WITH_EXPLICIT_REASON" for r in cohort),
            "cohort_fixed": sum(r["disposition"] == "FIXED" for r in cohort),
            "unknown_but_valued": unknown},
        "gate_N_build_validator_parity": gate_n,
    }
    json.dump(cohort, open(os.path.join(a.out_dir, "cap_step_cohort.json"), "w"), indent=1, default=str)
    json.dump(served, open(os.path.join(a.out_dir, "cap_steps_served.json"), "w"), indent=1, default=str)
    json.dump(disagreements, open(os.path.join(a.out_dir, "parity_disagreements.json"), "w"), indent=1, default=str)
    json.dump(summ, open(os.path.join(a.out_dir, "cap_step_summary.json"), "w"), indent=1, default=str)
    print(json.dumps(summ, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
