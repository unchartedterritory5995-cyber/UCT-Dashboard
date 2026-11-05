# Pine parity: progress review and next stage (desktop, 2026-11-05)

## 1. Where we are

| stream | state |
|---|---|
| W4 runtime lane | Code-complete on branches except the capture-gated T5, T6 and T17-later. Built and GO: T0, T1, T2, T3, T4, T7, T8, T9, T10, T11, T12, T13 (+spike), T14, T15, T17 probes. |
| W5 server interpreter | T1-T19 + INT built and GO (T12 already on master). Only T20 is left, which is OWNER: create the Railway service. |
| W3 drawings | S1 r3 GO (engine 8). |
| W2 arming packet | r3 GO. Arming itself is an OWNER decision. |
| E evidence engine | Offline half on master; the lows are GO. The capture queue needs the owner's rig. |
| Editor status panel (E2) | `feat/pine-editor-status` a2f137dc67: the NO-GO round-3 fix has been waiting for re-review since 11-02. |

Reviewed GO and unmerged: 37 lanes, plus 3 held since 11-03 (language scoreboard 397ecee294, W4-T1 f9b85fb442, W4-T4 311fb46c7a). **Nothing has merged since the programme started.** Master has moved 724 commits past the programme base 5d95103c8a and stays at engine 5.

## 2. What the last day taught us

1. **Review pays.** 9 of 37 lanes were NO-GO at first review, each for a real defect: the gate would have turned master red for every team, a plotcandle+plotbar crash, a "1D" vs "D" timeframe, drawing past where TradingView stops, a secrets leak, the warm-up contract, and two object-door gates with no rails. Keep independent review on every lane.
2. **Fix rounds cost more than first builds.** They had three recurring causes:
   - final-tip ran before the last code change (5 lanes);
   - a test runtime differed from CI (Node 20.18 vs 20.20; vitest rails never run under Node 20);
   - a rail the final-tip scope never ran (test_semantics_consumers.py:118).
   ready-check.sh and final-tip's refusal of dirty trees fix the first cause. The adjustments in section 3 cover the other two.
3. **Merge debt is now the biggest risk.** 40 branches are stacked on a master that moves about 250 commits a day. Every day unmerged adds refresh work, and reviewed tips go stale. Landing them one at a time, each with its own full landing run, would take about 40 heavy runs.
4. **The machine is the throughput limit.** Heavy jobs are serialized by locks, and RAM fell to 3.3 GB when five locks were held. ram_gate (6 GB) fixed that. Light work (design, review, docs) can run alongside heavy jobs without limit.
5. **Shared scratch space caused collisions.** Job scripts now live under runs/<lane>/.

## 3. Adjustments (effective now)

- **A1. Landing train, not 40 single landings.**
  - Build one integration branch, `integ/pine-train-2026-11-05`, from current master and merge all 40 lanes in dependency order.
  - Assign engine numbers on the train in merge order.
  - After each merge, run that lane's named rails. Run a full final-tip at three milestones (after W4+W3+W2, after W5, at the end), plus one C18 measure-pair against master.
  - Result: the owner approves one train and it lands as one merge, or as 2-3 batches. That means 3-4 heavy runs instead of about 40, and conflicts are solved once.
  - The train is an ordinary branch push and never touches master or production.
- **A2. CI-identical runtimes.** lane_env pins Node 20.20.2 for every vitest run. A Node mismatch counts as a failed run, not a pass.
- **A3. Final-tip scope = the lane's named files + every test file that imports a module the lane changed.** The builder lists the importers in EVIDENCE.md, and the reviewer checks the list.
- **A4. New builds start from the train tip, not from master.** This stops the "built on a stale base, then restack" cycle (W5-T5, W5-T14 and W5-T19 each needed one).
- **A5. Keep the train fresh.** When master moves more than about 150 commits, merge master into the train and re-run the named rails. Re-run the full final-tip only on conflict.
- **A6. Reviewer notes become tracked follow-ups, not lost text** (section 5).

## 4. Next stage, in order

| # | work | who / where | depends on |
|---|---|---|---|
| N1 | Landing train (A1) | 1 Opus builder, heavy locks | none: starts now |
| N2 | W6 breakdown doc: collections, UDTs, methods, enums, generics, `for...in`, laid out like W4-BREAKDOWN, with walls ranked from the census | 1 Opus, docs only | none: starts now |
| N3 | W9 strategy-tester design: broker emulator, `strategy.*` read-backs, tester report, captures needed | 1 Opus, docs only | none: starts now |
| N4 | Editor status panel round-3 delta review | 1 Opus reviewer | none: starts now |
| N5 | W0 re-measure on the train tip: census, ranked walls, coverage numbers for PLAN section 1 | heavy, after N1 | N1 |
| N6 | W6 builds (array, map, matrix, type/method/enum, for...in) from the train tip | 3-5 builders | N1, N2, N5 |
| N7 | W7.1 same-symbol higher TF (built refused-until-capture), W7.3 lower-TF arrays | 2 builders | N1, N5 |
| N8 | W9.1 broker emulator core | 1-2 builders | N3 |
| N9 | Follow-ups (section 5) | Sonnet builders | N1 |

## 5. Follow-ups from reviews (not yet assigned)

- F1: the `env` path accepts a tuple/`:=` shadow of a non-var text constant (W4-T3 review).
- F2: the runtime lane ignores `indicator(timeframe=...)`; reuse pine.js::declarationTimeframe.
- F3: in W5-T14, an admission() exception (a mistyped lane included) silently becomes "unavailable"; it should be loud.
- F4: W5-T15 should adopt scan_runtime.store_time_seconds (one authority for bar time).
- F5: RUNTIME_CANDLE_STYLE picks styles by position in OHLC_DEF_STYLES; it should select by name (W4-T13).
- F6: the W5-T4 HP-1 regex test is weak; make it assert the hp1Summary fields.
- F7: W5-T19 committed dist-server output into history; squash it on the train and gitignore `app/dist-server`.

## 6. Waiting on the owner (nothing here blocks N1-N4)

1. **Approval to merge the train to master** (production deploy). This is the one gate on landing everything.
2. W2: arm the runtime lane, stage by stage.
3. W5-T20: create the Railway `pine-runtime` service and its secrets.
4. TradingView captures on the dedicated rig. They unblock W4-T5, T6, T17-later, W3 percent, the E queue and the W7.1 pins.
5. The W5-T15 vs T14 history-length rule (500 vs 5,000 bars).
6. Who owns the Q2 sweep cap of 25 documents a night.
7. The W7.2 data contract for other symbols intraday.
