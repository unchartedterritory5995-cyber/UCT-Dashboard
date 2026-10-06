// app/src/components/chart/builder/studio/chartPreview.js
//
// ─── ⭐⭐ P2 TRACK B — THE EPHEMERAL LIVE-CHART PREVIEW, AS A READ VIEW ────────
//
// Create Indicator draws the conversation's WORKING definition on the member's
// REAL chart — the real binder, the real presentation, the real pane layout —
// without the working definition ever becoming chart state.
//
// HOW: the working definition is installed in the registry under ONE fixed id
// (`STUDIO_PREVIEW_DEF_ID`) and ONE instance of it is laid over StockChart's
// `csView` — the read view the renderer already consumes for follow-the-chart
// COT (`StockChart.jsx`, "A READ VIEW ONLY: every write keeps using `cs`"). The
// stored blob `cs` never holds it, so no writer that spreads `{...cs}` can carry
// it to storage.
//
// ⛔ DEFENCE IN DEPTH: `stripPreview` runs at the persist boundary
// (`handleUpdateChartSettings`) too. A preview reaching storage by any route —
// a future writer that reads the view by mistake, a pane-size drag on the
// preview's own pane — is removed there, every reference to it included.
//
// ⭐ ONE CONVERSATION, ONE PREVIEW IDENTITY. The def id and the instance id are
// both fixed, so turn 2 PATCHES preview A (re-install under the same id, same
// instance) rather than adding preview B. There is no counter to drift.

import { addInstance } from '../../engine/instanceControls'

/** The registry id the studio preview installs under. Legal under
 *  `defSchema.ID_RE`; the server mints `u_` + 12 hex, so no stored definition can
 *  ever wear it. Distinct from the Builder's two preview ids so the studio and an
 *  open Builder can never fight over one registry entry. */
export const STUDIO_PREVIEW_DEF_ID = 'u_studio-preview'

/** Is this instance (or instance id) the studio preview? */
export function isPreviewInstanceId(id) {
  return typeof id === 'string' && id.includes(STUDIO_PREVIEW_DEF_ID)
}

/**
 * The ONE preview instance for the installed preview definition, shaped by the
 * product's own `addInstance` (declared input defaults, placement) against the
 * STORED blob — so it is exactly the instance Save will add, under an id that is
 * stable across turns because the stored blob never holds it.
 * @returns {object|null}
 */
export function previewInstanceFor(cs, registry) {
  if (!cs || typeof cs !== 'object') return null
  const before = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const next = addInstance(cs, STUDIO_PREVIEW_DEF_ID, registry)
  if (next === cs) return null
  const list = Array.isArray(next.indicatorInstances) ? next.indicatorInstances : []
  const taken = new Set(before.map((i) => i && i.instanceId))
  return list.find((i) => i && i.defId === STUDIO_PREVIEW_DEF_ID && !taken.has(i.instanceId)) || null
}

/** The read view with the preview laid over it. Identity when there is none. */
export function withPreviewInstance(view, instance) {
  if (!instance || !view) return view
  const list = Array.isArray(view.indicatorInstances) ? view.indicatorInstances : []
  return { ...view, indicatorInstances: [...list.filter((i) => !(i && i.defId === STUDIO_PREVIEW_DEF_ID)), instance] }
}

const refersToPreview = (v) => isPreviewInstanceId(v)

/**
 * Remove every trace of the studio preview from a settings blob bound for
 * storage. Returns the SAME object when there is nothing to remove — writers in
 * StockChart compare by identity, so a no-op must stay a no-op.
 */
export function stripPreview(settings) {
  if (!settings || typeof settings !== 'object') return settings
  let out = settings
  const touch = () => { if (out === settings) out = { ...settings } }

  const list = settings.indicatorInstances
  if (Array.isArray(list) && list.some((i) => i && (i.defId === STUDIO_PREVIEW_DEF_ID || refersToPreview(i.instanceId)))) {
    touch()
    out.indicatorInstances = list.filter((i) => !(i && (i.defId === STUDIO_PREVIEW_DEF_ID || refersToPreview(i.instanceId))))
  }
  if (settings.indicators && typeof settings.indicators === 'object' && STUDIO_PREVIEW_DEF_ID in settings.indicators) {
    touch()
    const { [STUDIO_PREVIEW_DEF_ID]: _gone, ...rest } = settings.indicators
    out.indicators = rest
  }
  if (Array.isArray(settings.paneOrder) && settings.paneOrder.some(refersToPreview)) {
    touch()
    out.paneOrder = settings.paneOrder.filter((k) => !refersToPreview(k))
  }
  if (settings.paneSizes && typeof settings.paneSizes === 'object' && Object.keys(settings.paneSizes).some(refersToPreview)) {
    touch()
    out.paneSizes = Object.fromEntries(Object.entries(settings.paneSizes).filter(([k]) => !refersToPreview(k)))
  }
  const pso = settings.paneSeriesOrder
  if (pso && typeof pso === 'object' && Object.entries(pso).some(([k, v]) => refersToPreview(k)
    || (Array.isArray(v) && v.some(refersToPreview)))) {
    touch()
    out.paneSeriesOrder = Object.fromEntries(Object.entries(pso)
      .filter(([k]) => !refersToPreview(k))
      .map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => !refersToPreview(x)) : v]))
  }
  const ivs = settings.header && settings.header.infoValues
  if (Array.isArray(ivs) && ivs.some((e) => e && refersToPreview(e.instanceId))) {
    touch()
    out.header = { ...settings.header, infoValues: ivs.filter((e) => !(e && refersToPreview(e.instanceId))) }
  }
  return out
}
