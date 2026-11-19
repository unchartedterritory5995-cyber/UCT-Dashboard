# U-REQ-HOIST-COLUMN, the lowering: a request region reads a pure expression's past from the requested bars (2026-11-18, NUMBER PENDING)

Coordinator ruling (2026-11-18, request unit, part A): build the lowering the roadmap entry names, static offsets only,
with engine 78's guard kept as the backstop, plus the last-line hoist bug found while designing it. Branch
`feat/pine-request-region-history` from master `3d31b25661` (engine 80), its own PR.

## 1. The answer

- **The acceptance is met.** The four `rozz-2026-11-18` captures, PA ZigZag Fibonacci FAN with Alt Timeframe at 1W and
  1M on NYSE:RDDT and AMEX:SPY 1D from the listing (local, patrick-54's run), grade **MATCH on the runtime-on lane, all
  10 items, every bar compared** (668 RDDT bars, 8,509 SPY bars per item). At master the same four are INCONCLUSIVE
  (9 of 10 items not compared: the e78 guard refuses the run). They are graded at the moved setting through the e77
  harness seam; a member still sees that setting read-only until its evidence gate opens.
- **The guard's refusal lifts only for shapes the lowering serves.** A dynamic offset keeps its column and its refusal
  (rail below).
- **The census (runtime-on, 967 rows): served counts unchanged** (drawn 553 of the 679-sample keys; 163 by the runtime
  lane, 390 by the host lane, before and after). Two rows' answers moved, neither in what is drawn:
  - `builtin:seasonality` (`request.security(syminfo.tickerid, "1M", calculateMontlyChanges(...), lookahead_on)`): its
    request value used to refuse `runtime:request` (a column in the value); it now lowers, and the script stops on its
    next wall, `runtime:unbound` (`time_close[1]`, line 59), then `pine:collection`. **No request value with `e[1]`
    becomes served in the sample.**
  - `reference:market-structure-with-inducements-sweeps-luxalgo` (drawn by the runtime lane both times): a host
    translation refusal's text changed from the step budget to the 10,000 ms wall budget, a timing difference of the
    host translator on this box, unrelated to this change.
- **The full corpus, both lanes:** this PR's own pine heavy run against master `3d31b25661`'s verdicts (runtime-on 941
  graded, MATCH 321; production 941, MATCH 211), stated in the PR description.

## 2. What was built

`app/src/components/chart/engine/ast/pineRuntimeFrontend.js`:

1. **`case 'offset'`, inside a request region** (`inRequestValue && hoistSink`). Before: a static `e[k]` over a pure
   expression that is not a price series fell to `hist(column(columnOf(e)), k)`. A COLUMN is computed once over THIS
   chart's bars, and the request's sub-run (`vm.js::runRequest`) reads it at the REQUESTED bar's index. So PA ZigZag's
   `_isUp[1]` (a pure body binding, substituted as a macro) read the chart's daily bar j-1 on weekly bar j, and engine
   78 refused it (`runtime:request-hoisted-history`). Now the expression is declared into the region's OWN committed
   series (`history src r<n>`, the same rewrite a window's source already gets there) and read through that slot's ring
   (`histSlot` + `hoistedHistorySlot`), committed once per requested bar. It is a pure expression (a slot read takes
   the `readsSlot` arm above), so its place in the region cannot change its value. `e[0]` is `e`.
2. **The last line of a hoisted body.** `lowerInlineCall` lowers a statement-form body's last line after `lowerStmts`
   has restored the ROOT's statement sink, so a `(d * 2)[1]` there declared its committed series into the MAIN program,
   which a sub-run never runs: `na` on every requested bar, with no column for the guard to see. The last line now
   hoists into the body's own sink, after the statements it reads.
3. **Unchanged:** a DYNAMIC offset keeps its column, and engine 78's guard keeps refusing it by name (the backstop
   rail below). The value guard (`carriesColumn(valueIr)`, `runtime:request`) is unchanged; a shape it used to refuse
   because of a static `e[k]` now has no column to find.

## 3. Rails and mutation proofs

`runtime/__tests__/requestHoistedHistory.test.js` (sixty synthetic weeks, fourteen months; expected values written
out from the script, never read from the engine):

- the PA ZigZag shape builds with no column in any hoisted statement;
- it equals TradingView's zigzag of the weeks and of the months on every bar, `na` included, with look-ahead on and off
  (4 cases);
- `(close > open)[1]` as a request's value is last week's direction;
- a hoisted body's last line `(d * 2)[1]` is the previous week's value (it read `na`);
- the backstop: a dynamic offset over an expression in a hoisted body still refuses `runtime:request-hoisted-history`,
  at the build and the run;
- controls: the identity request, a `var` accumulator and a slot recurrence still serve, right.

Remote lane (GitHub runners, the committed head): the rail and `runtimeRequestSupply`, `engine55OtherSymbolDoors`,
`w4ClassifierHonesty`, `pine.requestResolution` green.

Mutants (`runs/mutants-manifest.json`, `uct.ci-mutants/v1`, run by pine heavy's mutant job):
- A1 the region's own committed series is not taken (a static offset keeps its chart column)
- A2 the region's series is read one requested bar too far back
- A3 the last line of a hoisted body declares its series into the main program again
- A4 the e78 guard no longer walks the hoisted statements (the backstop is gone)

Results: the PR's mutant job (dispatched `skip_legs`), stated in the PR description.

## 4. Runs

| run | result |
|---|---|
| rozz-2026-11-18, runtime-on, master `3d31b25661` | 4 INCONCLUSIVE (the e78 guard) |
| rozz-2026-11-18, runtime-on, this branch | 4 MATCH, 10 / 10 items each, every bar compared |
| census, runtime-on, master against this branch | 967 / 967 rows; served unchanged; 2 rows moved (section 1) |
| remote lane, the rails above | green |
| full corpus, both lanes | the PR's pine heavy run (PR description) |

Every local step took the heavy lock separately, at `VITEST_MAX_WORKERS=1`, from a fresh copy of the same sample cache
(`cov-e73`) and reference extract the roadmap used.
