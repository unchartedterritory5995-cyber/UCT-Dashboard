// ⭐ THE GATE IS A PROPERTY, NOT A SET OF EXAMPLES. A one-way builder is exactly
// TC2000's PCF seam: you can build in the UI or write the formula, and they
// diverge. The round trip IS the product claim, so it is measured over a
// GENERATED corpus whose coverage of the manifest is itself a gate.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse as parseJs } from 'acorn'
import { parseFormula, astHash, TABLE } from '../engine/ast/parse'
import {
  toSource, fromAst, fromSource, canonicalPicker, isCanonical, vocabulary, REFUSALS,
} from './criteria'

/** The repo root, found by walking up — the helper every fixture-driven test in
 *  this tree uses, and it THROWS BY NAME rather than defaulting, because a
 *  helper that returned a default would make every case below read nothing. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`criteria.test: could not find the repo root from ${process.cwd()}`)
})()

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const MUST_REFUSE = readJson('tests/fixtures/criteria/must_refuse.json')
const CRITERIA_REL = 'app/src/components/chart/builder/criteria.js'

const VOCAB = vocabulary(TABLE)

/** A seeded PRNG. ⛔ NOT Math.random: a property test that generates a different
 *  corpus on every run cannot be re-run against a failure, and a flake in a gate
 *  this load-bearing would be triaged as noise. */
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * ⛔ THE CORPUS IS THE SET OF PICKERS THE UI CAN PRODUCE, AND NOTHING ELSE.
 *
 * Two shapes are deliberately NOT generated, and both are absences the fixtures
 * assert from the other side:
 *
 *   * a NESTED CALL (`sma(sma(close, 5), 5)`). `fromAst` refuses it at
 *     `picker:term` — `must_refuse.json` case 7 — so generating one would make
 *     the identity property assert that a refusal round-trips.
 *   * a nested group carrying its PARENT's join. `canonicalPicker` flattens it
 *     by definition, so it is not a canonical picker and the invariant below
 *     would be false for a shape no UI can reach. The required join is therefore
 *     threaded DOWN rather than patched on afterwards.
 */
function genCorpus(seed, n) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const names = [...VOCAB.series, ...VOCAB.scalars]
  const fns = [...VOCAB.functions.keys()]
  const cmps = [...VOCAB.comparators]
  const other = (join) => (join === 'and' ? 'or' : 'and')

  const term = () => {
    const roll = r()
    if (roll < 0.35) return { t: 'name', name: pick(names) }
    if (roll < 0.55) return { t: 'num', value: Math.floor(r() * 400) }
    const name = pick(fns)
    const spec = VOCAB.functions.get(name)
    return {
      t: 'call',
      name,
      args: spec.args.map((kind) => (kind === 'int'
        ? { t: 'num', value: 2 + Math.floor(r() * 50) }
        : { t: 'name', name: pick(names) })),
    }
  }
  const row = () => ({ kind: 'row', left: term(), cmp: pick(cmps), right: term() })
  const group = (depth, join) => {
    const k = 2 + Math.floor(r() * 3)
    const children = []
    for (let i = 0; i < k; i += 1) {
      children.push(depth > 0 && r() < 0.3 ? group(depth - 1, other(join)) : row())
    }
    return { kind: 'group', join, children }
  }
  return Array.from({ length: n }, () => group(2, r() < 0.5 ? 'and' : 'or'))
}

const CORPUS = genCorpus(0xE4E4, 400)

const ROW_A = { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } }
const ROW_B = { kind: 'row', left: { t: 'name', name: 'high' }, cmp: '>', right: { t: 'num', value: 3 } }
const ROW_C = { kind: 'row', left: { t: 'name', name: 'low' }, cmp: '<', right: { t: 'num', value: 9 } }

describe('the corpus is not vacuous', () => {
  // ⛔ DERIVED FROM THE MANIFEST. Hand-listing what a corpus covers is how DPC's
  // four constants rode unpinned for the rule's entire life.
  it('every declared name the picker offers appears in at least one case', () => {
    const seen = new Set()
    const walkTerm = (t) => {
      if (t.t === 'name') seen.add(t.name)
      if (t.t === 'call') { seen.add(t.name); t.args.forEach(walkTerm) }
    }
    const walk = (n) => {
      if (n.kind === 'group') return n.children.forEach(walk)
      if (n.kind === 'row') { seen.add(n.cmp); [n.left, n.right].forEach(walkTerm) }
      return undefined
    }
    CORPUS.forEach(walk)
    const declared = [...VOCAB.series, ...VOCAB.scalars, ...VOCAB.functions.keys(), ...VOCAB.comparators]
    expect(declared.length, 'the vocabulary itself is empty — this census would pass on nothing').toBeGreaterThan(50)
    const missing = declared.filter((n) => !seen.has(n))
    expect(missing, 'raise the corpus size or the generator is not reaching these').toEqual([])
  })

  it('and the corpus contains both joins and at least one nested group', () => {
    const joins = new Set(); let nested = 0
    const walk = (n, d) => {
      if (n.kind !== 'group') return
      joins.add(n.join); if (d > 0) nested += 1
      n.children.forEach((c) => walk(c, d + 1))
    }
    CORPUS.forEach((c) => walk(c, 0))
    expect([...joins].sort()).toEqual(['and', 'or'])
    expect(nested).toBeGreaterThan(0)
  })
})

