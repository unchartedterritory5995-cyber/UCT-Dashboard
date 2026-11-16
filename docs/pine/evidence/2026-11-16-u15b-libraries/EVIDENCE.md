# U15 Phase B: libraries (2026-11-16)

The unit has two halves, both approved by the owner on 2026-11-16 in the coordinator's session.
- **(B) the engine.** A Pine v5 library imported by a v6 script. U15 measured 15 such scripts, all
  refused `pine:module`.
- **(A) the promotion.** Re-grade the held-out library versions on engine 61, update
  `tools/pine_library/promotion_allowlist.json` to the new truth, and write the owner's runbook. Not
  performed here.

No library source is in this repository. Every library in the rails is a fixture written from scratch.
The graded sources are in the out-of-git scratch store U15 measured with
(`%LOCALAPPDATA%/uct-vendor-batch/pine-libraries-scratch`, 83 entries). Each is pinned by its sha256.

## What the reference states about a v5 library inside a v6 script

Nothing that settles how it runs. Read on 2026-11-16:
- **The v6 reference.** `import` says only that a script imports a published library by
  `{username}/{libraryName}/{libraryVersion}`: "Used to load an external library() into a script and
  bind its functions to a namespace". `library`, `export`, `type` and `method` say nothing about
  versions.
- **The User Manual, Libraries.** It says a library's own source "includes the `//@version` compiler
  annotation to specify the Pine Script version", and that "Scripts do not automatically use the
  latest version of a library". That second sentence is about the LIBRARY's version number, not the
  Pine version. It has no sentence on importing a library written in another Pine version.
- **The migration guide, "To Pine Script version 6".** It does not mention `import`, nor a library of
  another version. It does list every construct whose meaning changed from v5 to v6.

So, per the coordinator's rule (2026-11-16), **cross-version linking needs a capture before it
serves.** Two gates enforce it, and the probe below asks the general question.

## (B) What the engine does now

`app/src/components/chart/engine/ast/pineLibraryVersion.js`, called by the linker
(`pineLibraries.js`). A v5 library inside a v6 script is linked only when BOTH hold:

1. **The version is on the admission table** (`ast/pineLibraryCrossVersion.json`).
   - A row is allowed only for a `promote` version of the promotion allowlist whose every newly
     attaching v6 importer grades MATCH host-only. That is the coordinator's rule: U15's promotion
     rule, applied to the new importers. `tests/test_pine_library_pinning.py` holds the table to it.
   - The table fails closed: a document it cannot read admits nothing.
   - So Phase B never widens the reach of a version a store holds that nobody graded in a v6 script.
2. **The code the script reaches holds nothing the migration guide changed**
   (`crossVersionDifference`). Every check is conservative: a construct the token stream cannot show
   to mean the same in both versions is refused.
   - `and` / `or` with a call on its right other than a pure read (Lazy evaluation of conditions).
   - Bool `na`: `na()` / `nz()` / `fixnan()` of a value not shown to be a number, the history of a
     bool, `na` given to a bool, and an `if` / `switch` value without `else` / a default arm whose
     arms may be bool (Boolean values cannot be na).
   - A condition not shown to be a bool (Explicit "bool" casting).
   - A division of two values that may be `const int` (Fractional division of constants). A name
     bound to a const int stays one when reassigned, as `vw-int-div-assign` D05 witnessed.
   - `timeframe.period` (Timeframes must include a multiplier).
   - `color.red`, `color.teal`, `color.yellow`, and `label.new` without `textcolor` (Color changes).
   - A `for` end bound that calls anything but a size read of a collection the loop does not resize,
     or that reads a name the loop reassigns (Dynamic for loop boundaries).
   - `request.*`, `strategy.*`, the `transp` / `offset` / `linewidth` arguments, a repeated named
     argument, the history of a literal or of a field, and a negative literal array index.

Otherwise the import line is refused **by name**: `pine:library-version`, in both lanes, with the
construct and the guide's section in the sentence. A v6 library inside a v5 script stays refused as
before (`pine:module`). The guide reads v5 → v6 only.

## The probe (queued, row LB1)

`docs/pine/probes/lib-v5-in-v6.pine`, queued as `lib-v5-in-v6@NYSE:RDDT@D`
(`docs/pine/capture-queue-2026-11-16-libraries-phase-b.md`). It is a v6 script with four constant
plots, each computed inside a published v5 library: `BarefootJoey/AstroLib/1` and
`boitoki/Utilities/11`, both MPL-2.0, imported and never copied.

