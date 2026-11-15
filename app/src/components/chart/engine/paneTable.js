// app/src/components/chart/engine/paneTable.js
//
// ─── THE PANE TABLE — a small grid of payload numbers in a pane's corner ─────
//
// A server-lane envelope carries a `payload` of scalars beside its columns. The
// readout (`readoutSchema.js`) prints them as rows in the chip menu; this module
// prints a SHORT, FIXED set of them as one compact table pinned to the indicator
// pane's top-right corner, the way Deepvue's RS Line pane prints its 1M / 3M / 6M
// / 9M / 12M ranks (as one row of code-and-rank pairs: `PaneRanksTable`).
//
// ⭐ DECLARED, NOT CODED. A definition opts in with `meta.paneTable`; this module
// names no definition, and the surface (`StockChart`) renders whatever the model
// below says. The grammar (validated fail-closed by `defSchema.validateMetaPaneTable`):
//
//   meta.paneTable: {
//     label?:      'Rating ranks',              // the table's accessible name
//     when?:       ['input:showRating', ...],   // gates in the readout `when` grammar;
//                                               // ALL must hold or there is no table
//     timeframes?: ['D'],                       // chart timeframes it is shown on
//     columns: [{
//       key:       'm1',                        // unique per table
//       label:     '1M',                        // the header cell, ≤ 4 characters
//       source:    'scalar:rating.m1',          // a scalar/payload path (never input:)
//       optional?: true,                        // a column that exists only while the
//                                               // payload CARRIES the key (a 9M rank a
//                                               // later server adds); absent ⇒ no column
//       emphasis?: true,                        // the headline column (the rating itself)
//     }],
//     band?:       { when: 'input:ratingBands' } // colour each 1-99 value by the site's
//                                               // rating bands while the gate holds
//   }
//
// ⛔ FAIL CLOSED, AND NEVER A FABRICATED NUMBER. A value that is not a whole
// number from 1 to 99 prints a muted dash (`MISSING_TEXT`), never a zero, never a
// guess. No envelope, a closed gate, or a payload that resolves NO value at all
// (the server has no rating row) means no table: `null`. PURE: no React, no DOM.

import { readoutGateOpen, readoutSourceValue, parseReadoutSource, parseReadoutGate, ratingBandOf } from './readoutSchema'

/** The closed set of fields `meta.paneTable` may carry. */
export const PANE_TABLE_FIELDS = Object.freeze(['label', 'when', 'timeframes', 'columns', 'band'])
/** The closed set of fields one column may carry. */
export const PANE_TABLE_COLUMN_FIELDS = Object.freeze(['key', 'label', 'source', 'optional', 'emphasis'])
/** The closed set of fields `band` may carry. */
export const PANE_TABLE_BAND_FIELDS = Object.freeze(['when'])
/** A header cell is a column code, not a phrase: `12M`, `RS`. */
export const PANE_TABLE_LABEL_MAX = 4
/** A corner table, not a dashboard: past this it would cover the newest bars. */
export const PANE_TABLE_MAX_COLUMNS = 8
/** What a value the payload does not hold prints: an en dash, in the muted ink. */
export const MISSING_TEXT = '–'
/** Gap kept between the pane label's right edge and the table's left edge, px. */
export const PANE_TABLE_LABEL_GAP_PX = 12

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A 1-99 rank, as the table prints it, or `null` for anything else. */
function rankText(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 99 ? String(v) : null
}

/** Does the payload CARRY this path (the key exists, its value may be null)? */
function carries(scalars, source) {
  return readoutSourceValue(source, scalars, null, null) !== undefined
}

/**
 * The table one instance shows, or `null` when it shows none.
 *
 * @param {object} def the definition (reads `def.meta.paneTable`, `def.inputs`)
 * @param {object|null} scalars the envelope's payload (`serverCompute.scalarsFor`)
 * @param {{inputs?: object}} [ctx] the instance's stored inputs, for `input:` gates
 * @returns {null|{label: string, timeframes: string[]|null,
 *   columns: {key: string, label: string, text: string, value: number|null,
 *     missing: boolean, emphasis: boolean, band?: string}[]}}
 */
export function paneTableFor(def, scalars, ctx) {
  try {
    const spec = def && isPlainObject(def.meta) ? def.meta.paneTable : null
    if (!isPlainObject(spec) || !Array.isArray(spec.columns) || !spec.columns.length) return null
    if (!isPlainObject(scalars)) return null
    const inputs = ctx && isPlainObject(ctx.inputs) ? ctx.inputs : {}
    const gates = spec.when === undefined ? [] : (Array.isArray(spec.when) ? spec.when : [spec.when])
    for (const g of gates) if (!readoutGateOpen(g, scalars, def, inputs)) return null
    const banded = isPlainObject(spec.band)
      && (spec.band.when === undefined || readoutGateOpen(spec.band.when, scalars, def, inputs))
    const columns = []
    let any = false
    for (const c of spec.columns) {
      if (!isPlainObject(c) || typeof c.key !== 'string' || typeof c.label !== 'string') continue
      if (c.optional === true && !carries(scalars, c.source)) continue
      const raw = readoutSourceValue(c.source, scalars, def, inputs)
      const text = rankText(raw)
      if (text !== null) any = true
      const col = {
        key: c.key, label: c.label,
        text: text === null ? MISSING_TEXT : text,
        value: text === null ? null : raw,
        missing: text === null,
        emphasis: c.emphasis === true,
      }
      const band = banded && text !== null ? ratingBandOf(raw) : null
      if (band) col.band = band
      columns.push(col)
    }
    // ⛔ A ROW OF DASHES IS NOT A TABLE: the server holds nothing for this symbol.
    if (!any) return null
    return {
      label: typeof spec.label === 'string' && spec.label.trim() ? spec.label.trim() : 'Ranks',
      timeframes: Array.isArray(spec.timeframes) && spec.timeframes.length ? spec.timeframes.slice() : null,
      columns,
    }
  } catch {
    return null
  }
}

