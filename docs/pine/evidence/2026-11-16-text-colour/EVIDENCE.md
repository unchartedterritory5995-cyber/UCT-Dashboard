# TC: text and colour values (coverage unit, 2026-11-16)

Branch `feat/pine-coverage-text-colour` (off master `5007f3a43e`; master merged in up to `#1464`, engine 62 on master). PR #1467.
No engine number is taken: two `NUMBER PENDING` lines in `scriptEngineVersion.js`; the coordinator numbers the train.
The runtime lane stays dark for members; nothing is armed.

## What is served now, and what witnesses it

| shape | lane | witness |
|---|---|---|
| a parameter declared `color` holds a colour (`method transp(color x, int t) => color.new(x, t)`) | runtime | Pine v6 User Manual, *User-defined functions* > *Declaring parameter types* > *Type keywords* (read 2026-11-16): "If a parameter declaration includes a type keyword, it accepts only arguments of that type, or arguments that Pine can automatically cast to that type." |
| a script's own method in the dotted form (`coloring.transp(80)`) is the call it rewrites to | runtime, host objects | the rewrite `recv.m(a)` -> `m(recv, a)` the runtime front end (`methodCallOf`, C11) and the Resolver's read methods (`inlineReadMethod`, C11c) already make; capture `volatility-trend-score-backquant-rddt-1d-2026-11-14` (below) |
| an UNTYPED parameter holds a colour in the copy compiled for a call site whose argument is one (`f_safeColor(baseColor, t) => color.new(baseColor, t)`) | runtime | same manual section: "If a function parameter does not have a type keyword in its declaration, its type is initially undefined. In each separate call to the function, the parameter automatically inherits the same type as its specified argument." (the C35 specialisation, keyed by the colour parameters) |
| a helper whose value is a `var color` it reassigns is a colour | runtime | WS-E's declared-type rule (`colourTypedNamesOf`), read for a function's result |
| a colour constructor in a held helper body is pointwise (a colour helper in one arm of `?:`) | runtime | `color.new` / `color.rgb` / `color.from_gradient` read their arguments on the bar and keep nothing |
| `==` / `!=` between two colours | runtime | Pine reference v4/v5, operators: "Equal to. Applicable to expressions of any type." / "Not equal to. Applicable to expressions of any type."; one colour is one 0xTTBBGGRR word whose byte is the complement of TradingView's packed opacity byte (C29), so equal words are equal vendor words. Served only where each operand is written with a whole-number transparency (or none) |
| a colour's past (`scolor[1]`), committed on its line | runtime | Pine reference `[]`: "Series subscript. Provides access to previous values of series expr1." |
| v4 `iff(c, a, b)` with colour arms | runtime | Pine v4 reference, `iff`: "does exactly the same thing as ternary conditional operator ?: but in a functional style" (syntax lists `→ series[color]`) |
| the colour constants follow the script's version (v6 red / teal / yellow) | both (unchanged, now railed on the runtime lane) | Pine v6 migration guide, *Color changes*: "The color values behind some of the `color.*` constants have changed in Pine v6 to better reflect the TradingView palette": `color.red` #FF5252 -> #F23645, `color.teal` #00897B -> #089981, `color.yellow` #FFEB3B -> #FDD835 |
| `str.tostring(x, format.mintick)` at the binding's witnessed tick TEXT | runtime | CBC-FMT S10 `vw-fmt-tie-readings` T08-T12 (the one tick formatter, `tickNumberText`); S17 `vw-cs2-label-format-rddt-1d-2026-11-15` label 6 "98.45" and s21 `vw-cs2-label-format-v6-direct` label 6, now printed by the runtime lane (MATCH, `vendorHarness.cbcLiteralText.test.js`) |
| a written pattern with text around it or grouping by three (`"#.# X"`) | runtime | the host lane's one formatter (`formatPatternedNumber`, F3: swing-highlow-zigzag-chartprime RDDT/SPY; CBC-FMT F9 grouping by three, S10 T20) |
| `chart.fg_color.transp(50)` in a drawing colour reads as `color.new(chart.fg_color, 50)` | host objects (production) | capture `volatility-trend-score-backquant-rddt-1d-2026-11-14`: objects MATCH (2 lines, colours 2 of 2 theme-relative) on the runtime-on lane |

