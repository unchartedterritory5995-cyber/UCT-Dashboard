# W4 "Finish the runtime lane": task breakdown

Written 2026-11-03 by the pine-parity coordinator session (af33efb6), docs only.

Citations:
- Every line citation is at `origin/master` **`e055b21e7f`**. That is after W1 (#736,
  SCRIPT_ENGINE_VERSION 5) and W5 T12 (#737).
- `FE` means `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (11,115 lines, one
  closure).
- `RT/` means `app/src/components/chart/engine/runtime/`.

**The goal is the language, not the sample** (AGENT-RULES on branch docs/pine-parity-programme, "fix the language, never the
script").
- Every task below implements a Pine capability for every script that uses it.
- The 679-script sample only ranks the capabilities.
- Where a task names scripts, they are the measure-pair rows expected to move, never a special
  case.

## 0. What the measurements say (read this first)

Two inputs, used for different things:

| input | what it is | used for |
|---|---|---|
| `docs/pine/coverage-map.json` (committed, `6272ed7fa3`, pre-W1) | `runtimeOn.walls.touches` and `byScript` | the **official ranking** (section 1, column A) |
| `_resume-laptop/runs/w1final/rt/tip/census/census.jsonl`: licence-held, not committed. It is the runtime-on half of W1's final measure-pair, i.e. today's master code. | per peel step: `rtProbe` (guard, line, token, message) and `runtimeDeclined` | **which language feature** sits behind each guard, and which counts are instrument artefacts (columns B to D) |

Four findings change how W4 should be planned. Each one is reproducible from the files named.

1. **The top runtime-lane wall is mostly an instrument artefact.**
   - `pine:statement` has 76 touches and is rank 1 in `COVERAGE-MAP-2026-11-02.md` section 4.
     It is the **step-0** wall of only **6** scripts. The other 74 meet it only after a peel
     step.
   - Why: the census peel overwrites ONE physical line with `name = 0.0`
     (`app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js:199-206`).
     When that line is part of a multi-line call or a function header, the reader then refuses
     the continuation lines left behind. Sample texts: `bar_index - 1,`,
     `border_color = boxBorderColor,`, `title = 0.0`.
   - The same mechanism inflates five more guards (count after a peel / total):

     | guard | after a peel | note |
     |---|---:|---|
     | `runtime:function` | 23 of 27 | "a body with no statements" |
     | `runtime:unbound` | 10 of 11 | |
     | `runtime:statement` | 19 of 28 | `else` with no `if` is a peeled `if` line |
     | `runtime:tuple` | 4 of 4 | |
     | `runtime:nothing-drawn` | 8 of 8 | |

2. **`runtime:object-op` (35) is a mis-attribution.**
   - `coverage_map.py:518` takes `rtProbe.guard` before `runtimeDeclined.code`.
   - `rtProbe` is a probe built WITHOUT `objectsInRun`
     (`coverageMapDoorCensus.measure.test.js:90`). The door declined on the drawing build's
     guard instead (`memberPaneDefinition.js:1308`, `runtimeObjectsDoor.js:59-100`).
   - Only 2 of 79 `object-op` steps agree with the decline.
   - The real walls behind it: `runtime:conditional-history` (23 steps), `pine:undefined` (11),
     `pine:builtin` (7), `runtime:call-text-state` (7), `runtime:loop` (5) and others.
3. **`runtime:call-undeclared-builtin-state` (68) is mostly not W4.**

   | share | what it is | owner |
   |---|---|---|
   | 19 scripts | the v1-v4 spelling `security(…)`. `builtinStateFamily` only recognises `request.` (`FE:4893`), so a bare `security` falls through to "the closed table does not declare it" (`FE:4931`). 16 of the 19 show it as the step-0 wall (T1's list); the others reach it only after a peel step. | W7 |
   | ~15 | library aliases (`ml.*`, `pc.*`, `zen.*`, `tl.*`) | W8 |
   | (in the ~15) | UDT/drawing getters (`line_h.get_y1`, `deviations.size`) | W3/W6 |
   | ~13 | **user functions whose definition the lane did not compile** (`xhma`, `avg`, `gaussian`, `f_kalman`, `dot`). The held definition's real guard is hidden behind a builtin label. | W4 (T1) |

4. **Two more guards are out of W4.**
   - `runtime:loop` is `for … in` in 20 of 20 steps (`FE:8856`). That is W6.5.
   - `runtime:no-output` is the step-0 wall of 22 scripts. 19 of those are TradingView's built-in
     **strategies** (orders, W9). Its other 16 touches come after a peel.

**The corrected size of W4.** Recount with three changes: re-label findings 3 and 4, take the
decline code first (finding 2), and drop peel-own lines as `coverage_map.py` already does.
- W4 still **blocks 274** non-transferring scripts post-W1.
- **67 have only W4 walls** (upper bound). The committed map said 88.

## 1. Runtime-lane walls ranked, with the language feature behind each

Column key:
- **A**: touches in the committed map (`runtimeOn.walls.touches`, wave W4 per
  `tools/pine_coverage/w0/targets.py:44-60`).
- **B**: touches post-W1, decline code first.
- **C**: step-0 scripts, i.e. the wall on the unpeeled source (exact, no instrument effect).
- **D**: the committed map's count of W4-only scripts that carry this wall.

| # | wall | A | B | C | D | language feature behind it (post-W1 sub-shapes, scripts) | task |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | `runtime:history-dynamic-offset` | 40 | 40 | 23 | 18 | **Qualifier folding and window sizing**, four shapes: (a) a `simple` text or number passed through a UDF parameter, e.g. `BarInSession(sess) => time(period, sess)` (11); (b) a dynamic offset over a variable whose bound is `simple` (10); (c) a v6 `series int` window length, e.g. `ta.highest(high, dynLen)` (15); (d) a `simple` length the frozen resolver cannot fold, because it is reassigned or is a never-reassigned `var` (7). | T2, T3, T8, T9 |
| 2 | `runtime:conditional-history` | 33 | 39 | 19 | 14 | **Per-call-site history** (Pine's execution model), five shapes: `ta.*` in a `?:` arm (17); drawing runs under `objectsInRun` (9); a UDF with history called inside a block (4); a v6 `and`/`or` right operand (4); a block `ta.*` beyond the served `sma`/`ema`/`rma` (8). | T4, T5, T6 |
| 3 | `pine:statement` | 76 | 81 | **6** | 26 | **Mostly the peel artefact** (finding 1). Real cases: a one-line function whose body is a binding or comma statements (`xhma(a,b) => _return = …`, `ma(x)=>a=0.,a:=…`); a trailing comma in a switch arm; the `ta.highest(14)` length-only form. | T0, then T15 |
| 4 | `runtime:call-undeclared-builtin-state` | 68 | 69 | 22 | 19 | **Mis-labelled** (finding 3). W4 residue: user functions whose definition was held (~13). Real missing names, a W1 follow-up (~8): `time` forms, `timeframe.in_seconds`, `math.toradians`, `weekofyear`, `ta.swma`, `ta.correlation`. | T1 |
| 5 | `runtime:no-output` | 38 | 38 | 22 | 8 | Strategies (W9) plus peel artefacts. **No W4 language work.** | none (T0 relabels) |
| 6 | `runtime:object-op` | 35 | **2** | 0 | 19 | **Mis-attribution** (finding 2). The walls behind it are counted under their own guards. | T0 |
| 7 | `runtime:history-expression` | 28 | 27 | 16 | 6 | **An expression's own committed series inside a function body or block.** Examples in UDFs: `hma(x,len) => wma(2*wma(x,len/2) - wma(x,len), …)`, `sum(v*w, p)`, `ta.vwma(_src,_len)`, `ta.pivothigh(expr, …)`. The hoist refuses in frames and in nested statement lists (`FE:5158-5168`). | T7 |
| 8 | `runtime:function` | 27 | 27 | 4 | 5 | The value of a body ending in a loop (3); parameter defaults (2); otherwise peel artefacts. | T15 |
| 9 | `runtime:statement` | 24 | 28 | 6 | 9 | `time(tf, session)` with a non-literal session (4, `FE:6592-6660`). Otherwise peel artefacts, or other waves (`array.min(id, nth)` is W6). | T3 |
| 10 | `runtime:expression-statement` | 23 | 23 | 4 | 6 | `log.info`/`log.warning`/`log.error` statements (`FE:9859`). Also UDF and method statements whose definition was held (peel artefact or W6). | T15 (item 4) |
| 11 | `runtime:block-value` | 16 | 17 | 3 | 6 | **v6 `bool` typing**: in v6, a bool `if`/`switch` value with no matching arm yields `false` (`FE:8022-8036`). Plus function branches with no `else`. | T14 |
| 12 | `runtime:presentation` | 15 | 15 | 3 | 5 | `plotcandle` / `plotbar` from the run (`FE:9710-9713`). | T13 |
| 13 | `runtime:loop` | 15 | 15 | 8 | 5 | `for … in`: **W6.5, not W4**. | none |
| 14 | `runtime:call-text-state` | 12 | 14 | 5 | 2 | Text builtins over runtime values (`FE:6127-6150`, `RT/text.js:39-133`): `str.substring`, `str.replace`, `str.tonumber`, `str.pos`, `str.format_time`, and `str.tostring` with a format other than `#0`. | T11 |
| 15 | `runtime:call-windowed-state` + `pine:state` | 12+6 | 12+6 | 5+1 | 2+2 | **State kernels** fed by a mutable value: `ta.vwap`, `ta.pivothigh`/`ta.pivotlow`, `ta.cum`, `ta.stoch`. `ta.cum` includes the v2/v3 self-referencing running totals (`vwapsum = …vwapsum[1]…`). | T10 |
| 16 | `runtime:colour`, `fill-target`, `withheld-all`, `output-map` | 8+4+3+2 | 18 | 6 | 10 | **Paint typing**: `color.new` or `fill()` given a value the lane cannot prove is a colour (`FE:6193-6200`, `FE:7250-7268`, `holdsColour` at `FE:2598`); fill targets; per-bar colours withheld. | T12 |
| 17 | `runtime:directive`, `pine:window`, `pine:offset-literal` | 3+3+4 | 10 | 7 | 4 | **`max_bars_back` and integer division in window sizes.** `max_bars_back(x, n<5000)`. `length/2` as a window, e.g. TradingView's own **HMA** (`ta.wma(src, length/2)`) and **DPO** (`close[period_/2 + 1]`). `constantArgOf` refuses `/` and `%` on purpose (`FE:10462-10466`). | T17 |
| 18 | `runtime:function-global-state` | 7 | 7 | 1 | 4 | A UDF reading a global's history (`FE:5570`, `FE:6391`, `FE:6484`). | T7 |
| 19 | `runtime:varip`, `runtime:na-test` | 3+3 | 3+2 | 2+1 | 1+3 | `varip` in a UDF (needs a tick feed); `?:` below v4. | deferred (F, G) |
| 20 | `runtime:clock-zone`, `builtin-args`, `input-state`, `budget:lookback` | 2+1+1+1 | 5 | 1 | 1 | Singles. | fold into T3 and T2 |

**Expected yield (upper, post-W1, re-labelled).** For each task, the scripts whose ONLY
remaining wall is that task's family:

| task | scripts | notable |
|---|---:|---|
| T17 | 4 | incl. built-in HMA and DPO |
| T12 | 3 | |
| T4 | 2 | incl. built-in McGinley |
| T3 | 2 | |
| T10 | 2 | |
| T9 | 1 | |
| T14 | 1 | built-in Volatility Stop |
| T6 | 1 | |
| T2 | 1 | |
| T8 | 1 | |
| T13 | 1 | |

- The rest need two or more tasks. Scripts carry walls in combination (PHASE3 2.3), so judge
  every landing by wall counts moving, not by the headline.
- Section 3 names the rows per task.

## 2. Rules every W4 task follows

1. **Built dark, merged without waiting for arming.**
   - The runtime pane is dark behind `runtimePaneEnabled()`, the kill list and the starter
     allowlist (`memberPaneDefinition.js:1273-1296`).
   - Nothing a W4 task adds is member-visible on the pane until W2's stage 1. Even then, only the
     allowlisted script is shown.
2. **The C18 object door is LIVE.**
   - It builds through this same front end with `opts.objectDoor = true`
     (`RT/runtimeColumns.js:1488, 1582`).
   - Every new lowering calls `objectDoorRefuses(…)` (`FE:1101-1106`) first, so the door builds
     exactly what master builds.
   - Rail: `RT/__tests__/objectDoorGate.test.js` gets one case per new capability.
   - measure-pair must show **0 C18 verdict diffs** (`out-*.json`, `probe-*.json`). This is what makes a
     dark merge safe. A task whose job is to rename a refusal (T1) changes the refusal text on its own
     rows; the probes must still refuse.
3. **The stage-1 script must not move.**
   - `adx-and-di-for-v4` (W2 stage 1) must stay byte-identical.
   - Once W2 merges, its `runtimeAllowlistParity.test.js` (on `feat/pine-w2-arming`) is a
     required rail for every W4 PR.
   - Until then, the PR body quotes that script's runtime-on harness verdict, before and after.
4. **Refuse by name what no capture settles** (ruling 2). When a capability is served before its
   capture lands, its unwitnessed sub-shape keeps a by-name refusal and gets a row in the W4
   queue doc (section 5).
5. **One authority per value.**
   - Kernels live in `ast/interpret.js` (`FINITE_WINDOW` at `:2434`, `CARRIED` at `:2504`,
     `CARRIED2` at `:2674`) and are imported by `RT/vm.js:25`.
   - A new kernel is added there, with its Python mirror (`api/services/ast_interpret.py`).
   - Standing ruling 9: one owner of the closed table at a time.
6. **Engine version.**
   - A task that turns a refusal into a served value changes door outcomes. The coordinator
     bumps `SCRIPT_ENGINE_VERSION` once per merge (`scriptEngineVersion.js`, now 5; W3 takes 6).
     Builders never bump.
   - `RUNTIME_FRONTEND_VERSION` (`FE:177`) is bumped only if an already-served shape changes
     meaning. `RT/runtimeColumns.js:341-350` refuses only newer stamps. No task here intends
     such a change.
   - Once W5 T4 lands, each bump also regenerates its host-parity `expected-digests.json`
     (SERVER-RUNTIME-DESIGN 2.3).
7. **Ship loop**, per WAVE-TASKS section 1 (on branch docs/pine-parity-programme):
   - rails red before the fix, green after;
   - every guard mutation-proved (`docs/pine/parity-programme/scripts/mutate.py`, on branch docs/pine-parity-programme);
   - independent Opus review GO;
   - measure-pair runtime-on (`measure-pair.sh <out> tip:… base:… 1 1`), with every intended
     census or harness diff classified in the PR body;
   - deploy-gate pytest set and hygiene before the final push.
8. **No heavy job outside the lock.** Targeted vitest files only, `--maxWorkers=2`.

## 3. Tasks

Sizes: S ≤ 1 day, M 2-3 days.

Model tiers follow AGENT-RULES' token budget (branch docs/pine-parity-programme):
- **Sonnet** builds from a precise spec.
- **Opus** builds engine-semantic fixes and does every merge-gating review.
- **Fable** only after Opus fails the same task twice.
- **Haiku** does list and log chores.

Terms used in the measure-pair lines:
- **Rows** are census keys in the runtime-on lane (`census.jsonl` `key`).
- **First wall moves**: the step-0 wall changes.
- **Attach**: the script attaches on the runtime lane.

### T0 Instrument honesty (W0-owned tooling; no engine change) | S | Sonnet

- **Files:**
  - `app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js`: the peel
    (`:196-207`) and `runtimeProbeOf` (`:88-103`);
  - `tools/pine_coverage/coverage_map.py` (`:505-524`);
  - `tools/pine_coverage/w0/targets.py` (`rt_wave`, `:44-60`).
- **What:**
  1. The peel neutralises the whole **logical statement**: the refused line plus its
     continuation lines and, for a function header, its body.
  2. `runtimeProbeOf` builds with `objectsInRun` when the door's decline came from the drawing
     build.
  3. `coverage_map.py` takes `runtimeDeclined.code` when `rtProbe.agrees` is false.
  4. `rt_wave` re-maps three guards:
     - `runtime:loop` with a `for … in` detail goes to W6;
     - a bare `security` goes to W7;
     - `runtime:no-output` on an order strategy goes to W9.
- **Semantics:** none (measurement).
- **Acceptance:**
  - A fixture census row for each artefact class (multi-line call, function header, object-op
    disagreement) proves the old wall disappears and the next real wall appears.
  - `--check` on `coverage-targets` regenerates without error.
- **Mutations:**
  - revert the continuation walk: the multi-line fixture shows `pine:statement` again;
  - revert the `agrees` preference: the object-op fixture is mis-attributed again.
- **measure-pair:**
  - No engine diff: C18, harness and census are identical apart from the walls fields.
  - The next W0 run should show `pine:statement` near 6 at step 0 and `runtime:object-op` near 2.
- **Engine bump:** no.
- **Depends:** none. Coordinate with W0's next re-run.

### T1 Classifier honesty: name the real wall | S | Sonnet

- **Files:**
  - FE `builtinStateFamily` (`:4886-4933`);
  - the held-definition rethrow at the call (`FE:5958-5984`, keyed on `deferredFnRefusals`);
    `FE:6930-6935` is the generic builtin fallback;
  - a new rail `RT/__tests__/w4ClassifierHonesty.test.js`.
- **What:**
  - `security`, `security_lower_tf` and `financial` in v1-v4 spelling return
    `runtime:request-with-state`, as `request.*` does at `FE:4893`.
  - A call to a user function whose definition was held rethrows the **definition's** refusal at
    the call. **Pin, don't add:** this rethrow already exists in master (`FE:5958-5984`,
    `deferredFnRefusals`; `fnByName` keeps held names on purpose). The rail pins it. The ~13
    census calls that read `undeclared` through a held function are peel artefacts (the peel
    removed the definition), which is T0's work.
  - A dotted name whose head is a library alias says so (`runtime:library`).
