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
31 of 31 killed (`muts.json`). M31 (the margin check's commission ask dropped) survives the four T5 files alone
and dies in `w9BrokerIntegration.test.js`'s N7 rail, so that file is in the run.
