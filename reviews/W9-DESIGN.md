VERDICT: NO-GO @abe065dd80

Reviewer: independent (desktop), read-only. Doc: `docs/pine/W9-STRATEGY-DESIGN.md` on
`origin/docs/pine-w9-strategy-design` @abe065dd80. Master read at `646dca8cbf` (= origin/master
tip at review time). No vitest, census, harness, rig or heavy job was run. Light `git show`/grep and
a read-only Python scan of the 70 sources only.

Summary: the measurements and most of the code citations hold up well. Five doc-level defects
must be fixed before builders take T1, T10, T14 or the capture queue. T0, T2 and T3 (Batch 1
minus T1) are not affected and may start. The fixes are edits to the doc, not a redesign.

## What was verified (holds)

- Population (coverage-map.json @646dca8cbf, read-only): 70 strategy of 679; committed 25 /
  builtin 23 / reference 22; v6 25, v5 16, v4 20, v2 6, v1 3; clean 0, attached 14, runtime-attached
  16. `coverage-targets-2026-11-02.json` prodWaves.W9 = blocks 70 / onlyThisWave 40 / firm 12.
  Map walls: `[strategy]` 70, `strategy.position_size` 11, `position_avg_price` 3, `opentrades` 1.
  All match.
- Static scan recomputed over the 70 sources (comments stripped, `strategy(` args by paren
  matching). Match: percent_of_equity declared 19; v6 with no size 20; v1-v4 with no
  `default_qty_value` 19; union 58 (disjoint); `currency =` 8; `strategy.risk.*` 6; v5 `when =` 6;
  `strategy.order` 3; trail args 4; `strategy.exit` 25; cancel 11; pyramiding > 1 7;
  `process_orders_on_close = true` 2; `calc_on_every_tick = true` 2; `calc_on_order_fills = true`
  1; `position_size` 18; `position_avg_price` 16; `equity` 5; `netprofit` 4. Close but not equal
  (definition-dependent, fine): opentrades 7 vs 6, OCA 5 vs 3, commission_value 19 (any) vs 17
  (non-zero/input), slippage 5 (any) vs 3.
- Finding 4 reproduced on `origin/fix/pine-w0-census-peel` (masterSha 6990d63b02): exactly the six
  named strategies are `clean`; `[strategy]` bucket 53; `strategy.position_size` wall 0.
  `coverage_map.py:358` `STRATEGY_ORDERS` has 5 names vs `STRATEGY_ORDER_CALLS` 13
  (`pine.js:239-242`). Correct.
- Code citations spot-checked on origin/master (10, all real): `pine.js:239-242`
  (STRATEGY_ORDER_CALLS), `:25661-25667` (C50 host skip), `:893` NAMESPACE_GUARD strategy,
  `:256-257` + `:24947` (declaration-strategy); `FE:8728-8738` (R1 skip), `FE:1101-1105`
  (objectDoorRefuses); `runtimeColumns.js:1488`, `:1582` (objectDoor: true);
  `memberPaneDefinition.js:1699` (`runtimeHistory: 'listing'`); `scriptEngineVersion.js:88` (= 5);
  `runtimeStrategy.test.js:113-127`; `coverage_map.py:358`, `:368-373`, `targets.py:56`, `:189`;
  `screener_backtest.py:160` (MAX_BARS_PER_SYMBOL 5000, also on T15 at :163); T15 `:483`
  RUNTIME_HISTORY_LEAD 500 with the "NOT a TradingView-equal seed" sentence; T15
  `_runtime_descriptor` at :503. FE is 11,115 lines.
- Prior branches (`merge-base --is-ancestor`): c50-strategies `cf5e38d5d2` ON master;
  r1-runtime-strategy `44aa7cc9b0` ON master; s1-strategy-broker `34da5eb926` NOT on master, merge
  base `2e304db425`; T15 `8550ef036b` NOT; census-peel NOT. S1's own commit is exactly the 15 files
  the doc lists (broker.js 585, strategyBroker.js 199, rail 247, FE +117, ir +19, lowerIr +31,
  program +34, vm +48, gate 21, spec, queue, probe). Opcode collision real: S1 `BROKER: 97` /
  `case 97 /* OP.BROKER */` (S1 vm.js:794); master `OBJ_CREATE: 97, OBJ_UPDATE: 98, OBJ_DELETE: 99`
  (program.js:270). No `s1-*` harness fixture on master.
