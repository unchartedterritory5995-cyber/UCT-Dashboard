# W6-T2 keyword and namespace honesty (lane w6-t2)

FINAL-TIP r2 at 3dcd4f7c55 (runs/w6-t2/final-r2, full, no code change): READY-CHECK PASS; no timeouts; jsfail is the baseline set plus coverageAudit and usePreferences.additionsOnly (both fail on base).

Base: origin/master 7f6dd3714d (engine 18, W6-T3a in). Spec: W6-BREAKDOWN T2, review GO-WITH-NOTES.

## Fixed
- `method` (pineRuntimeFrontend.js, the statement walk's `method` arm) is a keyword only in the shape
  `method <ident>`, and only when the script version is known and below 5. A v3/v4 `method = input(...)`,
  `method := ...` and `method` as an argument bind and read as an ordinary name.
  `scanDefs` already counted declarations only for `method <ident>`, so it is unchanged.
- v5+ or unversioned `method = ...` still refuses `runtime:udt-method`, now with a sentence that says why
  (keyword from v5, no `method <name>(`). TradingView's answer for that shape is uncaptured.

## Refused by name (no committed capture)
- Spec item 2 (a parameter or local named like a namespace, then `timeframe.period`): not changed. The runtime
  lane already serves `f(string timeframe) => timeframe.period`; the host resolver (`pine.js` `typeRefusalFor`)
  still refuses it `pine:type`. No capture pins TradingView's resolution, so no resolver edit.
- `enum`: the front end has no `enum` statement arm and no measured wall; nothing to fix, nothing claimed.
- v5/v6 `method = ...` served as a name: refused (see above).

## Coordination
Touches only the `method` arm of the statement walk (and its refusal message). Not `defineFunction`, not
`runtimeRespelling`, not `exprType`; no overlap with W6-T3b or W34-D3 lines.

## Rails and mutations
Rail: app/src/components/chart/engine/runtime/__tests__/w6KeywordHonesty.test.js (v3 name, v4 `:=`, v6 UDT method
still binds, v5 still refuses, user-function and `ta.sma` forms untouched).
Mutations (heavy-mut.lock): no-op comment SURVIVED (control); `method` always a declaration KILLED (3 tests);
version gate removed KILLED (v5 refusal test). A third change (keeping `method` out of HELD_WORDS) survived its
mutation, so it was reverted rather than shipped unproved.

## Engine bump: yes (v3/v4 scripts using `method` as a name go from refused to served).
Measure-pair, C18 diffs, final-tip: see below.

## Measure-pair (heavy-mp2.lock, base pine-dsk-mpbase2 asserted at 7f6dd3714d before and after)
- C18 corpus audit: no differences except per-script timing (`ms`). C18 constructed probes: identical.
- Vendor harness: identical (336 captures, MATCH 110, DIVERGE 107, INCONCLUSIVE 119 both sides).
- Census (runtime-on, 967 rows): one row moved, `price-divergence-detector-v32-revised-by-justunclel`
  (stuck false->true reaches the peel, steps 1->2). No attach claimed. `technical-ratings` did not move (item 2 not changed).
- Classification: intended. No door output changes.

## Final-tip (full, heavy-final2.lock) at f3c12a473f (master merged; master's diff touches nothing under app/src)
gate=0 hyg=0 js=1, totals ok, integrity ok. Failing files: controlDoorCensus, enumerationSites, vendorHarness,
settingsScope.rail, pollingSites.rail (baselines), vendorHarness.coverageAudit (delta-rsi, re-run alone: still fails),
usePreferences.additionsOnly (TodayHome.jsx opaque setPref, from master). The last two were re-run on the base
7f6dd3714d: both fail there identically, so neither is from this lane.

## r1 (review NO-GO @70d1a93722, B1)
B1 was a silent wrong value: a v3/v4 user function named `method` was served, but HELD_WORDS still skipped it, so a
held body calling it counted as pure. Fix: the held scan skips `method` as a word only when the version is not known
to be below 5. Rails added: the reviewer's repro (v4 held `g` calling `method(x) => x - x[1]` refuses
runtime:conditional-history, with the renamed `mm` control) and `method f(x) =>` is still a declaration in v4.
Mutations (heavy-mut.lock): no-op SURVIVED (control); HELD gate removed KILLED (this is the pre-fix state, so the repro
is red before and green after); methodIsName forced false KILLED; version gate removed KILLED; ident clause removed KILLED
(the reviewer's M3, now a killed case).
N3 (fnDefName) deliberately NOT changed: it is type inference, the result stays unknown (conservative), and changing it
would need a new measure-pair. Measure-pair numbers above stand for the one-line HELD change since it only affects
scripts with a v3/v4 user function named `method`, which refused before. Engine bump: yes.

## r1 final-tip (full, heavy-final2.lock) at fb955cc2d1, master merged
gate=0 hyg=0 js=1, totals ok, integrity ok. Failing: the five baselines, coverageAudit and usePreferences.additionsOnly
(both fail identically on base), plus pineBoxImportVerdict and vendorHarness.b1Paints, which timed out at 120 s under
full-run load and pass alone (11/11 and 52/52).
