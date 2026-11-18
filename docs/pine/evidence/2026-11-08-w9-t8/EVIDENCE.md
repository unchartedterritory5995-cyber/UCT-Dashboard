# W9-T8 strategy.risk.*: evidence (2026-11-08)

Base `6b75450c5e` (origin/feat/pine-w9-t5-costs: T5 on the broker integration; lands as engine 41). Builder lane,
dark. No `SCRIPT_ENGINE_VERSION` edit, no flag, no Railway, no ledger change (`brokerPins.resolved.json` still
`{"rules":{}}`). What was built and why: `docs/pine/strategy-broker-spec.md`, section "W9-T8".

## Sources

- R6: `_w0-2026-11-02/ref/pine_v6_reference.json`, the six `strategy.risk.*` entries (desc, args, examples).
- M: the User Manual "Strategies" page, section "Risk management"
  (https://www.tradingview.com/pine-script-docs/concepts/strategies/#risk-management), fetched 2026-11-08 with a
  browser user agent, HTTP 200, 85,590 bytes; the section text taken from the HTML between `id="risk-management"` and
  `id="margin-and-leverage"`, tags stripped. Typographic quotes are written as ASCII in the spec.
- Every quoted phrase of the spec section was checked by script against the two sources (16 quotes; the one not in
  either is the design's own "the intraday risk functions", W9 design 5.2 row W9-R1i).

## Rules (3 new, one per probe that calls its command)

B-RISK-ALLOW (W9-R1, `w9-r1-risk-allow.pine`), B-RISK-DDOWN (W9-R1, `w9-r1-risk-ddown.pine`), B-RISK-INTRADAY-ORDERS
(W9-R1i, `w9-r1-risk-intraday.pine`). `BROKER_RULE_IDS` 41 -> 44, pinned once in `strategiesAreRuled.test.js`; the D7
scorecard derives "0 of 44". `max_intraday_loss`, `max_cons_loss_days` and `max_position_size` are refused at build by
name: no queued probe calls them (W9-R1i's probe calls only `max_intraday_filled_orders`), so they are not rules.

No halt is served: a limit that may be reached (drawdown, filled orders per day) stops the run
`runtime:strategy-unsettled` by name. B-RISK-DDOWN and B-RISK-INTRADAY-ORDERS serve only the run below the limit, which
is the run without the call.

## Default path

Census: the committed T5 harness (`docs/pine/evidence/2026-11-08-w9-t5/census.harness.js.txt`) rerun unchanged, as a
temporary copy (deleted after), over the same 758 committed `.pine` files (corpus/committed 266, visual_conformance
probes 284, host-parity corpus 41, pine_blind 48, pine_community 30, pine_oos 30, pine_screener 38, pine 21), four lanes
(gate off; gate on, committed ledger; all pins; S1's 22 pins). Base by swapping in the five base engine files
(`git show 6b75450c5e:<path>`) and restoring the lane's copies (`cmp` clean).

| lane | non-strategy (659) | strategy (99) |
|---|---:|---:|
| gate off | 0 diffs | 0 diffs |
| committed ledger (`on`) | 0 diffs | 3 diffs |
| all pins | 0 diffs | 3 diffs |
| S1's 22 pins | 0 diffs | 3 diffs |

The 3 are the W9-R1 / W9-R1i probes (`w9-r1-risk-allow`, `-ddown`, `-intraday`), refused in every lane both sides: at base
at build (`runtime:strategy-option`, the risk call); now the risk call is read and they refuse at the standard set's
`strategy.closedtrades.entry_time()` (`runtime:strategy-value`, T10's). Nothing new is served. 96 strategy scripts are
identical in every lane (outputs, trades, rulesUsed, refusals). The licence-held local cache was not in this census.

The strategy record is unchanged (no new field): the T14 sealed fixture did not move.

## Suites

- Node 20.20.2, `--maxWorkers=1`: w9T8Risk (43), w9T5Costs, w9T1, s1, T4, T6, T7, T11, T13a, T13aReportParity, T14,
  w9BrokerIntegration, brokerPinsLock, runtimeStrategy, w9OrderOnlyIf, w9StrategyReadInPresentation,
  strategyBrokerGate.product, strategiesAreRuled, productScorecard: 19 files, 532/532. objectDoorGate,
  runtimeAllowlistParity, hostNeutralClosure, serverBundle, runtimeHardeningP1, doorNameCoverage, reachable: 7 files,
  343/343.
- Node 24.13.1: `tools/pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166 (indicator columns
  byte-identical); `node --test services/pine_runtime/test/**/*.mjs` 139/139.
- pytest `tests/test_pine_strategy_backtest.py`, `tests/test_broker_pins_resolve.py`,
  `tests/test_pine_coverage_w9_t0_strategies.py`: 108 passed.

## Mutants

`mutate_t8.py` (copy aside, one textual change, the focused rails with vitest's JSON reporter, restore by copy,
`filecmp`; never `git checkout`). Results with each kill's failing tests: `muts.json`.

33 of 33 killed. The first full run left two survivors, both build-reader gaps: M31 (any `type` name read as cash:
the rail sent only a missing `type`, which an earlier guard refuses) and M32 (a non-literal `alert_message` read
past). Rails were added (`max_drawdown(5, strategy.fixed)`; `alert_message = str.tostring(close)`) and the two were
rerun on that tree: both killed.

Three guards were REMOVED during the run because no fixture can tell them apart from their absence (unprovable, so
not kept): a fill count in `closePart` (a partial size is a T7 kind, refused beside a risk command); a "position open in
the forbidden direction" refusal (nothing can open one beside a risk command); and the drawdown samples at the open and
before each fill (equity is continuous across a fill when no cost is served, and the open lies between the bar's
extremes). A sample at a fill level on the path is kept: a reversal there is an extreme no vertex holds (rail: "a
REVERSAL at a level on the path", M14).

| mutant | first failing test |
|---|---|
| M1 a forbidden entry proceeds (reverses) | allow: a forbidden market entry against the position CLOSES it |
| M2 B-RISK-ALLOW never asked | allow: a forbidden market entry against the position CLOSES it (rulesUsed) |
| M3 direction.all forbids the other side | allow: an ALLOWED entry, and strategy.direction.all, change nothing |
| M4 a forbidden price entry served | allow: a forbidden PRICE entry refuses by name |
| M5 the risk close not labelled | allow: a forbidden market entry ... CLOSES it (exit rule) |
| M6 a flat forbidden entry walks the close path | allow_entry_in(short): ... (asks no B-FIFO) |
| M7 the forbidden entry stays queued | allow: a forbidden entry with no position open fills nothing |
| M8 risk beside a cost served | allow ... under a commission, a slippage ...; intraday under a commission |
| M9 risk under POC served | allow ... process_orders_on_close; max_drawdown under process_orders_on_close |
| M10 a T7 kind beside a risk command served | strategy.order beside a risk command refuses by name |
| M11 one row for every risk refusal | intraday: under a commission it refuses with its own row (W9-R1i) |
| M12 drawdown limit strict | a cash limit of exactly 2 MAY be reached |
| M13 percent of the peak | percent: taken of the initial capital |
| M14 no sample at a fill level | a REVERSAL at a level on the path |
| M15 no sample at the vertices | a cash limit of exactly 2 MAY be reached |
| M16 the peak never moves | a cash limit of exactly 2 MAY be reached |
| M17 B-RISK-DDOWN never asked | a cash limit of 2.5 ... asks B-RISK-DDOWN; pin-before-serve B-RISK-DDOWN |
| M18 max_drawdown under POC served | max_drawdown under process_orders_on_close |
| M19 an unknown trading day counted | the run must be told each bar's trading day |
| M20 the day limit strict | a day that REACHES the limit refuses by name |
| M21 an opened trade not counted | a day that REACHES the limit refuses by name |
| M22 a closed trade not counted | a day that REACHES the limit refuses by name |
| M23 B-RISK-INTRADAY-ORDERS never asked | below the limit on every day; pin-before-serve |
| M24 intraday beside a cost served | intraday: under a commission it refuses by name |
| M25 one count for every day | below the limit on every day |
| M26 a risk call inside a block read | a risk command inside a block refuses at build |
| M27 any Pine version read | a version other than 6 ... refuse at build |
| M28 a second call wins | (same test) |
| M29 a percent above 100 read | (same test) |
| M30 the unwitnessed commands fall through | the three commands no probe calls refuse at build |
| M31 any type name read as cash | a version other than 6 ... (strategy.fixed) |
| M32 a non-literal alert_message read past | a version other than 6 ... (str.tostring) |
| M33 B-RISK-DDOWN pinned by W9-R1i | each T8 rule is named, with the capture row the design gives it |

The full failing-test lists are in `muts.json`.
