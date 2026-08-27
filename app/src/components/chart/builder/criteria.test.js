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
 *   * a NEGATION OF A NEGATION. `!!x` and `x` are the same truth and different
 *     trees, so `criteria.js` refuses it on all three of its sides rather than
 *     collapsing it; generating one would make the identity property assert that
 *     a refusal round-trips. The generator wraps AT MOST ONCE, by construction —
 *     `negate` is applied to a freshly-built child and never to its own output.
 *   * a ZERO-BAR QUALIFIER. `parse.js::convert` FOLDS `x[0]` to `x`, so a picker
 *     carrying `bars: 0` spells source that reads back as the UNQUALIFIED
 *     picker — a different shape — and generating one would make the identity
 *     property assert that a fold round-trips. `qualified` starts at 1.
 *   * a QUALIFIER ON A GROUP OR ON A NEGATION. `(a && b)[1]` and `(!x)[1]` are
 *     legal formulas the picker refuses BY NAME (the qualifier rides the leaf it
 *     reads, and a negation is written over the qualified condition), so
 *     generating one would make the identity property assert that a refusal
 *     round-trips.
 */
function genCorpus(seed, n) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const names = [...VOCAB.series, ...VOCAB.scalars]
  const fns = [...VOCAB.functions.keys()]
  const cmps = [...VOCAB.comparators]
  // ⭐ EVERY ROW SHAPE IS IN THE CORPUS, DERIVED. A shape the 400 cases never
  // generated would leave every property below true of a picker that could not
  // spell one, which is exactly the state E-4 shipped for crossings and the
  // state the picker was in for a BARE BOOLEAN NAME until this task.
  const crosses = [...VOCAB.crossings.keys()]
  const flags = [...VOCAB.flags.keys()]
  const other = (join) => (join === 'and' ? 'or' : 'and')

  // ⭐ THE FIFTH SHAPE, AND IT IS THE ONE THAT IS NOT A SHAPE — a QUALIFIER on
  // the thing it reads. It rides a TERM and it rides a LEAF ROW, so it is
  // applied at both layers; a corpus that only qualified terms would leave
  // `(close < sma(close, 50))[1]` — the firm's own Remount — unmeasured while
  // every property below stayed green. ⚠️ Never a `num` term, never a call
  // ARGUMENT, never a group and never a negation: all four are refused by name.
  const qualified = (node) => (r() < 0.2 ? { ...node, bars: 1 + Math.floor(r() * 9) } : node)

  const term = () => {
    const roll = r()
    if (roll < 0.35) return qualified({ t: 'name', name: pick(names) })
    if (roll < 0.48) return { t: 'num', value: Math.floor(r() * 400) }
    // ⭐ AND NEGATIVE LITERALS. The grammar has no negative `num` — `-2` is an
    // OPERATOR node over a positive one — so a corpus of non-negative numbers
    // leaves every property below true of a picker that cannot show the firm's
    // own `pct_vs_ema20 >= -2`. ⚠️ Never `-0`: it spells back as `0`, which is a
    // DIFFERENT tree, and `readTerm` refuses it for exactly that reason.
    if (roll < 0.55) return { t: 'num', value: -(1 + Math.floor(r() * 400)) }
    const name = pick(fns)
    const spec = VOCAB.functions.get(name)
    return qualified({
      t: 'call',
      name,
      args: spec.args.map((kind) => (kind === 'int'
        ? { t: 'num', value: 2 + Math.floor(r() * 50) }
        : { t: 'name', name: pick(names) })),
    })
  }
  const row = () => {
    const roll = r()
    if (flags.length && roll < 0.15) return qualified({ kind: 'flag', name: pick(flags) })
    if (crosses.length && roll < 0.40) return qualified({ kind: 'cross', left: term(), fn: pick(crosses), right: term() })
    return qualified({ kind: 'row', left: term(), cmp: pick(cmps), right: term() })
  }
  // ⭐ THE FOURTH SHAPE, AND IT IS THE ONLY ONE THAT WRAPS. Applied to whatever
  // the child turned out to be — a row of any of the three leaf shapes OR a
  // nested group — because `!x` is defined over CONDITIONS and a corpus that
  // only ever negated comparisons would leave `!(a || b)` and `!above_50sma`
  // unmeasured while every property below stayed green.
  const negate = (node) => ({ kind: 'not', child: node })
  const group = (depth, join) => {
    const k = 2 + Math.floor(r() * 3)
    const children = []
    for (let i = 0; i < k; i += 1) {
      const child = depth > 0 && r() < 0.3 ? group(depth - 1, other(join)) : row()
      children.push(r() < 0.25 ? negate(child) : child)
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
      if (n.kind === 'not') return walk(n.child)
      if (n.kind === 'row') { seen.add(n.cmp); [n.left, n.right].forEach(walkTerm) }
      if (n.kind === 'cross') { seen.add(n.fn); [n.left, n.right].forEach(walkTerm) }
      if (n.kind === 'flag') seen.add(n.name)
      return undefined
    }
    CORPUS.forEach(walk)
    const declared = [...VOCAB.series, ...VOCAB.scalars, ...VOCAB.functions.keys(),
      ...VOCAB.comparators, ...VOCAB.crossings.keys(), ...VOCAB.flags.keys()]
    expect(declared.length, 'the vocabulary itself is empty — this census would pass on nothing').toBeGreaterThan(50)
    const missing = declared.filter((n) => !seen.has(n))
    expect(missing, 'raise the corpus size or the generator is not reaching these').toEqual([])
  })

  it('and it contains EVERY ROW SHAPE — a corpus of comparisons proves nothing about the others', () => {
    // ⭐ THE CENSUS THAT SEES A GENERATOR THAT QUIETLY STOPPED EMITTING ONE.
    // Every property below is `it.each` over CORPUS, so a corpus with no `cross`
    // node — or no `flag` node — leaves all 400 identity cases green while
    // `toSource`/`fromAst` have no support for that shape at all. E-4 shipped
    // exactly that state for crossings; the picker was in it for a bare boolean
    // name until this task.
    const kinds = new Set()
    const walk = (n) => {
      kinds.add(n.kind)
      if (n.kind === 'group') n.children.forEach(walk)
      if (n.kind === 'not') walk(n.child)
    }
    CORPUS.forEach(walk)
    expect(VOCAB.crossings.size, 'the manifest declares no crossing — this census would pass on nothing')
      .toBeGreaterThan(0)
    expect(VOCAB.flags.size, 'the manifest declares no boolean name — this census would pass on nothing')
      .toBeGreaterThan(0)
    expect(VOCAB.notOp, 'the manifest declares no negation — this census would pass on nothing')
      .toBeTruthy()
    expect([...kinds].sort()).toEqual(['cross', 'flag', 'group', 'not', 'row'])
  })

  it('and a NEGATION wraps EVERY shape it can, not just the easy one', () => {
    // ⛔ THE CENSUS ONE LEVEL FINER, and it is the one that matters for this
    // shape. `not` appearing in the census above is satisfied by 400 negated
    // COMPARISONS — `!(a || b)` and `!above_50sma` would be unmeasured while
    // every identity case stayed green, which is precisely the state the
    // crossing row was in before it was generated.
    const wrapped = new Set()
    const walk = (n) => {
      if (n.kind === 'not') wrapped.add(n.child.kind)
      if (n.kind === 'group') n.children.forEach(walk)
      if (n.kind === 'not') walk(n.child)
    }
    CORPUS.forEach(walk)
    expect([...wrapped].sort()).toEqual(['cross', 'flag', 'group', 'row'])
  })

  it('and it contains a NEGATIVE literal — the other half of what the shipped starter needs', () => {
    // ⛔ THE SAME CENSUS ONE LAYER DOWN, for the term rather than the row. A
    // generator that stopped emitting negatives would leave all 400 identity
    // cases green while `-2` — which the firm's own surviving starter screens
    // on — could not be shown at all.
    let negatives = 0
    const walkTerm = (t) => {
      if (t.t === 'num' && t.value < 0) negatives += 1
      if (t.t === 'call') t.args.forEach(walkTerm)
    }
    const walk = (n) => {
      if (n.kind === 'group') { n.children.forEach(walk); return }
      if (n.kind === 'not') { walk(n.child); return }
      if (n.kind === 'flag') return
      ;[n.left, n.right].forEach(walkTerm)
    }
    CORPUS.forEach(walk)
    expect(negatives).toBeGreaterThan(0)
  })

  it('and the BARS-AGO QUALIFIER reaches BOTH layers and EVERY shape that may carry one', () => {
    // ⛔ THE CENSUS THE OTHER FOUR SHAPES ALREADY HAVE, for the fifth. A
    // generator that only qualified TERMS would leave `(close < sma(close,
    // 50))[1]` — the firm's own Remount, and the reason this task exists —
    // unmeasured while all 400 identity cases stayed green. That is exactly the
    // state the crossing row was in before it was generated.
    const onTerms = new Set()
    const onRows = new Set()
    const walkTerm = (t) => { if (t.bars) onTerms.add(t.t) }
    const walk = (n) => {
      if (n.kind === 'group') { n.children.forEach(walk); return }
      if (n.kind === 'not') { walk(n.child); return }
      if (n.bars) onRows.add(n.kind)
      if (n.kind === 'flag') return
      ;[n.left, n.right].forEach(walkTerm)
    }
    CORPUS.forEach(walk)
    // ⛔ AND NEVER ON A NUMBER — `5[1]` is not even a formula the parser accepts
    // (jsep reads `[1]` after a literal as an array), so a qualified number is a
    // picker shape no source can spell.
    expect([...onTerms].sort()).toEqual(['call', 'name'])
    expect([...onRows].sort()).toEqual(['cross', 'flag', 'row'])
  })

  it('and every generated qualifier counts at least ONE bar — a zero would be a FOLD, not a shape', () => {
    // ⛔ `parse.js::convert` folds `x[0]` to `x`, so a picker carrying `bars: 0`
    // spells source that reads back as the UNQUALIFIED picker. Generating one
    // would make the identity property assert that a fold round-trips.
    let seen = 0
    const check = (node) => {
      if (node.bars === undefined) return
      seen += 1
      expect(Number.isInteger(node.bars) && node.bars >= 1, JSON.stringify(node)).toBe(true)
    }
    const walk = (n) => {
      if (n.kind === 'group') { n.children.forEach(walk); return }
      if (n.kind === 'not') { walk(n.child); return }
      check(n)
      if (n.kind === 'flag') return
      ;[n.left, n.right].forEach(check)
    }
    CORPUS.forEach(walk)
    expect(seen).toBeGreaterThan(0)
  })

  it('and the corpus contains both joins and at least one nested group', () => {
    const joins = new Set(); let nested = 0
    const walk = (n, d) => {
      if (n.kind === 'not') { walk(n.child, d); return }
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
    // and every offered TERM function is a term-valued one — a `bool` function
    // is a condition, and it has a ROW of its own rather than a term slot.
    expect([...VOCAB.functions.keys()].every((n) => TABLE.functions[n].yields !== 'bool')).toBe(true)
  })
})

