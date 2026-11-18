# Lane 2 (B0 + NA): first-bar and `na`-seed gaps on from-listing captures

Branch `fix/pine-b0-na-seed`. Review: GO-WITH-NOTES at 75e31e46af (`dsk/reviews/LANE2.md`); r1 addresses N1, A3 and the census timeout.

## Rules served (each witnessed by a committed from-listing capture)
1. An unmarked `na` seed (`0/0`) is a history seed: from the listing, bar 0 runs the update
   (`interpret.js::historySeedReading`). It applies only where bar 0's history is pinned (v3+).
   v1/v2 keep every base candidate (`opts.listingSeedUnpinned`).
   Witnesses: vw-ratchet-stops R03, optimized-keltner, twin-range, vw-bar-origin-rddt-60 O05.
2. `x = na(x[k]) ? na : U` with a BARE `x[k]` read in the test is the constant `na` on v3+
   (`pine.js::naSeededSelfReference`). On v1/v2 it is not rewritten.
3. `ta.wma`'s warm-up counts finite observations (host `rolling`, Python twin, runtime `vm.js`).
   Witness: trend-targets-algoalpha RDDT Baseline.

## Engine bump
REQUIRED at landing. Served values change (bar 0 of na-seeded state from the listing; wma over
gapped sources), and translator output changes for `x = na(x[k]) ? na : U` on v3+.
`SCRIPT_ENGINE_VERSION` was not edited on this branch.

## Filed for a future lane (no code here)
`ta.hma` propagates `na` over a gapped source (lane 2 review finding), although its reference
sentence is the same as `ta.wma`'s, and `ta.wma` now answers there under the finite-count forward-fill
rule. This lane did not change hma, and no capture witnesses hma over a gap. Next step: an original
probe (hma over a source finite on bar 0, then a gap, from the listing), queued before any code.

## Logs
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/lane2/` (mp1, mp2, hp*.log, suite-engine.log, vh.log, mut*.py).
