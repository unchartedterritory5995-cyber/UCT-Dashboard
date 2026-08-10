// ─── PINE IN, ONE FORMULA OUT ───────────────────────────────────────────────
//
// A member pastes a Pine script and gets a scan. This module is the door, and
// everything downstream of it is the door that was already there.
//
// ⭐⭐ IT PRODUCES **SOURCE TEXT**, NOT A STORED TREE. `parse.js` stays the ONLY
// producer of a persisted AST. The translator emits a UCT formula string, that
// string goes into the same box a member types into, and `parseFormula` makes the
// tree exactly as it does for a hand-typed formula. So `astHash` — which IS
// `compute.fn`, which IS `def_hash` — is byte-identical to what the builder would
// have produced for the same formula, the Python lane needs no change at all, and
// a jsep upgrade cannot desynchronise a Pine-authored definition from a typed one.
//
// ⭐⭐ AND THE TRANSLATION PROVES ITSELF. This module builds a canonical tree as
// it walks, prints text from it, RE-PARSES that text through `parseFormula`, and
// compares `astHash`. A printer bug is therefore a loud `pine:roundtrip` refusal
// and never a formula that means something else than the Pine said. Two
// independent producers must agree or nothing is emitted — that is the mechanical
// form of "a Pine script that half-translates is the worst possible outcome".
//
// ⭐⭐ THE FUNCTION MAP IS DERIVED FROM `closedTable.json` AT RUNTIME. There is no
// list of indicator names in this file. `ta.rsi` resolves because `rsi` is a key
// of `TABLE.functions`; the day another key lands there, the Pine name that
// normalises to it works with nothing here changing, and its ARITY and its
// ARGUMENT KINDS are read off the same declaration. `PINE_NAME_ALIASES` below is
// spelling only — it renames, it never asserts that anything exists.
//
// ⛔ EVERY UNSUPPORTED CONSTRUCT REFUSES BY NAME, AT ITS OWN TOKEN. Each refusal
// carries `{guard, message, line, column, token}` and the source line with a
// caret. The messages are pairwise disjoint from each other AND from `parse.js`'s,
// `interpret.js`'s, `budget.js`'s and `sentence.js`'s, for the reason those four
// are disjoint from one another: two gates sharing a phrase let a `toThrow(/…/)`
// pass with the safety deleted, and that has happened in this repo.
//
// ⭐ RESOLUTION RUNS **BACKWARDS FROM THE OUTPUTS**, AND THAT IS THE WHOLE REASON
// REAL SCRIPTS TRANSLATE. A published screener carries forty `input.symbol` rows,
// an `hline`, a `fill`, a table and a `func() =>` that the plot never touches.
// Refusing the script because line 31 declares a symbol input would refuse every
// real script on TradingView. So a statement is only ever REFUSED when it is on
// the path from a `plot()`/`alertcondition()` to its value; a statement nothing
// reaches is a NOTE, listed, never silently dropped.
// ⛔ THE ONE HOLE THAT WOULD OPEN IS `:=`, AND IT IS CLOSED BY CONSTRUCTION: a
// name reassigned ANYWHERE in the script — including inside an `if` or a `for`
// this module never reads — is marked opaque at its reassignment token, so
// inlining its first binding and ignoring the mutation is not reachable.
//
// ⛔ `close[1]` IS REFUSED, AND THAT IS A DECISION MADE ELSEWHERE. The manifest's
// `_no_offset` declares that there is no backward-index form, and
// `_no_offset_reopened_by` declares that re-opening it belongs to the owner of the
// repaint claim together with the owner of the manifest — "not a v2 feature
// request that any later task may grant on its own". Granting it here would make
// `maxLookback(ast)` stop being a tree sum. So the `[` token refuses, by name,
// and the message names `change(...)` when the shape is the one `change` already
// says.
//
// ⚠️ WHAT TRADINGVIEW'S OWN PINE SCREENER RESTRICTS IS A DIFFERENT AND MUCH
// SHORTER LIST than what this engine restricts, and pretending otherwise would be
// the over-claim. Measured 2026-08-09 against TradingView's own help centre
// (`support/solutions/43000742436`), the Pine Screener requires only: at least one
// `plot()` or `alertcondition()`; at most FIVE `request.*()` calls, whose
// timeframes come from a fixed list; a timeframe from that same list; one
// indicator per screen; no indicator-on-indicator; Pine v4 or higher; and it
// computes on THE LAST 500 BARS. It supports `request.*` — multi-timeframe and
// other-symbol data are ALLOWED there — and it supports most `input.*`, falling
// back to defaults for `input.timeframe`/`input.symbol`/`input.time`.
// ⛔ IT PUBLISHES NO RULE AT ALL about arrays, maps, user-defined types, `var`,
// loops, `barstate.*`, or strategies-versus-indicators. Those are legal Pine and
// TradingView runs them; they simply produce nothing a column can read. So a
// refusal below is almost always THIS ENGINE'S limit and not TradingView's, and
// the coverage map says which is which. Claiming "TradingView rejects arrays"
// would be a fabrication, and it is the kind a competitor can disprove in one
// screenshot.

import { TABLE, NODE_TYPES, parseFormula, astHash } from './parse.js'

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** A Pine construct this translator will not translate. Carries the guard AND
 *  the exact token, because "somewhere in your script" is not a refusal a member
 *  can act on. */
