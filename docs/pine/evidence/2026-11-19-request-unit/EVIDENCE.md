# The `request` engine unit, PR 1: TF-FOLD, a request's settled timeframe on the runtime lane (2026-11-20, NUMBER PENDING)

Coordinator: patrick-2b (GO 2026-11-19; PR 1 narrowed to TF-FOLD and approved 2026-11-20). Branch
`feat/eng-request-unit` from master `a08c39617c` (engine 87). Engine number: NUMBER PENDING (the next engine train
numbers it). The unit's roadmap entry: `docs/pine/PARITY-ROADMAP-2026-11-18.md` U-REQ; its 23 sole scripts:
`docs/pine/parity-roadmap.json`, `units[unit == "request"]`.

## 1. The answer

- **1 script newly served: `committed:cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels`** (3,816 agrees).
  Runtime-on lane: INCONCLUSIVE -> **MATCH on both committed captures** (`...-rddt-1d-2026-11-14`,
  `...-spy-1d-2026-11-14`: 27 / 27 items each). The member door now draws it on the runtime lane, and every capability
  it names (`request-other`, `var`, `obj:label`, `obj:delete`, `conditional-ta`, `realtime-state`, ...) is admitted
  (`request-other` and `realtime-state` at closed-bar-history scope).
- **The plot lane does not move**: 537 / 537 plot-lane translations byte-identical base vs head (section 4), and the
  corpus rail holds it.
- The other 22 sole scripts stay refused, each by name (section 5).

## 2. What was built

`app/src/components/chart/engine/ast/pine.js` (`Resolver`): a `request.security`'s timeframe argument, and only that
argument (`requestTimeframeReach`, handed by `requestTargetOf`, `requestIsOtherPeriod` and `securityDeclineReason`), is
read through `TF_READ_HOPS` (16) names and ternary arms on the runtime lane (`REQUEST_TF_REACH`), the object pass's
reach (C10). The plot lane keeps its 4. Set by `pineRuntimeFrontend.js` on its own resolvers
(`requestTimeframeReader: 'runtime'`) and by nothing else; every other reader of a timeframe (`time()`, `time_close()`,
`timeframe.change`) keeps its own reach.

cppivot's `floor_pivot_resolution = tf == "1H" ? '60' : tf == "2H" ? '120' : tf == "4H" ? '240' : tf` over
`input("D", options = [...])` is six hops: the runtime lane now reads `'D'` (the identity on a daily chart) and, at the
member's "W" / "M", the weekly / monthly look-ahead merge already witnessed (`vw-request-htf-alignment-spy-1d-2026-10-02`).

## 3. The witnesses

- **The rule is the language's.** A constant chain that settles before the first bar IS the literal it settles to.
  Every rail compares the folded request with the same request written with that literal, on the runtime lane's own
  run (`runtime/__tests__/requestTimeframeReader.test.js`).
- **The script's own captures** (runtime-on lane, the corpus harness, base `a08c39617c` vs head):

| capture | base | head |
|---|---|---|
| cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels-rddt-1d-2026-11-14 | INCONCLUSIVE (refused `pine:request`) | **MATCH** 27 / 27 |
| cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels-spy-1d-2026-11-14 | INCONCLUSIVE (refused `pine:request`) | **MATCH** 27 / 27 |

  Production lane: unchanged (INCONCLUSIVE, the plot lane still refuses the chain by name). The same A/B over the unit's
  other committed and licence-held captures (multi-timeframe-trend-indicator, mtf-key-levels, tehthomas FVG, Saty ATR
  Levels, Ripster + RVOL, price-action-doji-harami, best-abcd-pattern-screener) moved no verdict on either lane.

## 4. The plot lane does not move

- `requestTimeframeReader.test.js`: every committed corpus script that reads `security(` translates on the plot lane
  to the same bytes with the runtime lane's reach handed to every reader and without it; its control shows the digest
  CAN move (the reach handed to the plot lane moves cppivot's chain).
- Measured once, base `a08c39617c` vs head, the plot-lane translation (`translatePine`, strict, parameter manifest)
  of all 266 committed corpus scripts and the 271 reference scripts of the coverage sample: **537 / 537 identical**
  (sha256 of outputs, refusals, notes, objects and the parameter manifest). Measured on the wider working tree that
  also carried the withdrawn PR 2 readers (`09856545ab`); this PR's code is the same on the plot lane (the host
  translator sets no option either way), and the corpus rail above is green on this PR's commit (remote run).

## 5. Still refused, by name (this unit's other 22 sole scripts)

- **PR 2 (approved 2026-11-20), engine:** a request timeframe written as a CALL (Saty ATR Levels' `timeframe_func()`,
  TehThomas' `getAlignedTimeframe()`): the runtime lane's resolver environment holds no user function, so the reader
  cannot see the body. Then the chart's own symbol on the extended session (`ticker.new(syminfo.prefix,
  syminfo.ticker, session.extended)`) at the chart's own "D" on a daily chart, served only if Saty's held captures grade
  MATCH and the rig's Q-REQ5 agrees.
- **Capture-gated (queue rows, `capture-queue-2026-11-19-request-unit.md`):** Q-REQ5 / Q-REQ6 (extended ticker),
  Q-REQ7 (`"12M"`: mtf-key-levels-support-and-resistance), Q-REQ8 / Q-REQ9 (the RSI-divergence screeners, for a symbol
  read through a helper's parameter); Q-REQ2 (previous-n-daysweeksmonths-high-low) and Q-REQ3 (price-action-doji-harami,
  Heikin Ashi) unchanged from 2026-11-16.
- **Engine, later:** best-abcd-pattern-screener and the two RSI screeners (a held US symbol through a helper's
  parameter: outside a request the runtime lowers a user function once, in a shared frame, so `_ticker` is a slot;
  plus v4 `input(..., type = input.symbol)`).
- **Owner data decisions (refused by name, not built around):** lower timeframe on a daily chart (Q-REQ-LTF:
  initial-balance-ib, delta-volume-v21, multi-timeframe-trend-indicator, multi-timeframe-rolling-bitmex-liquidation-levels,
  ripster-rvol-saty-atr-levels); data the platform does not hold (Q-REQ-DATA: 4c-nyse-market-breadth-ratio, sub,
  chases-buysell, global-liquidity-index, my-cme-open-interest, earnings-sr-levels, banknifty-mcclellan-oscillator).
  Crypto stays out of scope (owner ruling): bitcoin-futures-funding-rates, swing-points-and-liquidity.

## 6. Mutants

`ci/mutants/request-tf-fold.json` (`tools/ci_mutant_runner.py`): TF1 the plot lane handed the reach, TF2 the reach back
to 4 hops, TF3 the reach unbounded, TF4 the runtime lane not given the reach. Run on this PR's branch by the `pine heavy` mutant job
(`-f mutants_manifest=ci/mutants/request-tf-fold.json -f skip_legs=true`); its result is on the PR.

## 7. How it was measured

Measured on `09856545ab` (the wider working tree; the plot lane and the hop reach are this PR's) unless named. All local runs under `uct-clips/tools/heavy_lock.py`, a scratch cache outside the repo, base = a detached worktree
at `a08c39617c`:
- the corpus harness over the unit's captures, both lanes (`VENDOR_HARNESS_DIR` = those captures, committed and
  licence-held from the local store), base vs head;
- the member-door census scoped to the 23 sole scripts (`tools/pine_coverage/run_census.py`, both lanes, empty
  reference, empty library store: none of the 23 imports a library);
- the plot-lane digest (a local measure, not committed).
