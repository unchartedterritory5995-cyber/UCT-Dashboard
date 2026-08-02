// app/src/components/chart/engine/readout.js
//
// ─── THE CROSSHAIR LEGEND FOR EVERY SERIES THE ENGINE DREW ──────────────────
//
// ⛔ THE CARRY THIS CLOSES, AND WHY IT NEEDED ITS OWN GATE. `processCrosshair`
// reads `rsiSeriesRef.current` (`StockChart.jsx:7788`). When the engine draws
// RSI that ref is null, `crosshairData.rsi` stays null, and the `RSI(14) 54.3`
// chip (`:9590`) is simply absent. The pixel gate CANNOT SEE THIS: a headless
// capture has no cursor, so no chip is drawn on either side and the diff is 0
// either way. A migration is not done when the picture matches; it is done when
// everything that reads the indicator still reads it.
//
// PURE. No React, no lightweight-charts, no refs. It takes the binder's own
// bindings and the crosshair event's `seriesData` map and returns rows.
//
// ─── THE SLOT BRIDGE IS TRANSITIONAL, AND SAYS SO ───────────────────────────
//
// `LEGACY_SLOTS` maps a binding to the `crosshairData` FIELD the shipped legend
// already renders (`crosshairData.rsi`, `.macd`, `.macdSig`, …). That is the only
// way to land an engine chip in the SAME POSITION, with the same neighbours, as
// the chip it replaces — and position is exactly the kind of difference no pixel
// gate run without a cursor can catch. It is deleted at B4, when the legend
// renders `engineChips()` directly and stops enumerating indicators at all.

/** `'<defId>::<plotKey>'` → the `crosshairData` field the shipped legend reads.
 *
 *  ⚠️ TRANSITIONAL. Every entry corresponds to one line of the hand-written
 *  `legChips` array (`StockChart.jsx:9588-9599`) and disappears with it.
 *  `readout.test.js` fails if a definition declares a visible chip with no slot
 *  (the chip would render nowhere) or if a slot names a plot that does not exist. */
export const LEGACY_SLOTS = Object.freeze({
  'rsi::rsi': 'rsi',
  'macd::macd': 'macd',
  'macd::signal': 'macdSig',
  'stoch::k': 'stochK',
  'stoch::d': 'stochD',
  'atr::atr': 'atr',
  'sar::sar': 'sar',
  'ichimoku::tenkan': 'ichimokuTenkan',
  'ichimoku::kijun': 'ichimokuKijun',
})

/** LWC's own default when a plot declares no `legend.decimals`. Two, because
 *  that is `seriesOptionsDefaults.priceFormat.precision` and a chip with no
 *  declared opinion should agree with the axis it sits above. */
const DEFAULT_DECIMALS = 2

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** The chip's leading text: an explicit label, or shortName + declared params
 *  resolved against THIS instance's inputs (falling back to the definition's
 *  declared defaults, which is what "unset means current default" means
 *  everywhere else in the engine). */
function chipLabel(def, plot, inputs) {
  if (plot.legend && typeof plot.legend.label === 'string') return plot.legend.label
  const name = (def.meta && def.meta.shortName) || def.id
  const params = (def.meta && def.meta.legendParams) || []
  if (!params.length) return name
  const declared = new Map((def.inputs || []).map(i => [i.key, i.default]))
  const values = params.map(k => (inputs && inputs[k] !== undefined ? inputs[k] : declared.get(k)))
  return `${name}(${values.join(', ')})`
}

/** A plot's colour for THIS instance. Mirrors `pool.resolvePlotForInstance`
 *  without importing it, because that module carries the LWC option vocabulary
 *  and the legend needs one field. */
function resolvePlotColor(plot, inputs, def) {
  const refKey = plot.$refs && plot.$refs.color
  if (refKey) {
    if (inputs && inputs[refKey] !== undefined) return inputs[refKey]
    const declared = (def.inputs || []).find(i => i && i.key === refKey)
    if (declared && declared.default !== undefined) return declared.default
  }
  return plot.color
}

/**
 * The legend chips for the series the engine currently holds.
 *
 * @param {object[]} bindings  `binder.bindings()` — each carries `lastValue`,
 *                             the developing-bar fallback (see below)
 * @param {Map}      seriesData `crosshairMove` param's `seriesData` map
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list (for per-instance inputs)
 * @returns {{defId,plotKey,slot,label,color,decimals,value,text}[]} in binding order
 */
export function engineChips(bindings, seriesData, registry, instances) {
  const get = resolveRegistry(registry)
  const byId = new Map((Array.isArray(instances) ? instances : [])
    .filter(i => i && typeof i.instanceId === 'string')
    .map(i => [i.instanceId, i]))
  const out = []

  for (const b of (Array.isArray(bindings) ? bindings : [])) {
    if (!b || !b.series) continue
    const def = get(b.defId)
    if (!def) continue
    const plot = (def.plots || []).find(p => p && p.key === b.plotKey)
    // No `legend` block at all ⇒ no chip. The ten un-flipped natives are in that
    // state, and their chips are still the hand-written ones — emitting an
    // undeclared chip here would put a second, differently-formatted ATR next to
    // the legacy one the moment anyone hands the binder an ATR instance.
    if (!plot || !plot.legend || plot.legend.hide === true) continue

    const point = seriesData && typeof seriesData.get === 'function' ? seriesData.get(b.series) : null
    // ── THE DEVELOPING-BAR FALLBACK ──────────────────────────────────────────
    //
    // Legacy: `d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)`
    // (`StockChart.jsx:7829`). The hovered bar not carrying a point for this
    // series is the NORMAL live case, not an edge one: the bars push feed's
    // writer B appends the developing candle imperatively (`:4553`), so on an
    // intraday chart the newest bar is on the candles and not yet on the
    // indicator until the next SWR refresh. Legacy printed the last computed
    // value there; an engine chip that printed NOTHING is a readout regression
    // no pixel gate can see — it only happens under a live tape.
    //
    // `binding.lastValue` is the binder's own record of the final point it set
    // on this series (`binder.js`), which is the same number `.at(-1)` reads.
    let value = point ? point.value : undefined
    if (!Number.isFinite(value)) value = b.lastValue
    if (!Number.isFinite(value)) continue

    const inst = byId.get(b.instanceId)
    const inputs = (inst && inst.inputs) || {}
    // The colour a chip wears is the colour the LINE wears, so it is resolved the
    // same way the binder resolves it — through the instance, never the
    // definition default. Reading `cs.indicators[id].color` (what the shipped
    // legend does) would be wrong the moment a second instance exists.
    const resolved = resolvePlotColor(plot, inputs, def)
    const decimals = Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS
    const label = chipLabel(def, plot, inputs)

    out.push({
      defId: def.id,
      plotKey: plot.key,
      slot: LEGACY_SLOTS[`${def.id}::${plot.key}`] || null,
      label,
      color: resolved,
      decimals,
      value,
      text: `${label} ${value.toFixed(decimals)}`,
    })
  }
  return out
}

/** The chips keyed by the legacy `crosshairData` field, for the bridge in
 *  StockChart. A chip with no slot is DROPPED here and reported by
 *  `readout.test.js`, never rendered in the wrong place. */
export function chipsBySlot(chips) {
  const out = {}
  for (const c of (chips || [])) {
    if (!c.slot) continue
    out[c.slot] = { value: c.value, text: c.text, color: c.color }
  }
  return out
}
