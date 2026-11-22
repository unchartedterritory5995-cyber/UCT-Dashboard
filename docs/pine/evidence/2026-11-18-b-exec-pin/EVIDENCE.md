# [B-EXEC] pinned: a strategy's backtest runs on a member's in-session chart (2026-11-18)

Branch `feat/b-exec-pin-e80`, stacked on #1896. Engine: 80 (#1899, the engine 80 train). Coordinator ruling 2026-11-18 (a).

## What a member sees

**Before:** while the newest daily bar is forming (in session), every strategy backtest is refused by name:
"The backtest is not run on this chart: it rests on a strategy rule that no comparison with TradingView has confirmed
yet." The plots are drawn. This is `runtime:strategy-unpinned`, rule [B-EXEC]. The production check found it on
supertrend-strategy RDDT 1D at 19:59Z, the day #1859 shipped.

**After:** a backtest that the closed chart serves is also served in session, as of the last closed bar. The forming
bar is not executed, which is TradingView's behaviour. The census rail of #1896 derives its expectation from the pins
production reads, and it now expects the 3 committed strategies the closed chart serves (buy-monday-exit-tuesday,
scalping-...-1-minute-only, supertrend-strategy) to be served in session too.

Nothing is taken away. The plots are the same plots, and the door rule `takesAway` still keeps the host document when
a broker document would draw less.

## The two witnesses

1. **The capture.** `supertrend-strategy-is-rddt-1d-2026-11-18`:
   - Run `qs1p-is-2026-11-18`, packet `d64e34c28819`, promoted under the corpus licence (MPL-2.0).
   - Captured 20:12:28Z with `newestBarIsForming: true`: 669 bars from the 2024-03-21 listing. TradingView ran 668
     of them (`newestBarNotRun` 1795012200, the 11-18 bar).
   - Source sha256 `7e343cf8b46c...`, the committed corpus source, the same one a member pastes.
   - Strategy Tester report ok.
   - **Grade at today's engine: MATCH at step 7.** That covers 11 trades (10 closed, 1 open) and every fill, the 9
     report slots our report states, and 7 value series bar by bar.
   - `rulesExercised` includes B-EXEC.
2. **TradingView's documented default.** From the Pine Script reference, `strategy()`, `calc_on_every_tick`: "If false,
   the strategy executes only on the closing tick of each bar". This is cited as R6 in `docs/pine/strategy-broker-spec.md`.

**Neutral, not evidence for or against.** `macd-shortlong-strategy-is-rddt-1d-2026-11-18` (same run, 20:12:53Z,
forming) grades DIVERGE at step 1, with no trade or slot compared:
- Our run refuses by name: `runtime:strategy-unsettled`, Q-S1a, "the entry `short` takes a percent-of-equity default
  size while trades are open...".
- That wall is unrelated to the forming bar, and the run exercises no rule (`rulesExercised: []`), so the row neither
  pins nor un-pins B-EXEC.
- It is the wall that keeps macd-shortlong's backtest refused on every chart.

The ledger's coded rule (`evidence_engine.resolve_pins`) has two conditions:
- every listed capture MATCHes and exercised the rule;
- every committed row that exercised the rule MATCHes.

It has no capture or family count. The pin is self-correcting: a later committed row that exercises B-EXEC and does
not MATCH un-pins it.

## Two defects found on the way, both fixed here

1. **No run could pin B-EXEC.**
   - `vm.js` asked the rule with its own pin check, outside the broker's rule ledger, so B-EXEC never reached
     `rulesUsed`. A capture pins only the rules its row says it exercised.
   - Fix: the broker asks it (`broker.js::makeBroker`, `formingBar` from the vm). It is asked once, before the first
     bar, after every bind check, which is the order the vm asked it in.
   - It is dated on the forming bar, so ruling D11 can name it the culprit of a difference on that bar, never of one
     before it.
   - The vm's copy is deleted, so there is one guard.
2. **The strategy harness dropped two bars on an in-session capture.**
   - `barsTradingViewRan` cut the forming bar, and the run was still told its newest bar was forming, so the vm left
     out a second bar. The 11-17 bar read `na` on our side: DIVERGE "Down Trend differs at 1794925800 (reference
     117.34, ours na)", on a run no member makes.
   - No committed strategy verdict was in session before these two, so nothing else moved.
   - Fix: an in-session capture is graded on the member's own run. Every bar goes in, the newest not confirmed, and the
     vm leaves the forming bar out.
   - Our point on the forming bar leaves the series only when our run computed nothing there. A value of ours there
     stays, and the grade reads it as a bar TradingView does not have (DIVERGE).

## The lock (the train's act)

`brokerPins.resolved.json` now holds 42 rules (B-EXEC added), sha256
`122439c63ea5d58d547f85ac862c562e91946f4470c9c94bffc498064df89fd3`. With this train's number N:
- append `"N": "122439c63ea5d58d547f85ac862c562e91946f4470c9c94bffc498064df89fd3"` to `brokerPins.lock.json`;
- set `COMMITTED_OLDER_DIGEST` in `brokerPinsLock.test.js` to
  `dc23d7fa765cb3856a13950db532c60bfd6e55dd6738dc3875cbbf8f691be6f8`, the digest of the older entries 17, 60, 66
  and 68.

These were computed with `brokerPinsLock.js` (`olderEntriesDigest`, `checkLock` at 80: ok). Until then,
`brokerPinsLock.test.js` "the committed ledger, lock and engine version agree" is red by design:
`ledger-changed-without-a-lock-entry`.

## A second capture, to strengthen the pin (requested)

| id | probe | symbol / tf | what to record |
|---|---|---|---|
| Q-S1p-is2 | `tools/visual_conformance/probes/w9-q-s1p-when.pine` (sha256 `cb9926f19f98...`) | NYSE:RDDT 1D, from the listing, **in session** (newest bar forming) | the Strategy Tester report (`_reportData`), every plot, and the drawn texts |

It is our own probe, a different family from the community script. On closed bars it MATCHes at step 8 (37 items, 20
texts: `w9-q-s1p-when-rddt-1d-2026-11-15`). `s1-broker-core` is not a candidate: on closed bars it refuses by name
before its first trade (DIVERGE at step 1).
