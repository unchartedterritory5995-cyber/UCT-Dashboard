# Engine 54 — the run half's OBJECT RAIL

Follows engine 53 (PR #1179, the run half). Branch `fix/pine-engine54-object-rail`, cut from `origin/master`
`b56fe3900d`; `origin/master` merged in twice with merge commits (`3d6045258e`, then `b6fc70129d` with #1190); see "Runs". `SCRIPT_ENGINE_VERSION` 53 -> 54, with a
history line. This is the prerequisite for admitting runtime scripts by capability (engine-53 plan,
Part 2); Part 2 itself is NOT here.

## Why

The engine-53 review found the column rail VACUOUS for a drawing-only partial script: with no plot
mapped, nothing is compared, and in the allow-every upper bound 2 of the 4 served run halves were
served on the gates alone. And the engine-53 source binding tied `runtimeObjects.source` to the row's
script, not the row's trees and object program.

## What changed

| File | Change |
|---|---|
| `engine/ast/objectProgram.js` | `objectSiteKey(tok)` = `<line>:<column>` of a drawing call's own token (the one lexer both lanes read, `lexPine`), `OBJECT_SITE_KEY_RE`. |
| `engine/ast/pine.js` | the object pass records each emitted create site's source call (`siteSources[s<n>] = objectSiteKey(op.at)`), carried NON-ENUMERABLY on `objectDiagnostics` (`OBJECT_SITE_SOURCES`): no stored document and no diagnostics census changes by a byte. |
| `engine/ast/pineRuntimeFrontend.js`, `runtime/ir.js`, `runtime/lowerIr.js`, `runtime/program.js`, `runtime/vm.js`, `runtime/objectStore.js` | a `.new` / `.copy` drawing call carries `site` (its `objectSiteKey`) through the IR, the lowering (an object op is now interned per site), the program (validated `<line>:<column>`), the VM and the store; every run object's `finish().live[].site` names its source call (was `null`). |
| `runtime/runtimeColumns.js` | `probeRuntimeProgram` returns `objectSites` (each drawing-making op's site and name). |
| `builder/memberPane/memberPaneDefinition.js` | the door mints `compute.runtimeObjects.sites` (`runHalfSites`: every host create site -> its source call, proved to be a call the run lowers as the same family, else declined `run-half:site-unpaired`), and stamps `programSha256` (and `programGraphSha256` when the save will send the graph form) on the FINISHED document, before the store's 64 KiB check. |
| `engine/runHalfProgram.js` (new) | the program digest: sha256 of a canonical JSON of `{form, source sha256, outputs, sites, scanPlot, objects, ast+trees | graph}`; `runHalfProgramBound(def)` (memoised per document). Imports only the hash. |
| `engine/runHalfRailSeam.js` (new, a leaf) | the registered object rail (fail closed when absent) and the Part 2 evidence hook (`setRunHalfObjectEvidence`, `runHalfEvidenceAdmits`: 2+ distinct captures, each objects-v2 MATCH with the runtime pane on; nothing sets it in production). |
| `engine/runHalfObjectRail.js` (new) | the object rail (below); `hostObjectRun` / `hostObjectReaderOpts`, the ONE host object evaluation the binder now also calls; registers itself on import. |
| `engine/runHalfTelemetry.js` (new) | per-document-session refusal counts and the `{code, hash}` beacon. |
| `engine/nativeRegistry.js` | `withRunHalf`: `run-half:program-unbound` after the source binding; after the column rail, the object rail (`run-half:rail-not-loaded` when unregistered); every answer noted for telemetry. |
| `engine/binder.js` | host objects through `hostObjectRun` (no behaviour change; one path for drawing and comparing); imports the rail module, which registers it. |
| `engine/ast/objectLoss.js` | sentences for the five new codes; the drawing note now says plots AND drawings must agree. |
| `engine/defSchema.js`, `api/services/presentation_schema.py`, `tests/fixtures/runtime_objects_schema.json` | `sites` (`s<n>` -> `<line>:<column>`), `programSha256`, `programGraphSha256` (64 lowercase hex), rule for rule, one fixture (9 new cases). |
| `api/routers/pine_runtime_telemetry.py` | `POST /api/pine-runtime-telemetry/run-half` (`{code, hash}`, closed pattern, the S8 caps, no member id in the row) and the admin read `GET /run-halves`. |
| `engine/scriptEngineVersion.js` | 54. |
| `tests/fixtures/run_half_stored_bytes.json` | regenerated (the fixture document now carries `sites` and `programSha256`). |

### The object rail (`runHalfObjectRail.js::runHalfObjectVerdict`)
For every create site of the host object program whose family the host draws on this chart, the run's
objects made at the SAME source call must be the host's objects:
- per site, the same count (host more: `run-half:host-object-withheld`, whatever the cause: a warm-up,
  a collector, a branch; run more: `run-half:object-rail`);
- across every compared site, the same creation order; each made on the same bar;
- each DRAWN the same (`objectRenderState.toRenderState`, the one renderer both lanes feed): anchors to
  the price tolerance policy at an unknown price scale (`compare.mjs`: REL 1e-9, floor 1e-12), text,
  style, colours (one `#rrggbbaa` spelling), size, extend, a table's cells, a fill's two lines (by which
  compared line they are).
- a host object at a site the run half does not map, a host program that stopped, or a family the host
  withholds IN PART (it draws some and withholds others): `run-half:object-rail`.
- nothing comparable: no host site in a family the host draws (the verdict `removes`, or a family it
  withholds WHOLE), or the compared sites hold no object on either side: `run-half:no-comparable-
  objects`, unless the Part 2 hook admits the script.
Run objects at a source call the host program does not have (the drawings it LOST, the reason the run
half exists) are not compared object by object; they are drawn only when the compared sites agree.

## Forgery binding: option (a), and why not (b)
(b) is not feasible in this engine:
- the document's trees and object program are built by the member door (`memberPaneDefinition` and
  the builder modules it composes: rows, keys, parameter manifests, paints), and that door is NOT in
  the pine-runtime service's closure (`tools/pine_runtime_closure.mjs`: 96 modules from
  `runtimeColumns.js`); bringing it in pulls `runtimePaneGate` (`import.meta.env`), `runtimeKill`
  (`fetch`) and `nativeRegistry` -> `serverCompute` (`fetch`), exactly the edges the closure rail
  forbids (SERVER-RUNTIME-DESIGN 2.2 H3/H4);
- the translator's own deadline is a wall clock (`TRANSLATE_BUDGET`, H5): the server and the browser
  could translate one script to two answers, and a stored verdict must not depend on load;
- the save would gain a synchronous call to a separate service (a new signed endpoint, codec and smoke)
  that is not armed in production, so every run-half save would fail closed today.
So (a): the door stamps a digest of the program it minted the run half beside; the bind re-derives it
from the document and refuses `run-half:program-unbound` on any difference (a coherent forgery: another
script's translated trees under this run half; an edited object program; an edited site map; a missing
stamp). Stated residual: a client digest can be recomputed by whoever edits the row, so (a) makes an
edit under the old stamp fail and makes the program, plots and objects one recorded unit; it does not
prove the trees were translated from the script. What keeps a wrong drawing off the chart either way
is the pair of rails: the plots must equal the run's columns and the drawings at every comparable site
must equal the run's objects, so a forged host program that disagrees with its own script's run is
refused, and one that agrees draws what the script's run draws. A share never carries a run half
(engine 53).

## Measurement

All on the engine-54 tree (after the merge of `origin/master` `3d6045258e`). BEFORE = the same tree with
`origin/master`'s `nativeRegistry.js` and `memberPaneDefinition.js` swapped in (the engine-53 door and
bind: no sites, no program stamp, no program binding, no object rail), restored afterwards from the
saved copies (`git hash-object` == committed blob for both: `a3ec761646`, `07dc18b1ed`). Each run under
`heavy_lock`, `--maxWorkers=1`. Reduced artifacts in `runs/`.

