"""mm21 — ORACLE side: oracle3 (independent, unchanged) for each (date, universe) golden4 scored
non-exact, recording the per-name EMA and every price it compared. Observation only."""
import os, sys, json, collections
import mm21_common as mc
os.environ["V2C2_TAG"] = mc.TAG
os.environ["GUARD_BOUNDARIES"] = "/data/_audit/validation/v2c_final/out/guard_oracle_boundaries_%s.json" % mc.TAG
mc.arm_guard()
import numpy as np
import oracle, oracle3
want = collections.defaultdict(set)
for x in mc.cells():
    want[x["date"]].add(x["u"])
O3 = oracle3.Oracle3(dividends=True)
_mm, _mem = oracle.metrics_matrix, O3.members
unis = ("uct", "uct_backtest", "us", "nasdaq", "nyse")
for D in sorted(want):
    cap, memo = [], {}

    def spy(L, P):
        cap.append((L["ema"].copy(), P.copy()))
        return _mm(L, P)

    def mem(Dx, traded):
        memo["m"] = _mem(Dx, traded)
        return memo["m"]
    oracle.metrics_matrix = spy
    O3.members = mem
    try:
        r = O3.day(D, unis)
    finally:
        oracle.metrics_matrix = _mm
        O3.members = _mem
    present = [u for u in unis if memo["m"].get(u)]
    assert len(cap) == 2 * len(present), (len(cap), present)
    for k, u in enumerate(present):
        if u not in want[D]:
            continue
        (ema, P), (_e2, cpx) = cap[2 * k], cap[2 * k + 1]
        np.savez_compressed(os.path.join(mc.OUTDIR, "orc_%s_%s.npz" % (D, u)),
                            names=np.array(memo["m"][u]), ema=ema, P=P, cpx=cpx[:, 0])
        print(D, u, "names", len(memo["m"][u]), "buckets", P.shape[1], "oracle", r[u].get("pct_above_20ema"), flush=True)
        with open(os.path.join(mc.OUTDIR, "orc_%s_%s.json" % (D, u)), "w") as f:
            json.dump({"date": D, "u": u, "pct_above_20ema": r[u].get("pct_above_20ema"),
                       "members": len(memo["m"][u]), "buckets": r[u]["_meta"]["buckets"]}, f)
print("DONE", flush=True)
