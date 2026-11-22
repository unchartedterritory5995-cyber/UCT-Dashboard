# bt: built-ins and the session clock (NUMBER PENDING), 2026-11-16

Coverage unit "missing built-ins + time/session built-ins". Branch `feat/pine-coverage-builtins-time`,
cut from `origin/master` `e9807547d0` (engine 61), master merged at `6a1f2e5fb6` (engine 62). No engine
bump: the history line is a `NUMBER PENDING` entry in `scriptEngineVersion.js`; the landing train numbers
it. Queue rows: `docs/pine/capture-queue-2026-11-16-bt-builtins-time.md` (Q-BT1, Q-BT4, Q-BT5 captured and
closed; Q-BT2 `"1440"` and Q-BT3 `math.toradians` open).

All five BITSTAMP:BTCUSD captures that witness what this serves are on master, through the capture
session's data PRs (never a copy committed here): `vw-w4-session-overnight-btcusd-60` with #1472 (run cq1),
the other four with #1494 (runs ac2 / ac3). Each is byte-identical (sha256) to the licence-store copy the
rail was graded against before it landed (19 / 19 on this PC, lock hold, `353aa19c44`). Master is merged in
(`733e2fbb7d`) and every block of `ast/btSessionClock.test.js` is UNCONDITIONAL: a missing capture is red.

| capture | probe | rows |
|---|---|---|
| `vw-w4-session-overnight-btcusd-60-2026-11-16` (run cq1) | `vw-w4-session-overnight.pine` | O1-O4, 25,215 bars |
| `vw-bt-session-overnight-value-btcusd-60-2026-11-16` (run ac2) | `vw-bt-session-overnight-value.pine` | V1-V4, 25,216 bars |
| `vw-bt-session-overnight-value-btcusd-1d-2026-11-16` (run ac2) | same | V1-V4, 5,537 bars |
| `vw-bt-session-to-midnight-daymask-btcusd-60-2026-11-16` (run ac2) | `vw-bt-session-to-midnight-daymask.pine` | M1/M2, 25,216 bars |
| `vw-w4-session-default-days-v4-btcusd-60-2026-11-16` (run ac3) | `vw-w4-session-default-days-v4.pine`, rows re-spelled `timeframe.period` by the capture session | N1-N3, 25,216 bars |

## What is served now, and what witnesses each shape

