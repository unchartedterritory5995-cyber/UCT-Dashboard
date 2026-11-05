VERDICT: GO-WITH-NOTES @fe4f84b78c

Reviewed: docs/pine/W3W4-NEXT-BREAKDOWN.md on origin/docs/pine-w3w4-next-breakdown @fe4f84b78c.
Census: origin/docs/pine-coverage-2026-11-05 @de4371e1e9. Citations checked at 3168501f22 (ancestor of
origin/master e2027ad581; FE/PJ/CM byte-identical between the two). Read-only; no vitest/census/harness run.

Scope of the GO: D1, D3 and T0 may start now. T1 and D2 must not be dispatched until B1 / B2 are fixed
in the doc (text-only fixes).

## Counts (what reproduced)

- Appendix A, run patched to read the why file via `git show origin/master:` (see N1), reproduces every
  table in 1.1 and 1.2 exactly: 56 / 41 sole; step-0 guards 39/7/7/3 and 18/11/6/3/1/1/1; route rows
  8/3/3/2/2/2/1/1/1/1/1 (+31 combos) and 19/3/1/1/1/1/1/1 (+13 combos); why-file table rows.
- Independently recomputed (own script over coverage-map.json + coverage-targets runtimeWalls):
  1. Sole sets: 56 `[drawing-objects]`, 41 `[imperative]`.
  2. `runtimeClean` among the 41 imperative = 19; the 19 names match section 1.2 exactly.
  3. `runtimeClean` among the 56 drawing = 3 (fair-value-gap, order-blocks, auto-fibonacci-...). Track A = 19 + 3 = 22: VERIFIED.
     adx-and-di-for-v4 and inside-bar-range-mother-candle-... are in `verifiedByLane["runtime-on"].verified`: the "already MATCH runtime-on" claim holds.
  4. `runtime:conditional-history` on the 56: 1 sole (trendlinesample), 8 touches; the 8 names equal D1's measure-pair list.
  5. `runtime:no-output` on the 56: 5 touches, 2 sole (strong-start-rvol-dashboard, rth-opening-range-...); names equal D2's list.
  6. `runtime:call-undeclared-builtin-state`: 3 sole (correlation-matrix, previous-day-high-and-low-..., volume-profile-auto-line-v2), 9 touches: matches D3.
  7. The 8 "no runtime wall, attached dirty" scripts equal D5's list.
  8. Per-op rows: create:label 4, cell:text 3, guard:loop 1, guard:update 1; blocks 44/55/26/25: match.
  9. Imperative single-wall rows (RSI, williams-vix-fix, ema-92150 for cond-history; bolingger FGS; coral pine:state; flying-buddha HE; one-sided-gaussian array; price-divergence udt-method; swing-parabolic-sar strategy-call): all match.

## Blocking (scoped to the named task)

