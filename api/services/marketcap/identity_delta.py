"""Market Cap V1 IDENTITY / HISTORY RETENTION DELTA -- the report behind release gate R (owner decision 2026-10-05).

    python -m api.services.marketcap.identity_delta --build NEW.db --reference ACCEPTED.db \
        [--attestations identity_attestations.json] --out identity_delta.json

HISTORICAL TRUTH DOES NOT DISAPPEAR MERELY BECAUSE AN ISSUER IS NO LONGER CURRENT. Every valued (issuer, day) of the
accepted REFERENCE build that the new build no longer values must be ATTRIBUTABLE:

  EVIDENCE_HOLD          the new build withholds the day with a reason code of the accepted methodology (new evidence
                         made the state unresolved / stale / held). Allowed; every block is listed.
  IDENTITY_WITHHELD      the issuer's retained symbol was reassigned (identity_retention WITHHELD_REASSIGNED: Massive names
                         another CIK, so the symbol's reference record and price basis are someone else's). The build is
                         right to withhold, but established history is going away: FAILS unless attested.
  ATTESTED               a human attestation (cik, start, end, reason, evidence) covers the block. Allowed; listed.
  IDENTITY_UNATTESTED    the new build gives the day an IDENTITY reason (not yet listed / ticker reuse / delisted) that the
                         reference did not -- a listing-boundary change -- OR the issuer's ticker mapping changed (a symbol
                         added / dropped vs the reference) and the day is now withheld for any reason: a mapping change
                         can induce a hold (a retained old symbol beside a renamed one reads as a second class), so it is
                         never accepted as "new evidence" without a person. FAILS unless attested.
  UNEXPLAINED            the day is neither valued nor reason-coded in the new build -- the issuer or its ticker simply
                         vanished (WBS / RITR before the identity ledger). FAILS.

The gate also FAILS when there is no reference (a first build must say so explicitly: --reference NONE_FIRST_BUILD) --
a missing comparison is never a pass. Values that CHANGE are counted, never gated (new evidence moves values).
"""
from __future__ import annotations

import argparse
import bisect
import json
import os
import sqlite3
from collections import Counter, defaultdict

from . import reasons as R

IDENTITY_REASONS = frozenset({R.TICKER_REUSE, R.NOT_YET_LISTED, R.DELISTED})
FIRST_BUILD = "NONE_FIRST_BUILD"
FAILING = ("IDENTITY_UNATTESTED", "IDENTITY_WITHHELD", "UNEXPLAINED")


