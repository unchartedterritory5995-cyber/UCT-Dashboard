// app/src/components/chart/builder/authoringIntent.js
//
// ─── ⭐⭐ P1 — AUTHORING INTENT (PLOT / SIGNAL / VALUE): WHAT THE MEMBER IS
//     MAKING, NEVER WHAT THE OUTPUT IS ───────────────────────────────────────────
//
// Intent is AUTHORING METADATA. It picks the builder's wording, the default
// presentation, the read-back and which consumer is requested after Save. It
// NEVER sets a type: every output's type is `outputType.outputTypeOf`'s, derived
// from its own tree, and every permission is `evaluability`'s. Nothing in this
// file is read by the type authority, the gate or any evaluator, and intent is
// not persisted (P1-DESIGN §3) — reopening a document re-derives it.
//
//   PLOT    → every output asked on its chart lane (`chart`, `chart-marker` for
//             a markers row, `chart-paint` for a column a paint reads).
//   SIGNAL  → the SELECTED output asked on `signal` (truth types only; a numeric
//             SERIES is refused `signal:numeric-output` — never converted), and
//             every other output on its chart lane.
//   VALUE   → the SELECTED output asked on `info-value`; a SERIES stays a
//             SERIES (the info value reads its latest value), a SCALAR is refused.
//
// ⛔ EVERY OUTPUT, NEVER PLOT 1. `outputsOf(def)` walks them all, and a document
// with one supported and one refused output reads `partial`, never "all good".

import { outputsOf, OUTPUT_TYPES, isTruthType } from '../engine/outputType'
import { evaluability, LANES, STATUS } from '../engine/evaluability'
import { MARKER_SHAPES, MARKER_POSITIONS } from '../engine/defSchema'

export const INTENTS = Object.freeze({ PLOT: 'plot', SIGNAL: 'signal', VALUE: 'value' })
export const INTENT_LABELS = Object.freeze({
  plot: 'Plot — draw it on the chart',
  signal: 'Signal — mark when it is true',
  value: 'Value — show its latest value',
})

/** The type, in plain words a member reads. */
export function typeWords(type) {
  switch (type) {
    case OUTPUT_TYPES.SERIES: return 'a number on every bar'
    case OUTPUT_TYPES.CONDITION: return 'a yes/no on every bar'
    case OUTPUT_TYPES.EVENTS: return 'an event (it happened on this bar)'
    case OUTPUT_TYPES.SCALAR: return 'a current-only value with no bar history'
    default: return 'no type can be derived'
  }
}

/** The output a document is "about": its scan plot, else its first data output. */
function primaryKey(def, outs) {
  const scan = def && def.compute && def.compute.scanPlot
  if (scan && outs.some((o) => o.key === scan)) return scan
  return outs.length ? outs[0].key : null
}

/** P1-DESIGN §5: the scan plot when truth-typed, else the first truth-typed
 *  output in plot order; null when the document has none. Never a SERIES. */
export function signalOutputFor(def) {
  const outs = outputsOf(def)
  const scan = def && def.compute && def.compute.scanPlot
  const scanOut = outs.find((o) => o.key === scan)
  if (scanOut && isTruthType(scanOut.type)) return scanOut.key
  const first = outs.find((o) => isTruthType(o.type))
  return first ? first.key : null
}

/** P1-DESIGN §3: reopening re-derives intent from the PRIMARY output's type —
 *  CONDITION / EVENTS → SIGNAL, anything else → PLOT. VALUE is never derived:
 *  an info value is a chart-settings reference, not a property of the document. */
export function defaultIntentFor(def) {
  const outs = outputsOf(def)
  const key = primaryKey(def, outs)
  const out = outs.find((o) => o.key === key)
  return out && isTruthType(out.type) ? INTENTS.SIGNAL : INTENTS.PLOT
}

