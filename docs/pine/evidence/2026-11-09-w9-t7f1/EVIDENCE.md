# W9-T7-F1 order log and trade exit ids: evidence (2026-11-09)

Base: `origin/feat/pine-w9-t8-risk` `38d617316c` (T4 / T6 / T7 / T13a / T5 / T8) with
`origin/feat/pine-engine40-integration` `cac7a4370d` (T12 / T13b) merged in (`9c583a9032`; one conflict, the T14
fixture, regenerated here). Builder lane, dark. No `SCRIPT_ENGINE_VERSION` edit, no flag, no Railway, no ledger change
(`brokerPins.resolved.json` still `{"rules":{}}`), no new rule. What was built and why:
`docs/pine/strategy-broker-spec.md`, section "W9-T7-F1".

## What is served now

- `record.orders`: the broker's order log (schema in the spec section), and `record.trades[].exitId` (`exitIdOf`). Both
  left `STRATEGY_RECORD_UNSERVED`. Additive: every other field is unchanged; the one shape check
  (`strategyRecordShapeErrors`) now checks the rows and their links (each trade opened by exactly one filled order,
  each closed trade closed by exactly one, `exitId` = `exitIdOf(closing order)`).
- Six TEXT values off the log: `strategy.opentrades.entry_id` / `entry_comment`, `strategy.closedtrades.entry_id` /
  `entry_comment` / `exit_id` / `exit_comment` (B-VAL, like every per-trade read). Refused by name (W9-V1) where the
  texts do not state the value.
- T12 markers find each fill through the log's own link (`opened` / `closed`), label it with `orderLabelOf` (comment,
  else id), and refuse whole by name (`runtime:strategy-markers-unlabelled`) where the label is not known. **The member
  door still refuses first by MK-LOOK** (W9-MK1 unpinned): rail `w9T12TradeMarkers` "W9-T7-F1: the record T11 builds NOW
  serves ... and the member door STILL refuses, by the look", and the door test through the real binder.
- T13a/T13b: the trade list gains `entrySignal` / `exitSignal` (the same `orderLabelOf`) and the panel two columns.

## Default path

