import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  sentenceFor, explainSentence, compileRules, coverageGaps,
  OPERATOR_SENTENCE, SENTENCE_RULES, SentenceRefusal, REFUSALS as SENTENCE_REFUSALS,
} from './sentence.js'
import { parseFormula, astHash, TABLE, REFUSALS as PARSE_REFUSALS } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS } from './interpret.js'

/** The repo root, found by walking up — the same helper `budget.test.js`,
 *  `interpret.test.js` and `lint.test.js` use, and it THROWS BY NAME rather than
 *  defaulting, because a helper that returned a default here would make every
 *  fixture-driven case below silently read nothing. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`ast/sentence.test: could not find the repo root from ${process.cwd()}`)
})()

const AST_DIR = path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine', 'ast')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
/** ⚠️ CRLF NORMALISED AT THE DOOR. `core.autocrlf` is on in this checkout, so a
 *  multi-line `\n` anchor otherwise matches zero times — a failure this
 *  programme has now paid for on eight separate tasks. */
const readSource = (file) => fs.readFileSync(path.join(AST_DIR, file), 'utf8').replace(/\r\n/g, '\n')

const CORPUS = readJson('tests/fixtures/ast/corpus.json')

const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)
const clone = (v) => JSON.parse(JSON.stringify(v))

/** A structurally identical object whose keys were INSERTED in reverse order.
 *  Deep-equal to its source and iterated in the opposite direction — which is
 *  the only lever this module has for measuring an insertion-order dependency. */
function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k])
    return out
  }
  return v
}

// =========================================================================== //
// THE ORACLE: a hand-written reader for the SENTENCE GRAMMAR
// =========================================================================== //
//
// ⭐⭐ THIS IS THE ONLY GATE THAT CAN CATCH A SENTENCE THAT IS MERELY PLAUSIBLE,
// AND ITS INDEPENDENCE IS THE WHOLE POINT. Every English phrase below is TYPED
// OUT HERE, by hand, and NOTHING in this section reads `TABLE.functions[…]
// .sentence` or `OPERATOR_SENTENCE`. A reader derived from the template it is
// checking agrees with itself no matter what the template says — the "helper
// REIMPLEMENTS the logic instead of calling it" trap
// [[lesson_mutation_harness_needs_a_control]] names — and the measurement that
// this reader is NOT derived is a mutation: swap `{0}` and `{1}` in a template
// and the round trip must break. It is asserted in-process below
// (`the round trip is NOT self-agreeing`) and again on disk by the gauntlet.
//
// ⚠️ WHAT IT DOES READ FROM THE MANIFEST IS THE SERIES *VOCABULARY* — which bare
// words name a bar field — and that is deliberate: a series is said as its own
// name, so the set of legal bare words is data, not phrasing. Every PHRASE is
// hand-typed. The distinction is what keeps this an oracle rather than a mirror.
//
// ⭐ THE GRAMMAR NEEDS NO PRECEDENCE, because `sentence.js` brackets every
// composite argument. So the chrome of exactly one form appears at bracket depth
// zero, and the reader finds its operands by scanning at depth zero. That claim
// is not assumed — `readSentence` REFUSES a sentence that more than one form
// parses, so an ambiguity anywhere in the corpus or in the generated set fails
// loudly instead of being resolved by declaration order.

const SERIES_WORDS = new Set(Object.keys(TABLE.series))

/** Each form is a chunk list: strings are literal chrome, numbers are argument
 *  positions. The order below is DECLARED rather than incidental — a phrase that
 *  is a prefix of another (`is greater than` inside `is greater than or equal
 *  to`) is tried longest-first — but it is not load-bearing, because a form only
 *  counts as a parse when its operands parse too, and `readSentence` refuses a
 *  tie rather than taking the first. */
