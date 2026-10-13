# WS8: Performance, Reliability, Security and Test Coverage

Audit of `audit/indicators-competitive-2026-10-13` at `84164aee3d` (= origin/master = production, 2026-10-13).
Audit only. No runtime code, tests or config were changed. Scratch harnesses live in
`app/src/__audit_scratch__/ws8/` and are not committed.

**Headline.** I found no P0. Formula execution is interpretive in both lanes, with no `eval` or `new Function`.
Server-side checks enforce every admin, paid and dark gate I looked at. The budgets are real and they stop
runaway programs by name.

The main weaknesses are:
- **Performance (P1):** the AST lane recomputes everything on every update, on the main thread.
- **Reliability (P3):** a few resource classes are not accounted for.
- **Test hygiene (P1/P2):** 68 backend tests have been red since 10-08 because fixtures lack `definition.version`, and they include the anti-forgery and graph-bomb rails. There are also 7 more red rails beyond the 5 known concierge failures.

---

## A. Performance and reliability

### A1. Architecture: where indicator work runs

| Lane | Where it runs | Entry point | Caching | Incremental on tick/new bar |
|---|---|---|---|---|
| Native and AST formulas ("host lane") | **Main thread**, inside the binder | `engine/binder.js:1656-1664` calls `registry.computeFor` (`engine/nativeRegistry.js:3004`) | (1) Per-instance memo keyed on `registry`, `def`, **`calcBars` identity** and an inputs/source signature (`binder.js:1655-1658`). (2) A per-pass `crossMemo` shared by all plots of one document, dropped after the call (`nativeRegistry.js:2459-2475`). (3) A per-tree structural memo inside `interpret` (`ast/interpret.js:4015-4060`, `4119-4137`). | **None.** A new bars array (every live update; `LIVE_UI_CADENCE_MS = 1000`, `utils/streamStatus.js:19`) misses the binder memo, and every AST column is recomputed over the whole history. |
| Pine runtime ("runtime lane", VM) | **Web Worker** (`engine/runtime/runtimeWorker.js:17-38`), with a synchronous fallback when no `Worker` exists (`runtimeAsync.js:16`, `78`, `250`) | `computeRuntimeColumns` (`runtime/runtimeColumns.js:369`) | Sessions: up to 12, with a 64 MiB byte cap (`runtimeColumns.js:552-559`) | **Yes.** It resumes from the last confirmed-bar checkpoint when the bars, program and columns before it are bit-identical (`runtimeColumns.js:530-620`). A forming bar is never checkpointed. |
| Server lane (`compute.kind: 'server'`) | Backend; fetched by `useServerColumns` | `engine/serverCompute.js` (joined by time, never by index; no entitlement logic on the client) | SWR | n/a |
| Server formula evaluation (alerts, scans, concierge) | Python `ast_interpret.interpret` | `api/services/ast_interpret.py:5300-5330`; budget checked on **every** call (`:5320`) | per call | n/a; sweeps are off the request path (`test_scan_evaluator_off_request_path.py`) |

The runtime pane is dark in production: `VITE_PINE_RUNTIME_PANE_ENABLED` has status `dark` in
`docs/frontend_feature_flags.json`, and both `runtimePaneBuilt` and `runtimePanePermitted` must hold
(`engine/runtimePaneGate.js:69-71`). So in production every member formula runs in the **host lane on the main thread**.

### A2. Resource limits (verified in code)

**Formula (AST) budget**, the same in both languages:
- `maxNodes 128`, `maxLookback = max(NESTED_RECURRENCE_WARMUP 550, SESSION_MAX_BARS)`, `maxSeriesRefs 8`.
  See `api/services/ast_budget.py:115`, `:138-146` and `app/.../engine/ast/budget.js:63-94`.
- The stored `compute.budget` is clamped **downward only** (`ast_budget.py:252-274`), so user data cannot raise a cap.
- The server checks the budget in `interpret` before any node is walked (`ast_interpret.py:5320`). It also checks
  at concierge (`definition_concierge.py:2944`), conversation (`definition_conversation.py:1019`),
  alerts (`alert_user_series.py:895`) and starters (`starter_library.py:326`).
- The recurrence step cap is `MAX_RECURRENCE_STEPS = 12,000,000` (`ast_interpret.py:548`).

