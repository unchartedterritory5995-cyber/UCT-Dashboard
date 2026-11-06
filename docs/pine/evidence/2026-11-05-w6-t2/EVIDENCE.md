# W6-T2 keyword and namespace honesty (lane w6-t2)

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

## STATUS at push (incomplete)
Measure-pair (heavy-mp2.lock, base pine-dsk-mpbase2 at merge-base 7f6dd3714d) and final-tip (heavy-final2.lock)
were NOT run: heavy-mp2.lock was held by another lane ('w34-d2-rep') for 20+ minutes. Next step: run
`$RUN/mp.sh` (C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w6-t2/mp.sh), read the C18 out/probe diffs
and census first-wall moves (expected: price-divergence-detector-v32 first wall moves; no C18 door diff expected,
as only the runtime lane's `method`-as-name refusal changes), then merge origin/master and run final-tip.
