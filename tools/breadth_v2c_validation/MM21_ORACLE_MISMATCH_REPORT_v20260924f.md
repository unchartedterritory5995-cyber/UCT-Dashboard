# V2c2 FINAL (v20260924f) — the 21 non-exact oracle cells, explained

Artifact `/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f.db` sha256 `5670fdc0d3deeb9ed1d7eb13da794457d395d3ad007255a8a685769aeefb904e`. Oracle: golden4 (oracle3) — 611,018 cells, 610,997 exact, 21 non-exact.
Evidence: `/data/_audit/validation/v2c_final/mismatch21/mm21_explain_v20260924f.json` (sha256 `b194b2127f68ba107759e3d318ff5f82ff1d997198a634dd0cfa8302a6697d94`), `/data/_audit/validation/v2c_final/mismatch21/mm21_mechanism.json` (sha256 `ff65afd0b3f9a8971ce29f8ca6d2c9930772fb3de36258c0f06db3fbe3324017`).

## Method

Both implementations were re-run on each affected (date, universe) and OBSERVED, unchanged: the correction's own pinned modules (module md5 pins checked OK against the grind ledger) and the independent oracle3. Every per-name comparison was replayed; each replay reproduces its own published cell to the digit (artifact row / golden4 oracle value). The two sides agree on membership, on the comparable (valid) mask, and on every price bitwise; the ONLY difference is the above-EMA verdict of ONE name per cell. An exact-arithmetic EMA (Python `Fraction`, same frame closes, same dividend ratios — none in frame for these names) decides which verdict is true.

## Result