**Runtime VM limits:** 24 named limits (`runtime/limits.js:29-79`), each raising `RuntimeLimitError` with the
limit name, ceiling and value reached (`limits.js:209-218`).

| Limit | Value | Notes |
|---|---|---|
| `PROGRAM_SIZE` | 512 KiB | checked before lexing |
| `INSTRUCTIONS_PER_BAR` | 200,000 | |
| `TOTAL_INSTRUCTIONS` | 200,000,000 | |
| `LOOP_ITERATIONS` | 5,000,000 | |
| `WHILE_ITERATIONS` | 10,000 | |
| `LOOP_NESTING` | 8 | |
| `CALL_DEPTH` | 64 | |
| `HISTORY` | 32,768 bars | |
| `MEMORY` (estimate) | 64 MiB | |
| `WALL_TIME` | 5,000 ms | |

On top of these:
- a 1,000 ms pane budget (`runtimeColumns.js:198`, `:491-498`);
- a 20 s worker watchdog that terminates and rebuilds the worker (`runtimeAsync.js:39`, `:99-114`);
- a server-owned kill list (`engine/runtimeKill.js`, `GET /api/user-definitions/runtime-kill`, `api/routers/user_definitions.py:523-537`).

The `Budget` object is passed per run, never kept as module state (`limits.js:233-260`).
`runtimeLimitsAcceptance.test.js` gives every limit a script that trips it.

**Server request bounds:**
- definition document: 64 KiB (`user_definitions.py:177`);
- runtime document: 128 KiB;
- `/propose`: at most 5,000 bars (`routers/user_definitions.py:107`) and 40 calls per hour (`:135`, charged before the model call, `:141-161`);
- vision: 5 MiB image, 4 media types, 10 calls per hour (`services/indicator_from_image.py:127-131`, `routers/indicator_vision.py:64`);
- scans: `MAX_ROWS = 500` on `definition-results` (`routers/scan_results.py:18`).

### A3. Micro-benchmark

**Methodology.** One scratch vitest, `app/src/__audit_scratch__/ws8/indicatorBench.measure.test.js`:
- 5,000 synthetic daily bars from a seeded LCG;
- each figure is the median of 5 to 7 reps, in one jsdom fork;
- formulas are parsed with `parseFormula`, budget-checked with `checkBudget`, and evaluated with `interpret` directly.

**⚠ Contamination:** this was measured under **shared CPU load** (7 other auditors running suites at the same time).
The absolute milliseconds are not trustworthy. Read only the ratios inside one run.

| Case | Median (ms, contaminated) | Relative |
|---|---|---|
| Parse all 10 formulas | 2.5 | ≈4% of one evaluation pass: parse/compile cost is negligible |
| 9-formula set, cold (each tree its own memo) | 58 | 1.00 |
| Same set with a shared pass `crossMemo` | 51 | ≈0.88 (reuse only where subtrees repeat) |
| Same set after a "tick" (new bars array, last close +0.1%) | 55 | ≈0.95: **a tick costs a full recompute** |
| 40-deep nested `sma(…,13)` (admitted, lookback 480 < 550) | 159 | ≈2.7× the whole 9-formula set |
| Widest admitted sum of distinct `sma(close,k)` (42 terms, then `budget:nodes`) | 179 | ≈3.1× the set |
| Runtime: runaway `for 0..100000` | 39 | stopped by `INSTRUCTIONS_PER_BAR` |
| Runtime: runaway `while k >= 0` | 14 | stopped by `WHILE_ITERATIONS` |
| Runtime: honest `ta.sma` over 5,000 bars | 23 | baseline |
| Runtime: string doubled every bar (`stringGrowth.measure.test.js`) | 13 | stopped at bar 28 by **V8's own** `Invalid string length`, reported as `runtime:failed`, **not** as a named limit |

`atr(14)` was refused with `resolve:arity`; the formula grammar's `atr` takes a different arity. This is noted, not a defect.

**What it shows:**
1. Compile cost is negligible compared with evaluation.
2. The budget-cap worst case costs about 3× a typical 10-indicator chart in one call. That is bounded, but it all runs on the main thread.
3. There is no incremental evaluation in the host lane. On a 16-chart layout, every 1 s live update re-runs every formula on every chart.
   - Extrapolation, not a measurement: 16 × 1× set ≈ 16× the cold figure per cadence tick.