| plot | under v5 rules | under v6 rules |
|---|---|---|
| r of `color.red` | 255 | 242 |
| g of `color.yellow` | 235 | 216 |
| a `-34 / 60` const-int division inside `riset` | `DegSin(0)` | `DegSin(-0.5667)` |
| `timeframe.period` inside `auto_htf`, on a 1D chart | length 2 | length 3 |

## (A) The re-grade on engine 61

**Hold 1, tree `2b20c5d2d7`.** That is origin/master `e9807547d0` (engine 61) plus Phase B; Phase B changes
only v5-in-v6 linking, so no same-version grade can move. The probe is `f4Sweep.measure.test.js`, narrowed
to the 92 capture ids whose script imports a library: `F4_SWEEP_ONLY`, the out-of-git capture folders
`runs/s11`, `s12` and `cq1` in `F4_SWEEP_DIRS`, and the scratch store in `PINE_LIBRARY_STORE`. `on` is
host-only (objects pane on, runtime pane off), the lane members are served. `runtime` is the same capture
with the runtime pane on.

| version | importers that attach host-only | importers refused by name (draw nothing) | outcome |
|---|---|---|---|
| theEccentricTrader PubLibSwing/3, PubLibPattern/4, PubLibCandleTrend/2, PubLibTrend/3 | All Chart Patterns RDDT 1D, SPY 1D: MATCH, MATCH | none | stays `promote` |
| **TradingView/ta/11** (+ RelativeValue/3) | Chandelier exit RDDT, Pring's special K SPY, Ulcer index RDDT, **Aroon oscillator RDDT**: MATCH x4, in both states | KAMA, Price Momentum Oscillator (`pine:function-def`) | **joins `promote`**. Aroon was DIVERGE on engine 57; it MATCHes on 61 |
| PineCoders/ConditionalAverages/2 | none: Rolling VWAP is `pine:block` host-only on 3 captures (MATCH x3 with the runtime pane on) | Rolling VWAP | stays held: no host-only witness |
| PineCoders/VisibleChart/3 | Volume Profile Heatmap RDDT: INCONCLUSIVE | none | stays held |

**The three denied versions.** All three are denied for a DIVERGE (a defect), never a licence; each is
MPL-2.0. So they were measured (hold 2, tree `37f2655e19`) with the deny list emptied **in the working tree
only**. A shell trap restored it, and `git hash-object` equals HEAD's blob `2888387960`. The f4 sweep then
ran with the full scratch store:

| version | captures | host-only | runtime pane on | outcome |
|---|---|---|---|---|
| Fontiramisu/fontilab/11 | ATR Trend Bands RDDT | refused `pine:timeout` | DIVERGE | stays denied |
| loxx/loxxexpandedsourcetypes/4 | Black-Scholes RDDT, AAPL, JPM, SPY | DIVERGE x4 (table cells 22 vs 8) | DIVERGE x4 | stays denied |
| loxx/loxxexpandedsourcetypes/4 | Deviation-Scaled MA x2, STD-Filtered Hull MA x2 | refused `pine:state`, `pine:block` | refused | (no picture) |
| TradingView/ValueAtTime/2 | Performance RDDT, SPY | DIVERGE x2 (table cells 55 vs 0) | DIVERGE x2 | stays denied |

**Every other version the sample imports has no importer that attaches host-only.** Each is refused by name
at its next wall, so there is no MATCH witness and no promotion. The 10 Trendoscope CC-BY-NC-SA versions
are never promoted.

`tools/pine_library/promotion_allowlist.json` now says exactly this:
- `promote`: the four theEccentricTrader versions, TradingView/ta/11 and TradingView/RelativeValue/3.
- Every row records its `imports`. The rail requires every import of a promoted version to be promoted.
- Importers refused by name are listed under `notAttaching`.
- The engine-61 re-grade is on each held row.

## Coverage: per importing script, before -> after, with the store as it will be after promotion

The census is the member door (`coverageMapDoorCensus.measure.test.js`). It now takes an opt-in
`PINE_LIBRARY_STORE`, measure-only: a row measured with a store carries `libraryStore`. It ran over the 65
importing sample scripts plus 12 transferring controls, in both lanes.
- Store: the six `promote` versions, copied sha-checked from the scratch store
  (`promotion_check.py check --exact`: PASS).
