# Capture queue: Q-BSF, `realtime-state` on a FORMING newest bar (2026-11-23)

Coordinator rulings 2026-11-21 (track 1a, the forming-bar witnesses; revised the same day after the language probe).

**The rule these rows are aimed at.** `realtime-state` is served for closed-bar history only (`scope:
closed-bar-history`, `rollout_gate.PINE_CAPABILITY_FORMING_UNGRADED`). No capture grades it on a forming newest bar,
so the member door refuses it by name there. Lifting that scope takes the family rule, graded on a FORMING newest bar:
at least 2 captures of at least 2 scripts, at least 1 of them community, each MATCH with the runtime pane on.
- Our probe `vw-barstate-forming.pine` (rows a, b) carries the DIRECT discrimination. Every barstate variable is a
  column on every bar, so the newest bar's columns are a forming-bar answer in every capture.
- The community script `corpus/committed/renko-candles-overlay__d76a18d49e.pine` (rows c, d; LonesomeTheBlue,
  MPL-2.0, already in the committed corpus and already MATCH on closed bars as `realtime-state` evidence) carries
  REALISM. It reads `not barstate.ishistory and barstate.isrealtime` to count the bricks the forming bar has made
  (`unconfirmed`), and its `barstate.islast` drawing colours those bricks with the unconfirmed colour. So its newest
  bar discriminates only when the forming bar has made a brick.
- ⛔ The admission note must state that split. A community MATCH whose newest bar did not discriminate shows that
  the script draws correctly on a forming chart. It does not show that the engine reads `isconfirmed` correctly
  there: the probe shows that.
- So the evidence notes record, per community capture, whether its newest bar DISCRIMINATED: a turn on the newest
  bar, with `isconfirmed` false holding the mark off.

**The language probe (2026-11-21, both lanes, master).** Both lanes refused the first draft by name at
`barstate.isnew` (`pine:builtin`, RULING-0927: `isnew` needs per-tick evaluation). The probe no longer reads it.
Without those lines it installs clean on both lanes. The first community pick (kalman-smoothed-roc-stochastic) was refused
by both lanes (host `pine:timeout`, runtime `runtime:history-dynamic-offset`), so it could never MATCH.

**When.** Monday 2026-11-23, regular hours, the newest bar forming, at two moments, one capture each, read on one
tick:
- Moment 1, from 14:45Z: row a (the probe on SPY) and row c (renko on SPY 5 and QQQ 5).
- Moment 2, from 18:30Z: row b (the probe on QQQ) and row d (renko on IWM 5 and DIA 5).
- LAST, and dropped first if time runs short: row e.

The queue has one `insession` phase per script and chart, so a second moment takes other symbols rather than a
second phase; that gives renko four 5-minute charts, four chances that the forming bar makes a brick (on 1D almost none).
Not after the close: a fresh load then has no forming bar (RS RATING L11).

**Row e, a TradingView-only witness.** The visualizer plots `barstate.isnew`, so both lanes refuse it whole and it
grades REFUSED, never MATCH. It is captured anyway as the forming-bar evidence a future per-tick `isnew` unit needs.
It is LICENCE_HOLD (no licence header): metadata only in `corpus/reference/`, captured by the
add-the-published-script path.

**Not here: `varip`.** It stays closed-bar. Grading its updates inside a forming bar needs tick replay, which the rig
does not have.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-BSF-a | `vw-barstate-forming.pine` | AMEX:SPY 1D, AMEX:SPY 5 (extended hours OFF) | moment 1 in regular hours, the newest bar forming: F01-F05 on the newest bar (expected isconfirmed 0, isrealtime 1, islast 1, ishistory 0, islastconfirmedhistory 0; islastconfirmedhistory 1 on the bar before), F06's na on the newest bar against close on every confirmed bar, and every historical bar's columns | yes | insession |
| Q-BSF-b | `vw-barstate-forming.pine` | NASDAQ:QQQ 1D, NASDAQ:QQQ 5 (extended hours OFF) | the same questions at moment 2, about four hours after Q-BSF-a | yes | insession |
| Q-BSF-c | `corpus/committed/renko-candles-overlay__d76a18d49e.pine` | AMEX:SPY 5, NASDAQ:QQQ 5 (extended hours OFF) | moment 1, the community witness: the bricks (boxes) on the newest bar, those the forming bar has made drawn in the UNCONFIRMED colour (record whether the forming bar made a brick) | yes | insession |
| Q-BSF-d | `corpus/committed/renko-candles-overlay__d76a18d49e.pine` | AMEX:IWM 5, AMEX:DIA 5 (extended hours OFF) | the same at moment 2 | yes | insession |
| Q-BSF-e | `reference:visualizing-behaviors-of-barstate-variables__obOGTMd2LJ` | AMEX:SPY 5 (extended hours OFF) | LAST, TradingView-only: each barstate column on the newest forming bar, `isnew` included (graded refused: the evidence a per-tick `isnew` unit needs) | yes | insession |