### (i) Reach — the member door over 679 scripts (266 committed + 271 reference + 142 builtin), `runs/reach.json`

Host-OK 297, host-partial 57 (both lanes, unchanged).

| lane | before minted | after minted |
|---|---|---|
| off (runtime pane dark) | 0 (`run-half:pane-off` 57) | **0** (`run-half:pane-off` 57) |
| real (pane on, SERVER allowlist: adx-and-di-for-v4 only) | 0 (`runtime:not-yet-graded` 57) | **0** (`runtime:not-yet-graded` 57) |
| every (test-only allow-every: upper bound) | 6 | 6 |

Door decline codes, upper bound: identical before and after (the same 51 declines by the same codes;
no script declined `run-half:site-unpaired`: every minted script's host sites are calls the run lowers
as the same family).

Upper bound, the 6 minted, bound over the 600-bar synthetic series from the listing:

| script | before | after |
|---|---|---|
| atr-support-and-resistance | served (0 objects) | **refused `run-half:no-comparable-objects`** (the 3 compared sites hold nothing on either side) |
| auto-trendlines-by-pivots | served (68 objects) | **served**: 52 labels compared at its 2 host sites (26 + 26), all equal; its 16 lines come from a call the host program lost (a family the host draws none of) |
| fabio-style-order-flow | served (35 objects) | **refused `run-half:no-comparable-objects`** (the host program draws nothing: no site) |
| intraday-power-3-visual | served (0 objects) | **refused `run-half:no-comparable-objects`** |
| volume-profile | refused `runtime:limit` | refused `runtime:limit` (before the rail) |
| fourier-extrapolator | refused `runtime:limit` | refused `runtime:limit` |

