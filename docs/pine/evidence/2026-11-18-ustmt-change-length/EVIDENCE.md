# U-STMT PR 1: `ta.change(source, length)` on the runtime lane (2026-11-18)

Engine number PENDING (the coordinator numbers the train). Branch `feat/pine-statements`. Roadmap unit U-STMT
(`docs/pine/PARITY-ROADMAP-2026-11-18.md` section 5), first PR.

## What changed

`ast/pineRuntimeFrontend.js`, the `changeTarget` branch: the branch a `ta.change` call reaches when its source
is held in a slot (a `var`, a reassigned name, an expression over one). A pure source never reached it: the
columnar resolver serves `ta.change(close, 2)` from the host's rule.

1. **`ta.change(source, length)` is served** as `source - source[length]`, through the same three history paths
   the one-argument form uses (a slot's ring, a function frame's ring, a hoisted expression's series). The
   length is a whole number of bars, 1 or more, fixed before bar 0 (`foldConstNode`: a literal, a constant, an
   input at its value in force). The arguments are read by Pine's parameter names (`source`, `length`).
   Refused by name, guard `runtime:statement` with a true sentence:
   - any other length;
   - a source this lane cannot prove is a number (the host's bool sentence);
   - any other argument shape.

   Before this change the branch refused every two-argument call as "a closed-table gap", which it had stopped
   being on 2026-10-29.
2. **The branch now asks the region rule.**
   - In a `?:` arm, the one-argument form takes the witnessed per-run rule (`servedCondCall`).
   - Anywhere else in a region that does not run on every bar, the branch asks `r4Guard`. With HIST-S3, the
     value is drawn only while the region has run on every bar, and the run stops by name at the first bar it
     skips. In the drawing build it is refused by name.
   - The object door is unchanged.

## Evidence for (1)

- v6 reference, `ta.change(source, length)`: "Compares the current `source` value to its value `length` bars
  ago and returns the difference." Returns: "The difference between the values when they are numerical. When a
  'bool' source is used, returns `true` when the current source is different from the previous source."
  Remarks: "`na` values in the `source` series are included in calculations and will produce an `na` result."
- v4 reference, `change(source, length)`: "Difference between current value and previous, x - x[y]."
- Capture `vw-w4-arm-runs` row E01, `plot(ta.change(close, 2))`. It equals close - close[2] on every graded bar:
  NYSE:RDDT 1D 666 of 666, AMEX:SPY 1D 8507 of 8507. The newest bar is forming in both captures and is not
  graded.
- Precedent: the host has served exactly this rule since 2026-10-29 (`pine.js`, the `mom` expansion,
  `pine.arityHints.test.js`). After this change the lanes are one definition: a slot's `ta.change(x, 2)`
  equals the pure route's `ta.change(close, 2)` over x = close, bar for bar (rail R1).

## Evidence for (2): the defect it closes

The branch lowered `x - x[1]` off the slot's every-bar ring wherever the call stood, with no region check.
Measured at master `73f8ae6db1` on vw-w4-arm-runs-rddt-1d-2026-11-16's bars:

| script | master | this change |
|---|---|---|
| `var x = 0.0 / x := close / plot(close > open ? ta.change(x) : 0.0)` | ran to the end; bar 2 = 13.80 (59.8 - 46.0, the bar before) | bar 2 = 9.36 (59.8 - 50.44, the previous RUN), bar for bar equal to `close > open ? ta.change(close) : 0.0` on RDDT (667 bars) and SPY (8508) |
| the same with `if close > open` / `y := ta.change(x)` | ran to the end, every-bar values | stopped by name (`runtime:conditional-history`) at the first bar the block skips |

The per-run rule for the one-argument form in an arm is witnessed by vw-arm-history T05 / K03 (the pure
source). It is the same built-in and the same call-site rule whatever the source is.

**Blast radius on the coverage-map sample (679 scripts), measured before building.** The changed region paths
were instrumented and every sample script was probed on the value build and the drawing build:

- One script reaches them: `reference:fib-pivot-points-alerts__A4zY3dRcsE`, in the drawing build only.
- Its value build refuses `runtime:conditional-history` at master and with this change, identically.
- It is served by the host lane (host-clean), so no member's chart changes.
- The only script whose answer changes is `committed:machine-learning-moving-average-backquant__4d7ff59e68`, which
  now builds.

**The corpus diff, measured after building.** This PR's own pine-heavy run (44427583401, head d597bb8a62) was
diffed against train e80's run (44406509220), capture by capture, on both harness lanes:

- **Production lane: 936 captures, none moved.** What a member sees today does not change.
- **Runtime-on lane: 936 captures, 3 moved, none away from MATCH.** All three are backquant's:

| capture | e80 | this PR | what the PR run grades |
|---|---|---|---|
| `machine-learning-moving-average-backquant-rddt-1d-2026-11-14` | INCONCLUSIVE | MATCH | plot (666 bars), objects, paints and objectsV2 all agree |
| `machine-learning-moving-average-backquant-rddt-1d-2026-11-17` | INCONCLUSIVE | MATCH | plot (668 bars), objects, paints and objectsV2 all agree |
| `machine-learning-moving-average-backquant-spy-1d-2026-11-17` | INCONCLUSIVE | DIVERGE | the run stops at the array-operation limit (2,000,262 of 2,000,000, bar 2,805 of 8,509) and draws nothing; the plot and objects grade INCONCLUSIVE by name, the bar colours DIVERGE (TradingView paints them) |

On RDDT the change draws exactly what TradingView draws. On SPY the script itself runs past this lane's
array-operation limit, which has nothing to do with `ta.change`, and is stopped by name.

**So backquant is killed by source hash, by the REACH stop rule** (coordinator ruling 2026-11-16: capability
admission ON, an admitted script with a DIVERGE capture is killed). Under admission the door now draws it on the
runtime lane (`capabilityEvidenceLane.test.js` found it: the door answers `runtime` where the committed reach report
said refused), and one of its captures DIVERGEs. With the kill:

- `api/data/pine_runtime_killlist.json` gains the entry, held to the SPY capture's DIVERGE grade (the RT1 rail).
- The three records are spliced verbatim from run 44427583401 into `docs/pine/vendor-harness/runtime-on/verdicts.json`.
- The reach report (`docs/pine/evidence/2026-11-16-draw1-drawing-objects/runs/report.json`) drops the three captures
  (a killed script is not admitted), and its populations follow: captures admitted 561 -> 558, refused 146 -> 143;
  committed scripts admitted 118 -> 117, refused 33 -> 32.
- Members see what they see today: backquant was refused before this change (`pine:reassign` on the host lane), and is
  refused now, by name, with the kill's reason. It comes back when its `liftWhen` is met.

## For U-COND (not served here): what W4-A1 says about `ta.change(x, n)` in an arm

The committed captures `vw-w4-arm-runs-{rddt,spy}-1d-2026-11-16` answer queue row W4-A1. TradingView's
`up ? ta.change(close, 2) : 0.0` (C01) and `even ? ta.change(close, 3) : na` (C02) are neither "n runs back" nor
"n bars back". The call site keeps a BAR-indexed buffer that carries the value of the last run over the bars
the arm skips:

    value(i) = x(i) - x(the last run on or before bar i - n)

Mismatches against each model:

| row | carried buffer | n runs back | n bars back |
|---|---:|---:|---:|
| C01, RDDT (316 runs) | 0 | 169 | 174 |
| C01, SPY (4461 runs) | 0 | 2159 | 2130 |
| C02, RDDT (334 runs) | 0 | 332 | 332 |
| C02, SPY (4254 runs) | 0 | 4234 | 4221 |

For n = 1 the carried buffer is the previous run, the one-argument rule already served. This change keeps the
two-argument form in an arm on HIST-S3's check (stopped by name at the first skip). Serving it by this rule is
U-COND's.

## Rails and mutants

`runtime/__tests__/taChangeLength.test.js`, rails R1-R7. `runtime/__tests__/carriedState.test.js` is re-pinned:
it asserted the two-argument refusal. Each mutant was made on a saved copy, watched red, and the saved copy
restored and confirmed byte-equal (never `git checkout`); the PR lists the reds.