describe('⭐ THE CROSSING ROW — the second shape, and the asymmetry it closes', () => {
  // 🔴 SPEC §1.1: the definition consumed by chart, alerts, screener and builder
  // is the SAME OBJECT. A member could TYPE `crossOver(close, sma(close, 20))`,
  // save it, scan it, chart it and alert on it, and the picker refused to SHOW
  // it — two doors onto one object offering different sets, which is the exact
  // failure the spec names by competitor. These are the cases that say it is
  // closed, and the identity properties above already run over a corpus that
  // contains crossings.

  it('the crossing set is a PARTITION of the manifest against the term functions', () => {
    // ⛔ NO NAME AND NO COUNT — the identity a hand-list cannot satisfy by
    // accident, and it moves with the manifest.
    expect(VOCAB.crossings.size).toBeGreaterThan(0)
    const term = new Set(VOCAB.functions.keys())
    const cross = new Set(VOCAB.crossings.keys())
    expect([...cross].filter((n) => term.has(n)), 'a function is offered as BOTH').toEqual([])
    for (const n of cross) {
      expect(TABLE.functions[n].yields, n).toBe('bool')
      expect(TABLE.functions[n].args, n).toHaveLength(2)
    }
    for (const n of term) expect(TABLE.functions[n].yields, n).not.toBe('bool')
    // every declared function that answers yes-or-no about two things IS offered
    const owed = Object.entries(TABLE.functions)
      .filter(([, s]) => s.yields === 'bool' && (s.args || []).length === 2)
      .map(([n]) => n)
      .filter((n) => !cross.has(n))
    expect(owed, 'a two-operand boolean function the picker does not offer').toEqual([])
    // and `boolFunctions` is the wider set the refusal split reads
    expect([...cross].every((n) => VOCAB.boolFunctions.has(n))).toBe(true)
  })

  it('a TYPED crossing reads back as a crossing row and re-spells to the SAME TREE', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const src = `${fn}(close, sma(close, 50)) && rs_rank > 80`
    const parsed = parseFormula(src)
    expect(parsed.ok, parsed.error).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.children.map((c) => c.kind)).toEqual(['cross', 'row'])
    expect(back.group.children[0]).toEqual({
      kind: 'cross',
      left: { t: 'name', name: 'close' },
      fn,
      right: { t: 'call', name: 'sma', args: [{ t: 'name', name: 'close' }, { t: 'num', value: 50 }] },
    })
    expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parsed.ast))
  })

  it('a crossing alone at the top is a ONE-ROW GROUP, like any other single condition', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const back = fromSource(`${fn}(close, open)`)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.kind).toBe('group')
    expect(back.group.children).toEqual([{
      kind: 'cross', left: { t: 'name', name: 'close' }, fn, right: { t: 'name', name: 'open' },
    }])
    expect(isCanonical(back.group)).toBe(true)
  })

  it('⛔ AND IT IS DERIVED: a REMOVED `yields: bool` takes a crossing out of the picker', () => {
    // ⭐ E-2's M5/M5b for the second shape. The name is not spelled in
    // `criteria.js`; declaring it a number must move it out of the crossing set
    // and INTO the term functions, with no edit there.
    const fn = [...VOCAB.crossings.keys()][0]
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.functions[fn].yields = 'num'
    const v = vocabulary(planted)
    expect(v.crossings.has(fn)).toBe(false)
    expect(v.functions.has(fn)).toBe(true)
    expect(fromAst(parseFormula(`${fn}(close, open)`).ast, v).guard).toBe('picker:not-a-condition')
  })

  it('⛔ AND A PLANTED two-operand boolean function IS OFFERED, with no edit here', () => {
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.functions.uctPlantedTouch = {
      args: ['series', 'series'], lookback: 1, yields: 'bool', sentence: '{0} touching {1}',
    }
    const v = vocabulary(planted)
    expect(VOCAB.crossings.has('uctPlantedTouch')).toBe(false)
    expect(v.crossings.has('uctPlantedTouch')).toBe(true)
    const res = fromAst(parseFormula('uctPlantedTouch(close, open)').ast, v)
    expect(res.ok, res.reason).toBe(true)
    expect(res.group.children[0]).toEqual({
      kind: 'cross', left: { t: 'name', name: 'close' }, fn: 'uctPlantedTouch', right: { t: 'name', name: 'open' },
    })
    // …and the SHIPPED vocabulary still refuses it, so the planted table is
    // demonstrably what made the difference. ⚠️ It refuses as NOT-A-CONDITION
    // rather than as a shapeless one, and that is right: a function the table
    // does not declare at all has no `yields` to read, so the picker cannot
    // know it answers yes-or-no. The linter names it first anyway
    // (`resolve:function`), which is the message the member actually sees.
    expect(fromAst(parseFormula('uctPlantedTouch(close, open)').ast, VOCAB).guard)
      .toBe('picker:not-a-condition')
  })

  it('⛔ A BOOLEAN FUNCTION WITH ANY OTHER ARITY HAS NO ROW, and says THAT rather than "a number"', () => {
    // ⭐ THE CASE TODAY'S MANIFEST CANNOT REACH, so it is planted. Collapsing
    // this into `picker:not-a-condition` would tell a member their yes-or-no
    // question "produces a number", which is both wrong and unactionable — the
    // same distinction E-4 drew for `!x` and `a ? b : c`.
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.functions.uctPlantedRising = {
      args: ['series'], lookback: 1, yields: 'bool', sentence: '{0} rising',
    }
    const v = vocabulary(planted)
    expect(v.crossings.has('uctPlantedRising')).toBe(false)
    expect(v.functions.has('uctPlantedRising')).toBe(false)
    expect(v.boolFunctions.has('uctPlantedRising')).toBe(true)
    const res = fromAst(parseFormula('uctPlantedRising(close)').ast, v)
    expect(res.ok).toBe(false)
    expect(res.guard).toBe('picker:node')
    expect(res.group).toBeUndefined()
  })

  it('the middle label is the MANIFEST\'S OWN SENTENCE with the operand holes removed', () => {
    // ⛔ THE ASSERTION IS A PROPERTY, NOT A RESTATEMENT. Retyping "crossing
    // above" here would be a second authority over a string the manifest owns —
    // this repo's most-repeated defect — so what is asserted is that the label
    // carries no operand hole, is non-empty, and says nothing the sentence does
    // not. The planted case below is what proves it is READ rather than written.
    for (const [name, spec] of VOCAB.crossings) {
      expect(spec.label, name).toBeTruthy()
      expect(spec.label, name).not.toMatch(/[{}]/)
      const sentence = TABLE.functions[name].sentence
      const stray = spec.label.split(/\s+/).filter((w) => !sentence.includes(w))
      expect(stray, `${name}'s label says something its sentence does not`).toEqual([])
    }
  })

  it('and the label MOVES with the manifest — a planted sentence changes it', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.functions[fn].sentence = '{0} uctplantedrelation {1}'
    const v = vocabulary(planted)
    expect(v.crossings.get(fn).label).toBe('uctplantedrelation')
    expect(VOCAB.crossings.get(fn).label).not.toBe('uctplantedrelation')
  })

  it('a crossing whose function the vocabulary does not offer is REFUSED, never spelled', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const narrowed = { ...VOCAB, crossings: new Map() }
    expect(() => toSource(
      { kind: 'group', join: 'and', children: [{ kind: 'cross', left: { t: 'name', name: 'close' }, fn, right: { t: 'name', name: 'open' } }] },
      narrowed,
    )).toThrow(/comparison/i)
  })
})

