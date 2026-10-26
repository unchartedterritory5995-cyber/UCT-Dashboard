/**
 * The widget formula dialect, client twin (wave 10, Task 10.3): "your own fields" in a built
 * widget, checked as the member types.
 *
 * It answers EXACTLY what the server does (`api/services/journal_two/widget_formula.py`, Task
 * 10.2) on every entry of the shared vector file `tests/fixtures/widgetFormulaVectors.json`, which
 * is the one authority on how the dialect answers. This module never reads that file: the tests
 * do, with a file read.
 *
 * It is a SEPARATE dialect from the note-property formula language (`lib/formula/**`, spec
 * §16.2): nothing here imports it and nothing there moves.
 *
 * Pure: no I/O, no clock, no `eval`, no `Function`, no dynamic `import()`, and no computed
 * property access by member text (`widgetFormula.noEval.test.js` walks this file's AST). Function
 * names go through ONE static dispatch table (`FN`, a Map keyed by the canonical names), field
 * lookups through Maps, and a row is read only for its OWN keys (`Object.hasOwn`), so
 * `[__proto__]` is just an unknown field and a row carrying `__proto__` is just data.
 *
 * LAZY: imported only by the builder's lazy chunk (Task 10.16), never by a first-open file
 * (`widgetFormula.lazy.test.js`).
 *
 * Bounded work, the same bounds as the server: at most `MAX_LENGTH` code points, at most
 * `MAX_TOKENS` tokens, parentheses nested at most `MAX_DEPTH` deep, counted by the TOKENIZER
 * before the parser runs, so the parser's recursion (which only happens through a `(`) is bounded
 * by the counter and never by the JS stack. A stack overflow (`RangeError`) is caught as
 * `too_deep`, a backstop only. Operator chains are flat n-ary nodes built by a loop and unary
 * minus is a counted run, so the tree's height is bounded by the parenthesis depth.
 *
 * Code points, never UTF-16 units: every position and every length walks `Array.from(expr)`, so
 * an emoji counts once, as it does in Python.
 *
 * Values: number, text (string), yes/no (boolean) and day (a valid `YYYY-MM-DD` string, from a
 * day field only). `null` is "no data": an empty input, a divide by zero and every non-finite
 * intermediate give `null`, never `Infinity`, `NaN` or a made-up 0. `-0` is never an answer.
 */

// ---------------------------------------------------------------------------------------------
// Limits (spec §5.5), the server's numbers.

export const LIMITS = Object.freeze({
  MAX_LENGTH: 2000,
  MAX_TOKENS: 500,
  MAX_DEPTH: 32,
  MAX_FORMULAS: 5,
  NAME_MAX: 60,
  MAX_TEXT: 200,
  BUCKET_EDGES_MAX: 10,
  ROUND_DIGITS_MAX: 6,
  CHECK_EVERY: 256,
  SIG_DIGITS_MAX: 15,
  SHOWN_MAX: 20,
  BUCKET_PLACES_MAX: 4,
  /** The most rows one scan reads (the bounded scan is `LIMIT SCAN_ROWS + 1`). Client only: it
   *  bounds `skipNotice`, and is not one of the shared vector file's constants. */
  SCAN_ROWS: 5000,
})

const {
  MAX_LENGTH, MAX_TOKENS, MAX_DEPTH, NAME_MAX, MAX_TEXT, BUCKET_EDGES_MAX, ROUND_DIGITS_MAX,
  CHECK_EVERY, SIG_DIGITS_MAX, SHOWN_MAX, BUCKET_PLACES_MAX, SCAN_ROWS,
} = LIMITS

export const FUNCTIONS = Object.freeze([
  'If', 'And', 'Or', 'Not', 'Abs', 'Round', 'Min', 'Max',
  'CountIf', 'SumIf', 'AvgIf', 'Share', 'Bucket', 'Hour', 'Weekday',
])
const AGGREGATES = new Set(['CountIf', 'SumIf', 'AvgIf', 'Share'])

/** (fewest, most) arguments per function. */
const ARITY = new Map([
  ['If', [3, 3]], ['And', [2, 8]], ['Or', [2, 8]], ['Not', [1, 1]], ['Abs', [1, 1]],
  ['Round', [1, 2]], ['Min', [2, 8]], ['Max', [2, 8]], ['CountIf', [1, 1]], ['SumIf', [1, 2]],
  ['AvgIf', [1, 2]], ['Share', [1, 1]], ['Bucket', [2, 1 + BUCKET_EDGES_MAX]], ['Hour', [1, 1]],
  ['Weekday', [1, 1]],
])

export const ARITY_WORDS = Object.freeze({
  If: '3 values', And: '2 to 8 values', Or: '2 to 8 values', Not: '1 value',
  Abs: '1 value', Round: '1 or 2 values', Min: '2 to 8 values', Max: '2 to 8 values',
  CountIf: '1 value', SumIf: 'a value and an optional condition',
  AvgIf: 'a value and an optional condition', Share: '1 value',
  Bucket: 'a value and 1 to 10 edges', Hour: '1 value', Weekday: '1 value',
})
const ARITY_WORDS_MAP = new Map(Object.entries(ARITY_WORDS))

export const FUNCTION_DOCS = Object.freeze([
  { name: 'If', usage: 'If(condition, then, otherwise)',
    meaning: "One value when the condition holds, another when it doesn't." },
  { name: 'And', usage: 'And(condition, condition, \u2026)',
    meaning: 'Yes when every condition holds.' },
  { name: 'Or', usage: 'Or(condition, condition, \u2026)',
    meaning: 'Yes when any condition holds.' },
  { name: 'Not', usage: 'Not(condition)', meaning: 'The opposite of a condition.' },
  { name: 'Abs', usage: 'Abs(number)', meaning: 'The number without its sign.' },
  { name: 'Round', usage: 'Round(number, places)',
    meaning: 'Rounded to 0 to 6 decimal places (0 when left out).' },
  { name: 'Min', usage: 'Min(number, number, \u2026)',
    meaning: 'The smallest of the values; empty values are skipped.' },
  { name: 'Max', usage: 'Max(number, number, \u2026)',
    meaning: 'The largest of the values; empty values are skipped.' },
  { name: 'CountIf', usage: 'CountIf(condition)',
    meaning: 'How many rows meet the condition.' },
  { name: 'SumIf', usage: 'SumIf(value, condition)',
    meaning: 'The value added up over the rows that meet the condition, or over all rows.' },
  { name: 'AvgIf', usage: 'AvgIf(value, condition)',
    meaning: 'The average of the value over the rows that meet the condition, or over all rows.' },
  { name: 'Share', usage: 'Share(condition)',
    meaning: 'The share of rows that meet the condition, from 0 to 1.' },
  { name: 'Bucket', usage: 'Bucket(number, edge, \u2026)',
    meaning: 'Puts a number into ranges: under the first edge, between edges, or the last edge or more.' },
  { name: 'Hour', usage: 'Hour(day)',
    meaning: 'The ET hour, 0 to 23; empty for trades with dates only.' },
  { name: 'Weekday', usage: 'Weekday(day)',
    meaning: 'The weekday of a day, Monday to Sunday.' },
].map((d) => Object.freeze(d)))

