// ─── THE READ-BACK: ONE ENGLISH SENTENCE, DERIVED FROM THE TREE ─────────────
//
// ⛔ THIS FUNCTION IS THE ONLY PRODUCER OF THE TEXT A USER CONFIRMS, and the
// concierge is FORBIDDEN from writing that text. A model-written summary of a
// model-written formula is two guesses agreeing, and the user has no way to tell
// that pair apart from a correct one. So the sentence is `sentenceFor(ast)`:
// deterministic, derived from the tree, and never written by a model.
//
// ⭐ THE VOCABULARY IS `closedTable.json`, AND TOTALITY IS DERIVED FROM IT.
// Every function's phrasing is the manifest's own `sentence` field, so the
// chip's plain English and the interpreter's dispatch come from ONE declaration.
// The coverage rail below walks `Object.keys` of each manifest section — it is
// never a hand-list, because a rail built on a list is a list, and DPC's four
// constants rode outside one for a rule's entire life.
//
// ⚠️ THE OPERATOR PHRASES LIVE HERE AND THAT IS NOT A SECOND VOCABULARY.
// The manifest declares operators by NAME and ARITY only — it has no `sentence`
// field for them — so the English has to live somewhere, and this file owns two
// files' worth of nothing else. What matters is that the TOTALITY is derived:
// `compileRules` iterates the manifest's operator keys and reports any name with
// no phrase BY NAME. A new operator lands red here until somebody writes English
// for it. (Moving these into the manifest is a manifest-owner decision, not this
// module's; see `_no_offset_reopened_by` for the shape of that rule.)
//
// ⭐⭐ THE ENGLISH DOES NOT IMPLY BOOLEAN SEMANTICS, BECAUSE THE ENGINE DOES NOT
// IMPLEMENT THEM. The manifest's `_booleans` decision, implemented in
// `interpret.js`, is unlike both host languages:
//   * `1 && 2` is **1**, not 2, and `0 || 5` is **1**, not 5;
//   * truthiness is `x !== 0`, so `!5` is **0**;
//   * **NaN propagates** through `&&`, `||`, `!` and `?:` — the opposite of both
//     JS (`!NaN === true`) and Python (`not nan is False`);
//   * a **comparison** against NaN is **0**, so a comparison column really is
//     total over `{0, 1}` and never carries an unknown.
// So `&&` is NOT said as "and", and `?:` is NOT said as "if … then … else":
// both of those import a semantics this engine does not have. Each of the four
// is said with all of its cases, and the NaN case is said as "nothing", which is
// what the binder actually draws (whitespace). A construct that cannot be said
// honestly in one clause is said in three rather than smoothed into one.
//
// ⚠️ NO CLOCK, NO LOCALE, NO `Intl`, NO RANDOMNESS, NO NETWORK, NO REGISTRY.
// The sentence is compared against a committed string in a test and rendered
// into a stored definition, so a locale-sensitive number format would make it
// machine-dependent — and this box has already produced one cp1252 failure and
// one CRLF failure of exactly that family. `sentence.test.js` proves it
// STRUCTURALLY, by AST over this file's own source, because a grep for `Date`
// matches the word in a comment.
//
// ⚠️ EVERY SET-VALUED OUTPUT IS SORTED. Two things this module emits are sets of
// names — the coverage gaps and the "this table declares …" list inside a
// refusal — and an insertion-ordered emission would make the text depend on the
// manifest's key order rather than on its content. That is the ordering hazard
// this file has, it is the only one, and `sentence.test.js` measures it by
// rendering through a manifest whose keys were rebuilt in reverse order.

import { TABLE, NODE_TYPES } from './parse.js'

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** The read-back saying it cannot say something. Carries the guard that fired.
 *
 *  ⚠️ A THIRD CLASS, deliberately distinct from `parse.js`'s and
 *  `interpret.js`'s `TableRefusal`. The three doors refuse different things —
 *  shapes a tree may not have, names a tree may not reach, and trees this module
 *  has no English for — and one shared class would let a deletion in one be
 *  covered by a test of another. */
export class SentenceRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'SentenceRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s AND `interpret.js`'s SETS TOO —
 *  no message here is a substring of any message there, or of any other message
 *  here. Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
 *  deleted, and that has happened in this repo. `sentence.test.js` asserts the
 *  disjointness over the union of all three modules. */
