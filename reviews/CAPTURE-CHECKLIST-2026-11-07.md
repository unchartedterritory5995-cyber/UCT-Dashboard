# TradingView capture checklist for the owner (compiled 2026-11-07, docs only)

The owner does every capture by hand on the rig (`.worktrees/canary-chrome-profile-persistent`). Agents never sign in or run the rig (OWNER-ACTIONS.md:4).
Sources are read from `origin/master` unless a branch is named. `W6-BD` = `origin/docs/pine-w6-breakdown:docs/pine/W6-BREAKDOWN.md`; `W9-SD` = `origin/docs/pine-w9-strategy-design:docs/pine/W9-STRATEGY-DESIGN.md`; `cq-` = `docs/pine/capture-queue-`.
"Probe" paths are under `tools/visual_conformance/probes/`. Existence was checked with `git ls-tree origin/master` on 2026-11-07.
Machine queue: `docs/pine/vendor-harness/capture-queue.json`. It was derived 2026-11-05 at master `3ca4b0d358`, so it does NOT include the 11-06 docs (w6, w6-t6, w34-i4, w34-i6c). Its counts: 177 targets; 84 QUEUED, 75 CAPTURED, 13 NEEDS_CHART, 5 NEEDS_LIVE; **131 rows NEEDING a probe** (8 of them live).
Standing settings for every W9 row: values come from the chart model only, settings live in the source, the market is closed, and the plan is recorded (W9-SD:779-818). "Method (a)" = `NYSE:RDDT 1D` from the 2024-03-21 listing.
Effort: S = 1 capture, about 5 min; M = 2-5 captures; L = more than 5.

## 1. Top table, sorted by unblock value