describe('picker -> AST -> picker is the IDENTITY', () => {
  it.each(CORPUS.map((p, i) => [i, p]))('case %i', (_i, picker) => {
    const src = toSource(picker)
    const parsed = parseFormula(src)
    expect(parsed.ok, `${src} did not parse: ${parsed.error}`).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, `${src} could not be read back: ${back.reason}`).toBe(true)
    expect(back.group).toEqual(picker)
  })
})

describe('AST -> picker -> AST is the identity ON THE TREE', () => {
  // ⭐ THE HALF THAT CATCHES A LOST PARENTHESIS. `a && b || c` parses as
  // `(a && b) || c`; a picker that flattened mixed joins, or a spelling that
  // dropped the parentheses, produces a DIFFERENT tree that still round-trips
  // through the picker. Only the hash sees it.
  it.each(CORPUS.map((p, i) => [i, p]))('case %i', (_i, picker) => {
    const ast = parseFormula(toSource(picker)).ast
    const back = fromAst(ast, VOCAB)
    const again = parseFormula(toSource(back.group)).ast
    expect(astHash(again)).toBe(astHash(ast))
  })
})

describe('the picker shape is CANONICAL, and non-canonical is reported', () => {
  it('every generated case is already canonical', () => {
    CORPUS.forEach((p) => expect(isCanonical(p)).toBe(true))
  })
  it('a same-join nested group is NOT canonical, and canonicalPicker flattens it', () => {
    // The positive control for the invariant above. Without it, `isCanonical`
    // returning `true` unconditionally passes the whole block.
    const bad = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'group', join: 'and', children: [ROW_A, ROW_B] }, ROW_C],
    }
    expect(isCanonical(bad)).toBe(false)
    expect(canonicalPicker(bad)).toEqual(
      { kind: 'group', join: 'and', children: [ROW_A, ROW_B, ROW_C] })
    expect(isCanonical(canonicalPicker(bad))).toBe(true)
  })
  it('and the flattened form spells the SAME TREE as the nested one', () => {
    // ⛔ THE REASON FLATTENING IS SAFE HERE AND NOT ACROSS JOINS, MEASURED. Same
    // join: one tree. Mixed joins: two different trees — which is why `absorb`
    // tests the operator name.
    const bad = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'group', join: 'and', children: [ROW_A, ROW_B] }, ROW_C],
    }
    const mixed = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'group', join: 'or', children: [ROW_A, ROW_B] }, ROW_C],
    }
    const h = (p) => astHash(parseFormula(toSource(p)).ast)
    expect(h(bad)).toBe(h(canonicalPicker(bad)))
    expect(h(mixed)).not.toBe(h(bad))
  })
})

