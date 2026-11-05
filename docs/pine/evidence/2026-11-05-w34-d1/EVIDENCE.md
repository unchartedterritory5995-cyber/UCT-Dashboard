# W3W4-D1 evidence: per-call-site history for drawings (lane w34-d1)

Branch feat/pine-w34-d1-drawing-history, base origin/master c855e8cadf (engine 18, W6-T3a already in).

## Step 1: witness coverage
- C48 vw-call-site-history-{rddt,spy}-1d-2026-10-01 pins per-run sma/ema (C03/C04, D02) as PLOT values,
  and a block local's [1] is pinned by vw-rt5-arm-draw-block-history B01 (previous RUN).
- No committed capture holds a drawing whose y reads the served set over many runs. So the plot witnesses
  grade the drawing's y (the label y is the same call-site value), and a differential against the plot lane on
  bars the block skips is the second rail. No new capture queued; nothing beyond the pinned set is served.

## Served (drawing build, main-body block only)
- ta.sma / ta.ema / ta.rma in a block that runs on some bars: the SAME servedCondCall (SERVED_COND), one table.
- Composite around a served call is lowered piece by piece (condTransparent), as on the plot lane.

## Refused by name (runtime:conditional-history)
ta.stdev, ta.highest, ta.change in a block (arm-only change is not reachable under objectsInRun), a block local's
[1], loop bodies, function bodies. Any other block history the lexical test flags is now refused by name instead of
read from the every-bar column. FOUND: `bx = bar_index` then `bx[1]` in an `if` drew the PREVIOUS BAR's index on
master (a silent wrong value; the rt5 B01 witness says previous RUN). Now refused.
Unchanged: never draws where the block does not run; objectPool limits and C37 colours untouched.

## Rails
- runtime/__tests__/w3nDrawCondHistory.test.js (17 cases): vendor-graded RDDT+SPY (SPY graded after warm-up since
  its capture does not start at bar 0), differential vs plot lane, two sites keep two rings, refusals + control.
- rt5RuntimeObjects.test.js: the sma refusal case now uses ta.stdev (sma served).
- Mutations (mutate.py, lock heavy-mut-w34-d1): noop control SURVIVED (as required); shared ring across sites,
  block fallthrough without refusal, admit stdev, drop objects gate, serve nothing: all KILLED.
  Log: runs/w34-d1/mut.out.

## measure-pair (base c855e8cadf in pine-dsk-mpbase3, HEAD asserted before/after; runtime-on 1, census 0)
C18 corpus audit: 0 verdict diffs (timing field excluded). C18 probes: 0 diffs. Vendor harness runtime-on:
336 captures, MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 both sides, summary and verdicts identical.
Census not run (needs licence sample); the expected trendlinesample first-wall move is therefore unconfirmed here.

## Engine bump: yes (runtime-on drawing output changes for the served shapes). SCRIPT_ENGINE_VERSION not edited.
Moving scripts: none in C18.
