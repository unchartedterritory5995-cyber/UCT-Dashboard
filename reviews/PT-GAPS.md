VERDICT: GO-WITH-NOTES @0d31b677f6

Lane PT-GAPS, first review (r0). Branch origin/feat/pine-pt-gaps, one commit 0d31b677f6, on merge base 33a8a2ab43
(engine 32). Reviewer: independent desktop Opus, 2026-11-07. I used two detached worktrees, rv-ptgaps (tip) and
rv-ptgaps-base (33a8a2ab43), plus a third copy at the tip for mutations, so the measure-pair never read a mutated file.
Their node_modules junctions pointed at nbw-p2-impl/app/node_modules: pine-base had lost packages, and my first run there
failed with "Cannot find module @asamuzakjp/css-color". I ran no npm command. Cleanup: each junction was unlinked with
`cmd /c rmdir`, then each worktree was removed with `git worktree remove`, no --force, on clean trees. The junction target
is intact. I edited no lane code and pushed nothing. Run outputs: _resume-2026-11-01/runs/ptgaps-review/.

## Blocking
None.

## Should fix (in this lane if cheap, otherwise next host-lane lane)

S1. A fill dropped by G-h gets a FALSE sentence. When a fill colour's block mark has no guard to carry
(`holderColourGates` returns a refusal), `resolveFillHandles` does `continue` before `ctx.carried.add(f)`.
`sayChartOnly` then tells the member "`fill` is not drawn: its two edges are not both plots this door carries".
In my probe both edges are carried plots: `var float s = na` / `if na(s) or s > s[1]` / `s := ta.sma(close, 3)`,
with `fill(p1, p2, color = close > s ? … : …)`. Base drew the band. The tip drops the band and gives the wrong reason.
Dropping the band is the cautious direction. But the sentence is wrong, and AGENT-RULES says "refuse by name".
None of the 808 corpus or sample scripts reaches this path, because no script's fill count moved.
Fix: give the fill a withheld record carrying the gate's own sentence, as a paint gets `pine:block`. Or make the
chart-only sentence say why. Add a rail.

S2. G-h's two refusal paths are unrailed. In my mutations, R6 (the fill refusal keeps the band) and R7 (the paint refusal
draws anyway) both SURVIVED. ptGaps.test.js has no case where the guard cannot be carried. The self-referencing guard
above reaches both paths: on the tip the paint is withheld as `pine:block`, and the fill is dropped.

## Focus items

