# Strategy value read-backs on the runtime lane: evidence (2026-11-15)

Branch `feat/pine-strategy-value-readbacks`, cut from `origin/master` `771264afff` (`SCRIPT_ENGINE_VERSION` 57).
The broker stays dark (`VITE_PINE_STRATEGY_BROKER_ENABLED` off) and the pin ledger stays empty in the main commits:
nothing here is served to a member.

Every number below is re-derived by a committed rail from the committed captures
(`tests/fixtures/vendor/harness/<id>-2026-11-15.json`, runs s25 / s26 / s27): the witness tables by
`app/src/components/chart/engine/__tests__/vendorHarness/strategyReadbackWitness.test.js` (TradingView's own data,
no engine import), the grades by `strategyGrading.test.js` (which holds every verdict file to today's grade).

## 1. What refused, and why

U14 graded the 33 strategy captures and 26 refused `runtime:strategy-value` at build. All 26 are one thing: the
standard plotted set reads `strategy.closedtrades.entry_time(i)` and `exit_time(i)`, the only two per-trade reads
`BROKER_OPS` (`runtime/broker.js`) did not name. Every other `strategy.*` read of the 33 sources was already served
behind `B-VAL` (and the commission rules).

Serving the two reads uncovered what U14 could not reach:

1. **The harness built neither way the member door builds.** `strategyHarness.js` passed neither `objectsInRun` nor
   `objectTrees`, so the std set's `label.new` refused `runtime:object-op`. It now builds as
   `runtimeObjectsDoor.js::runtimeOwnObjectsOf` does: the build that draws when it lowers a drawing, else the value
   build with the label texts listed UNGRADED by name.
2. **No value series was ever compared before this unit.** U14 keyed our plots by `output.title`; no plot output
   carries a title, so the map was always empty. Method (a) never read it; method (b)'s signal identity could only
   answer INCONCLUSIVE. Plots are now paired by source order, fail-closed (section 4).
3. **RDDT's bars carry off-grid prices** (292 of 666 bars hold an open, high or low off the 0.01 grid). Our broker
   filled a market order at the raw open and called the fill exact; TradingView never reports an off-grid fill.

## 2. The witnesses

### 2.1 B-ROUND: a fill on an off-grid OPEN is that open rounded to the nearest tick, a tie up

Over the 33 captures TradingView reports 1,402 fills; none is off the tick grid. 96 of them sit on a bar whose open
is off the grid, on 18 distinct bars of 23 captures, and every one is the open rounded to the nearest tick with a
tie rounded UP.

| | count |
|---|---:|
| fills at the rounded open of an off-grid open | 96 |
| distinct bars / captures | 18 / 23 |
| the open is exactly a half tick (a tie), all filled UP | 70 |
| below a half tick, all filled down | 22 |
| above a half tick, all filled up | 4 |
| buys / sells | 12 / 84 |
| MARKET (entry, `strategy.order`, `strategy.close`, `strategy.close_all`) | 93 |
| STOP (an exit's stop the open reached) | 3 |
| LIMIT, STOP_LIMIT | 0 |
| counterexamples | 0 |

The data separates the rule: "ties down" fails on all 70 ties, "always down" on 74 rows, "always up" on 22. A tie
filled UP on a SELL (60 of the 70 ties) is the favorable direction for the strategy, so it is rounding, not slippage.

Captures (23): s1-broker-core, w9-g1-v3-properties, w9-k1-commission-pct, w9-k2-commission-contract,
w9-k3-commission-order, w9-p2-order-fills, w9-p2-order-fills-nv, w9-p3-every-tick-history, w9-q-s1a-size-v2, -v4,
-v5cash, -v5pct, w9-q-s1b-defaults-v4, -v5, w9-q-s1e-live-past, w9-q-s1j-stop-limit, w9-q-s1p-when,
w9-r1-risk-allow, w9-r1-risk-ddown, w9-r1-risk-intraday-range (AMEX:SPY 15), w9-x3-oca, w9-x4-order, w9-x5-cancel.

The three STOP fills: s1-broker-core (a buy, 195.985 -> 195.99) and w9-q-s1e-live-past (two sells, 57.7204 -> 57.72
and 113.875 -> 113.88).

W9-K4 (slippage 3 ticks) adds four market sells on an off-grid open, each the ROUNDED open three ticks lower:
114.725 -> 114.70, 244.804 -> 244.77, 141.875 -> 141.85, 155.775 -> 155.75. Rounding to a tick and a whole number
of ticks commute, so "slip before or after rounding" (the refusal W9-T5 raised) is one answer.

**Scope served.** Only the witnessed kinds: a market order, and a stop order the open reached (an exit's stop-loss
leg, a stop entry), on a bar's OPEN. Refused by name (Q-S1l): a LIMIT order the open gapped through (an entry, a
take-profit, a limit entry placed beyond the market), a trailing stop, a trailing activation, a stop-limit's
trigger, and any fill on another tick at an off-grid price (the close under `process_orders_on_close`, a path
vertex under `calc_on_order_fills`).

Not built, recorded for the next unit: w9-p2-order-fills and -nv show 7 market fills at a rounded HIGH or LOW (a
path vertex under `calc_on_order_fills`). Both captures stop earlier on Q-S1d, so the vertex stays refused.

### 2.2 B-ROUND-MARK: open trades are marked at the rounded close

`w9-r1-risk-intraday-range-spy-15` (AMEX:SPY 15m): on all 47 bars where a position is open and the close is off
the grid (24 ties, 10 above a half tick, 13 below), the plotted `strategy.openprofit` equals (rounded close -
`position_avg_price`) x `position_size`. The raw close explains 0 of the 47; "ties down" explains 23. On the 10,099
bars of the 32 captures with a position and an on-grid close, the same formula holds with the close itself.

No RDDT 1D capture holds a bar with a position and an off-grid close, and our run cannot bind AMEX:SPY (its
`syminfo.mintick` has no witnessed row in `symbolScope.json`), so no capture of ours can grade this rule yet. It is
built, asked only when reached, and stays unpinned.

### 2.3 An open trade's paid entry fee is in `strategy.netprofit`, not in `strategy.openprofit`

W9-K1 (percent 0.1), W9-K2 (1.5 per contract), W9-K3 (5 per order): on each capture's 372 bars in position, the
plotted `S07_netprofit` is the last flat bar's net profit minus the entry fee, and `S09_openprofit` is (close -
entry price) x size with no fee in it. `S08_equity` is initial capital + netprofit + openprofit on every bar.

