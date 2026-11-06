// app/src/components/chart/engine/readoutSchema.js
//
// ─── THE READOUT SCHEMA — a definition's scalar rows, resolved and formatted ──
//
// A server-lane envelope carries a `payload` of scalars beside its columns
// (`serverCompute.withEnvelopeExtras`; read back by `scalarsFor`). Nothing in
// it is per-bar, so nothing in it is drawn — it is what the LEGEND SAYS IN
// WORDS: which benchmark was actually used, how far the line sits from its
// average, how many bars ago the last high was. This module is the one place a
// definition's top-level `readout[]` turns those scalars into rows.
//
// PURE. No React, no DOM, no registry, no serverCompute import — the scalars
// arrive as an argument. It names no definition: the tenant scan in
// `serverCompute.test.js` reads this file too, so a fourth server tenant needs
// no code here either.
//
// ⛔ FAIL CLOSED, EVERYWHERE. A row whose source resolves to nothing, whose
// value the declared format cannot print, or whose `when` gate is false is
// OMITTED — never "NaN", never "undefined", never an empty line. The only text
// that ever stands in for a missing value is a `fallback` the entry itself
// declared, and such a row is marked `muted` so a surface can grey it.
//
// THE ENTRY GRAMMAR (validated fail-closed by `defSchema.validateDefinition`):
//
//   readout: [{
//     key:      'benchmark',                 // unique per definition
//     label:    'Benchmark',                 // member-facing, operator voice
//     source:   'scalar:benchmark.resolved', // scalar:<path> | payload:<path> | input:<key>
//     format:   'text',                      // one of READOUT_FORMATS
//     when?:    'scalar:benchmark.fallback', // same grammar; falsy ⇒ row omitted
//     fallback?: 'not yet rated',            // shown, muted, when the source is missing
//     chip?:    true,                        // feeds the chip/pane suffix (at most MAX_CHIP_ROWS)
//     words?:   ['above', 'below'],          // `bool` only: the true / false words
//     card?:    { what, origin, evidence?, learn? }  // the three-line explanation (About page);
//                                            // `learn` is a key into the app's Learn map
//   }]
//
//   `scalar:` and `payload:` are synonyms — both resolve a dotted path over the
//   envelope's `payload` object. `input:` reads the instance's own input (its
//   declared default when unset). A `when` gate reads the same grammar.
//
// THE FORMATS — one line each, so the next format is one line too:
//   ratio    a number to 4 significant figures            1.0234 → 1.023
//   pct      a signed percentage, one decimal, '%'        1.84 → +1.8%
//   int      a whole number with thousands grouping       3600 → 3,600
//   barsAgo  a non-negative integer age in bars           0 → today · 3 → 3 bars ago
//   text     a non-empty string (or a finite number)      'S&P 500 (SPY)'
//   bool     true/false as a word pair                    true → yes (or `words[0]`)

export const READOUT_FORMATS = Object.freeze(['ratio', 'pct', 'int', 'barsAgo', 'text', 'bool'])

/** The source prefixes a row may read from. `scalar` and `payload` both mean
 *  the envelope's payload; `input` is the instance's own input. */
export const READOUT_SOURCE_PREFIXES = Object.freeze(['scalar', 'payload', 'input'])

/** The closed set of fields a readout entry may carry. Unknown fields fail
 *  closed in `defSchema` — a readout row is behavioural (it decides what the
 *  legend prints), not a document field to preserve. */
export const READOUT_ENTRY_FIELDS = Object.freeze([
  'key', 'label', 'source', 'format', 'when', 'fallback', 'chip', 'words', 'card',
])

/** The closed set of fields a row's `card` may carry. `learn` (2a-10) is a
 *  key into an APP-side lesson map (`lib/deskVideoHref.RS_LEARN_VIDEOS`): the
 *  schema checks it is a non-empty string and nothing more — the map is app
 *  code, this is engine code, and a key the map does not know renders no
 *  link rather than a broken one (`learnHref` answers null). */
export const READOUT_CARD_FIELDS = Object.freeze(['what', 'origin', 'evidence', 'learn'])

/** `<prefix>:<segment>(.<segment>)*` — a prefix from READOUT_SOURCE_PREFIXES and
 *  a dotted path of identifier segments. */