export const REFUSALS = Object.freeze({
  'sentence:node':
    'this read-back has no rule for that node shape',
  'sentence:num':
    'a read-back cannot spell a number that is not finite',
  'sentence:name':
    'the read-back cannot name a value the table does not declare',
  'sentence:unsayable-name':
    'the read-back cannot spell a name that is not a plain word',
  'sentence:function':
    'the read-back has no rule for a function outside the table',
  'sentence:operator':
    'the read-back has no phrase for that operator',
  'sentence:arity':
    'the read-back was handed a call with the wrong argument count',
  'sentence:window':
    'the read-back cannot spell a window that is not a whole number',
  'sentence:no-template':
    'the table declares this entry and nobody wrote its read-back',
  'sentence:placeholder':
    'the read-back template leaves an argument unsaid',
})

function refuse(guard, detail) {
  throw new SentenceRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

/** ⛔ THE ONLY WAY THIS MODULE ASKS WHETHER A NAME EXISTS. `name in obj` walks
 *  the prototype chain and `obj[name]` returns whatever it finds there — which
 *  is how `toString` becomes a series in a text box. */
const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

/** ⚠️ SORTED, ALWAYS. See the header: this is one of the two set-valued outputs
 *  and the only reason the sentence surface is manifest-order independent. */
const sortedKeys = (obj) => Object.keys(obj).sort()

/** A name this module is willing to put in a sentence. A name with a space in it
 *  would make the read-back ambiguous — "the smaller of my close and open" has
 *  two readings — so it is REFUSED BY NAME rather than rendered into a sentence
 *  nobody can parse back. */
const SAYABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

// --------------------------------------------------------------------------- //
// the operator phrases
// --------------------------------------------------------------------------- //

/** operator name → its English, with `{k}` for argument position k.
 *
 *  ⭐ THE FOUR LOGICAL FORMS SAY ALL THREE OF THEIR CASES. `&&` is not "and"
 *  and `?:` is not "if"; see the header for why. The comparison forms say only
 *  two cases and that is not an omission — a comparison against NaN is 0, so a
 *  comparison column is total over `{0, 1}` and there is no third case to say.
 *
 *  ⚠️ ASCII ONLY. An em dash here would be a cp1252 hazard on this box, and the
 *  sentence is written into a stored definition and compared byte-for-byte. */
export const OPERATOR_SENTENCE = Object.freeze({
  '+': '{0} plus {1}',
  '-': '{0} minus {1}',
  '*': '{0} times {1}',
  '/': '{0} divided by {1}',
  '>': '1 when {0} is greater than {1} and 0 otherwise',
  '<': '1 when {0} is less than {1} and 0 otherwise',
  '>=': '1 when {0} is greater than or equal to {1} and 0 otherwise',
  '<=': '1 when {0} is less than or equal to {1} and 0 otherwise',
  '==': '1 when {0} equals {1} and 0 otherwise',
  '!=': '1 when {0} does not equal {1} and 0 otherwise',
  '&&': '1 when {0} and {1} are both not zero, 0 when either is zero, and nothing while either is unknown',
  '||': '1 when {0} or {1} is not zero, 0 when both are zero, and nothing while either is unknown',
  'u-': 'the negative of {0}',
  '!': '1 when {0} is zero, 0 when it is not zero, and nothing while it is unknown',
  '?:': '{1} when {0} is not zero, {2} when it is zero, and nothing while it is unknown',
})

// --------------------------------------------------------------------------- //
// compiling the rules FROM the manifest
// --------------------------------------------------------------------------- //

/** Which argument positions a phrase actually says. Returns `null` when the
 *  phrase says every position exactly the once it must and invents none.
 *
 *  ⭐ THIS IS THE "NEVER SILENTLY OMITS A TERM" RULE, AS A DERIVED CHECK. A
 *  template that forgets `{1}` renders a sentence that reads perfectly and
 *  describes a simpler formula than the one that runs, which is worse than no
 *  read-back at all. The arity it is checked against is the MANIFEST's, so a
 *  function that gains an argument fails here without this file moving. */
function placeholderGap(phrase, arity) {
  const seen = new Set()
  const re = /\{(\d+)\}/g
  let m
  while ((m = re.exec(phrase)) !== null) seen.add(Number(m[1]))
  const missing = []
  for (let i = 0; i < arity; i++) if (!seen.has(i)) missing.push(i)
  const extra = [...seen].filter((i) => i >= arity).sort((a, b) => a - b)
  if (missing.length === 0 && extra.length === 0) return null
  return `says nothing for argument(s) [${missing.join(', ')}] and invents [${extra.join(', ')}]`
}

/** The manifest, compiled into the three lookup tables the walker uses.
 *
 *  ⛔ EVERY DECLARED ENTRY GETS A ROW, INCLUDING THE BROKEN ONES. An entry with
 *  no phrase is NOT left out — it is carried with a `gap`, so a tree that uses it
 *  is refused BY NAME (`sentence:no-template`) instead of falling through to
 *  "unknown function", which would read like the table never declared it. The
 *  same rows are what `coverageGaps` reports, so the rail and the runtime refusal
 *  are ONE derivation rather than two that can drift.
 *
 *  ⚠️ NEVER THROWS. The module has to load for the coverage rail to be able to
 *  report a gap; a `compileRules` that threw on a bad manifest would make the
 *  gap unmeasurable, which is the failure mode a coverage rail exists to end. */
export function compileRules(table = TABLE, operatorPhrases = OPERATOR_SENTENCE) {
  const series = Object.create(null)
  const operators = Object.create(null)
  const functions = Object.create(null)
  const gaps = { series: [], operators: [], functions: [], placeholders: [] }

  for (const name of sortedKeys(table.series)) {
    const gap = SAYABLE.test(name) ? null : 'unsayable'
    if (gap) gaps.series.push(name)
    series[name] = Object.freeze({ gap })
  }

  for (const name of sortedKeys(table.operators)) {
    const spec = table.operators[name]
    const arity = spec && typeof spec.arity === 'number' ? spec.arity : 0
    const phrase = own(operatorPhrases, name) ? operatorPhrases[name] : undefined
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
      gaps.operators.push(name)
    } else {
      const bad = placeholderGap(phrase, arity)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    operators[name] = Object.freeze({ phrase, arity, gap })
  }

  for (const name of sortedKeys(table.functions)) {
    const spec = table.functions[name]
    const args = spec && Array.isArray(spec.args) ? spec.args.slice() : []
    const phrase = spec && spec.sentence
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
      gaps.functions.push(name)
    } else {
      const bad = placeholderGap(phrase, args.length)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    functions[name] = Object.freeze({ phrase, args: Object.freeze(args), gap })
  }

  return Object.freeze({
    series: Object.freeze(series),
    operators: Object.freeze(operators),
    functions: Object.freeze(functions),
    gaps: Object.freeze({
      series: Object.freeze(gaps.series),
      operators: Object.freeze(gaps.operators),
      functions: Object.freeze(gaps.functions),
      placeholders: Object.freeze(gaps.placeholders),
    }),
  })
}

/** Every manifest entry this module has no English for, BY NAME.
 *
 *  ⚠️ A LIST, NEVER A COUNT. A count survives a rename — `(d.plots || [])`
 *  answered `[]` for a renamed field on this branch and silently voided an entire
 *  clause — and the whole point of this rail is that a NEW table entry is named
 *  in the failure message of the test that goes red. */
export function coverageGaps(table = TABLE, operatorPhrases = OPERATOR_SENTENCE) {
  return compileRules(table, operatorPhrases).gaps
}

// --------------------------------------------------------------------------- //
// rendering
// --------------------------------------------------------------------------- //

const isLeaf = (n) => !!n && typeof n === 'object' && (n.type === 'num' || n.type === 'series')

/** ⚠️ `String(n)`, NEVER `toLocaleString` AND NEVER `Intl`. ECMAScript pins
 *  Number-to-String exactly; a locale format would put a comma in a thousands
 *  separator on one machine and a period on another, and the sentence is
 *  compared byte-for-byte against a committed string. */
function spellNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    refuse('sentence:num', `at ${path}: got ${JSON.stringify(value) ?? String(value)}`)
  }
  return String(value)
}

