# Strategy broker: TradingView's margin call (Q-S1i, the short), evidence 2026-11-17

Branch `feat/pine-strategy-margin-call`, cut from `origin/master` `66dd41b3e8` (engine 66). The strategy broker stays
DARK (`VITE_PINE_STRATEGY_BROKER_ENABLED` off): nothing a member is served changes. Engine number: NUMBER PENDING.

## 1. What the User Manual states (cited verbatim)

Pine Script User Manual, page "Strategies" (`https://www.tradingview.com/pine-script-docs/concepts/strategies/`),
section "Margin and leverage", fetched 2026-11-17 (HTTP 200, 85,590 B), tags stripped:

> To simulate this process in strategies, the broker emulator generates margin call events if a strategy's available
> funds fall below the required margin percentage. Each time that a margin call event occurs, the emulator
> immediately liquidates four times the number of contracts/shares/lots/units required to cover the loss to help
> prevent continuous margin calls across subsequent bars. The emulator uses the following algorithm to determine the
> liquidated quantity for each event:
>
> Calculate the amount of capital spent on the position: Money Spent = Quantity * Entry Price
> Calculate the Market Value of Security (MVS): MVS = Position Size * Current Price
> Calculate the Open Profit as the difference between MVS and Money Spent. If the position is short, multiply this value by -1.
> Calculate the strategy's equity value: Equity = Initial Capital + Net Profit + Open Profit
> Calculate the margin ratio: Margin Ratio = Margin Percent / 100
> Calculate the margin value, which is the cash required to cover the hypothetical account's portion of the position: Margin = MVS * Margin Ratio
> Calculate the strategy's available funds: Available Funds = Equity - Margin
> Calculate the total amount of money lost: Loss = Available Funds / Margin Ratio
> Calculate the number of contracts/shares/lots/units the account must liquidate to cover the loss, truncated to the
> same decimal precision as the minimum position size for the current instrument: Cover Amount = TRUNCATE(Loss / Current Price).
> Multiply the quantity required to cover the loss by four to determine the margin call size: Margin Call Size = Cover Amount * 4

> Therefore, short trades in a strategy that uses any nonzero margin are subject to forced liquidation from margin
> call events, even if the margin_short argument is 100 or the "Short leverage" input value is 1.

The manual does NOT state: which price "Current Price" is (and so when on the bar the event happens), at what price
the liquidation fills, how the event is listed (order id, comment), or what happens to an entry the funds cannot
carry on a short. The capture answers each of those for the shape it holds.

## 2. What the capture witnesses

`w9-q-s1i-short-v6-rddt-1d-2026-11-16` (probe `tools/visual_conformance/probes/w9-q-s1i-short-v6.pine`, NYSE:RDDT 1D,
gradeMethod a, report ok, Properties read back: v6 defaults, 100% of equity, margin long/short 100, capital 100,000,
no commission, no slippage, pyramiding 1): an SMA 5/20 crossunder short, closed on the crossover. 23 trades (22
closed, 1 open), 32 fills, 22 std-set labels.

A scratch replay of the manual's algorithm (outside the repo) reproduces all 22 closed trades exactly (bar, units,
fill price, profit) under exactly these readings, and DIVERGEs under the alternatives tried:

| reading | witnessed by | alternative tried |
|---|---|---|
| "Current Price" is each TICK of the simulated path ([B-PATH]): the open after its fills, then the extremes and the close | bar 84: called at its HIGH 71.41 (Available Funds cross zero near 67.98, between ticks: no call there); bar 297: two calls on one bar, 60 at its open 108.19 then 316 at its high | - |
| the fill is that tick's price rounded to the nearest tick | 113.7999 -> 113.80, 104.9111 -> 104.91, 106.7068 -> 106.71, 233.7128 -> 233.71, 144.5499 -> 144.55 (up and down: nearest, not toward the loss) | computing the size at the raw price instead: the same 13 sizes (not told apart here; a run where the two differ refuses by name) |
| a flat short market entry at the v6 default that needs more than the equity at its fill open is REJECTED (no trade, not kept waiting) | 20 crossunders; the 9 with qty x fill open <= equity are TradingView's 9 entries, the 11 others are absent from its trades and fills | filling them and margin-calling at the open: 54 trades against TradingView's 23 |
| the event closes part of the oldest trade, which keeps its entry | trades 1-2, 4-8, 9-10, ... share their entry bar and price | - |
| TradingView lists the fill with `e: null` (no entry / exit command), id `Margin call N`, comment `Margin call` | the 13 margin-call fills in `filledOrders` | - |
| the closed trade's exit id reads `Close position order`, its exit comment `Margin call` | 13 labels `S>Close position order:Margin call` | - |

