// app/src/components/chart/engine/zorder.js
//
// ─── R0.5 — PINE'S NINE Z-BUCKETS ON LIGHTWEIGHT-CHARTS' FOUR SLOTS ──────────
//
// Pine orders every visual into nine ascending groups, and states the rule that
// makes them a contract rather than a default: *"An element cannot be placed
// outside the region of z-space that its group occupies — for example, a plot can
// never appear on top of a table."* Within a group, whatever the script created
// last paints on top.
//
// Lightweight Charts offers `PrimitivePaneViewZOrder = 'bottom' | 'normal' |
// 'top'`, which crossed with the `drawBackground()` / `draw()` split gives FOUR
// effective slots. Nine buckets have to land on those four, and they do it by
// collapsing onto **six distinct physical positions**, with buckets 5–8 separated
// only by ATTACH ORDER inside one slot.
//
// ─── ⛔⛔ ATTACH ORDER IS THE LOAD-BEARING PART, AND IT IS FRAGILE ───────────
//
// LWC keeps primitives in a plain array — `push` on attach, `filter` on detach —
// so draw order within one zOrder layer IS attach order. That is a structural
// guarantee, not a convention. It is also the whole mechanism separating
// linefills from lines from boxes from labels, which means:
//
//   ANY other 'normal' primitive attached to the drawings' host series AFTER the
//   label layer jumps above the labels. There is no id, no dedupe, no cap.
//
// So the order lives HERE, in one exported list, and the attach site is expected
// to consume it rather than hand-roll a sequence. `primitiveGate.test.js` already
// polices which call sites may attach at all; this says in what order.
//
// ─── WHAT THIS MODULE IS NOT ────────────────────────────────────────────────
//
// It computes ORDER. It draws nothing, imports no chart library, and holds no
// canvas — so every ordering rule below is a pure function and is tested as one.
//
// Provenance: docs/pine/lwc5-capability-map.md §3 (which quotes Pine's Visuals /
// Overview for the buckets and PaneWidget.paint from the 5.2.0 bundle for the
// paint order); docs/pine/pine-presentation-spec.md for the per-primitive rules.

/** Pine's nine z-index groups, ascending. Index 0 is painted first (lowest). */
export const PINE_BUCKETS = Object.freeze([
  'background colors',
  'fills',
  'plots',
  'horizontal levels',
  'linefills',
  'lines',
  'boxes',
  'labels',
  'tables',
])

/** The Pine construct(s) that land in each bucket. */
export const BUCKET_SOURCES = Object.freeze({
  'background colors': ['bgcolor'],
  fills: ['fill'],
  plots: ['plot', 'plotshape', 'plotchar', 'plotcandle', 'plotbar', 'plotarrow'],
  'horizontal levels': ['hline'],
  linefills: ['linefill.new'],
  lines: ['line.new'],
  boxes: ['box.new'],
  labels: ['label.new'],
  tables: ['table.new', 'table.cell'],
})

/**
 * Where each bucket lands in Lightweight Charts.
 *
 * `slot`      — PrimitivePaneViewZOrder, or 'series' for native series pixels,
 *               'priceLine' for `createPriceLine`, or 'dom' for a DOM overlay.
 * `subpass`   — 'drawBackground' or 'draw' within that slot; null when native.
 * `attachSeq` — position in the single attach sequence, for the four layers that
 *               are separated by attach order alone. null when ordering does not
 *               depend on it.
 * `physical`  — the distinct physical position, 0-lowest. Nine buckets, six values.
 */