describe('fromAst REFUSES what it cannot show, BY NAME, and never approximates', () => {
  it('the must-refuse corpus is non-empty and every case PARSES first', () => {
    // ⛔ A case the PARSER rejects proves nothing about the picker — the escape
    // corpus learned this in Phase D and the same rule applies here.
    expect(MUST_REFUSE.length).toBeGreaterThan(5)
    MUST_REFUSE.forEach((c) => expect(parseFormula(c.source).ok, c.source).toBe(true))
  })

  it('and every case names a guard the module actually declares', () => {
    // Without this a typo in the fixture (`picker:nodes`) would assert against a
    // guard nothing can ever produce and the case would look strict while
    // proving nothing but "it refused with something".
    MUST_REFUSE.forEach((c) => expect(Object.keys(REFUSALS), c.source).toContain(c.guard))
    expect(new Set(MUST_REFUSE.map((c) => c.guard)).size).toBeGreaterThan(2)
  })

  it.each(MUST_REFUSE.map((c) => [c.source, c.guard]))('%s -> %s', (source, guard) => {
    const res = fromAst(parseFormula(source).ast, VOCAB)
    expect(res.ok).toBe(false)
    expect(res.guard).toBe(guard)
    expect(res.group, 'a refusal must not hand back a partial picker').toBeUndefined()
  })

  it('a refusal inside ONE ROW refuses the WHOLE picker — no partial reconstruction', () => {
    // ⭐ M1, ASSERTED FROM THE OTHER SIDE. A `fromAst` that dropped the child it
    // could not show would return `ok: true` with two rows here, and every
    // must-refuse case above would still pass because their refusal is at the
    // TOP. This is the case that sees a lossy reconstruction.
    const src = '((close > open) && (sma(sma(close, 5), 5) > 1)) && (high > low)'
    expect(parseFormula(src).ok).toBe(true)
    const res = fromAst(parseFormula(src).ast, VOCAB)
    expect(res.ok).toBe(false)
    expect(res.guard).toBe('picker:term')
    expect(res.group).toBeUndefined()
  })

  it('every refusal sentence is DISJOINT from every other', () => {
    // C Task 9's M1: two gates sharing a phrase let `raises(match=…)` pass with
    // the safety deleted. The same trap exists for a `guard` a test asserts on.
    const words = Object.values(REFUSALS).map((s) => new Set(s.split(/\W+/).filter((w) => w.length > 4)))
    expect(words.length).toBeGreaterThan(3)
    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        const shared = [...words[i]].filter((w) => words[j].has(w))
        expect(shared.length, `refusals ${i} and ${j} share ${shared}`).toBeLessThan(3)
      }
    }
  })

  it('`picker:comparator` is REACHABLE and not a dead entry in the table', () => {
    // A refusal nothing can produce is a sentence pretending to be a gate. This
    // narrows the OFFERED set without touching the manifest, which is exactly
    // what a caller handing its own vocabulary does.
    const narrowed = { ...VOCAB, comparators: new Set([...VOCAB.comparators].filter((c) => c !== '>')) }
    expect(narrowed.comparators.size).toBe(VOCAB.comparators.size - 1)
    const res = fromAst(parseFormula('close > open').ast, narrowed)
    expect(res.ok).toBe(false)
    expect(res.guard).toBe('picker:comparator')
  })
})

describe('the comparator set is DERIVED from `yields`, and its absence is a REFUSAL', () => {
  // ⛔ CORRECTION 2. A hand-list here is the second grammar the closed table
  // exists to prevent, and it would be the SAME hand-list E-5 would write in
  // Python — `williams_r` vs `williamsR`, one layer up.
  it('vocabulary() throws rather than falling back when `yields` is absent', () => {
    const stripped = JSON.parse(JSON.stringify(TABLE))
    Object.values(stripped.operators).forEach((s) => { delete s.yields })
    expect(() => vocabulary(stripped)).toThrow(/comparator/i)
  })

  it('a PLANTED `yields` moves an operator INTO the comparator set with no edit here', () => {
    // ⭐ E-2's M5/M5b, from the behavioural side. `+` is not a comparator today;
    // declaring it `bool` must make the picker offer it, and it must make
    // `fromAst` read `close + open` as a ROW rather than refusing it.
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.operators['+'].yields = 'bool'
    const v = vocabulary(planted)
    expect(VOCAB.comparators.has('+')).toBe(false)
    expect(v.comparators.has('+')).toBe(true)
    const res = fromAst(parseFormula('close + open').ast, v)
    expect(res.ok).toBe(true)
    expect(res.group.children[0].cmp).toBe('+')
  })

  it('and a REMOVED `yields` takes one back OUT, refusing what it used to read', () => {
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.operators['>='].yields = 'num'
    const v = vocabulary(planted)
    expect(VOCAB.comparators.has('>=')).toBe(true)
    expect(v.comparators.has('>=')).toBe(false)
    expect(fromAst(parseFormula('close >= open').ast, v).guard).toBe('picker:not-a-condition')
  })

  it('a PLANTED SCALAR is offered and read back, with no edit here', () => {
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.scalars.uct_planted_probe = {
      source: { store: 'screener_rows', column: 'uct_planted_probe' },
      as_of: { column: 'snapshot_date', grain: 'date' },
      cadence: 'nightly', yields: 'num', sentence: 'the planted probe',
    }
    const v = vocabulary(planted)
    expect(VOCAB.scalars.has('uct_planted_probe')).toBe(false)
    expect(v.scalars.has('uct_planted_probe')).toBe(true)
    const res = fromAst(parseFormula('uct_planted_probe > 4').ast, v)
    expect(res.ok).toBe(true)
    expect(res.group.children[0].left).toEqual({ t: 'name', name: 'uct_planted_probe' })
    // …and the shipped vocabulary still refuses it, so the planted table is
    // demonstrably what made the difference.
    expect(fromAst(parseFormula('uct_planted_probe > 4').ast, VOCAB).guard).toBe('picker:term')
  })

  it('the joins and the comparators PARTITION the arity-2 boolean operators', () => {
    // ⛔ NO COUNT AND NO NAME. The identity is what a hand-list cannot satisfy
    // by accident, and it moves with the manifest.
    const joins = new Set(VOCAB.joins.values())
    expect(joins.size).toBe(2)
    expect([...joins].every((n) => VOCAB.boolBinary.has(n))).toBe(true)
    expect([...VOCAB.comparators].every((n) => VOCAB.boolBinary.has(n))).toBe(true)
    expect([...VOCAB.comparators].some((n) => joins.has(n))).toBe(false)
    expect(VOCAB.comparators.size + joins.size).toBe(VOCAB.boolBinary.size)
    // and every offered function is a TERM-valued one — a `bool` function is a
    // condition wearing a term's clothes and `must_refuse.json` fates it.
    expect([...VOCAB.functions.keys()].every((n) => TABLE.functions[n].yields !== 'bool')).toBe(true)
  })
})

