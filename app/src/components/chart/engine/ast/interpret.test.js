import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { parseFormula, TABLE, NODE_TYPES, REFUSALS as PARSE_REFUSALS } from './parse.js'
import {
  interpret, maxLookback, nodeCount, FN, TableRefusal, REFUSALS,
} from './interpret.js'

/** The repo root, found by walking up — same helper `parse.test.js` uses, and it
 *  THROWS BY NAME rather than defaulting, because a helper that returned a
 *  default here would make every fixture-driven case below silently read
 *  nothing. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`ast/interpret.test: could not find the repo root from ${process.cwd()}`)
})()

const SELF = path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine', 'ast', 'interpret.js')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

const CORPUS = readJson('tests/fixtures/ast/corpus.json')
const ESCAPES = readJson('tests/fixtures/ast/escapes.json')

/** ⭐ THE BARS ARE RESOLVED THROUGH THE CORPUS'S OWN DECLARATION, NOT RE-TYPED.
 *
 *  `corpus.json` says `tests/fixtures/alerts/replay_bars.json#intraday5m`, that
 *  fixture says `barsFrom: app/src/pages/parityBars/intraday5m.json`, and this
 *  follows both links. So the pixel gate, the alert replay, the Python
 *  conformance lane and this file are provably ONE series rather than four
 *  copies that agreed on the day somebody made them — the same argument
 *  `tools/ast_conformance.py::corpus_bars` makes on the other side. A wrong path
 *  fails by name; it never silently reads some other tape.
 *
 *  ⚠️ THE RECORDED `sha256` IS NOT RE-CHECKED HERE, AND SAYING WHY MATTERS.
 *  `alert_replay._bars_digest` hashes `json.dumps(bars, sort_keys=True,
 *  separators=(',',':'))` — a CANONICAL RE-SERIALISATION, not the file's bytes,
 *  which is what makes it immune to the CRLF trap. JS cannot reproduce it:
 *  Python writes `100.0` where `JSON.stringify` writes `100`, so a naive
 *  re-implementation here would fail forever on a file nobody touched (it did,
 *  on the first run of this file, against the raw bytes). The digest stays the
 *  Python lane's to enforce — it runs on every `--check` and every census — and
 *  what this asserts instead is the fixture's own recorded `bar_count`, which
 *  catches a truncated or swapped file without pretending to re-derive a digest
 *  in a language that cannot spell it. */
const BARS = (() => {
  const ref = CORPUS.bars
  if (!ref || !ref.includes('#')) throw new Error(`corpus.bars must be '<path>#<fixture>', got ${ref}`)
  const [rel, name] = ref.split('#')
  const entry = readJson(rel).fixtures[name]
  if (!entry) throw new Error(`${rel} has no fixture named ${name}`)
  if (!entry.barsFrom) throw new Error(`${rel}#${name} carries no barsFrom; this file reads the SHARED series or nothing`)
  const bars = readJson(entry.barsFrom).bars
  if (bars.length !== entry.bar_count) {
    throw new Error(
      `${entry.barsFrom} holds ${bars.length} bars, not the recorded ${entry.bar_count}. `
      + 'That file is the SHARED parity series — every pixel number and every golden '
      + 'indicator fixture measured against it moved too.')
  }
  return bars
})()

/** parse → interpret, the way a user's formula actually travels. */
const col = (source, inputs) => {
  const res = parseFormula(source)
  expect(res.ok, `${source} did not parse: ${res.error}`).toBe(true)
  return interpret(res.ast, BARS, inputs || {})
}

const ast = (source) => {
  const res = parseFormula(source)
  expect(res.ok, `${source} did not parse: ${res.error}`).toBe(true)
  return res.ast
}

const isNaNAt = (c, i) => Number.isNaN(c[i])
const values = (c) => Array.from(c)

/** Mirrors `tools/ast_conformance.py::generate_ast('gen:nest(n)')` in CANONICAL
 *  shape, and builds it ITERATIVELY — a recursive generator would die building
 *  the very input the node budget exists to refuse. */
const nestedSum = (n) => {
  let node = { type: 'num', value: 1 }
  for (let i = 0; i < n; i++) node = { type: 'op', name: '+', args: [{ type: 'num', value: 1 }, node] }
  return node
}
const nestSizeOf = (astFrom) => {
  const m = /^gen:nest\((\d+)\)$/.exec(String(astFrom))
  if (!m) throw new Error(`unknown AST generator spec: ${astFrom}`)
  return Number(m[1])
}

// ═════════════════════════════════════════════════════════════════════════════
// THE TWO ABOUT SAFETY, FIRST
// ═════════════════════════════════════════════════════════════════════════════

