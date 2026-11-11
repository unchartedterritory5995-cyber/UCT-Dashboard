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
//     when?:    'scalar:benchmark.fallback', // same grammar; falsy ⇒ row omitted; or the
//                                            // equals form 'input:view=rotation' (below)
//     fallback?: 'not yet rated',            // shown, muted, when the source is missing
//     chip?:    true,                        // feeds the chip/pane suffix (at most MAX_CHIP_ROWS);
//                                            // `false` = named and NOT a chip (F3: a definition
//                                            // that writes `chip` anywhere names its chip rows)
//     words?:   ['above', 'below'],          // `bool` only: the true / false words
//     card?:    { what, origin, evidence?, learn?, evidenceSource? }
//                                            // the three-line explanation (About page);
//                                            // `learn` is a key into the app's Learn map;
//                                            // `evidenceSource` (2b-09) is a `scalar:` /
//                                            // `payload:` path whose text REPLACES the
//                                            // static `evidence` line when it resolves
//     detailOf?: 'rsHigh',                   // a DETAIL row: it prints only inside that
//                                            // glance row's card (the numbers block)
//     note?:    'scalar:benchmark.note',     // same grammar: a muted second line under
//                                            // the value, absent when it resolves to nothing
//     muted?:   true,                        // the value itself prints in the quiet ink
//                                            // (a qualifier, never a pane-label value);
//                                            // or a gate in the `when` grammar (3-08):
//                                            // 'scalar:rotation.reason' mutes the row
//                                            // while the server says why it has no reading
//     chipWhen?: {key: 'headlineRating', in: ['ibd', 'both']},
//                                            // a `chip` row rides the pane label ONLY while
//                                            // this input condition holds (the inputs'
//                                            // `activeWhen` grammar); the row itself stays
//     chipPrefix?: 'fast',                   // a word printed before the value in the pane
//                                            // label only (`fast 91`), never in the menu
//     band?:    {source: 'scalar:rating.ibd', when: 'input:ratingBands'},
//                                            // a 1-99 rating the row is coloured by: the
//                                            // site's bands (RATING_BANDS), only while `when`
//     action?:  {kind: 'pickDate', input: 'anchorDate'},
//                                            // one thing the row offers to DO (3-07):
//                                            // READOUT_ACTION_KINDS, closed; the surface
//                                            // (StockChart, unit 3-09) renders it
//   }]
//
// ⭐ THE EQUALS GATE (UCT RS 3-07). A `when` (and a `band.when`) may also be
// `input:<key>=<value>`: open while that ENUM input holds that option value
// (`input:view=rotation`, a row printed only under its view). Closed grammar:
// `input:` only (a scalar gate stays truthiness), one `=`, and `defSchema`
// refuses a key that is not a declared enum input or a value that is not one of
// its declared string options, so a typo can never hide a row forever.
//
// An `input:` source in `text` format over an `enum` input prints the option's
// LABEL (`Sector ETF (auto)`), never the stored code (`SECTOR`).
//
// ⭐ GLANCE ROWS AND DETAIL ROWS (Phase 2a visual round, item A1). The chip menu
// is a read in under five seconds, so it lists the GLANCE rows only — every
// entry without `detailOf`, in declaration order. A row with `detailOf:
// '<glanceKey>'` explains one glance row and renders inside that row's card, in
// a "numbers" block above the three card lines. `defSchema` holds the nesting
// to ONE level: `detailOf` names an entry that has a `card` and no `detailOf` of
// its own. `readoutRows` copies the field onto each resolved row (absent on a
// glance row), so a surface groups the rows without re-reading the definition.
// A chip row may be a detail row: the pane suffix reads `chip`, never `detailOf`.
//
//   `scalar:` and `payload:` are synonyms — both resolve a dotted path over the
//   envelope's `payload` object. `input:` reads the instance's own input (its
//   declared default when unset). A `when` gate reads the same grammar.
//
// THE EVIDENCE LINE (unit 2b-09). A card's "What the evidence says" is the one
// line that changes without a deploy: the nightly backtest (2b-01) publishes
// `rs/evidence.json`, the web pod pulls it (2b-03) and the provider writes one
// sentence per card into `payload.evidence.sentence.<key>` — the measured
// sentence when the signal clears the display floor, the honesty sentence
// ("No published hit rate exists for this signal and UCT has not measured one
// yet.") when it does not. `cardEvidenceText` reads that path when the card
// declares `evidenceSource`, and falls back to the static `card.evidence`
// (the literature statement, or the same honesty sentence) when the envelope
// carries nothing there. The static line is therefore what a chart with no
// landed envelope prints, never a blank.
//
// ⭐ THE LITERATURE LINE STAYS (review finding #22, 2026-11-07). A sourced card
// writes its static `evidence` as zero or more literature sentences followed by
// ONE stand-in sentence, the last: the honesty sentence. The server sentence
// replaces only that stand-in, so the Before-price card prints Bulkowski and
// then the measured (or below-floor) sentence. Before this, a V2 envelope always
// carried a string there, so the Bulkowski line never printed. A card whose
// static line is the stand-in alone prints the server sentence alone, as before.
//
// THE FORMATS — one line each, so the next format is one line too:
//   ratio    a number to 4 significant figures            1.0234 → 1.023
//   pct      a signed percentage, one decimal, '%'        1.84 → +1.8%
//   int      a whole number with thousands grouping       3600 → 3,600
//   barsAgo  a non-negative integer age in bars           0 → today · 3 → 3 bars ago
//   text     a non-empty string (or a finite number)      'S&P 500 (SPY)'
//   bool     true/false as a word pair                    true → yes (or `words[0]`)