B1. "39 of the 56 dropped every op" is NOT established, and the committed evidence contradicts it for 12.
   - Code (PJ:27024-27050 @3168501f22): `refusal: hardRefusals[0] || r`, `guard = draws ? 'pine:objects-only' : 'pine:no-output'`,
     `draws = program.ops.length > 0`. So a door `pine:no-output` means ZERO SURVIVING ops, which includes ZERO ATTEMPTED ops
     (a drawing ctor the object pass never attempted), not only "dropped every op".
   - coverage-map.json carries no attempted/dropped counts, so the 39 cannot be checked from the census. The only per-op
     evidence is the screener-lane why file, which for the 39 gives: 27 all-dropped, 10 partial (some ops survive), 2 zero-attempted
     (builtin pivot-points-standard 0/0, builtin trading-sessions 0/0). correlation-matrix is 110 attempted / 0 dropped there.
   - Consequence: finding 1 and 1.1(a) ("the object program dropped every op") overclaim; T1's "refusal text changes on the 39
     `pine:no-output` drawing rows" is wrong by construction, because T1's own condition (`droppedOps === attemptedOps > 0`) keeps the old
     sentence for zero-attempt rows (at least the 2 above, both TradingView built-ins, one of them also D2's Trading Sessions).
   - Fix: reword to "39 ended with an empty object program (all dropped, or none attempted)"; T1 measure-pair = "the subset with
     attemptedOps > 0, counted by T0"; T0 must surface `attemptedOps`/`droppedOps` (already in CEN:168-169) into coverage-map.json per
     step and give the zero-attempt case its own wall (not `[drawing-objects]`). Do not dispatch T1 until fixed.

B2. Open-branch overlaps are misattributed; the W6-T3a landing branch is missing entirely.
   - Section 4.1 lists FE `:73, :1017, :1777, :2716-2922, :3111-3660, :7001-7011, :9255, :10525-11349` as W6-T3b's. Every one of those
     hunks is W6-T3a's: `git diff origin/master...origin/land/pine-w6-t3a-engine18` touches exactly that set (and bumps
     SCRIPT_ENGINE_VERSION 17 -> 18, regenerates hostParity digests). W6-T3b's OWN FE hunks (diff land/...-engine18 .. feat/...-t3b)
     are only around the typed-declaration reader (land 3730-3760, +326 lines), land 7095, 10967, 11141 and the final return (land 12292).
   - W6-T3a replaces the per-slot `collection`/`text`/`colour`/drawing-family flags with one `slots[s].ty` descriptor (land FE:1785-1816,
     "a reviewer rejects any new per-slot type flag"). D2's lowering (FE:3083-3330) reads slot kinds, so D2 must be built ON T3a's model,
     and D2 is not blocked by T3b's own hunks at all.
   - All FE citations at 3168501f22 shift once T3a lands (+3 above :73, about +42 at D1's 1905-2440, +41..+90 through 3111-11349).
   - Fix: 4.1/4.2/section 6 should read "W6-T3a (land/pine-w6-t3a-engine18) -> D2; D2 rebases onto engine 18"; drop "D2 after W6-T3b";
     tell builders to locate by symbol (`conditionalHistoryGuard`, `servedCondCall`, `builtinStateFamily`, `objectOpsLowered`, `outerSlot`)
     after T3a lands. D1/I3 adjacency is real but textual only (T3a's insert at :1777 is the slot-type getters, no condDepth semantics).

## Notes

N1. Appendix A is not reproducible from any checkout but master: it opens `docs/pine/census/w3-object-why-2026-11-02.json` from disk
    (FileNotFoundError in this handoff worktree). Read it with `git show origin/master:...` like the other two files.
N2. Finding 3 / the screener-lane why file. Judgement: table 1.1(b) (routes) and the task targets for D1/D2/D3/I1-I4 come from the census
    runtimeWalls, which IS the door's lane, so they are reliable. Table 1.1(c) and the "at most 4 host-owned" sentence are not: besides the
    `this.strict` branches the doc names (PJ:13949 session clock, 10907, 10925, 13876, all verified), the why file disagrees with the door on
    10 of the 39 no-output rows (it shows surviving ops where the door shows none) and on correlation-matrix (0 dropped). T0 must:
    (a) item 4 strict-lane translation (or retire the file) as written; (b) carry attempted/dropped per step (B1); (c) when drops are named
    on a refused step, also suppress CM:441-443's output-contract -> `[drawing-objects]` rewrite, or item 1 leaves the bucket in place;
    (d) a zero-attempt wall. Section 1.1(c) should be labelled "leads only; 10/39 rows contradict the door".
N3. T0 vs feat/pine-w9-t0-census is more than "coordinate": W9-T0 inserts 53 lines at CM:358 (shifting walls_of 376 -> ~428), edits
    `transfers_fully`, and inserts 6 lines at targets.py:43, inside T0's owned `rt_wave` 44-60. Merge W9-T0 first, then T0 by symbol.
N4. W9-T14a/T2's `ast_interpret.py:542` change is a one-line COMMENT edit (`scan_evaluator._MAX_BARS` -> `bars_window.HISTORY_WINDOW_BARS`)
    inside the REFUSALS doc block, not a REFUSALS entry. I4 need not wait for it; a trivial rebase covers it.
N5. I1 and I3 own adjacent lines in the same three refusal blocks (FE:7153-7160 history-expression then function-global-state;
    7266-7278 likewise; 6394 vs 6409-6412). 4.2 gives no I1/I3 order. Add one (I1 after D1, I3 rebases on I1, or vice versa).
N6. Capture precision, I1: RSI's `ma()` switch arms read `ta.wma` and `ta.vwma` as well as rma/sma/ema. No queued H row covers
    wma/vwma per-run windows (H1 stdev/sum/median, H2 change/mom/roc/swma, H3 atr/rsi), and arms are lowered as SELECT (H6). Either
    add an H row for wma/vwma in a block/arm or state RSI stays refused after H1-H4; I1's "3 sole" yield otherwise overstates.
N7. Capture precision, I4: the mutation "seed with 0 instead of na" presumes the seed. The v1-v3 first-bar `x[1]` seed is a vendor
    behaviour unless the reference states it; name the row now (e.g. W3N-S1, probe on AMEX:SPY 1D, Coral and Laguerre bar 0..5) and
    refuse by name until it MATCHes, rather than "needs a row" conditionally.
N8. Capture precision, D4: label text shapes that use `format.mintick` / default `str.tostring` precision depend on the symbol's mintick;
    both proposed charts tick at 0.01. Add a second symbol with a different mintick for any shape that reads it.
N9. D2 rails only assert `objectOps > 0`; that moves the runtime-on attach number with no rendered-value check. State that any table/cell or
    family rule not already pinned is withheld by name (objectStore withhold, :309), and that runtime-on attach from D2 counts only after a
    graded capture.
N10. Small citation errors: "a step with no named drop (`:443`)" is CM:431 (`:443` is the output-contract rewrite); `w3ObjectWhy.measure.test.js`
    calls `translatePine(src, {})` at :27, not :28; D5 says "Five drop no object op at all" but the why file shows six with 0 dropped
    (heat-map-seasons, supertrend-strategy, dot-dynamics, dual-supertrend-..., money-flow-index, relative-strength-index-divergences-...).

## Code references spot-checked at 3168501f22 (all hold unless noted)

FE: 1905-1916 conditionalHistoryGuard (refuses at objectsInRun && condDepth>0); 1917 topLevelHistory; 1969-1976 r4Guard objectsInRun exit;
2272 lazyArmContext; 2387/2391 SERVED_COND / ARM_ONLY_SERVED_COND; 2392-2393 servedCondCall objectsInRun exit; 1245 objectPassOwnsDrawing;
1723-1726 outerSlot; 5449-5516 builtinStateFamily (return :5513); 12176-12180 runtime:no-output exit with objectOpsLowered; 6394/7155/7268
history-expression; 6409-6412/7157-7160/7275-7278 function-global-state. PJ: 411-418 REFUSALS; 2716-2720 session-clock sentence;
13949 strict-only time(); 10907/10925/13876 strict branches; 22393 noteGuardRefusal; 23164-23170 guardOf undefined -> drop; 24164 C33
guard:partial; 27110 paintOnlyWin; 19957 textNodeOf; 21174 loopTextOf. CM: 68, 376, 413-431, 441-443, 509. CEN: 123 oneDoor, 140, 167-173.
MPD: 156-158 strict door options; 1337-1342 starter allowlist. runtimeObjectsDoor.js 59-96/76; objectStore.js 28, 36-39, 297-309;
objectPool.js:71 POOL_LIMITS; clockFns.js:109 timestamp; targets.py:44 rt_wave.

W3 S1 reuse: 5f7da680d0, 4ab4df812d, merge 619abef90c and be5fd05ea2 are all ancestors of origin/master. D4 builds in the existing
textNodeOf/loopTextOf band and pineTextFormat.js with rails beside textRefusalNames.test.js (which already rails PERCENT_CAPTURED);
D2 keeps S1's cell-text names refused. No second text reader, format table, family table or served set is proposed. Reuse: OK.

## Capture gating

Every new vendor behaviour is refused by name until pinned except as noted in N6-N9. Existing rows/probes verified on master:
capture-queue-2026-10-31-wsc-history.md rows H1-H10 (H1-H4, H9 marked as needing probes is consistent), probe vw-andor-history.pine (H7),
D1 witnesses vw-call-site-history-{rddt,spy}-1d-2026-10-01.json and vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03.json (RDDT only, so
D1 step 1 is right to check SPY coverage), capture-queue-2026-11-02-w3.md, capture-queue-2026-11-03-w4-t3.md.

## First batch (question 5)

The batch is sound in substance but should be reordered: T0 FIRST, then D1 and D3 in parallel; D2 spike only, build after W6-T3a lands
(B2), not after W6-T3b.
Why T0 first: it is S, tooling-only, the only task that touches all 39 + 8 + 9 hidden rows, it fixes the wrong-lane evidence (N2), it
supplies the attemptedOps split T1 needs (B1), and its item 5 removes the licence-held census.jsonl dependency for D3/I4/I6 spikes.
D1/D3 do not depend on it (their targets come from lane-correct runtimeWalls), so leading with T0 costs nothing. Its one constraint is
N3: land after feat/pine-w9-t0-census.
Track A (22, verified) remains the largest lever and is owner-only; nothing here changes that.

VERDICT: GO-WITH-NOTES @fe4f84b78c