export class PineRefusal extends Error {
  constructor(guard, message, at) {
    super(message)
    this.name = 'PineRefusal'
    this.guard = guard
    this.at = at || null
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s, `interpret.js`'s, `budget.js`'s
 *  AND `sentence.js`'s TABLES TOO. `pine.test.js` asserts that over the UNION of
 *  all five, in both directions — "no message equals another" misses the half
 *  that matters, which is "no message is a SUBSTRING of another". */
export const REFUSALS = Object.freeze({
  'pine:empty':
    'there is no Pine here to translate',
  'pine:character':
    'Pine has no character like this one',
  'pine:statement':
    'this Pine line is not a shape the translator reads',
  'pine:declaration-strategy':
    'a strategy places orders to be backtested, and a screen filters symbols',
  'pine:declaration-library':
    'a Pine library exports functions instead of producing a plot to filter on',
  'pine:module':
    'importing another script pulls in code this engine never sees',
  'pine:strategy-call':
    'an order-placing call answers with no value a screen could filter',
  'pine:request':
    'another symbol or another timeframe is outside what one screened column reads',
  'pine:drawing':
    'a drawing object paints on a chart and answers with no number',
  'pine:collection':
    'an array, a matrix or a map is outside the expression grammar this engine runs',
  'pine:state':
    'a value that persists from one bar to the next is outside this engine grammar',
  'pine:reassign':
    'a name that is reassigned later cannot be folded into one expression',
  'pine:block':
    'a Pine block spans several statements and this engine stores a single expression',
  'pine:type':
    'a user-defined type is outside the four node shapes this engine stores',
  'pine:function-def':
    'a Pine function definition introduces a name this engine has nowhere to keep',
  'pine:tuple':
    'this Pine call answers with several values at once and a column carries one',
  'pine:history-ref':
    'the bar-offset form has no node in this engine grammar yet',
  'pine:offset-literal':
    'a bar offset has to be a plain whole number written into the script',
  'pine:offset-negative':
    'a bar offset that runs forwards would read a bar that has not happened',
  'pine:na':
    'Pine na has no spelling in this engine grammar',
  'pine:text-value':
    'text cannot be a value in a screened column',
  'pine:colour-value':
    'a colour cannot be a value in a screened column',
  'pine:operator':
    'this Pine operator has no counterpart in the engine grammar',
  'pine:builtin':
    'this Pine built-in names something the engine grammar does not hold',
  'pine:function':
    'this Pine function maps to nothing the engine grammar declares',
  'pine:arity':
    'the engine grammar declares a different signature for that name',
  'pine:named-argument':
    'a named argument cannot be matched onto the engine grammar positions',
  'pine:window':
    'a Pine length has to reach the engine as a plain whole number',
  'pine:input-kind':
    'this Pine input carries a default the engine grammar cannot hold',
  'pine:cycle':
    'this Pine name is defined in terms of itself',
  'pine:undefined':
    'this Pine name was never given a value in the pasted script',
  'pine:no-output':
    'the pasted script offers no plot and no alert condition to filter on',
  'pine:plot-offset':
    'a displaced plot writes its value at a different bar from the one that produced it',
  'pine:role-order':
    'this table states what kind each argument is and never what role it plays, '
    + 'so several price series cannot be matched onto it by position',
  'pine:roundtrip':
    'the translator wrote formula text it could not read back, so it emitted none',
})

// --------------------------------------------------------------------------- //
// the namespaces, by what they mean rather than by a list of members
// --------------------------------------------------------------------------- //

/** A Pine namespace prefix → the guard that refuses everything under it.
 *
 *  ⭐ A PREFIX, NOT A MEMBER LIST. `request.security`, `request.security_lower_tf`
 *  and whatever TradingView ships next all refuse under one entry, which is what
 *  keeps this from being the list-that-rots. The guard names WHY the whole
 *  namespace is out, and a namespace with several reasons would be several
 *  entries. */
const NAMESPACE_GUARD = Object.freeze({
  request: 'pine:request',
  strategy: 'pine:strategy-call',
  line: 'pine:drawing',
  linefill: 'pine:drawing',
  label: 'pine:drawing',
  box: 'pine:drawing',
  polyline: 'pine:drawing',
  table: 'pine:drawing',
  array: 'pine:collection',
  matrix: 'pine:collection',
  map: 'pine:collection',
  str: 'pine:builtin',
  syminfo: 'pine:builtin',
  ticker: 'pine:builtin',
  timeframe: 'pine:builtin',
  session: 'pine:builtin',
  barstate: 'pine:builtin',
  chart: 'pine:builtin',
  color: 'pine:colour-value',
  runtime: 'pine:builtin',
  log: 'pine:builtin',
  alert: 'pine:builtin',
  currency: 'pine:builtin',
  earnings: 'pine:builtin',
  dividends: 'pine:builtin',
  splits: 'pine:builtin',
  adjustment: 'pine:builtin',
  display: 'pine:builtin',
  format: 'pine:builtin',
  location: 'pine:builtin',
  scale: 'pine:builtin',
  shape: 'pine:builtin',
  size: 'pine:builtin',
  extend: 'pine:builtin',
  xloc: 'pine:builtin',
  yloc: 'pine:builtin',
  order: 'pine:builtin',
  position: 'pine:builtin',
  text: 'pine:builtin',
  font: 'pine:builtin',
  dayofweek: 'pine:builtin',
})

/** The two namespaces whose members are ORDINARY VALUE FUNCTIONS that this engine
 *  may hold. Everything else under a dot is decided by `NAMESPACE_GUARD`.
 *
 *  ⛔ `ta` AND `math` ARE NOT AN ALLOW-LIST OF FUNCTIONS. They are the two places
 *  Pine keeps the kind of thing this table could declare; whether any particular
 *  member exists is `TABLE.functions`'s answer and nothing else's. */
const VALUE_NAMESPACES = Object.freeze(new Set(['ta', 'math']))

/**
 * ⭐⭐ THE ONE THING THE MANIFEST DOES NOT DECLARE, AND THE ONLY REASON THIS
 * TABLE EXISTS: `closedTable.json` states what KIND each argument is
 * (`["series","series","series","int"]`) and never what ROLE it plays. So for a
 * function with more than one series argument, "same name, same arity" does NOT
 * establish that Pine's positions line up with this table's — and the default
 * below is therefore to REFUSE, not to line them up and hope.
 *
 * ⛔ THIS WAS MEASURED, NOT ANTICIPATED. Pine's `ta.stoch(source, high, low, n)`
 * against this table's `stoch(h, l, c, n)` translated verbatim, produced a
 * plausible number, produced a plausible read-back, and was WRONG BY 126 POINTS
 * of a 0-100 oscillator. `pine.roles.test.js` is the probe that caught it and it
 * is a standing rail: every entry here is checked against the interpreter by
 * EVALUATING it on bars whose high, low and close are all different, so a
 * permutation that stops being right goes red instead of going unnoticed.
 *
 * `table` is a CANDIDATE KEY, resolved through the same derived index as any
 * other name — an entry naming a function the manifest does not declare refuses
 * at `pine:function` exactly like an undeclared one. `build` says how to fill
 * each of the TABLE's argument positions: `{pine: i}` takes Pine's i-th argument,
 * `{series: 'high'}` supplies a chart series Pine leaves implicit.
 *
 * ⛔ `ta.atr` IS ABSENT ON PURPOSE AND ITS ABSENCE IS A MEASUREMENT. Pine's
 * `ta.atr` is Wilder's RMA of true range; this table's `atr(h,l,c,n)` matches
 * NEITHER that (max difference 0.20) NOR a plain SMA of true range (0.21), so it
 * runs a third smoothing convention and a member reading Pine's number would get
 * a different one. It refuses at `pine:arity` today because the arities also
 * differ; if the arities ever agree it must still refuse until the conventions
 * are reconciled. Same reasoning holds for `ta.cci`, whose Pine definition is
 * built on an arbitrary `source` rather than on the typical price.
 */
export const PINE_CALL_SHAPES = Object.freeze({
  // Two series, and the ORDER MEANS SOMETHING: `ta.crossover(a, b)` is "a crossed
  // above b", and so is this table's `crossOver(a, b)`. Railed.
  crossover: { table: 'crossOver', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  crossunder: { table: 'crossUnder', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  // Two series and order-INSENSITIVE; the rail asserts the commutativity rather
  // than assuming it.
  min: { table: 'min', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  max: { table: 'max', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
  // ⭐ THE PERMUTATION. Pine (source, high, low, length) → table (high, low, close,
  // length): Pine's `source` plays the role this table calls `c`.
  stoch: { table: 'stoch', pineArity: 4, build: [{ pine: 1 }, { pine: 2 }, { pine: 0 }, { pine: 3 }] },
  // Pine's `ta.wpr(length)` leaves high/low/close implicit; supplying them is an
  // identity, and the rail measures it at max difference 0.
  wpr: { table: 'williams_r', pineArity: 1, build: [{ series: 'high' }, { series: 'low' }, { series: 'close' }, { pine: 0 }] },
})

/** Pine v1–v4 spelled several of these WITHOUT a namespace; v5 moved them into
 *  one. `security(…)` in a v3 script is `request.security(…)`, and calling it
 *  "a function this table does not declare" would send a member looking for a
 *  spelling instead of telling them their script reads another timeframe.
 *
 *  ⛔ THE VALUE IS A NAMESPACE, NOT A GUARD. It routes into `NAMESPACE_GUARD`, so
 *  the reason a legacy name is refused is the same declaration that refuses its
 *  modern spelling and the two can never drift into different sentences. */
const LEGACY_BARE_NAMESPACE = Object.freeze({
  security: 'request',
  security_lower_tf: 'request',
  financial: 'request',
  quandl: 'request',
  splits: 'request',
  dividends: 'request',
  earnings: 'request',
})

/** Pine's own derived price series, expanded to the arithmetic Pine's reference
 *  manual defines them as.
 *
 *  ⚠️ AN EXPANSION IS ONLY ADMISSIBLE WHEN IT IS AN IDENTITY, and these four are:
 *  the Pine reference defines `hl2` AS `(high + low) / 2`. It is not a guess about
 *  what the author meant, and the read-back says the arithmetic out loud, so a
 *  member sees exactly what was understood. */
const DERIVED_SERIES = Object.freeze({
  hl2: ['high', 'low'],
  hlc3: ['high', 'low', 'close'],
  ohlc4: ['open', 'high', 'low', 'close'],
  hlcc4: ['high', 'low', 'close', 'close'],
})

/** Pine keywords that begin a construct with no single-expression form. */
const BLOCK_KEYWORDS = Object.freeze(new Set(['if', 'for', 'while', 'switch']))
const TYPE_KEYWORDS = Object.freeze(new Set(['type', 'method', 'enum']))
const STATE_KEYWORDS = Object.freeze(new Set(['var', 'varip']))

/** Pine type qualifiers and type names that may sit between `var` and the bound
 *  name, or in front of a plain declaration (`float x = 0.0`). */
const TYPE_WORDS = Object.freeze(new Set([
  'series', 'simple', 'const', 'input',
  'int', 'float', 'bool', 'string', 'color',
  'line', 'linefill', 'label', 'box', 'polyline', 'table', 'array', 'matrix', 'map',
]))

/** Calls whose whole job is to paint the chart.
 *
 *  ⚠️ NOTED AS IGNORED, NOT REFUSED, AND THE REASON IS TRADINGVIEW'S OWN RULE:
 *  its help centre says the screener's filter columns come from `plot()` and
 *  `alertcondition()`, and `visuals/overview` says drawings "do not have external
 *  uses like creating alerts or exporting data". So a `bgcolor()` line changes
 *  nothing a screen could read THERE either, and refusing a script over one would
 *  refuse most published indicators.
 *  ⛔ WHETHER `plotshape`/`hline`/`fill` YIELD A COLUMN ON TRADINGVIEW IS
 *  UNDOCUMENTED — its docs group them under "plots" but the screener article names
 *  only the two. Ignoring them is the conservative reading and it is stated in the
 *  notes a member sees, rather than assumed silently in either direction. */
const CHART_ONLY_CALLS = Object.freeze(new Set([
  'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar',
  'bgcolor', 'barcolor', 'fill', 'hline', 'alert',
]))

// --------------------------------------------------------------------------- //
// the derived function index
// --------------------------------------------------------------------------- //

const normaliseName = (name) => String(name).toLowerCase().replace(/_/g, '')

const INDEX_CACHE = new WeakMap()

/** `normalised name → the table's own key`, built from `Object.keys` of the
 *  manifest's `functions` section at call time.
 *
 *  ⭐ THIS IS THE WHOLE MAPPING. A function added to `closedTable.json` while this
 *  file is untouched is callable from Pine the moment it lands, under any spelling
 *  that normalises to its key — which is what `ta.rsi` → `rsi` and
 *  `ta.crossover` → `crossOver` both are. */
function functionIndex(table) {
  const cached = INDEX_CACHE.get(table)
  if (cached) return cached
  const index = new Map()
  for (const key of Object.keys((table && table.functions) || {})) {
    // First declaration wins, and the keys are walked in the manifest's own
    // order, so a collision is decided by the manifest rather than by chance.
    const n = normaliseName(key)
    if (!index.has(n)) index.set(n, key)
  }
  INDEX_CACHE.set(table, index)
  return index
}

const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key)

// --------------------------------------------------------------------------- //
// the lexer
// --------------------------------------------------------------------------- //

/** ⚠️ LONGEST FIRST, AND THE ORDER IS LOAD-BEARING. `PUNCT.find(startsWith)`
 *  returns the first match, so `+` ahead of `+=` would lex a compound assignment
 *  as a plus and an equals — and a compound assignment read as a BINDING is the
 *  silent misread this module exists to prevent (`total += x` would inline the
 *  first value and drop every later one). */
const PUNCT = [
  '=>', ':=', '==', '!=', '>=', '<=',
  '+=', '-=', '*=', '/=', '%=',
  '?', ':', ',', '(', ')', '[', ']',
  '>', '<', '+', '-', '*', '/', '%', '=', '!',
]

/** Every spelling of "this name changes after it was bound". */
const MUTATORS = Object.freeze(new Set([':=', '+=', '-=', '*=', '/=', '%=']))

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

/**
 * Source → a flat token list, the per-line indent, and the `//@version=` a Pine
 * script declares.
 *
 * ⚠️ NEWLINES ARE NOT TOKENS; each token carries its own `line`, and statement
 * grouping is a separate pass. Pine's continuation rule is about INDENT and
 * BRACKET DEPTH, and both are cleaner to read off a positioned token list than
 * off a stream with separators in it.
 */
export function lexPine(src) {
  const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n')
  const tokens = []
  const lines = text.split('\n')
  const indents = lines.map((line) => {
    const m = /^[ \t]*/.exec(line)
    return m ? m[0].length : 0
  })
  let version = null
  let i = 0
  let line = 1
  let lineStart = 0

  const at = (index, ln, col, raw) => ({ line: ln, column: col, index, token: raw })

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { i += 1; line += 1; lineStart = i; continue }
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    const col = i - lineStart + 1

    // comments — and the version pragma, which is one
    if (ch === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      const comment = text.slice(i, end)
      const m = /^\/\/\s*@version\s*=\s*(\d+)/.exec(comment)
      if (m && version === null) version = Number(m[1])
      i = end
      continue
    }

    // colour literal — a value this grammar has no room for, lexed so the
    // refusal can point at it rather than at "an unexpected character".
    if (ch === '#') {
      let j = i + 1
      while (j < text.length && /[0-9A-Fa-f]/.test(text[j])) j += 1
      tokens.push({ kind: 'colour', value: text.slice(i, j), line, column: col, index: i })
      i = j
      continue
    }

    // string
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && j + 1 < text.length) { out += text[j + 1]; j += 2; continue }
        if (text[j] === '\n') break
        out += text[j]
        j += 1
      }
      if (j >= text.length || text[j] !== ch) {
        throw new PineRefusal('pine:character', REFUSALS['pine:character'],
          at(i, line, col, ch))
      }
      tokens.push({ kind: 'string', value: out, line, column: col, index: i })
      i = j + 1
      continue
    }

    // number
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || ''))) {
      let j = i
      while (j < text.length && DIGIT.test(text[j])) j += 1
      if (text[j] === '.') { j += 1; while (j < text.length && DIGIT.test(text[j])) j += 1 }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1
        if (text[k] === '+' || text[k] === '-') k += 1
        if (DIGIT.test(text[k] || '')) { k += 1; while (k < text.length && DIGIT.test(text[k])) k += 1; j = k }
      }
      const raw = text.slice(i, j)
      tokens.push({ kind: 'number', value: Number(raw), raw, line, column: col, index: i })
      i = j
      continue
    }

    // identifier, possibly dotted (`ta.sma`, `input.int`, `strategy.entry`)
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < text.length && IDENT_PART.test(text[j])) j += 1
      while (text[j] === '.' && IDENT_START.test(text[j + 1] || '')) {
        j += 1
        while (j < text.length && IDENT_PART.test(text[j])) j += 1
      }
      tokens.push({ kind: 'ident', value: text.slice(i, j), line, column: col, index: i })
      i = j
      continue
    }

    // punctuation
    const punct = PUNCT.find((p) => text.startsWith(p, i))
    if (punct) {
      tokens.push({ kind: 'punct', value: punct, line, column: col, index: i })
      i += punct.length
      continue
    }

    throw new PineRefusal('pine:character', REFUSALS['pine:character'], at(i, line, col, ch))
  }

  return { tokens, indents, version, lines }
}

