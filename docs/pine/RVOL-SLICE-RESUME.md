# Pine RVOL slice — RESUME HERE

> **Branch `feat/pine-value-model`. Read this before touching the Pine engine.**
> State at **`ac44defbf`**, 2026-09-22 (was `17192d37d`). Nothing here is merged
> and nothing reaches a member.
>
> ⚠️ `docs/pine/SESSION-STATE.md` is the **closed R0/R1 wave's** resume doc, not
> this one. Do not update it for this work.
>
> ### ⭐⭐ 2026-09-22 — THE VENDOR AGREES. SIX COMMITS, FIVE ROOT CAUSES.
>
> **Every indicator that CAN be compared now matches TradingView.** The only
> remaining row is `request.security`, a missing data feed rather than a
> translation defect. Full write-up: **`docs/pine/PARITY-ROOT-CAUSE.md`**.
>
> | | |
> |---|---|
> | `239fd83ed` | **RC-B** — the drawing quota EVICTS THE OLDEST, as Pine does. Default cap was 500 (Pine's is 50) and at the cap we `fail()`ed, which keeps the OLDEST objects. `objectPool.js` had held the correct FIFO, with green tests, unwired past its own expiry. |
> | `e9646c396` | **RC-C** — the forward axis counts SESSIONS, not calendar days. `bar_index + 3` from a Friday landed on the weekend. The cadence is DERIVED from the series' own weekdays, so weekly and 24/7 series need no special case. |
> | `c8b4ce0b1` | **S4** — a parking note may not outlive its own expiry. Expiries are DATA now; a lapsed one fails BY NAME. This is what let RC-B's fix sit unwired for eight days past its date. |
> | `f9947dca3` | **RC-D** — a linefill has a LIFETIME, not a budget. It dies with its lines, and at the ceiling evicts rather than abandoning the drawing. |
> | `ac44defbf` | **RC-E + RC-F** — the drawing lane did not know which language it was reading, and Pine's `time` is milliseconds. |
>
> ⛔⛔ **RC-E IS THE ONE TO CARRY FORWARD, AND IT IS A ONE-ARGUMENT BUG.**
> `pineRuntimeFrontend.js` built both its resolvers as `new Resolver(env, TABLE,
> new Map(), {})` — an EMPTY options object — so `pineVersion` was null in the
> lane that DRAWS and every version-conditional rule in `pine.js` silently
> answered *"this is not Pine"*. RC-A had taught the resolver that a bare
> `pivothigh` in a v4 script is Pine's confirmation-shifted column, verified it
> through `translatePine`, and shipped — while the drawing lane kept the
> unshifted house column and every trendline sat one pivot span early against
> TradingView. **Look-ahead, in the lane that draws, with RC-A's rail green one
> lane over.** ⭐ *A fix is only as wide as the lane you measured it in.*
>
> ⚰️ **AND THE DOC WAS WRONG ABOUT LIQUIDITY POOLS.** `PARITY-ROOT-CAUSE.md`
> said the line cap "explains Liquidity Pools completely". It explained nothing:
> that script declares `max_lines_count=500` and never had more than 86 lines
> live. It was REFUSING at bar 250 on a `linefill` envelope Pine does not
> publish at all. **Found only because re-measuring after RC-B showed the
> numbers had not moved** — a plausible mechanism that fit the symptom had been
> allowed to stand in for the measured one.
>
> ⭐ **NEW INSTRUMENT: `runtime/__tests__/guardProbe.measure.test.js`.** The
> census's companion. A census row counts a TOKEN, not a capability, and this
> prints a row's scripts grouped by refusal SHAPE so the number of jobs hiding
> in it is visible. It immediately re-sized `pine:input-kind` from "10 scripts,
> one named root cause" to **three capabilities** — `input.color` 4,
> `input.timeframe` 4, `input.symbol` 2, the last two feeding a
> `request.security` with no feed here. Run it before sizing any row.
>
> **Object-lane census: BUILDS 6 of 266** (was 2 on 2026-09-21). The six are
> exactly the six vendor-compared indicators. `runtime/pine:builtin` 16 → 12.
> ### ⛔⛔ 2026-09-21, LATER — THE DRAWING FAMILIES, AND ONE NUMBER THAT DID NOT MOVE
>
> Branch **`pine/runtime-object-ops`** off `feat/pine-value-model`, at
> **`03a0d21a3`** (two commits, pushed, not merged).
>
> | | |
> |---|---|
> | `9f0e1fde1` | **the DRAWING arrays** — `array.new_box`/`_line`/`_label`/`_linefill`, plus a zero-size fix that is general |
> | `03a0d21a3` | **`runtime:object-op` is a question about the CALLER** — the refusal says so, a value-position drawing is filed under its own family, and the census asks both questions |
>
> ⭐⭐ **THE HEADLINE IS THE NUMBER THAT DID NOT MOVE.** A new standing
> instrument, `runtime/__tests__/objectLaneCensus.measure.test.js`, measures the
> PRODUCT path — `buildObjectLane`, the pipeline a drawing actually goes
> through, with every refusal tagged by the lane that raised it. It reads
> **2 of 266 draw end to end**, and it read 2 of 266 before this work as well —
> **the same two scripts** (`4c-nyse-market-breadth-ratio`,
> `makuchaku039s-trade-tools-fair-value-gaps`). Both commits moved the
> runtime-lane census and neither moved the drawing.
>
> ⛔ **So the runtime-lane census is not the product's bottleneck, and planning
> from it alone will keep producing that result.** Roughly half the corpus dies
> in the OBJECT PASS before the runtime lane is consulted at all —
> `pine:character` 23, `objects:nothing-drawn` 13, `pine:declaration-strategy`
> 13, `pine:block` 11, `objects:iterated-tree-not-last-bar` 11. Read the
> object-lane table BESIDE the runtime-lane one before choosing the next
> capability.
>
> ⭐⭐ **AND `runtime:object-op` WAS NEVER THE WORK QUEUE IT LOOKED LIKE.**
> Measured: **11 of its 12** scripts move off it the moment the caller declares
> it owns the drawing (`objectTrees`, which `buildObjectLane` always passes),
> and **four then compile end to end**. The row was the harness asking a
> two-lane pipeline with one lane — the same disease as the clock contamination
> that file already rails against. There is now a second contamination rail
> beside the clock one, and the owned pass prints its own table
> (**compiled 12/266 owned vs 8/266 bare**).
>
> ⭐ **The ONE genuine gap in that family** is a drawing used as a VALUE —
> `array.push(highLineArray, line.new(…))`, `liquidity-levels-sonarlab` @L170.
> It is refused under ownership too, deliberately: there is no honest number
> for a drawing handle, and `na` would make `na(array.get(zones, i))` read TRUE
> for a line already drawn. Pinned in `ast/objectOpOwnership.test.js`.
>
> **Census delta, runtime lane, bare:** `runtime:array` **8 → 3** ·
> `runtime:object-op` **8 → 12** and `pine:drawing` **5 → 1** (a clean
> reclassification — 13 both sides, nothing gained or lost) · compiled
> **8 → 8**.
>
> ### 2026-09-21 — items 1-4 of NEXT, IN ORDER are closed
>
> | | |
> |---|---|
> | `3e93cb281` | **`table.clear` is carried** — a cell the author removed leaves the drawing |
> | `e04815d69` | **`text_formatting` is carried AND rendered** — the target's 6 header cells keep their bold |
> | `17192d37d` | **the corpus census is a command**, not prose: `runtimeCorpusCensus.measure.test.js` |
>
> **Compiled end to end: 8 of 266 (3.0%)**, up from 5. Item 2
> (`calc_bars_count`) is measured and deliberately left inert — the reason is in
> the list, and it is a measurement, not a preference.
>
> ### 2026-09-21 — item 5 closed, and it moved the corpus by ZERO
>
> **History / window / `ta.change` over an EXPRESSION** compiles at a root
> statement (`historyExpression.test.js`). **`compiled` stayed at 8/266 and
> `runtime:history-expression` stayed at 3** — all three of its scripts hit the
> construct inside a user function. A spike that widened the scope to function
> bodies took the guard **3 → 0** with `compiled` **still 8**. The whole
> capability, at maximum scope, buys nothing on this corpus. Details in item 5.
>
> ⚰️⚰️ **AND `16  [` IN THE DEMAND CENSUS IS NOT THE HISTORY OPERATOR.** Fifteen
> of those sixteen call sites are **tuple destructuring** (`[a, b] = f(…)`); one
> is a history read. That row is one TOKEN over two unrelated capabilities.
> **Read the call sites before sizing a row of that table.**
>
> ⭐ **What is left is NOT more of the same.** Item 6 (the gradient fill) is a
> RENDERER job by its own description, and item 7 needs the market open. The
> cheap, principled items in this lane are done.
>
> ⛔ **The standing question is untouched and is still the owner's:** all of this
> improves a lane with **zero live importers** (ruling D2). The objects-only pane
> path is dark behind `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`.

> ## ⛔⛔ THE ACCEPTANCE SCRIPT CHANGED, AND IT IS NOT IN THIS REPO
>
> The owner switched targets on 2026-09-20: **"RVOL + ATR Dashboard"**, not the
> corpus's `strong-start-rvol-dashboard`. Both are parked OUTSIDE the repo at
>
> ```
> C:\Users\Patrick\uct-pine-local\rvol-atr-dashboard.pine        <- THE TARGET (143 lines)
> C:\Users\Patrick\uct-pine-local\strong-start-rvol-dashboard.pine  <- the previous one
> ```
>
> ⛔⛔ **NEVER COMMIT EITHER.** This repo is PUBLIC and the target carries no
> licence header. It was previously held in a session scratchpad, which a new
> session cannot reach — that is why it now lives at a durable path instead.
>
> ⭐ Its SHAPE is reproduced, licence-free, in
> `app/src/components/chart/engine/runtime/__tests__/watchlistDashboard.test.js`.
> Use that rail for regression work; use the parked file only to re-measure the
> real thing.

---

## ⛔⛔ THE ONE THING TO KNOW FIRST

**The runtime lane has ZERO live importers, by owner ruling D2.**

Nothing outside `engine/ast/` and `engine/runtime/` imports `buildRuntimeIr`,
`lowerIrProgram` or the VM. `__tests__/pineRuntimeFrontendGate.test.js` exists to
say so and to keep it true. The member pane is driven by the **HOST lane's saved
definition** — `paneGate.js::PANE_LANE = 'host'`.

**So every runtime-lane capability improves a compiler that currently draws
nothing.** That is a deliberate decision about which translation is
authoritative, not an oversight, and revisiting it is the owner's call.

⭐ This was discovered late in the session, after seven commits of runtime-lane
work. The work is real and correct; what changed is the understanding of what it
is *for*. Read this section before planning more of it.

---

## ⭐⭐ THE TARGET BUILDS, RUNS AND DRAWS (at `9d68ddab5`)

Measured end to end through `buildObjectLane` → `runObjectLane`, two passes,
with real per-symbol request bars. No layer mocked:

```
Symbol | RVOL        CCC | 545%        BBB | 288%        AAA | 149%
```

Ranked by `array.sort_indices(…, order.descending)`; symbols extracted from
`NASDAQ:CCC` by `str.split`; RVOL exact (`3000/((500*49+3000)/50) = 545%`).
`droppedOps 0`, `droppedPropNames []`, `loopValuesUnresolved 0`.

The wall moved **L82 → L106 → L129 → L143 → none** over this session.

⚠️ **The ORB column reads `NO` in that fixture and that is CORRECT** — the only
09:30 ET bar in it IS the opening bar, and `openingRangeComplete` excludes it.
The ORB logic is proved separately in `objectLane`/clock rails
(`NaN,0,1,1,1,1,1,1` once later closes exceed the opening range).

✅ **`table.clear` IS CARRIED (2026-09-21).** It used to be read, filed under
`objectDiagnostics.unsupported`, and then dropped — absent from the ops AND
absent from `droppedOps`, so nothing downstream could tell the call had ever
been there. It is now a real `clear` op through all four layers (reader →
converter → program → runtime) and removes the inclusive rectangle it names.

⭐ **Carried, not refused, and the reason is worth keeping:** refusing it by
name would have stopped the acceptance dashboard, which calls it at its own
line 108 — a by-name refusal was the only option that would have REGRESSED the
one script this lane can currently draw. Ten of the 266 corpus scripts call it,
17+ sites.

⚠️ **It is not a whole-table fix.** On `strong-start-rvol-dashboard` the two
clears still do not reach the program: both sit under a guard the converter
cannot translate, which is the same pre-existing limit that drops 8 of that
same script's CELLS (`guard:cell`). What changed there is that an
untranslatable clear is now a COUNTED drop with a named reason
(`dropReasons['guard:clear'] === 2`) instead of vanishing.

### The previous script (`strong-start-rvol-dashboard`)

Its own status below is from `8b0581541` and is **not re-measured**. Several of
its listed blockers (object-pass loops, dropped props, `unresolvedValues`) were
closed by this session's work; re-measure before acting on any of it.

Measured at `8b0581541`. Re-measure rather than quoting these.

| | runtime lane | host lane (the one that draws) |
|---|---|---|
| `strong-start-rvol-dashboard__36140b1cbe.pine` | `ok=false`, 50 stmts, `runtime:history-expression @L57` | `ok=false`, 0 outputs, **`pine:objects-only`, 3 object ops** |
| `rvol__05fcd9e160.pine` | `ok=false`, 19 stmts, `runtime:fill-gradient @L26` | **`ok=true`, 2 plots, 0 refusals** |

### The dashboard (script 1) — the friend's script

**It has no plots. It draws one table.** The host lane refused it at
`pine:no-output` — *"offers no plot and no alert condition to filter on"*, which
is TRUE and which its author reads as "this engine cannot see my script". The
object pass, which understands its table perfectly, **never ran**: it sits ~40
lines after that early return.

✅ Fixed (`dbfc982b5`): `runObjectPass()` extracted and called from both sites,
new guard `pine:objects-only`, `objects` now survives the refusal. `ok` stays
FALSE — there genuinely is no column to screen on.

✅ **IT DRAWS — measured end to end, no layer mocked** (`5bc01520b`). Owner
decision 2026-09-20: admit an objects-only verdict to the pane, **dark behind
`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`** (default OFF, `dark` in the ledger).
Through the member's own route — `memberPaneDefinition` → `objectReaderFor` →
`evaluateObjects` → `toRenderState` → `layoutTables` → `renderTables` — the
dashboard puts **a real `<table>` in the DOM reading `RVOL 100%`**.

Three things stood in the way and only one was the ruling: `paneGate` refusing
`ok !== true`; `buildDefinition` taking its primary from `rows[0]` (now a HIDDEN
anchor — the `plot(0)` placeholder its peers write by hand); and
`if (!visible.length)` saying *"declares nothing a chart can draw"*, which had
become false. Plus a hole only this path reaches: the objects-only return
dropped `mode`, so the verdict arrived as *"from the unknown lane"*.

⛔⛔ **IT DRAWS; IT IS NOT YET IDENTICAL — ONE CELL OF MANY.** The engine names
its own gap. Read `objectDiagnostics` off the definition:

```
loopBlocked: 15   loopBlockedCalls: [array.push, array.set, table.cell]
unsupported: [table.clear]        unresolvedValues: 12
droppedOps: 8     dropReasons: { guard:cell: 8 }
droppedProps: 3   [table.position@122, cell.bgcolor@210, cell.text_size@210]
```

The script writes its per-symbol rows inside `for i = 0 to slots - 1` (line 77)
and **the object pass does not carry loop bodies**. That is the whole difference
between the header cell rendering and the watchlist rendering.

⭐ So the next capability is **loops in the OBJECT PASS** — then `table.clear`,
the 8 `guard:cell` drops, and the 3 dropped props.

⚠️ Its runtime-lane blocker is separate and unrelated:
`calcDaily(simple int N) => ta.sma(volume[1], N)` has **never compiled in any
context**. The cause is the parameterised LENGTH — a `simple int` parameter
cannot fold before bar 0, so the window's ring cannot be sized. Serving it needs
the body lowered **per CALL SITE** (monomorphisation), because one compiled body
is shared by every site today. Corpus demand for that: **4 of 266.**

### Script 2 — already translates live

`ok=true`, 2 plots, 0 refusals on the host lane today. Its only runtime-lane gap
is the **six-arg gradient** `fill(p1, p2, top_value, bottom_value, top_colour,
bottom_colour)`, refused by name as `runtime:fill-gradient`. `fillPrimitive.js`
paints ONE colour across a span; the gradient shades vertically between two
values and is a renderer capability, not a front-end one.

---

## WHAT SHIPPED (9 commits, all mutation-proved, all 0 NEW failures)

| SHA | What |
|---|---|
| `5036c74e9` | `request.security` — fixed-point symbol discovery, measured M1 alignment, `lookahead` refused by name. 11/11 mutations. |
| `e59d89324` | The front door — `PineRefusal` positions were being **dropped entirely** (~70 of 266 first blockers reported `line: null`). Plus multi-line string literals and spaced dotted names. 7/7. |
| `1364f1059` | **A plot bound to a name silently disappeared.** 67 of 266 scripts bind a plot; 375 bound calls. One emitter now serves both spellings. 5/5. |
| `64d9c0cf8` | `alertcondition` + `hline` are outputs, not presentation. 5/5. |
| `adf790f95` | Typed array constructors (`array.new_float` …) by delegation. 5/5. |
| `a9d405dd4` | **The colour channel** — a colour is a packed `0xTTBBGGRR` int; `bgcolor`/`barcolor` paint. 8/8. |
| `078778009` | `fill()` — an output becomes a descriptor carrying its span. 7/7. |
| `dbfc982b5` | **`pine:objects-only`** — a table-only script keeps its drawing. 5/5. |
| `8b0581541` | A text input may NAME its default; **19 corpus scripts** move off `pine:no-output`. 4/4. |
| `477da5bc8` | **The ET clock + session clock + statement bodies in a request.** `etClockAt` extracted as ONE clock both lanes read; `OP.READ_CLOCK` + `OP.SESSION`; `hour/minute(time, tz)`, `time(tf,"0930-1600",tz)`; a `var`/`if` helper body lowered INTO a request's region; `%` routed to the same `mod` the columnar lane already used; `array.sort_indices` (M7 tie order); hex colour literals. |
| `d54e1af5b` | **Build fix, unrelated to Pine.** `vite.config.js` had a duplicate `build:` key — the last won, so `chunkSizeWarningLimit` and the WHOLE `rollupOptions.manualChunks` block were dead from 2026-09-12. Four vendor chunks restored. |
| `9d68ddab5` | **The dashboard draws.** Object trees lowered where their names live; inline frames applied to raw trees; per-iteration values ride the member's own loop (parallel loop kept as fallback); `runObjectLane` forwards `barTimes`/`requestBars` and returns `requested`; three text-read-as-numeric holes closed. |

**32 test files** added or changed on the branch.

---

## THE CORPUS MAP — where 266 real published scripts die

⭐⭐ **RE-MEASURE, DO NOT QUOTE — AND SINCE 2026-09-21 THAT IS ONE COMMAND:**

```sh
cd app && node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/runtimeCorpusCensus.measure.test.js

# ⭐⭐ AND SINCE 2026-09-21 THERE IS A SECOND ONE, WHICH IS THE PRODUCT'S
# OWN QUESTION: does the script DRAW? Read them together — the runtime-lane
# table moved twice this day and this one did not move at all.
cd app && node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/runtime/__tests__/objectLaneCensus.measure.test.js
```

It prints the whole first-blocker table and **asserts no count**, deliberately:
a census pinned to a number goes red every time the lane improves, which is why
several `.measure` files already sit in the failing baseline. What it does
assert is that the corpus was found, that every script is accounted for
(nothing silently dropped from the walk), and the contamination rail below.

⚰️ **This section used to be hand-recorded prose under the instruction
"re-measure, do not quote" — with no way to re-measure.** So every reader either
trusted numbers that predated several waves of work or rebuilt the harness from
scratch. Its figures were three commits and two capabilities stale by the time
anyone read them.

**Measured 2026-09-21 at `e04815d69`, 266 scripts, tf=D, clock told.
Compiled end to end: 8 (3.0%)** — was 5 at `8b0581541`. First blockers, largest
first:

| n | guard | what it is |
|---|---|---|
| 47 | `runtime:declaration` | `strategy()` scripts — **OUT OF SCOPE by design** |
| 23 | `pine:character` | member access on a CALL RESULT (`full.get(y).vol`) — UDT family |
| 20 | `pine:builtin` | table gaps (e.g. `time` is ms in Pine, seconds here) |
| 18 | `pine:undefined` | loop vars in the COLUMNAR lane |
| 17 | `runtime:statement` | |
| 15 | `runtime:expression-statement` · `runtime:call-undeclared-builtin-state` · `pine:function` | |
| 12 | `runtime:udt` | |
| 11 | `pine:block` | |
| 8 | `runtime:array` · `runtime:object-op` | |

⚰️ **THE LAST ROW IS STALE IN BOTH DIRECTIONS AS OF `03a0d21a3`, and how it is
stale is worth more than the numbers.** `runtime:array` is **3** (the drawing
constructors landed). `runtime:object-op` is **12**, which looks like a
*regression* and is not: four rows moved INTO it out of `pine:drawing` (5 → 1),
which is the columnar lane's guard and was being reported for a lane this
caller is not using. And **11 of those 12 are the HARNESS**, not the corpus —
see the second contamination rail. Re-run the command; do not read this table.

⚠️ **Scripts mostly move to their NEXT blocker rather than clearing.** That is
why `compiled` moves slowly, and it is the honest shape of the number. It is
also why the top of this table barely moves while real work lands: the two
largest entries are unchanged since `8b0581541`.

⛔ **THE CENSUS CAN CONTAMINATE ITSELF.** Run without `runtimeClockOpts`, it
reports `runtime:realtime-untold` scripts — that is the harness not telling the
lane about the clock, not a property of the corpus. **That trap is now a rail**
(`the harness TELLS the lane about the clock`): it runs the census BOTH ways and
asserts the clean pass reports zero while the contaminated one reports more than
zero. If it ever stops differing, either the trap was fixed upstream or the
clean run has quietly stopped passing the clock — and in the second case every
number above is contaminated.

---

## TRAPS PAID FOR IN THIS SESSION

- ⛔ **A refusal with no position makes every investigation guesswork.** Hunting
  the `pine:character` culprit with `line: null` produced three confident wrong
  answers — a `™` in the licence header, a library `import`, a method call —
  each ruled out only by a probe. Fixing the position found both real gaps in
  one pass.
- ⛔ **Prefix-bisection of a script is invalid.** Truncating a file *creates*
  lexer errors; all 24 scripts "bisected" to the same dangling `_`.
- ⛔ **Comparing two spellings to each other cannot tell if both are wrong.** A
  mutation hard-coding one call name passed every case because both sides were
  wrong identically. Check each against the truth.
- ⛔ **Self-referential assertions.** `transparencyToByte(50)` on both sides of
  an expectation compares the function to itself; round vs trunc was invisible
  until it asserted a round-trip property instead.
- ⛔ **A guard nobody has seen fire is not a guard.** The output-descriptor
  validator was green under mutation until it got cases of its own.
- ⭐ **Two mutations were STRUCK as defective**, not chased: each expressed a
  state no input can reach (`buildObjectProgram` never returns an empty program;
  the defval precedence stopped being reachable once a duplicate began to
  refuse). A mutation with no behavioural difference reports a false "the rail
  cannot see this".
- ⛔ **Timeouts are not breakage.** Two sweep rails timed out at 15,000 ms under
  full-suite load and pass alone in 767 ms and 992 ms.
- ⚠️ **The Bash heredoc eats escapes** (`\n`, `` \` ``, `\\`) repeatedly. Use the
  Edit/Write tools for anything containing them.

---

## TRAPS PAID FOR ON 2026-09-20 (the draw session)

⛔⛔ **SOURCE ORDER IN `lowerStmts`' `if` BRANCH IS LOAD-BEARING.** The test is
lowered BEFORE the body, and the function's own comment says so. Recording the
branch scopes inverted it, and the cost was not a mis-numbered artifact but a
**MOVED REFUSAL**: `if not isRatioSymbol` at v2:249 reads `syminfo.ticker`, and
with the body first a `lookahead` refusal twelve lines INSIDE that body fired
instead. The symbol seam stopped being reached — "with symbol" and "without
symbol" read identically. `irSymbolFold`'s control is exactly what caught it.

⛔⛔ **I EDITED LEDGERS TO MATCH THAT REGRESSION BEFORE I UNDERSTOOD IT.**
`pineRuntimeTextLane` pins statement counts and the seam's line; both "moved
forward", which reads as progress. They had not: the lane had stopped CHECKING.
**A ledger edited to match the code it measures is not a ledger.** Reverted.

⛔ **A DEPTH GUARD MUST BE THREADED THROUGH EVERY RECURSIVE EDGE.** `holdsText`
gained a user-function branch with `depth < 8`, but its `binary` and `ternary`
branches called back without passing `depth` — so it reset to 0 every hop and
`f(x) => f(x) + 1` overflowed the stack instead of refusing `runtime:recursion`.

⛔ **A SYNTHESISED NODE SHAPE HAS AN OWNER.** `guardOf` builds drawing guards as
`{type:'op', name:'!'|'&&'}` — the RESOLVER's shape, not the parser's.
Respelling it into the parser's shape "for one spelling of one meaning" broke
the table vendor-parity suite outright, because another reader depends on it.
The runtime lane is a second READER, so it reads `op`; it does not respell.

⛔ **A REFUSAL BACKED BY A MEASUREMENT IS NOT A GAP TO FILL IN PASSING.**
`array.sort_indices` was refused BY NAME because vendor packet M7 is partial.
M7 measured that ties KEEP their order ascending and **REVERSE descending**; a
stable sort keeps them both ways — correct ascending, wrong in the direction a
dashboard ranks by. `arrays.test.js`'s own control caught it.

⚠️ **MY OWN PROBES WERE WRONG FOUR TIMES, each reading as a product finding:**
`Object.keys()`/`JSON.stringify` on a **Map** (`iterByTree`) reporting empty;
passing the bars ARRAY where `view.bars` is a COUNT (`array | 0` → 0, so nothing
executed); keying `inputs` by the input's TITLE when it is keyed by the bound
NAME; and a hand-rolled `stringy()` heuristic that found 0 text trees while the
VM was demonstrably throwing on one. **Check the accessor before believing the
zero.**

---

## HOW TO VERIFY

```sh
cd app
# the engine suite — 11-12 failed across 7-8 files, ALL pre-existing:
#   memberPaneGate · bothLanesAgreeOnFacts · capabilityDemandCensus ·
#   historyDemandCensus · oosMeasuredBaseline · paramIds ·
#   recurrenceSteps.measure  (+ stockChartWiring, LOAD-SENSITIVE — passes
#   216/216 alone; re-run it alone before calling it a regression)
node node_modules/vitest/vitest.mjs run src/components/chart/engine

# the end-to-end dashboard rail (6 cases, asserts CELL TEXT not counts)
node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/runtime/__tests__/watchlistDashboard.test.js

# pine.js is the PRODUCTION columnar lane — its other consumers too
node node_modules/vitest/vitest.mjs run src/components/chart/builder src/components/screener

# classify by SET DIFFERENCE against a pristine-master run, never by count
```

⛔ **Never bank a count.** The stable master baseline is the licence-gated corpus
census tests, the flag ledger, and a load-sensitive `stockChartWiring` hover
case. Compare failing test NAMES.

`python tools/check_repo_hygiene.py` must exit 0 before any commit.

---

## NEXT, IN ORDER

> ### ⭐⭐ 2026-09-23 — THE QUEUE, RE-MEASURED AFTER `pine:block` CLOSED
>
> `runtime/pine:block` **13 → 4** and `runtime:statement` **17 → 16**. The
> table below is the census AFTER those, read with `guardProbe.measure.test.js`
> rather than taken from counts.
>
> | scripts | row | what it actually is |
> |---|---|---|
> | 10 | `runtime/pine:undefined` | ⭐⭐ **THE BIGGEST REAL CAPABILITY LEFT — and it is not what the guard says.** "this Pine name was never given a value" is reported for `_ma`, `_src`, `_len` — which are **FUNCTION PARAMETERS**. These are user-defined function bodies lowered without their params in scope. It is the `runtime:function` capability ("no call frames yet") wearing a different guard, and sizing it from the sentence would send someone hunting a scoping bug that is not there. |
> | 14 | `runtime/pine:builtin` | 7 unknown builtin names (a grab-bag), plus `barstate.isnew` ×2, `syminfo.mintick`, `timeframe.change`, `syminfo.basecurrency`, `syminfo.timezone` |
> | 12 | `runtime/pine:function` | 6 unknown functions · 3 tuple destructuring `[a,b,c] = ta.bb(…)` · 3 `time('W')` / 2 `time(session)` — the FUNCTION forms RC-F did not serve |
> | 12 | `runtime/pine:input-kind` | `input.color` 4 · `input.timeframe` 4 · `input.symbol` 2 — ⛔ the last six feed `request.security`, which has no feed here |
> | 16 | `runtime/runtime:statement` | ⛔ **TEN distinct shapes — do not treat as one row.** The tractable singles: `math.round(x, precision)` ×2 · `ta.highest(len)` / `ta.lowest(len)` one-arg overload ×2 · `for … in` ×1. The rest is `request.security` tuple destructuring (×3) and symbol settling (×2). |
> | 9 | `objects/pine:block` | `for` loops inside user functions — the OTHER half of the old `pine:block` row, and a different job from the one just closed |
>
> ⛔ **35 `runtime:declaration` + 13 `objects/pine:declaration-strategy` are
> `strategy()` scripts, OUT OF SCOPE by design**, and 13 more are
> `objects:no-objects-in-source` — scripts that correctly draw nothing.
>
> ### ⭐⭐ 2026-09-22 — THE QUEUE AS IT WAS SIZED THEN
>
> Run `guardProbe.measure.test.js` before committing to any row below; each of
> these was measured that way rather than taken from the census count.
>
> | scripts | row | what it actually is |
> |---|---|---|
> | ✅ | `pine:block` | **DONE 2026-09-22** — `x = if …` and `x = switch …` lower in the RUNTIME lane. `runtime/pine:block` **13 → 4**. ⭐ It was NOT a columnar change: the top-level columnar walk already handled both, and all 13 were dying in `pineRuntimeFrontend`, which has slots and `ifStmt` and needed none of the single-expression restriction. |
> | ~7 | `pine:block` | a `for` loop reached through a user function — same guard, different job |
> | ~10 | `time(...)` | the FUNCTION forms: `time('W')` (opening timestamp of the enclosing period, 3) and `time("", "0830-1201", tz)` (session clock, 2), plus 5 more on `pine:function`. RC-F served only the bare VARIABLE. |
> | 4 | `input.color` | `producesColour` (`runtime/colours.js`) holds only `color.new`/`color.rgb`, so `holdsColour` answers false for an `input.color` CALL and the binding routes to the columnar lane, which refuses the kind |
> | 3 | tuple destructuring | `[a, b, c] = ta.bb(…)` — the plan already flagged this as the real top row behind the `history-expression` misread |
> | 6 | `input.timeframe`/`input.symbol` | ⛔ **DO NOT SPEND A WAVE HERE.** They exist to feed `request.security`, which has no feed on this box — serving them moves six scripts to a blocker they cannot pass either. |
>
> ⛔ **48 of the 266 are `strategy()` scripts, OUT OF SCOPE by design**, and 13
> more are `objects:no-objects-in-source` — scripts that correctly draw nothing.
> The honest denominator is well under 266 and nobody has written it down.
>
> ⭐ **Expect movement, not clearance.** Every capability closed this week moved
> scripts to their NEXT blocker without raising `BUILDS`. That is the measured
> pattern (item 8 below, and RC-F's own 16 → 12), not a disappointment.


✅ **DONE:** objects-only scripts draw · object-pass loops · per-call-site
lowering inside a request · the ET clock and session clock · the target
dashboard builds, runs and draws.

1. ✅ **DONE 2026-09-21 — `table.clear` is CARRIED.** Reader → converter →
   program → runtime, 12 cases in
   `runtime/__tests__/tableClear.test.js`, five mutations RED, 0 NEW failures
   against a pristine-HEAD baseline on both the engine suite and pine.js's
   other consumers. See the ✅ block near the top for what it does and does
   NOT fix.
   ⭐ **One finding worth carrying into (2) and (3):** the first four cases all
   used integer-literal bounds, which fold to constants — so deleting the
   binding that turns a bound into something the runtime can read left the
   whole rail GREEN. A fifth case with a bound computed from `close` is what
   catches it. **Any op whose arguments can be either a literal or an
   expression needs a computed-argument case, or its binding is unrailed.**
2. ⏸️ **`calc_bars_count` — MEASURED 2026-09-21, LEFT ACCEPTED-AND-INERT ON
   PURPOSE.** Neither honoured nor refused, and the reason is a measurement
   rather than a preference. **4 of 266 corpus scripts** name it, with values
   `200000`, `200000`, `10000`, `1000`. This app serves **at most 5,000 bars on
   every timeframe** (CLAUDE.md, Charts section), so three of those four
   **cannot bind at all** — the window is larger than any history the engine
   holds. Only the `1000` can, on one script, and only for bars older than 1,000
   from the end.
   ⛔ **Refusing it by name would break 4 scripts over a parameter that is
   structurally inert in 3 of them** — the `nvi`/`pvi` precedent (declared inert
   on purpose, no code) rather than the `table.clear` one.
   ⛔ **And honouring it needs a vendor capture this box cannot take.** Whether
   bars outside the window read `na` (a semantic change) or the argument is only
   a calculation bound (a performance hint) is NOT measured here, and the two
   give different answers for deep history. Do not implement it from the
   reference manual alone — take the capture first.
3. ✅ **DONE 2026-09-21 — `text_formatting` is CARRIED and RENDERED.**
   `CELL_PROPS` + the three `text.format_*` enum names + `ENUM_SLOTS` +
   `objectTableDom`'s `fontWeight`/`fontStyle`. **Measured on the parked target:
   all 6 of its header cells now carry `text_formatting`** (they carried none
   before). 7 cases in `engine/__tests__/cellTextFormatting.test.js`, five
   mutations RED, 0 NEW failures.
   ⚰️ **It was a QUIETER omission than `table.clear`.** The cell converter skips
   an unrecognised property with a bare `continue` — no value read, no
   `dropProp`, no diagnostic entry — so unlike `table.clear`, which at least
   appeared in `unsupported`, this left **no trace anywhere**. The table
   rendered, every cell held the right text, and the row the author had marked
   as headings looked exactly like the data.
   ⛔ **STILL OPEN, and it is the general case of this bug:** that bare
   `continue` (`pine.js`, in the `cell` branch of `convertList`) silently drops
   EVERY unknown cell property, not just this one. Naming them — the way
   `dropProp` already names a property whose VALUE could not be read — is the
   next instance of item (1)'s principle, and it is deliberately not bundled
   here because it will move real diagnostic counts and wants its own
   before/after measurement.
4. ✅ **DONE 2026-09-21 — the corpus is re-measured, and re-measuring is now a
   COMMAND** rather than an instruction nobody could follow:
   `runtimeCorpusCensus.measure.test.js`. See THE CORPUS MAP below for the
   fresh table. **Compiled end to end moved 5 → 8 of 266.**
   ⚠️ The top of the table barely moved — `runtime:declaration` (47, strategies,
   out of scope by design) and `pine:character` (23, the UDT family) are
   unchanged. Plan from the table, not from the headline.
4b. ✅ **DONE 2026-09-21 (`pine/runtime-object-ops`) — the DRAWING families.**
   `array.new_box`/`_line`/`_label`/`_linefill` are served (`runtime:array`
   8 → 3), and `runtime:object-op` was measured rather than implemented: 11 of
   its 12 scripts are the harness, not the corpus. See the ⛔⛔ block at the top
   of this file.
   ⭐⭐ **AND THE FINDING THAT SHOULD SHAPE ITEMS 5+ :** neither commit moved
   the DRAWING. `objectLaneCensus.measure.test.js` reads 2 of 266 before and
   after, the same two scripts. **Plan from the object-lane table, not from the
   runtime-lane one** — roughly half the corpus is refused by the OBJECT PASS
   before the runtime lane is consulted, and the four largest of those
   (`pine:character` 23, `objects:nothing-drawn` 13,
   `pine:declaration-strategy` 13, `pine:block` 11) are all object-pass work.
   ⚠️ **Open, found and deliberately not fixed:** a drawing bound to a PLAIN
   name and used later (`nl = cond ? line.new(…) : na` … `array.push(rays, nl)`)
   is still filed under the columnar lane's `pine:drawing`. `holdsObjectCall`
   tests the subtree and that subtree is a bare name; `holdsArray` resolves such
   a name through `env` and this could too — but `holdsObjectCall` also decides
   the ownership SKIP at three declaration branches, so widening it changes what
   gets skipped and wants its own cases.
5. ✅ **DONE 2026-09-21 — history / window / `ta.change` over an EXPRESSION, at
   a ROOT statement.** `(x + 1)[1]`, `ta.sma(x + 1, 5)` and `ta.change(x * 2)`
   compile: the expression is hoisted into its own committed series on the line
   above — the rewrite the refusal's own message used to *demand*. 17 cases in
   `runtime/__tests__/historyExpression.test.js`, 7 of 8 mutations RED, 0 NEW
   failures on the engine suite AND on pine.js's other consumers.

   ⛔⛔ **AND THE CORPUS DELTA IS ZERO. MEASURED, TWICE, AND IT IS THE POINT OF
   THIS ENTRY.** `compiled end to end` stayed at **8/266** and
   `runtime:history-expression` stayed at **3**, because all three of its
   corpus scripts hit the construct INSIDE A USER FUNCTION, which this
   deliberately does not serve. A throwaway spike that widened the scope to
   function bodies was then run to price the rest of the capability: the guard
   went **3 → 0** and `compiled` **stayed at 8** — the three scripts moved to
   `pine:undefined`, `runtime:call-undeclared-builtin-state` and
   `runtime:request-with-state`. **The whole capability, at maximum scope, buys
   zero additional compiled scripts.** Do not spend a wave on the frame case
   expecting corpus movement; it is language correctness, not throughput.

   ⚰️⚰️ **AND THE 16-SCRIPT FIGURE THAT SENT THIS LANE HERE WAS A MISREAD.** The
   demand census reports `16  [  runtime:history-expression,pine:builtin,…` and
   that row was taken to mean the history operator blocks 16 scripts. It does
   not. Reading the 16 REAL CALL SITES, **fifteen are TUPLE DESTRUCTURING** —
   `[a, b, c] = f(…)` — and exactly **one** is a history read
   (`ad-line-of-sp-sectors` L30). `[` is one TOKEN spanning two unrelated
   capabilities, and the census cannot tell them apart because it reports the
   token, not the construct. ⭐ **The queue's own top row is therefore
   `[a,b] = …`, not `[]`** — a far larger and completely different job. Read the
   call sites before sizing a row of that table.
6. **The gradient fill** — the last blocker on script 2. Front end is easy;
   the renderer is the work.
7. **Still owed, market hours only:** vendor M2, M5, M1's realtime half, and
   **M7's all-equal / already-descending halves** (see `sort_indices` — the tie
   rule is measured, those two are extrapolated and labelled as such).
8. ✅ **DONE 2026-09-21 — the `input.*` family is off the closed-table wall**
   (`feat/pine-input-runtime`, `f10a33b66`). ⭐⭐ **It was never a missing
   capability.** Every kind — `input.int`/`bool`/`color`/`source`/`float`/
   `timeframe` and bare `input` — already compiled on this lane with literal
   arguments. What refused them was the ROUTE DECISION reading a **presentation
   argument**: `var string GROUP_FRACT = "Fractals"` makes `group=GROUP_FRACT`
   a slot read, `needsRuntime` walks every argument, and the whole call was
   handed to the runtime lane and filed under `runtime:call-undeclared-builtin-
   state` — *"the CLOSED TABLE does not declare this builtin"*, about a name
   that is not a table function in either lane. `needsRuntime` now descends only
   into an input's `defval` and its NAMED `minval`/`maxval`/`step`/`options`,
   and `builtinStateFamily` answers `runtime:input-state` instead.
   ⛔ **NOTHING IS REWRITTEN** — the node keeps every argument, so `boundName`
   and the param-manifest title are untouched; only the LANE changes.
   ⚠️ **ZERO scripts cleared end to end — 8 of 266 before and after.** All nine
   blocked scripts moved to their next blocker; seven moved past the input
   family outright. `runtime:call-undeclared-builtin-state` 15 → 6. Stated
   rather than buried, the `timenow` precedent.
8. **A `var` NAME BOUND TO A LITERAL AND NEVER REASSIGNED IS STILL A SLOT** —
   the root cause one level above (7), and what still blocks the last two input
   scripts (`var color c_defSolidLine = #FFFF00` used as a defval). By Pine's
   own definition such a name IS its initialiser on every bar, so it needs no
   slot. ⛔ **Its correctness turns on the initialiser being BAR-INVARIANT**:
   `var x = close` is not — it is bar 0's close, pinned — so the condition is a
   literal constant, not merely "reads no slot". It changes how EVERY `var`
   declaration in the lane is lowered and wants its own measurement.
9. **`var color c = input.color(…)` refuses at `pine:input-kind`** —
   `producesColour` (`runtime/colours.js`) holds only `color.new`/`color.rgb`,
   so `holdsColour` answers false for an `input.color` CALL and the binding is
   routed to the columnar lane, which refuses the kind. Found as
   `auto-trendline-dojiemoji`'s new first blocker after (7).

⚠️ **AND THE STANDING QUESTION NOBODY HAS RE-OPENED:** ruling D2 means all of
this improves a lane with **zero live importers**. The objects-only pane path is
dark behind `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`. Deciding whether a member
ever sees this is the owner's call, not a task.

## Related

`project_pine_rvol_slice_2026_09_19` (memory) ·
`docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` ·
`docs/superpowers/specs/universal-indicator-ecosystem/VALUE_MODEL_DECISION.md`