4. Runaways in the runtime lane are stopped within tens of ms, by name.

### A4. Proposed clean benchmark methodology

1. Use a dedicated, idle machine, or `taskset`/affinity pinning plus a quiesced box. Turn turbo/boost off or fix the governor. Record the CPU model and the Node version.
2. Run under Node directly (`vitest bench` or a plain `node --expose-gc` script), not jsdom forks, for engine-only figures.
   Add a separate Playwright trace for render/commit cost on `/charts`.
3. Warm up with 3 discarded runs, then measure 30 or more reps. Report the median and p95. Call `gc()` between reps for the memory figures (`process.memoryUsage().heapUsed` delta).
4. Matrix:
   - bars ∈ {500, 5,000, 20,000, 32,000};
   - formula sets ∈ {1, 10, 30};
   - layouts ∈ {1, 4, 16} charts;
   - shapes ∈ {typical, budget-cap nested, budget-cap wide, runtime corpus scripts};
   - operations ∈ {cold load, tick on forming bar, new bar, symbol switch}.
5. Record main-thread long tasks (>50 ms) per tick on a 16-chart layout with 10 formulas each. This is the user-facing number that matters.
6. Gate it: commit the fixture and the harness, compare against a stored baseline with a ±15% tolerance, and run it nightly on a fixed runner, never in the shared-CPU unit suite.

### A5. Reliability and error handling

- Every refusal names its guard. Runtime stops are `RuntimeLimitError` (`limits.js:200-218`), worker errors are sent back as fields (`runtimeWorker.js:27-37`), and the watchdog says what happened (`runtimeAsync.js:66`).
- `/propose` refusals return `200 {ok:false, gate}` (`routers/user_definitions.py:362-367`); there is a test-backed contract for this.
- **Telemetry:**
  - `indicator_telemetry.py` uses per-event allowlists (`EVENT_SCHEMAS`, `:120`) and refuses any non-scalar value.
  - Prompts and source text are never logged; the source is checked in `/propose` (`routers/user_definitions.py:419`) and in the module docstring (`:23-50`).
  - `POST /api/indicator-telemetry/event` requires authentication (`routers/indicator_telemetry.py:53-54`) but has **no rate limit** (gap G6).
  - The rollout report is admin-only (`:65-66`).

---

## B. Security

### B1. Formula sandboxing

- **No dynamic code execution.** A grep of `app/src` for `new Function(`, `eval(`, `innerHTML =`,
  `dangerouslySetInnerHTML` and `insertAdjacentHTML` (excluding tests) finds no hit under `components/chart/`.
  Every hit is in unrelated surfaces (community, Morning Wire, desk, notebook).
- On the server, a grep for `eval(`, `exec(` and `__import__` in `ast_*`, `indicator_compute`, `user_definitions`,
  `alert_user_series`, `scan_definition`, `pine_library_store` and `indicator_from_image` finds nothing.
  The only `getattr` uses are on the SDK message object and function metadata.
- **The VM is interpretive.** Pine is lowered to IR and run by `runtime/vm.js`. Formulas are tree-walked by `ast/interpret.js` (JS) and `ast_interpret.py` (Python).
- Scope lookups use `name in scope` on a plain dict (`ast_interpret.py:5325-5330`). There are prototype/attribute escape probes in `tests/fixtures/ast/escapes.json`.
- **Worker isolation:** the runtime lane runs in a module Worker (`runtimeAsync.js:242`). It has no DOM access. It is same-origin, so it could `fetch`, but it runs only interpreted code.
- **No user-controlled regex** in the runtime (`str.replace_all` uses `replaceAll` with a string needle, `runtime/text.js:39-48`). The server's `tickerPattern` comes from a repo JSON file (`alert_user_series.py:402`).

### B2. Findings by class