Census: the committed T5 harness (`../2026-11-08-w9-t5/census.harness.js.txt`) rerun unchanged as a temporary copy
(deleted after), over the same 758 committed `.pine` files (corpus/committed 266, visual_conformance probes 284,
host-parity corpus 41, pine_blind 48, pine_community 30, pine_oos 30, pine_screener 38, pine 21), four lanes (gate off;
gate on, committed ledger; all pins; S1's 22 pins). Base by swapping in the five base engine files the lanes load
(`git show 9c583a9032:<path>` for `broker.js`, `strategyRecord.js`, `ir.js`, `ast/strategyBroker.js`,
`ast/pineRuntimeFrontend.js`) and restoring this lane's copies (`cmp` clean).

**The two outputs are byte-identical (`cmp`), every lane, every row: 659 non-strategy and 99 strategy scripts, 0 value
diffs, 0 refusal diffs, 0 rulesUsed diffs, and 0 program-digest diffs.** No script moved, so nothing new is served on
this corpus. Why the corpus cannot show the new paths, so the rails do: the 12 strategies that pass a `comment` (9
committed, 3 probes) all refuse before a run, at walls F1 does not touch (a library import, conditional history, a
lookback budget, `request.security` in a strategy, T10's `strategy.closedtrades.entry_time()`, ...); every probe that
reads an id or a comment (`s1-broker-core*`, `w9-*`) refuses first at another wall, mostly T10's `entry_time()` (also
`margin_liquidation_price`, `currency`, `varip`, an undeclared builtin). The 14 strategies that run in the all-pins lane
pass no comment and read no id. The licence-held local cache was not in this census.

## Suites

- Node 20.20.2, `--maxWorkers=1`: w9T7F1OrderLog (new; 32 in this run, 33 with the later text rail, rerun green with 6 neighbours, 207/207), w9T11Record, w9T11StrategyStamp, w9T12TradeMarkers,
  w9T12MarkersDoor, w9T13aBrokerReport, w9T13aReportParity, strategyReportPanel, w9T13bReportWire, w9T14ServerRecord,
  w9T1Broker, s1StrategyBroker, w9T4Sizing, w9T5Costs, w9T6FillTiming, w9T7Exits, w9T8Risk, w9BrokerIntegration,
  brokerPinsLock, serverBundle.rail, runtimeStrategy, strategyBrokerGate.product, w9OrderOnlyIf,
  w9StrategyReadInPresentation, hostNeutralClosure.rail, objectDoorGate, runtimeHardeningP1, strategiesAreRuled,
  productScorecard, alertMessageRides, argRoles, enumerationSites, runtimeAllowlistParity, doorNameCoverage, reachable,
  attachedPineDisclosures.noGuardIds: 36 files, 1135/1135.
- Node 24.13.1: `tools/pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166 (indicator columns
  byte-identical); `node --test "services/pine_runtime/test/**/*.mjs"` 139/139.
- pytest `tests/test_pine_strategy_backtest.py` + `tests/test_broker_pins_resolve.py`: 85 passed. The T14 sealed fixture
  was regenerated (`W9T14_WRITE_FIXTURE=1`): the record gains `orders` and the trades' `exitId` (null: the fixture's
  exit is a `strategy.close`), and loses the two `unserved` entries, so `strategy_sha256` moved; the column `digest` did not.
- Hand-made broker summaries in the T12 / T13a / T13b / service rails now state their order log through one test
  fixture (`runtime/__tests__/orderLogFixture.js`), held to the schema by the one shape check.

## Mutants

`mutate_t7f1.py` (copy, one textual change, the focused F1 rails, restore by copy, `filecmp`; never `git checkout`).

31 of 31 killed (`muts.json`). One candidate was dropped with the code it tested: a front-end typing line that made a
text read TEXT to `exprTypeIn` changed nothing measurable (equality, `+`, `str.length`, a `var string`, all served
identically without it), so it was removed rather than kept unprovable. Unrailed and stated: the `nothing-to-close`
end of a market close (a close that meets no open trade of its id when it fills) is kept so a filled row always closed
something, but no reachable run is known to take it (no other order fills between a close's placement and its tick).

## r1 (review GO-WITH-NOTES @c130ebabc2, `dsk/reviews/W9-T7-F1.md`)

- **N1 (one fact, two answers).** On a reversal (`strategy.entry("S", ..., comment = "flip")` against an open long),
  `strategy.closedtrades.exit_comment(0)` refused while the report's exit signal and the markers served "flip". Ruling:
  refuse consistently. ONE rule now, `strategyRecord.js::exitLabelUnstated` (an EXIT label taken from an ENTRY row, row
  `EXIT_LABEL_ROW` = W9-V1): `orderLabelOf` returns null for it, so the report's `exitSignal` refuses
  (`runtime:strategy-report-unstated`, W9-V1, a plain sentence the panel shows in that cell) and the markers refuse whole
  (`runtime:strategy-markers-unlabelled`, the fill named "a reversing entry"); `broker.js` `exit_comment` asks the same
  function. The reversing entry's own ENTRY signal ("flip") is stated and stays served. Rails: `w9T7F1OrderLog` "r1 ... on
  EVERY surface" (a real run: the value, the report, the markers) with a control (an exit command's comment served on all
  three), and `strategyReportPanel` "r1" (the cell's text, no comment, no id, no guard).
- Mutants: M17 was replaced by M34 (its anchor is the shared rule now); M32-M35 added (the rule never fires; the label
  rule, `exit_comment` and the report each ignoring it). M32-M35 4 of 4 killed (`muts.json`, round r1, beside r0's 31 of 31 at `c130ebabc2`). The full 34-mutant rerun was
stopped by the session's low-memory guard after M2 (files restored from the runner's copy, `cmp` clean), so only the r1
mutants were rerun; r0's mutants touch code r1 did not change, except M17, whose code r1 replaced (M34 covers it).
Suites at r1 (Node 20): w9T7F1OrderLog, w9T12TradeMarkers, w9T12MarkersDoor, w9T13aBrokerReport, w9T13aReportParity,
strategyReportPanel, w9T13bReportWire, w9T11Record, w9T14ServerRecord, serverBundle.rail: 10 files, 206/206.