/** code -> sentence template. `{x}` is the member's own text (clipped, see `shown`), `{label}` a
 *  field label, `{Fn}` a function name, `{what}` a function name or an operator, `{n}` the
 *  `ARITY_WORDS` entry. */
export const ERRORS = Object.freeze({
  empty: 'Type a formula.',
  too_long: 'A formula can be at most 2,000 characters.',
  too_many_parts: 'This formula has too many parts. Split it into two fields.',
  too_deep: 'This formula is nested too deeply.',
  bad_char: "{x} can't be used in a formula.",
  unclosed_field: 'A [ is missing its ].',
  unclosed_paren: 'A ( is missing its ).',
  extra_paren: 'There is a ) without its (.',
  unclosed_text: 'A quote is missing its closing ".',
  text_too_long: 'Text in a formula can be at most 200 characters.',
  bad_number: "{x} isn't a number a formula can use.",
  unexpected: 'Something is missing near {x}.',
  chained_compare: "Two comparisons can't be chained; join them with And.",
  trailing: 'There is something extra at the end: {x}.',
  unknown_field: "[{x}] isn't a field here.",
  tag_field: '[{label}] holds several values; use it as a filter instead.',
  unknown_function: "{x} isn't a function. Try If, Round or SumIf.",
  bare_field: 'Put field names in brackets, like [{x}].',
  arg_count: '{Fn} takes {n}.',
  needs_number: '{what} needs a number.',
  needs_condition: '{what} needs a yes/no condition.',
  needs_day: '{Fn} needs a day.',
  mixed_types: 'Both answers of If need the same kind of value.',
  compare_types: "These two sides can't be compared.",
  bad_result: 'A formula must give a number, text or yes/no.',
  nested_aggregate: "CountIf, SumIf, AvgIf and Share can't contain each other.",
  field_outside_aggregate:
    '[{label}] needs to be inside CountIf, SumIf, AvgIf or Share when the formula adds up rows.',
  aggregate_number: 'A formula that adds up rows must give a number.',
  bucket_edges: "Bucket's edges must be numbers, rising from left to right.",
  bucket_edge_places: "Bucket's edges can have at most 4 decimal places.",
  round_digits: "Round's second value must be a whole number from 0 to 6.",
  hour_no_time: 'Hour needs a time; [{label}] has none here.',
})
const ERRORS_MAP = new Map(Object.entries(ERRORS))

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ---------------------------------------------------------------------------------------------
// Characters. Fixed code point lists, never `\p{}` or a Unicode table, so both twins agree on
// every engine.

const WS = new Set([' ', '\t', '\n'])
const CMP_OPS = new Set(['=', '<>', '<', '<=', '>', '>='])
const ADD_OPS = new Set(['+', '-'])
const MUL_OPS = new Set(['*', '/'])
const NEG_OPS = new Set(['-'])
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '=', '<', '>'])
const TWO_CHAR_OPS = new Set(['<>', '<=', '>='])

/** Refused ANYWHERE, inside a text or a field name too (see the server for the reasons). */
const FORBIDDEN_RANGES = [
  [0x0000, 0x0008], [0x000B, 0x001F], [0x007F, 0x009F], [0x00AD, 0x00AD], [0x034F, 0x034F],
  [0x061C, 0x061C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180F], [0x200B, 0x200F],
  [0x202A, 0x202E], [0x2060, 0x206F], [0x20E3, 0x20E3], [0x2800, 0x2800], [0x3164, 0x3164],
  [0xD800, 0xDFFF], [0xFE00, 0xFE0F], [0xFEFF, 0xFEFF], [0xFFA0, 0xFFA0], [0xFFF9, 0xFFFB],
  [0x1BCA0, 0x1BCA3], [0x1D173, 0x1D17A], [0xE0000, 0xE0FFF],
]
/** Emoji ranges for the joiner rule (the skin tones U+1F3FB-1F3FF lie inside the first). */
const EMOJI_RANGES = [
  [0x1F000, 0x1FAFF], [0x2600, 0x27BF], [0x2300, 0x23FF], [0x2B00, 0x2BFF], [0x1F3FB, 0x1F3FF],
]
/** Space-like: allowed inside a text or a field name, never trimmed, written as U+XXXX when
 *  quoted back. */
const SPACE_LIKE_RANGES = [
  [0x00A0, 0x00A0], [0x1680, 0x1680], [0x2000, 0x200A], [0x202F, 0x202F], [0x205F, 0x205F],
  [0x3000, 0x3000],
]
/** Line terminators: each ends a text and a field name exactly as a newline does. */
const LINE_ENDS = new Set(['\n', '\u2028', '\u2029'])
const PRESENTATION_SELECTORS = new Set(['\uFE0E', '\uFE0F'])
const ZWJ = '\u200D'
const KEYCAP = '\u20E3'
const KEYCAP_BASES = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '*'])

function sortedTable(ranges) {
  const ordered = ranges.slice().sort((a, b) => a[0] - b[0])
  return { los: ordered.map((r) => r[0]), his: ordered.map((r) => r[1]) }
}
const FORBIDDEN_TABLE = sortedTable(FORBIDDEN_RANGES)
const INVISIBLE_TABLE = sortedTable([
  ...FORBIDDEN_RANGES, ...SPACE_LIKE_RANGES, [0x0009, 0x000A], [0x2028, 0x2029],
])

const cp = (c) => c.codePointAt(0)

/** Binary search over non-overlapping ranges; printable ASCII is on neither list. */
function inTable(table, c) {
  const o = cp(c)
  if (o >= 0x20 && o <= 0x7E) return false
  const { los, his } = table
  let lo = 0
  let hi = los.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (los[mid] <= o) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found >= 0 && o <= his[found]
}
const forbidden = (c) => inTable(FORBIDDEN_TABLE, c)
const invisible = (c) => inTable(INVISIBLE_TABLE, c)
function emoji(c) {
  const o = cp(c)
  return EMOJI_RANGES.some((r) => r[0] <= o && o <= r[1])
}

const isDigit = (c) => c >= '0' && c <= '9' && c.length === 1
const isLetter = (c) => c.length === 1 && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))

/** ASCII-only lower case: only A-Z fold (never `toLowerCase`, which folds the Kelvin sign). */
function fold(s) {
  return s.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32))
}
const FOLDED_FUNCTIONS = new Map(FUNCTIONS.map((name) => [fold(name), name]))

/** Strip the code points in `set` from both ends of the array `cps`. */
function stripCps(cps, set) {
  let i = 0
  let j = cps.length
  while (i < j && set.has(cps[i])) i += 1
  while (j > i && set.has(cps[j - 1])) j -= 1
  return cps.slice(i, j)
}
const SPACE_TAB = new Set([' ', '\t'])
const SPACE_ONLY = new Set([' '])
const trimSpaceTab = (s) => stripCps(Array.from(s), SPACE_TAB).join('')

/**
 * Ruling W10-R30: inside the text literal opened at `start`, the refused character at `j` is
 * allowed when it is part of an ordinary emoji. Only code points INSIDE the text count as
 * neighbours (the opening quote does not). `s` is a code point array.
 *   * U+FE0E / U+FE0F after a visible character that is not a space;
 *   * U+200D when the code point after it is an emoji and the one before it is an emoji, or is
 *     U+FE0E/U+FE0F whose own previous code point is an emoji (ruling W10-R48: heart on fire,
 *     the rainbow flag, eye in speech bubble). A selector after a non-emoji licenses no joiner;
 *   * U+20E3 after 0-9, # or *, optionally with U+FE0E/U+FE0F between.
 */
