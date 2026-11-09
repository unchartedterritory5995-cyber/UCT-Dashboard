# W9 decisions, 2026-11-07

The owner delegated the W9 section-8 decisions (`docs/pine/W9-STRATEGY-DESIGN.md` on
`origin/docs/pine-w9-strategy-design`) to the desktop coordinator. The coordinator ruled them as
recorded below. D4 is not ruled here. Arming (D6) stays the owner's act: nothing is armed by this
record or by the branch that carries it.

Base: `origin/master` `33a8a2ab43`.

## Rulings

| # | ruling | reasoning (one line) | unblocks |
|---|---|---|---|
| D1 | Pin before serve applies to the 22 rules S1 settled from text. | Text is a reading of TradingView's manual, not a measurement of its tester, so it earns no exemption from design rule 2. | T1 and T4-T8 build on one rule: every broker rule refuses `runtime:strategy-unpinned` until a MATCHing capture pins it. |
| D2 | Always show "this backtest starts on <date>; TradingView may start elsewhere" when the window does not reach the listing. | A member comparing our trade list with TradingView's must be told the two may start on different bars, every time, not only when it looks likely. | T14's answer shape (already built, see "D2 and D8 status") and T13b's stamp. |
| D3 | Defer T9 (bar detalization). | It needs W7.3 data that does not exist yet, and 0 of 70 scripts set the bar magnifier. | Takes T9 off the W9 critical path; the rest of the plan runs without it. |
| D4 | NOT DECIDED. The rig account's plan is the owner's. | The coordinator does not hold the account. | Nothing yet. W9-R1i (15-minute depth) and any capture that depends on the plan stay open. |
| D5 | The W9.4 route uses the same plan gate as the W5 server lane, and is single-symbol only for now. Multi-symbol is deferred. | One gate keeps the paid boundary in one place; one symbol bounds the cost at `HISTORY_WINDOW_BARS` bars per call until the broker's cost on the service is measured (section 9 item 8). | T14's gate is settled. The single-symbol limit is a follow-up on T14's route (see "Follow-ups"). |
| D6 | Arming goes per W2 stage, not all at once. The act of arming remains the owner's. | A per-stage step lets each stage's evidence be read before the next is opened. | The arming plan's shape; no arming happens here. |
| D7 | The scorecard wording is written by the builder (W9-T15, this branch). The screener ruling stays. | The scorecard must say what is measured, not what is hoped for. | T15 (done here: wording below). |
| D8 | Metrics we cannot compute show the refusal. | A missing number with its reason is honest; a guessed number is a silent wrong value (design rule 1). | T13a and T13b (not built yet; see "D2 and D8 status"). |
| D9 | `HISTORY_WINDOW_BARS` stays 5000. | One constant for every server lane (R10); no capture has shown 5000 is too short for a served case. | Nothing to change; T14a's one-authority rail stands. |
| D10 | The grading floor stays 5 closed trades in TradingView's capture, as reference only. | The floor is a property of TradingView's capture, never of our broker's counts (section 9 item 11). | Routing of the RDDT captures (5.2 E) once they land. |

## D7: the scorecard wording (W9-T15)

The product scorecard (`app/src/components/chart/engine/ast/productScorecard.test.js`) keeps its
`strategies` row unchanged: "RULED OUT, a strategy is not a screen", held by
`strategiesAreRuled.test.js`. It gains one row for the single-symbol strategy backtest. At
`33a8a2ab43` it prints:

> 0 of 22 broker rules are pinned, each verified against a TradingView capture. A backtest that
> reaches an unpinned rule stops and refuses by name (runtime:strategy-unpinned). Strategy
> backtests are not served to members yet.

- The counts are derived, never typed: the 22 rules are `BROKER_RULES`
  (`runtime/brokerRules.js`), and the pinned set is the committed ledger
  `runtime/brokerPins.resolved.json`, the one `pinned(ruleId)` reads at run time.
