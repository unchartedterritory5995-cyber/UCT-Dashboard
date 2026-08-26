import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  parseFormula, TABLE, NODE_TYPES, REFUSALS as PARSE_REFUSALS, RECURRENCES, BAR_READERS,
  SESSION_MAX_BARS,
} from './parse.js'
import {
  interpret, maxLookback, nodeCount, FN, BAR_FN, TableRefusal, REFUSALS,
  MAX_RECURRENCE_STEPS,
} from './interpret.js'
import { computeVWAP, computeAVWAP } from '../../indicators.js'
import { DEFAULT_BUDGET } from './budget.js'

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

/** Every `tools/ast_conformance.py::generate_ast` spec, in CANONICAL shape.
 *
 *  ⚠️ EXTENDED 2026-08-08 AND THE EXTENSION IS THE POINT: `escapes.json` grew a
 *  `gen:seriesChain(9)` case for the third budget cap, and the census helper
 *  below used to call `nestSizeOf` directly — which THREW on the new spec rather
 *  than skipping it. Throwing is the right failure (a case that silently left the
 *  census would take its claim with it), and it is why this is a total function
 *  over the specs rather than a lookup with a default.
 *
 *  ⭐ `gen:seriesChain`'s names come out of the MANIFEST, sorted, exactly as the
 *  Python generator's do — a hand-typed `close` here would keep building a tree
 *  of UNKNOWN names on the day a series is renamed, and an unknown name is
 *  refused by `resolve:name`, at a different door. */