describe('⭐ THE FLAG ROW — a name that answers yes-or-no IS a condition', () => {
  // 🔴 THE DEFECT THIS BLOCK CLOSES. `criteria.js` answered
  // `picker:not-a-condition` for a BARE `series` node while the manifest
  // declares `above_50sma` with `yields: "bool"` — so the picker told a member
  // that a yes-or-no fact "produces a number", and the ONE starter the library
  // ships could not be opened in the door that exists to teach the syntax. It is
  // the SAME correction the crossing row already made for boolean FUNCTIONS, one
  // node type over, and it is made the same way: by reading `yields`.

  it('the flag set is a PARTITION of the manifest\'s boolean NAMES, across ALL THREE sections', () => {
    // ⛔ NO NAME, NO COUNT AND NO SECTION. A bar field, a clock value and a
    // table scalar are the same NODE (E-1), so which section an entry lives in
    // cannot decide whether it is a condition — only `yields` can, and this is
    // the identity that a hand-list cannot satisfy by accident.
    expect(VOCAB.flags.size).toBeGreaterThan(0)
    const owed = [...Object.entries(TABLE.series), ...Object.entries(TABLE.clock), ...Object.entries(TABLE.scalars)]
      .filter(([, s]) => s.yields === 'bool')
      .map(([n]) => n)
      .filter((n) => !VOCAB.flags.has(n))
    expect(owed, 'a boolean name the manifest declares and the picker does not offer').toEqual([])
    for (const name of VOCAB.flags.keys()) {
      const spec = TABLE.series[name] || TABLE.clock[name] || TABLE.scalars[name]
      expect(spec, name).toBeTruthy()
      expect(spec.yields, name).toBe('bool')
    }
    // …and every flag SOURCED FROM SERIES OR SCALARS is still a NAME the picker
    // knows as a TERM too, so a flag row's source is a name both directions
    // already resolve — for those two sections.
    const seriesOrScalarFlags = [...VOCAB.flags.keys()].filter((n) => !TABLE.clock[n])
    expect(seriesOrScalarFlags.filter((n) => !VOCAB.series.has(n) && !VOCAB.scalars.has(n))).toEqual([])
    // ⚠️ AND A CLOCK FLAG IS DELIBERATELY FLAG-ONLY, NOT ALSO A TERM. The
    // ruling that added `table.clock` to `boolNames` scoped it to the picker's
    // flag ROW (this shape) — it did not add a `vocab.clock` term set, so
    // `sessionfirst == 1` is not offered even though bare `sessionfirst` is.
    // Recorded here so the asymmetry is a decision, not an oversight — the same
    // idiom the "A BOOLEAN NAME IS STILL A TERM TOO" case below uses for the
    // scalar/series case.
    const clockFlags = [...VOCAB.flags.keys()].filter((n) => TABLE.clock[n])
    expect(clockFlags.length, 'the manifest declares no clock boolean — this half asserts nothing')
      .toBeGreaterThan(0)
    expect(clockFlags.every((n) => !VOCAB.series.has(n) && !VOCAB.scalars.has(n))).toBe(true)
  })

  it('⭐ EVERY DECLARED NAME, DERIVED: `yields` decides, and the answer is total', () => {
    // ⭐⭐ THE GATE, AND IT COVERS A 55th ENTRY AUTOMATICALLY. The assertion is
    // not "these six open and `close` refuses" — it is that the picker's verdict
    // on EVERY name the manifest declares is exactly what that name's `yields`
    // says, in both directions. A name added to `closedTable.json` tomorrow is
    // already asserted here, and a hand-list that agreed with today's manifest
    // would still have to agree with tomorrow's.
    const names = [...Object.entries(TABLE.series), ...Object.entries(TABLE.clock), ...Object.entries(TABLE.scalars)]
    expect(names.length).toBeGreaterThan(50)
    const bools = names.filter(([, s]) => s.yields === 'bool')
    const others = names.filter(([, s]) => s.yields !== 'bool')
    expect(bools.length, 'no boolean name declared — this case would pass on nothing').toBeGreaterThan(0)
    expect(others.length, 'no non-boolean name declared — the refusal half would pass on nothing').toBeGreaterThan(0)

    for (const [name] of bools) {
      const back = fromSource(name)
      expect(back.ok, `${name} is declared bool and the picker refused it: ${back.reason}`).toBe(true)
      expect(back.group.children).toEqual([{ kind: 'flag', name }])
      expect(isCanonical(back.group)).toBe(true)
      // …and it re-spells to the SAME TREE, which is what makes it editable
      // rather than merely visible.
      expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parseFormula(name).ast))
    }
    for (const [name] of others) {
      // ⛔ THE OTHER HALF, AND WITHOUT IT THIS TASK HAS TRADED A FALSE REFUSAL
      // FOR A FALSE ACCEPTANCE. A price is not a yes-or-no answer, and the
      // picker must still say so — in the sentence it already had.
      const back = fromSource(name)
      expect(back.ok, `${name} yields a number and the picker accepted it as a condition`).toBe(false)
      expect(back.guard, name).toBe('picker:not-a-condition')
      expect(back.group, name).toBeUndefined()
    }
  })

  it('a flag alone at the top is a ONE-ROW GROUP, like any other single condition', () => {
    const name = [...VOCAB.flags.keys()][0]
    const back = fromSource(name)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.kind).toBe('group')
    expect(back.group.children).toEqual([{ kind: 'flag', name }])
  })

  it('⛔ AND IT IS DERIVED: a PLANTED boolean SCALAR is offered with no edit here', () => {
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.scalars.uct_planted_flag = {
      source: { store: 'screener_rows', column: 'uct_planted_flag' },
      as_of: { column: 'snapshot_date', grain: 'date' },
      cadence: 'nightly', yields: 'bool', sentence: 'whether the planted probe is set',
    }
    const v = vocabulary(planted)
    expect(VOCAB.flags.has('uct_planted_flag')).toBe(false)
    expect(v.flags.has('uct_planted_flag')).toBe(true)
    const res = fromAst(parseFormula('uct_planted_flag').ast, v)
    expect(res.ok, res.reason).toBe(true)
    expect(res.group.children[0]).toEqual({ kind: 'flag', name: 'uct_planted_flag' })
    // …and the SHIPPED vocabulary still refuses it, so the planted table is
    // demonstrably what made the difference.
    expect(fromAst(parseFormula('uct_planted_flag').ast, VOCAB).guard).toBe('picker:not-a-condition')
  })

  it('⛔ AND THE SECTION IS NOT WHAT DECIDES — a planted boolean BAR FIELD is offered too', () => {
    // ⭐ THE CASE TODAY'S MANIFEST CANNOT REACH: every declared bar field yields
    // a number, so a reader that filtered on the SCALARS section alone would
    // pass every other case in this block. A scalar and a bar field are the same
    // NODE, so only `yields` may decide.
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.series.uct_planted_bar_flag = { key: 'c', yields: 'bool', sentence: 'whether the planted bar is set' }
    const v = vocabulary(planted)
    expect(VOCAB.flags.has('uct_planted_bar_flag')).toBe(false)
    expect(v.flags.has('uct_planted_bar_flag')).toBe(true)
    const res = fromAst({ type: 'series', name: 'uct_planted_bar_flag' }, v)
    expect(res.ok, res.reason).toBe(true)
    expect(res.group.children[0]).toEqual({ kind: 'flag', name: 'uct_planted_bar_flag' })
  })

  it('⭐ THE CLOCK SECTION — the optional polish this task took. A planted boolean CLOCK value is offered too', () => {
    // ⭐⭐ THE THIRD SECTION, PROVED THE SAME WAY THE OTHER TWO ABOVE ARE. Before
    // this task `boolNames` read only `table.series` and `table.scalars`, so a
    // clock boolean rendered, linted and evaluated correctly and was still
    // UNREACHABLE from the picker — the "a filter family with no view is half
    // shipped" failure. A clock value rides the same `series` NODE as a bar
    // field and a scalar (E-1, extended by tableVersion 2), so only `yields`
    // may decide here too.
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.clock.uct_planted_clock_flag = {
      lookback: 0, yields: 'bool', sentence: 'whether the planted clock condition is set',
    }
    const v = vocabulary(planted)
    expect(VOCAB.flags.has('uct_planted_clock_flag')).toBe(false)
    expect(v.flags.has('uct_planted_clock_flag')).toBe(true)
    const res = fromAst({ type: 'series', name: 'uct_planted_clock_flag' }, v)
    expect(res.ok, res.reason).toBe(true)
    expect(res.group.children[0]).toEqual({ kind: 'flag', name: 'uct_planted_clock_flag' })
    // …and it round-trips, so it is editable and not merely visible.
    expect(toSource(res.group, v)).toBe('uct_planted_clock_flag')
    // …and the SHIPPED vocabulary still refuses it (it is not in the real
    // table), so the planted table is demonstrably what made the difference.
    expect(fromAst({ type: 'series', name: 'uct_planted_clock_flag' }, VOCAB).guard)
      .toBe('picker:not-a-condition')
  })

  it('⛔ AND A REAL CLOCK BOOLEAN IS OFFERED TODAY, WITH NO PLANT AT ALL — the shipped proof', () => {
    // The other half of the plant above: `closedTable.json` already declares
    // five real clock booleans, and the SHIPPED `VOCAB` — built from the real
    // table, no synthetic entry involved — offers every one of them today.
    const realClockBools = Object.entries(TABLE.clock)
      .filter(([, spec]) => spec.yields === 'bool').map(([n]) => n)
    expect(realClockBools.length, 'the manifest declares no clock boolean — this case proves nothing')
      .toBeGreaterThan(0)
    for (const name of realClockBools) {
      expect(VOCAB.flags.has(name), name).toBe(true)
      const res = fromSource(name)
      expect(res.ok, `${name}: ${res.reason}`).toBe(true)
      expect(res.group.children).toEqual([{ kind: 'flag', name }])
      expect(astHash(parseFormula(toSource(res.group)).ast)).toBe(astHash(parseFormula(name).ast))
    }
  })

  it('⛔ AND A REMOVED `yields: bool` TAKES ONE BACK OUT, refusing what it used to read', () => {
    // ⚠️ PICKED FROM SCALARS BY SEARCH, NOT BY INDEX. `VOCAB.flags` is a Map
    // built series-then-clock-then-scalars, and `table.series` has no boolean
    // entry today, so `[...VOCAB.flags.keys()][0]` is now a CLOCK name — this
    // proof is about the SCALARS section moving; the clock section gets its own
    // proof below.
    const name = [...VOCAB.flags.keys()].find((n) => TABLE.scalars[n])
    expect(name, 'no scalar flag exists — this proof asserts nothing').toBeTruthy()
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.scalars[name].yields = 'num'
    const v = vocabulary(planted)
    expect(VOCAB.flags.has(name)).toBe(true)
    expect(v.flags.has(name)).toBe(false)
    expect(fromAst(parseFormula(name).ast, v).guard).toBe('picker:not-a-condition')
  })

  it('⛔ AND A REMOVED CLOCK `yields: bool` TAKES ONE BACK OUT TOO, the mirror proof', () => {
    // The direction that matters for the newest section: take a REAL clock
    // boolean's `yields` away and the picker stops offering it, exactly as it
    // does for a scalar (above) and a bar field (further above).
    const [name] = Object.entries(TABLE.clock).find(([, spec]) => spec.yields === 'bool')
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.clock[name].yields = 'num'
    const v = vocabulary(planted)
    expect(VOCAB.flags.has(name)).toBe(true)
    expect(v.flags.has(name)).toBe(false)
    expect(fromAst(parseFormula(name).ast, v).guard).toBe('picker:not-a-condition')
  })

  it('the flag\'s label is the MANIFEST\'S OWN SENTENCE, and it MOVES with the manifest', () => {
    // ⛔ A PROPERTY, NOT A RESTATEMENT. Retyping "whether the price is above its
    // 50-day average" here would be a second authority over a string the
    // manifest owns — this repo's most-repeated defect. The planted case is what
    // proves the label is READ rather than written.
    for (const [name, spec] of VOCAB.flags) {
      const declared = (TABLE.series[name] || TABLE.clock[name] || TABLE.scalars[name]).sentence
      expect(spec.label, name).toBeTruthy()
      expect(spec.label, name).not.toMatch(/[{}]/)
      const stray = spec.label.split(/\s+/).filter((w) => !declared.includes(w))
      expect(stray, `${name}'s label says something its sentence does not`).toEqual([])
    }
    // ⚠️ PICKED FROM SCALARS BY SEARCH, NOT BY INDEX — see the removal proof
    // above for why `[0]` is no longer safe here.
    const first = [...VOCAB.flags.keys()].find((n) => TABLE.scalars[n])
    expect(first, 'no scalar flag exists — this proof asserts nothing').toBeTruthy()
    const planted = JSON.parse(JSON.stringify(TABLE))
    planted.scalars[first].sentence = 'uctplantedfact'
    expect(vocabulary(planted).flags.get(first).label).toBe('uctplantedfact')
    expect(VOCAB.flags.get(first).label).not.toBe('uctplantedfact')
  })

  it('a flag whose name the vocabulary does not offer is REFUSED, never spelled', () => {
    // ⛔ AND WITH THE READ SIDE'S OWN SENTENCE. A name that is not a flag yields
    // a NUMBER, which is exactly what `picker:not-a-condition` says, so the two
    // directions cannot drift into telling a member two different things.
    const narrowed = { ...VOCAB, flags: new Map() }
    const group = { kind: 'group', join: 'and', children: [{ kind: 'flag', name: [...VOCAB.flags.keys()][0] }] }
    expect(() => toSource(group, narrowed)).toThrow(/yes-or-no/i)
    expect(toSource(group, VOCAB)).toBe([...VOCAB.flags.keys()][0])
  })

  it('⚠️ A BOOLEAN NAME IS STILL A TERM TOO, and that is deliberate', () => {
    // The grammar has no boolean node — `_booleans` says a condition IS a 0/1
    // column — so `above_50sma == 1` is a legal comparison and it opened in the
    // picker before this task. Refusing it now would REMOVE something a member
    // can do today in the name of consistency with the crossing decision, which
    // is a narrowing and an owner call, not a bug fix. It is recorded here so
    // the asymmetry is a decision on the record rather than an oversight.
    //
    // ⚠️ PICKED FROM SERIES-OR-SCALARS BY SEARCH, NOT BY INDEX. A clock flag is
    // deliberately NOT also a term (see the PARTITION case above) — `[0]` would
    // pick one and turn this into a false negative for the wrong reason.
    const name = [...VOCAB.flags.keys()].find((n) => TABLE.series[n] || TABLE.scalars[n])
    expect(name, 'no series-or-scalar flag exists — this proof asserts nothing').toBeTruthy()
    const back = fromSource(`${name} == 1`)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.children[0].kind).toBe('row')
    expect(back.group.children[0].left).toEqual({ t: 'name', name })
  })

  it('⚠️ …AND A CLOCK FLAG IS NOT A TERM — `sessionfirst == 1` still refuses', () => {
    // ⭐ THE MIRROR OF THE CASE ABOVE, PROVING THE SCOPE RATHER THAN ASSUMING IT.
    // Offering `table.clock` to `boolNames` widened the FLAG ROW only; `readTerm`
    // and `termSource` were not touched, so a clock name used as a comparison
    // OPERAND still has no editor — `vocab.series`/`vocab.scalars` do not carry
    // it. This is the ruling's own stated cost boundary ("one line plus a
    // test"), not an oversight; a widened comparator set was never asked for.
    const name = [...VOCAB.flags.keys()].find((n) => TABLE.clock[n])
    expect(name, 'no clock flag exists — this proof asserts nothing').toBeTruthy()
    expect(fromSource(`${name} == 1`).guard).toBe('picker:term')
    // …and the bare flag still opens, so the refusal above is about the TERM
    // position and not about the name being unknown to the picker.
    expect(fromSource(name).ok).toBe(true)
  })
})