// --------------------------------------------------------------------------- //
// statements
// --------------------------------------------------------------------------- //

/** Tokens → statements. A statement starts on a line whose indent is 0 and which
 *  begins at bracket depth 0; every other line continues the one before it.
 *
 *  ⚠️ THAT RULE ALSO SWALLOWS A BLOCK BODY, ON PURPOSE. `if cond` / `    x := 1`
 *  becomes ONE statement, so the block refuses once, at its own keyword, rather
 *  than producing a second unreadable statement whose first token is `x`. */
function statementsOf(tokens, indents) {
  const out = []
  let current = null
  let depth = 0
  for (const tok of tokens) {
    const indent = indents[tok.line - 1] || 0
    const startsStatement = current === null
      || (tok.line !== current.tokens[current.tokens.length - 1].line && depth === 0 && indent === 0)
    if (startsStatement) {
      current = { tokens: [] }
      out.push(current)
    }
    current.tokens.push(tok)
    if (tok.kind === 'punct') {
      if (tok.value === '(' || tok.value === '[') depth += 1
      else if (tok.value === ')' || tok.value === ']') depth = Math.max(0, depth - 1)
    }
  }
  return out.filter((s) => s.tokens.length > 0)
}

const isPunct = (tok, value) => !!tok && tok.kind === 'punct' && tok.value === value

/** The index of the first token at bracket depth 0 matching `pred`, or -1. */
function findTop(toks, pred) {
  let depth = 0
  for (let i = 0; i < toks.length; i += 1) {
    const tok = toks[i]
    if (tok.kind === 'punct') {
      if (tok.value === '(' || tok.value === '[') { depth += 1; continue }
      if (tok.value === ')' || tok.value === ']') { depth -= 1; continue }
    }
    if (depth === 0 && pred(tok)) return i
  }
  return -1
}

// --------------------------------------------------------------------------- //
// the Pine expression parser
// --------------------------------------------------------------------------- //
//
// Precedence-climbing over one statement's tokens. It builds a PINE tree (not a
// canonical one) so that resolution can happen later, from the outputs backwards.

const PINE_BINARY = Object.freeze({
  or: 1, and: 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
})

class Cursor {
  constructor(toks) { this.toks = toks; this.i = 0 }

  peek(k = 0) { return this.toks[this.i + k] || null }

  next() { const t = this.toks[this.i]; this.i += 1; return t }

  eat(value) {
    const t = this.peek()
    if (isPunct(t, value)) { this.i += 1; return t }
    return null
  }

  expect(value) {
    const t = this.eat(value)
    if (!t) {
      const bad = this.peek() || this.toks[this.toks.length - 1]
      throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(bad))
    }
    return t
  }
}

const locate = (tok) => (tok
  ? { line: tok.line, column: tok.column, index: tok.index, token: String(tok.raw ?? tok.value) }
  : null)

function parseExpression(cur, minBp = 0) {
  let left = parseUnary(cur)
  for (;;) {
    const tok = cur.peek()
    if (!tok) break
    let op = null
    if (tok.kind === 'punct' && own(PINE_BINARY, tok.value)) op = tok.value
    else if (tok.kind === 'ident' && (tok.value === 'and' || tok.value === 'or')) op = tok.value
    if (op === null) break
    const bp = PINE_BINARY[op]
    if (bp < minBp) break
    cur.next()
    const right = parseExpression(cur, bp + 1)
    left = { type: 'binary', op, left, right, tok }
  }
  // the ternary binds loosest and is right-associative
  if (minBp <= 0 && isPunct(cur.peek(), '?')) {
    const tok = cur.next()
    const yes = parseExpression(cur, 0)
    cur.expect(':')
    const no = parseExpression(cur, 0)
    return { type: 'ternary', test: left, yes, no, tok }
  }
  return left
}

function parseUnary(cur) {
  const tok = cur.peek()
  if (isPunct(tok, '-')) { cur.next(); return { type: 'unary', op: '-', arg: parseUnary(cur), tok } }
  if (isPunct(tok, '+')) { cur.next(); return parseUnary(cur) }
  if (isPunct(tok, '!')) {
    // ⚠️ PINE HAS NO `!`, `&&` OR `||` — the operators page lists `not`, `and`,
    // `or` and nothing else. Somebody typing `!` has written JavaScript, and
    // saying so is more use than "unexpected character".
    throw new PineRefusal('pine:operator',
      `${REFUSALS['pine:operator']} — \`!\`. Pine spells negation \`not\``, locate(tok))
  }
  if (tok && tok.kind === 'ident' && tok.value === 'not') {
    cur.next()
    return { type: 'unary', op: 'not', arg: parseUnary(cur), tok }
  }
  return parsePostfix(cur)
}

function parsePostfix(cur) {
  let node = parsePrimary(cur)
  for (;;) {
    const tok = cur.peek()
    if (isPunct(tok, '[')) {
      // ⭐ PINE'S HISTORY-REFERENCING OPERATOR, READ IN FULL AND CONSTRAINED HERE.
      // The constraints are the engine's, not this parser's taste, and they are
      // the ones that keep `maxLookback(ast)` a TREE SUM and a forward reference
      // INEXPRESSIBLE: the index must be a whole-number literal, and it must not
      // be negative. A variable index would make the window depend on a knob and
      // the repaint linter could not bound it; a negative one is `close[-1]`,
      // which is next bar.
      cur.next()
      const idx = parseOffsetIndex(cur, tok)
      cur.expect(']')
      // ⛔ ONE APPLICATION PER VALUE, exactly as Pine itself rules: `close[1][2]`
      // is an error there, and letting it through here would compose two windows
      // this module then has to reason about.
      if (isPunct(cur.peek(), '[')) {
        throw new PineRefusal('pine:offset-literal',
          `${REFUSALS['pine:offset-literal']} — and Pine allows only one \`[…]\` per value`,
          locate(cur.peek()))
      }
      node = { type: 'offset', arg: node, n: idx, tok }
      continue
    }
    if (isPunct(tok, '(')) {
      // `f(x)(y)` and `arr.get(i)(j)` — a call of a call has no bare name.
      throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
    }
    break
  }
  return node
}

