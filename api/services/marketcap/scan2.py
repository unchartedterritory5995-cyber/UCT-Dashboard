"""Second-order historical consistency scan (VALIDATION ONLY -- nothing is mutated).

    python -m api.services.marketcap.scan2 --build B.db --baseline BASE.db --data C:/mcapdata --out scan2.json

Searches the SERVED history for states that look wrong in ways the earlier detectors were not built for:

  STEP_10X             a >= 10x cap step between consecutive valued days not explained by the price
  SHARE_STEP_10X       a >= 10x share-state step between consecutive served states (whatever the price did)
  TINY_STATE           a served state whose underlying raw count is < 10,000 shares
  ISOLATED_EXTREME     a served state (<= 120 sessions) >= 5x away, price-adjusted, from BOTH valued neighbours, same side
  REVERSION            states A -> B -> A' with B >= 3x from both A and A' (A' within 1.5x of A)
  SPLIT_LIKE           consecutive served states whose ratio is within 2% of a split factor with no ledger split between
  ONE_OFF_PARSED       a served text-parsed state no other filing corroborates (within 400 days, 1.5x) that is >= 3x from
                       a neighbour

Every finding carries its EVIDENCE CLASS from the observations behind it: CORROBORATED (another filing agrees),
BRIDGED (intermediate issuer counts move < 10x at a time), CAPITAL_EVENT (an offering / merger / tender filing between),
PRODUCTION_SHARED (production makes the same move). A finding with none of these is UNEXPLAINED.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter
from datetime import date

from .build import CAPITAL_EVENT_FORMS, COMMON_SPLIT_FACTORS, load_ref

TEXT_SOURCES = ("COVER_TEXT", "OFFERING_DOCUMENT_TEXT", "IPO_PROSPECTUS")


def _d(i: int) -> str:
    s = str(i)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def run(build: str, baseline: str, data: str) -> dict:
    B, S = sqlite3.connect(build), sqlite3.connect(baseline)
    px = sqlite3.connect(f"{data}/prices.db")
    inp = sqlite3.connect(f"{data}/inputs.db")
    ref = load_ref(f"{data}/ref.jsonl")
    findings = []
    for cik, t in B.execute("SELECT cik, primary_ticker FROM coverage WHERE primary_ticker IS NOT NULL").fetchall():
        caps = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d", (cik,)).fetchall()
        if len(caps) < 2:
            continue
        iss = f"cik:{cik}"
        cl = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
        prod = dict(S.execute("SELECT d, cap FROM base_daily WHERE ticker=?", (t,)))
        runs = B.execute("SELECT class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run WHERE issuer_id=? "
                         "ORDER BY start", (iss,)).fetchall()
        obs = B.execute("SELECT class_key, as_of, normalized_value, raw_value, accession, source_type, form, validation_status "
                        "FROM observation WHERE issuer_id=? AND normalized_value > 0", (iss,)).fetchall()
        obs = [o for o in obs if o[7] not in ("REJECTED_SOURCE_CONFLICT", "REJECTED_INVALID_UNIT", "REJECTED_NONPOSITIVE")]
        forms = sorted((f, fm) for f, fm in inp.execute("SELECT filing_date, form FROM filing WHERE cik=?", (cik,)) if fm in CAPITAL_EVENT_FORMS)
        splits = sorted(s.ex_date.isoformat() for s in ref.get(t, (None, []))[1])
        splits += [d for (d,) in B.execute("SELECT d FROM split_gap WHERE cik=? AND status='APPLIED'", (cik,))]
        capd = dict(caps)
        served = []
        for r in runs:
            n = sum(1 for d in capd if _d(d) >= r[1] and _d(d) <= r[2]) if False else \
                B.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d BETWEEN ? AND ?",
                          (cik, int(r[1].replace("-", "")), int(r[2].replace("-", "")))).fetchone()[0]
            if n:
                served.append((r, n))

        def corroborated(r):
            a = date.fromisoformat(r[5])
            return any(o[0] == r[0] and o[4] != r[4] and abs((date.fromisoformat(o[1]) - a).days) <= 400
                       and abs(math.log(o[2] / r[3])) < math.log(1.5) for o in obs)

        def raw_of(r):
            return next((o[3] for o in obs if o[4] == r[4] and o[0] == r[0] and o[1] == r[5]), None)

        def evidence(ra, rb):
            ev = []
            if corroborated(ra) and corroborated(rb):
                ev.append("CORROBORATED")
            if ra[0] == rb[0]:
                mids = sorted((o[1], o[2]) for o in obs if o[0] == ra[0] and ra[5] <= o[1] <= rb[5])
                vals = [ra[3]] + [v for _d, v in mids] + [rb[3]]
                if all(abs(math.log(y / x)) < math.log(10) for x, y in zip(vals, vals[1:])):
                    ev.append("BRIDGED")
            if any(ra[5] < f <= rb[5] for f, _fm in forms):
                ev.append("CAPITAL_EVENT")
            if any(ra[5] < s <= rb[5] for s in splits):
                ev.append("SPLIT_BETWEEN")
            return ev

        def add(kind, d0, d1, ra, rb, extra):
            ev = evidence(ra, rb) if ra and rb else []
            p0, p1 = prod.get(d0), prod.get(d1)
            if p0 and p1 and capd.get(d0) and capd.get(d1) and abs(math.log((capd[d1] / capd[d0]) / (p1 / p0))) < math.log(2):
                ev.append("PRODUCTION_SHARED")
            findings.append({"kind": kind, "ticker": t, "cik": cik, "d0": d0, "d1": d1, "evidence": ev,
                             "before": ra and list(ra), "after": rb and list(rb), **extra})

        def run_at(d):
            ds = _d(d)
            return [r for r, _n in served if r[1] <= ds <= r[2]]

        days = [d for d, _c in caps]
        for a, b in zip(days, days[1:]):
            if not (cl.get(a) and cl.get(b)):
                continue
            q = math.log(capd[b] / capd[a]) - math.log(cl[b] / cl[a])
            ra, rb = run_at(a), run_at(b)
            sa, sb = sum(r[3] for r in ra), sum(r[3] for r in rb)
            if abs(q) >= math.log(10):
                add("STEP_10X", a, b, ra[0] if ra else None, rb[0] if rb else None, {"unexplained": math.exp(q)})
            elif sa and sb and abs(math.log(sb / sa)) >= math.log(10):
                add("SHARE_STEP_10X", a, b, ra[0], rb[0], {"share_ratio": sb / sa})
        for (r, n) in served:
            raw = raw_of(r)
            if raw is not None and raw < 10_000:
                findings.append({"kind": "TINY_STATE", "ticker": t, "cik": cik, "run": list(r), "sessions": n, "raw": raw,
                                 "evidence": ["CORROBORATED"] if corroborated(r) else []})
        # neighbour structure of served runs (per class)
        bycls = {}
        for r, n in served:
            bycls.setdefault(r[0], []).append((r, n))
        for ck, rs in bycls.items():
            for (p, _pn), (m, mn), (n_, _nn) in zip(rs, rs[1:], rs[2:]):
                if not (p[3] and m[3] and n_[3]):
                    continue
                up, dn = m[3] / p[3], m[3] / n_[3]
                if abs(math.log(up)) >= math.log(3) and abs(math.log(dn)) >= math.log(3) and (up > 1) == (dn > 1):
                    if abs(math.log(n_[3] / p[3])) < math.log(1.5):
                        add_kind = "REVERSION"
                    elif mn <= 120 and abs(math.log(up)) >= math.log(5) and abs(math.log(dn)) >= math.log(5):
                        add_kind = "ISOLATED_EXTREME"
                    else:
                        continue
                    findings.append({"kind": add_kind, "ticker": t, "cik": cik, "run": list(m), "sessions": mn,
                                     "vs_prev": up, "vs_next": 1 / dn, "evidence": ["CORROBORATED"] if corroborated(m) else []})
            for (p, _pn), (m, _mn) in zip(rs, rs[1:]):
                if not (p[3] and m[3]):
                    continue
                k = max(m[3] / p[3], p[3] / m[3])
                if k >= 2 and any(abs(math.log(k / f)) < 0.02 for f in COMMON_SPLIT_FACTORS) \
                        and not any(p[5] < s <= m[5] for s in splits):
                    findings.append({"kind": "SPLIT_LIKE", "ticker": t, "cik": cik, "run": list(m), "prev": list(p), "ratio": m[3] / p[3],
                                     "evidence": evidence(p, m)})
                if m[6] in TEXT_SOURCES and not corroborated(m) and k >= 3:
                    findings.append({"kind": "ONE_OFF_PARSED", "ticker": t, "cik": cik, "run": list(m), "prev": list(p),
                                     "ratio": m[3] / p[3], "evidence": []})
    for f in findings:
        ev = set(f["evidence"])
        f["status"] = "EXPLAINED" if (ev & {"PRODUCTION_SHARED", "BRIDGED"} or {"CORROBORATED", "CAPITAL_EVENT"} <= ev
                                      or (f["kind"] in ("TINY_STATE", "ISOLATED_EXTREME", "REVERSION") and "CORROBORATED" in ev
                                          and f["kind"] != "REVERSION")) else "UNEXPLAINED"
    by = Counter((f["kind"], f["status"]) for f in findings)
    return {"counts": {f"{k}:{s}": n for (k, s), n in sorted(by.items())}, "findings": findings}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = run(a.build, a.baseline, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps(res["counts"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