export const READOUT_SOURCE_RE = /^(scalar|payload|input):([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/

/** How many rows the chip suffix prints at most — a pane label is one line. */
export const MAX_CHIP_ROWS = 3

/** The `bool` format's words when the entry declares none. */
export const DEFAULT_BOOL_WORDS = Object.freeze(['yes', 'no'])

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Parse a `source` / `when` string into `{kind, path}`, or `null` when it is
 * not one. `kind` is `'scalar'` (for both `scalar:` and `payload:`) or `'input'`.
 *
 * @param {unknown} source
 * @returns {{kind: 'scalar'|'input', path: string[]}|null}
 */
export function parseReadoutSource(source) {
  if (typeof source !== 'string') return null
  const m = READOUT_SOURCE_RE.exec(source)
  if (!m) return null
  return { kind: m[1] === 'input' ? 'input' : 'scalar', path: m[2].split('.') }
}

/** Walk a dotted path over plain objects. `undefined` the moment a step is not
 *  a plain object or the key is not its own — never a prototype read. */
function readPath(obj, path) {
  let cur = obj
  for (const seg of path) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined
    cur = cur[seg]
  }
  return cur
}

/** An instance input as the compute reads it: the stored value, else the
 *  declared default. `undefined` for a key nothing declares. */
function readInput(def, inputs, key) {
  if (inputs && inputs[key] !== undefined) return inputs[key]
  const declared = (def && Array.isArray(def.inputs) ? def.inputs : [])
    .find((i) => i && i.key === key)
  return declared ? declared.default : undefined
}

function readSource(parsed, scalars, def, inputs) {
  if (!parsed) return undefined
  if (parsed.kind === 'input') {
    // An input path is one key; `defSchema` refuses a dotted one, and a runtime
    // reader simply finds nothing for it.
    return parsed.path.length === 1 ? readInput(def, inputs, parsed.path[0]) : undefined
  }
  return readPath(scalars, parsed.path)
}

/** Thousands grouping for a whole number, no locale involved. */
function groupedInt(n) {
  const r = Math.round(n)
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (r < 0 ? '-' : '') + digits
}

function boolWords(entry) {
  const w = entry && entry.words
  return Array.isArray(w) && w.length === 2 ? w : DEFAULT_BOOL_WORDS
}

/**
 * ONE value → ONE string, by format. `null` whenever the value is not one the
 * format can honestly print — the caller omits the row.
 *
 * @param {string} format one of READOUT_FORMATS
 * @param {unknown} value the resolved source value
 * @param {object} [entry] the readout entry (for `words`)
 * @returns {string|null}
 */
export function formatReadoutValue(format, value, entry) {
  switch (format) {
    case 'ratio': {
      if (!isNum(value)) return null
      // 4 significant figures, trailing zeros dropped: 1.0234 → 1.023, 0.2477 → 0.2477
      return String(Number(value.toPrecision(4)))
    }
    case 'pct': {
      if (!isNum(value)) return null
      const s = value.toFixed(1)
      if (Number(s) === 0) return '0.0%'                 // never "-0.0%"
      return `${value > 0 ? '+' : ''}${s}%`
    }
    case 'int':
      return isNum(value) ? groupedInt(value) : null
    case 'barsAgo': {
      if (!Number.isInteger(value) || value < 0) return null
      if (value === 0) return 'today'
      return value === 1 ? '1 bar ago' : `${value} bars ago`
    }
    case 'text': {
      if (typeof value === 'string') { const t = value.trim(); return t || null }
      return isNum(value) ? String(value) : null
    }
    case 'bool': {
      if (typeof value !== 'boolean') return null
      const w = boolWords(entry)[value ? 0 : 1]
      return (typeof w === 'string' && w) ? w : null      // an empty word omits the row
    }
    default:
      return null
  }
}

/** Truthiness for a `when` gate: JS truthiness, which already reads `null`,
 *  `undefined`, `0`, `''`, `false` and `NaN` as off. */
const gateOpen = (v) => Boolean(v)

function resolveRow(entry, scalars, def, inputs) {
  if (!isPlainObject(entry)) return null
  if (typeof entry.key !== 'string' || !entry.key) return null
  if (typeof entry.label !== 'string') return null
  if (!READOUT_FORMATS.includes(entry.format)) return null
  const src = parseReadoutSource(entry.source)
  if (!src) return null
  if (entry.when !== undefined && entry.when !== null) {
    const gate = parseReadoutSource(entry.when)
    if (!gate) return null
    if (!gateOpen(readSource(gate, scalars, def, inputs))) return null
  }
  const value = readSource(src, scalars, def, inputs)
  const text = (value === undefined || value === null) ? null : formatReadoutValue(entry.format, value, entry)
  if (typeof text === 'string' && text) {
    return { key: entry.key, label: entry.label, value, text, muted: false }
  }
  if (typeof entry.fallback === 'string' && entry.fallback) {
    return { key: entry.key, label: entry.label, value: null, text: entry.fallback, muted: true }
  }
  return null
}

/**
 * A definition's `readout[]` resolved against the scalars its envelope carried
 * and this instance's inputs — one row per entry that can honestly print.
 *
 * NEVER THROWS, and returns `[]` for anything that is not a definition with a
 * readout block over a plain scalars object: this runs on the crosshair path.
 *
 * @param {object} def the definition (reads `def.readout` and `def.inputs`)
 * @param {object|null} scalars the envelope's payload (`scalarsFor`'s answer)
 * @param {{inputs?: object}} [ctx] the instance's stored inputs, for `input:` rows
 * @returns {{key: string, label: string, value: *, text: string, muted: boolean}[]}
 *   in declaration order
 */
export function readoutRows(def, scalars, ctx) {
  const entries = def && Array.isArray(def.readout) ? def.readout : []
  if (!entries.length) return []
  const payload = isPlainObject(scalars) ? scalars : null
  const inputs = ctx && isPlainObject(ctx.inputs) ? ctx.inputs : {}
  const out = []
  for (const entry of entries) {
    let row = null
    try { row = resolveRow(entry, payload, def, inputs) } catch { row = null }
    if (row) out.push(row)
  }
  return out
}

/**
 * The rows that feed the chip / pane suffix: the entries flagged `chip: true`
 * when any are, else the first rows — never more than MAX_CHIP_ROWS, and never
 * a muted fallback (a pane label is not the place for "not yet rated").
 *
 * @param {object} def the definition (reads `def.readout[].chip`)
 * @param {object[]} rows `readoutRows`' answer
 * @returns {object[]} a subset of `rows`, in order
 */
export function readoutChipRows(def, rows) {
  const entries = def && Array.isArray(def.readout) ? def.readout : []
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.muted !== true && typeof r.text === 'string' && r.text) : []
  const flagged = new Set(entries.filter((e) => isPlainObject(e) && e.chip === true).map((e) => e.key))
  const picked = flagged.size ? list.filter((r) => flagged.has(r.key)) : list
  return picked.slice(0, MAX_CHIP_ROWS)
}