| # | Class | Severity | Evidence | Verdict |
|---|---|---|---|---|
| S1 | Code-execution sandbox escape | none found | above | Interpretive in all lanes |
| S2 | Admin/member boundary: UCT Agent | none found | All 13 routes in `api/routers/uct_agent.py` declare `Depends(require_admin_dark)` (`:63-65`, `:140-471`; count of routes = count of dependencies = 13) | Enforced on the server |
| S3 | Advanced Pine runtime disabled in production | none found | Save door: `PINE_RUNTIME_SAVE_ENABLED` (dark) and `PINE_RUNTIME_STAGE` (dark, default `off`). Checked per call in `_save_runtime` (`user_definitions.py:2141-2156`): save switch, `save_permission(role)` (`runtime_definitions.py:209-221`), kill list, starter allowlist. The role comes from the server-side `user["role"]` (`routers/user_definitions.py:349`, `:594`); a caller that omits it is treated as a member. | Enforced on the server. The client pane flag only affects what the member's own browser draws. |
| S4 | Create-Indicator (conversational) cohort | none found | `/converse` uses `require_admin_dark_rollout` = admin or cohort, with the flag read per call (`routers/user_definitions.py:454-480`) | Enforced on the server |
| S5 | Cross-user data access | none found | Every definition read is scoped by `user_id` (`user_definitions.get`, `:2264-2277`). The alert cache key is `user_id\x1faddress` (`alert_user_series.py:236-238`). Sharing goes through a 128-bit `secrets.token_hex(16)` token (`:2348`), checked for revocation (`:2497`), and the install re-runs the full save validation (`:2562`). | OK |
| S6 | CSS/markup injection via labels, tables, colours | none found (fixed 10-08) | Table cells use `textContent`, never `innerHTML` (`engine/objectTableDom.js:229-233`). Colours go through `cssColourOrNone` (`engine/objectColour.js:35`, grammar `:47-55`), and the server refuses the same grammar at save. Labels are drawn on canvas. Legend names render through React. | OK |
| S7 | Telemetry leakage | none found | Allowlist plus a scalar-only rule (`indicator_telemetry.py:37-50`, `:120`) | OK |
| S8 | AI cost: `/propose` | Low | 40/hour per process (`:135`), plus `may_member_spend` (global with a reserve) and a per-user daily USD cap, both checked before each model call (`definition_concierge.py:3145-3150`). **No prompt-length cap**: only `prompt:empty` is checked (`:3091`). | P3: an over-long prompt spends input tokens up to the per-user cap. The rate limit is in memory and per process, and the code says so (`routers/user_definitions.py:131-134`). |
| S9 | AI cost: vision | Low | 10/hour plus the global `may_member_spend` (`indicator_from_image.py:511`). **No per-user daily USD cap** like the concierge has. | P3 |
| S10 | Upload safety | Low | 5 MiB cap, applied before parsing, through `body_cap.CappedMultipart` (`routers/indicator_vision.py:136-148`). The media type is taken from the **client header** (`:199`) and checked against an allowlist; the magic bytes are not checked. | P3: the bytes go only to the model API, never to disk or the DOM |
| S11 | Pine library store | none found | Read-only HTTP routes (`routers/pine_libraries.py:26-33`). Names and path are anchored by regex (`pine_library_store.py:39-40`), so traversal cannot pass. The only writer is the offline `tools/pine_library/fetch_library.py:220`. Note: reads need only `get_current_user`, not a paid plan. | OK (P3 entitlement nit) |
| S12 | DoS via formula, server | none found | Budget checked on every `interpret` call (`ast_interpret.py:5320`). The budget measurement is iterative, so it survives an 8,001-node tree. The step cap is `MAX_RECURRENCE_STEPS`. | OK |
| S13 | DoS via a shared formula, client | Low | A shared or installed definition runs in the **recipient's** main thread. It is bounded by the AST budget, so in the worst case it costs about 3× a typical chart per tick (A3). | P2 perf, not security |
| S14 | Runtime memory accounting | Low | Strings are not charged to `MEMORY`. A doubling string is stopped only by V8's max string length, at bar 28 (A3). This is lane-dark in production. | P3 |
| S15 | Telemetry write amplification | Low | Authenticated, with no rate limit. Rows are deduplicated only per `import_id`. | P3 |
| S16 | Scan results by hash | Info | `GET /api/scans/definition-results` serves hits by `def_hash` to any paid user (`routers/scan_results.py:49-90`). The hash is a content hash, so you must already know the formula to know it. It returns tickers only. | Info |
| S17 | Other-symbol fan-out, client | Info | Authored trees are capped at `maxOtherSymbols: 2` (`builder/authoring/crossContext.json:4`), enforced by the server (`alert_user_series.py:398-408`). The runtime caps `REQUEST_COUNT` at 16. I **did not find** a client-side cap on how many other symbols an imported host-lane document can fetch (`otherSymbols.js`, `secondaryBars.js`). That data is already within the member's own `/api/bars` entitlement. | Info / P3 |

