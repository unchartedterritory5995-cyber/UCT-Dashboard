# `str.*` builtins and typed arrays — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the runtime the two things a watchlist dashboard is built out of — text operations and typed collections — so a pasted symbol list becomes an array of symbols the engine can walk.

**Architecture:** Plan 3 made a slot hold a value and put strings in it. This adds the operations. A collection is a JS array behind a handle held in a slot, so the host's garbage collector owns its lifetime (the reason NaN-boxing was rejected: an index into a side table is not a reference, and nothing can collect it). Element type comes from the `typeArgs` the lexer already preserves (plan 1) — `array<string>` and `array<float>` are different types and the runtime is told which.

**Tech Stack:** JavaScript (ES modules), Vitest, `engine/runtime/{program,vm,ir,lowerIr}.js`, `engine/ast/pineRuntimeFrontend.js`.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` §5.

## Global Constraints

- Branch `feat/pine-language-core` (continues plan 3). Never push to master.
- `npm run test:engine` from `app/` is the gate; compare against a baseline run at the base commit in `.claude/worktrees/pine-baseline-check` (READ-ONLY).
- A run with no totals line is not a run. `vitest -t` is a regex; a filter matching nothing exits 0.
- No backend pytest. No `git add -A`. No `git stash`.
- `python tools/check_repo_hygiene.py --staged` before each commit; messages via quoted heredoc, ending with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- ⛔ **Two capabilities are BLOCKED ON VENDOR MEASUREMENT and must stay refused by name until the answers land in `docs/pine/rvol-slice-vendor-answers.json`:**
  - `str.tostring(x, format)` — rounding at `.5` is **M6**, unmeasured.
  - `array.sort_indices` — tie order is **M7**, unmeasured.
  Implementing either on a guess puts a wrong number in a member's table cell, and nothing downstream would catch it. `str.tostring(x)` with **no** format argument is also deferred: it is the same rounding question wearing a default.

## File Structure

| file | responsibility | change |
|---|---|---|
| `runtime/program.js` | opcode table | `STR_*` and `ARR_*` opcodes + `IMPLEMENTED` |
| `runtime/vm.js` | the bar loop | execute them; refuse a wrong operand kind by name |
| `runtime/limits.js` | resource ceilings | element and operation ceilings already exist — wire them |
| `runtime/ir.js`, `runtime/lowerIr.js` | IR → program | lower the calls |
| `engine/ast/pineRuntimeFrontend.js` | Pine → IR | admit the supported names; keep every other one refusing |
| `runtime/__tests__/strBuiltins.test.js` | text operations | create |
| `runtime/__tests__/arrays.test.js` | collections, incl. Pine's own error behaviour | create |
| `runtime/__tests__/splitAndWalk.test.js` | the two together, on the real idiom | create |

---

### Task 1: The `str.*` subset both acceptance scripts use

**Files:** `program.js`, `vm.js`, `lowerIr.js`, `pineRuntimeFrontend.js`, `runtime/__tests__/strBuiltins.test.js` (create)

**Interfaces:**
- Produces: `str.replace_all(s, target, replacement)`, `str.trim(s)`, `str.contains(s, sub)`, `str.startswith(s, pre)`, `str.length(s)`, `str.upper(s)`, `str.lower(s)`. Each refuses a non-string operand by name at the VM boundary.
- Not produced, and refusing by name: `str.tostring` (M6), `str.split` (Task 3), `str.format`, `str.match`, `str.substring`, `str.pos`.

**Context:** measured from the two acceptance scripts — F1 uses `replace_all`, `split`, `trim`, `contains`, `tostring`; F2 adds `startswith`. Nothing else in either.

⛔ **Pine's `str.replace_all` replaces EVERY occurrence and takes plain strings, not regexes.** JavaScript's `String.prototype.replaceAll` matches that for a string needle, but `replace` with a string needle replaces only the first — so use `replaceAll`, and the test plants a needle appearing three times so the difference is visible. **Any regex-special character in a member's watchlist (`.` in `BRK.B`) must be treated literally**, which is the second reason a regex path is wrong here.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/engine/runtime/__tests__/strBuiltins.test.js
//
// ─── THE TEXT OPERATIONS A WATCHLIST IS PARSED WITH ─────────────────────────
//
// ⛔ `str.replace_all` REPLACES EVERY OCCURRENCE AND ITS NEEDLE IS LITERAL.
// JavaScript's `replace` with a string needle replaces only the FIRST, and a
// regex path would give `BRK.B`'s dot a meaning the member never asked for.
// Both traps have a case below.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const runs = (body) => buildRuntimeIr(H + body + '\n').ok

describe('str.* in the runtime lane', () => {
  it('replace_all replaces EVERY occurrence', () => {
    expect(runs('string s = str.replace_all("a,b,c", ",", ";")\nplot(s == "a;b;c" ? 1 : 0)')).toBe(true)
  })

  it('replace_all treats its needle LITERALLY, not as a regex', () => {
    expect(runs('string s = str.replace_all("BRK.B", ".", "-")\nplot(s == "BRK-B" ? 1 : 0)')).toBe(true)
  })

  it('trim, contains, startswith, length, upper, lower', () => {
    expect(runs('plot(str.trim("  AAPL ") == "AAPL" ? 1 : 0)')).toBe(true)
    expect(runs('plot(str.contains("NASDAQ:AAPL", ":") ? 1 : 0)')).toBe(true)
    expect(runs('plot(str.startswith("###note", "###") ? 1 : 0)')).toBe(true)
    expect(runs('plot(str.length("AAPL"))')).toBe(true)
    expect(runs('plot(str.upper("aapl") == "AAPL" ? 1 : 0)')).toBe(true)
    expect(runs('plot(str.lower("AAPL") == "aapl" ? 1 : 0)')).toBe(true)
  })

  it('CONTROL: str.tostring is STILL refused, by name — it waits on vendor M6', () => {
    const out = buildRuntimeIr(H + 'plot(str.length(str.tostring(1.5)))\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toMatch(/str\.tostring/)
  })

  it('CONTROL: an unlisted str.* is refused by name', () => {
    const out = buildRuntimeIr(H + 'plot(str.length(str.substring("abcd", 1, 3)))\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.message).toMatch(/str\.substring/)
  })
})
```