const FORMS = [
  { kind: 'call', name: 'ema', parts: ['the ', 1, '-bar exponential average of ', 0] },
  { kind: 'call', name: 'stdev', parts: ['the ', 1, '-bar standard deviation of ', 0] },
  { kind: 'call', name: 'sma', parts: ['the ', 1, '-bar average of ', 0] },
  { kind: 'call', name: 'highest', parts: ['the highest ', 0, ' of the last ', 1, ' bars'] },
  { kind: 'call', name: 'lowest', parts: ['the lowest ', 0, ' of the last ', 1, ' bars'] },
  { kind: 'call', name: 'change', parts: ['the bar-over-bar change in ', 0] },
  { kind: 'call', name: 'abs', parts: ['the absolute value of ', 0] },
  { kind: 'call', name: 'min', parts: ['the smaller of ', 0, ' and ', 1] },
  { kind: 'call', name: 'max', parts: ['the larger of ', 0, ' and ', 1] },
  { kind: 'call', name: 'crossOver', parts: [0, ' crossing above ', 1] },
  { kind: 'call', name: 'crossUnder', parts: [0, ' crossing below ', 1] },

  { kind: 'op', name: '+', parts: [0, ' plus ', 1] },
  { kind: 'op', name: '-', parts: [0, ' minus ', 1] },
  { kind: 'op', name: '*', parts: [0, ' times ', 1] },
  { kind: 'op', name: '/', parts: [0, ' divided by ', 1] },
  { kind: 'op', name: 'u-', parts: ['the negative of ', 0] },
  { kind: 'op', name: '>=', parts: ['1 when ', 0, ' is greater than or equal to ', 1, ' and 0 otherwise'] },
  { kind: 'op', name: '<=', parts: ['1 when ', 0, ' is less than or equal to ', 1, ' and 0 otherwise'] },
  { kind: 'op', name: '>', parts: ['1 when ', 0, ' is greater than ', 1, ' and 0 otherwise'] },
  { kind: 'op', name: '<', parts: ['1 when ', 0, ' is less than ', 1, ' and 0 otherwise'] },
  { kind: 'op', name: '==', parts: ['1 when ', 0, ' equals ', 1, ' and 0 otherwise'] },
  { kind: 'op', name: '!=', parts: ['1 when ', 0, ' does not equal ', 1, ' and 0 otherwise'] },
  {
    kind: 'op',
    name: '&&',
    parts: ['1 when ', 0, ' and ', 1,
      ' are both not zero, 0 when either is zero, and nothing while either is unknown'],
  },
  {
    kind: 'op',
    name: '||',
    parts: ['1 when ', 0, ' or ', 1,
      ' is not zero, 0 when both are zero, and nothing while either is unknown'],
  },
  {
    kind: 'op',
    name: '!',
    parts: ['1 when ', 0, ' is zero, 0 when it is not zero, and nothing while it is unknown'],
  },
  {
    kind: 'op',
    name: '?:',
    parts: [1, ' when ', 0, ' is not zero, ', 2,
      ' when it is zero, and nothing while it is unknown'],
  },
]

function indexAtDepthZero(s, needle, from) {
  let depth = 0
  for (let i = from; i + needle.length <= s.length; i++) {
    const ch = s[i]
    if (ch === '(') { depth += 1; continue }
    if (ch === ')') { depth -= 1; continue }
    if (depth === 0 && s.startsWith(needle, i)) return i
  }
  return -1
}