### B3. Flag and boundary verification summary

| Flag | Status (docs) | Enforced on the server? |
|---|---|---|
| `PINE_RUNTIME_SAVE_ENABLED` | dark | ✅ `user_definitions._save_runtime` |
| `PINE_RUNTIME_STAGE` | dark (`off`) | ✅ `runtime_definitions.save_permission` |
| `CREATE_INDICATOR_COHORT_ENABLED` | pending (0) | ✅ `require_create_indicator_access` |
| UCT Agent (admin-dark) | — | ✅ all 13 routes `require_admin_dark` |
| `INDICATOR_VISION_ENABLED` | armed | ✅ checked in the handler before the rate charge (`routers/indicator_vision.py:159`) |
| `VITE_PINE_RUNTIME_PANE_ENABLED` | dark (build-time) | Client-only, and correctly so: it changes only the member's own rendering. Saving is gated on the server. |
| `VITE_INDICATOR_TEMPLATES_ENABLED` | dark | client-only (`builder/indicatorTemplates.js`). I did not audit the server half. |

---

## C. Test coverage

### C1. Inventory

The classes below come from a filename-heuristic classifier, then spot-checked. Counts are approximate (±10%), and every file is counted once.

**Frontend: 615 indicator-related test files**

| Directory | Files |
|---|---|
| `engine/` | 27 |
| `engine/ast/` | 313 (15 `.measure`, 9 `.vendor`) |
| `engine/ast/__tests__/` | 2 |
| `engine/runtime/__tests__/` | 118 (6 `.measure`) |
| `builder/` | 104 (2 `.measure`) |
| `pane/` | 6 |
| `legend/` | 5 |
| `chart/*.test.{js,jsx}` (indicator-named) | 40 |

There are also 73 `*agent*` test files under `app/src` and 20 `tests/*agent*` files, which are Agent integration and outside the rows below.

| Class | Frontend | Backend (64 files) |
|---|---|---|
| Calculation / evaluator / semantics | ≈215 | 20 |
| Import compatibility (Pine/thinkScript/PCF/corpus/vendor/OOS) | ≈198 | 4 (concierge, vision, starters, library) |
| Rendering / objects (tables, labels, colours, markers) | ≈67 | — |
| UI interaction (`.jsx`) | ≈52 | — |
| Performance / limits / budgets / census | ≈40 | 4 (budget, c19 shared budget, telemetry ×2) |
| Pane management | ≈21 | — |
| Parser / binder / lint | ≈12 | 6 |
| Two-lane parity (JS ⇄ Python) | (inside evaluator) | 14 |
| Persistence / versions / sharing | ≈6 | 10 |
| Security (escape, colour trust, auth) | ≈2 by name, plus colour-trust and escape rails inside ast | 3 (`user_definitions_auth`, `definition_colour_trust`, `definition_sharing`), plus `test_exposed_routes_gated` and `test_object_colour_trust` |
| Integration / acceptance | ≈2 | 3 (alerts), plus ring-2 end-to-end files |
| Agent integration | ≈6 in chart dirs | separate |

### C2. Coverage by capability

**Well tested**
- Evaluator semantics and the two-lane JS ⇄ Python parity: 14 parity suites plus the conformance census.
- Budgets and limits: every one of the 24 VM limits has an acceptance case, and there are measured ceilings.
- Refusal naming.
- Pine import corpus and vendor captures.
- Colour/CSS trust, at both save and render.
- Auth gating of definition routes, checked per handler.
- Runtime incremental equivalence (`runtimeIncremental.test.js`, bit for bit).
- Telemetry allowlist.

**Partially tested**
- Main-thread performance of the host lane: `.measure` tests exist but are not gated, and nothing measures many charts at once.
- Worker lifecycle: watchdog and kill are tested with a factory seam; there is no real-Worker test.
- Share/install flows: there is a service test; UI coverage is thin.
- Rate limits: `/propose` and vision have unit tests; the per-process scale-out caveat is untested by nature.