- [ ] **Step 2: Run it; every non-CONTROL case must fail before you implement**
```bash
npx vitest run src/components/chart/engine/runtime/__tests__/strBuiltins.test.js
```
- [ ] **Step 3: Implement** the seven names: opcodes in `program.js` (`OP` + `IMPLEMENTED`), execution in `vm.js` with a kind check per operand (`typeof x !== 'string'` throws naming the builtin and the operand position), lowering in `lowerIr.js`, admission in `pineRuntimeFrontend.js`. Use `replaceAll` with a string needle.
- [ ] **Step 4: Re-run the file, then `npm run test:engine`; record both totals lines.**
- [ ] **Step 5: Commit** (`feat(pine runtime): the str.* subset a watchlist is parsed with`).

---

### Task 2: Typed arrays

**Files:** `program.js`, `vm.js`, `limits.js`, `lowerIr.js`, `pineRuntimeFrontend.js`, `runtime/__tests__/arrays.test.js` (create)

**Interfaces:**
- Produces: `array.new<T>()` / `array.new_float|int|bool|string(size, initial)`, `array.from`, `push`, `get`, `set`, `size`, `copy`, `clear`. A handle lives in a slot; the collection is a JS array the host collects.
- Not produced, refusing by name: `sort_indices` (M7), `sort`, `slice`, `concat`, `matrix.*`, `map.*`.

**Context:** the element type comes from `typeArgs` on the head token, which the lexer preserves (plan 1). `limits.js` already declares `ARRAY_ELEMENTS` (100000) and `ARRAY_OPERATIONS` (2000000) — wire them rather than inventing new ceilings.

⛔⛔ **Pine's out-of-range `array.get` is a RUNTIME ERROR that stops the script, not an `na`.** A dashboard that silently returned `na` for a bad index would draw a table with blank cells where TradingView shows an error — the member would read our blank as "no data" and trust it. The test asserts the throw, and a CONTROL asserts an in-range read does not throw, so "it throws" cannot pass for the wrong reason.