1. Backing for each built gap. Probes ran on tip and base, on the pane lane (`strict`) and the screen lane, 37 shapes.
   - L3. Backing: Pine's `?:` is lazy (v6 capture `vw-arm-history`; v5 the existing stamp already assumes it).
     Shapes probed: v6 and v5 nested; false-arm encloser (`!a ? b : 0`); triple nesting; a v6 `and` right side;
     an `if` expression; an else-if chain; a v4 `iff`; an `offset`; a shared top-level binding read under two arms.
     Every nested gate became `encloser ? inner : 0`. The v4 iff, the offset and the shared binding are unchanged.
     The shared binding `s = b ? ta.sma… : close` is correctly NOT conjoined, because a top-level statement runs on
     every bar. Proof sketch that L3 never adds withholding: the outer arm's own gate (`a`) still stands, and a new
     inner firing needs either `a` to run after a skip (the outer fires) or the old inner gate to fire. So L3 only
     removes over-withholding. Not wider than the capture.
   - L4. Backing: `interpret.js::PINE_TERNARY` witnesses (rt1-na-test-v4/v5/v6): `bool b = na` with `b ? 1 : 2` gives 2;
     `cross(close, warm)` in warm-up takes the false arm. Combined with laziness, the true arm does not run on an `na`
     bar. The guard is evaluated with the plot's own options, so the `na` rule applies only from the listing, in a
     document declaring `meta.naConditionFalse`. Shapes that moved:
       - `up[1] ? ta.sma…` (v5 and v6): on the listing it is now a skip at bar 0.
       - `var bool f = na`: the plot was drawn before and is refused now (skip 0, run 2). Base drew the every-bar
         `ta.ema` where TradingView's ran only after `f` was set. This was a real under-withhold, now closed.
       - crossover over a warm-up `sma`: the same refusal, found earlier.
     A false-arm call is unchanged in outcome. Comparisons, `na(m)` and v6 colour shapes are byte-identical.
     Off the listing, and on the screen lane, every column is the same as before. L4 only increases withholding, and only
     where Pine's own `na` rule says the arm skipped. Within capture.
   - L6. No output change: memo only. A capped answer is not memoised (rail plus my R12 kill).
   - G-c. `n := up and ta.rising(close, 2) ? n + 1 : 0` now carries the v6 `and` "that right side" gate. The plain
     (no-call) counter and the v5 counter are unchanged. Correct, because v5 `and` is not stamped.
   - G-h. Backing: the C48 block rule (capture vw-call-site-history), as F2 already applies it to plot colours.
     These shapes gain the block's guard on their colour rule:
       - bgcolor, both the two-colour form and the `: na` form;
       - barcolor;
       - a fill;
       - a gradient;
       - a block-local `m = ta.sma` assigned to `s`;
       - v5.
     These are unchanged:
       - `if barstate.isfirst`: its gate evaluates as never-run-after-skip, which is exact;
       - a block filled from `close` (no call);
       - `color.new(…, cond ? 0 : 50)`: already withheld `paint:colour` on both sides;
       - an arm-only colour (H1);
       - a static colour;
       - the screen lane (no paints, no blockRuns).
     A withheld paint or fill draws nothing. That is the safe direction (AGENT-RULES: never draw where unproved).
   - G-d. Disclosure only: the info row keeps the value and reads the condition column's refusal under
     `colorMode: column:<key>`. The text "drawn in the series colour" matches `binder.pointColour` → null.
     The legend's study stack still does not show it, as the gap row says.

2. Classification. I agree with every row. Nothing marked (c) is a member-visible wrong value: G-g and G-e only
   over-withhold or are covered by the window's own rule, and L5/G-a are closed by merged work. Nothing marked (a)
   needs a new capture: L3, L4, G-c and G-h each compose rules that are already captured, as above. G-f and G-i are
   correctly (b): they move the object door, which needs a drawing capture (Q-PT6, Q-PT7 rows are well formed).
   One note on G-h: a paint or fill colour withheld at bind time has no member-facing sentence. That is the same as H1's
   arm-gated paints today, but now covers more shapes (N2).

3. What changes at the door and in host output. I ran measure-pair.sh, tip against base at 33a8a2ab43, census 0, on
   Node 20.20.2:
   - runtime 1: C18 corpus audit 395/395 rows, 0 non-timing diffs (only `ms`). C18 constructed probes byte-identical.
     Harness TOTAL 336: MATCH 112, DIVERGE 107, INCONCLUSIVE 117, the same on both sides, and no harness file differs.
   - runtime 0: the same result, with harness MATCH 93, DIVERGE 103, INCONCLUSIVE 140 on both sides.
   - Base cache filled: 33a8a2ab438c-rt1-cen0-… and -rt0-cen0-….
   Translation sweep: 808 scripts (corpus/committed 266, oos 30, blind 48, community 30, curated 21, pine-sample 413),
   pane and screen lanes, diffing outputs, gates, colour gates, paint codes and fill counts. Three movers, all on the pane
   lane:
     - committed/liquidity-pools: gate `isconfirmed` → `isconfirmed ? 1 : 0` (L4). Same column on every bar, because
       isconfirmed is never `na`; `neverNaTree` is conservative here.
     - sample flying-buddha-inside-bars (v3) and sample qqe-mod-ssl-hybrid-waddah (v5): the `barcolor` paint goes from
       ok to `pine:block` (G-h refusal path). In both, the plot lane already refuses the outputs that read the same
       block (`pine:block`), and both scripts are ok:false on both sides. Consistent with one rule. Intended.
   Screen lane: 0 movers. hostParity --check on Node 24.13.1: HP-1 GREEN 166/166, no digest moved. Expected: the runtime
   bundle does not import ast/pine.js, and the branch touches no runtime/ or services/ file.
   Service suite: tests 139, pass 139, fail 0.

