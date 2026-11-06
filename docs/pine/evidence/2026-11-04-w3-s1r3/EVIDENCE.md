# W3 S1 r3 (desktop) - percent refused by name until capture Q-W3-3 (closes W3-S1R2 B1 + B2)

Branch `feat/pine-w3-drawings`; code tip `4ab4df812d3e45e931baf0970889a2535a8c4980`; tested-on-master (merge-base) `52f76f9b4f4ce3241e19590ffb25acd773a909c5`.
Ruling (desktop, owner delegation): refuse by name anything not proven exact against TradingView.

## Change
- `pineTextFormat.js`: `PERCENT_CAPTURED = false` (the Q-W3-3 gate) and `servedPreset()`. `percent` is not an accepted keyword, so
  `compileMessagePattern` refuses `{N,number,percent}` BY NAME `format:number-pattern:percent` exactly as master does; `isMessageNumberFormat` (validator)
  asks the same function. `percentMessageNumber` returns null and `percentWithheldWhy` says `percent:uncaptured` for every value, either sign.
  The formatting code is kept as `percentFormatUncaptured` / `percentCornerWhy` (nothing in the engine calls them; unit-railed) so serving later is a one-line switch.
- `pine.js` refusal sentence names Q-W3-3. `capture-queue-2026-11-02-w3.md`: S1-C row says refused; Q-W3-3 is the GATE (-0.126, -0.004, -0.575 and the positives).
- Master's rails restored: `formatVendorRules.test.js` (percent cell not OK), `strFormat.vendor.test.js` (`why` is `format:number-pattern:percent`).
  `textRefusalNames.test.js` section A flipped to the refusal (grammar, 18-value sample incl. negatives, translator drop by name, forged-node validator, object lane draws nothing).
- Engine bump: NO bump from this round; the lane as a whole still needs the coordinator's number at merge (translator refusal naming is diagnostics only).

## Mutations (`muts3.json`, `mutate.py`, 4 rail files, lock heavy-mut; log runs/w3r3/mutate3.log): 25 of 26 killed
New gate mutations N01-N09 (gate opened; servedPreset / percentMessageNumber / percentWithheldWhy / isMessageNumberFormat / compileMessagePattern / formatMessageNumber
each serve ungated; corner authority skipped; refusal sentence loses Q-W3-3): all KILLED. Carried M01, M03-M08, M10, M15-M22 (incl. M19): all KILLED.
Survivor M14 (validator back to `fmt !== '#.##'`): EQUIVALENT while gated, since a pattern-only check also refuses `percent`. Dropped as unreachable-while-gated: M02, M12 (percent keyword trimming), M09/M11/M13 (superseded by N03/N07/N05).

## measure-pair (lock heavy-mp2, mpbase2 switched in-job to merge-base, HEAD asserted with timestamps before/after each side)
- runtime 0: tip 4ab4df812d (22:22), base 52f76f9b4f (22:43). Census 967/967 both. Harness TOTAL 336: MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 both sides, harness dirs and probe JSON byte-identical.
- runtime 1: tip 4ab4df812d (23:04), base 52f76f9b4f (23:26). Census 967/967. Harness MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 both sides, harness and probe byte-identical.
- C18 object-door `out-*.json`: identical base vs tip on both lanes once per-script `ms` timings are removed: 0 object-door changes. No script stopped drawing percent text
  (the sample never drew a percent cell; fewer draws than r2 is expected but r2 drew none on the sample either). Named: none.
- Census row diffs (rt0: 3 rows, rt1: 1 row), all in `steps` of peeled runs: `pine:timeout` refusal reporting a different line/token between sides, one peel path ending
  one step later, and one `droppedOps 144 vs 143`. These are the wall-clock `pine:timeout` guard landing on different lines (it recurs on both sides and moves between runs); none touches a
  `str.format`/percent text, `reachedAfterPeel` flips in one row (rt0). Classified: timing variance of the existing timeout guard, not from this round (this round changes only percent). Not re-run.
- Logs: runs/w3r3/mp0.log, mp1.log, mp-job.log (summary lines only committed).

## final-tip (lock heavy-final2, `final-tip.sh pine-dsk-w3r3 dsk-w3r3-final tests/test_script_engine_version_gate.py`, tip 4ab4df812d)
Gate pytest `46 passed`; hygiene clean; version gate `6 passed`; vitest chart+hooks `Test Files 1 failed | 1335 passed | 28 skipped (1364)`: only `src/hooks/pollingSites.rail.test.js` (baseline). Log runs/w3r3/final-job.log.
