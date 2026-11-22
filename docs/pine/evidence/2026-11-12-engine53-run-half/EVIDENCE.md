# Engine 53 — the run half (host-partial drawings drawn by the per-bar run)

Plan: `ENGINE53-PLAN-2026-11-12.md` sections 1, 2 and 4 (Part 1 only; Part 2, capability
admission, is NOT in this PR). Base: `origin/master` `b89d075af8` (engine 51). Follows engine 52
(PR #1164, `fix/pine-engine52-serve-never-default`), which claims 52.

## What changed

A host-OK script whose object program lost drawings (`objectLoss` verdict `partial` or
`removes`) gets `compute.runtimeObjects = {source, outputs, ...runtimeVersionStamp}` on its
kind `ast` document (precedent: DIV-4 `compute.runtimeColours`). The plots stay the host's; the
host object program stays in `definition.objects` as the fallback.

| File | Change |
|---|---|
| `builder/memberPane/runRowPairing.js` (new) | `pairRunRows(t, runOutputs)`: THE row pairing (kind + ordinal, candles four to a group by role), extracted from `runtimeLaneDefinition` (mPD:1466-1511 at base) so both lanes share one function; returns `runOutputOf` (host output index -> run output index). |
| `builder/memberPane/memberPaneDefinition.js` | `runtimeLaneDefinition` calls `pairRunRows` (no behaviour change); new `hostPartialRunHalf` (minted after the host document is built, beside DIV-4); `routeHostPartial` option (default on); the drawing note gains `RUN_HALF_DRAWING_SENTENCE` when minted; result carries `runHalf: {minted, columns}` or `runHalfDeclined: {code, why}`. |
| `engine/nativeRegistry.js` | `withRunHalf` after `withRuntimeColours` on the `ast` path of `computeFor`; every gate on every run; the column rail; frozen synthetic runtime document per `runtimeObjects` (WeakMap); state rides non-enumerable; `computeSignature` carries the run half's gate state (latch / lists) into the binder's memo key; `withRuntimeColours` also honours the server's served stamps. |
| `engine/runtime/runtimeObjects.js` | `RUN_HALF_KEY`, `withRunHalfState`, `runHalfOf`, `carriesRunHalf` (module still imports nothing). |
| `engine/binder.js` | run branch also for a run half that is `served` or `pending` (pending -> empty layer); `refused` -> host branch with the refusal sentence in the drawing note's `why`; a host result whose run half is pending is never memoised. |
| `engine/ast/objectLoss.js` | `RUN_HALF_WHY_KEY`, `RUN_HALF_DRAWING_SENTENCE`, `runHalfRefusedSentence(code)` (plain words; no guard token). |
| `engine/defSchema.js` | `runtimeObjectsErrors` + `RUNTIME_OBJECTS_FIELDS` (closed), called from `validateDefinition`. |
| `api/services/presentation_schema.py` | `_check_runtime_objects` + `RUNTIME_OBJECTS_FIELDS`, rule for rule (code `runtime-objects`). |
| `tests/fixtures/runtime_objects_schema.json` | one fixture both sides read (21 cases, error PATHS). |
| `api/services/runtime_definitions.py` | `stamp_served` reaches an `ast` row with `runtimeObjects` / `runtimeColours` (kill / stage / allowlist); a stale stamp written back is dropped; `run_read_source`. |
| `engine/scriptEngineVersion.js` | 53 (history line notes it follows 52). |
| harness: `ourSide.js`, `objectsV2Regrade.measure.test.js`, `partialDrawing.census.measure.test.js`, `runHalf.reach.measure.test.js` (new) | record run half minted / declined / served / refused; objects graded from the run where the bind served it; regrade runtime-on mode (`PINE_OBJECTS_V2_RUNTIME_ON=1`) grading each minted capture before (killed) and after. |

### The door (`hostPartialRunHalf`) — minted only when ALL hold
runtime pane enabled (build flag + latch) and `routeHostPartial !== false`; verdict partial /
removes with `attemptedOps > 0`; no `calc_bars_count`; not killed; graded (allowlist);
`runtimeRepaintOf(source).ok`; `probeRuntimeProgram(source, {objectsInRun: true})` ok with
`objectOps > 0`, `requests === 0`, `naTests === 0`, no broker; `pairRunRows` ok and every
VISIBLE drawable host row pairs; the document (graph-reduced if needed) <= 64 KiB.
Otherwise the document is byte-identical and `runHalfDeclined` names the code. It never
creates a refusal.

### The bind (`withRunHalf`) — every run
build flag; latch; kill list (this tab's list and the served stamp `meta.runtimeKilled`);
allowlist (list and `meta.runtimeNotGraded`); the script's own `runtime.error`; inputs at
defaults (the DIV-4 rule: every declared input at its default and the manifest at its
defaults); the lane loaded; the run built and finished with its drawings `ok` (not `WITHHELD`,
not `OBJECT_UNWITNESSED`); no family withheld that the host program creates; and THE COLUMN
RAIL: for every mapped key, the run's column equals the host column on every bar from the
run's served start (`runtimeWarmupOf(...).withheldBars`, 0 from the listing): `na` with `na`,
a number to 1e-9 of its size. Served -> the run's drawings ride on the column record under
the RT5 key (non-enumerable) and the binder draws them INSTEAD of the host program. Pending
(worker in flight) -> empty object layer, not memoised. Refused -> host picture + sentence.
`ctx` absent (the event-column probe) asks nothing of the run.

Deliberate readings, stated:
- A run half that maps NO plot (a drawing-only partial script) is allowed: the rail is then
  vacuous and the gates (allowlist above all) are the guarantee, as for an RT5 runtime
  document's drawings.
- A visible host row the pairing cannot map (a kind with no run column) declines the run half
  (`run-half:row-unpaired`) rather than leaving a plot out of the rail.
- At-defaults counts every declared input (chrome included), as DIV-4 does: a member who
  restyles a plot keeps the host picture. Conservative; widening it is a later ruling.

## Measurement (plan section 4)

Measured TWICE, under `heavy_lock` label `eng53`, `--maxWorkers=1`: on `242db4f0b7` (engine 51
base) and again on `f552c13d09`, the branch with `origin/master` (engine 52, PR #1164) merged
in. Both runs give the same verdicts on every capture; the numbers below and in `runs/` are the
POST-MERGE run except where a pre-merge figure is named. BEFORE = the same tree with
`origin/master`'s `memberPaneDefinition.js` swapped in (so no run half is ever minted),
restored afterwards from the saved copy (`git hash-object` = committed blob `7eb37a5f9d`, both
runs).

### (i) Reach — the member door over 679 scripts (266 committed corpus + 271 reference + 142 builtin)

`runHalf.reach.measure.test.js` (`runs/reach.json`). Host-OK scripts 297; host-partial
(verdict partial / removes) **57** (pre-merge on engine 51: 299 / 58).

| lane | minted | declined |
|---|---|---|
| off (runtime pane dark: every member without the stage) | **0** | `run-half:pane-off` 57 |
| real (pane on, the SERVER allowlist: adx-and-di-for-v4 only) — production for an admin | **0** | `runtime:not-yet-graded` 57 |
| every (test-only allow-every override: upper bound) | **7** | 50, by code below |

So with the real allowlist the slice is production-inert: 0 run halves minted, therefore 0
that draw; and every declined document is byte-identical to the door that never asks
(digest with the run half stripped == digest, for every non-minted row; the door tests
compare the JSON byte for byte).

Upper bound, the 7 minted, bound over a 600-bar synthetic series from the listing (proves the
gates and the rail run; never parity): **4 served** (atr-support-and-resistance,
auto-trendlines-by-pivots, fabio-style-order-flow, intraday-power-3-visual), **3 refused**
(`runtime:limit` 2: volume-profile, fourier-extrapolator; `interpret:bind-time-text` 1:
dual-view-htf-candlestick-patterns). Bind time with the run (synchronous, cold): p50 93 ms,
**p95 317 ms**, max 317 ms (pre-merge 41 / 340 / 340), against the pane's 1,000 ms budget
(`RUNTIME_PANE_TIME_BUDGET_MS`).

Door decline codes, upper-bound lane (count): `pine:function` 8, `runtime:request` 6,
`runtime:conditional-history` 5, `runtime:request-with-state` 5, `runtime:history-dynamic-offset` 5,
`pine:request` 3, `runtime:statement` 2, `budget:lookback` 2, `pine:builtin` 2,
`runtime:call-text-state` 2, and 1 each: `runtime:call-windowed-state`, `runtime:object-op`,
`lower-tf:store-unmeasured`, `runtime:block-value`, `runtime:colour`, `runtime:input-state`,
`runtime:call-undeclared-builtin-state`, `lower-tf:lookahead`, `runtime:function`,
`runtime:history-expression` (the run cannot build the script with its drawings: the
objects-in-run probe's own guard; pre-merge also `pine:colour-value` 1). The decline for a run
that lowers no drawing is `run-half:no-object-ops` (renamed from `runtime:no-object-ops` after
the heavy run: the editor-status rail requires every `runtime:` literal to have a family, and a
decline is not a refusal). Bind refusal codes observed: `runtime:limit` 2,
`interpret:bind-time-text` 1 (synthetic bars); `runtime:limit` 4 (captures, below).

partialDrawing census, runtime pane on + permit + allow-every (committed corpus, objects-only
flag off / on): minted 2 / 3, the rest declined by the same probe codes.

### (ii) Vendor harness, plot verdicts identical before and after

| lane | captures | before (M/D/I) | after (M/D/I) | plot-verdict diffs | capture diffs |
|---|---|---|---|---|---|
| production (`VENDOR_HARNESS_RUNTIME_ON=0`) | 369 | 154/48/167 | 154/48/167 | **0** | **0** |
| runtime-on (`=1`, upper bound) | 369 | 181/48/140 | 183/48/138 | **0** | 2: both atr-support-and-resistance captures (RDDT, SPY) INCONCLUSIVE -> **MATCH** on objects |

### (iii) Objects v1 / v2 regrade (`objectsV2Regrade`, new runtime-on mode)

| lane | v1 M/D/I | v2 M/D/I | MATCH->DIVERGE |
|---|---|---|---|
| production, before (master door) | 79/31/15 | **75/35/15** | — |
| production, after | 79/31/15 | **75/35/15** (row for row identical) | **0** |
| runtime-on, after (upper bound) | 96/31/13 | 92/35/13 | **0** (run half `movedToDiverge: []`) |

Runtime-on run-half ledger over the 152 captures with object records: door minted 6
(3 scripts x RDDT/SPY), declined 36 (the probe codes above). Bind: **served 2**
(atr-support-and-resistance RDDT and SPY: v1 and v2 INCONCLUSIVE before, **MATCH / MATCH**
after), refused 4 (`runtime:limit`: dual-view-htf both, volume-profile both; their verdicts
unchanged, the host picture stays). The six watched host-partial MATCH captures:
average-day-range (declined `runtime:request`), high-low-open-mid (not minted),
ict-killzones (declined `runtime:block-value`), vdubus (declined `runtime:colour`),
multi-tf-supply-demand and swing-zigzag-chartprime (no capture verdict moved): all unchanged.

### (iv) Perf
The run half adds one runtime-lane run per chart load for a minted document (in the worker,
off the main thread, memoised per bars array; coalesced per pane like any runtime document).
Measured cold and synchronous on 600 bars: p95 340 ms (above). Inert in production today.

## Mutants (copy -> edit -> focused tests -> restore FROM THE SAVED COPY -> hash-object == committed blob)

`runs/mutants.json`, run on `9b8856b9e4` (before the merge; engine 52 changed none of the
mutated lines). C0 (no edit): GREEN, 29 tests. Every restore: blob equal.

| id | mutant | killed by |
|---|---|---|
| M1 | route a clean host (door ignores the verdict) | runHalf.test (clean CONTROL) |
| M2 | drop the door's kill check | runHalf.test (declined byte-identical, `runtime:killed`) |
| M3a / M3b | drop the bind's kill / graded check | runHalf.test (bind kill / allowlist, list and stamp) |
| M4 | draw host and run together (no `continue`) | runHalf.test (served set ONCE; latch revoke) |
| M5 | the column rail always agrees | runHalf.test (swapped outputs refused) |
| M6 | memoise a pending result | runHalf.test (pending then land, same bars) |
| M7 | a revoked latch keeps the run's objects | runHalf.test (bind latch) |
| M8 | moved inputs keep the run's objects | runHalf.test (member moved a setting) |
| M9 | mint with the pane disabled | runHalf.test (pane off) |
| M10 | mint past 64 KiB | runHalf.test (size) |
| M11 | route an output-map mismatch | runHalf.pairing.rail (one plot more on the run) |
| M12 | a run withholding a family the host draws is served | runHalf.test (family withheld) |
| M13 | pending draws the host picture then swaps | runHalf.test (pending layer EMPTY) |
| M14a / M14b | server loses the duplicate-index rule / client loses the undeclared-key rule | test_runtime_objects_schema_parity.py / runtimeObjectsSchemaParity.test.js |
| M15 | a guard id leaks into a sentence | runHalf.test (sentences; refused note text) |
| M16 | a second copy of the row pairing in the door | runHalf.pairing.rail |

All 18 KILLED.

## hostParity, service smoke

- After the merge (engine 52 base): `node tools/pine_runtime_host_parity.mjs --write` moved ONLY
  `digest` (166) and `script_engine` (52 -> 53), recorded on Node v24.13.1 as master's file was;
  `--host node --check` **HP-1 GREEN 166/166**; `--mutation-control` **HP-4 GREEN** (perturbed
  bundle red on 35 cases). (A first `--write` under Node 20.20.2 also moved `node` / `v8`, and two
  `transcendental` digests differ between the two V8s, so it was re-recorded on v24 to keep
  master's host.)
- `service_smoke.json` re-recorded against a LOCAL engine-53 pine-runtime service (Node 20.20.2,
  the Dockerfile's permission flags, a throwaway in-memory secret; `main({env})` handed only the
  allowlisted variables while the Windows process kept `SystemRoot` for Winsock): `--record`
  PASS, plain smoke PASS (engine 53/1/1, canary green, digest `caa68b29f15b`, unsigned POST 401).
  Only `digest` and `identity.script_engine` moved.

## Tests

- Focused (<= 5 files per run, `--maxWorkers=1`): `runHalf.test.jsx` (23), `runHalf.pairing.rail`
  (6), `runtimeObjectsSchemaParity` (23); member-pane batches (`memberPaneDefinition`,
  `partialDrawing`, `runtimeObjectsDoor`, `w4T13CandlePane`, `div4RuntimeReadPaint`, `wse*`,
  `objectsOnlyPane`, `savedDocumentRoundTrip`, `runtimeDocumentRoundTrip`, `runtimeProductWorkflow`,
  `savedScriptUpgrade`, `MemberPane`, `w9T12MarkersDoor`) and engine batches (`rt5RuntimeObjects`,
  `runtimeObjectsWithheldPlain`, `defSchema`, `nativeRegistry`, `objectsNotShownNote`,
  `objectRenderDrops`, `eventColumns`, `runtimeWarmupDrawings`, `rt6ColourCarriage`,
  `runtimeAllowlistParity`): all green. Post-merge: the run-half files + `memberPaneDefinition` +
  `engine52ServeNeverDefault`: 113 green; after the rename, `editorStatus.families` + the
  run-half files: 43 green.
- ONE heavy run on the merged head `f552c13d09` (`engine/ast`, `engine/runtime/__tests__`,
  `engine/__tests__`, `builder`, `--maxWorkers=1`, heavy lock): **1,133 files, 19,691 passed,
  11 failed, 200 skipped** (1,099 files passed, 30 skipped). Failures:
  - `rsRatingDef` / `rsVsEmaDef` (1 each): the known master reds (#1136).
  - `readoutSchema.va2.test.js` (8): a MASTER red from the RS readout work that landed with
    engine 52's merge (`080bd7ad98`, `2f0d981bf2`). It fails identically with master's
    `nativeRegistry.js`, `defSchema.js`, `binder.js`, `runtimeObjects.js` and `objectLoss.js`
    swapped in (restored from saved copies, blobs equal). Not touched here.
  - `editorStatus.families.test.js` (1): mine, fixed after the run (the rename above).
- Python: `test_runtime_objects_schema_parity`, `test_engine53_stamp_served_ast`,
  `test_runtime_definitions`, `test_div4_runtime_colour_paint`, `test_pine_runtime_engine_identity`,
  `test_pine_runtime_service_smoke`, `test_pine_runtime_codec`, `test_pine_runtime_client`,
  `test_saved_script_prebump`, `test_script_engine_version_gate`, `test_line_width_cap_parity`,
  `test_batch2_save_door`: **574 passed**.

## Review of #1179 (APPROVE-WITH-NOTES at `ef373e1489`) — the fixes

1. **The run half is bound to the document's own script** (MEDIUM). Before: the schema accepted any
   `compute.runtimeObjects.source` and the bind ran it, so a document carrying script A's plots and
   objects plus `runtimeObjects = {source: <another script>, outputs: {}}` passed every gate (the rail
   is vacuous with no mapped plot), read `served` with `live: []`, and A's host drawings vanished.
   Now, all three:
   - **Save door** (`user_definitions.save` -> `runtime_definitions.run_half_source_refusal`): refused
     (`SaveRefused`, guard `run-half:source`) unless `sha256(runtimeObjects.source)`, the document's
     stamp `meta.pineSourceSha256` and `sha256(pine_source)` are one script; a save with no script
     cannot bind one and is refused too. A share copy (`install_share`, saved without the author's
     script) drops the run half (`runtime_definitions.without_run_half`): the author's Pine never
     travels with a share, and the copy keeps the host picture. A fork carries its script and keeps it.
   - **Bind** (`nativeRegistry::withRunHalf`): refused `run-half:source-unbound` unless
     `sha256(ro.source) === meta.pineSourceSha256` (hash memoised per `runtimeObjects` object). The door
     stamps the script it translated (`RUN_HALF_SOURCE_STAMP`), only on a minted document, so every
     declined document stays byte-identical.
   - **Schema** (both sides, one fixture): `runtimeObjects.source` must equal
     `runtimeColours.source` when both are present, which also settles which script
     `stamp_served` reads for such a row.
   - Rails: the forged-doc repro on the client (`runHalf.test.jsx`: foreign source refused, no stamp
     refused, a stamp naming the foreign script refused, honest served) and the server
     (`test_run_half_source_binding.py`: forged, forged with the stamp forged too, no script, missing
     or wrong stamp, share drops / fork keeps, the honest one saves).
   - Residual, stated: the binding proves the run half is the row's own script; it cannot prove the
     row's plots were translated from that script (that would need a server-side translation). A
     member forging their OWN row draws a wrong picture only on their own chart; a share never
     carries a run half. The vacuous rail for a drawing-only script is a Part 2 requirement (below).
2. **Rails for the seven surviving mutants** X2-X8 (door ignores requests / naTests /
   calc_bars_count / hidden rows; bind ignores the runtime.error stop; DIV-4 ignores the not-graded
   stamp; the rail reads na vs a number as agreeing): each now killed (table below).
3. **A refused run half over a host with no drawing program** (LOW): `binder.js` returned before
   `publishDrops`; it now publishes the refusal sentence, and empties a layer the run drew before.
   Railed with the fixture whose host program loses every drawing.
4. **The door counts the bytes the store counts** (LOW): the 64 KiB check moved to the FINISHED
   document and measures it as the store will (`storedBytes.js`: the save's engine stamp and graph
   form, the store's `paramState`, the semantics strip and Python's JSON text). Over the cap, the run
   half is taken out again so the document is byte-identical to the door that never asks.
   `user_definitions.stored_bytes_for_new` is the server's count; `tests/fixtures/run_half_stored_bytes.json`
   holds the two equal, and the saved blob's own length equals the server's count. A border rail
   finds the largest script that still mints and proves its stored count is within 64 bytes under
   the cap, and the next one declines byte-identically.

## Before Part 2 (NOTE ONLY, not built here)

- **Latch / fetch ordering (review finding 4).** A tab that has not latched the per-member
  permission, or has not read the lists yet, answers `pane:not-permitted` / `pane:not-graded`, and
  the member reads the "switched off for your account" sentence for a script that may be admitted a
  moment later. Before admission widens reach: hold the run half `pending` (empty layer) until the
  latch and the lists have answered, and word the member-visible sentence for "not yet known"
  separately from "switched off".
- **Requirements for capability admission to serve run halves:**
  (a) the source binding (done here, item 1);
  (b) an object-level cross-check against the host's partial program per create site, and, where
      nothing is comparable (a drawing-only script, a vacuous rail), objects v2 runtime-on MATCH
      evidence from 2 or more captures, with family admission counted per family;
  (c) refuse when the run withholds ANY object the host draws, warm-up-withheld objects included
      (today: a whole family withheld is refused; a single warm-up object is not compared);
  (d) rail-refusal telemetry (which gate and which code refused, counted per script hash), so the
      reach under admission is measured, not inferred.

### Review mutants (`runs/mutants-review.json`; on `7cf9b35717`, before the master merge, which touched none of the mutated files)

C0 (no edit): GREEN, 41 tests. Every restore from the saved copy: `git hash-object` == committed blob.

| id | mutant | killed by |
|---|---|---|
| X2 | the door ignores `probe.requests` | runHalf.pairing.rail (X2) |
| X3 | the door ignores `probe.naTests` | runHalf.pairing.rail (X3) |
| X4 | the door ignores `calc_bars_count` | runHalf.test (X4) |
| X5 | the bind ignores the script's `runtime.error` stop | runHalf.test (X5: refused before the run is asked) |
| X6 | DIV-4 ignores the not-graded served stamp | div4RuntimeReadPaint (stamps) |
| X7 | the rail reads na against a number as agreeing | runHalf.test (X7, both directions) |
| X8 | the door maps hidden rows | runHalf.test (X8) |
| X9 | the bind runs a run half not bound to the document's script | runHalf.test (forged doc) |
| X10 | the save door accepts a run half naming another script | test_run_half_source_binding (forged doc) |
| X11a / X11b | client / server schema accept a run half beside another script's colours | runtimeObjectsSchemaParity / test_runtime_objects_schema_parity |
| X12 | a refused run half with no host program publishes nothing | runHalf.test (review 3) |
| X13 | the door counts JavaScript's bytes, not the store's | runHalf.test (border) |
| X14 | a share copy keeps the author's run half | test_run_half_source_binding (share / fork) |

All 15 KILLED.

### Runs after the review (which SHA ran what)

- Review mutants X2-X14 (table above): on `7cf9b35717` (review fixes, before the merge).
- `origin/master` (`02493fd108`) merged in with a merge commit: `16ce8fa4f9`. It touched none of
  the run-half, schema, bind, binder, store or runtime files (no conflicts).
- On `16ce8fa4f9`:
  - Focused (<= 5 files per run, `--maxWorkers=1`): `runHalf.test.jsx` (33), `runHalf.pairing.rail`
    (8), `storedBytes.parity` (3), `div4RuntimeReadPaint`, `runtimeObjectsSchemaParity` (25):
    111 green; `memberPaneDefinition`, `partialDrawing`, `runtimeObjectsDoor`, `savedScriptUpgrade`,
    `editorStatus.families`: 77 green; `nativeRegistry`, `defSchema`, `objectsNotShownNote`,
    `objectRenderDrops`, `rt5RuntimeObjects`: 637 green.
  - Touched pytest (`test_run_half_source_binding`, `test_runtime_objects_schema_parity`,
    `test_engine53_stamp_served_ast`, `test_runtime_definitions`, `test_div4_runtime_colour_paint`,
    `test_batch2_save_door`, `test_line_width_cap_parity`, `test_saved_script_prebump`,
    `test_script_engine_version_gate`, `test_pine_runtime_engine_identity`,
    `test_pine_runtime_service_smoke`): **246 passed**. Wider: every pytest file importing
    `user_definitions` (120 files): 2,771 passed, 14 failed; all of those fail identically with
    master's `user_definitions.py` / `runtime_definitions.py` / `presentation_schema.py` swapped in
    (restored after, blobs equal): `test_alert_erasure` census, `test_definition_concierge` (3),
    `test_p2x_truth_converse` R4, `test_pine_strategy_backtest` (1), `test_starter_library` (5),
    `test_user_definitions_auth` (1). Master reds, not this branch's.
  - Reach (inertness), 679 scripts: host-OK 297, host-partial 57. Pane dark: **0 minted**. REAL
    allowlist: **0 minted** (57 `runtime:not-yet-graded`). Allow-every upper bound: **6 minted**
    (4 served on synthetic bars, 2 refused `runtime:limit`; bind p95 236 ms), and
    dual-view-htf-candlestick-patterns is now declined `run-half:size`: its 60 KB script
    re-embedded puts it past the store's cap as the store counts it. Before item 4 it minted and
    would have been refused at save. Every non-minted document is byte-identical to the
    no-run-half document.
  - ONE heavy run under `heavy_lock` (`engine/ast`, `engine/runtime/__tests__`, `engine/__tests__`,
    `builder`, `--maxWorkers=1`): **1,134 files, 19,729 passed, 10 failed, 200 skipped**. Failed:
    `readoutSchema.va2` (8), `rsRatingDef` (1), `rsVsEmaDef` (1). All three are known master reds.
  - hostParity `--host node --check`: **HP-1 GREEN 166/166** (the digests are unchanged by the
    review: no runtime-lane code moved).

## Deferred

- Part 2 (capability admission) is not in this PR. Until it lands the allowlist holds only
  adx-and-di-for-v4 (no drawings), so no member and no admin gets a run half.
- Named above, not changed: at-defaults counts chrome inputs (DIV-4's rule); the rail is vacuous
  for a drawing-only partial script; the `runtime:limit` refusals on the upper-bound bind
  (volume-profile, fourier-extrapolator, dual-view-htf on captures).
- Owner capture gaps G1-G7 (plan section 4) are unchanged.
