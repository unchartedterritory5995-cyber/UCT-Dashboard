# W9-T6 Fill timing: evidence (2026-11-08)

Branch `feat/pine-w9-t6-fill-timing`, based on origin/master `7df8cd4f75`. Spec: `docs/pine/W9-STRATEGY-DESIGN.md`
(section 3.1, task T6, capture rows W9-P1, W9-P1b, W9-P2, W9-P3, W9-J1) and `docs/pine/W9-DECISIONS-2026-11-07.md`
(D1 pin before serve, D3 T9 deferred, D6 dark). Light phase: focused vitest on Node 20.20.2 `--maxWorkers=1`, Node 24
host parity and service suite, a corpus census, hand mutants. No SCRIPT_ENGINE_VERSION edit, no flag, no Railway.

Step 0: `git log origin/master --oneline -800 | grep -i t6` lists only W6-T6 commits; `git branch -r | grep -i w9`
has no T6 branch. T6 was not landed or in flight.

## What T6 implements

Semantics source: the Pine v6 reference (`_w0-2026-11-02/ref/pine_v6_reference.json`, `strategy()` arguments) and
the User Manual, Strategies page, "Altering calculation behavior".

| rule | capture row | what is implemented | source |
|---|---|---|---|
| ~~B-J1~~ | W9-J1 | **r1: not a rule.** Folded into the pin resolver as a precondition on Q-S1-core fixtures (below) | |
| B-POC | W9-P1 | `process_orders_on_close`: a market entry / close / close_all placed by bar t's close execution fills at C[t] after the script ran; the script reads it from t+1 | **HYPOTHESIS, User-Manual-derived** (the fill AT C[t]): manual "can fill orders created on a bar's close immediately, on the same tick". R6 says only that a market order is executed "before the next bar's open" ("an additional attempt to execute orders after a bar closes and strategy calculations are completed"); manual: "can fill orders created on a bar's close immediately, on the same tick"; "does not affect ... orders that a strategy places before a bar's closing tick" |
| B-POC-PRICE | W9-P1 | every live price order gets one attempt (r1, X4: the R6 reading, which names no subset; a HYPOTHESIS W9-P1b grades) at C[t] (fills there only if the close meets it); otherwise live from the next open as before | R6: "If the orders are price-dependent, they will only be filled if the price conditions are met" |
| B-POC-PYR | W9-P1 | asked when a close fill adds to a same-direction position | design T6 "POC with pyramiding" |
| B-POC-FILLS | W9-P1b | POC + `calc_on_order_fills`: a fill on the closing tick re-runs the bar from its start state | R6 `calc_on_order_fills` ("a new execution ... on each tick where an order fill occurs") |
| B-FILLS | W9-P2 | `calc_on_order_fills` on history: an extra execution at each fill tick (the open, a level on the path, an extreme); OHLC hold the bar's final values; the extra execution is rolled back; its market orders fill on the next path vertex, its price orders join the rest of the path | R6 for the ticks ("On historical bars, ticks refer to bar OHLC prices"); **HYPOTHESES, User-Manual-derived**, for the rollback and the final-value OHLC (history executions see each bar's final high/low/close, the lookahead warning) |
| B-TICK-HIST | W9-P3 | `calc_on_every_tick = true` on history executes once on the close, as the default; asked once per run (the forming bar still refuses Q-S1o) | R6 `calc_on_every_tick` (realtime bars only); manual ("on historical bars ... up to one market order per bar, based on the final close") |
| ~~B-FILL-LIMITS~~ | none | **r1: dropped.** `backtest_fill_limits_assumption` other than 0 refuses `runtime:strategy-option` at build, named, with its reason (master behaviour). R6 states neither the fill price nor the boundary | |

Costs at the close are T5's: `commission_value` and `slippage` other than 0 still refuse at build, so a POC run takes
no cost. `calc_on_every_history_tick = true` (July 2026, deferred by the design) refuses `runtime:strategy-option`;
`= false` is read past. Bar detalization stays T9 (deferred, D3).

**Unsettled sub-cases stop by name** (`runtime:strategy-unsettled`), never guessed: two orders on one closing tick
(Q-S1d); a fill on the closing tick under `calc_on_order_fills` (one execution or two, W9-P2); a price order an
extra execution places already past its level at that tick (Q-S1e); a price order and an extra execution's market
order on one tick (Q-S1d); `calc_on_order_fills` with realtime state (`varip` / `barstate.isnew`, W9-P1b); a bar
re-run more than 64 times (W9-P2).

## The step order (`runtime/vm.js`, `runtime/broker.js`)

