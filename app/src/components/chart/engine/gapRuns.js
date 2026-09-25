/**
 * Canonical GAPS in a fundamental line, drawn as a real break.
 *
 * ⛔⛔ UNKNOWN MUST NOT LOOK LIKE KNOWN. The store, the API and `projectAsOf`
 * all carry a canonical gap (a v4 period whose basis cannot be proven -- TSLA
 * Q1-Q3 2025, CELH Q2 2022) as NaN, and `binder.toPoints` hands the renderer a
 * whitespace point `{time}` for it. MEASURED on lightweight-charts 5.2.0 (the
 * version this repo pins): a line series KEEPS ONLY VALUED ROWS in its plot list
 * and connects them, so whitespace draws NOTHING DIFFERENT from no point at all
 * -- the last value before the gap was carried straight across it. That shipped
 * (2026-09-24) because the harness counted POINTS in the gap (0) and never looked
 * at PIXELS.
 *
 * 5.2.0 has no discontinuity option (`LineStyleOptions` is colour, style, width,
 * type, visibility, point and crosshair markers). A per-point `color` cannot
 * fake one either, measured: on a STEP line the horizontal leg takes the colour
 * of the point it LEAVES and the vertical riser the colour of the point it
 * REACHES, so hiding the bridge leaves the riser, and hiding the riser as well
 * erases the first real bar after the gap -- a value drawn one bar LATE, which
 * is a knowledge-time lie.
 *
 * So one LOGICAL series is drawn as ONE RENDER SERIES PER CONTIGUOUS VALID RUN:
 * no render series holds points on both sides of a gap, and the renderer has
 * nothing to connect. The binder owns the extra series; nothing outside it --
 * settings, legend rows, the inspector -- ever sees more than one plot.
 */
import { parseFundamentalSource } from './fundamentalGrammar'

/** Pool keys that draw a CONNECTED line, and so can bridge a gap. A histogram
 *  bar is per-point and draws nothing on whitespace, so it is never split. */
const CONNECTED = new Set(['line', 'area', 'baseline'])

export function isConnectedPool(poolKey) {
  return CONNECTED.has(poolKey)
}

const valued = (p) => !!p && Number.isFinite(p.value)

/**
 * Does this instance's value descend from a `fund:` source -- directly, or
 * through any chain of `@<instanceId>::<plotKey>` sources (an MA of a
 * fundamental, an MA of that MA)?
 *
 * ⛔ ANY definition, not only the `domainBehavior: 'inherit'` ones that
 * `fundamentalFormatOfInstance` follows for the UNIT: an oscillator of a
 * fundamental does not share its unit, but it does share its gaps, and a gap
 * reconnected one step downstream is the same lie.
 *
 * ⚠️ The gap is a property of the DATA contract, not of chart geometry: this
 * never infers a gap from elapsed time. It only decides whose NaNs are
 * canonical. A price indicator's interior NaN keeps today's behaviour.
 */
export function hasFundamentalLineage(inst, instances, depth = 0) {
  if (!inst || depth > 8) return false
  const src = inst.inputs && typeof inst.inputs.source === 'string' ? inst.inputs.source : ''
  if (!src) return false
  const f = parseFundamentalSource(src)
  if (f && f.kind === 'fundamental') return true
  if (src[0] !== '@') return false
  const cut = src.lastIndexOf('::')
  const id = cut > 1 ? src.slice(1, cut) : null
  const next = id && Array.isArray(instances) ? instances.find((i) => i && i.instanceId === id) : null
  return next ? hasFundamentalLineage(next, instances, depth + 1) : false
}

/**
 * Split LWC points into contiguous VALUED runs.
 *
 * A run ends at the first whitespace point that is FOLLOWED by another valued
 * point -- an interior gap. Leading and trailing whitespace separate nothing
 * (there is nothing on the far side to connect to), so a series with no
 * interior gap comes back as ONE run and the caller changes nothing.
 *
 * Fundamentals are STEP functions, and `projectAsOf` already holds a known
 * value on every bar until a newer filing or a gap replaces it -- so a quarter
 * with no filing is a run of equal values, never whitespace. Only a canonical
 * gap (or the period-age limit, which is the same "unknown") produces one.
 *
 * @param {object[]} points  `{time}` or `{time, value, ...}`, ascending
 * @returns {{primary: object[], runs: object[][], count: number}}
 *   `primary` -- the SAME length and times as `points`, valued ONLY on the last
 *   run (every other row whitespace), so the series the rest of the chart knows
 *   keeps its time coverage, its last-value tag and its pane residency;
 *   `runs` -- the EARLIER runs, oldest first, valued rows only;
 *   `count` -- total runs including the last.
 */
export function splitGapRuns(points) {
  const pts = Array.isArray(points) ? points : []
  const bounds = []                         // [start, end] inclusive, valued
  let start = -1
  let lastValued = -1
  for (let i = 0; i < pts.length; i++) {
    if (!valued(pts[i])) continue
    if (start < 0) start = i
    else if (i !== lastValued + 1) {        // whitespace between two valued rows
      bounds.push([start, lastValued])
      start = i
    }
    lastValued = i
  }
  if (start >= 0) bounds.push([start, lastValued])
  if (bounds.length <= 1) return { primary: pts, runs: [], count: bounds.length }

  const [ls] = bounds[bounds.length - 1]
  const primary = pts.map((p, i) => (i >= ls || !valued(p) ? p : { time: p.time }))
  const runs = bounds.slice(0, -1).map(([s, e]) => pts.slice(s, e + 1))
  return { primary, runs, count: bounds.length }
}

/**
 * The value a gap-breaking binding holds at one bar's time, for the legend.
 *
 * `undefined` -- this series has no row at that time (the developing bar the
 * push feed appended before the next refresh): the caller keeps its existing
 * last-value fallback. `NaN` -- a row that is a GAP: the legend prints no
 * number, because the last known value is not the value there.
 */
export function valueAtFor(points) {
  const byTime = new Map()
  for (const p of (Array.isArray(points) ? points : [])) {
    if (p && p.time !== undefined) byTime.set(p.time, valued(p) ? p.value : NaN)
  }
  return (time) => (byTime.has(time) ? byTime.get(time) : undefined)
}