- The guard name is the broker's own `UNPINNED_GUARD`.
- The last sentence is dropped only when a caller passes `served: true`. The scorecard passes
  false, because nothing is armed (D6).
- Source: `app/src/components/chart/engine/ast/strategyScorecard.js`. Rails:
  `strategiesAreRuled.test.js`, describe "D7: the strategy-backtest scorecard wording".

## The "pinned by" column (T15)

The spec is not on master, so the column is recorded here. Section 1's "pinned by" column names
the capture rows that pin each wall; the table below is the broker-rule view of the same thing, one
row per rule the broker can exercise. "State" is the committed ledger at `33a8a2ab43`, where
`brokerPins.json` and `brokerPins.resolved.json` both hold no rules.

| rule | what | pinned by | state |
|---|---|---|---|
| B-EXEC | a strategy executes once per closed bar; the forming bar is not executed | Q-S1p | unpinned |
| B-FILL | orders placed on bar t fill from the next bar, before the script runs on it | Q-S1-core | unpinned |
| B-MARKET | a market order fills at the next bar open | Q-S1-core | unpinned |
| B-PATH | the intrabar path open -> near extreme -> far extreme -> close | Q-S1-core | unpinned |
| B-GAP | a level crossed between bars fills at the next open | Q-S1-core | unpinned |
| B-IMMEDIATE | a price order placed beyond the market fills on the next tick | Q-S1e | unpinned |
| B-PYR | pyramiding limits same-direction entries | Q-S1-core | unpinned |
| B-REVERSE | an entry against the position closes it and opens the new size on one fill | Q-S1-core | unpinned |
| B-MODIFY | an unfilled order with the same id is modified | Q-S1-core | unpinned |
| B-CANCEL | strategy.cancel / cancel_all remove unfilled orders | none queued | unpinned |
| B-CLOSE | strategy.close / close_all | Q-S1-core | unpinned |
| B-EXIT-BIND | strategy.exit binds a bracket to the trades of from_entry | Q-S1-core | unpinned |
| B-EXIT-LIFE | how long an exit lives | Q-S1-core | unpinned |
| B-EXIT-NA | an exit with every level na places nothing | Q-S1-core | unpinned |
| B-FIFO | exits close the oldest trades first | Q-S1-core | unpinned |
| B-MARGIN | the margin check (a margin call is never modelled) | Q-S1i | unpinned |
| B-SIG | positional order arguments follow the Pine version's signature | Q-S1-core | unpinned |
| B-WHEN | the `when` argument (v4, and v5) | Q-S1p | unpinned |
| B-DIR | strategy.long / strategy.short (v4 `long`) as directions | Q-S1-core | unpinned |
| B-QTY | qty = na takes the declared default size | Q-S1a | unpinned |
| B-DEFAULTS | the per-version declaration defaults | Q-S1b | unpinned |
| B-VAL | the strategy.* values and per-trade reads | Q-S1-core | unpinned |

When a pin lands, the scorecard row's count moves with the ledger; this table is a dated copy and
is not the authority (`brokerRules.js` and the ledger are).

## D2 and D8 status

- **D2: implemented, with a rail.** `api/routers/pine_strategy_backtest.py` `_window_of` states
  the window on every answer with `note = "this backtest starts on <date>; TradingView may start
  elsewhere"`, and `fromListing` is always false on the server, so the sentence is always shown.
  Rail: `tests/test_pine_strategy_backtest.py` asserts the exact sentence.
  **Amended 2026-11-08 (W9-T13a r1, coordinator ruling on one authority):** the start date has ONE
  authority, `strategyRecord.js::startSentenceOf(window.startTime)`. No record carries the symbol's
  exchange timezone, so the date is the UTC date of the run's start and the sentence says so:
  "this backtest starts on <date> (UTC); TradingView may start elsewhere". The record carries
  `window.startDate` / `window.startSentence`; the report reads them and the route serves them
  verbatim. With no record (a refusal) the route applies its mirror `start_sentence_of` to the
  bar time it sent, held to the JS function by `tests/fixtures/pine_runtime/w9t13a_start_sentence.json`
  (written by `w9T13aBrokerReport.test.js`, an ASX session that is the day before in UTC).