**Untested or absent**
- Host-lane incremental evaluation (the feature does not exist).
- A many-chart × many-formula layout under live ticks.
- Memory over a long session (host-lane memo growth, `computeMemo` keyed by instance).
- String/heap accounting in the runtime.
- Prompt-length bounds.
- Telemetry rate limiting.
- An end-to-end browser test of a shared-definition XSS/CSS payload: there are unit rails only.

### C3. Test runs (shared-CPU box; Python 3.12.10 on Windows)

**Backend ring 1** (64 files: `ast_*`, `user_definition*`, `definition_*`, `indicator_*`, `alert_user_series`, `scan_definition`, `starter_library`, `pine_library_store`):
**2,410 passed, 12 failed**, 5 skipped, 1 xfailed, in 245 s.

| Failing test | Root cause (from reading code and git history) | Fails on baseline? |
|---|---|---|
| `test_definition_concierge.py` ×5 (`BUDGET_is_consulted_BEFORE_the_linter`, `LINTS_repainting…ONE_repair`, `REPAINT_refusal_is_the_LINTERS`, `EVERY_refusal_names_a_door`, `CORPUS_of_FIRM_PHRASINGS`) | **Confirmed as already root-caused.** The fixtures still expect `dev(close,5)` to lint as repainting. After the lint fix `50e43e7459` the first proposal no longer repaints (`got budget:nodes`, `repair did not happen`, `('lint:repaint', {… 'name': 'dev' …})`). The corpus test reports "4 of 1343 firm phrasings anchored NOTHING", which is the 4 starter screens renamed in `602f8865ab`. | Yes, by cause (the fixtures predate both commits) |
| `test_starter_library.py::test_every_DECLARED_starter_ACTUALLY_RESOLVES`, `::test_a_RETUNED_THRESHOLD…`, `::test_installing_a_starter_TWICE…` (3) | **New, not in the lead's list.** The same root cause as the concierge corpus gap: the "Classic Flag/Pullback" starter is grounded on `starter_leaders_pullback`, which `602f8865ab` (2026-09-20) removed from the screener. | Yes, by cause (since 09-20) |
| `test_starter_library.py::test_the_save_path_has_NO_STARTER_BRANCH__BY_AST` | **Rail false positive.** The AST scan finds the word "starter" in the `_save_runtime` docstring ("the starter allowlist (GT, D6)"), added by `40c82dc9ec` (2026-10-03). | Yes, by cause (since 10-03) |
| `test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…` | **Rail drift.** Three routers refuse with the identical sentence "The screener requires a paid plan": `screener.py` (`4e2563bdff`, 08-08), plus `screener_nl.py` (`20f30762f9`) and `screen_promote.py` (`37ca6b44bf`), both 10-02. The UX requirement that each surface says which one locked the member out is not met. | Yes, by cause (since 10-02) |
| `test_ast_interpret.py::test_the_escape_census_ZERO_is_ATTRIBUTABLE…`, `test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR…` | **Harness, environment-sensitive.** `tools/ast_conformance.py:868` `json.dumps`es the nested 4,000-deep `gen:nest(4000)` escape tree into the node driver's stdin and hits `RecursionError` in CPython's C JSON encoder. The harness already flattens the return path for this exact reason (`:710-718`) but not the outbound payload. The escape fixtures are unchanged since 08-09. This depends on the platform/Python C-stack limit (local Windows 3.12.10; the production image is 3.12.7 on Linux). **The security rail is therefore not running on this box.** | **Baseline unknown. Lead: run these two on Linux / Python 3.12.7.** |

Ring 1 shows **no failures caused by a missing `definition.version`**.

**Backend ring 2** (48 more files that touch definitions: `alert_user_*`, `p0..p3_truth_*`, `scan_*`, `runtime_*`, `entitlements`, `exposed_routes_gated`, …): see C3a.

**Frontend sample** (177 files: all of `builder/`, 12 `engine/` files, 7 `engine/ast/` core suites including `interpret`, `parse`, `budget`, `lint`, `dialect`, `closedTable` and `parse.deepTree`, plus runtime `HardeningP1`, `LimitsAcceptance` and `PaneSafety`):
**3,932 passed, 0 failed, 11 skipped**, 4 files skipped, in 112 s.