/** The `n` in `close[n]`, or a refusal naming which rule it broke.
 *
 *  ⛔ TWO SEPARATE GUARDS, BECAUSE THEY ARE TWO SEPARATE MISTAKES. A variable
 *  index (`close[len]`) is a window the repaint linter cannot bound; a negative
 *  index (`close[-1]`) is a bar that has not happened. Reporting both as "bad
 *  offset" would hide from a member which one they made. */
function parseOffsetIndex(cur, openTok) {
  const negative = isPunct(cur.peek(), '-')
  if (negative) cur.next()
  const tok = cur.peek()
  if (!tok || tok.kind !== 'number' || !Number.isInteger(tok.value)) {
    throw new PineRefusal('pine:offset-literal', REFUSALS['pine:offset-literal'],
      locate(tok || openTok))
  }
  cur.next()
  // ⚠️ THE `]` IS CHECKED HERE RATHER THAN BY THE CALLER, so `close[1 + 1]`
  // reports the OFFSET rule it broke instead of "this line is not a shape the
  // translator reads" — the literal is the first token of a computed index, and a
  // guard that only looks at the first token names the wrong mistake.
  if (!isPunct(cur.peek(), ']')) {
    throw new PineRefusal('pine:offset-literal', REFUSALS['pine:offset-literal'],
      locate(cur.peek() || tok))
  }
  if (negative) {
    throw new PineRefusal('pine:offset-negative',
      `${REFUSALS['pine:offset-negative']} — \`[-${tok.value}]\``, locate(tok))
  }
  return tok.value
}

function parsePrimary(cur) {
  const tok = cur.next()
  if (!tok) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], null)

  if (tok.kind === 'number') return { type: 'number', value: tok.value, tok }
  if (tok.kind === 'string') return { type: 'string', value: tok.value, tok }
  if (tok.kind === 'colour') return { type: 'colour', value: tok.value, tok }

  if (isPunct(tok, '(')) {
    const inner = parseExpression(cur, 0)
    cur.expect(')')
    return inner
  }

  if (isPunct(tok, '[')) {
    // A `[…]` where a VALUE was expected is a Pine tuple or an array/options
    // literal (`options = ['A', 'B']`). Naming it "a line this translator does
    // not read" would send a member looking for a typo.
    throw new PineRefusal('pine:collection', REFUSALS['pine:collection'], locate(tok))
  }

  if (tok.kind === 'ident') {
    if (tok.value === 'true') return { type: 'number', value: 1, tok }
    if (tok.value === 'false') return { type: 'number', value: 0, tok }
    if (BLOCK_KEYWORDS.has(tok.value)) {
      throw new PineRefusal('pine:block', REFUSALS['pine:block'], locate(tok))
    }
    if (isPunct(cur.peek(), '(')) {
      cur.next()
      const args = parseArguments(cur)
      return { type: 'call', name: tok.value, args, tok }
    }
    return { type: 'name', name: tok.value, tok }
  }

  throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
}

/** `(a, b, title=c)` — positional and named, in Pine's own order. */
function parseArguments(cur) {
  const args = []
  if (cur.eat(')')) return args
  for (;;) {
    let name = null
    const first = cur.peek()
    const second = cur.peek(1)
    if (first && first.kind === 'ident' && isPunct(second, '=')) {
      name = first.value
      cur.next(); cur.next()
    }
    const value = parseExpression(cur, 0)
    args.push({ name, value, tok: first })
    if (cur.eat(',')) continue
    cur.expect(')')
    break
  }
  return args
}

/** One statement's tokens → one Pine expression, with nothing left over. */
function parseWholeExpression(toks) {
  const cur = new Cursor(toks)
  const node = parseExpression(cur, 0)
  const rest = cur.peek()
  if (rest) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(rest))
  return node
}

// --------------------------------------------------------------------------- //
// canonical nodes and the printer
// --------------------------------------------------------------------------- //

const cNum = (value) => (value < 0
  // ⚠️ A NEGATIVE LITERAL IS `u-` APPLIED TO A POSITIVE ONE, because that is what
  // jsep produces when it reads the text this module prints. Emitting a `num`
  // with a negative value would print text that re-parses to a DIFFERENT tree and
  // the round-trip check would refuse a formula that is perfectly fine.
  ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] }
  : { type: 'num', value })
const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
const cCall = (name, args) => ({ type: 'call', name, args })

/** Printing precedence. Deliberately a LOCAL copy of `parse.js`'s binding powers
 *  rather than an import, and the copy is safe for exactly one reason: every
 *  string this printer produces is re-parsed and hashed against the tree it was
 *  printed from. A drift between the two tables cannot ship a wrong formula — it
 *  can only make `pine:roundtrip` fire, loudly, with nothing emitted. */
const PRINT_BP = Object.freeze({
  '||': 1, '&&': 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10,
})

const TERNARY_BP = 0
const UNARY_BP = 11
/** ⚠️ ABOVE `UNARY_BP`, AND THAT IS LOAD-BEARING. `[n]` is postfix, so it binds
 *  tighter than unary minus: printing `(-close)[1]` as `-close[1]` would re-parse
 *  as `-(close[1])`, a different tree. The round-trip check would catch it, but
 *  it would catch it as a refusal a member could not act on. */
const POSTFIX_BP = 12

