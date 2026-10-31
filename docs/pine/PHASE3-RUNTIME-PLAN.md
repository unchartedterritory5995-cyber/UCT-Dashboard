# Phase 3 plan: finish and arm the per-bar runtime lane

Written 2026-10-30/31. Measured on `origin/master` @ `b09a6bcee6`, after PRs #539-#542 including
Phase 2's #541. The runtime lane's own code (`engine/runtime/`, `pineRuntimeFrontend.js`,
`memberPaneDefinition.js`, `runtime_definitions.py`) is byte-identical between `ab852b4880`,
where the code was read, and `b09a6bcee6`, so every line citation holds at both.
Research and planning only: this branch
changes no product code. It is a companion to [`COVERAGE-MAP.md`](COVERAGE-MAP.md) (PR #535), whose
roadmap row 3 this plans, and to [`runtime-pane-switch-on-plan.md`](runtime-pane-switch-on-plan.md)
(RF/GT, 2026-10-02), whose operator steps it reuses rather than restates.

Every number here was measured in a **test process only**. No production endpoint, variable or
database was read. How to reproduce each one is in [section 7](#7-how-every-number-here-was-taken).

---

## 0. The answer in one screen

- **The lane is real, large and mostly built.** It is a bytecode VM running in a browser Web
  Worker. It has bar-by-bar execution, `var`, `:=`, `if`/`for`/`while`, value `switch`, UDF call
  frames with per-call-site state, tuples, arrays, UDTs, text and colour values, history rings,
  23 named limits, a kill list, an allowlist and a per-member stage. It is **dark** behind four
  switches, all off by default in code.
- **What switching it on buys today.** Run the census with the runtime pane on and the sample
  goes from **186 to 216 of 679 (27.4% to 31.8%)**. **24 of those 30 are imperative-blocked
  scripts**: 25 of the 186 attach through the runtime lane, and one of the 25 is an
  order-placing strategy, which never counts. Of the 24, **none has a parity grade from the
  coverage run**, because the vendor harness ran with the pane dark. **This plan's runtime-on
  harness run is the first grade.** It turns 22 INCONCLUSIVE captures into **17 MATCH and 5
  DIVERGE, with 0 regressions** (MATCH 92 to 109). 8 corpus scripts now have a MATCH capture,
  against 1 on the allowlist today. See [section 2.4](#24-parity-evidence-with-the-pane-on).
- **What finishing the lane buys** (runtime pane on, all remaining walls peeled):
  - **Imperative set.** Of the 147 imperative-blocked, non-order-strategy scripts that still do
    not attach, **78 have only Phase-3 walls** (upper bound). 25 of those were fully peeled to an
    attach (firm).
  - **Whole sample.** Phase-3 work alone reaches **+170 upper / +48 firm** on top of the 216.
    That is **386/679 (56.8%) upper and 264/679 (38.9%) firm**.
  - The coverage map's roadmap estimate was +135 upper / +59 firm. It was taken through the HOST
    door's walls, and this is the first estimate taken through the runtime lane's own walls.
- **The walls that remain**, ranked by scripts unblocked on the whole sample (greedy, details in
  [section 2.3](#23-remaining-walls-ranked)):

  | rank | wall | unblocks (upper / firm) |
  |---:|---|---|
  | 1 | history and series semantics | **+44 / +12** |
  | 2 | statement and block-value grammar | **+39 / +5** |
  | 3 | drawing and presentation from the run | **+34 / +8** |
  | 4 | builtins over runtime state, plus missing names | **+32 / +17** |
  | 5 | input kinds | **+16 / +3** |
  | 6 | `varip` and realtime | **+5 / +3** |

  Walls the lane cannot cross in this phase: `import` (58 scripts), `request.*` (71) and
  collections/`for…in`/`matrix`/`map` (42). Those belong to Phases 6, 5 and 4.
- **Arming needs little new code for its first stage (admins, allowlist only).** The
  allowlist can grow from 1 to 8 graded-MATCH scripts on today's evidence. Arming is blocked
  on:
  1. **evidence that stays measured**: today's runtime-on grade came from a temporary patch,
     because the committed harness cannot turn the pane on (2.4);
  2. **three small safety gaps**: string memory is unaccounted, the shared-link read is not kill
     or allowlist stamped, and nothing tells the operator when a member's run stops;
  3. **one silent semantic divergence**: a `ta.*` called conditionally is computed from every
     bar. This blocks widening past the allowlist.
  The go/no-go checklist is [section 4](#4-arming-go--no-go-checklist-owner-decision).
- **Work breakdown**: ten workstreams (0, A to F, H, I, J), plus a small item G. Once WS-0
  lands, A to F run in parallel beside H and I, with file ownership drawn so they do not
  collide ([section 5](#5-work-breakdown-parallel-workstreams)).

---

## 1. What the runtime lane is today

### 1.1 Architecture

```
member pastes Pine
  └─ memberPaneDefinition (builder/memberPane/memberPaneDefinition.js)
       ├─ host (columnar) translation: pine.js -> canonical tree -> V2 graph   ← production today
       └─ host refused AND runtimePaneEnabled()  ->  runtimeLaneDefinition (:1080)
            1. kill list (runtimeKill.js)              -> runtime:killed
            2. allowlist (runtimeKill.js, GT D6)       -> runtime:not-yet-graded
            3. repaint class (runtimeRepaint.js)       -> runtime:repaint-unstated
            4. probe build: pineRuntimeFrontend.buildRuntimeIr -> lowerIr -> program
            5. other-symbol/timeframe request          -> runtime:request
            6. unsettled na-test (fallback only)       -> runtime:na-test
            7. output map, presentation, own objects (RT5), disclosures
         => document  compute = {kind:'runtime', source, outputs, objects?}
  save  -> POST /api/user-definitions -> user_definitions._save_runtime (lexes, never executes)
  load  -> nativeRegistry.validateUserDefinitions (install door) -> computeFor
  run   -> runtimeAsync.ensureRuntimeLane -> module Web Worker (runtimeWorker.js)
             -> computeRuntimeColumns: build IR, lower, vm.run over the chart's OHLCV
             -> columns posted back -> chart repaints
```

- **One authoritative runtime, in JavaScript** (C4 Phase 2A decision): Node ran the same
  bytecode 33x faster than Python. The Python `ast_interpret.py` keeps the legacy
  columnar lane and never learns scopes, frames or loops.
- **Hybrid by effect, not by syntax.** In `pineRuntimeFrontend.js`, a subtree that reads no
  mutable slot is routed to the columnar lane (`interpret.js`) and becomes one precomputed
  column, which the VM reads with `READ_COLUMN`/`READ_HIST`. A subtree that reads a mutable slot
  becomes IR statements. So the 70 closed-table builtins keep their warm-ups and vendor pins, and
  the VM never re-implements one. The scalar operators are imported from `interpret.js`, not
  copied.
- **Compiled on every run.** The stored document is the **raw Pine source**, never bytecode. The
  browser compiles it on every run, and the document's version stamp
  (`runtimeColumns.js:300-337`) refuses a document built by a different front end
  (`runtime:version`).

| part | file | lines |
|---|---|---:|
| front end (statement tree to IR) | `engine/ast/pineRuntimeFrontend.js` (one closure, `buildRuntimeIrLinked`, `:1033-8785`) | 8,821 |
| IR / validator | `engine/runtime/ir.js` | 928 |
| IR to program | `engine/runtime/lowerIr.js` | 922 |
| VM | `engine/runtime/vm.js`, `vmState.js` | 1,498 |
| limits | `engine/runtime/limits.js` | 260 |
| columns / probe / checkpoint resume | `engine/runtime/runtimeColumns.js` | 1,129 |
| worker transport | `engine/runtime/runtimeAsync.js`, `runtimeWorker.js` | 291 |
| collections, objects, text, colours | `collections.js`, `objectLane.js`, `objectStore.js`, `text.js`, `colours.js`, `records.js`, `handles.js` | 2,611 |
| server | `api/services/runtime_definitions.py`, `runtime_repaint.py` | 629 |

### 1.2 Pine semantics: implemented and not

Detail, with line citations, is in section 3. In summary:

| capability | state |
|---|---|
| one pass per bar, in order; end-of-bar commit | implemented (`vm.js:575-1304`) |
| `var` (once-only initialiser) | implemented; `var x = if/switch …` refused (`runtime:block-value`) |
| `varip` | **refused** (`runtime:varip`) |
| `:=`, compound assignment | implemented |
| `if`/`else if`/`else` as statement or value | implemented; a multi-statement value arm is refused (`runtime:block-value`) |
| `switch` as value | implemented; `switch` as a statement is **refused** (`runtime:switch`) |
| `for i = a to b by s`, `while`, `break`/`continue` | implemented (bounds evaluated once) |
| `for … in` | **refused** (`runtime:loop`) |
| UDFs | frames with per-call-site `var`/history/carried state; recursion, named args and global-state reads refused |
| tuples `[a, b] = f()` | implemented |
| arrays (about 25 `array.*`), UDTs, single-dispatch `method` | implemented; `matrix.*`, `map.*` and overloaded methods refused |
| text and colour values | implemented, with partial builtin coverage (`runtime:call-text-state`) |
| `x[n]` on series, columns, variables, function locals | implemented; a nested `(expr)[n]` and an unbounded dynamic offset are refused |
| conditional `ta.*` (per-call-site history) | **silently computed from every bar** on the plot lane (`pineRuntimeFrontend.js:1518-1563`); refused only when the run draws its own objects |
| `max_bars_back` | only `max_bars_back(x, 5000)` accepted; the `indicator(max_bars_back=)` argument is ignored |
| realtime rollback | a rerun resumes from the last confirmed bar's checkpoint (`runtimeColumns.js:530-621, 709`), which reproduces rollback for non-`varip` state |
| `barstate.isrealtime/isconfirmed/ishistory` | tri-state; refused (`runtime:realtime-untold`) when the forming state is unknown |
| `barstate.isnew` | refused by name |
| `request.security` on the pane | the VM can run requests (`runRequest`), but the pane gets no other bars, so it is refused (`runtime:request`) |
| `request.security_lower_tf`, `import`, strategies' orders | refused; out of this phase |

### 1.3 Security model (it runs member-supplied logic)

**Where it runs.** Only in the member's own browser, in a module Web Worker
(`runtimeAsync.js:415`).
- If constructing a Worker throws, the run falls back to the main thread under the same budget.
- **The server never executes Pine.** It lexes (repaint class, `runtime_repaint.py`) and
  validates shape.
- Scans and alerts refuse any lane but `ast` (`scan_definition.py:492`,
  `alert_user_series.py:809-817`).
- There is no Node sidecar for this lane, despite the C4 Phase 2 plan.

**No code generation.**
- No `eval` and no `new Function` anywhere under `app/src/components/chart` outside tests.
- Pine is lowered to a flat `[op, a, b]` instruction array and interpreted by a switch-dispatch
  VM whose header says no clock, no network, no module state (`vm.js:19-22`).
- There is no `fetch`, XHR, WebSocket, storage or `importScripts` under `engine/runtime/`.
- The script's only inputs are the chart's OHLCV, its inputs, ticker and exchange.

**Cross-member reach exists, and is gated today by the allowlist.**
- A runtime definition can be shared, installed, forked or published.
- `install_share` and `fork` re-save through `_save_runtime`, so the installer's stage, kill
  list, allowlist and the 128 KiB cap all apply again.
- ⚠️ `GET /shared/{token}` returns the document **without** `stamp_served`
  (`routers/user_definitions.py:798`), so a killed or ungraded script's shared link is not
  stamped. Whether the client previews a shared runtime document through the lane is
  **unverified**. Gap S4 in section 4.

**CPU limits** (`limits.js:83-200`; every limit throws a named `RuntimeLimitError`):
- instructions: 200,000 per bar and 200 M per run;
- loops: 5 M loop iterations per run, 10,000 `while` iterations per entry, nesting depth 8;
- calls: depth 64, 5 M calls;
- **time: 1,000 ms pane budget** (`runtimeColumns.js:198`, checked per bar) and 5,000 ms VM
  wall time;
- worker: watchdog 20 s, 3 worker starts per tab, one run in flight per pane, and a hung worker
  is never re-run on the main thread.

**Memory limits**:
- arrays: 100k elements and 2 M operations;
- live objects: 2,055;
- history: 32,768 bars, 512 slots, 262,144 values;
- source: 512 KiB;
- IR: 200k nodes;
- `MEMORY` 64 MiB, which is an **estimate** (static bytes, plus 16 B per array element, plus
  512 B per live object, `vm.js:1329`).

⚠️ **Strings are not counted.** `CONCAT` is a raw `x + y` (`vm.js:724-740`). A doubling loop fits
30 doublings inside one bar's instruction budget, so the worker's own heap limit trips before any
named limit. It is contained (the worker dies and is named `runtime:worker-failed`, and the
chart lives), but unmeasured. Gap S2.

### 1.4 Performance (measured by RF, 2026-10-02, `docs/pine/evidence/rf-runtime-readiness-2026-10-02/`)

| measure | value |
|---|---|
| 5,000 daily bars, headless Chromium worker, the six then-attaching scripts | 65 to 271 ms; fibonacci-dolphintradebot **0.8 to 1.24 s, at or over the 1,000 ms budget** |
| main-thread worst frame gap during a worker run | 17 ms (a deliberate 400 ms block control read 383 ms) |
| `postMessage` of result rows | 1 to 2 ms at 5k bars; 13 to 17 ms at 32k |
| worker bundle | 1,303,711 B (380,686 B gzip), standalone; the in-app chunk is **unmeasured** |
| 32,768-bar history ceiling | worst about 1.3 s; memory estimate peak 28 MB of 64 MB |
| C4 2A spike | 5.5 ns per VM instruction (Node), 33x the Python loop |

Since then a checkpoint resume (UIE Phase 5) makes a realtime rerun start at the last confirmed
bar instead of bar 0. Its cost on a live chart is unmeasured here.

### 1.5 The switches, and their defaults in code

| switch | read at | default in code | change needs | ledger (`docs/feature_flags.json`) |
|---|---|---|---|---|
| `VITE_PINE_RUNTIME_PANE_ENABLED` | `engine/runtimePaneGate.js:52-59` (`=== '1'`, fails closed) | **off** | a rebuild (`Dockerfile.web:114, 138`) | `dark`, "UNSET on every service" |
| `PINE_RUNTIME_STAGE` (`off`/`admins`/`all`) | `api/services/runtime_definitions.py:139-159`; rides the auth payload as `pine_runtime_pane_enabled` | **off** (unset, empty or a typo all read off) | a variable; a tab keeps its first latched answer until reload | `dark` |
| `PINE_RUNTIME_SAVE_ENABLED` | `runtime_definitions.py:123-125` | **off** | a variable (plus a redeploy after a delete) | `dark` |
| `PINE_RUNTIME_KILL_LIST` | `runtime_definitions.py:128-136` | empty | a variable | **no ledger row** |
| `PINE_RUNTIME_ALLOWLIST` + `api/data/pine_runtime_allowlist.json` | `runtime_definitions.py:171-206` | env empty; the file holds **one** script (adx-and-di-for-v4) | a variable, or a commit + deploy | **no ledger row** |

A member sees a runtime pane only when **all** of these hold:
- the build flag is set;
- their stage is permitted;
- the script's sha256 is allowlisted;
- the script is not killed.

There is **no cohort-tag stage** (`rollout_gate.py` has no pine cohort). GT replaced RF's cohort
proposal with `PINE_RUNTIME_STAGE`.

---

## 2. Measured: the census with the runtime pane on

### 2.1 Method

- **Same sample, same door.** 679 scripts from the coverage-map cache, through the member door
  (`memberPaneDefinition` then `installUserDefinitions`), driven by
  `tools/pine_coverage/run_census.py`.
- **One change, temporary.** The census test was patched, for this run only, to hold
  `VITE_PINE_RUNTIME_PANE_ENABLED=1` on **every peel step** instead of step 0 only. It also
  records the runtime lane's own decline (`runtimeDeclined`), and the probe's refusal guard,
  line and token.
- **The patch is reverted.** It was restored byte-identically (sha256 `dffad242…` verified)
  before this commit.
- **The peel neutralises the line the runtime lane refused**, using the same `x = 0.0` binding
  rule, up to 8 steps.
- **Walls are attributed to the runtime lane's guard, not the host's.** The original census
  recorded only the host's refusals for a runtime decline, which hides the runtime lane's real
  wall.
- **Grouping.** Each wall is mapped to one of six Phase-3 groups (A to F) or to an out-of-phase
  group (X4 collections, X5 requests, X6 libraries, X7 strategy).
- **Instrument artifacts are discarded:**
  - `pine:undefined`, which mostly comes from a peel blanking a tuple binding;
  - a refusal on the peel's own `x = 0.0` line.
- **"Transfer" uses `coverage_map.py`'s predicate.** A runtime-lane attach counts, and an
  order-placing strategy never does.

### 2.2 Which of the 186 imperative-blocked scripts it already handles

**25 of 186 attach through the runtime lane today. 24 count**: `parabolic-sar-strategy` places
orders.

| population | runtime-attached (counted) |
|---|---|
| TradingView built-ins | fisher-transform, mcginley-dynamic, MACD, percentage-volume-oscillator, price-oscillator |
| committed corpus | adx-and-di-for-v4, atr-stepped-pdf-ma-loxx, deadband-hysteresis-filter-backquant, delta-rsi-oscillator-strategy, fvg-trend, inside-bar-range-mother-candle, kalman-price-filter-backquant, linear-regression-channel, nadaraya-watson-rational-quadratic-kernel-non-repainting, parabolic-sar (xoeo), renko-candles-overlay, trend-targets-algoalpha, wyckoff-accumulation-distribution |
| reference corpus | aetheredge-smart-money-flow, laguerre-rsi-v4-lk, nadaraya-watson-combine, twiggs-money-flow-lazybear, volume-supertrend-ai-zeiierman, williams-vix-fix-bottoms-and-tops |

⚠️ **Six of the 24 carry the host's `partial` object-loss verdict.** These are
linear-regression-channel, parabolic-sar, renko, wyckoff, aetheredge and nadaraya-watson-combine.
"Attached" is an upper bound: the census does not grade what the runtime lane draws.

The other 6 scripts that switching on adds are not imperative-blocked: average-directional-index,
DMI, cc-yata, fibonacci-dolphintradebot, order-blocks and parabolic-sar-alerts.

**The lane loses nothing.** No script that transfers in production stops transferring with the
pane on (0 of 186).

### 2.3 Remaining walls, ranked

**Scope of the measurement:**
- **Imperative set:** 147 scripts that do not attach and are not order-placing strategies.
- **Whole sample:** 324 such scripts.
- **Fully peeled to an attach** (firm): 29 and 72 respectively. The rest hit the 8-step cap or a
  line-less decline, so their wall lists are lower bounds.

**Greedy order: close the group that unblocks the most, then the next.**

| group | what it is | imperative: touches | imperative: unblocks (upper / firm) | whole sample: touches | whole sample: unblocks (upper / firm) |
|---|---|---:|---|---:|---|
| **C** history and series semantics | `(expr)[n]` inside blocks, series lengths and dynamic offsets (`ta.sma(x, len)` with series `len`, `ta.highest/lowest`), UDFs reading a global's history (`runtime:function-global-state`), `max_bars_back` forms, unbounded recurrence (`pine:state`) | 34 | +21 / +7 | 62 | **+44 / +12** |
| **A** statements and block values | multi-statement `if` value arms (25 scripts), comma-separated statements (14), `switch` as a statement (11), `var x = switch/if` (5), orphan `else` (6), `runtime.error` statement, `runtime:no-output` (13) | 81 | +19 / +2 | 164 | **+39 / +5** |
| **E** drawing and presentation from the run | `line/label/box.new` in the run (27), drawing getters, `plotcandle` (11), gradient `fill`, fill target, `barcolor` colour, `nothing-drawn` / `withheld-all` (24) | 42 | +17 / +6 | 75 | **+34 / +8** |
| **B** builtins over runtime state, plus missing names | `str.tostring` over state (7), `int()` over state (5), `ta.hma/ta.cum/ta.vwap` over state, per-bar clock calls `time()/timestamp/year(t)` (16), `barstate.isnew` (4), `ta.cci` role order, `ta.macd` arity, `ta.nvi/pvi`, `TVta.*` (built-in library calls), `str.format/endswith` | 85 | +9 / +6 | 195 | **+32 / +17** |
| **D** input kinds | `input.timeframe` (13), `input.time` (7), `input.session` (6), an input default read from state | 15 | +8 / +1 | 29 | **+16 / +3** |
| **F** realtime | `varip` (5) | 4 | +4 / +3 | 5 | **+5 / +3** |
| **G** `na` below v4 | `runtime:na-test` | 0 | 0 | 3 | +2 sole |
| *all of A to F* | | | **78 / 25** | | **170 / 48** |

**The last wall a script has** (scripts with only one group left, whole sample):

| group | scripts |
|---|---:|
| B | 32 |
| X5 | 17 |
| A | 14 |
| E | 11 |
| C | 8 |
| X6 | 5 |
| F | 3 |
| D | 2 |
| G | 2 |
| X4 | 1 |

**Walls outside this phase.** The lane cannot pass these, and other phases own them:

| group | touches (whole sample) | imperative scripts needing only this group |
|---|---:|---:|
| X6 `import` (`runtime:library`) | 58 | 23 |
| X5 `request.*` | 71 | 19 |
| X4 collections (`for…in` 13, `matrix.new`, `map.new`, `array.insert/fill/sort`, overloaded methods) | 42 | 14 |

**Reading the numbers:**
- **B is the most certain.** It has the largest firm count (+17), because many scripts are one
  builtin away. It overlaps Phase 1's missing names (`time` forms, `barstate.isnew`, `ta.cci`,
  `ta.nvi/pvi`). Do it with Phase 1, not twice: section 5, WS-B.
- **C and A have the largest reach** but the smallest firm share. Their scripts have long wall
  lists.
- **"Upper" is optimistic.** For the 252 of 324 scripts the peel did not finish, further walls
  may hide behind the cap. The firm column is the floor.
- **Known instrument limits:**
  - the runtime peel removes one line per step, so 8 steps is a short reach;
  - 13 `runtime:no-output` declines may be peel consequences, where a peeled plot line left
    nothing to draw.
  - WS-0 raises the cap and collects every refusal per pass.
- **Routing gap.** 63 scripts attach on the HOST lane with a dropped object or a withheld paint.
  The runtime lane is never offered those, because routing happens only on a host refusal. How
  many the runtime lane would draw exactly is **unmeasured**: WS-J.

### 2.4 Parity evidence with the pane on

**Method.**
- `vendorHarness.corpus.test.js` was run over `tests/fixtures/vendor/harness` (336 captures, RDDT
  and SPY, mostly daily), at `b09a6bcee6`, twice:
  1. objects-only pane on, runtime pane dark (production flags);
  2. both panes on.
- The second run needed a **temporary patch**. It was reverted and its sha256 verified.

**⛔ Instrument finding: the harness, as committed, cannot measure the runtime lane at all.**
- `runHarness` runs at **collection** time, inside `describe`.
- `test-setup.js` grants the per-member permission and the allow-every-script override in a
  **`beforeEach`**, which has not run yet at collection time.
- So `runtimePaneEnabled()` is false for every capture, however the flag is set. Setting
  `VITE_PINE_RUNTIME_PANE_ENABLED=1` in the process environment, or `vi.stubEnv` at module scope,
  changed nothing: both runs read MATCH 92 / DIVERGE 98 / INCONCLUSIVE 146, capture for capture.
- The patch that worked (WS-0 makes it a committed, env-gated mode) does three things at module
  scope, before `runHarness`:
  - `vi.stubEnv` of both flags;
  - `__permitRuntimePaneForTests()`;
  - `__allowEveryRuntimeScriptForTests()`.
- It also tags each runtime decline in the refusal text, so the decline code can be counted.
- ⚠️ This explains why the coverage map's runtime-attached scripts carry no grade. **Any earlier
  "runtime on" harness number taken through env vars alone measured the dark pane.**

**Result.**

| run | MATCH | DIVERGE | INCONCLUSIVE |
|---|---:|---:|---:|
| production flags (runtime dark) | 92 | 98 | 146 |
| runtime pane on | **109** | **103** | **124** |

- **22 captures change verdict, every one from INCONCLUSIVE.** No capture that MATCHes today stops
  matching, and no DIVERGE gets worse.
- **17 become MATCH**, covering 8 corpus scripts plus probes:

  | kind | captures |
  |---|---|
  | corpus scripts | adx-and-di-for-v4 (RDDT + SPY), deadband-hysteresis-filter-backquant, delta-rsi-oscillator-strategy, fibonacci-dolphintradebot (RDDT + SPY), inside-bar-range (RDDT), kalman-price-filter-backquant, parabolic-sar, renko-candles-overlay |
  | probes | `vw-bar-origin` (RDDT 60, SPY 1m, SPY 1W), `vw-h4-loops` (RDDT + SPY), `vw-var-seed` (SPY), `r1-strategy-draws-indicator` |

- **5 become DIVERGE**, in four classes:

  | class | captures | what differs |
  |---|---|---|
  | **per-bar `barcolor` not carried** (ruling D4: disclosed, not drawn) | wyckoff (SPY), `vw-deadband-ticks` (BRK.A) | `paints: barcolor notDrawn`. Plots match. |
  | **early-bar `na`** | inside-bar-range (SPY) | `plotshape` at bar 2: vendor 1, ours `na`. One bar. |
  | **last-bar strategy value** | `r1-strategy-draws` (RDDT) | All four plots at bar 635, the newest bar, are `na` on TradingView and a value here. This is a strategy recalculation on the last bar: realtime model, WS-F. |
  | **a real value defect** | trend-targets-algoalpha (RDDT) | `Baseline` is `na` here on 82 scattered bars (140 to 221) where TradingView has a value. To diagnose before that script is allowlisted. |

- **Runtime declines across the 336 captures**, by code:

  | code | captures |
  |---|---:|
  | `pine:input-kind` | 18 |
  | `pine:function` | 16 |
  | `pine:builtin` | 14 |
  | `runtime:library` | 5 |
  | `lower-tf:*` | 7 |
  | `runtime:request` | 3 |
  | `runtime:loop` | 2 |
  | `runtime:statement` | 2 |
  | `pine:arity` | 2 |
  | `pine:drawing` | 2 |
  | `pine:colour-value` | 2 |
  | one each | `runtime:colour`, `runtime:object-op`, `pine:collection`, `runtime:call-undeclared-builtin-state` |

  The same walls as 2.3, in the same order: input kinds, builtins and names.

**What this means for arming.** The allowlist (ruling D6: a capture graded MATCH) could grow from
1 to **8 scripts today**:

| status | scripts |
|---|---|
| allowlisted today | adx-and-di-for-v4 |
| graded MATCH, can be added | deadband-hysteresis-filter-backquant, delta-rsi-oscillator-strategy, fibonacci-dolphintradebot, kalman-price-filter-backquant, parabolic-sar (xoeo), renko-candles-overlay |
| MATCH on RDDT only | inside-bar-range (its SPY capture DIVERGEs by one early bar) |
| needs a fix first | trend-targets-algoalpha |
| needs paints carried (D4) | wyckoff |

Caveats on the additions:
- delta-rsi-oscillator-strategy places orders. Its plots MATCH, but it never counts as a
  transfer.
- fibonacci-dolphintradebot sits at the 1,000 ms budget (B2).

---

## 3. Pine execution semantics that must hold for parity, and where the lane stands

Each row has three parts:
- **Pine:** the behaviour TradingView documents for Pine v5/v6. Rows marked *(pin)* are not yet
  witnessed by a committed capture. Standing ruling 2 applies: an unwitnessed semantic is never
  served, it is refused by name until a capture settles it.
- **Lane:** what the code does, with file:line.
- **Verdict.**

### 3.1 Bar-by-bar execution and history

| semantic | Pine | lane | verdict |
|---|---|---|---|
| execution order | The whole script runs once per bar, oldest to newest. Every statement on the bar sees the values committed at the previous bar's close. | One pass per bar (`vm.js:575`). The main frame's locals reset to `na` per bar (`:579`). History rings are committed at end of bar (`:1284-1304`). | **holds** |
| pure builtins | `ta.*` is a series function evaluated on the bars where its call executes | The columnar precompute is read per bar (`READ_COLUMN`). This is identical when the call runs every bar. | holds for unconditional calls |
| **conditional `ta.*` / history in a block or function that does not run every bar** | The call's internal history holds **only the bars on which it ran**: per call site. TradingView warns about exactly this. | A pure call inside an `if`, a loop or a UDF body becomes an every-bar column. It is refused (`runtime:conditional-history`) **only** when the run draws its own objects (`pineRuntimeFrontend.js:1518-1563, 5365`). | **WRONG, silently, on the plot lane.** The single most important correctness item. Captures C34 / `vw-fn-series-history` witness Pine's rule. WS-C. |
| `x[n]`, `n` literal, over a series or variable | the value committed `n` bars ago; `na` before the first bar | rings; `na` past the start, never a clamp (`vm.js:650-665, 761-775`) | holds |
| `(expr)[n]` | the history of the expression's own series | hoisted to a hidden committed slot at root level (`:4728-4748`); nested lists refuse (`runtime:history-expression`) | partial (WS-C) |
| function-local `x[n]` | per call site | per-site rings, and a skipped site re-commits its held value (vendor-pinned v5/v6, `vm.js:291-306`) | holds |
| dynamic `x[n]` | any series int; `na` beyond the buffer | over a column or series: yes. An `na` offset reads the current bar (C29, witnessed). Over a variable: only when proven `0 ≤ n ≤ 5000`. Otherwise `runtime:history-dynamic-offset`. | partial (WS-C) |
| v6 series-length `ta.*` (`ta.sma(x, len)` with series `len`) | allowed in v6 | refused (`runtime:history-dynamic-offset`, `:5277-5281`) | **missing** (WS-C, 15+ scripts) |
| `max_bars_back` | The buffer is sized automatically from the early bars. `max_bars_back(x, n)` and `indicator(max_bars_back=)` raise it, up to 5,000. A read past the buffer is a **runtime error** on TradingView. | Only `max_bars_back(x, 5000)` is accepted, as a no-op. The declaration argument is ignored (`:6623`). A read past the start is `na`, and the lane never raises Pine's error. The comment "a chart here holds at most 5,000 bars" is stale: `HISTORY` is 32,768. | **diverges in the error case** *(pin: C38 queues `max_bars_back(x, n)` and a buffer overrun, with no probe file yet)*. WS-C. |

### 3.2 `var`, `varip` and the realtime rollback model

| semantic | Pine | lane | verdict |
|---|---|---|---|
| `var x = …` | The initialiser runs once, on the first bar it is reached. The value persists across bars. | `JUMP_IF_INIT` around the initialiser (`lowerIr.js:550-561`); persistence is decided per declaration | holds; `var x = if/switch` refused (WS-A) |
| non-`var` | re-evaluated every bar | locals reset per bar | holds |
| realtime, each tick of the forming bar | All variables, **including `var`**, roll back to the state committed at the previous bar's close. Then the script re-runs for the tick. At bar close, the last run's state commits. | No tick loop. Each new bars array triggers a rerun **from the checkpoint at the last confirmed bar** (`runtimeColumns.js:530-621, 709`). A forming bar is never checkpointed (`:550`). Equivalent to rollback for `var` and non-`var`. | **holds by construction**; the tick cadence is whatever the bars feed delivers *(pin: no committed realtime capture of a `var` counter on a forming bar)* |
| `varip` | escapes rollback: keeps per-tick updates within the bar | refused (`runtime:varip`) | **missing** (WS-F). Also needs a tick-granular feed, otherwise `varip` equals `var`. |
| `barstate.isnew` | true on the first tick of a bar | refused by name (it used to fold to a tautology) | **missing** (WS-F) |
| `barstate.isrealtime/isconfirmed/ishistory/islastconfirmedhistory` | | Tri-state columns from `/api/bars` `newest_bar_is_forming`. Without it: `runtime:realtime-untold`. | holds where told |
| historical vs realtime divergence (repaint) | a script may draw differently on history than live | stated per document by `runtimeRepaint.js` and re-derived by the server | holds (classification, not simulation) |

### 3.3 `na` propagation

| semantic | Pine | lane | verdict |
|---|---|---|---|
| arithmetic with `na` | `na` | IEEE NaN propagation; scalar operators shared with `interpret.js` | holds |
| division by zero, overflow | `na` | Infinity is laundered to `na` only at `EMIT` (`vm.js:1114-1143`). Inside a bar an Infinity can live in a slot and win a comparison. | **edge risk**: `x / 0 > y` inside a branch differs *(pin)* |
| comparisons with `na` | false | `cmp` gives 0 | holds |
| `na` in `if`/`while` conditions | false (v4+) | false | holds |
| `na` in `?:`, `and`, `or`, `not` | v4/v5 read as condition (false); v6 `and`/`or` short-circuit, and `bool` cannot be `na` | implemented from the listing (`naConditionIsFalse`, `lowerIr.js:383-481`; F2 witnessed) | holds v4 to v6 |
| v1 to v3 `na` conditions | different rules per version | unclaimed: `runtime:na-test` | refused by name (3 scripts) |
| `nz`, `na()`, `fixnan` | | pointwise / carried | holds |
| `%` with a negative operand | truncated (JS-like) per the docs, not published precisely | truncation | *(pin)* |
| `int(x)` | truncates toward zero (docs) | the runtime truncates; the **host lane refuses** a non-whole `int()` as unpinned | **the two lanes disagree by design** *(pin)* |
| int ÷ int | before v6, `const int / const int` truncates; v6 returns float | the pre-v6 const rule is implemented (vendor-witnessed) | holds |

### 3.4 Type qualifiers (`const` < `input` < `simple` < `series`)

**Pine.** Qualifiers are checked at compile time. Some arguments must be `simple` (in v5, many
`ta.*` lengths; v6 relaxed most to `series`). A `series` value cannot feed a `simple` slot.
Declared types (`int`, `float`, `bool`, `string`, `color`) coerce: an `int` assigned to a `float`
slot is a float, and `bool` cannot be `na` in v6.

**Lane.** There is **no qualifier checker.** Kinds (text, colour, array, UDT, drawing) are
inferred structurally. A mismatch surfaces as a run-time `VmError` (`runtime:failed`). A value
needed before bar 0 (window lengths, offsets, input defaults) must fold, which is effectively a
`simple` check: `runtime:history-dynamic-offset` and `runtime:input-state`.

**Verdict.**
- Acceptable for parity of **valid** scripts: TradingView rejects invalid ones before they run.
- **Two gaps matter:**
  1. **v6 `series` lengths** are refused where Pine allows them (WS-C).
  2. **Declared-type coercion** (`int x = 3.7`, `bool` never `na` in v6) is not modelled
     uniformly. Unmeasured; WS-B adds a probe.
- A checker is **not** a prerequisite. A member's paste was compiled by TradingView first.

### 3.5 Loop limits and timeouts

| | Pine (TradingView) | lane |
|---|---|---|
| per-loop | runtime error when one loop runs too long (documented as a time limit) *(pin the exact rule)* | `WHILE_ITERATIONS` 10,000 per entry; `LOOP_ITERATIONS` 5 M per run |
| per-bar / per-script | total calculation-time limits per script (plan-dependent) | `INSTRUCTIONS_PER_BAR` 200,000 (a **standing ruling: never raised**); 1,000 ms pane budget; 5,000 ms VM wall |
| `for` bound | **v6 re-evaluates the `to` bound on each iteration** (v6 migration guide) | evaluated once at entry (`lowerIr.js:598-658`) | **diverges for v6 loops whose bound changes in the body** *(pin; WS-A)* |

**Verdict.**
- **Instruction budgets are deterministic and device-independent, so they are right for
  verdicts.** A script that passes on one device passes on all.
- **The 1,000 ms wall budget is not deterministic.** fibonacci-dolphintradebot measured
  0.8 to 1.24 s on one box, so it attaches on one device and stops on another.
- The arming checklist requires a per-script measured cost class, not a single wall clock
  (section 4, P3).

### 3.6 What the lane gets wrong today (the short list)

1. **Conditional `ta.*`/history**: an every-bar column instead of per-call-site. **Silent** on
   plot-only scripts. *Highest priority: it can make an attached script draw a plausible wrong
   line.*
2. **Past-buffer reads** answer `na` where TradingView raises a `max_bars_back` error. This
   draws where TV shows an error, and the declaration argument is ignored.
3. **v6 `for` upper bound** is evaluated once, where v6 re-reads it.
4. **Infinity inside a bar** is laundered only at output.
5. **`int()` of a non-whole value**: the two lanes answer differently.
6. **Refusal sentences are stale** in `RUNTIME_REFUSALS`. `runtime:loop` says "no iteration
   yet" and `runtime:function` says "no call frames yet", though both exist. A member reads these
   only through the host sentence, but diagnostics and the census read them. Map by guard, never
   by sentence.

---

## 4. Arming: go / no-go checklist (owner decision)

**The owner decides.** Every lever below is a **variable or a list entry, never a delete**.
Per standing memory rule, a kill switch is never a delete: a killed script falls back to the
host's answer, and its saved definition stays.

### 4.1 Safety

| # | item | state | evidence or work |
|---|---|---|---|
| S1 | Member logic runs only in the member's own browser worker. No eval, no network, and the server never executes it. | **MET** | section 1.3; grep evidence |
| S2 | Memory: strings counted in the `MEMORY` estimate; a measured worker-OOM path that names the stop and leaves the chart usable | **NOT MET** | WS-H: account `CONCAT` bytes, add a rail with a doubling-string script |
| S3 | CPU: every stop named (`time-budget`, `limit`, `failed`, `worker-unresponsive`, `worker-failed`, `load-failed`); watchdog; 3 starts per tab; a run never moves to the main thread after a hang | **MET** (RF P2/P4) | `runtimePaneSafety.test.jsx` |
| S4 | Every serving path stamps kill and allowlist state, **including `GET /shared/{token}`** | **NOT MET** | WS-H: one line in `routers/user_definitions.py:798`, plus a rail |
| S5 | Kill switches, all "=0 / remove from list" levers: `PINE_RUNTIME_STAGE=off`, `PINE_RUNTIME_KILL_LIST`, the allowlist entry, `PINE_RUNTIME_SAVE_ENABLED` unset | **MET** (GT) | `tests/test_pine_runtime_switch_on.py`, `runtimeKillSwitch.test.js` |
| S6 | A switch-off reaches an open tab | **PARTIAL**: the stage latches per tab until reload | Accept (documented), or WS-I re-reads the stage on each kill-list read |
| S7 | Ledger rows for `PINE_RUNTIME_KILL_LIST` and `PINE_RUNTIME_ALLOWLIST` in `docs/feature_flags.json` | **NOT MET** | WS-I (docs only) |
| S8 | Telemetry: the operator can see run stops by guard, per script hash, without reading a member's screen | **NOT MET**: the stop is shown only on the member's disclosure strip | WS-H: a counted beacon (guard, hash prefix, bars, ms), no source, no member content |

### 4.2 Parity evidence

| # | item | state |
|---|---|---|
| P1 | Every script served by the lane is graded **MATCH** on a TradingView capture with the **pane on** (ruling D6) | Holds by construction for the allowlist (1 script). **8 scripts are now graded MATCH with the pane on** (section 2.4). Adding each is one allowlist line, per D6. |
| P2 | The graph-vs-runtime differential rail is green (bit-identical, with mutation controls) | exists (`graphRuntimeDifferential.test.js`); must be part of the gate run |
| P3 | **The conditional-`ta.*` divergence (3.6 item 1) is fixed, or refused on every lane**, before anything beyond the allowlist is served | **NOT MET**: a no-go for widening past the allowlist |
| P4 | The vendor harness has a **runtime-on mode as a rail**, so the verdict with the pane on is re-measured on every change | **NOT MET**, and worse than missing: the committed harness **silently measures the dark pane** even with the flag set (2.4). WS-0. |
| P5 | The allowlist can grow faster than one capture per script. The owner's goal is "essentially every script", and a per-sha256 allowlist does not scale: a member's paste that differs by one byte is a different hash. | **Policy decision for the owner**: see 4.6 |

### 4.3 Performance budgets

| # | budget | state |
|---|---|---|
| B1 | Main-thread frame gap ≤ 1 frame during a worker run | MET (17 ms) |
| B2 | p95 run ≤ 1,000 ms at 5,000 daily bars on a **reference low-end device**, for every allowlisted script | measured on one desktop only. WS-H adds a CPU-throttled (4x) profile to `runtime_pane_worker_probe.py`. |
| B3 | 32,768-bar intraday run ≤ 1,000 ms or a named stop | measured at worst about 1.3 s. A named stop is acceptable; a hang is not. |
| B4 | Worker chunk measured **in-app** (gzip), lazily fetched only when a runtime pane computes | in-app size **unmeasured** (RF blocker). Budget proposal: ≤ 450 KB gzip. |
| B5 | Realtime rerun from a checkpoint ≤ 50 ms per tick on a 5,000-bar daily chart | **unmeasured**: WS-H |

### 4.4 Rollback plan (all reversible, none deletes)

| scope | lever | reach |
|---|---|---|
| one script | add its sha256 or definition id to `PINE_RUNTIME_KILL_LIST`, or remove its allowlist line | next definitions read / MemberPane mount; no deploy |
| everyone | `PINE_RUNTIME_STAGE=off` | next authenticated request; an open tab at reload |
| saving | unset `PINE_RUNTIME_SAVE_ENABLED` (then `railway redeploy`) | saved rows stay and are still served |
| the code | rebuild without `VITE_PINE_RUNTIME_PANE_ENABLED` | a deploy |

The exact commands, and the in-process verification, are the GT operator steps in
`runtime-pane-switch-on-plan.md`. Trigger: `tools/runtime_pane_smoke.py` exit 1 means roll back
first (H15). Exit 2 is inconclusive and never a trigger.

### 4.5 Staged rollout

| stage | who | gate to enter | gate to leave |
|---|---|---|---|
| **0. dark** (today) | nobody | — | S1, S3, S5, B1 (all met), plus a full-suite run on a whole install (RF P11, **not met**) |
| **1. owner-only** | admins (`PINE_RUNTIME_STAGE=admins`), allowlist = graded MATCH only | stage-0 exit; S2, S4, S8 met | 2 weeks, with zero `worker-failed`/`load-failed`, no H14 (repaint loop) report, and the smoke green on each deploy |
| **2. cohort tag** | a `user_tags` cohort, e.g. `pine-runtime-pane`, behind its own cohort kill switch in `rollout_gate.py` | **needs code: WS-I.** A cohort stage that does not exist today; GT has admins/all only. | allowlist ≥ 25 graded scripts; P3 met; telemetry shows the time-budget stop rate under 2% of runs |
| **3. everyone** | `PINE_RUNTIME_STAGE=all` | stage-2 exit; B2 met on the low-end profile | — |

### 4.6 The owner decisions this plan needs

- **R1. Grading policy beyond one-capture-per-script.**
  - Keep D6 (only captured MATCH scripts are served), or
  - admit a script when **every capability it uses** is conformance-graded: per-capability vendor
    captures, plus the differential rail, plus the census naming its capabilities.
  - The second scales to "essentially every script". The first caps the lane at the capture rate
    (about 5 to 10 per owner session).
- **R2. Cohort stage.** Build WS-I's cohort tag between admins and all, or go admins to all
  (GT's two steps).
- **R3. The 1,000 ms wall budget.** Keep it device-dependent (ruling D3), or move the attach
  decision to the deterministic instruction budget and keep wall time as a safety stop only.
- **R4. Conditional-`ta.*` transition.** Before WS-C lands the per-call-site semantics, refuse
  conditional pure `ta.*` on the plot lane too. That may detach some of the 24, and the count is
  unmeasured until WS-0 runs. Or hold the allowlist at graded scripts only.

---

## 5. Work breakdown: parallel workstreams

**File-ownership rule.** `pineRuntimeFrontend.js` is one 7,750-line closure that most
workstreams touch. Each workstream below owns **named regions** of it, by function or line band
at `ab852b4880`. It adds its rails in **new** test files, rebases daily, and lands through one
integrator. A workstream that needs to edit another's region asks that owner. The scalar
operators in `interpret.js` and the closed table have **JS/Python mirrors** (standing ruling 9):
only WS-B touches them.

| WS | name | size | depends on | census gain (whole sample, upper / firm) | owns (files / regions) |
|---|---|---|---|---|---|
| **0** | **Instrument**: commit the runtime-on census mode and a vendor-harness runtime-on mode (permission + allowlist override at module scope, because `runHarness` runs at collection time before `test-setup.js`'s `beforeEach`); tag runtime declines in the harness refusal; collect every refusal per pass; raise the peel cap; runtime walls into `coverage-map.json` | S | — | 0 (it is the scoreboard; it turns the "upper" column firm) | `engine/ast/coverageMapDoorCensus.measure.test.js`, `tools/pine_coverage/*`, `engine/__tests__/vendorHarness/vendorHarness.corpus.test.js` (env-gated mode only) and `ourSide.js` (the refusal line only) |
| **A** | **Statements and block values**: multi-statement value arms, `switch` statement, `var x = switch/if`, comma statements, orphan-`else` parse, `runtime.error` as a statement, v6 re-evaluated `for` bound (pin first), stale refusal sentences | L | 0 | **+39 / +5** | FE statement and block region (`:6200-7400`: `lowerSwitchInto`, if/for/while/switch statement lowering, block-value lowering); `runtime/lowerIr.js` control-flow section (`:540-720`); `runtime/ir.js` statement validators; FE `RUNTIME_REFUSALS` table (`:175-302`) |
| **B** | **Builtins over state, plus missing names** (with Phase 1): text, conversion and windowed builtins over mutable values; per-bar clock calls; `barstate.isnew` (shared with F: B owns the name, F owns the semantics); `ta.cci` role order; `ta.macd` arity; `ta.nvi/pvi`, `str.format/endswith`; `TVta.*` built-in library aliases; a declared-type coercion probe | L | 0; coordinate with Phase 1 (one owner of `closedTable.json`) | **+32 / +17** | FE builtin-state region (`builtinStateFamily` `:4070-4120`, call lowering `:4500-5030` except the `readGlobal` path, window lowering `:5240-5370` for builtin rows only); `runtime/vm.js` POINTWISE/TEXT/WINDOW/CARRIED opcode handlers (`:834-1070`); `runtime/text.js`; `ast/interpret.js` + `ast/closedTable.json` + their Python mirrors (`api/services/ast_interpret.py`, `ast_table.py`) |
| **C** | **History and series semantics**: per-call-site conditional `ta.*` and history (the correctness fix, P3), nested `(expr)[n]` hoist sinks, v6 series lengths and bounded dynamic offsets, UDF reads of a global's history, `max_bars_back` forms + declaration arg + overrun error (pin), Infinity laundering inside the bar | L | 0; the R4 ruling; captures `vw-fn-series-history` (taken) and `max_bars_back` (owed) | **+44 / +12** | FE history regions (`:1518-1563` conditional-history, `:3170-3200` hoist, `:3800-3840` history slots, `:4540-4552` `readGlobal`/function-global-state, `:4728-4750` expression history, `:5270-5290` dynamic window length, `:5900-5912` + `:7479-7486` `max_bars_back`); `runtime/vm.js` ring and `READ_HIST*` handlers (`:640-780`) and `EMIT` (`:1114-1170`); `runtime/limits.js` (comments only; budgets never raised) |
| **D** | **Input kinds**: `input.timeframe`, `input.time`, `input.session` as runtime values; inputs whose default reads state | M | 0 | **+16 / +3** | `runtime/runtimeInputs.js`; FE input-binding code (the `resolveInput` call sites in `buildRuntimeIrLinked`); `builder/memberPane/memberPaneDefinition.js` input-spec functions only (`runtimeInputSpecsOf` call path) |
| **E** | **Drawing and presentation from the run** (with Phase 2): `line/label/box.new` and getters in the run, `plotcandle`/`plotbar`, gradient `fill`, fill targets, per-bar `barcolor`, the `nothing-drawn`/`withheld-all` declines | L | 0; coordinate with Phase 2 (host object lane) | **+34 / +8** | `runtime/objectLane.js`, `objectStore.js`, `colours.js`, `records.js`, `handles.js`, `warmupDrawings.js`; `builder/memberPane/runtimeObjectsDoor.js`; `memberPaneDefinition.js` runtime presentation functions (`runtimeRowPresentation`, `runtimeRowColour`, `runtimePaintColour`, `:917-1056`) |
| **F** | **Realtime**: `varip` (needs a tick-granular bar feed), `barstate.isnew` semantics, a realtime capture of `var` rollback on a forming bar, checkpoint-resume cost (B5) | M | 0; a live-tick capture (owner session, market hours) | **+5 / +3** | `runtime/runtimeColumns.js` checkpoint/resume (`:430-760`); `runtime/vmState.js`; FE `varip` site (`:6716`); `ast/pineRuntimeClock.js` |
| **H** | **Safety and performance hardening** (arming prerequisites S2, S4, S8, B2, B4, B5) | M | — (independent of A to F) | 0 (arming) | `runtime/vm.js` `CONCAT` + `MEMORY` estimate only (`:724-740`, `:1325-1335`); `runtime/runtimeAsync.js`, `runtimeWorker.js`; a new telemetry endpoint (new router file) + `api/routers/user_definitions.py` `/shared` stamp line; `tools/runtime_pane_worker_probe.py`, `tools/runtime_pane_smoke.py` |
| **I** | **Rollout and grading machinery**: cohort stage (if R2), stage re-read on the kill-list read (S6), ledger rows (S7), allowlist evidence workflow, and the per-capability grading registry (if R1) | M (+ owner capture sessions) | R1, R2 | 0 directly; it turns attaches into served scripts | `api/services/runtime_definitions.py`, `api/services/rollout_gate.py`, `api/routers/auth.py` (payload key), `app/src/lib/runtimePanePermission.js`, `engine/runtimeKill.js`, `api/data/pine_runtime_allowlist.json`, `docs/feature_flags.json`, `tests/test_pine_runtime_switch_on.py` |
| **J** | **Routing dirty host attaches**: measure how many of the 63 host-attached-but-dirty scripts the runtime lane draws exactly; if positive, route them | S to M | 0, E | unmeasured (≤ 63) | `memberPaneDefinition.js` routing block (`:178-200`) and `engine/ast/paneGate.js` (`runtimeFallbackOf`) |
| (G) | `na` below v4: three scripts; pin each version's rule | S | captures | +2 sole | `runtime/lowerIr.js` `naTestsOf` (`:483-500`) + `ast/interpret.js` `naConditionIsFalse` (B's file: hand the edit to B) |

**Parallelism**:
- **Day 1:** WS-0, H and I in parallel. They share no files with A to F.
- **Once WS-0 lands:** A, B, C, D, E and F in parallel.
- **Collision hotspots and how to handle them:**
  - **B and C** both touch call lowering in the FE. C owns the `readGlobal`/function-global-state
    path (`:4540-4552`); B owns the rest of `:4500-5030`.
  - **C and E** both touch conditional history under `objectsInRun`. C owns the guard; E only
    consumes it.
  - **A and C** both touch block lowering. A owns statement shapes; C owns the hoist sinks
    (`:3170-3200`).
- **Order inside the phase is set by evidence:**
  - **B first** for firm gain.
  - **C first** for correctness, because of P3.
  - Run both from day one.

**Done means MATCH, not attach.** Each workstream closes when:
1. its scripts attach in the runtime-on census (WS-0); and
2. every capability it adds is witnessed by a capture or an existing pin (ruling 2); and
3. the runtime-on vendor harness shows no new DIVERGE (WS-0 rail); and
4. the differential rail is green.

Acceptance may read flat for several landings. Per C4 Phase 1, scripts carry walls in combination,
so judge each landing by its wall counts moving, not by the headline.

---

## 6. What this plan does not cover

- **Out of scope:** collections, `matrix`/`map`, `for…in` and overloaded methods (Phase 4);
  `request.*` and lower timeframes (Phase 5); `import` (Phase 6); strategy emulation (Phase 7).
- **Phase 4 depends on this lane:** the collections work lands on it.
- **Screener and alerts:** a scan or alert over a runtime document. Both refuse non-`ast` lanes
  today. The C4 Phase 2 decision names a Node sidecar for it; that is a later program.
- **The owner's capture sessions.** Every *(pin)* above needs one. The capture queue files in
  `docs/pine/capture-queue-*.md` are where a WS adds its probe.

---

## 7. How every number here was taken

- **Census, runtime pane on, every peel step** (test process; runs about 38 min; uses the heavy
  lock).
  - The temporary patch is the four edits described in 2.1. It was reverted and its sha256
    verified.
  - Command:

    ```sh
    COVERAGE_RUNTIME_ON=1 python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label phase3-runtime-census \
      --timeout 14400 -- python tools/pine_coverage/run_census.py --cache <copy of the sample manifest> --ref <empty ref>
    ```
  - Input: the coverage-map cache's `sample_manifest.json`, with paths pointing at the
    read-only cache. No examples. 679/679 rows.
  - WS-0 commits this mode properly.
- **Grouping and greedy ranking:** a script over `census.jsonl` plus `docs/pine/coverage-map.json`
  (for the `[imperative]` wall, order strategies and the `runtimeClean` predicate). The guard to
  group map is the table in 2.3. `runtime:call-*` on `security`/`request.*` is counted as X5.
- **Vendor harness, pane on:** `vendorHarness.corpus.test.js` over `../tests/fixtures/vendor/harness`,
  through the heavy lock.
  - The temporary patch (section 2.4) was reverted and its sha256 verified.
  - ⚠️ Env vars alone do NOT turn the pane on in this harness.
  - It is compared capture by capture with a pane-off run at the same HEAD.
- **Architecture and semantics:** read at `ab852b4880`. Line numbers are at that commit, and are
  unchanged at `b09a6bcee6`.
- **Baseline at `b09a6bcee6`:** the unmodified census (`run_census.py`, production flags, with
  examples) plus `coverage_map.py` over a fresh pane-off harness run. It gives 186/679 transfer
  and a 216 runtime counterfactual. The committed `coverage-map.json` (185/215) predates
  #539-#542.