export const LWC_ASSIGNMENT = Object.freeze({
  'background colors': Object.freeze({ mechanism: 'BgLayer', slot: 'bottom', subpass: 'drawBackground', attachSeq: null, physical: 0 }),
  fills: Object.freeze({ mechanism: 'FillLayer', slot: 'normal', subpass: 'drawBackground', attachSeq: null, physical: 1 }),
  plots: Object.freeze({ mechanism: 'native series', slot: 'series', subpass: null, attachSeq: null, physical: 2 }),
  'horizontal levels': Object.freeze({ mechanism: 'createPriceLine', slot: 'priceLine', subpass: null, attachSeq: null, physical: 3 }),
  linefills: Object.freeze({ mechanism: 'LinefillLayer', slot: 'normal', subpass: 'draw', attachSeq: 1, physical: 4 }),
  lines: Object.freeze({ mechanism: 'LineLayer', slot: 'normal', subpass: 'draw', attachSeq: 2, physical: 4 }),
  boxes: Object.freeze({ mechanism: 'BoxLayer', slot: 'normal', subpass: 'draw', attachSeq: 3, physical: 4 }),
  labels: Object.freeze({ mechanism: 'LabelLayer', slot: 'normal', subpass: 'draw', attachSeq: 4, physical: 4 }),
  tables: Object.freeze({ mechanism: 'DOM overlay', slot: 'dom', subpass: null, attachSeq: null, physical: 5 }),
})

/**
 * ⛔ THE ONE TRUE ATTACH SEQUENCE. Attach these, in this order, from ONE place.
 *
 * Buckets 5–8 share a single physical slot and are separated by nothing except
 * the order in which their layers were pushed onto the host series. A layer
 * attached out of sequence is not "slightly wrong" — it inverts a documented Pine
 * ordering rule, and it does so silently.
 */
export const ATTACH_SEQUENCE = Object.freeze(['linefills', 'lines', 'boxes', 'labels'])

/** Losses recorded in the capability map that this module has to encode rather
 *  than paper over. Keyed by the map's own loss ids so the two can be diffed. */
export const KNOWN_LOSSES = Object.freeze({
  L1: 'any other normal-slot primitive attached after LabelLayer jumps above the labels',
  L2: 'plots on a series that paints after the drawings host land above the drawings',
  L3: 'explicit_plot_zorder cannot push an hline below a plot while hlines use createPriceLine',
  L4: 'behind_chart=true needs the main series to paint last, which depends on L2',
  L5: 'a pane primitive at normal always paints beneath every series primitive',
  L7: 'whether TradingView draws its grid above or below a Pine bgcolor is UNVERIFIED',
})

function requireBucket(bucket) {
  if (!LWC_ASSIGNMENT[bucket]) throw new Error(`unknown Pine z-bucket: ${bucket}`)
  return LWC_ASSIGNMENT[bucket]
}

/** The bucket a Pine construct belongs to. */
export function bucketOf(source) {
  for (const [bucket, sources] of Object.entries(BUCKET_SOURCES)) {
    if (sources.includes(source)) return bucket
  }
  throw new Error(`no z-bucket for Pine construct: ${source}`)
}

/** Ascending rank of a bucket, 0-lowest. */
export function rankOf(bucket) {
  const i = PINE_BUCKETS.indexOf(bucket)
  if (i < 0) throw new Error(`unknown Pine z-bucket: ${bucket}`)
  return i
}

/**
 * Order drawn elements exactly as Pine paints them.
 *
 * @param {Array<{bucket: string, seq?: number}>} elements  `seq` is creation
 *        order within the script; Pine paints later-created elements on top.
 * @param {{explicitPlotZorder?: boolean}} [opts]
 * @returns {Array} the same elements, first-painted first
 *
 * ⭐ STABLE WITHIN A BUCKET, AND THAT IS A REQUIREMENT, NOT A DETAIL. Pine:
 * *"elements created last in the script's logic appear on top."* An unstable sort
 * would reorder same-bucket elements arbitrarily between renders, which reads as
 * a flicker nobody can reproduce.
 */