Per bar: (1) `broker.beginBar(bar)` walks the fills (now a generator, `barTicks`). Without `calc_on_order_fills` it
never yields, so the walk is the T1 walk. (2) the script runs. (3) `broker.endBar(bar)`: under POC the orders that
close execution placed get their attempt at the close. (4) If (1) stopped at a fill tick (an extra execution) or (3)
filled under `calc_on_order_fills`, the VM restores the bar's start state (vars, history rings, held and carried
state, skip windows, iteration buffers, drawings, this bar's outputs) and steps the same bar again; the broker's
state is kept. Only a broker run with `calc_on_order_fills` snapshots; every other run steps exactly as before.

## Unpinned: every T6 rule

The committed ledger (`brokerPins.resolved.json`) holds no rule, so every T6 rule refuses `runtime:strategy-unpinned`
by name with its capture row. No committed capture pins any of them (no W9-P1 / P1b / P2 / P3 fixture exists; the
2026-10-02/03 strategy captures carry plots only).

| rule | the capture that would pin it |
|---|---|
| (W9-J1, not a rule) | the settings read-back of the Q-S1-core capture: the resolver will not count a Q-S1-core fixture as MATCH without it |
| B-POC, B-POC-PRICE, B-POC-PYR | W9-P1: `w9-p1-on-close.pine` (RDDT 1D) |
| B-POC-FILLS | W9-P1b: `w9-p1b-on-close-fills.pine` (RDDT 1D) |
| B-FILLS | W9-P2: `w9-p2-order-fills.pine` (RDDT 1D) |
| B-TICK-HIST | W9-P3: `w9-p3-every-tick-history.pine` (RDDT 1D) |

Note for the capture queue: `w9-p1-on-close.pine` declares commission and slippage, so on our side it refuses at build
until T5 serves costs; and `w9-p1b` uses `varip`, which rule 11 refuses in broker mode. The TradingView captures still
pin the rules; our side of the grade waits on T5 and on a `varip`-free variant.

D7 scorecard: derived, now "0 of 30 broker rules are pinned" (22 + 8). `strategiesAreRuled.test.js` pins the 30.

## Rails (`runtime/__tests__/w9T6FillTiming.test.js`, 24 tests)

Hand-computed on bars o=100+i, h=101.5+i, l=99+i, c=100.5+i (path open -> low -> high -> close), each with a
default-timing control:
- POC: entry placed bar 3 fills at 103.5 on bar 3, close placed bar 6 at 106.5; position 0 on bar 3, 1 on 4..6
  (control 104 / 107). Pyramiding 2: sizes 1 then 2. Price order: limit 104.4 fills at the close 104.5; limit 106.2
  lives to bar 5's path. Two market orders on one closing tick: Q-S1d.
- `calc_on_order_fills`: three extra executions on bar 3 (L at 103, x at 104.5, L2 at 104) against the control's
  bars 4 and 5; a `var` counter reads bar_index + 1 (rollback); an extra execution's close fills at the next vertex
  (102; control 104 at bar 4); a closing-tick fill and an already-passed level stop by name; a lone open fill asks
  B-FILLS; POC + fills re-runs bar 3 (position 1 on bar 3; control 0).
- `calc_on_every_tick` on history: identical trades and outputs to the default; B-TICK-HIST asked.
- fill limits: 102.2 with N=2 fills at 102.2; 102.05 with N=10 never; control N=0 fills at 102.05.
- Every rule each run used, removed from the pin set one at a time, stops the run naming that rule.
- Member door (`computeRuntimeColumns`, gate on): committed ledger refuses `runtime:strategy-unpinned`; with every
  non-T6 rule pinned the door names B-POC and W9-P1; all pinned, the record states the timing settings and B-POC fills.

Updated: `s1StrategyBroker.test.js` (POC is read now; the option-refusal case is `calc_on_every_history_tick = true`),
`strategiesAreRuled.test.js` (30 rules), `tests/fixtures/pine_runtime/w9t14_strategy_result.json` regenerated with
`W9T14_WRITE_FIXTURE=1` (classified: settings gain `process_orders_on_close` / `calc_on_order_fills` /
`backtest_fill_limits_assumption`, `unserved` drops `settings.process_orders_on_close`, rulesUsed gains B-J1; the dark
fixture is unchanged). `tests/test_pine_strategy_backtest.py` 43/43 against it.

Focused runs (Node 20.20.2): 16 files, 472 tests, all pass (T6, S1, T1, T11, T14, order-only-if, runtimeStrategy,
pins lock, gate product, strategiesAreRuled, productScorecard, runtimeHardeningP1, objectDoorGate,
runtimeAllowlistParity, hostNeutralClosure, serverBundle).

## Mutants (`mutate_t6.py`: copy aside, one replacement, run the T6 rail, restore, assert bytes; never git checkout)

