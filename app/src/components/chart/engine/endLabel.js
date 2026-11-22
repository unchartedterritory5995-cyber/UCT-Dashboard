// app/src/components/chart/engine/endLabel.js
//
// ─── THE LINE-END LABEL — a small tag at the last point of one plot ──────────
//
// MarketSurge prints the RS Rating at the right end of its RS line (`RS 96`), so
// the number sits where the eye already is. The engine draws no HTML, so the
// surface (`StockChart`) does: one tag per declared plot, positioned with the
// HOST SERIES' own `priceToCoordinate`, which is what makes it land on an `own:`
// scale in the price pane (`placement.js` `ownScaleOf`) and in an indicator pane
// alike. This module is the PURE half: the grammar, the value, the last finite
// point and the geometry. No React, no DOM, no definition named (UCT RS split, U2).
//
// ⭐ DECLARED, NOT CODED. A definition opts in per plot:
//
//   plots[].endLabel: {
//     source:  'scalar:rating.ibd' | 'payload:<a.b>' | 'value',
//                       // a payload scalar through the readout resolver
//                       // (`readoutSchema.readoutSourceValue`), or the plot's own
//                       // last finite value
//     prefix?: 'RS ',   // printed before the value, as written
//     suffix?: '%',     // printed after it
//     format?: 'int' | 'text' | 'ratio',   // `readoutSchema.formatReadoutValue`;
//                       // default: 'int' for a whole number, 'ratio' for any other
//                       // number, 'text' for a string
//     when?:   ['input:showRating', 'scalar:rating.asof'],  // readout gates; ALL
//                       // must hold or there is no tag
//   }
//
// ⛔ FAIL CLOSED. No value, a closed gate, a non-finite number, a source that does
// not parse: `null`, and the surface draws nothing. Never a zero, never a guess.

import {
  readoutGateOpen, readoutSourceValue, parseReadoutSource, parseReadoutGate, formatReadoutValue,
} from './readoutSchema'

/** The closed set of fields `plots[].endLabel` may carry. */
export const END_LABEL_FIELDS = Object.freeze(['source', 'prefix', 'suffix', 'format', 'when'])
/** The formats a tag may print (a subset of `READOUT_FORMATS`: a tag is one short number or word). */
export const END_LABEL_FORMATS = Object.freeze(['int', 'text', 'ratio'])
/** The source that reads the plot's own last finite value. */
export const END_LABEL_VALUE_SOURCE = 'value'
/** A prefix or suffix is a code (`RS `, `%`), not a sentence. */
export const END_LABEL_AFFIX_MAX = 8
/** Gap kept between the tag's right edge and the plot's last point, px. */
export const END_LABEL_GAP_PX = 4

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The source, parsed: `{kind: 'value'}`, `{kind: 'scalar', path}`, or `null`.
 * An `input:` source is refused: a tag prints a VALUE, and an input is a setting.
 */
export function parseEndLabelSource(source) {
  if (source === END_LABEL_VALUE_SOURCE) return { kind: 'value' }
  const parsed = parseReadoutSource(source)
  return parsed && parsed.kind === 'scalar' ? parsed : null
}

/** The format a spec prints with: its own, else one read off the value. */
function formatOf(spec, value) {
  if (typeof spec.format === 'string') return spec.format
  if (typeof value === 'string') return 'text'
  return Number.isInteger(value) ? 'int' : 'ratio'
}

/**
 * The text one tag prints, or `null` for no tag.
 *
 * @param {object} spec `plot.endLabel`
 * @param {{scalars?: object|null, def?: object, inputs?: object, value?: unknown}} ctx
 *   the envelope payload (for `scalar:` sources and gates), the definition and the
 *   instance's stored inputs (for `input:` gates), and the plot's last finite value
 *   (for the `value` source)
 * @returns {string|null}
 */
export function endLabelText(spec, ctx) {
  try {
    if (!isPlainObject(spec)) return null
    const src = parseEndLabelSource(spec.source)
    if (!src) return null
    const c = isPlainObject(ctx) ? ctx : {}
    const scalars = isPlainObject(c.scalars) ? c.scalars : null
    const inputs = isPlainObject(c.inputs) ? c.inputs : {}
    const gates = spec.when === undefined ? [] : (Array.isArray(spec.when) ? spec.when : [spec.when])
    for (const g of gates) if (!readoutGateOpen(g, scalars, c.def, inputs)) return null
    const raw = src.kind === 'value' ? c.value : readoutSourceValue(spec.source, scalars, c.def, inputs)
    if (raw === undefined || raw === null) return null
    if (typeof raw === 'number' && !isNum(raw)) return null
    const text = formatReadoutValue(formatOf(spec, raw), raw, null)
    if (typeof text !== 'string' || !text) return null
    const prefix = typeof spec.prefix === 'string' ? spec.prefix : ''
    const suffix = typeof spec.suffix === 'string' ? spec.suffix : ''
    return `${prefix}${text}${suffix}`
  } catch {
    return null
  }
}

/**
 * What a chip carries for its plot's tag (`readout.stampReadout`): the resolved
 * text for a scalar source, or the spec itself for a `value` source, whose number
 * is only known where the series is (`lastFinitePoint`). `null` = no tag.
 *
 * @returns {null|{text: string}|{fromValue: true, spec: object}}
 */
