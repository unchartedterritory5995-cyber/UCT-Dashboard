# C1: the `input.time` defaults the reference alone settles (engine 84)

This change implements the coordinator's ruling of 2026-11-19 on the time-related queue (C1 (2)). Build the
reference-only `input.time` defaults now, in one PR:

- a literal ms default;
- `timestamp("UTC", y, m, d, h, mm)`;
- `timestamp(y, m, d, h, mm)` on New York symbols, under the same clock rule as the rest of the lane.

The other spellings wait for Q-D2 / CR-S1, which are queued. C1 (1), widening the clock zone, is held; its probe,
Q-CLK-1, rides in this PR.

## The reference

The Pine v6 reference states every fact this change reads:

- `input.time`: "defval (const int)".
- `timestamp`: "Returns: UNIX time". For its numeric form, `timezone`: "The default is syminfo.timezone".

## What changed (`runtime/runtimeInputs.js::timeInputDefaultOf`)

This is the one reader shared by the run, the settings dialog and the translator. RULING-0927 r1 served one
spelling there, the captured `timestamp("D MMM YYYY hh:mm +0000")`, and held every other spelling for a capture.
Three more spellings are now served, because nothing is read in them that the reference does not state exactly:

- **A literal count of milliseconds.** It IS the UNIX time the input returns. Served on every lane, inside the
  ±8.64e15 range as before.
- **`timestamp("UTC" | "GMT", year, month, day, hour, minute[, second])`.** The zone named is UTC itself: there is no
  offset, so there is no sign to read (the sign of `GMT+N` belongs to CR-S1). Served on every lane.
- **`timestamp(year, month, day, hour, minute[, second])`.** It reads the exchange's zone, so it is read only where the
  run is told a New York symbol: NYSE, NASDAQ or NYSE Arca, the rule `pineRuntimeFrontend.js::requireNewYorkExchange`
  states for every exchange-zone read on this lane. The run passes that zone to the reader as `opts.exchangeZone`.
  - The value is New York wall time through the lane's own New York clock (`clockFns.instantField`).
  - It is never read in the hour New York's clock skips or repeats: exactly one instant must read the wall time back.
  - The settings dialog and the translator have no symbol, so for them this form stays skipped by name. The run is
    the one reader that knows the chart.

Everything else is refused by name, as before:

- an offset zone (`"GMT+3"`, `"+0300"`; CR-S1);
- the no-zone, ISO and month-first date strings (Q-D2, CR-S1);
- the named-argument spelling of `timestamp(timezone = …)`;
- a non-New-York symbol, or no symbol, for the exchange form.

## Rails and mutants

`runtime/__tests__/inputTimeReferenceDefaults.test.js`:

- **Served:**
  - A literal ms is the captured form's instant, and the run reads it as such.
  - `"UTC"` and `"GMT"` give the captured form's instant.
  - `timestamp(2024, 1, 2, 9, 30)` on SPY is New York wall time (EST, UTC-5), equal to the same `timestamp(…)` written
    as an expression on that chart; in summer it is UTC-4.
  - The input splits the run (non-vacuous).
- **Refused by name:**
  - the exchange form on BITSTAMP:BTCUSD, and with no symbol;
  - the spring-forward and fall-back hours;
  - an offset zone, an offset date string, an ISO datetime.
- **The shared reader with no symbol** serves the literal and UTC forms, and skips the exchange form unless handed
  the New York zone.

Re-pinned, each with a tombstone: `ast/ruling0927.test.js` (the literal and UTC rows move from refused to served, at
the captured form's instant) and `runtime/__tests__/runtimeInputKinds.test.js`.

Mutants Q1-Q6 are in `ci/mutants/c1-input-time-defaults.json`. Each was made on a saved copy, watched turn its rail
red, and then restored from that copy and confirmed byte-equal.

## The probe for C1 (1): Q-CLK-1

`tools/visual_conformance/probes/vw-clk1-exchange-zone.pine` has rows in `docs/pine/capture-queue-2026-11-19-clock-zone.md`
for BITSTAMP:BTCUSD 1D and FX:EURUSD 1D from the listing. It reads:

- `timestamp(2024, 1, 1, 0, 0)` with the zone implicit, against its UTC twin;
- `hour` and `dayofweek` in the exchange's zone, against UTC;
- `syminfo.timezone` as a label's text.

The queue derives both rows: QUEUED, from the listing, with the committed sha.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured with master (engine 81) and this branch over the same tree, the runtime lane's own reader and front end on
each side: **0 scripts move.** No sample script stops on one of these three spellings. The coordinator's reason for
them is the scripts the member assistant writes (the Studio session's paste-path probes), and the PR's pine-heavy run
is the corpus diff on both lanes.