import { inputsAsRead } from './legacyInputs'

export const READOUT_FORMATS = Object.freeze(['ratio', 'pct', 'int', 'barsAgo', 'text', 'bool'])

/** The source prefixes a row may read from. `scalar` and `payload` both mean
 *  the envelope's payload; `input` is the instance's own input. */
export const READOUT_SOURCE_PREFIXES = Object.freeze(['scalar', 'payload', 'input'])

/** The closed set of fields a readout entry may carry. Unknown fields fail
 *  closed in `defSchema` — a readout row is behavioural (it decides what the
 *  legend prints), not a document field to preserve. */
export const READOUT_ENTRY_FIELDS = Object.freeze([
  'key', 'label', 'source', 'format', 'when', 'fallback', 'chip', 'words', 'card', 'detailOf', 'note', 'muted',
  'chipWhen', 'chipPrefix', 'band', 'action',
])

/** ⭐ UCT RS 3-07 — what a readout row may offer to DO. Closed: an unknown kind
 *  fails closed in `defSchema`, because a row's action is a control a member
 *  presses, not a document field to preserve.
 *    pickDate     `{kind, input}` — pick a bar on the chart; its date is written
 *                 to that `string` input (the RS anchor)
 *    resetInput   `{kind, input}` — put that `string` input back to its default
 *    openRotation `{kind}`        — open the Rotation view (Compare panel)
 *  Rendering is the surface's (`StockChart`, unit 3-09); `readoutRows` copies a
 *  well-formed action onto its row so the surface needs no second read. */
export const READOUT_ACTION_KINDS = Object.freeze(['pickDate', 'resetInput', 'openRotation'])

/** The action kinds that name an input, and the fields each kind carries. */
export const READOUT_ACTION_FIELDS = Object.freeze({
  pickDate: Object.freeze(['kind', 'input']),
  resetInput: Object.freeze(['kind', 'input']),
  openRotation: Object.freeze(['kind']),
})

/** The input type an input-naming action writes: both write a text value. */
export const READOUT_ACTION_INPUT_TYPE = 'string'

/** The comparators `chipWhen` may use — the inputs' `activeWhen` grammar
 *  (`indicatorRegistry.evalActiveWhen`), so there is one condition language for
 *  inputs, guides and readout rows. `readoutConditionOpen` mirrors that evaluator
 *  and `__tests__/readoutSchema.va2.test.js` pins the two agree. */
export const READOUT_CONDITION_OPS = Object.freeze(['equals', 'notEquals', 'in', 'gt', 'gte', 'lt', 'lte'])

/** ⭐ THE SITE'S RATING BANDS (UCT RS unit VA2; `components/RsBadge.jsx` tierClass,
 *  the screener's RS heat): 80 and above leads, 60 to 79 is strong, 40 to 59 is
 *  neutral, below 40 lags. Rules of thumb, not tested cut-offs, and the member
 *  copy says so. Highest floor first; the first floor a value reaches names it. */