| shape | lanes | witness |
|---|---|---|
| `time(tf, "HHMM-0000[:days]")`: the window runs to midnight of its OWN day; a day list is asked of the bar's day | host; runtime through the host's session clock | O3 ("2000-0000:1234567" in at 20:00-23:00 every day); M1 ("2000-0000:23456" in at 20:00-23:00 of Monday-Friday themselves); `vw-time-session-spy-*` S15 now MATCHES on all four SPY captures (na on every bar: no bar there opens after 20:00) |
| `time(tf, "0000-0000[:days]")`: the bar's own date, whole day | host, runtime | O4 (in on every bar); user manual session table ("0000-0000:23456 — A 24-hour session beginning at midnight, but only Monday to Friday"); the v4 reference's own example |
| a WRAPPING session (end at or before start): membership, the after-midnight part belonging to the session that ENDS that day | host, runtime | O1 ("1800-0200:1234567" in 18:00-23:00 and 00:00-01:00 every day); O2 ("1800-0200:23456" in from Sunday 18:00 to Friday 01:00, never Friday 18:00, never Saturday); user manual: "1700-1700:23456 — An overnight session. The Monday session starts Sunday at 17:00 and ends Monday at 17:00" |
| the VALUE inside a wrapping session: the session-anchored grid continued across midnight | host, runtime | V1 "1930-0230" answers -1800 s on every in-session hourly bar, 00:00-02:00 included; V2-V4 0 on hourly bars; on 1D the session's start the evening before (V1 -16200, V2 -21600, V3 "1700-1700" -25200, V4 "2000-1630" -14400 s on a 00:00 UTC bar). The same rule as the measured same-day one (S04 / S08, `vw-time-session-spy-60-*`), whose tree is unchanged (railed) |
| a v4 session with no day list = `:23456` | host, runtime | N1 (Monday-Friday on every bar); v4 reference (`time`): "If the days aren't specified, the session is considered to have been set from Monday to Friday"; v4->v5 migration guide: "has changed from "23456" (Monday to Friday) to "1234567" (Sunday to Saturday)" |
| a fixed zone spelled `"UTC±H"`, `"UTC±HH:MM"`, `"GMT±HHMM"` | host, runtime | user manual (Time, "Time zone strings"): "UTC (or GMT) offset notation, e.g., "UTC-5", "UTC+05:30", "GMT+0100""; the arithmetic is the measured `"GMT-4"` / `"GMT-5"` one (S11 / S12), trees identical (railed) |
| runtime: `timeframe.in_seconds([tf])`, tf fixed before bar 0 | runtime (the host's own `timeframeCallOf`) | vw-time-tf T10-T15 (`pineVocabularyWave.test.js`), one reader for both lanes |
| runtime: v1-v4 bare `avg(…)` = `math.avg(…)` | runtime (the host already expands it) | v4->v5 migration guide, `math` table: "`avg()` / `math.avg()`" |

## What changed to REFUSED: an over-acceptance closed

An unbound bare `period` in a v4+ script was read as the chart's timeframe. TradingView's v4 compiler
refuses it ("Compilation error: Undeclared identifier 'period';", the capture session's reading of
`vw-w4-session-default-days-v4`, recorded in the captured source's header), and neither the v4 nor the v5
reference holds a bare `period`. It now refuses `pine:builtin` by name on every lane
(`pine.js::legacyPeriodRefusal`: "`period` is the chart's timeframe in Pine v1–v3 only ... write
`timeframe.period`"). A script's own `period` binding, and v1-v3, are unchanged. Measured: no corpus,
reference, builtin, test-fixture or probe script of v4+ uses an unbound bare `period`; five rails that
wrote it in v4 are re-spelled `timeframe.period` (`pine.tfternary`, `w4TextConstants` x4,
`runtimeClockCalls` x1).

## A regression this unit caused, and its fix: a knob may never cost the script its install

The coverage ratchet named `corpus/committed/session-hilo__WM2g5GtC4h.pine` LOST on both lanes on
`e64bc57ee0`: it attaches on master and failed to INSTALL here (`compute.budget: exceeds the
series-reference budget`). Its session, `"1800-1500"`, wraps; on master that refused, which folded the
script's `Use Session Constraint` / `Include Weekends` / `Show Lines` toggles to their defaults. Served
here, those toggles became live member knobs, and every live input is a distinct `series` name to
`budget.js::seriesRefs` (cap 8). Measured per tree (a scratch diagnostic on GitHub runners, never
committed): master `value` = {high, self, time}; this branch {dayofweek, high, hour, minute, s_incWE,
s_lines, s_useSess, self, time} = 9.

1. `5bc583b4b3`: a membership read (`na(time(…))` with a wrapping session) is the membership tree alone,
   without the value tree's `time` / `periodseconds` (10 -> 9; railed, M10).
2. `1063dccb83`: the member door (`builder/builderInputs.js::memberInputTranslation`) gives back the knobs
   an output over `budget:series` reads, folded to the author's defaults, only when that brings fewer
   outputs over the cap, and names each in the row's skipped inputs (`budgetRefusal`, flag `budgetBound`).
   A script with no output over the cap is untouched, so this only turns a definition the registry refuses
   into one it installs. Rails: `builder/knobInstallBudget.test.js` (an over-cap fixture measured at 9,
   its four toggles given back by name, installs; an under-cap control keeps its knob) and the session-hilo
   install rail in `ast/btSessionClock.test.js`; mutants M11, M12.
3. `budget.js`'s note that `budget:series` "cannot fire" held for the table's five price series only (clock
   columns, `self` and knobs are series too); corrected in place. The cap is unchanged.

The rule does NOT reach the one other script refused at install for this cap on master: the harness's
`mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14` still measure 10 against 8 on
`compute.trees.out2` on this branch (graded on this PC, both lanes): its over-cap column reads no knob
the door could give back. Unchanged, INCONCLUSIVE.

## Two more rails this unit's gains reached (pine-heavy `engine-ast-2` on `76de8c4068`)

1. `lookbackAgreement.test.js`: chart-champions translates now, and seven of its trees ("Sun-2DVWAP" …
   "Sat-2DVWAP") read 251 bars back to `interpret.js::maxLookback` and "unanalysable" to
   `lint.js::maxLookback`. Measured on GitHub runners (a scratch diagnostic, never committed): the linter's
   only reasons were `lastbaryear` / `lastbarmonth` / `lastbardayofmonth` "declare an UNBOUNDED forward reach".
   Those leaves declare `lookback: 0`; `lint.js::ownWindow` answered `back: UNKNOWN` whenever the FORWARD half
   was unbounded. It now reads the back half from the lookback (`ast_lint._own_window` the same); the repaint
   verdict is unchanged (forward stays unbounded, the tree still `repaints`). No tree on master held such a
   leaf, which is why the rail never saw it. Rails: `ast/lintUnboundedForwardBack.test.js` and its twin in
   `tests/test_ast_lookback_agreement.py`; mutants M13 (JS) and M14 (Python).
2. `pine.tickerCall.test.js`: a rail wrote the v3 forms `tickerid` / `security(t, period, hl2)` under a
   `//@version=5` header; bare `period` refuses by name from v4 on now. Re-spelled `timeframe.period`, the
   rail's subject (the ticker) unchanged.

## Coverage: the census's own predicate, targets plus controls

`coverageMapDoorCensus.measure.test.js` over a subset input (the 114 scripts whose engine-60 walls touch this
unit's families, plus 25 transferring controls that read `time(`, sessions, `timeframe.in_seconds`, theme
colours, `avg(`, `color(` or `syminfo.`), both lanes. **Before = the engine-60 census rows, 2026-11-16**
(`runs/cov-e60/{rt,prod}/census.jsonl`; engine 61/62 changed no transfer status: price-scale join,
request-pending and round_to_mintick only). Transfer is the coverage map's predicate (production: `clean`;
runtime-on: `clean` or attached on the runtime lane at step 0; never a strategy that places orders).
Measured twice, lock holds on this PC: `e52b588ce3` and again on `353aa19c44` (the knob rule and
`time("", …)` included; master since then brings no engine source change). The table is the second.

| lane | targets transferring | controls transferring | first wall moved |
|---|---|---|---|
| runtime-on | 0 -> **3** | 25 -> 25 | 8 |
| production | 0 -> **2** | 18 -> 18 | 6 |

Every target whose first wall moved:

| script | runtime-on before | runtime-on after | production before | production after |
|---|---|---|---|---|
| `committed:sessions__2677` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | **TRANSFERS** |
| `reference:nylondonasian-sessions-ict-swings__14bce3660b` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | **TRANSFERS** |
| `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | `pine:hidden-only` (its plots are all hidden on the host lane; the runtime lane carries it) |
| `committed:ict-killzone-index-version__28962c02dd` | `pine:function` `time` | attached, refusal `pine:objects-only` | `pine:no-output` | attached, refusal `pine:objects-only` |
| `committed:chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2` | `pine:function` `time` | attached; object removals withheld | `pine:function` `time` | attached; object removals withheld |
| `committed:initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q` | `pine:function` `time` (v4 no day list) | `pine:request` `security` | `pine:function` `time` | `pine:function` `time` (another time() shape) |
| `reference:range-filter-x-hull-suite__8430e18838` | `runtime:request` | attached; partial loss withheld | `pine:function` `time` (`"UTC+1"`) | attached; partial loss withheld |
| `reference:session-liquidity__96d8d1599c` | `pine:function` `time` (wrap) | `runtime:conditional-history` | `pine:no-output` | `pine:no-output` |

No control and no target moved from transferring to not transferring on either lane (139 / 139 rows each).

## Harness: the captures this unit moves, graded on this PC (both lanes, `353aa19c44`)

Committed captures and the licence-store captures of the moved scripts, from a scratch directory outside
the repo; "master" is `docs/pine/vendor-harness/{production,runtime-on}/verdicts.json`. Both lanes read alike.

| capture | master | this branch |
|---|---|---|
| `sessions-rddt-1d-2026-11-14` | INCONCLUSIVE (refused `pine:function`) | **MATCH**, all 10 items agree (paints: plots 3, 7, 11 agree 666/666, plot 15 na on both) |
| `vw-time-session-spy-1d-2026-09-28` | INCONCLUSIVE | **MATCH**, all 20 items agree (S15 now served) |
| `session-hilo-rddt-1d-2026-11-14` | MATCH | MATCH, all 4 items (held: the install fix) |
| `nylondonasian-sessions-ict-swings-rddt-1d-2026-11-14` (licence store) | not graded on master | **MATCH**, all 8 items agree |
| `range-filter-x-hull-suite-{rddt,spy}-1d-2026-11-14` (licence store) | not graded on master | INCONCLUSIVE: 1 of 15 not compared (two `alertcondition`s draw nothing) |
| `vw-time-session-spy-60-{ext,rth}-2026-09-28` | INCONCLUSIVE | INCONCLUSIVE, 1 of 20 not compared |
| `chart-champions…`, `initial-balance…`, `opening-range…`, `mtf-key-levels…` (RDDT and SPY) | INCONCLUSIVE | INCONCLUSIVE (install lookback cap; `pine:function`; not compared; install series cap) |

Two pins in `vendorHarness.b1Paints.test.js` moved with it, to the door's own answer: `sessions-rddt-1d`
(refused -> the five paint lines above) and `ict-killzone-index-version-rddt-1d` (`pine:no-output` ->
`pine:objects-only`: its session translates, so the door reaches the objects refusal).

## Capability admission for the scripts that newly transfer on the runtime lane

Capability admission is ON in production (`PINE_RUNTIME_CAPABILITY_ADMISSION=on`, the coordinator's
reading of the service; this tree's local default is off). Read with `api/services/runtime_definitions.py`
and `pine_capabilities.capabilities_of` against the committed kill list (`api/data/pine_runtime_killlist.json`):

| script | sha256 (prefix) | capabilities | admitted | killed | on the graded allow list | graded |
|---|---|---|---|---|---|---|
| `committed:sessions__2677` | `73c2cc29a76bf99d` | core, fn-multi, fn-single, if-block, reassign, ternary | yes | no | no | `sessions-rddt-1d-2026-11-14` (committed): **MATCH** both lanes, all 10 items |
| `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749` | `9d9ef18357506d24` | core, fn-multi, fn-single, history-expr, if-block, method-call, obj:delete, obj:label, obj:line, realtime-state, reassign, tuple-destructure, var | yes | no | no | NO CAPTURE: queued as Q-BT6 (NYSE:RDDT 1D + AMEX:SPY 1D) |
| `reference:nylondonasian-sessions-ict-swings__14bce3660b` | `39bd272630b925ff` | core, fn-multi, fn-single, if-block, obj:line, reassign, ternary, var | yes | no | no | `nylondonasian-sessions-ict-swings-rddt-1d-2026-11-14`, licence store only, graded on this PC: **MATCH** both lanes, all 8 items |

So all three would be admitted to members by capability. None graded DIVERGE, so none goes on the kill list;
session-highs-dst-safe is admitted with no capture behind it until Q-BT6 is taken.

## Tests (each with the commit it ran on)

| what | where | commit | result |
|---|---|---|---|
| touched vitest files (`btSessionClock`, `btRuntimeClock`, `pineVocabularyWave`, `w4TextConstants`, `pine.tfternary`, `runtimeClockCalls`, `pineMathCeilAccept`, `pineTimenowAccept`, `openingRangeBoolCast.vendor`, `noRegexLookbehind`) | GitHub runners, `tools/remote_tests.py`, run 43940205861 | `6a1f2e5fb6` | 2 failed (the chart-champions rails, which now translate), every other file green; 5 skipped = the capture blocks |
| the two chart-champions rails, re-pinned | run 43941706457 | `e52b588ce3` | GREEN, 2 files passed |
| the pytest twins (`tests/test_pine_*.py`, `tests/test_runtime_definitions.py`) | run 43940205861 | `6a1f2e5fb6` | 1221 passed, 1 skipped |
| session/runtime clock and harness-adjacent rails, `test_pine_capability_admission` | GitHub runners | `5bc583b4b3` | 1 red: the session-hilo install rail (9 > 8), which led to `1063dccb83` |
| `builder/` (all), session/runtime clock, budget, param ids, `vendorHarness/` (all), `memberPaneTables` + pytest budget / session-window / admission / dispositions | GitHub runners, run 43965028640 | `353aa19c44` | pytest green; vitest 4 red, all four rails of this unit's own making: the knob fixture and the session-hilo rail named knobs that are folded away unread (only the first toggle is listed), and two `b1Paints` pins that moved with the served sessions. Corrected and re-pinned after it |
| `btSessionClock.test.js` with the five licence-store captures present (untracked, placed only for this run, removed after, absence checked) | this PC, lock hold | `353aa19c44` + the `dc4f4333b7` rail | 19 passed (19) |
| census, both lanes | this PC, lock hold | `353aa19c44` | 139 / 139 rows each lane |
| `engine/ast/` (all), `runtimeRepaint` + pytest `test_ast_lookback_agreement`, `test_ast_lint`, `test_ast_budget` | GitHub runners, run 43980824801 | `c7eb129062` | GREEN: vitest 6,324 passed, 17 skipped; pytest 90 passed |
| the touched rails again (knob, session clock, `b1Paints`, runtime clock, dispositions) | GitHub runners, run 43971319991 | `76de8c4068` | GREEN: vitest 161 passed, 4 skipped (the four ac2/ac3 capture blocks); pytest 10 passed |
| harness over the moved captures, both lanes | this PC, lock hold | `353aa19c44` | the table above |
| `evidence_engine.py queue --check`, `pins --check`, `refusal_codes.py --check`, `check_repo_hygiene.py`, `test_queue_dispositions.py` | this PC | after each master merge (last `5465c83b64`) | pass |

## Mutants (this PC, lock holds; each restored from a saved copy, `git hash-object` = HEAD)

| id | mutation | focused rails | tree | result |
|---|---|---|---|---|
| M1-wrap-day | the after-midnight part of a wrapping session asked of today's day list, not tomorrow's | btSessionClock, btRuntimeClock | `e52b588ce3` | 4 failed, red |
| M2-value-wrap | the value after midnight without the `+1440` wrap | btSessionClock, btRuntimeClock | `e52b588ce3` | 4 failed, red |
| M3-v4-days | v4 no-day-list read as every day | btSessionClock | `e52b588ce3` | 3 failed, red |
| M4-avg-version | bare `avg` served in v5 too | btRuntimeClock | `e52b588ce3` | 1 failed, red |
| M5-in-seconds | runtime `timeframe.in_seconds` lowering removed | btRuntimeClock | `e52b588ce3` | 3 failed, red |
| M6-to-midnight | "HHMM-0000" read as empty | btSessionClock | `e52b588ce3` | 4 failed, red |
| M7-utc-sign | a UTC offset read with the wrong sign | btSessionClock | `e52b588ce3` | 1 failed, red |
| M8-legacy-period | bare `period` accepted again in v4+ | btSessionClock, btRuntimeClock, w4TextConstants | `e52b588ce3` | 3 failed, red |
| M9-empty-tf | `time("", …)` no longer the chart's own timeframe on the host lane | btSessionClock | `353aa19c44` | 1 failed (the `""` rail), red |
| M10-membership-tree | a membership read builds the value tree again | btSessionClock | `353aa19c44` | 1 failed (the membership-tree rail), red |
| M11-knob-budget | the member door stops giving knobs back | btSessionClock, knobInstallBudget | `353aa19c44` | red: the session-hilo install rail (green unmutated in the same hold) |
| M12-budget-reason | a knob given back loses the budget's reason | knobInstallBudget | `76de8c4068`, GitHub runners run 43971377446, a scratch commit (the worktree never edited; its ref deleted after) | 1 failed of 3: the reason assertion (the row read "the formula never reads useO", not the budget's sentence), red; the same file unmutated is green in run 43971319991. The lock hold's run on `353aa19c44` was no proof: that fixture's set assertion was itself wrong on that tree |
| M13-lint-back | the linter answers an unknown back again when the forward reach is unbounded (JS) | lintUnboundedForwardBack | `c7eb129062`, GitHub runners run 43981061437, scratch commit | 1 failed of 2 ("both readers give one number"), red; unmutated green in run 43980824801 |
| M14-lint-back-py | the same in the Python twin (`ast_lint._own_window`) | test_ast_lookback_agreement | `c7eb129062`, GitHub runners run 43981131550, scratch commit | 1 failed of 6 (`(20, None)`: interpreter 20, linter unanalysable), red; unmutated green in run 43980824801 |

## What stays refused, by name

| shape | guard | what would settle it |
|---|---|---|
| a v1-v3 session with no day list | `pine:function` ("... the default days are not stated by any reference text this engine holds") | a v1-v3 reference text or probe; none held (`trading-session-indicator`, `cm-forex-sessions-highlight-v1` wait on it) |
| `time("1440", …)` | `pine:function` ("... the chart's OWN timeframe") | Q-BT2 `vw-bt-time-1440.pine` |
| `math.toradians` / `math.todegrees` | unchanged | Q-BT3 `vw-bt-toradians.pine` (the reference says only "approximately equivalent"; three spellings differ in the last bit) |
| `chart.left_visible_bar_time` / `chart.right_visible_bar_time` | `pine:builtin`, ruled sentence | by design: TradingView re-runs the script on every scroll |
| `chart.bg_color` / `chart.fg_color` read as a value | `pine:builtin`, ruled sentence | engine work: the chart theme in the bind context (painted with, they are already carried) |
| `syminfo.type` / `.description` / `.volumetype` / `.prefix()` / `.target_price_*` | unchanged | the symbol store has to hold the field |
| `ta.sar`, `ta.dmi`, `ta.kc` with a computed `useTrueRange`, legacy `correlation` over runtime state | unchanged | not built in this unit |
| type casts (`color(na)`, `string(x)`), call shapes (`color.new(c, transp=…)`, `array.new_float(n, initial_value=…)`, `array.min(a, n)`, `ta.change(x, n)`), `pine:offset-literal` (fractional offsets) | unchanged | not built in this unit: none is the last wall of a target script; fractional offsets are today's capture batch |
