// app/src/components/chart/builder/editor/languages.js
//
// ─── FOUR TOKENIZERS, ONE VOCABULARY AUTHORITY ───────────────────────────────
//
// ⛔ THE FORMULA DIALECT'S NAMES ARE READ OFF THE CLOSED TABLE AT MODULE LOAD —
// never typed here. `parse.js` configures jsep from the same manifest, so a name
// this file colours as a function is a name the parser will resolve, and the day
// W2a lands `vwap()` — or the `clock` section the closed-table v2 contract names —
// it colours without a line of this file changing. The three foreign dialects
// carry their OWN keyword sets (they are foreign languages), but the names that
// map onto OUR table are read off the translator maps.
//
// ⚠️ `StreamLanguage` REJECTS a bare `'function'` token name ("Modifier function
// used at start of tag" — measured 2026-08-25), so every tokenizer declares the
// `tokenTable` below and returns its keys.
//
// ⚠️ EVERY `StreamLanguage.define` MINTS A NEW `Document` NODE TYPE into
// @codemirror/language's global type array (`docID`, measured in 6.12.4 — token
// types are cached by tag, the top node is not). The formula tokenizer depends on
// the declared input NAMES and nothing else, so it is memoised on that set: the
// same inputs hand back the same instance, and an editor re-rendering per
// keystroke leaks nothing.

