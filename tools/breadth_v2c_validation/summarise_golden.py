"""Summarise the v2 golden matrix: exactness under each oracle mode, every remaining
non-exact cell, and the materiality of the dual-class (dot/dash) defect (spec vs faithful).
"""
import collections
import json
import statistics as st

from common import OUT, write

R = json.load(open(OUT + "/golden_matrix_v2.json"))
cells = R["cells"]
S = {"sessions": len(R["sessions"]), "cells": len(cells),
     "stored_vs_oracle_pandas_ema": dict(collections.Counter(c["vs_oracle"] for c in cells)),
     "stored_vs_oracle_production_ema": dict(collections.Counter(c["vs_oracle_prodema"] for c in cells)),
     "sizes_all_equal": R["summary"]["sizes_all_equal"],
     "nonexact_production_ema": [(c["date"], c["u"], c["m"], c["vs_oracle_prodema"], c["stored"], c["oracle_prodema"])
                                 for c in cells if c["vs_oracle_prodema"] != "exact"],
     "pandas_vs_production_ema_differ_only_on": dict(collections.Counter(
         c["m"] for c in cells if c["vs_oracle"] != c["vs_oracle_prodema"]))}
dif = collections.defaultdict(list)
for c in cells:
    if c["spec"] and c["oracle"]:
        dif[(c["u"], c["m"])].append(c["spec"]["c"] - c["oracle"]["c"])
S["dual_class_effect_on_close"] = {"%s|%s" % k: {"n": len(v), "mean": round(st.mean(v), 3),
                                                  "mean_abs": round(st.mean(abs(x) for x in v), 3),
                                                  "max_abs": round(max(abs(x) for x in v), 3)}
                                    for k, v in sorted(dif.items()) if any(abs(x) > 1e-9 for x in v)}
ch = collections.defaultdict(list)
for c in cells:
    if c["m"] == "universe_count":
        for mode, key in (("stored", "stored"), ("spec", "spec")):
            x = c[key]
            if x:
                ch[(c["u"], mode)].append(x["c"] / x["h"])
S["universe_count_close_over_high"] = {"%s|%s" % k: {"mean": round(st.mean(v), 4), "min": round(min(v), 4),
                                                      "close_below_high_sessions": sum(1 for x in v if x < 0.9999)}
                                        for k, v in sorted(ch.items())}
S["geometry_per_universe_differs"] = {
    d: {u: g["last_bar"] for u, g in v.get("geometry_per_universe", {}).items()}
    for d, v in R["sessions"].items()
    if len({g["last_bar"] for g in v.get("geometry_per_universe", {}).values()}) > 1}
print(write("golden_matrix_v2_summary.json", S))
print(json.dumps({k: v for k, v in S.items() if k not in ("dual_class_effect_on_close",)}, indent=1, default=str)[:6000])
top = sorted(S["dual_class_effect_on_close"].items(), key=lambda kv: -kv[1]["max_abs"])
for k, v in top[:30]:
    print("DUAL", k, v)
for k, v in S["dual_class_effect_on_close"].items():
    if "pct_above" in k or "ratio" in k:
        print("DUALPCT", k, v)