| # | capture id | unblocks (lane / task; engine or served change?) | probe | symbol / tf / settings | effort | source |
|---|---|---|---|---|---|---|
| 1 | **W9-C0** (spike, read-only key walk `__uctVH._strategyKeys()`) | W9-T3a report reader, which unblocks W9-S1, W9-S2 and every report field in block E grading. Tooling, then served metrics (T13a) | `r1-strategy-draws.pine` (exists) | NYSE:RDDT 1D, 1 session | S | cq-2026-11-05-w9.md:25; W9-SD:829 |
| 2 | **Q-S1-core** (+ W9-J1 and W9-S1 ride on it, 0 extra captures) | W9-T1: the broker rules B-FILL..B-VAL are pinned before they are served (D1). Also W9-T6 defaults (J1) and T13a (S1). **Engine/served**: the broker serves backtests | `s1-broker-core.pine` (exists) | (a) RDDT 1D, rows N02-N14 | S | cq-…-w9.md:31,80,82; W9-SD:829-833 |
| 3 | **Q-S1-core-b** | W9-T1; proves method (b), which every SPY grading variant needs | `s1-broker-core-range.pine` (exists) | AMEX:SPY 1D, X=2023-01-03, Y=2025-01-02, joined on time | S | cq-…-w9.md:32; W9-SD:800-805 |
| 4 | **Q-S1a** ×5, **Q-S1b** ×3, **W9-D1** ×2, **W9-D2** | W9-T4 sizing, capital, margin, currency (served broker defaults); T1 reversal | all exist (e.g. `w9-q-s1a-size-v4.pine`, `w9-d2-currency.pine`) | (a) RDDT 1D | L (11) | cq-…-w9.md:33-34,58-59; W9-SD:631 |
| 5 | **Q-S1n** (fact, never graded MATCH) | the SPY window for every grading variant (`range_guard.py window`), the D2 sentence, and the W9-T11 survivors M3-M5 (reviews/W9-T11.md:87) | `s1-broker-core.pine` (exists) | AMEX:SPY 1D at two loaded depths | M (2) | cq-…-w9.md:52,93-96 |
| 6 | **W6-A1** | W6-T5 `array.*`: median/stdev/variance/sort/percentile now stop by name (reviews/W6-T5.md:7,24). **Engine bump** | `vw-w6-array-members.pine` (exists) | AMEX:SPY 1D, rows S/T/P/Z/R/J/M/N/U/E/V/Q/L/H/I | S | cq-2026-11-06-w6.md:60; W6-BD:663 |
| 7 | **Q-A1** | W6-T11, the v6 per-pass `for` bound. The first wall moves on `support-resistance-mtf-flux-charts` and `support-and-resistance-zones-feels`. **Engine bump** | `vw-v6-for-bound.pine` (exists, never captured) | AMEX:SPY 1D, rows L02-L06 | S | cq-2026-10-31-wsa-for-bound.md:29; W6-BD:547-564,666 |
| 8 | **vw-w4-session-default-days** + **vw-w4-session-overnight** (W4-T3a/T3b) | queue priority 1, firm `atr-trailing-stop-by-ceyhun`, upper bound 82 scripts. Lifts the `pine:function` session refusals. Engine | both exist | BITSTAMP:BTCUSD 60 | M (2) | cq-2026-11-03-w4-t3.md:19-20; capture-queue.json targets |
| 9 | **W4-A1..A4** (`vw-w4-arm-runs`) | `runtime:conditional-history`: `ta.change(x,n)`, `rma`, nested `?:`, carried built-ins in an arm. Upper bound 69. Engine | `vw-w4-arm-runs.pine` (exists) | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | M (2) | cq-2026-11-03-w4-t4.md:28-31 |
| 10 | **W6-K1** | W6-T8 `map.*`: order and missing-key rules, plus a v6 bool missing-key ASK row N05 (reviews/W6-T8.md:67). Engine | `vw-w6-map.pine` (exists) | AMEX:SPY 1D; K01-K10, then N01-N04 one at a time | M | cq-2026-11-06-w6.md:42; W6-BD:668 |
| 11 | **W6-M1** | W6-T7 `matrix.*`: every `(W6-M1)` refusal (reviews/W6-T7.md:12,33,67). Engine | `vw-w6-matrix-members.pine` (exists). W6-BD:667 names `vw-w6-matrix.pine`, which does not exist; the queue doc's name wins | AMEX:SPY 1D; then E01-E08 one at a time | M | cq-2026-11-06-w6.md:86 |
| 12 | **W6-U1** | W6-T9 receivers: overloads refused as W6-U1 (reviews/W6-T9.md:159,205). Engine | `vw-w6-receivers.pine` (exists) | AMEX:SPY 1D, U01-U09 | S | cq-2026-11-06-w6.md:97; W6-BD:669 |
| 13 | **Q-W19R2a / Q-W19R2b** | W6-T5: `insert`/`fill` edges and the three binary searches. Engine | `vw-w19r2-collections.pine` (exists) | NYSE:RDDT 1D from the listing | S (one probe) | cq-2026-11-06-w6.md:48,54; W6-BD:661-662 |
| 14 | **W9-K1..K4**, **W9-P1, P1b, P2, P3** | W9-T5 costs; W9-T6 fill timing. Served broker | exist (`w9-k1-commission-pct.pine`, `w9-p1-on-close.pine`, …) | (a) RDDT 1D | L (8) | cq-…-w9.md:60-67 |
| 15 | **W9-X1..X4**, **Q-S1d,f,g,h,j,k**, **Q-S1c,e,l,p** | W9-T7 exits/order kinds; T1 tie, live-past, off-grid, `when`. Served broker | exist (W9 T3b probes) | (a) RDDT 1D | L (15) | cq-…-w9.md:35-46,68-71 |
| 16 | **W9-R1** ×2, **W9-V1**, **W9-MK1**, **W9-S2** ×2, **Q-S1m** | W9-T8 risk; T10 read-back tail; T12 markers; T13a Sharpe/Sortino (S2 waits on the reader, row 1) | exist | (a) RDDT 1D | L (7) | cq-…-w9.md:45,72,75-79 |
| 17 | **W4-S1-v4** (+ inherited **W4-S1**) | W34-I6c: `zigzag-multi-time-frame-with-fibonacci-retracement` stays refused at the member door until it MATCHes (reviews/W34-I6c.md:89-93) | **needs probe**: neither `vw-w4-series-length-v4.pine` nor `vw-w4-series-length.pine` is on master (text is in the doc) | AMEX:SPY 1D, NYSE:RDDT 1D | S-M | cq-2026-11-06-w34-i6c.md:17-18 |
| 18 | **W34-I4-S1** | W34-I4b: a v1/v2 bare self-read seed (`thelark-lma-v2-laguerre`) (reviews/W34-I4b.md:51) | `vw-w34-i4-v2-selfref-seed.pine` (exists) | AMEX:SPY 1D from the listing | S | cq-2026-11-06-w34-i4.md:13 |
| 19 | **W3W4-D3** (correlation with `na`; no row id in the doc) | runtime `correlation` refusal; `correlation-matrix`. Builder fix + engine | **needs probe**: inline Pine only (`UCTPROBE_CORR_NA`), no file | AMEX:SPY 1D, regular session, full history; repeat `z_v` with length 20 | S | cq-2026-11-05-w34-d3.md:1-24 |
| 20 | **W3N-D1a..d** | a drawing's y over a per-run sma/ema/rma, and a block local's `[1]` (d decides a refusal) | `vw-w3n-draw-block-history-{a..d}.pine` (exist) | unclear (the chart is not stated in the table) | M (4) | cq-2026-11-05-w3w4-d1.md:95-98 |
| 21 | **W4-D1** int/int window | `pine:window` for hull-MA, DPO, rsi-cyclic (upper bound 18) | `vw-w4-int-div-window.pine` (+`-v5`, `-v4`) exists | AMEX:SPY 1D, NYSE:RDDT 1D | M | cq-2026-11-05-w4-t15-t17.md:26 |
| 22 | **W4-T1** daymask, **W4-T2** session-param | session day-mask (upper bound 33); session text through a UDF (upper bound 20) | exist | AMEX:SPY 60 + BITSTAMP:BTCUSD 60; AMEX:SPY 5 | M (3) | cq-2026-11-03-w4-t3.md:17-18 |
| 23 | **Q-W6T6-G** (grade only, already captured) | W6-T6 host `forInRefused`. **No rig time**: it grades INCONCLUSIVE until a lane accepts the reassignment | captured fixture `vw-forin-collections-2-rddt-1d-2026-10-02` | NYSE:RDDT 1D | 0 | cq-2026-11-06-w6-t6.md:9; W6-BD:665 |
| 24 | **W6-E1** | W6-T10 enum text rules. No wall in the sample today (W6-BD:670), so low value | `vw-w6-enum.pine` (exists) | AMEX:SPY 1D | S | cq-2026-11-06-w6.md:111 |
| 25 | **W9 block E** grading (about 60 RDDT + about 11 SPY variants) | 38 strategies gradable by W9 alone. Needs rows 1-16 first | sources are unmodified corpus; SPY variants come from `range_guard.py` after Q-S1n | RDDT 1D, then SPY 1D variants | L (about 2 sessions) | W9-SD:900-963,965-979 |

