# HTF-NEWEST-NARROW: on a newest bar a weekly or monthly read cannot know, withhold only what reads it there (2026-11-19, engine 84)

Coordinator ruling (2026-11-19): build the narrow-the-withhold half of the HTF-forming design now. It fixes WRONG
refusals: the host lane blanked `x[1]` where it reads a settled value, and the runtime lane blanked every plot,
including plots that never read the request. The look-ahead-on forming serve waits for Q-HTF-FORM
(`docs/pine/capture-queue-2026-11-19-htf-forming.md`). Branch `feat/pine-htf-newest-narrow`, stacked on #1985
(REQ-B1, whose harness rule it narrows), on master engine 82.

## 1. What was wrong (measured before the change)

- **Host lane.** `interpret.js::tfMergeMask` withheld the newest bar for a plot's WHOLE tree whenever a `tf_merge` in
  it could not know that bar (a finished bar inside its week or month). A throwaway probe (hand-built
  `tf_merge('W', close)` over twelve weekdays ending Tuesday 2026-11-17, not forming) read x = 10, 10, NaN and
  x[1] = 5, 10, NaN on the last three bars. x[1] on the newest bar is x on Monday 11-16, 10, which is settled.
- **Runtime lane.** `runtimeColumns.js` (RS RATING L5) set the newest bar to NaN on EVERY column of the run, and
  withheld every drawing, when any request site's newest read was withheld. SR-MTF graded on the runtime lane forced
  (#1985) lost its daily and weekly plots on the newest bar of a Friday because its MONTHLY read could not know it.

## 2. What was built

1. **Host** (`interpret.js::tfMergeMask`, `newestReadsMerge`): which root bars read the unknown merge is engine 56's
   dependency walk (`witnessMask`), every `tf_merge` a site unknown on its newest bar only. The walk now asks a site
   before treating a nested-read node as unknown on every bar; that is the only change to it, and every earlier
   caller's sites are calls, so their answers are unchanged. So `x[k]` moves the unknown k bars later and `x[1]`
   draws; `nz(x)`, `na(x) ? x[1] : x`, a window (`sma(x, 3)`) or a running value (`cum(x)`) over x read x on that bar
   and stay withheld. ⛔ A merge under another request keeps the whole-tree rule. The code is named only for a tree
   that withholds. The Python twin (`ast_interpret.py::tf_merge_mask`, `_newest_reads_merge`, `_witness_mask`)
   moves with it.
2. **Runtime.** Each request site carries `newestReach` (`strategyTaint.js::requestNewestReachOf`), and
   `runtimeColumns.js::requestNewestHeldOf` blanks the union of the withheld sites' reach. It names those plot keys
   (`RUNTIME_REQUEST_WITHHELD_KEY` gains `keys`; `null` means every column).
   - **The reach** is the host lane's own same-bar taint (`strategyTaintSinks`), seeded by the site's call on its
     source line. Its new `cutHistory` option skips a scalar's `x[k]` with k >= 1, which an earlier bar committed.
     It never skips a name that may hold a reference (a collection's first argument, a name with a member, a name
     assigned from `array.*` / `matrix.*` / `map.*` / `.new` / `.copy`): one bar back that is the same object.
   - **Matching** is `strategyDisarmOf`, unchanged.
   - **The whole-bar rule stays** when the request reaches a `fill` / `hline` / `alert` or a drawing, when an output
     is unplaced, when the site's call is not found on its line, or when the trace throws or does not settle in 64
     rounds.
   - The strategy taint itself is unchanged: its defaults are the old behaviour.
   - `requestSupply.js` names WHICH sites are withheld (`newestWithheldSites`). `lowerIr.js` carries `newestReach`
     to the program.
3. **Consumers.** `headlessCompute.js` and the vendor harness (`ourSide.js`, #1985's rule) mark only the named keys.
   The SR-MTF forced rail now expects the two monthly plots withheld on the newest bar, and the daily and weekly
   plots compared there.

What a member sees change: only the newest bar, only from withheld to drawn, and only for a value that does not read
the unknown request value on that bar.

## 3. Rails and mutation proofs

- `engine/ast/htfNewestNarrow.test.js` (host):
  - x, nz(x, 0), na(x) ? x[1] : x, sma(x, 3) and cum(x) withheld; x[1] = 10, x[2] = 10, close = 12,
    x[1] + close = 22;
  - the code is named for x, not for x[1];
  - a merge under a merge keeps the rule, with a control that the bar before is drawn;
  - CONTROLS: a forming newest bar and a Friday draw every shape.
- `tests/test_pine_htf_newest_narrow.py`: the same, in the Python lane.
- `runtime/__tests__/requestNewestNarrow.test.js` (runtime, a finished Thursday, `w` a weekly request):
  - withheld: w, nz(w), na(w) ? w[1] : w, a `var` total of w, y set inside `if w > close`, an array fed w;
  - drawn: w[1] (equal to w on the bar before), close, the total's [1];
  - the run names exactly the withheld keys; a drawing fed w keeps the whole-bar rule;
  - CONTROL: the Friday withholds nothing;
  - the taint directly: r[1] cut, a reference's a[1] never cut, and without the cut (the strategy taint) r[1]
    reached;
  - the unseeded and unplaced refusals; `requestNewestHeldOf`'s whole-bar fallbacks.
- `vendorHarness.reqBareSecurityForced.test.js` (#1985's rail, narrowed): on RDDT and SPY 1D 2026-10-02, the two
  monthly plots are withheld on the newest bar and the other four are compared there, all six MATCH.

Mutants (`runs/mutants-manifest.json`, `uct.ci-mutants/v1`, run by pine heavy's mutant job):
- N1 the whole-tree rule (host);
- N2 the walk treats a merge site as a nested read;
- N3 a nested merge loses the whole-tree rule;
- N4 / N5 the same two in Python;
- N6 the run blanks every column again;
- N7 no history cut;
- N8 a reference's [k] cut too;
- N9 an unseeded site served;
- N10 the supply names no withheld site.

Results: stated in the PR description.

## 4. Runs

| run | result |
|---|---|
| remote lane, `c173f91c52` (run 44498372788): the 3 new rails, `vendorHarness.reqBareSecurityForced`, `runtimeRequestSupply`, `requests`, `requestHoistedHistory`, `strategyDisarmedTaint`, `w9StrategyReadInPresentation`, `objectLoss`, `engine55HtfMerge`, `tfMergeNestedMasks`, `engine56Values`, `engine57Builtins`, `interpret`, `budget`, `pendingNumbers`, `headlessCompute`, `vendorHarness.test`, `reqLookaheadAlignment`, `e55NamedGaps`; pytest `test_pine_htf_newest_narrow`, `test_engine55_tf_merge`, `test_pine_tfmerge_nested_masks`, `test_ast_budget`, `test_engine56_values`, `test_script_engine_version_gate`, `test_ast_tf_live_quarter` | 668 passed, 1 failed: the `fill` control. The runtime lane refuses that script's colour before it runs, so the control became a drawing |
| remote lane, the two new rails at the fixed head (run 44499446021) | green, 28 tests |
| full corpus, both lanes | the PR's pine heavy run (PR description) |