/** Is a resolved table shown on this chart timeframe? A table that names no
 *  timeframes is shown on every one; an unknown timeframe shows nothing. */
export function paneTableShownOn(table, tf) {
  if (!table) return false
  if (!table.timeframes) return true
  return typeof tf === 'string' && table.timeframes.includes(tf)
}

/**
 * Definitions whose table YIELDS to another instance's table of the same label on
 * the same chart. `rsRating` and `rsLine` resolve the same `RS ranks` strip from
 * the same server row; Deepvue draws it once, on the RS line's pane, and the
 * rating pane keeps its own label and history.
 */
export const PANE_TABLE_YIELDING_DEFS = Object.freeze(['rsRating'])

/**
 * ⭐ ONE STRIP PER CHART (2026-11-12). Of the visible chips that carry a table
 * shown on this timeframe, the ones that draw it: one per table label, chosen
 * (1) a non-yielding instance drawn with the candles (`hostOf` answers `null`),
 * (2) a non-yielding instance in a pane, (3) a yielding one, first in chip order
 * at each step. Decided per render from the chips, so a saved chart's inputs never
 * change: hide the RS line, or turn its strip off (its chip then carries no
 * table), and the rating pane's strip comes back by itself.
 *
 * @param {object[]} chips `crosshairData.chips`
 * @param {string} tf the chart timeframe
 * @param {Function} [hostOf] chip → pane key, `null` on the price pane
 * @param {string[]} [yielding] definition ids that yield
 * @returns {Set<object>} the chips that draw their table
 */
export function paneTableOwners(chips, tf, hostOf, yielding = PANE_TABLE_YIELDING_DEFS) {
  const owners = new Set()
  if (!Array.isArray(chips) || !chips.length) return owners
  const byLabel = new Map()
  for (const c of chips) {
    if (!c || c.hidden === true || !c.paneTable || !paneTableShownOn(c.paneTable, tf)) continue
    let host = null
    try { host = hostOf ? hostOf(c) : null } catch { host = null }
    const rank = yielding.includes(c.defId) ? 2 : (host === null ? 0 : 1)
    const label = typeof c.paneTable.label === 'string' ? c.paneTable.label : ''
    const best = byLabel.get(label)
    if (!best || rank < best.rank) byLabel.set(label, { chip: c, rank })
  }
  for (const { chip } of byLabel.values()) owners.add(chip)
  return owners
}

/**
 * ⭐ THE COLLISION RULE the surface applies every frame: the table sits at the
 * plot area's right edge (left of the price scale) and is shown only while it
 * clears the pane label by `gap` px. Measured, never assumed: on a 390 px phone
 * the label `UCT Relative Strength · SPY · 94` already spans most of the plot,
 * so the table steps aside there and the same numbers stay one tap away in the
 * readout's Rating card. Inputs are px in the pane's own frame.
 *
 * @returns {boolean}
 */