- [ ] **Step 1: Write the failing test** — cases: a typed array round-trips a string; `push`/`size`/`get`/`set`/`copy` behave; `copy` is a COPY (mutating the copy leaves the original alone — the case that catches an aliasing bug); out-of-range `get` throws; **CONTROL** in-range `get` does not throw; **CONTROL** `array.sort_indices` still refuses by name (M7); **CONTROL** `matrix.new` still refuses by name; an array exceeding `ARRAY_ELEMENTS` raises the named limit error.
- [ ] **Step 2: Run it; watch every non-CONTROL case fail.**
- [ ] **Step 3: Implement**, charging `ARRAY_ELEMENTS`/`ARRAY_OPERATIONS` through the existing `budget.charge` path.
- [ ] **Step 4: Re-run, then `npm run test:engine`; record totals.**
- [ ] **Step 5: Commit.**

---

### Task 3: `str.split`, and the idiom both scripts are built on

**Files:** `program.js`, `vm.js`, `lowerIr.js`, `pineRuntimeFrontend.js`, `runtime/__tests__/splitAndWalk.test.js` (create)

**Interfaces:** `str.split(s, separator) -> array<string>`. It is here rather than in Task 1 because it returns a collection, so it needs Task 2.

**Context:** this is the shape of both acceptance scripts' parsers — replace newlines with commas, split on the comma, trim each token, skip the empties, prefix a default exchange when there is no colon. The test runs that whole shape, because each piece passing separately is not evidence the idiom works.

⛔ **Pine's `str.split` on an empty string yields one empty element, not an empty array**, and both scripts rely on the empty-token skip that follows. Get this wrong and a pasted list with a trailing newline gains a phantom symbol — which would then be requested, fail, and read to the member as a dead ticker.

- [ ] **Step 1: Write the failing test** — the full parse idiom over `"AAPL,MSFT\nNVDA,,  TSLA "` produces exactly `NASDAQ:AAPL, NASDAQ:MSFT, NASDAQ:NVDA, NASDAQ:TSLA`; a trailing separator adds no phantom; `"NYSE:JPM"` keeps its own exchange; **CONTROL** an empty input yields an empty result rather than one empty symbol.
- [ ] **Step 2: Run it; watch it fail.**
- [ ] **Step 3: Implement `str.split`.**
- [ ] **Step 4: Re-run, then `npm run test:engine`; record totals.**
- [ ] **Step 5: Commit.**

---

### Task 4: Move the acceptance scripts' wall, and say where it now stands

**Files:** `engine/ast/rvolSliceParseEvidence.test.js` (extend — it exists from plan 1)

**Context:** plan 1 pinned that F2 carries no shape refusals. This adds the runtime-lane half: F2's first runtime refusal must no longer be the text value model, and whatever it IS now gets pinned by name so the next plan inherits a measured fact instead of a guess.

- [ ] **Step 1** Add a case asserting `buildRuntimeIr(F2).refusal.message` no longer matches `/text|value-model/` and DOES match the next real wall (loops, requests or drawings — read it from the run, do not predict it).
- [ ] **Step 2** Run it; record the actual refusal verbatim in the commit message.
- [ ] **Step 3** `npm run test:engine`; commit.

---

## Self-review

**Spec coverage.** Implements §5's text and collection clauses except the two vendor-blocked names, which stay refused by name with a control each.

**Placeholders.** Tasks 2–4 give their cases as an enumerated list rather than full code, deliberately: each is a variation of Task 1's shape, and the discriminating detail (what must fail first, what the CONTROL is, what Pine's real semantics are) is stated for every one. If an implementer cannot write the case from that, the case description is the thing to fix.

**Type consistency.** `str.split` returns the same collection handle Task 2 defines; `typeArgs` is read from the lexer's head token as plan 1 left it.

**The risk worth restating.** Two names are blocked on measurements nobody has taken. The temptation to implement them "provisionally" is exactly the failure this wave exists to prevent: a plausible rounding rule produces a number that looks right in every test we can write, and is wrong on the member's screen.