**All 21: EXPLAINED — NUMERIC/EMA TIE.** One name per cell, four names, all SPACs trading at their trust value (NEBU 9.65, CCH 9.63, TWNT 9.83, NGC 10.00). Every close they printed in the 380-session frame is that one value, so the EMA equals the price EXACTLY (exact sign = 0). pandas (oracle; also the definition recorded in the artifact's `pass_meta.ema`) returns exactly the price → `price > ema` is False. The correction's recursion `(w·ema + α·x)/(w+α)` is not idempotent in float64 once a missing session makes w ≠ 1, and lands 1 ULP low (9.629999999999999) → counted ABOVE. Exact arithmetic sides with the oracle in 21/21. Effect: +1 name in the numerator (e.g. 1217/2521 vs 1216/2521), which crosses a 0.1-point rounding boundary in these 21 cells only.

No data, membership, dividend, guard, calendar or methodology difference is involved. Not the same explanation as `ema_tie3` (which hypothesised factor multiplication order and never isolated a name — its output has `tie_names: []`); same class (float arithmetic at an exact tie), now isolated and proved.

### Mechanism demonstration (`mm21_mechanism.json`, pandas 3.0.1)

| price | series | correction recursion | pandas | recursion vs price | pandas vs price |
|---|---|---|---|---|---|
| 9.65 | no gaps | 9.65 | 9.65 | equal | equal |
| 9.65 | with gaps | 9.649999999999999 | 9.65 | below | equal |
| 9.63 | no gaps | 9.63 | 9.63 | equal | equal |
| 9.63 | with gaps | 9.629999999999997 | 9.63 | below | equal |
| 9.83 | no gaps | 9.83 | 9.83 | equal | equal |
| 9.83 | with gaps | 9.829999999999998 | 9.83 | below | equal |
| 10.0 | no gaps | 10.0 | 10.0 | equal | equal |
| 10.0 | with gaps | 9.999999999999998 | 10.0 | below | equal |

## Per-cell table

| # | date | universe | field(s) | artifact o/h/l/c | oracle o/h/l/c | Δ | num/den (artifact → oracle) | security | price (both, bitwise =) | EMA correction | EMA oracle | EMA exact | price−EMA corr / oracle / exact | verdict corr / oracle | same as ema_tie3 class | classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2018-04-23 | nasdaq | l | 56.1/56.3/48.3/51.2 | 56.1/56.3/48.2/51.2 | l+0.1 | l: 1217/2521 → 1216/2521 | NEBU (391 of 391 comparisons flip) | 9.65 (yes) | 9.649999999999999 | 9.65 | 9.65 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 2 | 2018-05-09 | us | c | 59.9/62.3/57.1/61.4 | 59.9/62.3/57.1/61.3 | c+0.1 | c: 2887/4705 → 2886/4705 | NEBU (15 of 391 comparisons flip) | 9.65 (yes) | 9.649999999999999 | 9.65 | 9.65 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 3 | 2018-07-05 | nasdaq | o,h | 50.4/54.9/47.7/54.5 | 50.3/54.8/47.7/54.5 | o+0.1,h+0.1 | o: 1263/2508 → 1262/2508; h: 1396/2544 → 1395/2544 | NEBU (391 of 391 comparisons flip) | 9.65 (yes) | 9.649999999999999 | 9.65 | 9.65 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 4 | 2018-07-06 | us | l | 54.3/62.8/53.9/61.3 | 54.3/62.8/53.8/61.3 | l+0.1 | l: 2516/4672 → 2515/4672 | NEBU (100 of 391 comparisons flip) | 9.65 (yes) | 9.649999999999999 | 9.65 | 9.65 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 5 | 2018-11-30 | us | o | 48.4/54/47.6/51.5 | 48.3/54/47.6/51.5 | o+0.1 | o: 2285/4725 → 2284/4725 | CCH (212 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 6 | 2018-11-30 | nyse | o,c | 51.7/57.6/50.5/56.6 | 51.6/57.6/50.5/56.5 | o+0.1,c+0.1 | o: 1008/1950 → 1007/1950; c: 1106/1955 → 1105/1955 | CCH (212 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 7 | 2018-12-03 | us | c | 62/62.4/52.2/59.1 | 62/62.4/52.2/59 | c+0.1 | c: 2808/4754 → 2807/4754 | CCH (391 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 8 | 2018-12-03 | nyse | o,h | 68.4/69.9/58.1/66.4 | 68.3/69.8/58.1/66.4 | o+0.1,h+0.1 | o: 1332/1948 → 1331/1948; h: 1362/1949 → 1361/1949 | CCH (391 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 9 | 2018-12-04 | us | o | 57.2/57.7/29.7/29.8 | 57.1/57.7/29.7/29.8 | o+0.1 | o: 2699/4721 → 2698/4721 | CCH (129 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 10 | 2018-12-04 | nyse | l,c | 64.6/65.3/31.7/32 | 64.6/65.3/31.6/31.9 | l+0.1,c+0.1 | l: 619/1954 → 618/1954; c: 625/1954 → 624/1954 | CCH (129 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 11 | 2018-12-06 | us | o | 21.6/29.4/18.6/29 | 21.5/29.4/18.6/29 | o+0.1 | o: 1019/4724 → 1018/4724 | CCH (126 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 12 | 2018-12-06 | nyse | o,h,c | 22.1/31.2/15.8/31 | 22/31.1/15.8/30.9 | o+0.1,h+0.1,c+0.1 | o: 431/1952 → 430/1952; h: 609/1955 → 608/1955; c: 606/1955 → 605/1955 | CCH (126 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 13 | 2018-12-07 | us | l | 29.6/33/20.5/21.7 | 29.6/33/20.4/21.7 | l+0.1 | l: 970/4739 → 969/4739 | CCH (391 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 14 | 2018-12-07 | nyse | c | 32.3/37/21.6/23 | 32.3/37/21.6/22.9 | c+0.1 | c: 449/1953 → 448/1953 | CCH (391 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 15 | 2018-12-10 | us | o | 22/22.7/16.4/20.9 | 21.9/22.7/16.4/20.9 | o+0.1 | o: 1035/4713 → 1034/4713 | CCH (144 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 16 | 2018-12-10 | nyse | o,h,l,c | 22.8/23.8/15.3/20.5 | 22.7/23.7/15.2/20.4 | o+0.1,h+0.1,l+0.1,c+0.1 | o: 444/1948 → 443/1948; h: 463/1948 → 462/1948; l: 298/1952 → 297/1952; c: 400/1954 → 399/1954 | CCH (144 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 17 | 2018-12-11 | nyse | h | 27.4/29.5/20/21.1 | 27.4/29.4/20/21.1 | h+0.1 | h: 576/1953 → 575/1953 | CCH (207 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 18 | 2018-12-12 | us | o | 27.7/33.3/27.1/27.4 | 27.6/33.3/27.1/27.4 | o+0.1 | o: 1304/4716 → 1303/4716 | CCH (342 of 391 comparisons flip) | 9.63 (yes) | 9.629999999999999 | 9.63 | 9.63 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 19 | 2021-04-29 | nyse | o,h | 77.2/77.7/67.7/71 | 77.1/77.6/67.7/71 | o+0.1,h+0.1 | o: 1587/2056 → 1586/2056; h: 1597/2056 → 1596/2056 | TWNT (21 of 391 comparisons flip) | 9.83 (yes) | 9.829999999999998 | 9.83 | 9.83 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 20 | 2021-05-28 | us | c | 65.6/66.7/62.1/63.3 | 65.6/66.7/62.1/63.2 | c+0.1 | c: 3464/5476 → 3463/5476 | NGC (38 of 391 comparisons flip) | 10.0 (yes) | 9.999999999999998 | 10.0 | 10.0 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |
| 21 | 2021-06-01 | us | o | 68.5/70.3/64.7/69 | 68.4/70.3/64.7/69 | o+0.1 | o: 3737/5459 → 3736/5459 | NGC (58 of 391 comparisons flip) | 10.0 (yes) | 9.999999999999998 | 10.0 | 10.0 | 1.78e-15 / 0 / 0 (exact tie) | above / not above | same class (float at exact tie); mechanism = recursion non-idempotence | EXPLAINED — NUMERIC/EMA TIE |

## Gate checks per cell

Every cell: replay reproduces artifact = True, replay reproduces oracle = True, names only on one side = 0, valid-mask mismatches = 0, price bitwise mismatches = 0, dividend ratios identical, differing names = 1.

## Consequence (not acted on)

The recursion is `breadth_live._ewm_last` on the correction branch. Whether the live path shares it, and whether to make it idempotent on ties (pandas' behaviour), is a cutover-design review item — it would move these 21 cells by 0.1 and is NOT done to this frozen artifact.