The 13 margin calls (bar index of the call, the entry bar, the tick, units, fill):

| call bar | entry bar | tick | units | fill |
|---:|---:|---|---:|---:|
| 84 | 84 | high 71.41 | 560 | 71.41 |
| 295 | 292 | high 104.9111 | 52 | 104.91 |
| 296 | 292 | high 106.7068 | 28 | 106.71 |
| 297 | 292 | open 108.19 | 60 | 108.19 |
| 297 | 292 | high 113.7999 | 316 | 113.80 |
| 330 | 330 | high 147.05 | 136 | 147.05 |
| 361 | 361 | high 227.9 | 48 | 227.90 |
| 363 | 361 | high 239.37 | 68 | 239.37 |
| 408 | 408 | high 199.3 | 312 | 199.30 |
| 446 | 446 | high 233.7128 | 12 | 233.71 |
| 567 | 566 | high 169.02 | 288 | 169.02 |
| 629 | 629 | high 153.88 | 68 | 153.88 |
| 651 | 651 | high 144.5499 | 4 | 144.55 |

Worked example (bar 84): 1,467 short at 67.80 (100,000 / signal close 68.13, floored); at the high 71.41 MVS =
104,758.47, Open Profit = -5,295.87, Equity = 94,704.13, Available Funds = -10,054.34, Cover = TRUNCATE(-140.79) =
-140, size 560. The capture: 560 at 71.41.

## 3. What is served (and what still stops by name)

`runtime/broker.js`:
- **[B-MARGIN-CALL]** (`marginTick`): ONE open SHORT trade at `margin_short` 100, no commission, no slippage, default
  fill timing (no `process_orders_on_close` / `calc_on_order_fills`), no `strategy.risk.*` command, no exit bound to
  the trade, a minimum contract of 1 and a point value of 1. On every tick of the bar (the open after its fills, each
  path vertex), the manual's algorithm; a call fills at that tick rounded to the nearest tick, as an order row of kind
  `margin_call` (side buy, comment `Margin call`, rule B-MARGIN-CALL), closing part of (or the whole) trade.
- **[B-FUNDS-SHORT]**: the short twin of B-FUNDS (`fundsRejectShape` / `fundsShort`).
- Still `runtime:strategy-unsettled` Q-S1i, by name: every other shape past the funds (a long, more than one open
  trade, a margin other than 100, a commission, an exit bound to the trade, an unknown minimum contract, ...: the
  stop names which), a cover that truncates to 0, a size above the trade, a tick an exact half-tick off the grid, a
  size that differs between the tick's price and its rounded fill, a Loss / price on a whole number, and a call due
  on a tick where an order fills (which TradingView makes first is not witnessed).
