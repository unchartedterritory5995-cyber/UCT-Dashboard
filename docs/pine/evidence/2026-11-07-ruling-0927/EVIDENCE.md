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

Not changed.

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
