# U-REQ-HOIST-COLUMN, the guard half: a request whose hoisted statements carry a column refuses by name (2026-11-18, engine 78 (#1847))

Coordinator ruling (2026-11-18, after #1831 named the cause): correctness first. Steps: (1) measure exposure across
every document the member door serves; (2) extend the column guard to a request's hoisted statements, so such a
request refuses by name, `runtime:request-hoisted-history`, with a member sentence; (3) if (1) finds a served
document, report it at once. The proper lowering (the region's own slot history) is a later roadmap unit. Branch
`fix/pine-request-hoisted-history-guard`, from master `2314cb0c14` (engine 76), its own PR, engine 78 (#1847).

## 1. The answer

- **Exposure: 0 served documents, by name.** On the runtime-on census (967 rows: the 679-script sample plus 288
  reference examples), master against this branch, no row's answer changes and no row names the new guard. Every
  row is identical apart from its timing. On the full vendor-harness corpus, both lanes, `verdicts.json` and
  `summary.md` are byte-identical: no verdict moves on either lane, so no MATCH moves, and no capture names the
  guard. Section 3 explains why the answer is 0.
- **The guard is built**, railed and mutation-proved (section 4).

## 2. What was built

`app/src/components/chart/engine/ast/pineRuntimeFrontend.js`, where a `request.security` site is lowered:

- **Before:** the column guard, `carriesColumn` (a generic walk that follows user-function calls), checked only the
  request's value, `carriesColumn(valueIr)`.
- **Now:** it also checks every statement hoisted into the request's region,
  `hoisted.some((s) => carriesColumn(s))`. Such a request refuses `runtime:request-hoisted-history`, with the called
  function named (`zigzag()`) and the line.
- **The sentence a member reads** (`RUNTIME_REFUSALS`): "a data request runs a helper's lines that read their own
  earlier values (such as `x[1]`), and this chart can read that history only from its own bars, not the requested
  timeframe's or symbol's, so nothing is drawn rather than a wrong value".
- **A run half refused this way** reads its own sentence (`objectLoss.js::RUN_HALF_WHY`). The code joins the
  support-loop vocabulary (`refusalCodes.json`, regenerated). The editor status panel files it under the request
  family (its `runtime:request` prefix).

The predicate is the COLUMN, the same one the value guard has always used, not "any history read":

- A probe of PA ZigZag Fibonacci FAN at a weekly timeframe on our side found the value carries no column. Two of
  its five hoisted statements do: the `_dir :=` assignment and the `_zz` declaration, the two that read `_isUp[1]`
  and `_isDown[1]`.
- A slot's own history (`d[1]` on a recurrence, committed per requested bar) and a `var` live in the region, not in
  a column. They read the requested bars correctly (`_dir[1]` did: section 3 of
  `2026-11-18-timeframe-input-setting/EVIDENCE.md`), so they keep serving.

## 3. Exposure, measured before the change

Base: master `2314cb0c14` (engine 76). Branch: `e56c1d86c0`. Each lane took the heavy lock separately, at
`VITEST_MAX_WORKERS=1`. The census inputs were fresh copies of the same sample cache (`cov-e73`) and reference
extract (`ref_rebuilt.json`) the roadmap used.

| run | master | branch |
|---|---|---|
| census, runtime-on (the member door; production runs the runtime pane for everyone) | 967 / 967 rows; 163 drawn by the runtime lane, 390 by the host lane | 967 / 967 rows, each identical to master's apart from its timing; 0 rows name `runtime:request-hoisted-history` |
| vendor harness, runtime-on | 910 graded: MATCH 308, MATCH_SUBSTITUTED 20, DIVERGE 77, INCONCLUSIVE 505 | `verdicts.json` and `summary.md` byte-identical; 0 captures name the guard |
| vendor harness, production | 910 graded: MATCH 204, DIVERGE 81, INCONCLUSIVE 625 | byte-identical |

Why the answer is 0, read off master's census:

- Of the 967 rows, 198 call `request.security` / `security`. The host lane draws 50 of them; its `tf_merge` / `sym`
  trees are another evaluator, which this change does not touch. 145 are not drawn.
- The runtime lane draws 3, and none of them hoists a body at another timeframe or symbol:
  - `committed:pa-zigzag-fibonacci-fan__2001`: at its default, Alt Timeframe `1D` on a daily chart, the request is
    the identity. It folds to the expression and has no region.
  - `committed:fair-value-gap__1048fa103a`: its requests read bare series (`close[1]`, `high[2]`, `bar_index`).
  - `reference:ut-bot-strategy__VynMPwQs9U`: `close` at the chart's own period.
- The two scripts allowlisted by name (`api/data/pine_runtime_allowlist.json`):
  - `adx-and-di-for-v4` makes no request.
  - RS Rating's requests (`request.security(lineTicker, timeframe.period, close)`, `… 'D', close`, and
    `request.seed(…)`) read bare `close`.
- No `request-other` capability row is admitted, so a runtime document whose requests read another timeframe or
  symbol is declined at the member door before anything draws.

What this cannot see: a member's own saved script outside the sample and the corpus. No production data was read.
The guard covers any such script from the moment it ships.

## 4. Rails and mutation proofs

`app/src/components/chart/engine/runtime/__tests__/requestHoistedHistory.test.js` has 6 tests on twelve synthetic
weeks:

- The PA ZigZag shape, with look-ahead on, refuses at the build, by name and with the sentence.
- The same shape refuses at the run.
- The same shape with look-ahead off refuses too.
- CONTROL: the same function at the chart's own period is the identity. It has no region and serves.
- A hoisted `var` accumulator serves. The rail asserts the shape (statements present, no column) and checks every
  bar against the hand-computed running sum of the weekly closes.
- A hoisted recurrence with slot history (`nz(d[1])`) serves the hand-computed weekly direction. The weeks turn
  both ways, so a wrong read shows.

Mutants, each restored from a saved copy and checked byte-equal (never `git checkout`), in one heavy-lock hold:

| mutant | result |
|---|---|
| H1 the hoisted statements are not walked | RED, 3 rails red, restored byte-equal: yes |
| H2 any hoisted statement refuses | RED, 2 rails red, restored byte-equal: yes |
| H3 any history read in a hoisted statement refuses (not only a column) | RED, 1 rail red, restored byte-equal: yes |
| H4 the refusal is filed under the old name (`runtime:request`) | RED, 3 rails red, restored byte-equal: yes |
| H5 no member sentence for the code | RED, 1 rail red, restored byte-equal: yes |

The rail was green before the first mutant and after the last restore.

Neighbours, local: `requestHoistedHistory`, `runtimeRequestSupply`, `engine55OtherSymbolDoors`, `objectLoss`, the
three `editorStatus` files, `serverBundle.rail` and `pineImportHold` all pass (9 files, 208 tests). So do
`tests/test_support_loop_refusal_codes.py`, `tests/test_script_engine_version_gate.py` and
`tests/test_pine_runtime_engine_identity.py` (35 tests).

## 5. What is left

**Serving the read** is a later roadmap unit, U-REQ-HOIST-COLUMN's lowering half: lower a history read inside a
request's region as the region's own slot history, committed per requested bar, never as a column. Until then the
four PA ZigZag `rozz-2026-11-18` captures stay witnesses. They are graded only through the harness's
moved-timeframe switch (#1831). Once both have landed, this guard should make our side refuse there rather than
diverge. That is not measured here: those captures are local, and the switch is #1831's.
