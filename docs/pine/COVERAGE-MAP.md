# Pine coverage map: where we stand against the whole Pine language

Measured 2026-10-30 on `origin/master` @ `dadccbc98d`. Machine-readable twin:
[`coverage-map.json`](coverage-map.json). Re-run: [How to re-run](#how-to-re-run).

Owner goal: paste any open-source Pine script and get the same result as TradingView.
This page measures the distance to that goal against the **whole** Pine v6 language,
weights it by what real scripts use, and ranks the work.

---

## 1. Headline

> **185 of 679 sampled open-source scripts (27.2%) transfer fully today.**
> **34 of 679 (5.0%) transfer fully AND have a TradingView capture that MATCHes.**

**Exact definition of "transfers fully"** (the predicate is `isClean` in
`app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js`):

1. the script goes through the **production member door**, the two doors a member's
   paste goes through: `memberPaneDefinition` then `installUserDefinitions`, with the flag
   state production runs (objects-only pane **armed**, runtime pane **dark**); and
2. it **attaches and installs**, with **zero refusals** in its translation; and
3. its drawing-object program is carried with **nothing dropped and nothing withheld**
   (`assessObjectLoss` verdict `clean`), and no per-bar paint is withheld; and
4. it is **not a strategy that places orders** (`strategy.entry/order/exit/close/close_all`).
   The door draws a strategy's plots (ruling C50), but its trades, markers and tester
   report are its output and nothing simulates the broker, so it does not count.

⚠️ This is a **door verdict, not a parity verdict**. It says the whole script is accepted
and drawn; it does not say every number equals TradingView's. Parity is graded only where a
vendor capture exists (second line of the headline, and section 1.2).

### 1.1 Breakdown

| slice | scripts | transfer fully | % |
|---|---:|---:|---:|
| **all** | **679** | **185** | **27.2%** |
| committed corpus (`corpus/committed`, MPL/MIT/Apache) | 266 | 50 | 18.8% |
| reference-only corpus (rest of the 537-entry popularity plan, fetched to a local cache) | 271 | 78 | 28.8% |
| TradingView built-ins (`pine-facade list?filter=standard`, open ones) | 142 | 57 | 40.1% |
| Pine v1-v3 | 85 | 48 | 56.5% |
| Pine v4 | 132 | 33 | 25.0% |
| Pine v5 | 191 | 35 | 18.3% |
| Pine v6 | 271 | 69 | 25.5% |
| `indicator()` / `study()` | 609 | 185 | 30.4% |
| `strategy()` | 70 | 0 | 0% |

Other numbers from the same run:

- **259 / 679 (38.1%) attach in some form** (the member sees a pane). The 74 that attach but
  do not transfer fully are 11 order-placing strategies whose plots draw, and 63 with a
  refused output, dropped drawing ops, or a withheld paint.
- **Runtime-lane counterfactual: 215 / 679 (31.7%).** The same door with the DARK
  `VITE_PINE_RUNTIME_PANE_ENABLED` switched on in the test process (nothing armed). An upper
  bound: it counts a script the runtime lane attaches, and the runtime lane's own drawing is
  not graded here. Arming it today is worth about +30 scripts.
- **TradingView's own reference examples**: 73 of 295 whole-script examples transfer fully.

### 1.2 Parity evidence (vendor harness)

Fresh run of `vendorHarness.corpus.test.js` over `tests/fixtures/vendor/harness` (336
captures, RDDT and SPY daily): **71 MATCH, 69 DIVERGE, 196 INCONCLUSIVE**. Joined to the
sample by source text: 97 sampled scripts have a capture.

| | MATCH | DIVERGE | INCONCLUSIVE |
|---|---:|---:|---:|
| transfers fully (door) | **34** | 3 | 14 |
| does not transfer | 4 | 13 | 29 |

So the door verdict is a good predictor (34 of 37 graded clean scripts MATCH), but parity
evidence exists for only 51 of the 185 that transfer. **134 transfer with no parity
evidence at all.**

### 1.3 The sample, and how it was drawn

| population | n | how | licence handling |
|---|---:|---|---|
| committed | 266 | `corpus/committed/*.pine` | in the repo |
| reference | 271 | every `corpus/reference/*.json` not committed: the rest of `docs/pine/corpus-expansion-plan.json` (537 entries, popularity-ranked by boosts across trend, momentum, volatility, volume, breadth, structure, sessions, dashboards) | source fetched to a **local cache only**, never committed |
| builtin | 142 | TradingView's own built-in library (145 listed; 3 are `closed_no_auth` and were skipped) | local cache only |

Fetched by `tools/pine_coverage/fetch_sample.py` from the two public, unauthenticated
endpoints `tools/pine_survey/tvfetch.py` already used (`pine-facade .../get/<id>/last` and
`.../list/?filter=standard`), sequential with a 0.5 s delay. No sign-in, nothing published,
no bot protection touched; a non-open script is recorded and skipped. All 271 reference
sources and 142 of 145 built-ins were retrievable.

⚠️ Bias: the corpus plan was walked most-boosted-first, so this is the popular head, not the
long tail. The built-ins are easier than community scripts (40% vs 19-29%).

---

## 2. Inventory: the whole Pine v6 language, by namespace and status

Source: TradingView's own v6 reference, extracted by
`tools/pine_survey/pine_reference_extract.js` (fixed in this branch: the i18n helper's
module id moved from 982245 to 93738, and is now read off the data module rather than
hard-coded). 719 function overloads (475 unique names), 251 methods, 162 variables, 241
constants, 20 types, 23 keywords, 23 operators, 10 annotations: **927 unique items**.

**Status definitions** (computed per item by `tools/pine_coverage/coverage_map.py`):

| status | meaning, and the evidence that decides it |
|---|---|
| supported-and-verified | appears in a sample script or TradingView example that transfers fully, AND in the source of a vendor capture whose verdict is MATCH. Orders, alerts and logs are never counted as verified: the harness does not grade them |
| supported-unverified | transfers in at least one real usage; no MATCH capture contains it |
| door-unreachable | never seen in a production-clean script, but seen in a script the **dark runtime lane** attaches: the engine has a path, the member's door does not open it |
| call-unmapped | the door knows the name and refused this call's shape (arity, role order, named argument, input kind, a collection or request form) and it never transfers |
| missing | refused as a name or capability the door does not have (`pine:function`, `pine:builtin`, `pine:module`, `pine:type`, `pine:function-def`, `pine:block`...) and never transfers |
| data-limited | cannot match exactly without data we do not hold (section 5) |
| unproven | used in the sample, but every script that uses it is blocked by some other wall first, so the door was never asked about it |
| no-evidence | not used by any sampled script or any TradingView example |
| `+partial` (suffix in the JSON) | transfers in some calls and is refused in others |

| namespace | items | verified | unverified | door-unreach. | call-unmapped | missing | data-limited | unproven | no evidence | item-uses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `(language)` keywords, types, operators, annotations | 64 | 29 | 6 | 3 | 1 | 1 |  | 10 | 14 | 10506 |
| `(global)` (close, plot, indicator, nz, time...) | 59 | 37 | 8 |  |  | 2 | 2 | 8 | 2 | 8978 |
| `ta` | 67 | 28 | 19 | 1 |  | 8 |  | 11 |  | 2412 |
| `color` | 24 | 18 | 2 |  |  |  |  | 4 |  | 2376 |
| `input` | 13 | 8 | 2 |  | 2 |  |  | 1 |  | 1633 |
| `array` | 55 | 8 | 18 | 4 | 2 |  |  | 17 | 6 | 1415 |
| `math` | 28 | 12 | 7 |  |  | 1 |  | 6 | 2 | 1099 |
| `line` | 28 | 10 | 6 | 5 |  | 1 |  | 6 |  | 1070 |
| `label` | 43 | 11 | 4 | 4 |  |  |  | 15 | 9 | 1017 |
| `size` | 6 | 5 |  | 1 |  |  |  |  |  | 716 |
| `str` | 18 | 6 | 2 | 1 |  |  |  | 8 | 1 | 432 |
| `box` | 30 | 5 | 3 | 2 |  |  |  | 16 | 4 | 430 |
| `timeframe` | 14 | 7 | 1 |  |  | 2 | 2 | 2 |  | 385 |
| `shape` | 12 | 9 | 1 |  |  |  |  | 2 |  | 383 |
| `strategy` | 96 |  |  |  | 4 |  |  | 41 | 51 | 375 |
| `position` | 9 | 9 |  |  |  |  |  |  |  | 363 |
| `location` | 5 | 5 |  |  |  |  |  |  |  | 344 |
| `table` | 23 | 9 | 3 |  |  |  |  | 3 | 8 | 339 |
| `barstate` | 7 | 3 | 2 | 1 |  | 1 |  |  |  | 329 |
| `syminfo` | 40 | 2 | 3 |  |  |  | 31 | 4 |  | 291 |
| `plot` | 14 | 8 |  |  |  |  |  | 4 | 2 | 235 |
| `request` | 11 | 1 |  |  |  |  | 10 |  |  | 209 |
| `display` | 7 | 2 | 2 |  |  |  |  | 2 | 1 | 197 |
| `extend` | 4 | 2 | 2 |  |  |  |  |  |  | 195 |
| `text` | 10 | 3 | 1 |  |  |  |  | 3 | 3 | 167 |
| `format` | 5 | 1 | 2 | 1 |  |  |  |  | 1 | 152 |
| `xloc` | 2 | 2 |  |  |  |  |  |  |  | 146 |
| `barmerge` | 4 | 2 |  |  |  |  |  | 2 |  | 126 |
| `yloc` | 3 | 3 |  |  |  |  |  |  |  | 110 |
| `chart` | 16 | 2 |  |  |  | 1 |  | 6 | 7 | 107 |
| `alert` | 3 |  | 2 |  |  |  |  | 1 |  | 63 |
| `matrix` | 49 |  |  |  | 1 |  |  | 20 | 28 | 62 |
| `ticker` | 9 | 1 | 2 |  |  |  | 1 | 1 | 4 | 47 |
| `runtime` | 4 |  | 1 |  |  |  |  |  | 3 | 45 |
| `linefill` | 6 | 1 | 1 |  |  |  |  | 1 | 3 | 44 |
| `hline` | 3 | 3 |  |  |  |  |  |  |  | 40 |
| `map` | 11 |  | 2 |  |  |  |  | 7 | 2 | 40 |
| `dayofweek` | 7 |  |  |  |  |  |  | 7 |  | 33 |
| `polyline` | 3 |  |  |  |  |  |  | 3 |  | 23 |
| `session` | 9 |  |  |  |  |  |  | 6 | 3 | 17 |
| `font` | 2 |  |  |  |  |  |  | 2 |  | 11 |
| `log` | 3 |  |  |  |  |  |  | 2 | 1 | 11 |
| `currency` | 56 |  |  |  |  |  |  | 2 | 54 | 8 |
| `scale` | 3 |  | 1 |  |  |  |  | 2 |  | 8 |
| `order` | 2 |  |  |  |  |  |  | 2 |  | 6 |
| `volume_row` | 8 |  |  |  |  |  | 8 |  |  | 5 |
| `footprint` | 9 |  |  |  |  |  | 9 |  |  | 4 |
| `earnings` | 7 |  |  |  |  |  | 7 |  |  | 3 |
| `dividends` | 5 |  |  |  |  |  | 5 |  |  | 2 |
| `splits` | 2 |  |  |  |  |  | 2 |  |  | 2 |
| `settlement_as_close` | 3 |  |  |  |  |  |  | 1 | 2 | 1 |
| `adjustment` | 3 |  |  |  |  |  |  |  | 3 | 0 |
| `backadjustment` | 3 |  |  |  |  |  |  |  | 3 | 0 |
| **all** | **927** | **252** | **103** | **23** | **10** | **17** | **77** | **228** | **217** | |
| share of item-uses | | 87.2% | 6.7% | 1.6% | 0.3% | 0.6% | 0.2% | 3.5% | 0.0% | 37012 |

⚠️ **Read the last row carefully.** 87% of item-USES are of items that are supported. That
is not "87% done": the per-item view cannot see that `if`, `:=`, `for` and `request.security`
each work in some contexts and are refused in most. The gap lives in **language features and
call contexts**, not in names, which is why the headline is per script.

**Items the door does not have, by usage** (missing): `import` (65 scripts),
`timeframe.in_seconds` (38), `dayofmonth` (25), `month` (23), `line.get_price` (12),
`ta.alma` (8), `chart.right_visible_bar_time` (7), `timeframe.isdwm` (7), `barstate.isnew` (6),
`ta.percentile_nearest_rank` (4), `ta.swma` (4), `math.acos` (3), `ta.nvi` (3), `ta.pvi` (3),
`ta.rci` (2), `ta.tsi` (2), `ta.accdist` (1).

**Known names, call shape not mapped**: `strategy.position_size` (18),
`strategy.position_avg_price` (16), `input.time` (14), `matrix.get` (12), `input.enum` (9),
`array.includes` (7), `varip` (7), `strategy.opentrades` (6),
`array.binary_search_rightmost` (5).

**Door-unreachable** (the runtime lane reaches them, production does not): `size.large` (94),
`type` (57: UDTs attach only on the runtime lane), `array.unshift` (46), `line.set_color` (40),
`line.set_xy2` (36), `array.pop` (34), `line.set_xy1` (31), `array.new_label` (29), `-=` (28),
`label.set_color` (25), `line.set_style` (24), `format.percent` (19), `str.split` (15) and 10 more.
⚠️ This is association, not attribution: these names appear in scripts the runtime lane
attaches; the runtime lane may not be what unlocks each one.

**Works in some calls, refused in others** (transfer/use): `request.security` (21/181),
`array.get` (7/169), `time` (11/168), `array.push` (8/147), `nz` (27/202), `plotshape`
(36/172), `ta.pivothigh` (19/94), `ta.valuewhen` (14/70), `ta.barssince` (4/49), `fixnan`
(2/22), `plotcandle` (3/36).

**Unproven** (always behind another wall, the door was never asked): `strategy.entry` (68),
`label.set_textcolor` (27), `barmerge.lookahead_off` (23), `box.set_top` (22),
`line.set_y2` (20), `chart.point` (16), `hour` (16), `str.substring` (15), `minute` (14),
`chart.point.from_index` (12), `polyline.new` (11) and 217 more in the JSON.

### 2.1 Language features (detected in source; transfer rate of the scripts that use them)

| feature | scripts using | of those, transfer | rate |
|---|---:|---:|---:|
| ?: ternary | 554 | 126 | 23% |
| if statements / blocks | 451 | 57 | 13% |
| := reassignment | 419 | 54 | 13% |
| user function, single-line body | 406 | 61 | 15% |
| user function, multi-line body | 380 | 49 | 13% |
| var declarations | 371 | 48 | 13% |
| [a, b] = tuple destructuring | 203 | 10 | 5% |
| for loops | 201 | 5 | 2% |
| history reference on an expression (expr)[n] | 193 | 12 | 6% |
| switch | 142 | 13 | 9% |
| += -= *= /= %= | 138 | 12 | 9% |
| method-call syntax x.f(...) on a value | 135 | 4 | 3% |
| max_bars_back | 107 | 9 | 8% |
| strategy() declaration | 70 | 0 | 0% |
| import of a library | 65 | 0 | 0% |
| array<T> / matrix<T> / map<K,V> generics | 64 | 2 | 3% |
| type (user-defined types) | 57 | 0 | 0% |
| float[] array types | 57 | 2 | 4% |
| while loops | 44 | 2 | 4% |
| for...in loops | 43 | 0 | 0% |
| method definitions | 34 | 2 | 6% |
| varip | 7 | 0 | 0% |
| enum | 7 | 0 | 0% |

---

## 3. Top 30 blockers, ranked by scripts unblocked

How blockers are found: each refused script is **peeled through the same member door**. The
refused lines are neutralised (a binding keeps its name as `x = 0.0`, any other line is
blanked) and the door is asked again, up to 8 times, so a script's walls are its whole wall
list and not just the first. Peel artifacts are discarded (an output-contract or round-trip
refusal after step 0, a refusal on the peel's own `x = 0.0`). A wall is keyed to a **Pine
item** when the refusal's token is one, otherwise to the **capability** its guard names
(`[bracketed]`).

- **sole** = scripts for which this is the ONLY wall found: fixing it alone makes them transfer.
- **blocks** = scripts that have this wall at all.

⚠️ Walls were fully enumerated for **224 of 494** non-transferring scripts (they attached, or
the peel reached a build). For the other 270 the peel stopped (a whole-program refusal, no
progress, or the cap), so they may hide further walls: "sole" can be optimistic for them.

| # | blocker | capability | sole | blocks |
|---:|---|---|---:|---:|
| 1 | [drawing-objects] object program not carried (no-plot drawing script) | drawing-objects | 55 | 106 |
| 2 | [imperative] if/for/while blocks, := reassignment, var state | imperative | 47 | 186 |
| 3 | [strategy] order-placing strategy (no broker simulation) | strategy | 36 | 70 |
| 4 | `request.security` (form not servable) | request-security | 15 | 49 |
| 5 | [imports-libraries] `import` | imports-libraries | 11 | 65 |
| 6 | [translator-robustness] timeout / round-trip | translator-robustness | 9 | 36 |
| 7 | [output-contract] constant-only / presentation-only / paint-only | output-contract | 6 | 6 |
| 8 | `fixnan` | builtin-missing | 5 | 12 |
| 9 | [history-offsets] non-literal plot offset / history | history-offsets | 4 | 21 |
| 10 | [udt-methods] `type` | udt-methods | 4 | 21 |
| 11 | object op dropped: `cell:text` (table cell text) | drawing-objects | 3 | 47 |
| 12 | object op dropped: `create:label` | drawing-objects | 3 | 35 |
| 13 | `ta.alma` | builtin-missing | 3 | 5 |
| 14 | [user-functions] multi-line function bodies | user-functions | 2 | 55 |
| 15 | `time` (session / timeframe forms) | builtin-missing | 2 | 16 |
| 16 | `array.get` | collections | 2 | 7 |
| 17 | `ta.cci` (role order) | builtin-missing | 2 | 5 |
| 18 | `ta.sar` | builtin-missing | 2 | 3 |
| 19 | `ta.rci` | builtin-missing | 2 | 2 |
| 20 | `ta.tsi` | builtin-missing | 2 | 2 |
| 21 | object op dropped: `guard:loop` (drawing inside a loop) | drawing-objects | 1 | 22 |
| 22 | [text-colour-values] text / colour as computed values | text-colour-values | 1 | 8 |
| 23 | `array.unshift` | collections | 1 | 4 |
| 24 | `input.time` | builtin-missing | 1 | 4 |
| 25 | `ta.nvi` | builtin-missing | 1 | 3 |
| 26 | `ta.pvi` | builtin-missing | 1 | 3 |
| 27 | `ta.valuewhen` (role order) | builtin-missing | 1 | 3 |
| 28 | `ta.accdist` | builtin-missing | 1 | 1 |
| 29 | `ta.percentile_nearest_rank` | builtin-missing | 1 | 1 |
| 30 | `ta.swma` | builtin-missing | 1 | 1 |

Next by reach, with no sole script yet: [tuples] (blocks 48), object op dropped
`guard:create` (35), `create:line` (23), `guard:update` (23), `update:props` (19),
`guard:delete` (17), `coll:diverged` (16), `loop:empty` (16), `strategy.position_size` (11).

### 3.1 By capability, greedy order

Fix the capability that unblocks the most scripts, then the next, given the ones already
fixed. "firm" counts only scripts whose walls were fully enumerated.

| step | capability | blocks | unblocks | firm | cumulative transfer |
|---:|---|---:|---:|---:|---:|
| 1 | drawing-objects | 194 | 109 | 60 | 43.3% |
| 2 | imperative | 186 | 57 | 21 | 51.7% |
| 3 | strategy | 70 | 45 | 16 | 58.3% |
| 4 | builtin-missing | 82 | 41 | 22 | 64.4% |
| 5 | request-security | 52 | 33 | 18 | 69.2% |
| 6 | translator-robustness | 36 | 29 | 24 | 73.5% |
| 7 | user-functions | 55 | 27 | 7 | 77.5% |
| 8 | imports-libraries | 65 | 35 | 10 | 82.6% |
| 9 | tuples | 48 | 39 | 14 | 88.4% |
| 10 | collections | 25 | 22 | 11 | 91.6% |
| 11 | udt-methods | 21 | 19 | 6 | 94.4% |
| 12 | history-offsets | 21 | 20 | 10 | 97.3% |
| 13 | text-colour-values | 8 | 8 | 4 | 98.5% |
| 14 | output-contract | 6 | 6 | 0 | 99.4% |
| 15 | call-mapping | 4 | 4 | 1 | 100.0% |

"100%" is door acceptance, and only for walls the peel could see. It is not parity, and
data-limited scripts (section 5) still cannot match.

---

## 4. Big-ticket capability gaps

**Drawing objects (blocks 194, the largest).** `line/label/box/table` all translate in some
scripts (`label.new` transfers in 23 of 227 users). What fails is completeness of the object
program: ops created under a condition the object pass cannot evaluate (`guard:create`, 129
scripts at step 0), `table.cell` text (`cell:text`, 80), labels created per bar
(`create:label`, 83), drawings inside loops (`guard:loop`, 62), deletes and updates under
conditions (68 / 66), collection-held drawings (`coll:diverged`, 41). A drawing-only script
whose object program comes out empty is refused with nothing to show. Object **limits**
(`max_lines_count`, `max_labels_count`, `max_boxes_count`, the 500 cap) are already modelled
by `engine/objectPool.js`. `polyline.new` (11 users) and `chart.point` (16) are never reached:
always behind another wall. `linefill.new` transfers in 4 of 29.

**Per-bar imperative execution (blocks 186).** The host lane stores one expression per
column, so `if` blocks, `:=` after declaration, `var` state that is not an accumulator, loops
and multi-line functions are refused (`pine:block`, `pine:reassign`, `pine:state`,
`pine:cycle`). This one capability, together with user functions, tuples, history offsets
and text/colour values (all the same per-bar model), is the gap to most community scripts:
`for` loops transfer in 2% of their users, `if` blocks in 13%. A per-bar runtime lane exists
and is **dark** (`VITE_PINE_RUNTIME_PANE_ENABLED`); switching it on in a test process attaches
30 more scripts (31.7% vs 27.2%) and opens UDTs (`type`), `array.unshift/pop` and the
drawing setters. The work is finishing that lane to TradingView's execution model (one pass
per bar, `var`/`varip` lifetimes, `max_bars_back` history buffers, rollback of non-`var`
state on the realtime bar), grading it, and arming it.

**Strategy tester emulation (blocks 70, 0 of 70 strategies transfer).** Needs a broker
emulator: order types (market/limit/stop, `strategy.entry/order/exit/close/cancel`, OCA
groups), fill rules (`process_orders_on_close`, `calc_on_every_tick`, slippage,
commission), pyramiding, position sizing (`default_qty_type`), the `strategy.*` read-backs
(`position_size`, `position_avg_price`, `opentrades.*`, `equity`, `netprofit`), on-chart trade
markers, and the Strategy Tester report. Bar-magnifier fills need intrabar data.

**`request.security` across symbols and timeframes (blocks 52).** Of 184 scripts calling it:
122 request the chart's own symbol at another timeframe, 58 a symbol from an input or
variable, 17 a literal other symbol, 17 call `request.security_lower_tf`. The door serves
another symbol only as `sym` on the benchmark roster, exchange-spelled (C26). Literal
prefixes in the sample: bare tickers 58, `INDEX:` 39 (breadth series), `COINBASE:` 8,
`USI:` 5, `BINANCE:` 5, `OANDA:` 3, `QUANDL:` 2. Needs: same-symbol higher-TF resampling with
TradingView's `lookahead`/`gaps` semantics and the repaint rule, arbitrary-symbol fetch,
lower-timeframe arrays (the C41 branch, dark), and the data in section 5.

**Libraries and `import` (blocks 65, 0 transfer).** `import TradingView/ta/10 as ta` and
community libraries. Needs fetching the published library source (public via pine-facade
when the library is open), translating it as a module, and versioned resolution.
`tests/fixtures/pine_library` and `PINE_LIBRARY_STORE` are the start (L1/L2); the
production registry is empty.

**Collections, UDTs, methods (blocks 25 + 21).** `array.*` transfers in 7 of 169 scripts that
call `array.get`; `matrix.*` (49 items) and `map.*` (11) never transfer; UDTs never transfer in
production. All belong to the runtime lane.

**Alerts.** `alertcondition` (176 users) and `alert()` (74) translate, and the vendor harness
does not grade them. Whether a member's alert FIRES like TradingView's (once per bar close,
`alert.freq_*`) is not measured here.

**Realtime and `varip`.** `varip` (7 users, call-unmapped), `barstate.isrealtime` (0 of 12
transfer), `barstate.isnew` (missing). Intrabar semantics need a tick or 1-second stream and
the realtime rollback model.

**Chart types and TradingView built-in tools.** `ticker.heikinashi` transfers (2 of 12
users, verified by one MATCH capture); `ticker.renko/linebreak/kagi/pointfigure` have no
evidence. Renko and point-and-figure built on TradingView's own box rules need their exact
construction (ATR box size on which bars, wicks vs close). TradingView's **Volume Profile**
family (Visible Range, Fixed Range, Session) is not Pine source anyone can paste: it needs
lower-timeframe or tick volume by price (`request.security_lower_tf` or the `footprint` /
`volume_row` objects, data-limited), plus the visible-range binding
(`chart.left_visible_bar_time`, `chart.right_visible_bar_time`, missing).

**Translator robustness (blocks 36).** `pine:timeout` (61 refusals at step 0) and
`pine:roundtrip`. Budgets are never raised (standing ruling), so these are efficiency or
emitter bugs, not policy.

---

## 5. Data-limited items, and the source each needs

56 of 679 scripts use a data-limited item; 62 use one or a non-US-equity literal symbol.

| items | used by | data source that would close it |
|---|---:|---|
| `timeframe.isseconds`, seconds charts | 20 | Seconds-resolution bars (aggregated trades) |
| `request.security_lower_tf` | 17 | Intraday (and sub-minute) bars for any requested symbol, aligned the way TradingView aligns them |
| `request.security` on `INDEX:`, `USI:` (breadth: advancers, decliners, up/down volume) | ~44 | Exchange breadth series as TradingView publishes them (USI/INDEX tickers) |
| `request.security` on `COINBASE:`, `BINANCE:`, `OANDA:` | 16 | Crypto and FX bars from those venues (24/7 sessions) |
| `request.financial` | 0 in sample | FactSet fundamentals by fiscal period with TradingView's field ids |
| `request.earnings`, `earnings.*` | 3 | EPS actual / estimate / standardized history per fiscal period |
| `request.dividends`, `dividends.*` | 3 | Dividend history (ex-date, gross/net) |
| `request.splits`, `splits.*` | 2 | Split history |
| `request.economic` | 0 in sample | Economic series by country/field, with TradingView's vintages |
| `request.footprint`, `footprint.*`, `volume_row.*` | 2 | Tick trades with aggressor side (bid/ask classified volume) |
| `bid`, `ask` | 1 | Live best bid/ask (only defined on the 1T tick chart) |
| `request.currency_rate` | 1 | FX cross rates on TradingView's conversion basis |
| `syminfo.target_price_*`, `recommendations_*`, `employees`, `shareholders`, `shares_outstanding_*` | 1 | Analyst targets, recommendations and share-count fundamentals |
| `syminfo.basecurrency`, `pointvalue`, `root`, `mincontract`, `volumetype`, `minmove`, `pricescale`, `expiration_date`, `current_contract` | 7 | Per-symbol metadata for crypto, FX and futures |
| `request.quandl`, `request.seed` (and `QUANDL:` symbols) | 2 | Nasdaq Data Link (deprecated) and TradingView's Pine Seeds repos: no public equivalent |
| `ticker.inherit`, `ticker.modify` settlement/adjustment variants | 1 | TradingView ticker-id modifiers applied to another symbol's feed |

Even with the data, exact matches for these depend on the vendor's own revisions,
adjustments and session rules, which TradingView does not publish.

---

## 6. Phased roadmap

Cumulative transfer if each phase lands in this order, measured on this sample. "Upper" counts
every script whose known walls are all closed; "firm" counts only scripts whose walls were
fully enumerated. Sizes are rough (S = days, M = 1-3 weeks, L = 1-2 months, XL = a quarter+).

| phase | scope | blocks | unblocks (upper / firm) | cumulative (upper / firm) | size |
|---|---|---:|---:|---:|---|
| 0. today | | | | **27.2%** | |
| 1. Names and robustness | the 17 missing names (calendar fields `dayofmonth/month/year/hour/minute/dayofweek`, `timeframe.in_seconds/isdwm`, `ta.alma/swma/nvi/pvi/rci/tsi/accdist/percentile_nearest_rank`, `math.acos`, `fixnan`, `barstate.isnew`, `line.get_price`), the role-order maps (`ta.cci`, `ta.valuewhen`, `ta.barssince`), `input.time/enum`; fix timeouts and round-trips without raising budgets | 117 | +40 / +24 | 33.1% / 30.8% | M |
| 2. Drawing-object completeness | conditional create/update/delete, per-bar labels, table cell text, drawings in loops and in arrays, `polyline`, `linefill`, `chart.point`; paint-only output contract | 200 | +119 / +64 | 50.7% / 40.2% | L |
| 3. The per-bar runtime lane, finished and armed | `if/for/while/switch` blocks, `:=`, `var/varip` lifetimes, multi-line user functions, tuples, history on expressions and non-literal offsets, text/colour values, `max_bars_back`; graded against captures before the flag moves | 224 | +135 / +59 | 70.5% / 48.9% | XL |
| 4. Collections, UDTs, methods | `array.*`, `matrix.*`, `map.*`, `type`, `method`, `enum`, generics, `for...in` (on the runtime lane) | 45 | +30 / +11 | 75.0% / 50.5% | L |
| 5. `request.*` | same-symbol higher TF with `lookahead`/`gaps` and repaint semantics, other symbols beyond the benchmark roster, lower-TF arrays (ship C41), plus the data sources in section 5 | 52 | +41 / +19 | 81.0% / 53.3% | L (+ data contracts) |
| 6. Libraries | resolve `import` from published open libraries, module translation, versioning | 65 | +59 / +19 | 89.7% / 56.1% | L |
| 7. Strategy tester | broker emulator, `strategy.*` read-backs, trade markers, tester report | 70 | +70 / +28 | 100% / 60.2% | XL |

The firm column stops at 60% because 270 refused scripts were never fully peeled: their
remaining walls are unknown until the earlier phases expose them. Every phase also needs
**parity work**, not just door work: only 51 of today's 185 transferring scripts have a
capture, and 3 of those DIVERGE. A phase is done when its scripts MATCH, not when they attach.

Order rationale: phase 1 is cheap and independent. Phase 2 has the largest single reach and
builds on the shipped object lane. Phase 3 is the largest lever but the largest build; phases
4, 6 and 7 depend on it. Phase 5 is part engineering, part data contracts.

---

## 7. Honest limits (what cannot be matched, and why)

1. **Data we do not have** (section 5): fundamentals, earnings/dividends/splits history,
   economic series, tick and bid/ask data, footprint, seconds bars, non-US-equity venues and
   exchange breadth tickers. Without these, scripts using them can at best run with a gap.
2. **Vendor-internal behaviour that is not published**: exact `request.security`
   alignment on gaps and sessions, how TradingView builds Renko/Kagi/PnF boxes,
   strategy-tester fill and bar-magnifier rules, `%` rounding, how history loads (`bar_index`
   depends on how much history the vendor loaded: `pine:window-dependent`). Each can only be
   matched by capturing TradingView's output and fitting to it, one witnessed behaviour at a time.
3. **Realtime behaviour**: `varip`, `barstate.isrealtime`, alert firing and intrabar
   repainting depend on the live tick stream TradingView sees. A daily-bar capture cannot
   witness them.
4. **Closed and invite-only scripts** are out of scope by definition: only open source can
   be pasted. 3 of 145 TradingView built-ins are closed (Auto Key Levels, Auto Trend
   Detector, the RelativeValue library).
5. **What this measurement cannot see**:
   - **Door acceptance is not parity.** 134 of the 185 transferring scripts have no capture.
   - **Elision**: a name in a transferring script may sit in a binding the translator elided
     as unused, so "supported" can be generous for rarely used names.
   - **Peel estimates**: neutralising a line changes the program, so later walls can be
     consequences of the edit. The wall list is an estimate of order, not a work ticket.
   - **Token attribution**: a wall is keyed to an item only when the refusal's token names
     it; refusals whose token is a user name fall back to the guard's capability.
   - **Sample bias**: the popular head of the catalogue plus TradingView's built-ins. The long
     tail uses more arrays, UDTs and libraries (see `demand-popularity-weighted.md`).
   - **Keyword usage** is detected by regex over comment- and string-stripped source, not a
     parser; v1-v4 bare names are mapped to v6 namespaces (`sma` to `ta.sma`, `security` to
     `request.security`).

---

## How to re-run

All scratch output goes outside the repo. Heavy steps go through the heavy lock.

```sh
SCR=<scratch dir>
# 1. the reference (network: TradingView's public static bundles)
node tools/pine_survey/pine_reference_extract.js --out $SCR/ref/pine_v6_reference.json --cache $SCR/ref/_chunkcache
# 2. the sample (network: two public pine-facade endpoints; sources stay in $SCR)
python tools/pine_coverage/fetch_sample.py --cache $SCR/sample
# 3. fresh vendor verdicts (from app/)
python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label pine-coverage-verdicts -- \
  env VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$SCR/verdicts \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
# 4. the member-door census (about 10 minutes; restarts itself if one script kills the process)
python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label pine-coverage-census -- \
  python tools/pine_coverage/run_census.py --cache $SCR/sample --ref $SCR/ref/pine_v6_reference.json
# 5. optional: the engine's own declared functions through the Pine door (from app/)
COVERAGE_DOOR_OUT=$SCR/engine_door.json node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js
# 6. the map (deterministic for the same inputs)
python tools/pine_coverage/coverage_map.py --cache $SCR/sample --ref $SCR/ref/pine_v6_reference.json \
  --verdicts $SCR/verdicts/verdicts.json --engine-door $SCR/engine_door.json \
  --out docs/pine/coverage-map.json --measured-on <yyyy-mm-dd> --master-sha <sha>
```

A daily job diffs `headline`, `blockers`, `capabilities.greedyRoadmap` and per-item
`status` in `coverage-map.json`. Per-script rows (`scripts[]`) carry each script's
transfer verdict, first guards and walls, so any number walks back to a script.

Files: `tools/pine_coverage/fetch_sample.py`, `tools/pine_coverage/run_census.py`,
`tools/pine_coverage/coverage_map.py`,
`app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js` (opt-in; skipped
unless `COVERAGE_INPUT`/`COVERAGE_OUT` or `COVERAGE_DOOR_OUT` is set; it lives under `app/`
because vitest only serves files inside the app root).