describe('⭐ THE SOURCE RAIL — this module SPELLS NO NAME THE TABLE DECLARES', () => {
  // ⛔ THE HALF NO BEHAVIOURAL TEST CAN SEE. E-2 measured it (M5 vs M5b): a
  // hand-list that REPLACES a derivation is behavioural and the planted-manifest
  // cases above catch it. A hand-list that AGREES WITH TODAY'S MANIFEST and
  // merely shadows the derivation is invisible to every one of them — its only
  // possible killer is an AST walk of the source. Plan-review #13 found exactly
  // this shape in an earlier `vocabulary()` that subtracted `'&&'` and `'||'` by
  // name; renaming an operator would have dropped it with every gate green.
  const DECLARED = new Set([
    ...Object.keys(TABLE.series),
    ...Object.keys(TABLE.scalars),
    ...Object.keys(TABLE.functions),
    ...Object.keys(TABLE.operators),
  ])

  /** Every string CONSTANT in a module, by full equality only — so a comment or
   *  a docstring quoting a formula can neither satisfy nor defeat the rail
   *  (plan-review #14). Template quasis count; comments are not in the AST. */
  function stringConstants(src) {
    const out = new Set()
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'Literal' && typeof node.value === 'string') out.add(node.value)
      if (node.type === 'TemplateLiteral') node.quasis.forEach((q) => out.add(q.value.cooked))
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
    }
    walk(parseJs(src, { ecmaVersion: 2023, sourceType: 'module' }))
    return out
  }

  it('the intersection of criteria.js\'s string constants with the manifest is EMPTY', () => {
    const spelled = [...stringConstants(readSource(CRITERIA_REL))].filter((s) => DECLARED.has(s))
    expect(DECLARED.size, 'the declared set is empty — this rail would pass on anything').toBeGreaterThan(70)
    expect(spelled, 'a manifest name is hand-listed in criteria.js — derive it instead').toEqual([])
  })

  it('and the rail is NOT vacuous — a planted hand-list is caught BY NAME', () => {
    const dirty = 'const JOINS = { and: \'&&\', or: \'||\' }\nexport default JOINS\n'
    const spelled = [...stringConstants(dirty)].filter((s) => DECLARED.has(s))
    expect(spelled.sort()).toEqual(['&&', '||'])
  })
})

describe('the acceptance formula reaches the picker and comes back unchanged', () => {
  // ⭐ THE PHASE'S OWN FORMULA, THROUGH THE PUBLIC DOOR. Two scalars and one
  // function call — E-1's whole point, seen from the builder.
  const ACCEPTANCE = 'rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)'

  it('it parses, reads back as three rows, and re-spells to the SAME TREE', () => {
    const parsed = parseFormula(ACCEPTANCE)
    expect(parsed.ok).toBe(true)
    const back = fromSource(ACCEPTANCE)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.join).toBe('and')
    expect(back.group.children).toHaveLength(3)
    expect(back.group.children.map((c) => c.kind)).toEqual(['row', 'row', 'row'])
    expect(back.group.children[0].left).toEqual({ t: 'name', name: 'rs_rank' })
    expect(back.group.children[2].right).toEqual(
      { t: 'call', name: 'sma', args: [{ t: 'name', name: 'close' }, { t: 'num', value: 50 }] })
    expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parsed.ast))
  })
})
