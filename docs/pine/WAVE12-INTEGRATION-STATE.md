# Wave 12 integration - state at stop (2026-10-01 evening)

Branch `integrate/wave12-2026-10-01` = wave 11 (`873fa13d8a`) + C45 + C47 + C46, merged by the
integrator after the account's WEEKLY limit stopped every lane (resets 2026-10-05 12:00 CT).
Conflicts were resolved as unions; the two judgement calls were:
- `objectColumns.js`: C45's `withholdFailed` (ANY failed tree is unknown) replaces C41's
  `withholdFailedLowerTf` (only `ltf` trees) - C45's rule contains C41's.
- `ast_interpret.py` / `interpret.js` withhold codes: wave 11's list (C49 removed
  `session-open-missing` / `period-end-missing`) plus C45's `bar-index:window` / `bar-index:early-bars`.

## NOT READY: 20 tests in 9 files fail on the merged tree (`--testTimeout=180000`)
Each must be classified before any re-pin - an improvement where two lanes meet, or a real
regression. Do NOT bulk re-pin. First suspects (look at these first):
1. `vendorHarness.c44ColourVerdict` heat-map-seasons: the colour-OFF verdict is now DIVERGE where it
   was MATCH - something other than colour moved (C45's variable-named-`color` fix? C47?).
2. `savedDocumentRoundTrip` (C46): mostly "the saved computation changed" - expected where C45/C47/
   C48/C49 change a script's tree; verify EVERY listed id still names the same input; then re-baseline
   the fixture on wave 11 rather than wave 10.
3. `vendorHarness.c41LowerTfServe` failed-tree cases: C45's general rule replaced C41's; check the
   expectation, not the code, is what moved.
4. `vendorHarness.c48CallSite`: ids `__uct_param_1` -> `__uct_param_1001` (C46's source ids for an
   out-of-corpus probe - expected), a TypeError (null[0]) - real, investigate; SPY labels 24 -> 22.
5. `vendorHarness.c49CapturedClock` 15/5/60m + packet #3: C45's `bar-index:window` now withholds the
   probes' `bar_index` control rows (consistent with C45's rule - confirm and re-pin).
Likely improvements (verify, then re-pin with the reason): OHLM cells 37 -> 45 and lines 503 -> 504
(C47 quarter + C49 calendar; `objectFnInline.vendor`, `c47OhlmDivider` x3); vdubus' failed tree no
longer fails (`c45FailedTree`); volume-profile's 200 held lines now withheld (`c47ConstTernary`, C45 item 7).

