# Pine RVOL slice — RESUME HERE

> **Branch `feat/pine-value-model`. Read this before touching the Pine engine.**
> State at `8b0581541`, 2026-09-20. Base `b2b95c764`; 26 commits ahead of
> master, 48 behind. Nothing here is merged and nothing reaches a member.
>
> ⚠️ `docs/pine/SESSION-STATE.md` is the **closed R0/R1 wave's** resume doc, not
> this one. Do not update it for this work.

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

## WHERE THE TWO ACCEPTANCE SCRIPTS ACTUALLY STAND

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

⛔ **What remains for it to DRAW**, all in the member-pane path (production UI):

1. `paneGate` refuses anything with `t.ok !== true` — it must admit an
   objects-only verdict. **This is where ruling D2 lives; it is an owner call.**
2. `memberPaneDefinition.buildDefinition` builds ROWS from outputs; an
   objects-only script has none.
3. The renderer half already exists — `binder.js` imports `evaluateObjects` and
   `objectReaderFor` today.

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

**29 test files** added or changed on the branch.

---

## THE CORPUS MAP — where 266 real published scripts die

⭐ **Re-measure, do not quote.** Run `buildRuntimeIr` over `corpus/committed`
with `{ tf: 'D', ...runtimeClockOpts(false) }` — see the trap below.

At `8b0581541`, first blockers, largest first:

| n | guard | what it is |
|---|---|---|
| 47 | `runtime:declaration` | `strategy()` scripts — **OUT OF SCOPE by design** |
| 23 | `pine:character` | member access on a CALL RESULT (`full.get(y).vol`) — UDT family |
| 21 | `pine:builtin` | table gaps (e.g. `time` is ms in Pine, seconds here) |
| 16 | `pine:undefined` | loop vars in the COLUMNAR lane |
| 15 | `runtime:statement` · `pine:function` · `runtime:call-undeclared-builtin-state` | |
| 14 | `runtime:expression-statement` | |

Across the session: **compiled end-to-end 2 → 5**; `runtime:presentation` 22 →
out of the top eight; `runtime:array` 19 → out.

⚠️ **Scripts mostly move to their NEXT blocker rather than clearing.** That is
why `compiled` moves slowly, and it is the honest shape of the number.

⛔ **THE CENSUS CAN CONTAMINATE ITSELF.** Run without `runtimeClockOpts`, it
reports **39 `runtime:realtime-untold`** as the top blocker — that is the
harness not telling the lane about the clock, not a property of the corpus.

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

## HOW TO VERIFY

```sh
cd app
# the engine suite — expect ~6460 passed / 11 failed, ALL pre-existing
node node_modules/vitest/vitest.mjs run src/components/chart/engine

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

1. **Owner decision — does an objects-only script draw?** If yes, items 1–2 of
   the dashboard list above. This touches `paneGate`, which is where ruling D2
   lives.
2. **The gradient fill** — the last blocker on script 2. Front end is easy (four
   series + a descriptor); the renderer is the work.
3. **Per-call-site specialisation** — the dashboard's runtime blocker. 4 of 266
   corpus demand; weigh against the above.
4. **Still owed, market hours only:** vendor measurements M2, M5, and M1's
   realtime half. M4 part A and M10's data-feed label are owner-side but not
   market-dependent.

## Related

`project_pine_rvol_slice_2026_09_19` (memory) ·
`docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` ·
`docs/superpowers/specs/universal-indicator-ecosystem/VALUE_MODEL_DECISION.md`
