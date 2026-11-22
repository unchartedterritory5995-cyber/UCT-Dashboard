# The `request` engine unit, PR 2: a request timeframe written as a call to the script's own function, and EXT-OWN (2026-11-20, engine 90)

Coordinator: patrick-2b (PR 2 approved 2026-11-20: "hand the runtime request reader the script's function bodies
(expression bodies and the `x = lit` + if-chain `x := lit` statement form ONLY, refuse anything else by name), then
EXT-OWN graded on Saty's held captures + Q-REQ5 rig witness"). Branch `feat/eng-request-settled-fns`, stacked on PR 1
(#2154, `feat/eng-request-unit` at `6ea84730bf`). Engine number: engine 90 (the next engine train numbers it).
PR 1's evidence: `docs/pine/evidence/2026-11-19-request-unit/EVIDENCE.md`.

## 1. The answer

- **1 script newly served: Saty ATR Levels** (`reference:saty-atr-levels__99165984ef`), refused `pine:request` before.
  Runtime-on lane: INCONCLUSIVE -> **MATCH, all 32 items, on both of its captures** (`saty-atr-levels-rddt-1d-2026-11-14`,
  `saty-atr-levels-spy-1d-2026-11-14`, licence-held, graded from the local store). Its two walls were this PR's two
  readers: `timeframe_func()` (the settled `if` chain over its "Trading Type" input, `"D"` at the default) and its ticker
  `ticker.new(syminfo.prefix, syminfo.ticker, session = session.extended)` at that `"D"` on a daily chart (EXT-OWN). The
  member door now draws it on the runtime lane (the reach run's door answers `runtime`; the reach report's row is
  re-pinned and its population block re-derived).
- **Production lane: unchanged** on every graded capture; **plot lane: 537 / 537 translations byte-identical**.
- **No verdict moved MATCH -> non-MATCH on either lane** (section 3); the unit's other 22 sole scripts answer as before.
- TehThomas' aligned-timeframe FVGs now reads its timeframe (`"M"` on a daily chart) and stays refused by name for a
  different gap (section 5).

## 2. What was built (runtime lane only)

- `pine.js::settledRequestFunctionOf(inl)`: a script function's result as ONE expression, from the body the runtime lane
  keeps (`inlineBodyByName`). Two shapes and nothing else: an expression body (`f(a) => expr`, or plain `name = expr`
  lines then a last expression), or `x = '<text>'` (typed `string x` too) then ONE `if` / `else if` / `else` chain whose
  every arm is the single statement `x := '<text>'`, then optionally `x` alone; that chain is the ternary
  `c1 ? t1 : c2 ? t2 : … : tElse`. The `else` is required. Anything else is `{refused: <why>}`.
- `Resolver.throughSettledCall` (read by `timeframeLiteralOf` / `ownTimeframeOf` under `REQUEST_TF_REACH.calls`): the
  call's result read in the body's own scope (the names bound before the function, a snapshot taken at its
  definition), the call's arguments as its parameters. A test is folded only by `constantBranchOf`, as the same
  ternary written out is, so a test (or an argument) that varies per bar answers null and the request keeps its
  refusal.
- `Resolver.settledAliasOf`: a top-level name declared ONCE as `NAME = f(…)`, never reassigned, not an `env` binding
  (`alignedTF = getAlignedTimeframe()`): the runtime lane holds it per bar, and its value on every bar is that call's.
- `pineRuntimeFrontend.js`: hands its resolvers `requestSettledFunctions` (`get`, `alias`) and the
  `requestExtendedOwn: 'daily-identity'` flag; a request whose timeframe is such a call and still refuses NAMES the
  function and why (`settledCallWhy`, appended to the `runtime:request` sentence); a settled call (or alias) in the
  timeframe argument is not a slot read in itself (`tfReachesSlot`: its arguments are checked as any argument is).
- EXT-OWN (`Resolver.extendedOwnTickerOf`, `runtimeExtendedOwnDaily`): `request.security(ticker.new(syminfo.prefix,
  syminfo.ticker, session.extended), <the chart's own "D">, x)` on a DAILY chart is the chart's own daily series (the
  identity), and nothing wider: another timeframe, an intraday chart, a literal prefix, another ticker or an extra
  argument keep their refusal.
- ⛔ The host translator sets none of it: the plot lane does not move (section 4).

## 3. The witnesses

- **The rule is the language's.** Pine returns a function's last value, an `if` / `else` chain takes the arm whose
  test holds and its value is that arm's last expression; a call that settles before the first bar IS the text it
  settles to. Every rail compares the call with the same request WRITTEN with that text, on the runtime lane's own run.
- **EXT-OWN is served on its captures alone** (the manual says only that extended-hours data is not shown on "1D" and
  above): Saty's two daily captures read `close[1]`, `ta.atr(14)[1]`, `high` and `low` through the extended ticker at
  `"D"`, every one matching. The rig's own probe (capture-queue row Q-REQ5, `vw-req-extended-own.pine`) is the committed
  witness still to come; it keeps or withdraws EXT-OWN.
- **The A/B** (base = PR 1 head `6ea84730bf`, head = `491998a101`; the unit's 16 committed and licence-held captures,
  both lanes, the corpus harness):

| capture | production, base -> head | runtime-on, base -> head |
|---|---|---|
| saty-atr-levels-rddt-1d-2026-11-14 | INCONCLUSIVE -> INCONCLUSIVE | INCONCLUSIVE -> **MATCH** (32 / 32) |
| saty-atr-levels-spy-1d-2026-11-14 | INCONCLUSIVE -> INCONCLUSIVE | INCONCLUSIVE -> **MATCH** (32 / 32) |
| cppivot-boss-floor-pivots (RDDT, SPY 1D) | unchanged | MATCH -> MATCH |
| the other 12 (best-abcd, mtf-key-levels, multi-timeframe-trend, price-action-doji-harami, ripster-rvol-saty, tehthomas; RDDT and SPY each) | unchanged | unchanged (each refused by its own name) |

- **The scoped member-door census** (the unit's 23 sole scripts, runtime-on, base vs head): one row moves,
  `reference:saty-atr-levels__99165984ef`, not attached (2 peel steps) -> attached at step 0. The other 22 are unchanged.

## 4. The plot lane does not move

- `requestTimeframeReader.test.js`: every committed corpus script that reads `security(` translates on the plot lane to
  the same bytes with every runtime-lane reader in the code and with each stubbed out (the reach, the settled call, the
  settled name, the extended own ticker); its control shows the digest can move.
- Measured base `6ea84730bf` vs head `491998a101`: **537 / 537 plot-lane translations identical** (266 committed corpus
  + 271 reference sample; sha256 of outputs, refusals, notes, objects and the parameter manifest).
- The production lane of every graded capture is unchanged (section 3), and the plot lane refuses each shape in the
  rails as before (`requestSettledFunctions.test.js`).

## 5. Still refused, by name

- **TehThomas aligned-timeframe FVGs** (`committed:tehthomas-aligned-timeframe-fair-value-gaps`): its timeframe now
  reads (`alignedTF` is `"M"` on a daily chart), and the script stays refused by name for a different gap: its request
  value reads `time[1]` (`runtime:unbound`, `time` inside a request). Its committed captures' rows are unchanged.
- **best-abcd-pattern-screener and the two RSI-divergence screeners** (Q-REQ8 / Q-REQ9): a request whose SYMBOL is a
  function's parameter (SYM-PARAM). Built on a local branch after this PR (each call site compiled with its own fixed
  symbol, C35's per-call-site specialisation) and HELD, NOT in this PR: its only witness, best-abcd, is `overlay = false`,
  and the member door's runtime lane does not hand a script on its own pane another symbol's bars yet ("10
  `request.security` read another symbol ... which a script drawn bar by bar on its own pane is not handed yet"), and
  the RSI screeners read `BYBIT:BTCUSD` (crypto, out of scope). Nothing would be newly served, so nothing is shipped.
- **Owner data decisions** (unchanged from PR 1, refused by name, not built around): lower timeframe on a daily chart
  (Q-REQ-LTF: initial-balance-ib, delta-volume-v21, multi-timeframe-trend-indicator,
  multi-timeframe-rolling-bitmex-liquidation-levels, ripster-rvol-saty-atr-levels); data the platform does not hold
  (Q-REQ-DATA: 4c-nyse-market-breadth-ratio, sub, chases-buysell, global-liquidity-index, my-cme-open-interest,
  earnings-sr-levels, banknifty-mcclellan-oscillator). Crypto stays out of scope (owner ruling):
  bitcoin-futures-funding-rates, swing-points-and-liquidity.
- **Capture-gated** (unchanged): Q-REQ6 (the extended ticker on intraday charts), Q-REQ7 (`"12M"`), Q-REQ2 / Q-REQ3.

## 6. Rails and mutants

- `app/src/components/chart/engine/runtime/__tests__/requestSettledFunctions.test.js` (25): the Saty shape at each
  input reads what its text written out reads (and the arms are distinct reads); an expression body and a constant
  argument; the TehThomas shape through `alignedTF` and written in the request; the per-bar test, the per-bar argument,
  a reassigned name, and five refused body shapes, each refused and NAMED; EXT-OWN at "D" equals the regular ticker
  (and through `timeframe.period`, and through the Saty function), stays refused at "W", on an intraday chart and for
  three other spellings; the plot lane refuses every shape here as before; each reader stubbed out turns its rail red.
- `requestTimeframeReader.test.js`: the corpus confinement now stubs out every runtime-lane reader (the reach, the
  settled call, the settled name, the extended own ticker) and holds the plot lane to the same bytes.
- `ci/mutants/request-settled-fns.json` SF1..SF7 (killed locally, every file restored byte-equal; the `pine heavy`
  mutant job on the PR branch is the record); `ci/mutants/request-tf-fold.json` TF2 / TF3 now name the reach with
  `calls: true`.

## 7. How it was measured

All local runs under `uct-clips/tools/heavy_lock.py` (or a focused two-capture grade), a scratch output outside the
repo; licence-held captures and reference-sample script text are read from the local store and never committed.
- the corpus harness over this unit's committed and licence-held captures, both lanes, base (PR 1 head `6ea84730bf`) vs
  this PR, one worktree checked out at each commit in turn;
- the plot-lane digest of the 266 committed corpus scripts and the 271 reference-sample scripts (`translatePine`, strict,
  parameter manifest: sha256 of outputs, refusals, notes, objects and the manifest), base vs head;
- the member-door census scoped to this unit's 23 sole scripts (`tools/pine_coverage/run_census.py --runtime-on`), base
  vs head;
- the reach run's door for Saty (this repo's `capabilityEvidenceLane.test.js` member door: the allowlist empty,
  capability admission on and latched, the host known-divergence list applied): `runtime`.