`muts.json`: control SURVIVED; 15 KILLED (POC endBar off, POC declaration ignored, drop B-POC-PYR, no POC re-run,
drop B-J1, drop B-TICK-HIST, coof never, VM no rollback, vertex fill off, closing-tick guard off, afterExtra off,
extra execution priced at the close, fill-limits at the trigger, fill-limits ignored, record POC null). Two
SURVIVED, both duplicated asks (a guard repeated is a guard unproved): B-POC asked twice in the market branch, and
B-FILLS asked at three yield sites. Fixed by asking each once (B-FILLS in `beginBar` before every extra execution;
B-POC only as its fill's rule) and a new rail (a lone open fill must stop on B-FILLS). `muts_r2.json` at the tip:
control SURVIVED; drop B-FILLS, drop B-POC, drop B-POC-PRICE all KILLED.

## Indicator byte-identity

- `node tools/pine_runtime_host_parity.mjs --host node --check` (Node 24.13.1): `HP-1 GREEN: 166/166 cases equal the
  committed digests`. `pine_runtime_closure.mjs --check`: host-neutral, 0 findings.
- Service suite, Node 24.13.1, `node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"`: 139/139.
- Corpus census (a temporary, uncommitted vitest harness): 1,003 scripts (266 committed corpus, 142 builtin + 271
  reference from the licence-held local cache, read only, nothing committed, the probes and the host-parity corpus),
  each built and run in three lanes (gate off; gate on with the committed ledger; gate on with all pins), digests of
  the program, every output column and the broker record, base (this tip's parent, taken before any edit) vs tip.
  **861 non-strategy scripts: 0 differences in any lane.** 6 strategy rows differ, all intended: `w9-p1-on-close`
  and one reference v2 script now refuse at their next unserved option instead of at POC / `calc_on_order_fills`;
  three Q-S1b probes' program digest moves (the declaration config gains the three timing fields, outputs equal);
  the off-grid probe's rulesUsed gains B-J1 (outputs equal).

## r1 (review NO-GO @07bd06d3c4, vocabulary) and the T4 merge

Coordinator rulings, all applied (`4817001bd0`, then the merge commit):

1. **W9-J1 folded.** Not a rule any more. `tools/vendor_harness/evidence_engine.py::resolve_pins` counts a fixture
   of queue row Q-S1-core as MATCH only when every committed row of it carries a settings read-back
   (`provenance.strategySettings.properties`) with `process_orders_on_close` false, `backtest_fill_limits_assumption`
   0, `use_bar_magnifier` false and `calc_on_every_history_tick` false. The Properties names are parsed from
   `strategy_capture.mjs::PROPERTY_TABLE`, never restated. Rails: `tests/test_broker_pins_resolve.py` (10 new: pins
   with the defaults, each setting moved, no read-back in four shapes, one setting missing, only the core row, never
   turns a DIVERGE into MATCH, the core row found by its `rows` list). Default records no longer gain B-J1: the T14
   fixture's `rulesUsed` is master's again.
2. **B-FILL-LIMITS dropped.** `backtest_fill_limits_assumption` other than 0 refuses `runtime:strategy-option` with
   "other than 0 is not served (a limit that fills only once the price passes its level by that many ticks: no
   TradingView capture is queued for it)". The scorecard derives **0 of 28** (`strategiesAreRuled`, and T4's own
   count rail, updated at the merge).
3. **Vertex asks dropped.** A vertex fill is labelled B-FILLS and asks nothing; `beginBar` is the one B-FILLS site.
4. **X4** (rail `W9-T6 X4 HYPOTHESIS`): the close attempt takes every live order, whichever execution placed it, the
   R6 reading. An order placed before the close execution that the close meets has already met its level on the
   path, which ends at the close, so the reviewer's restricted reading gives the same run on every reachable input:
   the rail pins the observable consequence (an extra execution's limit fills on the path at its level, B-PATH, or
   passes the close attempt unfilled and fills on the next bar). The order-stamp code that implemented the
   restriction is gone. **X7**: the `calc_on_order_fills` + realtime-state refusal is commented defensive in
   `vm.js` (the hooks exist only for `varip` or a `barstate.isnew` read; `varip` refuses first in a broker program and
   `barstate.isnew` is refused by name on this lane) and railed through `execute` with test hooks, plus a rail that
   `varip` refuses first.
5. **Labels.** B-POC's fill AT the close and B-FILLS' rollback and final-value prices are User-Manual-derived
   hypotheses (table above and `strategy-broker-spec.md`), not R6.

