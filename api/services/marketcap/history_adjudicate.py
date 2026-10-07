"""Adjudicate every block of sessions where V1 and production are >= 10x apart, by CONTINUITY.

    python -m api.services.marketcap.history_adjudicate --build B.db --baseline BASE.db --out adjudication.json

At each edge of a disagreement block, compare each side's cap step with the price step over the same days. The side
whose cap moves with the price (|log cap step - log price step| < log 1.5) is CONTINUOUS; the side that jumps is the
one that changed basis there. Verdicts per block: PRODUCTION_JUMPS (V1 continuous at an edge where production is not),
V1_JUMPS, BOTH_CONTINUOUS (the disagreement is a constant basis difference across the whole block -- resolved by the
structure: ADR ratio, class sum), UNDECIDED (no valued neighbour on either side).
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter


def run(build: str, baseline: str) -> dict:
    B = sqlite3.connect(build)
    S = sqlite3.connect(baseline)
    px = sqlite3.connect(build.replace("\\", "/").rsplit("/builds/", 1)[0] + "/prices.db")
    verdicts = Counter()
    sess = Counter()
    per = {}
    for cik, t in B.execute("SELECT cik, primary_ticker FROM coverage").fetchall():
        base = dict(S.execute("SELECT d, cap FROM base_daily WHERE ticker=?", (t,)))
        if not base:
            continue
        v1 = dict(B.execute("SELECT d, cap FROM cap_daily WHERE cik=?", (cik,)))
        both = sorted(d for d in v1 if d in base and v1[d] and base[d])
        bad = [d for d in both if abs(math.log10(v1[d] / base[d])) >= 1]
        if not bad:
            continue
        close = dict(px.execute("SELECT d, c FROM bar WHERE ticker=?", (t.replace(".", "-"),)))
        idx = {d: i for i, d in enumerate(both)}
        blocks, cur = [], [bad[0]]
        for d in bad[1:]:
            if idx[d] == idx[cur[-1]] + 1:
                cur.append(d)
            else:
                blocks.append(cur)
                cur = [d]
        blocks.append(cur)
        out = []
        for blk in blocks:
            res = []
            for inside, outside in ((blk[0], both[idx[blk[0]] - 1] if idx[blk[0]] > 0 else None),
                                    (blk[-1], both[idx[blk[-1]] + 1] if idx[blk[-1]] + 1 < len(both) else None)):
                if outside is None or not close.get(inside) or not close.get(outside):
                    continue
                p = math.log(close[outside] / close[inside])
                v_ok = abs(math.log(v1[outside] / v1[inside]) - p) < math.log(1.5)
                b_ok = abs(math.log(base[outside] / base[inside]) - p) < math.log(1.5)
                res.append((v_ok, b_ok))
            if not res:
                v = "UNDECIDED"
            elif any(v and not b for v, b in res) and not any(b and not v for v, b in res):
                v = "PRODUCTION_JUMPS"
            elif any(b and not v for v, b in res) and not any(v and not b for v, b in res):
                v = "V1_JUMPS"
            elif all(v and b for v, b in res):
                v = "BOTH_CONTINUOUS"
            else:
                v = "MIXED"
            verdicts[v] += 1
            sess[v] += len(blk)
            out.append({"start": blk[0], "end": blk[-1], "sessions": len(blk), "verdict": v,
                        "ratio_v1_over_production": round(v1[blk[0]] / base[blk[0]], 6)})
        per[t] = out
    return {"blocks_by_verdict": dict(verdicts), "sessions_by_verdict": dict(sess), "per_security": per}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--build", "--baseline", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = run(a.build, a.baseline)
    json.dump(res, open(a.out, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "per_security"}))
    v1j = {t: [b for b in bl if b["verdict"] in ("V1_JUMPS", "MIXED", "UNDECIDED")] for t, bl in res["per_security"].items()}
    for t, bl in v1j.items():
        if bl:
            print(t, bl[:3])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