describe('⭐ A NEGATIVE LITERAL IS A NUMBER, not arithmetic', () => {
  // 🔴 THE OTHER HALF OF WHY THE SHIPPED STARTER COULD NOT BE OPENED. The
  // canonical tree has no negative `num` — `_canonical` says unary minus is
  // spelled `u-` — so `pct_vs_ema20 >= -2` arrives with an OPERATOR in a term
  // slot, and a picker that read the node's TYPE refused a plain number.

  it('the negation set is DERIVED, and every member is an arity-1 numeric operator', () => {
    // ⛔ NO NAME. Which operator negates is a fact about the INTERPRETER, so it
    // is measured by running it — the same idiom the join/comparator split uses.
    // What is asserted here is read off the manifest, never typed.
    expect(VOCAB.negations.size).toBeGreaterThan(0)
    for (const name of VOCAB.negations) {
      expect(TABLE.operators[name].arity, name).toBe(1)
      expect(TABLE.operators[name].yields, name).toBe('num')
    }
    // …and the LOGICAL not did not leak in. It is arity 1 too, and it is a
    // DIFFERENT SHAPE — one wraps a CONDITION, the other makes a literal
    // negative — so an operator that landed in both would let `!(close > open)`
    // be read as a term. ⛔ NEITHER NAME IS TYPED: the two derivations are
    // asserted to be disjoint, which is the identity a hand-list cannot satisfy
    // by accident and which moves with the manifest.
    expect(VOCAB.notOp, 'the manifest declares no negation — this half asserts nothing').toBeTruthy()
    expect(VOCAB.negations.has(VOCAB.notOp)).toBe(false)
  })

  it('a negative literal reads back as a NUMBER and re-spells to the SAME TREE', () => {
    const src = 'pct_vs_ema20 >= -2'
    const parsed = parseFormula(src)
    expect(parsed.ok, parsed.error).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.children[0].right).toEqual({ t: 'num', value: -2 })
    expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parsed.ast))
  })

  it('⛔ AND IT IS DERIVED: a vocabulary with no negation FAILS CLOSED, exactly as before', () => {
    // The direction that matters. Delete the operator from the manifest and the
    // picker goes back to refusing a negative literal BY NAME rather than
    // silently spelling something the parser would read differently.
    const narrowed = { ...VOCAB, negations: new Set() }
    expect(fromAst(parseFormula('pct_vs_ema20 >= -2').ast, narrowed).guard).toBe('picker:term')
    expect(fromAst(parseFormula('pct_vs_ema20 >= -2').ast, VOCAB).ok).toBe(true)
  })

  it('⛔ THE OPERAND MUST BE A LITERAL — a negated EXPRESSION is still arithmetic', () => {
    // This widens nothing but the one shape the grammar forces. `-close` is a
    // term that is a tree, which is the arithmetic row shape that has not been
    // taken and is still refused BY NAME.
    expect(fromSource('-close > 1').guard).toBe('picker:term')
    expect(fromSource('-(close + open) > 1').guard).toBe('picker:term')
  })

  it('⛔ AND NOT `-0`, because it would spell back as a DIFFERENT TREE', () => {
    // `String(-0)` is `0`, which parses to `num 0` rather than to a negation —
    // so admitting it would make the AST identity property false for a shape no
    // member can reach by any other route. It refuses instead.
    const parsed = parseFormula('close > -0')
    expect(parsed.ok, parsed.error).toBe(true)
    expect(fromAst(parsed.ast, VOCAB).guard).toBe('picker:term')
  })

  it('⛔ AND NEVER INSIDE A CALL — refused in BOTH directions, so they cannot disagree', () => {
    // A negative argument spells `sma(close, -2)`, whose canonical form puts an
    // OPERATOR in the argument slot, and `readTerm` refuses an operator there.
    // Spelling one would produce source the picker could not read back — the
    // exact asymmetry the identity property exists to catch.
    expect(fromSource('sma(close, -2) > 1').guard).toBe('picker:term')
    expect(() => toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'row',
        left: { t: 'call', name: 'sma', args: [{ t: 'name', name: 'close' }, { t: 'num', value: -2 }] },
        cmp: [...VOCAB.comparators][0],
        right: { t: 'num', value: 1 },
      }],
    }, VOCAB)).toThrow(/longer expression/i)
  })
})

