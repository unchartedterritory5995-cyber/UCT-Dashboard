# PA5: the dark Pine runtime VM, and running the security suite on Linux

**Audit only.** No runtime code, tests, config or flags were changed, and nothing was committed. Worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`. HEAD is `aac74481b1` (the audit docs) on top of `4a368e80ed` (= production). Scratch probes are in `app/src/__audit_scratch__/phaseA-5/` and are not committed:

- `supertrendRuntime.measure.test.js`: runtime performance;
- `test_pa5_deep_tree_save.py`: depth sensitivity of the save path;
- `pa5_version_shim.py`: a re-run of the stale-fixture rails.

Production was not read. No workflow was triggered. Timings were taken on a shared, loaded CPU, so read them as **ratios**.

---

## Part 1. The stateful Pine execution engine (runtime VM)

### 1.1 Decision history

| Date | Decision | Source |
|---|---|---|
| 2026-09-18 | **One authoritative Pine runtime, in JS.** It runs natively in the browser for charts, and through a long-lived **Node sidecar** owned by the Python backend for the screener. `ast_interpret.py` is "NOT retired and NOT extended".<br>Rejected options: two implementations (Python dispatch is 33× slower than Node, so a whole-market scan would take 84 s); WASM (it would add a toolchain, and "a major new production/deployment architecture" is a stop condition); and a Python-authoritative backend round-trip. | `docs/superpowers/specs/universal-indicator-ecosystem/PHASE2_RUNTIME_ARCHITECTURE.md` §1–§3 (first commit `e855f62cdb`, #145) |
| 2026-09-11 / 09-12 | **Ruling 3.3:** the IR lane must refuse rather than blank (four `barstate.*` columns would have rendered blank). Recommendation A: "build the producer first… never a blank". | `docs/pine/DECISIONS-2026-09-11.md:120-170`; cited as "RULING 3.3 (owner, 2026-09-12)" at `engine/ast/pineRuntimeFrontend.js:276-284` |
| 2026-09-15 | **Ruling D2:** a pane acts on the **host lane's** saved definition (`PANE_LANE = 'host'`). The IR lane being off the pane path is "the consequence, not the ruling". Corrected in place on 2026-09-15, because the precondition it had named (the text layer) had already been met. | `engine/ast/paneGate.js:1-48`; `docs/pine/PR-BODY.md:242` |
| 2026-09-28 | **Owner principle (PR #241):** "our chart draws exactly what TradingView draws… what the columnar lane cannot represent routes to the runtime lane". Built **dark** behind a new build flag, `VITE_PINE_RUNTIME_PANE_ENABLED`, and nothing was armed. | commit `bb72f13054` message; `docs/feature_flags.json:2968-2977` (`owner_decision: "not yet taken"`) |
| 2026-10-01 | **R-B:** a raise of `INSTRUCTIONS_PER_BAR` to 250,000 was measured and **not** taken. Standing ruling: "Budgets are never raised". | `runtime/limits.js:97-99`; `docs/pine/SESSION-STATE.md` "Standing rulings" §1 |
| 2026-10-02 | **Rulings D1–D6 (owner), built by GT:**<br>D1: admins first, then everyone, with the kill list as the safety net (`PINE_RUNTIME_STAGE`, default `off`).<br>D2: the runtime document cap is 128 KiB.<br>D3: keep the 1,000 ms budget.<br>D4: keep disclosing omitted bar colours.<br>D5: keep the 20,000-bar intraday limit (later revisited).<br>D6: a starter allowlist holding only `adx-and-di-for-v4`, "extended one line at a time as captures grade MATCH". | `docs/pine/runtime-pane-switch-on-plan.md:140-147`; commits `40c82dc9ec`, `50e7b8b76c` |
| 2026-10-02 | Ledger: `PINE_RUNTIME_SAVE_ENABLED` and `PINE_RUNTIME_STAGE` are both `dark`, with `owner_decision`: "…the flip itself is not yet taken". | `docs/feature_flags.json:2397-2415` |
| 2026-10-11 | UIE Phase 3: the owner authorised revisiting D5, and `HISTORY` was raised to 32,768 on measurement. "Past 32,768 needs the owner again." | `runtime/limits.js:151-165` |
| 2026-10-11 | Phase 6 ledger:<br>• the runtime pane is "**OFF** (unset)" in production;<br>• runtime alerts, scans and other-timeframe reads are "refused by design (named)";<br>• heavy scripts under the first-load budget are "⛔ blocked — owner decision (compile-to-JS is an architecture change)". | `docs/indicators/PHASE6-ENGINE-LEDGER-2026-10-11.md:26,40-41` |
| 2026-10-12 | "UCT Agent stays admin-only; **advanced Pine stays off**; no flag changes." | `docs/agent/AGENT-INDICATORS-ENTRY-2026-10-12.md:4` |
| 2026-10-13 | This audit: "Owner instruction: keep it disabled; this audit does not change that." | `03-GAP-ANALYSIS.md:250`; `04-RECOMMENDED-ROADMAP.md:145` |

⚠️ The exact owner sentence "Keep advanced Pine disabled in production" reached me through the brief. I did not find it verbatim in the repo. The repo records it as the paraphrases above, dated 10-11, 10-12 and 10-13.

**Why it is dark: four reasons, in the order they were recorded.**

1. **D2.** A member pane draws the host lane's saved definition. The runtime was off the pane path until the IR lowering programme landed. The route exists since `bb72f13054`, but only behind a flag.
2. **Fidelity.** The rule is "an unwitnessed semantic is never served". Only scripts graded **MATCH** against a TradingView capture may draw (D6), and one script is graded.
3. **The server cannot run it.** Alerts, scans and the store's evaluation are AST-only. The Node sidecar the architecture called for was never built: there is no runtime sidecar anywhere in `api/`.
4. **Owner gate.** Every flip is the owner's, and none has been taken.

### 1.2 Technical rationale: what the runtime does that the host (AST) lane cannot

The host lane is a **closed, pure, columnar expression grammar**. Each node computes a whole column from its children's columns. It has no assignment after use, no persistence, and no ordering dependence. It is bounded by the 128-node budget and a static `maxLookback` (`api/services/ast_budget.py:110-140`, mirrored in JS).

The architecture states the rule: a subprogram takes the graph lane only when it is **provably pure and total**, and "anything merely unproven takes the runtime" (`PHASE2_RUNTIME_ARCHITECTURE.md` §3).

Why `var`, loops, arrays, UDTs and `switch` cannot become one expression tree:

- **`var` with true state.** Supertrend's `up := close[1] > prevUp ? max(basicUp, prevUp) : basicUp` makes bar *t* depend on its own value at *t−1* through a nonlinear branch. That is unbounded memory, and no finite composition of window operations reproduces it. The host lane has `accum(seed, …, 250)` only for state that **forgets its seed** (accepted only when the residual is ≤ 2e-13, per the WS5 matrix). It refuses true state with `pine:state`.
- **Loops with data-dependent bounds, `break` and `continue`.** These are control flow over iterations, not a dataflow DAG. The host has only plan-time unrolled loops.
- **Arrays and UDTs mutated across bars.** These are heap state with aliasing (`array.get` is a copy, a record is a reference). A pure column cannot hold an object reference or answer `na(someLine)`. The architecture's value model is tagged for that reason (§4: `na` is a tag, not NaN).
- **`switch` / `if` as mutating statements.** These are statement order, not value order.

The VM gives each of these a slot-resolved IR (`runtime/ir.js`), lowered by `runtime/lower.js` / `lowerIr.js` and run bar by bar by `runtime/vm.js`. `var` initialises once **structurally**: `JUMP_IF_INIT` jumps over the initialiser (`PHASE2_RUNTIME_ARCHITECTURE.md` §9).

**What the runtime does not support** (WS5 construct matrix, `WS5-pine-migration.md:100-140`, and the refusal catalogue in `engine/ast/pineRuntimeFrontend.js:250-300`):

- `varip`: `runtime:varip`, "intrabar persistence, which a closed-bar runtime cannot reproduce" (`:261`).
- `for … in`: not on master. It sits on the gated wave-10 branch only (`SESSION-STATE.md`, wave 10 row, C40).
- `map` / `matrix`: refused by name at the constructor (`:2298-2306`).
- `method` on a UDT: `runtime:udt-method` (`:273`).
- Library `import`: `runtime:library` (`:298`), 33 of 266 corpus scripts.
- `request.*` of other bars on the pane path: `runtime:request` (`runtime/runtimeColumns.js:691-692`, `:919-920`).
- `strategy()`.
- `runtime:switch` is still thrown in one nested walker (`:6851`), with the stale message "no multi-way branch yet" (`:260`). At the same time WS5 measured `switch` as running in the runtime (D). The nested case is not characterised here.

### 1.3 Security model

**Execution model.** The VM is purely **interpretive**:

- Pine is lexed and parsed by `pineRuntimeFrontend.js`, lowered to IR, and dispatched by `vm.js`.
- A grep of `runtime/*.js`, `pineRuntimeFrontend.js`, `runtimeKill.js` and `runtimePaneGate.js` finds **no `eval`, no `new Function` and no `importScripts`**. The only `postMessage` calls are the worker protocol (`runtimeAsync.js:185`, `runtimeWorker.js:25-28`).
- "Compile-to-JS", which would have been a codegen path, is explicitly **owner-blocked** (Phase 6 ledger :41).
- `str.replace_all` uses `replaceAll` with a string needle, so no user-controlled regex is involved (`runtime/text.js:39`).

**Isolation and what a script can reach.**

- The run executes in a **module Web Worker** (`runtimeAsync.js:242`). It has no DOM. It is same-origin, so the worker *could* `fetch`, but the interpreted program has no instruction that reaches `fetch`, the DOM or storage.
- Inputs cross as plain data only (`runtimeAsync.js:152-173`): the bars `{t, o, h, l, c, v}`, the compute block, two meta facts, and the context (tf, forming flag, listing flag, the member's input values, ticker/exchange).
- **Other symbols:** a document whose IR keeps a request of other bars is refused on the pane path (`runtime:request`). Only requests the lowering folds onto the chart's own bars run. `REQUEST_COUNT` (16) and `REQUEST_FANOUT` (64) bound the sub-runs.
- **Network:** none.
- Without `Worker` (tests, non-browser hosts), the run is synchronous on the calling thread under the same budget (`runtimeAsync.js:73-81`, `:128-132`). A dead or hung worker is never re-run on the main thread (`:105-120`).

**The 24 named limits** (`runtime/limits.js:29-76`; defaults `:83-200`):

| Limit | Default | Limit | Default |
|---|---|---|---|
| `PROGRAM_SIZE` | 512 KiB source | `HISTORY` | 32,768 bars |
| `IR_SIZE` | 200,000 | `HISTORY_SLOTS` | 512 |
| `INSTRUCTIONS_PER_BAR` | 200,000 | `HISTORY_VALUES` | 262,144 |
| `TOTAL_INSTRUCTIONS` | 200,000,000 | `WINDOW_CELLS` | 100,000,000 |
| `LOOP_ITERATIONS` | 5,000,000 | `CARRIED_INSTANCES` | 4,096 |
| `WHILE_ITERATIONS` | 10,000 | `CARRIED_CELLS` | 65,536 |
| `LOOP_NESTING` | 8 | `CARRIED_STEPS` | 100,000,000 |
| `CALL_DEPTH` | 64 | `REQUEST_COUNT` | 16 |
| `CALL_COUNT` | 5,000,000 | `REQUEST_FANOUT` | 64 |
| `ARRAY_ELEMENTS` | 100,000 | `MEMORY` | 64 MiB (an *estimate*) |
| `ARRAY_OPERATIONS` | 2,000,000 | `WALL_TIME` | 5,000 ms |
| `LIVE_OBJECTS` | 2,055 | `OBJECT_OPERATIONS` | 2,000,000 |

- Each limit raises `RuntimeLimitError(limit, ceiling, reached)` (`:210-218`).
- `runtimeHardeningP1.test.js` asserts that every name in `LIMIT_NAMES` is counted somewhere. Six limits were declared-but-uncounted until P1 hardening on 2026-10-11 (`:84-88`).
- `runtimeLimitsAcceptance.test.js` gives every limit a script that trips it.
- On top of the 24 limits:
  - a **1,000 ms pane budget** (`runtimeColumns.js:198`), shared by the two warm-up-curtain runs (`:495-505`);
  - a **20 s worker watchdog** with **3 worker starts per tab** (`runtimeAsync.js:39`, `:44`, `:94-120`);
  - **12 sessions or 64 MiB** for incremental checkpoints (`runtimeColumns.js:553`, `:558`).

**Known gap (WS8 G7/S14), re-measured.** `MEMORY` is sized from the run's own numeric allocations, plus 16 B per array element and 512 B per drawing (`vm.js:473-481`, `:1329-1330`). **String length is charged nowhere.**

- The WS8 probe (`var string s = "x"; s := s + s`) still stops at **bar 28 of 200** with `runtime:failed (Invalid string length)`: V8's own maximum string length, not a named limit. It took 14 ms (re-run today).
- Mitigation by construction: V8 builds concatenations as cons-strings (ropes), so the doubling itself is cheap. But any operation that flattens a large string (`str.contains`, `replace_all`, a label text) would materialise up to roughly 2^28–2^29 characters inside the worker before failing.
- An array of large strings is charged 16 B per element regardless of string length.
- The stop is still named (`runtime:failed`) and contained to the worker, but it is not a `RuntimeLimitError` and it is not in the 24.

**Client-side gates** are user-experience gates, not security boundaries:

- `runtimePaneEnabled()` = the build flag **and** a per-tab latched server permission (`engine/runtimePaneGate.js:50-71`).
- The allowlist latch fails closed: nothing latched means nothing graded (`engine/runtimeKill.js:56-70`).
- A member who tampers with their own browser can run the VM there, but only on their own data and only in their own tab. The boundary that matters is the server's.

**Server gates.**

- `_save_runtime` (`api/services/user_definitions.py:2118-2170`) applies five refusals, in order:
  1. `PINE_RUNTIME_SAVE_ENABLED == "1"` (`runtime_definitions.py:123-125`);
  2. `save_permission(role)` against `PINE_RUNTIME_STAGE`; a missing role reads as a member, and an unrecognised stage reads as `off` (`:139-159`, `:209-221`);
  3. the kill list, by `u_` id or sha256 / a ≥12-hex prefix (`:128-136`, `:230-243`);
  4. the starter allowlist, sha256 only, as the union of the committed JSON and the env var, failing closed on an unreadable file (`:171-206`);
  5. `validate()`: source required, `meta.runtimeLanguage` must be Pine, the repaint class re-derived server-side by `runtime_repaint.py` and checked both ways, no AST-only keys (`:246-314`).
- After those: the **128 KiB** cap (`:2163-2168`), the repaint admission identical to the formula lane (`_admit_runtime`, `:2081-2115`), and a refusal to save a runtime document over a live formula id (`:2181-2190`).
- Stored rows that are not listed are **served stamped** (`meta.runtimeKilled` / `meta.runtimeNotGraded`). They are never deleted (`stamp_served`, `:331-356`).
- The role comes from the server's `user["role"]` (`routers/user_definitions.py:349`, `:594`).
- Share-install re-runs the full save, so a shared runtime document meets the same five gates.
- `GET /api/user-definitions/runtime-kill` needs `require_paid` (`routers/user_definitions.py:523-537`).
- `PINE_RUNTIME_KILL_LIST` and `PINE_RUNTIME_ALLOWLIST` have **no entries of their own** in `docs/feature_flags.json`. They are only mentioned inside other entries' notes. This is a ledger-completeness nit.

**Does the server ever execute a runtime document? No. It only stores, validates and statically classifies one.**

- `runtime_repaint.py` is a rule-table and regex classifier over source text, with no execution (imports at `:15-22`).
- Alerts refuse the lane: `_gate_lane` requires `compute.kind == "ast"` (`api/services/alert_user_series.py:790-799`).
- Scans refuse it: `ScanRefused("kind", …)` (`api/services/scan_definition.py:488-493`).
- The store's own docstring says so: "there is no tree to hash, lint, scan or evaluate for an alert" (`runtime_definitions.py:1-8`).
- Member consequence: a runtime indicator would **draw only in the member's own open browser tab**. It cannot raise an alert, appear in a screen, be computed for a watchlist column, or run on another timeframe. The flag note discloses this ("cannot be saved, alerted on or screened"). The architecture's planned fix, the Node sidecar, remains unbuilt. Its lifecycle was an open item (§8: "a screener cannot [degrade gracefully], so this needs a real answer").

### 1.4 Performance

**Design.**

- Off the main thread, in one shared module worker per tab.
- The browser probe of 2026-10-02 measured the worst main-thread frame gap at **17 ms**, against a 400 ms control block.
- The worker bundle is **1.30 MB / 381 KB gzip**, fetched only when a runtime pane computes (`runtime-pane-switch-on-plan.md:41-46`).
- Jobs are **FIFO per worker and coalesced per pane** (`runtimeAsync.js:194-227`). A layout of many charts with runtime panes therefore **serialises**: the last pane waits for every pane ahead of it.
- **Checkpoint/resume** (`runtimeColumns.js:530-620`): a session keeps the bars, the program, and a VM checkpoint at the last **confirmed** bar. Resume happens only when bars `[0, cp]` are bit-identical, the program is the same, and every precomputed column is the same up to `cp`. A forming bar is never checkpointed.

**Measured: one script, a hand-written Supertrend** (`var` ×3, if/else, `ta.atr`). The probe is `phaseA-5/supertrendRuntime.measure.test.js`. It runs `computeRuntimeColumns` directly under vitest/jsdom on Node, not in a browser worker, on a **shared, loaded CPU**, so ratios are what count.

| 5,000 synthetic daily bars | Run 1 | Run 2 |
|---|---|---|
| Cold, full run (median of 5) | 10.6 ms | 11.1 ms (7.0 ms in the scaling pass) |
| Resume after a **1-bar append** | 5.6 ms | 5.6 ms (4.7 ms) |
| Tick on the forming bar | 5.1 ms | 5.6 ms |
| Cold ÷ append / cold ÷ tick | **1.9× / 2.1×** | 2.0× / 2.0× |
| Resumed (append / tick) | 5/5, 5/5 | 5/5, 5/5 |
| Resumed result equal to a full run | bit for bit (`Object.is`, every bar) | yes |
| Supertrend ÷ a two-`ta.sma` runtime baseline | 1.31× | 1.32× |
| Off-listing warm-up curtain (two runs) ÷ cold | 1.33× (453 bars withheld) | 1.48× |
| Cost per bar, cold | ≈ 2.1–2.2 µs | |
| Session estimate | 0.6 MB | |

| Bars | 50 | 5,000 | 32,000 |
|---|---|---|---|
| Cold | 0.9 ms (≈ fixed compile cost) | 7.0 ms | 40.4 ms |
| Append | 0.9 ms | 4.7 ms | 30.0 ms |
| Session bytes (estimate) | 6 KB | 0.6 MB | 3.8 MB |

**Reading.**

- For a **cheap** stateful script, resume saves only the VM loop: about 1.3–2×.
- The front-end compile, the precomputed columns and the **O(n) bit-for-bit row and column comparison** (`sameRowsTo` / `sameColumnsTo`, `runtimeColumns.js:578-600`) still scale with bars.
- For **loop-heavy** scripts the gain is larger. Commit `9e0942f42a` recorded these tick medians on 8,000 RDDT 5m bars: nadaraya 10 ms vs 140 ms full, wyckoff 31 vs 234, atr-stepped 13 vs 154.
- The heavy end is what binds:
  - `delta-rsi-oscillator-strategy` stops `runtime:time-budget` on **all six** ledger charts (`docs/pine/uie-compatibility-ledger-2026-10-11.md:88`), and ≈ 4 s per 10k bars per the Phase 6 ledger;
  - `fibonacci-dolphintradebot` sits at the 1,000 ms edge.

**Memory and many charts.**

- Sessions are bounded at 12 or 64 MiB per worker, and one session is 3–32 MB at 20k bars for corpus scripts (`runtimeColumns.js:554-558`).
- The `MEMORY` limit is an estimate. JavaScript exposes no per-run heap figure (`limits.js:187-194`).
- Worst case per tab: one worker holding up to about 64 MiB of sessions, plus the live run (≤ 64 MiB estimated, strings uncounted), plus the bundle.
- Not measured here: a real multi-chart browser layout, and mobile devices.
- The architecture's §7 pod/performance gates (single chart < 50 ms at 5,000 bars for a composite program; whole-market scan < 10 s) were **never measured on the pod**. The scan gate is moot without the sidecar.

### 1.5 Implementation status

**Code**

- Language: `var`/`:=`, if/else, `for`/`while`/`break`/`continue`, user functions (per-call-site state), tuples, typed arrays, UDT records, strings and the `str.*` subset, colours, drawings (labels, lines, boxes, tables, linefills) with the Pine collector, and the `barstate`/clock reads.
- Behaviour around the run: the warm-up curtain (R-W), incremental resume, source edit as a revision, and the server repaint classifier.
- See `docs/pine/SESSION-STATE.md` waves 3–9, and `PHASE6-ENGINE-LEDGER-2026-10-11.md:39`, which marks the runtime "✅ complete, **dark**".

**Tests**

- `engine/runtime/__tests__/`: **118 files** (6 `.measure`), about 1,266 `it`/`test` call sites. Commit `9e0942f42a` reports 1,482 tests passing, which includes `.each` expansions.
- Further runtime-related files: 8 in `engine/__tests__/` (`runtimeKillSwitch`, `runtimeSwitchOn`, `runtimeErrorNotice`, `pineRuntimeFrontendGate`, `graphRuntime`, `objectRuntime*`) and about 10 in `engine/ast/` (`runtimePaneRoute.vendor`, `pineRuntime*`, `runtimeFrontendCoverage`, …).
- Python: 60 tests across `test_runtime_definitions.py` (16), `test_runtime_document_round_trip.py` (8), `test_pine_runtime_switch_on.py` (24), `test_runtime_repaint.py` (5) and `test_runtime_pane_smoke.py` (7), plus `test_auth_surface_runtime.py`.

**Run today, on Windows:**

- vitest, 18 representative files: **278/278 pass**. The files were:
  - from `engine/runtime/__tests__/`: `runtimeHardeningP1`, `runtimeLimitsAcceptance`, `runtimePaneSafety`, `runtimeIncremental`, `runtimeAsync`, `sourceToRuntime`, `state`, `loops`, `udtRecords`, `arrays`, `switchArmGuards`, `runtimeRealtimeAcceptance`, `graphRuntimeDifferential`, `runtimeWorkerWarmup`;
  - from `engine/__tests__/`: `runtimeKillSwitch`, `runtimeSwitchOn`, `runtimeErrorNotice`;
  - from `engine/ast/`: `runtimePaneRoute.vendor`.
- pytest: `test_runtime_definitions` + `test_runtime_document_round_trip` + `test_pine_runtime_switch_on` give **73 passed**. `test_runtime_repaint` + `test_runtime_pane_smoke` give **24 passed**.

**Grading**

- The allowlist (`api/data/pine_runtime_allowlist.json`) holds exactly one entry: `adx-and-di-for-v4`, sha256 `d0853c47…0499`, evidence "MATCH, capture adx-and-di-for-v4-rddt-1d-2026-09-27".
- The UIE ledger (2026-10-11) routes **16** of 266 corpus scripts to the runtime:
  - 7 are math-verified: adx-and-di, deadband-hysteresis, delta-rsi, fibonacci-dolphintradebot, inside-bar-range, kalman-price-filter, parabolic-sar;
  - 5 are partly verified, 2 drawings-verified, 2 executed-not-graded;
  - 96 of 96 save/reload round trips are identical.
- So six more scripts have at least one MATCH capture but are **not** on the allowlist. Some also have caveats: delta-rsi is 0/4 on SPY and hits the time budget everywhere, and fibonacci hits `interpret:bind-time-text` on two charts.

**What the switch-on plan says remains** (`runtime-pane-switch-on-plan.md`):

- P11, a full-suite gate on the landing tree: **NOT MET** (`:62`).
- `tools/runtime_pane_smoke.py` has never been run against production (`:116-117`).
- Every flip in the GT operator steps (`:199-215`) is the owner's, and none has been taken.
- The byte-identity rate of member pastes against graded corpus sources is "**not measured**" (`:223-225`). A CRLF or trailing-newline difference is a different sha256, and it declines.

### 1.6 Gated checklist for enabling it safely, eventually

⛔ No flag was changed. "Met" means met today, on evidence.

| # | Gate | Met today? | Evidence and what is missing |
|---|---|---|---|
| E1 | **Security suite green on Linux** (§2.4 suite) | **NO** | The Python files run on Linux in `full-suite-report.yml`, but that job is report-only. On master `caf67367b5` (3 commits behind production; run 38334654786), the 2 Windows-only census failures **pass**. But **69 tests in the suite's own files are red there too**:<br>• `test_compute_graph` 31;<br>• `test_param_manifest` 25 (the anti-forgery rails);<br>• `test_param_repaste_c46` 11;<br>• `test_graph_wire_size::test_the_bomb_is_still_refused_on_the_write_path` 1;<br>• `test_user_definitions_auth` 1 (a duplicate refusal sentence).<br>68 of the 69 fail on the 10-08 `definition.version` gate (`4b9796e968`) firing before the rail's own claim. With a scratch shim that injects `version: 1`, **80 of 81** pass (the one exception, `test_a_v1_document_is_untouched`, is an artefact of the shim). So the protections hold, but the rails do not currently exercise them. Separately, the **vitest** job has recorded **0 collected** in the last **99** published runs (last record: 37123227661, 2026-10-03). The JS half has no Linux evidence for 10 days. |
| E2 | **String/heap accounting** | **NO** | WS8 G7 is unchanged: strings are not charged to `MEMORY`, and runaway growth stops on V8's `Invalid string length` at bar 28. Needed: a named `STRING_LENGTH` limit, or charge string bytes to `MEMORY` at assignment, concat and array push. |
| E3 | **Grading captures per promoted script** | **PARTIAL** | The mechanism is met. The allowlist is by source sha256, the server and client fail closed, and P9 is "met by construction". One script is graded. Six more have MATCH captures and need an explicit owner grading call. Pastes that are not byte-identical are unmeasured, so a normalisation rule may be needed. New captures need the owner's TradingView account. |
| E4 | **Verdict-honesty contract (one shared verdict system)** | **NO** | Audit P0-7 (`03-GAP-ANALYSIS.md:167-179`): the paste box computes its verdict from the lenient lane, while the chart uses the strict lane plus the runtime fallback. A runtime decline shows the host's sentence. Needed: one verdict, from the lane that will draw, used by the box, the chart, the save and the Agent. |
| E5 | **Alerts/scans story** | **NO** (decided by design, not solved) | The server never executes runtime documents (`alert_user_series.py:790-799`, `scan_definition.py:488-493`), and the sidecar was never built. The owner needs to choose:<br>(a) chart-only, with explicit disclosure on every surface that would offer an alert or scan;<br>(b) build the sidecar (the architecture's plan, with its lifecycle open);<br>(c) client-side alerts, which are not equivalent to the server alerts members have today. |
| E6 | **Staged rollout: admins → cohort → members** | **PARTIAL** | `PINE_RUNTIME_STAGE` off/admins/all, read per request and latched per tab, is built and tested (`test_pine_runtime_switch_on.py`, `runtimeSwitchOn.test.js`). There is **no cohort middle stage**. GT built a stage, not the plan's cohort gate (`:64-91`), so admins jumps straight to all. `rollout_gate.py` cohorts exist and could be wired. |
| E7 | **Kill-switch drill** | **NO** | The mechanism is met in tests (P7): a kill reaches a member on the next definitions read, never mid-session, and deletes nothing. It has **never been drilled** end to end on a real deploy, and `tools/runtime_pane_smoke.py` has never run against production. |
| E8 | **Performance budget** | **PARTIAL** | Met: the 1,000 ms pane budget, worker isolation (17 ms worst gap), and incremental resume (equal bit for bit).<br>Not met:<br>• heavy scripts stop on the time budget (delta-rsi on all six charts);<br>• no multi-chart or layout budget exists, though the worker serialises panes;<br>• the §7 pod gates were never run;<br>• no low-end or mobile device was measured. |
| E9 | **Rollback** | **PARTIAL** | Designed and documented (`:119-127`, `:227-236`). Stage off, the kill list, the allowlist and save-off need no code deploy. The whole pane needs a rebuild. Nothing deletes saved rows. Never exercised. An open tab keeps its latched answer and bundle until reload. |
| E10 | (plan P11) Full suite on the landing tree | **NO** | `runtime-pane-switch-on-plan.md:62`. E1 subsumes it. |

**Verdict: 0 of the 9 requested gates (E1–E9) are fully met. 4 are partial (E3, E6, E8, E9) and 5 are unmet (E1, E2, E4, E5, E7).** The engine is far ahead of its release envelope. The gaps are honesty, the server story, and operations, not interpreter safety.

---

## Part 2. The Windows-only sandbox test limitation (WS8 G4)

### 2.1 Reproduction and root cause

On this box (CPython **3.12.10**, MSC v.1943, 64-bit, Windows 11 10.0.26200), `pytest tests/test_ast_interpret.py tests/test_ast_conformance.py` gives **160 passed, 2 failed, 5 skipped** (the 5 skips are superseded-rail skips). The two failures:

1. `tests/test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE_and_the_reconciliation_says_so`
2. `tests/test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT`

Both fail with `RecursionError: maximum recursion depth exceeded while encoding a JSON object`. The stack is:

```
escape_census (tools/ast_conformance.py:1451)
  → _guarded_outcomes (:1379)
  → run_js_escapes (:965)
  → _node_run (:868)
  → subprocess.run(..., input=json.dumps(payload))
```

The payload carries the **nested** JSEP trees from `tests/fixtures/ast/escapes.json`, including the 4,000-deep `too_many_nodes` case.

**Why Windows differs.**

- In CPython 3.12, the C JSON encoder guards each container with `Py_EnterRecursiveCall`, which now counts against a separate **C recursion budget** (`Py_C_RECURSION_LIMIT`).
- That constant is compiled in, and it is **lower on Windows builds** because the default Windows main-thread stack is 1 MB, against 8 MB on Linux.
- Measured here: nested dicts encode at depth **2,990** and fail at **3,000**, and `json.loads` fails at the same depth.
- `sys.setrecursionlimit(100000)` does **not** help (measured), and neither does a 64 MB `threading.stack_size` (measured). It is a counter, not the real stack.
- On Linux the 3.12 constant is far higher. I did not measure it here. That CI on `ubuntu-latest` passes both tests (run 38334654786, `pytest-shard-tests-01`) proves it is above 4,000.
- The harness already knew this. Its comment at `tools/ast_conformance.py:704-718` says "Python cannot receive it nested either — `json.loads` recurses in C… not raisable from `setrecursionlimit`", and it flattened the **return** path. The **outbound** payload was never flattened.
- Fix (not done): send each case's tree in the same flat post-order form, or drop the deep case from the outbound payload and build it in the driver. Size S.

### 2.2 Is the PRODUCT path depth-sensitive? Yes, but not because of Windows

- **Request parse.** FastAPI 0.115.6 / Starlette run `json.loads` (C-recursive) on the body.
  - In production (Linux) the C limit is high.
  - FastAPI wraps body-parse exceptions as **400**.
  - Pydantic 2.12.5 accepted a 3,500-deep `definition` dict in-process.
- **`assert_canonical` is iterative** (`api/services/user_definitions.py:401-444`). So are `ast_interpret.node_count` / `flat_node_count` (`ast_interpret.py:4016-4060`). The budget measurement survives an 8,001-node tree, as WS8 S12 says.
- **But the save path hashes before it budgets.**
  - `save()` calls `ast_hash()` at `user_definitions.py:1720`, which runs `stable_stringify()` (`:447`). That function is **Python-recursive**: about 3 Python frames per tree level against the default recursion limit of 1,000, so this part does not depend on the C limit or the platform.
  - The 128-node budget refusal is `_admit_new_maths` at `:1792`, *after* the hash.
  - `_save_or_400` catches only `SaveConflict`, `SaveRefused` and `ValueError` (`api/routers/user_definitions.py:196-216`). There is no global handler (`api/main.py:9287` registers only the rate-limit handler).
- **Measured** on a temp DB (`phaseA-5/test_pa5_deep_tree_save.py`):

  | Input | Result |
  |---|---|
  | v1 tree, depth 100 / 200 | named `ValueError` (400) |
  | v1 tree, depth 300 / 1,000 | **`RecursionError` escapes `_save_or_400`, so HTTP 500** |
  | shared-graph chain, length 600 (passes the 2,048-node expansion cap) | `RecursionError` |
  | shared-graph chain, length 2,000 | named "expands to 4001 nodes" refusal |

- **Severity: P3.** It fails closed: nothing is stored, the body is about 20–70 KB, and no state changes. But it is a 500 instead of a named `budget:nodes` refusal, and it applies on Linux equally.
- **Amend WS8 S12** ("none found") to record it.
- Fix (not done): an iterative `stable_stringify`, or a depth or node check before `ast_hash`. Do **not** catch the `RecursionError`: `test_ast_budget.py` forbids exactly that pattern in the budget module, for good reasons.

### 2.3 Linux options

| Option | Status | Notes |
|---|---|---|
| Existing **`full-suite-report.yml`** | exists | `ubuntu-latest`, `actions/setup-python` with **3.12** (the patch level is not printed in the published log), Node 20, `npm ci`.<br>Runs **every** pytest file in about 20 shards. **Report-only** (`continue-on-error: true`) to the `ci-results` branch on push to master and PRs, and on `workflow_dispatch`.<br>It **does** run the census tests (they pass there).<br>Its vitest job has published **no results for 99 runs** (since 2026-10-03).<br>It uses the GitHub image, not the production base image. |
| `master-deploy-gate.yml` | exists | `ubuntu-latest`, Python 3.12.<br>Runs only `test_no_shadowed_definitions`, `test_dockerfile_vite_build_args`, `test_vite_flag_ledger`, `test_visibility_flag_ledger`, the discord goldens and the UCT Agent suites (`:286-352`).<br>**No** escape census, budget, runtime or auth rails. |
| `ocr-linux-cert.yml` | exists, precedent | `workflow_dispatch` (+ path push), runs **inside `python:3.12-slim-bookworm`**, "the SAME base `Dockerfile.web`'s runtime stage uses" (`:16`).<br>This is the template for a production-matching job. |
| New `workflow_dispatch` "security suite (Linux, prod base)" | not built | Recommended (below). |
| Local Docker | **not available** | `docker` is not installed (checked read-only). |
| WSL | **not available** | "The Windows Subsystem for Linux is not installed" (checked read-only).<br>The owner already ruled "do NOT install WSL or Docker just for this" for OCR (`ocr-linux-cert.yml:9-14`). |

**The production Python version.**

- `web` builds from `Dockerfile.web` (`railway.web.json`) on **`python:3.12-slim-bookworm`** for both `pydeps` and `runtime` (`Dockerfile.web:156`, `:173`). That is a floating 3.12 patch, with Node pinned at `20.18.0` (`:52`).
- The last recorded inventory, of the earlier nixpacks image, said "python 3.12.7… node v20.18.0" (`:40`, measured 2026-09-08).
- `nixpacks.toml` and `railway.json` (other services) also pin Python 3.12.
- I did not read the current exact patch, because production access is forbidden.

### 2.4 The security suite: definition, command and expected baseline

**Python (26 files):**

| Area | Files |
|---|---|
| Escape census / sandbox | `test_ast_interpret.py`, `test_ast_conformance.py`, `test_ast_conformance_no_conftest_in_server.py`, `test_refusal_not_laundered.py` |
| Budget | `test_ast_budget.py`, `test_ast_c19_shared_budget.py` |
| Graph bomb / wire | `test_compute_graph.py`, `test_graph_wire_size.py` |
| Param-manifest anti-forgery | `test_param_manifest.py`, `test_param_repaste_c46.py` |
| Auth per route | `test_user_definitions_auth.py`, `test_exposed_routes_gated.py`, `test_auth_surface_runtime.py`, `test_entitlements.py` |
| Share tokens | `test_definition_sharing.py`, `test_share_publish_authorization.py` |
| Colour/XSS rails | `test_definition_colour_trust.py`, `test_object_colour_trust.py` |
| Runtime save gates / switch-on | `test_runtime_definitions.py`, `test_runtime_document_round_trip.py`, `test_pine_runtime_switch_on.py`, `test_runtime_repaint.py`, `test_runtime_pane_smoke.py` |
| Flag ledgers / build args | `test_feature_flag_ledger.py`, `test_dockerfile_vite_build_args.py`, `test_vite_flag_ledger.py` |

**Vitest (18 files):**

| Area | Files |
|---|---|
| Budget, canonical tree, sandbox | `engine/ast/{budget,parse.deepTree,interpret,parse,closedTable,stringEscapes,sharedBudget,paramIds}.test.js` |
| Colour, DOM and XSS sinks | `engine/__tests__/{objectColour,objectTableDom}.test.js`, `engine/__tests__/presentationColourSinks.test.jsx` |
| Runtime limits, watchdog, isolation | `engine/runtime/__tests__/{runtimeHardeningP1,runtimeLimitsAcceptance,runtimeAsync}.test.js`, `runtimePaneSafety.test.jsx` |
| Kill list, switch-on, frontend gate | `engine/__tests__/{runtimeKillSwitch,runtimeSwitchOn,pineRuntimeFrontendGate}.test.js` |

**Proposed command** (inside `python:3.12-slim-bookworm`, with Node 20.18.0 and `npm ci` in `app/`):

```bash
python -m pip install -r requirements.txt pytest
python -m pytest -q -p no:cacheprovider \
  tests/test_ast_interpret.py tests/test_ast_conformance.py tests/test_ast_conformance_no_conftest_in_server.py \
  tests/test_refusal_not_laundered.py tests/test_ast_budget.py tests/test_ast_c19_shared_budget.py \
  tests/test_compute_graph.py tests/test_graph_wire_size.py tests/test_param_manifest.py tests/test_param_repaste_c46.py \
  tests/test_user_definitions_auth.py tests/test_exposed_routes_gated.py tests/test_auth_surface_runtime.py \
  tests/test_entitlements.py tests/test_definition_sharing.py tests/test_share_publish_authorization.py \
  tests/test_definition_colour_trust.py tests/test_object_colour_trust.py tests/test_runtime_definitions.py \
  tests/test_runtime_document_round_trip.py tests/test_pine_runtime_switch_on.py tests/test_runtime_repaint.py \
  tests/test_runtime_pane_smoke.py tests/test_feature_flag_ledger.py tests/test_dockerfile_vite_build_args.py \
  tests/test_vite_flag_ledger.py
cd app && E=src/components/chart/engine && npx vitest run \
  $E/ast/budget.test.js $E/ast/parse.deepTree.test.js $E/ast/interpret.test.js $E/ast/parse.test.js \
  $E/ast/closedTable.test.js $E/ast/stringEscapes.test.js $E/ast/sharedBudget.test.js $E/ast/paramIds.test.js \
  $E/__tests__/objectColour.test.js $E/__tests__/objectTableDom.test.js $E/__tests__/presentationColourSinks.test.jsx \
  $E/runtime/__tests__/runtimeHardeningP1.test.js $E/runtime/__tests__/runtimeLimitsAcceptance.test.js \
  $E/runtime/__tests__/runtimePaneSafety.test.jsx $E/runtime/__tests__/runtimeAsync.test.js \
  $E/__tests__/runtimeKillSwitch.test.js $E/__tests__/runtimeSwitchOn.test.js $E/__tests__/pineRuntimeFrontendGate.test.js
```

**Baselines.**

| Where | Python | Vitest |
|---|---|---|
| Windows, today (measured) | **1,267 passed, 71 failed, 5 skipped** (455 s) | **18 files, 397 passed, 1 skipped** |
| Linux, expected (from the CI record of these same files on `caf67367b5`) | **69 failed**: compute_graph 31, param_manifest 25, param_repaste_c46 11, graph_wire_size 1, user_definitions_auth 1. The 2 census tests flip to pass, so about **1,269 passed / 69 failed / 5 skipped**. | **397 passed / 1 skipped**, inferred. Not evidenced on Linux since 10-03. |
| **Target before any stateful-execution change** | **0 failed** | **0 failed** |

The Windows Python failures are the 69 that fail on Linux too, plus the 2 Windows-only census tests.

The target needs two small repairs, neither made here:

- the stale fixtures gain `version: 1`, so the anti-forgery and bomb rails assert their own claims again (the shim shows they would pass);
- the refusal-sentence duplicate is resolved, or recorded as a finding with its owner.

### 2.5 Recommendation

1. **Before any change to stateful execution, run the 26 + 18 file suite on Linux, inside the production base image.** Do it as a **new `workflow_dispatch`-only job** modelled on `ocr-linux-cert.yml`:
   - `container: python:3.12-slim-bookworm`, Node 20.18.0, no secrets, checkout only;
   - **blocking on its own result** for that change: 0 failures, with an empty known-red list, or one that names each finding with its id.
   - Do not rely on `full-suite-report.yml` for this. It is report-only, it does not use the production image, and its vitest record has been empty for 99 runs.
   - Docker and WSL are not available locally, and the owner has ruled against installing them.
   - Nothing was triggered by this audit. Adding the job is a code change the owner has not authorised.
2. **Repair the suite first (size S, owner-authorised work only):**
   - add `version` to the stale fixtures, so 68 rails re-arm;
   - flatten the census's outbound payload (G4), so the Windows dev box can run the census too;
   - make `stable_stringify` iterative, or bound depth before `ast_hash`, so a deep tree gets a named 400 and not a 500.
3. **Keep the runtime dark** (owner instruction). If enablement is ever reopened, take the gates in this order:
   - E1 (Linux suite green);
   - E2 (string accounting);
   - E4 (one verdict);
   - E5 (an owner decision on alerts and scans: disclose chart-only, or build the sidecar);
   - E3 (grade the six candidates);
   - E6 (add a cohort stage);
   - E7 (drill the kill switch on admins);
   - E8 (a layout budget);
   - E9 (rehearse the rollback).

## Tests and probes run (all local, targeted)

- vitest:
  - 18 runtime files: 278/278 passed;
  - 18 security-suite files: 397 passed, 1 skipped (one run of 16 files plus a 2-file re-run after a path fix);
  - the PA5 Supertrend probe: 2/2;
  - the WS8 string-growth probe: 1/1 (re-confirmed bar 28).
- pytest:
  - 3 runtime files: 73 passed;
  - 2 more runtime files: 24 passed;
  - `test_ast_interpret` + `test_ast_conformance`: 160 passed, 2 failed, 5 skipped;
  - the 26-file suite: 1,267 passed, 71 failed, 5 skipped;
  - the 4 stale rails with the version shim: 80 passed, 1 failed (a shim artefact);
  - the PA5 deep-tree probe: 7/7 (the results are in the prints).
- Python one-offs: the JSON C-recursion threshold (2,990 ok, 3,000 fails), `setrecursionlimit` and thread stack size (neither helps), and the server functions on deep trees.
- Read-only git: `log`/`show` on runtime commits, and the `origin/ci-results` published records (runs 38334654786, 37123227661, and the 99-run vitest scan).
