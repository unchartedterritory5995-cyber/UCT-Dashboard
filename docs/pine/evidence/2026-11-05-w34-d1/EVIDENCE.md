NEXT STEP (session restart): final-tip #2 on tip 54e519f4f0 is running under lock_run (log: _resume-2026-11-01/runs/w34-d1/final2.log, outdir runs/w34-d1-final). When FINAL_DONE appears run ready-check.sh; expected baseline-only failures. First final-tip failed only coverageMapDoorCensus (fixed in ef5798c4e1). Merge origin/master again if it moved, then report. Engine bump: yes (not edited).

FIX r3 (delta review GO-WITH-NOTES @e66d95c015): N1 the queue doc table now has a probe column, so capture-queue.json queues
8 targets (probes a-d x RDDT/SPY); rail tests/test_pine_w34_d1_queue_targets.py (killed by removing the column: 2 failed; control passes).
N2 rail added: a function body if/else around ta.sma builds identically gate off and gate on (kills the `owner === null` mutant; mutate.py KILLED).
N3 SUPERSEDING NOTE: every older "Engine bump: yes" line below is withdrawn; engine bump is NO for this tip (gate off = master) and
becomes YES only when DRAWING_HISTORY_CAPTURED flips. Test/queue data only, so targeted runs (w3nDrawCondHistory 27 pass, pytest 2 pass),
no new final-tip. The mutation run did not take heavy-mut.lock (one vitest file), noted for the record. Master NOT merged (coordinator merges at landing).

FINAL-TIP r2 (full, tip d4edf778b6, shared heavy-final3.lock, runs/w34-d1/final5.log): gate=0 hyg=0 js=1 totals=ok errors=0 integrity=ok.
READY-CHECK PASS (baseline-only jsfail). lookback_agreement.json was NOT rewritten this time (the earlier tree-changed run is unreproduced;
the single test leaves it unchanged on this branch and on master 768816c654). Engine bump: NO (gate off = master's output).

FIX r2 (re-review GO-WITH-NOTES):
- Whole drawing history path is now behind the one gate (drawingHistoryServed in condHistory, from DRAWING_HISTORY_CAPTURED=false or the
  test-only opts.w3nD1ServeDrawingHistory). Gate off = the drawing build is master's, including a block local's [1]: master draws the
  previous BAR's value there (B01 pins the previous RUN, so it is wrong but unchanged). Affected census scripts: NONE, so no output moves,
  no member loses a served value, engine bump: NO. With the gate on (test option) [1] is refused by name; queue row W3N-D1d decides it.
  Correction (N2): ta.change in a block was already refused on master; only [1] ever differed, and now not even that with the gate off.
- N1 probes: W3N-D1 split into four probes vw-w3n-draw-block-history-{a,b,c,d}.pine, one label per UP bar, so RDDT's 308 labels all
  survive max_labels_count=500 and warm-up is visible; doc rewritten, capture-queue.json regenerated (--check PASS).
- Mutations (runs/w34-d1/mut3.out): noop SURVIVED; gate on in product, gate ignores test option, gate removed, drop lexForeign refusal,
  admit stdev, shared ring: all KILLED. The redundant second gate copy in servedCondCall was deleted (it survived, being unreachable).
- lookback_agreement.json: lookbackAgreement.test.js writes it unconditionally; alone on branch and on master 768816c654 it leaves the file
  unchanged. See the final-tip note below for the full-suite result.

FINAL-TIP r1 (full, code tip 07e1646b81, shared heavy-final3.lock, runs/w34-d1/final4.log, outdir runs/w34-d1-final):
gate=0 hyg=0 js=1 totals=ok errors=0; jsfail = the baseline set incl. coverageAudit and usePreferences.additionsOnly.
integrity=tree-changed-during-run: tools/lookback_agreement.json was rewritten by a test in the full run (one line differs);
lookbackAgreement.test.js alone on a clean tree does NOT rewrite it, and the lane does not touch it. File restored (git checkout).
ready-check therefore FAILs on integrity only. Re-run if the coordinator wants a clean integrity line.

FIX r1 (review NO-GO @5b10b9ff6f, B1/N1/N2):
- B1: sma/ema/rma are NOT served to drawings. The machinery stays, gated off by DRAWING_HISTORY_CAPTURED = false
  (FE, beside servedCondCall); test-only opts.w3nD1ServeDrawingHistory lifts it. Product callers never set it.
  Gate off: refused by name (runtime:conditional-history). W3N-D1 queued: docs/pine/capture-queue-2026-11-05-w3w4-d1.md,
  probe tools/visual_conformance/probes/vw-w3n-draw-block-history.pine, capture-queue.json regenerated with
  tools/vendor_harness/evidence_engine.py queue (--check PASS). rt5RuntimeObjects/coverageMapDoorCensus fixtures reverted to master.
- Rails (w3nDrawCondHistory, gate off refuses; gate on with the test option holds today's values). Mutations (runs/w34-d1/mut2.out):
  noop SURVIVED; gate on in product, gate ignores test option, gate removed, drop lexForeign refusal, admit stdev, shared ring: all KILLED.
- N1: nested-block lexForeign case added to the refused list (kills the reviewer's mutant).
- N2 deviation: the spec rail "rt5 witness MATCHes through the drawing build" is not built; a block local's [1] is refused
  instead (master drew the previous BAR's value; B01 pins the previous RUN).
- measure-pair (tip vs master 51ea1acf04, base HEAD asserted before/after, runs/w34-d1/mp2): C18 audit 0 diffs, probes 0 diffs.
  Harness differs only on delta-rsi-oscillator-strategy (MATCH on tip, INCONCLUSIVE on base): the known wall-clock flake; no D1 path
  (the gate is off). Census not run. No served value changes.
- Engine bump: NO for this tip (no script output changes: sma/ema/rma refused as before, the only behaviour change is
  block-local [1] and ta.change in a block now refused by name where master drew a value; zero C18 movement). Re-decide when W3N-D1 MATCHes and the gate flips (then yes).
- Locks: this lane used per-lane lock names; from now shared dsk/heavy-final3.lock and heavy-mp3.lock.

FINAL-TIP (full, tip defa05f551, clean tree, heavy-final3 lock): log runs/w34-d1/final3.log, outdir runs/w34-d1-final.
rcs: gate=0 hyg=0 js=1 totals=ok errors=0 integrity=ok. ready-check FAIL on two non-baseline files, both not from D1:
- vendorHarness.coverageAudit delta-rsi: re-run alone still INCONCLUSIVE, and it fails identically on master (pine-dsk-mpbase3 @7f6dd3714d).
- usePreferences.additionsOnly: TodayHome.jsx (notebook, arrived via master merge) has 1 unbaselined opaque setPref site; not touched by this lane.
Other failures are the listed baseline files. master was 15 commits ahead of the tip when run; not merged per coordinator.
Served: ta.sma/ema/rma in a main-body block (C48 plot witnesses + differential); all else refused by name. Engine bump: yes (not edited).

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