export const RATING_BANDS = Object.freeze([[80, 'lead'], [60, 'strong'], [40, 'neutral'], [1, 'lag']])

/** The band a 1-99 rating sits in, or `null` for anything that is not one. */
export function ratingBandOf(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 99) return null
  for (const [floor, name] of RATING_BANDS) if (value >= floor) return name
  return null
}

/** The closed set of fields a row's `card` may carry. `learn` (2a-10) is a
 *  key into an APP-side lesson map (`lib/deskVideoHref.RS_LEARN_VIDEOS`): the
 *  schema checks it is a non-empty string and nothing more — the map is app
 *  code, this is engine code, and a key the map does not know renders no
 *  link rather than a broken one (`learnHref` answers null).
 *
 *  `evidenceSource` (2b-09) is a `scalar:` / `payload:` path in the row-source
 *  grammar (`READOUT_SOURCE_RE`); `defSchema` admits the NAME through this list
 *  and `cardEvidenceText` reads the value fail-closed — a path that does not
 *  parse, or resolves to anything but a non-empty string, leaves the static
 *  `evidence` line standing. */
export const READOUT_CARD_FIELDS = Object.freeze(['what', 'origin', 'evidence', 'learn', 'evidenceSource'])

/** `<prefix>:<segment>(.<segment>)*` — a prefix from READOUT_SOURCE_PREFIXES and
 *  a dotted path of identifier segments. */