/** The output an intent is ABOUT (the one its consumer will read). */
export function selectedOutputFor(def, intent, requested = null) {
  const outs = outputsOf(def)
  if (requested && outs.some((o) => o.key === requested)) return requested
  if (intent === INTENTS.SIGNAL) return signalOutputFor(def) || primaryKey(def, outs)
  return primaryKey(def, outs)
}

/** The chart lane an output is drawn through on this document. */
function chartLaneFor(def, key) {
  const plot = (Array.isArray(def && def.plots) ? def.plots : []).find((p) => p && p.key === key)
  if (plot && plot.style === 'markers') return LANES.CHART_MARKER
  const paints = Array.isArray(def && def.paints) ? def.paints : []
  if (paints.some((p) => p && p.colorMode === `column:${key}`)) return LANES.CHART_PAINT
  return LANES.CHART
}

const INTENT_LANE = Object.freeze({
  [INTENTS.SIGNAL]: LANES.SIGNAL,
  [INTENTS.VALUE]: LANES.INFO_VALUE,
})

/**
 * ⭐⭐ THE TYPED READ-BACK: every output, its derived type in plain words, and
 * the gate's verdict on the lane this intent asks it.
 *
 * @returns {{intent, selectedKey, outputs: Array<{key, label, type, words, lane,
 *   selected, verdict}>, status: 'ok'|'partial'|'refused', blocking: string|null}}
 *   `blocking` is the sentence that shuts Save under THIS intent (the selected
 *   output is refused on the intent's lane): SIGNAL / VALUE only — PLOT keeps the
 *   sheet's own save gates and DISCLOSES a refused output instead.
 */
export function intentReadback(def, intent, { ctx = {}, requestedKey = null } = {}) {
  const outs = def ? outputsOf(def) : []
  const selectedKey = def ? selectedOutputFor(def, intent, requestedKey) : null
  const plots = Array.isArray(def && def.plots) ? def.plots : []
  const outputs = outs.map((o) => {
    const selected = o.key === selectedKey && intent !== INTENTS.PLOT
    const lane = selected ? INTENT_LANE[intent] : chartLaneFor(def, o.key)
    const verdict = evaluability(def, o.key, lane, ctx)
    const plot = plots.find((p) => p && p.key === o.key)
    return Object.freeze({
      key: o.key,
      label: (plot && plot.label) || o.key,
      type: o.type,
      words: typeWords(o.type),
      lane,
      selected,
      verdict,
    })
  })
  // ⚠️ A PENDING refusal (another symbol's bars still loading) is not an answer
  // yet: it is neither counted as refused nor allowed to shut Save — the chart
  // decides it when the data arrives (`final: false`).
  const isRefused = (o) => o.verdict.status === STATUS.REFUSED && !o.verdict.pending
  const refused = outputs.filter(isRefused)
  const status = !outputs.length ? 'refused'
    : refused.length === 0 ? 'ok'
      : refused.length === outputs.length ? 'refused' : 'partial'
  const sel = outputs.find((o) => o.selected)
  const blocking = intent !== INTENTS.PLOT && sel && isRefused(sel)
    ? sel.verdict.reason || 'This output cannot be used this way.'
    : (intent !== INTENTS.PLOT && !sel ? 'This definition has no output to use.' : null)
  return Object.freeze({ intent, selectedKey, outputs, status, blocking })
}

// ─── SIGNAL presentation, on master's existing primitives ─────────────────────

/** The marker / paint choices the SIGNAL intent offers — closed lists, the
 *  renderer's own (`defSchema.MARKER_SHAPES` / `MARKER_POSITIONS`). */
export const SIGNAL_MARKER_DEFAULT = Object.freeze({ shape: 'arrowUp', position: 'belowBar' })
export const SIGNAL_PAINT_DEFAULTS = Object.freeze({ barcolor: '#26a69a', bgcolor: '#26a69a' })
/** A background shade is drawn translucent so the candles stay readable. */
export const SIGNAL_BG_OPACITY = 0.2
/** "No paint" for a false bar: Pine's `na` colour, which every paint channel
 *  already reads as "draw nothing" (`paintPrimitive.isNaColour` / `isClearColour`). */