describe('⭐ THE NEGATION ROW — the shape that WRAPS a condition rather than being one', () => {
  // 🔴 SPEC §1.1 AGAIN, AND THIS IS THE LAST OF IT AT THE CONDITION LAYER. A
  // member could TYPE `!(close > open)`, save it, scan it, chart it and alert on
  // it, and the picker refused to SHOW it. Every other shape the picker learned
  // was a LEAF — `<term> <relation> <term>`, or a name standing alone. This one
  // has a picker CHILD, which is why it did not fall out of the crossing row's
  // generalisation and needed a shape of its own.

  const notOf = (src) => `!${src}`

  it('the negation operator is DERIVED by RUNNING the interpreter, and there is exactly one', () => {
    // ⛔ NO NAME, AND NOT `yields` EITHER. The manifest declares `yields: "bool"`
    // of every comparator and both joins, so it says *this answers yes-or-no*
    // and never *this INVERTS one*. What is asserted here is read off the
    // manifest; which operator it IS was measured.
    expect(VOCAB.notOp).toBeTruthy()
    expect(TABLE.operators[VOCAB.notOp].arity).toBe(1)
    expect(TABLE.operators[VOCAB.notOp].yields).toBe('bool')
    // …and no OTHER arity-1 operator was mistaken for it — the numeric negation
    // is arity 1 as well, and the two sets must not overlap.
    expect(VOCAB.negations.size).toBeGreaterThan(0)
    expect([...VOCAB.negations].includes(VOCAB.notOp)).toBe(false)
  })

  it('a TYPED negation reads back as a NOT wrapping its row, and re-spells to the SAME TREE', () => {
    const src = '!(close > open) && rs_rank > 80'
    const parsed = parseFormula(src)
    expect(parsed.ok, parsed.error).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.children.map((c) => c.kind)).toEqual(['not', 'row'])
    expect(back.group.children[0]).toEqual({
      kind: 'not',
      child: { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } },
    })
    expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parsed.ast))
  })

  it('a negation alone at the top is a ONE-ROW GROUP, like any other single condition', () => {
    const back = fromSource('!(close > open)')
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.kind).toBe('group')
    expect(back.group.children).toHaveLength(1)
    expect(back.group.children[0].kind).toBe('not')
    expect(isCanonical(back.group)).toBe(true)
  })

  it('⭐ IT WRAPS EVERY SHAPE THE PICKER HAS — derived from the vocabulary, not listed', () => {
    // ⛔ THE ASSERTION IS TOTAL OVER THE ROW SHAPES. A negation that only worked
    // over comparisons would leave `!above_50sma` — a sentence a member would
    // reach for immediately — refused, with every other case here green.
    const cmp = [...VOCAB.comparators][0]
    const cross = [...VOCAB.crossings.keys()][0]
    const flag = [...VOCAB.flags.keys()][0]
    const cases = [
      `close ${cmp} open`,
      `${cross}(close, open)`,
      flag,
      '((close > open) || (high > low))',
    ]
    for (const inner of cases) {
      const src = notOf(`(${inner})`)
      const parsed = parseFormula(src)
      expect(parsed.ok, `${src}: ${parsed.error}`).toBe(true)
      const back = fromAst(parsed.ast, VOCAB)
      expect(back.ok, `${src}: ${back.reason}`).toBe(true)
      expect(back.group.children[0].kind, src).toBe('not')
      expect(isCanonical(back.group), src).toBe(true)
      expect(astHash(parseFormula(toSource(back.group)).ast), src).toBe(astHash(parsed.ast))
    }
  })

  it('⛔ AND IT IS DERIVED: a vocabulary with NO negation FAILS CLOSED, exactly as before', () => {
    // The direction that matters, and the one the source rail cannot see. Take
    // the operator away and the picker goes back to refusing a negation BY NAME
    // rather than spelling a character it decided on for itself.
    const narrowed = { ...VOCAB, notOp: null }
    expect(fromAst(parseFormula('!(close > open)').ast, narrowed).guard).toBe('picker:node')
    expect(fromAst(parseFormula('!(close > open)').ast, VOCAB).ok).toBe(true)
    // …and it cannot be SPELLED either, so the two directions fail together.
    const picker = { kind: 'group', join: 'and', children: [{ kind: 'not', child: ROW_A }] }
    expect(() => toSource(picker, narrowed)).toThrow(/no row for/i)
    expect(toSource(picker, VOCAB)).toContain(toSource(ROW_A, VOCAB))
  })

  it('⛔ A NEGATION IS A FLATTENING BARRIER — `!(a && b)` inside an all-of is NOT `a && b`', () => {
    // ⭐ THE CASE THE GENERATOR DELIBERATELY DOES NOT REACH, because its nested
    // groups always carry the OTHER join. Through a negation the SAME join is
    // canonical — and a `canonicalPicker` that absorbed it would change the
    // meaning of the formula while every identity case above stayed green.
    const barrier = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'not', child: { kind: 'group', join: 'and', children: [ROW_A, ROW_B] } }, ROW_C],
    }
    expect(isCanonical(barrier)).toBe(true)
    expect(canonicalPicker(barrier)).toEqual(barrier)
    // …and the tree says the same thing: absorbing it would be a DIFFERENT tree.
    const absorbed = { kind: 'group', join: 'and', children: [ROW_A, ROW_B, ROW_C] }
    const h = (p) => astHash(parseFormula(toSource(p)).ast)
    expect(h(barrier)).not.toBe(h(absorbed))
    // …and it round-trips, which is what says the barrier is real rather than
    // merely unflattened.
    const back = fromAst(parseFormula(toSource(barrier)).ast, VOCAB)
    expect(back.ok, back.reason).toBe(true)
    expect(back.group).toEqual(barrier)
  })

  it('⛔ `!!x` REFUSES IN ALL THREE PLACES, so the directions cannot disagree', () => {
    // ⭐ THE DECISION, ON THE RECORD. `!!x` and `x` are the same truth and
    // DIFFERENT TREES. Collapsing it would hand a member back a formula they did
    // not write; rendering it would need a control the picker does not have.
    // Refusing it in only one direction would let the picker spell something it
    // cannot read back, which is the asymmetry the identity property exists to
    // catch — so all three refuse, with ONE guard between them.
    const chain = { kind: 'not', child: { kind: 'not', child: ROW_A } }
    expect(fromSource('!!(close > open)').guard).toBe('picker:node')
    expect(() => toSource({ kind: 'group', join: 'and', children: [chain] }, VOCAB))
      .toThrow(/no row for/i)
    expect(() => canonicalPicker(chain)).toThrow(/no row for/i)
    expect(isCanonical(chain)).toBe(false)
    // …and ONE level still works, so the refusal is about the chain and not
    // about negation.
    expect(fromSource('!(close > open)').ok).toBe(true)
  })

  it('the refusal inside a negation is the OPERAND\'S OWN, never a second sentence', () => {
    // ⛔ `!close` is not "a construction the picker has no row for" — the picker
    // has a row for a negation. What is wrong is INSIDE it, and saying so in the
    // sentence that already says it is what keeps one fact from acquiring two
    // descriptions. Every case here is also in `must_refuse.json`, from the
    // other side.
    expect(fromSource('!close').guard).toBe('picker:not-a-condition')
    expect(fromSource('!(sma(sma(close, 5), 5) > 1)').guard).toBe('picker:term')
    expect(fromSource('!((close > 1) ? 2 : 3)').guard).toBe('picker:node')
  })

  it('a negation nested inside a negated GROUP is fine — the bound is on the CHAIN', () => {
    // The distinction the `!!` refusal must not overreach into: two negations at
    // DIFFERENT levels are two conditions, each with one toggle, and the picker
    // shows both.
    const src = '!((!(close > open)) && (high > low))'
    const back = fromSource(src)
    expect(back.ok, back.reason).toBe(true)
    const outer = back.group.children[0]
    expect(outer.kind).toBe('not')
    expect(outer.child.kind).toBe('group')
    expect(outer.child.children[0].kind).toBe('not')
    expect(astHash(parseFormula(toSource(back.group)).ast)).toBe(astHash(parseFormula(src).ast))
  })
})

