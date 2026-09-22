// app/src/components/chart/engine/primaryProduct.js
//
// ─── A PRIMARY CHART WHOSE IDENTITY IS A PRODUCT ────────────────────────────
//
// ⭐⭐ ONE PRIMARY IDENTITY, SEVERAL PLOTTED SERIES — AND NO NEW RENDERER. The
// main chart is built around ONE bars array feeding ONE price series, and that
// assumption is load-bearing everywhere (live ticks, replay, capture, the atomic
// symbol handoff). So a product does not change it: the chart's own price slot
// holds the product's PRIMARY COMPONENT, and the remaining components are added
// as ORDINARY `dataSeries` instances overlaid on the price pane — exactly what a
// member could do by hand, which is why the legend, the crosshair, the scale and
// the settings surfaces all work with no code that knows a product exists.
//
// ⛔⛔ DERIVED, NEVER PERSISTED. These instances are computed from the symbol and
// the catalogue on every render and live only in the blob the renderer reads.
// Nothing is written to `chart_settings`, so charting AAII does not mutate a
// member's workspace, switching away removes them with no cleanup, and a saved
// chart is byte-identical to one saved before products existed. That is the same
// discipline the primary chart-type clamp follows one file over.
//
// ⛔ AND IT IS DRIVEN BY THE REGISTRY, NOT BY A TICKER. Any product the backend
// declares works here; nothing names AAII.

import { PRODUCT_SERIES_COLORS } from '../discoveryCatalog'

/** The id prefix these ephemeral instances carry.
 *
 *  ⭐ RECOGNISABLE AND RESERVED, so anything that walks the instance list can tell
 *  a derived companion from a member's own row — and so a future writer can refuse
 *  to persist one. A member's instances are minted `inst:<defId>:<n>`; this shape
 *  cannot collide with that. */
export const PRIMARY_PRODUCT_PREFIX = 'prod:'

export const isPrimaryProductInstance = (i) =>
  !!(i && typeof i.instanceId === 'string' && i.instanceId.startsWith(PRIMARY_PRODUCT_PREFIX))

/**
 * The companion instances a product-identity primary chart draws beside its own
 * price series.
 *
 * @param {object|null} product a catalogue product row — `{id, components,
 *        component_rows, primary_component}`
 * @returns {Array} ordinary `dataSeries` instances, or `[]`
 *
 * ⛔ THE PRIMARY COMPONENT IS SKIPPED, ALWAYS. The chart's own price series is
 * already bound to it (`series.build_bars` serves it under the product's ticker),
 * so emitting it here too would draw the same numbers twice — once as the price
 * line and once as an overlay — and the legend would read the value twice.
 *
 * ⚠️ COLOURS CONTINUE THE PRODUCT PALETTE FROM INDEX 0, so the price series and
 * the overlays are the same three colours a member sees when they add the product
 * as an INDICATOR. One product, one look, whichever door they came through.
 */
export function primaryProductInstances(product) {
  if (!product) return []
  const ids = Array.isArray(product.components) ? product.components.filter(Boolean) : []
  if (ids.length < 2) return []
  const primary = product.primary_component || product.primaryComponent || ids[0]
  const named = new Map(
    (product.component_rows || product.componentRows || [])
      .filter((c) => c && c.id)
      .map((c) => [c.id, c]),
  )
  const out = []
  ids.forEach((cid, idx) => {
    if (cid === primary) return
    const meta = named.get(cid) || {}
    out.push({
      // ⚠️ KEYED BY THE COMPONENT, NOT BY POSITION. The id has to be stable across
      // renders or the binder would retire and recreate the series every frame.
      instanceId: `${PRIMARY_PRODUCT_PREFIX}${product.id}:${cid}`,
      defId: 'dataSeries',
      inputs: {
        source: `sym:${cid}:close`,
        color: PRODUCT_SERIES_COLORS[idx % PRODUCT_SERIES_COLORS.length],
      },
      // ⭐ ON THE PRICE PANE, WHICH IS WHERE THE PRODUCT'S OWN SERIES ALREADY IS.
      // All components share one unit, so they share one scale — the shared
      // percentage axis the product declares, not three normalisations.
      placement: { target: 'price' },
      display: meta.display ? { name: meta.display, compact: meta.short || meta.display } : undefined,
    })
  })
  return out
}

/**
 * `cs` with the product's companions merged in, or `cs` unchanged.
 *
 * ⚠️ RETURNS THE SAME OBJECT WHEN THERE IS NOTHING TO ADD. Identity matters — the
 * settings blob feeds memo dependencies all over `StockChart`, and allocating a
 * copy per render would invalidate every one of them on every frame.
 *
 * ⛔ THE MEMBER'S OWN INSTANCES COME FIRST AND ARE NEVER REPLACED. A companion is
 * appended; if a member has separately added the same component themselves, both
 * exist, which is the honest outcome — their row is theirs to delete and ours is
 * not a row at all.
 */
export function withPrimaryProduct(cs, product) {
  const extra = primaryProductInstances(product)
  if (!extra.length) return cs
  const own = Array.isArray(cs && cs.indicatorInstances) ? cs.indicatorInstances : []
  return { ...cs, indicatorInstances: [...own, ...extra] }
}