function emojiPartOk(s, start, j) {
  const c = s[j]
  let prev = j - 1 > start ? s[j - 1] : null
  if (PRESENTATION_SELECTORS.has(c)) {
    return prev !== null && prev !== ' ' && !invisible(prev)
  }
  if (c === ZWJ) {
    const nxt = j + 1 < s.length ? s[j + 1] : null
    // W10-R48: an emoji's selector before the joiner; the emoji it presents is the neighbour.
    if (prev !== null && PRESENTATION_SELECTORS.has(prev)) prev = j - 2 > start ? s[j - 2] : null
    return prev !== null && nxt !== null && emoji(prev) && emoji(nxt)
  }
  if (c === KEYCAP) {
    if (prev !== null && PRESENTATION_SELECTORS.has(prev)) prev = j - 2 > start ? s[j - 2] : null
    return prev !== null && KEYCAP_BASES.has(prev)
  }
  return false
}

/**
 * A formula NAME's characters, exactly as the server screens them (`plan._name_chars_ok`, ruling
 * W10-R47): nothing the member cannot see, EXCEPT the parts of an ordinary emoji, judged by the
 * text-literal rule above (`emojiPartOk`, the ONE emoji helper) with EVERY code point of the name a
 * neighbour (`start = -1`; a text literal excludes its quotes). Skin tones are ordinary code points.
 * Still refused: other format characters, zero-width spaces, a joiner outside an emoji, bidi
 * controls, NBSP and the other space-like characters, tab and the line ends, a lone surrogate.
 * The caller trims the name first (the server's `str.strip`). Never throws.
 */
export function formulaNameCharsOk(name) {
  if (typeof name !== 'string') return false
  const s = Array.from(name)
  for (let j = 0; j < s.length; j += 1) {
    const ch = s[j]
    if (!invisible(ch)) continue
    if (!(forbidden(ch) && emojiPartOk(s, -1, j))) return false
  }
  return true
}

const code = (c) => `U+${cp(c).toString(16).toUpperCase().padStart(4, '0')}`

/** One refused character: printable ASCII as itself, an invisible one as U+XXXX, any other as
 *  its glyph followed by ` (U+XXXX)`. */
function shownChar(c) {
  const o = cp(c)
  if (o >= 0x21 && o <= 0x7E) return c
  if (invisible(c)) return code(c)
  return `${c} (${code(c)})`
}

/** Member text for a sentence: whitespace runs (space, tab, newline ONLY) become one space,
 *  trimmed, clipped to SHOWN_MAX code points, then every invisible character written as U+XXXX
 *  -- except a selector, joiner or keycap that builds an allowed emoji (ruling W10-R31), judged on
 *  the whole collapsed text before the clip. */
function shown(x) {
  const out = []
  let inWs = false
  for (const ch of Array.from(x)) {
    if (WS.has(ch)) {
      if (!inWs) out.push(' ')
      inWs = true
      continue
    }
    inWs = false
    out.push(ch)
  }
  const whole = stripCps(out, SPACE_ONLY)
  const clip = whole.slice(0, SHOWN_MAX)
  let text = ''
  for (let k = 0; k < clip.length; k += 1) {
    const c = clip[k]
    const keep = forbidden(c) ? emojiPartOk(whole, -1, k) : false
    text += keep || !invisible(c) ? c : code(c)
  }
  return text
}

/** `x` in double quotes, unless it is a quoted text already. */
const quoted = (x) => (x.startsWith('"') ? x : `"${x}"`)

// ---------------------------------------------------------------------------------------------
// Refusals. Thrown inside this module only; `compileFormula` catches them and never throws.

class FormulaError extends Error {
  constructor(errCode, sentence, pos) {
    super(sentence)
    this.name = 'FormulaError'
    this.code = errCode
    this.sentence = sentence
    this.pos = pos
  }
}

/** Fill a template's named slots. A static switch, never an index by a slot name. */
function fillSlot(slot, fill) {
  switch (slot) {
    case 'x': return fill.x
    case 'label': return fill.label
    case 'Fn': return fill.Fn
    case 'n': return fill.n
    case 'what': return fill.what
    default: return ''
  }
}

function err(errCode, pos, fill = {}) {
  const template = ERRORS_MAP.get(errCode)
  const sentence = template.replace(/\{(x|label|Fn|n|what)\}/g, (_m, slot) => String(fillSlot(slot, fill)))
  return new FormulaError(errCode, sentence, pos)
}

// ---------------------------------------------------------------------------------------------
// Values.

/** A finite number or null; -0 becomes 0. */
function fin(x) {
  if (x === null || x === undefined || typeof x !== 'number' || !Number.isFinite(x)) return null
  return x + 0
}
const asNum = (v) => (typeof v === 'number' ? fin(v) : null)
const asText = (v) => (typeof v === 'string' ? v : null)
const asBool = (v) => (typeof v === 'boolean' ? v : null)

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** A real calendar day written `YYYY-MM-DD` (ASCII digits, year 0001-9999), else null. */
function asDay(v) {
  if (typeof v !== 'string' || v.length !== 10 || v.charAt(4) !== '-' || v.charAt(7) !== '-') return null
  const parts = [v.slice(0, 4), v.slice(5, 7), v.slice(8, 10)]
  for (const p of parts) {
    for (const ch of p) if (!isDigit(ch)) return null
  }
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (y < 1 || m < 1 || m > 12 || d < 1) return null
  const mi = m - 1
  const last = mi === 1 && isLeap(y) ? 29 : MONTH_DAYS[mi]
  if (d > last) return null
  return v
}

/** Python's `date.weekday()` (Monday 0), proleptic Gregorian, by Sakamoto's method: no Date
 *  object, so a year below 100 is not read as 19xx. */
const SAKAMOTO = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
function weekdayIndex(day) {
  let y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  const d = Number(day.slice(8, 10))
  if (m < 3) y -= 1
  const mi = m - 1
  const sunday0 = (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + SAKAMOTO[mi] + d) % 7
  return (sunday0 + 6) % 7
}

const COERCE = new Map([['number', asNum], ['text', asText], ['bool', asBool], ['day', asDay]])

/** A row's OWN value at `key` (a key from the field table, never member text); a getter is not
 *  run, an inherited or missing key reads as undefined. */
function readField(row, key) {
  if (row instanceof Map) return row.has(key) ? row.get(key) : undefined
  if (row === null || typeof row !== 'object' || !Object.hasOwn(row, key)) return undefined
  const desc = Object.getOwnPropertyDescriptor(row, key)
  return desc && 'value' in desc ? desc.value : undefined
}

// ---------------------------------------------------------------------------------------------
// Tokenizer: one left-to-right pass over code points; the FIRST problem met is the one reported.

function significant(run) {
  const dot = run.indexOf('.')
  const whole = dot < 0 ? run : run.slice(0, dot)
  const frac = dot < 0 ? '' : run.slice(dot + 1)
  return (whole + frac.replace(/0+$/, '')).replace(/^0+/, '').replace(/0+$/, '')
}