## Still refused, by name (queue `docs/pine/capture-queue-2026-11-16-text-colour.md`, probe `vw-tc1-colour-na-compare.pine`)

- a colour compared with the literal `na` (`c != na`, `c == na`): `runtime:colour` (rows C1-C3, N1-N3); engulfing-sinyal waits on it.
- `==` / `!=` over a colour written with a fractional transparency or a gradient: `runtime:colour` (rows E1-E2).
- any other operator over a colour, a colour against a number: `runtime:colour` (Pine does not compile either).
- an untyped parameter whose call site passes a price: the held `runtime:colour`.
- `str.tostring` with no witnessed tick (`format:tick-unsettled`), a tie no capture shows (`format:tick-tie-uncaptured`), a `%` / `‰` pattern, `format.percent`, `format.volume`, a computed format: `runtime:call-text-state` or the run stops by the format name.
- `chart.bg_color` / `chart.fg_color` as a value on the runtime lane (builtin family; coordinator ruling: stays refused).

## Colour arithmetic this unit relies on, unchanged (already witnessed)

- `color.new(c, t)` REPLACES the transparency and keeps red, green and blue byte for byte; the paint is the exact `t`
  (`round((1 - t/100) x 255)`, C29 / Uncharted Clouds capture A), the read-back `color.t` truncates (C29 70.5 -> 70).
- `color.from_gradient(v, lo, hi, a, b)` (C29 `vw-gradient-spy-1d-2026-09-30`, C48 `vw-colour-components-spy-1d-2026-10-01`):
  the position is CLAMPED to [0, 1] beyond the bounds (the endpoint colour), an `na` value or bound or `lo == hi` is the
  zero colour (r = g = b = 0, transparency 100), reversed bounds hold the bottom colour between them and are not served
  outside them; the opacity bytes blend and the channels blend premultiplied by them, truncated.
- Colour constants follow the script's version (`pinePalette.js` `PALETTE_BY_VERSION`; v6 red #F23645, teal #089981,
  yellow #FDD835 - the capture readings red r = 242, yellow g = 216 - against v5 #FF5252 / #00897B / #FFEB3B), railed on
  the runtime lane by `tcTextColour.test.js`.

## Admission (`PINE_RUNTIME_CAPABILITY_ADMISSION=on`)

The real admission (`tools/pine_coverage/capability_admission.py::admission_row` on this tree, the committed registry
and kill list) for each newly transferring script, and every committed capture whose source hashes to it:

| script | admitted | missing | committed captures | their runtime-on verdict on this tree |
|---|---|---|---|---|
| committed:volatility-trend-score-backquant | no | `method-def` | `volatility-trend-score-backquant-rddt-1d-2026-11-14` | INCONCLUSIVE (3 plots MATCH, objects MATCH, the plot titled "" unpaired); master: INCONCLUSIVE (refused) |
| reference:color-gradient-framework-pinecoders | YES | - | none | - |
| reference:edufx-amd | no | `obj:box` | none | - |
| reference:study-for-squeeze-momentum-indicator-lazybear | YES | - | none | - |
| reference:vwap-supply-demand-zones-pro | no | `obj:box`, `obj:table` | none | - |

No admitted script has a DIVERGE capture, so nothing goes on the kill list. The two admitted ones are queued for
capture (rows TC-A1 / TC-A2 in `docs/pine/capture-queue-2026-11-16-text-colour.md`); a DIVERGE there puts the script on
`api/data/pine_runtime_killlist.json` by its sha256 in a follow-up.

## Measurements

### Coverage: the census test on this tree (`coverageMapDoorCensus.measure.test.js`, one lock hold, head `26404e8c6d`)

Over the 41 text-colour targets + controls (every sample script touching a changed feature: typed / untyped colour
parameters, colour `==` / `!=`, `iff` with colours, `format.mintick`, patterned `str.tostring`, methods with drawings):

| lane | scripts run | transfer before (engine-60 census) | after | gained | lost |
|---|---:|---:|---:|---:|---:|
| runtime-on | 241 (41 targets, 200 controls) | 37 | **42** | **5** | 0 |
| production | 88 (41 targets, 47 controls) | 22 | 22 | 0 | 0 |