- Every position that is not the witnessed shape keeps exactly the check it had (`marginCheckBar`, the bar's worst
  price after the open's fills).

`runtime/strategyRecord.js`: `margin_call` is an order kind (its id generated by TradingView, null in the log);
`witnessedExitIdOf` answers `Close position order` for it behind B-MARGIN-CALL.

The harness (three corrections, each found by this capture):
- `tools/vendor_harness/compare.mjs::compareTrades` joined trades on the entry time with a Map, one trade per time: the
  second trade of an entry bar silently replaced the first (step 4 read "exitTime differs at 1721741400" with every
  trade equal). It now groups each entry bar's trades in one canonical order (exit time, exit price, quantity) on both
  sides. No other committed verdict moves.
- `strategyHarness.js::oursOf`: a margin call's fill takes the role TradingView's `e: null` maps to (`order`).
- `tools/vendor_harness/evidence_engine.py::resolve_pins` read the evidence ledger's own row (the INDICATOR harness's
  per-lane grade, `verdicts: {production, runtime-on}`, no top-level `verdict`; all 972 committed rows have that shape)
  as a broker row with a missing verdict, i.e. a non-MATCH: a capture promoted through that harness (the 2026-11-16
  night's) could never pin, whatever its strategy verdict. Such a row is now skipped; a fixture with only such a row is
  still "no committed verdict" (an error). Rail: `tests/test_broker_pins_resolve.py`.

## 4. The capture's grade, before and after

| capture | before (master 66dd41b3e8) | after |
|---|---|---|
| w9-q-s1i-short-v6-rddt-1d-2026-11-16 | DIVERGE step 1, our run refused (`runtime:strategy-unsettled`, Q-S1i) | **MATCH step 8**: trades, fills, 9 report slots, 39 value series, 22 drawn texts |

INCONCLUSIVE inside the MATCH: 12 report slots our report does not state (`runtime:strategy-report-unstated`:
maxDrawdown, maxRunup, buyAndHoldReturn, percentProfitable, avgTrade, avgWinningTrade, avgLosingTrade,
largestWinningTrade, largestLosingTrade, avgBarsInTrades, sharpeRatio, sortinoRatio), listed in the verdict file's
`ungradedSlots`, never compared. The open trade (TradingView's 23rd, exit "" at the unrun newest bar) is graded with
the fills.

Every other committed strategy capture: re-graded (UPDATE_STRATEGY_VERDICTS=1, the whole U14 table); no verdict file
changed but this one (`git diff --stat` of `docs/pine/vendor-harness/strategy-verdicts/`: one file). No MATCH -> DIVERGE.

The pin ledger (`evidence_engine.py pins`, `pins --check` PASS): + B-FUNDS-SHORT and + B-MARGIN-CALL, both
`[w9-q-s1i-short-v6-rddt-1d-2026-11-16]`; nothing else moves (32 -> 34 pinned of 54 rules). `brokerPins.lock.json`
needs the coordinator's entry with the engine number (`brokerPinsLock.test.js` is red until then, by design).

## 5. The armed strategy census (70 strategy scripts, RDDT 1D), before and after

`strategyArmedCensus.measure.test.js` over the 70 reference-only strategy scripts (the input of 2026-11-16), one lock
hold each, before on the unmodified tree (66dd41b3e8), after on this branch's tree with the resolved ledger.

| wall | before | after |
|---|---:|---:|
| **would transfer if armed** | **2** | **2** |
| `run:runtime:strategy-unsettled:Q-S1i` (the margin check) | 7 | **0** |
| `run:runtime:strategy-unsettled:Q-S1a` | 10 | 17 |
| `strategy:no-broker-run` | 11 | 11 |
| `run:runtime:strategy-unsettled:Q-S1b` | 8 | 8 |
| `door:pine:request` / `door:pine:module` / `door:pine:no-output` | 7 / 6 / 5 | 7 / 6 / 5 |
| everything else (one or two each) | 14 | 14 |

The 7 built-ins that stopped at the margin check (channel-breakout, consecutive-updown, inside-bar, macd,
moving-average-crossover, rsi, two-moving-averages-crossover) now run past every margin call and short funds check
their run reaches and stop, each, at the NEXT question: Q-S1a, "the entry takes a percent-of-equity default size
while trades are open, and whether available equity excludes what they hold is not stated" (each places a long and a
short entry: the reversal is sized while the other side is open). So the census's transfer count does not move in
this slice; the Q-S1i wall is gone. Nothing newly transfers, so nothing is kill-listed.

The next slice: the reversal's default size. `w9-q-s1b-defaults-v6-rddt-1d-2026-11-15` (committed, report ok) is a
v6 default-size strategy with reversals whose report also lists a `Margin call`; it stops today at that same Q-S1a
question, so it is the witness to read first.

## 6. Rails and mutants

Rails: `runtime/__tests__/w9MarginCall.test.js` (new: the call at the high, the rounded fill, a call at the open, the
control with no call, unpinned stops by name, and each unwitnessed shape stopping by name), `w9T4Sizing.test.js`
(B-FUNDS-SHORT rejects; unpinned stops by name; the member door completes with it pinned; an explicit-size short
still stops), `w9T1Broker.test.js`, `w9ValueReadbacks.test.js`, `ast/strategiesAreRuled.test.js` (54 rules, 34
pinned), the D7 scorecard rails, `__tests__/vendorHarness/strategyGrading.test.js` (the verdict file),
`tests/test_broker_pins_resolve.py` (54 rules; the ledger-row reading).

Mutants: `ci/mutants/strategy-margin-call.json` (MC1-MC8), run by pine-heavy's dispatch `mutants` job; results in the PR.

## 7. Still open (queue rows)

Q-S1i keeps, by name: a LONG margin call (margin below 100; the manual's own example is a long at 25% on a
TSLA daily chart: Supertrend Strategy, 300% of equity, long leverage 4), a margin other than 100, a margin call beside a
commission / slippage / bound exit / pyramided trades, a minimum contract other than 1. Each needs a capture with the
Strategy Tester report (NEEDS_LIVE on the owner's rig).