function validNumber(run) {
  const parts = run.split('.')
  if (parts.length > 2) return false
  for (const p of parts) {
    if (!p) return false
    for (const ch of p) if (!isDigit(ch)) return false
  }
  return significant(run).length <= SIG_DIGITS_MAX && Number.isFinite(Number(run))
}

function tokenize(s) {
  const toks = []
  const opens = []
  const n = s.length
  let i = 0

  const push = (t) => {
    if (toks.length >= MAX_TOKENS) throw err('too_many_parts', t.pos)
    toks.push(t)
  }
  const slice = (a, b) => s.slice(a, b).join('')

  while (i < n) {
    const c = s[i]
    if (WS.has(c)) { i += 1; continue }
    if (isDigit(c) || (c === '.' && i + 1 < n && isDigit(s[i + 1]))) {
      let j = i
      while (j < n && (isDigit(s[j]) || isLetter(s[j]) || s[j] === '.' || s[j] === '_')) j += 1
      const run = slice(i, j)
      if (!validNumber(run)) throw err('bad_number', i, { x: shown(run) })
      push({ kind: 'num', pos: i, end: j, text: run, value: Number(run) })
      i = j
      continue
    }
    if (isLetter(c)) {
      let j = i
      while (j < n && (isDigit(s[j]) || isLetter(s[j]) || s[j] === '_')) j += 1
      const word = slice(i, j)
      const folded = fold(word)
      if (folded === 'true' || folded === 'false') push({ kind: 'bool', pos: i, end: j, text: word, value: folded === 'true' })
      else push({ kind: 'name', pos: i, end: j, text: word, value: null })
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      const buf = []
      for (;;) {
        if (j >= n || LINE_ENDS.has(s[j])) throw err('unclosed_text', i)
        if (forbidden(s[j]) && !emojiPartOk(s, i, j)) throw err('bad_char', j, { x: shownChar(s[j]) })
        if (s[j] === '"') {
          if (j + 1 < n && s[j + 1] === '"') {
            buf.push('"')
            j += 2
            continue
          }
          break
        }
        buf.push(s[j])
        j += 1
      }
      if (buf.length > MAX_TEXT) throw err('text_too_long', i)
      push({ kind: 'text', pos: i, end: j + 1, text: slice(i, j + 1), value: buf.join('') })
      i = j + 1
      continue
    }
    if (c === '[') {
      let j = i + 1
      while (j < n && s[j] !== '[' && s[j] !== ']' && !LINE_ENDS.has(s[j])) {
        if (forbidden(s[j])) throw err('bad_char', j, { x: shownChar(s[j]) })
        j += 1
      }
      if (j >= n || s[j] !== ']') throw err('unclosed_field', i)
      push({ kind: 'field', pos: i, end: j + 1, text: slice(i, j + 1), value: trimSpaceTab(slice(i + 1, j)) })
      i = j + 1
      continue
    }
    if (c === '(') {
      push({ kind: '(', pos: i, end: i + 1, text: c, value: null })
      opens.push(i)
      if (opens.length > MAX_DEPTH) throw err('too_deep', i)
      i += 1
      continue
    }
    if (c === ')') {
      if (!opens.length) throw err('extra_paren', i)
      opens.pop()
      push({ kind: ')', pos: i, end: i + 1, text: c, value: null })
      i += 1
      continue
    }
    if (c === ',') {
      push({ kind: ',', pos: i, end: i + 1, text: c, value: null })
      i += 1
      continue
    }
    const two = slice(i, i + 2)
    if (TWO_CHAR_OPS.has(two)) {
      push({ kind: 'op', pos: i, end: i + 2, text: two, value: null })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.has(c)) {
      push({ kind: 'op', pos: i, end: i + 1, text: c, value: null })
      i += 1
      continue
    }
    throw err('bad_char', i, { x: shownChar(c) })
  }
  if (opens.length) throw err('unclosed_paren', opens.at(-1))
  return toks
}

// ---------------------------------------------------------------------------------------------
// Parser. Nodes: {k:'num',pos,value,text} {k:'text',pos,value} {k:'bool',pos,value}
// {k:'field',pos,name} {k:'neg',pos,count,operand} {k:'arith',pos,first,rest:[{op,opPos,operand}]}
// {k:'cmp',pos,op,opPos,left,right} {k:'call',pos,name,args}. Recursion happens only through `(`,
// whose depth the tokenizer has already capped.

class Parser {
  constructor(src, toks, st) {
    this.src = src
    this.toks = toks
    this.st = st
    this.i = 0
  }

  peek() {
    const { i } = this
    return i < this.toks.length ? this.toks[i] : null
  }

  unexpected(t) {
    if (t === null) {
      const lastTok = this.toks.at(-1)
      return err('unexpected', this.src.length, { x: quoted(shown(lastTok.text)) })
    }
    return err('unexpected', t.pos, { x: quoted(shown(t.text)) })
  }

  isOp(t, ops) { return t !== null && t.kind === 'op' && ops.has(t.text) }

  parse() {
    const node = this.expr()
    const t = this.peek()
    if (t !== null) throw err('trailing', t.pos, { x: quoted(shown(this.src.slice(t.pos).join(''))) })
    return node
  }

  expr() {
    const left = this.additive()
    const t = this.peek()
    if (!this.isOp(t, CMP_OPS)) return left
    this.i += 1
    const right = this.additive()
    const t2 = this.peek()
    if (this.isOp(t2, CMP_OPS)) throw err('chained_compare', t2.pos)
    return { k: 'cmp', pos: left.pos, op: t.text, opPos: t.pos, left, right }
  }

  chain(ops, operand) {
    const first = operand()
    const rest = []
    while (this.isOp(this.peek(), ops)) {
      const t = this.peek()
      this.i += 1
      rest.push({ op: t.text, opPos: t.pos, operand: operand() })
    }
    return rest.length ? { k: 'arith', pos: first.pos, first, rest } : first
  }

  additive() { return this.chain(ADD_OPS, () => this.multiplicative()) }

  multiplicative() { return this.chain(MUL_OPS, () => this.unary()) }

  unary() {
    let count = 0
    let start = null
    while (this.isOp(this.peek(), NEG_OPS)) {
      const t = this.peek()
      if (start === null) start = t.pos
      count += 1
      this.i += 1
    }
    const operand = this.primary()
    return count ? { k: 'neg', pos: start, count, operand } : operand
  }