import { StreamLanguage, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import jsep from 'jsep'
import { TABLE } from '../../engine/ast/parse'
import { PINE_CALL_SHAPES } from '../../engine/ast/pine'
import { PCF_FUSED, PCF_VOCABULARY, priceLetters } from '../../engine/ast/pcf'

export const DIALECTS = Object.freeze(['formula', 'pine', 'thinkscript', 'pcf'])

/** token name → lezer tag. The keys are the ONLY strings a tokenizer may return. */
const TOKEN_TABLE = Object.freeze({
  fn: tags.function(tags.variableName),
  series: tags.variableName,
  scalar: tags.propertyName,
  input: tags.special(tags.variableName),
  let: tags.definition(tags.variableName),
  literal: tags.bool,
  unknown: tags.invalid,
  keyword: tags.keyword,
  namespace: tags.namespace,
  string: tags.string,
  comment: tags.lineComment,
  operator: tags.operator,
  punctuation: tags.punctuation,
  number: tags.number,
  name: tags.name,
})

/** The class map `CodeEditor` hands in comes from its CSS module; tests hand in
 *  plain names. A key the map lacks styles NOTHING for that token — a missing
 *  class is a bare span, never a thrown editor. */
export function highlightStyle(classes) {
  const map = classes || {}
  return HighlightStyle.define(
    Object.keys(TOKEN_TABLE)
      .filter((key) => typeof map[key] === 'string' && map[key])
      .map((key) => ({ tag: TOKEN_TABLE[key], class: map[key] })),
  )
}

/** Every name the FORMULA dialect colours, read off ONE table. Sections are read
 *  BY NAME so a section the manifest lacks today is an empty set, not a throw:
 *  `clock` (series-kind, closed-table v2) is empty until W2a lands it and the
 *  real set the day it does. */
export function vocabularyOf(table) {
  const section = (name) => Object.freeze(new Set(Object.keys((table && table[name]) || {})))
  return Object.freeze({
    series: section('series'),
    clock: section('clock'),
    functions: section('functions'),
    scalars: section('scalars'),
    operators: section('operators'),
    // The parser's own literals, kept to the ones the manifest's `_booleans` note
    // says canonicalise (a boolean is a 0/1 number; `null` is not a column).
    // Filtered by TYPE rather than by name: jsep's factory set also carries
    // `null`, which parse.js removes at configure time, and this reads the same
    // two words whether or not this module shares the parser's jsep instance.
    literals: Object.freeze(new Set(Object.keys(jsep.literals).filter((k) => typeof jsep.literals[k] === 'boolean'))),
  })
}

export const FORMULA_VOCAB = vocabularyOf(TABLE)

const WORD = /^[A-Za-z_][A-Za-z0-9_]*/
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const BRACKETS = /^[(),[\]]/

/** The canonical operator NAMES spell unary minus `u-` and the ternary `?:`
 *  (manifest `_shape`); on the page they are `-`, `?` and `:`. Longest first so
 *  `>=` wins over `>`. */
function operatorSymbols(names) {
  const out = new Set()
  for (const op of names) {
    if (op === 'u-') out.add('-')
    else if (op === '?:') { out.add('?'); out.add(':') }
    else out.add(op)
  }
  return [...out].sort((a, b) => b.length - a.length)
}

function matchSymbol(stream, symbols) {
  for (const sym of symbols) if (stream.match(sym)) return true
  return false
}

// ── the formula dialect ─────────────────────────────────────────────────────

function defineFormula(declared, vocab) {
  const symbols = operatorSymbols(vocab.operators)
  return StreamLanguage.define({
    name: 'uct-formula',
    tokenTable: TOKEN_TABLE,
    startState: () => ({ lets: new Set(), afterLet: false, awaitingEq: false }),
    copyState: (s) => ({ lets: new Set(s.lets), afterLet: s.afterLet, awaitingEq: s.awaitingEq }),
    token(stream, state) {
      if (stream.eatSpace()) return null
      // `awaitingEq` spans exactly ONE token — the binding name to its `=`.
      const awaitingEq = state.awaitingEq
      state.awaitingEq = false
      if (stream.match(WORD)) {
        const w = stream.current()
        if (w === 'let') {
          // The binding form is line-initial; `let` anywhere else is an ordinary unknown name.
          if (!/^\s*let$/.test(stream.string.slice(0, stream.pos))) return 'unknown'
          state.afterLet = true
          return 'keyword'
        }
        if (state.afterLet) {
          state.afterLet = false
          state.awaitingEq = true
          state.lets.add(w)
          return 'let'
        }
        if (state.lets.has(w)) return 'let'
        if (vocab.functions.has(w)) return 'fn'
        if (vocab.series.has(w) || vocab.clock.has(w)) return 'series'
        if (vocab.scalars.has(w)) return 'scalar'
        if (vocab.literals.has(w)) return 'literal'
        if (declared.has(w)) return 'input'
        return 'unknown'
      }
      // Only the identifier IMMEDIATELY after `let` is the binding.
      state.afterLet = false
      if (stream.match(NUMBER)) return 'number'
      // The table's operators run FIRST so `==` — which the manifest DOES declare —
      // can never be split by the `=` branch below.
      if (matchSymbol(stream, symbols)) return 'operator'
      // ⛔ THE BINDING `=` IS THE LET FORM'S OWN SYNTAX, NOT A TABLE OPERATOR.
      // `TABLE.operators` declares no `=`, and this file derives its symbol list
      // from that section alone — so without this branch the `=` on every correct
      // `let` line fell through to `stream.next()` and wore `tags.invalid`, the
      // same class a planted non-table name gets. It is matched HERE, gated on the
      // binding form, rather than by adding `=` to the derived symbols: the table
      // stays the single authority over what an operator is.
      if (awaitingEq && stream.match('=')) return 'operator'
      if (stream.match(BRACKETS)) return 'punctuation'
      stream.next()
      return 'unknown'
    },
  })
}

/** declared-name set → the one language instance for it (see the header note). */
const FORMULA_LANGUAGES = new Map()

export function formulaLanguage(inputs = undefined, vocab = FORMULA_VOCAB) {
  const declared = new Set(Object.keys(inputs || {}))
  if (vocab !== FORMULA_VOCAB) return defineFormula(declared, vocab)
  // A declared input name matches `parse.js`'s `KEY_RE` (`[A-Za-z][A-Za-z0-9_]*`),
  // so a space cannot occur inside one and the joined key cannot collide.
  const key = [...declared].sort().join(' ')
  let lang = FORMULA_LANGUAGES.get(key)
  if (!lang) {
    lang = defineFormula(declared, vocab)
    FORMULA_LANGUAGES.set(key, lang)
  }
  return lang
}

// ── Pine ────────────────────────────────────────────────────────────────────
// A foreign language: its keywords are its own. The call names that reach OUR
// table are `PINE_CALL_SHAPES`' keys (bare, after the `ta.`/`math.` prefix).
const PINE_KEYWORDS = new Set([
  'if', 'else', 'for', 'to', 'by', 'while', 'var', 'varip', 'import', 'export', 'method', 'type', 'switch',
  'and', 'or', 'not', 'na', 'break', 'continue', 'return',
  'indicator', 'study', 'strategy', 'library', 'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle',
  'plotbar', 'hline', 'fill', 'bgcolor', 'barcolor', 'alertcondition', 'alert', 'input',
])
const PINE_TABLE_CALLS = new Set(Object.keys(PINE_CALL_SHAPES))
const PINE_SYMBOLS = ['==', '!=', '>=', '<=', ':=', '=>', '+', '-', '*', '/', '%', '>', '<', '=', '?', ':', '!']

export const pineLanguage = StreamLanguage.define({
  name: 'pine',
  tokenTable: TOKEN_TABLE,
  startState: () => ({ afterDot: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null
    if (stream.match(/^\/\/.*/)) return 'comment'
    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string'
    if (stream.match(NUMBER)) return 'number'
    if (stream.match(WORD)) {
      const w = stream.current()
      const afterDot = state.afterDot
      state.afterDot = false
      if (afterDot) return PINE_TABLE_CALLS.has(w) ? 'fn' : 'name'
      if (stream.peek() === '.') { state.afterDot = true; return 'namespace' }
      if (PINE_KEYWORDS.has(w)) return 'keyword'
      if (FORMULA_VOCAB.series.has(w)) return 'series'
      if (FORMULA_VOCAB.literals.has(w)) return 'literal'
      return 'name'
    }
    if (stream.match('.')) return 'punctuation'
    if (matchSymbol(stream, PINE_SYMBOLS)) return 'operator'
    if (stream.match(BRACKETS)) return 'punctuation'
    stream.next()
    return 'unknown'
  },
})

// ── TC2000 PCF ──────────────────────────────────────────────────────────────
// Price letters are DERIVED from the table's series (`priceLetters`), and the
// call spellings from the PCF maps. `AND OR NOT XOR` are Worden's.
//
// ⛔⛔ THE MATCH IS ANCHORED AND WHOLE-TOKEN, BECAUSE THE COLOUR MUST AGREE WITH
// THE REFUSAL. `pcf.js` `readFused` (L783-786) splits the dotted tail, then tests
// `^NAME([A-Z])(\d*)$` for a family that declares `field` and `^NAME(\d*)$` for
// one that does not; anything that matches no family reaches `refuse('pcf:name')`
// at L940. An UNANCHORED prefix test (`letters.startsWith(call)`) coloured
// `SUMMER`, `SQRC50` and `DIPLUSX` as functions while the engine refused them by
// name — in a lane whose product is 1:1 agreement, that is the promise leaking.
// The patterns below are BUILT from `PCF_FUSED`'s own entries, so a family added
// there is matched here on its own declared shape.
//
// ⛔ `PCF_DIFFERENT_FORMULA` NEEDS NO GUARD HERE, AND THAT WAS MEASURED. `RSI`,
// `WSTOC`, `MS` and `TSV` are look-alikes `pcf.js` refuses with their own sentence
// ("TC2000's RSI is not Wilder's…"), so they must not wear the function colour —
// and under the anchored match above they already cannot: none of them is a
// `PCF_FUSED` family or a `PCF_CALLS` key, so `RSI14`/`MSFT` fall through to
// `unknown` on their own. An explicit exclusion set here was DEAD CODE — deleting
// it changed no test — and a guard that has never fired reads as protection while
// providing none. The property is pinned in the test instead, derived from the map.
// ⛔⛔ AND THE WORD LISTS COME FROM `pcf.js` TOO — `PCF_VOCABULARY`, its own
// enumeration of everything it accepts. A hand-typed keyword set stood here and
// was wrong in BOTH directions at once: it missed `NAND`/`NOR`/`XNOR`/`MOD`
// (legal TC2000 the reader accepts, painted `tags.invalid`) and invented
// `TRUE`/`FALSE` (which the reader refuses BY NAME, painted as keywords). The
// stateful calls (`CountTrue`…), the fundamentals (`Capitalization`…) and `IIF`
// were invisible for the same reason — their maps were module-private. The
// hand-typed `PCF_SYMBOLS` mirror went with it.
const PCF_KEYWORDS = new Set(PCF_VOCABULARY.words)
const PCF_CALL_NAMES = new Set(PCF_VOCABULARY.calls)
const PCF_BARE_NAMES = new Set(PCF_VOCABULARY.bare)
const PCF_SYMBOLS = PCF_VOCABULARY.symbols
const PCF_LETTERS = priceLetters(TABLE)
const PCF_BARE_LETTER = /^([A-Z])(\d*)$/
const PCF_FUSED_PATTERNS = Object.entries(PCF_FUSED).map(([name, family]) => ({
  re: family.field ? new RegExp(`^${name}([A-Z])(\\d*)$`) : new RegExp(`^${name}(\\d*)$`),
  field: !!family.field,
}))

/** ⛔ SHAPE IS NOT THE WHOLE TEST. `AVGZ50` matches `^AVG([A-Z])(\d*)$` and is
 *  REFUSED BY NAME — `readFused` checks the captured letter against the table's
 *  own `priceLetters` ("this table declares O, H, L, C, V") — so a pattern test
 *  alone painted a refusal as a function. The membership check reads the SAME
 *  map the refusal reads. */
const fusedFamily = (base) => PCF_FUSED_PATTERNS.some(({ re, field }) => {
  const m = re.exec(base)
  return !!m && (!field || PCF_LETTERS.has(m[1]))
})

/** ⛔ `pcf.js` DECIDES CALL-VS-FUSED ON THE NEXT **TOKEN**, AND ITS LEXER SKIPS
 *  WHITESPACE (`tokenize`, then `atom`: *"if the next token is `(` this is a
 *  call"*). A single-character peek made legal `AVG (C, 50)` an error colour.
 *  ⚠️ BOUNDED TO THE LINE: `StringStream` exposes one line, so a call whose `(`
 *  sits on the NEXT line still reads as fused. `pcf.js` would accept it; nobody
 *  writes it, and the stream API cannot see it. Recorded, not silently ignored. */
const CALL_AHEAD = /^\s*\(/

export const pcfLanguage = StreamLanguage.define({
  name: 'pcf',
  tokenTable: TOKEN_TABLE,
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(NUMBER)) return 'number'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_.]*/)) {
      const w = stream.current()
      // The dotted tail is parameters, not part of the name — `readFused` splits
      // it off before matching, so `AVGC50.2` is matched as `AVGC50`.
      const base = w.split('.')[0].toUpperCase()
      // ⚠️ KEYWORDS FIRST, and that is `pcf.js`'s order too: `unary()` intercepts
      // `NOT` before `atom()` ever sees it, so `NOT (…)` is a prefix operator and
      // not a call. (The reader does refuse `MOD(…)`/`AND(…)` by name where this
      // still says keyword — a spelling nobody writes, recorded rather than
      // special-cased into a branch that would never fire in practice.)
      if (PCF_KEYWORDS.has(base)) return 'keyword'
      // ⭐ CALLED-OR-NOT IS THE FORK, BEFORE ANYTHING ELSE — the same fork `atom`
      // takes. A name with a parenthesis after it reaches `buildCall`, which knows
      // only price letters, `IIF`, the stateful three and `PCF_CALLS`; the fused
      // families are NOT among them, so `AVGC50(C, 5)` is refused by name even
      // though `AVGC50` alone reads. Testing the fused shape first painted it `fn`.
      if (CALL_AHEAD.test(stream.string.slice(stream.pos))) {
        if (PCF_LETTERS.has(base)) return 'series'
        return PCF_CALL_NAMES.has(base) ? 'fn' : 'unknown'
      }
      const bare = PCF_BARE_LETTER.exec(base)
      if (bare && PCF_LETTERS.has(bare[1])) return 'series'
      if (fusedFamily(base)) return 'fn'
      // A TC2000 fundamental standing alone — `Capitalization`, `MarketCap`.
      if (PCF_BARE_NAMES.has(base)) return 'scalar'
      return 'unknown'
    }
    if (matchSymbol(stream, PCF_SYMBOLS)) return 'operator'
    if (stream.match(BRACKETS)) return 'punctuation'
    stream.next()
    return 'unknown'
  },
})

