# RULING-0927: the four rows "blocked by a ruling, not by a capture"

Date: 2026-11-07. Made by the desktop coordinator lane under the owner's delegation. Source table:
`docs/pine/capture-queue-2026-09-27.md`, section "Blocked by a RULING". Base: origin/master `33a8a2ab43`
(engine 32; `SCRIPT_ENGINE_VERSION` not touched). Rail: `app/src/components/chart/engine/ast/ruling0927.test.js`
(13 tests).

The rule applied: serve exactly what the captures show, under the conditions they cover; anything they do not
decide stays refused by name, with the reason written down.

## 1. `barstate.isnew`: STAYS REFUSED (reason rewritten)

Evidence:
- `tests/fixtures/vendor/barstate-full-spy-1d-closed-2026-09-10.json`, 5-bar tail (column `N25_isnew`): the four closed bars read 1,
  the newest reads 0 (with `isrealtime=1`, `ishistory=0`).
- `tests/fixtures/vendor/barstate-daily-timeline.json`, 9 rows on one bar series (AMEX:SPY D, regular): the vendor's `isnew` equals
  its own `ishistory` on every row. It reads 0 on six rows (16:17 to 20:55 ET) and 1 on three (23:57 to 07:38 ET).
  Our seam (`ourSeamSaysForming`) answered `false` at all nine instants.
- No capture holds `isnew` on a forming bar during the session (`barstate-realtime-spy-2026-09-09.json` says so in `_note_still_unmeasured`).

Ruling: history (1) is determined. The newest bar is not determined by anything this engine receives, because the
vendor's value there depends on when it releases the bar, and the realtime-update value was never captured. A column
would be a guess on the newest bar, so the name stays refused on the pane, screen and runtime lanes. The old reason
("every bar would be `isnew`, a restatement of the question") is contradicted by the captures (the vendor does answer 0)
and is replaced in `closedTable.json::_barstate.refused.isnew`. The runtime lane's producer `isNewByBar` stays unread.
To unblock: a capture tying the vendor's release instant to something our calendar can derive, plus a forming-bar reading.

## 2. `input.time`: SERVED at its default

Evidence: `tests/fixtures/vendor/vw-time-tf-spy-1d-2026-09-27.json`, T16
`input.time(timestamp("18 May 2022 00:00 +0000"))` / 86400000 = 19130 on all 8472 bars: the timestamp itself, in ms.

