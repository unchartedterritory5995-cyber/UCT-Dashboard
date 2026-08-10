import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  sentenceFor, explainSentence, compileRules, coverageGaps, yieldsOf,
  OPERATOR_SENTENCE, OPERATOR_SENTENCE_CONDITIONS, CONDITIONS_FORM_DECLINED,
  SENTENCE_RULES, SentenceRefusal, REFUSALS as SENTENCE_REFUSALS,
} from './sentence.js'
import { parseFormula, astHash, TABLE, REFUSALS as PARSE_REFUSALS, RECURRENCES } from './parse.js'
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

/** phrase → the binding it reads back to. ⛔ TYPED, like every other phrase in
 *  this reader: deriving it from `sentence.js` would make the round trip a
 *  tautology. The BINDING NAME is read from the manifest, because that is a
 *  value this file was handed rather than a phrasing it is here to check. */
const RECURRENCE_PHRASE = Object.freeze({
  'the running value so far': RECURRENCES.accum.binds,
})

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

  // ⭐ THE INDICATOR FORMS (Phase F). Hand-typed like every other phrase in this
  // table, and that is the whole design: this grammar is a DELIBERATE second
  // authority, written from the manifest's words by a reader rather than derived
  // from them, so `swapping a template BREAKS it` can be true. Seventeen new
  // declarations therefore cost seventeen new forms here, and a phrase edited in
  // the manifest without one lands as `0 parses` rather than as a green round
  // trip against a reader that moved with it.
  { kind: 'call', name: 'rsi', parts: ['the ', 1, '-bar RSI of ', 0] },
  { kind: 'call', name: 'macd', parts: ['the ', 1, '/', 2, ' MACD line of ', 0] },
  { kind: 'call', name: 'atr', parts: ['the ', 3, '-bar average true range of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'plusDI', parts: ['the ', 3, '-bar +DI of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'minusDI', parts: ['the ', 3, '-bar -DI of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'stoch', parts: ['the ', 3, '-bar stochastic %K of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'cci', parts: ['the ', 3, '-bar commodity channel index of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'williamsR', parts: ['the ', 3, '-bar Williams %R of ', 0, ', ', 1, ' and ', 2] },
  { kind: 'call', name: 'mfi', parts: ['the ', 4, '-bar money flow index of ', 0, ', ', 1, ', ', 2, ' and ', 3] },
  { kind: 'call', name: 'donchianUpper', parts: ['the top of the ', 2, '-bar Donchian channel over ', 0, ' and ', 1] },
  { kind: 'call', name: 'donchianMiddle', parts: ['the midline of the ', 2, '-bar Donchian channel over ', 0, ' and ', 1] },
  { kind: 'call', name: 'donchianLower', parts: ['the bottom of the ', 2, '-bar Donchian channel over ', 0, ' and ', 1] },
  { kind: 'call', name: 'ichimokuTenkan', parts: ['the Ichimoku conversion line over ', 0, ' and ', 1, ' at ', 2, '/', 3, '/', 4] },
  { kind: 'call', name: 'ichimokuKijun', parts: ['the Ichimoku base line over ', 0, ' and ', 1, ' at ', 2, '/', 3, '/', 4] },
  { kind: 'call', name: 'ichimokuSpanA', parts: ['the Ichimoku leading span A over ', 0, ' and ', 1, ' at ', 2, '/', 3, '/', 4] },
  { kind: 'call', name: 'ichimokuSpanB', parts: ['the Ichimoku leading span B over ', 0, ' and ', 1, ' at ', 2, '/', 3, '/', 4] },
  { kind: 'call', name: 'ichimokuChikou', parts: ['the Ichimoku lagging span of ', 2, ' over ', 0, ' and ', 1, ' at ', 3, '/', 4, '/', 5] },

  // ⭐ THE RECURRENCE FORM. Hand-typed from the manifest's words like every row
  // above, for the same reason: this reader is a DELIBERATE second authority, so
  // re-wording `accum`'s sentence without touching this line must land as `0
  // parses` rather than as a round trip against a grammar that moved with it.
  //
  // ⚠️ IT CONTAINS A BARE ` and `, WHICH IS ALSO `&&`'s CHROME AND `min`/`max`'s.
  // That is safe and it is worth saying why: `matchForm` anchors on the LEADING
  // literal, so the `&&` row can only claim this sentence by reading everything
  // before the ` and ` as an operand — and `the running value that starts at
  // close` is not a leaf, so that candidate is discarded rather than counted.
  // The unambiguity rail below is what actually proves it, over every generated
  // sentence rather than over this argument.
  { kind: 'call', name: 'accum', parts: ['the running value that starts at ', 0, ' and becomes ', 1, ' on each of the last ', 2, ' bars'] },

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

  // ⭐ THE CONDITIONS FORMS, HAND-TYPED LIKE EVERY OTHER PHRASE HERE. A logical
  // operator every one of whose operands already yields `bool` drops the `!= 0`
  // scaffolding, so the grammar has a second reading for `&&` and `||` — and the
  // reader must be able to invert BOTH or the round-trip silently stops covering
  // the smoothed half. ⚠️ They are NOT ambiguous with the unsmoothed forms above:
  // those open with the literal `1 when `, and a smoothed operand is either a
  // LEAF or is bracketed, so `readOperand` refuses the `1 when …` prefix a
  // mis-parse would have to swallow. `the grammar is UNAMBIGUOUS` measures it.
  { kind: 'op', name: '&&', via: 'op:&&:conditions', parts: [0, ' and ', 1] },
  { kind: 'op', name: '||', via: 'op:||:conditions', parts: [0, ' or ', 1] },
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
  // ⭐ THE RECURRENCE BINDING IS A LEAF, AND IT IS NOT IN `TABLE.series`. `self`
  // is bound by the `accum` around it rather than declared, which is exactly why
  // it cannot ride `SERIES_WORDS` — and why the phrase is matched WHOLE here: a
  // prefix match would let "the running value so far plus 1" read as a leaf and
  // swallow its own operator.
  if (own(RECURRENCE_PHRASE, s)) return { type: 'series', name: RECURRENCE_PHRASE[s] }
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

/** ⭐ THE OFFSET FORM, AND IT IS NOT A `FORMS` ROW. Every row above builds
 *  `{type, name, args}`; an offset builds `{type, value, args}` — the bar count
 *  rides ON THE NODE rather than in an operand slot, which is exactly the
 *  property that makes a computed offset inexpressible. So the reader needs its
 *  own clause, hand-typed from `renderOffset`'s words like every other phrase
 *  here, so a re-phrasing there lands as `0 parses` rather than as a reader that
 *  quietly moved with it.
 *
 *  ⚠️ A SUFFIX MATCH, WHICH CANNOT BE AMBIGUOUS WITH THE FORMS ABOVE: a
 *  composite child is bracketed, so anything ending in `) N bars ago` still ends
 *  in the offset's own chrome and nothing else's. */
const OFFSET_SUFFIX = /^(.+) (\d+) (bar|bars) ago$/

function readOffsetSentence(s) {
  const m = OFFSET_SUFFIX.exec(s)
  if (!m) return null
  const value = Number(m[2])
  // The plural has to agree, or `close 1 bars ago` would read as a tree the
  // writer can never produce.
  if (m[3] !== (value === 1 ? 'bar' : 'bars')) return null
  return { via: 'offset', ast: { type: 'offset', value, args: [readOperand(m[1])] } }
}

function readSentenceCandidates(s) {
  const found = []
  try { found.push({ via: 'leaf', ast: readLeaf(s) }) } catch { /* not a leaf */ }
  try {
    const off = readOffsetSentence(s)
    if (off) found.push(off)
  } catch { /* the chrome matched but the child did not read */ }
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
      found.push({
        via: form.via || `${form.kind}:${form.name}`,
        ast: { type: form.kind, name: form.name, args },
      })
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

/** What the MANIFEST says a tree's values can be — a hand-written second reader.
 *
 *  ⭐⭐ AN ORACLE, NOT A CALL. `sentence.js::yieldsOf` is the module's answer and
 *  the chrome's choice depends on it, so a `predictTrace` that asked `yieldsOf`
 *  would agree with the walker no matter what either said. This reads the same
 *  three rules straight off `closedTable`'s `_yields` note instead:
 *
 *    • a `num` literal is a condition iff it is one of the two values a 0/1
 *      column holds;
 *    • a bar series declares no `yields` and is a price, so it is a number; a
 *      scalar's declaration decides;
 *    • `passthrough` — the ternary's, and only the ternary's — is a condition iff
 *      EVERY ARM is, and the arms are the arguments AFTER the selector.
 *
 *  The mutations that prove it is independent are in the harness: resolving the
 *  ternary from ALL of its arguments, or from EITHER arm, both survive a reader
 *  derived from the module and die against this one. */
function oracleYields(node) {
  if (!node || typeof node !== 'object') return 'num'
  if (node.type === 'num') return node.value === 0 || node.value === 1 ? 'bool' : 'num'
  if (node.type === 'series') {
    const spec = own(TABLE.scalars, node.name) ? TABLE.scalars[node.name] : null
    return spec && spec.yields === 'bool' ? 'bool' : 'num'
  }
  const section = node.type === 'op' ? TABLE.operators : TABLE.functions
  const declared = own(section, node.name) ? section[node.name].yields : 'num'
  if (declared !== 'passthrough') return declared === 'bool' ? 'bool' : 'num'
  const arms = (node.args || []).slice(1)
  return arms.length > 0 && arms.every((a) => oracleYields(a) === 'bool') ? 'bool' : 'num'
}

/** Which operators drop the `!= 0` scaffolding, off the module's own second
 *  phrase table — the SET is the module's (it is a vocabulary, like
 *  `OPERATOR_SENTENCE`), the CHOICE is what `oracleYields` re-derives above. */
const hasConditionsForm = (name) => own(OPERATOR_SENTENCE_CONDITIONS, name)

/** The rule sequence a correct walker MUST emit for a tree — re-derived here from
 *  the tree and the manifest, never read back out of `explainSentence`. */
function predictTrace(node, at = '$') {
  if (node.type === 'num') return [{ path: at, rule: 'num' }]
  if (node.type === 'series') {
    return [{ path: at, rule: own(TABLE.series, node.name) ? 'series:table' : 'series:input' }]
  }
  if (node.type === 'offset') {
    // ⚠️ NO `value === 0` BRANCH, and the absence is the point: the parse door
    // FOLDS `x[0]` to `x`, so a zero-bar offset never arrives from a formula. A
    // STORED one still renders as the bare child (see `renderOffset`), and that
    // asymmetry is covered by its own case rather than smuggled in here.
    return [{ path: at, rule: 'offset' },
      ...predictTrace(node.args[0], `${at}.args[0]`)]
  }
  if (node.type === 'op') {
    const smoothed = hasConditionsForm(node.name)
      && node.args.length > 0
      && node.args.every((a) => oracleYields(a) === 'bool')
    const out = [{ path: at, rule: smoothed ? `op:${node.name}:conditions` : `op:${node.name}` }]
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
    // 🔴 …AND THEY STAY PINNED NOW THAT THE LOGICAL CHROME CONSULTS `yields`.
    // `close`, `volume` and `open` are bar fields: the manifest declares no
    // `yields` for a series because a price is a NUMBER, so every reading above
    // is the coercion actually happening and every byte of it must survive.
    // `!` and `?:` are DECLINED (see `CONDITIONS_FORM_DECLINED`), so their
    // readings do not move even when every operand IS a condition:
    expect(sentenceFor(ast('!(close > open)'), {})).toBe(
      '1 when (1 when close is greater than open and 0 otherwise) is zero,'
      + ' 0 when it is not zero, and nothing while it is unknown')
    expect(sentenceFor(ast('(close > open) ? (high > low) : (low > high)'), {})).toBe(
      '(1 when high is greater than low and 0 otherwise) when'
      + ' (1 when close is greater than open and 0 otherwise) is not zero,'
      + ' (1 when low is greater than high and 0 otherwise) when it is zero,'
      + ' and nothing while it is unknown')
    expect(sentenceFor(ast('crossOver(ema(close, 9), ema(close, 21))'), {})).toBe(
      '(the 9-bar exponential average of close) crossing above'
      + ' (the 21-bar exponential average of close)')
    expect(sentenceFor(ast('-close'), {})).toBe('the negative of close')
  })
})

/** A rail's failure message, WITH THE NAMES IN IT.
 *
 *  ⚠️ vitest TRUNCATES a long array in its diff — `[ 'abs', 'change', …(8) ]` —
 *  and a rail whose entire purpose is to NAME the entry that broke must not
 *  depend on a differ's display budget for the one thing it exists to say. This
 *  was measured: the branch-deletion mutations print `[ Array(5) ]` without it. */
const named = (what, list) => (list && list.length ? `${what}: ${list.join(', ')}` : what)

describe('totality over the closed table — derived from the manifest, never hand-listed', () => {
  it('every entry of every section has a read-back, and the gaps are reported BY NAME', () => {
    // ⛔ A FUNCTION WITH NO TEMPLATE RENDERS AS ITS OWN SOURCE, which reads like
    // a sentence and is not one. Derived from the manifest so a new entry lands
    // RED here until somebody writes English for it.
    //
    // ⭐ AND EVERY ROW IS THE WALKER'S OWN ANSWER. `compileRules` renders one
    // minimal tree per declared entry, in every section, and reports the ones
    // that REFUSE — so deleting `renderName`'s series branch, or the `op` or
    // `call` dispatch, turns the matching row red naming its own entries.
    const gaps = coverageGaps()
    expect(gaps.functions, named('these functions have no read-back', gaps.functions)).toEqual([])
    expect(gaps.operators, named('these operators have no read-back', gaps.operators)).toEqual([])
    expect(gaps.series, named('these series cannot be spelled in a sentence', gaps.series)).toEqual([])
    expect(gaps.placeholders,
      named('these templates drop or invent an argument', gaps.placeholders)).toEqual([])
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
    // field on this branch and silently voided an entire clause. 48 is the
    // number `ast_conformance --coverage` asserts; the names are what a rename
    // has to fail against. ⭐ It went 31 -> 48 in Phase F, and the LIST is why
    // that reads as seventeen indicators arriving rather than as a number
    // somebody adjusted. ⭐ 48 -> 49 is `accum`, the recurrence: one entry, and
    // the list is why that reads as bar-to-bar state arriving rather than as a
    // count that drifted.
    const entries = treesForTheWholeTable(TABLE).map((t) => t.entry)
    expect(entries).toEqual([
      'series:close', 'series:high', 'series:low', 'series:open', 'series:volume',
      'operator:!', 'operator:!=', 'operator:&&', 'operator:*', 'operator:+', 'operator:-',
      'operator:/', 'operator:<', 'operator:<=', 'operator:==', 'operator:>', 'operator:>=',
      'operator:?:', 'operator:u-', 'operator:||', 'function:abs',
      // ⭐ THE RECURRENCE. The list is SORTED, so `accum` lands between `abs`
      // and `atr` — not where it was appended in the manifest.
      'function:accum', 'function:atr',
      'function:cci', 'function:change', 'function:crossOver', 'function:crossUnder',
      'function:donchianLower', 'function:donchianMiddle', 'function:donchianUpper',
      'function:ema', 'function:highest', 'function:ichimokuChikou',
      'function:ichimokuKijun', 'function:ichimokuSpanA', 'function:ichimokuSpanB',
      'function:ichimokuTenkan', 'function:lowest', 'function:macd', 'function:max',
      'function:mfi', 'function:min', 'function:minusDI', 'function:plusDI', 'function:rsi',
      'function:sma', 'function:stdev', 'function:stoch', 'function:williamsR',
    ])
    expect(entries.length).toBe(49)
  })

  it('EVERY declared entry renders, is ASCII, and ROUND-TRIPS — by construction', () => {
    // ⭐ TOTALITY, PROVEN GENERATIVELY. "A tree the table can express must never
    // produce a sentence you cannot generate" is a claim about all 31 entries,
    // so every one of them is built from the manifest and put through the full
    // loop. ⛔ The count is asserted against the list above rather than retyped
    // as prose a second time.
    const subjects = treesForTheWholeTable(TABLE)
    expect(subjects.length).toBe(49)
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
    const gaps = coverageGaps()
    expect(gaps.scalars, named('these scalars have no read-back', gaps.scalars)).toEqual([])
    expect(gaps.placeholders,
      named('these templates drop or invent an argument', gaps.placeholders)).toEqual([])
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

// =========================================================================== //
// THE COVERAGE RAIL, IN ALL FOUR SECTIONS — ONE PROBE, NOT FOUR BESPOKE ONES
// =========================================================================== //
//
// ⭐⭐ THE SHAPE OF THE DEFECT, STATED ONCE. `coverageGaps` has four section
// rows, and until `56a2bca6` every one of them asked the DECLARATION — "does
// this entry carry a phrase", "is this name spellable" — which is a question the
// WALKER never asks. So the one class of gap the rail structurally could not
// report was the class that shipped: a whole section `renderName` has no branch
// for. `56a2bca6` converted `scalars` to a probe and left the other three
// deliberately, to keep `gaps.placeholders` byte-identical. This converts them,
// with the SAME loop rather than three of their own.
//
// The proof that a row is a probe and not a re-reading is the same in every
// section: AN ENTRY WHOSE DECLARATION IS COMPLETE, WHICH THE WALKER STILL
// REFUSES, MUST BE NAMED. A "is a phrase declared?" rail calls that entry
// covered.
//
// ⚠️ `series` IS THE ONE SECTION WITH NO SUCH CASE AVAILABLE IN-PROCESS, and
// that is a property of the section rather than a hole in the rail: a series is
// said as its own name, so `SAYABLE` and the walker cannot disagree today. Its
// probe is proven the other way instead — by the branch-deletion mutation the
// brief handed over verbatim (harness M1: delete `renderName`'s series branch
// and this rail names close, high, low, open and volume, where the declarative
// rail stayed `[]`).

/** The probe's section list, READ OFF `sentence.js`'s OWN AST.
 *
 *  ⭐ AST, NEVER A GREP. A grep for `PROBED_SECTIONS` matches the paragraph of
 *  comment above the declaration — this programme has already had a grep report
 *  five call sites where all five were prose. */
function probeSectionShape(tree) {
  let declarators = 0
  let init = 'none'
  let forOfOverIt = 0
  let literalLists = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'VariableDeclarator' && n.id && n.id.name === 'PROBED_SECTIONS') {
      declarators += 1
      const v = n.init
      if (!v) init = 'none'
      else if (v.type === 'ArrayExpression') { init = 'ArrayExpression'; literalLists += 1 }
      else if (v.type === 'CallExpression' && v.callee.type === 'MemberExpression'
        && !v.callee.computed && v.callee.object.name === 'Object'
        && v.callee.property.name === 'keys'
        && v.arguments.length === 1 && v.arguments[0].type === 'Identifier') {
        init = 'Object.keys(<identifier>)'
      } else init = v.type
    }
    if (n.type === 'ForOfStatement' && n.right) {
      if (n.right.type === 'Identifier' && n.right.name === 'PROBED_SECTIONS') forOfOverIt += 1
      if (n.right.type === 'ArrayExpression') literalLists += 1
    }
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
      walk(n[k])
    }
  }
  walk(tree)
  return { declarators, init, forOfOverIt, literalLists }
}

describe('the coverage rail is the WALKER\'s answer in ALL FOUR sections', () => {
  it('every COMPILED section has a rail row, and a FIFTH section could not arrive silently', () => {
    // ⛔ THE ROWS ARE DERIVED FROM THE COMPILED OBJECT, so a section the probe
    // never walks has no row at all rather than an empty one. The four names
    // below are a FLOOR and they are deliberately typed: the day a fifth section
    // is compiled this case goes red and somebody has to look at the probe,
    // which is the failure direction the whole task exists to buy.
    const sections = Object.keys(SENTENCE_RULES).filter((k) => k !== 'gaps')
    expect(sections.slice().sort()).toEqual(['functions', 'operators', 'scalars', 'series'])
    const gaps = coverageGaps()
    expect(Object.keys(gaps).slice().sort())
      .toEqual([...sections, 'placeholders'].sort())
    for (const s of sections) {
      expect(gaps[s], `the ${s} rail reports a name the read-back cannot say`).toEqual([])
    }
  })

  it('🔴 POSITIVE CONTROL — SERIES: a bar field the walker cannot say is NAMED, every one of them', () => {
    // ⛔ WITHOUT THIS, "the series rail is green" is indistinguishable from "the
    // series rail reports nothing". Derived over the declared section, so a
    // sixth bar field is covered the day it lands.
    const declared = Object.keys(TABLE.series)
    expect(declared.length).toBeGreaterThanOrEqual(5)
    for (const name of declared) {
      const table = clone(TABLE)
      // …a space gives the name two readings, which is the one thing a series
      // may not have, and the manifest is otherwise untouched.
      const unsayable = `${name} x`
      table.series[unsayable] = clone(TABLE.series[name])
      delete table.series[name]

      expect(coverageGaps(table, OPERATOR_SENTENCE).series,
        `${name} became unsayable and the rail said nothing`).toEqual([unsayable])
      const rules = compileRules(table, OPERATOR_SENTENCE)
      let caught = null
      try { explainSentence({ type: 'series', name: unsayable }, {}, rules) } catch (e) { caught = e }
      expect(caught, name).toBeInstanceOf(SentenceRefusal)
      expect(caught.guard, name).toBe('sentence:unsayable-name')
    }
    // …AND THE CONTROL: a PLANTED field whose name is fine is clean, so the rail
    // is answering about the gap and not about the table having been rebuilt.
    const clean = clone(TABLE)
    clean.series.zzz_planted_field = { field: 'c' }
    expect(coverageGaps(clean, OPERATOR_SENTENCE).series).toEqual([])
    expect(explainSentence({ type: 'series', name: 'zzz_planted_field' }, {},
      compileRules(clean, OPERATOR_SENTENCE)).text).toBe('zzz_planted_field')
  })

  it('🔴 POSITIVE CONTROL — OPERATORS: a DECLARED phrase the walker refuses is NAMED, all fifteen', () => {
    // ⭐⭐ THE PROBE-vs-DECLARATION PROOF FOR THIS SECTION. Every phrase here is
    // present and non-empty, so a rail that asked "is a phrase declared?" calls
    // the operator COVERED. The walker refuses it — the phrase references an
    // argument the operator does not have — so the probe names it.
    const declared = Object.keys(TABLE.operators)
    expect(declared.length).toBeGreaterThanOrEqual(15)
    for (const name of declared) {
      const phrases = { ...OPERATOR_SENTENCE, [name]: `${OPERATOR_SENTENCE[name]} over {9}` }
      expect(typeof phrases[name], `${name} has no declared phrase to break`).toBe('string')
      const gaps = coverageGaps(TABLE, phrases)
      expect(gaps.operators, `${name} invents an argument and the rail said nothing`)
        .toEqual([name])
      const rules = compileRules(TABLE, phrases)
      const args = []
      for (let i = 0; i < TABLE.operators[name].arity; i++) args.push({ type: 'num', value: 1 })
      let caught = null
      try { explainSentence({ type: 'op', name, args }, {}, rules) } catch (e) { caught = e }
      expect(caught, name).toBeInstanceOf(SentenceRefusal)
      expect(caught.guard, name).toBe('sentence:placeholder')
    }
  })

  it('🔴 POSITIVE CONTROL — FUNCTIONS: a DECLARED phrase the walker refuses is NAMED, every one', () => {
    // ⛔ NO COUNT IN THE TITLE. It said "all eleven" and Phase F declared
    // seventeen more; the loop below was always derived, so the number was
    // decoration that went stale while the assertion stayed correct.
    const declared = Object.keys(TABLE.functions)
    expect(declared.length).toBeGreaterThanOrEqual(11)
    for (const name of declared) {
      const table = clone(TABLE)
      table.functions[name].sentence = `${TABLE.functions[name].sentence} over {9}`
      const gaps = coverageGaps(table, OPERATOR_SENTENCE)
      expect(gaps.functions, `${name} invents an argument and the rail said nothing`)
        .toEqual([name])
      const rules = compileRules(table, OPERATOR_SENTENCE)
      const args = TABLE.functions[name].args.map((kind) => (kind === 'int'
        ? { type: 'num', value: 3 }
        : { type: 'series', name: 'close' }))
      let caught = null
      try { explainSentence({ type: 'call', name, args }, {}, rules) } catch (e) { caught = e }
      expect(caught, name).toBeInstanceOf(SentenceRefusal)
      expect(caught.guard, name).toBe('sentence:placeholder')
    }
  })

  it('…and each section\'s rail answers about ITS OWN section, not the others', () => {
    // ⛔ A RAIL THAT NAMES FOUR SECTIONS WHEN ONE BROKE IS AS USELESS AS ONE THAT
    // NAMES NONE. This is why the probe passes NUMBER LITERALS as arguments
    // rather than borrowing `close`: a function's probe must not depend on the
    // series branch, or deleting that branch would light up every row.
    const table = clone(TABLE)
    table.functions.zzz_planted = { args: ['series'], lookback: 0 }
    table.series['my close'] = { field: 'c' }
    table.scalars.zzz_planted_scalar = { yields: 'num' }
    const phrases = { ...OPERATOR_SENTENCE, '+': '' }
    const gaps = coverageGaps(table, phrases)
    expect(gaps.series).toEqual(['my close'])
    expect(gaps.scalars).toEqual(['zzz_planted_scalar'])
    expect(gaps.operators).toEqual(['+'])
    expect(gaps.functions).toEqual(['zzz_planted'])
  })

  it('the probe sorts its own output, and that sort is load-bearing', () => {
    // 🔬 THE "TWO SORTS" FINDING FROM THIS FILE'S OWN GAUNTLET, ANSWERED RATHER
    // THAN REPEATED. Every row is INSERTED sorted, so re-sorting in the probe
    // reads like a guard nothing can fail. It is not: an INTEGER-LIKE key is
    // emitted by `Object.keys` in ascending NUMERIC order however it was
    // inserted, so a manifest declaring `9` and `10` separates the two orders.
    const table = clone(TABLE)
    table.functions['10'] = { args: ['series'], lookback: 0 }   // no sentence: a gap
    table.functions['9'] = { args: ['series'], lookback: 0 }
    // …the compiled object really is NOT in sorted order for these two.
    expect(Object.keys(compileRules(table, OPERATOR_SENTENCE).functions).slice(0, 2))
      .toEqual(['9', '10'])
    expect(coverageGaps(table, OPERATOR_SENTENCE).functions).toEqual(['10', '9'])
  })

  it('…and a REVERSE-KEYED manifest moves no byte of any rail row', () => {
    const planted = reverseKeys(clone(TABLE))
    planted.functions.zzz_planted = { args: ['series'], lookback: 0 }
    planted.functions.aaa_planted = { args: ['series'], lookback: 0 }
    planted.scalars.zzz_planted_scalar = { yields: 'num' }
    planted.scalars.aaa_planted_scalar = { yields: 'num' }
    planted.series['zzz planted'] = { field: 'c' }
    planted.series['aaa planted'] = { field: 'c' }
    const phrases = reverseKeys({ ...OPERATOR_SENTENCE, '+': '', '*': '' })
    const gaps = coverageGaps(planted, phrases)
    expect(gaps.series).toEqual(['aaa planted', 'zzz planted'])
    expect(gaps.scalars).toEqual(['aaa_planted_scalar', 'zzz_planted_scalar'])
    expect(gaps.operators).toEqual(['*', '+'])
    expect(gaps.functions).toEqual(['aaa_planted', 'zzz_planted'])
  })

  it('⚠️ `gaps.placeholders` is UNMOVED — the one row this conversion had to leave alone', () => {
    // ⛔ PINNED AGAINST A BATTERY, NOT AGAINST THE SHIPPED TABLE ALONE, because
    // on the shipped table the row is `[]` and `[] === []` proves nothing. Every
    // expectation below is the output of `56a2bca6`'s module — the harness
    // re-runs THIS CASE against that `sentence.js` as its control — so this is a
    // pin on the old behaviour and not the new module agreeing with itself.
    //
    // ⚠️ THE ORDER IS PART OF THE PIN: scalars, then operators, then functions,
    // which is the order `compileRules` compiles them in.
    const dropped = clone(TABLE)
    dropped.functions.min.sentence = 'the smaller of {0}'
    const invented = clone(TABLE)
    invented.functions.abs.sentence = 'the absolute value of {0} over {1}'
    const scalarInvented = clone(TABLE)
    scalarInvented.scalars.market_cap.sentence = 'the market capitalisation of {0}'
    const noTemplate = clone(TABLE)
    noTemplate.functions.zzz_planted = { args: ['series'], lookback: 0 }
    delete noTemplate.scalars.rs_rank.sentence
    const everything = clone(TABLE)
    everything.functions.min.sentence = 'the smaller of {0}'
    everything.scalars.market_cap.sentence = 'the market capitalisation of {0}'

    const battery = [
      ['the shipped table', TABLE, OPERATOR_SENTENCE, []],
      ['a function that DROPS an argument', dropped, OPERATOR_SENTENCE,
        ['min: says nothing for argument(s) [1] and invents []']],
      ['a function that INVENTS one', invented, OPERATOR_SENTENCE,
        ['abs: says nothing for argument(s) [] and invents [1]']],
      ['a scalar that INVENTS one', scalarInvented, OPERATOR_SENTENCE,
        ['market_cap: says nothing for argument(s) [] and invents [0]']],
      ['an operator that INVENTS one', TABLE,
        { ...OPERATOR_SENTENCE, '+': '{0} plus {1} over {2}' },
        ['+: says nothing for argument(s) [] and invents [2]']],
      // ⚠️ A MISSING TEMPLATE IS NOT A PLACEHOLDER GAP. It is a section gap, and
      // keeping the two apart is exactly what "byte-identical" means here.
      ['entries with NO template at all', noTemplate, OPERATOR_SENTENCE, []],
      ['a table with no scalars section', { series: {}, operators: {}, functions: {} },
        OPERATOR_SENTENCE, []],
      ['one broken entry in two sections at once', everything, OPERATOR_SENTENCE,
        ['market_cap: says nothing for argument(s) [] and invents [0]',
          'min: says nothing for argument(s) [1] and invents []']],
    ]
    for (const [what, table, phrases, expected] of battery) {
      expect(coverageGaps(table, phrases).placeholders, what).toEqual(expected)
    }
  })

  it('🔴 the probe walks the COMPILED SECTIONS, and that list is not typed here — by AST', async () => {
    const acorn = await import('acorn').catch((e) => {
      // ⛔ A LANE THAT CANNOT BE MEASURED REFUSES; IT NEVER REPORTS ZERO.
      throw new Error(`the structural rail needs a JS parser and \`acorn\` did not import: ${e.message}`)
    })
    const src = readSource('sentence.js')
    expect(src.length).toBeGreaterThan(2000)
    const shape = probeSectionShape(acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(shape.declarators, 'PROBED_SECTIONS is not declared exactly once').toBe(1)
    expect(shape.init, 'the probe\'s section list is typed here instead of derived')
      .toBe('Object.keys(<identifier>)')
    expect(shape.forOfOverIt, 'nothing iterates the derived section list').toBe(1)
    expect(shape.literalLists, 'a hand-listed section list reached the probe').toBe(0)
  })

  it('…and the structural rail can FAIL — the positive control', async () => {
    // ⛔ WITHOUT THIS, the case above is satisfied by a walk that finds nothing.
    const acorn = await import('acorn')
    const handListed = `
      function compileRules() {
        const PROBED_SECTIONS = ['series', 'operators', 'functions']
        for (const section of PROBED_SECTIONS) { void section }
        for (const other of ['a', 'b']) { void other }
      }
    `
    const shape = probeSectionShape(acorn.parse(handListed, { ecmaVersion: 2023, sourceType: 'module' }))
    expect(shape.declarators).toBe(1)
    expect(shape.init).toBe('ArrayExpression')
    expect(shape.forOfOverIt).toBe(1)
    expect(shape.literalLists).toBe(2)
  })
})

// =========================================================================== //
// THE LOGICAL CHROME CONSULTS `yields` — the 0/1 REPRESENTATION STOPS LEAKING
// =========================================================================== //
//
// ⭐⭐ THE DEFECT, STATED ONCE. `closedTable._booleans` says a condition is a 0/1
// column because the table's only literal is a number — an implementation detail
// of the REPRESENTATION — and `&&` therefore coerces both operands with `!= 0`.
// The read-back said so out loud: *"…and whether the recent bars are tightly
// consolidated are both not zero"*. Every one of the six `bool` phrases is
// CORRECT and reads perfectly alone; what was wrong was the chrome, which
// explained the representation to somebody who asked about the maths.
//
// ⛔ AND THE FIX IS NOT A LIST. Which combinations drop the scaffolding is
// derived from the manifest's `yields` key at every operand, so a fifty-fifth
// scalar is covered the day it declares one and no concept and no scalar is
// named anywhere in the mechanism. The cases below are therefore SWEEPS over
// `Object.keys` of each section, with the offenders built into the message.

/** The scalars declaring one `yields`, sorted — derived, never a name list. */
const scalarsYielding = (kind) => Object.keys(TABLE.scalars)
  .filter((n) => TABLE.scalars[n].yields === kind).sort()

/** A declared `bool` scalar to conjoin things with. Picked BY DECLARATION so
 *  this file names no scalar, and so a manifest that retires this one keeps
 *  working while a manifest with no `bool` scalar at all goes red on the floor
 *  asserted in the first case. */
const BOOL_PARTNER = scalarsYielding('bool')[0]

/** Fill a declared phrase's slots. ⚠️ THE EXPECTATION IS DERIVED FROM THE PHRASE
 *  TABLES, NOT RETYPED. Restating chrome the source owns is this repo's most
 *  repeated defect; the BYTES of these phrases are pinned once, in the Phase D
 *  case above and in the oracle's hand-typed `FORMS`. What these cases measure is
 *  WHICH of the two declared phrases the chrome chose. */
const say = (phrase, parts) => phrase.replace(/\{(\d+)\}/g, (_m, d) => parts[Number(d)])

describe('the logical chrome drops `!= 0` when every operand already yields bool', () => {
  it('🔴 THE WORKED EXAMPLE, BYTE FOR BYTE — the sentence the brief handed over', () => {
    // The `bool` scalar inside the logical chrome, before and after, spelled out
    // once. The CLAIM is the derived sweep below; this is the reported defect.
    expect(sentenceFor(ast('rs_rank >= 80 && tight_consolidation'), {})).toBe(
      '(1 when the relative-strength rank is greater than or equal to 80 and 0 otherwise)'
      + ' and whether the recent bars are tightly consolidated')
    expect(sentenceFor(ast('above_50sma && tight_consolidation'), {})).toBe(
      'whether the price is above its 50-day average'
      + ' and whether the recent bars are tightly consolidated')
  })

  it('🔴 THE CONTROL: a `num` operand STILL reads `!= 0` — byte for byte', () => {
    // ⛔ THIS IS THE CASE THAT PROVES THE CHROME WAS NARROWED RATHER THAN
    // DELETED. A number standing in for a condition really is coerced, and a
    // member reading "close and volume" would be reading a semantics this engine
    // does not have (`1 && 2` is 1, not 2). One `num` operand anywhere — even
    // beside a `bool` one — and every byte of the scaffolding stays.
    expect(sentenceFor(ast('close && volume'), {})).toBe(
      '1 when close and volume are both not zero, 0 when either is zero,'
      + ' and nothing while either is unknown')
    expect(sentenceFor(ast('above_50sma && close'), {})).toBe(
      '1 when whether the price is above its 50-day average and close are both not zero,'
      + ' 0 when either is zero, and nothing while either is unknown')
    expect(sentenceFor(ast('close && above_50sma'), {})).toBe(
      '1 when close and whether the price is above its 50-day average are both not zero,'
      + ' 0 when either is zero, and nothing while either is unknown')
    expect(sentenceFor(ast('market_cap && above_50sma'), {})).toBe(
      '1 when the market capitalisation and whether the price is above its 50-day average'
      + ' are both not zero, 0 when either is zero, and nothing while either is unknown')
  })

  it('⭐ ALL 54 SCALARS, DERIVED — the bool ones smooth, the num ones do not', () => {
    // ⭐ THE GENERALISATION. Every declared scalar is conjoined with a declared
    // `bool` scalar and the reading is decided by ITS OWN `yields`. A
    // fifty-fifth scalar is covered the day it is declared, with no edit here.
    const partnerSaid = TABLE.scalars[BOOL_PARTNER].sentence
    const leaked = []
    const stripped = []
    for (const name of Object.keys(TABLE.scalars).sort()) {
      const said = sentenceFor(ast(`${name} && ${BOOL_PARTNER}`), {})
      const parts = [TABLE.scalars[name].sentence, partnerSaid]
      const bool = TABLE.scalars[name].yields === 'bool'
      const want = say(bool ? OPERATOR_SENTENCE_CONDITIONS['&&'] : OPERATOR_SENTENCE['&&'], parts)
      if (said === want) continue
      ;(bool ? leaked : stripped).push(`${name}: ${said}`)
    }
    expect(leaked,
      named('these `bool` scalars still explain the 0/1 representation', leaked)).toEqual([])
    expect(stripped,
      named('these `num` scalars lost the coercion that really happens', stripped)).toEqual([])

    // ⚠️ NON-VACUITY, BOTH HALVES — neither branch may be empty, and the two
    // must be the WHOLE section, so a third `yields` cannot slip past unjudged.
    expect(scalarsYielding('bool').length, 'no bool scalar: the fix half is vacuous')
      .toBeGreaterThanOrEqual(6)
    expect(scalarsYielding('num').length, 'no num scalar: the control half is vacuous')
      .toBeGreaterThanOrEqual(48)
    expect(scalarsYielding('bool').length + scalarsYielding('num').length)
      .toBe(Object.keys(TABLE.scalars).length)
  })

  it('…and every OPERATOR and FUNCTION too, through every declared conditions form', () => {
    // ⭐ THE OTHER THREE SECTIONS, the same way: a comparison declares
    // `yields: "bool"` and smooths; `+` declares `num` and does not; `crossOver`
    // smooths and `sma` does not — none of which is written down here.
    const partnerSaid = TABLE.scalars[BOOL_PARTNER].sentence
    const wrong = []
    let smoothed = 0
    let kept = 0
    for (const op of Object.keys(OPERATOR_SENTENCE_CONDITIONS).sort()) {
      expect(TABLE.operators[op].arity, `${op} is not binary`).toBe(2)
      for (const { entry, ast: tree } of treesForTheWholeTable(TABLE)) {
        if (entry.startsWith('series:')) continue
        const outer = { type: 'op', name: op, args: [tree, { type: 'series', name: BOOL_PARTNER }] }
        const bool = oracleYields(tree) === 'bool'
        const parts = [`(${sentenceFor(tree, {})})`, partnerSaid]
        const want = say(bool ? OPERATOR_SENTENCE_CONDITIONS[op] : OPERATOR_SENTENCE[op], parts)
        const said = sentenceFor(outer, {})
        if (said !== want) wrong.push(`${op} over ${entry} (${bool ? 'bool' : 'num'}): ${said}`)
        else if (bool) smoothed += 1
        else kept += 1
      }
    }
    expect(wrong, named('these entries were read with the wrong form', wrong)).toEqual([])
    // ⚠️ AND BOTH ANSWERS HAPPENED. A sweep where every subject took one branch
    // proves nothing about the other.
    expect(smoothed, 'nothing smoothed — the sweep only exercised the control').toBeGreaterThan(0)
    expect(kept, 'nothing kept the scaffolding — the sweep only exercised the fix')
      .toBeGreaterThan(0)
  })

  it('⭐ the two phrase tables PARTITION the chrome that talks about zero', () => {
    // ⛔ THE `_scalars_excluded` IDIOM, APPLIED TO THE CHROME. A declared list on
    // its own is a list of what somebody remembered; with the identity, a
    // SIXTEENTH operator that reads its operands as conditions lands RED until
    // somebody DECIDES about it. The evidence side is the BASE phrases — the only
    // phrases in this module that mention zero are the four logical ones — and
    // the subject side is the two tables, so nothing here is circular.
    const undecided = (phrases, forms, declined) => Object.keys(phrases)
      .filter((n) => /\bzero\b/.test(phrases[n]) && !own(forms, n) && !own(declined, n)).sort()

    const saysZero = Object.keys(OPERATOR_SENTENCE)
      .filter((n) => /\bzero\b/.test(OPERATOR_SENTENCE[n])).sort()
    expect(saysZero, 'the chrome that reads an operand as a condition has moved')
      .toEqual(['!', '&&', '?:', '||'])

    expect(undecided(OPERATOR_SENTENCE, OPERATOR_SENTENCE_CONDITIONS,
      CONDITIONS_FORM_DECLINED)).toEqual([])
    expect([...Object.keys(OPERATOR_SENTENCE_CONDITIONS),
      ...Object.keys(CONDITIONS_FORM_DECLINED)].sort()).toEqual(saysZero)
    expect(Object.keys(OPERATOR_SENTENCE_CONDITIONS)
      .filter((n) => own(CONDITIONS_FORM_DECLINED, n)),
    'an operator is in BOTH halves of the partition').toEqual([])
    for (const n of [...Object.keys(OPERATOR_SENTENCE_CONDITIONS),
      ...Object.keys(CONDITIONS_FORM_DECLINED)]) {
      expect(Object.keys(TABLE.operators), `${n} is not a declared operator`).toContain(n)
    }
    // …and a DECLINED entry states WHY, in prose long enough to be a reason.
    for (const [n, why] of Object.entries(CONDITIONS_FORM_DECLINED)) {
      expect(typeof why, n).toBe('string')
      expect(why.length, `${n} declines without stating a reason`).toBeGreaterThan(60)
    }
  })

  it('…and the partition rail can FAIL — a sixteenth logical operator is NAMED', () => {
    // ⛔ WITHOUT THIS, "the partition holds" is satisfied by a predicate that
    // finds nothing. The plant's phrase reads its operands against zero and it is
    // in neither half, which is exactly the decision nobody made.
    const undecided = (phrases, forms, declined) => Object.keys(phrases)
      .filter((n) => /\bzero\b/.test(phrases[n]) && !own(forms, n) && !own(declined, n)).sort()
    const planted = { ...OPERATOR_SENTENCE, xor: '1 when exactly one of {0} and {1} is not zero' }
    expect(undecided(planted, OPERATOR_SENTENCE_CONDITIONS, CONDITIONS_FORM_DECLINED))
      .toEqual(['xor'])
    // …and the same plant DECIDED, either way, is clean.
    expect(undecided(planted, { ...OPERATOR_SENTENCE_CONDITIONS, xor: '{0} or {1} but not both' },
      CONDITIONS_FORM_DECLINED)).toEqual([])
    expect(undecided(planted, OPERATOR_SENTENCE_CONDITIONS,
      { ...CONDITIONS_FORM_DECLINED, xor: 'because' })).toEqual([])
  })

  it('🔴 the conditions form is READ OFF THE TABLE — a planted one for `!` is used', () => {
    // ⭐⭐ THE ANTI-HARD-WIRING PROOF. `&&` and `||` are the two the module ships
    // a join for; if the mechanism were wired to those two names, planting a
    // phrase for a DECLINED operator would change nothing. It changes the
    // sentence, and only for the trees whose operands are all conditions.
    const phrases = { ...OPERATOR_SENTENCE_CONDITIONS, '!': 'not {0}' }
    const rules = compileRules(TABLE, OPERATOR_SENTENCE, phrases)
    expect(coverageGaps(TABLE, OPERATOR_SENTENCE, phrases).operators).toEqual([])
    expect(explainSentence(ast('!(close > open)'), {}, rules).text)
      .toBe('not (1 when close is greater than open and 0 otherwise)')
    expect(explainSentence(ast('!(close > open)'), {}, rules).trace[0])
      .toEqual({ path: '$', rule: 'op:!:conditions' })
    // …and the CONTROL: a `num` operand still takes the base phrase, so the
    // plant bought a second reading rather than replacing the first.
    expect(explainSentence(ast('!close'), {}, rules).text).toBe(
      '1 when close is zero, 0 when it is not zero, and nothing while it is unknown')
    // …and the shipped table really does NOT carry it, so the case is about the
    // plant and not about `!` having smoothed all along.
    expect(own(OPERATOR_SENTENCE_CONDITIONS, '!')).toBe(false)
  })

  it('🔴 a BROKEN conditions phrase is a NAMED gap — found by the PROBE, not the declaration', () => {
    // ⭐⭐ THE PROBE-vs-DECLARATION PROOF FOR THE SECOND PHRASE. The base phrase
    // is untouched and perfect, so the operator's `gap` is null and every
    // declaration-derived rail calls it COVERED. The walker refuses the tree
    // whose operands are all conditions, so the probe — which renders BOTH of an
    // operator's phrases — names it.
    const broken = { ...OPERATOR_SENTENCE_CONDITIONS, '&&': '{0} and {1} over {9}' }
    const gaps = coverageGaps(TABLE, OPERATOR_SENTENCE, broken)
    expect(gaps.operators, named('the operators row', gaps.operators)).toEqual(['&&'])
    expect(gaps.placeholders).toEqual(['&&: says nothing for argument(s) [] and invents [9]'])

    const rules = compileRules(TABLE, OPERATOR_SENTENCE, broken)
    // ⛔ AND NO QUIET FALLBACK: the tree that would have used the broken phrase
    // REFUSES rather than degrading to the phrase nobody asked for…
    let caught = null
    try { explainSentence(ast('close > open && high > low'), {}, rules) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(SentenceRefusal)
    expect(caught.guard).toBe('sentence:placeholder')
    // …while the tree that never needed it is untouched.
    expect(explainSentence(ast('close && volume'), {}, rules).text).toBe(
      '1 when close and volume are both not zero, 0 when either is zero,'
      + ' and nothing while either is unknown')
  })

  it('…and a BLANK conditions phrase is a gap too, not an absent one', () => {
    const blank = { ...OPERATOR_SENTENCE_CONDITIONS, '||': '' }
    expect(coverageGaps(TABLE, OPERATOR_SENTENCE, blank).operators).toEqual(['||'])
    expect(coverageGaps(TABLE, OPERATOR_SENTENCE, blank).placeholders)
      .toEqual(['||: says nothing for argument(s) [0, 1] and invents []'])
  })

  it('the TRACE says which form spoke, and a `num` operand moves it back', () => {
    // ⭐ ATTRIBUTION, NOT ONLY OUTPUT. "The sentence is correct" is satisfiable
    // by the wrong branch agreeing today.
    expect(explainSentence(ast('above_50sma && nr7'), {}).trace[0])
      .toEqual({ path: '$', rule: 'op:&&:conditions' })
    expect(explainSentence(ast('above_50sma && close'), {}).trace[0])
      .toEqual({ path: '$', rule: 'op:&&' })
    expect(explainSentence(ast('above_50sma || nr7'), {}).trace[0])
      .toEqual({ path: '$', rule: 'op:||:conditions' })
  })

  it('a fifty-fifth scalar is covered BY ITS DECLARATION — planted, both ways', () => {
    // ⛔ THE ANTI-HAND-LIST PROOF. The plant did not exist when this file was
    // written; its `yields` alone decides how the chrome joins it.
    const base = {
      source: { store: 'screener_rows', column: 'zzz_planted_scalar' },
      as_of: { column: 'bars_asof', grain: 'date' },
      cadence: 'nightly',
      sentence: 'whether the planted probe is wide',
    }
    const partnerSaid = TABLE.scalars[BOOL_PARTNER].sentence
    const tree = {
      type: 'op',
      name: '&&',
      args: [{ type: 'series', name: 'zzz_planted_scalar' },
        { type: 'series', name: BOOL_PARTNER }],
    }

    const asBool = clone(TABLE)
    asBool.scalars.zzz_planted_scalar = { ...base, yields: 'bool' }
    expect(explainSentence(tree, {}, compileRules(asBool, OPERATOR_SENTENCE)).text)
      .toBe(`whether the planted probe is wide and ${partnerSaid}`)

    const asNum = clone(TABLE)
    asNum.scalars.zzz_planted_scalar = { ...base, yields: 'num' }
    expect(explainSentence(tree, {}, compileRules(asNum, OPERATOR_SENTENCE)).text)
      .toBe(say(OPERATOR_SENTENCE['&&'], ['whether the planted probe is wide', partnerSaid]))

    // …and a scalar declaring NO `yields` fails closed to the coercion.
    const undeclared = clone(TABLE)
    undeclared.scalars.zzz_planted_scalar = { ...base }
    expect(explainSentence(tree, {}, compileRules(undeclared, OPERATOR_SENTENCE)).text)
      .toBe(say(OPERATOR_SENTENCE['&&'], ['whether the planted probe is wide', partnerSaid]))
  })

  it('the joined words are still the MANIFEST\'S — reword a scalar and the join follows', () => {
    // ⛔ THE ANTI-SECOND-VOCABULARY PROOF FOR THE SMOOTHED FORM. This module
    // contributes ONE word to the sentence; everything either side of it is the
    // manifest's own phrase, so rewording the manifest must move the join.
    const NONSENSE = 'the wibbly frobnication of a planted gribble'
    const table = clone(TABLE)
    table.scalars[BOOL_PARTNER].sentence = NONSENSE
    const rules = compileRules(table, OPERATOR_SENTENCE)
    const tree = {
      type: 'op',
      name: '&&',
      args: [{ type: 'series', name: BOOL_PARTNER }, { type: 'series', name: BOOL_PARTNER }],
    }
    expect(explainSentence(tree, {}, rules).text).toBe(`${NONSENSE} and ${NONSENSE}`)
  })

  it('`yieldsOf` answers off the manifest — including the ternary\'s ARMS', () => {
    // ⚠️ THE HAND-WRITTEN EXPECTATIONS ARE THE POINT. Every answer below is
    // typed, so a `yieldsOf` rewritten to agree with itself cannot satisfy them.
    const cases = [
      [{ type: 'num', value: 0 }, 'bool'],
      [{ type: 'num', value: 1 }, 'bool'],
      [{ type: 'num', value: 2 }, 'num'],
      [{ type: 'num', value: 0.5 }, 'num'],
      [{ type: 'series', name: 'close' }, 'num'],           // a bar field is a price
      [{ type: 'series', name: 'threshold' }, 'num'],       // an input declares nothing
      [{ type: 'series', name: 'above_50sma' }, 'bool'],
      [{ type: 'series', name: 'market_cap' }, 'num'],
      [ast('close > open'), 'bool'],
      [ast('close + open'), 'num'],
      [ast('crossOver(close, open)'), 'bool'],
      [ast('sma(close, 20)'), 'num'],
      // ⭐ THE ARMS, AND ONLY THE ARMS. The selector's kind is not the answer…
      [ast('close ? 1 : 0'), 'bool'],
      // …and it is EVERY arm, not either: a branch that hands back a price is a
      // number even when the other branch is a flag.
      [ast('close > open ? 1 : close'), 'num'],
      [ast('close > open ? high : low'), 'num'],
      [{ type: 'lambda', name: 'x' }, 'num'],               // outside the four: fail closed
      [null, 'num'],
    ]
    const wrong = []
    for (const [node, want] of cases) {
      const got = yieldsOf(node, SENTENCE_RULES)
      if (got !== want) wrong.push(`${JSON.stringify(node)} → ${got}, wanted ${want}`)
    }
    expect(wrong, named('these trees were classified wrongly', wrong)).toEqual([])
  })

  it('…and every declared entry\'s `yields` reaches the compiled row, derived', () => {
    // ⛔ A ROW THAT LOST ITS `yields` FAILS CLOSED TO `num`, which reads as "the
    // chrome quietly stopped smoothing". Derived over all four sections so a new
    // entry is covered.
    const missing = []
    for (const section of ['scalars', 'operators', 'functions']) {
      for (const name of Object.keys(TABLE[section])) {
        const declared = TABLE[section][name].yields
        const compiled = SENTENCE_RULES[section][name].yields
        if (declared !== compiled) missing.push(`${section}.${name}: ${compiled} != ${declared}`)
      }
    }
    expect(missing, named('these rows lost their declared `yields`', missing)).toEqual([])
    expect(SENTENCE_RULES.operators['?:'].yields).toBe('passthrough')
  })

  it('🔴 the probe\'s TWO arguments are classified differently — by AST, off the source', () => {
    // ⛔ OTHERWISE THE SECOND PROBE IS THE SAME TREE TWICE. `probeTrees` renders
    // an operator's base phrase with `PROBE_ARG` and its conditions phrase with
    // `PROBE_CONDITION_ARG`; if both literals were conditions — which `1` is —
    // the base phrase would never be rendered by the rail at all, silently. The
    // two values are READ OFF `sentence.js`'s own AST rather than typed here, and
    // the judge is `yieldsOf` itself, so the claim is exactly the one that
    // matters: the probe covers both branches of the chrome.
    return import('acorn').then((acorn) => {
      const src = readSource('sentence.js')
      const tree = acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module' })
      const found = {}
      const walk = (n) => {
        if (!n || typeof n !== 'object') return
        if (Array.isArray(n)) { n.forEach(walk); return }
        if (n.type === 'VariableDeclarator' && n.id
          && (n.id.name === 'PROBE_ARG' || n.id.name === 'PROBE_CONDITION_ARG')) {
          // Object.freeze({ type: 'num', value: <literal> })
          const obj = n.init && n.init.arguments && n.init.arguments[0]
          const prop = obj && obj.properties
            && obj.properties.find((p) => p.key && p.key.name === 'value')
          found[n.id.name] = prop && prop.value && prop.value.value
        }
        for (const k of Object.keys(n)) {
          if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
          walk(n[k])
        }
      }
      walk(tree)
      expect(Object.keys(found).sort(), 'the probe no longer declares two arguments')
        .toEqual(['PROBE_ARG', 'PROBE_CONDITION_ARG'])
      expect(typeof found.PROBE_ARG).toBe('number')
      expect(typeof found.PROBE_CONDITION_ARG).toBe('number')
      expect(yieldsOf({ type: 'num', value: found.PROBE_ARG }, SENTENCE_RULES),
        `PROBE_ARG is ${found.PROBE_ARG}, which the chrome reads as a CONDITION — `
        + 'the base phrase is never rendered by the coverage probe').toBe('num')
      expect(yieldsOf({ type: 'num', value: found.PROBE_CONDITION_ARG }, SENTENCE_RULES),
        `PROBE_CONDITION_ARG is ${found.PROBE_CONDITION_ARG}, which is not a condition — `
        + 'the conditions phrase is never rendered by the coverage probe').toBe('bool')
      // …and `PROBE_ARG` must still be a legal `int` window, or every windowed
      // function's probe would refuse for the wrong reason.
      expect(Number.isInteger(found.PROBE_ARG) && found.PROBE_ARG >= 1).toBe(true)
    })
  })

  it('the manifest\'s KEY ORDER cannot reach the CHOICE either', () => {
    const scrambled = compileRules(reverseKeys(clone(TABLE)),
      reverseKeys(clone(OPERATOR_SENTENCE)), reverseKeys(clone(OPERATOR_SENTENCE_CONDITIONS)))
    for (const c of CORPUS.cases) {
      expect(explainSentence(c.ast, {}, scrambled).text, c.id).toBe(sentenceFor(c.ast, {}))
    }
    expect(explainSentence(ast('above_50sma && nr7'), {}, scrambled).text)
      .toBe(sentenceFor(ast('above_50sma && nr7'), {}))
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
    // ⚠️ THIS READING MOVED, DELIBERATELY, and it is the defect rather than a
    // casualty of it: BOTH operands are comparisons, which the manifest declares
    // `yields: "bool"`, so the outer `&& … are both not zero` was explaining the
    // 0/1 representation to a member who asked about the maths.
    const source = 'market_cap > 1e9 && close > sma(close, 50)'
    const parsed = parseFormula(source)
    expect(parsed.ok, String(parsed.error)).toBe(true)
    expect(sentenceFor(parsed.ast, {})).toBe(
      '(1 when the market capitalisation is greater than 1000000000 and 0 otherwise)'
      + ' and (1 when close is greater than (the 50-bar average of close) and 0 otherwise)')
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
      '((1 when the relative-strength rank is greater than 80 and 0 otherwise)'
      + ' and (1 when the average daily range percentage is greater than 4 and 0 otherwise))'
      + ' and (1 when close is greater than (the 50-bar average of close) and 0 otherwise)')

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
      'equality_and_negation', 'unary_minus', 'rsi_overbought', 'rsi_of_a_smoothed_series',
      'macd_line', 'macd_signal_by_composition', 'atr_of_hlc', 'plus_di', 'minus_di',
      'stoch_k', 'stoch_d_by_composition', 'cci_20', 'williams_r', 'mfi_14',
      'donchian_upper', 'donchian_middle', 'donchian_lower', 'ichimoku_tenkan',
      'ichimoku_kijun', 'ichimoku_span_a', 'ichimoku_span_b', 'ichimoku_chikou',
      // ⭐ THE BOUNDED BACKWARD OFFSET (Phase F6). Seven rows, and they are the
      // reason this list moved — separable, by name, from the indicator rows
      // above it, which moved it in the same working tree for a different
      // reason.
      'offset_one_bar', 'offset_zero_is_identity', 'offset_change_idiom',
      'offset_inside_a_reduction', 'offset_of_a_reduction', 'offset_of_a_condition',
      'offset_two_bars_apart',
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
    expect(sentences.length).toBe(CORPUS.cases.length + 49)
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

  it('DELETING the branch a sentence is attributed to changes that sentence — every function', () => {
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
    // ⚠️ 9 -> 12 and 6 -> 7 with the bounded backward offset: the parse door
    // gained `offset-literal`, `offset-forward` and `offset-chained`, and the
    // interpreter gained `interpret:offset` for a STORED tree that never met
    // the parse door. The floor is a count on purpose — a door that stopped
    // contributing messages is named rather than silently shrinking the set.
    expect(Object.keys(PARSE_REFUSALS).length).toBe(12)
    expect(Object.keys(INTERPRET_REFUSALS).length).toBe(9)
    expect(Object.keys(SENTENCE_REFUSALS).length).toBe(10)
    expect(all.length).toBe(31)
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

// ═════════════════════════════════════════════════════════════════════════════
// THE BOUNDED BACKWARD OFFSET — read back in English
// ═════════════════════════════════════════════════════════════════════════════

describe('the bounded backward offset, read back', () => {
  const tree = (source) => {
    const r = parseFormula(source)
    expect(r.ok, `${source}: ${r.error}`).toBe(true)
    return r.ast
  }
  const say = (source) => sentenceFor(tree(source), {})

  it('says it in plain English, and gets the plural right', () => {
    expect(say('close[1]')).toBe('close 1 bar ago')
    expect(say('close[3]')).toBe('close 3 bars ago')
    expect(say('close - close[1]')).toBe('close minus (close 1 bar ago)')
  })

  it('a composite child is bracketed, so the sentence stays re-readable', () => {
    // The one rule that makes a read-back parseable by eye: every composite
    // argument is bracketed, so exactly one form appears at bracket depth zero.
    expect(say('sma(close, 20)[2]'))
      .toBe('(the 20-bar average of close) 2 bars ago')
    expect(say('sma(close[2], 20)'))
      .toBe('the 20-bar average of (close 2 bars ago)')
  })

  it('⛔ a STORED `[0]` reads as the bar itself, not "0 bars ago"', () => {
    // The parse door FOLDS `x[0]` away, so this can only arrive as a stored
    // tree — and "close 0 bars ago" would make a reader stop and work out
    // whether it means today or yesterday.
    expect(say('close[0]')).toBe('close')
    expect(sentenceFor({ type: 'offset', value: 0, args: [{ type: 'series', name: 'close' }] }, {}))
      .toBe('close')
  })

  it('an offset changes WHEN, never WHAT — the result kind passes through', () => {
    // ⛔ Falling to the `num` floor would quietly demote every offset condition
    // out of the boolean lane, and `scan_definition` would then refuse a screen
    // whose formula is plainly a filter.
    expect(yieldsOf(tree('(close > open)[1]'))).toBe(yieldsOf(tree('close > open')))
    expect(yieldsOf(tree('(close > open)[1]'))).toBe('bool')
    expect(yieldsOf(tree('close[1]'))).toBe('num')
  })

  it('a MALFORMED stored offset refuses rather than inventing a phrase', () => {
    for (const bad of [
      { type: 'offset', value: -26, args: [{ type: 'series', name: 'close' }] },
      { type: 'offset', value: 1, args: [] },
    ]) {
      expect(() => explainSentence(bad, {}, SENTENCE_RULES)).toThrow(SentenceRefusal)
    }
  })

  it('the offset rule is NAMED in the trace, so a test can ask which rule spoke', () => {
    const { trace } = explainSentence(tree('close[1]'), {}, SENTENCE_RULES)
    expect(trace.some((t) => t.rule === 'offset')).toBe(true)
  })
})
