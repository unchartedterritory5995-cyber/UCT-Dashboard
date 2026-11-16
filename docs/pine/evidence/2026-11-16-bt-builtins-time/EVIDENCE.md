# bt: built-ins and the session clock (NUMBER PENDING), 2026-11-16

Coverage unit "missing built-ins + time/session built-ins". Branch `feat/pine-coverage-builtins-time`,
cut from `origin/master` `e9807547d0` (engine 61), master merged at `6a1f2e5fb6` (engine 62). No engine
bump: the history line is a `NUMBER PENDING` entry in `scriptEngineVersion.js`; the landing train numbers
it. Queue rows: `docs/pine/capture-queue-2026-11-16-bt-builtins-time.md` (Q-BT1, Q-BT4, Q-BT5 captured and
closed; Q-BT2 `"1440"` and Q-BT3 `math.toradians` open).

⛔ **This PR waits on the capture session's data PRs.** Five BITSTAMP:BTCUSD captures witness what it
serves; they reach `tests/fixtures/vendor/harness/` only through those PRs (never a copy committed here).
Until they are on the tree, `ast/btSessionClock.test.js` skips their five blocks by a title that says so,
and the PR does not merge while a skip stands: once the data PRs land, master is merged in and the skip is
removed so a missing capture is red. The blocks were run against the licence-store copies on this tree
(below): 16 / 16 pass.

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

The same rule reaches one script that was refused at install on master too: the harness's
`mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14` were INCONCLUSIVE on both lanes
("measures 10 and the cap is 8 … `compute.trees.out2`"). This PR's pine-heavy harness legs grade them on
this branch; the verdict moves are reported in the PR.

## Coverage: the census's own predicate, targets plus controls

`coverageMapDoorCensus.measure.test.js` over a subset input (the 114 scripts whose engine-60 walls touch this
unit's families, plus 25 transferring controls that read `time(`, sessions, `timeframe.in_seconds`, theme
colours, `avg(`, `color(` or `syminfo.`), both lanes, on `e52b588ce3`. **Before = the engine-60 census rows,
2026-11-16** (`runs/cov-e60/{rt,prod}/census.jsonl`; engine 61/62 changed no transfer status: price-scale join,
request-pending and round_to_mintick only). Transfer is the coverage map's predicate (production: `clean`;
runtime-on: `clean` or attached on the runtime lane at step 0; never a strategy that places orders).

| lane | targets transferring | controls transferring | first wall moved |
|---|---|---|---|
| runtime-on | 0 -> **3** | 25 -> 25 | 7 |
| production | 0 -> **2** | 18 -> 18 | 4 |

Every target whose first wall moved:

| script | runtime-on before | runtime-on after | production before | production after |
|---|---|---|---|---|
| `committed:sessions__2677` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | **TRANSFERS** |
| `reference:nylondonasian-sessions-ict-swings__14bce3660b` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | **TRANSFERS** |
| `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749` | `pine:function` `time` (wrap) | **TRANSFERS** | `pine:function` `time` | `pine:function` `time` (unchanged: the host lane refuses an earlier shape; the runtime lane carries it) |
| `committed:chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2` | `pine:function` `time` | attached; object removals withheld | `pine:function` `time` | attached; object removals withheld |
| `committed:initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q` | `pine:function` `time` (v4 no day list) | `pine:request` `security` | `pine:function` `time` | `pine:function` `time` (another time() shape) |
| `reference:range-filter-x-hull-suite__8430e18838` | `runtime:request` | attached; partial loss withheld | `pine:function` `time` (`"UTC+1"`) | attached; partial loss withheld |
| `reference:session-liquidity__96d8d1599c` | `pine:function` `time` (wrap) | `runtime:conditional-history` | `pine:no-output` | `pine:no-output` |

No control and no target moved from transferring to not transferring on either lane.

## Capability admission for the scripts that newly transfer on the runtime lane