function printNumber(value) {
  if (!Number.isFinite(value)) {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
  return String(value)
}

/** A canonical tree → UCT formula text, with the fewest parentheses that survive
 *  a round trip through `parseFormula`. */
export function printFormula(node, parentBp = 0) {
  if (!node || typeof node !== 'object') {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
  switch (node.type) {
    case 'num': return printNumber(node.value)
    case 'series': return node.name
    case 'call':
      return `${node.name}(${node.args.map((a) => printFormula(a, 0)).join(', ')})`
    case 'offset':
      // The engine's fifth node type, spelled the way its own parser reads it —
      // which is the way Pine spells it too, so what a member sees in the formula
      // box is the sub-expression they pasted.
      return `${printFormula(node.args[0], POSTFIX_BP)}[${printNumber(node.value)}]`
    case 'op': {
      if (node.name === 'u-' || node.name === '!') {
        const sym = node.name === 'u-' ? '-' : '!'
        const inner = printFormula(node.args[0], UNARY_BP)
        const text = `${sym}${inner}`
        return UNARY_BP < parentBp ? `(${text})` : text
      }
      if (node.name === '?:') {
        const text = `${printFormula(node.args[0], TERNARY_BP + 1)} ? `
          + `${printFormula(node.args[1], TERNARY_BP + 1)} : `
          + `${printFormula(node.args[2], TERNARY_BP)}`
        return parentBp > TERNARY_BP ? `(${text})` : text
      }
      const bp = PRINT_BP[node.name]
      if (typeof bp !== 'number') {
        throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
      }
      const text = `${printFormula(node.args[0], bp)} ${node.name} ${printFormula(node.args[1], bp + 1)}`
      return bp < parentBp ? `(${text})` : text
    }
    default:
      throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
}

// --------------------------------------------------------------------------- //
// resolution — from the outputs backwards
// --------------------------------------------------------------------------- //

// --------------------------------------------------------------------------- //
// the bar offset — ONE SEAM, and it is the only thing waiting on another lane
// --------------------------------------------------------------------------- //

/**
 * ⭐⭐ `close[3]` → whatever node the ENGINE declares for a bar offset.
 *
 * Pine's history-referencing operator is read in full by `parsePostfix` above,
 * with the engine's own constraints applied AT PARSE — a whole-number literal,
 * never negative, one application per value. Everything about `[n]` on the Pine
 * side is therefore finished. What is not finished is the node it becomes: the
 * manifest's `_no_offset` says there is none yet, and `_no_offset_reopened_by`
 * says re-opening it belongs to the owner of the repaint claim together with the
 * owner of the manifest — so this module may not invent one.
 *
 * ⛔ AND IT MUST NOT INVENT ONE EVEN TEMPORARILY. A second offset representation
 * would be a second grammar with a second Python walker and a second thing
 * `maxLookback` has to know about, and `compute.fn` is `astHash` — so a shape
 * guessed today is a shape every persisted definition is stuck with. That is the
 * `williams_r`/`williamsR` cost, paid up front and permanently.
 *
 * ⭐ SO IT IS DISCOVERED FROM THE MANIFEST, WHICH IS WHERE THIS REPO PUTS A FACT
 * BOTH LANES READ. When the offset lands it will declare itself there; this
 * reads that declaration and emits the node. Until then it refuses BY NAME and
 * says what it is waiting for — a refusal that names its own dependency, rather
 * than a wall that reads like a decision.
 *
 * The declaration this looks for:
 *
 *     "_bar_offset": { "fn": "<the function key>" }
 *
 * and the emitted node is `call(<fn>, [<child>, num(n)])` — the ONE shape under
 * which `maxLookback` stays a tree sum, because the manifest's existing
 * `"lookback": "arg1"` machinery already turns the literal second argument into
 * the window (`lint.js::resolveDeclaration`), and the outer window composes onto
 * the child's through `addReach` with not a line of the linter changing.
 * `pine.offset.test.js` proves that end to end against a synthetic manifest, so
 * the day the real one lands this is a fact rather than a hope.
 */
function barOffsetNode(child, n, table, tok, wrote) {
  // `x[0]` is `x`, at every bar, under any representation. Emitting it needs no
  // node and no dependency.
  if (n === 0) return child

  // ⭐ DISCOVERED FROM `NODE_TYPES`, WHICH `parse.js` EXPORTS AND ASSERTS BY
  // WALKING A PARSED TREE. Not a version check, not a feature flag and not a
  // `try { … } catch`: the canonical vocabulary is a value this module can read,
  // so "does the engine have a bar offset" is answered by the engine.
  if (NODE_TYPES.includes('offset')) {
    return { type: 'offset', value: n, args: [child] }
  }

  throw new PineRefusal('pine:history-ref',
    `${REFUSALS['pine:history-ref']}${wrote ? ` — \`${wrote}\`` : ''}. It is being added `
    + 'as a bounded constant offset; until it lands, a one-bar difference is '
    + '`change(x)` and a one-bar crossing is `crossOver(a, b)` / `crossUnder(a, b)`, '
    + 'both of which this table already declares', locate(tok))
}

const PINE_OP_TO_TABLE = Object.freeze({
  '+': '+', '-': '-', '*': '*', '/': '/',
  '>': '>', '<': '<', '>=': '>=', '<=': '<=',
  '==': '==', '!=': '!=',
  and: '&&', or: '||',
})

class Resolver {
  constructor(env, table, types) {
    this.env = env
    this.table = table
    this.types = types || new Map()
    this.index = functionIndex(table)
    this.stack = new Set()
    this.usedInputs = new Map()
  }

  /** `Point.new(…)` and `p.x` are both a user-defined type showing through, and
   *  saying `pine:builtin` about either would name the wrong thing. A dotted name
   *  whose first segment is a type the script DECLARED, or a local the script
   *  BOUND, is a field or a constructor — never a Pine namespace. */
  typeRefusalFor(name, tok) {
    const dot = name.indexOf('.')
    if (dot <= 0) return null
    const head = name.slice(0, dot)
    if (!this.types.has(head) && !this.env.has(head)) return null
    return new PineRefusal('pine:type',
      `${REFUSALS['pine:type']} — \`${name}\``,
      this.types.get(head) || locate(tok))
  }

  resolve(node) {
    switch (node.type) {
      case 'number': return cNum(node.value)
      case 'string':
        throw new PineRefusal('pine:text-value', REFUSALS['pine:text-value'], locate(node.tok))
      case 'colour':
        throw new PineRefusal('pine:colour-value', REFUSALS['pine:colour-value'], locate(node.tok))
      case 'unary': {
        const inner = this.resolve(node.arg)
        return cOp(node.op === 'not' ? '!' : 'u-', [inner])
      }
      case 'binary': {
        const mapped = PINE_OP_TO_TABLE[node.op]
        if (!mapped || !own(this.table.operators, mapped)) {
          throw new PineRefusal('pine:operator',
            `${REFUSALS['pine:operator']} — \`${node.op}\``, locate(node.tok))
        }
        return cOp(mapped, [this.resolve(node.left), this.resolve(node.right)])
      }
      case 'ternary':
        return cOp('?:', [this.resolve(node.test), this.resolve(node.yes), this.resolve(node.no)])
      case 'offset': {
        // ⭐ THE CHILD RESOLVES FIRST, so `ta.sma(close, 20)[2]` and `close[2]`
        // reach the seam the same way and nesting needs no special case.
        const child = this.resolve(node.arg)
        const wrote = node.arg.type === 'name' ? `${node.arg.name}[${node.n}]` : null
        return barOffsetNode(child, node.n, this.table, node.tok, wrote)
      }
      case 'name': return this.resolveName(node)
      case 'call': return this.resolveCall(node)
      default:
        throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(node.tok))
    }
  }

  resolveName(node) {
    const name = node.name

    if (name === 'na') {
      throw new PineRefusal('pine:na', REFUSALS['pine:na'], locate(node.tok))
    }

    // A bar field the manifest declares. ⭐ READ OFF THE TABLE, not a list here.
    if (own(this.table.series, name)) return cSeries(name)
    if (own(this.table.scalars || {}, name)) return cSeries(name)

    // Pine's own derived price series, expanded to their reference definitions.
    if (own(DERIVED_SERIES, name)) {
      const parts = DERIVED_SERIES[name]
      for (const p of parts) {
        if (!own(this.table.series, p)) {
          throw new PineRefusal('pine:builtin',
            `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
        }
      }
      const sum = parts.map(cSeries).reduce((a, b) => cOp('+', [a, b]))
      return cOp('/', [sum, cNum(parts.length)])
    }

    // A binding from the pasted script.
    const bound = this.env.get(name)
    if (bound) {
      if (bound.kind === 'opaque') {
        throw new PineRefusal(bound.guard, bound.message, bound.at)
      }
      if (this.stack.has(name)) {
        throw new PineRefusal('pine:cycle',
          `${REFUSALS['pine:cycle']} — \`${name}\``, locate(node.tok))
      }
      this.stack.add(name)
      try { return this.resolve(bound.node) } finally { this.stack.delete(name) }
    }

    // A dotted or namespaced built-in.
    const dot = name.indexOf('.')
    if (dot > 0) {
      const asType = this.typeRefusalFor(name, node.tok)
      if (asType) throw asType
      const ns = name.slice(0, dot)
      if (own(NAMESPACE_GUARD, ns) && !VALUE_NAMESPACES.has(ns)) {
        const guard = NAMESPACE_GUARD[ns]
        throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
      }
      if (VALUE_NAMESPACES.has(ns)) {
        // `ta.vwap`, `ta.obv`, `ta.tr` are VARIABLES in Pine. They reach the table
        // as zero-argument calls, and the table decides whether that is a thing.
        return this.resolveTableCall(name, name.slice(dot + 1), [], node.tok)
      }
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }

    if (own(LEGACY_BARE_NAMESPACE, name)) {
      const guard = NAMESPACE_GUARD[LEGACY_BARE_NAMESPACE[name]]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }

    // A bare name that is neither a bar field nor a binding. It may still be a
    // zero-argument table function (`ta.vwap` and `ta.obv` are VARIABLES in Pine,
    // and a v4 script spells them without the namespace).
    if (this.index.has(normaliseName(name)) || own(PINE_CALL_SHAPES, normaliseName(name))) {
      return this.resolveTableCall(name, name, [], node.tok)
    }

    // Everything else: a Pine built-in with no home here, or a name the script
    // never bound. The two are different facts and get different guards.
    if (PINE_KNOWN_BUILTINS.has(name)) {
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }
    throw new PineRefusal('pine:undefined',
      `${REFUSALS['pine:undefined']} — \`${name}\``, locate(node.tok))
  }

  resolveCall(node) {
    const name = node.name
    const dot = name.indexOf('.')
    const ns = dot > 0 ? name.slice(0, dot) : null
    const base = dot > 0 ? name.slice(dot + 1) : name

    if (name === 'nz' || name === 'na' || name === 'fixnan') {
      throw new PineRefusal('pine:na', `${REFUSALS['pine:na']} — \`${name}\``, locate(node.tok))
    }
    if (ns === 'input' || name === 'input') return this.resolveInput(node)

    const asType = this.typeRefusalFor(name, node.tok)
    if (asType) throw asType

    if (ns && own(NAMESPACE_GUARD, ns) && !VALUE_NAMESPACES.has(ns)) {
      const guard = NAMESPACE_GUARD[ns]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }
    if (ns && !VALUE_NAMESPACES.has(ns)) {
      throw new PineRefusal('pine:builtin',
        `${REFUSALS['pine:builtin']} — \`${name}\``, locate(node.tok))
    }
    // ⛔ ONLY A `f(x) =>` DEFINITION SHADOWS A TABLE NAME, AND A VALUE NEVER DOES.
    // `rsi = rsi(src, length)` is ordinary Pine — the variable and the function
    // live in different namespaces there — and consulting the value binding first
    // made `07-rsi.pine` refuse its own plot with the wrong guard entirely.
    const bound = this.env.get(name)
    if (bound && bound.kind === 'opaque' && bound.isFunction) {
      throw new PineRefusal(bound.guard, bound.message, bound.at)
    }

    if (own(LEGACY_BARE_NAMESPACE, name)) {
      const guard = NAMESPACE_GUARD[LEGACY_BARE_NAMESPACE[name]]
      throw new PineRefusal(guard, `${REFUSALS[guard]} — \`${name}\``, locate(node.tok))
    }
    return this.resolveTableCall(name, base, node.args, node.tok)
  }

  /** ⭐ THE DERIVED MAP. `pineName` is what the member wrote; `base` is it with a
   *  value namespace stripped; the MANIFEST decides whether the name exists, how
   *  many arguments it takes and what kind each one is. The only thing this
   *  module supplies is a ROLE ORDER, and only where one has been measured. */
  resolveTableCall(pineName, base, args, tok) {
    const shape = PINE_CALL_SHAPES[normaliseName(base)] || null
    const candidate = shape ? shape.table : base
    const key = this.index.get(normaliseName(candidate))
    if (!key) {
      throw new PineRefusal('pine:function',
        `${REFUSALS['pine:function']} — \`${pineName}\`. This table declares `
        + `${Object.keys(this.table.functions).sort().join(', ')}`, locate(tok))
    }
    const spec = this.table.functions[key]
    const declaredArgs = Array.isArray(spec.args) ? spec.args : []
    const seriesSlots = declaredArgs.filter((a) => a === 'series').length

    for (const arg of args) {
      if (arg.name) {
        throw new PineRefusal('pine:named-argument',
          `${REFUSALS['pine:named-argument']} — \`${arg.name}\` on \`${pineName}\`. `
          + `\`${key}\` takes ${signatureOf(key, spec)}`, locate(arg.tok || tok))
      }
    }

    // ── the fill plan ──────────────────────────────────────────────────────
    let plan
    if (shape) {
      // ⛔ THE SHAPE IS CHECKED AGAINST THE MANIFEST, NOT TRUSTED. A declaration
      // here that no longer fits what the table declares is a STALE shape, and a
      // stale shape is exactly the misread this whole table exists to stop — so
      // it refuses rather than filling the first N positions and dropping the
      // rest.
      if (shape.build.length !== declaredArgs.length) {
        throw new PineRefusal('pine:role-order',
          `${REFUSALS['pine:role-order']} — \`${pineName}\` has a measured order for `
          + `${shape.build.length} positions and this table's \`${key}\` now takes `
          + `${declaredArgs.length} — ${signatureOf(key, spec)}`, locate(tok))
      }
      if (args.length !== shape.pineArity) {
        throw new PineRefusal('pine:arity',
          `${REFUSALS['pine:arity']} — \`${pineName}\` was given ${args.length} `
          + `argument${args.length === 1 ? '' : 's'} and Pine's own signature takes `
          + `${shape.pineArity}`, locate(tok))
      }
      plan = shape.build
    } else {
      if (seriesSlots > 1) {
        // ⭐⭐ FAIL CLOSED ON AN UNMEASURED ROLE ORDER. A function the indicator
        // agent adds tomorrow with two price arguments lands HERE, refused by
        // name, rather than being matched up by position and quietly returning
        // somebody else's number.
        throw new PineRefusal('pine:role-order',
          `${REFUSALS['pine:role-order']} — \`${key}\` takes ${seriesSlots} price series `
          + `(${signatureOf(key, spec)}) and no measured order maps \`${pineName}\` onto them`,
          locate(tok))
      }
      if (args.length !== declaredArgs.length) {
        throw new PineRefusal('pine:arity',
          `${REFUSALS['pine:arity']} — \`${pineName}\` was given ${args.length} `
          + `argument${args.length === 1 ? '' : 's'}; this table takes `
          + `${declaredArgs.length} — ${signatureOf(key, spec)}`, locate(tok))
      }
      plan = declaredArgs.map((_, i) => ({ pine: i }))
    }

    const out = []
    for (let i = 0; i < plan.length; i += 1) {
      const slot = plan[i]
      let resolved
      if (own(slot, 'series')) {
        if (!own(this.table.series, slot.series)) {
          throw new PineRefusal('pine:role-order',
            `${REFUSALS['pine:role-order']} — \`${pineName}\` needs an implicit `
            + `\`${slot.series}\` and this table declares none`, locate(tok))
        }
        resolved = cSeries(slot.series)
      } else {
        resolved = this.resolve(args[slot.pine].value)
      }
      if (declaredArgs[i] === 'int') {
        // ⛔ A WINDOW MUST BE A LITERAL, AND THAT IS THE REPAINT LINTER'S RULE
        // RATHER THAN THIS MODULE'S TASTE. `lint.js::resolveDeclaration` returns
        // UNKNOWN for an `argK` that is not a `num` node, so a computed length
        // fails closed to `repaints` and the save door refuses it. Refusing here
        // names the length; refusing there would name the badge.
        if (resolved.type !== 'num' || !Number.isInteger(resolved.value)) {
          const src = own(slot, 'series') ? tok : (args[slot.pine].tok || tok)
          throw new PineRefusal('pine:window',
            `${REFUSALS['pine:window']} — argument ${i + 1} of \`${pineName}\``,
            locate(src))
        }
      }
      out.push(resolved)
    }
    return cCall(key, out)
  }

  /** `input.int(14, "RSI Length")` → `14`.
   *
   *  ⭐ FOLDED TO THE DEFAULT, AND THE REASON IS THE REPAINT BADGE. A length that
   *  is a per-instance knob makes `lint.js` answer UNKNOWN for the whole tree, so
   *  the definition could never be saved at all. TradingView's own screener does
   *  the same thing to the three inputs it cannot set. The fold is recorded and
   *  shown, never silent. */
  resolveInput(node) {
    const name = node.name
    const kind = name === 'input' ? 'input' : name.slice('input.'.length)
    const NUMERIC = new Set(['input', 'int', 'float', 'bool', 'source', 'price'])
    let defval = null
    let title = null
    for (let i = 0; i < node.args.length; i += 1) {
      const arg = node.args[i]
      if (arg.name === 'defval') defval = arg.value
      else if (arg.name === 'title') title = arg.value
      else if (!arg.name && defval === null && i === 0) defval = arg.value
      else if (!arg.name && title === null && i === 1) title = arg.value
    }
    if (!NUMERIC.has(kind)) {
      throw new PineRefusal('pine:input-kind',
        `${REFUSALS['pine:input-kind']} — \`${name}\``, locate(node.tok))
    }
    if (defval === null) {
      throw new PineRefusal('pine:input-kind',
        `${REFUSALS['pine:input-kind']} — \`${name}\` states no default`, locate(node.tok))
    }
    const resolved = this.resolve(defval)
    this.usedInputs.set(`${node.tok.line}:${node.tok.column}`, {
      call: name,
      title: title && title.type === 'string' ? title.value : null,
      folded: printFormula(resolved),
      line: node.tok.line,
      column: node.tok.column,
    })
    return resolved
  }
}

function signatureOf(key, spec) {
  const args = Array.isArray(spec.args) ? spec.args : []
  return `${key}(${args.join(', ')})`
}

/** Pine built-in VARIABLES that name something with no column here. Used only to
 *  tell "a Pine name we know and cannot hold" apart from "a name your script
 *  never defined" — two different sentences for two different mistakes. */
const PINE_KNOWN_BUILTINS = Object.freeze(new Set([
  'bar_index', 'time', 'time_close', 'time_tradingday', 'timenow',
  'year', 'month', 'weekofyear', 'dayofmonth', 'hour', 'minute', 'second',
  'na', 'last_bar_index', 'last_bar_time', 'first_bar_index',
  'open_time', 'volume_delta',
]))

// --------------------------------------------------------------------------- //
// the program walk
// --------------------------------------------------------------------------- //

const chartOnlyNote = (word) => `\`${word}\` paints on a chart; TradingView's own screener `
  + 'reads plot() and alertcondition() and nothing else, so this line is ignored here too'

function noteOf(code, message, tok) {
  return { code, message, ...(locate(tok) || { line: null, column: null, index: null, token: null }) }
}

/** Every `IDENT :=` anywhere in the token stream, including inside a block this
 *  module never reads.
 *
 *  ⭐⭐ THIS IS THE ONE THING THAT MAKES LAZY RESOLUTION SAFE. Inlining a name's
 *  first binding while a `:=` further down changes it is the silent misread this
 *  whole module exists to make impossible, and a `:=` inside `if`/`for` is exactly
 *  where it would hide. The scan is over TOKENS rather than over statements, so a
 *  construct the parser never understood cannot hide a reassignment from it. */
function reassignedNames(tokens) {
  const out = new Map()
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if (tok.kind === 'punct' && MUTATORS.has(tok.value) && tokens[i - 1].kind === 'ident') {
      const name = tokens[i - 1].value
      if (!out.has(name)) out.set(name, tok)
    }
  }
  return out
}

