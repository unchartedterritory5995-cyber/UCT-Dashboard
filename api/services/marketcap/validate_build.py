"""Validation of one build (Gates G/J/K): split continuity, share-state jump census, current cross-check.

    python -m api.services.marketcap.validate_build --build B.db --data C:/mcapdata --out val.json

SPLIT CONTINUITY. Prices are split-adjusted to today's basis and every share observation is normalized with the
same security's ledger, so a split must move NEITHER side. For every ledger split inside a valued span, the
share state in force just before the ex-date is compared with the first state that supersedes it after the
ex-date (the first post-split filing): a ratio outside [0.8, 1.25] that is a near-multiple of the split ratio is a
split-normalization defect.

STATE JUMPS. Every change of the selected share state by more than 1.5x (or less than 1/1.5) is listed with both
accessions, for review (issuances, mergers, buybacks are legitimate; a clean split multiple is not).

CURRENT CROSS-CHECK. Latest company capitalization vs Massive's CURRENT `market_cap` (reference only -- Massive
current values are a consumer, never an input): ratio distribution and the largest disagreements.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from collections import Counter
from datetime import date

from .build import load_ref


def run(build: str, data: str) -> dict:
    db = sqlite3.connect(build)
    ref = load_ref(f"{data}/ref.jsonl")
    out: dict = {}
    # map issuer -> primary ticker + listing start
    cov = {cik: (t, ls) for cik, t, ls in db.execute("SELECT cik, primary_ticker, listing_start FROM coverage")}
    runs = {}
    for iss, ck, s, e, sh, accn, as_of, src in db.execute(
            "SELECT issuer_id, class_key, start, end, shares, obs_accession, as_of, source_type FROM state_run ORDER BY issuer_id, class_key, start"):
        runs.setdefault((iss, ck), []).append((s, e, sh, accn, as_of, src))
    comps = {}
    for iss, comp in db.execute("SELECT issuer_id, components FROM regime"):
        for ck, pt, _m, _ev in json.loads(comp):
            comps[(iss, ck)] = pt
    split_checks, split_bad = 0, []
    for (iss, ck), rs in runs.items():
        pt = comps.get((iss, ck))
        if not pt or pt not in ref:
            continue
        for sp in ref[pt][1]:
            ex = sp.ex_date.isoformat()
            before = [r for r in rs if r[0] < ex]
            after = [r for r in rs if r[0] >= ex and r[4] >= ex]
            if not before or not after:
                continue
            b, a = before[-1], after[0]
            if a[3] == b[3]:
                continue
            split_checks += 1
            ratio = a[2] / b[2]
            if not (0.8 <= ratio <= 1.25):
                near = min((abs(math.log(ratio) - k * math.log(sp.ratio)) for k in (-1, 1)), default=9)
                split_bad.append({"issuer": iss, "class": ck, "ticker": pt, "ex": ex, "split": sp.ratio, "state_ratio": round(ratio, 4),
                                  "split_multiple": near < 0.05, "before": b, "after": a})
    out["split_continuity"] = {"checked": split_checks, "outside_band": len(split_bad),
                               "split_multiple_defects": sum(1 for x in split_bad if x["split_multiple"]), "examples": split_bad[:40]}
    jumps = []
    for (iss, ck), rs in runs.items():
        for p, n in zip(rs, rs[1:]):
            if p[2] and n[2] and (n[2] / p[2] > 1.5 or n[2] / p[2] < 1 / 1.5):
                jumps.append({"issuer": iss, "class": ck, "at": n[0], "ratio": round(n[2] / p[2], 3), "from": p[3], "to": n[3],
                              "from_src": p[5], "to_src": n[5]})
    out["state_jumps"] = {"count": len(jumps), "issuers": len({j["issuer"] for j in jumps}),
                          "by_source_pair": dict(Counter(f"{j['from_src']}->{j['to_src']}" for j in jumps)),
                          "examples": sorted(jumps, key=lambda j: -abs(math.log(j["ratio"])))[:60]}
    cmp_rows = []
    for cik, (t, _ls) in cov.items():
        last =db.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (cik,)).fetchone()
        m = MASSIVE_CAP.get(t) if MASSIVE_CAP else None
        if last and m:
            cmp_rows.append((t, cik, last[0], last[1], m, last[1] / m))
    if cmp_rows:
        rat = sorted(x[5] for x in cmp_rows)
        q = lambda p: rat[min(len(rat) - 1, int(p * len(rat)))]
        out["massive_current"] = {"n": len(rat), "p05": q(0.05), "p50": q(0.5), "p95": q(0.95),
                                  "within_5pct": sum(1 for x in rat if abs(x - 1) <= 0.05) / len(rat),
                                  "within_20pct": sum(1 for x in rat if abs(x - 1) <= 0.20) / len(rat),
                                  "worst": sorted(cmp_rows, key=lambda x: -abs(math.log(x[5])))[:40]}
    return out


MASSIVE_CAP: dict = {}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    for line in open(f"{a.data}/ref.jsonl", encoding="utf-8"):
        t, d, _s, _e = json.loads(line)
        if d and d.get("market_cap"):
            MASSIVE_CAP[t] = float(d["market_cap"])
    res = run(a.build, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("examples", "worst")} for k, v in res.items()}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