Lane proofs: `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 964, host refusals 908)`; `LANE MEASURED:
production (gate CLOSED, runtime lane reached 0, host refusals 143)`. CI's coverage ratchet over the 266 committed scripts
(run 43948529016): runtime-on 87 transfer vs snapshot 86, gained volatility-trend-score, lost 0; production 58 = 58.
`docs/pine/coverage-ratchet.json` updated from that run's own rows (`coverage_ratchet.py --lane runtime-on --rows ... --write`).

**Newly transferring (runtime-on): 5** - `committed:volatility-trend-score-backquant`,
`reference:color-gradient-framework-pinecoders`, `reference:edufx-amd`,
`reference:study-for-squeeze-momentum-indicator-lazybear`, `reference:vwap-supply-demand-zones-pro`.

Per target, the step-0 wall before -> after:

| target | runtime-on before | runtime-on after | production before | production after |
|---|---|---|---|---|
| `builtin:open-interest` | pine:builtin L3 | pine:builtin L3 | pine:tuple | pine:tuple |
| `committed:atr-trend-bands-misu` | pine:library-denied L8 | pine:library-denied L8 | pine:library-denied | pine:library-denied |
| `committed:black-scholes-option-pricing-model-w-greeks-loxx` | pine:library-denied L13 | pine:library-denied L13 | pine:library-denied | pine:library-denied |
| `committed:candlestick-patterns-on-backtest` | runtime:library L6 | runtime:library L6 | pine:module | pine:module |
| `committed:heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` | runtime:function-global-state L457 | runtime:function-global-state L457 | pine:cycle | pine:cycle |
| `committed:ict-killzones-pivots-tfo` | attached, objects partial: create@486: pine:builtin `timeframe.in_seconds` | attached, objects partial: create@486: pine:builtin `timeframe.in_seconds` | attached, objects partial: create@486: pine:builtin `timeframe.in_seconds` | attached, objects partial: create@486: pine:builtin `timeframe.in_seconds` |
| `committed:machine-learning-logistic-regression-v3` | runtime:conditional-history L94 | runtime:conditional-history L94 | pine:request | pine:request |
| `committed:machine-learning-moving-average-backquant` | runtime:statement L199 | runtime:statement L199 | pine:reassign | pine:reassign |
| `committed:market-structure-trend-targets-chartprime` | pine:function L39 | pine:function L39 | pine:statement | pine:statement |
| `committed:mtf-key-levels-support-and-resistance` | attached, objects partial: create:label@164: pine:text-value | attached, objects partial: create:label@164: pine:text-value | attached, objects partial: create:label@164: pine:text-value | attached, objects partial: create:label@164: pine:text-value |
| `committed:multiple-mtf-moving-average-xdecow` | runtime:request-with-state L160 | runtime:request-with-state L160 | pine:builtin | pine:builtin |
| `committed:power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations` | pine:builtin L53 | pine:builtin L53 | pine:no-output | pine:no-output |
| `committed:support-resistance-mtf-flux-charts` | runtime:loop L270 | runtime:loop L270 | pine:type | pine:type |
| `committed:volatility-coil-edge-bullbyte` | runtime:call-text-state L662 | runtime:colour L879 | pine:reassign | pine:reassign |
| `committed:volatility-trend-score-backquant` | runtime:colour L105 | TRANSFERS | pine:type | pine:type |
| `committed:vold-market-breadth` | attached, objects partial: cell:text@38: pine:text-value | attached, objects partial: cell:text@38: pine:text-value | attached, objects partial: cell:text@38: pine:text-value | attached, objects partial: cell:text@38: pine:text-value |
| `committed:volume-delta-hapharmonic` | runtime:call-text-state L91 | runtime:call-text-state L91 | pine:type | pine:type |
| `committed:volume-footprint-measuring-classical-indicators-by-math-geometry-intro` | runtime:library L13 | runtime:library L13 | pine:module | pine:module |
| `reference:color-gradient-framework-pinecoders` | runtime:colour L189 | TRANSFERS | pine:text-value | pine:text-value |
| `reference:cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new` | attached, objects partial: cell:text@351: pine:text-value | attached, objects partial: cell:text@351: pine:text-value | attached, objects partial: cell:text@351: pine:text-value | attached, objects partial: cell:text@351: pine:text-value |
| `reference:ct-displacement-fvg-toolkit` | pine:drawing L171 | pine:drawing L171 | pine:reassign | pine:reassign |
| `reference:dynamic-higher-timeframe-fibonacci-pivot-points` | attached, objects partial: create:label@292: pine:text-value | attached, objects partial: create:label@292: pine:text-value | attached, objects partial: create:label@292: pine:text-value | attached, objects partial: create:label@292: pine:text-value |
| `reference:dynamic-support-and-resistance-with-trend-lines-multi-language` | runtime:library L6 | runtime:library L6 | pine:module | pine:module |
| `reference:edufx-amd` | runtime:colour L64 | TRANSFERS | pine:no-output | pine:no-output |
| `reference:engulfing-sinyal` | pine:colour-value L7 | runtime:colour L14 | pine:colour-value | pine:colour-value |
| `reference:intraday-power-3-visual` | attached, objects partial: create:line@132: pine:text-value | attached, objects partial: create:line@132: pine:text-value | attached, objects partial: create:line@132: pine:text-value | attached, objects partial: create:line@132: pine:text-value |
| `reference:liquidity-pools-pro-willyalgotrader` | pine:colour-value L176 | pine:colour-value L176 | pine:prop-unreadable | pine:prop-unreadable |
| `reference:luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-` | pine:builtin L230 | pine:builtin L230 | pine:state | pine:state |
| `reference:luxy-super-duper-supertrend-predictor-engine` | runtime:history-dynamic-offset L214 | runtime:history-dynamic-offset L214 | pine:text-value | pine:text-value |
| `reference:mema-bb-parabolic-sar` | runtime:colour L19 | runtime:colour L19 | pine:function | pine:function |
| `reference:mirage-liquidity-sweep-pro-willyalgotrader` | pine:colour-value L176 | pine:colour-value L176 | pine:reassign | pine:reassign |
| `reference:nadaraya-watson-trend-quantalgo` | runtime:block-value L59 | runtime:block-value L59 | pine:reassign | pine:reassign |
| `reference:ripster-rvol-saty-atr-levels-v6-options-dashboard` | runtime:request L285 | runtime:request L285 | pine:request | pine:request |
| `reference:rsi-entry-engine-trade-w-samet` | pine:builtin L349 | pine:builtin L349 | pine:reassign | pine:reassign |
| `reference:smc-target-liquidity-v35-manual-distance-control` | runtime:history-expression L107 | runtime:history-expression L107 | pine:no-output | pine:no-output |
| `reference:study-for-squeeze-momentum-indicator-lazybear` | pine:colour-value L45 | TRANSFERS | pine:colour-value | pine:colour-value |
| `reference:support-and-resistance-zones-feels` | runtime:loop L142 | runtime:loop L142 | pine:block | pine:block |
| `reference:volume-profile-free-pro-by-rrb` | pine:builtin L322 | pine:builtin L322 | pine:reassign | pine:reassign |
| `reference:volume-profile-free-ultra-sli-by-rrb` | pine:text-value L294 | pine:text-value L294 | pine:reassign | pine:reassign |
| `reference:vwap-supply-demand-zones-pro` | runtime:colour L58 | TRANSFERS | pine:reassign | pine:reassign |
| `reference:williams-r-rsi-ema-tendance-silver-wong` | attached, objects partial: create:label@158: pine:text-value | attached, objects partial: create:label@158: pine:text-value | attached, objects partial: create:label@158: pine:text-value | attached, objects partial: create:label@158: pine:text-value |