export function paneTableFits({ plotWidth, labelRight, tableWidth, margin = 6, gap = PANE_TABLE_LABEL_GAP_PX }) {
  if (![plotWidth, labelRight, tableWidth].every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  if (plotWidth <= 0) return false
  const left = plotWidth - margin - tableWidth
  return left >= labelRight + gap
}

// ─── the schema half (called by `defSchema.validateMeta`) ───────────────────

const fmt = (v) => {
  try { return JSON.stringify(v) } catch { return String(v) }
}

/**
 * Validate `meta.paneTable`, pushing one message per fault. Fail closed: an
 * unknown field, a column with no scalar source, a gate that does not parse, an
 * equals gate on an input that is not a declared enum, a duplicate key, too many
 * columns, a header longer than a column code.
 *
 * @param {unknown} spec
 * @param {object} def the definition (for its inputs)
 * @param {string[]} errors
 * @param {{isValidTf?: (code: string) => boolean, equalsGateFault?: Function}} [helpers]
 */
export function validatePaneTable(spec, def, errors, helpers = {}) {
  const at = 'meta.paneTable'
  if (!isPlainObject(spec)) {
    errors.push(`${at}: expected an object {columns, when?, timeframes?, band?, label?}, got ${fmt(spec)}`)
    return
  }
  for (const k of Object.keys(spec)) {
    if (!PANE_TABLE_FIELDS.includes(k)) errors.push(`${at}.${k}: unknown pane table field — expected one of: ${PANE_TABLE_FIELDS.join(', ')}`)
  }
  const inputsByKey = new Map((Array.isArray(def && def.inputs) ? def.inputs : [])
    .filter((x) => isPlainObject(x) && typeof x.key === 'string').map((x) => [x.key, x]))
  const checkGate = (g, path) => {
    const gate = parseReadoutGate(g)
    if (!gate) {
      errors.push(`${path}: expected a readout source or an input:<key>=<value> gate, got ${fmt(g)}`)
      return
    }
    if (gate.kind === 'input' && !inputsByKey.has(gate.path[0])) {
      errors.push(`${path}: ${fmt(g)} names no declared input`)
      return
    }
    if (typeof gate.equals === 'string' && typeof helpers.equalsGateFault === 'function') {
      const fault = helpers.equalsGateFault(gate, inputsByKey)
      if (fault) errors.push(`${path}: ${fault}`)
    }
  }
  if (spec.label !== undefined && (typeof spec.label !== 'string' || !spec.label.trim())) {
    errors.push(`${at}.label: expected a non-empty string (the table's accessible name), got ${fmt(spec.label)}`)
  }
  if (spec.when !== undefined) {
    const gates = Array.isArray(spec.when) ? spec.when : [spec.when]
    if (!gates.length) errors.push(`${at}.when: an empty list gates nothing; omit it`)
    gates.forEach((g, i) => checkGate(g, `${at}.when${Array.isArray(spec.when) ? `[${i}]` : ''}`))
  }
  if (spec.timeframes !== undefined) {
    if (!Array.isArray(spec.timeframes) || !spec.timeframes.length) {
      errors.push(`${at}.timeframes: expected a non-empty array of chart timeframe codes, got ${fmt(spec.timeframes)}`)
    } else {
      spec.timeframes.forEach((tf, i) => {
        const ok = typeof tf === 'string' && (typeof helpers.isValidTf === 'function' ? helpers.isValidTf(tf) : !!tf)
        if (!ok) errors.push(`${at}.timeframes[${i}]: ${fmt(tf)} is not a chart timeframe code`)
      })
    }
  }
  if (spec.band !== undefined) {
    if (!isPlainObject(spec.band)) {
      errors.push(`${at}.band: expected {when?}, got ${fmt(spec.band)}`)
    } else {
      for (const k of Object.keys(spec.band)) {
        if (!PANE_TABLE_BAND_FIELDS.includes(k)) errors.push(`${at}.band.${k}: unknown field — expected one of: ${PANE_TABLE_BAND_FIELDS.join(', ')}`)
      }
      if (spec.band.when !== undefined) checkGate(spec.band.when, `${at}.band.when`)
    }
  }
  if (!Array.isArray(spec.columns) || !spec.columns.length) {
    errors.push(`${at}.columns: expected a non-empty array of {key, label, source}, got ${fmt(spec.columns)}`)
    return
  }
  if (spec.columns.length > PANE_TABLE_MAX_COLUMNS) {
    errors.push(`${at}.columns: ${spec.columns.length} columns — at most ${PANE_TABLE_MAX_COLUMNS} fit a pane corner`)
  }
  const seen = new Set()
  spec.columns.forEach((c, i) => {
    const path = `${at}.columns[${i}]`
    if (!isPlainObject(c)) { errors.push(`${path}: expected an object {key, label, source}, got ${fmt(c)}`); return }
    for (const k of Object.keys(c)) {
      if (!PANE_TABLE_COLUMN_FIELDS.includes(k)) errors.push(`${path}.${k}: unknown column field — expected one of: ${PANE_TABLE_COLUMN_FIELDS.join(', ')}`)
    }
    if (typeof c.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.key)) {
      errors.push(`${path}.key: expected an identifier, got ${fmt(c.key)}`)
    } else if (seen.has(c.key)) {
      errors.push(`${path}.key: ${fmt(c.key)} is declared twice`)
    } else seen.add(c.key)
    if (typeof c.label !== 'string' || !c.label.trim() || c.label.length > PANE_TABLE_LABEL_MAX) {
      errors.push(`${path}.label: expected a column code of 1 to ${PANE_TABLE_LABEL_MAX} characters (such as "12M"), got ${fmt(c.label)}`)
    }
    const src = parseReadoutSource(c.source)
    if (!src || src.kind !== 'scalar') {
      errors.push(`${path}.source: expected a 'scalar:<a.b>' or 'payload:<a.b>' path, got ${fmt(c.source)}`)
    }
    for (const flag of ['optional', 'emphasis']) {
      if (c[flag] !== undefined && typeof c[flag] !== 'boolean') errors.push(`${path}.${flag}: expected true or false, got ${fmt(c[flag])}`)
    }
  })
  if (spec.columns.every((c) => isPlainObject(c) && c.optional === true)) {
    errors.push(`${at}.columns: every column is optional, so a payload without them draws an empty table; make one required`)
  }
}