describe('⭐ EVERY DECLARED OPERATOR, DERIVED — and the shape NOT taken still REFUSES', () => {
  // ⭐⭐ THE FLAG BLOCK'S TOTALITY CENSUS, ONE SECTION OVER, AND IT IS THE GUARD
  // AGAINST THIS TASK TRADING A FALSE REFUSAL FOR A FALSE ACCEPTANCE. The
  // assertion is not "negation opens and arithmetic refuses" — it is that the
  // picker's verdict on EVERY operator `closedTable.json` declares is exactly
  // what that operator's own `arity` and `yields` say, in the shape that fits
  // it. An operator added tomorrow is already asserted here, and the day
  // arithmetic is half-landed — read but not spelled, or spelled but not
  // normalised — this is what goes red.
  //
  // ⛔ THE TREES ARE BUILT DIRECTLY, NOT SPELLED. `u-` is the CANONICAL name and
  // `-` is the character the source uses; a census that spelled its operands
  // would be asserting `parse.js`'s mapping, which is `parse.test.js`'s job, and
  // it could not reach the unary entries at all.
  const COND = parseFormula('close > open').ast
  const TERM = { type: 'series', name: 'close' }
  const NUM = { type: 'num', value: 1 }
  const opNode = (name, args) => ({ type: 'op', name, args })
  const SOME_CMP = [...VOCAB.comparators][0]

  it('the manifest declares enough operators for this census to mean something', () => {
    expect(Object.keys(TABLE.operators).length).toBeGreaterThan(10)
    expect(VOCAB.joins.size).toBe(2)
    expect(VOCAB.comparators.size).toBeGreaterThan(3)
    expect(VOCAB.notOp).toBeTruthy()
  })

  it('the verdict on every operator is what its arity and yields say — and the tally is complete', () => {
    const tally = { join: 0, comparator: 0, arithmetic: 0, negation: 0, shapeless: 0 }
    for (const [name, spec] of Object.entries(TABLE.operators)) {
      if (spec.arity === 2 && VOCAB.joinOf.has(name)) {
        const res = fromAst(opNode(name, [COND, COND]), VOCAB)
        expect(res.ok, `${name}: ${res.reason}`).toBe(true)
        expect(res.group.kind, name).toBe('group')
        expect(res.group.children, name).toHaveLength(2)
        tally.join += 1
      } else if (spec.arity === 2 && VOCAB.comparators.has(name)) {
        const res = fromAst(opNode(name, [TERM, TERM]), VOCAB)
        expect(res.ok, `${name}: ${res.reason}`).toBe(true)
        expect(res.group.children[0].kind, name).toBe('row')
        expect(res.group.children[0].cmp, name).toBe(name)
        tally.comparator += 1
      } else if (spec.arity === 2) {
        // ⛔ THE SHAPE NOT TAKEN. An arity-2 operator that is neither a join nor
        // a comparator yields a NUMBER, and it refuses in BOTH positions: as the
        // whole formula it is not a yes-or-no answer, and inside a comparison it
        // is a TERM the picker has no editor for. Both sentences are the ones
        // the module already had — no refusal was added for arithmetic.
        expect(spec.yields, name).not.toBe('bool')
        expect(fromAst(opNode(name, [TERM, TERM]), VOCAB).guard, name).toBe('picker:not-a-condition')
        expect(fromAst(opNode(SOME_CMP, [opNode(name, [TERM, TERM]), NUM]), VOCAB).guard, name)
          .toBe('picker:term')
        tally.arithmetic += 1
      } else if (name === VOCAB.notOp) {
        const res = fromAst(opNode(name, [COND]), VOCAB)
        expect(res.ok, `${name}: ${res.reason}`).toBe(true)
        expect(res.group.children[0].kind, name).toBe('not')
        tally.negation += 1
      } else {
        // Every remaining arity — the numeric negation and the ternary today —
        // has no row at all, and says THAT rather than "this produces a number".
        const args = Array.from({ length: spec.arity }, (_, i) => (i === 0 ? COND : TERM))
        expect(fromAst(opNode(name, args), VOCAB).guard, name).toBe('picker:node')
        tally.shapeless += 1
      }
    }
    // ⛔ AND NOT ONE BRANCH IS EMPTY. A census whose interesting arm never ran
    // is a gate that cannot fail — the arithmetic arm especially, since it is
    // the one this task deliberately did not close.
    expect(tally.join).toBe(2)
    expect(tally.negation).toBe(1)
    expect(tally.comparator).toBeGreaterThan(3)
    expect(tally.arithmetic, 'no numeric operator declared — the refusal arm proves nothing')
      .toBeGreaterThan(0)
    expect(tally.shapeless, 'no shapeless operator declared — the `picker:node` arm proves nothing')
      .toBeGreaterThan(0)
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(Object.keys(TABLE.operators).length)
  })

  it('⛔ AND A NEGATION DOES NOT LAUNDER AN ARITHMETIC TERM INTO A CONDITION', () => {
    // The one way the new shape could have widened what the picker accepts: a
    // negation whose operand is arithmetic. It refuses with the OPERAND's guard,
    // exactly as `!close` does, rather than being read as a condition because
    // its wrapper is one.
    for (const [name, spec] of Object.entries(TABLE.operators)) {
      if (spec.arity !== 2 || spec.yields === 'bool') continue
      const res = fromAst(opNode(VOCAB.notOp, [opNode(name, [TERM, TERM])]), VOCAB)
      expect(res.ok, name).toBe(false)
      expect(res.guard, name).toBe('picker:not-a-condition')
      expect(res.group, name).toBeUndefined()
    }
  })
})

