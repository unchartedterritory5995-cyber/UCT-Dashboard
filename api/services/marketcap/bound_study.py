"""Is the 15-month (456-day) safety bound right, or is a cadence-aware bound materially safer? (owner ruling 2)

    python -m api.services.marketcap.bound_study --build B.db --out bound.json

For every valued trading day the carried share state has an AGE (days since its as-of date). When the state is
later superseded, the NEW count measures what carrying the old one cost: err = |ln(new / old)|. We aggregate by
age bucket x the issuer's own filing CADENCE (median gap between consecutive accepted as-of dates) and report the
share of carried days whose value was off by > 10% / > 25% when finally corrected, plus how many days each
candidate bound would have withheld.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import statistics
import sys
from collections import defaultdict
from datetime import date

AGE = [(0, 120), (120, 200), (200, 300), (300, 400), (400, 457)]


def cadence_class(gaps: list[int]) -> str:
    if not gaps:
        return "unknown"
    m = statistics.median(gaps)
    return "quarterly" if m <= 120 else "semiannual" if m <= 220 else "annual"


def run(build: str) -> dict:
    db = sqlite3.connect(build)
    runs = defaultdict(list)
    for iss, ck, s, e, sh, as_of in db.execute("SELECT issuer_id, class_key, start, end, shares, as_of FROM state_run ORDER BY issuer_id, class_key, start"):
        runs[(iss, ck)].append((date.fromisoformat(s), date.fromisoformat(e), sh, date.fromisoformat(as_of)))
    agg = defaultdict(lambda: {"days": 0, "err10": 0, "err25": 0, "errs": []})
    for key, rs in runs.items():
        asofs = sorted({r[3] for r in rs})
        cad = cadence_class([(b - a).days for a, b in zip(asofs, asofs[1:]) if (b - a).days > 20])
        for cur, nxt in zip(rs, rs[1:]):
            if nxt[3] <= cur[3]:
                continue
            err = abs(math.log(nxt[2] / cur[2])) if cur[2] and nxt[2] else None
            if err is None:
                continue
            # trading days of this run, spread by age bucket (approximate: calendar days * 5/7)
            for lo, hi in AGE:
                a0 = max((cur[0] - cur[3]).days, lo)
                a1 = min((cur[1] - cur[3]).days, hi - 1)
                if a1 < a0:
                    continue
                n = int((a1 - a0 + 1) * 5 / 7) or 1
                b = agg[(cad, f"{lo}-{hi - 1}")]
                b["days"] += n
                b["err10"] += n if err > math.log(1.10) else 0
                b["err25"] += n if err > math.log(1.25) else 0
                b["errs"].append(err)
    out = {}
    for (cad, age), b in sorted(agg.items()):
        e = sorted(b["errs"])
        out[f"{cad}|{age}"] = {"carried_days": b["days"], "pct_days_off_gt10": round(100 * b["err10"] / b["days"], 2),
                               "pct_days_off_gt25": round(100 * b["err25"] / b["days"], 2),
                               "median_err_pct": round(100 * (math.exp(e[len(e) // 2]) - 1), 2) if e else None,
                               "p95_err_pct": round(100 * (math.exp(e[int(0.95 * (len(e) - 1))]) - 1), 2) if e else None}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.build)
    json.dump(res, open(a.out, "w"), indent=1)
    for k, v in res.items():
        print(k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