Failing tests:
- src/components/chart/builder/memberPane/savedDocumentRoundTrip.test.js > C46 — documents saved under the walk-order ids > ⛔⛔ every saved document: the door still builds the same manifest — same ids, same inputs, same pla
- src/components/chart/builder/memberPane/savedDocumentRoundTrip.test.js > C46 — documents saved under the walk-order ids > ⛔⛔ every saved document: the values a member saved, replayed BY ID, land on the same inputs
- src/components/chart/engine/__tests__/objectFnInline.vendor.test.js > high-low-open-mid-ranges — the input-guarded helpers are inlined > ⭐ 37 of TradingView's 45 cells are drawn, and every one is a cell TradingView shows
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c41LowerTfServe.test.js > C41 — a dead arm that reads below the chart, and a tree that could not be computed > ⭐ graph form: an `ltf` tree over the node budge
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c41LowerTfServe.test.js > C41 — a dead arm that reads below the chart, and a tree that could not be computed > ⭐ trees form (a document under the byte budget)
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c44ColourVerdict.test.js > C44 — the option: colour off is the verdict as it was > ⭐ heat-map-seasons — the one committed capture colour moves: MATCH before
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c45FailedTree.test.js > C45 — the two corpus programs that hold a failed tree, on their committed captures > vdubus-pattern-gen: ONE tree at 129 nodes (cap 128)
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47ConstTernary.test.js > C47 — volume-profile: past the dead arm, onto its next wall (by name) > ⛔ graded: nothing about what is drawn moves — lines 203 / 
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47OhlmDivider.test.js > C47 — high-low-open-mid-ranges: the one line we do not hold is the first week's divider > ⛔ the divider's condition is not computable
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47OhlmDivider.test.js > C47 — high-low-open-mid-ranges: the one line we do not hold is the first week's divider > ⭐ 503 of 504: every line and label we hold 
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47OhlmDivider.test.js > C47 — high-low-open-mid-ranges: the one line we do not hold is the first week's divider > ⭐ the control: ONE more divider on bar 2 is
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48CallSite.test.js > C48 — MANY executions: a chart's plot is refused where its block skips a bar, and only there > ⛔ a ONE-RUN binding mints what its every-
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48CallSite.test.js > C48 — MANY executions: a chart's plot is refused where its block skips a bar, and only there > ⛔ nothing moves at translation: the same 
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48CallSite.test.js > C48 — MANY executions: a chart's plot is refused where its block skips a bar, and only there > ⭐ `bar_index[1]` in a block is the chart'
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48CallSite.test.js > C48 — ONE execution: our object lane on the probe's own source > ⭐ SPY (a window of a longer chart): the 22 labels that read no bar coun
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c49CapturedClock.test.js > C49 · 4 — AMEX:SPY 15, 5 and 60 minutes: the period opens at 09:30 of its first session; `time("60")` is a 60-minute bucket > vw-tim
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c49CapturedClock.test.js > C49 · 4 — AMEX:SPY 15, 5 and 60 minutes: the period opens at 09:30 of its first session; `time("60")` is a 60-minute bucket > vw-tim
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c49CapturedClock.test.js > C49 · 4 — AMEX:SPY 15, 5 and 60 minutes: the period opens at 09:30 of its first session; `time("60")` is a 60-minute bucket > vw-tim
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c49CapturedClock.test.js > C49 · 8 — packet #3: `request.security(tickerid, "D", close)` on AMEX:SPY 5 minutes, the newest bar forming > ⭐ through the member
- src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c49CapturedClock.test.js > C49 · 8 — packet #3: `request.security(tickerid, "D", close)` on AMEX:SPY 5 minutes, the newest bar forming > ⭐ through the member


## Owner delegation 2026-10-01: "You decide it all whatever is best for the platform and users"
Integrator rulings (members first: charts stay fast, nothing drawn wrong). Each ships behind a
measurement, never on assertion:
- R-B (budget): INSTRUCTIONS_PER_BAR 200,000 -> 250,000, ONLY after measuring member chart speed
  (compute time per indicator on a 5,000-bar chart, before/after, and the app-wide smoke). Admits
  dual-view (247,425) and poor-man (227,730). k-clustering (800,613) stays refused by name.
- R-P (plots): CARRY_MAX 12 -> 64 (TradingView's own plot limit), after measuring render time with
  a 64-plot script. Unblocks candlestick-patterns, madrid, ema-ribbon's 13th plot.
- R-RT (runtime pane): staged rollout - first an allowlist of scripts whose runtime-lane output is
  graded MATCH on a capture (inside-bar-range, wyckoff-accumulation-distribution), with the
  app-wide smoke; widen as the census proves more. Global flag stays dark until then.
- R-D (data): no new paid data feeds. Breadth symbols (ADVN/DECN, USI:*) map to our own breadth
  collector ONLY where a capture shows our numbers equal TradingView's. Futures/FX stay refused by name.
- R-LTF (lower timeframe): flip VITE_PINE_LOWER_TF_ENABLED once `storeIntradayAgreement` passes
  (>= 99% of sessions equal on OHLC, >= 99.5% same last close) on a committed read-only payload of
  our own `/api/bars/RDDT?tf=15&bars=60000`, and the same on SPY.
- Deploys still need the owner's literal "deploy wave N" (standing master-push rule).

## Rulings applied (2026-10-01 night, integrator, solo - lanes stopped by the weekly limit)
- R-P DONE on `integrate/wave13-2026-10-01`: member pane ceiling 12 -> 64 plots (DOC 36 -> 96).
  candlestick-patterns and madrid INCONCLUSIVE -> MATCH; ema-ribbon 13/13 plots. Grade time
  148->142 / 258->411 / 576->637 ms. No saved id moved; only appends (multicator-table +6).
- R-B MEASURED, NOT TAKEN: 200k -> 250k moved no graded script. dual-view's product path stops
  on `pine:state` / `coll:diverged` before the budget; poor-man's on its withheld-text gate; the
  ceiling only binds in the dark runtime pane. Revisit together with R-RT.
