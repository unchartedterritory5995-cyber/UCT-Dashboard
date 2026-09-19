# Runtime value model + strings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a runtime slot able to hold a value that is not a number, then carry Pine strings end to end — from a string literal in a member's script to a value living in a slot — so the capabilities that sit on strings (cell text, symbol lists, `str.*`) have something to stand on.

**Architecture:** The decision is made and measured: a slot is a JS value (`VALUE_MODEL_DECISION.md`). This plan applies it to the three stores that actually need it — the operand stack, the bar frame (`locals`) and the persistent slots — plus the const pool. **Series, columns, the history ring, window buffers and the carried-state store stay `Float64Array`**: they serve numeric builtins and are numeric by construction, so boxing them would cost speed and buy nothing.

**Tech Stack:** JavaScript (ES modules), Vitest, `app/src/components/chart/engine/runtime/` (`vm.js`, `program.js`, `lowerIr.js`, `ir.js`) and `engine/ast/pineRuntimeFrontend.js`.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` (§4.4 and §5), with the decision in `…/VALUE_MODEL_DECISION.md`.

## Global Constraints

- Branch `feat/pine-language-core`, based on `origin/master`. Never push to master.
- Run the engine suite from `app/` as `npm run test:engine`. A narrower path may be used while iterating, never as the evidence that it passes.
- Compare against a **baseline run of the same suite at the base commit**, in a clean checkout. `.claude/worktrees/pine-baseline-check` already exists with `node_modules` installed; it is READ-ONLY for this plan — run tests there, never edit, and leave `git status --short` empty.
- A run with no totals line is not a run. Quote totals verbatim. `vitest -t` is a regex; a filter matching nothing exits 0.
- Do not run backend pytest at all in this plan.
- Never `git add -A`; never `git stash`.
- `python tools/check_repo_hygiene.py --staged` before every commit.
- Commit messages via a quoted heredoc (`git commit -F - <<'MSG'`), never `-m`, because they contain identifiers and backticks. Each ends with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- ⛔ **This plan changes no member-visible behaviour.** The runtime lane is not wired to any product surface (`PINE_LANGUAGE_RUNTIME_COMPLETION_MATRIX.md`: chart integration "deliberately not wired"). The engine suite is the whole audience.

## File Structure

| file | responsibility | change |
|---|---|---|
| `app/src/components/chart/engine/runtime/program.js` | the flat program + its validation | const pool accepts strings; validate members |
| `app/src/components/chart/engine/runtime/vm.js` | the bar loop | stack / locals / persist become boxed; `EMIT` guards; `CONCAT` + string compare |
| `app/src/components/chart/engine/runtime/ir.js` | the semantic IR vocabulary | a string literal is a value shape |
| `app/src/components/chart/engine/runtime/lowerIr.js` | IR → program | lower string literal, concat, compare |
| `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` | Pine → IR | stop refusing a string-valued expression by name |
| `runtime/__tests__/valueModel.test.js` | slots hold non-numbers; numbers unchanged | create |
| `runtime/__tests__/strings.test.js` | concat, compare, literal, end to end from Pine | create |
| `runtime/__tests__/boxedNumericCost.test.js` | the measured cost of boxing, recorded | create |

---

### Task 1: A slot can hold a value that is not a number

**Files:**
- Modify: `runtime/program.js` (`makeProgram`, ~line 180; `validateProgram`, ~line 224)
- Modify: `runtime/vm.js` (stack ~line 91, locals ~line 109, persist ~line 110, `EMIT` ~line 500)
- Test: `runtime/__tests__/valueModel.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `program.consts` is a plain `Array` whose members are `number | string`. `stack`, `locals` and `persist` inside `execute()` are plain arrays holding `number | string`. Everything else — `series`, `columns`, the history ring, window buffers, the carried-state store, and every `outputs[i]` — stays `Float64Array` and stays numeric.

**Context the implementer needs:** today `makeProgram` does `consts: Float64Array.from(consts || [])`, so a string const is silently coerced to `NaN`; and `vm.js` allocates `new Float64Array(256)` for the stack, `new Float64Array(program.locals + depthLimit * maxFrame)` for the frame and `new Float64Array(Math.max(program.persists, 1))` for persistent slots. A string stored into any of them becomes `NaN` — no error, no warning. That silent coercion is what this task removes.