describe('⭐ THE BARS-AGO QUALIFIER — the fifth node, and the walker that lagged three commits', () => {
  // 🔴 THE LAST WALKER. `291c9d8a` added `offset` to the canonical vocabulary —
  // `{type:'offset', value: N>=1, args:[child]}`, spelled `expr[N]` — and every
  // reader in the repo learned it EXCEPT this one. `assert_canonical`,
  // `ast_budget`, `ast_lint`, `ast_freshness` and `sentence.js` shipped with it;
  // `c6ae15171` closed the Python sentence lane. `criteria.js` dispatched
  // num / series / op / call and answered `picker:node` — so two of the firm's
  // own setups (both TWO-BAR relationships) could not be opened in the door that
  // exists to teach the syntax, and the catalogue rail below went red on them.
  //
  // ⭐ AND IT IS A QUALIFIER, NOT A ROW — which is why it did not fall out of the
  // negation's generalisation. Every earlier shape was a thing on the page: a
  // comparison, a crossing, a name, a condition said the other way round. `x[1]`
  // is none of those. It says WHEN to read something that is already there, so
  // it rides the operand — and the leaf row — it qualifies, as a `bars` field.
  //
  // ⛔ AND THE PHRASE IS THE SENTENCE LANE'S, NOT A SECOND ONE. `sentence.js`
  // renders `{inner} N bar(s) ago` and `definition_concierge._render_offset`
  // mirrors it decision-for-decision; the picker's control says the same words
  // over the same number, and `CriteriaPicker.test.jsx` is where that is seen.

  const opens = (src) => {
    const parsed = parseFormula(src)
    expect(parsed.ok, `${src} did not parse: ${parsed.error}`).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, `${src} could not be opened: ${back.reason}`).toBe(true)
    expect(isCanonical(back.group), src).toBe(true)
    // ⛔ THE HASH, NOT THE STRING. A qualifier that re-spelled to a different
    // tree — a lost parenthesis, a dropped `[1]`, the fold — round-trips through
    // the picker's own shape and only this sees it.
    expect(astHash(parseFormula(toSource(back.group, VOCAB)).ast), src)
      .toBe(astHash(parsed.ast))
    return back.group
  }

  it('the canonical node exists and the parser FOLDS a zero-bar one away', () => {
    // ⛔ THE PRECONDITION, MEASURED. `close[0]` and `close` are ONE column and
    // therefore one `astHash`, so `bars: 0` is not a shape the picker may carry
    // — every refusal below rests on this being true of the shipped parser
    // rather than on this file remembering that it is.
    expect(parseFormula('close[1]').ast.type).toBe('offset')
    expect(parseFormula('close[1]').ast.value).toBe(1)
    expect(astHash(parseFormula('close[0] > open').ast))
      .toBe(astHash(parseFormula('close > open').ast))
    const back = fromSource('close[0] > open')
    expect(back.ok, back.reason).toBe(true)
    expect(back.group.children[0]).toEqual(
      { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } })
  })

  it('a BAR SERIES one bar ago is a TERM, and the row is otherwise unchanged', () => {
    const group = opens('close > high[1]')
    expect(group.children[0]).toEqual({
      kind: 'row',
      left: { t: 'name', name: 'close' },
      cmp: '>',
      right: { t: 'name', name: 'high', bars: 1 },
    })
  })

  it('a SCALAR one bar ago is a term too — the node tag does not decide, the vocabulary does', () => {
    const group = opens('rs_rank[1] > 80')
    expect(group.children[0].left).toEqual({ t: 'name', name: 'rs_rank', bars: 1 })
    expect(group.children[0].right).toEqual({ t: 'num', value: 80 })
  })

  it('a CALL one bar ago is a term, and its own arguments are untouched', () => {
    const group = opens('sma(close, 50)[3] > close')
    expect(group.children[0].left).toEqual({
      t: 'call', name: 'sma', args: [{ t: 'name', name: 'close' }, { t: 'num', value: 50 }], bars: 3,
    })
  })

  it('a FLAG one bar ago is still ONE control — a yes-or-no fact, read a bar back', () => {
    const flag = [...VOCAB.flags.keys()][0]
    const group = opens(`${flag}[2]`)
    expect(group.children).toEqual([{ kind: 'flag', name: flag, bars: 2 }])
  })

  it('a CROSSING one bar ago is still a crossing row', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const group = opens(`${fn}(close, open)[1]`)
    expect(group.children).toEqual([{
      kind: 'cross', left: { t: 'name', name: 'close' }, fn, right: { t: 'name', name: 'open' }, bars: 1,
    }])
  })

  it('🔴 A WHOLE COMPARISON one bar ago — the shape the firm\'s Remount is', () => {
    const group = opens('(close < sma(close, 50))[1]')
    expect(group.children).toEqual([{
      kind: 'row',
      left: { t: 'name', name: 'close' },
      cmp: '<',
      right: { t: 'call', name: 'sma', args: [{ t: 'name', name: 'close' }, { t: 'num', value: 50 }] },
      bars: 1,
    }])
  })

  it('🔴 AND NESTED INSIDE A BINARY OP, which is Remount whole', () => {
    // ⭐ THE CATALOGUE ENTRY, BEFORE IT IS IN THE CATALOGUE. A qualifier that
    // only worked as the WHOLE formula would leave the shipped starter refused
    // with every case above green.
    const group = opens('(close < sma(close, 50))[1] && above_50sma')
    expect(group.join).toBe('and')
    expect(group.children.map((c) => c.kind)).toEqual(['row', 'flag'])
    expect(group.children[0].bars).toBe(1)
    expect(group.children[1]).toEqual({ kind: 'flag', name: 'above_50sma' })
  })

  it('and a qualified term sits inside a binary op just as happily', () => {
    const group = opens('open > high[1] && close > high[1]')
    expect(group.children.map((c) => c.right.bars)).toEqual([1, 1])
  })

  it('a NEGATION over a qualified condition is the negation of what happened a bar ago', () => {
    // ⛔ THE NESTING IS ONE WAY ROUND, AND THAT IS THE DECISION. `!(x[1])` is the
    // shape the picker carries — the qualifier is the leaf's, and the negate
    // toggle is written over the qualified condition. `(!x)[1]` is refused below.
    const group = opens('!(close > open)[1]')
    expect(group.children[0].kind).toBe('not')
    expect(group.children[0].child.bars).toBe(1)
  })

  it('⛔ A QUALIFIER ON A GROUP IS REFUSED IN BOTH DIRECTIONS, so they cannot disagree', () => {
    // ⭐ AND THE REASON IS THE IDENTITY PROPERTY, not taste. A one-child group
    // spells its child and nothing else, so `group{bars:1}[flag]` and
    // `flag{bars:1}` would be TWO pickers with ONE tree — the picker would hand
    // back a shape the member did not assemble. Refusing the whole level costs a
    // formula nobody can otherwise reach and keeps the round trip an identity.
    expect(fromSource('((close > open) && (high > low))[1]').guard).toBe('picker:node')
    const bad = {
      kind: 'group', join: 'and', bars: 1, children: [ROW_A, ROW_B],
    }
    expect(() => toSource({ kind: 'group', join: 'and', children: [bad] }, VOCAB)).toThrow(/no row for/i)
    expect(() => canonicalPicker(bad)).toThrow(/no row for/i)
    expect(isCanonical(bad)).toBe(false)
  })

  it('⛔ AND A QUALIFIER OUTSIDE A NEGATION IS REFUSED THE SAME WAY', () => {
    expect(fromSource('(!(close > open))[1]').guard).toBe('picker:node')
    const bad = { kind: 'not', bars: 1, child: ROW_A }
    expect(() => toSource({ kind: 'group', join: 'and', children: [bad] }, VOCAB)).toThrow(/no row for/i)
    expect(() => canonicalPicker(bad)).toThrow(/no row for/i)
    // …and the supported nesting still works, so the refusal is about the ORDER
    // and not about negation.
    expect(fromSource('!(close > open)[1]').ok).toBe(true)
  })

  it('⛔ AND NEVER INSIDE A CALL ARGUMENT — refused on BOTH sides, exactly as a negative literal is', () => {
    // A qualified argument spells `sma(close[1], 20)`, and the picker's argument
    // controls are a name picker and a window box: rendering one would show a
    // member `sma(close, 20)` for a formula that says something else. The
    // control the argument would need is the row's, one level up.
    expect(fromSource('sma(close[1], 20) > 1').guard).toBe('picker:term')
    expect(() => toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'row',
        left: { t: 'call', name: 'sma', args: [{ t: 'name', name: 'close', bars: 1 }, { t: 'num', value: 20 }] },
        cmp: [...VOCAB.comparators][0],
        right: { t: 'num', value: 1 },
      }],
    }, VOCAB)).toThrow(/longer expression/i)
  })

  it('⛔ AND A ZERO-BAR QUALIFIER REFUSES IN ALL THREE PLACES, because the parser FOLDS it', () => {
    // ⭐ THE `-0` RULING, ONE NODE OVER. `close[0]` is `close`, so a picker
    // carrying `bars: 0` spells source that reads back as a DIFFERENT picker.
    // It is refused where it is spelled and where it is normalised; it cannot be
    // READ at all, because no tree the parser produces contains one.
    const zeroRow = { ...ROW_A, bars: 0 }
    expect(() => toSource({ kind: 'group', join: 'and', children: [zeroRow] }, VOCAB)).toThrow(/no row for/i)
    expect(() => canonicalPicker(zeroRow)).toThrow(/no row for/i)
    expect(isCanonical(zeroRow)).toBe(false)
    const zeroTerm = {
      kind: 'group',
      join: 'and',
      children: [{ ...ROW_A, left: { t: 'name', name: 'close', bars: 0 } }],
    }
    expect(() => toSource(zeroTerm, VOCAB)).toThrow(/longer expression/i)
    // …and a fraction and a negative are refused for the same reason: neither is
    // a whole count of bars, and `readOffset` in the parser says so first.
    expect(() => toSource({ kind: 'group', join: 'and', children: [{ ...ROW_A, bars: 1.5 }] }, VOCAB))
      .toThrow(/no row for/i)
    expect(() => toSource({ kind: 'group', join: 'and', children: [{ ...ROW_A, bars: -1 }] }, VOCAB))
      .toThrow(/no row for/i)
  })

  it('⛔ AND THE REFUSAL INSIDE A QUALIFIER IS THE OPERAND\'S OWN, never a second sentence', () => {
    // The same rule the negation already follows: what is wrong is INSIDE the
    // qualifier, and the picker says so in the sentence it already had.
    // ⚠️ `((close - low) / (high - low))[1]` is the Kicker Candle clause, and it
    // is refused for ARITHMETIC — the shape this task deliberately did not take
    // — not for the qualifier. Recorded here so the two are never confused.
    expect(fromSource('((close - low) / (high - low))[1] <= 0.33').guard).toBe('picker:term')
    expect(fromSource('(close + open)[1] > 1').guard).toBe('picker:term')
    expect(fromSource('sma(close, 20)[1]').guard).toBe('picker:not-a-condition')
    expect(fromSource('close[1]').guard).toBe('picker:not-a-condition')
  })

  it('⛔ AND A CHAIN IS UNREACHABLE FROM SOURCE AND REFUSED FROM A TREE', () => {
    // `close[1][2]` is `canonicalise:offset-chained` at the parser — one column,
    // one tree — so the picker can never be handed one by a member. A
    // hand-built double still refuses rather than silently reading the outer.
    expect(parseFormula('close[1][2]').ok).toBe(false)
    expect(parseFormula('close[1][2]').guard).toBe('canonicalise:offset-chained')
    const chained = {
      type: 'op',
      name: '>',
      args: [
        { type: 'offset', value: 2, args: [{ type: 'offset', value: 1, args: [{ type: 'series', name: 'close' }] }] },
        { type: 'series', name: 'open' },
      ],
    }
    expect(fromAst(chained, VOCAB).guard).toBe('picker:term')
  })
})