- **D8: not implemented yet.** T13a (`RT/brokerReport.js`) and T13b (the report panel) do not
  exist on master. D8 is their acceptance criterion: an uncomputable metric shows its refusal
  sentence.

## Section 9 item 6: RESOLVED, no change needed

Coordinator finding on `origin/master` `33a8a2ab43`: the chart lane never requests `bars=5000`.
`StockChart` and `barsBackfill` use 600 bars, then `fullBarsFor('D')` = 12500. The
`tf=D&bars=5000` that was seen comes from the notebook's `BarReplay.jsx:114`, a replay display
fetch, which is a different quantity. Only the server sets `ctx.historyWindowBars`
(`api/services/pine_runtime_client.py:279`), from the single authority
(`bars_window.HISTORY_WINDOW_BARS`). A grep on this branch agrees: the other `bars=5000` in
`app/src` is `testing/marketIndicators/marketIndicatorsHarness.jsx`, a test harness, also not the
chart lane.

## Section 9 item 4: RESOLVED, fixed earlier by W9-T0

The 11-03 census (W4-T0 peel) passed a smaller reference, `runs/C/ref_rebuilt.json` (286 items, no
`strategy.entry` / `exit` / `order`), and the tooling of the day found order calls through that
inventory. 17 strategies lost the `[strategy]` wall wrongly; 6 of them read as transfers. W9-T0
(`0b8e9145bd`) detects orders from the source, with a rail, and the 11-05 census on master shows
all 70 back with no strategy transferring. Evidence:
`docs/pine/evidence/2026-11-07-w9-open-questions/EVIDENCE.md`.

## Section 9 item 7: RESOLVED, fixed on `fix/pine-w9-open-questions`

The walker does not skip an order-only `if`: it lowers its test, which runs every bar, and a
`strategy.*` value there refuses by name. With the broker dark only the order is dropped. Its
arguments were dropped with it, which served a wrong value when one had an effect (an array push).
They are now evaluated in place, the `alert()` rule, railed by
`runtime/__tests__/w9OrderOnlyIf.test.js`. Evidence:
`docs/pine/evidence/2026-11-07-w9-open-questions/EVIDENCE.md`.

## Follow-ups

1. **D5, single-symbol.** T14's route accepts up to `min(INLINE_MAX_SYMBOLS, max_cells() //
   HISTORY_WINDOW_BARS)` symbols, which is 50 at the defaults. D5 rules single-symbol for now. The
   change is a cap of 1 in `max_symbols()` plus its rail; it is a behaviour change to T14's
   route, so it is left to T14's owner rather than folded into this docs branch.
2. **D8** lands with T13a and T13b.
3. **D4** awaits the owner.
4. **9.7, `strategy.*` reads in an order argument over-refuse (review N1 on #935).** Calls such as
   `strategy.opentrades.entry_price(0)` or `strategy.closedtrades.profit(0)` now count as effects
   under "unknown namespaced call = effect", so they are lowered and refuse `pine:strategy-call`
   where master dropped them and served. This is an over-refusal, never a wrong value. The fix is to treat
   `strategy.*` reads as values at the order site. The `alert()` site has the same behaviour.
   **RESOLVED (W9-OQ-N1, `fix/pine-w9-oq-n1`).** At the dark order site a `strategy.*` read call
   (`strategy.opentrades.*`, `strategy.closedtrades.*`, `strategy.convert_to_*`,
   `strategy.default_entry_qty`) is a value, so an argument of reads and values is dropped with the
   order and the script is served. The read can reach a served output only through an effect in the
   same argument; that argument is still lowered whole and the read refuses by name. The `alert()`
   site is NOT changed: an alert message is served output, so a read there reaches it and the
   refusal is honest, not an over-refusal. Rails: `runtime/__tests__/w9OrderOnlyIf.test.js`
   (`W9-OQ-N1`), four hand-mutations killed.
