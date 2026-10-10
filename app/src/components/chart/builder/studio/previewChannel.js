// app/src/components/chart/builder/studio/previewChannel.js
//
// ─── ⭐ M3 S3 — THE ONE LIVE AUTHORING PREVIEW PER BROWSER TAB (AGENT-M3-CONTRACT D3) ────
//
// The studio preview's registry entry is ONE module-global id (`STUDIO_PREVIEW_DEF_ID`), so
// two charts previewing at once would share it and either one's teardown would remove both.
// This file is the rule that makes that impossible: whoever shows a preview CLAIMS the tab's
// one preview; the previous holder's preview is cleared first and its chart is reported
// (`movedFrom`). Owners: the Create Indicator dock (`kind: 'dock'`, which always wins) and the
// chart handle UCT Agent drives (`kind: 'agent'`).
//
// ⭐ `installPreview` is the dock's own install-and-show step, MOVED here from
// `CreateIndicatorPanel` so the dock and the Agent preview through ONE path: install the
// working definition under the preview id (the registry is also the validation door), then
// hand the chart the instance Save would add — or, for an edit, the instance it stands in for.
// ⛔ Never persisted: StockChart strips the preview from every settings write (`stripPreview`).

import { STUDIO_PREVIEW_DEF_ID, previewInstanceFor, previewInstanceLike, withCalcFrame } from './chartPreview'
// ⛔ `editPreview.withPendingInputs` is INJECTED (`shapeEdit`), never imported: it reaches the
// save module (and through it BuilderSheet/StockChart), and the chart toolbar imports this file
// EAGERLY — an import here would close a cycle through the drawing tools at load.

let holder = null // { token, chartRef, kind, clear }

/**
 * Claim the tab's one preview for `token` on `chartRef`. A different holder's preview is
 * cleared first. @returns `{movedFrom: chartRef|null}` — the chart that lost its preview.
 */
export function claimPreview(token, chartRef, clear, kind = 'agent') {
  let movedFrom = null
  if (holder && holder.token !== token) {
    const prev = holder
    holder = null
    try { prev.clear() } catch { /* the previous chart's teardown */ }
    movedFrom = prev.chartRef === chartRef ? null : (prev.chartRef ?? null)
  }
  holder = { token, chartRef: chartRef ?? null, kind, clear }
  return { movedFrom }
}

/** Give the preview up (only the holder can). */
export function releasePreview(token) {
  if (holder && holder.token === token) holder = null
}

/** Who holds the tab's preview, as plain data. */
export function previewHolder() {
  return holder ? { chartRef: holder.chartRef, kind: holder.kind } : null
}
export function holdsPreview(token) { return !!holder && holder.token === token }

/**
 * Install `definition` (already under `STUDIO_PREVIEW_DEF_ID`, semantics-stamped) and show it
 * on the chart through `onPreview`. `edit` = the stored definition this previews in place of
 * (`{defId}`), `base` its opened version, `calcTf` the requested calculation timeframe.
 * @returns true when the preview is drawn; false (and nothing drawn) when the registry refuses it.
 */
export function installPreview({ definition, edit = null, base = null, calcTf = null, settings, registry, onPreview, shapeEdit = null }) {
  if (!definition) {
    registry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
    onPreview?.(null)
    return false
  }
  const { installed } = registry.installUserDefinitions([definition])
  if (installed.length !== 1) {
    registry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
    onPreview?.(null)
    return false
  }
  // ⭐ PHASE 4 — an edit previews IN PLACE of the saved drawing, shaped like it.
  // ⭐ PHASE 5 — on the calculation timeframe the conversation asked for.
  // ⭐ BATCH 1 — with the setting values Save will write (`editPreview.withPendingInputs`).
  if (edit && edit.defId) {
    const plain = previewInstanceLike(settings, edit.defId, registry)
    const like = typeof shapeEdit === 'function' ? shapeEdit(plain, { base, working: definition, settings, registry }) : plain
    onPreview?.(withCalcFrame(like, calcTf), { replaces: edit.defId })
  } else onPreview?.(withCalcFrame(previewInstanceFor(settings, registry), calcTf))
  return true
}

/** Remove the preview: no registry entry, no instance. */
export function removePreview(registry, onPreview) {
  registry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
  onPreview?.(null)
}

/** Tests only. */
export function _resetPreviewChannel() { holder = null }
