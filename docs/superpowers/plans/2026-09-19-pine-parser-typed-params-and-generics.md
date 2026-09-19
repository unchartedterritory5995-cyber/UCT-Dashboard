# Pine parser: typed parameters and generic collection syntax — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both Pine lanes read two v5/v6 spellings they currently reject as unreadable lines — typed function parameters (`f(float a) =>`) and generic collection syntax (`array.new<string>()`, `array<string> x = …`) — so a script that uses them is refused by the capability it needs, never by the shape of its line.

**Architecture:** One authority per grammar rule. The translator already parses typed parameters in `functionParams()`; the runtime front end hand-rolls a second loop that reads the type word as a parameter. Task 1 deletes the second parser and exports the first. Generic type arguments are not understood anywhere, so Task 2 normalises them once in the shared lexer, attaching the element type to the head token instead of discarding it — every consumer downstream, in both lanes, is then reading the same tokens.

**Tech Stack:** JavaScript (ES modules), Vitest, the existing Pine engine under `app/src/components/chart/engine/`.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/2026-09-19-pine-runtime-rvol-slice-design.md` (§5 "Parser (both lanes, one authority)").

## Global Constraints

- Branch `feat/pine-runtime-rvol-slice`, based on `origin/master` `f34b1830c`. Never push to master.
- Run the engine suite from `app/` as `npm run test:engine`. A narrower path may be used while iterating, but never as the evidence that "the engine suite passes" — `engine/__tests__/suiteCoverage.test.js` exists because a narrower path was once reported as the suite.
- `vitest -t` is a regex, and a filter matching nothing exits 0. Never cite it as a pass.
- A run with no totals line is not a run. Quote the totals line verbatim.
- Do not run backend pytest at all in this plan; unscoped collection OOMs this machine.
- Never `git add -A` or `git add .`; stage explicit paths. Never `git stash` (the stack is shared).
- Match the surrounding comment style: these files explain *why*, at length, and record what a mistake cost.
- **This plan changes no verdict for any script that already translates.** Scripts that use collections keep being refused — by their collection, not by their line shape.
- F1 (the owner's friend's RVOL + ATR Dashboard) is never committed, never added as a fixture, and never quoted at length. F2 (`corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine`, MPL-2.0) is already in the repo and is the committed evidence.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| file | responsibility | change |
|---|---|---|
| `app/src/components/chart/engine/ast/pine.js` | the shared lexer, statement tree and translator | export `functionParams`; add `stripTypeArguments` and call it in `lexPine` |
| `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` | the runtime lane's semantic front end | `defineFunction` uses `functionParams` instead of its own loop |
| `app/src/components/chart/engine/ast/udfTypedParams.test.js` | typed-parameter behaviour, both lanes | create |
| `app/src/components/chart/engine/ast/genericTypeArguments.test.js` | generic syntax and its controls | create |
| `app/src/components/chart/engine/ast/rvolSliceParseEvidence.test.js` | F2 reaches a capability refusal, not a shape refusal | create |

---

### Task 1: Typed function parameters read by one parser

**Files:**
- Modify: `app/src/components/chart/engine/ast/pine.js` (around `functionParams`, line ~8891)
- Modify: `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (`defineFunction`, lines ~1414-1432)
- Test: `app/src/components/chart/engine/ast/udfTypedParams.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `functionParams(toks, arrow) -> string[] | null` exported from `pine.js` — the parameter NAMES of a `name(params) =>` header, skipping Pine type words and qualifiers (`series simple const input int float bool string color line linefill label box polyline table array matrix map`); `null` when the header is not that shape, which includes a default value (`f(int n = 2)`).

**Context the implementer needs:** `f(float a) => a * 2` is today refused by the runtime lane with "`f` takes 2 arguments, given 1", because `defineFunction` pushes every `ident` token in the header as a parameter, so `float` becomes a parameter named `float`. The translator gets this right already. Both acceptance scripts type every parameter (`parseSymbols(string raw, string exch)`, `calcDaily(simple int N)`, `isStrongStart(float o, float l, float pc)`), so nothing else in the wave can proceed past this. Default parameter values stay refused by name in both lanes: neither acceptance script uses them, and implementing them means carrying default expressions into the frame protocol — a later plan, not this one.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/chart/engine/ast/udfTypedParams.test.js`:

```js
// app/src/components/chart/engine/ast/udfTypedParams.test.js
//
// ─── TYPED PARAMETERS, READ BY ONE PARSER ───────────────────────────────────
//
// ⚰️ MEASURED 2026-09-19: `f(float a) => a * 2` was refused by the runtime lane
// with "`f` takes 2 arguments, given 1" while the translator read it correctly.
// Two parsers for one grammar, and the divergence was invisible because each
// lane's own tests only ever asked its own parser. Every function in both
// acceptance scripts of the RVOL slice is typed, so this was the first wall.
//
// ⛔ THE CONTROL IS NOT OPTIONAL. An untyped header must keep working, or a
// "fix" that deleted parameters entirely would pass every assertion below.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const runtime = (body) => buildRuntimeIr(H + body + '\n')
const host = (body) => translatePine(H + body + '\n', { strict: true })

describe('typed function parameters', () => {
  it('reads an untyped header (control)', () => {
    expect(runtime('f(a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })

  it('reads a typed header in the runtime lane', () => {
    expect(runtime('f(float a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })

  it('reads a qualifier plus a type', () => {
    expect(runtime('f(simple int n) =>\n    n * 2\nplot(f(3))').ok).toBe(true)
  })

  it('reads several typed parameters', () => {
    expect(runtime('f(float a, float b, int n) =>\n    (a + b) * n\nplot(f(close, open, 2))').ok).toBe(true)
  })

  it('binds the parameter by its NAME, not by its type word', () => {
    // ⭐ THE ASSERTION THAT CATCHES "arity fixed, binding wrong": the body reads
    // `a`, so a parser that kept `float` as the first parameter would either
    // refuse the body or bind `a` to the wrong slot.
    const out = runtime('f(float a) =>\n    a * 3\nplot(f(close))')
    expect(out.ok).toBe(true)
    expect(String(out.refusal || '')).not.toMatch(/float/)
  })

  it('still refuses a default value BY NAME, in both lanes', () => {
    const r = runtime('f(float a, int n = 2) =>\n    a * n\nplot(f(close))')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/default value/i)
    expect(host('f(float a, int n = 2) =>\n    a * n\nplot(f(close))').ok).toBe(false)
  })

  it('leaves the translator unchanged on both spellings', () => {
    expect(host('f(a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
    expect(host('f(float a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail for the right reason**

Run from `app/`:

```bash
npx vitest run src/components/chart/engine/ast/udfTypedParams.test.js
```

Expected: the untyped control and the two translator cases PASS; the typed runtime cases FAIL with "`f` takes 2 arguments, given 1". If a typed case fails with anything else, stop and read the refusal before changing code.

- [ ] **Step 3: Export the one authority from `pine.js`**

`functionParams` is declared around line 8891 as `function functionParams(toks, arrow) {`. Add the export keyword and a note saying who else reads it:

```js
/** The parameter names of `f(a, b) =>`, or null if the header is not that shape.
 *
 *  ⭐⭐ EXPORTED FOR THE RUNTIME FRONT END, which had its own copy of this loop
 *  until 2026-09-19. That copy read `f(float a)` as TWO parameters, so a typed
 *  header — the normal spelling in v5 and v6 — was refused as an arity error in
 *  one lane and accepted in the other. One grammar, one parser; a second one is
 *  a second answer waiting to diverge.
 */
export function functionParams(toks, arrow) {
```

- [ ] **Step 4: Make the runtime front end use it**

In `pineRuntimeFrontend.js`, add `functionParams` to the existing import from `./pine.js` (the block at lines ~31-35), then replace the hand-rolled loop inside `defineFunction`. Delete these lines:

```js
    const params = []
    for (let i = 2; i < arrow - 1; i += 1) {
      const t = toks[i]
      if (isPunct(t, ',')) continue
      if (t.kind !== 'ident') {
        throw new RuntimeRefusal('runtime:function',
          `a parameter this front end cannot read (\`${t.value}\`) — default values are not supported yet`,
          locate(t))
      }
      params.push(t.value)
    }
```

and put this in their place:

```js
    // ⭐⭐ ONE PARSER FOR THE HEADER. `functionParams` is the translator's own,
    // exported rather than copied: it skips Pine's type words and qualifiers
    // (`float a`, `simple int n`) and answers null for a header this grammar
    // does not read. The copy that used to live here counted `float` as a
    // parameter, which surfaced as a wrong ARITY — a refusal that named the call
    // site and said nothing about the real cause.
    const params = functionParams(toks, arrow)
    if (params === null) {
      // ⛔ THE REFUSAL STILL NAMES THE TOKEN. `null` means "not this shape", and
      // the member needs to know which token stopped it; a default value is the
      // case this corpus actually hits, so it keeps its own sentence.
      const bad = toks.slice(2, arrow - 1).find(
        (t) => !isPunct(t, ',') && t.kind !== 'ident')
      throw new RuntimeRefusal('runtime:function',
        bad && isPunct(bad, '=')
          ? `a parameter this front end cannot read (\`=\`) — default values are not supported yet`
          : `a parameter this front end cannot read${bad ? ` (\`${bad.value}\`)` : ''}`,
        locate(bad || toks[0]))
    }
```

- [ ] **Step 5: Run the test again**

```bash
npx vitest run src/components/chart/engine/ast/udfTypedParams.test.js
```

Expected: all cases PASS.

- [ ] **Step 6: Run the engine suite**

```bash
npm run test:engine
```

Expected: no NEW failures. Record the totals line verbatim. Three files are known-flaky in company (`flipCRecord`, `flipCGeometry`, `manifestProse`); if one of those is red, re-run it alone and say so.

- [ ] **Step 7: Commit**

```bash
git add src/components/chart/engine/ast/pine.js \
        src/components/chart/engine/ast/pineRuntimeFrontend.js \
        src/components/chart/engine/ast/udfTypedParams.test.js
git commit -m "fix(pine): one parser for typed function parameters

The runtime front end kept its own header loop, which read `f(float a)`
as two parameters and refused the call as an arity error, while the
translator read the same header correctly. Export the translator's
functionParams and delete the copy. Default values stay refused by name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Generic collection type arguments, normalised in the lexer

**Files:**
- Modify: `app/src/components/chart/engine/ast/pine.js` (`lexPine`, exported at line ~1851)
- Test: `app/src/components/chart/engine/ast/genericTypeArguments.test.js` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `lexPine(src).tokens` no longer contains the `<` … `>` run of a collection type argument. The head token instead carries `typeArgs: string[]` — for `array.new<float>()` the head token `array.new` carries `['float']`; for `map.new<string, array<float>>()` it carries `['string', 'array<float>']`. Later plans (typed arrays in the runtime) read `typeArgs`; nothing reads it yet.

**Context the implementer needs:** measured on 2026-09-19, the lexer emits a dotted name as ONE ident token (`array.new`, `str.split`, `math.max`), and emits `<`, `>` as separate punctuation. So `a = array.new<float>()` lexes as `ident:a punct:= ident:array.new punct:< ident:float punct:> punct:( punct:)`, and the parser reads `<` as a comparison, fails to find a readable statement, and reports `pine:statement` — "this Pine line is not a shape the translator reads" — which tells a member nothing about arrays. Both acceptance scripts use the generic spelling (`array.new<string>()`, `array<string> toks = str.split(…)`).

The discriminator is exact and must stay exact: `a < b > c` is a legal comparison chain and lexes identically apart from its head token. Only two heads can carry type arguments — the collection constructors `array.new` / `matrix.new` / `map.new`, and a declaration whose type is `array` / `matrix` / `map`. Matching on a closed list of heads, rather than on "any ident followed by `<`", is what keeps every real comparison untouched.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/chart/engine/ast/genericTypeArguments.test.js`:

```js
// app/src/components/chart/engine/ast/genericTypeArguments.test.js
//
// ─── `array.new<string>()` IS A LINE THIS ENGINE CAN READ ───────────────────
//
// Pine writes a collection's element type in angle brackets. This grammar has no
// type arguments, and every consumer downstream reads `<` and `>` as
// comparisons, so the whole statement came back as `pine:statement` — "this Pine
// line is not a shape the translator reads". That is a refusal about a LINE when
// the truth is a refusal about a CAPABILITY: we do not do collections yet.
//
// ⛔⛔ THE CONTROLS ARE THE POINT OF THIS FILE. `a < b > c` lexes the same way
// apart from its head token, and a matcher that took "any ident followed by `<`"
// would silently turn a comparison chain into a call — a mistranslation that
// parses, lints, saves and scans. The head list is closed for that reason.
import { describe, it, expect } from 'vitest'
import { lexPine, translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const shape = (src) => lexPine(H + src + '\n').tokens.map((t) => `${t.kind}:${t.value}`).join(' ')
const headOf = (src, value) => lexPine(H + src + '\n').tokens.find((t) => t.value === value)

describe('generic collection type arguments', () => {
  it('drops the type argument of a constructor and keeps it on the head token', () => {
    expect(shape('a = array.new<float>()')).not.toMatch(/punct:</)
    expect(headOf('a = array.new<float>()', 'array.new').typeArgs).toEqual(['float'])
  })

  it('drops the type argument of a typed declaration', () => {
    expect(shape('array<string> toks = str.split(s, ",")')).not.toMatch(/punct:</)
    expect(headOf('array<string> toks = str.split(s, ",")', 'array').typeArgs).toEqual(['string'])
  })

  it('handles a nested type argument and the `>>` it ends with', () => {
    expect(shape('m = map.new<string, array<float>>()')).not.toMatch(/punct:</)
    expect(headOf('m = map.new<string, array<float>>()', 'map.new').typeArgs)
      .toEqual(['string', 'array<float>'])
  })

  it('CONTROL: leaves a comparison chain completely alone', () => {
    const before = 'punct:< ident:b punct:> ident:c'
    expect(shape('x = a < b > c ? 1 : 0')).toContain(before)
  })

  it('CONTROL: leaves a comparison whose head is a dotted builtin alone', () => {
    expect(shape('x = ta.sma(close, 5) < high ? 1 : 0')).toMatch(/punct:</)
  })

  it('CONTROL: an unterminated `<` is left alone rather than eating the line', () => {
    expect(shape('a = array.new<float')).toMatch(/punct:</)
  })

  it('a script using a collection is now refused BY ITS COLLECTION, not by its line shape', () => {
    const src = H + 'a = array.new<float>()\narray.push(a, close)\nplot(array.get(a, 0))\n'
    const host = translatePine(src, { strict: true })
    expect(host.ok).toBe(false)
    const messages = (host.refusals || []).map((r) => r.message).join(' | ')
    expect(messages).toMatch(/array|collection/i)
    expect(messages).not.toMatch(/not a shape the translator reads/)

    const rt = buildRuntimeIr(src)
    expect(rt.ok).toBe(false)
    expect(rt.refusal.message).toMatch(/array|collection/i)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail for the right reason**

```bash
npx vitest run src/components/chart/engine/ast/genericTypeArguments.test.js
```

Expected: the three CONTROL cases PASS already (nothing strips anything yet); the constructor, declaration, nested and refusal cases FAIL.

- [ ] **Step 3: Add the normaliser to `pine.js`**

Put this immediately above `export function lexPine(src) {` (line ~1851):

```js
/** The only heads that may carry a type argument.
 *
 *  ⛔⛔ CLOSED ON PURPOSE, AND IT IS WHAT KEEPS COMPARISONS SAFE. `a < b > c` is
 *  a legal chain and lexes exactly like a generic apart from its head token, so
 *  "any ident followed by `<`" would rewrite arithmetic into a call. Only Pine's
 *  three collection constructors and the three collection type names can be
 *  followed by `<`, so only those six are matched here. */
const GENERIC_CALL_HEADS = Object.freeze(new Set(['array.new', 'matrix.new', 'map.new']))
const GENERIC_TYPE_HEADS = Object.freeze(new Set(['array', 'matrix', 'map']))

/**
 * Remove `<…>` type arguments, keeping the element type on the head token.
 *
 * ⭐ THE TYPE IS KEPT, NOT DISCARDED. `array<string>` and `array<float>` are
 * different types, and the runtime's typed collections will need to know which
 * — so the segment leaves the token stream (this grammar has no type arguments)
 * and reappears as `head.typeArgs`. Dropping it outright would make the next
 * wave re-parse the source to recover something we already had.
 *
 * ⭐ WHY THE LEXER. Both lanes call `lexPine`, so normalising here fixes the
 * translator and the runtime front end in one place. A fix in either parser
 * would leave the other reading a line it cannot see the shape of.
 *
 * ⛔ AN UNTERMINATED `<` IS LEFT ALONE. A run with no matching `>` on the same
 * statement is not a type argument; swallowing to end-of-input would turn a typo
 * into a vanished line.
 *
 * @param {object[]} tokens the lexer's tokens, mutated in place is NOT done —
 *   a new array is returned and the head token is copied before `typeArgs` is
 *   attached, so nothing that already holds a token sees it change.
 */
function stripTypeArguments(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const head = tokens[i]
    const next = tokens[i + 1]
    const isCall = head.kind === 'ident' && GENERIC_CALL_HEADS.has(head.value)
    const isDecl = head.kind === 'ident' && GENERIC_TYPE_HEADS.has(head.value)
    if (!(isCall || isDecl) || !isPunct(next, '<')) { out.push(head); continue }

    // Find the `>` that closes this `<`, counting nested pairs. `array<float>>`
    // ends with two separate `>` tokens, which is why this counts rather than
    // searching for the first one.
    let depth = 0
    let close = -1
    const parts = []
    let part = []
    for (let j = i + 1; j < tokens.length; j += 1) {
      const t = tokens[j]
      if (isPunct(t, '<')) { depth += 1; if (depth > 1) part.push('<'); continue }
      if (isPunct(t, '>')) {
        depth -= 1
        if (depth === 0) { close = j; break }
        part.push('>')
        continue
      }
      if (depth === 1 && isPunct(t, ',')) { parts.push(part.join('')); part = []; continue }
      if (t.kind === 'ident' || t.kind === 'number') part.push(String(t.value))
      else { close = -2; break }   // anything else means this was never a type argument
    }
    if (close < 0) { out.push(head); continue }
    if (part.length) parts.push(part.join(''))

    // ⛔ THE SHAPE AFTER THE `>` DECIDES IT. A constructor's type argument is
    // followed by `(`; a declaration's is followed by the name being declared.
    // Anything else is not a generic and is left untouched.
    const after = tokens[close + 1]
    const good = isCall ? isPunct(after, '(') : (after && after.kind === 'ident')
    if (!good) { out.push(head); continue }

    out.push({ ...head, typeArgs: parts })
    i = close
  }
  return out
}
```

- [ ] **Step 4: Call it from `lexPine`**

Find `lexPine`'s return statement (it returns `{ tokens, indents, version, lines, rawOffsetMap }`) and normalise the tokens there:

```js
  // ⭐ ONE NORMALISATION, BEFORE ANY PARSER SEES THE TOKENS — see
  // `stripTypeArguments` for why this belongs to the lexer and not to either
  // lane's parser.
  return { tokens: stripTypeArguments(tokens), indents, version, lines, rawOffsetMap }
```

- [ ] **Step 5: Run the test again**

```bash
npx vitest run src/components/chart/engine/ast/genericTypeArguments.test.js
```

Expected: every case PASSES, controls included.

- [ ] **Step 6: Run the engine suite**

```bash
npm run test:engine
```

Expected: no NEW failures. This step is the real gate for this task: the lexer feeds every Pine test in the repo, so a matcher that is too greedy shows up here as unrelated scripts changing verdict. Record the totals line verbatim. If any corpus census test reports a moved number (for example `capabilityDemandCensus` or `executionShapeCensus`), that is expected to be an IMPROVEMENT — scripts moving off `pine:statement` onto a named capability. Report the before/after numbers rather than updating a snapshot silently.

- [ ] **Step 7: Commit**

```bash
git add src/components/chart/engine/ast/pine.js \
        src/components/chart/engine/ast/genericTypeArguments.test.js
git commit -m "feat(pine): read generic collection syntax, keep the element type

array.new<string>() and array<string> x = ... came back as
pine:statement, a refusal about the LINE when the truth was a refusal
about a CAPABILITY. Normalise the type argument away in the shared
lexer, so both lanes see a readable statement, and keep the element type
on the head token for the typed-collection wave. Heads are a closed list
of six so that a < b > c stays a comparison.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Evidence that the acceptance script moved

**Files:**
- Test: `app/src/components/chart/engine/ast/rvolSliceParseEvidence.test.js` (create)

**Interfaces:**
- Consumes: Task 1 and Task 2.
- Produces: nothing other tasks read. This is the rail that keeps the two fixes honest as the wave continues.

**Context the implementer needs:** F2 is the committed acceptance script of the RVOL slice. Before this plan it produced `pine:statement` at its `array<string>` lines and an arity error for its typed functions. After it, its refusals must all name capabilities that are genuinely missing (collections, loops, requests, drawings) and none of them may be about the shape of a line. This test is what stops a later change quietly re-breaking the parse.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/chart/engine/ast/rvolSliceParseEvidence.test.js`:

```js
// app/src/components/chart/engine/ast/rvolSliceParseEvidence.test.js
//
// ─── THE ACCEPTANCE SCRIPT IS REFUSED BY CAPABILITY, NEVER BY LINE SHAPE ────
//
// F2 of the RVOL slice — "Strong Start RVOL Dashboard" (MPL-2.0, © finallynitin),
// already in `corpus/committed`. It is a watchlist dashboard: typed user
// functions, generic arrays, a loop of `request.security` calls, one table.
//
// None of that is built yet, and this test does not pretend otherwise. What it
// pins is the DIFFERENCE between "this Pine line is not a shape the translator
// reads" and "we do not do collections yet": the first is a dead end for the
// member and for us, the second is a capability with a name and a plan.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const F2 = path.resolve(
  process.cwd(),
  '../corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine')

describe('RVOL slice parse evidence (F2)', () => {
  const src = fs.readFileSync(F2, 'utf8')
  const out = translatePine(src, { strict: true })
  const sentences = [
    ...(out.refusals || []).map((r) => r.message),
    ...(out.notes || []).map((n) => n.message),
  ].filter(Boolean)

  it('reads every line of it', () => {
    expect(sentences.join(' | ')).not.toMatch(/not a shape the translator reads/)
  })

  it('does not report a wrong arity for its typed functions', () => {
    expect(sentences.join(' | ')).not.toMatch(/takes \d+ arguments, given/)
  })

  it('still refuses it, by capabilities that have names', () => {
    // ⛔ It MUST still be refused. Collections, loops, requests and tables are
    // the rest of the wave; a green verdict here would mean the door had started
    // accepting a script it cannot actually run.
    expect(out.ok).toBe(false)
    expect(sentences.join(' | ')).toMatch(/array|collection|loop|request|drawing|table/i)
  })
})
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/components/chart/engine/ast/rvolSliceParseEvidence.test.js
```

Expected: PASS on all three, given Tasks 1 and 2. If "reads every line of it" fails, print the failing sentences and find which construct still reports a shape refusal — that is a real finding and belongs in the plan's completion notes, not in a loosened assertion.

- [ ] **Step 3: Measure F1 locally and record the numbers (not the script)**

F1 is the owner's friend's script and is never committed. Run the same translation against the local copy and record ONLY the counts, in the completion notes:

```bash
node -e "const {translatePine}=require('./src/components/chart/engine/ast/pine.js')" 2>/dev/null || true
```

Use a throwaway Vitest probe under a path that is not committed, translate
`C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\fbaee546-bd99-4225-863b-af5a7a60f4a3\scratchpad\rvol\rvol_atr_dashboard.pine`,
and report: the number of `pine:statement` notes before and after (expected: 2 → 0), whether any arity error remains (expected: none), and the first refusal by code. Delete the probe afterwards.

- [ ] **Step 4: Run the engine suite one last time and commit**

```bash
npm run test:engine
git add src/components/chart/engine/ast/rvolSliceParseEvidence.test.js
git commit -m "test(pine): pin that the RVOL slice's committed script parses

F2 must be refused by capabilities that have names — collections, loops,
requests, drawings — and never by the shape of a line. This is the rail
that keeps the typed-parameter and generic-syntax fixes honest while the
rest of the wave lands.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** This plan implements the first two bullets of the spec's §5 "Parser (both lanes, one authority)". Default parameter values are named in the spec's list and are deliberately NOT implemented here: neither acceptance script uses them, and they need default expressions in the frame protocol. They stay a named refusal in both lanes, and are carried into the language-core plan below.

**Placeholders.** None: every step has its command, its expected result, and its code.

**Type consistency.** `functionParams(toks, arrow)` keeps its existing signature and return type (`string[] | null`); the runtime's `defineFunction` consumes exactly that. `stripTypeArguments(tokens)` returns a new token array and is called only from `lexPine`'s return; `typeArgs` is written on a copied head token and is read by nobody in this plan.

**One risk worth restating.** Task 2 edits the lexer, which every Pine test in the repo depends on. The engine suite in Step 6 is the gate, and a moved census number is expected to be an improvement — to be reported with before/after numbers, never silently re-snapshotted.

## The plan sequence for the rest of the wave

This is plan 1 of 7. Each later plan gets written when its turn comes, from the same spec, and each produces something testable on its own.

| # | plan | depends on | why here |
|---|---|---|---|
| 1 | **Parser: typed parameters, generic syntax** (this plan) | — | Blocks nothing; unblocks both acceptance scripts' parse |
| 2 | **Value model decision** — tagged values vs NaN-boxing, benchmarked with an agreement control, as C4 chose the runtime | 1 | Every later capability sits on it |
| 3 | **Language core** — strings, typed arrays, loops, tuples, UDF frames carrying `var`, default parameters | 2 | The bulk of the grammar both scripts need |
| 4 | **Requests** — contexts, HTF/LTF merge, fixed-point discovery of dynamic symbols, symbol resolution, the request ceiling. Vendor measurements first | 3 | Needs strings and loops to exist |
| 5 | **Tables from the runtime** — object ops, `table.clear`, `cell_set_*`, `text_formatting` | 3 | Independent of 4; can run in parallel |
| 6 | **Data layer** — today-pack and bars stream, session filter, backoff, concurrency cap | — | Can start any time; independent of the engine work |
| 7 | **Product wiring** — kind `pine`, its own flag plus cohort tag, worker execution, object-only definitions, input controls, install off the render path | 3,4,5,6 | The last mile, and the only one that touches what members see |
