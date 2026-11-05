VERDICT: NO-GO @a967e01a14

Delta re-review of `docs/pine/W9-STRATEGY-DESIGN.md` r1 (`origin/docs/pine-w9-strategy-design`
@a967e01a14), against the r0 NO-GO @abe065dd80. Read-only: `git show`/grep and a read-only Python
scan of the 70 sources. No vitest, census, harness, rig or heavy job was run.

Summary: r0's B2, B3 and B4 are fixed. B1 is fixed in substance. B5 is fixed in intent. Three new
blockers come from how two of those fixes meet W5 and the grading set. Their scope is narrow:
- **Can start now:** T0, T3a, T3b, and T2's ledger, resolve step and grader. None of them is
  touched by these blockers.
- **Blocked:** T2's identity field (B1), T14 (B2) and block E grading (B3).

## r0 findings: status

| r0 | status | evidence |
|---|---|---|
| B1 history | fixed in substance, but see new B2 | 3.4: one window, `_MAX_BARS`, no listing rule, no 32,768 cap; D9 makes a longer window an owner change to the one constant |
| B2 SPY captures | fixed | all pins are on (a) RDDT 1D or (b) SPY with a time range; E is 70 on RDDT; recount checked: B 25 + C 25 = 50, 47 schedulable (minus Q-S1i and W9-M1 x2) |
| B3 FE footprint | fixed at 00e2d0dfda; now stale (N1) | anchors checked at `00e2d0dfda`, see below; `orderOnlyChain` count is 0 on master and on 00e2 |
| B4 probes | fixed | every row names a probe file (T3b); the CSV reads are replaced by plotted and label fields |
| B5 pins vs identity | intent right, contract wrong | see new B1 |
| N1-N11 | folded in | T13 split; s1BrokerCensus dropped; existing opcode rail reused; magnifier 0; 23/23; W9-MK1; broker checks its own window; bar identity first; `asOfBar`; 47 now |

Anchors checked at `00e2d0dfda`:

| site | line | what is there |
|---|---:|---|
| F3 | 1074 | `buildRuntimeIr` |
| F4 | 1203 | head of `buildRuntimeIrLinked` |
| F5 | 2865 | `holdsObjectCall` |
| F6 | 5459 | `holdsPineTwin` |
| F7 | 5579 | `ORDER_ENUM` |
| F8 | 6006 | `case 'call': {` |
| F9 | 8913 | the R1 strategy skip |
| F11 | 10926 | `lowerStmts(stmts, root, true)` |
| F12 | 11260 | the options object |

FE is 11,350 lines at `00e2d0dfda`.

## Blockers

B1. Putting `broker_pins` in the identity breaks W5's identity contract and its gate.
   The r1 plan (rule 7; T2) adds a field `broker_pins` to the runtime identity and does not bump
   `SCRIPT_ENGINE_VERSION`. On W5 (`SERVER-RUNTIME-DESIGN.md` on `feat/pine-w5-t15-backtest`) that
   breaks three things.
   - **The identity is a fixed five-field contract.** Lines 199-200 list exactly five fields in
     the digest preimage, in order: `script_engine`, `runtime_language`, `runtime_frontend`,
     `runtime_ir`, `bundle_sha256`. Line 215 says the wire `engine` block "carries exactly the
     five fields above; an extra or a missing field is refused". Both halves of the codec and
     `tests/fixtures/pine_runtime/codec_parity.json` encode that, and HP-6 compares the bundle's
     identity with the web pod's. So adding a sixth field is a W5 codec change, a codec-parity
     regeneration, an HP-6 change and a web-pod reader change in `runtime_server_lane` (W5-T16
     builds the identity from `read_script_engine_version` plus the declared constants). T2's
     ownership line, "one field ... at whichever module W5-T1/W5-T4 define it", does not cover any
     of that.
   - **HP-1 says digests change only with an engine bump.** Lines 258-259: `expected-digests.json`
     "is regenerated **only** by the coordinator's engine bump (`SCRIPT_ENGINE_VERSION`) ... A
     digest change without a bump fails the gate." The identity is in every digest's preimage. A
     pin landing would therefore move every digest in the corpus, not only strategy cases, with no
     bump. Then either the deploy gate goes red, or the coordinator regenerates outside the one
     rule W5 states. That gives two authorities over "the engine changed".
   - **The server already sees pins through `bundle_sha256`.** W5-T1 inlines every JSON into the
     bundle, so `brokerPins.resolved.json` already moves `bundle_sha256`. The doc's claim that
     "the identity is the only place pins enter a cache key" is wrong for the server.

   Fix: choose one of these, written into both docs, and give it to W5's owner for the W5 side.
   - (a) **Recommended. No new field.** Derive the identity's `runtime_frontend` string as
     `RUNTIME_FRONTEND_VERSION` plus the first 12 hex digits of `BROKER_PINS_SHA256`. Derive it in
     one place, read by both halves. Amend HP-1's sentence to "regenerated only by a coordinator
     merge that changes the identity: a `SCRIPT_ENGINE_VERSION` bump or a pin-ledger change".
     T2's rail then moves the ledger and watches `runtime_frontend` and the digests move.
   - (b) Make a pin landing a coordinator `SCRIPT_ENGINE_VERSION` bump. The r1 doc rejects this
     on cost. On the train the coordinator already bumps per merge (now 17, 12 bumps since 5), so
     the cost argument is weaker than stated.

   With either option, `brokerPins.resolved.json` must be committed, not generated inside the
   Docker build, with a freshness rail against the verdict files. Otherwise the web and service
   builds can resolve different pin sets from the same commit.