export const NO_PAINT = 'transparent'

/**
 * Can this marker request be drawn exactly as asked? `null` when it can, else
 * the sentence that refuses it. ⛔ No new shapes, no coercion: a shape or
 * position outside the renderer's closed list is refused, never swapped for a
 * near neighbour; a label over 24 characters is refused, never truncated.
 */
export function markerRequestProblem(marker) {
  if (!marker || typeof marker !== 'object') return 'No marker was chosen.'
  if (!MARKER_SHAPES.includes(marker.shape)) {
    return `A "${marker.shape}" marker cannot be drawn — the chart draws ${MARKER_SHAPES.join(', ')}.`
  }
  if (marker.position !== undefined && !MARKER_POSITIONS.includes(marker.position)) {
    return `A marker cannot sit "${marker.position}" — the chart places one ${MARKER_POSITIONS.join(', ')}.`
  }
  if (marker.text !== undefined && (typeof marker.text !== 'string' || marker.text.length > 24)) {
    return 'A marker label is at most 24 characters.'
  }
  return null
}

/**
 * The `paints[]` entries a SIGNAL presentation asks for on output `key`:
 * `{barcolor?: colour, bgcolor?: colour}` → schema paints reading the
 * condition's own column (`colorMode: 'column:<key>'`): the chosen colour where
 * it is true, NO paint where it is false, and — through `binder.unknownColourRule`
 * on a semantics-2 document — no paint where it is unknown.
 */
export function signalPaintsFor(key, { barcolor = null, bgcolor = null } = {}) {
  const out = []
  if (typeof barcolor === 'string' && barcolor) {
    out.push({ kind: 'barcolor', title: 'Signal candles', colorMode: `column:${key}`,
      colorUp: barcolor, colorDown: NO_PAINT })
  }
  if (typeof bgcolor === 'string' && bgcolor) {
    out.push({ kind: 'bgcolor', title: 'Signal background', colorMode: `column:${key}`,
      colorUp: bgcolor, colorDown: NO_PAINT, opacity: SIGNAL_BG_OPACITY })
  }
  return out
}

/** Read a SIGNAL presentation back off a stored document (reopen): which of
 *  the builder's own paints name `key`. Paints it did not write are left alone
 *  and not reported (they are the document's, not this control's). */
export function signalPaintsOf(def, key) {
  const paints = Array.isArray(def && def.paints) ? def.paints : []
  const mine = (kind) => paints.find((p) => p && p.kind === kind && p.colorMode === `column:${key}`
    && p.colorDown === NO_PAINT && typeof p.colorUp === 'string')
  const bar = mine('barcolor')
  const bg = mine('bgcolor')
  return { barcolor: bar ? bar.colorUp : null, bgcolor: bg ? bg.colorUp : null }
}

/**
 * Is this presentation request representable for output `key` of `def`? Asks
 * the gate on the lane each channel draws through, so a marker on a number is
 * DISCLOSED ("drawn where > 0") and a paint on a refused output is refused.
 * @returns {{status, reason?, note?}}
 */
export function presentationVerdict(def, key, { marker = null, paints = [] } = {}, ctx = {}) {
  if (marker) {
    const problem = markerRequestProblem(marker)
    if (problem) return { status: STATUS.REFUSED, reason: problem }
    const v = evaluability(def, key, LANES.CHART_MARKER, ctx)
    if (v.status !== STATUS.SUPPORTED) return { status: v.status, reason: v.reason, note: v.note }
  }
  if (paints.length) {
    const v = evaluability(def, key, LANES.CHART_PAINT, ctx)
    if (v.status === STATUS.REFUSED) return { status: v.status, reason: v.reason }
    if (!isTruthType(v.type)) {
      return { status: STATUS.REFUSED, reason: 'A signal colour reads a yes/no; this output is not one.' }
    }
  }
  return { status: STATUS.SUPPORTED }
}