4. Runtime/host agreement. Targeted, 9 files, 187 passed + 1 skipped, identical on tip and base: postfixMember,
   pine.armRuns, paramIds, blockRunsParity, vendorHarness.c45ArmRuns, vendorHarness.c48CallSite, infoValuesPersistence,
   p1.info.truth, p2.ui.truth. No new runtime/host disagreement: the runtime lane has no stamps. L4 makes the host guard
   read `na` as the host plot does; the runtime VM already does this per bar.

5. My mutations. Method: mutate.py on a separate tip copy, run ptGaps.test.js, restore bytes and check equal.
   - R1, L3 context kept through `offset`: KILLED.
   - R2, L3 context kept through a `multiState` call: SURVIVED. Unrailed. This direction would under-withhold (N3).
   - R3, a v6 `or` right side using the left's yes-guard: KILLED.
   - R4, the encloser written as `&&` instead of `?:`: KILLED.
   - R5, L4 wrapping never-`na` tests too: KILLED.
   - R6, the fill refusal keeps the band: SURVIVED (S2).
   - R7, the paint refusal draws anyway: SURVIVED (S2).
   - R8, `condGateNotesOnly` ignored: SURVIVED. It was also equivalent on all 37 probe shapes, including
     `if barstate.isfirst`. No distinguishing shape found (N4).
   - R9, hostLane check dropped in resolvePaints: SURVIVED. Equivalent, because the screen lane has no paints by
     construction.
   - R10, G-d's sentence dropped on the unknown-value path: SURVIVED (N5).
   - R11, copyKeepingArmRuns depth cap 2: KILLED.
   - R12, L6 memo ignoring the roster: KILLED.
   The builder's rails: 19 tests, 14 red on base (ptGaps.test.js copied in), and the 5 controls green on both sides.
   This matches EVIDENCE.

6. Merge: `git merge-tree --write-tree origin/master(911eb4b215) 0d31b677f6` is clean (rc 0). Master is 6 commits past
   the base (W9-T14 strategyScorecard, memobs, docs), with no shared files.

7. A measure-pair is REQUIRED, on both lanes, with census 1 (host lane, member-visible). EVIDENCE says it was not run
   ("light phase only"). I ran it with census 0, and it shows 0 C18 diffs (audit and probes) and 0 harness diffs on both
   runtimes, so expect the same from the coordinator's run. Census: from my sweep, at most the two pine-sample paint
   withholds (flying-buddha, qqe-mod). Neither changes a script's ok state, so I expect no transfer-count movement.
   Engine bump: YES. Translation output changes: gate trees for L3, L4 and G-c, and colour gates and paint withholds for
   G-h. Saved documents gain the new stamps only when re-translated. The coordinator bumps at merge.

## Notes (non-blocking)
N1 EVIDENCE "Not done" should state that measure-pair and final-tip are owed. It does say so. The coordinator must run
   final-tip on the merged tip.
N2 G-h widens bind-time paint and fill colour withholding, which has no member sentence (G-d covers plot info rows only).
   Worth a follow-up row next to G-d.
N3 Add a rail that a nested arm inside a `multiState` call (`accumK`) drops the enclosing context (R2 survivor).
N4 `condGateNotesOnly` has no rail and no shape I found distinguishes it. Either add the one-run-block case it exists for,
   or say it is defensive.
N5 Rail G-d's sentence on the UNKNOWN-value path too (R10 survivor).
N6 `neverNaTree` treats `barstate.isconfirmed` as possibly `na` (liquidity-pools). The result is harmless, but the gate
   text changes in a committed corpus script.

VERDICT: GO-WITH-NOTES @0d31b677f6