Served / refused: before **4 / 2** (`runtime:limit` 2); after **1 / 5** (`run-half:no-comparable-objects`
3, `runtime:limit` 2). Bind time with the run (synchronous, cold): before p50 72 / p95 462 ms, after
p50 61 / p95 344 ms (600 bars; the pane budget is 1,000 ms).
auto-trendlines GENUINELY matches on what is comparable: it is served on 52 compared objects, not on
its gates. volume-profile never reaches the rail on these bars (it stops on `runtime:limit` first, as
under engine 53).

### (ii) Objects v1 / v2 regrade (`objectsV2Regrade`, `runs/regrade-*-cmp.json`)

| lane | before v1 M/D/I | before v2 M/D/I | after v1 M/D/I | after v2 M/D/I | rows changed | MATCH->DIVERGE |
|---|---|---|---|---|---|---|
| production | 79/31/15 | 75/35/15 | 79/31/15 | **75/35/15** | **0** (row for row identical) | **0** |
| runtime-on (upper bound) | 96/31/13 | 92/35/13 | 94/31/15 | 90/35/15 | 2 | **0** |

Runtime-on, what changes: both atr-support-and-resistance captures (RDDT 2026-09-28, SPY 2026-10-03)
MATCH/MATCH -> INCONCLUSIVE/INCONCLUSIVE. The bind now refuses their run half
`run-half:no-comparable-objects` (on those captures too the host draws nothing at its three sites), so
the host picture stays: the engine-53 gain undone, by rule. Run-half ledger, runtime-on: door minted 4
(atr x2, volume-profile x2), the same declines; bind before served 2 / refused 2 (`runtime:limit` 2),
after served 0 / refused 4 (`run-half:no-comparable-objects` 2, `runtime:limit` 2); `movedToDiverge: []`
in both runs.
⭐ atr-support-and-resistance is the first Part 2 candidate: its run's drawings graded objects-v2 MATCH
on 2 distinct captures with the runtime pane on (the BEFORE run above), exactly the evidence
`runHalfEvidenceAdmits` asks for. Nothing in production supplies that evidence today.

### (iii) Vendor harness (`vendorHarness.corpus`, `runs/harness-*-cmp.json`)

| lane | captures | before M/D/I | after M/D/I | plot-verdict diffs | capture diffs |
|---|---|---|---|---|---|
| production (`VENDOR_HARNESS_RUNTIME_ON=0`) | 369 | 154/48/167 | 154/48/167 | **0** | **0** |
| runtime-on (`=1`, upper bound) | 369 | 183/48/138 | 181/48/140 | **0** | 2: both atr-support-and-resistance captures MATCH -> INCONCLUSIVE (objects; the run half refused, above) |

## Mutants (`runs/mutants.json`)

copy -> edit -> focused tests (`runHalfObjectRail.test.jsx` + `runHalf.test.jsx`; the schema and
telemetry mutants their parity files) -> restore FROM THE SAVED COPY -> `git hash-object` == the
committed blob, on `445612b31b`. C0 (no edit): GREEN. Every restore: blob equal.

