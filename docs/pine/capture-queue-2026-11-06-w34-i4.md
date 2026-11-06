# Capture queue: W34-I4 the bar-0 value of a bare v1/v2 self read (2026-11-06)

The run serves a v1/v2 self-referencing definition whose every self read is the one-argument
`nz(x[k])`: its bar 0 is 0 under either seed rule, so no capture is owed
(`pineRuntimeFrontend.js::v2SelfReferenceStatements`, graded against the hand-unrolled recurrence in
`runtime/__tests__/w34I4SelfReference.test.js`). A BARE self read keeps the host lane's `pine:state`
refusal by name until this row is captured, and so does the fill form `nz(x[k], fill)` (it reads
`fill` or 0 on bar 0 by the same rule; it keeps master's answer): the reference does not state
whether a v1/v2 self-reference starts at `na` or at 0.

| id | probe | symbol / tf | refusal kept | unblocks | owner |
|---|---|---|---|---|---|
| W34-I4-S1 | `vw-w34-i4-v2-selfref-seed.pine` | `AMEX:SPY 1D` from the listing | `pine:state` "reads its own previous bar, and this engine can hold that only when the script states a first-bar value the way `na(x[1]) ? … : …` does" | a bare self read in a v1/v2 definition (`thelark-lma-v2-laguerre`, `col`, line 43; that script is also behind W7 `runtime:request-with-state`), and the fill form `nz(x[k], fill)` (probe R07) | W34-I4 follow-up: widen `v2SelfReferenceStatements` to the bare read once the bar-0 rule and the below-v4 `na == x` reading are witnessed |
