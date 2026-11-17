# Capture queue: the `sar()` expansion's 200-bar window (2026-11-16)

Found by `app/src/components/chart/engine/ast/sar.test.js` ("real: every distinct captured series in the
vendor harness") when `vw-lower-tf-bars-rddt-15-2026-11-16` (NYSE:RDDT 15m, 20,886 bars, closed bars deep
in history) joined the harness. The `sar(step, max)` / `sarDirection` expansion (`callExpansions.js::sarTrees`)
recomputes SAR over a bounded window (`SAR_WARMUP` = 200 bars) and claims it equals the chart's full-history
`indicators.js::computeParabolicSAR` on every bar it publishes. On this series it does not: 43 published bars
(5167-5246) disagree, 17 of them in value AND direction (60 counted at step 0.02, max 0.2).

Native SAR is the correct side. The full-history loop started 200 bars before bar 5167 gives the expansion's
answer (205.86 UP, full history 208.52 DOWN) and rejoins the full history only at bar 5247, 280 bars later;
started 400, 800, 1600, 3200 or 5000 bars back it rejoins within 28-87 bars. A fixed 200-bar SAR window does
not always converge.

The capture already exists; nothing here is a TradingView reading. The rail records the series as a KNOWN
failure (`it.fails` plus a control pinning 43 bars / 5167-5246 / 17 by name); the fix (a window that provably
converges, or a narrower claim with its own refusal) flips the `it.fails`, and every other captured series
still asserts 0.

| id | probe | symbol / tf | refusal kept | unblocks | owner |
|---|---|---|---|---|---|
| sar() window | none: engine fix (the capture `vw-lower-tf-bars-rddt-15-2026-11-16` is in the harness) | `NYSE:RDDT 15` | none: the expansion publishes a value that is not the full-history SAR on 43 bars | `sar.test.js` KNOWN `it.fails` flips to `it` | the builder assigned the SAR window fix (2026-11-16) |
| sar() saved-tree upgrade | none: engine gap (load-time rewrite of a stored tree) | any | a formula document saved before 2026-11-16 keeps its stored 200-bar SAR tree, evaluated as stored by every lane (chart, alerts, scans): read back as `sar(step, maxStep)` with a note naming the 200-bar start, and re-expanded at 400 on its next save | a load-time rewrite of stored 200-bar SAR trees to the current window: formula documents have no engine stamp, so `savedScriptUpgrade.js` (Pine script documents, re-translated from source) does not reach them | engine |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).

| not a capture | disposition | reason |
|---|---|---|
| sar() window | closed | the `sar()` expansion's 200-bar window does not converge on vw-lower-tf-bars-rddt-15-2026-11-16 (43 bars, 17 value and direction); native SAR is correct, the capture is already in the harness, and what closes it is a build that flips the `it.fails` in `sar.test.js`, not a TradingView reading. ⭐ CLOSED 2026-11-16 by `fix/pine-sar-warmup`: `SAR_WARMUP` 200 -> 400, measured (docs/pine/evidence/2026-11-16-sar-window/EVIDENCE.md); the `it.fails` is an `it` |
| sar() saved-tree upgrade | engine-gap | a stored formula tree is not re-expanded on load, and formula documents carry no engine stamp for `savedScriptUpgrade.js` to act on; what closes it is a load-time rewrite of the stored 200-bar SAR tree (and a rail that a saved alert does not fire twice on one bar across it), not a TradingView reading |