| id | mutant | killed by |
|---|---|---|
| N1 | the object rail always agrees | a compared drawing that differs; site ids are the pairing |
| N2a | the door ignores a host site the run does not make at the same call | a host site the run does not make ... declines the run half |
| N2b | the rail pairs by family, ignoring the site id | site ids are the pairing; the fill test |
| N3 | a host object the run withholds (a warm-up, any cause) is ignored | the run WITHHOLDS a drawing the host draws |
| N4 | nothing comparable is served | nothing the host draws to compare: refused |
| N5 | the bind ignores the program digest | an edited tree / object program / site map / missing stamp |
| N6 | the telemetry beacon carries the source | one count per refusal ... no source; a sentence is never sent |
| N7 | an unregistered rail serves | an unregistered rail is a refusal |
| N8 | anchors are not compared | a compared drawing that differs; the chart test |
| N9 | a family the host withholds in part is compared anyway | withheld WHOLE vs in part |
| N10 | the door stamps no program digest | the honest document is served (CONTROL) and every served test |
| N11 | telemetry counts every paint | one count per refusal entered |
| N12 | one capture of evidence admits | refused with one capture |
| N13 | a fill's lines are not compared | a fill is compared by which compared lines it spans |
| N14 | the created bar is not compared | made on another bar is another drawing |
| N15 | the run stamps no site on its objects | every served test (the honest run half is refused) |
| N16a / N16b | client / server schema accept any source call | runtimeObjectsSchemaParity / test_runtime_objects_schema_parity |
| N17 | the server telemetry accepts a free-text code | test_run_half_refusal_telemetry |

All 20 KILLED. N16a was re-run on `c2c888e12a` after the parity file's field-list fix (its own
control, the unedited file, green): KILLED by the three engine-54 source-call cases.

## hostParity, service smoke

