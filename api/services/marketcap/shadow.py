"""SERVED == BUILT: the smallest shadow comparison the lifecycle needs.

    python -m api.services.marketcap.shadow --root <published root> --build B.db --prices prices.db --pin BUILD:SHA --out out.json

For every ticker the release manifest names, the production read path (pit_serving, reading the private publication
with full hash verification) must return exactly what the dark reader (serve.Authority) computes from the immutable
build DB: the same daily points, the same reason-coded gaps, the same structure, the same latest values. A single
difference fails. Read-only on both sides.
"""
from __future__ import annotations

import argparse
import json
import os


def compare(root: str, build: str, prices: str, pin: str) -> dict:
    os.environ["MCAP_PIT_SOURCE"] = "local"
    os.environ["MCAP_PIT_LOCAL_ROOT"] = root
    os.environ["MCAP_PIT_PIN"] = pin
    from . import pit_serving as S
    from .serve import Authority
    S.clear_cache()
    a = Authority(build, prices)
    b = S.bound(force=True)
    diffs, n_pts, n_gaps = [], 0, 0
    for t in sorted(b["manifest"]["artifacts"]["documents"]):
        code, srv, _ = S.series(t)
        ref = a.series(t)
        if code != 200 or ref is None:
            diffs.append({"ticker": t, "issue": f"status {code} / reference {'none' if ref is None else 'ok'}"})
            continue
        for k in ("issuer_id", "points", "gaps", "structure", "listing"):
            if srv[k] != ref[k]:
                diffs.append({"ticker": t, "field": k})
        lc, lsrv, _ = S.latest(t)
        lref = a.latest(t)
        for k in ("date", "company_market_cap", "security_market_cap"):
            if lsrv.get(k) != lref.get(k):
                diffs.append({"ticker": t, "field": f"latest.{k}", "served": lsrv.get(k), "built": lref.get(k)})
        n_pts += len(srv["points"])
        n_gaps += len(srv["gaps"])
        S._docs.clear()                               # bounded memory: one document at a time
    return {"build_id": b["build_id"], "tickers": len(b["manifest"]["artifacts"]["documents"]), "points": n_pts, "gaps": n_gaps,
            "differences": len(diffs), "examples": diffs[:30], "pass": not diffs}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--root", "--build", "--prices", "--pin", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = compare(a.root, a.build, a.prices, a.pin)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in res.items() if k != "examples"}))
    return 0 if res["pass"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
