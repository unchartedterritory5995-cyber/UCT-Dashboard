# W6 "Collections, UDTs, methods, enums, generics, `for … in`": task breakdown

Written 2026-11-05 by a pine-parity planning session on the desktop. Docs only: no vitest, census or
harness was run for this document.

Citations:
- Every line citation is at `origin/master` **`646dca8cbf`**. `pineRuntimeFrontend.js` is byte-identical
  there to W4-BREAKDOWN's `e055b21e7f`, so a `FE:` line in this doc and one in W4-BREAKDOWN name the
  same code. `SCRIPT_ENGINE_VERSION` is 5 (`scriptEngineVersion.js:88`).
- `FE` means `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (11,115 lines, one closure).
- `RT/` means `app/src/components/chart/engine/runtime/`.
- `HOST` means the columnar/object lane: `ast/pine.js` (30,370 lines, owned by W3 while W3 runs),
  `ast/pineObjects.js` (the host object lane) and `ast/interpret.js`.

**The goal is the language, not the sample** (AGENT-RULES, branch `docs/pine-parity-programme`). Every
task implements a Pine capability for every script that uses it. The 679-script sample only ranks the
capabilities. Where a task names scripts, they are the census rows expected to move, never special cases.

**W6 builds start from the W4 landing train tip** (`integ/pine-train-2026-11-05`, being built; not pushed
when this was written). Tasks are written against master's code. Every FE/RT region an unmerged W4 lane
touches is flagged in section 4 as a rebase risk, with the W4 branch and its hunk lines.

## 0. What the measurements say (read this first)

Three inputs:

| input | what it is | used for |
|---|---|---|
| `docs/pine/coverage-map.json` and `docs/pine/coverage-targets-2026-11-03.json` on `origin/fix/pine-w0-census-peel` @ `127a0f1e3c` | the W0 re-run with W4 T0's logical-statement peel. **Measured 2026-11-03/04 on the desktop, master `6990d63b02`**, 679 scripts, runtime-on lane = the runtime pane on at every peel step. | per-wall touches, step-0 walls, wave sets, upper and firm counts (section 1) |
| `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w0peel/after-rt/census.jsonl` (967 rows; licence-held, local, not committed) | the runtime-on census rows behind that map | which **language feature** sits behind each W6 guard (`rtProbe.message`, `rtProbe.text`), and the per-task split |
| the 679 sources (`corpus/committed/*.pine` plus `_resume-2026-11-01/pine-sample/{builtin,reference}`) | read-only regex scan | how many scripts USE each feature, walled or not (finding 4) |

The engine between `6990d63b02` and `646dca8cbf` differs only in `ast/closedTable.json` and one test, so
the census describes today's master code. W4 has changed nothing on master yet; every count below is
**before W4**.

Five findings change how W6 should be planned.

1. **W6 is small and deep on this sample.** 56 scripts carry a W6 wall on the runtime-on lane (the
   committed map's `runtimeWaves.W6.blocks`). Only **5** have W6 walls alone (upper), of which **4** are
   firm (walls fully enumerated: the peel reached a clean state). With W4 also closed: **15 upper / 7
   firm**. The plan's "+30 / +11" is the 2026-10-31 production-lane phase table (COVERAGE-MAP.md
   section 6, cumulative after W1, W3 and W4), a different measure; the greedy runtime-on order of the
   11-03 targets puts W6 sixth at **+52 upper** (after W3, W4, W1, W7, W8). Judge W6 by walls moving and
   by rails, not by the headline.
2. **Most W6 walls are reached late.** 146 scripts stopped at the peel cap before their walls were all
   seen (`runtimeOn.walls.stuck.cap`), and the per-script wall list is capped at 8. W6 features hide behind W4 (`runtime:history-*`,
   `runtime:conditional-history`), W1 names and W8 libraries. Expect more W6 walls to appear as W4
   lands: the sample USES W6 features far more than the walls show (finding 4).
3. **Three W6 guard counts are mis-waved, as W4's were.**
   - `pine:collection` (5 scripts): 4 are arrays made by `request.security_lower_tf` that the peel
     removed ("`ltfVolumesUp` is read as an array here and nothing in this script creates it"), i.e. W7;
     the fifth (`inside-bar-strategy-w-sl`) is an order strategy (W9).
   - `pine:type` (8 scripts): 2 are **not types at all**. `technical-ratings` (TradingView built-in) binds
     a parameter named `timeframe` and then reads `timeframe.period`; the shared `Resolver.typeRefusalFor`
     (`pine.js:8921-8930`) treats any dotted name whose head is a bound name as a UDT field. The
     reference doc script `functions` does the same with `timeframe.change(timeframe)`. Of the rest, 2
     heads are library types (`chr.DateTimeWindow`, `pocRow` from an imported library: W8).
   - `runtime:udt-method` (3 scripts): `price-divergence-detector-v32-revised-by-justunclel` is a **v3**
     script whose line `method = input(defval='BB %B', …)` is a binding, not a method declaration.
     `FE:8808` reads the word `method` as the keyword in every version and in every position.
4. **What the sample uses, walled or not** (scripts of 679, name form; method-form calls not counted):
   `array.*` 195, a generic `<T>` 102, `type` declarations 57, `for … in` 43, `method` declarations 34, a
   user function with an `array<T>`/`matrix`/`map` parameter 15, `matrix.*` 13, `input.enum` 9,
   `map.*` 9, `enum` declarations 7. `array.*` members the runtime lane does not implement, by scripts
   using them: `array.sort` 7, `array.insert` 7, `array.fill` 7, `array.join` 5, `array.percentrank` 3,
   `array.binary_search_rightmost` 3, `array.reverse` 2, `array.lastindexof` 2,
   `array.binary_search_leftmost` 2, `array.variance` 1, `array.standardize` 1,
   `array.percentile_nearest_rank` 1, `array.covariance` 1. Matrix members used: `new` 13, `get` 7,
   `set` 5, `rows` 5, `columns` 4, `add_row` 3, `min` 2, `max` 2, `submatrix`, `remove_row`, `col`,
   `add_col` 1 each.
5. **`enum` has no measured wall.** No census step reached an `enum` declaration or an `input.enum`:
   the 7 + 9 scripts that use them stop earlier. Its yield is unmeasured until W4/W1/W8 expose it.

## 1. Runtime-lane W6 walls ranked, with the language feature behind each

Column key (all from the 11-03 map and its census rows, master `6990d63b02`, runtime-on lane):
- **A** scripts touched (`runtimeOn.walls.byScript`, wave by `targets.py::rt_wave`).
- **B** step-0 scripts (`runtimeOn.walls.first`: the wall on the unpeeled source; no instrument effect).
- **C** census peel steps behind it.

| # | wall | A | B | C | language feature behind it (sub-shapes, scripts) | task |
|---:|---|---:|---:|---:|---|---|
| 1 | `runtime:array` (`FE:192`, raised `FE:6240`, `FE:9802`, family `FE:5110-5115`) | 22 | 8 | 89 | **Missing collection members**, three families: `matrix.*` 6 (`matrix.new` in all six; then `get`/`set`/`rows`/`columns`/`add_row`/`col`); `map.new` 3; missing `array.*` 13: `insert` 5, `fill` 4, `binary_search_*` 2, `sort` 1, `standardize` 1, `join` 1, `range` 1 (the doc script `functions` adds `covariance`, `lastindexof`, `mode`, `variance`). | T5 (array), T7 (matrix), T8 (map) |
| 2 | `runtime:loop` (`FE:189`) | 18 | 8 | 33 | `for … in` (`FE:8854-8857`) in 16: over a user array (`for gap in allGaps`), a UDT array, a drawing array, `label.all` / `polyline.all`, and the tuple form `for [i, v] in arr`. The other 2 are a v6 `for` whose body pushes onto the array its `to` bound reads (`FE:8899-8912`, Q-A1). | T6; T11 (the 2) |
| 3 | `pine:type` (`pine.js:318`, raised `pine.js:8921-8930`) | 8 | 0 | 10 | **The receiver's type is not known** to the shared resolver: a user method on a UDT (`points.first()`, `points.updatePivot(…)`), a built-in member on a collection held in a UDT field or parameter (`lt_v.size()`, `bullish_recent.avg()`, `previos_detail_close.size()`), a field read in a loop bound (`htfBar.leftIndex`). Two are the namespace mis-read (finding 3), two are library types (W8). | T9; T2 (the 2); W8 |
| 4 | `pine:member` (`pine.js:328`) | 6 | 1 | 8 | **A member read off an expression's result**: `allGaps.shift().delete()`, `fvg_bull.get(i).get_bottom()`, `array.get(bk, i).live`, `copy.get(0).strength`, `f_rt(…).mc().ha()`. One is a library constructor chain (`chr.DateTimeWindow.new().init(…)`, W8). | T9 |
| 5 | `pine:collection` (`pine.js:287`) | 5 | 1 | 12 | **Mis-waved** (finding 3): lower-timeframe arrays (W7) and an order strategy (W9). No W6 language work. | T1 (relabel) |
| 6 | `runtime:udt-method` (`FE:290`, raised `FE:8808-8818`) | 3 | 1 | 6 | **Overloaded methods**: `method clear(array<string> id, …)` and `method delete(DexterDev DV)` declared beside a same-named method or function; Pine picks by receiver type (`bindableMethod`, `FE:1277`). Plus the v3 `method =` binding (finding 3). | T9; T2 (the v3 one) |
| 7 | `enum`, `input.enum` | 0 | 0 | 0 | Not reached (finding 5). `input.enum` is `UNSERVED` in `RT/runtimeInputs.js:65-67`; an `enum` statement has no arm in the FE statement walk. | T10 |

**Per-task yield on this census** (11-03, before W4). "Upper" = the scripts whose ONLY remaining walls
are this task's; "firm" = those whose walls were fully enumerated (census `reachedAfterPeel`). "+W4" =
the same, allowing W4 walls too (W4 lands first).

| task | scripts touched | upper (firm) | upper (firm) with W4 | rows |
|---|---:|---:|---:|---|
| T2 keyword and namespace honesty | 2 | 1 (0) | 1 (0) | `price-divergence-detector-v32-…` (stuck `no-progress`, so not firm); `technical-ratings` moves its first wall |
| T5 `array.*` completion | 13 | 1 (1) | 4 (3) | `range-filter-dw`; +W4 `bollinger-band-width-percentile`, `machine-learning-moving-average-backquant`, `session-tpo-profile` |
| T6 `for … in` | 16 | 2 (2) | 5 (3) | `trendline-pivots-quantvue`, `order-block-detector-luxalgo`; +W4 `trading-sessions` (built-in), `atr-god-strategy-by-tradesmart`, `market-structure-break-order-block` |
| T7 `matrix.*` | 6 | 1 (1) | 2 (1) | `one-sided-gaussian-support-resistance-rate-loxx`; +W4 `supertrend-cluster-zeiierman` |
| T8 `map.*` | 3 | 0 | 1 (0) | +W4 `supply-demand-mtf-flux-charts` |
| T9 receiver types | 14 | 0 | 1 (0) | +W4 `trend-speed-analyzer-zeiierman` |
| T11 v6 per-pass bound | 2 | 0 | 0 | first wall moves on `support-resistance-mtf-flux-charts`, `support-and-resistance-zones-feels` |
| T10 `enum` | 0 | 0 | 0 | unmeasured |
| **all of W6** | 56 | **5 (4)** | **15 (7)** | firm with W4: `bollinger-band-width-percentile`, `machine-learning-moving-average-backquant`, `market-structure-break-order-block`, `one-sided-gaussian-…`, `range-filter-dw`, `trendline-pivots-quantvue`, `order-block-detector-luxalgo` |

Scripts carry walls in combination: `momentum-terrain-3d-luxalgo` needs T6 + T7, `support-resistance-mtf-
flux-charts` T8 + T11, `gaps` (built-in) T6 + T9. Judge every landing by wall counts moving.

## 2. What exists, by feature: the runtime lane vs the host lane

W6 reuses before it builds. "One semantic source" means: a rule TradingView pins is written once, and
both lanes either import it or are railed against the same capture.

| feature | runtime lane on master (RT/FE) | host lane on master (HOST) | prior branches (`git merge-base --is-ancestor … origin/master`) |
|---|---|---|---|
| `array.*` values | **Built.** `RT/collections.js`: 34 members (`ARRAY_FNS`, `:480-631`; typed `new_*` `:472`; `from`, `sort_indices`, `first`/`last`/`shift`/`pop`/`unshift`/`remove`/`concat`/`indexof`/`includes`/`max`/`min`/`sum`/`avg`). Measured rules: out-of-range stops (`:89-99`), v6 negative index (`:83-92`, `vw-array-na`), `na` skipped by reductions (`:199-235`, `vw-array-na`, `vw-rt7-empty-reduce-fixnan`), `na` never found (`:290-297`). Unmeasured fills held as `UNFILLED` (`:112-134`). `array.slice` as a guarded copy (`:259-273`). `array.median`/`array.stdev` compile and stop when reached (`:275-288`, `:619-620`). VM `OP.ARRAY` (`RT/vm.js:970-993`), budgets `ARRAY_ELEMENTS` 100,000 and `ARRAY_OPERATIONS` (`RT/limits.js:133-134`). | Bounded numeric windows read as series (C32, `pine.js:9032-9400`, refused `pine:collection` otherwise); drawing lists in the object lane (C11b/C16, `pineObjects.js:298+`). | `pine/c11-arrays`, `c11b-object-collections`, `c32-collections`, `h3-host-collections`: all merged. **`pine/w19-r2-collections-drawings` is NOT merged** (146 commits ahead, based 2026-10-04): commit `794bfb02f3` adds `array.fill`/`array.insert` to `RT/collections.js` (`W19R2_MEMBERS`) from the Pine manual's Arrays text, with probe `vw-w19r2-collections.pine` and queue rows Q-W19R2a/b. T5 ports it. |
| method form `a.size()` | **Built.** `ast/ufcs.js` (shared by both lanes, decides no legality). FE rewrites when the receiver slot is marked `collection` (`FE:6219-6244` value, `FE:9783-9806` statement), but the family is hard-coded: `methodFormCall(node, () => 'array', …)`. | Same `ufcs.js` for drawings and arrays (`pineObjects.js:34`, `:370-392`). | `pine/ufcs-method-form` merged. |
| UDT `type`, `Foo.new`, fields | **Built.** `collectUdtTypes` (`FE:515-542`), `lowerRecordNew` with defaults and named args (`FE:3236-3282`), field paths (`FE:3194-3220`), a drawing in a field (`FE:3296-3317`), element type of `array<Foo>` (`FE:3334-3360`); values in `RT/records.js` (`udtRecord`, `fieldGet`, `fieldSet`); VM `OP.RECORD`/`FIELD_GET`/`FIELD_SET` (`RT/vm.js:997-1025`). | Refused: `TYPE_KEYWORDS` (`pine.js:2850`, note at `:25004`) and `typeRefusalFor` (`pine.js:8921-8930`). | `pine/udt-types`, `c11c-loops-udts` merged. `pine/h6-host-state-udt` (host: a field read off a constant instance, `ast/udtConstFields.js`) is **not merged** (4 ahead). RT14 ("a record's type follows it through a user call and out of a global array", `874f7855bd`) is only on `w19-r2`. |
| `method` declarations | **Built for one declaration per name:** `bindableMethod` (`FE:1277`), `methodCallOf` (`FE:1285-1291`), the definition is `defineFunction` with the keyword dropped (`FE:8808-8818`). Overloads refuse `runtime:udt-method`. | Yields to a user definition (`pineObjects.js:370-392`). | `ufcs-method-form` merged. |
| static types | **Ad hoc flags per slot**: `collection`, `elemText`, `elemUdt`, `udt`, `colour`, `text`, drawing family, set at three binding sites (`FE:9449-9451`, `FE:9671-9673`, parameters `FE:10000-10012`), read by `holdsArray` (`FE:3048`), `udtTypeOf` (`FE:3103`), `udtElemOf`, `arrayHoldsText` (`FE:2551`). No expression type: an element read (`a.get(i)`) or a call result has no type, which is what `pine:member` reports. | None (`pine:member` sentence says so). | none |
| generics `<T>` | Lexed: `stripTypeArguments` keeps the type argument on the head token (`pine.js:2965-3010`, `GENERIC_CALL_HEADS` = `array.new`/`matrix.new`/`map.new`). Read for `array<Foo>` element types only. | Same lexer. | none |
| `for … in` | **Refused** `runtime:loop` (`FE:8854-8857`). Plain `for`/`while` built (`FE:8858-9000`, `RT/lowerIr.js` `STMT.FOR` `:599`, `STMT.WHILE` `:661`). | **Built on the host object lane** (C40/C48, `pineObjects.js:1595-1700`): over a held list, a bounded numeric window, `line.all`/`box.all`/`label.all`; the live-list rule for `push`/`shift`/`set` (`FOR_IN_LIVE_WITNESSED`), `<family>.all` as a snapshot; other mutations refused (`forInRefused`). Rails `__tests__/objectForInLoops.test.js`, `vendorHarness.c40ForIn.test.js`. | `pine/c40-forin-collections` merged. |
| `matrix.*`, `map.*` | Refused `runtime:array`. | None. | none |
| `enum`, `input.enum` | No arm; `input.enum` `UNSERVED` (`RT/runtimeInputs.js:65-67`). | `TYPE_KEYWORDS` note `pine:type`. | none |

Captures already taken that W6 reuses (fixtures under `tests/fixtures/vendor/harness/`):
`vw-array-na-spy-1d-2026-10-02`, `vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04`,
`vw-int-array-avg-spy-1d-2026-09-30`, `vw-int-array-avg-neg-spy-1d-2026-10-01`,
`vw-forin-collections-rddt-1d-2026-10-01` (F01-F05, A01-A06, W01, Z01-Z03; served on the host lane) and
`vw-forin-collections-2-rddt-1d-2026-10-02` (G01-G07 mutations by `remove`/`pop`/`unshift`/`insert`/
`clear`/reassign/helper, S01-S03, P01). The second fixture is committed, but the host lane still refuses
those mutations and `objects-triage-2026-09-28.md:4063` still lists them as needing it; see section 7.

## 3. Rules every W6 task follows

W4-BREAKDOWN section 2 applies unchanged. In short, with what is specific to W6:

1. **Built dark, merged without waiting for arming.** The runtime pane is dark (`runtimePaneEnabled()`,
   kill list, allowlist; `memberPaneDefinition.js:1273-1296`).
2. **The C18 object door is LIVE and must build exactly what master builds.** Every new lowering calls
   `objectDoorRefuses(…)` (`FE:1102-1106`) first when `atObjectDoor`. This matters most for `for … in`
   (T6): the host object lane already serves it for drawing scripts, so the door must keep refusing a
   runtime `for … in` unless measure-pair shows the door's output identical. Rail:
   `RT/__tests__/objectDoorGate.test.js` gets a case per new capability. measure-pair must show **0 C18
   verdict diffs**.
3. **The stage-1 script must not move** (`adx-and-di-for-v4`); `runtimeAllowlistParity.test.js` once W2
   merges.
4. **Refuse by name what no capture settles.** Where the Pine reference states a rule exactly (a formula,
   an index rule), a reference-formula rail is enough (WAVE-TASKS 1.1). Where it does not (na placement in
   a sort, map order after a re-put, a matrix created with `na` rows, a runtime error's trigger), the
   sub-shape keeps a by-name refusal and a row in the W6 queue (section 5). A runtime error Pine raises is
   served as a stop by name (`CollectionError`, `RecordError`), never as `na`.
5. **One authority per value.**
   - Collection semantics live in `RT/collections.js` and its new siblings `RT/matrices.js` and
     `RT/maps.js`, imported by the VM through ONE dispatch table. The server runtime (W5) runs the same JS
     (SERVER-RUNTIME-DESIGN 2), so no Python mirror is written for collections.
   - A value's static type has ONE owner after T3 (`slotType` / `exprType`). No task adds another
     per-slot boolean.
   - The `for … in` walk rule (live list vs snapshot, which mutations are witnessed) is ONE table,
     exported from a shared module and read by both `pineObjects.js` and the FE (T6).
   - `ufcs.js` stays the only method-form rewrite; it gains a family callback, not a roster.
6. **Engine version.** A task that turns a refusal into a served value changes door outcomes: the
   coordinator bumps `SCRIPT_ENGINE_VERSION` once per merge. `RUNTIME_FRONTEND_VERSION` (`FE:177`) is not
   bumped: no served shape changes meaning. Each bump regenerates W5's host-parity digests once W5 T4 is in.
7. **Ship loop** per WAVE-TASKS section 1: rails red before, green after; every guard mutation-proved
   (`docs/pine/parity-programme/scripts/mutate.py`); independent Opus review GO; measure-pair runtime-on
   with every intended diff classified; deploy-gate pytest and hygiene.
8. **No heavy job outside the lock.** Targeted vitest files only, `--maxWorkers=2`.
9. **W3 owns `ast/pine.js`.** A W6 fix whose natural home is the shared `Resolver` (`typeRefusalFor`,
   `pine:member`) is made on the runtime side (the FE resolves the name before it reaches the resolver),
   or is coordinated with W3 as a one-function change with W3's reviewer.

## 4. Tasks

Sizes: S ≤ 1 day, M 2-3 days, L 4-6 days. Model tiers per AGENT-RULES: **Sonnet** builds from a precise
spec; **Opus** builds engine-semantic and type-system work and does every merge-gating review; **Fable**
only after Opus fails twice; **Haiku** list and log chores.

Terms: **rows** are runtime-on census keys; **first wall moves** = the step-0 wall changes; **attach** =
the script attaches on the runtime lane.

### T1 Instrument: re-wave the mis-labelled W6 guards (tooling only) | S | Haiku/Sonnet

- **Files:** `tools/pine_coverage/coverage_map.py` (the tag pass beside W4 T0's `for-in`/`bare-security`
  tags), `tools/pine_coverage/w0/targets.py` (`rt_wave`, `:44-75` on the peel branch). No `app/src` file.
- **What:**
  - Tag `pine:collection` whose detail is "nothing in this script creates it" and whose name is the target
    of a `request.security_lower_tf` in the unpeeled source as `ltf-array` → W7.
  - Tag `pine:type` / `pine:member` whose head is an `import` alias, or a type the library exports, as
    `library` → W8.
  - Tag `pine:collection` on an order strategy → W9 (as W4 T0 did for `runtime:no-output`).
- **Acceptance:** fixture rows for each tag; `--check` on the targets regenerates.
- **Mutations:** drop the `ltf-array` tag: the fixture's row returns to W6.
- **measure-pair:** no engine diff. The next W0 run: W6 blocks 56 → about 50 (5 `pine:collection` rows and
  the library-only `pine:type`/`pine:member` rows leave W6).
- **Engine bump:** no. **Depends:** W4 T0 merged (same files). **Captures:** none.

### T2 Keyword and namespace honesty | S | Sonnet

- **Files:** FE statement walk `method` arm (`FE:8808-8818`) and `scanDefs` (`FE:1252-1270`, where
  `methodDecls` is counted); the FE name lowering that hands dotted names to the shared resolver
  (`FE:5535-5560` band); rail `RT/__tests__/w6KeywordHonesty.test.js`.
- **What:**
  1. `method` is a declaration only in the shape `method <ident>(`. `method = …`, `method := …` and
     `method` as an argument are an ordinary name, in every version, exactly as `type = input(…)` already is
     (`FE:8777-8785`, `collectUdtTypes`). The same test for `enum`.
  2. A dotted name `ns.member` whose head is bound as a plain (non-UDT, non-collection) local or parameter,
     and whose whole spelling is a Pine built-in namespace member (`timeframe.period`,
     `timeframe.change`), resolves to the built-in. Pine compiles TradingView's own Technical Ratings with
     a `timeframe` parameter and `timeframe.period` in its body, which is the witness.
- **Pine semantics:** `method` and `type` arrived in v5 and `enum` in v6 (v5/v6 migration guides,
  https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/); a v3 script cannot
  mean the keyword. Namespaces: https://www.tradingview.com/pine-script-docs/language/identifiers/
- **Acceptance:** a v3 `method = input(…)` binds and reads; a v6 `method m(float x) =>` still binds as a
  method; `f(string timeframe) => timeframe.period` reads the chart period; a UDT local named like a
  namespace (`type Info` / `Info timeframe = …` / `timeframe.field`) still reads the field.
- **Mutations:** make `method =` a declaration again: the v3 rail goes red; resolve any bound head as a
  namespace: the UDT-field control goes red.
- **measure-pair:** first wall moves on `price-divergence-detector-v32-revised-by-justunclel`,
  `technical-ratings`. Attach expected: `price-divergence-detector-v32-…` (its only wall).
- **Engine bump:** yes. **Depends:** none. **Captures:** none. **Rebase risk:** low (`FE:1252-1270` is
  near W4 T1's `:1225` hunk and T15's `:1531-1546`; disjoint lines).

### T3 One static type per value: `slotType` and `exprType` | M | Opus build

The foundation for T6-T10. It is a refactor with no served change.

- **Files:** FE binding sites that set the per-slot flags (`FE:9440-9452` `var` branch, `FE:9664-9673`
  plain binding, parameters `FE:10000-10012`), the readers `holdsArray` (`FE:3048`), `udtTypeOf`
  (`FE:3103`), `udtElemOf` (`FE:3334-3360`), `arrayHoldsText` (`FE:2551`), `untypedParamArrayCall`
  (`FE:1647`), the method-form sites (`FE:6219-6244`, `FE:9783-9806`); `ast/ufcs.js` (`methodFormCall`'s
  family callback); rail `RT/__tests__/w6TypeDescriptor.test.js`.
- **What:**
  1. `slots[s].ty = { kind: 'array'|'matrix'|'map'|'udt'|'drawing'|'enum'|'num'|'text'|'colour'|'bool',
     elem?, key?, name? }`, read from the declared type first (`array<Foo>`, `map<string, float>`,
     `Foo f = …`), else from the initialiser. The old flags (`collection`, `elemText`, `elemUdt`, `udt`)
     become getters over it during the transition, then are removed in the same task.
  2. `exprType(node, scope)`: the type of a name, a field path, a collection read (`array.get` → `elem`,
     `matrix.get` → `elem`, `map.get` → value type), a user function's declared result type, a `Foo.new`.
     It answers `null` when it cannot tell; a caller that needs a type refuses by name on `null`.
  3. `ufcs.methodFormCall`'s family callback returns `exprType(receiver).kind` instead of the constant
     `'array'`. With only arrays served, behaviour is identical.
- **Pine semantics:** Type system, Collections, Objects:
  https://www.tradingview.com/pine-script-docs/language/type-system/ ,
  https://www.tradingview.com/pine-script-docs/language/objects/
- **Acceptance:** measure-pair shows **zero** census, harness and C18 diffs (a pure refactor). The rail
  pins `exprType` on each shape above, and `null` on an untyped parameter and on a call to an undeclared
  function.
- **Mutations:** answer `'array'` for every collection: the map/matrix descriptor rails go red; drop the
  declared-type-first rule: `array<float> a = na` loses its element type and the rail goes red.
- **measure-pair:** no intended diff.
- **Engine bump:** no. **Depends:** the W4 train tip. **Captures:** none.
- **Rebase risk: HIGH.** W4 T12 (`feat/pine-w4-t12-paint`) adds colour-array marks at `FE:9450`, `:9672`,
  `:10009` (the same three binding sites) and edits `holdsColour` (`FE:2598`, `:2660`); W4 T13 carries the
  same hunks. Build T3 on the train tip, not on master.

### T4 (folded into T3)

"Generics" in Pine v6 means typed collections (`array<T>`, `matrix<T>`, `map<K, V>`, a UDT field of a
collection type). There are no user-declared type parameters. It is T3's descriptor plus each family's
element-type rails; no separate build.

### T5 `array.*` completion | M | Sonnet | partly capture-gated

- **Files:** `RT/collections.js` (new members only, plus `ARRAY_WRITES` `:667-678` and the `READS_ALL` /
  `HANDS_BACK` sets `:655-659`); FE only if a member needs an argument the FE does not lower today
  (`order.*` is at `FE:81-84`); rail `RT/__tests__/w6ArrayMembers.test.js`.
- **What:**
  1. **Port `794bfb02f3`** (`pine/w19-r2-collections-drawings`): `array.fill(a, v[, from[, to]])` with
     `0 ≤ from ≤ to ≤ size`, `to` exclusive, `na` = end; `array.insert(a, i, v)` with `0 ≤ i < size`. Its
     rail `w19r2Collections.test.js` comes with it. Cherry-pick the collections half only; the gradient
     fill half belongs to W4 T12's paint work.
  2. Reference-formula members (exact from the reference text): `array.reverse`, `array.lastindexof`,
     `array.range` (max − min over real elements), `array.abs`, `array.join` (text elements; numeric
     elements only after W6-A1), `array.variance` / `array.stdev` / `array.covariance` with the `biased`
     parameter (default `true`, population form), `array.median`, `array.mode` (smallest of the most
     frequent), `array.standardize`, `array.percentrank`, `array.percentile_linear_interpolation`,
     `array.percentile_nearest_rank`, `array.sort` and `array.sort_indices` on real numbers and on text, v6
     `array.every` / `array.some`. `array.median`/`array.stdev` leave `unmeasuredReduction` once railed.
  3. Kept refused by name until a capture: `na` placement in `array.sort`, numeric formatting in
     `array.join`, ties in `array.mode`, an `na` element in the statistics members, `insert`/`fill` at the
     indices the manual does not settle (Q-W19R2a), the three binary searches (Q-W19R2b).
  4. `array.slice` as a view (write-through) stays refused (`:259-273`); out of scope.
- **Pine semantics:** Arrays: https://www.tradingview.com/pine-script-docs/language/arrays/ ;
  reference entries https://www.tradingview.com/pine-script-reference/v6/#fun_array.sort and siblings.
- **Acceptance:** one reference rail per member with an `na`-free fixture; the existing `vw-array-na`
  rails still pass; every kept refusal has a rail that reaches it.
- **Mutations:** make `fill`'s `to` inclusive: the manual-example rail goes red; make `stdev` unbiased by
  default: its rail goes red; let `sort` place `na` first: the by-name refusal rail goes red.
- **measure-pair:** first wall moves on `auto-trendlines-tradingfinder-…`, `bollinger-band-width-
  percentile` (only after Q-W19R2b), `initial-balance-…`, `machine-learning-moving-average-backquant`,
  `market-sessions-and-volume-profile-by-leviathan`, `range-filter-dw`, `session-tpo-profile`,
  `smart-money-concept-tradingfinder-…`, `supertrend-relative-volume-kernel-optimized-flux-charts`,
  `volume-open-interest-footprint-by-leviathan`, `footprint`, `rsi-kernel-optimized-flux-charts`,
  `vp-period`. Attach expected: `range-filter-dw`.
- **Captures:** Q-W19R2a, Q-W19R2b (probe exists on the w19 branch; port it to master with the rows),
  W6-A1 (new). **Engine bump:** yes. **Depends:** none (it can start before T3).
- **Rebase risk:** low. `RT/collections.js` is untouched by every W4 lane (section 6).

### T6 `for … in` on the runtime lane | M | Opus build

- **Files:** FE statement walk (`FE:8847-8857`, the refusal, and the `for` lowering it sits before,
  `FE:8858-9000`); `RT/lowerIr.js` (`STMT.FOR` `:599-660` reused through a hidden index slot, no new op);
  a new shared module `ast/forInRule.js` exporting the walk rule (`FOR_IN_LIVE_WITNESSED`, the snapshot
  families) moved out of `pineObjects.js:1611-1614`, and the import in `pineObjects.js`; rails
  `RT/__tests__/w6ForIn.test.js` and `__tests__/vendorHarness/vendorHarness.w6ForInRuntime.test.js`.
- **What:**
  1. `for x in coll` and `for [i, x] in coll` lower to a counter `i` over the LIVE collection: the length
     is re-read before every pass and slot `i` is read when the pass reaches it (C48, F03-F05). `x` takes
     the element type from `exprType` (T3), so `for ob in obs` / `ob.top` reads a record field.
  2. Collections: a user array (any element kind, drawings included as opaque handles), `line.all` /
     `box.all` / `label.all` / `polyline.all` as a SNAPSHOT taken when read (A02-A06), a matrix (one pass
     per row, `x` an array; after T7), a map (`for [k, v] in m`, insertion order; after T8).
  3. Mutations of the walked collection inside the body: `push`, `shift`, `set` are served (witnessed);
     everything else is refused by name with the host lane's sentence until the G-rows are read (section 7).
  4. `break` / `continue` as in `for` (`RT/lowerIr.js` already handles them).
  5. A `for … in` that is the last statement of a function body yields its last value (as W4 T15's
     `loopSink` does for `for`), and in a function body every call site walks its own collection.
  6. At the object door, `objectDoorRefuses('for … in', …)` first, unless measure-pair proves the door's
     output identical on every census row that has one.
- **Pine semantics:** Loops, "`for…in`": https://www.tradingview.com/pine-script-docs/language/loops/ .
  Witnessed: `vw-forin-collections-rddt-1d-2026-10-01`.
- **Acceptance:** `vw-forin-collections` F01-F05 and A01-A06 MATCH through the runtime lane (the new
  vendor harness file, runtime-on), and the host lane's `objectForInLoops.test.js` is unchanged while it
  now imports `forInRule.js`. An empty collection runs no pass. A `remove` in the body refuses by name.
- **Mutations:** read the length once: F04 (13 passes) goes red; walk `box.all` live: A04 goes red; admit
  `remove` without a row: the refusal rail goes red; skip the door refusal: `objectDoorGate` goes red.
- **measure-pair:** first wall moves on all 16 `for … in` rows (section 1 #2). Attach expected:
  `trendline-pivots-quantvue`, `order-block-detector-luxalgo`; with W4: `trading-sessions` (built-in),
  `market-structure-break-order-block`, `atr-god-strategy-by-tradesmart` (a strategy: attaches, never a
  transfer, W9).
- **Captures:** none for the served half; W6-F1 for the shapes no row shows yet (section 5).
- **Engine bump:** yes. **Depends:** T3; T7/T8 for the matrix/map halves (land them as follow-ups).
- **Rebase risk: HIGH.** W4 T15 (`feat/pine-w4-t15-fn-forms`) rewrites the `for` body lowering at
  `FE:8896` (`loopSink`, the value of a loop) and inserts at `:8858`, `:8955`, `:8973`; W4 T7/T8 touch
  `lowerStmts` at `:8663`, `:8679`. Build on the train tip and reuse T15's `loopSink`, do not copy it.

### T7 `matrix.*` | M | Sonnet | partly capture-gated

- **Files:** new `RT/matrices.js` (value, members, kind `'matrix'` in `kindOf`), the dispatch in
  `RT/collections.js`'s exported table (one table, one VM op `OP.ARRAY` renamed in comments only), FE
  admission through `admitArrayCall` (`FE:3392-3430`) generalised to the family T3 reports, `ARRAY_NS`
  (`FE:435`) unchanged; budgets `RT/limits.js` (a matrix counts its cells against `ARRAY_ELEMENTS`;
  never raised); rail `RT/__tests__/w6Matrix.test.js`.
- **What:** the corpus roster first (finding 4): `matrix.new<T>(rows, cols, initial)`, `get`, `set`,
  `rows`, `columns`, `add_row`, `add_col`, `remove_row`, `remove_col`, `row`, `col`, `min`, `max`, `avg`,
  `sum`, `submatrix`, `copy`, `fill`, `elements_count`; the method form. Out-of-range stops by name (as
  arrays do). The linear-algebra members (`det`, `inv`, `mult`, `eigen…`, `pinv`, `rank`, `kron`, …) stay
  refused by name; no sample script reaches them.
- **Pine semantics:** Matrices: https://www.tradingview.com/pine-script-docs/language/matrices/ ;
  reference `matrix.new` and siblings.
- **Acceptance:** reference rails per member; `row`/`col` return COPIES (the manual says so), railed by a
  write to the copy; a matrix is a reference (`m2 = m` aliases; only `matrix.copy` copies), railed as
  `arrays.test.js` rails arrays.
- **Kept refused until W6-M1:** `matrix.new` with `na` rows or columns (`candlestick-patterns-on-backtest`
  writes `matrix.new<float>(na, n, na)`), `add_row` with an array of the wrong length, `min`/`max`/`avg`
  over `na` cells.
- **Mutations:** make `col` a view: the copy rail goes red; answer `na` out of range: the stop rail goes red.
- **measure-pair:** first wall moves on `pivot-points-standard` (built-in), `bull-vs-bear-market-intraday-
  sessions-kioseff-trading`, `candlestick-patterns-on-backtest`, `one-sided-gaussian-support-resistance-
  rate-loxx`, `momentum-terrain-3d-luxalgo`, `supertrend-cluster-zeiierman`. Attach expected:
  `one-sided-gaussian-…`.
- **Captures:** W6-M1. **Engine bump:** yes. **Depends:** T3.
- **Rebase risk:** medium. `FE:435` sits beside W4 T10's hunk at `:433` (`feat/pine-w4-t10-state-kernels`);
  `admitArrayCall` (`FE:3392-3430`) is near W4 T7/T8's `:3638` (disjoint).

### T8 `map.*` | M | Sonnet | partly capture-gated

- **Files:** new `RT/maps.js` (kind `'map'`), the same dispatch table, FE admission as T7; rail
  `RT/__tests__/w6Map.test.js`.
- **What:** `map.new<K, V>()`, `put` (returns the previous value or `na`), `get` (`na` for a missing
  key), `contains`, `remove` (returns the removed value or `na`), `size`, `keys`, `values` (new arrays, in
  insertion order), `copy`, `clear`, `put_all`; the method form. Keys are the primitive types the manual
  lists (int, float, bool, string, color, and enum after T10). A map holds at most 50,000 pairs (manual);
  past that the run stops by name.
- **Pine semantics:** Maps: https://www.tradingview.com/pine-script-docs/language/maps/ ("maps maintain
  the insertion order of their keys").
- **Acceptance:** reference rails for every member; insertion order of `keys()`; a map is a reference.
- **Kept refused until W6-K1:** the order of `keys()` after `put` of an EXISTING key (kept in place, or
  moved to the end), and a float key that is `na`.
- **Mutations:** sort `keys()`: the insertion-order rail goes red; return the new value from `put`: its
  rail goes red.
- **measure-pair:** first wall moves on `supply-demand-mtf-flux-charts`, `support-resistance-mtf-flux-
  charts`, `divergence-screener-trendoscope`.
- **Captures:** W6-K1. **Engine bump:** yes. **Depends:** T3.
- **Rebase risk:** as T7.

### T9 Receiver types: overloaded methods, member chains, methods on any typed receiver | M | Opus build

- **Files:** `bindableMethod` / `methodCallOf` (`FE:1277-1291`), `scanDefs` method counting
  (`FE:1252-1270`), the `method` arm (`FE:8808-8818`), `defineFunction` (`FE:9918-10230`; a method's
  definition is registered under `name + receiver type`), the call lowering for dotted calls
  (`FE:6205-6245` band), the name lowering for field paths (`fieldPathOf` `FE:3194-3220`); rail
  `RT/__tests__/w6ReceiverTypes.test.js`.
- **What:**
  1. **Overloads.** Methods are keyed by `(name, receiver type)`. A call `recv.m(…)` resolves by
     `exprType(recv)`; a user method wins over a built-in member of the same name only for its own receiver
     type (the `ufcs.js` shadowing rule, now typed). An untyped receiver still refuses by name.
  2. **Chains.** `a.get(i).field`, `a.get(i).set_x(…)`, `f(…).m()`, `array.get(bk, i).live`: the receiver
     of each step is the previous step's `exprType`. A step that hands back a drawing goes to the object
     program exactly as a named handle does (`allGaps.shift().delete()`), or refuses `runtime:object-op`.
  3. **Built-in members on collections held anywhere typed:** a UDT field (`ob.levels.size()`), a typed
     parameter, an element of an `array<array<…>>` is refused (Pine has no nested collections; a UDT
     wrapper is the idiom).
  4. **UDT values completed where the corpus reaches them:** `Foo.copy(f)` / `f.copy()` (shallow), `na`
     record tests (`na(f)`), a field read off an `na` record stops by name (Pine raises a runtime error).
- **Pine semantics:** User-defined methods and objects:
  https://www.tradingview.com/pine-script-docs/language/methods/ ,
  https://www.tradingview.com/pine-script-docs/language/objects/
- **Acceptance:** two `method clear` over `array<string>` and `array<float>` each run on their own
  receiver; a chain over an element of `array<Foo>` reads the field; an untyped receiver refuses; a field
  of an `na` record stops.
- **Kept refused until W6-U1:** dispatch between a user method and a built-in member of the same name on
  the SAME receiver type, and the error text/bar of a field read off `na`.
- **Mutations:** dispatch by declaration order instead of type: the overload rail goes red; drop the
  copy in `Foo.copy`: the aliasing rail goes red.
- **measure-pair:** first wall moves on `fx-market-sessions`, `ipda-standard-deviations-…`, `gaps`
  (built-in, with T6), `multi-timeframe-fvg-tfo`, `enhanced-mcclellan-summation-index`,
  `machine-learning-supertrend-aslan`, `support-and-resistance-zones-feels`, `higher-time-frame-fair-
  value-gap-zeroherotrading`, `smart-money-volume-activity-algoalpha`, `stop-loss-clustering-breakouts-
  kioseff-trading`, `footprint-strategy`, `trend-speed-analyzer-zeiierman`.
- **Captures:** W6-U1. **Engine bump:** yes. **Depends:** T3.
- **Rebase risk: HIGH.** `defineFunction` (`FE:9918-10230`) is edited by W4 T7/T8 (`:9978`,
  `:10195-10262`), T12/T13 (`:10096-10239`) and T15 (`:9964`, `:10097-10158`); T15 also edits `:1531-1546`
  near `bindableMethod`.

### T10 `enum` and `input.enum` | M | Sonnet | partly capture-gated

- **Files:** a pre-pass `collectEnums` beside `collectUdtTypes` (`FE:515-542`); the statement walk (an
  `enum` arm beside `type`, `FE:8786-8794`); name lowering for `E.member` (`FE:5535-5560` band, where
  object enums already lower to string constants); `RT/runtimeInputs.js` (`UNSERVED` `:65-67`, and the
  input default path); rail `RT/__tests__/w6Enum.test.js`.
- **What:** an `enum E` declaration with members and optional titles; `E.member` is a constant of type
  `E` (T3 descriptor kind `'enum'`), compared with `==`/`!=`, used in `switch`, as a map key (T8), in a
  collection; `input.enum(E.member, …)` at the value in force (the member's chosen option once the member
  input UI carries it, the default until then).
- **Pine semantics:** Enums: https://www.tradingview.com/pine-script-docs/language/enums/ ; reference
  `input.enum`.
- **Kept refused until W6-E1:** `str.tostring(enumValue)` (does it give the title or the member name),
  an `na` enum value, and the member pane knob for `input.enum` (that is the input UI's work, owned with
  W2's member inputs; until then a member-set enum input refuses by name and the default serves).
- **Acceptance:** rails for each served shape; an `enum` declared after its first use still binds (the
  pre-pass, as `collectUdtTypes` does for types).
- **Mutations:** compare enums by title: the two-members-same-title rail goes red.
- **measure-pair:** no census row moves today (finding 5); the rails are the measure. Re-count after W4.
- **Captures:** W6-E1. **Engine bump:** yes. **Depends:** T3; T2 (the `enum =` binding rule).
- **Rebase risk:** low (`FE:515-542` and `FE:8786` are untouched by W4; `FE:5535-5560` is untouched).

### T11 v6 per-pass `for` bound | S | Sonnet | capture-gated

This guard is W4-labelled (`runtime:loop` without `for-in`), but both scripts it blocks reach it through
array growth, and W4-BREAKDOWN did not schedule it.

- **Files:** `RT/lowerIr.js` `STMT.FOR` (`:599-660`), FE `forBoundMovedBy` (`FE:8529`) and its refusal
  (`FE:8899-8912`); rail `RT/__tests__/w6ForBound.test.js`.
- **What:** in v6, re-lower the `to` bound inside the loop test so it is read before every pass, and
  `by` per Q-A1's L06; v5 keeps the read-once bound. Then lift the `forBoundMovedBy` refusal.
- **Pine semantics:** v6 migration guide, "Dynamic `for` loop boundaries".
- **Acceptance:** Q-A1 L02-L06 MATCH (probe `tools/visual_conformance/probes/vw-v6-for-bound.pine`,
  exists, uncaptured); v5 still reads once.
- **Mutations:** apply the re-read to v5: the v5 rail goes red.
- **measure-pair:** first wall moves on `support-resistance-mtf-flux-charts`, `support-and-resistance-
  zones-feels`.
- **Captures:** Q-A1. **Engine bump:** yes. **Depends:** Q-A1; the train tip.
- **Rebase risk: HIGH** as T6 (`FE:8896` is W4 T15's).

### Deferred (not W6 builds)

- `array.slice` as a write-through view: a different storage model; no census row needs it.
- Matrix linear algebra (`det`, `inv`, `mult`, `eigen…`, `pinv`, `rank`, `kron`, `trace`, `pow`): no
  sample script reaches them.
- `export type` / `export method` / `export enum`, and library types read through an alias: W8.
- `varip` holding a collection or a record: refused today (`FE:8836-8846`), needs the tick feed (W4 F).
- Lower-timeframe arrays (`request.security_lower_tf`): W7. Order strategies: W9.

## 5. What can run in parallel

The front end is one closure. "Region" means a function or line band at `646dca8cbf`. Two tasks in the
same file in disjoint regions can run together; the later one rebases onto the earlier's merge.

| task | files / regions it owns | W4 lanes that touch the same region (branch: master-side hunk lines) |
|---|---|---|
| T1 | `tools/pine_coverage/coverage_map.py`, `w0/targets.py` | W4 T0 (`fix/pine-w0-census-peel`): same files |
| T2 | FE `:1252-1270`, `:8808-8818`, `:5535-5560` | none in those lines (T1 `:1225`, T15 `:1531-1546` nearby) |
| T3 | FE `:9440-9452`, `:9664-9673`, `:10000-10012`, `:2551`, `:3048-3120`, `:3334-3360`, `:1647`, `:6219-6244`, `:9783-9806`; `ast/ufcs.js` | **T12 `feat/pine-w4-t12-paint`: `:9450`, `:9672`, `:10009`, `:2660`, `:9591`; T13 `feat/pine-w4-t13-candle`: the same** |
| T5 | `RT/collections.js` | none |
| T6 | FE `:8847-9000`; `RT/lowerIr.js` `:599-660`; `ast/forInRule.js` (new); `ast/pineObjects.js` `:1595-1620` (import only) | **T15 `feat/pine-w4-t15-fn-forms`: `:8858`, `:8896`, `:8955`, `:8973`; T7/T8: `:8663`, `:8679`** |
| T7 | `RT/matrices.js` (new); dispatch export in `RT/collections.js`; FE `:3392-3430`, `:435` | T10 `feat/pine-w4-t10-state-kernels`: `:433` |
| T8 | `RT/maps.js` (new); same dispatch and FE admission as T7 | as T7 |
| T9 | FE `:1252-1291`, `:8808-8818`, `:9918-10230`, `:6205-6245`, `:3194-3220` | **T7 `feat/pine-w4-t7-fn-series` and T8 `…-t8-series-length`: `:9978`, `:10195-10262`; T12/T13: `:10096-10239`; T15: `:9964`, `:10097-10158`, `:1531-1546`**; T11 `…-t11-runtime-text`: `:6152-6168` (adjacent) |
| T10 | FE `:515-542`, `:8786-8794`, `:5535-5560`; `RT/runtimeInputs.js` | none |
| T11 | `RT/lowerIr.js` `:599-660`; FE `:8529`, `:8899-8912` | **T15: `:8896`**; T8: `RT/lowerIr.js:510` (disjoint) |

Measured hunks were read with `git diff -U0 origin/master...origin/feat/pine-w4-<task>` on 2026-11-05.
No W4 lane edits `RT/collections.js`, `RT/records.js`, `ast/ufcs.js` or `RT/vm.js`'s `OP.ARRAY` /
`OP.RECORD` handlers (`:970-1025`); W4 T8 and T10 edit `RT/vm.js` at `:363-365`, `:1033-1036` and
`:1095-1110` (`OP.WINDOW` / `OP.CARRIED`), adjacent to but not inside the collection handlers.

**Conflicts that force an order:**

| pair | why | order |
|---|---|---|
| T3 → T6, T7, T8, T9, T10 | the type descriptor they all read | T3 first |
| T6 ⟂ T11 | both edit `STMT.FOR` and the `for` lowering near `FE:8896` | T6 first, T11 after Q-A1 |
| T7 ⟂ T8 | the shared dispatch table and `admitArrayCall` | merge one, rebase the other (T7 first) |
| T2 ⟂ T9 | `scanDefs` / the `method` arm | T2 first (S) |
| T2 → T10 | the `enum =` binding rule | T2 first |
| T1 after W4 T0 | the same tooling files | W4 T0 first |

**Batches** (at most 3 Opus or Fable agents at once; 3 agents while free RAM is under 4 GB; heavy jobs
through the lock):

- **Batch 1 (on the train tip):** T3 (Opus), T5 (Sonnet), T2 (Sonnet), and T1 (Haiku, tooling) once
  W4 T0 is merged. T5 and T1 touch no FE region; T2 and T3 are disjoint.
- **Batch 2 (after T3):** T6 (Opus), T7 (Sonnet), T9 (Opus).
- **Batch 3:** T8 (after T7), T10 (after T2, T3), T6's matrix/map halves (after T7/T8).
- **Capture-gated, as captures land:** T5's kept refusals (Q-W19R2a/b, W6-A1), T7 (W6-M1), T8 (W6-K1),
  T9 (W6-U1), T10 (W6-E1), T11 (Q-A1), T6's further mutations (W6-F1 and the read of
  `vw-forin-collections-2`).

## 6. Risks, and the captures W6 needs

**Risks**

1. **A collection read that answers `na` where Pine stops.** The rule in `RT/collections.js:80-99` holds
   for every new member and family: out of range, empty, missing type stops by name. A rail per member
   proves it.
2. **The object door leaks through `for … in`.** The host object lane already serves `for … in` over
   drawings. If the runtime lowering reaches the C18 door without `objectDoorRefuses`, a live member's
   drawing changes. measure-pair C18 diff must be 0; `objectDoorGate.test.js` gets the case.
3. **Two type authorities.** T3 exists so that T6-T10 do not each add a flag. A reviewer rejects any
   W6 PR that adds a new per-slot boolean.
4. **Aliasing.** Arrays, matrices, maps and records are references in Pine (`collections.js:5-12`). Every
   family gets an aliasing rail and a copy rail; a copy-on-assign implementation passes every single-value
   test and is wrong.
5. **Budget creep.** Matrices and maps are counted against `ARRAY_ELEMENTS` / `ARRAY_OPERATIONS`
   (`RT/limits.js:133-134`). Budgets are never raised; a script that does not fit declines by name.
6. **Engine-version churn.** About 8 bumps over W6, batched per merge by the coordinator.
7. **W3 owns `pine.js`.** `pine:type` / `pine:member` are raised by the shared resolver. T2 and T9 fix
   them on the FE side; a change inside `pine.js` is coordinated with W3.

**Captures.** All new rows go in one queue doc, `docs/pine/capture-queue-2026-11-0X-w6.md`, in the
evidence engine's format (EVIDENCE-ENGINE-DESIGN 2.1): a table whose first cell is the row id, a committed
probe under `tools/visual_conformance/probes/`, an explicit `EXCH:SYM tf` chart, the guards and slugs it
unblocks. `python tools/vendor_harness/evidence_engine.py queue` derives the JSON. Existing rows are
reused by id. The owner runs the rig; no W6 builder signs in, opens TradingView or runs the rig.

| row | probe (new unless noted) | chart | guards | named scripts | settles | gates |
|---|---|---|---|---|---|---|
| Q-W19R2a (`capture-queue-2026-10-05-w19-r2.md`, on `pine/w19-r2-collections-drawings`; port to master) | `vw-w19r2-collections.pine` rows I01-I03, F01-F02 (exists on that branch) | `NYSE:RDDT 1D` | `runtime:array` | `initial-balance-…`, `session-tpo-profile` | `insert` at `size`, into an empty array, v6 negative index; `fill` edge indices | T5 |
| Q-W19R2b (same doc) | same probe, B/L/R/E rows | `NYSE:RDDT 1D` | `runtime:array` | `bollinger-band-width-percentile`, `rsi-kernel-optimized-flux-charts` | the three binary searches on duplicates, misses, empty | T5 |
| W6-A1 | `vw-w6-array-members.pine`: `array.sort` with `na` elements (both orders), `array.join` of floats and ints, `array.mode` ties, `array.variance`/`stdev`/`median`/`percentrank` with an `na` element, `array.new_bool(3)` / `new_string(3)` fill read | `AMEX:SPY 1D` | `runtime:array` | `machine-learning-moving-average-backquant`, `footprint` | `na` and formatting rules the reference does not state | T5 |
| W6-F1 | `vw-w6-forin-runtime.pine`: `for [i, x]` over an `array<Foo>` with a field write through `x`; reassigning the loop variable; `for … in` inside a UDF at two call sites; over a matrix (rows) and a map (`[k, v]`) | `NYSE:RDDT 1D` | `runtime:loop` | `trendline-pivots-quantvue`, `order-block-detector-luxalgo` | whether a write through `x` reaches the array; matrix and map walks | T6 (UDT write-through, matrix/map halves) |
| (read only) | `vw-forin-collections-2-rddt-1d-2026-10-02` (captured; rows G01-G07, S01-S03, P01) | `NYSE:RDDT 1D` | `runtime:loop`, host `forInRefused` | `smt-divergence-ict-killzones`, `fvg-order-blocks-bigbeluga` | the remaining body mutations | T6 (and the host lane, one rule) |
| Q-A1 (`capture-queue-2026-10-31-wsa-for-bound.md`) | `vw-v6-for-bound.pine` (exists) | `AMEX:SPY 1D` | `runtime:loop` | `support-resistance-mtf-flux-charts`, `support-and-resistance-zones-feels` | v6 per-pass `to`/`by` | T11 |
| W6-M1 | `vw-w6-matrix.pine`: `matrix.new<float>(na, 3, na)` then `add_row`; `add_row` with a short array; `get` out of range (a runtime error is a reading); `min`/`max`/`avg` over `na` cells; `col` then a write to the copy | `AMEX:SPY 1D` | `runtime:array` | `candlestick-patterns-on-backtest`, `supertrend-cluster-zeiierman` | `na` dimensions, mismatch and out-of-range behaviour | T7 |
| W6-K1 | `vw-w6-map.pine`: `keys()` after re-`put` of an existing key, `put` return value, `get` of a missing key, `remove` return, an `na` float key, `keys()` after `remove` then `put` | `AMEX:SPY 1D` | `runtime:array` | `supply-demand-mtf-flux-charts`, `divergence-screener-trendoscope` | map order and missing-key rules | T8 |
| W6-U1 | `vw-w6-receivers.pine`: two `method clear` overloads; a user `method get(array<float> a, int i)` beside the built-in on `array<float>` and on `array<int>`; a chain `a.get(i).f`; `Foo.copy` aliasing; a field read off `na` (runtime error text and bar) | `AMEX:SPY 1D` | `runtime:udt-method`, `pine:member`, `pine:type` | `fx-market-sessions`, `ipda-standard-deviations-…` | dispatch, copy depth, `na` record | T9 |
| W6-E1 | `vw-w6-enum.pine` (v6): `enum` with and without titles, `str.tostring(e)`, `input.enum` default, `switch` on an enum, an enum map key, an `na` enum | `AMEX:SPY 1D` | (none today) | none in the sample's walls | enum value and text rules | T10 |

**Rig time, in one sitting:** six new probes (W6-A1, W6-F1, W6-M1, W6-K1, W6-U1, W6-E1), one existing
probe never captured (Q-A1), and one probe to port from the w19 branch (Q-W19R2a/b). All are
single-symbol, inputs at defaults, after the close: about 8 captures on two charts.

## 7. What I could not determine

- **Whether `vw-forin-collections-2` was ever read into a rule.** The fixture is committed (2026-10-02),
  but the host lane's comment (`pineObjects.js:1607-1612`) and the triage doc (`objects-triage-2026-09-28.md
  :4063`) still refuse the G-row mutations. Either it was captured and not graded, or graded and not
  served. T6 should read it before asking for W6-F1.
- **Whether `pine/w19-r2-collections-drawings` is abandoned or waiting.** It is 146 commits ahead of
  master on a 2026-10-04 base and was never merged; its Q-W19R2a/b rows were never captured. T5 assumes
  a cherry-pick of `794bfb02f3`'s collections half is acceptable.
- **The real W6 yield after W4.** The per-script wall lists are capped at 8 and 146 scripts hit the peel
  cap; W6 walls hidden behind W4 are unmeasured. Re-count after the W4 train merges and
  W0 re-runs.
- **`enum` demand.** No census step reaches it (section 0 finding 5).
- **The W4 train's final line numbers.** `integ/pine-train-2026-11-05` was not pushed when this was
  written; the rebase-risk table uses each W4 branch's diff against master, not the train.
- **Whether `inside-bar-strategy-w-sl`'s `[inside1Bar]` is a collection literal or a parse artefact**:
  the census text is the bracket alone. It is an order strategy (W9) either way.

## 8. How these numbers were taken

Read-only Python over the committed `coverage-map.json` and `coverage-targets-2026-11-03.json` (branch
`fix/pine-w0-census-peel` @ `127a0f1e3c`) and the local runtime-on census rows named in section 0:
- a script's waves are `targets.py::rt_wave(wall, tags)` over `runtimeOn.walls.byScript`;
- a step's wall is `runtimeDeclined.code` when `rtProbe.agrees` is false, else `rtProbe.guard`;
- a W6 step's task comes from its message and token (`matrix.*` → T7, `map.*` → T8, other `array.*` →
  T5, `for … in` → T6, the v6 bound → T11, `pine:member` / `pine:type` / overloads → T9, the namespace
  and `method =` cases → T2, `pine:collection` → T1);
- firm = the census row's `reachedAfterPeel`.

Feature use (finding 4) is a regex scan of the 679 sources (`corpus/committed` plus the local
`pine-sample`). W4 rebase regions are `git diff -U0` hunks of each `origin/feat/pine-w4-*` branch against
`origin/master`. No vitest, census or harness was run.