- `node tools/pine_runtime_host_parity.mjs --write` (Node v24.13.1, master's recording host) moved ONLY
  `digest` (166) and `script_engine` (53 -> 54); `--host node --check` **HP-1 GREEN 166/166**;
  `--mutation-control` **HP-4 GREEN** (perturbed bundle red on 35 cases).
- `service_smoke.json` re-recorded against a LOCAL engine-54 pine-runtime service (the system Node
  24.13.1 with `--permission`, `--allow-fs-read=<worktrees>`, `--allow-worker`,
  `--disallow-code-generation-from-strings`; `main({env})` handed only `PORT` and a throwaway in-memory
  secret, deleted after): boot `engine=54/1/1 bundle=6b2101a0e99b`, `--record` PASS, plain smoke PASS
  (canary green, digest `87b0a9fb5089`, unsigned POST 401). Only `digest` and `identity.script_engine`
  moved. The service was stopped after and `app/dist-server` removed.
- `tools/pine_runtime_closure.mjs --check`: 96 modules, host-neutral (0 findings); the rail, the digest
  and the telemetry are not in the service's closure.

## The other builder's PR (#1190, share strips run reads)

Merged to master during this build and merged in here (merge commit, no conflicts). One semantic
coupling: it restates `RUN_HALF_DRAWING_SENTENCE` in Python (`runtime_definitions.py`) pinned to the JS.
Engine 54 changed that sentence, so the Python constant follows it, and a copy of an engine-53-minted
document drops the older wording too (`RUN_HALF_DRAWING_SENTENCES_PRIOR`; railed in
`test_share_strips_run_reads.py`).

## Tests

- Focused (<= 5 files per run, `--maxWorkers=1`, outside the lock): `runHalfObjectRail.test.jsx` (20,
  new), `runHalf.test.jsx` (34; engine-53 fixtures updated: a fake run now carries the run's real
  drawings, the swapped-outputs document is re-stamped so the column rail is what refuses, and the
  "host with no drawings" chart test admits its script through the evidence hook); member-pane batch
  (`memberPaneDefinition`, `partialDrawing`, `runtimeObjectsDoor`, `runHalf.pairing.rail`,
  `storedBytes.parity`) 56; runtime batch (`rt5RuntimeObjects`, `honestySweep`,
  `runtimeObjectsWithheldPlain`, `objectRenderDrops`) 85; `editorStatus.families`,
  `div4RuntimeReadPaint`, `runtimeAllowlistParity`, `cellPositionalOrder`, `tableCellReplace` 74;
  `shareStripCopy` 5; after the heavy run, `runtimeObjectsSchemaParity`, `vendorHarness.c45BarIndex`,
  `nativeRegistry`, `binder`, `defSchema` 691. All green.
- ONE heavy run under `heavy_lock` (`engine/ast`, `engine/runtime/__tests__`, `engine/__tests__`,
  `builder`, `--maxWorkers=1`) on `445612b31b`: **1,139 files, 19,826 passed, 12 failed, 200 skipped**.
  Failed: the master reds `readoutSchema.va2` (8), `rsRatingDef` (1), `rsVsEmaDef` (1); and two of
  mine, fixed after and green in the focused run above: `runtimeObjectsSchemaParity` (its parse of the
  server's field list read `[A-Za-z]+`, and `programSha256` has digits) and
  `vendorHarness.c45BarIndex` (its rail lists the product files that pass `barIndexFromFirstBar`
  through; the binder's host-reader options moved, unchanged, into
  `runHalfObjectRail.hostObjectReaderOpts`, now listed).
- pytest, touched: `test_run_half_refusal_telemetry` (new), `test_runtime_objects_schema_parity`,
  `test_pine_runtime_stop_telemetry`, `test_run_half_source_binding`, `test_engine53_stamp_served_ast`,
  `test_runtime_definitions`, `test_script_engine_version_gate`, `test_saved_script_prebump`,
  `test_batch2_save_door`, `test_line_width_cap_parity`, `test_div4_runtime_colour_paint`: 268 passed;
  `test_share_strips_run_reads` + `test_run_half_source_binding` after the merge of #1190: 37 passed
  (1 xfailed, theirs); `test_pine_runtime_engine_identity` + `test_pine_runtime_service_smoke` after the
  re-record: 29 passed.
- pytest, wider: every `tests/test_*.py` naming `user_definitions`, `presentation_schema`,
  `runtime_definitions` or `pine_runtime_telemetry` (127 files): **4,572 passed, 28 failed**. None is
  this branch's: the known master reds `test_alert_erasure` (1), `test_definition_concierge` (5),
  `test_starter_library` (5), `test_p2x_truth_converse` R4 (1), `test_pine_strategy_backtest` (1),
  `test_user_definitions_auth` (1); and reds from master's own newer work, each failing on a cause
  this branch does not touch: `test_converse_eval_runner` (7: the lane bundle has no loader for
  `SymbolSearch.jsx`'s new `.webp` import), `test_upload_cap_member_doors` (4: `candidates()` got an
  unexpected `max_per_hour`), `test_vision_spend_containment` (1: the image prompt is over its
  pinned token bound), `test_paywall_gate_free_tier` (1: `/api/calendar/next-report`,
  `/api/stock-brief/`, `/api/single-stock-etfs/` newly reachable from the free page),
  `test_rig_sandbox_never_inside_a_worktree` (1).

## Runs (which SHA ran what)

- `8375750974` engine 54, `0841d1ed5c` merge of `origin/master` `3d6045258e`: reach AFTER. On
  `8273ca7378` (a doc comment only): reach BEFORE, and the BEFORE / AFTER regrade and harness (BEFORE
  with the two master files swapped in, then restored blob-equal).
- `e8112c34a4`: `origin/master` merged again (#1190 share strips run reads, #1188, #1171; no conflicts),
  then the share-sentence follow-up; hostParity / service smoke re-recorded on `445612b31b`; mutants on
  `445612b31b`; the heavy run on `445612b31b`; the two test fixes and the N16a re-run on `c2c888e12a`.

## Deferred

- Part 2 (capability admission) is not here. The evidence hook (`setRunHalfObjectEvidence`) has no
  production caller; atr-support-and-resistance already carries the evidence shape (above).
- A family the host draws NONE of (a lost call) is not compared object by object: its objects are drawn
  only beside a non-vacuous comparison of the families the host does draw (auto-trendlines' 16 lines
  ride on 52 compared labels). Per-family admission for such a family is Part 2's ("family admission
  counted per family", engine-53 "Before Part 2" (b)).
- The engine-53 "Before Part 2" latch / fetch ordering note is unchanged.
- A framed instance (an instance timeframe) computes its run on the frame's bars while the binder draws
  host objects on the chart's bars: unchanged from engine 53, inert while no run half is minted, named
  for whoever widens reach.
- The program binding is (a), not (b) (above): the server does not re-translate.