export const READOUT_SOURCE_RE = /^(scalar|payload|input):([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/

/** ⭐ 3-07 — the equals gate: `input:<key>=<value>`. The value is an enum option
 *  code: letters, digits, `_`, `.` and `-`, never empty, never a second `=`. */
export const READOUT_GATE_EQUALS_RE = /^input:([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_][A-Za-z0-9_.-]*)$/

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

/**
 * Parse a `when` gate: the equals form (`input:<key>=<value>`) as
 * `{kind: 'input', path: [key], equals: value}`, else whatever
 * `parseReadoutSource` makes of it (`null` when it is neither).
 *
 * @param {unknown} when
 * @returns {{kind: 'scalar'|'input', path: string[], equals?: string}|null}
 */
export function parseReadoutGate(when) {
  if (typeof when !== 'string') return null
  const m = READOUT_GATE_EQUALS_RE.exec(when)
  if (m) return { kind: 'input', path: [m[1]], equals: m[2] }
  return parseReadoutSource(when)
}

/** A well-formed action copied fresh, or `null`. Runtime twin of the `defSchema`
 *  check (which also asks that the input is a declared `string` input). */
function readoutActionOf(action) {
  if (!isPlainObject(action) || !READOUT_ACTION_KINDS.includes(action.kind)) return null
  const fields = READOUT_ACTION_FIELDS[action.kind]
  if (Object.keys(action).some((k) => !fields.includes(k))) return null
  if (fields.includes('input')) {
    if (typeof action.input !== 'string' || !action.input) return null
    return { kind: action.kind, input: action.input }
  }
  return { kind: action.kind }
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

/** An instance input as the compute reads it: the stored value (a stored
 *  legacy input read as its successor, `legacyInputs.inputsAsRead`), else the
 *  declared default. `undefined` for a key nothing declares. The one reader of
 *  an input in this module: `input:` sources, equals gates, `muted`, `chipWhen`
 *  and the pane label's `legendFallback` all come through here. */
function readInput(def, stored, key) {
  const inputs = inputsAsRead(def, stored)
  if (inputs && inputs[key] !== undefined) return inputs[key]
  const declared = (def && Array.isArray(def.inputs) ? def.inputs : [])
    .find((i) => i && i.key === key)
  return declared ? declared.default : undefined
}

/**
 * Does an input condition hold for this instance? The inputs' `activeWhen`
 * grammar (`{key, equals}` / `notEquals` / `in` / `gt` / `gte` / `lt` / `lte`),
 * read over the instance's inputs with the declared default under each stored
 * value — the reading `fieldsForInstance(...).values` gives the dialog. Mirrors
 * `indicatorRegistry.evalActiveWhen` exactly (this module imports no registry);
 * the agreement is pinned by `__tests__/readoutSchema.va2.test.js`. A condition
 * that is not an object with a string `key` is open, as there.
 */
export function readoutConditionOpen(cond, def, inputs) {
  if (!isPlainObject(cond) || typeof cond.key !== 'string') return true
  const v = readInput(def, inputs, cond.key)
  if ('equals' in cond) return v === cond.equals
  if ('notEquals' in cond) return v !== cond.notEquals
  if ('in' in cond) return Array.isArray(cond.in) && cond.in.includes(v)
  if ('gt' in cond) return Number(v) > Number(cond.gt)
  if ('gte' in cond) return Number(v) >= Number(cond.gte)
  if ('lt' in cond) return Number(v) < Number(cond.lt)
  if ('lte' in cond) return Number(v) <= Number(cond.lte)
  if (Object.keys(cond).some((k) => k !== 'key')) return true
  return !!v
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

/** Is a parsed gate open? The equals form is strict identity with the option
 *  code; every other gate is truthiness. A gate that did not parse is CLOSED. */
function gateHolds(gate, scalars, def, inputs) {
  if (!gate) return false
  const v = readSource(gate, scalars, def, inputs)
  if (typeof gate.equals === 'string') return v === gate.equals
  return gateOpen(v)
}

/**
 * ⭐ A GATE STRING (the `when` grammar: a source read for truthiness, or the
 * `input:<key>=<value>` equals form) evaluated over one envelope and one
 * instance. Exported for the other declarative readers of the same payload
 * (`paneTable.js`), so there is one gate language, not two. A gate that does
 * not parse is CLOSED. Never throws.
 */
export function readoutGateOpen(when, scalars, def, inputs) {
  try {
    return gateHolds(parseReadoutGate(when), isPlainObject(scalars) ? scalars : null, def,
      isPlainObject(inputs) ? inputs : {})
  } catch { return false }
}

/**
 * The raw value one `source` string (`scalar:` / `payload:` / `input:`)
 * resolves to, or `undefined` when it does not parse or walks off the payload.
 * `null` is returned as `null`: the server SENT the key and said "nothing", which
 * a reader can tell from a key the payload does not carry at all. Never throws.
 */
export function readoutSourceValue(source, scalars, def, inputs) {
  try {
    return readSource(parseReadoutSource(source), isPlainObject(scalars) ? scalars : null, def,
      isPlainObject(inputs) ? inputs : {})
  } catch { return undefined }
}

/** ⭐ UCT RS 3-08 — is the row's value printed in the quiet ink? `muted: true`
 *  always; a `muted` GATE (the `when` grammar) while it holds — the server's
 *  `reason` beside a reading it could not make, so the row says why in the muted
 *  ink and never reaches the pane label. A gate that does not parse is closed. */
function entryMuted(entry, scalars, def, inputs) {
  if (entry.muted === true) return true
  if (typeof entry.muted !== 'string') return false
  return gateHolds(parseReadoutGate(entry.muted), scalars, def, inputs)
}

function resolveRow(entry, scalars, def, inputs) {
  if (!isPlainObject(entry)) return null
  if (typeof entry.key !== 'string' || !entry.key) return null
  if (typeof entry.label !== 'string') return null
  if (!READOUT_FORMATS.includes(entry.format)) return null
  const src = parseReadoutSource(entry.source)
  if (!src) return null
  if (entry.when !== undefined && entry.when !== null) {
    const gate = parseReadoutGate(entry.when)
    if (!gate) return null
    if (!gateHolds(gate, scalars, def, inputs)) return null
  }
  let value = readSource(src, scalars, def, inputs)
  // ⭐ AN ENUM INPUT PRINTS ITS OPTION LABEL, never the stored code: a member
  // picked "Sector ETF (auto)", not "SECTOR" (Phase 2a visual spec, Benchmark
  // card, "Requested"). The label is the definition's own, so there is no second
  // copy of the option copy anywhere.
  if (src.kind === 'input' && entry.format === 'text') value = enumOptionLabel(def, src.path[0], value)
  const text = (value === undefined || value === null) ? null : formatReadoutValue(entry.format, value, entry)
  let row = null
  if (typeof text === 'string' && text) {
    // `muted: true` — a qualifier the row states in the quiet ink even with a
    // value (the short-history note); a muted row never reaches the pane label.
    row = { key: entry.key, label: entry.label, value, text, muted: entryMuted(entry, scalars, def, inputs) }
  } else if (typeof entry.fallback === 'string' && entry.fallback) {
    row = { key: entry.key, label: entry.label, value: null, text: entry.fallback, muted: true }
  }
  // A detail row says whose card it belongs to; a glance row carries no field at
  // all, so the row shape every existing surface reads is unchanged for it.
  if (row && typeof entry.detailOf === 'string' && entry.detailOf) row.detailOf = entry.detailOf
  // ⭐ `note` — a second, muted line under the value (the Benchmark row's
  // `Sector ETF not available for an ETF; using SPY`, `No SPY bar for Nov 5
  // yet`). Same source grammar as `source`; a note that resolves to nothing is
  // simply absent, and a row that cannot print never carries one.
  if (row && entry.note !== undefined && entry.note !== null) {
    const n = parseReadoutSource(entry.note)
    const v = n ? readSource(n, scalars, def, inputs) : undefined
    if (typeof v === 'string' && v.trim()) row.note = v.trim()
  }
  // ⭐ VA2 — `chipWhen`: a chip row whose condition is false stays a row (the menu
  // and the card still print it) and leaves the pane label (`readoutChipRows`).
  if (row && entry.chip === true && entry.chipWhen !== undefined && !readoutConditionOpen(entry.chipWhen, def, inputs)) {
    row.chipOff = true
  }
  // ⭐ VA2 — `chipPrefix`: the word the pane label prints before the value
  // (`fast 91`), so two numbers side by side say which is which. Never on a
  // muted fallback, which never reaches the pane label anyway.
  if (row && row.muted !== true && typeof entry.chipPrefix === 'string' && entry.chipPrefix.trim()) {
    row.chipText = `${entry.chipPrefix.trim()} ${row.text}`
  }
  // ⭐ VA2 — `band`: the site's rating band of a 1-99 number, while the band's
  // `when` gate is open (the member's rating-band switch). Absent otherwise, so a
  // surface that knows nothing of bands renders exactly as before.
  if (row && row.muted !== true && isPlainObject(entry.band)) {
    const hasGate = entry.band.when !== undefined && entry.band.when !== null
    const gate = hasGate ? parseReadoutGate(entry.band.when) : null
    const open = hasGate ? gateHolds(gate, scalars, def, inputs) : true
    const src = parseReadoutSource(entry.band.source)
    const band = open && src ? ratingBandOf(readSource(src, scalars, def, inputs)) : null
    if (band) row.band = band
  }
  // ⭐ 3-07 — `action`: what the row offers to do, copied fresh so a surface that
  // mutates it cannot reach the definition. Absent otherwise, so every row that
  // declares none keeps the exact shape it had.
  if (row && entry.action !== undefined) {
    const action = readoutActionOf(entry.action)
    if (action) row.action = action
  }
  return row
}

/** The option label an enum input declares for `value`, or `value` unchanged. */
function enumOptionLabel(def, key, value) {
  const declared = (def && Array.isArray(def.inputs) ? def.inputs : []).find((i) => i && i.key === key)
  if (!declared || declared.type !== 'enum' || !Array.isArray(declared.options)) return value
  const hit = declared.options.find((o) => Array.isArray(o) && o[0] === value)
  return hit && typeof hit[1] === 'string' && hit[1] ? hit[1] : value
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
 * @returns {{key: string, label: string, value: *, text: string, muted: boolean, detailOf?: string, note?: string,
 *   chipOff?: true, chipText?: string, band?: string, action?: {kind: string, input?: string}}[]}
 *   in declaration order; `detailOf` is present on a detail row only, `note` on
 *   a row whose declared note resolved to text; `chipOff` on a chip row whose
 *   `chipWhen` is false, `chipText` on a row with a `chipPrefix`, `band` on a
 *   row whose `band` gate is open over a 1-99 number, `action` on a row that
 *   declares a well-formed one
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
 * Is this entry (or resolved row) a GLANCE row, the kind the chip menu lists?
 * Every row without a `detailOf`. Pure, never throws.
 *
 * @param {object} entryOrRow a readout entry or a `readoutRows` row
 * @returns {boolean}
 */
export function isGlanceRow(entryOrRow) {
  if (!isPlainObject(entryOrRow)) return false
  return !(typeof entryOrRow.detailOf === 'string' && entryOrRow.detailOf)
}

/**
 * The rows that feed the chip / pane suffix: the entries flagged `chip: true`
 * when the definition NAMES its chip rows, else the first rows — never more than
 * MAX_CHIP_ROWS, and never a muted fallback (a pane label is not the place for
 * "not yet rated").
 *
 * ⭐ F3 (2026-11-10) — A DEFINITION NAMES ITS CHIP ROWS BY WRITING `chip` ON ANY
 * ROW, `true` or `false`. `chip: false` is "this row is not a chip, and none
 * is": UCT RS Rating's pane label is the rating line's own number (and the
 * summary that leads with it as the fallback), so a chip number printed it
 * twice — and with no `chip: true` row left, "the first rows" would have put the
 * summary sentence into the suffix instead. A definition that writes no `chip`
 * at all keeps the first-rows rule byte for byte.
 *
 * @param {object} def the definition (reads `def.readout[].chip`)
 * @param {object[]} rows `readoutRows`' answer
 * @returns {object[]} a subset of `rows`, in order
 */
export function readoutChipRows(def, rows) {
  const entries = def && Array.isArray(def.readout) ? def.readout : []
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.muted !== true && typeof r.text === 'string' && r.text) : []
  const named = entries.some((e) => isPlainObject(e) && typeof e.chip === 'boolean')
  const flagged = new Set(entries.filter((e) => isPlainObject(e) && e.chip === true).map((e) => e.key))
  // ⭐ VA2 — a flagged row whose `chipWhen` is false (`chipOff`) is left out, and
  // the definition still counts as one that flags its chip rows: switching the
  // rating off must never promote "the first rows" into the pane label.
  const picked = named ? list.filter((r) => flagged.has(r.key) && r.chipOff !== true) : list
  return picked.slice(0, MAX_CHIP_ROWS)
}

/**
 * The text of a card's "What the evidence says" line (unit 2b-09): the string
 * `card.evidenceSource` resolves to over `scalars` when it is a `scalar:` /
 * `payload:` path and the value there is a non-empty string, led by the static
 * line's literature sentences when it has any (finding #22: everything before
 * its last sentence, the stand-in the server sentence replaces); else the static
 * `card.evidence` when that is a non-empty string; else `null` (no line).
 *
 * ⛔ FAIL CLOSED, LIKE THE ROWS. An `evidenceSource` that does not parse, an
 * `input:` source (a card has no instance to read), a path that walks off the
 * payload, a null, a number, an empty string — every one of them is "nothing
 * measured" and leaves the static line standing. Whitespace is trimmed; the
 * text is otherwise VERBATIM, because a measured sentence carries its sample
 * size, dates and caveat and nothing here may reword them. NEVER THROWS.
 *
 * @param {object} entry a readout entry — anything carrying `.card`
 *   (`def.readout[i]`, or the resolved row the surface joined its card onto)
 * @param {object|null} scalars the envelope's payload, the SAME reader answer
 *   the rows were built from (`scalarsFor`); `null` when nothing landed
 * @returns {string|null}
 */
export function cardEvidenceText(entry, scalars) {
  try {
    const card = entry && isPlainObject(entry.card) ? entry.card : null
    if (!card) return null
    const stat = typeof card.evidence === 'string' ? card.evidence.trim() : ''
    const src = parseReadoutSource(card.evidenceSource)
    if (src && src.kind === 'scalar' && isPlainObject(scalars)) {
      const v = readPath(scalars, src.path)
      if (typeof v === 'string') {
        const t = v.trim()
        if (t) {
          // finding #22: keep the static line's literature, replace its stand-in
          const lit = literatureOf(stat)
          return lit ? `${lit} ${t}` : t
        }
      }
    }
    return stat || null
  } catch {
    return null
  }
}

/** A sourced card's static line minus its last sentence (the stand-in the
 *  server sentence replaces): everything up to the last sentence end that is
 *  followed by more text. `''` when the line is one sentence. */
function literatureOf(text) {
  const re = /[.?!](?=\s+\S)/g
  let end = -1
  for (let m = re.exec(text); m; m = re.exec(text)) end = m.index
  return end < 0 ? '' : text.slice(0, end + 1).trim()
}
