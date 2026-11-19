# REQ-B1: a v3 / v4 bare `security(...)` is the request door's, graded on the runtime lane forced (2026-11-18, NUMBER PENDING)

Coordinator ruling (2026-11-18, request unit, part B1): route a v3 / v4 bare `security` through the request door,
citing TradingView's v3 migration sentence; v1 / v2 and a script with no version line stay refused by name. Branch
`feat/pine-bare-security-v3-v4` from master `3d31b25661` (engine 80), master `5c2aa89822` (engine 81) merged in once;
its own PR.

## 1. The answer

- **The reference.** `security(...)` became `request.security(...)` in v5 (a rename; `resolution` became
  `timeframe`). TradingView's v3 migration guide, verbatim: "We added a parameter to the `security` function (the
  fifth one) called `lookahead`. It can take on the form of two different values: `barmerge.lookahead_off` (and this
  is the default for Pine Script version 3) or `barmerge.lookahead_on` (which is the default for Pine Script version
  2)." So v3 and v4 share `request.security`'s look-ahead default; v1 and v2 do not.
- **Before:** on the runtime lane a v1-v4 bare `security` whose value needs the run (a `valuewhen`, a function's own
  state) fell to `runtime:request-with-state` without being asked the request door's questions, about a value that
  reads none of this run's state (24 of that wall's 39 sample hits).
- **Now:** for `//@version=3` and `4`, `pineRuntimeFrontend.js` routes it through `admitRequest`, exactly as
  `request.security`: every question that door asks (the symbol, the timeframe, look-ahead, a request inside a
  request) is asked, and each refusal keeps its name.
- **Witnessed for v4** by `support-and-resistance-multi-time-frame` (`security(..., 'D' | 'W' | 'M',
  valuewhen(...))`) on the two committed captures, NYSE:RDDT and AMEX:SPY 1D 2026-10-02, graded on the runtime lane
  FORCED: all six plots MATCH, every bar compared but the warm-up both sides leave blank and the newest bar, which the
  run withholds by name on every plot (RS RATING L5's run-wide rule, `request:htf-newest-unconfirmed`: its monthly
  read cannot know that bar yet). The member door still draws SR-MTF on the HOST lane (control in the rail), so the
  forced lane is how runtime-lane evidence for the request door is graded.
- **Unchanged, by name:** v1 / v2 and a script with no version line (`runtime:request-with-state`; their look-ahead
  default is the other one, Q-REQ4); a v3 / v4 value that reads this run's own mutable state, refused first whatever
  the timeframe (TradingView does not compile it: "Cannot use mutable variable as an argument for security
  function!"); a user function named `security` (routed before this branch).
- **The full corpus, both lanes:** this PR's own pine heavy run against engine 81's (run 44452719465), per capture,
  stated in the PR description.

## 2. What was built

- `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`: the bare `security` arm (v3 / v4 only).
- `app/src/components/chart/builder/memberPane/memberPaneDefinition.js::__forceRuntimeLaneForTests`: a TEST SEAM.
  While on, the door answers with `runtimeLaneDefinition` (its kill list, allowlist and admission still decide) as soon
  as the translation stands. Off everywhere but a rail; the rail walks `app/src` and fails if any member surface
  imports or calls it.
- `app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js` (approved harness change): the harness reads the
  run's own named newest-bar withhold (`RUNTIME_REQUEST_WITHHELD_KEY`, carrying `request:htf-newest-unconfirmed`) as
  not compared on every plot, as it already reads the host lane's per-plot newest withhold. Unread, a daily plot of a
  runtime document that also reads a monthly merge graded DIVERGE on that one named bar.
- `tools/whole_app_engine_rails.txt`: the new rail reads `app/src` outside the engine.
- The engine ledger's NUMBER PENDING line.

## 3. Rails and mutation proofs

`app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.reqBareSecurityForced.test.js`:
- forced, the door answers with the runtime lane, and all six plots MATCH on both committed captures, each with the
  newest bar withheld by name and every other steady bar compared;
- CONTROL: not forced, the door draws SR-MTF on the host lane;
- the routing's limits: a v3 weekly read over a carried state builds as a request; v2 and no version line refused by
  name; a v3 / v4 value reading this run's mutable state refused by name;
- no member surface imports or calls the seam (with a control that the pattern can find one).

Mutants (`runs/mutants-manifest.json`, `uct.ci-mutants/v1`, run by pine heavy's mutant job):
- B1-1 a v3 / v4 bare security is not routed to the request door (master's refusal)
- B1-2 v1 / v2 (and no version line) are routed too
- B1-3 a value that reads this run's own mutable state is not refused first
- B1-4 the forced-runtime seam is never read (the door keeps its own lane)
- B1-5 the harness does not read the run's named newest-bar withhold

Results: the PR's mutant job (dispatched `skip_legs`), stated in the PR description.

## 4. Runs

| run | result |
|---|---|
| remote lane, `eae36e1357` (run 44478871945): `vendorHarness.reqBareSecurityForced`, `vendorHarness.test`, `capabilityDemandCensus`, `irSymbolFold`, `pine.requestResolution`, `rvolSliceParseEvidence`, `pendingNumbers`, runtime `pointwise`, `requests`, `simpleArgWindow`, `w4ClassifierHonesty`, `runtimeRequestSupply`, memberPane `memberPaneDefinition`, `memberPaneDefinition.noGuess`, `draw1KeepHost`; pytest `test_ci_whole_app_rails`, `test_script_engine_version_gate` | green: vitest 15 files, 238 tests; pytest 20 passed |
| local, both lanes, `eae36e1357` against engine 81's pine heavy verdicts (run 44452719465): the 14 committed captures whose runtime decline was `runtime:request-with-state` on a v3 / v4 bare `security`, plus pmax-explorer, cpr-with-mas, fibonacci-pivot-points-cc and SR-MTF RDDT | no verdict moved; delta-volume-v21 and mtf-watchlist-charts now decline by the request door's own name (`runtime:request`) |
| full corpus, both lanes | the PR's pine heavy run (PR description) |
