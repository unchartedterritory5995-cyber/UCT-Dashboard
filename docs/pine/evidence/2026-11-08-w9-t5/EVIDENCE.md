# W9-T5 costs: evidence (2026-11-08)

Base `30e85eb877` (origin/feat/pine-w9-broker-integration: T4 + T6 + T7 + T13a). Builder lane, dark. No
`SCRIPT_ENGINE_VERSION` edit, no flag, no Railway, no ledger change (`brokerPins.resolved.json` still `{"rules":{}}`).
What was built and why: `docs/pine/strategy-broker-spec.md`, section "W9-T5: costs".

## Rules (5 new, one per capture row the design names for T5)

B-COMM-PCT (W9-K1), B-COMM-CONTRACT (W9-K2), B-COMM-ORDER (W9-K3), B-SLIPPAGE (W9-K4), B-POC-COST (W9-P1, design
T6's "costs are taken at the close"). `BROKER_RULE_IDS` 36 -> 41, pinned once in `strategiesAreRuled.test.js`; the
D7 scorecard derives "0 of 41".

## Default path

Census (`census.harness.js.txt`, a copy of W9-T6's with an S1-pins lane and a cost-normalised record digest:
the new `commission` field of each trade and the declaration's `commission` / `slippage` are stripped, and a
separate column counts non-zero fees). 758 committed `.pine` files (corpus/committed, the visual_conformance
probes, the host-parity corpus, pine_blind / community / oos / screener / pine), four lanes each (gate off;
gate on, committed ledger; all pins; S1's 22 pins). Base files swapped in by copy and restored by copy (`cmp`).

- 659 non-strategy scripts: 0 differences in every lane.
- 99 strategy scripts: 94 identical in every lane (outputs, trades, rulesUsed, refusals, 0 fees charged).
  The 5 that differ are the cost probes `w9-k1..k4` and `w9-p1-on-close`: at base they refused at build
  (`commission_value` / `slippage` other than 0); now they read the cost and refuse at the next unserved
  value (`strategy.closedtrades.entry_time()`, T10's). Nothing new is served.

The licence-held local cache (builtin / reference) was not in this census.

## Suites

- Node 20.20.2, `--maxWorkers=1`: w9T5Costs (42), w9T1, s1, T4, T6, T7, T11, T13a, T13aReportParity, T14,
  w9BrokerIntegration, brokerPinsLock, runtimeStrategy, w9OrderOnlyIf, w9StrategyReadInPresentation,
  strategyBrokerGate.product, strategiesAreRuled, productScorecard: 18 files, 477/477. objectDoorGate,
  runtimeAllowlistParity, hostNeutralClosure, serverBundle, runtimeHardeningP1, doorNameCoverage, reachable:
  7 files, 343/343.
- Node 24.13.1: `tools/pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166 (indicator columns
  byte-identical); `node --test services/pine_runtime/test/**/*.mjs` 139/139.
- pytest `tests/test_pine_strategy_backtest.py` + `tests/test_broker_pins_resolve.py`: 85 passed. The T14 sealed
  fixture was regenerated (`W9T14_WRITE_FIXTURE=1`): the record gains `settings.commission` / `settings.slippage`
  and each trade's `commission`, so `strategy_sha256` moved; the column `digest` did not.

## Mutants

`mutate_t5.py` (copy, one textual change, focused rails, restore by copy, `filecmp`; never `git checkout`).
r0: 31 of 31 killed. M31 (the margin check's commission ask dropped) survives the four T5 files alone
and dies in `w9BrokerIntegration.test.js`'s N7 rail, so that file is in the run.

## r1 (review NO-GO @361d4bac65, `dsk/reviews/W9-T5.md`)

- **B1.** A LIMIT fill (a limit entry, a take-profit) under `slippage > 0` now refuses
  `runtime:strategy-unsettled` by name, row W9-K4, quoting both texts: R6 slips "market/stop orders", the
  User Manual "the strategy applies constant slippage to _all_ order fills". They disagree, so by the spec's
  own rule it is unsettled. The rail that asserted B-SLIPPAGE was not asked is flipped. A new rail runs the
  reviewer's probe (slippage 3, a limit entry at 99.8, a take-profit at 101.2) under S1's 22 pins only: it
  refuses, and the same script with slippage 0 is served under those pins.
- **U2.** A percent-fee fixture at pointvalue 50 (entry fee 10, exit fee 10.35, net 329.65).
- **U5a.** The off-grid slipping branch is gone. A market fill off the tick grid under a slippage refuses by
  name (W9-K4), with its own rail.
- **Citations.** Both User Manual quotes are given in full (the reviewer confirmed them on the live page), and
  the "not yet confirmed" markers are dropped. The B-SLIPPAGE row quotes the full R6 text and the manual's
  full sentence.
- **B-CANCEL** now names capture row W9-X5. That row is queued on origin/fix/pine-capture-queue-hygiene
  d1a6cb9fb3, which this branch does not carry, so the dependency is noted in `brokerRules.js` and the spec.
- **Mutants:** 35 of 35 killed. M32 to M35 are new: the limit refusal, the take-profit refusal, the off-grid
  refusal, and the percent fee without pointvalue.

## r2 (review GO-WITH-NOTES @afbe38d73a)

- **The grid test under slippage.** r1 assumed 1 / mintick was a whole number, so it wrongly refused on-grid
  fills for tick 5 (at 4200) and tick 0.3 (at 99.9). The test is now k = round(price / mintick) with
  |price - k * mintick| <= 1e-9 * max(1, |price|). The fill steps k by the slippage and is written at the
  tick's own decimals.
- **Rails** (`makeBroker`, behind the test pin), long and short, for ticks 5, 10, 0.3, 0.25, 1/64, 0.00001 and
  0.1. Tick 0.1 is there because 7 x 0.1 is not exactly 0.7 in floating point, so it checks the decimals step.
  On-grid fills are served; price + tick / 3 refuses (W9-K4).
- **Mutants:** 37 of 37 killed. M36 restores the r1 test; M37 drops the write at the tick's decimals.
- Node 20: 20 focused files, 510/510. Node 24.13.1: HP-1 GREEN 166/166; service suite 139/139.

## r3 (review GO-WITH-NOTES @fc2aa0fcaa)

- **New rail:** a satoshi tick of 1e-8 (`String(1e-8)` is "1e-8", so the decimals come from the exponent).
  At slippage 2, price 0.00012345 fills a long at 0.00012347 and a short at 0.00012343; price + tick / 3
  refuses (W9-K4).
- **New mutant:** M38, a `tickDecimals` that ignores the exponent. It dies on the new rail. M36 and M37 were
  re-run on this tree and are still killed. 38 of 38 killed.
- Node 20: w9T5Costs 54/54.