### C3a. The "~74 tests failing for lack of `definition.version`" claim

**The claim is confirmed: there are 68 such failures, all in backend ring 2.**

Ring 2 covered 48 files and finished with **1,406 passed, 71 failed** in 441 s.

| File | Failures | Cause |
|---|---|---|
| `tests/test_compute_graph.py` | 31 | version |
| `tests/test_param_manifest.py` | 25 | version |
| `tests/test_param_repaste_c46.py` | 11 | version |
| `tests/test_graph_wire_size.py::test_the_bomb_is_still_refused_on_the_write_path` | 1 | version |
| `tests/test_phase_e_acceptance.py` | 3 | **a different cause** (see below) |

How the 68 break:
- 62 raise `ValueError: definition.version: required integer >= 1` straight from the save door that `4b9796e968` (10-08) added (`user_definitions.py:1648-1652`).
- The other 6 assert a *different* refusal sentence (for example `'at least two plots'`, `'expands to'`, or `startswith('compute.trees:')` at `test_compute_graph.py:194` and `:276`). They receive the version refusal first, because it now fires earlier than the guard under test.
- Every one of these fixtures predates `4b9796e968`. The last test change was `61c63035d8` on 10-06, so they fail on any baseline after 10-08 by construction.

⚠ **Security consequence.** Many of these are anti-forgery and DoS rails that currently prove nothing about their own guard:
- `test_attack_invented_parameter_id`, `test_attack_altered_bounds_in_both_directions`, `test_attack_forged_locator…`, `test_attack_transplanted_parameter…`;
- `test_14_a_crafted_manifest_widening_an_existing_parameters_bound_is_defeated`, `test_15_a_crafted_PUT_cannot_invent…`;
- `test_a_client_may_not_widen_its_own_bounds`;
- the graph "bomb" write-path rail.

The production refusal still happens, but it comes from the wrong door. The parameter-manifest trust guard and the graph-bomb write guard are **unverified since 10-08**. This is the "refused by a different door" defect class that `ast_budget.py`'s own docstring warns about.

The 3 `test_phase_e_acceptance.py` failures are not about `version`:
- `def_hash` is expected bare but arrives with the semantics-v2 `~s2` suffix (`'sha256:…~s2' == 'sha256:…'` at `:433`; result identity regex at `user_definitions.py:524`). The two downstream legs then find no receipt (`:517`, `:572`).
- This is likely fixture drift from the semantics-v2 result identity (P0/P1/P2 reapply `61c63035d8`, 10-06). **Lead: confirm on a baseline.**

Ring 2 had no other failures, so `test_exposed_routes_gated`, `test_entitlements`, `test_share_publish_authorization`, `test_object_colour_trust`, the `runtime_*` tests, and the `p0..p3` truth tests are all green.

### C4. EvidenceTab timeout review

The tests cover:
- `BuilderSheet.evidence.test.jsx` (12 tests): the Evidence tab exists only for a saved definition; the receipt binds to the saved hash; the drift note appears on multi-plot documents.
- `EvidenceTab.test.jsx`: retro study and forward-record rendering.
- `EvidenceTab.rails.test.js`: every sentence renders as prose.
- `EvidenceTab.doors.test.js`: exactly two importers, derived from the real import graph.

Run alone (4 files, 74 tests) they **all pass**. The slowest test took 760 ms, and module import took 13 s of the 12.9 s wall time spread across forks.

The known timeout is `EvidenceTab.doors.test.js › ANTI-ROT: the derived importer set IS the named pair`, recorded in `docs/breadth/gates.md:19` as "load (15 s timeout)". That test walks **all of `app/src`** (`walkDir`, `EvidenceTab.doors.test.js:75-92`) and acorn-parses files to resolve importers. It is I/O- and CPU-bound: 663 ms alone, against `testTimeout: 15000` (`vite.config.js:333`).

**Verdict:** this is a load-time timeout, not a deadlock. It is flaky only under a saturated fork pool and the full suite. `BuilderSheet.evidence` uses fake timers with explicit `advanceTimersByTime` and `flush`, and nothing in it awaits a real timer. It did not hang here.

Suggestion (P3): cache the import graph once per run, or give that one test a per-test timeout.

### C5. Concierge failures

