// app/src/components/chart/builder/presentationPreserve.js
//
// ─── ⭐⭐ P2 — AN EDIT THAT CHANGES THE MATHS DOES NOT ERASE THE PRESENTATION ──
//
// The builder writes a document from its ROW MODEL (`buildDefinition`). Fields
// that model cannot hold — a Pine import's computed plot colour
// (`colorPacked`), a `lineStyle`, a custom `legend`, `precision`, `sparse`, a
// band's `edges`, a non-numeric `opacity`, extra placement settings, and every
// `paints[]` entry the builder did not author — used to vanish on a reopen-and-
// save (P1 intent report, MEDIUM finding). Two halves close it:
//
//   1. `restorableRowFields(plot)` — what the row model CAN hold comes back INTO
//      the row on reopen (colorMode + its colours, numeric opacity, fill), so the
//      member's own UI stays the authority over it: change it and the change
//      wins, leave it and it round-trips through `buildDefinition` unchanged.
//   2. `preservePresentation(next, prior, …)` — what the row model CANNOT hold is
//      carried from the stored document onto the newly built one, field by
//      field, ONLY when the new document does not already say something there.
//      A field the builder never lets a member edit cannot have been "explicitly
//      changed", so the stored value is the truth.
//
// ⛔ NOTHING MATHEMATICAL IS CARRIED. `forward`/`repaint`/`freshness` are facts
// about the tree; `objects` (the Pine drawing program) is bound to the compute
// graph's node indexes, so carrying it across a maths edit could bind it to the
// wrong nodes — it is NOT carried (recorded for owner review).
//
// ⛔ A CARRIED REFERENCE MUST STILL RESOLVE. A paint whose column, or `edges`
// naming a plot, the member has since removed is DROPPED and REPORTED in
// `dropped` — removing the column is the member's explicit change.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** Fields `buildDefinition` writes from a row (its vocabulary). A prior value
 *  of one of these is either restored into the row on reopen or is the
 *  builder's own to decide — never carried behind its back. */
const BUILDER_PLOT_VOCAB = new Set([
  'key', 'label', 'style', 'color', 'width', 'role', 'hidden', 'marker',
  'displace', 'displaceFrom', 'levels',
  'colorMode', 'colorUp', 'colorDown', 'colorPalette', 'colorGradient',
  'opacity', 'fill', 'fillColor', 'fillOpacity',
])
/** Facts about the maths, never presentation. */
const NEVER_CARRIED = new Set(['forward', 'repaint', 'freshness'])
/** The builder writes a fixed default here and offers no control over it, so a
 *  stored value is never something the member changed in this sheet. */
const PRIOR_WINS = new Set(['legend'])

/**
 * The presentation a stored data plot carries that the row model can hold,
 * shaped exactly as `buildDefinition` reads it off a row — so a reopen-and-save
 * writes the same fields back.
 */
export function restorableRowFields(p) {
  if (!isObj(p)) return {}
  const out = {}
  const mode = typeof p.colorMode === 'string' ? p.colorMode : null
  if (mode && typeof p.colorUp === 'string' && typeof p.colorDown === 'string') {
    Object.assign(out, { colorMode: mode, colorUp: p.colorUp, colorDown: p.colorDown })
  } else if (mode && Array.isArray(p.colorPalette) && p.colorPalette.length >= 2) {
    Object.assign(out, { colorMode: mode, colorPalette: p.colorPalette.slice() })
  } else if (mode && isObj(p.colorGradient)
    && typeof p.colorGradient.from === 'string' && typeof p.colorGradient.to === 'string') {
    Object.assign(out, { colorMode: mode, colorGradient: { ...p.colorGradient } })
  }
  if (Number.isFinite(p.opacity)) out.opacity = p.opacity
  if (isObj(p.fill) && typeof p.fill.with === 'string') out.fill = clone(p.fill)
  if (typeof p.fillColor === 'string') out.fillColor = p.fillColor
  if (Number.isFinite(p.fillOpacity)) out.fillOpacity = p.fillOpacity
  return out
}

/** Does a stored plot carry presentation the untouched-row test must respect? */
export function rowCarriesPresentation(row) {
  return !!(row && (row.colorMode || Number.isFinite(row.opacity) || isObj(row.fill)
    || (row.marker && row.marker.shape)))
}

const columnOf = (mode) => (typeof mode === 'string' && mode.startsWith('column:')
  ? mode.slice('column:'.length) : null)

/**
 * The indexes of `prior.paints` the BUILDER authored and moved into its SIGNAL
 * control on reopen (`openForEdit`: `signalPaintsOf(prior, key)` — the first
 * barcolor and the first bgcolor on the signal column that paint nothing where
 * false). Those are the builder's to re-emit or drop; every other paint is the
 * document's and is carried.
 */