export function endLabelChipModel(spec, scalars, def, inputs) {
  if (!isPlainObject(spec)) return null
  const src = parseEndLabelSource(spec.source)
  if (!src) return null
  if (src.kind === 'value') {
    // The gates are the readout's and can be answered now; the value cannot.
    const gates = spec.when === undefined ? [] : (Array.isArray(spec.when) ? spec.when : [spec.when])
    for (const g of gates) if (!readoutGateOpen(g, scalars, def, isPlainObject(inputs) ? inputs : {})) return null
    return { fromValue: true, spec }
  }
  const text = endLabelText(spec, { scalars, def, inputs })
  return text === null ? null : { text }
}

/**
 * The LAST FINITE point of a series' data (`ISeriesApi.data()`: `{time, value}`
 * rows, a whitespace row carrying no `value`), scanning from the end so a line
 * whose newest bars are blank (a benchmark a day behind) is labelled where it
 * actually ends. `null` when nothing is finite.
 *
 * @param {Array<{time: unknown, value?: number}>} points
 * @returns {null|{index: number, time: unknown, value: number}}
 */
export function lastFinitePoint(points) {
  if (!Array.isArray(points)) return null
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (p && isNum(p.value)) return { index: i, time: p.time, value: p.value }
  }
  return null
}

/**
 * ⭐ THE GEOMETRY the surface applies every frame. The tag is right-aligned to
 * the point, `gap` px left of it, vertically centred on it and kept inside its
 * pane. It is HIDDEN (not clamped) when the point is off the plot — scrolled or
 * zoomed away — or when the tag would not fit between the plot's left edge and
 * the point: a tag that slid to a place its point is not would read as a value
 * for a different bar. Left of the point means it never reaches the price axis,
 * so it never sits over the axis' own last-value tag.
 *
 * Inputs are px: `x` from `timeScale().timeToCoordinate` (plot-local), `y` from
 * the host series' `priceToCoordinate` (pane-local); `plotLeft` is the left price
 * scale's width; `paneTop` the pane's top in the container; `width`/`height` the
 * tag's own box.
 *
 * @returns {{hidden: true}|{hidden: false, left: number, top: number}}
 */
export function endLabelPlacement({ x, y, plotLeft = 0, plotWidth, paneTop = 0, paneHeight, width, height, gap = END_LABEL_GAP_PX }) {
  if (![x, y, plotWidth, paneHeight, width, height].every(isNum)) return { hidden: true }
  if (plotWidth <= 0 || paneHeight <= 0 || width <= 0 || height <= 0) return { hidden: true }
  if (x < 0 || x > plotWidth) return { hidden: true }
  if (y < 0 || y > paneHeight) return { hidden: true }
  const left = plotLeft + x - gap - width
  if (left < plotLeft) return { hidden: true }
  const top = paneTop + Math.min(Math.max(y - height / 2, 0), paneHeight - height)
  return { hidden: false, left: Math.round(left), top: Math.round(top) }
}

// ─── the schema half (called by `defSchema.validatePlot`) ────────────────────

const fmt = (v) => {
  try { return JSON.stringify(v) } catch { return String(v) }
}

/**
 * Validate one `plots[].endLabel`, pushing one message per fault. Fail closed:
 * an unknown field, a source that is neither `value` nor a scalar path, a format
 * outside the tag's set, an affix that is not a short string, a gate that does
 * not parse or names an undeclared input.
 *
 * @param {unknown} spec
 * @param {string} path `plots[i].endLabel`
 * @param {Iterable<string>} inputKeys the definition's declared input keys
 * @param {string[]} errors
 */
export function validateEndLabel(spec, path, inputKeys, errors) {
  if (!isPlainObject(spec)) {
    errors.push(`${path}: expected an object {source, prefix?, suffix?, format?, when?}, got ${fmt(spec)}`)
    return
  }
  for (const k of Object.keys(spec)) {
    if (!END_LABEL_FIELDS.includes(k)) errors.push(`${path}.${k}: unknown end label field — expected one of: ${END_LABEL_FIELDS.join(', ')}`)
  }
  if (!parseEndLabelSource(spec.source)) {
    errors.push(`${path}.source: expected 'value' (the plot's own last value) or a 'scalar:<a.b>' / 'payload:<a.b>' path, got ${fmt(spec.source)}`)
  }
  for (const k of ['prefix', 'suffix']) {
    if (spec[k] !== undefined && (typeof spec[k] !== 'string' || spec[k].length > END_LABEL_AFFIX_MAX)) {
      errors.push(`${path}.${k}: expected a string of at most ${END_LABEL_AFFIX_MAX} characters (a code such as "RS "), got ${fmt(spec[k])}`)
    }
  }
  if (spec.format !== undefined && !END_LABEL_FORMATS.includes(spec.format)) {
    errors.push(`${path}.format: expected one of ${END_LABEL_FORMATS.join(', ')}, got ${fmt(spec.format)}`)
  }
  if (spec.when !== undefined) {
    const declared = new Set(inputKeys || [])
    const gates = Array.isArray(spec.when) ? spec.when : [spec.when]
    if (!gates.length) errors.push(`${path}.when: an empty list gates nothing; omit it`)
    gates.forEach((g, i) => {
      const where = `${path}.when${Array.isArray(spec.when) ? `[${i}]` : ''}`
      const gate = parseReadoutGate(g)
      if (!gate) errors.push(`${where}: expected a readout source or an input:<key>=<value> gate, got ${fmt(g)}`)
      else if (gate.kind === 'input' && !declared.has(gate.path[0])) errors.push(`${where}: ${fmt(g)} names no declared input`)
    })
  }
}