W9-T5 had taken the fee off the open profit (a hypothesis; its comment said the K rows would grade it). The captures
refute it. `strategy.equity` is the same number either way.

Not witnessed, refused by name: `strategy.grossprofit` / `grossloss` while an open trade has paid a fee (the K
probes do not plot them; W9-K1..K3), and the Strategy Tester's own money figures in that state (every K capture ends
flat; W9-S1).

### 2.4 `strategy.closedtrades.entry_time` / `exit_time` are the fill bar's `time`, in milliseconds

The reference states the unit ("the UNIX time of the closed trade's entry, expressed in milliseconds"). That it is
the fill BAR's time is witnessed: on every bar of the 29 captures that plot them (20,000+ bars), `S10_c0_entry_time`
and `S11_c0_exit_time` are the Strategy Tester's own entry and exit bar times for the last closed trade. The intraday
capture separates a bar's time from its session's: AMEX:SPY 15 shows 14 distinct times of day over 3,753 bars. A
daily capture cannot (every RDDT 1D bar time is its session open).

### 2.5 The exit texts (`strategy.closedtrades.exit_id`, `exit_comment`)

Read off the std set's label `entry_id > exit_id : exit_comment`, one per closed trade, graded at step 8.

| rule | text served | captures that MATCH on it (step 8) |
|---|---|---|
| B-TXT-CLOSE-ID | a trade `strategy.close(id)` closed: `Close entry(s) order <id>` | w9-q-s1p-when, w9-k1, w9-k2, w9-k3, w9-k4, w9-p3 |
| B-TXT-CLOSE-ALL-ID | a trade `strategy.close_all()` closed: `Close position order` | w9-x3-oca (w9-x5-cancel reads it and DIVERGEs earlier, on B-CANCEL) |
| B-TXT-ENTRY-CLOSE-ID | a trade a `strategy.entry` fill closed (a reversal, an allow_entry_in close), the entry placed with no comment: that entry's id | w9-r1-risk-allow, w9-r1-risk-ddown |
| B-TXT-NO-COMMENT | a closing order with no comment: `exit_comment` reads the exit id | w9-q-s1p-when, w9-q-s1e-live-past, w9-q-s1k-exit-levels, -v6, w9-k1..k4, w9-p3, w9-r1-risk-allow, -ddown, w9-x3-oca, w9-x4-order |