describe('🔴 THE SHIPPED STARTERS OPEN IN THE PICKER, and come back as the same tree', () => {
  // ⭐ THE PRODUCT CLAIM, MEASURED ON THE ARTIFACT MEMBERS ACTUALLY MEET. The
  // Library is the builder's default tab and it ships a small number of the
  // firm's own scans; a starter that cannot be opened in the Conditions door is
  // an example that cannot be edited, which is the whole reason the gallery
  // exists. ⛔ READ FROM THE CATALOGUE, so a starter added tomorrow is asserted
  // the day it lands and one retired takes its case with it.
  const STARTERS = readJson('app/src/components/chart/engine/ast/starterScans.json').starters
  const CASES = Object.entries(STARTERS)

  it('the catalogue is not empty — this block would otherwise assert nothing', () => {
    expect(CASES.length).toBeGreaterThan(0)
  })

  it.each(CASES)('%s opens, is canonical, and re-spells to the SAME TREE', (name, entry) => {
    // ⛔ THE FROZEN TREE AND THE SOURCE ARE CHECKED AGAINST EACH OTHER FIRST.
    // Reading one of them alone would let a catalogue whose two halves had
    // drifted pass this case.
    const parsed = parseFormula(entry.source)
    expect(parsed.ok, `${name}: ${entry.source} did not parse — ${parsed.error}`).toBe(true)
    expect(astHash(parsed.ast), `${name}: the frozen tree is not what its source spells`)
      .toBe(astHash(entry.ast))

    const back = fromAst(entry.ast, VOCAB)
    expect(back.ok, `${name} cannot be opened in the picker: ${back.reason}`).toBe(true)
    expect(isCanonical(back.group), name).toBe(true)
    expect(astHash(parseFormula(toSource(back.group)).ast), name).toBe(astHash(entry.ast))
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
    ...Object.keys(TABLE.clock),
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