- **Semantics:** no behaviour changes, only guards. Reference: the v4 to v5 migration guide
  (`security` became `request.security`),
  https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/
- **Acceptance:** one fixture per shape, asserting the guard:
  - `security`;
  - a held UDF;
  - an `ml.` alias;
  - a real missing name, which stays `undeclared`.
- **Mutations:**
  - drop the `security` arm: its case reads `undeclared` again;
  - drop the existing rethrow: the held-UDF case reads `undeclared` again.
- **measure-pair:**
  - 0 attach changes, 0 C18 verdict diffs (camarilla's probes change refusal text only).
  - The step-0 wall moves to `runtime:request-with-state` on 16 rows:
    `boom-hunter-entry-point-screener-alerts`, `camarilla`, `delta-volume-v21-by-kernel-phi`,
    `moving-averages-as-support-resistance-mtf`, `mtf-watchlist-charts-anan`,
    `best-abcd-pattern-screener`, both `best-rsi-divergences-screener`,
    `delta-volume-columns-lucf`, `fxn-asian-session-range`, `money-flow-index-mtf-alerts`,
    `mtf-order-block-finder`, `supertrend-mtf-heatmap`, `thelark-lma-v2-laguerre`,
    `tradepro039s-trading-idea-cipher-b-…`, `vumanchu-b-divergences`.
- **Engine bump:** no. Only refusal text and guards change; translator output does not.
- **Depends:** none.

### T2 `simple` qualifier folding: values fixed before bar 0 | M | Opus build

- **Files:**
  - FE `constValueOf` (`:4553-4585`), `foldConstNode` (`:4656-4760`), `invariantTest`
    (`:1712-1756`);
  - one new helper `simpleValueOf` in the same band;
  - rail `RT/__tests__/w4SimpleFolding.test.js`.
- **What:** a root-level name has one value for the whole run when every write to it is one of:
  - its declaration, from a literal, an input at the value in force, or a chart constant
    (`timeframe.*`, `syminfo.*` text);
  - pointwise arithmetic (`math.*`, `+ - *`) over such values;
  - a reassignment under an invariant test (`if tf == "D"` then `len := 5`);
  - a `var` whose initialiser is invariant and which is never reassigned. This is
    `var enableMA = maTypeInput != "None"` in TradingView's own RSI.

  Such a name folds wherever a window length, an offset bound or an invariant test needs one.
  `/` and `%` stay out (T17).
- **Pine semantics:** the qualifier hierarchy `const < input < simple < series`. A value fixed on
  bar 0 that never changes is `simple`, and a `simple int` may size windows.
  - Type system, Qualifiers: https://www.tradingview.com/pine-script-docs/language/type-system/#qualifiers
  - Execution model: https://www.tradingview.com/pine-script-docs/language/execution-model/
- **Acceptance:** each shape folds to the in-force value and changes with the member's input:
  - never-reassigned `var`;
  - reassignment under `if` on an input or on `timeframe.isintraday`;
  - `math.max(len, 3)`.

  The control shapes still refuse:
  - a reassignment under a per-bar test;
  - a `var` written inside a block.
- **Mutations:**
  - accept a write under a non-invariant test: the per-bar control turns green, so the rail must
    go red;
  - drop the never-reassigned check on `var`: same.
- **measure-pair:**
  - First wall moves on `range-filter-bs-signals`, `volatility-coil-edge-bullbyte`,
    `luxy-super-duper-supertrend-predictor-engine`, `supertrend-cluster-zeiierman`,
    `relative-strength-index` (TradingView built-in; its next wall is T4's arm, or nothing).
  - Attach expected: `range-filter-bs-signals`.
- **Engine bump:** yes (coordinator).
- **Depends:** none. Feeds T3, T8, T9.

### T3 Text constants: sessions, timeframes and text parameters | M | Sonnet

- **Files:**
  - FE `fixedTextOf` (`:10557`), `constantArgOf` (`:10423-10475`), `simpleSpecialisation`
    (`:10295-10420`);
  - the session clock in `time(tf, session[, tz])` (`:6582-6660`);
  - `RT/clockFns.js` (day mask only);
  - rail `RT/__tests__/w4TextConstants.test.js`.
- **What:**
  1. A session or timeframe argument is fixed text when it is one of:
     - a literal;
     - `input.session` / `input.timeframe` / `input.string`, or v1-v4
       `input(type=session|resolution|string)`, at the value in force;
     - the chart's `timeframe.period` or the v1-v4 alias `period`;
     - a UDF parameter fixed at its call site (specialisation, as C47 does for `switch`).

     This serves `BarInSession(sess) => time(period, sess) != 0` and
     `timeinrange(res, sess) => time(res, sess) != 0`.
  2. Day masks (`"0930-1600:23456"`), with the documented digit-to-weekday map.
  3. The timezone stays America/New_York only. Its refusal stays (`FE:6611-6620`).
- **Pine semantics:** `time(timeframe, session)` returns the bar's time inside the session and
  `na` outside it. The session string grammar, including the day mask, is in the Sessions page.
  `period` is v4's name for `timeframe.period`.
  - https://www.tradingview.com/pine-script-docs/concepts/sessions/
  - https://www.tradingview.com/pine-script-reference/v6/#fun_time
  - https://www.tradingview.com/pine-script-reference/v4/#var_period
- **Acceptance:**
  - Existing captures `vw-time-session-spy-1d-2026-09-27` and `r11-time-session-spy-5m-2026-09-11`
    still MATCH.
  - New rails: a UDF session parameter, `period`, `input.session`, v3 `input(type=session)`, and
    one day-mask case per weekday digit.
  - A non-NY timezone still refuses.
- **Mutations:**
  - map digit 1 to Monday: the weekday rail goes red;
  - accept a per-bar text as the session: the control (a session read from a `var` written per
    bar) must go red.
- **measure-pair:**
  - First wall moves on `initial-balance-ib-and-previous-day-week-high-low-close`,
    `nubia-auto-midas-anchored-vwap-xdecow`, `smart-money-concepts-by-welotrades`,
    `cm-forex-sessions-highlight-v1`, `ict-killzone`, `kz-boxes`, `rsi-trend-reversal`,
    `trading-session-indicator`, `session-hilo`, `volume-profile-v054beta`.
  - Attach expected: **none from T3 alone** (corrected after the build, see
    `docs/pine/evidence/2026-11-03-w4-t3/EVIDENCE.md`). `nubia-auto-midas-anchored-vwap-xdecow` is held by
    `len`, a `simple int` through `getMidas`, which is T2's wall. `cm-forex-sessions-highlight-v1` stops at
    the no-day-list refusal (Pine before v5; capture W4-T3a), with overnight windows behind it (W4-T3b).
    The step-0 walls of `initial-balance`, `ict-killzone`, `kz-boxes`, `session-hilo` and
    `trading-session-indicator` move to those same two named refusals.
- **Captures:** W4-T1 (day mask), W4-T2 (session through a UDF on 5-minute bars). Section 5.
- **Engine bump:** yes.
- **Depends:** none. T2 helps `nubia` (a `simple int` through `getMidas`).

### T4 `?:` and `iff` arms run only when chosen (per-call-site state) | M | Opus build

This is the R4 correctness item on its witnessed half.

- **Files:**
  - FE `armHistoryGuard` (`:2116-2172`), `servedCondCall` and `SERVED_COND` (`:2176-2222`),
    expression `ternary` lowering (`:5663-5717`);
  - `RT/lowerIr.js` `EXPR.TERNARY` (`:458-497`): the jump form today needs `isBoolIr`;
  - rail `RT/__tests__/w4ArmHistory.test.js`.
- **What:**
  - A `?:` whose arm holds history is lowered as the jump form. The test is read with
    `asCondition` (per-version `na` rule, `naConditionIsFalse`), so the unpicked arm never runs.
  - Inside an arm, `ta.sma`, `ta.ema`, `ta.rma` and `ta.change` take per-call-site state
    (`windowCall`/`carriedCall`, exactly as `servedCondCall` does for an `if` block today).
  - Every other `ta.*` in an arm keeps `runtime:conditional-history`, until T5.
  - v4 `iff` stays refused until H10 is captured.
- **Pine semantics:** a function call in a branch that does not run keeps no history for that
  bar. Pine evaluates only the chosen operand of `?:` and warns that such calls should run on
  every bar.
  - https://www.tradingview.com/pine-script-docs/language/execution-model/
  - https://www.tradingview.com/pine-script-docs/language/operators/#-ternary-operator
  - Witnessed: `vw-arm-history-{rddt,spy}-1d-2026-10-02` rows T03, T05, K02, K03 (queue
    `capture-queue-2026-10-31-wsc-history.md` H6).
- **Acceptance:**
  - `vw-arm-history` T03/T05/K02/K03 MATCH through the runtime lane (a new
    `vendorHarness.w4ArmHistory.test.js`, runtime-on).
  - A `na` test in v3 still declines `runtime:na-test`.
  - `ta.stdev` in an arm still refuses.
- **Mutations:**
  - keep `SELECT` (both arms run): T03 goes red;
  - drop `asCondition`: a v5 `na`-test fixture goes red;
  - add `stdev` to the served set: the H1 refusal rail goes red.
- **measure-pair:**
  - First wall moves on `mcginley-dynamic` (TradingView built-in), `rob-booker-adx-breakout`,
    `banknifty-mcclellan-oscillator`, `kernel-channel-backquant`, both
    `strategyrszigzag-pa-strategy-v4*`, `trendlines-2x`, `trendlines-jd`.
  - Attach expected: `mcginley-dynamic`, `trendlines-2x`.
  - Measured at T4's merge: only `mcginley-dynamic` attaches; `luxy-momentum`'s first wall moves
    (the `na(x) ? na : ta.ema(…)` arm is now served; next wall later in the script); `cm-gann` (v1)
    moves na-test → conditional-history (fail-closed). The other listed rows did not move: they are
    v1-v4 or hit another wall first, and stay refused by name (see the T4 evidence note).
  - Harness: the McGinley built-in capture, if any, must be MATCH or unchanged.
- **Engine bump:** yes.
- **Depends:** none. RSI's attach needs T2 as well (batch 2).
- **Risk:** this is the single most important correctness item. The reviewer runs the
  every-bar-versus-per-run differential (section 4).

### T5 Conditional history beyond the witnessed set; drawing runs | M | Opus build | capture-gated

- **Files:**
  - FE `conditionalHistoryGuard` (`:1788-1796`) and `r4Guard` (`:1850-1870`);
  - `servedCondCall` (`:2176-2222`, which T4 must have merged first);
  - the `owner !== null` exit at `:2178`;
  - rail `RT/__tests__/w4CondHistoryWide.test.js`.
- **What:**
  1. Under `objectsInRun` (the drawing build), serve the same per-call-site set the plot lane
     serves. Today `conditionalHistoryGuard` refuses every stateful call at `condDepth > 0`.
  2. Serve in a function body branch (frame-relative windows and carried state).
  3. Widen the served set, family by family, as each capture lands:
     - H1: `stdev`/`sum`/`median`;
     - H2: `change`/`mom`/`roc`/`swma` in blocks;
     - H3: `atr`/`rsi`;
     - H4: `x[k≥2]`;
     - H9: `(expr)[n]` in a block.

     H5 (`highest`/`lowest`) and H8 (loops) stay refused. Their rule is unknown or unwitnessed.
- **Pine semantics:** as T4, extended to blocks, functions and drawing scripts. Execution model:
  https://www.tradingview.com/pine-script-docs/language/execution-model/ . Witnessed: C48
  `vw-call-site-history-*-2026-10-01`, `vw-fn-series-history-rddt-1d-2026-09-30`,
  `vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03`.
- **Acceptance:** for each family served, a vendor rail on its capture. Each family still
  refused keeps its by-name rail.
- **Mutations:**
  - remove the `objectsInRun` exclusion: the drawing-history rail goes red;
  - serve H5: the extremes rail goes red.
- **measure-pair:** first wall moves on `trendlinesample`, `interactive-atr-stop-loss`,
  `atr-god-strategy-by-tradesmart`, `auto-harmonic-patterns-open-source`,
  `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only`, `trend-line-harrybot`,
  `volumized-order-blocks-flux-charts`, `supply-and-demand-zones-with-enhanced-…`,
  `williams-vix-fix-bottoms-and-tops`, plus the 23 drawing-build steps hidden under `object-op`.
- **Engine bump:** yes, per merged family.
- **Depends:** T4. Captures H1-H4 and H9 (section 5).

### T6 v6 lazy `and`/`or` | S | Sonnet | capture-gated

- **Files:** FE `armHistoryGuard` short-circuit arm (`:2117`, `:2139`), the binary lowering of
  `and`/`or` when `pineVersion >= 6`, and `RT/lowerIr.js` (a jump form for `and`/`or`).
- **What:** in v6 the right operand runs only when needed. Its `ta.*` takes the T4 per-site state.
- **Pine semantics:** the v6 migration guide, "lazy evaluation of `and` and `or`", and the
  Operators page.
  - https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
  - https://www.tradingview.com/pine-script-docs/language/operators/#logical-operators
- **Acceptance:** H7 MATCH (probe `vw-andor-history.pine`, already in
  `tools/visual_conformance/probes/`); v5 still evaluates both operands.
- **Mutations:** apply laziness to v5: the v5 rail goes red.
- **measure-pair:** attach expected: `ema-92150-vwap-macd-rsi-pro-v6`.
- **Engine bump:** yes.
- **Depends:** T4, and capture H7.

### T7 An expression's own series inside function bodies | M | Sonnet

- **Files:**
  - FE `hoistCommittedSeries` (`:5158-5168`; today `owner !== null` returns null);
  - its call sites `:5740-5760` (offset), `:6370-6392` and `:6465-6490` (windowed calls);
  - rail `RT/__tests__/w4FrameHoist.test.js`.
- **What:** inside a UDF body, the hoist declares a hidden frame-local slot. It takes a ring
  off `historyBase`, so it is per call site and the skipped-site rule applies (`RT/vm.js:301-306`).
  This serves:
  - `hma(x,len) => wma(2*wma(x,len/2)-wma(x,len), …)`;
  - `sum(v*w, p)`;
  - `ta.vwma(expr, n)` and `ta.pivothigh(expr, l, r)` in UDFs;
  - a UDF reading a global's history through a hoisted copy (`runtime:function-global-state`).

  Nested statement lists, i.e. blocks, stay refused. That is T5's H9.
- **Pine semantics:** every expression is a series. Its history is the expression's own past
  values, and inside a function that history belongs to each call site.
  - User-defined functions: https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
  - Time series: https://www.tradingview.com/pine-script-docs/language/time-series/
  - Witnessed: `vw-fn-series-history-rddt-1d-2026-09-30`, `skipped-callsite-history-spy-1d-2026-09-08`.
- **Acceptance:** for each shape, the hoisted UDF equals the hand-inlined root binding over 5,000
  bars (differential). Two call sites with different arguments keep separate rings.
- **Mutations:**
  - share one ring across sites: the two-site rail goes red;
  - allow the hoist in a nested list: the H9 refusal rail goes red.
- **measure-pair:** first wall moves on `ad-line-of-sp-sectors`,
  `advanced-custom-multi-ma-signals-emasmavwmavwap`, `bollinger-band-width-percentile`,
  `machine-learning-logistic-regression-v3`, `market-structure-inducements-ict-…`,
  `momentum-based-zigzag`, `neural-network-buy-and-sell-signals`, `flying-buddha-inside-bars-…`,
  `hma-kahlman-trend-trendlines`, `obv-macd-indicator`, `qqe-mod-ssl-hybrid-waddah-attar-explosion`,
  `range-filter-v1`, `smc-target-liquidity-v35-…`, `spy-moving-averages-and-signals`,
  `triangular-hull-moving-average-volatility-bigbeluga`, `volatility-regimes-gainzalgo`.
- **Engine bump:** yes.
- **Depends:** none. It conflicts with T8 on the windowed-call function: sequence them (section 4).

### T8 v6 `series int` window lengths | M | Sonnet

- **Files:**
  - FE window lowering (`:6320-6350`);
  - `RT/vm.js` `OP.WINDOW` (`:1027-1079`), with the ring sized to the history ceiling and the span
    read per bar;
  - `RT/ir.js` (the WINDOW validator);
  - `RT/limits.js` (comments only; budgets never raised);
  - rail `RT/__tests__/w4SeriesLength.test.js`.
- **What:** a window builtin whose v6 reference parameter is `series int` takes a per-bar
  length, for v6 scripts only. The parameter qualifier is read per function from the extracted
  reference (`tools/pine_survey/pine_reference_extract.js` output), never typed by hand.
  - A length that is `na`, below 1, or beyond the ring keeps a by-name refusal (`runtime:history-dynamic-offset`).
  - It never draws `na` where Pine draws a number.
- **Pine semantics:** the Reference Manual lists `length (series int)` for `ta.sma`, `ta.highest`,
  `ta.lowest`, `ta.stdev` and others. On each bar the window is the last `length` bars.
  - https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sma (and the sibling entries)
- **Acceptance:**
  - A reference-formula rail per function: a per-bar length equals the fixed-length kernel at
    that bar's length.
  - Capture W4-S1 turns REFERENCE into VENDOR (W1 precedent).
- **Mutations:**
  - read the span once at bar 0: the varying-length rail goes red;
  - serve v5: the v5 control goes red.
- **measure-pair:**
  - First wall moves on `ict-institutional-order-flow-fadi`, `market-structure-break-order-block`,
    `smarter-snr`, `zigzag-multi-time-frame-with-fibonacci-retracement`,
    `auto-length-moving-average-trend-signals-zeiierman`, `heatmap-volume-xdecow`.
  - Attach expected: `heatmap-volume-xdecow`.
- **Engine bump:** yes.
- **Depends:** T2 for lengths that are really `simple`. The rest is independent.

### T9 Offsets bounded by `simple` values and frame parameters | S | Sonnet

- **Files:**
  - FE `forCounterRange` (`:4598`) and `frameBoundRefusal` (`:4590-4596`);
  - the `READ_HIST_SLOT_DYN` sizing path (`RT/vm.js:699`, `:796`, read-only use).
- **What:**
  - A dynamic `x[n]` over a variable is sized when `n` is bounded by a T2 `simple` value.
  - A loop counter bounded by a frame parameter carries `frameName`, so the call site can fix it.
    Today the specialisation path is not reached from `forCounterRange`.
  - Example: `linear-regression-channel` (TradingView built-in), `price := source[j]`.
- **Pine semantics:** `x[n]` reads `n` bars back. A `simple` bound fixes the buffer before
  bar 0. https://www.tradingview.com/pine-script-docs/language/operators/#history-referencing-operator
- **Acceptance:** a counter bounded by a parameter, at two call sites with different lengths.
  The offset `src[zxLag]` with `zxLag = math.floor((len - 1) / 2)` stays refused (division, T17).
- **Mutation:** drop the `frameName` carry: the two-site rail refuses again.
- **measure-pair:**
  - First wall moves on `linear-regression-channel`, `optimized-trend-tracker`,
    `support-and-resistance`, `anti-volume-stop-loss`, `most-screener`.
  - Attach expected: `linear-regression-channel`.
- **Engine bump:** yes.
- **Depends:** T2.

### T10 State kernels: `ta.cum`, running totals, `ta.vwap`, pivots, `ta.stoch` over runtime values | M | Sonnet

- **Files:**
  - `ast/interpret.js` (`CARRIED` `:2504` and `FINITE_WINDOW` `:2434`: new rows only);
  - their Python mirror `api/services/ast_interpret.py`;
  - `RT/vm.js` `OP.CARRIED` (`:1080-1110`);
  - FE `builtinStateFamily` (`:4886-4933`; T1 merged first);
  - rail `RT/__tests__/w4StateKernels.test.js`.
- **What:** carried kernels over a mutable source, each holding its own state per call site:
  - `cum`, the running sum. It also serves the v1-v3 `x = iff(start, a, x[1] + a)` running totals
    that `pine.js` refuses as `pine:state` (`ast/pine.js:7459-7472`).
  - `vwap` with its session anchor.
  - `stoch`.
  - `pivothigh`/`pivotlow` as a delayed window (the value appears `rightbars` later).
- **Pine semantics:** Reference entries `ta.cum`, `ta.vwap`, `ta.stoch`, `ta.pivothigh`.
  - https://www.tradingview.com/pine-script-reference/v6/#fun_ta.cum
  - Witnessed for the column form: `vw-clock-vwap-spy-1d-2026-09-27`,
    `groupb-pivot-default-spy-1d-2026-09-10`.
- **Acceptance:** for each kernel, the over-state result equals the columnar result when the
  state equals a plain series (differential over the fixture bars). The Python mirror parity
  rail stays green.
- **Mutations:**
  - reset `cum` on `na`: the `na`-carry rail goes red;
  - emit a pivot without the delay: the delay rail goes red.
- **measure-pair:**
  - First wall moves on `advance-decline-line`, `anchored-vwap-pinch-handoff-intervals-and-signals`,
    `volume-divergence-by-mm`, `volume-suite-by-leviathan`, `coral-trend-indicator-lazybear`,
    `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh`.
  - Attach expected: `volume-divergence-by-mm`, `coral-trend-indicator-lazybear`.
- **Engine bump:** yes.
- **Depends:** T1. Only one task at a time owns `interpret.js` and the closed table.

### T11 Text builtins over runtime values | M | Sonnet

- **Files:**
  - `RT/text.js` (`TEXT_FNS` `:39`, `RUN_TEXT_FNS` `:98`);
  - FE text lowering (`:6120-6160`);
  - rail `RT/__tests__/w4TextFns.test.js`.
- **What:** `str.substring`, `str.replace` (nth occurrence), `str.tonumber`, `str.pos`, and
  `str.format_time` (NY only), plus `str.tostring` with `format.mintick`/`format.percent`/
  `format.volume`, all over runtime text.
- **Pine semantics:**
  - Strings concept page: https://www.tradingview.com/pine-script-docs/concepts/strings/
  - Reference: https://www.tradingview.com/pine-script-reference/v6/#fun_str.substring and siblings.
  - Formatting: queued in `capture-queue-2026-10-31-p3-wsb.md`.
- **Acceptance:**
  - Reference rails for index rules: 0-based, end exclusive, `na` on a bad index per the
    reference.
  - The `str.tostring` formats stay refused until W4-X1 is captured.
- **Mutation:** a 1-based `substring` makes the index rail go red.
- **measure-pair:** first wall moves on `fibonacci-retracement-mtflog`,
  `fibonacci-retracement-statistics-by-volprofex`, `session-tpo-profile`,
  `gex-levels-breakout-structure-session-avwap-esspxspy`, `sessions-nephew-sam`.
- **Engine bump:** yes.
- **Depends:** none.

### T12 Paint typing: colours, fill targets, per-bar colours | M | Sonnet

- **Files:**
  - FE `holdsColour` (`:2598`);
  - the colour-call check (`:6193-6200`);
  - the output colour checks (`:7250-7268`, `:7365`);
  - the fill-target check (`:7306`);
  - `RT/colours.js`;
  - `memberPaneDefinition.js` `runtimeRowColour` and `runtimePaintColour` (`:1037-1085`);
  - rail `RT/__tests__/w4PaintTyping.test.js`.
- **What:** `holdsColour` proves a colour through:
  - `?:` / `switch` / `if` values whose every arm is a colour or `na`;
  - colour-typed UDF results;
  - `var color` slots;
  - arrays of colours.

  `fill()` accepts a plot id bound through a `?:` of two ids. Per-bar colour outputs are carried
  where the host withheld them (`runtime:withheld-all` causes listed at
  `memberPaneDefinition.js:1494-1503`).
- **Pine semantics:** colour is a type, and `na` is a valid colour that hides the output.
  - https://www.tradingview.com/pine-script-docs/visuals/colors/
  - https://www.tradingview.com/pine-script-docs/visuals/fills/
  - House rule: never draw where TradingView hides.
- **Acceptance:**
  - A colour `switch` over an input text paints the chosen colour on each bar.
  - `color.new(close, 50)` still refuses.
  - An `na` arm hides the bar.
- **Mutations:**
  - treat a numeric arm as a colour: the `color.new(close, 50)` control goes red;
  - drop the `na`-hides rule: the hide rail goes red.
- **measure-pair:**
  - First wall moves on `nonlinear-regression-zero-lag-moving-average-loxx`,
    `visualizing-displacement-tfo`, `color-gradient-framework-pinecoders`, `edufx-amd`,
    `mema-bb-parabolic-sar`, `vwap-supply-demand-zones-pro`.
  - Attach expected: the first, second and fourth of those.
- **Captures:** W4-P2, for gradient or per-bar fill if served. Otherwise those stay refused.
- **Engine bump:** yes.
- **Depends:** none.

### T13 `plotcandle` / `plotbar` from the run | M (spike S first) | Sonnet

- **Files:**
  - FE presentation refusal (`:9710-9713`), `PRESENTATION_CALLS` (`:7019-7021`);
  - `memberPaneDefinition.js` `RUNTIME_ROW_KINDS` (`:956`) and `runtimeRowPresentation`
    (`:1016`);
  - the chart pane renderer for a candle row, which the spike must locate. The host lane has no
    candle row either: `ast/pine.js:29671` lists the call, and `REFUSALS['pine:presentation-only']`
    explains why it is not drawn.
- **What:** the spike (S, Haiku/Sonnet) answers whether the member pane can draw an OHLC row. If
  yes, the run emits four columns plus colour, wick and border as one row. If no, the task is
  re-scoped as a renderer task owned outside W4.
- **Pine semantics:** Bar plotting: https://www.tradingview.com/pine-script-docs/visuals/bar-plotting/ .
  Reference `plotcandle`: https://www.tradingview.com/pine-script-reference/v6/#fun_plotcandle
- **Acceptance:** capture W4-P1 MATCH on o/h/l/c and colour; an `na` open hides the candle.
- **Mutation:** swap the high and low columns: the capture rail goes red.
- **measure-pair:** first wall moves on `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor`,
  `volatility-trend-score-backquant`, `uptrick-volatility-adjusted-trail`. Attach expected:
  `uptrick-volatility-adjusted-trail`.
- **Engine bump:** yes.
- **Depends:** the spike.

### T14 v6 `bool` typing for valueless arms | S | Sonnet

- **Files:**
  - FE `typeTables` (`:7810`), `provablyNonBoolToks` (`:7963`), `refuseV6UnmatchedBool`
    (`:8022-8036`);
  - the `lowerSwitchInto` no-default path (`:8218-8225`);
  - rail `RT/__tests__/w4V6Bool.test.js`.
- **What:** type an `if`/`switch` value as bool when every arm yields a comparison, a logical
  operator, `true`/`false`, a bool input or a bool-typed name. In v6 an unmatched arm then yields
  `false`; in v5 it yields `na`. A value that is not provably bool or non-bool keeps the refusal.
  The object door keeps Q-A3 (`objectDoorRefuses`).
- **Pine semantics:** in v6, `bool` can never be `na`, and an unmatched `if`/`switch` returns
  `false` for bool.
  - v6 migration guide, "Boolean values": https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
  - Conditional structures: https://www.tradingview.com/pine-script-docs/language/conditional-structures/
- **Acceptance:**
  - Q-A3 capture (queue `capture-queue-2026-10-31-wsa-for-bound.md` lists it): v6 gives `false`,
    v5 gives `na`.
  - An untypable control still refuses.
- **Mutation:** return `na` in v6: the Q-A3 rail goes red.
- **measure-pair:** first wall moves on `volatility-stop` (TradingView built-in) and
  `nadaraya-watson-trend-quantalgo`. Attach expected: `volatility-stop`.
- **Engine bump:** yes.
- **Depends:** capture Q-A3. If it is not yet taken, build with the refusal kept for the
  untyped case, and serve the typed case only on MATCH.

### T15 Function and statement forms | M | Sonnet

- **Files:**
  - FE `defineFunction` (`:9918-10230`): parameter defaults at `:9951-9953`, valueless loop end
    at `:6047-6056`;
  - the statement walk for `log.*` (`:9859`);
  - one-line bodies in the function header reader;
  - rail `RT/__tests__/w4FunctionForms.test.js`.
- **What:**
  1. Parameter defaults `f(x, len = 14) =>`, with named arguments at the call.
  2. A function whose body ends in a `for`/`while` returns the loop's last value.
  3. A one-line body that is a binding or comma statements (`f(x) => a = …`,
     `ma(x)=>a=0.,a:=…`), read by the runtime reader only, never `ast/pine.js` (W3 owns that file).
  4. `log.info`/`log.warning`/`log.error` as statements with no chart effect. Their arguments are
     still evaluated, for side effects.
- **Pine semantics:**
  - User-defined functions (defaults, the last expression is the result):
    https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
  - Loops (a loop returns its last evaluated expression):
    https://www.tradingview.com/pine-script-docs/language/loops/
  - Pine Logs (no chart output): https://www.tradingview.com/pine-script-docs/writing/debugging/#pine-logs
- **Acceptance:**
  - One rail per form.
  - A loop that never runs returns `na`.
  - `log.error` does not stop the script: `runtime.error` stays the only stop (C43, `RT/runtimeColumns.js:1290`).
- **Mutations:**
  - return the first loop value: the last-value rail goes red;
  - make `log.error` stop the run: the stop rail goes red.
- **measure-pair:** each re-labelled peel row should attach or move. Measure after T0.
- **Engine bump:** yes.
- **Depends:** T0, to know the true count.

### T16 (folded into T15)

Only one sample script carries `log.*` as a real wall. Its work is item 4 of T15.

### T17 `max_bars_back` and integer division in sizes | S now (probes) + S after captures | Sonnet

- **Files:**
  - probes `tools/visual_conformance/probes/vw-w4-int-div-window.pine` and
    `vw-w4-max-bars-back.pine` (new);
  - then FE `constantArgOf` (`:10462-10466`), the `max_bars_back` directive (`:9715-9724`) and
    the `MBB_*` buffer rule (`:7055-7070`).
- **What:**
  - Write the probes now. They are the M1-M5 rows of the WS-C queue, plus a new D1 row:
    `ta.wma(close, 9/2)` against `ta.wma(close, 4)` and `close[21/2 + 1]`, under v4, v5 and v6,
    with an `input.int` operand and with a `const` operand.
  - After the captures, fold `/` per the version and qualifier rule that the capture shows, and
    serve `max_bars_back(x, n)` with Pine's buffer rule.
- **Pine semantics:**
  - The v6 migration guide (integer division) and the Type system page.
  - `max_bars_back`: https://www.tradingview.com/pine-script-reference/v6/#fun_max_bars_back
  - The buffer-limit runtime error: https://www.tradingview.com/pine-script-docs/error-messages/
- **Acceptance:** the D1 and M1-M5 captures MATCH. TradingView's own HMA and DPO, taken as
  local-evidence captures (LICENCE_HOLD), MATCH.
- **Mutation:** truncate where the capture says round, or the reverse: D1 goes red.
- **measure-pair:** attach expected: `detrended-price-oscillator` and `hull-moving-average`
  (both TradingView built-ins), `hurst-cycle-channel-clone-lazybear`, `rsi-cyclic-smoothed`.
  First wall moves on `double-topbottom-ultimate-os`, `ict-turtle-soup-flux-charts`,
  `linear-regression-channel-200`.
- **Engine bump:** yes, after the captures.
- **Depends:** captures D1 and M1-M5.

### Deferred (not W4 builds)

- `varip` and realtime (WS-F): it needs a tick-granular feed, so on bar data `varip` would
  equal `var`. Kept refused (`FE:8844`, `FE:9552`).
- `na` tests below v4 (G): two scripts; waits for the `rt1-na-test` captures.
- `for … in` goes to W6. `security` and `request.*` go to W7. Library aliases go to W8.
  Strategies go to W9.

## 4. What can run in parallel

The front end is one closure. "Region" means a function or line band at `e055b21e7f`. Two
tasks in the same file but in disjoint regions can run together. The later one rebases onto
the earlier one's merge, and the integrator merges them one at a time.

| task | files / regions it owns |
|---|---|
| T0 | `coverageMapDoorCensus.measure.test.js`, `tools/pine_coverage/coverage_map.py`, `tools/pine_coverage/w0/targets.py` (no `app/src` engine file) |
| T1 | FE `builtinStateFamily` `:4886-4933`; held-definition rethrow `:5958-5984` (pin only) |
| T2 | FE `constValueOf` `:4553-4585`, `foldConstNode` `:4656-4760`, `invariantTest` `:1712-1756`; a new `simpleValueOf` |
| T3 | FE session clock `:6582-6660`, `simpleSpecialisation` `:10295-10420`, `constantArgOf` `:10423-10475`, `fixedTextOf` `:10557+`; `RT/clockFns.js` |
| T4 | FE `armHistoryGuard` and `servedCondCall` `:2117-2222`, `case 'ternary'` `:5663-5717`; `RT/lowerIr.js` `:458-497` |
| T5 | FE `:1788-1796`, `:1850-1870`, `:2176-2222` (after T4) |
| T6 | FE `:2117-2140` plus `and`/`or` lowering; `RT/lowerIr.js` (after T4) |
| T7 | FE `hoistCommittedSeries` `:5158-5168`, `:5740-5760`, `:6370-6392`, `:6465-6490` |
| T8 | FE window lowering `:6320-6350`; `RT/vm.js` `OP.WINDOW` `:1027-1079`; `RT/ir.js` validator |
| T9 | FE `frameBoundRefusal` and `forCounterRange` `:4588-4640` (after T2) |
| T10 | `ast/interpret.js` tables plus `api/services/ast_interpret.py`; `RT/vm.js` `OP.CARRIED` `:1080-1110`; FE `:4886-4933` (after T1) |
| T11 | `RT/text.js`; FE `:6120-6160` |
| T12 | FE `holdsColour` `:2598`, `:6193-6200`, `:7250-7370`; `RT/colours.js`; `memberPaneDefinition.js` `:1037-1085` |
| T13 | `memberPaneDefinition.js` `:956`, `:1016-1036`; FE `:9710-9713`; renderer (spike) |
| T14 | FE `:7810-8040`, `:8218-8225` |
| T15 | FE `:9918-10230`, `:6047-6056`, `:9859` |
| T17 | probes (new files) now; FE `:7055-7070`, `:9715-9724`, `:10462-10466` later |

**Conflicts that force an order:**

| pair | why | order |
|---|---|---|
| T4 → T5, T6 | `armHistoryGuard` / `servedCondCall` | T4 first |
| T1 → T10 | `builtinStateFamily` | T1 first |
| T2 → T9 | the shared folding helpers | T2 first |
| T7 ⟂ T8 | both edit the windowed-call lowering near `:6320-6392` | merge one, rebase the other (T7 first) |
| T3 ⟂ T17 | both edit `constantArgOf` | T17 builds only after captures, so in practice T3 goes first |
| T12 ⟂ T13 | both edit `memberPaneDefinition.js`, in different functions | merge in order |
| T8 ⟂ T10 | both edit `RT/vm.js`, adjacent handlers | disjoint regions; merge one, then rebase the other |

**Batches** (at most 3 Opus or Fable agents at once; only 3 agents while free RAM is under
4 GB; heavy jobs serialized through the lock whatever the agent count):

- **Batch 1 (now):** T0, T1, T3, T4. No shared regions. T0 touches no engine file.
- **Batch 2:** T2, T7, T11, T12, plus the T17 probes and the T13 spike (docs/probes only).
- **Batch 3:** T9 (after T2), T8 (after T7), T10 (after T1), T14, T15 (after T0's re-count).
- **Capture-gated, as captures land:** T5 (H1-H4, H9), T6 (H7), T17 (D1, M1-M5), T13 (P1),
  T14 (Q-A3).

## 5. Risks, and where accuracy needs TradingView captures

**Risks**

1. **The every-bar versus per-run confusion (T4, T5).**
   - A plausible wrong line is the worst outcome this lane can produce (PHASE3 3.6 item 1).
   - The reviewer runs a differential on every T4/T5 PR: the same script with the call hoisted
     to the root versus left in the arm. The two must differ exactly on the bars the arm skips.
   - A rail with no skipped bars is not a rail ("a fixture that cannot distinguish").
2. **The object door leaks.** A missed `objectDoorRefuses` changes a live member's drawing. That
   is why measure-pair's C18 verdict diff must be 0, and why `objectDoorGate.test.js` gets a case per task.
3. **The census undercounts or overcounts.** Until T0 lands, wall counts in section 1 column A
   overstate statement-family walls by up to 13x (`pine:statement` 81 vs 6). Plan by columns
   C and D.
4. **The Python mirror drifts (T10).**
   - `ast_interpret.py` must gain the same kernels, or a scan or alert computes differently.
   - Server lanes do not run runtime docs yet (W5 T12 admits only the allowlist), so the risk is
     latent. It becomes live with W5 T13/T14.
5. **W5 interplay.**
   - W5 T2 edits `RT/runtimeColumns.js` (clock injection) and `ast/pine.js` `TRANSLATE_DEADLINE`.
     No W4 task owns those lines.
   - Every W4 engine bump regenerates W5's host-parity digests once T4 of W5 exists.
   - T3's day-mask and session logic falls under W5's tz/DST fixture (H7, W5 T5). Keep sessions
     NY-only until then.
6. **Engine-version churn.** About 12 bumps over W4. The coordinator batches bumps per merge, and
   each saved script re-translates once per bump (#610). Batching two small merges under one bump
   is allowed when they land the same day.
7. **Budget creep.** Per-bar windows (T8) and frame hoists (T7) allocate rings. Ring memory is
   counted (`HISTORY_VALUES`, `RT/limits.js:46-58`) and budgets are never raised. A script that
   no longer fits declines by name.

**Captures.** All rows go in one new queue doc, `docs/pine/capture-queue-2026-11-0X-w4.md`, in
the evidence engine's format (`docs/pine/EVIDENCE-ENGINE-DESIGN.md` 2.1):
- a markdown table whose first cell is the row id;
- a committed probe under `tools/visual_conformance/probes/`;
- an explicit `EXCH:SYM tf` chart;
- the guards and slugs the row unblocks.

`python tools/vendor_harness/evidence_engine.py queue` then derives
`docs/pine/vendor-harness/capture-queue.json`. Existing rows are reused by their ids; nothing is
copied.

| row | probe (new unless noted) | chart | guards | named scripts | settles | gates |
|---|---|---|---|---|---|---|
| H1, H2, H3, H4, H9, H10 (`capture-queue-2026-10-31-wsc-history.md`) | probes still to write (NEEDS_PROBE today) | `NYSE:RDDT 1D`, `AMEX:SPY 1D` | `runtime:conditional-history` | `williams-vix-fix-bottoms-and-tops`, `atr-god-strategy-by-tradesmart` | per-run windows, carried state, `x[k]`, expression history in blocks, `iff` | T5, T4 (`iff`) |
| H7 (same doc) | `vw-andor-history.pine` (exists) | `NYSE:RDDT 1D`, `AMEX:SPY 1D` | `runtime:conditional-history` | `ema-92150-vwap-macd-rsi-pro-v6` | v6 lazy `and`/`or` | T6 |
| M1-M5 (same doc) | `vw-w4-max-bars-back.pine` | `AMEX:SPY 1D` from the listing | `runtime:directive` | `double-topbottom-ultimate-os` | buffer sizing and the overrun error | T17 |
| Q-A3 (`capture-queue-2026-10-31-wsa-for-bound.md`) | as listed there | as listed there | `runtime:block-value` | `volatility-stop`, `nadaraya-watson-trend-quantalgo` | the v6 unmatched-bool value | T14 |
| W4-D1 | `vw-w4-int-div-window.pine` (v4, v5 and v6 variants as sibling files `-v4`, `-v5`) | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | `pine:window`, `pine:offset-literal` | `hull-moving-average`, `detrended-price-oscillator`, `rsi-cyclic-smoothed` | `int / int` as a window length or offset, per version and qualifier | T17 |
| W4-S1 | `vw-w4-series-length.pine`: `ta.sma`/`ta.highest`/`ta.stdev` with `len = bar_index % 7 + 1` | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | `runtime:history-dynamic-offset` | `heatmap-volume-xdecow`, `smarter-snr` | a per-bar length: last `len` bars, `na` handling | T8 (REFERENCE → VENDOR) |
| W4-T1 | `vw-w4-session-daymask.pine`: `time(timeframe.period, "0930-1600:23456")` and `:1` / `:7` | `AMEX:SPY 60` | `runtime:statement` | `session-hilo` | the day-mask digit map | T3 (day masks) |
| W4-T2 | `vw-w4-session-param.pine`: `f(s) => time(timeframe.period, s)` with an `input.session` | `AMEX:SPY 5` | `runtime:history-dynamic-offset` | `cm-forex-sessions-highlight-v1`, `ict-killzone` | a session text through a parameter | T3 |
| W4-K1 | `vw-w4-state-kernels.pine`: `ta.cum`, `ta.vwap`, `ta.pivothigh(x,3,3)`, `ta.stoch` over a `var` running value | `AMEX:SPY 1D` from the listing | `runtime:call-windowed-state`, `pine:state` | `volume-divergence-by-mm`, `coral-trend-indicator-lazybear` | kernels over a mutable source | T10 |
| W4-X1 | `vw-w4-text-format.pine`: `str.tostring(x, format.mintick/percent/volume)`, `str.substring`, `str.replace(…, n)`, `str.tonumber` drawn into a label | `AMEX:SPY 1D` | `runtime:call-text-state` | `session-tpo-profile` | format rules and index rules | T11 |
| W4-P1 | `vw-w4-plotcandle.pine`: `plotcandle(o, h, l, c, color=…)` with an `na` bar | `AMEX:SPY 1D` | `runtime:presentation` | `uptrick-volatility-adjusted-trail` | the candle row and hiding | T13 |
| W4-P2 | `vw-w4-paint-switch.pine`: a colour `switch` on an input text, an `na` arm, `fill` between ids picked by `?:` | `AMEX:SPY 1D` | `runtime:colour`, `runtime:fill-target` | `visualizing-displacement-tfo`, `edufx-amd` | colour typing and hiding | T12 |
| W4-L (local evidence) | TradingView's own McGinley, RSI, HMA, DPO, Volatility Stop and Linear Regression Channel scripts (LICENCE_HOLD) | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | as above | the six built-ins | built-in parity after T2, T4, T9, T14, T17 | grading only |

The owner runs the rig (E.3). W4 rows are batched by evidence-engine priority. W4-L rows run in
local-evidence mode only (LICENSING.md). No W4 builder signs in, opens TradingView or runs the
rig.

## 6. The first batch to launch now

Four tasks share no region, and each has a precise spec above:

| # | task | tier | why now |
|---|---|---|---|
| 1 | **T4** arms run only when chosen | Opus | The highest-value correctness item (R4). Its captures are already witnessed (H6). It restores TradingView's own McGinley. |
| 2 | **T3** text constants and sessions | Sonnet | 10 step-0 rows and 2 expected attaches, with no capture needed for the non-mask half. |
| 3 | **T1** classifier honesty | Sonnet | S; moves 16 rows to their true wave (W7), and unblocks T10. |
| 4 | **T0** instrument honesty | Sonnet | Tooling only. It corrects the ranking every later W4 decision reads. Hand it to the W0 lane. |

Memory: if free RAM is under 4 GB at launch, run T4, T3 and T1, and queue T0 behind them.
Every heavy job (vitest, census, harness) goes through the lock, one at a time. The integrator
runs measure-pair once per merge, not per task.

**Next, the moment batch 1 merges:** T2 (Opus), T7, T11, T12, plus the T17 probes and the T13
spike, then batch 3 per section 4.

## 7. How these numbers were taken

Read-only Python over two files:
- the committed `docs/pine/coverage-map.json`;
- W1's final runtime-on census rows at
  `C:\Users\pgosz\uct-worktrees\_resume-laptop\runs\w1final\rt\tip\census\census.jsonl`
  (974 rows, 486 attached; licence-held, not committed).

Method:
- The wall of a step is `runtimeDeclined.code`, else `rtProbe.guard`.
- A step counts as step 0 when the source is unpeeled.
- Peel-own `x = 0.0` lines and post-peel `pine:undefined` are dropped, as `coverage_map.py`
  already does.
- Waves follow `tools/pine_coverage/w0/targets.py:44-60`, with the three re-labels of
  section 0.

No vitest, census or harness was run for this document.