// ── thinkScript ─────────────────────────────────────────────────────────────
// ⚠️ NO TABLE CLAIM. `engine/ast/thinkscript.js` (W3) does not exist in this tree;
// a call is coloured as a call by SHAPE (`NAME(`), and the day W3 exports its
// call map this tokenizer reads it the way the Pine one reads `PINE_CALL_SHAPES`.
const TS_KEYWORDS = new Set([
  'def', 'plot', 'input', 'declare', 'rec', 'if', 'then', 'else', 'and', 'or', 'not', 'switch', 'case',
  'default', 'while', 'do', 'fold', 'from', 'to', 'with', 'AddOrder', 'Alert', 'AddLabel', 'AddCloud',
  'AssignPriceColor', 'SetDefaultColor', 'SetPaintingStrategy', 'SetLineWeight', 'SetStyle', 'Hide',
])
const TS_SYMBOLS = ['==', '!=', '>=', '<=', '+', '-', '*', '/', '%', '>', '<', '=', '?', ':', '!']

export const thinkscriptLanguage = StreamLanguage.define({
  name: 'thinkscript',
  tokenTable: TOKEN_TABLE,
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/^#.*/)) return 'comment'
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'
    if (stream.match(NUMBER)) return 'number'
    if (stream.match(WORD)) {
      const w = stream.current()
      if (TS_KEYWORDS.has(w)) return 'keyword'
      if (stream.peek() === '(') return 'fn'
      if (FORMULA_VOCAB.series.has(w)) return 'series'
      return 'name'
    }
    if (stream.match('.')) return 'punctuation'
    if (matchSymbol(stream, TS_SYMBOLS)) return 'operator'
    if (stream.match(/^[(),[\];]/)) return 'punctuation'
    stream.next()
    return 'unknown'
  },
})

/** The one door `CodeEditor` uses. An unknown dialect is the formula tokenizer —
 *  a bad prop must not take the box down. */
export function languageFor(dialect, inputs = undefined) {
  switch (dialect) {
    case 'pine': return pineLanguage
    case 'pcf': return pcfLanguage
    case 'thinkscript': return thinkscriptLanguage
    default: return formulaLanguage(inputs)
  }
}
