# Strategy broker: Pine v2 / v3 strategies (B-V3), evidence 2026-11-17

Branch `feat/pine-strategy-next-wall`, STACKED on `feat/pine-strategy-reversal-sizing` (#1547, head `30f9977848`, which
contains #1539). The strategy broker stays DARK: nothing a member is served changes. Engine number: NUMBER PENDING.

## 0. Why this wall

After #1547 the armed census's biggest walls are Q-S1a (8; seven of them percent-of-equity STOP entries, a shape no
committed capture witnesses: probe `w9-q-s1a-size-stop-v6` is queued), `strategy:no-broker-run` (11) and Q-S1b (8: the
v4 margin default, held by coordinator ruling D12, which this unit does not clear). Inside `strategy:no-broker-run`,
Pine v2 order calls are the biggest group a COMMITTED capture witnesses: 4 scripts refuse `runtime:strategy-option`
("`strategy.entry` in Pine version 2"), and the two committed report captures `w9-q-s1a-size-v2` (v2) and
`w9-g1-v3-properties` (v3) both DIVERGEd at step 1 on exactly that refusal.

## 1. What the texts state, and what the captures witness

No Pine v2 / v3 Language Reference was read (`docs/pine/strategy-broker-spec.md` sources: R4 / R5 / R6 only), and the
User Manual documents v6. So nothing here is served from a text: only what the two captures witness.

| capture | source calls | Properties read back | trades | grade before -> after |
|---|---|---|---:|---|
| w9-q-s1a-size-v2-rddt-1d-2026-11-15 (v2, report ok) | `strategy.entry("L", strategy.long, when = up)`, `strategy.close("L", when = dn)` | Qty Type fixed, Qty Value 1, Initial Capital 100000, pyramiding 1, commission percent 0, slippage 0; NO margin, process_orders_on_close or close_entries_rule input | 20 | DIVERGE step 1 (`runtime:strategy-option`) -> **MATCH step 7**: trades, fills, 9 slots, 9 values |
| w9-g1-v3-properties-rddt-1d-2026-11-15 (v3, report ok) | `strategy.entry("L", strategy.long)`, `strategy.close("L")` inside `if` | the same | 20 | DIVERGE step 1 -> **MATCH step 7**: trades, fills, 9 slots, 2 values |

Step 7: neither probe draws a label, so there is no text to grade. 12 report slots our report does not state stay
ungraded (`ungradedSlots`).

## 2. What is served

`ast/strategyBroker.js`:
- `V3_SIGNATURES`: v2 / v3 `strategy.entry(id, direction)` and `strategy.close(id)` by position, plus a named `when`.
  Any other command (exit, close_all, cancel, order), argument position or named argument refuses `runtime:strategy-option`.
- `DECLARATION_DEFAULTS[2]` / `[3]`: fixed 1, capital 100,000 (the read-back), `margin: null`; `marginUnread` is set,
  and a declared `margin_long` / `margin_short` refuses (no such input is read back below v4).

`runtime/broker.js`:
- **B-V3** is asked once, before the first bar, by every v2 / v3 run (the whole run rests on it).
- the margin check of a v2 / v3 run (`marginUnread`) is served only where no margin can change the run: the position
  fits the equity (as at a margin of 100, and so at any lower one). A position worth more stops by name (W9-G1).

Pin ledger: + B-V3 by both captures (`pins --check` PASS), 39 -> 40 pinned of 59 rules. brokerPins.lock.json needs the
coordinator's entry with the number.

## 3. Grades and census

Every committed strategy capture re-graded: only these two verdict files change (both DIVERGE -> MATCH). No MATCH -> DIVERGE.

Armed census (70 strategy scripts, RDDT 1D), before (30f9977848) -> after:

| wall | before | after |
|---|---:|---:|
| **would transfer if armed** | **5** | **6** |
| `strategy:no-broker-run` | 11 | 8 |
| `run:...:Q-S1a` | 8 | 9 |
| `run:...:strategy-unpinned:B-FILLS` | 0 | 1 |
| every other wall | 46 | 46 |

- `reference:golden-cross-sma-200-long-only-moving-average-strategy-by-chartart` newly transfers. It has no committed
  capture (searched by source sha256), so nothing is kill-listed.
- `reference:hull-moving-average-crossover-strategy` now stops at B-FILLS (unpinned, row W9-P2).
- `reference:vix-fix-stochrsi-strategy` now stops at Q-S1a (a same-side percent entry with pyramiding 9).
- `reference:macd-sma-200-strategy-by-chartart` still refuses at build (`strategy.cancel` in v2, a stop entry,
  `strategy.risk.max_intraday_loss`).

## 4. Rails and mutants

Rails: `runtime/__tests__/w9V3.test.js` (new: v2 with `when`, v3 inside `if`, unpinned stops by name, every unwitnessed
call / argument / margin refuses, a position past the equity stops W9-G1), the rule-count and D7 rails (59 rules, 40
pinned), `w9T1Broker.test.js`, `tests/test_broker_pins_resolve.py`, `strategyGrading.test.js` (the verdict files).
Mutants: `ci/mutants/strategy-v2-v3.json`.

## 5. Still open

A v2 / v3 `strategy.exit`, `close_all`, `cancel`, `order`, or any other argument; a v2 / v3 position worth more than the
equity (no margin input is read back). Each needs a v2 / v3 capture with the report that makes that call (NEEDS_LIVE).
And the decision this unit does not take: ruling D12 holds the v4 margin default (8 scripts wait on Q-S1b).
