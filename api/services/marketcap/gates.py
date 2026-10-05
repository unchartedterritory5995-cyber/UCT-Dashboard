"""Market Cap V1 AUTOMATED RELEASE GATES -- evaluated from a build's report suite before ANY pointer move.

    python -m api.services.marketcap.gates --build B.db --reports DIR [--adjudication ADJ_DIR] --out validation.json

Every gate is a fixed, mechanical predicate over the report suite (validation.run_suite) and the build DB. A gate
is never reinterpreted to obtain PASS: a refresh that introduces anything the human adjudications do not already
cover FAILS here, keeps the previous authority, and is escalated (BUILD_FAILED). Automated acceptance (this file) is
a precondition of publication and of every automated pointer advance; it never substitutes for the HUMAN cutover
acceptance of the first authority or of a methodology change.

  A  unexplained gaps = 0                    universe_audit v1_unexplained_sessions, final_checks unexplained/bug days
  B  V1-introduced current >= 10x = 0        magnitude_scan outliers classed RECENT_V1_INTRODUCED
  C  unadjudicated historical >= 10x = 0     every UNDECIDED / MIXED / V1_JUMPS block lies inside an adjudicated case
  D  lookahead = 0                           state runs before known_from; observations known before public
  E  contamination = 0                       V1 values before the security's listing (audit F + ARM)
  F  ARM = pass                              every legit session valued, none before listing, no missing legit day
  G  unresolved split-multiple = 0           every split-multiple case dispositioned (none unverified)
  H  invalid units used = 0                  no state backed by a REJECTED_INVALID_UNIT observation
  I  unresolved ADR ratio used = 0           no state backed only by a REJECTED_ADR_RATIO_UNRESOLVED observation
  J  incomplete multi-class valued = 0       no valued day inside an UNRESOLVED structure regime
  K  prior cohorts unknown = 0               adjudicated split / historical / cap-step cohorts: nothing unknown
  L  unknown >= 10x steps = 0                cap_step_summary unknown_but_valued
  M  known-wrong second-order states = 0     every scan2 UNEXPLAINED finding is human-adjudicated PROVEN_CORRECT
  N  build/validator semantic parity         cap_step_summary gate N
  R  identity / history retention            identity_delta: every valued day of the accepted reference build that this
                                             build no longer values is reason-coded or attested (never silently gone)
plus
  METHODOLOGY  the build's methodology files are the pinned ones (methodology.drift() empty, same semantics version)
  BACKING      every state run is backed by an ACCEPTED observation
  INTEGRITY    duplicate days / overlapping gaps / inverted runs = 0, and the suite describes THIS build
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3

from . import methodology as M


def _j(d, *p):
    return json.load(open(os.path.join(d, *p)))


def evaluate(build: str, reports: str, adjudication: str | None = None) -> dict:
    B = sqlite3.connect(f"file:{build}?mode=ro", uri=True)
    man = dict(B.execute("SELECT key, value FROM manifest"))
    bid = man.get("build_id")
    fc = _j(reports, "final_checks.json")
    ua = _j(reports, "universe_audit.json")
    ms = _j(reports, "magnitude_scan.json")
    ha = _j(reports, "history_adjudication.json")
    arm = _j(reports, "arm_before_after.json")
    adj = _j(reports, "adjudication", "adjudication_summary.json")
    hc = _j(reports, "adjudication", "hist_cases.json")
    cs = _j(reports, "cap_steps", "cap_step_summary.json")
    s2 = _j(reports, "scan2.json")
    so_path = os.path.join(adjudication or reports, "second_order_adjudication.json")
    so = json.load(open(so_path)) if os.path.exists(so_path) else {"residual_unexplained_findings": []}
    g: dict[str, dict] = {}

    def gate(k, ok, value, definition):
        g[k] = {"pass": bool(ok), "value": value, "definition": definition}

    un = ua["unexplained"]["v1_unexplained_sessions"]
    gate("A", un == 0 and fc["unexplained_days"] == 0 and fc["bug_reason_days"] == 0 and not fc["bug_issuers"],
         {"unexplained_sessions": un, "unexplained_days": fc["unexplained_days"], "bug_reason_days": fc["bug_reason_days"],
          "bug_issuers": len(fc["bug_issuers"])}, "unexplained gaps = 0")
    v1i = [o["ticker"] for o in ms["outliers"] if o["class"] == "RECENT_V1_INTRODUCED"]
    gate("B", not v1i, {"recent_v1_introduced": v1i[:20], "outliers_by_class": ms["by_class"]}, "V1-introduced current >= 10x = 0")
    cover = {}
    for c in hc:
        cover.setdefault(c["ticker"], []).append((c["interval"][0], c["interval"][1], c.get("disposition")))
    unadj = []
    for t, blocks in ha["per_security"].items():
        for b in blocks:
            if b["verdict"] not in ("UNDECIDED", "MIXED", "V1_JUMPS"):
                continue
            if not any(lo <= b["start"] and b["end"] <= hi and disp not in (None, "UNKNOWN_BUT_VALUED")
                       for lo, hi, disp in cover.get(t, [])):
                unadj.append({"ticker": t, **b})
    gate("C", not unadj, {"unadjudicated_blocks": unadj[:20], "n": len(unadj)},
         "every UNDECIDED / MIXED / V1_JUMPS >= 10x block lies inside an adjudicated case")
    an = ua["anomalies"]
    gate("D", fc["lookahead_state_runs_before_known_from"] == 0 and fc["observations_known_before_public"] == 0
         and an["L_known_before_public"]["count"] == 0 and an["M_lookahead_state_before_known"]["count"] == 0,
         {"state_runs": fc["lookahead_state_runs_before_known_from"], "observations": fc["observations_known_before_public"]},
         "lookahead = 0")
    gate("E", an["F_v1_cap_before_listing"]["count"] == 0 and arm["v1_before_listing"] == 0,
         {"v1_cap_before_listing": an["F_v1_cap_before_listing"]["count"], "arm_before_listing": arm["v1_before_listing"]},
         "V1 values before listing = 0")
    gate("F", arm["v1_valued_legit"] == arm["legit_sessions"] and arm["v1_before_listing"] == 0 and not arm["v1_missing_legit"],
         {k: arm[k] for k in ("legit_sessions", "v1_valued_legit", "v1_before_listing", "max_rel_diff_where_both")},
         "ARM: every legit session valued, none before listing")
    gate("G", not adj["split_cases"]["unverified"], {"split_cases": adj["split_cases"]["total"],
                                                     "unverified": adj["split_cases"]["unverified"][:20]},
         "every split-multiple case dispositioned")
    gate("H", fc["invalid_unit_used"] == 0 and fc["other_member_classes_in_state"] == 0,
         {"invalid_unit_used": fc["invalid_unit_used"], "other_member_classes": fc["other_member_classes_in_state"]},
         "invalid units used = 0")
    backed = """SELECT COUNT(*) FROM state_run s WHERE NOT EXISTS (SELECT 1 FROM observation o WHERE o.accession=s.obs_accession
                AND o.issuer_id=s.issuer_id AND o.class_key=s.class_key AND o.as_of=s.as_of
                AND o.validation_status IN ('ACCEPTED','ACCEPTED_RESTATED_BASIS'))"""
    adr_only = """SELECT COUNT(*) FROM state_run s WHERE EXISTS (SELECT 1 FROM observation o WHERE o.accession=s.obs_accession
                AND o.issuer_id=s.issuer_id AND o.class_key=s.class_key AND o.as_of=s.as_of
                AND o.validation_status='REJECTED_ADR_RATIO_UNRESOLVED') AND NOT EXISTS (SELECT 1 FROM observation o
                WHERE o.accession=s.obs_accession AND o.issuer_id=s.issuer_id AND o.class_key=s.class_key AND o.as_of=s.as_of
                AND o.validation_status IN ('ACCEPTED','ACCEPTED_RESTATED_BASIS'))"""
    n_adr = B.execute(adr_only).fetchone()[0]
    gate("I", n_adr == 0, {"states_backed_only_by_unresolved_adr_ratio": n_adr}, "unresolved ADR ratio used = 0")
    n_j = 0
    for iss, s, e in B.execute("SELECT issuer_id, start, end FROM regime WHERE kind='UNRESOLVED'"):
        n_j += B.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?",
                         (int(iss[4:]), int(s.replace("-", "")), int(e.replace("-", "")))).fetchone()[0]
    gate("J", n_j == 0 and an["G_multi_class_same_price_ticker"]["count"] == 0,
         {"valued_days_in_unresolved_regimes": n_j}, "incomplete multi-class valued = 0")
    hcs = adj["hist_cases"]
    oc = cs["original_cohort"]["by_disposition"]
    gate("K", not adj["split_cases"]["unverified"] and not hcs["unverified"] and not hcs["unknown_but_valued"]
         and "UNKNOWN_BUT_VALUED" not in oc,
         {"split_unverified": len(adj["split_cases"]["unverified"]), "hist_unverified": len(hcs["unverified"]),
          "hist_unknown": len(hcs["unknown_but_valued"]), "cap_step_cohort": oc}, "prior cohorts unknown = 0")
    ub = cs["day_to_day_scan"]["unknown_but_valued"]
    gate("L", ub == 0, {"unknown_but_valued": ub, "served_10x_steps": cs["day_to_day_scan"]["unexplained_by_price_served"]},
         "unknown >= 10x steps = 0")
    adjudicated = [(r["kind"], r["ticker"], r["evidence"]) for r in so.get("residual_unexplained_findings", [])
                   if r.get("disposition") == "PROVEN_CORRECT"]
    open_ = []
    for f in s2["findings"]:
        if f.get("status") != "UNEXPLAINED":
            continue
        accn = (f.get("run") or [None] * 5)[4]
        if not any(k == f["kind"] and t == f["ticker"] and accn and accn in ev for k, t, ev in adjudicated):
            open_.append({"kind": f["kind"], "ticker": f["ticker"], "run_accession": accn})
    gate("M", not open_ and so.get("known_wrong_discovered_and_still_served", 0) == 0,
         {"unadjudicated_unexplained": open_[:20], "n": len(open_)}, "known-wrong second-order states = 0")
    n = cs["gate_N_build_validator_parity"]
    gate("N", n["pass"] and n["semantics"] == M.EXTREME_STEP_SEMANTICS, n, "build/validator semantic parity")
    idp = os.path.join(reports, "identity_delta.json")
    idd = json.load(open(idp)) if os.path.exists(idp) else {"pass": False, "error": "identity_delta.json missing"}
    gate("R", idd.get("pass") is True,
         {"reference": idd.get("reference"), "error": idd.get("error"),
          "removed_by_class": (idd.get("observations") or {}).get("removed_by_class"),
          "failing_blocks": (idd.get("failing_blocks") or [])[:20],
          "issuers_removed_unexplained": (idd.get("issuers") or {}).get("removed_unexplained")},
         "no unexplained historical issuer or observation loss vs the accepted reference")
    drift = M.drift()
    gate("METHODOLOGY", not drift and man.get("code_commit") is not None, {"drift": drift}, "pinned methodology files")
    nb = B.execute(backed).fetchone()[0]
    gate("BACKING", nb == 0, {"state_runs_without_accepted_observation": nb}, "every state is backed by an ACCEPTED observation")
    integ = {k: fc[k] for k in ("duplicate_cap_days", "gap_runs_overlapping_values", "state_runs_inverted")}
    gate("INTEGRITY", not any(integ.values()) and ua.get("build") == bid and os.path.basename(cs["build"]) == os.path.basename(build),
         {**integ, "suite_build": ua.get("build"), "build_id": bid}, "structural integrity, and the suite describes this build")
    status = "PASS" if all(v["pass"] for v in g.values()) else "FAIL"
    return {"status": status, "build_id": bid, "failed": [k for k, v in g.items() if not v["pass"]], "gates": g,
            "methodology": M.identity()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--reports", required=True)
    ap.add_argument("--adjudication")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = evaluate(a.build, a.reports, a.adjudication)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({"status": res["status"], "failed": res["failed"]}))
    return 0 if res["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