/** The name a declaration binds — the identifier immediately before the `=`,
 *  unless that identifier is one of Pine's type words (`float x = 0.0`, where the
 *  walk-back has already passed `x`). */
function boundName(toks, eqIndex) {
  const tok = toks[eqIndex - 1]
  if (!tok || tok.kind !== 'ident' || TYPE_WORDS.has(tok.value)) return null
  return tok
}

/**
 * Pine source → the outputs a screener could filter on, each with the formula
 * text this engine would run, or a refusal that names its own token.
 *
 * NEVER THROWS. A refusal is a value, for the reason `parseFormula` never throws:
 * the surface is a text box somebody just pasted into, and a throw reaches React
 * as a blank screen.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {object} [opts.table] the manifest to translate against. Defaults to the
 *        shipped `closedTable.json`; a test may hand a different one, which is how
 *        "the mapping is derived" is measured rather than asserted.
 * @returns {{
 *   ok: boolean,
 *   version: number|null,
 *   declaration: string|null,
 *   title: string|null,
 *   outputs: Array<object>,
 *   selected: number,
 *   notes: Array<object>,
 *   refusal: object|null,
 *   refusals: Array<object>,
 * }}
 */
export function translatePine(source, opts = {}) {
  const table = opts.table || TABLE
  const blank = {
    ok: false, version: null, declaration: null, title: null,
    outputs: [], selected: -1, notes: [], refusal: null, refusals: [],
  }

  if (typeof source !== 'string' || source.trim() === '') {
    return { ...blank, refusal: refusalValue('pine:empty', REFUSALS['pine:empty'], null), refusals: [refusalValue('pine:empty', REFUSALS['pine:empty'], null)] }
  }

  let lexed
  try {
    lexed = lexPine(source)
  } catch (err) {
    const r = fromError(err)
    return { ...blank, refusal: r, refusals: [r] }
  }

  const { tokens, indents, version, lines } = lexed
  if (tokens.length === 0) {
    const r = refusalValue('pine:empty', REFUSALS['pine:empty'], null)
    return { ...blank, version, refusal: r, refusals: [r] }
  }

  const env = new Map()
  const declaredTypes = new Map()
  const notes = []
  const outputs = []
  let declaration = null
  let title = null
  const hardRefusals = []

  // ⭐ EVERY REASSIGNMENT FIRST, over raw tokens, before a single statement is
  // read. See `reassignedNames`.
  const reassigned = reassignedNames(tokens)
  for (const [name, tok] of reassigned) {
    env.set(name, {
      kind: 'opaque',
      guard: 'pine:reassign',
      message: `${REFUSALS['pine:reassign']} — \`${name}\``,
      at: locate(tok),
    })
  }

  /** ⛔ `at` IS A LOCATOR, NEVER A TOKEN THIS FUNCTION PICKED. When a binding
   *  fails to parse, the refusal that comes back ALREADY points at the offending
   *  token — passing the statement's first token instead would move every caret
   *  to the start of the line, which is how a refusal stops being actionable.
   *  This was measured on the corpus: six scripts reported `close[1]` at the
   *  wrong column before the locator was threaded through. */
  const markOpaque = (name, guard, at, extra, isFunction = false) => {
    if (!name) return
    if (env.has(name) && env.get(name).kind === 'opaque') return
    env.set(name, {
      kind: 'opaque',
      guard,
      isFunction,
      message: `${REFUSALS[guard]}${extra ? ` — ${extra}` : ''}`,
      at: at || null,
    })
  }

  for (const stmt of statementsOf(tokens, indents)) {
    const toks = stmt.tokens
    const first = toks[0]

    // `[a, b] = f()` — a tuple destructure.
    if (isPunct(first, '[')) {
      const close = toks.findIndex((t) => isPunct(t, ']'))
      const names = toks.slice(1, close < 0 ? toks.length : close)
        .filter((t) => t.kind === 'ident' && !TYPE_WORDS.has(t.value))
      for (const n of names) markOpaque(n.value, 'pine:tuple', locate(first), `\`${n.value}\``)
      notes.push(noteOf('pine:tuple', REFUSALS['pine:tuple'], first))
      continue
    }

    if (first.kind !== 'ident') {
      notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
      continue
    }

    const word = first.value

    // ── declarations ──────────────────────────────────────────────────────
    if ((word === 'indicator' || word === 'study') && isPunct(toks[1], '(')) {
      declaration = word
      const firstString = toks.find((t) => t.kind === 'string')
      title = firstString ? firstString.value : null
      notes.push(noteOf('pine:declaration',
        'the indicator() declaration decides how a chart draws, and a screen reads none of it',
        first))
      continue
    }
    if (word === 'strategy' && isPunct(toks[1], '(') && toks.some((t) => t.kind === 'string')) {
      hardRefusals.push(refusalValue('pine:declaration-strategy',
        REFUSALS['pine:declaration-strategy'], locate(first)))
      continue
    }
    if (word === 'library' && isPunct(toks[1], '(')) {
      hardRefusals.push(refusalValue('pine:declaration-library',
        REFUSALS['pine:declaration-library'], locate(first)))
      continue
    }
    if (word === 'import' || word === 'export') {
      hardRefusals.push(refusalValue('pine:module', REFUSALS['pine:module'], locate(first)))
      continue
    }

    // ── things that bind a name this engine cannot fold ────────────────────
    if (STATE_KEYWORDS.has(word)) {
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      markOpaque(nameTok && nameTok.value, 'pine:state', locate(first),
        nameTok ? `\`${nameTok.value}\`` : null)
      notes.push(noteOf('pine:state', REFUSALS['pine:state'], first))
      continue
    }
    if (TYPE_KEYWORDS.has(word)) {
      // ⭐ REMEMBER THE NAME. `type Point` makes `Point.new(…)` and `p.x` mean
      // something this module can refuse ACCURATELY instead of calling them an
      // unknown Pine namespace.
      const named = toks[1]
      if (named && named.kind === 'ident') declaredTypes.set(named.value, locate(named))
      notes.push(noteOf('pine:type', REFUSALS['pine:type'], first))
      continue
    }
    if (BLOCK_KEYWORDS.has(word)) {
      notes.push(noteOf('pine:block', REFUSALS['pine:block'], first))
      continue
    }

    // ── outputs ────────────────────────────────────────────────────────────
    if ((word === 'plot' || word === 'alertcondition') && isPunct(toks[1], '(')) {
      outputs.push({ kind: word, toks, tok: first })
      continue
    }

    // ── a binding, a function definition, or a paint call ─────────────────
    const arrow = findTop(toks, (t) => isPunct(t, '=>'))
    const eq = findTop(toks, (t) => isPunct(t, '='))
    if (arrow >= 0) {
      const nameTok = toks[0].kind === 'ident' ? toks[0] : null
      markOpaque(nameTok && nameTok.value, 'pine:function-def', locate(toks[arrow]),
        nameTok ? `\`${nameTok.value}\`` : null, true)
      notes.push(noteOf('pine:function-def', REFUSALS['pine:function-def'], toks[arrow]))
      continue
    }
    if (eq > 0) {
      const nameTok = boundName(toks, eq)
      const rhs = toks.slice(eq + 1)
      if (!nameTok || rhs.length === 0) {
        notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
        continue
      }
      // ⭐⭐ `obvPlot = plot(obv, …)` IS STILL A PLOT. Pine's `plot()` RETURNS a
      // handle so `fill()` can join two of them, and a published indicator binds
      // it as a matter of course — `09-on-balance-volume.pine` in the corpus
      // binds both of its plots and offered NO column at all until this branch
      // existed. The binding is a chart handle and nothing here can read it; the
      // COLUMN is what the screener wants, and it is right there.
      if (rhs[0].kind === 'ident' && (rhs[0].value === 'plot' || rhs[0].value === 'alertcondition')
          && isPunct(rhs[1], '(')) {
        outputs.push({ kind: rhs[0].value, toks: rhs, tok: rhs[0] })
        markOpaque(nameTok.value, 'pine:drawing', locate(rhs[0]),
          `\`${nameTok.value}\` holds a plot handle, which is a chart object rather than a number`)
        continue
      }
      // `h0 = hline(80, …)` binds a CHART HANDLE, not a number — `fill(h0, h1)`
      // is what it is for. Reading it as an ordinary value binding would refuse
      // it later at `pine:function` ("hline maps to nothing this table declares"),
      // which is true and completely beside the point.
      if (rhs[0].kind === 'ident' && CHART_ONLY_CALLS.has(rhs[0].value) && isPunct(rhs[1], '(')) {
        markOpaque(nameTok.value, 'pine:drawing', locate(rhs[0]),
          `\`${nameTok.value}\` holds a \`${rhs[0].value}\` handle, which is a chart object rather than a number`)
        notes.push(noteOf('pine:chart-only', chartOnlyNote(rhs[0].value), rhs[0]))
        continue
      }
      if (env.has(nameTok.value) && env.get(nameTok.value).kind === 'opaque') continue
      if (rhs[0].kind === 'ident' && BLOCK_KEYWORDS.has(rhs[0].value)) {
        markOpaque(nameTok.value, 'pine:block', locate(rhs[0]), `\`${nameTok.value}\``)
        notes.push(noteOf('pine:block', REFUSALS['pine:block'], rhs[0]))
        continue
      }
      try {
        env.set(nameTok.value, { kind: 'expr', node: parseWholeExpression(rhs), at: locate(nameTok) })
      } catch (err) {
        const r = fromError(err)
        // ⛔ THE REFUSAL IS STORED WHOLE — its guard, ITS OWN MESSAGE and ITS OWN
        // LOCATOR. Rebuilding the sentence from the guard would drop the detail
        // the door appended (`— \`close\``), and re-pointing it at the start of
        // the line would move the caret off the token. See `markOpaque`.
        if (!env.has(nameTok.value) || env.get(nameTok.value).kind !== 'opaque') {
          env.set(nameTok.value, {
            kind: 'opaque',
            guard: r.guard,
            isFunction: false,
            message: `${r.message} (reached through \`${nameTok.value}\`)`,
            at: { line: r.line, column: r.column, index: r.index, token: r.token },
          })
        }
        // ⛔ NOT A REFUSAL YET. A binding nothing reaches is a note; if an output
        // reaches it, `resolveName` raises this same guard at this same token.
        notes.push({ ...r, code: r.guard })
      }
      continue
    }

    // A statement that is a bare call.
    if (isPunct(toks[1], '(')) {
      const dot = word.indexOf('.')
      const ns = dot > 0 ? word.slice(0, dot) : null
      if (CHART_ONLY_CALLS.has(word)) {
        notes.push(noteOf('pine:chart-only', chartOnlyNote(word), first))
        continue
      }
      if (ns === 'strategy') {
        hardRefusals.push(refusalValue('pine:strategy-call',
          `${REFUSALS['pine:strategy-call']} — \`${word}\``, locate(first)))
        continue
      }
      notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
      continue
    }

    notes.push(noteOf('pine:statement', REFUSALS['pine:statement'], first))
  }

  // ── resolve each output, independently ───────────────────────────────────
  const resolved = []
  for (const out of outputs) {
    const resolver = new Resolver(env, table, declaredTypes)
    let row
    try {
      const cur = new Cursor(out.toks.slice(2))
      const args = parseArguments(cur)
      const rest = cur.peek()
      if (rest) throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(rest))
      const seriesArg = pickOutputArgument(args, out.kind, out.tok)
      const ast = resolver.resolve(seriesArg.value)
      const formula = printFormula(ast)
      verifyRoundTrip(formula, ast)
      row = {
        kind: out.kind,
        title: outputTitle(args, out.kind) || null,
        line: out.tok.line,
        column: out.tok.column,
        formula,
        ast,
        inputsFolded: [...resolver.usedInputs.values()],
        refusal: null,
      }
    } catch (err) {
      row = {
        kind: out.kind,
        title: null,
        line: out.tok.line,
        column: out.tok.column,
        formula: null,
        ast: null,
        inputsFolded: [],
        refusal: fromError(err),
      }
    }
    resolved.push(row)
  }

  const usable = resolved.filter((r) => r.refusal === null)
  const refusals = [
    ...hardRefusals,
    ...resolved.filter((r) => r.refusal).map((r) => r.refusal),
  ].sort(byPosition)

  if (resolved.length === 0) {
    const r = refusalValue('pine:no-output', REFUSALS['pine:no-output'], null)
    return {
      ok: false, version, declaration, title, outputs: [], selected: -1,
      notes: withExcerpts(notes, lines),
      refusal: hardRefusals[0] || r,
      refusals: withExcerpts(hardRefusals.length ? refusals : [r, ...refusals], lines),
    }
  }

  // ⛔ A HARD REFUSAL REFUSES THE WHOLE SCRIPT EVEN WHEN A PLOT TRANSLATED.
  // A `strategy()` script's plot is real Pine and would translate fine — but the
  // artifact is a backtest, its meaning lives in orders this engine never runs,
  // and offering one of its plots as "your scan" is reading a different document
  // than the one the member pasted. Same for a `library()` and for an `import`,
  // whose behaviour depends on code that never arrived.
  const blocked = hardRefusals.length > 0
  return {
    ok: usable.length > 0 && !blocked,
    version,
    declaration,
    title,
    outputs: resolved.map((r) => (r.refusal ? { ...r, refusal: withExcerpt(r.refusal, lines) } : r)),
    selected: blocked ? -1 : chooseOutput(resolved, table),
    notes: withExcerpts(notes, lines),
    refusal: (usable.length > 0 && !blocked) ? null : withExcerpt(refusals[0] || null, lines),
    refusals: withExcerpts(refusals, lines),
  }
}