  primary() {
    const t = this.peek()
    if (t === null) throw this.unexpected(null)
    const kind = t.kind
    if (kind === 'num') { this.i += 1; return { k: 'num', pos: t.pos, value: t.value, text: t.text } }
    if (kind === 'text') { this.i += 1; return { k: 'text', pos: t.pos, value: t.value } }
    if (kind === 'bool') { this.i += 1; return { k: 'bool', pos: t.pos, value: t.value } }
    if (kind === 'field') { this.i += 1; return { k: 'field', pos: t.pos, name: t.value } }
    if (kind === '(') {
      this.i += 1
      const node = this.expr()
      const close = this.peek()
      if (close === null || close.kind !== ')') throw this.unexpected(close)
      this.i += 1
      return node
    }
    if (kind === 'name') {
      const folded = fold(t.text)
      const name = FOLDED_FUNCTIONS.get(folded)
      if (name === undefined) {
        if (this.st.byKey.has(folded) || this.st.byLabel.has(folded)) throw err('bare_field', t.pos, { x: shown(t.text) })
        throw err('unknown_function', t.pos, { x: shown(t.text) })
      }
      this.i += 1
      const nxt = this.peek()
      if (nxt === null || nxt.kind !== '(') throw err('unexpected', t.pos, { x: quoted(shown(t.text)) })
      this.i += 1
      const args = []
      const first = this.peek()
      if (first !== null && first.kind === ')') {
        this.i += 1
        return { k: 'call', pos: t.pos, name, args }
      }
      for (;;) {
        args.push(this.expr())
        const sep = this.peek()
        if (sep !== null && sep.kind === ',') { this.i += 1; continue }
        if (sep !== null && sep.kind === ')') {
          this.i += 1
          return { k: 'call', pos: t.pos, name, args }
        }
        throw this.unexpected(sep)
      }
    }
    throw this.unexpected(t)
  }
}

// ---------------------------------------------------------------------------------------------
// Checker and compiler: one walk, left to right, that types every node and builds its closure.
// Order of refusals inside a node: a call checks nesting and its argument count, then each
// argument (left to right), then the argument types; an operator checks both sides first.

class State {
  constructor(fields) {
    this.byKey = new Map()
    this.byLabel = new Map()
    for (const fi of fieldValues(fields)) {
      const fk = fold(fi.key)
      const fl = fold(fi.label)
      if (!this.byKey.has(fk)) this.byKey.set(fk, fi)
      if (!this.byLabel.has(fl)) this.byLabel.set(fl, fi)
    }
    this.keysAt = new Map()
    this.reads = new Map()
    this.needsTimes = false
    this.aggs = []
    this.outside = null
    this.bucketAt = new Map()
  }
}

/** A usable field-table entry: an object with a non-empty string key, a string label and a
 *  string type. Anything else is treated as ABSENT (never coerced: a missing label must not
 *  become the field "undefined"), so a malformed table can never make compileFormula throw. */
function wellFormed(fi) {
  return fi !== null && typeof fi === 'object'
    && typeof fi.key === 'string' && fi.key.length > 0
    && typeof fi.label === 'string' && typeof fi.type === 'string'
}

/** The field table's well-formed entries, in order: a Map (key -> field) or, defensively, an
 *  array. */
function fieldValues(fields) {
  let all = []
  if (fields instanceof Map) all = Array.from(fields.values())
  else if (Array.isArray(fields)) all = fields.slice()
  return all.filter(wellFormed)
}

function resolveField(st, pos, name) {
  let fi
  if (Array.from(name).length <= NAME_MAX) {
    const f = fold(name)
    fi = st.byKey.get(f) || st.byLabel.get(f)
  }
  if (!fi) throw err('unknown_field', pos, { x: shown(name) })
  if (fi.type === 'tag') throw err('tag_field', pos, { label: fi.label })
  if (!COERCE.has(fi.type)) throw err('unknown_field', pos, { x: shown(name) })
  return fi
}

function check(node, st, inAgg) {
  switch (node.k) {
    case 'num': {
      const v = node.value + 0
      return ['number', () => v]
    }
    case 'text': {
      const v = node.value
      return ['text', () => v]
    }
    case 'bool': {
      const v = node.value
      return ['bool', () => v]
    }
    case 'field': return checkField(node, st, inAgg)
    case 'neg': {
      const [t, f] = check(node.operand, st, inAgg)
      if (t !== 'number') throw err('needs_number', node.operand.pos, { what: '-' })
      if (node.count % 2 === 0) return ['number', f]
      return ['number', (r) => {
        const x = f(r)
        return x === null ? null : fin(-x)
      }]
    }
    case 'arith': return checkArith(node, st, inAgg)
    case 'cmp': return checkCmp(node, st, inAgg)
    default: return checkCall(node, st, inAgg)
  }
}

function checkField(node, st, inAgg) {
  const fi = resolveField(st, node.pos, node.name)
  st.keysAt.set(node.pos, fi.key)
  if (!st.reads.has(fi.key)) st.reads.set(fi.key, COERCE.get(fi.type))
  st.needsTimes = st.needsTimes || Boolean(fi.needsTimes)
  if (!inAgg && st.outside === null) st.outside = { pos: node.pos, label: fi.label }
  const coerce = COERCE.get(fi.type)
  const key = fi.key
  return [fi.type, (r) => coerce(readField(r, key))]
}

function arithFn(op) {
  if (op === '+') return (a, b) => a + b
  if (op === '-') return (a, b) => a - b
  if (op === '*') return (a, b) => a * b
  return (a, b) => (b === 0 ? null : a / b)
}

function checkArith(node, st, inAgg) {
  const [t0, f0] = check(node.first, st, inAgg)
  const parts = node.rest.map((p) => ({ op: p.op, operand: p.operand, checked: check(p.operand, st, inAgg) }))
  if (t0 !== 'number') throw err('needs_number', node.first.pos, { what: node.rest[0].op })
  const steps = []
  for (const p of parts) {
    if (p.checked[0] !== 'number') throw err('needs_number', p.operand.pos, { what: p.op })
    steps.push([arithFn(p.op), p.checked[1]])
  }
  return ['number', (r) => {
    let v = f0(r)
    for (const [fn, g] of steps) {
      if (v === null) return null
      const w = g(r)
      if (w === null) return null
      v = fin(fn(v, w))
    }
    return v
  }]
}

const NUM_CMP = new Map([
  ['=', (a, b) => a === b], ['<>', (a, b) => a !== b], ['<', (a, b) => a < b],
  ['<=', (a, b) => a <= b], ['>', (a, b) => a > b], ['>=', (a, b) => a >= b],
])

function checkCmp(node, st, inAgg) {
  const { op, opPos, left, right } = node
  const [tl, fl] = check(left, st, inAgg)
  const [tr, fr] = check(right, st, inAgg)
  const cmp = NUM_CMP.get(op)
  let foldText = false
  if (op === '=' || op === '<>') {
    if (tl === tr) foldText = tl === 'text'
    else if ((tl === 'day' && tr === 'text') || (tl === 'text' && tr === 'day')) {
      const lit = tl === 'text' ? left : right
      if (lit.k !== 'text' || asDay(lit.value) === null) throw err('compare_types', opPos)
    } else throw err('compare_types', opPos)
  } else if (!(tl === tr && (tl === 'number' || tl === 'day'))) {
    throw err('compare_types', opPos)
  }
  if (foldText) {
    return ['bool', (r) => {
      const a = fl(r)
      const b = fr(r)
      if (a === null || b === null) return null
      return cmp(fold(a), fold(b))
    }]
  }
  return ['bool', (r) => {
    const a = fl(r)
    const b = fr(r)
    if (a === null || b === null) return null
    return cmp(a, b)
  }]
}

