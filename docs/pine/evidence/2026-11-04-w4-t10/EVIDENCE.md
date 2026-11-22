# W4-T10 State kernels over runtime values - evidence (desktop, 2026-11-04)

Branch `feat/pine-w4-t10-state-kernels`, stacked on W4-T1 tip **`f9b85fb442`** (`feat/pine-w4-t1-wall-report`,
unmerged). measure-pair base = that same T1 tip, so every diff below is T10's own. Engine tip tested: `22ad7169f5`
(later commits: this file only). Logs (desktop): `C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\dsk-w4t10\`.
Lanes used: mutations on `heavy-mut.lock`, measure-pair on `heavy-mp2.lock` (`pine-dsk-mpbase2` switched to `f9b85fb442`
inside the job), final-tip on `heavy-final3.lock`.

## What changed (paths under app/src/components/chart/engine/)
- `ast/interpret.js`: new `CARRIED.cumPine`, `.pivotHighPine`, `.pivotLowPine` (all `runtimeOnly`) and `CARRIED2.stochPine`,
  `.vwapPine` (`inputs: 3`). Each is the columnar arithmetic stepped per bar: `cumCol` (na bar blank, total HELD),
  `pivotCol` run at the confirmation bar (ring of left+right+1, centre = right slots from newest, left tie pivots, right tie
  does not, any na in window = na), `computeStochastic` (zero range = 50; a non-finite input RESTARTS the window = the causal
  form of `bindShipped`'s `finiteTailStart`), `computeVWAP(bars, price)` (ET-day session key, non-finite price blanks the
  rest of the session). No existing member changed.
- `runtime/vm.js` OP.CARRIED / carried setup: `cells` may be a function of the length (pivots), `init` receives the length,
  `step` receives the plan entry's `m` (rightbars). OP.CARRIED2: a member with `inputs: 3` pops a third value. OP.WINDOW
  untouched (T8's band).
- `runtime/ir.js` (`carried2Call` optional third input, walked by the validator) and `runtime/lowerIr.js` (pushes it).
- `ast/pineRuntimeFrontend.js`: `RUNTIME_STATE_KERNELS`, `MAX_PIVOT_SPAN`, and one branch placed BEFORE the namespaced
  transform (which respells `ta.pivothigh` as `pivothigh(..)[R]`, a history read over a stateful call, refused). Serves
  `ta.cum(x)`, `ta.pivothigh/ta.pivotlow(x, L, R)` (L,R >= 1 whole, fixed before bar 0, span <= 5000), `ta.stoch(c,h,l,n)`,
  `ta.vwap(x)` (1 arg); v1-v4 bare `cum`/`pivothigh`/`pivotlow`/`stoch` only before v5; a script's own function wins; named
  args refuse `runtime:builtin-args`; a pivot whose `rightbars` is only known at run time keeps the existing refusal.
  Band: only the carried-call region and a new block at ~:6060 (outside every other lane's band listed in the brief).
  builtinStateFamily (T1's) is untouched.
- **Object door: master's answer kept.** The branch is off when `opts.objectDoor` is set, so the door falls through to master's
  `runtime:call-windowed-state`. Rail: `objectDoorGate.test.js` +4 shapes (`t10_cum/pivot/stoch/vwap`, x3 cases).
- Python mirror `api/services/ast_interpret.py`: **not touched.** The new kernels are runtime-lane-only members (no columnar
  twin, like `rsiPine`/`barssincePine`); the columnar table functions they are graded against are unchanged, so no Python
  twin is owed. The Python gate pytest runs in final-tip.
- Not served (stay refused): `ta.vwap` with anchor/stdev args, 2-argument `ta.pivothigh/low` (pure, the columnar lane answers
  it), pivot counts of 0 (the columnar lane refuses 0 too), and a PURE `ta.cum(volume)` (host ruling unchanged; only the runtime
  pane serves `ta.cum` over a run-computed value, from the first loaded bar).

## Rails (red on the T1 base f9b85fb442, green on the tip)
New `runtime/__tests__/w4StateKernels.test.js` (28). Base run (`redbase.log`: the five engine files rewritten to the T1 bytes,
six rail files run, tip bytes restored byte-exact): **34 failed | 181 passed**. Red on base: 23 of w4StateKernels (every served
shape; its controls pass), `objectDoorGate` t10_* "runtime pane builds it" x4, `carriedState` control (runtime-only count 3->6),
`finiteWindow` (cum no longer refused), `rt7PivotRightbars` x2, `vendorHarness.h4Loops` volume-divergence-by-mm. Tip: all green.
Pins moved on purpose: `h4Loops` volume-divergence-by-mm now BUILDS; `rt7PivotRightbars` parameter/literal-rightbars cases build
(control keeps the refusal); `finiteWindow` specimen of "no entry" is now `ta.cog`; `carriedState` runtime-only count 6.

## Mutations (mutate.py; mut1..mut4 logs; test files w4StateKernels + objectDoorGate [+ rt7PivotRightbars])
| mutation | killed by |
|---|---|
| cum resets on na | cum columnar / holes |
| pivot without delay (centre = newest) | columnar pivot, delay rail |
| pivot strict on left / tie admitted on right | columnar pivot (plateau fixture) |
| pivot ring answers before full | **equivalent** (unfilled slots are NaN; `beats(c, NaN)` is false) |
| pivot ignores an na in window | **equivalent** (same reason; `pivotCol`'s own comment names it) |
| stoch zero range 0 / no restart on na / answers early | zero-range, interior-hole, columnar warm-up |
| vwap never resets / non-finite price does not blank session / no-instant answers / volume weight / key drops day | session accumulator, hole, no-instants, close-weight rails |
| FE kernels at the object door | objectDoorGate t10_* |
| FE v5 bare names owned | v4/v5 bare-name rail |
| FE own function ignored | own-function rail |
| stoch high/low swapped; pivot fn swapped; vwap series | columnar rails |
| span ceiling off; named arg accepted; count 0 (left, right, stoch length) | refusal rails |
| unknown rightbars no longer falls through | rt7PivotRightbars control |
| VM drops third input / drops `m`; lowerIr drops third push | stoch / pivot rails |

A round-1 survivor (2-arg pivot default high/low) was a dead branch (a pure call never reaches the lane): removed.

## measure-pair (base `pine-dsk-mpbase2` = f9b85fb442 on both lanes; `== side tip 22ad7169f5` / `== side base f9b85fb442`)
| lane | C18 out-*.json | C18 probe-*.json | harness TOTAL (tip = base) | verdicts.json | census diffs |
|---|---|---|---|---|---|
| 0 | IDENTICAL (ms ignored) | IDENTICAL | 336: MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 | identical | 6 / 967 |
| 1 | IDENTICAL | IDENTICAL | 336: MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 | identical | 11 / 967 |

**Object-door census change: none** (C18 out/probe identical on both lanes; the stage-1 script adx-and-di-for-v4 has no diff).

Lane 0 census (the runtime probe field): INTENDED attach False->True for `committed:volume-divergence-by-mm` (pivotlow wall) and
`reference:stoch-money-flow-admf-absolute-strength-index-asi-ci8dh` (ta.stoch wall; `clean` stays false); peel-step drop counts on
`volatility-coil-edge-bullbyte` and `luxy-momentum...` (artefacts of the moved walls); `multi-timeframe-trend-indicator` and
`market-structure-with-inducements-sweeps-luxalgo` differ only in translator timeout wording/peel counts (wall-clock budget
noise, no T10 code path).

Lane 1 census: INTENDED step-0 attach False->True for the same two scripts. Wall/peel movements with no step-0 attach change:
`neural-network-buy-and-sell-signals` (pivothigh wall passed, next wall `ta.highest(sig_high[..])` history-expression),
`advanced-custom-multi-ma-signals-emasmavwmavwap`, `volume-suite-by-leviathan`, `hma-kahlman-trend-trendlines`,
`strong-knn-classifier`, `advance-decline-line` (stuck `pine:constant-only` -> `runtime:request`),
`best-rsi-divergences-screener` and `...-regular-and-hidden` (peel reaches), `multi-timeframe-trend-indicator` (peel count).
0 unintended. `coral-trend-indicator-lazybear` and `anchored-vwap-pinch-handoff...` (named in the spec) show no census row
change: their blocking wall is not one of the forms served (anchored/banded vwap stays refused).

Base-pin note: `pine-dsk-mpbase2` read f9b85fb442 at the start of each side and after the base side's census; by the time the
job finished another lane had moved it (HEAD 5d95103c8a). The base harness totals (93/103/140 lane 0, 111/107/118 lane 1)
equal the programme's baseline numbers, so the base side was f9b85fb442-equivalent.

## Engine bump
**Yes.** Refusals become served values on the runtime lane (cum/pivot/stoch/vwap). Not edited here (coordinator).

## Open items
- Interior-hole stoch is the causal restart, not the acausal `finiteTailStart` (they agree on leading-prefix holes and after
  the last hole); no TradingView capture grades stoch/pivot over a gappy runtime source (capture-row candidate).
- vwap session = ET calendar day like `computeVWAP` (non-ET exchanges inherit that house rule); anchored/stdev forms refused.

## Final-tip numbers
`final-tip.sh pine-dsk-w4t10 dsk-w4t10/final tests/test_ast_interpret.py tests/test_ast_interpret_c12r_work.py tests/test_script_engine_version_gate.py`
on tip `490146fe3f` (tree identical to the engine tip `22ad7169f5` apart from docs): gate pytest 46 passed; ast_interpret +
engine-version-gate pytest 113 passed; hygiene clean; vitest chart+hooks `Test Files 1 failed | 1335 passed | 27 skipped (1363)`,
`Tests 1 failed | 22422 passed | 118 skipped (22541)`. The one failure is `pollingSites.rail` (known baseline, red on every master).
`settingsScope.rail` passed in this run. Logs `runs/dsk-w4t10/final/`.
Engine-folder run on the pre-final tree (`eng.log`) also showed measure-test timeouts under load only (re-run green alone) and the
`enumerationSites` ledger scan, fixed by writing the kernel table without bare indicator-id keys.