/** An `int` argument is a `num` LITERAL or nothing, exactly as `interpret.js`
 *  requires. A tree whose window is a computed column is a tree the engine
 *  refuses to run, and a read-back that described it as though it were fine would
 *  be telling the user about maths that will never draw. */
function spellWindow(node, fnName, index, path, trace) {
  if (!node || typeof node !== 'object' || node.type !== 'num'
      || typeof node.value !== 'number' || !Number.isInteger(node.value) || node.value < 1) {
    refuse('sentence:window',
      `at ${path}: ${fnName} argument ${index} — got `
      + `${JSON.stringify(node && node.type === 'num' ? node.value : node) ?? String(node)}`)
  }
  trace.push({ path, rule: 'window' })
  return String(node.value)
}

/** Fill a phrase's `{k}` slots, and refuse a phrase that drops or invents one.
 *
 *  ⭐ THE SECOND HALF OF "NEVER SILENTLY OMITS A TERM", AT RENDER TIME. The
 *  compile-time check reads the manifest's declared arity; this reads the ACTUAL
 *  argument list of the node in hand, so the two cannot both be satisfied by a
 *  tree whose arity disagrees with its declaration. */
function fill(phrase, parts, what, path) {
  const used = new Set()
  const text = phrase.replace(/\{(\d+)\}/g, (_m, digits) => {
    const i = Number(digits)
    if (i >= parts.length) {
      refuse('sentence:placeholder',
        `at ${path}: the ${what} read-back references {${i}} and there is no such argument`)
    }
    used.add(i)
    return parts[i]
  })
  if (used.size !== parts.length) {
    const missing = []
    for (let i = 0; i < parts.length; i++) if (!used.has(i)) missing.push(i)
    refuse('sentence:placeholder',
      `at ${path}: the ${what} read-back never says argument(s) ${missing.join(', ')}`)
  }
  return text
}

