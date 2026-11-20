# Capture queue: A4, a branch decided by a parameter the call site passes per bar (2026-11-20)

Filed for coordinator patrick-2b by the objects agent (roadmap unit `objects`, A4). Probes only: no capture text is
committed.

The runtime lane now compiles, for a call site whose argument for a parameter that decides a branch holding history
changes every bar, a copy of the function whose branch is CHECKED to run on every call
(`pineRuntimeFrontend.js::checkedParamOf`, HIST-S3's `collections.js::callSiteRuns`): drawn while the branch has run on
every call, and the first call it skips STOPS the run by name. While the branch runs on every call of a call made on
every bar, its history is every bar's, so the drawn value is TradingView's whatever the version's arm rule (the
engine-64 queue doc's engine gap, `capture-queue-2026-11-16-runtime-history.md`). Row Q-A4-2 grades that against
TradingView and records what Pine keeps where the branch skips (where the lane stops).

A v4 `?:` arm is LAZY: `vw-cs2-v4-ternary-lazy-rddt-1d-2026-11-15` T00 (`up ? sma(close, 5) : close`), T01 (`barssince`)
and T02 (a helper calling `sma`) equal the arm's RUNS on 666 / 666 RDDT bars (re-read 2026-11-20; T01 counts runs, its
`close[1]` is the previous BAR). What a v4 arm does with `crossover` / `crossunder`, `cum` and a helper local's `[n]`
is not captured in any version (HIST-K1 / K2 ask the v6 / v5 halves): row Q-A4-1. Until it is, the lane serves no
per-run state for them: tradingviews-technical-analysis (v4, `crossunder` in the test of a nested `?:` in an else arm)
keeps its run-time stop by name (`runtime:conditional-history`, "skips bar ... and runs again on bar ...").

Every probe runs with its inputs at their defaults, on the chart's own symbol, from the listing so no warm-up hides a
difference. A line that does not compile is a reading: record the error text and the line, remove only that row, and
capture the rest. A runtime error is a reading: record its text and the bar it names. Not live. Read after the close.

Probe sha256 (first 16 hex, of the file as committed): `vw-a4-v4-arm-kernels.pine` a73ee9f54886d68d,
`vw-a4-param-branch.pine` f7edf07f11fb99f0.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-A4-1a | `tools/visual_conformance/probes/vw-a4-v4-arm-kernels.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | whether a v4 arm's `crossover` / `crossunder` (T00 / T01), `cum` (T02) and a helper's `cum` with `a[n]` (T03) count RUNS, and whether `crossunder` in an else arm's test is lazy (T04, TA's `adxpoint`): per run and equal to the lane's per-invocation step, the function joins the served per-call-site set for v4 and TA's stop lifts |
| Q-A4-1b | `tools/visual_conformance/probes/vw-a4-v4-arm-kernels.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-A4-2a | `tools/visual_conformance/probes/vw-a4-param-branch.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | P01 / C00 grade what A4 draws (the support-and-resistance `Variance` shape, the branch run on every call); P02 records what Pine keeps over the calls the arm ran on (the lane stops there by name) |
| Q-A4-2b | `tools/visual_conformance/probes/vw-a4-param-branch.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |

## Still refused, by name (not this queue's)

- support-and-resistance (`reference:support-and-resistance__c13363a5d2`): its VALUE build stands with A1 + A4 (the
  `Variance` branch checked, `k` never 1 at the defaults). Its drawing build keeps the refusal: HIST-S3's check runs on
  the value lane only, so the run half (its lines) is not minted. Lifting that is a drawing-build unit of its own.
- a parameter declared `simple` / `const` passed a per-bar value (Pine does not compile it), a call in a loop, the object
  door and a request's value: refused as before.
