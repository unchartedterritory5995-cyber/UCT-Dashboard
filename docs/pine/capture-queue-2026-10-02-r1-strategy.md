# Capture queue — 2026-10-02 R1, a strategy draws like an indicator

Branch `pine/r1-runtime-strategy`. One new probe
(`tools/visual_conformance/probes/r1-strategy-draws.pine`, never compiled), for the parent session
to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md`.

## Why

C50 (host lane, live) and R1 (runtime lane) read `strategy(...)` like `indicator(...)` and skip the
simulated broker's order calls (`STRATEGY_ORDER_CALLS`, `pine.js`). That rule is an integrator
ruling; no committed capture of a STRATEGY exists (none of the 139 harness captures declares
`strategy(`), so nothing vendor-side witnesses it yet.

## Q-S1

| # | capture | settles |
|---|---|---|
| Q-S1a | `r1-strategy-draws.pine` as written (a `strategy(...)`), NYSE:RDDT **1D**, full history, market closed | what the strategy draws |
| Q-S1b | the same file with line 2 replaced by `indicator("UCTPROBE_R1_STRATEGY", overlay = false)` and the five `strategy.*` order lines deleted, same chart | what the indicator with the same body draws |

Read: every plot `N01`..`N05` equal bar for bar between Q-S1a and Q-S1b. If any differs, the rule
is wrong for that shape (the likely suspects are the `var` rows after a fill bar) and both lanes
must refuse it by name until the difference is modelled.