⚠️ **This costs speed on the VM's own numeric work, and the amount is already measured**: the value-model spike put a boxed slot bank at about 1.2× a `Float64Array` one on a numeric-only program. That is the price of one representation, it was accepted with the decision, and Task 3 records the real number rather than trusting the spike's.

- [ ] **Step 1: Write the failing test**

Create `runtime/__tests__/valueModel.test.js`:

```js
// app/src/components/chart/engine/runtime/__tests__/valueModel.test.js
//
// ─── A SLOT IS A VALUE, NOT A DOUBLE ────────────────────────────────────────
//
// Series, columns, the history ring, the window buffers and the carried-state
// store are numeric BY CONSTRUCTION — they serve numeric builtins — and they
// stay `Float64Array`. The stack, the bar frame and the persistent slots are
// where a member's own values live, and a member's values include strings.
//
// ⚰️ WHAT THIS REPLACES: `Float64Array.from(['abc'])` is `[NaN]`. A string const
// did not fail, did not warn, and did not arrive — it became `na` somewhere
// between the front end and the first bar.
import { describe, it, expect } from 'vitest'
import { makeProgram, OP } from '../program.js'
import { makeContext, execute } from '../vm.js'

const BARS = 4
const zeros = () => new Float64Array(BARS)
const ctx = () => makeContext({
  bars: BARS,
  series: [zeros(), zeros(), zeros(), Float64Array.from([1, 2, 3, 4])],
  columns: [],
})

describe('the value model', () => {
  it('keeps a string const a string', () => {
    const p = makeProgram({ code: [[OP.CONST, 0, 0]], consts: ['hello'], outputs: 0 })
    expect(p.consts[0]).toBe('hello')
  })

  it('round-trips a string through a local slot', () => {
    const p = makeProgram({
      code: [
        [OP.CONST, 0, 0],
        [OP.STORE_LOCAL, 0, 0],
        [OP.LOAD_LOCAL, 0, 0],
        [OP.STORE_PERSIST, 0, 0],
      ],
      consts: ['NASDAQ:AAPL'],
      locals: 1,
      persists: 1,
      outputs: 0,
    })
    const out = execute(p, ctx(), {})
    expect(out.slots ? out.slots.persist[0] : out.persist[0]).toBe('NASDAQ:AAPL')
  })

  it('CONTROL: a number is still a number, and na is still NaN', () => {
    const p = makeProgram({
      code: [[OP.CONST, 0, 0], [OP.EMIT, 0, 0]],
      consts: [42],
      outputs: 1,
    })
    const out = execute(p, ctx(), {})
    expect(Array.from(out.outputs[0])).toEqual([42, 42, 42, 42])
  })

  it('EMIT refuses a value an output series cannot hold', () => {
    // ⛔ An output IS a Float64Array — that is the contract the chart and the
    // columnar lane both read. A string reaching it would land as NaN and read
    // as `na`, which is a WRONG ANSWER wearing a plausible costume.
    const p = makeProgram({
      code: [[OP.CONST, 0, 0], [OP.EMIT, 0, 0]],
      consts: ['not a number'],
      outputs: 1,
    })
    expect(() => execute(p, ctx(), {})).toThrow(/output|number|string/i)
  })

  it('CONTROL: the numeric stores are untouched typed arrays', () => {
    const c = ctx()
    expect(c.series[3]).toBeInstanceOf(Float64Array)
    const p = makeProgram({ code: [[OP.READ_SERIES, 3, 0], [OP.EMIT, 0, 0]], consts: [], outputs: 1 })
    const out = execute(p, c, {})
    expect(out.outputs[0]).toBeInstanceOf(Float64Array)
  })
})
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run src/components/chart/engine/runtime/__tests__/valueModel.test.js
```

Expected: the two CONTROL cases pass; "keeps a string const a string" fails (it is `NaN`); the round-trip fails; `EMIT refuses` fails (nothing throws today). If a case fails with `OP.STORE_PERSIST is not a function` or similar, read `program.js`'s `OP` table and fix the test's opcode names before touching source — the test must fail for the stated reason, not a typo.

