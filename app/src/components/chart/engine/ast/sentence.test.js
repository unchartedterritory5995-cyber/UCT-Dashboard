import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  sentenceFor, explainSentence, compileRules, coverageGaps,
  OPERATOR_SENTENCE, SENTENCE_RULES, SentenceRefusal, REFUSALS as SENTENCE_REFUSALS,
} from './sentence.js'
import { parseFormula, astHash, TABLE, REFUSALS as PARSE_REFUSALS } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS } from './interpret.js'
import { lintRepaint } from './lint.js'
// ⭐ THE DELIVERABLE IS A CHAIN, SO THE CHAIN'S OWN DOORS ARE THE SUBJECT.
// `evaluateFormula` runs parse → lint → budget → READ-BACK and reports
// `ok:false` carrying the read-back's guard when the sentence throws;
// `canSaveFormula` is the gate the Save button reads. Asserting `renderName`
// alone would prove the sentence exists without proving the formula can be
// SAVED, which is the thing that was actually broken.
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

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

  it('⭐ THE PHRASINGS PHASE D PINNED HAVE NOT MOVED — byte for byte', () => {
    // ⛔ NOT AN IMPROVEMENT TARGET, AND THAT IS THE POINT OF PINNING THEM. The
    // four logical forms are deliberately unsmoothed: `&&` is not "and", `?:` is
    // not "if … then … else", each says ALL of its cases, and the NaN case is
    // said as "nothing" because whitespace is what the binder draws. A later
    // task widening the vocabulary must not "tidy" one of these on the way past,
    // so they are bytes here rather than a shape.
    expect(sentenceFor(ast('close && volume'), {})).toBe(
      '1 when close and volume are both not zero, 0 when either is zero,'
      + ' and nothing while either is unknown')
    expect(sentenceFor(ast('close || volume'), {})).toBe(
      '1 when close or volume is not zero, 0 when both are zero,'
      + ' and nothing while either is unknown')
    expect(sentenceFor(ast('!close'), {})).toBe(
      '1 when close is zero, 0 when it is not zero, and nothing while it is unknown')
    expect(sentenceFor(ast('close > open ? high : low'), {})).toBe(
      'high when (1 when close is greater than open and 0 otherwise) is not zero,'
      + ' low when it is zero, and nothing while it is unknown')
    expect(sentenceFor(ast('sma(close, 20)'), {})).toBe('the 20-bar average of close')
    expect(sentenceFor(ast('crossOver(ema(close, 9), ema(close, 21))'), {})).toBe(
      '(the 9-bar exponential average of close) crossing above'
      + ' (the 21-bar exponential average of close)')
    expect(sentenceFor(ast('-close'), {})).toBe('the negative of close')
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

// =========================================================================== //
// THE FOURTH SECTION — the table's PER-SYMBOL SCALARS
// =========================================================================== //
//
// ⭐ THE PHRASE IS THE MANIFEST'S AND THIS MODULE AUTHORS NONE OF IT. A scalar
// declares its own `sentence`, so the chip's plain English, the interpreter's
// column and the linter's reach all come from ONE declaration. Every case below
// is derived from `Object.keys(table.scalars)` — a fifty-fifth scalar is covered
// the day it is declared, with no edit to this file.

/** ONE MINIMAL TREE PER DECLARED SCALAR, derived by walking the manifest.
 *
 *  A scalar rides the `series` node — the canonical node types are still four,
 *  and `parse.js` grew no fifth one for this. */
function scalarTrees(table) {
  return Object.keys(table.scalars).sort().map((name) => ({
    entry: `scalar:${name}`, name, ast: { type: 'series', name },
  }))
}

describe('the scalars — the table says them, and this module says nothing of its own', () => {
  it('EVERY declared scalar renders, in the MANIFEST\'S OWN WORDS — derived, never hand-listed', () => {
    const subjects = scalarTrees(TABLE)
    // ⚠️ A FLOOR, so an empty or renamed section could not make this vacuous.
    expect(subjects.length).toBe(Object.keys(TABLE.scalars).length)
    expect(subjects.length).toBeGreaterThanOrEqual(54)
    for (const { entry, name, ast: tree } of subjects) {
      const { text, trace } = explainSentence(tree, {})
      expect(text, `${entry} did not say the manifest's own sentence`)
        .toBe(TABLE.scalars[name].sentence)
      expect(text, `${entry} rendered an empty sentence`).not.toBe('')
      // ⚠️ ASCII ONLY — the sentence is stored and byte-compared, and this box
      // has already produced one cp1252 failure of exactly that family.
      expect(text, `${entry} put a non-ASCII character in a stored sentence`).toMatch(/^[ -~]+$/)
      // ⭐ ATTRIBUTION, NOT ONLY OUTPUT. A scalar said by the INPUT branch would
      // read identically today and diverge the moment inputs are seeded.
      expect(trace, `${entry} was not attributed to the scalar branch`)
        .toEqual([{ path: '$', rule: 'series:scalar' }])
    }
  })

  it('…and `coverageGaps` reports the scalars section BY NAME, and it is empty', () => {
    // The same rail the other three sections have: a scalar nobody wrote English
    // for is NAMED here rather than discovered by a member typing it.
    expect(coverageGaps().scalars, 'these scalars have no read-back').toEqual([])
    expect(coverageGaps().placeholders, 'these templates drop or invent an argument').toEqual([])
  })

  it('the sentence comes from the TABLE — proved with a PLANTED synthetic', () => {
    // ⭐⭐ THE ANTI-SECOND-VOCABULARY PROOF. The planted phrase is nonsense that
    // exists nowhere in this repo, so a module carrying its own phrase table
    // would ignore the plant and a module that READS the table cannot.
    const NONSENSE = 'the wibbly frobnication of a planted gribble'
    const table = clone(TABLE)
    table.scalars.zzz_planted_scalar = {
      source: { store: 'screener_rows', column: 'zzz_planted_scalar' },
      as_of: { column: 'snapshot_date', grain: 'date' },
      cadence: 'nightly',
      yields: 'num',
      sentence: NONSENSE,
    }
    const rules = compileRules(table, OPERATOR_SENTENCE)
    const tree = { type: 'series', name: 'zzz_planted_scalar' }
    expect(explainSentence(tree, {}, rules).text).toBe(NONSENSE)
    expect(explainSentence(tree, {}, rules).trace).toEqual([{ path: '$', rule: 'series:scalar' }])
    // …verbatim INSIDE a composite too, not only alone.
    expect(explainSentence(
      { type: 'op', name: '>', args: [tree, { type: 'num', value: 1 }] }, {}, rules).text)
      .toBe(`1 when ${NONSENSE} is greater than 1 and 0 otherwise`)
    // THE CONTROL: against the REAL table that same name is unknown, so the
    // case above is about the PLANT and not about the walker rendering anything.
    expect(() => sentenceFor(tree, {}))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:name']))
  })

  it('…and REWORDING a shipped scalar moves its sentence, and moves nothing else', () => {
    const table = clone(TABLE)
    table.scalars.market_cap.sentence = 'how big the company is'
    const rules = compileRules(table, OPERATOR_SENTENCE)
    expect(explainSentence({ type: 'series', name: 'market_cap' }, {}, rules).text)
      .toBe('how big the company is')
    expect(explainSentence({ type: 'series', name: 'rs_rank' }, {}, rules).text)
      .toBe(TABLE.scalars.rs_rank.sentence)
    expect(explainSentence(ast('sma(close, 20)'), {}, rules).text)
      .toBe('the 20-bar average of close')
  })

  it('a scalar with NO declared sentence is a NAMED gap and REFUSES — every one of them', () => {
    // ⛔ AND IT NEVER FALLS BACK TO THE COLUMN NAME. `market_cap` is not English
    // and a member cannot confirm it, so an entry nobody wrote a read-back for
    // is refused BY NAME — the same rule the functions live under. Derived over
    // the whole section, so a new scalar is covered without an edit here.
    for (const { entry, name, ast: tree } of scalarTrees(TABLE)) {
      const table = clone(TABLE)
      delete table.scalars[name].sentence
      expect(coverageGaps(table, OPERATOR_SENTENCE).scalars, `${entry} was not reported as a gap`)
        .toEqual([name])
      const rules = compileRules(table, OPERATOR_SENTENCE)
      let caught = null
      try { explainSentence(tree, {}, rules) } catch (e) { caught = e }
      expect(caught, `${entry} still rendered with its sentence deleted`)
        .toBeInstanceOf(SentenceRefusal)
      expect(caught.guard, entry).toBe('sentence:no-template')
      expect(caught.message, entry).toContain(JSON.stringify(name))
    }
  })

  it('…and a scalar phrase that INVENTS an argument is a gap too — a scalar takes none', () => {
    const table = clone(TABLE)
    table.scalars.market_cap.sentence = 'the market capitalisation of {0}'
    const gaps = coverageGaps(table, OPERATOR_SENTENCE)
    expect(gaps.placeholders).toEqual([
      'market_cap: says nothing for argument(s) [] and invents [0]',
    ])
    // 🔴 AND THE PROOF THAT THE SCALAR RAIL IS THE WALKER'S ANSWER, NOT A
    // SECOND READING OF THE DECLARATION. This scalar HAS a `sentence`, so a rail
    // that only asked "is a phrase declared?" would call it covered. The walker
    // refuses it, so the rail names it.
    expect(gaps.scalars).toEqual(['market_cap'])
    const rules = compileRules(table, OPERATOR_SENTENCE)
    expect(() => explainSentence({ type: 'series', name: 'market_cap' }, {}, rules))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:placeholder']))
  })

  it('🔴 THE POSITIVE CONTROL: a PLANTED scalar with no sentence is NAMED by the rail', () => {
    // ⛔ WITHOUT THIS, "the rail is green" is indistinguishable from "the rail
    // reports nothing", which is the state this whole task exists to end. The
    // plant did not exist when the rail was written and the rail has to name it.
    const table = clone(TABLE)
    table.scalars.zzz_planted_unsayable = {
      source: { store: 'screener_rows', column: 'zzz_planted_unsayable' },
      as_of: { column: 'snapshot_date', grain: 'date' },
      cadence: 'nightly',
      yields: 'num',
      // …and NO `sentence`. Nobody wrote English for it.
    }
    expect(coverageGaps(table, OPERATOR_SENTENCE).scalars).toEqual(['zzz_planted_unsayable'])
    // …and the CONTROL for the control: the same plant WITH a sentence is clean,
    // so the rail is answering about the gap and not about being planted.
    table.scalars.zzz_planted_unsayable.sentence = 'the planted per-symbol value'
    expect(coverageGaps(table, OPERATOR_SENTENCE).scalars).toEqual([])
    expect(explainSentence({ type: 'series', name: 'zzz_planted_unsayable' }, {},
      compileRules(table, OPERATOR_SENTENCE)).text).toBe('the planted per-symbol value')
  })

  it('…and the rail is ONE derivation — `compileRules().gaps` IS what `coverageGaps` returns', () => {
    // ⛔ TWO LISTS THAT AGREE TODAY ARE TWO LISTS. The runtime refusal and the
    // rail must be the same answer, or the day they disagree the rail is the one
    // that stays green.
    const table = clone(TABLE)
    delete table.scalars.rs_rank.sentence
    expect(compileRules(table, OPERATOR_SENTENCE).gaps.scalars)
      .toEqual(coverageGaps(table, OPERATOR_SENTENCE).scalars)
    expect(coverageGaps(table, OPERATOR_SENTENCE).scalars).toEqual(['rs_rank'])
  })

  it('🔴 a genuinely UNDECLARED name STILL refuses at `sentence:name`', () => {
    // ⛔ THE OTHER DIRECTION, AND IT IS THE HALF A FIX LIKE THIS LOSES. Teaching
    // the read-back a fourth section must not buy a false ACCEPTANCE: a typo, a
    // retired column and a prototype property all have to stay refusals.
    for (const name of ['market_cap_typo', 'zzz_not_declared', 'globalThis', 'toString', 'constructor']) {
      let guard = null
      try { sentenceFor({ type: 'series', name }, {}) } catch (e) { guard = e.guard }
      expect(guard, `${name} was rendered instead of refused`).toBe('sentence:name')
    }
  })

  it('…and the refusal NAMES BOTH VOCABULARIES, sorted — because it used to name a false one', () => {
    // ⚠️ THE BUG'S SECOND HALF. The message said "this table declares close,
    // high, low, open, volume" while the table declared fifty-four more names,
    // so the refusal was telling the member something untrue about the table.
    let message = null
    try { sentenceFor({ type: 'series', name: 'nope' }, {}) } catch (e) { message = e.message }
    expect(message).toContain('close, high, low, open, volume')
    expect(message, 'the refusal does not name the scalars the table declares')
      .toContain(Object.keys(TABLE.scalars).sort().join(', '))
    expect(message).toContain('market_cap')
    expect(message).toContain('no inputs')
  })

  it('a scalar and an input by the SAME name: the TABLE wins, by declaration', () => {
    // `interpret` throws outright on a definition whose input shadows a table
    // name, so this only decides what a wiring-defect definition reads back as.
    // What it must NOT do is depend on which object a merge spread second.
    expect(sentenceFor({ type: 'series', name: 'market_cap' }, { market_cap: 5 }))
      .toBe(TABLE.scalars.market_cap.sentence)
    // …and a name the table does NOT declare still reads as the input it is.
    expect(sentenceFor({ type: 'series', name: 'threshold' }, { threshold: 5 }))
      .toBe('the input threshold')
  })

  it('the scalars are INSERTED sorted, like every other set-valued output here', () => {
    const scrambled = compileRules(reverseKeys(clone(TABLE)), OPERATOR_SENTENCE)
    expect(Object.keys(scrambled.scalars), 'compileRules did not INSERT in sorted order')
      .toEqual(Object.keys(TABLE.scalars).sort())
    for (const { name, ast: tree } of scalarTrees(TABLE)) {
      expect(explainSentence(tree, {}, scrambled).text).toBe(TABLE.scalars[name].sentence)
    }
  })

  it('a rules object with NO scalars section does not crash — it refuses, as it always did', () => {
    // ⚠️ `compileRules` NEVER THROWS, and neither does a walk handed a rules
    // object a test built by hand. The failure direction is the old refusal.
    const noScalars = { ...SENTENCE_RULES, scalars: undefined }
    expect(() => explainSentence({ type: 'series', name: 'market_cap' }, {}, noScalars))
      .toThrow(new RegExp(SENTENCE_REFUSALS['sentence:name']))
    expect(() => compileRules({ series: {}, operators: {}, functions: {} }, OPERATOR_SENTENCE))
      .not.toThrow()
  })
})

describe('🔴 the deliverable: `market_cap > 1e9` parses, lints, READS BACK — and is saveable', () => {
  const SOURCE = 'market_cap > 1e9'
  const SAID = '1 when the market capitalisation is greater than 1000000000 and 0 otherwise'

  it('the whole chain, end to end, through the doors the builder actually calls', () => {
    const parsed = parseFormula(SOURCE)
    expect(parsed.ok, `the source did not parse: ${parsed.error}`).toBe(true)

    const verdict = lintRepaint(parsed.ast, { inputs: BUILDER_INPUT_SCOPE })
    expect(verdict.mode).toBe('non-repainting')
    expect(verdict.reasons.join(' ')).not.toContain('unanalysable')

    expect(sentenceFor(parsed.ast, BUILDER_INPUT_SCOPE)).toBe(SAID)

    // ⭐ AND THE SAVE DOOR ITSELF, not a re-implementation of it. Before this
    // fix the chain died right here at `sentence:name`, `ok` was false, and
    // `canSaveFormula` answered false — the formula was unsayable and therefore
    // UNSAVEABLE. That is the whole defect, asserted as the whole chain.
    const result = evaluateFormula(SOURCE, BUILDER_INPUT_SCOPE)
    expect(result.guard, String(result.error)).toBe(null)
    expect(result.ok).toBe(true)
    expect(result.readback).toBe(SAID)
    expect(result.verdict.mode).toBe('non-repainting')
    expect(canSaveFormula(result), 'the save gate still refuses a scalar formula').toBe(true)
  })

  it('…and the read-back is STRUCTURALLY one comparison whose left side is the MANIFEST\'s phrase', () => {
    // The oracle's operator chrome is hand-typed up top; the leaf phrase is data
    // over in the manifest. So this is not the module agreeing with itself — it
    // is an independently-written reader finding the table's own words in the
    // slot where the tree put the scalar.
    const form = FORMS.find((f) => f.kind === 'op' && f.name === '>')
    const slots = matchForm(form.parts, sentenceFor(parseFormula(SOURCE).ast, {}))
    expect(slots, 'the read-back is not one comparison at bracket depth zero').not.toBe(null)
    expect(slots[0]).toBe(TABLE.scalars.market_cap.sentence)
    expect(slots[1]).toBe('1000000000')
  })

  it('…and a scalar COMPOSES with a bar series in one sentence, and that saves too', () => {
    const source = 'market_cap > 1e9 && close > sma(close, 50)'
    const parsed = parseFormula(source)
    expect(parsed.ok, String(parsed.error)).toBe(true)
    expect(sentenceFor(parsed.ast, {})).toBe(
      '1 when (1 when the market capitalisation is greater than 1000000000 and 0 otherwise)'
      + ' and (1 when close is greater than (the 50-bar average of close) and 0 otherwise)'
      + ' are both not zero, 0 when either is zero, and nothing while either is unknown')
    expect(canSaveFormula(evaluateFormula(source, BUILDER_INPUT_SCOPE))).toBe(true)
  })

  it('🔴 THE PHASE\'S OWN ACCEPTANCE TREE reads back — it could not be said at all', () => {
    // ⭐ E-5a MEASURED THIS FROM THE OTHER SIDE: `definition_concierge.propose`
    // returns the `sentence:name` refusal as its WHOLE answer, so this phase's
    // acceptance criterion — the tree the concierge is supposed to propose and a
    // member is supposed to confirm — was unsayable and therefore unproposable.
    const source = 'rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)'
    const parsed = parseFormula(source)
    expect(parsed.ok, String(parsed.error)).toBe(true)

    const said = sentenceFor(parsed.ast, BUILDER_INPUT_SCOPE)
    // Both scalar phrases are the MANIFEST'S, verbatim, inside one sentence.
    expect(said).toContain(TABLE.scalars.rs_rank.sentence)
    expect(said).toContain(TABLE.scalars.adr_pct.sentence)
    expect(said).toBe(
      '1 when (1 when (1 when the relative-strength rank is greater than 80 and 0 otherwise)'
      + ' and (1 when the average daily range percentage is greater than 4 and 0 otherwise)'
      + ' are both not zero, 0 when either is zero, and nothing while either is unknown)'
      + ' and (1 when close is greater than (the 50-bar average of close) and 0 otherwise)'
      + ' are both not zero, 0 when either is zero, and nothing while either is unknown')

    const result = evaluateFormula(source, BUILDER_INPUT_SCOPE)
    expect(result.guard, String(result.error)).toBe(null)
    expect(result.readback).toBe(said)
    expect(canSaveFormula(result), 'the acceptance tree is still unsaveable').toBe(true)
    expect(lintRepaint(parsed.ast, { inputs: BUILDER_INPUT_SCOPE }).mode).toBe('non-repainting')
  })

  it('…and EVERY declared scalar is saveable the same way — derived over the section', () => {
    // ⭐ THE DELIVERABLE IS NOT ONE FORMULA. `market_cap` is the worked example;
    // the claim is about the section, so the section is the subject.
    const failures = []
    for (const { name } of scalarTrees(TABLE)) {
      const source = `${name} > 0`
      const result = evaluateFormula(source, BUILDER_INPUT_SCOPE)
      if (!result.ok || !canSaveFormula(result)) {
        failures.push(`${name}: ${result.guard || 'not saveable'} ${result.error || ''}`.trim())
        continue
      }
      if (!result.readback.includes(TABLE.scalars[name].sentence)) {
        failures.push(`${name}: the read-back does not carry the manifest's own phrase`)
      }
    }
    expect(failures, 'these declared scalars cannot be said, so they cannot be saved').toEqual([])
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