/** Which of a script's outputs is offered first.
 *
 *  ⭐ DERIVED, AND STATED. An `alertcondition` IS a condition by construction, so
 *  it wins. Failing that, a plot whose tree the manifest says `yields: bool` is a
 *  0/1 column and a scan is `<tree> != 0` — so it is the one that screens.
 *  Otherwise the first plot that translated at all. ⛔ A member can always choose
 *  another; this decides what is on screen first, never what is possible. */
function chooseOutput(rows, table) {
  const ok = (r) => r.refusal === null
  // ⛔ A CONSTANT IS NEVER THE FIRST OFFER, AND THAT IS MEASURED TOO. A published
  // indicator plots a hidden zero baseline so `fill()` has something to fill
  // against (`06-adx-advanced.pine` line 175: `pZero = plot(0.0,
  // display=display.none)`), and `0` satisfies "yields bool" — the manifest's
  // `_yields` says so correctly, because 0 IS one of the two values a 0/1 column
  // holds. Offering that as the member's scan would be a screen that matches
  // nothing, presented as the obvious choice.
  const live = (r) => readsBars(r.ast)
  const pick = (pred) => rows.findIndex((r) => ok(r) && pred(r))
  return [
    (r) => r.kind === 'alertcondition' && live(r),
    (r) => live(r) && treeYieldsBool(r.ast, table),
    (r) => live(r),
    () => true,
  ].reduce((found, pred) => (found >= 0 ? found : pick(pred)), -1)
}