Capability admission is ON in production (`PINE_RUNTIME_CAPABILITY_ADMISSION=on`, the coordinator's
reading of the service; this tree's local default is off). Read with `api/services/runtime_definitions.py`
and `pine_capabilities.capabilities_of` against the committed kill list (`api/data/pine_runtime_killlist.json`):

| script | sha256 (prefix) | capabilities | admitted | killed | on the graded allow list | graded |
|---|---|---|---|---|---|---|
| `committed:sessions__2677` | `73c2cc29a76bf99d` | core, fn-multi, fn-single, if-block, reassign, ternary | yes | no | no | `sessions-rddt-1d-2026-11-14` (committed capture; graded by the pine-heavy legs) |
| `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749` | `9d9ef18357506d24` | core, fn-multi, fn-single, history-expr, if-block, method-call, obj:delete, obj:label, obj:line, realtime-state, reassign, tuple-destructure, var | yes | no | no | NO CAPTURE: queued as Q-BT6 (NYSE:RDDT 1D + AMEX:SPY 1D) |
| `reference:nylondonasian-sessions-ict-swings__14bce3660b` | `39bd272630b925ff` | core, fn-multi, fn-single, if-block, obj:line, reassign, ternary, var | yes | no | no | `nylondonasian-sessions-ict-swings-rddt-1d-2026-11-14`, licence store only: graded on this PC, the grade is in the PR |

So all three would be admitted to members by capability. An admitted script graded DIVERGE goes on the kill
list in this PR, with a rail.

## Tests (each with the commit it ran on)

| what | where | commit | result |
|---|---|---|---|
| touched vitest files (`btSessionClock`, `btRuntimeClock`, `pineVocabularyWave`, `w4TextConstants`, `pine.tfternary`, `runtimeClockCalls`, `pineMathCeilAccept`, `pineTimenowAccept`, `openingRangeBoolCast.vendor`, `noRegexLookbehind`) | GitHub runners, `tools/remote_tests.py`, run 43940205861 | `6a1f2e5fb6` | 2 failed (the chart-champions rails, which now translate), every other file green; 5 skipped = the capture blocks |
| the two chart-champions rails, re-pinned | run 43941706457 | `e52b588ce3` | GREEN, 2 files passed |
| the pytest twins (`tests/test_pine_*.py`, `tests/test_runtime_definitions.py`) | run 43940205861 | `6a1f2e5fb6` | 1221 passed, 1 skipped |
| `btSessionClock.test.js` with the five licence-store captures present (untracked, placed only for this run, removed after, absence checked) | this PC, lock hold | `e52b588ce3` | 16 passed (16) |
| census, both lanes | this PC, lock hold | `e52b588ce3` | 139 / 139 rows each lane |
| `evidence_engine.py queue --check`, `pins --check`, `refusal_codes.py --check`, `check_repo_hygiene.py` | this PC | after the master merge | pass |

## Mutants (this PC, lock hold, tree `e52b588ce3`; each restored from a saved copy, `git hash-object` = HEAD)

| id | mutation | focused rails | result |
|---|---|---|---|
| M1-wrap-day | the after-midnight part of a wrapping session asked of today's day list, not tomorrow's | btSessionClock, btRuntimeClock | 4 failed, red |
| M2-value-wrap | the value after midnight without the `+1440` wrap | btSessionClock, btRuntimeClock | 4 failed, red |
| M3-v4-days | v4 no-day-list read as every day | btSessionClock | 3 failed, red |
| M4-avg-version | bare `avg` served in v5 too | btRuntimeClock | 1 failed, red |
| M5-in-seconds | runtime `timeframe.in_seconds` lowering removed | btRuntimeClock | 3 failed, red |
| M6-to-midnight | "HHMM-0000" read as empty | btSessionClock | 4 failed, red |
| M7-utc-sign | a UTC offset read with the wrong sign | btSessionClock | 1 failed, red |
| M8-legacy-period | bare `period` accepted again in v4+ | btSessionClock, btRuntimeClock, w4TextConstants | 3 failed, red |

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