- Tree: `37f2655e19`, hold 2.
- Before: the engine-60 census rows (`runs/cov-e60/{prod,rt}/census.jsonl`, empty store).
- Transfer predicates: the coverage map's own (`coverage_map.transfers_fully`; the runtime-on lane's
  `transfers`).

**5 scripts newly transfer, in BOTH lanes; 0 lost; all 12 controls unchanged** (11 transfer, 1
attached-dirty, as before):
- builtin:aroon-oscillator, builtin:chandelier-exit, builtin:pring039s-special-k and builtin:ulcer-index
  (ta/11);
- committed:all-chart-patterns-theeccentrictrader (theEccentricTrader).

Each newly served output is witnessed by its own capture graded MATCH host-only on this tree:
- **All Chart Patterns:** two COMMITTED captures (`tests/fixtures/vendor/harness/all-chart-patterns-*`).
- **The four TradingView built-ins:** licence-held captures (`runs/s11-2026-11-15/captures`, never
  committed), the ones U15 graded.

For contrast, with the deny list also emptied (scratch only): ATR Trend Bands would transfer on the
runtime-on lane. Its runtime capture DIVERGEs, which is exactly why it stays denied.

| script | before, prod / runtime-on | after, prod | after, runtime-on |
|---|---|---|---|
| `builtin:24-hour-volume` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:aroon-oscillator` | pine:module / pine:module / rt runtime:library | **TRANSFERS** | **TRANSFERS** |
| `builtin:auto-fib-extension` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:auto-fib-retracement` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:auto-pitchfork` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:chandelier-exit` | pine:module / pine:module / rt runtime:library | **TRANSFERS** | **TRANSFERS** |
| `builtin:cumulative-volume-delta` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:kaufman039s-adaptive-moving-average` | pine:module / pine:module / rt runtime:library | pine:function-def | pine:function-def / rt runtime:statement |
| `builtin:net-volume` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:performance` | pine:library-denied / pine:library-denied | pine:library-denied | pine:library-denied |
| `builtin:price-momentum-oscillator` | pine:module / pine:module / rt runtime:library | pine:function-def | pine:function-def / rt runtime:call-undeclared-builtin-state |
| `builtin:pring039s-special-k` | pine:module / pine:module / rt runtime:library | **TRANSFERS** | **TRANSFERS** |
| `builtin:relative-volume-at-time` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:technical-ratings-strategy` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:technical-ratings` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:ulcer-index` | pine:module / pine:module / rt runtime:library | **TRANSFERS** | **TRANSFERS** |
| `builtin:updown-volume` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:volume-delta` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `builtin:zigzag` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:adaptive-trend-following-suite-alpha-extract` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:all-chart-patterns-theeccentrictrader` | pine:module / pine:module / rt runtime:library | **TRANSFERS** | **TRANSFERS** |
| `committed:atr-stop-loss-indicator` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:atr-trend-bands-misu` | pine:library-denied / pine:library-denied | pine:library-denied | pine:library-denied |
| `committed:auto-trendlines-tradingfinder-support-resistance-signal-alerts` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:black-scholes-option-pricing-model-w-greeks-loxx` | pine:library-denied / pine:library-denied | pine:library-denied | pine:library-denied |
| `committed:bull-vs-bear-market-intraday-sessions-kioseff-trading` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:candlestick-patterns-on-backtest` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:chart-vwap` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:cvd-cumulative-volume-delta-candles` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:cvd-cumulative-volume-delta-chart` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:delta-volume-candles-lucf` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:deviation-scaled-moving-average-w-dsl-loxx` | pine:library-denied / pine:library-denied | pine:library-denied | pine:library-denied |
| `committed:fx-market-sessions` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:heikin-ashi-supertrend` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:kalman-psar-backquant` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:machine-learning-lorentzian-classification` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:machine-learning-lorentzian-classification` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:machine-learning-rsi-bullvision` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:pivot-trendlines-with-breaks-hg` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:rate-of-change` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:rolling-vwap` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:rsi-trendlines-with-breakouts-hg` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:smart-money-breakout-channels-algoalpha` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:smart-money-concept-tradingfinder-major-minor-ob-fvg-smc` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:smc-structures-and-multi-timeframe-fvg-ma-py` | pine:state / pine:state / rt runtime:function | pine:state | pine:state / rt runtime:function |
| `committed:std-filtered-adaptive-exponential-hull-moving-average-loxx` | pine:library-denied / pine:library-denied | pine:library-denied | pine:library-denied |
| `committed:stop-loss-clustering-breakouts-kioseff-trading` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:strength-of-divergence-across-multiple-indicators` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:supertrend-relative-volume-kernel-optimized-flux-charts` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:trailing-take-profit-trailing-stop-loss` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:volatility-stop-mtf` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:volume-footprint-measuring-classical-indicators-by-math-geometry-intro` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `committed:volume-profile-plus` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:auto-chart-patterns-trendoscope` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:auto-trendlines-trendoscope` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:divergence-screener-trendoscope` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:dynamic-support-and-resistance-with-trend-lines-multi-language` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:footprint-strategy` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:lorentzian-classification-advanced-trading-dashboard` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:open-interest-stochastic-money-flow-index` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:recursive-reversal-chart-patterns-trendoscope` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms` | pine:module / pine:module / rt runtime:statement | pine:module | pine:module / rt runtime:statement |
| `reference:supertrend-ladder-atr-1909capital-trendoscope` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:volume-profile-heatmap` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |
| `reference:vwap-trendfollow-strategy-wbburgin` | pine:module / pine:module / rt runtime:library | pine:module | pine:module / rt runtime:library |

Reading the "after" column:
- An `after` of `pine:module` for a script that imports an unpromoted version is the library missing from
  the store. That is the expected state; nothing is promoted that was not graded.
- The cross-version importers, with every library present (hold 1, full scratch store), stop as follows:
  - 13 are refused `pine:library-version` by the migration-guide check:
    - ta/8 `request.security_lower_tf`;
    - AlertSender `timeframe.period`;
    - Utilities/11 and ZigZag/7: a `for` bound calling `array.size` / `math.abs`;
    - ZigZag/7, LibraryCOT/3, arrayutils/10: `na()` / `nz()` of a non-number;
    - MyMovingAveragesLibrary/4: the history of a bool;
    - zigzag/5: `na` given to a bool.
  - 3 pass the check and stop at their next wall: Relative Volume at Time (ta/7) `pine:state`, 24-hour
    Volume `pine:request`, SMC structures (ZigZag/7) `pine:state`.
- None attaches, so none is graded and the admission table ships empty.

## Rails, on `37f2655e19` (hold 2)

- **vitest, 11 files, 101 passed:**
  - `pineLibraryVersion` 22, `pineLibraries` 20, `pineLibraryPinning` 16, `editorStatus.families` 14;
  - `libraryImportRefusal` 7, `noRegexLookbehind` 6, `symbolRosterSpeaks` 6;
  - `runtimeLibraryDoor` 3, `pine.guardCensus` 3, `libraryLinkParity` 2, `usePineLibraries` 2.
- **pytest** `tests/test_pine_*.py tests/test_runtime_definitions.py`, one process: **1223 passed**.
- `evidence_engine.py queue --check` PASS, `pins --check` PASS, `refusal_codes.py --check` ok (386 live, 1
  retired), `check_repo_hygiene.py` clean.

**Mutants.** All ran on `37f2655e19`. Each file was copied aside, mutated, its rail run, then restored, and
`git hash-object` equals HEAD.

| id | mutant | rail | result |
|---|---|---|---|
| LJ1 | the admission gate skipped | `pineLibraryVersion.test.js` | KILLED (2 failed) |
| LJ2 | an unreadable admission table admits everything | same | KILLED (1) |
| LJ3 | the migration-guide check answers nothing | same | KILLED (15) |
| LJ4 | `timeframe.period` not read | same | KILLED (2) |
| LJ5 | the right side of `and`/`or` not read | same | KILLED (1) |
| LJ6 | const-int division not read | same | KILLED (1) |
| LJ7 | a v6 library linked into a v5 script | same | KILLED (1) |
| LJ8 | bool history not read | same | KILLED (1) |
| LP1 | `promotion_check` ignores the pinned sha | `tests/test_pine_library_pinning.py` | KILLED (1) |
| LP2 | `install` overwrites other code | same | KILLED (1) |
| LP3 | `check` skips the import closure | same | KILLED (1) |
| LP4 | a version not promoted put on the admission table | same | KILLED (1) |

## Not done here, by instruction

- Nothing was written to any production store. No `railway` command ran.
- Nothing was enabled for members.
- The engine number is not taken: `scriptEngineVersion.js` carries a NUMBER PENDING line.
- Library sources and licence-held captures stay out of git.