describe('the table is closed at the NAME boundary', () => {
  it('an identifier resolves ONLY through hasOwnProperty on a null-prototype scope', () => {
    // ⛔ THE ONE-LINE DIFFERENCE BETWEEN A CLOSED TABLE AND AN OPEN ONE.
    // `scope[name]` finds `toString`, `constructor`, `valueOf` and every other
    // Object.prototype member — and each of them is a FUNCTION, so a bare
    // `scope[name]` turns a word a user typed into a callable.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty',
      '__proto__', 'propertyIsEnumerable', 'globalThis', 'undefined']) {
      const r = parseFormula(name)
      expect(r.ok, `${name} did not even parse — this test would prove nothing`).toBe(true)
      expect(r.ast).toEqual({ type: 'series', name })
      expect(() => interpret(r.ast, BARS, {})).toThrow(/unknown name/)
    }
  })

  it('a resolvable NAME can never be CALLED — names and functions are two dictionaries', () => {
    // ⛔ `escapes.json::unknown_function` names this: "a walker that consulted
    // one union would accept `close(3)`". `close` resolves perfectly as a name
    // and must still be uncallable, and `sma` is callable and must not resolve
    // as a name.
    expect(() => interpret(ast('close(3)'), BARS, {})).toThrow(/unknown function/)
    expect(() => interpret(ast('sma'), BARS, {})).toThrow(/unknown name/)
  })

  it('an input may not shadow a table name, and a non-numeric input is not a name at all', () => {
    // A definition whose input is called `close` is a WIRING defect: silently
    // letting it win would change what every formula on that definition means.
    expect(() => interpret(ast('close'), BARS, { close: 1 })).toThrow(/shadows a table name/)
    expect(() => interpret(ast('close'), BARS, { sma: 1 })).toThrow(/shadows a table name/)
    // …and an input that is a FUNCTION is not seeded, so naming it refuses
    // loudly instead of producing a column of `undefined`.
    expect(() => interpret(ast('evil'), BARS, { evil: () => 1 })).toThrow(/unknown name/)
    // A finite-number input IS a name, and it is a scalar.
    expect(values(col('period', { period: 14 })).every((v) => v === 14)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE JS-SIDE ESCAPE CENSUS — the run Task 2 handed this task by name
// ═════════════════════════════════════════════════════════════════════════════

describe('the escape census, run in the language the corpus was written for', () => {
  // ⭐⭐ TASK 2 RECORDED THIS AS OWED HERE: "the ten cases that die on an
  // incidental Python error are precisely the JS prototype/global reaches, and
  // only `interpret.js` can measure them in the language they were written for."
  // `tools/ast_conformance.py --escapes` runs its guarded census through the
  // PYTHON lane only, so `close.constructor` reaching `Function` is a claim no
  // Python run can make either way. This is that measurement.
  //
  // ⛔ DRIVEN BY `escapes.json`, NEVER BY A LIST RE-TYPED HERE. A second copy of
  // the corpus could agree with itself while disagreeing with the thing Task 6
  // must drive to zero.

  /** Offer one case to the whole pipeline and report WHICH DOOR refused it. */
  const census = () => ESCAPES.cases.map((c) => {
    if (c.astFrom) {
      // No usable source (`1 + (1 + (1 + ... ))` is a prose sketch), so the tree
      // is generated in canonical shape and offered straight to the walker.
      const tree = nestedSum(nestSizeOf(c.astFrom))
      try {
        interpret(tree, BARS, {})
        return { id: c.id, door: 'NONE', detail: 'reached a value' }
      } catch (e) {
        if (e instanceof TableRefusal) return { id: c.id, door: 'interpret', guard: e.guard, message: e.message }
        return { id: c.id, door: 'NONE', detail: `${e.name}: incidental, NOT a refusal` }
      }
    }
    const p = parseFormula(c.source)
    if (!p.ok) {
      return {
        id: c.id,
        door: p.guard === 'parser' ? 'parser' : 'canonicalise',
        guard: p.guard,
        message: p.error,
      }
    }
    try {
      interpret(p.ast, BARS, {})
      return { id: c.id, door: 'NONE', detail: 'reached a value' }
    } catch (e) {
      if (e instanceof TableRefusal) return { id: c.id, door: 'interpret', guard: e.guard, message: e.message }
      return { id: c.id, door: 'NONE', detail: `${e.name}: incidental, NOT a refusal` }
    }
  })

  const ids = (pred) => ESCAPES.cases.filter(pred).map((c) => c.id).sort()

  it('the corpus is big enough to measure anything at all', () => {
    // ⛔ THE NON-VACUITY FLOOR, AND IT IS FIRST. Without it a corpus somebody
    // emptied would satisfy every list equality below by making both sides `[]`,
    // and this file would report a closed table over nothing. Task 3 added the
    // same floor to the Python side (`parsed >= 15`) for the same reason:
    // `escaped == parsed` is satisfied by `0 == 0`.
    expect(ESCAPES.cases.length).toBeGreaterThanOrEqual(16)
    expect(ids((c) => String(c.guard).startsWith('resolve:')).length,
      'the corpus lost the cases THIS task owes; the census below would be vacuous',
    ).toBeGreaterThanOrEqual(5)
    expect(ids((c) => String(c.guard).startsWith('canonicalise:')).length).toBeGreaterThanOrEqual(7)
  })

  it('every `resolve:*` case is refused BY THE INTERPRETER, by its declared guard and fragment', () => {
    // ⭐ THIS IS THE HALF TASK 4 OWES. The `canonicalise:*` cases are `parse.js`'s
    // (Task 3) and the `budget:*` cases are Task 6's; these five are the ones a
    // walker with a scope object either closes or does not.
    const byId = Object.fromEntries(census().map((r) => [r.id, r]))
    const problems = []
    for (const c of ESCAPES.cases) {
      if (!String(c.guard).startsWith('resolve:')) continue
      const r = byId[c.id]
      if (r.door !== 'interpret') { problems.push(`${c.id}: refused by ${r.door}, not the interpreter (${r.detail || r.guard})`); continue }
      if (r.guard !== c.guard) { problems.push(`${c.id}: guard ${r.guard} != declared ${c.guard}`); continue }
      if (!r.message.includes(c.refuse)) {
        problems.push(`${c.id}: message ${JSON.stringify(r.message)} does not carry ${JSON.stringify(c.refuse)}`)
      }
    }
    expect(problems).toEqual([])

    // …and BY NAME, as a LIST rather than a count. A count survives a rename;
    // a list names the case that moved. `(d.plots || [])` answered `[]` for a
    // renamed field on this branch yesterday and voided a whole clause.
    const refusedHere = census().filter((r) => r.door === 'interpret').map((r) => r.id).sort()
    expect(refusedHere).toEqual(ids((c) => String(c.guard).startsWith('resolve:')))
  })

  it('every `canonicalise:*` case never reaches the interpreter — the parse door holds', () => {
    // Not a duplicate of `parse.test.js`: that file asserts `canonicalise` throws.
    // This asserts the SYSTEM is closed — that a user typing `close.constructor`
    // into the box cannot reach a walker at all. "The table is closed" is a claim
    // about the whole path, and the path is what a user actually travels.
    const byId = Object.fromEntries(census().map((r) => [r.id, r]))
    const problems = []
    for (const c of ESCAPES.cases) {
      if (!String(c.guard).startsWith('canonicalise:')) continue
      const r = byId[c.id]
      if (c.parses === false) {
        // `assignment`: jsep core has no `=`, so it never reaches canonicalise.
        if (r.door !== 'parser') problems.push(`${c.id}: declares parses=false but was refused by ${r.door}`)
        continue
      }
      if (r.door !== 'canonicalise') { problems.push(`${c.id}: refused by ${r.door}, not canonicalise`); continue }
      if (r.guard !== c.guard) { problems.push(`${c.id}: guard ${r.guard} != declared ${c.guard}`); continue }
      if (!r.message.includes(c.refuse)) problems.push(`${c.id}: message does not carry ${JSON.stringify(c.refuse)}`)
    }
    expect(problems).toEqual([])
  })

  it('what STILL escapes is exactly the budget guards — recorded, and Task 6 may shrink it', () => {
    // ⚠️ A SUBSET, NOT AN EQUALITY, AND THAT IS DELIBERATE. An equality here
    // would go RED the day Task 6 adds `compute.budget` and closes them — a gate
    // that forbids the fix, which is exactly what `indicatorCatalog.test.js:573`
    // became. A subset lets the number fall to zero and still fails by name the
    // moment a `resolve:*` or `canonicalise:*` case leaks.
    const escaping = census().filter((r) => r.door === 'NONE').map((r) => r.id).sort()
    const budget = ids((c) => String(c.guard).startsWith('budget:'))
    for (const id of escaping) {
      expect(budget, `${id} ESCAPED and its guard is not a budget one — the table leaked`).toContain(id)
    }
    // …and the control that keeps the subset honest: those cases must still be
    // MEASURABLE, i.e. the numbers Task 6 thresholds are computable today.
    expect(budget.length).toBeGreaterThanOrEqual(3)
  })

  it('an incidental error is NOT a refusal, and this file never counts one as one', () => {
    // Task 2's rule, in the lane it was written for: "an `AttributeError`, a
    // `TypeError` or a `RecursionError` is the LANGUAGE declining, incidentally,
    // for this input". Here that is a `RangeError` from a tree deep enough to
    // overflow the stack, and it must land in `NONE`, never in `interpret`.
    const deep = nestedSum(20000)
    let outcome = 'reached a value'
    try { interpret(deep, BARS, {}) } catch (e) {
      outcome = e instanceof TableRefusal ? `REFUSAL:${e.guard}` : e.name
    }
    expect(outcome.startsWith('REFUSAL:'),
      `a stack overflow was reported as a table refusal (${outcome}) — that is the ` +
      'shape that makes a census report a closed table over a walker that crashed',
    ).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE COLUMN CONTRACT
// ═════════════════════════════════════════════════════════════════════════════

describe('the column is the same contract every native produces', () => {
  it('the column is bars.length and NaN-padded — the same contract as every native', () => {
    // `computeFor` returns one Float64Array per key, aligned to bar count and
    // NaN-padded (spec §4); the binder converts NaN to LWC whitespace. A column
    // that is SHORTER silently shifts every index — the exact defect
    // `alert_series.series_for` asserts its way out of.
    const c = col('sma(close, 20)')
    expect(c).toBeInstanceOf(Float64Array)
    expect(c.length).toBe(BARS.length)
    expect(values(c).slice(0, 19).every(Number.isNaN)).toBe(true)
    expect(Number.isNaN(c[19])).toBe(false)

    // ⭐ THE CASE THAT PROVES THE LENGTH COMES FROM `bars`, NOT FROM THE VALUE.
    // A constant formula's value has no length at all, so a `toColumn` that read
    // the value's own length would return an empty (or 1-long) column and every
    // assertion above would still pass.
    const konst = col('20')
    expect(konst.length).toBe(BARS.length)
    expect(values(konst).every((v) => v === 20)).toBe(true)
    expect(col('close > open ? 1 : 0').length).toBe(BARS.length)
  })

  it('NaN PROPAGATES through arithmetic and is FALSE through a comparison', () => {
    // The two rules the Python lane must match exactly. Pinned here first because
    // they are the only places the two languages differ if either lane is written
    // casually — and a fabricated 0 during a 199-bar warmup is a number a user
    // could arm an alert on.
    const sub = col('sma(close, 20) - sma(close, 200)')
    expect(isNaNAt(sub, 100)).toBe(true)                       // NOT 0
    expect(isNaNAt(sub, 198)).toBe(true)
    expect(isNaNAt(sub, 199)).toBe(false)                      // …and it does compute

    const cmp = col('close > sma(close, 200)')
    expect(cmp[100]).toBe(0)                                   // a NaN comparison is false, not NaN
    expect(new Set(values(cmp))).toEqual(new Set([0, 1]))      // never NaN, on any bar
  })

  it('crossOver returns 0, 1 or NaN and NOTHING ELSE', () => {
    // Spec §3.1: events are columns valued {0,1,NaN}, and alerts, the screener and
    // this interpreter all consume that one shape. `nativeRegistry`'s
    // `validateEventColumns` already refuses 0.5 at registration for a native; a
    // formula must not be the way in.
    for (const src of ['crossOver(close, sma(close, 20))', 'crossUnder(ema(close, 9), ema(close, 21))']) {
      const c = col(src)
      const bad = values(c).map((v, i) => [v, i]).filter(([v]) => !(v === 0 || v === 1 || Number.isNaN(v)))
      expect(bad, `${src} produced a value outside {0,1,NaN}`).toEqual([])
      // …and the non-vacuity half: an all-NaN column satisfies the line above.
      expect(values(c).some((v) => v === 1), `${src} never fired on 579 bars`).toBe(true)
      expect(values(c).some((v) => v === 0)).toBe(true)
    }
    // ⛔ `true`/`false` would satisfy "0, 1 or NaN" under `==` but not under
    // `===`, and JSON round-trips them as booleans into the Python lane.
    expect(values(col('crossOver(close, sma(close, 20))')).every((v) => typeof v === 'number')).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TOTALITY — both directions
// ═════════════════════════════════════════════════════════════════════════════

describe('the implementation and the manifest are the same list', () => {
  it('every declared function has an implementation, and every implementation is declared', () => {
    // ⛔ BOTH DIRECTIONS. A declared-but-unimplemented name is a formula the builder
    // offers and the chart cannot draw; an implemented-but-undeclared name is a
    // callable OUTSIDE the closed table, which is the one thing this phase exists
    // to make impossible.
    expect(Object.keys(FN).sort()).toEqual(Object.keys(TABLE.functions).sort())
    expect(Object.keys(FN).length).toBeGreaterThanOrEqual(11)      // non-vacuity
    for (const name of Object.keys(TABLE.functions)) {
      expect(typeof FN[name], `${name} is declared but not callable`).toBe('function')
    }
  })

  it('every declared OPERATOR evaluates, and nothing outside the table does', () => {
    // The same rail for the other dictionary, and it is driven by the manifest —
    // a hand-listed set here would be a third vocabulary.
    const probe = {
      1: (name) => ({ type: 'op', name, args: [{ type: 'num', value: 3 }] }),
      2: (name) => ({ type: 'op', name, args: [{ type: 'num', value: 3 }, { type: 'num', value: 2 }] }),
      3: (name) => ({ type: 'op', name, args: [{ type: 'num', value: 1 }, { type: 'num', value: 3 }, { type: 'num', value: 2 }] }),
    }
    const unimplemented = []
    for (const [name, spec] of Object.entries(TABLE.operators)) {
      try { interpret(probe[spec.arity](name), BARS, {}) } catch (e) { unimplemented.push(`${name}: ${e.message}`) }
    }
    expect(unimplemented).toEqual([])
    expect(Object.keys(TABLE.operators).length).toBeGreaterThanOrEqual(15)
    for (const name of ['**', '%', '&', '|', '^', '<<', '>>', '>>>', '??', '===', '!==', '~']) {
      expect(() => interpret(probe[2](name), BARS, {}), `${name} is not in the table and must not evaluate`)
        .toThrow(/unknown operator/)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE BOOLEAN DECISION, AND WHAT IT COSTS
// ═════════════════════════════════════════════════════════════════════════════

describe('there is no boolean node type, so a condition is a 0/1 column', () => {
  it('`true` and `false` arrive as num 1 / num 0 and stay numbers', () => {
    expect(values(col('true')).every((v) => v === 1)).toBe(true)
    expect(values(col('false')).every((v) => v === 0)).toBe(true)
  })

  it('THE COST, PINNED: `1 && 2` is 1, `0 || 5` is 1, `!5` is 0', () => {
    // ⭐ JS's VALUE-RETURNING `&&`/`||` ARE DELIBERATELY NOT IMPLEMENTED. They
    // would put a non-{0,1} number into a column the alert grammar reads as a
    // signal, and `0 || 5` returning 5 in JS while Python returns 5 too would
    // agree perfectly on a value neither language should be producing here.
    expect(col('1 && 2')[0]).toBe(1)
    expect(col('0 || 5')[0]).toBe(1)
    expect(col('2 && 0')[0]).toBe(0)
    expect(col('!5')[0]).toBe(0)
    expect(col('!0')[0]).toBe(1)
    // truthiness is `x !== 0`, not JS's — a negative number is true
    expect(col('!(-3)')[0]).toBe(0)
  })

  it('NaN PROPAGATES through `&&`, `||`, `!` and `?:` — the opposite of both languages', () => {
    // ⛔ `!NaN` is `true` in JS and `not nan` is `False` in Python: the two
    // languages ALREADY disagree, so this cannot be left to either default. The
    // {0,1,NaN} domain distinguishes "did not happen" from "not computable yet",
    // and a warmup collapsing to 0 is a signal a user can arm an alert on.
    expect(isNaNAt(col('crossOver(close, sma(close, 200)) && 1'), 0)).toBe(true)
    expect(isNaNAt(col('crossOver(close, sma(close, 200)) || 1'), 0)).toBe(true)
    expect(isNaNAt(col('!crossOver(close, sma(close, 200))'), 0)).toBe(true)
    expect(isNaNAt(col('crossOver(close, sma(close, 200)) ? high : low'), 0)).toBe(true)
    // …and the control: once the warmup is over it is a real 0/1 again.
    const c = col('crossOver(close, sma(close, 20)) && 1')
    expect(new Set(values(c).slice(21))).toEqual(new Set([0, 1]))
  })

  it('the ternary selects columns, not scalars, and picks per bar', () => {
    const c = col('close > open ? high : low')
    for (let i = 0; i < BARS.length; i++) {
      expect(c[i]).toBe(BARS[i].c > BARS[i].o ? BARS[i].h : BARS[i].l)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE MEASUREMENTS TASK 6's BUDGETS WILL THRESHOLD
// ═════════════════════════════════════════════════════════════════════════════

describe('maxLookback and nodeCount — measurements, not guards', () => {
  it('maxLookback is a TREE SUM along the path, which is the case a per-argument check misses', () => {
    // `escapes.json::nested_lookback` exists for exactly this: neither 5,000
    // alone exceeds anything, and nothing else in the corpus catches it.
    expect(maxLookback(ast('close'))).toBe(0)
    expect(maxLookback(ast('sma(close, 20)'))).toBe(20)
    expect(maxLookback(ast('sma(close, 20) - sma(close, 200)'))).toBe(200)
    expect(maxLookback(ast('sma(sma(close, 5000), 5000)'))).toBe(10000)
    expect(maxLookback(ast('sma(close, 100000)'))).toBe(100000)
    expect(maxLookback(ast('abs(change(close))'))).toBe(1)
    expect(maxLookback(ast('crossOver(ema(close, 9), ema(close, 21))'))).toBe(22)
  })

  it('a window that is not a whole-number LITERAL is refused, because lookback must stay decidable', () => {
    // ⭐ NOT A CONVENIENCE. `maxLookback(ast)` takes no bars and no inputs; a
    // window that is an input name or a computed column is not decidable
    // statically, and the moment lookback stops being decidable statically Task
    // 7's repaint linter stops being a tree sum. `closedTable.json::_no_offset`
    // refuses that trade on the owner's behalf.
    for (const src of ['sma(close, close)', 'sma(close, 0)']) {
      expect(() => interpret(ast(src), BARS, {}), src).toThrow(/a window must be a whole-number literal/)
      expect(() => maxLookback(ast(src)), src).toThrow(/a window must be a whole-number literal/)
    }
    expect(() => maxLookback(ast('sma(close, period)'))).toThrow(/a window must be a whole-number literal/)
  })

  it('the measurements survive the tree `interpret` itself cannot walk', () => {
    // ⭐⭐ THE ASYMMETRY IS THE POINT. Task 6's guard runs BEFORE the walker and
    // must not need the walker to be safe first, so `nodeCount` and `maxLookback`
    // are ITERATIVE while `interpret` is a plain recursive walker. `parse.js`
    // made its forbidden-node scan iterative for the same reason: a guard that
    // dies inside itself is not a refusal.
    const spec = ESCAPES.cases.find((c) => c.astFrom)
    expect(spec, 'the corpus lost its generated deep-tree case').toBeTruthy()
    const n = nestSizeOf(spec.astFrom)
    const deep = nestedSum(n)
    expect(nodeCount(deep)).toBe(2 * n + 1)
    expect(maxLookback(deep)).toBe(0)
    // …and one deep enough that a recursive counter certainly dies.
    expect(nodeCount(nestedSum(200000))).toBe(400001)
  })

  it('nodeCount counts every node of an ordinary tree', () => {
    expect(nodeCount(ast('close'))).toBe(1)
    expect(nodeCount(ast('sma(close, 20)'))).toBe(3)
    expect(nodeCount(ast('sma(close, 20) - sma(close, 200)'))).toBe(7)
    expect(nodeCount(ast('close > open ? high : low'))).toBe(6)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// REFUSAL HYGIENE
// ═════════════════════════════════════════════════════════════════════════════

describe('the refusals', () => {
  it('every guard this module declares is REACHABLE, and the trigger set is total', () => {
    // ⛔ A GUARD NOBODY CAN TRIGGER IS A COMMENT. Both directions: a declared
    // guard with no trigger fails here, and a trigger for an undeclared guard
    // fails here too — so a new guard cannot be added without a way to fire it.
    const triggers = {
      'resolve:name': () => interpret(ast('toString'), BARS, {}),
      'resolve:function': () => interpret(ast('rugpull(close, 3)'), BARS, {}),
      'resolve:arity': () => interpret(ast('sma(close)'), BARS, {}),
      'resolve:window': () => interpret(ast('sma(close, close)'), BARS, {}),
      'interpret:node': () => interpret({ type: 'member', name: 'x', args: [] }, BARS, {}),
      'interpret:operator': () => interpret({ type: 'op', name: '**', args: [{ type: 'num', value: 2 }, { type: 'num', value: 3 }] }, BARS, {}),
    }
    expect(Object.keys(triggers).sort()).toEqual(Object.keys(REFUSALS).sort())
    for (const [guard, fire] of Object.entries(triggers)) {
      let err = null
      try { fire() } catch (e) { err = e }
      expect(err, `${guard} never fired`).toBeInstanceOf(TableRefusal)
      expect(err.guard, `${guard} fired as ${err && err.guard}`).toBe(guard)
      expect(err.message, `${guard}'s message lost its sentence`).toContain(REFUSALS[guard])
    }
  })

  it('the refusal sentences are pairwise DISJOINT across BOTH modules', () => {
    // ⛔ ACROSS THE UNION, NOT WITHIN THIS FILE. C Task 9 measured a
    // `raises(match=…)` STILL MATCHING with a safety deleted, because two
    // DIFFERENT gates shared a phrase — and here the two gates live in two
    // modules, which is precisely where a within-file check would miss it.
    const all = [...Object.values(PARSE_REFUSALS), ...Object.values(REFUSALS)]
    const overlaps = []
    for (const a of all) for (const b of all) if (a !== b && b.includes(a)) overlaps.push(`${JSON.stringify(a)} in ${JSON.stringify(b)}`)
    expect(overlaps).toEqual([])
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBeGreaterThanOrEqual(15)
  })

  it('a malformed persisted tree refuses; it does not draw a blank line', () => {
    // ⛔ `compute.ast` comes back out of a DATABASE. A walker that returned NaN
    // for a node type it did not know would draw a blank line for a tree nobody
    // authored, and a blank line reads exactly like a warmup.
    for (const bad of [null, 42, 'close', [], { type: 'member', name: 'x' },
      { type: 'op', name: '+', args: null }, { type: 'num', value: 'x' },
      { type: 'num', value: null }]) {
      expect(() => interpret(bad, BARS, {}), JSON.stringify(bad)).toThrow(TableRefusal)
    }
    expect(() => interpret(ast('close'), 'not bars', {})).toThrow(/bars must be an array/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE ARITHMETIC — the numbers the Python lane must reproduce at 1e-9
// ═════════════════════════════════════════════════════════════════════════════

describe('the arithmetic, against hand-computed values', () => {
  const closes = BARS.map((b) => b.c)

  it('sma is the plain mean of the last n closes', () => {
    const c = col('sma(close, 20)')
    for (const i of [19, 100, 300, BARS.length - 1]) {
      const want = closes.slice(i - 19, i + 1).reduce((s, v) => s + v, 0) / 20
      expect(c[i]).toBeCloseTo(want, 12)
    }
  })

  it('stdev is the POPULATION deviation — divisor n, matching computeBB', () => {
    // ⚠️ The corpus calls this out: a population/sample disagreement has the same
    // tree, the same length and the same NaN pad, and shows up only in the number.
    const c = col('stdev(close, 20)')
    const i = 300
    const w = closes.slice(i - 19, i + 1)
    const avg = w.reduce((s, v) => s + v, 0) / 20
    const pop = Math.sqrt(w.reduce((s, v) => s + (v - avg) ** 2, 0) / 20)
    const sample = Math.sqrt(w.reduce((s, v) => s + (v - avg) ** 2, 0) / 19)
    expect(c[i]).toBeCloseTo(pop, 12)
    expect(Math.abs(c[i] - sample)).toBeGreaterThan(1e-9)     // the two really differ here
  })

  it('ema seeds with the SMA of the first full window, like indicators.js::_ema', () => {
    const n = 9
    const k = 2 / (n + 1)
    let prev = closes.slice(0, n).reduce((s, v) => s + v, 0) / n
    const want = [prev]
    for (let i = n; i < closes.length; i++) { prev = prev * (1 - k) + closes[i] * k; want.push(prev) }
    const c = col('ema(close, 9)')
    expect(isNaNAt(c, n - 2)).toBe(true)
    expect(c[n - 1]).toBeCloseTo(want[0], 12)
    expect(c[300]).toBeCloseTo(want[300 - (n - 1)], 12)
  })

  it('highest / lowest / change / abs', () => {
    const highs = BARS.map((b) => b.h)
    const lows = BARS.map((b) => b.l)
    const hi = col('highest(high, 5)')
    const lo = col('lowest(low, 10)')
    expect(hi[100]).toBe(Math.max(...highs.slice(96, 101)))
    expect(lo[100]).toBe(Math.min(...lows.slice(91, 101)))
    const ch = col('change(close)')
    expect(isNaNAt(ch, 0)).toBe(true)
    expect(ch[1]).toBeCloseTo(closes[1] - closes[0], 12)
    const ab = col('abs(change(close))')
    expect(ab[1]).toBeCloseTo(Math.abs(closes[1] - closes[0]), 12)
    expect(values(ab).slice(1).every((v) => v >= 0)).toBe(true)
  })

  it('min / max are ELEMENTWISE over two series and NaN PROPAGATES', () => {
    // ⛔ THE ONE PLACE THE TWO LANGUAGES DIVERGE BY DEFAULT: JS's
    // `Math.max(NaN, x)` is NaN and Python's `max` returns whichever it meets
    // first. Spelled out in the implementation so neither lane inherits its
    // language's luck.
    const c = col('max(min(close, open), low)')
    for (const i of [0, 5, 300]) {
      expect(c[i]).toBe(Math.max(Math.min(BARS[i].c, BARS[i].o), BARS[i].l))
    }
    expect(isNaNAt(col('max(sma(close, 200), close)'), 0)).toBe(true)
    expect(isNaNAt(col('min(sma(close, 200), close)'), 0)).toBe(true)
  })

  it('`<` against a running minimum is FALSE on every bar, and `>=` is true at equality', () => {
    // The cheapest detector of a window boundary that shifted by a bar, and the
    // inclusive comparison a `>`/`>=` slip hides in.
    const strict = col('close < lowest(low, 20)')
    expect(values(strict).filter((v) => v === 1)).toEqual([])
    const inclusive = col('close >= open && close <= high')
    expect(values(inclusive).some((v) => v === 1)).toBe(true)
    expect(values(inclusive).every((v) => v === 0 || v === 1)).toBe(true)
  })

  it('every corpus case evaluates to a full-length column — the conformance log has a subject', () => {
    // ⛔ NON-VACUITY FOR TASK 5. `--record` freezes a per-ast digest over EVERY
    // corpus case; a case this lane cannot evaluate would be frozen as a
    // disagreement or silently dropped. Seventeen sources, seventeen columns.
    expect(CORPUS.cases.length).toBeGreaterThanOrEqual(17)
    const broken = []
    for (const c of CORPUS.cases) {
      try {
        const out = interpret(c.ast, BARS, {})
        if (out.length !== BARS.length) broken.push(`${c.id}: length ${out.length}`)
        if (!values(out).some((v) => !Number.isNaN(v))) broken.push(`${c.id}: entirely NaN`)
      } catch (e) { broken.push(`${c.id}: ${e.message}`) }
    }
    expect(broken).toEqual([])
  })

  it('the committed AST and the parsed source produce the SAME column', () => {
    // The corpus's `ast` is hand-written and its `source` rides alongside. Task 3
    // proved the trees match; this proves the two roads reach the same numbers,
    // which is the only thing a user actually sees.
    for (const c of CORPUS.cases) {
      const fromTree = interpret(c.ast, BARS, {})
      const fromSource = col(c.source)
      expect(values(fromTree), c.id).toEqual(values(fromSource))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PURITY — proven STRUCTURALLY, over this module's own source
// ═════════════════════════════════════════════════════════════════════════════

describe('the interpreter is PURE', () => {
  /** Free (global) identifiers, `Math.random`-shaped member reads, dynamic
   *  imports and import sources — from an AST, never from a grep.
   *
   *  ⛔ A GREP IS NOT A PROOF HERE AND THAT IS MEASURED, NOT ASSUMED: Phase D
   *  Task 1 ran a plain substring grep for its own module and got ten matches,
   *  EVERY ONE of them prose in a comment. This file's header contains the words
   *  `Math.random`, `clock` and `network` — a grep would flag its own warning. */
  const scan = (tree) => {
    const bound = new Set()
    const free = []
    const members = []
    const imports = []
    const findings = []

    const bindPattern = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'Identifier') { bound.add(node.name); return }
      if (node.type === 'ObjectPattern') { for (const p of node.properties) bindPattern(p.value || p.argument); return }
      if (node.type === 'ArrayPattern') { for (const e of node.elements) bindPattern(e); return }
      if (node.type === 'AssignmentPattern') { bindPattern(node.left); return }
      if (node.type === 'RestElement') { bindPattern(node.argument); return }
    }

    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { for (const n of node) walk(n); return }
      if (typeof node.type !== 'string') return

      switch (node.type) {
        case 'ImportDeclaration':
          imports.push(node.source.value)
          for (const s of node.specifiers) bound.add(s.local.name)
          return
        case 'ImportExpression':
          findings.push('dynamic import()')
          walk(node.source)
          return
        case 'VariableDeclarator':
          bindPattern(node.id)
          walk(node.init)
          return
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (node.id) bound.add(node.id.name)
          for (const p of node.params) bindPattern(p)
          walk(node.body)
          return
        case 'ClassDeclaration':
        case 'ClassExpression':
          if (node.id) bound.add(node.id.name)
          walk(node.superClass); walk(node.body)
          return
        case 'CatchClause':
          bindPattern(node.param); walk(node.body)
          return
        case 'MemberExpression':
          if (node.object.type === 'Identifier') members.push(`${node.object.name}.${node.computed ? '[…]' : node.property.name}`)
          walk(node.object)
          if (node.computed) walk(node.property)
          return
        case 'Property':
          if (node.computed) walk(node.key)
          walk(node.value)
          return
        case 'MethodDefinition':
        case 'PropertyDefinition':
          if (node.computed) walk(node.key)
          walk(node.value)
          return
        case 'Identifier':
          free.push(node.name)
          return
        default: break
      }
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
        walk(node[key])
      }
    }
    walk(tree)

    const ALLOWED = new Set([
      'Object', 'Number', 'Math', 'JSON', 'Error', 'Array', 'String', 'Boolean',
      'Float64Array', 'Map', 'Set', 'NaN', 'Infinity', 'undefined', 'arguments',
    ])
    for (const name of new Set(free)) {
      if (!bound.has(name) && !ALLOWED.has(name)) findings.push(`free identifier: ${name}`)
    }
    // ⚠️ AND ONE EXPLICIT CHECK ON TOP OF THE ALLOWLIST, because `Math` is
    // ALLOWED — `Math.min` is arithmetic and `Math.random` is a clock's cousin.
    for (const m of new Set(members)) {
      if (m === 'Math.random' || m === 'Date.now' || m === 'performance.now') findings.push(m)
    }
    return { findings: findings.sort(), imports, bound, free }
  }

  it('NO clock, NO randomness, NO I/O, NO globals — by AST over its own source', async () => {
    const acorn = await import('acorn').catch((e) => {
      // ⛔ A LANE THAT CANNOT BE MEASURED REFUSES; IT NEVER REPORTS ZERO.
      throw new Error(`the purity proof needs a JS parser and \`acorn\` did not import: ${e.message}`)
    })
    const src = fs.readFileSync(SELF, 'utf8')
    expect(src.length).toBeGreaterThan(2000)                    // it really read the module
    const tree = acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module' })
    const got = scan(tree)
    expect(got.findings, 'interpret.js reached something outside pure arithmetic').toEqual([])
    // …and the only thing it may import is the table's own parser module.
    expect(got.imports).toEqual(['./parse.js'])
  })

  it('…and the detector can FAIL — the positive control', async () => {
    // ⛔ WITHOUT THIS, THE CASE ABOVE IS SATISFIED BY `scan = () => ({findings: []})`.
    const acorn = await import('acorn')
    const dirty = `
      import fs from 'node:fs'
      const t = Date.now()
      const r = Math.random()
      export function go() {
        fetch('/api/x')
        window.localStorage.setItem('k', String(t))
        return import('./late.js')
      }
    `
    const got = scan(acorn.parse(dirty, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(got.findings).toContain('Math.random')
    expect(got.findings).toContain('Date.now')
    expect(got.findings).toContain('dynamic import()')
    expect(got.findings).toContain('free identifier: fetch')
    expect(got.findings).toContain('free identifier: window')
    expect(got.findings).toContain('free identifier: Date')
    // `imports` is the STATIC import list; a dynamic `import()` is a finding
    // rather than an import source, because its argument need not be a literal
    // at all — which is exactly why it is banned outright above.
    expect(got.imports).toEqual(['node:fs'])
  })

  it('…and it is pure BEHAVIOURALLY too: same inputs, same column, no side effects', () => {
    // The structural proof says nothing non-deterministic is REACHED; this says
    // the module keeps no state between calls, which is the other half.
    const before = JSON.stringify(BARS)
    const inputs = { period: 14 }
    const a = values(col('sma(close, 20) + 2 * stdev(close, 20)', inputs))
    const b = values(col('sma(close, 20) + 2 * stdev(close, 20)', inputs))
    expect(a).toEqual(b)
    // a different series in between must not leave anything behind
    interpret(ast('sma(close, 5)'), BARS.slice(0, 30), {})
    expect(values(col('sma(close, 20) + 2 * stdev(close, 20)', inputs))).toEqual(a)
    expect(JSON.stringify(BARS)).toBe(before)
    expect(inputs).toEqual({ period: 14 })
    // and the returned column is the caller's — mutating it changes nothing
    const c1 = col('close')
    c1[0] = -999
    expect(col('close')[0]).toBe(BARS[0].c)
  })
})