function checkCall(node, st, inAgg) {
  const { pos, name, args } = node
  const isAgg = AGGREGATES.has(name)
  if (isAgg && inAgg) throw err('nested_aggregate', pos)
  const [lo, hi] = ARITY.get(name)
  if (args.length < lo || args.length > hi) throw err('arg_count', pos, { Fn: name, n: ARITY_WORDS_MAP.get(name) })
  const checked = args.map((a) => check(a, st, inAgg || isAgg))
  return FN.get(name)(node, checked, st)
}

function need(errCode, checked, args, i, want, name) {
  if (checked[i][0] !== want) {
    if (errCode === 'needs_day') throw err(errCode, args[i].pos, { Fn: name })
    throw err(errCode, args[i].pos, { what: name })
  }
  return checked[i][1]
}

function fnIf(node, checked) {
  const { args } = node
  const cond = need('needs_condition', checked, args, 0, 'bool', 'If')
  const [ta, fa] = checked[1]
  const [tb, fb] = checked[2]
  if (ta !== tb) throw err('mixed_types', args[2].pos)
  return [ta, (r) => (cond(r) === true ? fa(r) : fb(r))]
}

const bools = (node, checked, name) => checked.map((_c, i) => need('needs_condition', checked, node.args, i, 'bool', name))
const numbers = (node, checked, name) => checked.map((_c, i) => need('needs_number', checked, node.args, i, 'number', name))

function fnAnd(node, checked) {
  const fs = bools(node, checked, 'And')
  return ['bool', (r) => fs.every((f) => f(r) === true)]
}

function fnOr(node, checked) {
  const fs = bools(node, checked, 'Or')
  return ['bool', (r) => fs.some((f) => f(r) === true)]
}

function fnNot(node, checked) {
  const f = need('needs_condition', checked, node.args, 0, 'bool', 'Not')
  return ['bool', (r) => {
    const x = f(r)
    return x === null ? null : !x
  }]
}

function fnAbs(node, checked) {
  const f = need('needs_number', checked, node.args, 0, 'number', 'Abs')
  return ['number', (r) => {
    const x = f(r)
    return x === null ? null : fin(Math.abs(x))
  }]
}

/** `sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d`, the same IEEE steps as the server. */
function roundHalfAway(x, d) {
  if (x === null) return null
  const m = 10 ** d
  const y = Math.abs(x) * m + 0.5
  if (!Number.isFinite(y)) return null
  const sign = x > 0 ? 1 : (x < 0 ? -1 : 0)
  return fin(sign * (Math.floor(y) / m))
}

const allDigits = (text) => Array.from(text).every((ch) => isDigit(ch))

function fnRound(node, checked) {
  const { args } = node
  const f = need('needs_number', checked, args, 0, 'number', 'Round')
  let d = 0
  if (args.length === 2) {
    const a = args[1]
    if (a.k !== 'num' || !allDigits(a.text) || a.value > ROUND_DIGITS_MAX) throw err('round_digits', a.pos)
    d = Math.trunc(a.value)
  }
  return ['number', (r) => roundHalfAway(f(r), d)]
}

function fnMin(node, checked) {
  const fs = numbers(node, checked, 'Min')
  return ['number', (r) => {
    let best = null
    for (const f of fs) {
      const x = f(r)
      if (x !== null && (best === null || x < best)) best = x
    }
    return fin(best)
  }]
}

function fnMax(node, checked) {
  const fs = numbers(node, checked, 'Max')
  return ['number', (r) => {
    let best = null
    for (const f of fs) {
      const x = f(r)
      if (x !== null && (best === null || x > best)) best = x
    }
    return fin(best)
  }]
}

function agg(kind, value, cond, st) {
  const idx = st.aggs.length
  st.aggs.push({ kind, value, cond })
  return ['number', (results) => results[idx]]
}

function fnCountIf(node, checked, st) {
  const cond = need('needs_condition', checked, node.args, 0, 'bool', 'CountIf')
  return agg('CountIf', null, cond, st)
}

function fnShare(node, checked, st) {
  const cond = need('needs_condition', checked, node.args, 0, 'bool', 'Share')
  return agg('Share', null, cond, st)
}

function valueAndCond(node, checked, name) {
  const value = need('needs_number', checked, node.args, 0, 'number', name)
  const cond = checked.length === 2 ? need('needs_condition', checked, node.args, 1, 'bool', name) : null
  return [value, cond]
}

function fnSumIf(node, checked, st) {
  const [value, cond] = valueAndCond(node, checked, 'SumIf')
  return agg('SumIf', value, cond, st)
}

function fnAvgIf(node, checked, st) {
  const [value, cond] = valueAndCond(node, checked, 'AvgIf')
  return agg('AvgIf', value, cond, st)
}

/** The literal's own digits: leading zeros and trailing fraction zeros trimmed, no exponent, a
 *  minus sign kept unless the number is zero. */
function edgeLabel(text, negative) {
  const dot = text.indexOf('.')
  let whole = dot < 0 ? text : text.slice(0, dot)
  let frac = dot < 0 ? '' : text.slice(dot + 1)
  whole = whole.replace(/^0+/, '') || '0'
  frac = frac.replace(/0+$/, '')
  const out = whole + (frac ? `.${frac}` : '')
  return negative && out !== '0' ? `-${out}` : out
}

/** A Bucket edge is `N` or `-N` with N a number literal: {value, label, exact}, else null. */
function literalEdge(node) {
  let neg = false
  let n = node
  if (n.k === 'neg' && n.count === 1) { neg = true; n = n.operand }
  if (n.k !== 'num') return null
  const value = neg ? -n.value : n.value
  const dot = n.text.indexOf('.')
  const frac = (dot < 0 ? '' : n.text.slice(dot + 1)).replace(/0+$/, '')
  return { value: value + 0, label: edgeLabel(n.text, neg), exact: frac.length <= BUCKET_PLACES_MAX }
}

/** `Under e1`, `e1 to e2`, ..., `ek or more`: the labels of a Bucket, in edge order. */
export function bucketLabelsFor(edgeLabels) {
  const out = [`Under ${edgeLabels[0]}`]
  for (let i = 1; i < edgeLabels.length; i += 1) out.push(`${edgeLabels[i - 1]} to ${edgeLabels[i]}`)
  out.push(`${edgeLabels.at(-1)} or more`)
  return out
}

function fnBucket(node, checked, st) {
  const { args } = node
  const f = need('needs_number', checked, args, 0, 'number', 'Bucket')
  const edges = []
  const printed = []
  for (const a of args.slice(1)) {
    const e = literalEdge(a)
    if (e === null) throw err('bucket_edges', a.pos)
    if (!e.exact) throw err('bucket_edge_places', a.pos)
    if (edges.length && !(e.value > edges.at(-1))) throw err('bucket_edges', a.pos)
    edges.push(e.value)
    printed.push(e.label)
  }
  const labels = bucketLabelsFor(printed)
  st.bucketAt.set(node.pos, labels)
  return ['text', (r) => {
    const v = f(r)
    if (v === null) return null
    let i = 0
    while (i < edges.length && v >= edges[i]) i += 1
    return labels[i]
  }]
}

