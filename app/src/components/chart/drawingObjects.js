/* Naming and summarising the objects on a chart — for the recovery surface.
 *
 * ⛔ THE ROSTER IS DERIVED FROM `TOOLS`, NOT RETYPED. An object manager exists
 * so a user can find what they cannot see; a manager that silently omits one
 * SHAPE is worse than no manager, because it teaches you to trust a list that
 * is lying. This file therefore reads the toolbar's own roster and cleans the
 * display text, so a tool added tomorrow is nameable the day it lands.
 * `drawingObjects.test.js` fails by name if any tool loses its name here.
 *
 * ⛔ AND THE CLEANING IS THE FIDDLY PART. The toolbar's labels carry two things
 * an object row must not: a keyboard chord appended by `chorded()`
 * ("Trendline (Alt+T)") — meaningless on a phone with no keyboard — and, for
 * the multi-click tools, an instruction ("Cup Curve — click the left rim, the
 * bottom, then the right rim"). Both are stripped structurally rather than
 * special-cased per tool.
 */
import { TOOLS } from './ChartToolbar'

/** Trim a price to a tidy string (max 4 decimals, no trailing zeros).
 *  ⭐ ONE authority — `ChartDrawingOverlay` imports this rather than keeping
 *  the copy it used to own, so the "Set level…" prefill and an object row can
 *  never disagree about how a price is written. */
export function fmtLevel(v) {
  if (v == null || !Number.isFinite(+v)) return ''
  return String(+(+v).toFixed(4))
}

const cleanLabel = (label) =>
  String(label || '')
    .split(' — ')[0]                 // drop the how-to-use instruction
    .replace(/\s*\([^)]*\)\s*$/, '') // drop the trailing keyboard chord
    .trim()

export const TYPE_NAMES = Object.fromEntries(
  TOOLS.filter((t) => t && t.id).map((t) => [t.id, cleanLabel(t.label)]),
)

// Shapes that exist on the canvas without a toolbar button of their own.
const EXTRA_NAMES = {
  ray: 'Ray',
  fibext: 'Fibonacci Extension',
}

/** A human name for a drawing's type. Never empty — an unnamed object in a
 *  recovery list is exactly the object you cannot recover. */
export function objectTypeName(type) {
  const t = String(type || '')
  return TYPE_NAMES[t] || EXTRA_NAMES[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Drawing')
}

const LEVEL_ONE = new Set(['horizontal', 'hray'])
const LEVEL_TWO = new Set(['trendline', 'ray', 'extended', 'channel', 'fib', 'fibext', 'rect', 'measure', 'position'])
// ⛔ A RULER'S SUMMARY IS NOT A PRICE. Bars & Time measures horizontally, so
// "412.50 → 418.00" would be two readings of the same level dressed up as a
// range. It falls through to the single-level branch below, which prints the row
// it sits on — the one price it actually has.

/** A one-line summary that tells you WHICH object this row is. */
export function objectSummary(d) {
  if (!d) return ''
  if (d.type === 'text') {
    const t = String(d.text || '').replace(/\s+/g, ' ').trim()
    return t.length > 28 ? `${t.slice(0, 27)}…` : t
  }
  const pts = d.points || []
  if (LEVEL_ONE.has(d.type)) return fmtLevel(pts[0]?.price)
  if (LEVEL_TWO.has(d.type)) {
    const a = fmtLevel(pts[0]?.price), b = fmtLevel(pts[1]?.price)
    return a && b ? `${a} → ${b}` : a || b
  }
  const a = fmtLevel(pts[0]?.price)
  return a || ''
}

/** The drawings a chart should actually paint. Hidden ones stay in the store,
 *  stay in the manager, and stay undoable — they simply are not on the canvas. */
export const visibleOnly = (drawings) => (drawings || []).filter((d) => !d.hidden)

export const hiddenCount = (drawings) => (drawings || []).reduce((n, d) => n + (d.hidden ? 1 : 0), 0)