⚠️ `execute()`'s return shape may not expose slots. If it does not, add the minimal accessor the test needs in Step 3 and say so in the commit; do not weaken the assertion to whatever is already reachable.

- [ ] **Step 3: Make the const pool hold values**

In `program.js`, replace the `Float64Array.from` line and validate what goes in:

```js
    // ⭐⭐ A CONST IS A VALUE, NOT A DOUBLE. `Float64Array.from(['abc'])` is
    // `[NaN]`: a string const used to arrive as `na` with nothing raised on the
    // way. The pool is a plain array, and its members are checked here so a bad
    // one is named at BUILD time rather than read as `na` on bar 0.
    consts: (consts || []).map((c, i) => {
      if (typeof c === 'number' || typeof c === 'string') return c
      throw new ProgramError(`const ${i}: a const is a number or a string, got ${typeof c}`)
    }),
```

- [ ] **Step 4: Box the three stores and guard `EMIT`**

In `vm.js`:

```js
  // ⭐ THE STACK, THE FRAME AND THE PERSISTENT SLOTS HOLD VALUES.
  // ⛔ `series`, `columns`, `hist`, `winBuf` and `carState` stay Float64Array —
  // they serve numeric builtins and are numeric by construction. Boxing them
  // would cost the numeric path and buy nothing (VALUE_MODEL_DECISION.md).
  const stack = new Array(256).fill(NaN)
```

and the same shape for `locals` and `persist` (`new Array(n).fill(NaN)` — `na` for a number is still `NaN`, which is what every existing numeric op already expects).

Then, at `OP.EMIT`:

```js
        case OP.EMIT: {
          const v = stack[--sp]
          // ⛔ AN OUTPUT SERIES IS A Float64Array AND THAT IS A CONTRACT, not an
          // implementation detail — the chart and the columnar lane both read it.
          // A string assigned into one lands as NaN and reads as `na`: a wrong
          // answer that looks exactly like a missing one.
          if (typeof v !== 'number') {
            throw new VmError(`output ${a}: a plot carries a number, got ${typeof v}`)
          }
          outputs[a][bar] = v
          break
        }
```

⚠️ Keep whatever else that case already does (bar indexing, output bounds). Read it before replacing it.

- [ ] **Step 5: Run the new test, then the engine suite**

```bash
npx vitest run src/components/chart/engine/runtime/__tests__/valueModel.test.js
npm run test:engine
```

Expected: the new file passes; the engine suite has **no failure that is not also in the baseline**. The rail that matters here is `runtime/__tests__/graphRuntimeDifferential.test.js` — one tree, two lanes, bit-identical. If it reds, the boxing changed a numeric answer and the task is wrong; do not proceed.

Record both totals lines. To get the baseline:

```bash
cd ../../pine-baseline-check/app && npm run test:engine   # READ-ONLY worktree
```

- [ ] **Step 6: Commit**

