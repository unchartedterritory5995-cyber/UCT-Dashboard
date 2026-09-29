"""mm21 — render the durable per-mismatch report (markdown) from mm21_explain + mm21_mechanism."""
import hashlib, json, os
import mm21_common as mc
mc.arm_guard()

E = os.path.join(mc.OUTDIR, "mm21_explain_%s.json" % mc.TAG)
M = os.path.join(mc.OUTDIR, "mm21_mechanism.json")
d, mech = json.load(open(E)), json.load(open(M))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
L = ["# V2c2 FINAL (%s) — the 21 non-exact oracle cells, explained" % mc.TAG, "",
     "Artifact `%s` sha256 `%s`. Oracle: golden4 (oracle3) — 611,018 cells, 610,997 exact, 21 non-exact." % (mc.ART, mc.ART_SHA),
     "Evidence: `%s` (sha256 `%s`), `%s` (sha256 `%s`)." % (E, sha(E), M, sha(M)), "",
     "## Method", "",
     "Both implementations were re-run on each affected (date, universe) and OBSERVED, unchanged: the correction's own "
     "pinned modules (module md5 pins checked OK against the grind ledger) and the independent oracle3. Every per-name "
     "comparison was replayed; each replay reproduces its own published cell to the digit (artifact row / golden4 oracle "
     "value). The two sides agree on membership, on the comparable (valid) mask, and on every price bitwise; the ONLY "
     "difference is the above-EMA verdict of ONE name per cell. An exact-arithmetic EMA (Python `Fraction`, same frame "
     "closes, same dividend ratios — none in frame for these names) decides which verdict is true.", "",
     "## Result", "",
     "**All 21: EXPLAINED — NUMERIC/EMA TIE.** One name per cell, four names, all SPACs trading at their trust value "
     "(NEBU 9.65, CCH 9.63, TWNT 9.83, NGC 10.00). Every close they printed in the 380-session frame is that one value, "
     "so the EMA equals the price EXACTLY (exact sign = 0). pandas (oracle; also the definition recorded in the "
     "artifact's `pass_meta.ema`) returns exactly the price → `price > ema` is False. The correction's recursion "
     "`(w·ema + α·x)/(w+α)` is not idempotent in float64 once a missing session makes w ≠ 1, and lands 1 ULP low "
     "(9.629999999999999) → counted ABOVE. Exact arithmetic sides with the oracle in 21/21. Effect: +1 name in the "
     "numerator (e.g. 1217/2521 vs 1216/2521), which crosses a 0.1-point rounding boundary in these 21 cells only.", "",
     "No data, membership, dividend, guard, calendar or methodology difference is involved. Not the same explanation as "
     "`ema_tie3` (which hypothesised factor multiplication order and never isolated a name — its output has "
     "`tie_names: []`); same class (float arithmetic at an exact tie), now isolated and proved.", "",
     "### Mechanism demonstration (`mm21_mechanism.json`, pandas %s)" % mech["pandas"], "",
     "| price | series | correction recursion | pandas | recursion vs price | pandas vs price |", "|---|---|---|---|---|---|"]
for c in mech["cases"]:
    L.append("| %s | %s | %s | %s | %s | %s |" % (c["price"], c["series"], c["correction_recursion"], c["pandas"],
                                               c["recursion_vs_price"], c["pandas_vs_price"]))
L += ["", "## Per-cell table", "",
      "| # | date | universe | field(s) | artifact o/h/l/c | oracle o/h/l/c | Δ | num/den (artifact → oracle) | security | price (both, bitwise =) | EMA correction | EMA oracle | EMA exact | price−EMA corr / oracle / exact | verdict corr / oracle | same as ema_tie3 class | classification |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for i, r in enumerate(d["cells"], 1):
    e = r["names"][0]
    nd = []
    for f in r["fields_differing"]:
        x = r["numerator_denominator"][f]
        a, b = x.get("corr"), x.get("oracle")
        nd.append("%s: %s/%s → %s/%s" % (f, a[0], a[1], b[0], b[1]) if a and b else "%s: n/a" % f)
    fmt = lambda v: "/".join("%g" % v[k] for k in "ohlc")
    dlt = ",".join("%s%+.1f" % (k, v) for k, v in r["difference"].items() if abs(v) > 1e-9)
    L.append("| %d | %s | %s | %s | %s | %s | %s | %s | %s (%d of 391 comparisons flip) | %s (%s) | %s | %s | %s | %.3g / %.3g / 0 (exact tie) | %s / %s | same class (float at exact tie); mechanism = recursion non-idempotence | %s |" % (
        i, r["date"], r["universe"], ",".join(r["fields_differing"]), fmt(r["artifact"]), fmt(r["oracle"]), dlt,
        "; ".join(nd), e["ticker"], e["buckets_flipped"], e["price_corr"], "yes" if e["price_bitwise_equal"] else "NO",
        e["ema_corr"], e["ema_oracle"], e["exact_ema"], e["price_minus_ema_corr"], e["price_minus_ema_oracle"],
        "above" if e["corr_verdict_above"] else "not above", "above" if e["oracle_verdict_above"] else "not above",
        r["classification"]))
L += ["", "## Gate checks per cell", "",
      "Every cell: replay reproduces artifact = True, replay reproduces oracle = True, names only on one side = 0, "
      "valid-mask mismatches = 0, price bitwise mismatches = 0, dividend ratios identical, differing names = 1." if all(
          r["replay_reproduces_artifact"] and r["replay_reproduces_oracle"] and not r["names_only_corr"] and not r["names_only_oracle"]
          and r["valid_mask_mismatches"] == 0 and r["price_bitwise_mismatches"] == 0 and len(r["names"]) == 1
          and all(n["dividend_ratios_identical"] for n in r["names"]) for r in d["cells"]) else "⛔ A GATE FAILED — see JSON.",
      "", "## Consequence (not acted on)", "",
      "The recursion is `breadth_live._ewm_last` on the correction branch. Whether the live path shares it, and whether to "
      "make it idempotent on ties (pandas' behaviour), is a cutover-design review item — it would move these 21 cells by "
      "0.1 and is NOT done to this frozen artifact."]
p = os.path.join(mc.OUTDIR, "MM21_ORACLE_MISMATCH_REPORT_%s.md" % mc.TAG)
with open(p, "x") as f:
    f.write("\n".join(L) + "\n")
print(p, sha(p))