function fnHour(node, checked, st) {
  const a = node.args[0]
  if (a.k !== 'field' || checked[0][0] !== 'day') throw err('needs_day', a.pos, { Fn: 'Hour' })
  const fi = resolveField(st, a.pos, a.name)
  if (typeof fi.hourKey !== 'string' || !fi.hourKey) throw err('hour_no_time', a.pos, { label: fi.label })
  const dayKey = fi.key
  const hourKey = fi.hourKey
  // The hour is read from its own key, so it is a field this formula reads (emptyFieldOf names it
  // on a dates-only row) and the formula needs times, like a hold-minutes field.
  if (!st.reads.has(hourKey)) st.reads.set(hourKey, asNum)
  st.needsTimes = true
  return ['number', (r) => {
    if (asDay(readField(r, dayKey)) === null) return null
    const h = asNum(readField(r, hourKey))
    if (h === null || !Number.isInteger(h) || h < 0 || h > 23) return null
    return h
  }]
}

function fnWeekday(node, checked) {
  const f = need('needs_day', checked, node.args, 0, 'day', 'Weekday')
  return ['text', (r) => {
    const d = f(r)
    if (d === null) return null
    const wi = weekdayIndex(d)
    return WEEKDAYS[wi]
  }]
}

/** The ONE dispatch table: canonical name -> builder(node, checkedArgs, state) -> [type, fn]. */
const FN = new Map([
  ['If', fnIf], ['And', fnAnd], ['Or', fnOr], ['Not', fnNot], ['Abs', fnAbs],
  ['Round', fnRound], ['Min', fnMin], ['Max', fnMax], ['CountIf', fnCountIf],
  ['SumIf', fnSumIf], ['AvgIf', fnAvgIf], ['Share', fnShare], ['Bucket', fnBucket],
  ['Hour', fnHour], ['Weekday', fnWeekday],
])

// ---------------------------------------------------------------------------------------------
// Public API.

function canonicalOf(src, toks, st) {
  let out = ''
  let last = 0
  for (const t of toks) {
    out += src.slice(last, t.pos).join('')
    if (t.kind === 'field') out += `[${st.keysAt.get(t.pos)}]`
    else if (t.kind === 'name') out += FOLDED_FUNCTIONS.get(fold(t.text))
    else if (t.kind === 'bool') out += t.value ? 'TRUE' : 'FALSE'
    else out += t.text
    last = t.end
  }
  return stripCps(Array.from(out), WS).join('')
}

function firstTokenPos(src) {
  let i = 0
  while (i < src.length && WS.has(src[i])) i += 1
  return i
}

function compileOrThrow(expr, fields) {
  if (typeof expr !== 'string') throw err('empty', 0)
  // Code points never exceed UTF-16 units, and are at least half of them: past twice the limit
  // the text is too long without walking it (a 1 MB paste answers at once).
  if (expr.length > 2 * MAX_LENGTH) throw err('too_long', MAX_LENGTH)
  const src = Array.from(expr)
  if (src.length > MAX_LENGTH) throw err('too_long', MAX_LENGTH)
  if (src.every((c) => WS.has(c))) throw err('empty', 0)
  let toks
  let st
  let tree
  let rtype
  let fn
  try {
    toks = tokenize(src)
    st = new State(fields)
    tree = new Parser(src, toks, st).parse()
    ;[rtype, fn] = check(tree, st, false)
  } catch (e) {
    if (e instanceof RangeError) throw err('too_deep', 0)
    throw e
  }
  const start = firstTokenPos(src)
  let kind
  let program
  const reads = Array.from(st.reads.entries())
  if (st.aggs.length) {
    if (st.outside !== null) throw err('field_outside_aggregate', st.outside.pos, { label: st.outside.label })
    if (rtype !== 'number') throw err('aggregate_number', start)
    kind = 'aggregate'
    program = Object.freeze({ tree, row: null, aggs: st.aggs.slice(), outer: fn, reads })
  } else {
    if (rtype !== 'number' && rtype !== 'text' && rtype !== 'bool') throw err('bad_result', start)
    kind = 'row'
    program = Object.freeze({ tree, row: fn, aggs: [], outer: null, reads })
  }
  const labels = tree.k === 'call' && tree.name === 'Bucket' ? st.bucketAt.get(tree.pos) || null : null
  return Object.freeze({
    canonical: canonicalOf(src, toks, st),
    kind,
    type: rtype,
    fields: reads.map((r) => r[0]),
    needsTimes: st.needsTimes,
    bucketLabels: labels,
    program,
  })
}

/**
 * Parse, type and compile `expr` against `fields` (a Map: key -> {key, label, type, hourKey,
 * needsTimes}). Never throws: `{ok: true, compiled}` or `{ok: false, code, sentence, pos}`, `pos`
 * a 0-based code point offset into the text as typed.
 */
export function compileFormula(expr, fields) {
  try {
    return { ok: true, compiled: compileOrThrow(expr, fields) }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, code: e.code, sentence: e.sentence, pos: e.pos }
    throw e
  }
}

/**
 * What a member sees inside the brackets for `fi`: its label, unless the label would not resolve
 * back to `fi` (it equals another field's key, it is shared, it is too long, it carries a
 * bracket, a line end, a refused character or outer spaces) -- then its key. So compiling the
 * displayed text always gives back the canonical one.
 */
export function displayName(fi, fields, st = null) {
  if (!wellFormed(fi)) return ''
  const lookup = st || new State(fields)
  const { label } = fi
  let ok = typeof label === 'string' && label.length > 0 && label === trimSpaceTab(label)
  if (ok) {
    const cps = Array.from(label)
    ok = cps.length <= NAME_MAX && !cps.some((ch) => ch === '[' || ch === ']' || LINE_ENDS.has(ch) || forbidden(ch))
  }
  if (ok) {
    const folded = fold(label)
    ok = (lookup.byKey.get(folded) || lookup.byLabel.get(folded)) === fi
  }
  return ok ? label : fi.key
}

/** The canonical text with every known field key written as its display name. A key no longer
 *  in `fields` stays as written; a text that no longer tokenizes is returned as stored, with any
 *  lone surrogate replaced so the answer can always be encoded. */
export function displayFormula(canonical, fields) {
  if (typeof canonical !== 'string') return ''
  const src = Array.from(canonical)
  let toks
  try {
    toks = tokenize(src)
  } catch (e) {
    if (!(e instanceof FormulaError)) throw e
    return src.map((c) => (cp(c) >= 0xD800 && cp(c) <= 0xDFFF ? '\uFFFD' : c)).join('')
  }
  const byKey = new Map()
  for (const fi of fieldValues(fields)) byKey.set(fi.key, fi)
  const st = new State(fields)
  const names = new Map()
  let out = ''
  let last = 0
  for (const t of toks) {
    if (t.kind === 'field' && byKey.has(t.value)) {
      if (!names.has(t.value)) names.set(t.value, displayName(byKey.get(t.value), fields, st))
      out += src.slice(last, t.pos).join('')
      out += `[${names.get(t.value)}]`
      last = t.end
    }
  }
  out += src.slice(last).join('')
  return out
}

/** A row formula's value on one row (null is "no data"). */
export function evalRow(compiled, row) {
  if (!compiled || compiled.kind !== 'row') {
    throw new TypeError('evalRow takes a row formula; use evalGroup for one that adds up rows')
  }
  return compiled.program.row(row)
}

