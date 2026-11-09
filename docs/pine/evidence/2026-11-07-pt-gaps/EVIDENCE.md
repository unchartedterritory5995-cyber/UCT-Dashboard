# PT-GAPS evidence, 2026-11-07

Lane: PT-GAPS, branch `feat/pine-pt-gaps`, from `origin/master` `33a8a2ab43` (engine 32; `SCRIPT_ENGINE_VERSION` not touched).
Scope: the "Known gaps" table of `docs/pine/capture-queue-2026-10-31-prod-ternary.md`: L3, L4, L5, L6, G-a, G-c, G-d, G-e, G-f, G-g, G-h, G-i. G-b is Q-PT3's; L2 has its probe.

## Classification

| gap | class | why |
|---|---|---|
| L3 | (a) built | Pine's `?:` is lazy (v6 captured, `vw-arm-history`; v5 stated by the to-v5 / to-v6 guides): an arm nested in another runs only where both are taken. Pure consequence of a rule already witnessed |
| L4 | (a) built | an `na` test takes the false arm: witnessed by `rt1-na-test-v4/v5/v6` (NYSE:RDDT 1D, 2026-10-02) and already the plot's own rule (`interpret.js::PINE_TERNARY`) |
| L5 | (c) closed | closed by H1 (arm gates); its block-gate half is G-h |
| L6 | (a) built | translation cost only, no vendor fact |
| G-a | (c) closed | closed by F2 |
| G-c | (a) built | a copy dropping a stamp is a bug in this engine, not a vendor question |
| G-d | (a) built | disclosure on our own surface, no vendor fact |
| G-e | (c) by design | the bounded window's own convergence rule answers for the seed |
| G-f | (b) capture | object door: no capture holds a drawing's text over a block's runs. Queued as Q-PT6 |
| G-g | (c) by design | an exemption is a per-function proof; until one capture per window-1 function exists it stays withheld |
| G-h | (a) built | C48's block rule (captured, `vw-call-site-history`) already applies to a plot's colour (F2); a paint's and a fill's colour are the same rule |
| G-i | (b) capture | object door, and the last change here took 35 TradingView-exact objects down (rsi-swing-indicator, C17 / F6). Queued as Q-PT7 |

## What was built (host plot lane, `app/src/components/chart/engine/ast/pine.js` unless named)