The same texts appear on captures our run still refuses (s1-broker-core, w9-q-s1b-defaults-v5 / -v6, w9-q-s1j,
w9-x1, w9-x2, w9-p1, w9-p1b-nv, w9-p2-nv, the sizing probes); they are not counted as graded.

Not served, each refused by name:

| text | seen on | why not served | row |
|---|---|---|---|
| `Margin call` | w9-q-s1b-defaults-v6 | a margin call is never modelled | Q-S1i |
| `Close Position (Max number of filled orders in one day)` | w9-r1-risk-intraday-range | a risk halt is never modelled | W9-R1i / W9-R1b |
| the exit id / comment of a trade closed by a reversing entry that CARRIES a comment | none | every witnessing entry has no comment | W9-V1 (its probe must add a commented reversal) |
| `entry_comment` of an order with no comment | none | the label never reads it | W9-V1 |

## 3. Before and after, over the 33 captures

Before (U14, master `771264afff`): 26 `runtime:strategy-value`, 2 `runtime:strategy-option`, 2 `runtime:varip`,
1 `runtime:call-undeclared-builtin-state`, 1 `runtime:strategy-unsettled`, 1 INCONCLUSIVE (margin read-back).
0 graded on trades, fills or values.

After:

| after | n | captures |
|---|---:|---|
| MATCH, step 8 (trades, fills, 9 report slots, every value series bar by bar, every label text) | 13 | w9-q-s1p-when, w9-q-s1e-live-past, w9-q-s1k-exit-levels, w9-q-s1k-exit-levels-v6, w9-x3-oca, w9-x4-order, w9-k1-commission-pct, w9-k2-commission-contract, w9-k3-commission-order, w9-k4-slippage, w9-p3-every-tick-history, w9-r1-risk-allow, w9-r1-risk-ddown |
| DIVERGE, graded (step 4) | 1 | w9-x5-cancel: TradingView's exit `XO` fills on the order `O` re-placed after `strategy.cancel("O")`; ours released the exit (B-CANCEL's own question (b)) |
| INCONCLUSIVE (step 2) | 1 | w9-q-s1a-size-v4: `margin_long` / `margin_short` read back 0, our v4 default is 100 |
| refused, two orders on one tick (Q-S1d) | 5 | s1-broker-core, w9-q-s1b-defaults-v4, -v5, w9-x2-partial, w9-p1b-on-close-fills-nv |
| refused, `syminfo.mincontract` unknown (Q-S1a) | 4 | w9-q-s1a-size-v5cash, -v5pct, -v6, w9-q-s1b-defaults-v6 |
| refused, `runtime:strategy-option` (Pine v2 / v3 order calls) | 2 | w9-g1-v3-properties, w9-q-s1a-size-v2 |
| refused, `runtime:varip` | 2 | w9-p1b-on-close-fills, w9-p2-order-fills |
| refused, an off-grid fill inside the bar (Q-S1l) | 2 | w9-p2-order-fills-nv (a path vertex), w9-x1-trail (a trailing stop's level) |
| refused, a limit fill under slippage (W9-K4) | 1 | w9-p1-on-close |
| refused, stop-limit with its limit at or beyond its stop (Q-S1j) | 1 | w9-q-s1j-stop-limit |
| refused at bind, `syminfo.mintick` not witnessed for AMEX | 1 | w9-r1-risk-intraday-range-spy-15 |

Of the 26 that refused `runtime:strategy-value`: 13 MATCH, 1 graded DIVERGE, 12 refuse by another name
(3 Q-S1d, 4 Q-S1a, 2 Q-S1l, 1 W9-K4, 1 Q-S1j, 1 the AMEX tick).

Each MATCH compared 36 value series (37 on w9-x4-order) over 666 bars and 20 label texts (39 on w9-r1-risk-ddown).

## 4. The grade (compare.mjs `gradeStrategy`, steps 7 and 8)

- **Step 7, value series.** Every plot of the capture against our output of the same plot, bar by bar, joined on
  time: `na` equals only `na`, numbers to `REL_TOL` (1e-9). A differing bar is DIVERGE naming the plot, the bar and
  both values. Strict: a capture with one differing series is DIVERGE as a whole.
- **The pairing is fail-closed.** Our k-th `plot` output is paired with the capture's `plot_k` only when the
  source declares exactly as many plots as the capture holds and our run emitted, and every style title in the
  capture is the title the source declares at that position. Otherwise INCONCLUSIVE, never paired by position.
- **Step 8, drawn texts.** The label texts per bar, as multisets. Texts our run could not draw are listed in the
  verdict's `ungradedTexts` with the reason.
- **Step 2** also refuses a run whose tick is not the capture's own (`minmov / pricescale`).
- **A reversal is one fill of both sizes** in TradingView's fill list; `oursOf` maps our order log to that.
- **`evidence_engine.resolve_pins`**: a strategy MATCH that compared no value series (`graded.values` 0 or absent)
  pins nothing (`MATCH-WITHOUT-VALUES`), like a MATCH without fills.

## 5. Next items, in measured order (how many of the 33 each blocks)

1. Q-S1d, two orders on one tick: 5.
2. Q-S1a, the minimum contract of a listing (`symbolScope.json::min_contract`): 4.
3. Pine v2 / v3 order signatures (`runtime:strategy-option`): 2.
4. `varip` in a strategy (rule 11): 2 (both superseded by their `-nv` twins).
5. Off-grid fills inside the bar (Q-S1l): 2. The vertex half has 7 witnessing fills already (section 2.1).
6. B-CANCEL, an exit waiting on a cancelled order's id binds the order re-placed under it: 1 (w9-x5-cancel, graded DIVERGE).
7. The v4 margin default (both v4 captures read back 0; ours is 100): 1 INCONCLUSIVE, and the second v4 capture behind Q-S1d.
8. A limit fill under slippage (W9-K4): 1.
9. Stop-limit with its limit at or beyond its stop (Q-S1j): 1.
10. `syminfo.mintick` for AMEX: 1 (the only capture that can grade B-ROUND-MARK and the intraday entry time on our side).

## Appendix: rulings D11 and D12 (coordinator, owner-delegated, 2026-11-16)

Recorded in `docs/pine/W9-DECISIONS-2026-11-07.md`. The verdict files now carry the fields D11 asks for
(`firstDifference`, `prefixExact`, `culprit`, `afterDifference`), null unless the capture diverges on a bar.

### What changed in the 33

- **w9-x5-cancel-rddt-1d-2026-11-15** was DIVERGE at step 4; is now MATCH at step 8. The capture settled
  question (b) of the row (`capture-queue-2026-10-05-s1.md` W9-X5): an exit waiting on a cancelled
  `strategy.order` keeps waiting for that id, and binds the order placed again under it, though the exit is
  not called again. Served behind B-CANCEL; the W9-K4-style refusal for a cancelled `strategy.entry` stays.
- **w9-q-s1a-size-v4** and **w9-q-s1b-defaults-v4** were DIVERGE / INCONCLUSIVE; are now EXPECTED-REFUSAL
  under D12 (a v4 strategy that states no margin stops at bind, naming the setting and Q-S1b).

Final table: 14 MATCH through step 8 (was 13; was 0 before this unit), 2 EXPECTED-REFUSAL (the two v4),
17 DIVERGE at step 1 (18 refusals less the one that became MATCH; the two v4 refusals now count as
EXPECTED-REFUSAL instead of INCONCLUSIVE / DIVERGE).

### What the 15 additional rules pin after D11 and D12

The pinned set (31 rules, re-derived from the verdict files by the resolver, with and without the pins
commit `pins --check` passes):

- unchanged from the pre-D11 set (15): B-COMM-PCT, B-COMM-CONTRACT, B-COMM-ORDER, B-SLIPPAGE, B-TICK-HIST,
  B-WHEN, B-GAP, B-PATH, B-OCA, B-REVERSE, B-RISK-ALLOW, B-RISK-DDOWN, B-TXT-CLOSE-ID,
  B-TXT-ENTRY-CLOSE-ID, B-TXT-NO-COMMENT;
- added by D11 and the x5 fix (11, pinned by MATCHing captures and un-pinned by nothing): B-VAL (14),
  B-FILL (14), B-MARKET (14), B-CLOSE (10), B-DEFAULTS (14), B-DIR (14), B-FIFO (13), B-QTY (13),
  B-MARGIN (14), B-SIG (14), B-ROUND (12);
- added by W9-X5 moving to MATCH (5): B-CANCEL (1), B-EXIT-BIND (4), B-EXIT-LIFE (4), B-ORDER (2),
  B-TXT-CLOSE-ALL-ID (2).

That is every rule any committed capture exercises today: `not pinnable: []`.

### Out of scope, confirmed

Not touched in this unit, in measured order by how many of the 33 each blocks: Q-S1d two orders on one tick
(5), `runtime:strategy-option` v2 / v3 (2), varip (2), `syminfo.mincontract` (4), the limit fill under slippage
(1, w9-p1-on-close), stop-limit (1, Q-S1j), the AMEX:SPY mintick bind (1, w9-r1-risk-intraday-range).

## Landing train 2 (engine 60, 2026-11-16)

This unit lands as the first input of landing train 2 (`land/pine-engine-train-2`), under engine number 60, with
its pin ledger as the second input.

- **Re-grade on the merged tree** (master 8cdb0af178 changed `ta.rma`, COND-TA, colours, legacy semantics and
  `str.tostring` under this unit): the 33 committed verdict files are current byte for byte. 14 MATCH through
  step 8, 2 EXPECTED-REFUSAL (D12), 17 refuse at step 1. With D12 the Q-S1d count of section 3 is 4, not 5:
  w9-q-s1b-defaults-v4 now stops at bind, before it can meet two orders on one tick.
- **The pin ledger** was re-derived from that grade and is the proposal's byte for byte: 31 of 50 rules,
  `brokerPins.resolved.json` sha256 98942c2b569ecf46..., lock entry at 60. The 14 MATCH captures pin B-VAL,
  B-FILL, B-MARKET, B-DEFAULTS, B-DIR, B-MARGIN and B-SIG; eleven rules rest on one capture each. B-ROUND-MARK
  and the 18 rules no committed capture exercises stay unpinned.
- **D11** is mutant-railed and unwitnessed by any capture (W9-DECISIONS D11 point 7); queue row W9-V-D11 and its
  generated probe `w9-d11-late-first-use.pine` are the one shape that can exercise it.
- **Mutants:** the 62 of `ci/mutants/strategy-readbacks.json` were all killed and byte-restored locally on
  #1406's head ebd06125ce (the cloud dispatch of that day failed on the runner's root, fixed since by #1414).
  They ride in the train's manifest `ci/mutants/landing-train-2.json`.
- The strategy broker gate stays off. Nothing here is served to a member.