function refuseGap(gap, kind, name, path) {
  if (gap === 'no-template') {
    refuse('sentence:no-template', `at ${path}: the ${kind} ${JSON.stringify(name)}`)
  }
  refuse('sentence:placeholder', `at ${path}: the ${kind} ${JSON.stringify(name)} ${gap}`)
}

/** A sub-expression, PARENTHESISED unless it is a leaf.
 *
 *  ⭐ THE ONE RULE THAT MAKES THE SENTENCE RE-READABLE. Because every composite
 *  argument is bracketed, the chrome of exactly one form appears at bracket depth
 *  zero in any sentence — so the grammar needs no precedence and a reader can
 *  find the operands by scanning at depth zero. `sentence.test.js` measures that
 *  claim: exactly one form parses each of the sentences it generates. */
function renderArg(node, rules, inputs, depth, path, trace) {
  const inner = renderNode(node, rules, inputs, depth + 1, path, trace)
  return isLeaf(node) ? inner : `(${inner})`
}

function renderName(node, rules, inputs, path, trace) {
  const name = node.name
  if (typeof name !== 'string') {
    refuse('sentence:node', `at ${path}: a series node carries a name; got ${JSON.stringify(name) ?? String(name)}`)
  }
  // ⛔ THE TABLE IS CONSULTED FIRST AND THE ORDER IS LOAD-BEARING. A definition
  // whose input shadows `close` is a wiring defect `interpret` throws on
  // outright; what the read-back must not do is let the ANSWER depend on which
  // object a merge happened to spread second.
  if (own(rules.series, name)) {
    if (rules.series[name].gap) {
      refuse('sentence:unsayable-name', `at ${path}: the series ${JSON.stringify(name)}`)
    }
    trace.push({ path, rule: 'series:table' })
    return name
  }
  if (own(inputs, name)) {
    if (!SAYABLE.test(name)) {
      refuse('sentence:unsayable-name', `at ${path}: the input ${JSON.stringify(name)}`)
    }
    trace.push({ path, rule: 'series:input' })
    return `the input ${name}`
  }
  refuse('sentence:name',
    `at ${path}: ${JSON.stringify(name)} — this table declares ${sortedKeys(rules.series).join(', ')}`
    + ` and this definition declares ${sortedKeys(inputs).join(', ') || 'no inputs'}`)
}

function renderOp(node, rules, inputs, depth, path, trace) {
  const name = node.name
  if (typeof name !== 'string' || !own(rules.operators, name)) {
    refuse('sentence:operator',
      `at ${path}: ${JSON.stringify(name)} — this table declares `
      + `${sortedKeys(rules.operators).join(', ')}`)
  }
  const rule = rules.operators[name]
  if (rule.gap) refuseGap(rule.gap, 'operator', name, path)
  if (!Array.isArray(node.args)) {
    refuse('sentence:node', `at ${path}: an op node carries an args array; got ${JSON.stringify(node.args)}`)
  }
  if (node.args.length !== rule.arity) {
    refuse('sentence:arity', `at ${path}: ${name} takes ${rule.arity}, got ${node.args.length}`)
  }
  trace.push({ path, rule: `op:${name}` })
  const parts = node.args.map((arg, i) =>
    renderArg(arg, rules, inputs, depth, `${path}.args[${i}]`, trace))
  return fill(rule.phrase, parts, `operator ${name}`, path)
}