/** An aggregate formula over one group of rows, in ONE pass; `check()` is called before rows
 *  256, 512, ... (every CHECK_EVERY rows), the server's cadence. */
export function evalGroup(compiled, rows, { check: checkFn = null } = {}) {
  if (!compiled || compiled.kind !== 'aggregate') {
    throw new TypeError('evalGroup takes a formula that adds up rows')
  }
  const { aggs } = compiled.program
  const k = aggs.length
  const sums = new Array(k).fill(0)
  const hits = new Array(k).fill(0)
  let n = 0
  let i = 0
  for (const row of rows) {
    if (checkFn !== null && i && i % CHECK_EVERY === 0) checkFn()
    i += 1
    n += 1
    for (let j = 0; j < k; j += 1) {
      const { value, cond } = aggs[j]
      if (cond !== null && cond(row) !== true) continue
      if (value === null) {
        hits[j] += 1
        continue
      }
      const v = value(row)
      if (v !== null) {
        sums[j] += v
        hits[j] += 1
      }
    }
  }
  const results = []
  for (let j = 0; j < k; j += 1) {
    const { kind } = aggs[j]
    if (kind === 'CountIf') results.push(n ? hits[j] + 0 : null)
    else if (kind === 'Share') results.push(n ? fin(hits[j] / n) : null)
    else if (kind === 'SumIf') results.push(hits[j] ? fin(sums[j]) : null)
    else results.push(hits[j] ? fin(sums[j] / hits[j]) : null)
  }
  return compiled.program.outer(results)
}

/** The first referenced field (in the order the formula names them) with no value on `row`. */
export function emptyFieldOf(compiled, row) {
  for (const [key, coerce] of compiled.program.reads) {
    if (coerce(readField(row, key)) === null) return key
  }
  return null
}

function withCommas(n) {
  const digits = String(n)
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i && (digits.length - i) % 3 === 0) out += ','
    out += digits.charAt(i)
  }
  return out
}

/**
 * The footnote for rows a formula skipped; null when nothing was skipped. `n` must be a whole
 * number from 1 to `SCAN_ROWS + 1` (no scan can skip more), else null; it is written with the
 * server's thousands grouping (`5,001`), never an exponent.
 *
 * The one accepted divergence from the server: Python refuses the float `1.0` while JavaScript
 * cannot tell `1.0` from `1`, so here both are 1.
 */
export function skipNotice(n, label, unitOne, unitMany) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > SCAN_ROWS + 1) return null
  const unit = n === 1 ? unitOne : unitMany
  if (label) return `[${label}] is empty on ${withCommas(n)} ${unit}; those are skipped`
  return `This formula has no value on ${withCommas(n)} ${unit}; those are skipped`
}

// ---------------------------------------------------------------------------------------------
// Autocomplete.

const SUGGEST_MAX = 12
const isWordChar = (c) => isLetter(c) || isDigit(c) || c === '_'

/** Rank `items` by `text(item)` against `query` (ASCII-folded): every prefix match, in source
 *  order, then every other match that contains the query. */
function rank(items, query, text) {
  const q = fold(query)
  const prefix = []
  const contains = []
  for (const item of items) {
    const t = fold(text(item))
    if (t.startsWith(q)) prefix.push(item)
    else if (q && t.includes(q)) contains.push(item)
  }
  return [prefix, contains]
}

/** The code point offset of the UTF-16 offset `units` in `text` (a textarea's `selectionStart`
 *  counts UTF-16 units). An offset inside a surrogate pair counts that whole character. */
export function utf16ToCodePoint(text, units) {
  if (typeof text !== 'string') return 0
  const u = Number.isInteger(units) ? Math.max(0, Math.min(units, text.length)) : text.length
  return Array.from(text.slice(0, u)).length
}

/** The UTF-16 offset of the code point offset `points` in `text`: maps a compile error's `pos`
 *  (code points, the shared contract) to a textarea selection. */
export function codePointToUtf16(text, points) {
  if (typeof text !== 'string') return 0
  const cps = Array.from(text)
  const p = Number.isInteger(points) ? Math.max(0, Math.min(points, cps.length)) : cps.length
  return cps.slice(0, p).join('').length
}

/**
 * Autocomplete at `caret`, a UTF-16 offset (a textarea's `selectionStart`). Inside an open `[`:
 * the fields whose label matches what is typed after it; on a bare word: the functions whose
 * name matches it, then the fields; inside a text literal: nothing. At most 12, prefix matches
 * first, then contains matches. Each suggestion is `{insert, label, kind, from, to}`, where
 * `from`..`to` is the UTF-16 range it replaces, so `value.slice(0, from) + insert +
 * value.slice(to)` splices the textarea directly; inside a bracket the range runs through the
 * closing `]` when one follows. A field is inserted by its display name, so the text compiles
 * back to the same field; a field that holds several values is never offered.
 */
export function suggest(expr, caret, fields) {
  if (typeof expr !== 'string' || expr.length > 2 * MAX_LENGTH) return []
  const src = Array.from(expr)
  const at = utf16ToCodePoint(expr, Number.isInteger(caret) ? caret : expr.length)
  const usable = fieldValues(fields).filter((fi) => fi.type !== 'tag' && COERCE.has(fi.type))
  const st = new State(fields)
  const units = (points) => codePointToUtf16(expr, points)

  // One pass up to the caret: are we inside a text, and is a bracket open?
  let inText = false
  let open = -1
  for (let i = 0; i < at; i += 1) {
    const c = src[i]
    if (inText) {
      if (c === '"' || LINE_ENDS.has(c)) inText = false
      continue
    }
    if (c === '"') inText = true
    else if (c === '[') open = i
    else if (c === ']' || LINE_ENDS.has(c)) open = -1
  }
  if (inText) return []

  if (open >= 0) {
    let end = at
    for (let j = at; j < src.length; j += 1) {
      const c = src[j]
      if (c === ']') { end = j + 1; break }
      if (c === '[' || c === '"' || LINE_ENDS.has(c)) break
    }
    const typed = stripCps(src.slice(open + 1, at), SPACE_TAB).join('')
    const [prefix, contains] = rank(usable, typed, (fi) => fi.label)
    const from = units(open)
    const to = units(end)
    return [...prefix, ...contains].slice(0, SUGGEST_MAX).map((fi) => ({
      insert: `[${displayName(fi, fields, st)}]`, label: fi.label, kind: 'field', from, to,
    }))
  }

  let j = at
  while (j > 0 && isWordChar(src[j - 1])) j -= 1
  const word = src.slice(j, at).join('')
  if (!word || !isLetter(word.charAt(0))) return []
  const from = units(j)
  const to = units(at)
  const asFunction = (name) => ({ insert: `${name}(`, label: name, kind: 'function', from, to })
  const asField = (fi) => ({ insert: `[${displayName(fi, fields, st)}]`, label: fi.label, kind: 'field', from, to })
  const [fnPrefix, fnContains] = rank(FUNCTIONS, word, (name) => name)
  const [fiPrefix, fiContains] = rank(usable, word, (fi) => fi.label)
  return [
    ...fnPrefix.map(asFunction), ...fiPrefix.map(asField),
    ...fnContains.map(asFunction), ...fiContains.map(asField),
  ].slice(0, SUGGEST_MAX)
}