const generatedCanonical = (astFrom) => {
  let m = /^gen:nest\((\d+)\)$/.exec(String(astFrom))
  if (m) return nestedSum(Number(m[1]))
  m = /^gen:seriesChain\((\d+)\)$/.exec(String(astFrom))
  if (m) {
    // ⭐ SERIES *AND* SCALARS, AND DISTINCT — the same change the Python
    // generator and `budget.test.js` made, for the same reason. `seriesRefs`
    // counts DISTINCT reads, so a chain cycling the five bar fields measured five
    // however long it got, and this spec exists to EXCEED a cap of eight. A
    // scalar rides the same `series` node and is a per-symbol column read.
    const names = [...Object.keys(TABLE.series).sort(), ...Object.keys(TABLE.scalars).sort()]
    const want = Number(m[1])
    if (want > names.length) throw new Error(`gen:seriesChain(${want}): the manifest declares ${names.length}`)
    let node = { type: 'series', name: names[0] }
    for (let i = 1; i < want; i++) {
      node = { type: 'op', name: '+', args: [node, { type: 'series', name: names[i] }] }
    }
    return node
  }
  throw new Error(`unknown AST generator spec: ${astFrom}`)
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
      const tree = generatedCanonical(c.astFrom)
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
    //
    // ⚠️ RE-DERIVED 2026-08-08, NOT WIDENED BY HAND. This used to equal the
    // `resolve:*` set alone, because the four `budget:*` cases ESCAPED the
    // interpreter entirely. They no longer do — the budget refuses them at the
    // same door — so the right-hand side is the UNION of the two guard families
    // that live in `interpret.js`, still derived from `escapes.json` and still a
    // list. The `canonicalise:*` cases must stay OUT of it, which is what makes
    // this an equality rather than a superset check.
    const refusedHere = census().filter((r) => r.door === 'interpret').map((r) => r.id).sort()
    expect(refusedHere).toEqual(
      ids((c) => String(c.guard).startsWith('resolve:') || String(c.guard).startsWith('budget:')))
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

  it('NOTHING escapes any more, and every `budget:*` case is refused by ITS OWN guard', () => {
    // 🧨 TIGHTENED 2026-08-08 BY THE BUDGET TASK — the case this replaced said:
    // "what STILL escapes is exactly the budget guards — recorded, and Task 6 may
    // shrink it", and it asserted a SUBSET precisely so it could not forbid its
    // own fix. The number has now fallen to zero, so a subset assertion would be
    // satisfied by an empty list and would assert nothing at all. This is the
    // tightening it left room for.
    const escaping = census().filter((r) => r.door === 'NONE').map((r) => r.id).sort()
    expect(escaping).toEqual([])

    // ⛔ AND THE FLOOR, BECAUSE `escaping === []` IS SATISFIED BY AN EMPTY CORPUS.
    // The budget cases are named as a LIST rather than counted: a count survives
    // a rename, a list names the case that moved.
    const budget = ids((c) => String(c.guard).startsWith('budget:'))
    expect(budget).toEqual(['lookback_too_deep', 'nested_lookback', 'too_many_nodes', 'too_many_series'])

    // …and each is refused BY THE INTERPRETER, by the guard it declares and with
    // the fragment it declares. This is the half that makes the zero above
    // ATTRIBUTABLE: before the budget existed these cases were refused too — at
    // the ROOT, by `interpret:node`, exactly as they would be with no budget in
    // the product at all.
    const byId = Object.fromEntries(census().map((r) => [r.id, r]))
    const problems = []
    for (const c of ESCAPES.cases) {
      if (!String(c.guard).startsWith('budget:')) continue
      const r = byId[c.id]
      if (r.door !== 'interpret') { problems.push(`${c.id}: refused by ${r.door} (${r.detail || r.guard})`); continue }
      if (r.guard !== c.guard) { problems.push(`${c.id}: guard ${r.guard} != declared ${c.guard}`); continue }
      if (!r.message.includes(c.refuse)) problems.push(`${c.id}: message lacks ${JSON.stringify(c.refuse)}`)
    }
    expect(problems).toEqual([])

    // ⛔ AND THE DOORS ARE PLURAL. The defect this replaced was ONE door answering
    // for every case; a "fix" that merely re-pointed that single door would
    // satisfy every equality above except this one.
    const doors = new Set(census().map((r) => r.guard).filter(Boolean))
    expect(doors.size).toBeGreaterThanOrEqual(6)
  })

  it('an incidental error is NOT a refusal, and this file never counts one as one', () => {
    // Task 2's rule, in the lane it was written for: "an `AttributeError`, a
    // `TypeError` or a `RecursionError` is the LANGUAGE declining, incidentally,
    // for this input". Here that is a `RangeError` from a tree deep enough to
    // overflow the stack, and it must NEVER be reported as a refusal.
    //
    // 🧨 RE-DERIVED 2026-08-08, AND THE OLD FORM IS RECORDED RATHER THAN DROPPED.
    // This used to call `interpret(nestedSum(20000), …)` and assert the outcome
    // was not a refusal. `interpret` now runs the node budget FIRST, so that tree
    // is refused as `budget:nodes` before a frame of the walker is entered — the
    // old assertion would have failed on the guard working. And the claim it
    // carried cannot be re-made here at all: a canonical tree's DEPTH never
    // exceeds its node count, and `maxNodes` is 128, so the overflow is now
    // UNREACHABLE through `interpret`. The relabelling defect can be INTRODUCED
    // and never OBSERVED in this lane, which is the shape that rots green.
    //
    // So the claim is asserted in the two places where it still bites, and this
    // case asserts the part that remains observable HERE: the deep tree's refusal
    // is a BUDGET one, carrying the number the measurement read.
    //   * `budget.test.js` walks `budget.js` and `interpret.js` with acorn and
    //     asserts ZERO `try` statements, with a positive control proving the scan
    //     finds a relabelling catch when one exists;
    //   * `tests/test_ast_budget.py` lowers Python's recursion limit so the
    //     overflow is observable again, and asserts `RecursionError` — never a
    //     `TableRefusal` — comes back.
    const deep = nestedSum(20000)
    let outcome = 'reached a value'
    let measured = null
    try { interpret(deep, BARS, {}) } catch (e) {
      outcome = e instanceof TableRefusal ? `REFUSAL:${e.guard}` : e.name
      measured = e.message
    }
    expect(outcome).toBe('REFUSAL:budget:nodes')
    // ⭐ THE NUMBER IS WHAT MAKES IT A MEASUREMENT RATHER THAN A CRASH WEARING A
    // LABEL: a caught `RangeError` could not carry a truthful node count.
    // ⚠️ 20001, NOT 40001, SINCE 2026-08-22: `nodeCount` counts DISTINCT subtrees.
    // `nestedSum` is `1 + (1 + (1 + …))`, so every depth is its own subtree but all
    // 20000 `1` leaves are ONE — hence n+1 rather than 2n+1. The point of the
    // assertion is unchanged: a caught `RangeError` could not carry a truthful count.
    expect(nodeCount(deep)).toBe(20001)
    expect(measured).toContain('measures 20001')
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
    //
    // ⭐ WITH EXACTLY ONE KIND OF EXCEPTION, AND IT IS DERIVED FROM THE MANIFEST
    // RATHER THAN LISTED HERE. An entry that declares a `recurrence` is
    // evaluated by the WALKER — its body is a per-bar expression, not a column,
    // so there is nothing for `FN` to hold. Writing `accum` into an ignore-list
    // here would be a second roster; asking the table which entries are
    // recurrences means a second one needs no edit, and an entry that stopped
    // declaring one would land RED with its own name in the message.
    //
    // ⭐ AND A SECOND KIND, DERIVED THE SAME WAY (2026-08-26). An entry
    // declaring `reads: 'bars'` is handed `interpret`'s own bar array rather
    // than a pack of argument columns, so its implementation lives in `BAR_FN`
    // and not in `FN` — the split is what lets `vwap()` read a real instant
    // where `bindShipped` can only offer a bar index. Same rule as above: the
    // roster is the MANIFEST's, so a third such entry needs no edit here.
    const byWalker = [...Object.keys(RECURRENCES), ...BAR_READERS].sort()
    expect(byWalker.length, 'the exception must be non-empty or this rail widened for nothing')
      .toBeGreaterThan(0)
    expect(BAR_READERS.length, 'the bar-reading exception must be non-empty too')
      .toBeGreaterThan(0)
    const expected = Object.keys(TABLE.functions).filter((n) => !byWalker.includes(n)).sort()
    expect(Object.keys(FN).sort()).toEqual(expected)
    // ⛔ AND `BAR_FN` IS THE OTHER HALF OF THE SAME EQUALITY, both directions: a
    // declared-but-unbound bar reader is a formula the builder offers and the
    // chart cannot draw, and a bound-but-undeclared one is a callable outside
    // the closed table. (`interpret.js` refuses this at IMPORT as well, which is
    // where a wiring defect belongs; this is the rail that names it.)
    expect(Object.keys(BAR_FN).sort()).toEqual([...BAR_READERS].sort())
    for (const name of BAR_READERS) {
      expect(typeof BAR_FN[name], `${name} declares reads:'bars' and is not callable`)
        .toBe('function')
      // …and it EVALUATES, so "declared and bound" cannot quietly mean "bound to
      // something that refuses". The tree is built from the manifest's own
      // arity, with a plausible instant for the one `int` slot the anchor form
      // carries, so a third entry is exercised the day it lands.
      const spec = TABLE.functions[name]
      const args = spec.args.map(() => ({ type: 'num', value: BARS[1].t }))
      const column = interpret({ type: 'call', name, args }, BARS, {})
      expect(column.length, `${name} did not produce a bar-aligned column`).toBe(BARS.length)
    }
    expect(Object.keys(FN).length).toBeGreaterThanOrEqual(11)      // non-vacuity
    for (const name of expected) {
      expect(typeof FN[name], `${name} is declared but not callable`).toBe('function')
    }
    // ⛔ AND THE EXCEPTION IS NOT A HOLE: every walker-evaluated entry must still
    // EVALUATE, or "no implementation" would quietly mean "no behaviour".
    for (const name of Object.keys(RECURRENCES)) {
      const spec = TABLE.functions[name]
      const rec = spec.recurrence
      const args = spec.args.map((kind, i) => (i === rec.warmup
        ? { type: 'num', value: 2 }
        : (i === rec.body
          ? { type: 'op', name: '+', args: [{ type: 'series', name: rec.binds }, { type: 'num', value: 1 }] }
          : { type: 'num', value: 0 })))
      const out = interpret({ type: 'call', name, args }, BARS, {})
      expect(out.length, `${name} is declared, walker-evaluated, and produced nothing`).toBe(BARS.length)
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
    // n + 1 distinct: every nesting depth differs, the `1` leaf is shared.
    expect(nodeCount(deep)).toBe(n + 1)
    expect(maxLookback(deep)).toBe(0)
    // …and one deep enough that a recursive counter certainly dies.
    expect(nodeCount(nestedSum(200000))).toBe(200001)
  })

  it('nodeCount counts every DISTINCT subtree of an ordinary tree', () => {
    // ⭐⭐ DISTINCT, NOT TOTAL, SINCE 2026-08-22. A translated script inlines
    // rather than names — the closed table cannot bind an intermediate — so a
    // pasted indicator repeats the same subexpression many times. Charging a
    // member once per REPEAT bills them for work the interpreter does once.
    expect(nodeCount(ast('close'))).toBe(1)
    expect(nodeCount(ast('sma(close, 20)'))).toBe(3)
    // 6, not 7: two `sma` calls differ, but they SHARE the `close` leaf.
    expect(nodeCount(ast('sma(close, 20) - sma(close, 200)'))).toBe(6)
    expect(nodeCount(ast('close > open ? high : low'))).toBe(6)
  })

  it('⭐ a repeated subtree costs ONCE, and a distinct one still costs', () => {
    // 🔴 THIS IS THE RAIL THAT MAKES THE BUDGET HONEST. `nodeCount` may only
    // discount a repeat because `interpret` MEMOISES on the same ids. If the memo
    // is ever narrowed or removed, this pair is what should go red — the count
    // and the work move together or the budget reports a cost nobody pays.
    const repeated = ast('sma(close, 20) + sma(close, 20) + sma(close, 20)')
    const distinct = ast('sma(close, 20) + sma(close, 21) + sma(close, 22)')
    // both are 11 nodes flat; the repeated one holds far fewer real subtrees
    expect(nodeCount(repeated)).toBeLessThan(nodeCount(distinct))
    // ⛔ AND IT IS NOT COLLAPSING EVERYTHING — a tree of genuinely different
    // subtrees must still be charged for them, or the budget stops bounding.
    expect(nodeCount(distinct)).toBeGreaterThan(6)
  })

  it('⛔ …and structurally different nodes never share an id', () => {
    // A delimiter bug would let `op`+`u-`+`''` collide with `op`+`u`+`-`, and a
    // collision UNDER-counts — the one direction that stops a guard guarding.
    expect(nodeCount(ast('close - open'))).toBe(3)
    expect(nodeCount(ast('close - close'))).toBe(2)
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
      // ⭐ HAND-BUILT, BECAUSE `parseFormula` CANNOT PRODUCE IT. A negative
      // offset is refused at the parse door, so the only way this guard is ever
      // reached is a STORED tree — which is exactly the input it exists for.
      'interpret:offset': () => interpret({ type: 'offset', value: -26, args: [{ type: 'series', name: 'close' }] }, BARS, {}),
      // ⭐ THE RECURRENCE PAIR, AND BOTH ARE REACHED THROUGH A TREE A USER CAN
      // ACTUALLY BUILD. The binding read where nothing binds it is the mistake a
      // translator makes; the step ceiling is the one a member makes by asking
      // for a long warm-up over a long chart.
      'interpret:recurrence': () => interpret(
        { type: 'op', name: '+', args: [{ type: 'series', name: RECURRENCES.accum.binds }, { type: 'num', value: 1 }] },
        BARS, {}),
      'interpret:steps': () => interpret(
        { type: 'call', name: 'accum', args: [
          { type: 'num', value: 0 },
          { type: 'op', name: '+', args: [{ type: 'series', name: RECURRENCES.accum.binds }, { type: 'num', value: 1 }] },
          { type: 'num', value: 500 }] },
        // ⛔ THE BARS ARE MADE HERE RATHER THAN REUSING `BARS`, because this is
        // the ONE guard in this table whose trigger depends on how many bars the
        // caller brought — that is the whole reason it could not live in
        // `budget.js` with the others.
        Array.from({ length: Math.floor(MAX_RECURRENCE_STEPS / 500) + 10 },
          (_, i) => ({ o: 1, h: 2, l: 0.5, c: 1 + (i % 7) * 0.1, v: 1000 })),
        {}),
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
        // ⛔ `c.opts` IS PASSED, AND IT IS THE SAME KEY `tools/ast_conformance.py`
        // READS OFF THE SAME CASE (`case_opts`). The four clock-boolean cases are
        // NOT COMPUTABLE without a timeframe, by design — evaluating them with no
        // `opts` here would land every one of them in `broken` as "entirely NaN"
        // for a reason that is the fail-closed path working, not a defect.
        const out = interpret(c.ast, BARS, {}, undefined, undefined, c.opts || {})
        if (out.length !== BARS.length) broken.push(`${c.id}: length ${out.length}`)
        // ⛔ AN ALL-NaN COLUMN IS STILL A FAILURE *UNLESS THE CASE DECLARES IT*.
        // The domain-refusal cases (sqrt of a negative, log of zero, an overflow,
        // a zero divisor) are the cases where the two languages natively disagree,
        // so they are the most valuable ones in the corpus — and their CORRECT
        // column is all-NaN. The flag is per-case and opt-in precisely so this
        // rail keeps its teeth for the unexpected ones it was written to catch.
        if (!c.allNaN && !values(out).some((v) => !Number.isNaN(v))) {
          broken.push(`${c.id}: entirely NaN`)
        }
        if (c.allNaN && values(out).some((v) => !Number.isNaN(v))) {
          broken.push(`${c.id}: declares allNaN but produced a number`)
        }
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
  const scan = (tree, alsoAllowed = []) => {
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
      // ⛔ `alsoAllowed` IS PER-CALL AND EVERY USE MUST MEASURE WHAT IT ADMITS.
      // A widened allowlist is how a purity claim goes hollow, so the one
      // caller that passes anything asserts BOTH directions: the file is clean
      // WITH the extension, and without it the findings are EXACTLY the names
      // the extension spells. Nothing may be admitted silently.
      ...alsoAllowed,
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
    // …and the only things it may import are the table's own parser module and
    // the budget.
    //
    // ⚠️ WIDENED 2026-08-08, AND WIDENING AN ALLOWLIST IS EXACTLY HOW A PURITY
    // CLAIM GOES HOLLOW: this module's purity is worth nothing if it imports an
    // impure one. So the scan is RUN OVER `budget.js` TOO rather than the entry
    // simply being admitted — the claim is about the closure of the import graph,
    // not about one file. `budget.js` imports only this module back (the declared
    // cycle), so scanning the two closes it.
    expect(got.imports.sort()).toEqual(['../../indicators.js', './budget.js', './parse.js'])
    const budgetSrc = fs.readFileSync(path.join(path.dirname(SELF), 'budget.js'), 'utf8')
    expect(budgetSrc.length).toBeGreaterThan(2000)
    const budgetScan = scan(acorn.parse(budgetSrc, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(budgetScan.findings, 'budget.js reached something outside pure arithmetic').toEqual([])
    // ⭐ `./parse.js` IS THE SAME EDGE `interpret.js` ALREADY DECLARES ABOVE, not a
    // new module in the closure: the budget's lookback cap is derived from the
    // session constant, and that constant is GRAMMAR, so it lives with the table
    // where both the interpreter and the repaint linter can see it. Admitting an
    // edge to a module already inside the scanned set widens nothing.
    expect(budgetScan.imports.sort()).toEqual(['./interpret.js', './parse.js'])

    // ─── AND THE THIRD EDGE, ADDED BY PHASE F, MEASURED THE SAME WAY ────────
    //
    // ⭐ `indicators.js` IS THE CHART'S OWN MATHS AND THE INDICATOR FUNCTIONS
    // BIND TO IT RATHER THAN RESTATING IT — so the closure this case is about
    // now includes it, and admitting the edge without scanning it would be the
    // hollow widening the note above warns against.
    //
    // ⚠️ IT NEEDS EXACTLY TWO NAMES THE BASE ALLOWLIST DOES NOT CARRY, AND
    // BOTH ARE MEASURED RATHER THAN WAVED THROUGH. `Intl.DateTimeFormat` and
    // `new Date(instant)` are how `etDayKey` resolves the ET calendar day per
    // instant from the IANA database — deterministic in the argument, which is
    // the whole property this case is about, and the reason that function reads
    // the zone per instant instead of caching an offset. ⛔ `Date` is admitted
    // as a CONSTRUCTOR ONLY: `Date.now` stays in the explicit member check
    // above, so a real clock reaching this module is still a finding, and the
    // positive control below still requires `free identifier: Date`.
    const INDICATORS = path.join(path.dirname(SELF), '..', '..', 'indicators.js')
    const indicatorsSrc = fs.readFileSync(INDICATORS, 'utf8')
    expect(indicatorsSrc.length).toBeGreaterThan(2000)
    const indicatorsTree = acorn.parse(indicatorsSrc, { ecmaVersion: 2023, sourceType: 'module' })
    const WIDENED_BY = ['Date', 'Intl']
    const indicatorsScan = scan(indicatorsTree, WIDENED_BY)
    expect(indicatorsScan.findings,
      'indicators.js reached something outside pure arithmetic').toEqual([])
    // ⛔ IT IS A LEAF. If it ever imports anything, that import is inside this
    // closure and unscanned, and this case would keep passing.
    expect(indicatorsScan.imports).toEqual([])
    // ⛔ AND THE WIDENING IS EXACTLY WHAT IT CLAIMS. Without the extension the
    // findings must be precisely the two names it spells — no more (or the
    // extension is hiding something) and no fewer (or it is admitting a name
    // the file does not even use, which is a licence nobody measured).
    expect(scan(indicatorsTree).findings)
      .toEqual(WIDENED_BY.map((n) => `free identifier: ${n}`).sort())
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

// ═════════════════════════════════════════════════════════════════════════════
// THE BOUNDED BACKWARD OFFSET — the left edge, and the tree sum
// ═════════════════════════════════════════════════════════════════════════════

describe('the bounded backward offset, evaluated', () => {
  it('🔴 THE LEFT EDGE IS NOT COMPUTABLE — never 0, never the first bar', () => {
    // ⭐⭐ THE DEFINING RULE OF THIS ENGINE, AND THE EXACT DEFECT CLASS IT SPENT
    // A WEEK REMOVING: `close > sma(close, 300)` on 200 bars returning 200
    // confident `0.0`s. `close[3]` on bars 0, 1 and 2 has no bar to read. A
    // clamp to `src[0]` or a fill of `0` would both draw a confident answer to a
    // question the data cannot answer — and a user can arm an alert on it.
    const c = col('close[3]')
    expect(c.length).toBe(BARS.length)
    for (const i of [0, 1, 2]) {
      expect(Number.isNaN(c[i]), `bar ${i} must be NOT COMPUTABLE, got ${c[i]}`).toBe(true)
    }
    expect(c[3]).toBe(BARS[0].c)
    expect(c[10]).toBe(BARS[7].c)
    // ⛔ AND THE PAD IS NOT ZERO AND NOT THE FIRST CLOSE, said as two separate
    // assertions because those are two different wrong answers.
    expect(c[0]).not.toBe(0)
    expect(c[0]).not.toBe(BARS[0].c)
  })

  it('...and a comparison over the left edge does NOT become a confident answer', () => {
    // The half that actually reaches a user: `_cmp` answers 0 when either side
    // is NaN, which is right for a warmup and wrong for a bar that does not
    // exist. The GUARD against that is `maxLookback`, so the number the caller
    // needs is the one below — this pins that it is not zero.
    expect(maxLookback(ast('close > close[3]'))).toBe(3)
  })

  it('`x[0]` shifts nothing and pads nothing', () => {
    const zero = values(col('close[0]'))
    expect(zero).toEqual(values(col('close')))
  })

  it('⭐ maxLookback IS STILL A TREE SUM, and it composes under nesting', () => {
    // ⚠️ THE NUMBERS ARE THE MANIFEST'S CONVENTION, NOT ARITHMETIC THIS FILE
    // CHOSE: `sma(x, 20)` declares `lookback: "arg1"`, so its own window is 20
    // and the offset ADDS to it.
    expect(maxLookback(ast('close[3]'))).toBe(3)
    expect(maxLookback(ast('close[0]'))).toBe(0)
    expect(maxLookback(ast('sma(close[2], 20)'))).toBe(22)
    expect(maxLookback(ast('sma(close, 20)[2]'))).toBe(22)
    expect(maxLookback(ast('sma(close[5], 20)'))).toBe(25)
    // the MAX along an operator, the SUM along a path
    expect(maxLookback(ast('close[1] > close[3]'))).toBe(3)
    expect(maxLookback(ast('sma(close, 20)[2] - ema(close, 50)[1]'))).toBe(51)
    // three levels
    expect(maxLookback(ast('sma(ema(close[1], 5)[2], 20)'))).toBe(28)
  })

  it('⭐ THE BUDGET IS THE CEILING, AND IT IS THE ONE THAT ALREADY EXISTED', () => {
    // ⛔ NO SECOND LIMIT. `close[100000]` is a well-formed backward offset — the
    // parse door has no ceiling of its own on purpose — and what refuses it is
    // `budget:lookback`, because the offset is counted by the same tree sum
    // `sma(close, 600)` is. Two ways of asking for 600 bars of warmup meet one
    // cap, which is the only arrangement in which they cannot drift apart.
    expect(maxLookback(ast('close[100000]'))).toBe(100000)
    let err = null
    try { col('close[100000]') } catch (e) { err = e }
    expect(err).toBeInstanceOf(TableRefusal)
    expect(err.guard).toBe('budget:lookback')
    // and a deep tree is still bounded through the offset.
    //
    // ⚰️ THE PAIR WAS `close[400]` + a 200 window — a hand-typed 600 chosen to
    // clear a cap of 550. When the cap moved to hold one ET session the pair
    // stopped tripping it and this line went GREEN while measuring nothing, which
    // is the identical defect the note below already records one boundary later.
    // Both halves are derived from the cap now, and each is asserted UNDER it so
    // the COMPOSITION is what refuses.
    const capForDeep = DEFAULT_BUDGET.maxLookback
    const off = capForDeep - 100
    const win = 200
    expect(off + win).toBeGreaterThan(capForDeep)
    expect(Math.max(off, win)).toBeLessThanOrEqual(capForDeep)
    let deep = null
    try { col(`sma(close[${off}], ${win})`) } catch (e) { deep = e }
    expect(deep?.guard).toBe('budget:lookback')
    // ⛔ THE BOUNDARY IS DERIVED FROM THE CAP, NOT RETYPED BESIDE IT. This read
    // `close[499]` / `close[501]` against a hard-coded 500, so when the cap moved
    // to 550 the "one over" case sat 49 bars INSIDE it and the test passed while
    // proving nothing. A boundary written as a literal stops being a boundary the
    // moment the thing it bounds moves.
    const cap = DEFAULT_BUDGET.maxLookback
    expect(() => col(`close[${cap - 1}]`)).not.toThrow()
    let over = null
    try { col(`close[${cap + 1}]`) } catch (e) { over = e }
    expect(over?.guard).toBe('budget:lookback')
  })

  it('a STORED negative offset is refused by the interpreter, not clamped', () => {
    // ⛔ THE PARSE DOOR CANNOT PRODUCE THIS. A stored tree is user data that
    // never went through `canonicalise`, and clamping `-26` to `0` would draw a
    // confident wrong column instead of refusing a forward reference.
    for (const bad of [-1, -26, 1.5, '3', null, true]) {
      let err = null
      try {
        interpret({ type: 'offset', value: bad, args: [{ type: 'series', name: 'close' }] }, BARS, {})
      } catch (e) { err = e }
      expect(err, `offset value ${JSON.stringify(bad)} was ACCEPTED`).toBeInstanceOf(TableRefusal)
      expect(err.guard).toBe('interpret:offset')
    }
  })

  it('a STORED offset with the wrong child count is refused too', () => {
    for (const args of [[], [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }]]) {
      let err = null
      try { interpret({ type: 'offset', value: 1, args }, BARS, {}) } catch (e) { err = e }
      expect(err?.guard).toBe('interpret:offset')
    }
  })

  it('the child is ANY expression — a call, a condition, a scalar', () => {
    // A CALL RESULT: `sma(close,20)[2]` reads the mean of [i-21, i-2].
    const shifted = col('sma(close, 20)[2]')
    const plain = col('sma(close, 20)')
    expect(Number.isNaN(shifted[0])).toBe(true)
    expect(shifted[30]).toBe(plain[28])

    // A CONDITION: still 0/1, and NOT COMPUTABLE before the bar exists.
    const cond = col('(close > open)[1]')
    expect(Number.isNaN(cond[0])).toBe(true)
    expect(values(cond).slice(1).every((v) => v === 0 || v === 1)).toBe(true)

    // A SCALAR broadcasts and THEN shifts — ⛔ the pad is NOT the scalar,
    // because "yesterday's market cap" is a value this table does not hold.
    const scal = interpret(ast('market_cap[1]'), BARS, {}, undefined, { market_cap: 1e9 })
    expect(Number.isNaN(scal[0])).toBe(true)
    expect(scal[1]).toBe(1e9)
  })

  it('NaN PROPAGATES through the shift rather than being filled', () => {
    // The warmup of the child must still read as a hole after the shift — a
    // shift that dropped NaNs would make a 20-bar mean look available 20 bars
    // early, which is the same lie one door along.
    const c = col('sma(close, 20)[2]')
    for (let i = 0; i < 21; i++) expect(Number.isNaN(c[i]), `bar ${i}`).toBe(true)
    expect(Number.isNaN(c[21])).toBe(false)
  })

  it('the offset counts toward the node budget like every other node', () => {
    expect(nodeCount(ast('close[1]'))).toBe(2)
    // 3, not 4: the offset is its own subtree, but both `close` reads are ONE.
    expect(nodeCount(ast('close - close[1]'))).toBe(3)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 🔴🔴 THE BUDGET AND THE MEMO MOVE TOGETHER, OR THE BUDGET LIES
// ═════════════════════════════════════════════════════════════════════════════
//
// `nodeCount` discounts a repeated subtree. That is honest ONLY because
// `interpret` memoises on the same ids and therefore computes it once. Delete
// the memo and the count keeps discounting — a budget under-reporting real cost
// is a guard that has stopped guarding, and NOTHING ELSE IN THIS SUITE NOTICES:
// the memo is a pure speed-up, so every behavioural test stays green without it.
//
// ⛔ A SOURCE RAIL, DELIBERATELY. There is no runtime seam that counts
// evaluations, and inventing one would put a second authority on "did the memo
// run". This reads the shipped file — the same idiom as `singleWriterIndex` —
// and fails when the wiring is cut.
describe('the node budget may only discount what the interpreter actually shares', () => {
  // ⛔ `SELF`, not a second path literal — this suite already owns that value.
  const SRC = fs.readFileSync(SELF, 'utf8')

  it('🔴 `nodeCount` counts DISTINCT subtrees via the shared walk', () => {
    expect(SRC).toMatch(/export function nodeCount[\s\S]{0,200}?structuralMaps\(ast\)\.distinct/)
  })

  it('🔴 …and `interpret` memoises on the ids from that SAME walk', () => {
    // the memo must key off `idOf` (identity from structuralMaps), not off
    // anything it computes for itself
    expect(SRC).toMatch(/const \{ idOf, freeOf \} = structuralMaps\(ast\)/)
    expect(SRC).toMatch(/const id = freeOf\.get\(n\) \? idOf\.get\(n\) : undefined/)
    expect(SRC).toMatch(/if \(id !== undefined && memo\.has\(id\)\) return memo\.get\(id\)/)
    expect(SRC).toMatch(/if \(id !== undefined\) memo\.set\(id, value\)/)
  })

  it('⛔ …and the walk refuses to invent an id for a child it has not keyed', () => {
    // The first version of this walk pushed a placeholder instead, and a 128-deep
    // chain collapsed to TWO distinct shapes — `nodeCount` answered 2. Silent
    // fallback = under-count = the one direction that stops a budget guarding.
    expect(SRC).toMatch(/throw new Error\('structuralMaps: a child was keyed after its parent/)
  })
})
// ══════════════════════════════════════════════════════════════════════════════
// `avwap`'s TWO DECLARED-WINDOW REFUSALS — THIS LANE'S HALF
// ══════════════════════════════════════════════════════════════════════════════
//
// ⛔ WRITTEN TWICE ON PURPOSE, here and in `tests/test_ast_vwap_parity.py`, the
// same arrangement `outOfOrder` / `_functions_domain` already has. The
// conformance corpus can only reach ONE of these two rules — it holds 579 bars
// and the other needs a series longer than a session — so a single-lane rail
// would leave the second free to drift, which is exactly the shape this lane has
// already paid three fix rounds for.

describe("`avwap`'s window is ENFORCED, not merely declared", () => {
  const avwap = (epoch) => ({ type: 'call', name: 'avwap', args: [{ type: 'num', value: epoch }] })
  const finite = (c) => [...c].filter((v) => Number.isFinite(v))

  it('⛔ an anchor BEFORE the first bar is NOT COMPUTABLE, never request-dependent', () => {
    // With the anchor before the series, "the first bar at or after it" is
    // whichever bar the caller happened to fetch — so the value moves when the
    // window moves. The control below is what makes this a measurement: the
    // shipped accumulator, called directly, really does answer differently on
    // two slices of the same tape.
    const before = BARS[0].t - 1
    expect(finite(interpret(avwap(before), BARS, {}))).toHaveLength(0)
    // …and exactly ON the first bar is refused too: `t >= anchor` is satisfied by
    // bar 0 whether or not earlier bars existed, so the boundary is not VISIBLE.
    expect(finite(interpret(avwap(BARS[0].t), BARS, {}))).toHaveLength(0)

    const full = computeAVWAP(BARS, before)
    const short = computeAVWAP(BARS.slice(2), before)
    expect(full[full.length - 1].value, 'the accumulator is not request-dependent on this fixture '
      + '— the refusal above is defending against nothing')
      .not.toBeCloseTo(short[short.length - 1].value, 9)

    // NON-VACUITY: the same call with a VISIBLE boundary answers.
    expect(finite(interpret(avwap(BARS[1].t), BARS, {})).length).toBeGreaterThan(0)
  })

  it('⛔ a bar past `sessionMaxBars` from the anchor is NOT COMPUTABLE', () => {
    // ⭐ THE DECLARED PROPERTY IS MADE TRUE RATHER THAN ASSERTED. `sessionMaxBars`
    // is far longer than any fixture in this file, which is why this case builds
    // its own series: a ceiling that cannot be reached is not a ceiling.
    const n = SESSION_MAX_BARS + 40
    const bars = Array.from({ length: n }, (_, i) => ({
      t: BARS[0].t + i * 300, o: 10, h: 11, l: 9, c: 10 + (i % 3), v: 100 + i,
    }))
    const anchor = bars[5].t
    const column = interpret(avwap(anchor), bars, {})
    expect(column).toHaveLength(n)
    expect(Number.isFinite(column[4]), 'a bar BEFORE the anchor must not answer').toBe(false)
    expect(Number.isFinite(column[5]), 'the anchor bar must answer').toBe(true)
    const last = 5 + SESSION_MAX_BARS
    expect(Number.isFinite(column[last]), 'the last bar INSIDE the window must answer').toBe(true)
    expect(Number.isFinite(column[last + 1]), 'a bar PAST the window must not answer').toBe(false)
    expect(finite(column.slice(last + 1))).toHaveLength(0)
    // NON-VACUITY: the trim is real — the shipped accumulator on its own keeps
    // answering all the way to the end, so this is a bound and not a coincidence.
    const raw = computeAVWAP(bars, anchor)
    expect(Number.isFinite(raw[raw.length - 1].value)).toBe(true)
  })

  it('⭐ and `vwap()` is the SHIPPED accumulator, bar for bar — not a second one', () => {
    const got = interpret({ type: 'call', name: 'vwap', args: [] }, BARS, {})
    const want = computeVWAP(BARS)
    expect(got).toHaveLength(BARS.length)
    for (let i = 0; i < BARS.length; i++) {
      const w = want[i] && Number.isFinite(want[i].value) ? want[i].value : NaN
      if (Number.isNaN(w)) expect(Number.isFinite(got[i]), String(i)).toBe(false)
      else expect(got[i], String(i)).toBeCloseTo(w, 9)
    }
    expect(finite(got).length).toBeGreaterThan(0)
  })
})