export function paintOrder(elements, { explicitPlotZorder = false } = {}) {
  const list = (elements || []).map((el, i) => ({ el, i, bucket: el.bucket }))
  for (const e of list) requireBucket(e.bucket)

  const key = (e) => {
    const r = rankOf(e.bucket)
    // ⚠️ `explicit_plot_zorder = true` collapses buckets 2/3/4 (fills, plots,
    // horizontal levels) into the script's own call order. Everything outside
    // that trio keeps its bucket rank.
    if (explicitPlotZorder && r >= 1 && r <= 3) return 1
    return r
  }

  return list
    .sort((a, b) => {
      const d = key(a) - key(b)
      if (d !== 0) return d
      const sa = a.el.seq, sb = b.el.seq
      if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb
      return a.i - b.i                 // stable: preserve input order
    })
    .map((e) => e.el)
}

/**
 * The LWC placement for a bucket, given the script's declaration flags.
 *
 * @returns {{mechanism, slot, subpass, attachSeq, physical, refusals: string[]}}
 *
 * ⚠️ `refusals` is where this module says what it CANNOT do, by name, instead of
 * returning a placement that looks fine and is wrong. A caller that ignores a
 * refusal ships the wrong z-order; a caller that never sees one cannot even know
 * to ask.
 */
export function placementFor(bucket, { explicitPlotZorder = false, behindChart = true } = {}) {
  const base = requireBucket(bucket)
  const refusals = []

  if (explicitPlotZorder && bucket === 'horizontal levels') {
    // L3. `priceLineView` is hard-wired after `seriesPaneView` inside
    // Series.paneViews(), so while an hline is a price line it can never be
    // pushed below a plot, whatever the script asked for.
    refusals.push(
      'pine:explicit-zorder-hline — explicit_plot_zorder cannot lower an hline while it is a ' +
      'createPriceLine; render hlines inside the ordered primitive layers instead',
    )
  }
  if (behindChart && bucket === 'plots') {
    // L4. behind_chart defaults to TRUE: the script's visuals belong behind the
    // chart's own candles. There is no "chart layer" to hide behind — the main
    // series is just another series — so the main series must paint last.
    refusals.push(
      'pine:behind-chart — requires the main price series to sort last in the pane ' +
      '(setSeriesOrder), whose paint-order semantics are UNVERIFIED (L2)',
    )
  }

  return { ...base, refusals }
}

/**
 * Does a proposed placement preserve Pine's non-negotiable rule?
 *
 * *"An element cannot be placed outside the region of z-space that its group
 * occupies — for example, a plot can never appear on top of a table."*
 *
 * @returns {{ok: boolean, violations: string[]}}
 *
 * ⭐ THE TABLE RULE HOLDS STRUCTURALLY, NOT BY CONVENTION. A pane primitive at
 * 'normal' always paints beneath every series primitive (L5) — you cannot reorder
 * that — so a table at 'normal' would sit under the plots, inverting the one
 * ordering Pine calls out by name. Tables therefore go to 'top' or the DOM, and
 * that mechanism is what enforces the rule rather than a check somewhere.
 */
export function validate(placements) {
  const violations = []
  for (const [bucket, got] of Object.entries(placements || {})) {
    const want = LWC_ASSIGNMENT[bucket]
    if (!want) { violations.push(`unknown bucket: ${bucket}`); continue }
    if (got.slot !== want.slot) {
      violations.push(`${bucket}: slot '${got.slot}' should be '${want.slot}'`)
    }
    if (got.subpass !== want.subpass) {
      violations.push(`${bucket}: subpass '${got.subpass}' should be '${want.subpass}'`)
    }
  }
  // Cross-bucket: whatever the individual slots say, the physical order must
  // still be monotonic in bucket rank.
  const ranked = PINE_BUCKETS.filter((b) => placements && placements[b])
  for (let i = 1; i < ranked.length; i += 1) {
    const lo = LWC_ASSIGNMENT[ranked[i - 1]].physical
    const hi = LWC_ASSIGNMENT[ranked[i]].physical
    if (hi < lo) violations.push(`${ranked[i]} would paint below ${ranked[i - 1]}`)
  }
  return { ok: violations.length === 0, violations }
}