### Harness

CI run 43948529016 (`pine-heavy-verdicts`) against master's committed snapshots: 0 verdict moves on either lane (production
MATCH 197 / DIVERGE 58, runtime-on MATCH 259 / DIVERGE 53, as on master), no new DIVERGE.

### Tests and mutants

Remote tests runs 43940389426 (pytest 1221 passed / 1 skipped; vitest 4522 passed, 1 failed - a stale control, fixed - 8 skipped) and 43942715529 (37 passed); pine-heavy run 43948529016 all legs green.

21 of 21 KILLED by pine-heavy's mutants job (`tools/ci_mutant_runner.py` -> `tools/mutation_check.py`; dispatch run 43958530036, job 133619413492, on `f931d49e32`, manifest `ci/mutants/tc-text-colour.json`): each rail went red naming the expected test, went green again after the restore, and every file was restored byte-identical (sha256 checked). A first local lock hold also reported 21/21 killed with its control green (4 files, 42 tests), but its killed runs' console logs came back empty, so it is not counted.

| id | file | what it breaks | rail must fail naming | result |
|---|---|---|---|---|
| M1-typed-colour-param | pineRuntimeFrontend.js | a parameter declared `color` is not marked a colour | "compiles and paints" | KILLED, green again after restore, byte-equal |
| M2-method-call-colour | pineRuntimeFrontend.js | a method in the dotted form is not read as the call it rewrites to | "compiles and paints" | KILLED, green again after restore, byte-equal |
| M3-colour-specialisation-off | pineRuntimeFrontend.js | no per-call-site copy for an untyped colour parameter | "two call sites, two colours" | KILLED, green again after restore, byte-equal |
| M4-colourParams-not-named | pineRuntimeFrontend.js | the colour refusal does not name its untyped parameter | "two call sites, two colours" | KILLED, green again after restore, byte-equal |
| M5-colour-ctor-not-pointwise | pineRuntimeFrontend.js | a colour constructor in a held helper body reads as history | "is pointwise" | KILLED, green again after restore, byte-equal |
| M6-var-color-result | pineRuntimeFrontend.js | a helper ending in a reassigned var color is not a colour | "reassigns is a colour" | KILLED, green again after restore, byte-equal |
| M7-iff-colour-arms | pineRuntimeFrontend.js | v4 iff with colour arms is not a colour | "answer bar by bar" | KILLED, green again after restore, byte-equal |
| M8-offset-is-colour | pineRuntimeFrontend.js | a colour history read is not a colour | "answer bar by bar" | KILLED, green again after restore, byte-equal |
| M9-colour-history-commit | pineRuntimeFrontend.js | a colour history read is not committed on its line | "answer bar by bar" | KILLED, green again after restore, byte-equal |
| M10-route-colour-fallthrough | pineRuntimeFrontend.js | a pure colour subtree stays with the columnar refusal | "answer bar by bar" | KILLED, green again after restore, byte-equal |
| M11-na-compare-served | pineRuntimeFrontend.js | a colour against the literal na is served | "against the literal" | KILLED, green again after restore, byte-equal |
| M12-fractional-served | pineRuntimeFrontend.js | == over a fractional transparency is served | "fractional one is refused" | KILLED, green again after restore, byte-equal |
| M13-other-operator-served | pineRuntimeFrontend.js | an ordering operator over colours is served | "any other operator over a colour" | KILLED, green again after restore, byte-equal |
| M14-mintick-branch-off | pineRuntimeFrontend.js | format.mintick is refused on the runtime lane again | "RDDT (NYSE, tick 0.01)" | KILLED, green again after restore, byte-equal |
| M15-mintick-guessed-tick | pineRuntimeFrontend.js | an unsettled tick is guessed as 0.01 | "no symbol, no witnessed tick" | KILLED, green again after restore, byte-equal |
| M16-patterned-off | pineRuntimeFrontend.js | a written pattern with text is refused again | "RDDT (NYSE, tick 0.01)" | KILLED, green again after restore, byte-equal |
| M17-tick-why-wrong | pineTextFormat.js | an unsettled tick is named a tie | "no symbol, no witnessed tick" | KILLED, green again after restore, byte-equal |
| M18-host-method-colour-off | pine.js | the host object reader does not open a read method | "reads exactly as" | KILLED, green again after restore, byte-equal |
| M19-runtime-text-op-number | text.js | the tick text op prints the raw number | "RDDT (NYSE, tick 0.01)" | KILLED, green again after restore, byte-equal |
| M20-differential-colour-new-off-by-one | colours.js | the runtime color.new paints transparency + 1 | "a v6 palette constant at a literal transparency" | KILLED, green again after restore, byte-equal |
| M21-colour-cycle-guard-off | pineRuntimeFrontend.js | the colour walker follows a binding it is already reading | "Maximum call stack" | KILLED, green again after restore, byte-equal |


