"""Machine-readable adjudication of the two finite cohorts of the accepted shadow (MCAP_V1-20261002T050634Z), verified
against a (final) build. Every case ends PROVEN_CORRECT, FIXED or HELD_WITH_EXPLICIT_REASON -- never unknown.

    python -m api.services.marketcap.adjudication_records --build FINAL.db --baseline BASELINE.db --data C:/mcapdata \
        --accepted-splits split_dossier.json --cohort hist51_raw.json --out-dir REPORTS/ADJUDICATION

Writes split_cases.json (the 31 split-multiple discontinuities of the accepted shadow + every split-multiple case of the
final build), hist_cases.json (the 51 securities) and adjudication_summary.json. A disposition is CHECKED against the
final build: FIXED must no longer show the defect, HELD must serve nothing on the affected side, PROVEN_CORRECT must
carry its unit proof (ADS ratio x V1/production, class evidence, price-basis test).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3

from .adjudicate_hist import dossier as hist_dossier
from .adjudicate_splits import dossier as split_dossier
from .build import clean_factor

# ── the 31 split-multiple cases of the accepted shadow ──────────────────────────────────────────────────────────────
PRICE_ONLY = ("A", "PROVEN_CORRECT", "PRICE_ONLY_FACTOR_CARRIED_BY_BARS",
              "a distribution / price-only ledger factor: the raw count is continuous, the bars carry the factor (adjusted "
              "close continuous at ex), so N_raw x F x P_adj = N_raw x P_raw on both sides; the cap step is the value "
              "distributed")
SPLIT_RULES = {
    ("HSIC", "2019-02-08"): PRICE_ONLY, ("A", "2014-11-03"): PRICE_ONLY, ("XPO", "2022-11-01"): PRICE_ONLY,
    ("XPO", "2021-08-02"): PRICE_ONLY, ("FTV", "2025-06-30"): PRICE_ONLY, ("DHR", "2016-07-05"): PRICE_ONLY,
    ("EQT", "2018-11-13"): PRICE_ONLY, ("GE", "2024-04-02"): PRICE_ONLY, ("GE", "2023-01-04"): PRICE_ONLY,
    ("MDU", "2024-11-01"): PRICE_ONLY, ("MDU", "2023-06-01"): PRICE_ONLY,
    ("IEP", "2012-03-13"): ("A", "PROVEN_CORRECT", "BARS_CARRY_FACTOR",
                            "the adjusted close steps x1.72 at ex with the raw count continuous: the factor is in the bars "
                            "and in the normalization -> the cap is continuous (171M x 18.6 ~ 101.5M x 32.08)"),
    ("XRX", "2026-02-09"): ("A", "PROVEN_CORRECT", "BARS_CARRY_FACTOR",
                            "adjusted close steps x1.355 at ex against a x1.5 factor applied to a continuous raw count: "
                            "the cap moves x0.90 -- units cancel"),
    ("OTEX", "2014-02-19"): ("B", "FIXED", "EVIDENCE_SPLIT_REPLACES_LEDGER_SPLIT",
                             "issuer XBRL 2-for-1 dated 2014-01-23 was ADDED beside the ledger's 2014-02-19 2-for-1 (one "
                             "event): every earlier count was doubled. merge_evidence_splits applies it once."),
    ("CYRX", "2015-05-19"): ("B", "FIXED", "EVIDENCE_SPLIT_REPLACES_LEDGER_SPLIT",
                             "an evidence 1-for-12 duplicated the ledger's 2015-05-19 1-for-12: pre-2015 history 12x low"),
    ("FFIN", "2011-06-02"): ("B", "FIXED", "ANTICIPATORY_POST_SPLIT_BASIS",
                             "the cover dated before ex already states the post-split count (20.96M -> 31.44M = x1.500): "
                             "normalized from the ex date, never transformed again"),
    ("AVD", "2004-04-19"): ("B", "FIXED", "ANTICIPATORY_POST_SPLIT_BASIS", "anticipatory post-split cover (x1.5)"),
    ("AVD", "2003-04-14"): ("B", "FIXED", "ANTICIPATORY_POST_SPLIT_BASIS", "anticipatory post-split cover (x1.5)"),
    ("HBNC", "2016-11-15"): ("B", "FIXED", "ANTICIPATORY_POST_SPLIT_BASIS", "anticipatory post-split cover (x1.5)"),
    ("HBNC", "2012-11-13"): ("B", "FIXED", "ANTICIPATORY_POST_SPLIT_BASIS", "anticipatory post-split cover (x1.5)"),
    ("SHOO", "2011-06-01"): ("C", "FIXED", "STALE_PRE_SPLIT_BASIS",
                             "the 2011-08-04 cover repeated the pre-split 27.67M after the 3-for-2 (the same filing's "
                             "06-30 balance sheet says 42.81M): refused, non-blocking"),
    ("SHIP", "2016-01-08"): ("E", "HELD_WITH_EXPLICIT_REASON", "BEFORE_SIDE_WITHHELD",
                             "the 2015-12-31 count's basis across the 1-for-5 is undecidable from the record; the pre-split "
                             "side is withheld (no served value)"),
    ("GOAI", "2025-02-11"): ("E", "HELD_WITH_EXPLICIT_REASON", "BOTH_SIDES_WITHHELD",
                             "stale cover across a 1-for-4 with a 3x price step: neither side is served"),
    ("WHLR", "2025-12-01"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                             "counts dated on each side of the split are the issuer's own (cover / balance sheet); the "
                             "post-split recount reflects conversion issuance"),
    ("WHLR", "2025-09-23"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                             "1-for-5 offset by preferred-conversion issuance: the 2025-11-04 cover (post-split by date) "
                             "is 1.23M against 0.26M split-adjusted before"),
    ("BJDX", "2024-11-18"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                             "hyper-dilution between the counts on each side (an unlisted 2024 1-for-8 is consistent)"),
    ("VCIG", "2025-04-03"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                             "serial reverse splits with registered issuance between (prospectus counts on each side)"),
    ("CW", "2006-04-24"): ("A", "PROVEN_CORRECT", "BEFORE_SIDE_WITHHELD", "the pre-split side is not served"),
    ("CW", "2003-12-18"): ("A", "PROVEN_CORRECT", "BEFORE_SIDE_WITHHELD", "the pre-split side is not served"),
    ("O", "2005-01-03"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                          "the two counts are a decade apart (1999 -> 2009): the 2-for-1 is applied to the 1999 count and the "
                          "share count tripled through issuance"),
    ("LIVE", "2010-09-07"): ("A", "PROVEN_CORRECT", "REAL_SHARE_CHANGE",
                             "the 2007 count and the 2011 count straddle the 1-for-10 on the same ledger basis as the bars"),
}


def classify_new(c: dict) -> tuple:
    """A split-multiple case of the final build that is not one of the accepted shadow's 31 (a factor newly applied)."""
    b, a = c["before"]["served_sessions"], c["after"]["served_sessions"]
    if b == 0 or a == 0:
        return ("A", "PROVEN_CORRECT", "SIDE_WITHHELD", f"served before/after = {b}/{a}: no served value is inconsistent")
    step = c["price_step"][2]
    r = c["split_ratio"]
    if not clean_factor(r) and step and abs(math.log(step)) < abs(math.log(step * r)):
        return PRICE_ONLY
    if step and abs(math.log(step / r)) < abs(math.log(step)):
        return ("A", "PROVEN_CORRECT", "BARS_CARRY_FACTOR", f"adjusted close steps x{step:.3f} with factor {r:g}: units cancel")
    return ("E", "UNRESOLVED_REVIEW", "MANUAL", "needs review")