- W9.4 composition (one record, separate route, reuse T15 client/codec/admission/receipt) is the
  right shape apart from B1. T0-T3 serve nothing unpinned: T1's `pinned()` returns false until T2,
  T2/T3 are tooling only. Rule 2 (pin-before-serve) and the refusal discipline are sound.
- Capture-count arithmetic: block B 26, block C 25 (sum of the per-row column), 51 total. Correct.

## Blockers

B1. T14 introduces a second history rule beside W5-T14's 5,000 bars.
   The ruling is one history rule: W5-T14's `_MAX_BARS = 5000`
   (`api/services/screener/scan_evaluator.py:230` on `origin/feat/pine-w5-t14-scans`; T15 restates
   it as `MAX_BARS_PER_SYMBOL = 5000`, `screener_backtest.py:163`, "matches the chart lane's own
   depth `/api/bars?bars=5000`"). Section 3.4 instead makes listing-start the rule ("bars must start
   at the symbol's first stored bar", `historyFromListing: true`), bounds it by **two** caps
   ("`bars.n <= 32,768` (service cap) and ... `MAX_BARS_PER_SYMBOL = 5000`"), and refuses
   `runtime:strategy-start` for anything longer. D2 also says "We run from our first stored bar".
   Consequences: any symbol with more than 5,000 daily bars (SPY since 1993, most large caps)
   can never be backtested, server or chart; and the 32,768 figure is a different authority from
   W5-T14's. Fix: state ONE rule, by import from W5-T14's constant (not T15's restatement): a
   strategy run uses W5-T14's 5,000-bar window; `historyFromListing` is true only when that
   window reaches the listing; otherwise the run either refuses by name or serves with a stated
   start date (TradingView also starts at its first loaded bar, B-START), and Q-S1n/D2 decide which.
   Drop the 32,768 sentence. Name W5-T14 (not only T15) in T14's Depends, and say T14 must not
   add a third bar constant. The same rule must govern the chart pane (B-START, `runtimeHistory`).

B2. The SPY captures contradict the doc's own B-START and D2.
   B-START serves a broker run only from the listing, and D2 recommends grading "only where the
   capture's first bar equals ours (RDDT-style charts)". Yet all 70 grading captures (block E) are
   on `AMEX:SPY 1D`, and these pin rows are on SPY: Q-S1-core (2nd), Q-S1c, Q-S1i, Q-S1n, W9-M1
   (`SPY 1D`, `SPY 60`), W9-R1-intraday (`AMEX:SPY 15`), W9-S1 (2nd), W9-S2 (24+ months). SPY's
   TradingView window and our 5,000-bar window (B1) do not start at SPY's 1993 listing, so our side
   refuses `runtime:strategy-start` and none of these can ever grade MATCH. The 15-minute
   W9-R1-intraday row makes `max_intraday_loss` / `max_intraday_filled_orders` unpinnable as
   designed. Fix: move every pin row that is not testing B-START itself to a listing-start chart
   (RDDT 1D; for intraday, a recent listing on 15m inside our intraday depth, or defer T8's
   intraday half). Re-point block E to listing-start symbols, or make block E wait for Q-S1n and D2.
   The "2 sessions for grading" estimate is void until then.

B3. T1's FE ownership is understated, and it overlaps T10.
   T1 and the section 6 table claim FE `:8726-8750`, and say no W4 task conflicts. S1's FE commit
   (`git diff 34da5eb926~1 34da5eb926 -- pineRuntimeFrontend.js`) is 12 hunks across the file:
   - the import list;
   - `RUNTIME_REFUSALS`;
   - a `buildRuntimeIr` retry wrapper (rebuild on `pine:strategy-call`);
   - `holdsBrokerRead` / `brokerRefusal` in `buildRuntimeIrLinked`;
   - a column-planner exclusion (`!holdsBrokerRead`, wave-18 ~4994);
   - value-name lowering to `brokerCall` (~5091) and trade-function lowering (~5505);
   - statement sites (~7650, ~8081, ~9561, ~9913).
   Today's anchors for these sit in bands that open W4 branches edit:
   - W4-T12 and W4-T13: 7564-7639, 9448-10233;
   - W4-T7 and W4-T8: 8660-8683, 9976-10260;
   - W4-T15: 8856-10155.
   T1 also edits `RT/ir.js`, `RT/lowerIr.js` and `RT/vm.js`, which W4-T10 (ir/lowerIr/vm), W4-T8
   (ir/lowerIr/vm/limits) and W4-T4 (lowerIr) edit too. The conflict table names none of these, and
   T11's `RT/limits.js` overlaps W4-T8. Separately, T10 claims "FE lowering of `strategy.*` names
   ... S1's 23 values", but S1's FE hunk already lowers them (`BROKER_VALUE_NAMES` /
   `BROKER_TRADE_FNS` via `brokerCall`), so T1's verbatim port delivers them. Fix:
   - list every S1 FE site with its master anchor in T1's Owns;
   - add the W4-T4/T7/T8/T10/T12/T13/T15 overlaps to section 6 with a merge order;
   - reduce T10 to the post-S1 tail (W9-V1 values, the `pinned()` asks, text values).

B4. Block B is not schedulable as written.
   Only `s1-broker-core.pine` exists on S1. Q-S1b..Q-S1m are prose in
   `capture-queue-2026-10-05-s1.md` with no probe file, yet the table writes "as S1" and marks
   only Q-S1a NEEDS_PROBE. Several S1 rows read their answer from the "trades CSV": Q-S1h, Q-S1i
   and Q-S1l, plus Q-S1a's text. Section 5.1 bans CSV ("No CSV export ... never a fixture").
   Fix:
   - mark Q-S1b..m NEEDS_PROBE and name each probe file;
   - name the owning task (T1 or T7) that writes it;
   - for each row, state the exact plotted fields that replace the CSV, using the 5.1 three-trade
     plot set. Q-S1l needs `exit_price` at full precision plotted, not a CSV.

B5. Pins change served output, but nothing changes the engine identity.
   Rule 7 says no W9 task changes door outcomes with the gate off, and builders never bump
   `SCRIPT_ENGINE_VERSION`. T2 loads `brokerPins.json` "at build", and a pin is live when the
   latest committed verdict is MATCH. So a fixture landing, or a fixture regressing to DIVERGE,
   flips refuse/serve with no code change and no engine-version change. W5's result cache is keyed
   on `sha256(engine identity || doc_sha256 || ctx || bars || want || limits)`
   (SERVER-RUNTIME-DESIGN 3.2 on T15, line 389). The W5 host-parity digests are keyed the same way.
   Both would then serve stale refusals or stale values. Fix: fold a digest of the effective pin
   set into the engine identity (or into `RUNTIME_FRONTEND_VERSION`), with a rail that moves the
   pin set and watches the identity move. Also state who may land a pin-only change, since it
   arms behaviour.

## Notes

N1. Porting S1: cherry-pick only commit `34da5eb926` against its parent, never the branch.
   `origin/master..origin/pine/s1-strategy-broker` is 166 commits, because the branch sits on
   `integrate/wave18-2026-10-04`. A three-dot diff is 309 files / 3.38M lines. T1 should say
   "port the diff of `34da5eb926~1..34da5eb926`" in so many words. The 107-line
   `s1BrokerCensus.measure.test.js` in that commit is not in T1's port list; say port or drop.
   S1 also adds `brokerOps`/`broker` to `makeProgram` and `BROKER` to `IMPLEMENTED`; list those.

N2. T1's "opcode uniqueness" rail would repeat an existing one.
   `runtime/__tests__/runtimeHardeningP1.test.js:153-158` ("B - the opcode table encodes each
   number once") already rails this. Reuse it and mutation-prove it with BROKER = 97. Do not add a
   second rail.

N3. Wrong claim in D3: `use_bar_magnifier` appears in **no** sample script.
   Grep of `pine-sample/` and `corpus/committed/` finds 0 hits. The doc says one script sets it
   (`hull-moving-average-crossover-strategy`), and that script does not contain it. This strengthens
   the case to defer T9, but correct the sentence.

N4. Built-ins: 23 of 23 need a sizing rule by this scan, not 22.
   Breakdown: 18 v6 with no size, 3 percent, and `rob-booker-adx-breakout` (v1, no qty value).
   The doc's 22 may exclude a script whose entries all pass `qty`. Say which script and why.

N5. Strategies have been captured before; T3 should start from that path.
   `tests/fixtures/vendor/harness` already holds 10 strategy captures from 2026-10-02:
   - supertrend, delta-rsi, macd-shortlong and keltner, each on RDDT and SPY;
   - the two R1 probes.
   Their study ids are `StrategyScript$USER;...`, so a working strategy-load path already exists.
   T3 should find out how those were taken before it builds a `Create new > Strategy` branch. The
   two RDDT R1 fixtures already show `history.startsAtBar0: true` (636 bars from the 2024-03-21
   listing), which is useful evidence for B-START.

N6. T13 (L) should split.
   - T13a: `RT/brokerReport.js` metrics, Opus, M. Pure functions plus one discriminating fixture
     per metric.
   - T13b: the panel UI, Sonnet, M. Three tabs, refusal sentences, Properties tab.
   The halves have different models, rails, gates and reviewers. Today T13 bundles about 30
   metrics, two models and per-metric pins in one PR.

N7. T14 also edits files that W5 lanes own.
   T14 edits `api/services/pine_runtime_codec.py`, which is not on master; it arrives with W5-T11
   (in T15's stack), alongside "W5 service files". W5-T1 (server bundle) and W5-T19 (gate) both
   touch `runtimeColumns.js`, which T11 owns. Name W5-T11, W5-T14 and W5-T19 in the section 6
   conflict table.

N8. Rename capture row "W9-T1" (marker presentation).
   It collides with task T1 in a doc where "T1" is everywhere, for example "pinned by W9-T1 before
   it ships". Use W9-MK1.

N9. B-START should be enforced in the broker, not only through the pane option.
   `memberPaneDefinition.js:1699` sets `runtimeHistory: 'listing'` only when `!routed`. The broker
   must check its start itself, as `runtime:strategy-start`, so that a routed document, the server
   (T14) and tests all meet the same rule.

N10. Risks the doc misses:
   a. Pyramiding defaults. Only 18 of 70 declare `pyramiding`, so 52 run on the default. B-PYR
      treats "0 and 1 both allow one entry" as text-settled, and no capture row isolates it per
      version (Q-S1b reads capital and margin only; Q-S1g sets `pyramiding = 1` explicitly). Add
      to Q-S1b: no `pyramiding`, two same-direction entries, v4/v5/v6. Also pin that `strategy.order`
      ignores pyramiding (W9-X4 covers that), and that an opposite `strategy.entry` reverses
      regardless of pyramiding.
   b. `process_orders_on_close` interactions. T6 rails only same-close against next-open. Pin
      these too:
      - an exit bracket placed on the POC bar: does it become live at that close or at the next
        open?
      - `position_size` read on the same bar after a close fill;
      - commission and slippage at the close price;
      - POC with `calc_on_order_fills` (the order of re-run and close fill);
      - POC with pyramiding.
      W9-P1 should carry a bracket and a pyramided add, not just market and `strategy.close`.
   c. Repainting and history-dependent inputs:
      - the 8 strategies with `request.security` (W7) fill on whatever the request returns, so a
        lookahead or repainting series gives non-reproducible trades. Refuse broker mode by name
        for `lookahead_on` / non-confirmed requests until W7 rules on them;
      - `timenow`, `barstate.isrealtime` and `barstate.islast` branches that place orders differ
        between a capture and a later run;
      - `varip` in strategies.
   d. Bars identity before rule grading. A trade DIVERGE caused by different OHLC is not a broker
      rule. T2's strategy grade must first require bar identity to the tick over the run. It must
      also record and match TradingView's dividend/split adjustment and session (RTH/ETH) settings.
      Today 5.1's Properties read-back lists none of these.
   e. Stability of the record as bars append. The last open trade, open P&L and equity change on
      every confirmed bar. The record should be stamped with its newest confirmed bar, and
      T12/T13 should show that stamp, so a member's TradingView comparison is like for like.
   f. Count rows that cannot run now. Q-S1i (deferred), W9-M1 (deferred plus plan-gated, D4) and
      W9-J1 (0 captures) are all in the "51 batchable". Say 47 schedulable now.

N11. Minor citation drift. "`coverage_map.py:367-373`" is `transfers_fully` at :368-373. Harmless.

SHA reviewed: abe065dd80 (doc) / 646dca8cbf (master).