**Merge of `origin/feat/pine-w9-t4-sizing` @497ff8a162 (T4 r1).** One conflict, the `readStrategyDeclaration` JSDoc
(both field lists kept); the T14 fixture regenerated on the merged tree. **T4 x T6 fix:** a cash or
percent-of-equity default size placed in an extra execution (`tickPx !== null`) refuses Q-S1a by name, because the
order would read the tick and T4 sizes at the close. A fixed default reads no price and is served. Rails in
`w9T6FillTiming.test.js` (refused at 103; control sized at the close 1000 / 103.5 = 9 units; fixed default served).

**Mutants.** `muts_r1.json` (pre-merge): control SURVIVED; KILLED: the one B-FILLS ask, X7 refusal off, fill limits
accepted again, POC endBar off, B-POC, B-POC-PRICE, VM no rollback, and three resolver mutants (precondition off,
applied to every row, one default dropped). X4 not run: no restriction code remains (equivalent, above).
`muts_merge.json` (merged tree): control SURVIVED; the T4 x T6 refusal off KILLED.

**Measured on the merged tree.** Focused vitest Node 20.20.2 `--maxWorkers=1`: 17 files, 517 tests pass (T6, T4,
S1, T1, T11, T14, order-only-if, runtimeStrategy, pins lock, gate product, strategiesAreRuled, productScorecard,
runtimeHardeningP1, objectDoorGate, runtimeAllowlistParity, hostNeutralClosure, serverBundle). Node 24.13.1:
`pine_runtime_host_parity.mjs --host node --check` HP-1 GREEN 166/166; closure 0 findings; service suite 139/139.
`evidence_engine.py pins --check` PASS. Pytest `test_pine_strategy_backtest.py` + `test_broker_pins_resolve.py`
73/73. Census (`census.harness.js.txt`, committed this time so it can be rerun): 861 non-strategy scripts, 0
differences against the pre-T6 base in all three lanes; 16 strategy rows differ (T4's sizing and T6's timing,
strategy-only).


## r2 (review GO-WITH-NOTES @985e804408): the settings read-back precondition on EVERY pin fixture

The r1 precondition covered Q-S1-core only. Design 5.1 says every capture reads its settings back, so
`evidence_engine.py::resolve_pins` now checks every MATCH row of every fixture a pin rests on (Q-S1a..m, W9-D1,
every W9-* row, Q-S1-core included). A row counts as MATCH only when:

- its `sourceSha256` names a committed source (a probe or the committed corpus; hashed as text, LF, as
  `adapters.mjs` hashes it), and an unknown or uncommitted source fails closed;
- it carries a read-back (`provenance.strategySettings.properties`);
- for each of the six timing settings (`process_orders_on_close`, `calc_on_order_fills`, `calc_on_every_tick`,
  `backtest_fill_limits_assumption`, `use_bar_magnifier`, `calc_on_every_history_tick`) the read-back shows
  EXACTLY what the capture's own `strategy()` declares as a literal, and the R6 default for each it does not
  declare. A declaration that is not a literal (an input) fails closed. The expected values are derived from the
  source; the Properties names, each setting's `strategy()` parameter and how its literal is read come from
  `strategy_capture.mjs::PROPERTY_TABLE`. Only the six R6 defaults are stated in Python.

So W9-P1 (`process_orders_on_close = true`) must read POC back as true and the other five at their defaults;
W9-P3 must read `calc_on_every_tick` true; Q-S1-core (no timing declared) must read all six at defaults.

Rails (`tests/test_broker_pins_resolve.py`, 38): the T2 rails now carry an agreeing default read-back; a
default-timing row with any of the six moved is not MATCH; a W9-P1 row with POC true read back pins and POC false
does not; a W9-P1 row with an undeclared setting moved is not MATCH; no read-back (three shapes), one setting
missing, unknown / missing / non-literal / no-strategy sources are not MATCH; a DIVERGE stays DIVERGE; rows no pin
rests on are not checked; comments inside the argument list and a commented-out `strategy(` are not declarations;
the committed probes are found by their text sha.

Mutants (`mutate_t6_r2pins.py`, copy/restore): `muts_r2pins.json` control SURVIVED; KILLED: precondition off,
Q-S1-core-only scope (the r1 scope), declaration ignored, non-literal served as default, unknown source passes, a
missing property passes, one checked setting dropped. "Comments not skipped" SURVIVED, so two rails were added
(a comment inside the argument list, a commented-out call); `muts_r2pins_b.json`: control SURVIVED, both comment
mutants KILLED.

`evidence_engine.py pins --check` PASS (the committed ledger pins nothing, so the resolution is unchanged).
Pytest `test_broker_pins_resolve.py` + `test_evidence_engine.py` + `test_w9_probes.py`: 91/91. HP-1 166/166 on
Node 24 (r2 touches no runtime code; one comment in `brokerRules.js`).