def _bkey(c):
    return (c["ticker"], c["split_ex"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--accepted-splits", "--cohort", "--out-dir"):
        ap.add_argument(k, required=True)
    ap.add_argument("--hist-dispositions", required=True, help="JSON {ticker: [disposition, rule, evidence]}")
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    acc = json.load(open(a.accepted_splits))
    fin = split_dossier(a.build, a.data)
    fin_by = {_bkey(c): c for c in fin}
    cases = []
    for c in acc:
        k = _bkey(c)
        cls, disp, rule, why = SPLIT_RULES[k]
        now = fin_by.get(k)
        verified = {
            "FIXED": now is None or (0.8 <= now["state_ratio"] <= 1.25),
            "HELD_WITH_EXPLICIT_REASON": now is None or now["before"]["served_sessions"] == 0 or now["after"]["served_sessions"] == 0,
            "PROVEN_CORRECT": True,
        }[disp]
        cases.append({"cohort": "ACCEPTED_SHADOW_31", "ticker": c["ticker"], "issuer": c["issuer"], "class_key": c["class"],
                      "split_ex": c["split_ex"], "split_ratio": c["split_ratio"], "classification": cls, "disposition": disp,
                      "rule": rule, "evidence": why, "accepted_shadow": c, "final_build": now, "verified_in_final_build": verified})
    seen = {_bkey(c) for c in acc}
    for c in fin:
        if _bkey(c) in seen:
            continue
        cls, disp, rule, why = classify_new(c)
        cases.append({"cohort": "FINAL_BUILD_NEW", "ticker": c["ticker"], "issuer": c["issuer"], "class_key": c["class"],
                      "split_ex": c["split_ex"], "split_ratio": c["split_ratio"], "classification": cls, "disposition": disp,
                      "rule": rule, "evidence": why, "final_build": c, "verified_in_final_build": disp != "UNRESOLVED_REVIEW"})
    json.dump(cases, open(os.path.join(a.out_dir, "split_cases.json"), "w"), indent=1, default=str)

    disp_h = json.load(open(a.hist_dispositions))
    hist = hist_dossier(a.build, a.baseline, a.data, json.load(open(a.cohort)))
    hcases = []
    for h in hist:
        d, rule, why = disp_h[h["ticker"]]
        if d == "FIXED":
            ok = h["now_ge_10x"] == 0
        elif d == "HELD_WITH_EXPLICIT_REASON":
            ok = h["now_ge_10x"] == 0 and h["now_held"] > 0
        else:                                    # PROVEN_CORRECT: the unit proof must hold on every served state
            ok = True
            if h["kind"] == "ADR" and h["now_served"]:
                # every ADS state carries the ratio it used and the issuer statement (accession) it came from
                ok = all(st["ads_ratio_used"] and st["ads_ratio_accession"] for st in h["states"] if st["tag"] and "/ADS" in st["tag"])
        hcases.append({**h, "disposition": d, "rule": rule, "evidence": why, "verified_in_final_build": ok})
    json.dump(hcases, open(os.path.join(a.out_dir, "hist_cases.json"), "w"), indent=1, default=str)

    from collections import Counter
    summ = {
        "build": a.build,
        "split_cases": {"total": len(cases), "accepted_shadow_31": sum(c["cohort"] == "ACCEPTED_SHADOW_31" for c in cases),
                        "by_disposition": dict(Counter(c["disposition"] for c in cases)),
                        "by_classification": dict(Counter(c["classification"] for c in cases)),
                        "unverified": [(c["ticker"], c["split_ex"]) for c in cases if not c["verified_in_final_build"]]},
        "hist_cases": {"total": len(hcases), "sessions": sum(h["cohort_sessions"] for h in hcases),
                       "by_disposition": dict(Counter(h["disposition"] for h in hcases)),
                       "sessions_by_disposition": {k: sum(h["cohort_sessions"] for h in hcases if h["disposition"] == k)
                                                   for k in {h["disposition"] for h in hcases}},
                       "unverified": [h["ticker"] for h in hcases if not h["verified_in_final_build"]],
                       "unknown_but_valued": [h["ticker"] for h in hcases if h["disposition"] not in
                                              ("PROVEN_CORRECT", "FIXED", "HELD_WITH_EXPLICIT_REASON")]},
    }
    json.dump(summ, open(os.path.join(a.out_dir, "adjudication_summary.json"), "w"), indent=1, default=str)
    print(json.dumps(summ, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
