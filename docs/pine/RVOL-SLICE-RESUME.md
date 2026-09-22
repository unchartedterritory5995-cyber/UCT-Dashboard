# Pine RVOL slice — RESUME HERE

> **Branch `feat/pine-value-model`. Read this before touching the Pine engine.**
> State at **`9d68ddab5`**, 2026-09-20 (was `5bc01520b`). Nothing here is merged
> and nothing reaches a member.
>
> ⚠️ `docs/pine/SESSION-STATE.md` is the **closed R0/R1 wave's** resume doc, not
> this one. Do not update it for this work.

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
5. **The gradient fill** — the last blocker on script 2. Front end is easy;
   the renderer is the work.
6. **Still owed, market hours only:** vendor M2, M5, M1's realtime half, and
   **M7's all-equal / already-descending halves** (see `sort_indices` — the tie
   rule is measured, those two are extrapolated and labelled as such).

⚠️ **AND THE STANDING QUESTION NOBODY HAS RE-OPENED:** ruling D2 means all of
this improves a lane with **zero live importers**. The objects-only pane path is
dark behind `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`. Deciding whether a member
ever sees this is the owner's call, not a task.

## Related

`project_pine_rvol_slice_2026_09_19` (memory) ·
`docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` ·
`docs/superpowers/specs/universal-indicator-ecosystem/VALUE_MODEL_DECISION.md`