Change (translator lane, `ast/pine.js::resolveInput`): `input.time` (and v4 `type = input.time`) folds to its default in ms.
The default is read by the runtime lane's own reader (`runtime/runtimeInputs.js::timeInputDefaultOf`), so both lanes
accept the same defaults and refuse the rest with the same sentence (for example `timestamp(year, month, ...)`, which reads the
exchange's zone). The translator lane mints no knob for it; a member value arriving there is refused by name
(`pine:input-kind`). The runtime lane already served it and is unchanged. The R16/R20 retirement sentence for `input.time`
became unreachable and was removed; its three rails were updated (tombstones in `inputKindSpeaksItsNumber.test.js`,
`routingSentencesRespectD2.test.js`).

Rails: the pane formula reads `1652832000000 / 86400000` and matches T16 with `Object.is` on every bar of the vendor's own
source; the runtime lane matches the same bars with `Object.is`; the screen lane folds the same constant; a name-bound
default follows its binding on both lanes. Effect: `session-hilo__WM2g5GtC4h` now attaches at `memberPaneDefinition`.
Screen lane: the default is a constant with no viewer or fetch dependence, so the screen serves it too.

## 3. `ta.nvi` / `ta.pvi`: already ruled (Phase 1, 2026-10-30); pinned

Evidence: `tests/fixtures/vendor/vw-nvi-pvi-spy-1d-full-2026-09-27.json` (8472 bars from SPY's first bar): both seed at 1.
Served on the pane as `window_dependent` (badged); a screen refuses by name. The rail checks the pane against the full
capture: max relative difference under 1e-9 (the exp/cum/ln form is not bit-exact). The fetch dependence measured in the
capture queue (a 5,000-bar fetch reads 9.07x / 2.87x low) is what the badge discloses. No change.

## 4. `time(<session>)` on daily bars: already ruled (C8 / Q-T1, built 2026-09-28); pinned

Evidence: `vw-time-session-spy-1d-2026-09-27.json`, `harness/vw-time-session-spy-1d-2026-09-28.json`, the two 60m legs.
Pane serves it (the bar's open time, half-open window); a screen refuses it by name. Existing rails:
`sessionClockDailyBars.test.js`, `pineVocabularyWave.test.js`. No change.

## Object door

⚰️ r0 said "Not changed". That was FALSE at r0 (the review measured C18 `wsd_input_time` refused -> served on rddt and spy). See r1 below for what the door does now.

## Verification (light phase: no mutate.py, measure-pair or final-tip)

- `vitest run src/components/chart/engine/ast src/components/chart/engine/runtime --maxWorkers=1` (Node 20.20.2, under
  `heavy-final5.lock`, 11.4 GB free): 4 failures, all stale assertions of the old behaviour (isnew sentence, input.time
  retirement sentence x3). Updated, and the 6 affected files then passed (61 tests).
- `node --test "services/pine_runtime/test/**/*.mjs"` on Node 24.13.1: 139/139.
- `tools/pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN, 166/166.

## Hand mutations (copy, mutate, run the rail, restore by copy, cmp clean)

| # | mutation | rail result |
|---|---|---|
| M1 | `input.time` folds to default + 1 ms | 3 failed |
| M2 | member-value refusal disabled | 1 failed |
| M3 | name-binding lookup disabled | 1 failed |
| M4 | isnew reason loses its RULING-0927 citation | 1 failed |
| M5 | the `input.time` branch disabled | 5 failed |

## r1 (2026-11-07): fix round after review NO-GO @0c2e5ac264

Review: `_resume-2026-11-01/dsk/reviews/RULING-0927.md`. Branch merged with origin/master `911eb4b215` first.

### B1: `input.time` is narrowed to the one captured form, on every lane

The gate is in the one reader every lane calls, `runtime/runtimeInputs.js::timeInputDefaultOf` (the runtime
run, the runtime settings dialog, and the translator's `pine.js::resolveInput`). The runtime lane was narrowed too,
because it served the same unwitnessed forms.

SERVED (T16 form only): `timestamp("D MMM YYYY hh:mm +0000")` as the default (`WITNESSED_TIME_DEFAULT`
`/^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} \+0000$/`), written directly or through a name binding, with
`confirm` absent or literally `false` (the parameter's own default, so it is the same call).

REFUSED BY NAME (pane and screen `pine:input-kind`; runtime `runtime:statement`; one sentence, citing
"RULING-0927 r1"), each queued in `capture-queue-2026-09-27.md`:
- no zone, ISO date, ISO date-time, `GMT+10`, `GMT-5`, `+0530`, seconds with `+0000`: "not written in the captured
  form" (Q-D1, Q-D2 existing probes; Q-D4 new probe `vw-input-time-forms.pine`);
- `timestamp(timezone, y, m, d, ...)`: Q-D2 / Q-D4;
- a literal millisecond count: Q-D4;
- `confirm = true`: Q-D5, new probe `vw-input-time-confirm.pine`;
- unchanged: `timestamp(y, m, d)` (exchange zone), named zones, no default, out of range.

### B2: the door, measured on this tip

- C18 constructed probes (`parity-programme/audit/zzAuditC18Probe.measure.test.js`, run on this tip and on the same
  tree with the three changed engine files set to origin/master): **0 of 69 rows differ.** `rddt/wsd_input_time`
  and `spy/wsd_input_time` (`timestamp("2024-01-02")`, no zone) are refused again, exactly as on master
  (`pine:no-output`, runtime refused `pine:input-kind`).
- Corpus (`tools/corpus_metric.json`, vs master): one mover, `session-hilo__WM2g5GtC4h` refused -> ok on host and
  screener (both of its defaults are in the captured form). `open-interest-profile` is back on `pine:input-kind`
  (`confirm = true`), as on master.
- Vendor harness, the member door on the `vw-time-tf` probe as captured: it used to refuse on T16 alone; it now
  passes the door and T16 matches on every bar (SPY 1D 900 bars, BTCUSD 1D 5491, the C49 SPY listing capture).
  On BTCUSD's full history, T01-T04 and T07-T09 WITHHOLD (`na`) on bars the vendor answers (na-only, 0 value
  mismatches); that is the pre-existing `time(<tf>)` withholding the C36 derived capture grades, now reachable for
  this probe because it no longer stops at T16. Rails: `vendorHarness.c30/c36/c49` updated to pin exactly this.

### Review notes

- N1/R2: the member-value refusal's guard CODE is railed (`pine:input-kind`).
- N2/R4: T16's `inputsFolded` entry (`startTime`, `Start Date`, `1652832000000`) is railed.
- N3: the routing rail's header records the retired `input.time` sentence.
- N4: the isnew sentence now names its evidence (four tail bars, three released timeline rows), not "every bar".
- N5: the `input.time` branch now runs before `knobReads`, so a v4 `type = input.time` is never recorded as a knob.

### Verification

- ast + runtime folders, `--maxWorkers=1`, Node 20.20.2, under `heavy-final5.lock` (16.4 GB free): 8420 passed,
  5 failed, all `Test timed out in 15000ms` in corpus-sweep `*.measure.test.js` files (guardProbe,
  objectLaneCallSites, objectLaneCensus x2, objectLaneDrawerCensus). The same files time out with the three engine
  files set to origin/master (guardProbe 1/1, objectLaneCensus+DrawerCensus 3/6), so this is the machine, not the change.
- Every test file that mentions `input.time` (29 files incl. vendor harness) + `pine.barstate.test.js`: 645/645.
- Service suite, Node 24.13.1: 139/139. `pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN 166/166.
- ⚠️ `pine-dsk-mpbase3/app/node_modules` -> `pine-base` lost its `.bin` and `@asamuzakjp/css-color` during this
  round; this worktree's junction was repointed to `pine-dsk-hpstop/app/node_modules` (identical package-lock).

### Hand mutations (copy, mutate, run the rails, restore by copy, cmp clean)

| # | mutation | result |
|---|---|---|
| N1 | the form regex also admits no zone | 1 failed |
| N2 | the `confirm` gate removed | 2 failed |
| N3 | the literal-ms gate removed | 2 failed |
| N4 | the tz-argument gate returns served | 5 failed |
| N5 | the form check skips the name-binding walk | 3 failed |
| N6 | member-value refusal thrown as `pine:builtin` (review R2) | 1 failed |
| N7 | the `inputsFolded` record dropped (review R4) | 1 failed |

A measure-pair is still required (the reviewer's item 8): the translator lane changes member output for
`session-hilo` and the vw-time-tf probe. Engine bump at merge, by the coordinator.

## r2 (2026-11-07): fix round after review NO-GO @3700363b99 (B1, B2 closed)

### B3: positional `confirm = true` on the v4 legacy form

`timeInputDefaultOf` read `confirm` positionally only for `input.time`. v4's signature is
`input(defval, title, type, minval, maxval, confirm, ...)`, so `confirm` is index 5 there too and
`input(timestamp("18 May 2022 00:00 +0000"), "S", input.time, 0, 0, true)` was served. It now reads
`argOf(node, 'confirm', 5)` for every time input (it was already failing closed on any value but a literal `false`).

Rails (`ruling0927.test.js`, r2 block): `confirm = true` refuses by name on pane, screen and runtime in four spellings
(v4 positional, v4 keyword `type = input.time`, v5 positional `input.time(…, "", "", "", true)`, v5 keyword), and
each `confirm = false` twin serves 19130 on pane and runtime. Nothing in the committed corpus uses the v4 form.

Mutation (copy, mutate, run, restore by copy, cmp clean): positional index dropped for the legacy form ->
"v4 positional: confirm = true refuses by name on every lane" goes red (1 failed of 34).

### Runtime-lane movers (the review's corpus note)

With the runtime pane ON, `machine-learning-knn-based-strategy` (defaults `timestamp("… GMT+10")`) goes from served on
the runtime lane to refused; it is the only committed-corpus script that stops drawing. Nobody had shown its old
drawing matched TradingView (the GMT+10 sign is unproven, Q-D2). Settings specs also dropped, on scripts already refused
for other reasons: candlestick-patterns-on-backtest `sTim`, heikin-ashi-supertrend `dateTimeClosed` (no zone),
volume-profile-plus `ANCHORED_TIME`, open-interest-profile `startTime`/`endTime` (`confirm = true`, defval 0).

### The kNN reason a member reads (review N6): documented, not changed

When the runtime fallback declines, the member door shows the HOST lane's refusal (`pine:collection` for kNN) and
carries the runtime lane's `input.time` sentence beside it as `runtimeDeclined`. That is the RT1 integrator decision
recorded at `memberPaneDefinition.js::runtimeLaneDefinition` ("the HOST lane's refusal, verbatim … the runtime reason
is carried beside it … never instead of it"). Reversing it changes the sentence for every fallback-declined script,
so it is not a cheap local fix; it is left as the review's later task.

### Verification

Every test file that mentions `input.time` (29 files) + `pine.barstate.test.js`: 653/653 (Node 20.20.2). Service suite
(Node 24.13.1) 139/139. `pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN 166/166.