function matchingClose(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth += 1
    else if (s[i] === ')') { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

function matchForm(parts, s) {
  const slots = {}
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (typeof p === 'string') {
      if (!s.startsWith(p, pos)) return null
      pos += p.length
      continue
    }
    const next = parts[i + 1]
    if (next === undefined) {
      if (pos >= s.length) return null
      slots[p] = s.slice(pos)
      pos = s.length
      continue
    }
    const at = indexAtDepthZero(s, next, pos)
    if (at <= pos) return null                    // an empty slot is a DROPPED term
    slots[p] = s.slice(pos, at)
    pos = at
  }
  return pos === s.length ? slots : null
}

const NUMBER_WORD = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const INPUT_PREFIX = 'the input '

function readLeaf(s) {
  if (s.startsWith(INPUT_PREFIX)) {
    const name = s.slice(INPUT_PREFIX.length)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`not an input name: ${s}`)
    return { type: 'series', name }
  }
  if (SERIES_WORDS.has(s)) return { type: 'series', name: s }
  if (NUMBER_WORD.test(s)) {
    const value = Number(s)
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${s}`)
    return { type: 'num', value }
  }
  throw new Error(`no leaf reads ${JSON.stringify(s)}`)
}

function readOperand(s) {
  if (s.startsWith('(') && matchingClose(s, 0) === s.length - 1) return readSentence(s.slice(1, -1))
  return readLeaf(s)
}

function readSentenceCandidates(s) {
  const found = []
  try { found.push({ via: 'leaf', ast: readLeaf(s) }) } catch { /* not a leaf */ }
  for (const form of FORMS) {
    const slots = matchForm(form.parts, s)
    if (!slots) continue
    try {
      const arity = Math.max(...form.parts.filter((p) => typeof p === 'number')) + 1
      const args = []
      for (let i = 0; i < arity; i++) {
        if (!own(slots, i)) throw new Error(`form ${form.name} never captured argument ${i}`)
        args.push(readOperand(slots[i]))
      }
      found.push({ via: `${form.kind}:${form.name}`, ast: { type: form.kind, name: form.name, args } })
    } catch { /* the chrome matched but the operands did not read */ }
  }
  return found
}

function readSentence(s) {
  const found = readSentenceCandidates(s)
  if (found.length !== 1) {
    throw new Error(
      `the sentence grammar read ${found.length} parses of ${JSON.stringify(s)}`
      + `${found.length ? ` — ${found.map((f) => f.via).join(' | ')}` : ''}`)
  }
  return found[0].ast
}

/** A sentence → the tree it describes. THE INVERSION RAIL'S HALF OF THE PROOF. */
const sentenceToAst = (s) => readSentence(s)

// =========================================================================== //
// helpers derived from the manifest
// =========================================================================== //

const sampleArg = (kind) => (kind === 'int'
  ? { type: 'num', value: 3 }
  : { type: 'series', name: 'close' })

/** ONE MINIMAL TREE PER DECLARED MANIFEST ENTRY, derived by walking the manifest.
 *
 *  ⭐ THIS IS THE TOTALITY PROOF, AND IT IS GENERATIVE RATHER THAN HAND-LISTED.
 *  "A tree the table can express must never produce a sentence you cannot
 *  generate" is a claim about EVERY entry, so the set of subjects is built from
 *  `Object.keys` of each section. A new entry lands here on the day it is
 *  declared, with no edit to this file. */
function treesForTheWholeTable(table) {
  const out = []
  for (const name of Object.keys(table.series).sort()) {
    out.push({ entry: `series:${name}`, ast: { type: 'series', name } })
  }
  for (const name of Object.keys(table.operators).sort()) {
    const arity = table.operators[name].arity
    const args = []
    for (let i = 0; i < arity; i++) args.push({ type: 'num', value: i + 1 })
    out.push({ entry: `operator:${name}`, ast: { type: 'op', name, args } })
  }
  for (const name of Object.keys(table.functions).sort()) {
    out.push({
      entry: `function:${name}`,
      ast: { type: 'call', name, args: table.functions[name].args.map(sampleArg) },
    })
  }
  return out
}

/** The rule sequence a correct walker MUST emit for a tree — re-derived here from
 *  the tree and the manifest, never read back out of `explainSentence`. */
function predictTrace(node, at = '$') {
  if (node.type === 'num') return [{ path: at, rule: 'num' }]
  if (node.type === 'series') {
    return [{ path: at, rule: own(TABLE.series, node.name) ? 'series:table' : 'series:input' }]
  }
  if (node.type === 'op') {
    const out = [{ path: at, rule: `op:${node.name}` }]
    node.args.forEach((a, i) => out.push(...predictTrace(a, `${at}.args[${i}]`)))
    return out
  }
  const spec = TABLE.functions[node.name]
  const out = [{ path: at, rule: `fn:${node.name}` }]
  node.args.forEach((a, i) => {
    const childPath = `${at}.args[${i}]`
    if (spec.args[i] === 'int') out.push({ path: childPath, rule: 'window' })
    else out.push(...predictTrace(a, childPath))
  })
  return out
}

const leavesOf = (node, acc = []) => {
  if (node.type === 'num') acc.push(String(node.value))
  else if (node.type === 'series') acc.push(node.name)
  else for (const a of node.args) leavesOf(a, acc)
  return acc
}

const ast = (source) => {
  const res = parseFormula(source)
  if (!res.ok) throw new Error(`the fixture source did not parse: ${source} — ${res.error}`)
  return res.ast
}

// =========================================================================== //

describe('the read-back is generated from the tree, and never written by a model', () => {
  it('the sentence is generated from the AST, and its phrases come from the MANIFEST', () => {
    // ⭐ THE READ-BACK IS THE ONE THING BETWEEN A USER AND MATHS THEY DID NOT
    // WRITE, and it must therefore be derived from what RUNS.
    expect(sentenceFor(ast('sma(close, 20)'), {})).toBe('the 20-bar average of close')
  })

  it('…and "from the manifest" is a MEASUREMENT: reword the table, and the sentence follows', () => {
    // ⛔ WITHOUT THIS THE CASE ABOVE IS SATISFIED BY A HARD-CODED STRING TABLE
    // inside sentence.js that happens to agree with the manifest today. Rewording
    // `sma` in a CLONE of the manifest must move the sentence — and must move
    // nothing else.
    const table = clone(TABLE)
    table.functions.sma.sentence = 'the mean of {0} across {1} bars'
    const rules = compileRules(table, OPERATOR_SENTENCE)
    expect(explainSentence(ast('sma(close, 20)'), {}, rules).text)
      .toBe('the mean of close across 20 bars')
    expect(explainSentence(ast('ema(close, 9)'), {}, rules).text)
      .toBe('the 9-bar exponential average of close')
  })

  it('a sentence NEVER silently omits a term', () => {
    // A read-back that drops a clause is worse than no read-back: the user
    // confirms a simpler formula than the one that runs.
    const s = sentenceFor(ast('sma(close, 20) - sma(close, 50)'), {})
    expect(s).toContain('20')
    expect(s).toContain('50')
  })

  it('…and that is asserted for EVERY leaf of EVERY corpus case, not one formula', () => {
    expect(CORPUS.cases.length).toBeGreaterThanOrEqual(17)
    for (const c of CORPUS.cases) {
      const s = sentenceFor(c.ast, {})
      const leaves = leavesOf(c.ast)
      expect(leaves.length, `${c.id} has no leaves — the rail would be vacuous`).toBeGreaterThan(0)
      for (const leaf of leaves) {
        expect(s, `${c.id}: the read-back never says ${leaf}`).toContain(leaf)
      }
    }
  })
})

describe('totality over the closed table — derived from the manifest, never hand-listed', () => {
  it('every entry of every section has a read-back, and the gaps are reported BY NAME', () => {
    // ⛔ A FUNCTION WITH NO TEMPLATE RENDERS AS ITS OWN SOURCE, which reads like
    // a sentence and is not one. Derived from the manifest so a new entry lands
    // RED here until somebody writes English for it.
    const gaps = coverageGaps()
    expect(gaps.functions, 'these functions have no read-back').toEqual([])
    expect(gaps.operators, 'these operators have no read-back').toEqual([])
    expect(gaps.series, 'these series cannot be spelled in a sentence').toEqual([])
    expect(gaps.placeholders, 'these templates drop or invent an argument').toEqual([])
  })

  it('…and BOTH DIRECTIONS: no phrase exists for a name the table does not declare', () => {
    // The mirror of the rail above. A phrase for an operator the manifest
    // retired is a vocabulary this module carries alone, which is the exact
    // failure `williams_r`/`williamsR` already cost this repo.
    expect(Object.keys(OPERATOR_SENTENCE).sort()).toEqual(Object.keys(TABLE.operators).sort())
    expect(Object.keys(SENTENCE_RULES.functions).sort()).toEqual(Object.keys(TABLE.functions).sort())
    expect(Object.keys(SENTENCE_RULES.series).sort()).toEqual(Object.keys(TABLE.series).sort())
  })

  it('…and the floor is the ENTRY LIST, not a count — a rename is named', () => {
    // ⚠️ A LIST, NEVER A COUNT. `(d.plots || [])` answered `[]` for a renamed
    // field on this branch and silently voided an entire clause. 31 is the
    // number `ast_conformance --coverage` asserts; the names are what a rename
    // has to fail against.
    const entries = treesForTheWholeTable(TABLE).map((t) => t.entry)
    expect(entries).toEqual([
      'series:close', 'series:high', 'series:low', 'series:open', 'series:volume',
      'operator:!', 'operator:!=', 'operator:&&', 'operator:*', 'operator:+',
      'operator:-', 'operator:/', 'operator:<', 'operator:<=', 'operator:==',
      'operator:>', 'operator:>=', 'operator:?:', 'operator:u-', 'operator:||',
      'function:abs', 'function:change', 'function:crossOver', 'function:crossUnder',
      'function:ema', 'function:highest', 'function:lowest', 'function:max',
      'function:min', 'function:sma', 'function:stdev',
    ])
    expect(entries.length).toBe(31)
  })

  it('EVERY declared entry renders, is ASCII, and ROUND-TRIPS — by construction', () => {
    // ⭐ TOTALITY, PROVEN GENERATIVELY. "A tree the table can express must never
    // produce a sentence you cannot generate" is a claim about all 31 entries,
    // so all 31 are built from the manifest and put through the full loop.
    const subjects = treesForTheWholeTable(TABLE)
    expect(subjects.length).toBe(31)
    for (const { entry, ast: tree } of subjects) {
      const s = sentenceFor(tree, {})
      expect(s, `${entry} rendered an empty sentence`).not.toBe('')
      // ⚠️ ASCII ONLY. cp1252 has already killed a harness's stdout mid-run on
      // this box, and the sentence is stored and byte-compared.
      expect(s, `${entry} put a non-ASCII character in a stored sentence`).toMatch(/^[ -~]+$/)
      expect(astHash(sentenceToAst(s)), `${entry} did not round-trip: ${s}`).toBe(astHash(tree))
    }
  })

  it('a PLANTED entry with no read-back is NAMED — never rendered by a catch-all', () => {
    // ⭐ THE ANTI-HAND-LIST PROOF. The rail has to notice an entry that did not
    // exist when it was written, and the walker has to refuse that entry BY
    // NAME rather than fall through to something that reads like English.
    const table = clone(TABLE)
    table.functions.zzz_planted = { args: ['series'], lookback: 0 }
    table.operators['~~'] = { arity: 2 }
    table.series['my close'] = { field: 'c' }

    const gaps = coverageGaps(table, OPERATOR_SENTENCE)
    expect(gaps.functions).toEqual(['zzz_planted'])
    expect(gaps.operators).toEqual(['~~'])
    expect(gaps.series).toEqual(['my close'])

    const rules = compileRules(table, OPERATOR_SENTENCE)
    const call = { type: 'call', name: 'zzz_planted', args: [{ type: 'series', name: 'close' }] }
    expect(() => explainSentence(call, {}, rules)).toThrow(/zzz_planted/)
    expect(() => explainSentence(call, {}, rules))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:no-template']))

    const binop = { type: 'op', name: '~~', args: [{ type: 'num', value: 1 }, { type: 'num', value: 2 }] }
    expect(() => explainSentence(binop, {}, rules)).toThrow(/~~/)

    const unsayable = { type: 'series', name: 'my close' }
    expect(() => explainSentence(unsayable, {}, rules))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:unsayable-name']))
  })

  it('…and the refusal is about the GAP, not about being planted — the control', () => {
    // ⛔ WITHOUT THIS, "a planted entry is refused" is satisfied by a walker that
    // refuses everything it did not ship with, which would make the table closed
    // against its own owner.
    const table = clone(TABLE)
    table.functions.zzz_planted = { args: ['series'], lookback: 0, sentence: 'the planted read of {0}' }
    expect(coverageGaps(table, OPERATOR_SENTENCE).functions).toEqual([])
    const rules = compileRules(table, OPERATOR_SENTENCE)
    const call = { type: 'call', name: 'zzz_planted', args: [{ type: 'series', name: 'close' }] }
    expect(explainSentence(call, {}, rules).text).toBe('the planted read of close')
  })

  it('a template that DROPS an argument is a gap, not a sentence', () => {
    // The "never silently omits a term" rule as a manifest-level rail: `min`
    // without `{1}` renders perfect English about the wrong maths.
    const table = clone(TABLE)
    table.functions.min.sentence = 'the smaller of {0}'
    expect(coverageGaps(table, OPERATOR_SENTENCE).placeholders).toEqual([
      'min: says nothing for argument(s) [1] and invents []',
    ])
    const rules = compileRules(table, OPERATOR_SENTENCE)
    expect(() => explainSentence(ast('min(close, open)'), {}, rules))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:placeholder']))
  })

  it('…and a template that INVENTS an argument is a gap too', () => {
    const table = clone(TABLE)
    table.functions.abs.sentence = 'the absolute value of {0} over {1}'
    expect(coverageGaps(table, OPERATOR_SENTENCE).placeholders).toEqual([
      'abs: says nothing for argument(s) [] and invents [1]',
    ])
  })
})

describe('the inversion rail — a sentence round-trips to the same maths', () => {
  it('the corpus is the subject, and its case LIST is the floor', () => {
    // ⚠️ `for (const c of CORPUS.cases)` asserts nothing over an empty corpus,
    // and `escaped == parsed` was satisfied by `0 == 0` on this branch until an
    // explicit floor was added. This is that floor, by name.
    expect(CORPUS.cases.map((c) => c.id)).toEqual([
      'sma_of_close', 'nan_propagates', 'float_division', 'compare_with_nan', 'ternary',
      'deep_nest', 'cross', 'cross_under', 'volume_relative', 'lowest_of_low', 'stdev_band',
      'abs_change', 'min_max_envelope', 'strict_less', 'bounds_inclusive',
      'equality_and_negation', 'unary_minus',
    ])
  })

  it('a sentence ROUND-TRIPS to the same maths, for every corpus case', () => {
    for (const c of CORPUS.cases) {
      const s = sentenceFor(c.ast, {})
      expect(astHash(sentenceToAst(s)), `${c.id}: ${s}`).toBe(astHash(c.ast))
    }
  })

  it('the round trip is NOT SELF-AGREEING — swapping a template BREAKS it', () => {
    // ⭐⭐ THE MUTATION THAT PROVES THE RAIL. If this survives, `sentenceToAst`
    // is derived from the template it is checking and the whole rail is vacuous.
    const table = clone(TABLE)
    table.functions.sma.sentence = 'the {0}-bar average of {1}'   // {0} and {1} swapped
    const rules = compileRules(table, OPERATOR_SENTENCE)
    const tree = ast('sma(close, 20)')
    const swapped = explainSentence(tree, {}, rules).text
    expect(swapped).toBe('the close-bar average of 20')
    let sameMaths = false
    try { sameMaths = astHash(sentenceToAst(swapped)) === astHash(tree) } catch { sameMaths = false }
    expect(sameMaths, 'the reader agreed with a swapped template — it is derived from it').toBe(false)
  })

  it('…and swapping an OPERATOR phrase breaks it the same way', () => {
    const phrases = { ...OPERATOR_SENTENCE, '-': '{1} minus {0}' }
    const rules = compileRules(TABLE, phrases)
    const tree = ast('sma(close, 20) - sma(close, 50)')
    const swapped = explainSentence(tree, {}, rules).text
    let sameMaths = false
    try { sameMaths = astHash(sentenceToAst(swapped)) === astHash(tree) } catch { sameMaths = false }
    expect(sameMaths).toBe(false)
  })

  it('the grammar is UNAMBIGUOUS — exactly one form reads each sentence', () => {
    // The claim that makes the reader legitimate: because every composite
    // argument is bracketed, one form's chrome sits at depth zero. Measured over
    // the corpus AND the generated set rather than asserted.
    const sentences = [
      ...CORPUS.cases.map((c) => sentenceFor(c.ast, {})),
      ...treesForTheWholeTable(TABLE).map((t) => sentenceFor(t.ast, {})),
    ]
    expect(sentences.length).toBe(CORPUS.cases.length + 31)
    for (const s of sentences) {
      const found = readSentenceCandidates(s)
      expect(found.map((f) => f.via), `${found.length} parses of: ${s}`).toHaveLength(1)
    }
  })

  it('…and the reader can FAIL — the positive control', () => {
    // ⛔ WITHOUT THIS, `readSentence` could be `() => corpusCase.ast` and every
    // round trip above would be green.
    expect(() => sentenceToAst('the 20-bar average of')).toThrow(/0 parses/)
    expect(() => sentenceToAst('the vibe of close')).toThrow(/0 parses/)
    expect(() => sentenceToAst('the 20-bar average of nonsense')).toThrow(/0 parses/)
  })
})

describe('attribution — WHICH branch produced the sentence, not only what it said', () => {
  it('the trace names the rule behind every piece of the sentence', () => {
    const { text, trace } = explainSentence(ast('sma(close, 20)'), {})
    expect(text).toBe('the 20-bar average of close')
    expect(trace).toEqual([
      { path: '$', rule: 'fn:sma' },
      { path: '$.args[0]', rule: 'series:table' },
      { path: '$.args[1]', rule: 'window' },
    ])
  })

  it('…and the trace agrees with a re-derived walk, for every corpus case', () => {
    for (const c of CORPUS.cases) {
      expect(explainSentence(c.ast, {}).trace, c.id).toEqual(predictTrace(c.ast))
    }
  })

  it('DELETING the branch a sentence is attributed to changes that sentence — all 11 functions', () => {
    // ⭐ THE ANSWER TO "RIGHT FOR THE WRONG REASON". A sentence that is correct
    // proves nothing about which branch made it; a sentence that STOPS being
    // producible when its claimed branch is deleted does. Run over every
    // function the manifest declares, derived, so a new one is covered.
    for (const { entry, ast: tree } of treesForTheWholeTable(TABLE)) {
      if (!entry.startsWith('function:')) continue
      const name = entry.slice('function:'.length)
      expect(explainSentence(tree, {}).trace[0]).toEqual({ path: '$', rule: `fn:${name}` })

      const table = clone(TABLE)
      delete table.functions[name].sentence
      const rules = compileRules(table, OPERATOR_SENTENCE)
      expect(coverageGaps(table, OPERATOR_SENTENCE).functions).toEqual([name])
      expect(() => explainSentence(tree, {}, rules), `${name} still rendered with its rule deleted`)
        .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:no-template']))
    }
  })

  it('…and the same for all 15 operators', () => {
    for (const { entry, ast: tree } of treesForTheWholeTable(TABLE)) {
      if (!entry.startsWith('operator:')) continue
      const name = entry.slice('operator:'.length)
      expect(explainSentence(tree, {}).trace[0]).toEqual({ path: '$', rule: `op:${name}` })

      const phrases = { ...OPERATOR_SENTENCE }
      delete phrases[name]
      expect(coverageGaps(TABLE, phrases).operators).toEqual([name])
      expect(() => explainSentence(tree, {}, compileRules(TABLE, phrases)),
        `${name} still rendered with its phrase deleted`)
        .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:no-template']))
    }
  })

  it('a node type outside the four is REFUSED BY NAME, never rendered by a catch-all', () => {
    // ⛔ THE MANDATORY MUTATION'S TARGET. A `default:` arm that returned a
    // plausible phrase would produce English for a node nobody wrote a rule for.
    const alien = { type: 'lambda', name: 'x', args: [] }
    expect(() => sentenceFor(alien, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:node']))
    expect(() => sentenceFor(alien, {})).toThrow(/"lambda"/)
    expect(() => sentenceFor(alien, {})).toThrow(/num, series, op, call/)
    let guard = null
    try { sentenceFor(alien, {}) } catch (e) { guard = e instanceof SentenceRefusal ? e.guard : 'not-a-refusal' }
    expect(guard).toBe('sentence:node')
  })
})

describe('determinism — the same tree, the same bytes, in any process', () => {
  it('a hundred renders of the same tree are byte-identical', () => {
    const tree = ast('sma(ema(close, 9) - ema(close, 21), 5)')
    const first = sentenceFor(tree, {})
    for (let i = 0; i < 100; i++) expect(sentenceFor(tree, {})).toBe(first)
  })

  it('the manifest\'s KEY ORDER cannot reach the sentence, or the refusal', () => {
    // ⚠️ THE ORDERING HAZARD, MEASURED. `--diff`'s shape summaries on this branch
    // print in per-process hash-seed order, which was proved by two runs on an
    // unchanged tree. This module has exactly two set-valued outputs — the
    // coverage gaps and the "this table declares …" list inside a refusal — and
    // both are sorted. A manifest rebuilt in REVERSE key order must not move a
    // single byte of either.
    const reversed = reverseKeys(clone(TABLE))
    expect(Object.keys(reversed.series)).not.toEqual(Object.keys(TABLE.series))
    const rules = compileRules(reversed, reverseKeys(clone(OPERATOR_SENTENCE)))

    for (const c of CORPUS.cases) {
      expect(explainSentence(c.ast, {}, rules).text, c.id).toBe(sentenceFor(c.ast, {}))
    }

    const unknown = { type: 'series', name: 'nope' }
    const message = (r) => { try { explainSentence(unknown, {}, r) } catch (e) { return e.message } return null }
    expect(message(rules)).toBe(message(SENTENCE_RULES))
    expect(message(SENTENCE_RULES)).toContain('close, high, low, open, volume')

    const planted = reverseKeys(clone(TABLE))
    planted.functions.zzz_planted = { args: ['series'], lookback: 0 }
    planted.functions.aaa_planted = { args: ['series'], lookback: 0 }
    expect(coverageGaps(planted, OPERATOR_SENTENCE).functions).toEqual(['aaa_planted', 'zzz_planted'])
  })

  it('…and the two sorts are SEPARATE, so each is measured separately', () => {
    // 🔬 A FINDING FROM THIS TASK'S OWN GAUNTLET, WRITTEN DOWN AS TWO CASES.
    // The manifest's order is sorted away TWICE — once when `compileRules`
    // INSERTS a row, once when a refusal READS the row set back — so deleting
    // either sort alone leaves the other covering for it and the obvious
    // mutation is a semantic NO-OP. Defence in depth is right and the
    // redundancy stays; what is wrong is a rail that cannot tell which half is
    // load-bearing. So: the insert order is asserted directly, and the read
    // order is asserted against a rules object built out of order by hand.
    const scrambled = compileRules(reverseKeys(clone(TABLE)), OPERATOR_SENTENCE)
    expect(Object.keys(scrambled.series), 'compileRules did not INSERT in sorted order')
      .toEqual(['close', 'high', 'low', 'open', 'volume'])

    const outOfOrder = {
      ...scrambled,
      series: Object.fromEntries(Object.entries(scrambled.series).reverse()),
    }
    expect(Object.keys(outOfOrder.series)).toEqual(['volume', 'open', 'low', 'high', 'close'])
    let message = null
    try { explainSentence({ type: 'series', name: 'nope' }, {}, outOfOrder) } catch (e) { message = e.message }
    expect(message, 'the refusal did not SORT the names it read back')
      .toContain('close, high, low, open, volume')
  })

  it('the INPUTS object\'s key order cannot reach the sentence either', () => {
    const tree = ast('close > threshold')
    const a = sentenceFor(tree, { threshold: 1, other: 2 })
    const b = sentenceFor(tree, { other: 2, threshold: 1 })
    expect(a).toBe(b)
    expect(a).toBe('1 when close is greater than the input threshold and 0 otherwise')
  })

  it('a SHADOWING input never wins — the table is consulted first, by declaration', () => {
    // `interpret` throws outright on a definition whose input shadows a table
    // name, so this only decides what a wiring-defect definition reads back as.
    // What it must NOT do is depend on which object a merge spread second.
    expect(sentenceFor(ast('close'), { close: 5 })).toBe('close')
  })

  it('numbers are spelled by the language, not by a locale', () => {
    expect(sentenceFor({ type: 'num', value: 1234567.5 }, {})).toBe('1234567.5')
    expect(sentenceFor({ type: 'num', value: 1e21 }, {})).toBe('1e+21')
    expect(sentenceFor({ type: 'num', value: -0 }, {})).toBe('0')
  })
})

describe('the refusals', () => {
  it('an unknown name is refused, with the declared names sorted', () => {
    expect(() => sentenceFor({ type: 'series', name: 'globalThis' }, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:name']))
  })

  it('a window that is not a whole-number literal is refused rather than described', () => {
    // The engine refuses `sma(close, close)` at `resolve:window`; a read-back
    // that described it as though it would draw is telling the user about maths
    // that can never run.
    const tree = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'close' }] }
    expect(() => sentenceFor(tree, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:window']))
  })

  it('a call with the wrong number of arguments is refused', () => {
    const tree = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }] }
    expect(() => sentenceFor(tree, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:arity']))
  })

  it('a non-finite number has no read-back', () => {
    expect(() => sentenceFor({ type: 'num', value: NaN }, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:num']))
  })

  it('every refusal message is DISJOINT across all three doors', () => {
    // ⛔ Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
    // deleted, and that has happened in this repo. The union is asserted, not
    // this module alone — and the FLOOR is the count, so a door that stopped
    // contributing messages is named rather than silently shrinking the set.
    const all = [
      ...Object.values(PARSE_REFUSALS),
      ...Object.values(INTERPRET_REFUSALS),
      ...Object.values(SENTENCE_REFUSALS),
    ]
    expect(Object.keys(PARSE_REFUSALS).length).toBe(9)
    expect(Object.keys(INTERPRET_REFUSALS).length).toBe(6)
    expect(Object.keys(SENTENCE_REFUSALS).length).toBe(10)
    expect(all.length).toBe(25)
    for (const a of all) {
      const containing = all.filter((b) => b.includes(a))
      expect(containing, `${JSON.stringify(a)} is a substring of another refusal`).toHaveLength(1)
    }
  })
})

// =========================================================================== //
// the non-measurement assertion: this module is pure, by AST over its own source
// =========================================================================== //

const SELF = path.join(AST_DIR, 'sentence.js')

function scan(tree) {
  const bound = new Set()
  const free = []
  const members = []
  const props = []
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
        bindPattern(node.id); walk(node.init); return
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
        walk(node.superClass); walk(node.body); return
      case 'CatchClause':
        bindPattern(node.param); walk(node.body); return
      case 'MemberExpression':
        if (node.object.type === 'Identifier') {
          members.push(`${node.object.name}.${node.computed ? '[...]' : node.property.name}`)
        }
        if (!node.computed && node.property && node.property.name) props.push(node.property.name)
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
    'Set', 'Map', 'RegExp', 'NaN', 'Infinity', 'undefined', 'arguments',
  ])
  for (const name of new Set(free)) {
    if (!bound.has(name) && !ALLOWED.has(name)) findings.push(`free identifier: ${name}`)
  }
  for (const m of new Set(members)) {
    if (m === 'Math.random' || m === 'Date.now' || m === 'performance.now') findings.push(m)
  }
  // ⚠️ AND A LOCALE CHECK ON TOP, because `String` is ALLOWED and
  // `x.toLocaleString()` is a locale reaching a stored, byte-compared sentence.
  for (const p of new Set(props)) {
    if (/^toLocale/.test(p)) findings.push(`locale formatting: .${p}`)
  }
  return { findings: findings.sort(), imports: imports.sort(), bound, free }
}

describe('sentence.js is a pure function of (ast, inputs) — by AST over its own source', () => {
  it('NO clock, NO locale, NO Intl, NO randomness, NO I/O, NO registry', async () => {
    const acorn = await import('acorn').catch((e) => {
      // ⛔ A LANE THAT CANNOT BE MEASURED REFUSES; IT NEVER REPORTS ZERO.
      throw new Error(`the purity proof needs a JS parser and \`acorn\` did not import: ${e.message}`)
    })
    const src = readSource('sentence.js')
    expect(src.length).toBeGreaterThan(2000)                     // it really read the module
    const got = scan(acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(got.findings, 'sentence.js reached something outside a pure derivation').toEqual([])
    // ⛔ ONE IMPORT, AND IT IS THE TABLE'S OWN PARSER MODULE. Not
    // `nativeRegistry.js`, not the network, not a date. The import closure ends
    // there DELIBERATELY: `parse.js` pulls `jsep` (pinned exact by Task 3) and
    // the manifest JSON, and those two are asserted as its whole import list
    // rather than scanned for purity — a verdict on a 480-line module with typed
    // arrays is not this task's to give, and saying so is better than an
    // allowlist widened until it means nothing.
    expect(got.imports).toEqual(['./parse.js'])
    const parseImports = scan(acorn.parse(readSource('parse.js'), { ecmaVersion: 2023, sourceType: 'module' })).imports
    expect(parseImports).toEqual(['./closedTable.json', 'jsep'])
  })

  it('…and the detector can FAIL — the positive control', async () => {
    // ⛔ WITHOUT THIS, the case above is satisfied by `scan = () => ({findings: []})`.
    const acorn = await import('acorn')
    const dirty = `
      import reg from '../nativeRegistry.js'
      const t = Date.now()
      const r = Math.random()
      export function go(n) {
        fetch('/api/x')
        window.localStorage.setItem('k', String(t))
        return new Intl.NumberFormat().format(n) + n.toLocaleString() + reg + r + import('./late.js')
      }
    `
    const got = scan(acorn.parse(dirty, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(got.findings).toContain('Math.random')
    expect(got.findings).toContain('Date.now')
    expect(got.findings).toContain('dynamic import()')
    expect(got.findings).toContain('free identifier: fetch')
    expect(got.findings).toContain('free identifier: window')
    expect(got.findings).toContain('free identifier: Date')
    expect(got.findings).toContain('free identifier: Intl')
    expect(got.findings).toContain('locale formatting: .toLocaleString')
    expect(got.imports).toEqual(['../nativeRegistry.js'])
  })

  it('…and it is not fooled by a COMMENT — the negative control', async () => {
    // The half a grep gets wrong, in the direction that fails a clean file.
    const acorn = await import('acorn')
    const clean = `
      // Date.now() and Math.random() and Intl and toLocaleString are named here
      const note = 'Date.now Math.random Intl toLocaleString nativeRegistry.js'
      export const go = () => note
    `
    const got = scan(acorn.parse(clean, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(got.findings).toEqual([])
    expect(got.imports).toEqual([])
  })

  it('…and it keeps NO state between calls — the behavioural half', () => {
    const tree = ast('crossOver(ema(close, 9), ema(close, 21))')
    const before = JSON.stringify(tree)
    const a = sentenceFor(tree, {})
    sentenceFor(ast('sma(close, 20)'), { period: 3 })
    const b = sentenceFor(tree, {})
    expect(b).toBe(a)
    expect(JSON.stringify(tree), 'the walker mutated the tree it was handed').toBe(before)
  })
})