Deferred, do not schedule yet: W9-M1 ×2 (D3; OWNER-ACTIONS.md:19-21; W9-SD:879), W9-R1i (after a 15-minute depth read, W9-SD:806-808,878), Q-S1i (deferred), Q-S1o and Q-S1p-live (live, cq-…-w9.md:84-89), and Renko Q-W2R1-R3 (OWNER-ACTIONS.md:32; cq-2026-11-02-w2.md:37-39).

## 2. Sessions (same symbol, timeframe and script family)

**Session A: W9 first session, RDDT 1D + SPY 1D (11 captures; W9-SD:981-988).** W9-C0, Q-S1-core, Q-S1-core-b (SPY), Q-S1a ×5, Q-S1b ×3, W9-D2. Add W9-D1 ×2 and Q-S1n ×2 (SPY 1D) if time allows.
**Session B: W9 pins, RDDT 1D (about 30).** K1-K4, P1-P3/P1b, X1-X4, Q-S1c-h, j, k, l, m, p, R1 ×2, V1, MK1, then S2 ×2 once the reader exists. At 30 s throttle and 40 per session, A + B is about 2 sessions (W9-SD:977-979).
**Session C: W6 collections, AMEX:SPY 1D, after the close (W6-BD:672-674 "about 8 captures on two charts").** W6-A1, Q-A1, W6-K1, W6-M1, W6-U1, W6-E1, plus W34-I4-S1, W3W4-D3 (once its probe is filed), W4-D1 (SPY), and W4-A arm-runs (SPY).
**Session D: RDDT 1D from the listing.** Q-W19R2a/b, W4-A arm-runs (RDDT), W4-D1 (RDDT), W4-S1/W4-S1-v4 (once filed), W6-F1 + Q-W6T6-A/H (once filed).
**Session E: intraday and crypto.** BITSTAMP:BTCUSD 60 (session default-days, overnight, daymask), AMEX:SPY 60 (daymask), AMEX:SPY 5 (session-param).
**Session F: W9 block E grading**, after A and B (about 2 sessions).

## 3. Rows still NEEDS_PROBE (no runnable file; a person must write it)

The machine count is 131 (capture-queue.json `counts.rowsNeedingProbe`, as of 11-05). Count by doc: prod-ternary 20, wsc-history 16, w1 16, w3 15, time-anchors 11, wsf-realtime 8, w4-t11 8, c45 6, w4-t13 6, wsd-input-kinds 5, 09-27 4, wse 3, w4-t15-t17 3, lower-tf 2, w4-t12 2, and l2-libraries, r1-strategy, rt1-na-test, rt3-na-logic, wsa-for-bound (Q-A3) and objcond 1 each.
Rows that block a current lane, named:

| row | lane that writes the probe | source |
|---|---|---|
| W6-F1 `vw-w6-forin-runtime.pine` (to write) | W6-T6 builder (for-in runtime). Also folds in Q-W6T6-H (review N1) | cq-2026-11-06-w6-t6.md:11-12; reviews/W6-T6.md:20,77 |
| Q-W6T6-A `vw-w6-forin-alias.pine` (to write) | W6-T6 builder | cq-2026-11-06-w6-t6.md:10 |
| W4-S1-v4 / W4-S1 (`vw-w4-series-length[-v4].pine`) | W34-I6c lane (T8 per the row) | cq-2026-11-06-w34-i6c.md:17-18 |
| W3W4-D3 correlation `na` | W3W4-D3 lane; the inline text is ready to file | cq-2026-11-05-w34-d3.md:6-20 |
| Q-W3-1..Q-W3-8 (probes are written inline in the doc, below the table, not as files) | W3 text/format lane. Q-W3-3 is THE gate for serving `percent` | cq-2026-11-02-w3.md:51-57,205 |
| W1-A..E rows (obv/pvt, barssince, iii/wvad/wad/cmo/cog, drawings, derived cmo/cog) | W1 lane | cq-2026-11-02-w1.md:13-152 |
| W4-T11-a/b/c (`str.substring`, `tonumber`/`replace`, `format_time`) | W4-T11 lane | cq-2026-11-04-w4-t11.md:16-76 |
| W4-P1 candle colours C01-C05, B01 | W4-T13 lane | cq-2026-11-04-w4-t13.md:13-40 |
| W4-T15-a/b/c (loop value, `log.*`) | W4-T15 lane | cq-2026-11-05-w4-t15-t17.md:15-17 |
| P2-F1 F01/F02 (`fill()` plot id by `?:`) | W4-T12 lane | cq-2026-11-03-w4-t12.md:5-27 |
| H1, H2, H3, H4, H9, H10 | W4 conditional-history lane | W4-BREAKDOWN.md:846 (origin/master) |
| Q-A3 (v6 `if`/`switch` value with no matching arm) | P3 WS-A lane (unclear which wave now owns it) | cq-2026-10-31-wsa-for-bound.md:36 |

Also: 13 targets are NEEDS_CHART (a probe exists but no chart is stated), e.g. `vw-int-cast` (priority 1), `vw-bool-cast`, and `vw-request-htf-alignment`. These are listed in capture-queue.json, and each doc's author lane must name a chart.

## 4. Owner DECISIONS that also block work

| decision | what it unblocks | source |
|---|---|---|
| Approve the train merge to master (production) | everything below; the re-grade of `adx-and-di-for-v4` | OWNER-ACTIONS.md:11-12 |
| **Arm stage 1**: set `PINE_RUNTIME_STAGE=admins` on `web` | the served runtime lane for admins (adx only); starts the 14-day watch. Already decided GO, after the train | OWNER-ACTIONS.md:13,24-38 |
| **Create the `pine-runtime` Railway service** (runbook section 3) | the server lanes, including W9-T14 server backtests; then the separate act `PINE_RUNTIME_SERVER_STAGE=admins` | OWNER-ACTIONS.md:40-55 |
| **Arm the broker on the service** | unclear: no separate act is named in OWNER-ACTIONS. W9-T1 is "gated and dark" (reviews/W9-T1.md:43). The serve step needs D1 + D6 below + `PINE_RUNTIME_SERVER_STAGE` | W9-SD:466; OWNER-ACTIONS.md:55 |
| W9 D1: pin before serve for the 22 text-settled rules | whether the broker serves before rows 2-16 MATCH (recommended: pin first) | W9-SD:1070 |
| W9 D2: the member sentence for a window that does not reach the listing | serving SPY-window backtests; Q-S1n feeds it | W9-SD:1071-1072 |
| W9 D3: bar-detalization data (W7.3) | W9-T9 / W9-M1 (recommended defer) | W9-SD:1073 |
| W9 D4: the rig's plan | W9-M1 eligibility. Decided "assume Premium"; the owner glances at the account menu (10 s) | W9-SD:1074; OWNER-ACTIONS.md:17-22 |
| W9 D5: the W9.4 route, plan gate, multi-symbol cost | W9.4 server/screener backtests | W9-SD:1075 |
| W9 D6: arming per W2 stage or all at once | the broker's arming path | W9-SD:1076 |
| **W9 D7: scorecard wording** (the screener ruling stays) | W9-T15 docs/ruling wording and the member-facing scorecard. **Not recorded as decided**: R12 covers D1-D3 and D5-D8 as delegated, but the wording itself is not in OWNER-ACTIONS. Confirm the text | W9-SD:1077; OWNER-ACTIONS.md:57 |
| W9 D8: show the refusal for metrics we cannot compute | T13a/T13b report panel | W9-SD:1078 |
| W9 D9: a longer `HISTORY_WINDOW_BARS` | every server lane's window (R10 fixed it at 5,000) | W9-SD:1079; OWNER-ACTIONS.md:57 |
| W9 D10: the grading floor of 5 TradingView closed trades | block E routing (set by coordinator; the owner may move it) | W9-SD:1080-1081 |
| W1-D hold for drawings (OBV level on SPY not from the listing) | lifting the drawing hold for D01-D03 | cq-2026-11-02-w1.md:99 |
| W34-I4 bump with zero attaches vs holding for the colour capture | one engine bump | reviews/W34-I4.md:34 |