These are confirmed to match the stated root cause; I did not redo the analysis.
- The failure messages point at stale repaint-lint fixtures after `50e43e7459`, plus a 4-phrase corpus gap tied to `602f8865ab`.
- **Addition:** the same `602f8865ab` gap also turns 3 `test_starter_library.py` tests red, and the lead's list does not include them.

---

## D. Gaps

| ID | P | Description | Evidence | Current vs expected | User impact | Complexity | Dependencies | Regression risk |
|---|---|---|---|---|---|---|---|---|
| G1 | **P1** | No incremental evaluation in the host (AST) lane; every live update recomputes all formulas over the full history on the main thread | `binder.js:1655-1664` (memo keyed on bars identity); A3: tick ≈ 0.95× cold | Now: full recompute every ~1 s per chart. Expected: append/tail recompute for causal trees, or move to a worker. | Jank on multi-chart layouts and large indicator sets; scales as charts × formulas × bars | L | the runtime lane's checkpoint design is a template | Medium: semantics of `barstate`/`last_bar_index`-style reads |
| G2 | P2 | Host lane runs on the main thread; only the dark runtime lane uses a worker | `runtimeWorker.js` only; `runtimePaneGate.js:69` | Expected: off-main-thread for heavy documents | Long tasks at the budget-cap worst case (≈3× a typical chart) | M–L | G1 | Medium |
| G0 | **P1** | 68 backend tests red since 10-08 because fixtures lack `definition.version`, including the parameter-manifest anti-forgery and graph-bomb write-path rails, which now refuse at the version door instead of their own guard | C3a; `user_definitions.py:1648-1652` | Expected: fixtures carry `version: 1`, so each rail reaches its own guard again | The trust guards in production are unverified by tests since 10-08; a regression there would be invisible | S (add `version` to fixture builders in 4 files) | none | Low |
| G3 | P2 | 7 red backend rails on master besides the 5 known concierge failures (3 starter grounding, 1 starter AST false positive, 1 paid-sentence duplicate, 2 escape-census harness) | C3 | Expected: green, or explicitly quarantined | Masks real regressions; the escape/sandbox census is **not running** on this box | S each | none | Low |
| G4 | P2 | The escape-census harness depends on the platform C-recursion limit (nested payload `json.dumps`) | `tools/ast_conformance.py:868`, `:710-718` | Expected: a flat outbound payload, like the return path | A security rail can silently stop working on some platforms | S | none | Low |
| G5 | P3 | No prompt-length cap on `/propose`; vision has no per-user daily USD cap | `definition_concierge.py:3091`; `indicator_from_image.py:511` | Expected: a char/token cap and a per-user cap that mirrors the concierge | Bounded cost leak per user | S | none | Low |
| G6 | P3 | Telemetry event endpoint has no rate limit | `routers/indicator_telemetry.py:53` | Expected: a per-user cap | Table growth by an authenticated user | S | none | Low |
| G7 | P3 | Runtime `MEMORY` does not count strings; runaway growth is stopped only by V8 | A3 string-growth probe | Expected: a named `MEMORY`/`STRING_LENGTH` stop | Worker memory spike before the error (lane dark in production) | S | runtime switch-on | Low |
| G8 | P3 | No gated perf benchmark; `.measure` tests are not run as gates | A4 | Expected: a nightly fixed-runner benchmark with tolerances | Perf regressions go unseen | M | CI runner | None |
| G9 | P3 | `EvidenceTab.doors` walks the whole source tree in one test | `EvidenceTab.doors.test.js:75-92` | Expected: a cached graph or a longer per-test timeout | Flaky full-suite runs | S | none | None |
| G10 | P3 | Duplicate paid-plan refusal sentence across three screener routers | `test_user_definitions_auth.py:349` | Expected: a distinct sentence per surface | Member cannot tell which surface refused them | S | none | Low |
| G11 | P3 | Vision trusts the client `Content-Type` and does not sniff magic bytes | `routers/indicator_vision.py:199` | Expected: a magic-byte check | Wasted model calls on mislabelled bytes | S | none | Low |
| G12 | Info | No client-side cap found on other-symbol fetches from imported host-lane documents | `otherSymbols.js`, `secondaryBars.js` | Expected: the same cap as authoring (2) or the runtime (16) | Self-inflicted fetch fan-out only | S | none | Low |
