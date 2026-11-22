# Strategy broker: the reversal at the v6 default size (Q-S1a), evidence 2026-11-17

Branch `feat/pine-strategy-reversal-sizing`, STACKED on `feat/pine-strategy-margin-call` (#1539, head `365c3ed4fd`).
The strategy broker stays DARK (`VITE_PINE_STRATEGY_BROKER_ENABLED` off): nothing a member is served changes. Engine
number: NUMBER PENDING.

## 1. What the texts state

- User Manual, "Strategies", section "Reversing positions" (fetched 2026-11-17): "By default, when an order from a
  strategy.entry() call executes while a position is open in the opposite direction, the command automatically adds the
  position's size to the new order's size. The added quantity allows the order to close the current position and open
  a new position for the specified number of contracts/lots/shares/units in the new direction."
- v6 Reference, `strategy()` `default_qty_type`: "strategy.percent_of_equity for a percentage of available equity"
  (`runtime/broker.js` `defaultSize`, W9-T4).
- Neither states WHICH equity sizes a percent order while a trade is open (the open trade's profit in or out, at the
  signal close or at the fill), how it is rounded, what happens when the new size cannot be funded, or in what order two
  market entries placed on one bar fill. The capture answers each for the shape it holds.

## 2. What the capture witnesses

`w9-q-s1b-defaults-v6-rddt-1d-2026-11-15` (probe `w9-q-s1b-defaults-v6.pine`, NYSE:RDDT 1D, report ok, Properties read
back: v6 defaults, percent of equity 100, margins 100, capital 100,000, pyramiding 1): `L1` long on the SMA 5/20
crossover, `S` short on the crossunder (reversals), `L2` long every fourth bar while long (rejected at the pyramiding
limit). 31 trades (30 closed), 32 fills, 30 std-set labels.

A scratch replay (outside the repo) reproduces all 30 closed trades exactly (bar, units, price, profit) under exactly
these readings, and DIVERGEs under the alternatives tried:

| reading | witnessed by | alternative tried |
|---|---|---|
| a reversal's NEW size = floor(strategy.equity at the signal close, the open trade's profit included, / that close); the order fills the open size plus it | 12 reversals; bar 84: 2,160 + floor(148,945.60 / 68.13) = 2,186 = TradingView's fill of 4,346 | - |
| it is REJECTED whole (nothing closes, nothing opens, not kept) when new size x fill open > that SAME equity | 13 crossings absent; bars 52, 65 and 632 fit the equity re-marked at the fill open (by $31.52, $31.44, $67.54) and are still absent | the equity re-marked at the fill (44 trades against 30); the whole order (close + new) against it (0 trades) |
| market entries on one opening tick are taken in the order placed; one rejected first leaves the next its turn | bars 229 and 629 (`L2` rejected, then `S` reverses: 1,027 and 776), 65 and 585 (both rejected), 641 (`L1`, `L2` both rejected) | `S` first: `L2` would reverse it back (no such trade) |
| a margin call whose manual size exceeds the trade closes the whole trade | bar 154: size 1,540 of a short of 1,306 at the open 104.90; TradingView lists one call of 1,306 | - |
| the margin call itself (B-MARGIN-CALL, #1539) | 18 more margin calls, each matched | - |

`w9-q-s1b-defaults-v5-rddt-1d-2026-11-15` (the same script at the v5 defaults: a fixed size of 1, margin 0) is a second
witness of the entry order on one tick (it refused Q-S1d before) and grades MATCH too.

## 3. What is served (and what still stops by name)

`runtime/broker.js`:
- **[B-QTY-REVERSE]** (`defaultSize`): a market `strategy.entry` against every open trade, at the percent default 100,
  margins 100, no risk command: the size above.
- **[B-FUNDS-REVERSE]** (`fillEntry`): the rejection above; the order row ends `rejected`, why `funds`.
- **[B-MARGIN-CALL-ALL]** (`marginTick`): the whole-trade close above.
- **[B-ENTRY-ORDER]** (`tickFill`): several market `strategy.entry` orders (and nothing else) on one OPENING tick, in
  placement order; served while every one before the last fills nothing (one that fills with later ones waiting stops
  by name, Q-S1d).
- A SAME-side percent order placed while a trade is open is sized only if it fills: at the pyramiding limit it is
  rejected without a size (`L2`); one that would fill stops by name at its fill, Q-S1a, with the old sentence.
- Still refused by name: a percent other than 100 on a reversal, a reversal whose open trades are gone at its fill, a
  same-side order that would fill (Q-S1a); a close or price order beside other orders on one tick (Q-S1d).

The pin ledger (`evidence_engine.py pins`, `pins --check` PASS): + B-QTY-REVERSE, + B-FUNDS-REVERSE, + B-MARGIN-CALL-ALL
(each `[w9-q-s1b-defaults-v6]`), + B-ENTRY-ORDER (`[v5, v6]`), + B-PYR (`[w9-d11-late-first-use-rpt, v5, v6]`: every
committed capture that exercises it MATCHes); B-FUNDS-SHORT and B-MARGIN-CALL gain v6 as a second fixture. 34 -> 39
pinned of 58 rules. brokerPins.lock.json needs the coordinator's entry with the number.

## 4. Grades, before (#1539 head 365c3ed4fd) and after

| capture | before | after |
|---|---|---|
| w9-q-s1b-defaults-v6-rddt-1d-2026-11-15 | DIVERGE step 1 (refused, Q-S1a: a percent size while trades are open) | **MATCH step 8**: trades, fills, 9 slots, 38 values, 30 texts |
| w9-q-s1b-defaults-v5-rddt-1d-2026-11-15 | DIVERGE step 1 (refused, Q-S1d: two orders on one opening tick) | **MATCH step 8**: trades, fills, 9 slots, 38 values, 39 texts |

Every other committed strategy capture re-graded (the whole U14 table): no other verdict file changes. No MATCH ->
DIVERGE. INCONCLUSIVE inside both MATCHes: the report slots our report does not state (`ungradedSlots`).

## 5. The armed strategy census (70 strategy scripts, RDDT 1D)

| wall | before (365c3ed4fd) | after |
|---|---:|---:|
| **would transfer if armed** | **2** | **5** |
| `run:...:Q-S1a` | 17 | 8 |
| `run:...:Q-S1i` | 0 | 6 |
| every other wall | 51 | 51 |

Newly transferring: `builtin:consecutive-updown-strategy`, `builtin:rsi-strategy`, `builtin:stochastic-slow-strategy`.
None has a committed capture (searched by source sha256 over `tests/fixtures/vendor/harness/`), so none has a DIVERGE
capture and nothing is kill-listed.

The 6 that move to Q-S1i stop, by name, on margin-call shapes no capture witnesses: a call at a tick exactly half a
tick off the grid (inside-bar 248.015, outside-bar 165.505, pivot-extension 59.565), a size that differs between the
tick's price and its rounded fill (macd, at 106.7068: 72 against 76), a cover that truncates to 0 (moving-average-
crossover), and a reversal into a deficit at its fill (two-moving-averages-crossover).

## 6. Rails and mutants

Rails: `runtime/__tests__/w9Reversal.test.js` (new), `w9MarginCall.test.js` (the whole-trade close), `w9T4Sizing.test.js`
(the pyramid add now completes; B-CLOSE-QTY is the unpinned subject), `pane/strategyReportPanel.test.jsx` (its unpinned
subject is B-PYR-PRICE), the rule-count and D7 rails (58 rules, 39 pinned), `w9T1Broker.test.js`,
`tests/test_broker_pins_resolve.py`, `strategyGrading.test.js` (the verdict files).
Mutants: `ci/mutants/strategy-reversal-sizing.json`.

## 7. Still open (queue rows)

A reversal at a percent other than 100, or beside a commission; a same-side percent order while a trade is open
(pyramiding above 1); a margin call at a half-tick tie, or where the price and the rounded fill disagree on its size,
or whose cover truncates to 0; a reversal into a deficit at its fill. Each needs a capture with the Strategy Tester
report (NEEDS_LIVE on the owner's rig).