- **L3** `armRunGates` carries the enclosing STAMPED arms' run guards down the walk and wraps a nested guard as `c ? g : 0` (a bar where an encloser is not taken is a skip). Dropped through `offset` and into a recurrence. A node under two enclosers is visited once per context and carries both gates.
- **L4** `armRunGates` writes a `?:` stamp's guard as `t ? 1 : 0` / `t ? 0 : 1` when the test can be `na` (`neverNaTree`). The bind evaluates it with the plot's own options, so it reads `na` as Pine does exactly where the plot does (from the listing, `meta.naConditionFalse`) and as `na` = neither everywhere else, including every server lane (`ast_interpret._ternary` has no listing rule, for the plot or the guard). `blockRuns.js` / `block_runs.py` are unchanged; `blockRunsParity.test.js` reproduces its fixture and `tests/test_block_runs_parity.py` passes (28).
- **L6** `armHistoryCallOf` memoises the nodes a chain repeats (`ternary`, `bound`) per history-function roster (`WeakMap`); a depth-capped answer is never kept.
- **G-c** the counter fold copies with `copyKeepingArmRuns`: the same JSON copy byte for byte, then every `_armRuns` stamp carried by a parallel walk.
- **G-h** paints (`resolvePaints`) and fill colours (`resolveFillHandles`) are read with `condGate` on in notes-only mode (`holderColourGates`, `condGateNotesOnly`: a one-run block is still read the every-bar way), host lane only. Their block gates hang on the colour rules (`COLOUR_BLOCK_RUNS`, read by `colourBlockRunsOf`). A block mark with no guard to carry withholds a paint by name (`pine:block`) and drops a fill. The output loop's guard reader is now the shared `blockGateGuardsOf`.
- **G-d** `infoValueResolve.withheldColourOf`: a pinned info value whose plot's condition column (`colorMode: column:<key>`) is refused keeps its value and carries the gate's sentence as its `reason` (the row's `title`), `colourWithheld: true`.

Runtime lane (`pineRuntimeFrontend.js`, `engine/runtime`): none of these gaps lives there (⚠️ r2: this is a claim about the CODE. The runtime PANE is reached through the member door, which runs the host translation first, so a host-lane change can reach what the runtime pane draws; r0's folder runs did not include `engine/__tests__`, which holds that path's rails. See r2). It evaluates `?:` per bar in its VM and serves conditional `ta.sma` / `ta.ema` / `ta.rma` per call site, refusing every other conditional shape by name (`runtime:conditional-history`), so it has no stamp to nest, copy or memoise. `postfixMember.test.js` (the runtime/host agreement rail named in the brief) passes, 28 tests.

## Rails

`app/src/components/chart/engine/ast/ptGaps.test.js`, 19 tests, each block with a control: L3 (6), L4 (4), L6 (2), G-c (2), G-h (3), G-d (2).

Targeted, all green: `ptGaps` 19, `pine.armRuns` 16, `vendorHarness.c45ArmRuns` 74, `vendorHarness.c48CallSite` 33, `blockRunsParity` 2, `postfixMember` 28, `paramIds` 5 (+1 skipped). Python `tests/test_block_runs_parity.py` 28 passed.

## Hand mutations (copy, mutate, run `ptGaps.test.js`, restore by copy, `cmp`), on the final code

| id | mutation | result |
|---|---|---|
| M1 | L3: `ctxOf` always returns the parent context | 5 red, restored, cmp equal |
| M2 | L4: never wrap the test as `?:` | 2 red, restored, cmp equal |
| M3 | L6: never store in the memo | 1 red, restored, cmp equal |
| M7 | L6: store a depth-capped answer too | 1 red, restored, cmp equal |
| M4 | G-c: plain JSON copy | 1 red, restored, cmp equal |
| M5 | G-h: leave `condGate` as it was while reading a paint / fill colour | 2 red, restored, cmp equal |
| M6 | G-d: `withheldColourOf` always null | 2 red, restored, cmp equal |

## Folder run

`npx vitest run src/components/chart/engine/ast src/components/chart/engine/runtime --maxWorkers=1`, Node 20.20.2, under `heavy-final6.lock` (label `ptgaps`), free RAM 13.5 GB before:

- Test Files 4 failed | 505 passed | 4 skipped (513); Tests 5 failed | 8406 passed | 11 skipped (8422).
- All 5 failures are `Test timed out in 15000ms` in four corpus census files under `runtime/__tests__`: `guardProbe.measure`, `objectLaneCallSites.measure`, `objectLaneCensus.measure` (2), `objectLaneDrawerCensus.measure`.
- Master control: the same four files on `origin/master`'s `pine.js` and `infoValueResolve.js` (swapped in, then restored and checked with `cmp`), default timeout, back to back on the same box: master **5 failed | 4 passed** (the same five), branch **3 failed | 6 passed**. With `--testTimeout=600000` all pass on the branch (each 18-21 s on a loaded box; master measured 14-21 s across runs). They are a 15 s budget on a shared box, not this change.

A first folder run was stopped mid-way because a source file was edited while it ran; its result is not used. Between the runs the shared `node_modules` this worktree's junction pointed at (`pine-dsk-mpbase3` -> `pine-base`) lost its `.bin` and some packages (another session); the junction was repointed to `nbw-p2-impl/app/node_modules` (same vitest 4.0.18; `package.json` differs only by `three`).

## Service suite

`node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"` on Node 24.13.1: tests 139, pass 139, fail 0.

## Not done

Light phase only: no `mutate.py`, measure-pair or final-tip. No new parity column (L4 needs none). No translation-cache bump: a saved document gains the new stamps when it is translated again.

## r1 (review GO-WITH-NOTES @0d31b677f6, `_resume-2026-11-01/dsk/reviews/PT-GAPS.md`)

- **S1** a fill G-h drops (its colour's block mark has no guard to carry) is now said by name: "`fill` is not drawn: its colour is withheld — <the gate's sentence>" (`resolveFillHandles` records it in `withheldFills`; `chartOnlySentence`'s `how.withheld`). Before, it read "its two edges are not both plots this door carries", which was false.
- **N4** the notes-only mode (`condGateNotesOnly`) is removed. It had a distinguishing shape: `float s = na` / `if barstate.islast` / `s := ta.sma(close, 3)` / `bgcolor(close > s ? …)` painted the every-bar `sma` on the last bar with NO gate, where the plot reads the one-run value (C42). A paint or fill colour now reads a one-run block the way a plot does; rail added.
- **S2 / N3 / N5** rails added to `ptGaps.test.js` (19 → 23 tests): a paint withheld `pine:block` on the self-referencing guard (`if na(s) or s > s[1]`); the same fill dropped with the by-name sentence (control: a plain fill drawn); a nested arm inside a multi-state recurrence keeps its own test; the paint's one-run read; G-d's sentence on the UNKNOWN-value path.
- **Reviewer survivors, re-run on the r1 code** (copy, mutate, run `ptGaps.test.js`, restore by copy, `cmp`): R2 (context kept through `multiState`) KILLED; R6 (fill refusal keeps the band) KILLED; R7 (paint refusal draws) KILLED; R8 (notes-only reintroduced) KILLED; R10 (G-d sentence dropped on UNKNOWN) KILLED. R9 (host-lane check dropped in `resolvePaints`) stays equivalent: the screen lane has no paints by construction.
- **Runs on the r1 code and again after merging `origin/master`** (merge clean, `721ba338f2`): `ptGaps` 23, targeted 9 files 211 passed + 1 skipped (incl. `blockRunsParity`, `c45ArmRuns`, `c48CallSite`, `postfixMember`, `fillColourRuns`, `chartOnly`, `paramIds`); `tests/test_block_runs_parity.py` 28 passed; service suite on Node 24.13.1 139/139; `pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166; `evidence_engine.py queue --check` PASS (no regeneration needed).
- Owed to the coordinator: measure-pair (census 1) and final-tip. Engine bump at merge (translation output changes, per the review).

## r2 (landing report: `vendorHarness.coverageAudit` :411, delta-rsi runtime pane refused after merge)

- **Not reproduced, on any tree.** `delta-rsi-oscillator-strategy (runtime pane): RDDT MATCHES` passes: on `feat/pine-pt-gaps` merged with `origin/master` `bfc3d77e0f` (engine 34), alone and in the whole file (185 passed, 7 skipped); with `SCRIPT_ENGINE_VERSION` swapped to 35 (copy, run, restore, `cmp`); in the landing tree `pine-dsk-land35` itself (`43e3d410f9`, read-only, whole file: 185 passed, 7 skipped); and in the full three-folder run below (`✓ … 878ms`). The landing tree's source equals `6fb4f3b3ed`, whose tree equals my merged tip (`git diff` empty).
- **What PT-GAPS does to delta-rsi: nothing.** It is Pine v4 (no `?:` / `and` stamps below v5, no paints, no fills, no counter fold, no `if` expression). Its host translation is 8 rows, all `pine:tuple` ("`for` (reached through `diff`)"), with no `meta.blockRuns`, on master and on the branch alike.
- **Where the reported sentence comes from.** That exact text is what the harness prints when the runtime pane does not take the script, so the door reports the host lane's refusal. It is also printed on every run, in every lane's logs (`ptgaps-final`, `honesty-final`, `i6an4-final2`, and this r2 run), as the census table's runtime-OFF row for the same capture. Mutation D3 (the runtime allowlist latch declines this one source: `runtimeKill.runtimeNotGradedOf`) reproduces the reported failure exactly: `refused on our side: member door refused (pine:tuple)`. A latched allowlist, or the table row, gives that sentence. No PT-GAPS code path does.
- **Rail:** `engine/__tests__/vendorHarness/vendorHarness.ptGapsDeltaRsi.test.js` (2 tests): the host translation is pinned (no stamps, 8 `pine:tuple` rows naming the `for` wall), and the runtime pane MATCHES on the four signals, with a runtime-off control that must read the host sentence.
- **Hand mutations against it** (copy, mutate, run, restore by copy, `cmp`): D3 (the runtime pane declines delta-rsi) KILLED. D1 (`rtAdmits` always false) and D2 (stamp v4 arms, with `rsi` / `ema` / `crossover` / `crossunder` read as history calls) SURVIVED. Both are equivalent on this shape: every host row refuses before any stamp, and the runtime pane does not route through `rtAdmits`. They show that the host-lane fixes cannot reach this script.
- **Full run** (free RAM 12.4 GB, `heavy-final6.lock`, label `ptgaps-r2`, 63 min): `engine/__tests__` + `engine/ast` + `engine/runtime`, `--maxWorkers=1`, Node 20.20.2, at `0387610bb9` (branch merged with master `bfc3d77e0f`): Test Files 9 failed | 842 passed | 24 skipped (875); Tests 13 failed | 14494 passed | 130 skipped. Five are the census 15 s timeouts recorded in r0. The other eight (`controlDoorCensus` [`app/src/agent/guide/slots.js` not in `BULK_BLOB_SITES`], `macdFlipAParity`, `priceFormatMinMove.realChart` ×4, `stockChartWiring` MACD precision, `vendorHarness` comparator tolerance) fail identically on master `bfc3d77e0f` (`pine-dsk-mchk34`, the same 5 files: 8 failed | 350 passed). None is PT-GAPS's.
- **After r2:** `ptGaps` 23, `ptGapsDeltaRsi` 2, `coverageAudit` 185 + 7 skipped (one run, 210 passed); service suite on Node 24.13.1 139/139; `pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166.
- No code change was needed. Nothing was narrowed, because no PT-GAPS change fires on this shape. If the landing run's failure recurs, its log should show whether the runtime pane was declined (`runtime:not-yet-graded`) or timed out (`could not be compared`). Those are the two ways this test goes red without a host change.