def _ro(p: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def _has(db, table: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone() is not None


def _primary(db) -> dict[int, str]:
    return {c: t for c, t in db.execute("SELECT cik, primary_ticker FROM coverage")} if _has(db, "coverage") else {}


def delta(build: str, reference: str, attestations: list | None = None) -> dict:
    if reference == FIRST_BUILD:
        return {"reference": FIRST_BUILD, "pass": True, "first_build": True,
                "note": "explicitly declared first build: no accepted evidence state to retain"}
    if not reference or not os.path.exists(reference):
        return {"reference": reference, "pass": False, "error": "no identity reference build: retention cannot be proven"}
    N, A = _ro(build), _ro(reference)
    nid = dict(N.execute("SELECT key, value FROM manifest")).get("build_id")
    rid = dict(A.execute("SELECT key, value FROM manifest")).get("build_id")
    names = {**_primary(A), **_primary(N)}
    att = defaultdict(list)
    for a in attestations or []:
        att[int(a["cik"])].append((int(a["start"]), int(a["end"]), a["reason"], a.get("evidence", "")))
    withheld = defaultdict(list)
    retained = []
    succession = defaultdict(list)                     # M3.1: (from, to, class, evidence) per cik
    if _has(N, "identity_retention"):
        for cik, t, last, st, why, kept, after in N.execute("SELECT * FROM identity_retention"):
            if st in ("SUCCESSION_BOUNDARY", "SUCCESSION_UNCERTAIN", "SUCCESSOR_FROM"):
                j = json.loads(why)
                if st == "SUCCESSOR_FROM":
                    rng = (0, j["successor_from"] - 1, "SUCCESSION_UNCERTAIN" if j["kind"] == "UNCERTAIN" else "SUCCESSION_BOUNDARY")
                else:
                    rng = (j["withheld_from"], 99991231, st)
                succession[cik].append((rng[0], rng[1], rng[2], json.dumps(j["evidence"], default=str)[:300]))
                retained.append({"cik": cik, "ticker": t, "status": st, "detail": j})
                continue
            if st.startswith("WITHHELD"):
                withheld[cik].append({"ticker": t, "status": st, "reason": why})
            else:
                retained.append({"cik": cik, "ticker": t, "last_attributed": last, "status": st, "bars_kept": kept,
                                 "bars_after_attribution": after})

    # the comparison runs inside SQLite (13M+ valued days per build): the reference is ATTACHed read-only
    N.execute("ATTACH DATABASE ? AS ref", (f"file:{reference}?mode=ro",))
    ref_n = N.execute("SELECT COUNT(*) FROM ref.cap_daily").fetchone()[0]
    new_n = N.execute("SELECT COUNT(*) FROM main.cap_daily").fetchone()[0]
    removed: dict[int, list] = defaultdict(list)
    for c, d in N.execute("SELECT r.cik, r.d FROM ref.cap_daily r WHERE NOT EXISTS (SELECT 1 FROM main.cap_daily n "
                          "WHERE n.cik=r.cik AND n.d=r.d) ORDER BY r.cik, r.d"):
        removed[c].append(d)
    added = dict(N.execute("SELECT n.cik, COUNT(*) FROM main.cap_daily n WHERE NOT EXISTS (SELECT 1 FROM ref.cap_daily r "
                           "WHERE r.cik=n.cik AND r.d=n.d) GROUP BY n.cik"))
    changed = dict(N.execute("SELECT n.cik, COUNT(*) FROM main.cap_daily n JOIN ref.cap_daily r ON r.cik=n.cik AND r.d=n.d "
                             "WHERE ABS(n.cap / r.cap - 1) > 1e-9 GROUP BY n.cik"))
    ref_iss = {c for (c,) in N.execute("SELECT DISTINCT cik FROM ref.cap_daily")}
    new_iss = {c for (c,) in N.execute("SELECT DISTINCT cik FROM main.cap_daily")}
    N.execute("DETACH DATABASE ref")
    ref_map, new_map = defaultdict(set), defaultdict(set)
    for t, c in N.execute("SELECT DISTINCT ticker, cik FROM ticker_map"):
        new_map[c].add(t)
    for t, c in A.execute("SELECT DISTINCT ticker, cik FROM ticker_map"):
        ref_map[c].add(t)
    mapping_changed = {c for c in set(ref_map) | set(new_map) if ref_map.get(c, set()) != new_map.get(c, set())}
    blocks, by_class, by_reason = [], Counter(), Counter()
    for c, days in removed.items():
        gaps = sorted(N.execute("SELECT start, end, reason FROM gap_run WHERE cik=?", (c,)).fetchall())
        starts = [g[0] for g in gaps]

        def reason_on(d):
            i = bisect.bisect_right(starts, d) - 1
            return gaps[i][2] if i >= 0 and gaps[i][1] >= d else None

        def classify(d, r):
            for s, e, why, _ev in att.get(c, []):
                if s <= d <= e:
                    return "ATTESTED", why
            for s, e, cls, ev in succession.get(c, []):
                if s <= d <= e:                        # a filing-evidenced succession boundary (listed, never silent)
                    return cls, ev
            if r is None:
                return ("IDENTITY_WITHHELD", "WITHHELD_REASSIGNED") if withheld.get(c) else ("UNEXPLAINED", None)
            if r in IDENTITY_REASONS:
                return "IDENTITY_UNATTESTED", r
            if c in mapping_changed:
                return "IDENTITY_UNATTESTED", f"{r} (ticker mapping changed)"
            return "EVIDENCE_HOLD", r
        cur = None
        for d in days:
            k = classify(d, reason_on(d))
            if cur and cur["class"] == k[0] and cur["reason"] == k[1]:
                cur["end"], cur["n_days"] = d, cur["n_days"] + 1
            else:
                cur = {"cik": c, "ticker": names.get(c), "start": d, "end": d, "n_days": 1, "class": k[0], "reason": k[1]}
                blocks.append(cur)
            by_class[k[0]] += 1
            by_reason[k[1] or "NONE"] += 1
    gone = sorted(ref_iss - new_iss)
    gone_unexplained = [c for c in gone if any(b["cik"] == c and b["class"] in FAILING for b in blocks)]
    rt = {(t, c) for t, c in A.execute("SELECT DISTINCT ticker, cik FROM ticker_map")}
    nt = {(t, c) for t, c in N.execute("SELECT DISTINCT ticker, cik FROM ticker_map")}
    failing = [b for b in blocks if b["class"] in FAILING]
    out = {
        "reference": {"build_id": rid, "path": reference}, "build": {"build_id": nid, "path": build},
        "issuers": {"reference_valued": len(ref_iss), "new_valued": len(new_iss), "retained": len(ref_iss & new_iss),
                    "added": sorted(new_iss - ref_iss), "removed": [{"cik": c, "ticker": names.get(c)} for c in gone],
                    "removed_unexplained": [{"cik": c, "ticker": names.get(c)} for c in gone_unexplained]},
        "observations": {"reference_valued_days": ref_n, "new_valued_days": new_n, "removed": sum(map(len, removed.values())),
                         "added": sum(added.values()), "changed": sum(changed.values()),
                         "removed_by_class": dict(by_class), "removed_by_reason": dict(by_reason),
                         "added_by_issuer": {str(c): n for c, n in sorted(added.items())},
                         "changed_by_issuer": {str(c): n for c, n in sorted(changed.items())}},
        "ticker_map": {"added": sorted([list(x) for x in nt - rt]), "removed": sorted([list(x) for x in rt - nt]),
                       "issuers_with_mapping_change": len(mapping_changed),
                       "retained": retained, "withheld": {str(c): v for c, v in withheld.items()}},
        "removed_blocks": blocks, "failing_blocks": failing,
        "pass": not failing and not gone_unexplained,
    }
    A.close()
    N.close()
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--reference", required=True)
    ap.add_argument("--attestations")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    att = json.load(open(a.attestations)) if a.attestations else []
    res = delta(a.build, a.reference, att)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({"pass": res["pass"], "removed": res.get("observations", {}).get("removed"),
                      "failing_blocks": len(res.get("failing_blocks", []))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