function renderCall(node, rules, inputs, depth, path, trace) {
  const name = node.name
  if (typeof name !== 'string' || !own(rules.functions, name)) {
    refuse('sentence:function',
      `at ${path}: ${JSON.stringify(name)} — this table declares `
      + `${sortedKeys(rules.functions).join(', ')}`)
  }
  const rule = rules.functions[name]
  if (rule.gap) refuseGap(rule.gap, 'function', name, path)
  if (!Array.isArray(node.args)) {
    refuse('sentence:node', `at ${path}: a call node carries an args array; got ${JSON.stringify(node.args)}`)
  }
  if (node.args.length !== rule.args.length) {
    refuse('sentence:arity', `at ${path}: ${name} takes ${rule.args.length}, got ${node.args.length}`)
  }
  trace.push({ path, rule: `fn:${name}` })
  const parts = []
  for (let i = 0; i < node.args.length; i++) {
    const childPath = `${path}.args[${i}]`
    parts.push(rule.args[i] === 'int'
      ? spellWindow(node.args[i], name, i, childPath, trace)
      : renderArg(node.args[i], rules, inputs, depth, childPath, trace))
  }
  return fill(rule.phrase, parts, `function ${name}`, path)
}

function renderNode(node, rules, inputs, depth, path, trace) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    refuse('sentence:node', `at ${path}: got ${JSON.stringify(node) ?? String(node)}`)
  }
  switch (node.type) {
    case 'num':
      trace.push({ path, rule: 'num' })
      return spellNumber(node.value, path)
    case 'series':
      return renderName(node, rules, inputs, path, trace)
    case 'op':
      return renderOp(node, rules, inputs, depth, path, trace)
    case 'call':
      return renderCall(node, rules, inputs, depth, path, trace)
    default:
      // ⛔ NOT A FALLTHROUGH TO SOMETHING PLAUSIBLE. A catch-all that returned
      // "the value" would produce English for a node type nobody wrote a rule
      // for — a sentence that is right for the wrong reason, which is the defect
      // this branch has now cost four separate tasks. The trace is what makes
      // that assertable: a test can ask WHICH rule produced a sentence, not only
      // what the sentence said.
      return refuse('sentence:node',
        `at ${path}: node type ${JSON.stringify(node.type)} — the canonical types are `
        + `${NODE_TYPES.join(', ')}`)
  }
}

// --------------------------------------------------------------------------- //
// the public door
// --------------------------------------------------------------------------- //

/** The manifest, compiled once. Recompiled per call would be the same answer for
 *  a frozen table and a wasted walk; a test that needs a DIFFERENT table calls
 *  `compileRules` itself and hands the result to `explainSentence`. */
export const SENTENCE_RULES = compileRules()

/** The sentence AND the identity of every rule that produced a piece of it.
 *
 *  ⭐ THE TRACE IS A GATE, NOT A DEBUG AID. "The sentence is correct" is
 *  satisfiable by a fallback branch that happens to say the right thing; "the
 *  sentence was produced by `fn:sma`, and deleting `fn:sma`'s template changes
 *  it" is not. Pre-order — a node before its arguments, arguments left to right —
 *  so the trace is itself a deterministic serialisation of the tree.
 *
 *  @param {object} ast    a canonical tree (`parse.js::canonicalise`'s output)
 *  @param {object} inputs the definition's declared inputs, by name
 *  @param {object} [rules] a compiled rule set; defaults to the manifest's
 *  @returns {{text: string, trace: ReadonlyArray<{path: string, rule: string}>}}
 */
export function explainSentence(ast, inputs, rules = SENTENCE_RULES) {
  const scope = inputs && typeof inputs === 'object' ? inputs : Object.create(null)
  const trace = []
  const text = renderNode(ast, rules, scope, 0, '$', trace)
  return Object.freeze({ text, trace: Object.freeze(trace.map((e) => Object.freeze(e))) })
}

/** An AST → one English sentence, deterministically.
 *
 *  Throws `SentenceRefusal` for a tree this module has no English for. It does
 *  NOT return a placeholder string: a read-back that quietly degrades is a read-
 *  back the user cannot rely on, and the caller's failure state is a red dot with
 *  the message in the tooltip, not a plausible sentence about the wrong maths.
 *
 *  @param {object} ast
 *  @param {object} [inputs]
 *  @returns {string}
 */
export function sentenceFor(ast, inputs) {
  return explainSentence(ast, inputs, SENTENCE_RULES).text
}