B2. T14's import of `scan_evaluator._MAX_BARS` is forbidden by a standing rail.
   3.4 and T14 say "the strategy route imports `scan_evaluator._MAX_BARS`", and the rail checks
   it "by identity (`is`)".
   - `tests/test_scan_evaluator_off_request_path.py` on master (E-3) is default-deny: "Binding
     the MODULE OBJECT ... trips — unconditionally, even unused", and any named reference outside
     `_OFF_SWEEP_READS` trips.
   - T15 records that it restated the constant for exactly this reason (`screener_backtest.py:158-163`
     on T15: "The obvious move was `scan_evaluator._MAX_BARS`, and a standing rail refuses a
     router to import that module at all").
   - So the R10 fix as written either goes red on E-3, or invites someone to widen
     `_OFF_SWEEP_READS`, which is the thing that rail exists to stop.
   Fix: move the one constant to a neutral module, for example `api/services/bars_window.py`
   `HISTORY_WINDOW_BARS = 5000`. `scan_evaluator._MAX_BARS`, T15's `MAX_BARS_PER_SYMBOL` and the
   T14 route all import it. This is a W5/coordinator change made before T14. It also retires T15's
   restatement, which is the same one-authority goal R10 states. 9.6's chart-side `/api/bars?bars=5000`
   literal is the third copy; name it as a follow-up for the chart lane.

B3. Grading 70 strategies on RDDT 1D will pass vacuously for some of them.
   The coordinator's question has an answer:
   - **Bar count.** RDDT has 636 daily bars to 2026-10-02 (`history.startsAtBar0`), so about 660
     today, not about 420.
   - **Certain zero-trade scripts.** A source scan finds 3 with default date filters that close
     before RDDT listed:
     - `atr-god-strategy-by-tradesmart`: 2023-01-01 to 2023-06-24, and an 18:00-20:00 session
       filter;
     - `highlow-channel-swing`: toYear 2021;
     - `best-engulfing-ma`: 2017 to 2020.
   - **Probable few-trade scripts.** Lookbacks of 150 to 400 bars in 13 scripts. Examples:
     - `tradingview-alerts-to-mt4-mt5-forex...` and `atr-god`: 400;
     - `footprint-strategy`: 300;
     - eight scripts on SMA/EMA 200, including the long-only `golden-cross-sma-200`.
     A 200-bar warm-up leaves about 460 bars. A long-only crossover may close 0 to 3 trades.
   - **Refused on our side.** Rule 11 refuses 6 to 7 scripts by name, where barstate or `timenow`
     reaches an order: `parabolic-sar-strategy` (builtin), `machine-learning-lorentzian`,
     `tradingview-alerts...-strategy-example`, `rsi-trend-reversal`, `swing-parabolic-sar`,
     `vwap-trendfollow`, and `take-profit-multi-timeframe` (`timenow`). T2's rail grades "our
     refusal against their value" as DIVERGE, so these would show up as broker divergences.
   - **What breaks.** A 0-trade script matches TradingView's 0 trades trivially. Under T2 that is
     MATCH, and a grade that cannot fail is not a grade.

   Fix:
   - (i) T2's strategy grade reports INCONCLUSIVE "too few trades" below a stated floor, for
     example fewer than 5 closed trades on either side. Rail it with a 0-trade fixture.
   - (ii) Classify a refusal by rule 11 or by another wave's wall as EXPECTED-REFUSAL, not a
     DIVERGE in the W9 tally.
   - (iii) Add a second method-(a) symbol with more history. It needs a listing after
     TradingView's loaded depth on the rig (1,800 bars, so after about 2019-08) and fewer than
     5,000 bars, for example a 2020 listing (about 1,500 bars). The capture asserts
     `startsAtBar0` per fixture.
   - (iv) State the expected gradeable count in 5.3, not "70".

## Notes

N1. Every W4 lane in the conflict table is now merged into the train.
   The train has moved to `1b8b4616d8`. W4-T2, T7, T8, T9, T10, T11, T12, T13 (+T13S), T14, T15
   and T17 are merged, and so are W2 and E-LOWS. Batch 2's condition ("after W4-T10, T13, T15")
   is met. T1 should start from the train tip, not `00e2d0dfda`, and re-anchor F1-F12; for
   example, `case 'call'` (F8) is now at 6467. Section 6's W4 rows become "resolved by merge
   order". On the train `SCRIPT_ENGINE_VERSION` is 17, but rule 7 still says "now 5". Fix the
   number or cite master.

N2. Method (b) compares bar indexes that differ between the two sides.
   TradingView's bar 0 on SPY 1D is 2019-08-06, and ours is about 5,000 bars earlier. The
   standard set plots `bar_index`, `entry_bar_index` and `exit_bar_index`, which will differ by a
   constant offset. T2 must join method (b) rows on bar `time`, never on index. Bar identity for
   (b) is checked over [X - warm-up, Y), not the whole run window. Both apply to Q-S1-core-b and
   W9-R1i.

N3. Q-S1n is counted in "rule pins" but is labelled "fact capture, not a pin". Either move it out
   of the 50, or keep it and say why.

N4. W9-R1i rests on an unmeasured assumption.
   9.9 already says TradingView's 15-minute depth on the rig plan is unmeasured, and 5,000 bars of
   ETH 15m is far fewer sessions than the stated 192 RTH. Record the session setting in the
   fixture. Count W9-R1i as schedulable only after one depth read.

N5. "Pinned at run time, never at build" is consistent with resolving at bundle build. Say
   explicitly that a stored runtime document never embeds pin state, and that W5-T17's
   `_awaits_retranslation` (keyed on `SCRIPT_ENGINE_VERSION`) correctly does not need to fire on
   a pin change. A change-of-meaning detector that keys on something else is exactly what B1 is
   about.

SHA reviewed: a967e01a14 (doc), 646dca8cbf (master), 00e2d0dfda / 1b8b4616d8 (train).
