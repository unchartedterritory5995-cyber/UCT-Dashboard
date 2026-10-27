// app/src/components/chart/builder/agentPanes.js
//
// ─── ⭐ I-9 — THE PANES ON ONE CHART, AS THE MEMBER'S ARRANGE LIST SHOWS THEM ─────────
//
// UCT Agent names panes ("move RSI above price", "make the RSI pane bigger") without
// deriving them. This is a thin READ over the exact helpers Chart Data's Arrange list
// uses: `listAllIndicators` → `activeIndicatorRows` → `paneMap`, ordered by
// `resolvePaneOrder`. The keys it returns are the keys `movePane` / `movePaneTo` /
// `setPaneSizes` take, so a key read here is a key the `movePane` / `setPaneSize`
// mutations accept.
//
// ⛔ PURE. No React, no network, no write.

import { listAllIndicators } from '../indicatorRegistry'
import { paneMap, activeIndicatorRows } from '../chartDataMap'
import { resolvePaneOrder } from '../engine/paneOrder'
import { storedPaneSizes } from '../engine/paneSizes'
import { adoptOverlayAverages } from '../maAdoption'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The registry as Chart Settings hands it to the row list: both lanes (shipped + the
 *  member's own formulas), so a saved formula's pane is listed like any other. */
function bothLanes(registry) {
  if (!registry || typeof registry !== 'object') return registry
  return typeof registry.listAllDefinitions === 'function'
    ? { ...registry, listDefinitions: registry.listAllDefinitions }
    : registry
}

/**
 * @typedef {{
 *   paneKey: string,                 // 'price' | 'volume' | <host instanceId> — the key pane ops take
 *   kind: 'price' | 'volume' | 'pane',
 *   label: string,                   // the name Chart Data shows ("Price", "RSI (14)")
 *   index: number,                   // 0 = top of the stack
 *   ownerInstanceIds: string[],      // the instances drawing in it (host first for a 'pane')
 *   hostInstanceId: string | null,   // the instance that owns a 'pane'
 *   share: number | null,            // the member's stored height share, or null (automatic)
 * }} PaneSummary
 */

/**
 * The visible pane stack, top to bottom.
 *
 * @param {object} cs           the chart's settings
 * @param {object} registry     the engine registry (`nativeRegistry`)
 * @param {object} [volumeOpts] the host's volume presentation props, exactly as the host
 *                              hands them to Chart Settings (`ChartPane` passes
 *                              `{volumeSeparatePane: true, blankVolume: false}`). Absent ⇒
 *                              the settings-only answer.
 * @returns {PaneSummary[]}
 */
export function paneKeysOf(cs, registry, volumeOpts = null) {
  if (!isObj(cs)) return []
  const view = adoptOverlayAverages(cs) || cs
  let groups = []
  try {
    const rows = activeIndicatorRows(listAllIndicators(view, bothLanes(registry), {}))
    const defOf = (id) => { try { return (registry && registry.getDefinition && registry.getDefinition(id)) || null } catch { return null } }
    groups = paneMap(rows, view, defOf, volumeOpts)
  } catch { return [] }
  const arrangeable = groups.filter((g) => g.kind === 'price' || g.kind === 'volume' || g.kind === 'pane')
  const sizes = storedPaneSizes(view)
  return arrangeable.map((g, index) => {
    const ids = g.rows.map((r) => r && r.instanceId).filter((id) => typeof id === 'string' && id)
    const host = g.kind === 'pane' ? g.id : null
    const owners = host ? [host, ...ids.filter((id) => id !== host)] : ids
    return Object.freeze({
      paneKey: g.id, kind: g.kind, label: g.name, index,
      ownerInstanceIds: [...new Set(owners)], hostInstanceId: host,
      share: Number.isFinite(sizes[g.id]) ? sizes[g.id] : null,
    })
  })
}

/** The arguments `movePane` / `movePaneTo` take for this chart, from the same read. */
export function paneArrangeArgs(cs, registry, volumeOpts = null) {
  const panes = paneKeysOf(cs, registry, volumeOpts)
  return {
    panes,
    paneKeys: panes.filter((p) => p.kind === 'pane').map((p) => p.paneKey),
    opts: { volumePane: panes.some((p) => p.kind === 'volume') },
  }
}

/** The resolved order (keys only) — what `resolvePaneOrder` says for this chart. */
export function paneOrderOf(cs, registry, volumeOpts = null) {
  const { paneKeys, opts } = paneArrangeArgs(cs, registry, volumeOpts)
  return resolvePaneOrder(isObj(cs) ? (adoptOverlayAverages(cs) || cs) : {}, paneKeys, opts)
}