```bash
python tools/check_repo_hygiene.py --staged
git add app/src/components/chart/engine/runtime/program.js \
        app/src/components/chart/engine/runtime/vm.js \
        app/src/components/chart/engine/runtime/__tests__/valueModel.test.js
git commit -F - <<'MSG'
feat(pine runtime): a slot holds a value, not a double

Float64Array.from(['abc']) is [NaN]: a string const arrived as `na`
with nothing raised on the way. The const pool, the operand stack, the
bar frame and the persistent slots now hold values; series, columns,
the history ring, the window buffers and the carried-state store stay
Float64Array because they serve numeric builtins and are numeric by
construction.

EMIT now refuses a non-number by name. An output series is a
Float64Array and that is a contract -- a string reaching one lands as
NaN and reads as `na`, which is a wrong answer wearing a missing
answer's costume.

Decision and measurements: VALUE_MODEL_DECISION.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Strings, from a member's script to a slot

**Files:**
- Modify: `runtime/vm.js` (a `CONCAT` case; string-aware `EQ`/`NE`)
- Modify: `runtime/program.js` (`OP.CONCAT` in the opcode table + `IMPLEMENTED`)
- Modify: `runtime/ir.js`, `runtime/lowerIr.js` (a string literal and a concatenation are lowerable shapes)
- Modify: `engine/ast/pineRuntimeFrontend.js` (stop refusing a string-valued expression by name)
- Test: `runtime/__tests__/strings.test.js` (create)

**Interfaces:**
- Consumes: Task 1's boxed slots and string consts.
- Produces: `OP.CONCAT` (pops b, pops a, pushes `a + b`, both strings); `EQ`/`NE` compare strings by value; the front end lowers a Pine string literal, `+` between two strings, and `==`/`!=` between two strings.

**Context the implementer needs:** measured 2026-09-19, the runtime front end's first refusal on F2 (the committed acceptance script) is at line 43: *"a TEXT builtin applied to a mutable value — text is a value-model change, not a series one"*. Task 1 makes that sentence obsolete for the VALUE half. This task removes the refusal for the three shapes above; every other text construct keeps refusing **by name** (`str.replace_all`, `str.split`, `str.tostring` and friends belong to the next plan, and `str.tostring`'s format is additionally blocked on vendor measurement M6, which is unmeasured — see `docs/pine/rvol-slice-vendor-answers.json`).

⛔ **Do not implement `str.tostring` with a format in this task even if it looks easy.** Its rounding at `.5` is a vendor question with no answer yet; guessing it puts a wrong number in a member's table cell and nothing would catch it.

- [ ] **Step 1: Write the failing test**

Create `runtime/__tests__/strings.test.js`:

```js
// app/src/components/chart/engine/runtime/__tests__/strings.test.js
//
// ─── A STRING REACHES A SLOT, FROM A MEMBER'S OWN SCRIPT ────────────────────
//
// Task 1 made a slot able to HOLD a string. This is the half that puts one
// there from Pine source. Scope is deliberate: a literal, `+` between two
// strings, and `==` / `!=`. Every other text construct keeps refusing BY NAME.
//
// ⛔ `str.tostring(x, "#")` IS NOT HERE, and not because it is hard: its
// rounding at .5 is vendor measurement M6, which is unmeasured. A guess there
// is a wrong number in a member's cell that nothing would catch.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const build = (body) => buildRuntimeIr(H + body + '\n')