/** Does this tree read the tape at all? A `series` leaf or a `call` — anything
 *  else is arithmetic on literals and is the same number for every symbol. */
function readsBars(node) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'series' || n.type === 'call') return true
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return false
}

/** `yields` off the manifest, resolved the way `sentence.js::yieldsOf` and
 *  `scan_definition.is_boolean_tree` both resolve it. Local rather than imported
 *  so that a caller-supplied table is honoured; `pine.test.js` asserts the two
 *  agree on the shipped manifest. */
export function treeYieldsBool(node, table = TABLE) {
  if (!node || typeof node !== 'object') return false
  switch (node.type) {
    case 'num': return node.value === 0 || node.value === 1
    case 'series': {
      const spec = (table.scalars || {})[node.name]
      return !!spec && spec.yields === 'bool'
    }
    case 'op': {
      const spec = (table.operators || {})[node.name]
      const declared = spec ? spec.yields : 'num'
      if (declared !== 'passthrough') return declared === 'bool'
      const arms = Array.isArray(node.args) ? node.args.slice(1) : []
      return arms.length > 0 && arms.every((a) => treeYieldsBool(a, table))
    }
    case 'call': {
      const spec = (table.functions || {})[node.name]
      return !!spec && spec.yields === 'bool'
    }
    case 'offset':
      // ⭐ A BAR OFFSET CHANGES *WHEN*, NEVER *WHAT*. `signal[1]` holds the same
      // kind of value `signal` does, so the answer is the child's — deriving it
      // any other way would be a second opinion about one declaration.
      return treeYieldsBool(node.args && node.args[0], table)
    default: return false
  }
}

/** The argument a screener reads. `plot(series, title, …)` and
 *  `alertcondition(condition, title, message)` — the first positional, or the
 *  named one Pine's own signature calls it. */
function pickOutputArgument(args, kind, tok) {
  // ⛔⛔ `plot(…, offset = n)` MOVES THE WHOLE COLUMN, AND IGNORING IT WOULD BE
  // THE SILENT MISREAD. A negative offset writes bar i's value at bar i-n and a
  // POSITIVE one writes it into the future — which is the forward reference the
  // repaint linter exists to decide, arriving through a parameter rather than
  // through the tree. This engine has no displacement, so a displaced plot
  // refuses rather than translating into an undisplaced one that means something
  // else. (`03-rsi-directional-momentum-scanner.pine` plots eight of these.)
  const offset = args.find((a) => a.name === 'offset')
  if (offset && !(offset.value.type === 'number' && offset.value.value === 0)) {
    throw new PineRefusal('pine:plot-offset', REFUSALS['pine:plot-offset'],
      locate(offset.tok || tok))
  }
  const named = kind === 'plot' ? 'series' : 'condition'
  const byName = args.find((a) => a.name === named)
  if (byName) return byName
  const positional = args.find((a) => !a.name)
  if (!positional) {
    throw new PineRefusal('pine:statement', REFUSALS['pine:statement'], locate(tok))
  }
  return positional
}

function outputTitle(args, kind) {
  const byName = args.find((a) => a.name === 'title')
  if (byName && byName.value.type === 'string') return byName.value.value
  const positional = args.filter((a) => !a.name)
  const second = positional[1]
  if (second && second.value.type === 'string') return second.value.value
  return null
}

/** ⭐⭐ THE PROOF THAT NOTHING HALF-TRANSLATED. The printed text is read back by
 *  the SHIPPED parser and hashed; a disagreement emits nothing at all. */
function verifyRoundTrip(formula, ast) {
  const reparsed = parseFormula(formula)
  if (!reparsed.ok) {
    throw new PineRefusal('pine:roundtrip',
      `${REFUSALS['pine:roundtrip']} (${reparsed.error})`, null)
  }
  let a
  let b
  try {
    a = astHash(reparsed.ast)
    b = astHash(ast)
  } catch (err) {
    throw new PineRefusal('pine:roundtrip',
      `${REFUSALS['pine:roundtrip']} (${err && err.message ? err.message : err})`, null)
  }
  if (a !== b) {
    throw new PineRefusal('pine:roundtrip', REFUSALS['pine:roundtrip'], null)
  }
}

// --------------------------------------------------------------------------- //
// refusal values
// --------------------------------------------------------------------------- //

function refusalValue(guard, message, at) {
  return {
    guard,
    message,
    line: at ? at.line : null,
    column: at ? at.column : null,
    index: at ? at.index : null,
    token: at ? at.token : null,
    excerpt: null,
  }
}

function fromError(err) {
  if (err instanceof PineRefusal) return refusalValue(err.guard, err.message, err.at)
  return refusalValue('pine:statement',
    `${REFUSALS['pine:statement']} (${err && err.message ? err.message : err})`, null)
}

/** The source line and a caret under the offending token. A refusal that names a
 *  line number and shows nothing is a refusal a member has to go looking for. */
function withExcerpt(refusal, lines) {
  if (!refusal || refusal.line == null) return refusal
  const text = lines[refusal.line - 1]
  if (typeof text !== 'string') return refusal
  const caret = `${' '.repeat(Math.max(0, (refusal.column || 1) - 1))}^`
  return { ...refusal, excerpt: `${text}\n${caret}` }
}

function withExcerpts(list, lines) {
  return list.map((r) => withExcerpt(r, lines))
}

function byPosition(a, b) {
  const al = a.line == null ? Infinity : a.line
  const bl = b.line == null ? Infinity : b.line
  if (al !== bl) return al - bl
  return (a.column || 0) - (b.column || 0)
}
