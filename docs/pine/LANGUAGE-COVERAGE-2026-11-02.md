# Pine language coverage: which Pine v6 items work exactly, per lane

Measured 2026-11-02 on master `cfc35a3b3f`. Machine-readable twin: [`language-coverage-2026-11-02.json`](language-coverage-2026-11-02.json). Built by `tools/pine_coverage/language_coverage.py` (re-run: [How to re-run](#how-to-re-run)).

Owner goal: paste ANY open-source Pine indicator and get what TradingView draws. The coverage map ranks which language features block real scripts. This page is the other half: of every item in TradingView's own Pine v6 reference (1165 of them), which does each lane draw **exactly**, which is merely accepted with nothing to prove it, which is refused by name, and which the lane has never heard of.

## 1. Headline

> **Host lane (what members get today): 205 of 1165 reference items are EXACT (17.6%).** 271 more are supported but unproven, 56 are refused by a named guard, 67 are missing, 566 could not be answered.
>
> **Runtime lane (dark): 47 of 1165 are EXACT (4.0%).** 445 supported but unproven, 111 refused, 85 missing, 477 unanswered.

**EXACT is a high bar and deliberately so.** It needs a TradingView capture the harness graded MATCH with every output compared, or a rail built from a formula TradingView itself publishes, and it is withheld from any item with a declared difference. "Supported, unproven" is the honest word for an item a lane draws that nothing has yet been shown to match: it is not a defect, it is the evidence queue.

| lane | exact | supported, unproven | refused | missing | unanswered | of which partial | of which known difference |
|---|---:|---:|---:|---:|---:|---:|---:|
| host lane (the translator members get today) | 205 | 271 | 56 | 67 | 566 | 105 | 9 |
| runtime lane (dark per-bar interpreter) | 47 | 445 | 111 | 85 | 477 | 142 | 2 |

`partial` counts items accepted somewhere and refused elsewhere (they keep their best status). `known difference` counts supported items held below EXACT by a declared difference. Both are inside the status columns, not extra.

### 1.1 Per kind

| kind | items | lane | exact | supported, unproven | refused | missing | unanswered |
|---|---:|---|---:|---:|---:|---:|---:|
| function | 475 | host lane | 87 | 137 | 41 | 11 | 199 |
|  |  | runtime lane | 14 | 218 | 96 | 22 | 125 |
| method | 213 | host lane | 9 | 20 | 0 | 0 | 184 |
|  |  | runtime lane | 0 | 22 | 0 | 0 | 191 |
| variable | 162 | host lane | 23 | 30 | 8 | 54 | 47 |
|  |  | runtime lane | 5 | 54 | 11 | 56 | 36 |
| constant | 241 | host lane | 50 | 71 | 0 | 2 | 118 |
|  |  | runtime lane | 6 | 117 | 0 | 7 | 111 |
| type | 20 | host lane | 10 | 3 | 2 | 0 | 5 |
|  |  | runtime lane | 3 | 11 | 2 | 0 | 4 |
| keyword | 23 | host lane | 9 | 5 | 5 | 0 | 4 |
|  |  | runtime lane | 5 | 11 | 2 | 0 | 5 |
| annotation | 10 | host lane | 1 | 2 | 0 | 0 | 7 |
|  |  | runtime lane | 1 | 4 | 0 | 0 | 5 |
| operator | 21 | host lane | 16 | 3 | 0 | 0 | 2 |
|  |  | runtime lane | 13 | 8 | 0 | 0 | 0 |

### 1.2 Per namespace (the 15 largest; every namespace is in the JSON, `headline.byNamespace`)

| namespace | items | lane | exact | supported, unproven | refused | missing | unanswered |
|---|---:|---|---:|---:|---:|---:|---:|
| `array` | 98 | host lane | 14 | 22 | 10 | 0 | 52 |
|  |  | runtime lane | 4 | 41 | 14 | 0 | 39 |
| `matrix` | 97 | host lane | 0 | 0 | 7 | 0 | 90 |
|  |  | runtime lane | 0 | 0 | 33 | 0 | 64 |
| `strategy` | 96 | host lane | 0 | 0 | 8 | 0 | 88 |
|  |  | runtime lane | 0 | 0 | 18 | 0 | 78 |
| `(language)` | 74 | host lane | 36 | 13 | 7 | 0 | 18 |
|  |  | runtime lane | 22 | 34 | 4 | 0 | 14 |
| `(global)` | 70 | host lane | 30 | 28 | 3 | 5 | 4 |
|  |  | runtime lane | 10 | 45 | 6 | 7 | 2 |
| `ta` | 69 | host lane | 30 | 29 | 0 | 8 | 2 |
|  |  | runtime lane | 5 | 55 | 1 | 8 | 0 |
| `label` | 63 | host lane | 8 | 16 | 1 | 0 | 38 |
|  |  | runtime lane | 0 | 30 | 1 | 0 | 32 |
| `box` | 58 | host lane | 3 | 20 | 1 | 0 | 34 |
|  |  | runtime lane | 0 | 18 | 1 | 0 | 39 |
| `currency` | 56 | host lane | 0 | 1 | 0 | 0 | 55 |
|  |  | runtime lane | 0 | 1 | 0 | 0 | 55 |
| `line` | 48 | host lane | 10 | 17 | 5 | 0 | 16 |
|  |  | runtime lane | 0 | 32 | 0 | 0 | 16 |
| `table` | 44 | host lane | 3 | 11 | 1 | 0 | 29 |
|  |  | runtime lane | 0 | 12 | 0 | 0 | 32 |
| `syminfo` | 42 | host lane | 2 | 6 | 0 | 22 | 12 |
|  |  | runtime lane | 0 | 10 | 0 | 24 | 8 |
| `math` | 28 | host lane | 9 | 13 | 0 | 6 | 0 |
|  |  | runtime lane | 0 | 22 | 1 | 5 | 0 |
| `color` | 24 | host lane | 15 | 5 | 0 | 0 | 4 |
|  |  | runtime lane | 5 | 15 | 1 | 0 | 3 |
| `map` | 21 | host lane | 0 | 2 | 4 | 0 | 15 |
|  |  | runtime lane | 0 | 0 | 10 | 0 | 11 |

### 1.3 What the numbers rest on

- **679 sample scripts** put to both doors: the host lane drew 223 whole, attached 295; the runtime lane compiled 238.
- **295 TradingView whole-script examples** (the reference's own usage of each item): host drew 81 whole; the runtime lane compiled 135.
- **323 synthesized single-item probes** planned, 323 answered.
- **The instrument's controls** (a run that fails any of them writes nothing): a known-good script was accepted by both lanes (yes); an unknown function was refused by the host lane with `pine:function` and by the runtime lane with `pine:function`; an unknown variable with `pine:function` and `pine:function`.
- **Engine table through the Pine door, host lane**: 60 of the engine's 86 declared functions reached.
- **Engine table through the Pine door, runtime lane**: 59 of the engine's 86 declared functions reached.
- **Vendor captures, host lane**: 369 graded {DIVERGE: 112, INCONCLUSIVE: 153, MATCH: 104}; 75 were fully compared MATCHes and credit their items.
- **Vendor captures, runtime lane**: 369 graded {DIVERGE: 116, INCONCLUSIVE: 131, MATCH: 122}, 56 drawn by the runtime lane; 10 were fully compared MATCHes and credit their items.
- **Usage counts** (ranking only) from `docs/pine/coverage-map.json`: 679 sample scripts, measured 2026-10-31 at `b6a3046739`; a name that is two kinds of item (a cast and a type, a function and a variable) and every method are recounted by kind over the same scripts (for the other items this run's recount agrees with the map on 678 and differs on 11).

## 2. How an item gets its status

- An ITEM is one entry of TradingView's own Pine v6 reference, one per kind per name: a name that is both a function and a variable (`time`) is two items, and a METHOD item is the method-call form (`a.push(x)`) of the function it names. The reference is read locally and never committed; this file carries names, kinds, counts and guard names only.
- TWO LANES, ASKED ABOUT THE SAME SOURCE. HOST is what members get today: the production member door (`memberPaneDefinition` then `installUserDefinitions`, objects-only pane armed, runtime pane dark). RUNTIME is the dark per-bar interpreter, asked through its own existing compile check (`probeRuntimeProgram`), in its value build and its own-drawings build. Nothing here decides what is supported: each answer is what a door said.
- SUPPORTED means a door accepted it: a script that uses the item was drawn whole (host: attached, installed, zero refusals, nothing dropped or withheld; runtime: compiled and reads no other symbol's or timeframe's bars), or its own probe was accepted, or the engine's declared function of that name was reached through the Pine door. An order-placing strategy is drawn as its plots only, so it credits no `strategy.*` item.
- REFUSED and MISSING need an ATTRIBUTABLE refusal: its token is the item, or it sits on the line a probe wrote the item on. A refusal on a probe's set-up line names the constructor it needed, so it blames nothing. A refusal about language (a block, a reassignment, a function body, a type, an import) names no builtin, so it blames the syntax item the guard is about that is written ON the refused line, and nothing else on the line. A name-unknown guard (`pine:function`, `pine:builtin` in the host lane; in the runtime lane whatever it answers to the two unknown-name controls every run asks, with `runtime:unbound` as the floor) is MISSING; any other guard is REFUSED and is named. The runtime lane names one wall per ask, so a refused script is asked again with each refused line neutralised (up to eight times); the later walls name items by their token and never credit anything. An item with no attributable answer is UNANSWERED, never counted as refused or missing.
- EXACT needs proof, and only two kinds count. (1) A vendor capture the harness graded MATCH, every output compared (nothing in `notCompared` or `notMeasured`), whose source uses the item, in THAT lane: the host lane's captures are the production run's, and a capture counts for the runtime lane only when the runtime lane drew it. The link from a capture to an item is presence in the source, so it is tiered: a purpose-built observation or probe credits its items alone, while a community script captured whole uses dozens of items incidentally, so an item it merely uses needs TWO distinct scripts (one script on two symbols is still one script). An item one such capture touches stays SUPPORTED and is marked not corroborated. (2) A reference-formula rail from the registry, counted only when it compares every bar AND TradingView's own reference publishes a formula or a reference implementation for the item. A rail against a definition the reference does not publish is recorded and proves nothing about TradingView.
- A DECLARED DIFFERENCE (the engine's own vendor notes and its accepted or open divergence ledger) keeps an item at SUPPORTED however many captures matched: a capture that matches in steady state does not erase a documented difference at the edges.
- PARTIAL: an item accepted somewhere and refused elsewhere keeps its best status and carries the guards that refused it. `request.security` and `array.get` are the usual cases.
- Usage counts come from the committed coverage map (679 sample scripts); they only rank. Statuses are re-measured on the master named above, not read from that map.

## 3. The top refused and missing items, by how many sample scripts use them

### 3.1 host lane: 123 items refused or missing

| item | kind | scripts using it | status | guard | note |
|---|---|---:|---|---|---|
| `import` | keyword | 65 | refused | `pine:module` |  |
| `type` | keyword | 57 | refused | `pine:type` |  |
| `line.set_style` | function | 19 | refused | `objects:loop-blocked` |  |
| `strategy.position_size` | variable | 18 | refused | `pine:strategy-call` |  |
| `line.get_x1` | function | 17 | refused | `pine:drawing` |  |
| `strategy.position_avg_price` | variable | 16 | refused | `pine:strategy-call` |  |
| `str.tonumber` | function | 15 | missing | `pine:builtin` |  |
| `input.time` | function | 14 | refused | `pine:input-kind` |  |
| `syminfo.type` | variable | 11 | missing | `pine:builtin` |  |
| `line.get_price` | function | 10 | refused | `pine:drawing` |  |
| `chart.left_visible_bar_time` | variable | 10 | missing | `pine:builtin` |  |
| `input.enum` | function | 9 | refused | `pine:input-kind` |  |
| `array.insert` | function | 8 | refused | `pine:collection` |  |
| `matrix.get` | function | 7 | refused | `pine:collection` |  |
| `ta.sar` | function | 7 | missing | `pine:function` |  |
| `chart.right_visible_bar_time` | variable | 7 | missing | `pine:builtin` |  |
| `enum` | keyword | 7 | refused | `pine:type` |  |
| `varip` | keyword | 7 | refused | `pine:state` |  |
| `barstate.isnew` | variable | 6 | missing | `pine:builtin` |  |
| `strategy.opentrades` | variable | 6 | refused | `pine:strategy-call` |  |
| `map` | type | 6 | refused | `pine:collection` |  |
| `matrix` | type | 6 | refused | `pine:collection` |  |
| `array.last` | function | 5 | refused | `objects:unsupported` |  |
| `strategy.equity` | variable | 5 | refused | `pine:strategy-call` |  |
| `array.includes` | function | 4 | refused | `pine:collection` |  |

### 3.2 runtime lane: 196 items refused or missing

| item | kind | scripts using it | status | guard | note |
|---|---|---:|---|---|---|
| `strategy.entry` | function | 68 | refused | `pine:statement` |  |
| `import` | keyword | 65 | refused | `runtime:library` |  |
| `plotcandle` | function | 36 | refused | `runtime:presentation` |  |
| `strategy.exit` | function | 25 | refused | `pine:statement` |  |
| `strategy.close` | function | 23 | refused | `pine:statement` |  |
| `line` | function | 18 | missing | `pine:function` |  |
| `strategy.position_size` | variable | 18 | refused | `pine:strategy-call` |  |
| `request.security_lower_tf` | function | 17 | refused | `runtime:request-with-state` | data we do not hold |
| `strategy.position_avg_price` | variable | 16 | refused | `pine:strategy-call` |  |
| `str.substring` | function | 15 | refused | `runtime:call-text-state` |  |
| `str.tonumber` | function | 15 | refused | `runtime:call-text-state` |  |
| `chart.point.from_index` | function | 12 | refused | `runtime:call-undeclared-builtin-state` |  |
| `syminfo.type` | variable | 11 | missing | `pine:builtin` |  |
| `label` | function | 10 | missing | `pine:function` |  |
| `log.info` | function | 10 | refused | `runtime:expression-statement` |  |
| `chart.left_visible_bar_time` | variable | 10 | missing | `pine:builtin` |  |
| `input.enum` | function | 9 | refused | `pine:input-kind` |  |
| `string` | function | 9 | missing | `pine:function` |  |
| `array.insert` | function | 8 | refused | `runtime:array` |  |
| `font.family_monospace` | constant | 8 | missing | `pine:builtin` |  |
| `array.fill` | function | 7 | refused | `runtime:array` |  |
| `array.sort` | function | 7 | refused | `runtime:array` |  |
| `matrix.get` | function | 7 | refused | `runtime:array` |  |
| `ta.dmi` | function | 7 | missing | `pine:function` |  |
| `chart.right_visible_bar_time` | variable | 7 | missing | `pine:builtin` |  |

### 3.3 What arming the runtime lane would add

55 items the host lane refuses, misses or cannot answer and the runtime lane accepts, by sample-script use (association, not attribution: the runtime lane may reach them through a statement the host lane lacks).

| item | kind | scripts using it | host lane | host guard | runtime lane |
|---|---|---:|---|---|---|
| `type` | keyword | 57 | refused | `pine:type` | supported, unproven |
| `line.set_xy2` | function | 33 | unanswered |  | supported, unproven |
| `line.set_xy1` | function | 30 | unanswered |  | supported, unproven |
| `array.new_label` | function | 29 | unanswered |  | supported, unproven |
| `-=` | operator | 28 | unanswered |  | supported, unproven |
| `array.unshift` | method | 23 | unanswered |  | supported, unproven |
| `barmerge.lookahead_off` | constant | 23 | unanswered |  | supported, unproven |
| `simple` | type | 23 | unanswered |  | supported, unproven |
| `array.set` | method | 21 | unanswered |  | supported, unproven |
| `line.set_style` | function | 19 | refused | `objects:loop-blocked` | supported, unproven |
| `line.get_x1` | function | 17 | refused | `pine:drawing` | supported, unproven |
| `continue` | keyword | 17 | unanswered |  | supported, unproven |
| `str.split` | function | 15 | unanswered |  | supported, unproven |
| `array.new_string` | function | 14 | unanswered |  | supported, unproven |
| `input.time` | function | 14 | refused | `pine:input-kind` | supported, unproven |
| `label.set_style` | function | 10 | unanswered |  | supported, unproven |
| `line.get_price` | function | 10 | refused | `pine:drawing` | supported, unproven |
| `label.style_label_upper_left` | constant | 8 | unanswered |  | supported, unproven |
| `shape.square` | constant | 8 | unanswered |  | supported, unproven |
| `ta.sar` | function | 7 | missing | `pine:function` | supported, unproven |

## 4. The next conformance rails: supported, unproven, and TradingView publishes the formula

Each of these is one rail away from EXACT: the reference carries a Pine reimplementation (`implementation`) or states the calculation (`stated`), so a test can difference our column against it with no capture. Implementations first, then by use. A `definition rail` is a rail that already compares to a definition the reference does not publish (informative, not proof).

### 4.1 host lane: 10 items

| item | kind | scripts using it | formula | note |
|---|---|---:|---|---|
| `ta.supertrend` | function | 12 | implementation | declared difference: supertrend-bounded-recurrence |
| `ta.mfi` | function | 11 | implementation |  |
| `ta.obv` | variable | 10 | implementation |  |
| `ta.alma` | function | 8 | implementation |  |
| `ta.bb` | function | 5 | implementation |  |
| `ta.nvi` | variable | 3 | implementation |  |
| `ta.pvi` | variable | 3 | implementation |  |
| `ta.kc` | function | 1 | implementation |  |
| `ta.bbw` | function | 0 | implementation |  |
| `ta.kcw` | function | 0 | implementation |  |

### 4.2 runtime lane: 24 items

| item | kind | scripts using it | formula | note |
|---|---|---:|---|---|
| `ta.ema` | function | 174 | implementation |  |
| `ta.atr` | function | 147 | implementation |  |
| `ta.rsi` | function | 78 | implementation |  |
| `ta.rma` | function | 66 | implementation |  |
| `ta.stdev` | function | 66 | implementation |  |
| `ta.wma` | function | 63 | implementation |  |
| `ta.dev` | function | 19 | implementation |  |
| `ta.supertrend` | function | 12 | implementation |  |
| `ta.mfi` | function | 11 | implementation |  |
| `ta.obv` | variable | 10 | implementation |  |
| `ta.sar` | function | 7 | implementation |  |
| `ta.bb` | function | 5 | implementation |  |
| `ta.swma` | function | 4 | implementation |  |
| `ta.nvi` | variable | 3 | implementation |  |
| `ta.pvi` | variable | 3 | implementation |  |
| `ta.kc` | function | 1 | implementation |  |
| `ta.bbw` | function | 0 | implementation |  |
| `ta.kcw` | function | 0 | implementation |  |
| `ta.crossunder` | function | 126 | stated |  |
| `ta.tr` | variable | 33 | stated |  |
| `ta.stoch` | function | 23 | stated |  |
| `ta.cci` | function | 15 | stated |  |
| `ta.tr` | function | 10 | stated |  |
| `ta.roc` | function | 8 | stated |  |

## 5. Supported, but known to differ from TradingView

| item | kind | lane | status | declared difference |
|---|---|---|---|---|
| `request.security` | function | host lane | supported, unproven | request-security-base-period-identity |
| `ta.supertrend` | function | host lane | supported, unproven | supertrend-bounded-recurrence |
| `barstate.isconfirmed` | variable | host lane | supported, unproven | barstate-three-axes, barstate-viewer-dependent |
| `barstate.ishistory` | variable | host lane | supported, unproven | barstate-three-axes, barstate-viewer-dependent |
| `barstate.islastconfirmedhistory` | variable | host lane | supported, unproven | barstate-three-axes, barstate-viewer-dependent |
| `barstate.isrealtime` | variable | host lane | supported, unproven | barstate-three-axes, barstate-viewer-dependent |
| `volume` | variable | host lane | supported, unproven | volume-provenance |
| `volume` | variable | runtime lane | supported, unproven | volume-provenance |
| `%` | operator | host lane | supported, unproven | mod-sign-of-the-dividend |
| `%` | operator | runtime lane | supported, unproven | mod-sign-of-the-dividend |

## 6. Items no door has answered

- **host lane**: 566 unanswered (annotation 7, constant 118, function 199, keyword 4, method 184, operator 2, type 5, variable 47).
- **runtime lane**: 477 unanswered (annotation 5, constant 111, function 125, keyword 5, method 191, type 4, variable 36).

An unanswered item is not counted as refused or missing: no script, example or probe put it to a door in a way that answers, so the honest word is that nobody has asked. They are listed per item in the JSON. The ones real scripts DO use (usually because every script that uses them is stopped by another wall first) are the queue for the next probe pass:

- **host lane**, 238 used items, the busiest: `strategy.entry` (function, 68), `as` (keyword, 65), `strategy.long` (constant, 63), `strategy.short` (constant, 55), `line.set_xy2` (function, 33), `line.set_xy1` (function, 30), `array.new_label` (function, 29), `-=` (operator, 28), `strategy.exit` (function, 25), `strategy.close` (function, 23), `array.unshift` (method, 23), `barmerge.lookahead_off` (constant, 23).
- **runtime lane**, 189 used items, the busiest: `as` (keyword, 65), `strategy.long` (constant, 63), `strategy.short` (constant, 55), `in` (keyword, 43), `strategy.percent_of_equity` (constant, 21), `array.clear` (method, 20), `line.delete` (method, 19), `array.remove` (method, 16), `chart.point` (type, 16), `label.delete` (method, 15), `array.pop` (method, 14), `table.cell` (method, 14).

## 7. What this cannot see

- **Door acceptance is not numeric parity.** SUPPORTED means a lane drew it; only EXACT says it equals TradingView, and only on the evidence named in the JSON for that item and lane.
- **A capture MATCH credits every item in the capture's source.** The link is the item's presence in code the lane drew whole and graded whole; an item sitting in code that feeds no output would be over-credited (none is known).
- **The runtime lane is asked only through its compile check.** It declines later (a request for other bars, the starter allowlist, a repaint class it cannot state) are not visible here beyond `runtime:request`.
- **Real scripts under-use the language**: items nobody wrote into a sample script rest on their probe or TradingView's own example, and the rest are listed as unanswered.
- **The rail registry is a seed**, not a census of every test in the repo: it lists rails whose items and oracle were read in full. Every other rail is a candidate for the next pass.

## 8. How the programme uses it

- **Re-run it after every merged wave** and diff the JSON: the exact counts and the supported counts should only move up. A REFUSED or MISSING item turning SUPPORTED is that wave's win; a SUPPORTED item falling to REFUSED is a regression the sample census would not have named.
- **The conformance queue is section 4**: every item there is one test away from EXACT with no capture needed. The capture queue (`docs/pine/capture-queue-*.md`) is for the supported items TradingView publishes no formula for.
- **The walls are section 3**, ranked by what real scripts use, per lane, with the guard that refuses each. Section 3.3 is what arming the runtime lane would buy today.
- **Never read a status as parity.** EXACT is a claim with a named witness; SUPPORTED is only that a door draws it.

## How to re-run

```sh
source docs/pine/parity-programme/scripts/env-laptop.sh        # UCT_PY, UCT_RESUME, hl
R=$UCT_RESUME/runs/lang; mkdir -p $R
python tools/pine_coverage/language_coverage.py inputs --cache $UCT_RESUME/pine-sample \
    --ref $UCT_RESUME/runs/C/ref_rebuilt.json --out-dir $R/in
cd app
# the engine's declared functions through the Pine door: host lane, then the runtime twin, then the capture lanes
COVERAGE_DOOR_OUT=$R/engine_door.json hl door -- node node_modules/vitest/vitest.mjs run \
    src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=2
LANGUAGE_COVERAGE_DOOR_RUNTIME_OUT=$R/engine_door_runtime.json hl door-rt -- node node_modules/vitest/vitest.mjs run \
    src/components/chart/engine/ast/languageCoverageDoors.measure.test.js --maxWorkers=2
LANGUAGE_COVERAGE_CAPTURE_LANES_OUT=$R/capture_lanes.json hl lanes -- node node_modules/vitest/vitest.mjs run \
    src/components/chart/engine/ast/languageCoverageDoors.measure.test.js --maxWorkers=2
# the vendor harness, each lane
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_OUT=$R/harness-prod hl h0 -- node node_modules/vitest/vitest.mjs run \
    src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_OUT=$R/harness-rt hl h1 -- node node_modules/vitest/vitest.mjs run \
    src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2
cd ..
# the sample and the examples through both lanes
hl probe -- python tools/pine_coverage/run_language_probe.py --inputs $R/in/inputs.json --out $R/in-rows.jsonl
# the single-item probes (plus the three controls) through both lanes
python tools/pine_coverage/language_coverage.py probes --ref $UCT_RESUME/runs/C/ref_rebuilt.json --out $R/probes.json
hl probe-items -- python tools/pine_coverage/run_language_probe.py --inputs $R/probes.json --out $R/probe-rows.jsonl
python tools/pine_coverage/language_coverage.py build --ref $UCT_RESUME/runs/C/ref_rebuilt.json \
    --coverage-map docs/pine/coverage-map.json --inputs $R/in/inputs.json --door-answers $R/in-rows.jsonl \
    --probes $R/probes.json --probe-answers $R/probe-rows.jsonl \
    --engine-door $R/engine_door.json --engine-door-runtime $R/engine_door_runtime.json \
    --verdicts $R/harness-prod/verdicts.json --runtime-verdicts $R/harness-rt/verdicts.json \
    --capture-lanes $R/capture_lanes.json --measured-on <date> --master-sha <sha> \
    --out docs/pine/language-coverage-2026-11-02.json --md docs/pine/LANGUAGE-COVERAGE-2026-11-02.md
```

Deterministic: same inputs, same bytes (sorted keys, no clock). No network. The reference and the sample are licence-held and read locally; only names, kinds, counts and guard names are written.