export function builderOwnedPaintIndexes(prior, signalKey, noPaint) {
  const out = new Set()
  if (!signalKey || !prior || !Array.isArray(prior.paints)) return out
  for (const kind of ['barcolor', 'bgcolor']) {
    const at = prior.paints.findIndex((p) => p && p.kind === kind
      && p.colorMode === `column:${signalKey}` && p.colorDown === noPaint && typeof p.colorUp === 'string')
    if (at >= 0) out.add(at)
  }
  return out
}

/**
 * Carry the presentation `next` (a freshly built document) cannot express from
 * `prior` (the stored document being edited).
 *
 * @param {object} next   the document `buildDefinition` just produced
 * @param {object|null} prior  the stored document the edit started from
 * @param {{ownedPaints?: Set<number>}} opts  prior paint indexes the builder owns
 * @returns {{doc: object, carried: string[], dropped: string[]}}
 */
export function preservePresentation(next, prior, { ownedPaints = new Set() } = {}) {
  const carried = []
  const dropped = []
  if (!isObj(next) || !isObj(prior)) return { doc: next, carried, dropped }
  const doc = clone(next)
  const nextPlots = Array.isArray(doc.plots) ? doc.plots : []
  const priorPlots = Array.isArray(prior.plots) ? prior.plots : []
  const columns = new Set(nextPlots.filter((p) => isObj(p) && p.style !== 'hlines').map((p) => p.key))
  const priorByKey = new Map(priorPlots.filter(isObj).map((p) => [p.key, p]))

  for (const p of nextPlots) {
    if (!isObj(p) || p.style === 'hlines') continue
    const q = priorByKey.get(p.key)
    if (!isObj(q) || q.style === 'hlines') continue
    for (const [field, value] of Object.entries(q)) {
      if (NEVER_CARRIED.has(field)) continue
      if (PRIOR_WINS.has(field)) {
        if (JSON.stringify(p[field]) !== JSON.stringify(value)) {
          p[field] = clone(value)
          carried.push(`plots.${p.key}.${field}`)
        }
        continue
      }
      if (field === 'colorPacked') {
        // A computed colour is read THROUGH its colorMode; they travel together,
        // and only where the member has not put a colour mode of their own.
        if (p.colorMode === undefined && typeof q.colorMode === 'string'
          && p.colorPacked === undefined) {
          const col = columnOf(q.colorMode)
          if (col && !columns.has(col)) { dropped.push(`plots.${p.key}.colorPacked`); continue }
          p.colorMode = q.colorMode
          p.colorPacked = clone(value)
          carried.push(`plots.${p.key}.colorPacked`)
        }
        continue
      }
      if (field === 'opacity' && !Number.isFinite(value) && p.opacity === undefined) {
        // a ramp-step NAME — the row model holds numbers only
        p.opacity = clone(value)
        carried.push(`plots.${p.key}.opacity`)
        continue
      }
      if (BUILDER_PLOT_VOCAB.has(field) || field in p) continue
      if (field === 'edges' && isObj(value)
        && !(columns.has(value.upper) && columns.has(value.lower))) {
        dropped.push(`plots.${p.key}.edges`)
        continue
      }
      p[field] = clone(value)
      carried.push(`plots.${p.key}.${field}`)
    }
  }

  // ── paints: the document's own (not the builder's SIGNAL ones), in stored
  // order, BEFORE the builder's — within one definition the later barcolor wins
  // (RT6), and the builder only ever appended its paints after the rest.
  const priorPaints = Array.isArray(prior.paints) ? prior.paints : []
  const kept = []
  priorPaints.forEach((paint, i) => {
    if (ownedPaints.has(i) || !isObj(paint)) return
    const col = columnOf(paint.colorMode)
    if (col && !columns.has(col)) { dropped.push(`paints[${i}]`); return }
    kept.push(clone(paint))
  })
  if (kept.length) {
    const own = Array.isArray(doc.paints) ? doc.paints : []
    const ownSig = new Set(own.map((x) => JSON.stringify(x)))
    doc.paints = [...kept.filter((x) => !ownSig.has(JSON.stringify(x))), ...own]
    carried.push(...kept.map((_, i) => `paints[${i}]`))
  }

  // ── placement: the builder decides the TARGET (pane vs price); every other
  // placement setting it has no control over comes from the stored document.
  if (isObj(prior.placement) && isObj(doc.placement)
    && prior.placement.target === doc.placement.target) {
    const merged = { ...doc.placement, ...clone(prior.placement) }
    if (JSON.stringify(merged) !== JSON.stringify(doc.placement)) {
      doc.placement = merged
      carried.push('placement')
    }
  }
  return { doc, carried, dropped }
}