describe('strings in the runtime lane', () => {
  it('runs a script whose string decides a plotted number', () => {
    const out = build('string s = "ab"\nplot(s == "ab" ? close : open)')
    expect(out.ok).toBe(true)
  })

  it('runs a concatenation', () => {
    const out = build('string e = "NASDAQ"\nstring s = e + ":" + "AAPL"\nplot(s == "NASDAQ:AAPL" ? 1 : 0)')
    expect(out.ok).toBe(true)
  })

  it('runs an inequality', () => {
    expect(build('string s = "ab"\nplot(s != "cd" ? 1 : 0)').ok).toBe(true)
  })

  it('CONTROL: a numeric script is unaffected', () => {
    expect(build('plot(close * 2)').ok).toBe(true)
  })

  it('CONTROL: an unsupported text builtin still refuses BY NAME', () => {
    const out = build('string s = str.replace_all("a,b", ",", ";")\nplot(s == "a;b" ? 1 : 0)')
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toMatch(/str\.replace_all/)
  })

  it('CONTROL: a string cannot become a plotted value', () => {
    // Pine would not type-check this either; the point is that OUR refusal
    // names the reason rather than silently plotting `na`.
    const out = build('string s = "ab"\nplot(s)')
    expect(out.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run src/components/chart/engine/runtime/__tests__/strings.test.js
```

Expected: both CONTROLs pass immediately (the numeric one runs; the unsupported builtin already refuses by name); the three string cases fail with the text refusal quoted above. **If a string case fails with a different sentence, quote it in the commit** — the refusal text is the map of what is actually in the way.

- [ ] **Step 3: Add `CONCAT` to the program vocabulary and the VM**

In `program.js`, add `CONCAT` to `OP` and to `IMPLEMENTED` (read both — `IMPLEMENTED` is what makes an opcode legal to execute; an opcode in `OP` alone is a reserved name that refuses at the loop).

In `vm.js`, beside the arithmetic cases:

```js
        case OP.CONCAT: {
          const y = stack[--sp]
          const x = stack[sp - 1]
          // ⛔ BOTH SIDES MUST ALREADY BE STRINGS. Pine's `+` on a string and a
          // number is a TYPE ERROR, not an implicit conversion, so coercing here
          // would accept a script TradingView rejects — and then disagree with it
          // about the result.
          if (typeof x !== 'string' || typeof y !== 'string') {
            throw new VmError(`concat: both sides must be strings, got ${typeof x} and ${typeof y}`)
          }
          stack[sp - 1] = x + y
          break
        }
```

and make `EQ`/`NE` compare strings by value while leaving the numeric path exactly as it is (read the existing cases first — they import their comparison from `interpret.js`, and the numeric semantics including `na` must not change).

- [ ] **Step 4: Lower the three shapes in the front end**

`pineRuntimeFrontend.js` refuses text by name today. Find the refusal the Step 2 run quoted, and admit exactly three shapes: a string literal (becomes a const), `+` where both operands are strings, and `==`/`!=` where both operands are strings. Everything else keeps its existing refusal.

⚠️ Route by the same rule the file already uses — *does this subtree read a mutable slot?* — rather than adding a second routing idea beside it.

- [ ] **Step 5: Run the test, then the engine suite**

```bash
npx vitest run src/components/chart/engine/runtime/__tests__/strings.test.js
npm run test:engine
```

Expected: all six pass; no new failure against the baseline. Record both totals lines.

- [ ] **Step 6: Commit**

```bash
python tools/check_repo_hygiene.py --staged
git add app/src/components/chart/engine/runtime/program.js \
        app/src/components/chart/engine/runtime/vm.js \
        app/src/components/chart/engine/runtime/ir.js \
        app/src/components/chart/engine/runtime/lowerIr.js \
        app/src/components/chart/engine/ast/pineRuntimeFrontend.js \
        app/src/components/chart/engine/runtime/__tests__/strings.test.js
git commit -F - <<'MSG'
feat(pine runtime): a string reaches a slot from a member's script

A literal, `+` between two strings, and `==` / `!=` between two
strings. Concat refuses a mixed pair by name: Pine's `+` on a string
and a number is a type error, not a conversion, so coercing would
accept a script TradingView rejects and then disagree about the answer.

str.tostring with a format is deliberately NOT here. Its rounding at .5
is vendor measurement M6 and M6 is unmeasured; a guess there is a wrong
number in a member's cell that nothing would catch.

Every other text construct keeps refusing by name, with a control in
the test file proving it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Record what boxing cost, on the real VM

**Files:**
- Test: `runtime/__tests__/boxedNumericCost.test.js` (create)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: nothing other tasks read. It is a recorded measurement with a ceiling.

**Context the implementer needs:** the value-model spike predicted about **1.2×** on a numeric-only program when slots are boxed. That was a spike, on a different VM. This records the real number so the next person reads a measurement instead of a prediction, and so a later change that makes it much worse is caught.

⛔ **A timing test must not fail on a slow machine.** The assertion is a generous ceiling (a numeric program stays under a fixed per-instruction budget), not a comparison against a stored number — a tight timing assertion on a shared box is a test that fails for reasons that have nothing to do with the code.

- [ ] **Step 1: Write the test**

```js
// app/src/components/chart/engine/runtime/__tests__/boxedNumericCost.test.js
//
// ─── WHAT BOXING COST, MEASURED ON THIS VM ──────────────────────────────────
//
// The value-model spike predicted ~1.2x on a numeric-only program when slots
// are boxed. That was a different VM. This records the real figure.
//
// ⛔ THE ASSERTION IS A CEILING, NOT A COMPARISON. A tight timing assertion on
// a shared machine fails for reasons that have nothing to do with the code, and
// a test that fails for unrelated reasons gets muted — taking the real signal
// with it.
import { describe, it, expect } from 'vitest'
import { makeProgram, OP } from '../program.js'
import { makeContext, execute } from '../vm.js'

const BARS = 20000
const NS_PER_INSTRUCTION_CEILING = 500   // generous on purpose

describe('the cost of boxed slots on numeric work', () => {
  it('stays under a generous per-instruction ceiling, and reports the figure', () => {
    const close = new Float64Array(BARS)
    for (let i = 0; i < BARS; i += 1) close[i] = 100 + Math.sin(i / 9)
    const zeros = () => new Float64Array(BARS)
    const ctx = makeContext({ bars: BARS, series: [zeros(), zeros(), zeros(), close], columns: [] })

    const code = [
      [OP.LOAD_PERSIST, 0, 0], [OP.CONST, 0, 0], [OP.MUL, 0, 0],
      [OP.READ_SERIES, 3, 0], [OP.CONST, 1, 0], [OP.MUL, 0, 0],
      [OP.ADD, 0, 0], [OP.STORE_PERSIST, 0, 0],
      [OP.LOAD_PERSIST, 0, 0], [OP.EMIT, 0, 0],
    ]
    const p = makeProgram({ code, consts: [0.9, 0.1], persists: 1, outputs: 1 })

    execute(p, ctx, {})                                  // warm
    const t0 = process.hrtime.bigint()
    const out = execute(p, ctx, {})
    const ns = Number(process.hrtime.bigint() - t0)

    const perInstruction = ns / (BARS * code.length)
    console.log(`boxed numeric cost: ${perInstruction.toFixed(1)} ns/instruction over ${BARS} bars`)

    expect(Number.isFinite(out.outputs[0][BARS - 1])).toBe(true)
    expect(perInstruction).toBeLessThan(NS_PER_INSTRUCTION_CEILING)
  })
})
```

- [ ] **Step 2: Run it and record the number**

```bash
npx vitest run src/components/chart/engine/runtime/__tests__/boxedNumericCost.test.js
```

Copy the printed `ns/instruction` into the commit message. If it is anywhere near the ceiling, say so plainly rather than raising the ceiling.

- [ ] **Step 3: Commit**

```bash
python tools/check_repo_hygiene.py --staged
git add app/src/components/chart/engine/runtime/__tests__/boxedNumericCost.test.js
git commit -F - <<'MSG'
test(pine runtime): record what boxed slots cost numeric work

The spike predicted ~1.2x on a different VM. This measures the real
one, on a recurrence over 20,000 bars, and asserts a generous ceiling
rather than a stored comparison -- a tight timing assertion on a shared
box fails for unrelated reasons and then gets muted, taking the real
signal with it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-review

**Spec coverage.** This plan implements the spec's §4.4 (the value model, now decided) and the *string values* clause of §5. It does NOT implement `str.*` builtins, typed arrays, loops, tuples, UDF frames or default parameters — those are plan 4 onward, and the spec's out-of-scope list is unchanged.

**Placeholders.** None. Every step has a command, an expected result, and the code.

**Type consistency.** `program.consts` is `Array<number|string>` in Task 1 and read as such in Task 2. `OP.CONCAT` is added to both `OP` and `IMPLEMENTED` in Task 2 Step 3 and used only there. The test helper `build()` wraps `buildRuntimeIr`, whose `{ok, refusal}` shape is the one the existing probes already read.

**One risk restated.** Task 1 touches the VM's hot loop, and the rail that protects it is the graph-vs-runtime differential — one tree, two lanes, bit-identical. If that reds, the boxing changed a numeric answer; stop rather than adjusting the tolerance, because the tolerance is the point.

## Where this sits in the sequence

| # | plan | state |
|---|---|---|
| 1 | Parser: typed parameters, generic syntax | **done**, `feat/pine-runtime-rvol-slice` |
| 2 | Value model decision | **done**, `feat/pine-value-model` |
| **3** | **Value model applied + strings** (this plan) | ready |
| 4 | `str.*` builtins + typed arrays (`sort_indices` waits on vendor M7) | next |
| 5 | Loops, tuples, UDF frames carrying `var`, default parameters | |
| 6 | Requests — contexts, merges, fixed-point discovery (waits on vendor M1–M5) | |
| 7 | Tables from the runtime · data layer · product wiring | |
