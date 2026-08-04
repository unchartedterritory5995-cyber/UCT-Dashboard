// app/src/components/chart/engine/readout.js
//
// ─── THE CROSSHAIR LEGEND, FOR EVERY SERIES ON THE CHART ────────────────────
//
// ⛔ THE CARRY THIS CLOSED, AND WHY IT NEEDED ITS OWN GATE (B3, historical).
// `processCrosshair` used to read `rsiSeriesRef.current`. When the engine drew
// RSI that ref was null, the legend's RSI value stayed null, and the
// `RSI(14) 54.3` chip was simply absent. The pixel gate CANNOT SEE THAT: a
// headless capture has no cursor, so no chip is drawn on either side and the diff
// is 0 either way. A migration is not done when the picture matches; it is done
// when everything that reads the indicator still reads it.
//
// ⚠️ Both names in that paragraph are gone now — `rsiSeriesRef` was deleted at
// RSI's Flip B, and the nine `crosshairData.<indicator>` numeric fields at B4
// Task 10. It is kept because it is the REASON this module exists and the reason
// its gate is a DOM test rather than a pixel one, and that reason has not changed.
//
// PURE. No React, no lightweight-charts, no refs. It takes a list of entries and
// the crosshair event's `seriesData` map and returns rows.
//
// ─── THE SLOT BRIDGE IS GONE, AND WHAT REPLACED IT IS NOT WHAT WAS PLANNED ──
//
// 🔴 THIS HEADER USED TO SAY `LEGACY_SLOTS` WAS "deleted at B4, when the legend
// renders `engineChips()` directly". **THAT PLAN WOULD HAVE DELETED SIX CHIPS FOR
// EVERY USER.** Nine chips ship; only three of them (RSI's line and MACD's line
// and signal) belong to a FLIPPED definition, so only three come out of
// `engineChips`. The other six — Stochastic's %K and %D, ATR, SAR and Ichimoku's
// tenkan and kijun — belong to definitions that are NOT
// migrated, are drawn by hand-written legacy blocks, and have no bindings at all.
//
// ⚠️ THOSE SIX ARE NAMED IN PROSE ON PURPOSE. `enumerationSites.test.js`'s
// discovery scan flags any shipped module that names four or more indicator ids,
// and it does not strip comments — writing them as `<id>::<plotKey>` pairs put
// this file on the scan's list for a paragraph that enumerates nothing. Measured,
// not guessed.
// A legend rendering `engineChips()` alone would simply stop printing them, and
// **no pixel gate could see it**: a headless capture has no cursor.
//
// ⛔ AND "MIGRATE THOSE FOUR THEN" IS THE WRONG TURN, NOT THE FIX. B4 ships ZERO
// migrations — `FLIPPED === MIGRATED` is a Global Constraint asserted both ways,
// and `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` is still
// OPEN, so a migrated-but-un-flipped definition would be engine-drawn for NOBODY.
//
// THE ADJUDICATED DESIGN (A3), and it needs no migration at all: `engineChips`
// already turned *(series, definition, instance inputs)* into *(label, colour,
// decimals, text)*, and only the SERIES SOURCE was engine-specific. So the
// formatting half is extracted into `chipsFrom(entries, …)` and fed a SECOND
// series source — `StockChart`'s `legacyChipEntriesRef`, keyed `<defId>::<plotKey>`
// and registered at the legacy `addSeries` sites that are already fated B5. One
// formatting pipeline, two lanes, and the six legacy chips are now declared on
// their own definitions' `plots[].legend` instead of hand-written in the legend.

// (`LEGACY_SLOTS`, `chipsBySlot` and the per-chip `slot` field were deleted here
//  by B4 Task 10 — the legend renders `crosshairData.chips` directly and there is
//  no `crosshairData.<indicator>` field left for a slot to name.)

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
 * One chip per *(series, plot-that-declares-a-`legend`)*.
 *
 * THE ONE FORMATTING PIPELINE spec §6 asks for: a chip's label, its precision and
 * its colour all come out of `plots[].legend` + `meta.legendParams` + the
 * instance's own inputs, for the engine lane and the legacy lane alike.
 *
 * @param {object[]} entries `[{defId, plotKey, series, lastValue, instanceId}]`.
 *        The engine lane maps its BINDINGS in (`engineChips` below);
 *        `StockChart`'s legacy render blocks register theirs as they create each
 *        series. A plot with NO `legend` block emits nothing, which is how the
 *        un-declared plots stay chip-less — Ichimoku's `spanA`/`spanB`/`chikou`,
 *        every `hlines` guide, and the ten definitions with no chip at all.
 * @param {Map} seriesData `crosshairMove` param's `seriesData` map.
 * @param {object|Function} registry
 * @param {Function} inputsFor `(defId, instanceId) => inputs`. The INSTANCE's own
 *        inputs for the engine lane; `cs.indicators[defId]` for the legacy lane,
 *        which has no instances. ⛔ Reading `cs.indicators[defId]` for BOTH would
 *        be wrong the moment a second instance of one definition exists: two RSI
 *        lines at different periods would print the same number twice.
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,text}[]} in the
 *        order the entries were given.
 */
export function chipsFrom(entries, seriesData, registry, inputsFor) {
  const get = resolveRegistry(registry)
  const out = []

  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || !e.series) continue
    const def = get(e.defId)
    if (!def) continue
    const plot = (def.plots || []).find(p => p && p.key === e.plotKey)
    // No `legend` block at all ⇒ no chip. Emitting an undeclared chip here would
    // put a second, differently-formatted line into the readout for any plot
    // whose author never asked for one.
    if (!plot || !plot.legend || plot.legend.hide === true) continue

    const point = seriesData && typeof seriesData.get === 'function' ? seriesData.get(e.series) : null
    // ── THE DEVELOPING-BAR FALLBACK ──────────────────────────────────────────
    //
    // Legacy: `d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)`. The hovered
    // bar not carrying a point for this series is the NORMAL live case, not an
    // edge one: the bars push feed's writer B appends the developing candle
    // imperatively, so on an intraday chart the newest bar is on the candles and
    // not yet on the indicator until the next SWR refresh. Legacy printed the
    // last computed value there; a chip that printed NOTHING is a readout
    // regression no pixel gate can see — it only happens under a live tape.
    //
    // ⚠️ TWO SHAPES, ON PURPOSE. The engine lane hands a NUMBER —
    // `binding.lastValue`, the binder's own record of the final point it set on
    // this series, which is the same number `.at(-1)` reads. The legacy lane
    // hands a THUNK, because its entry is registered when the series is created
    // and the last computed value moves under it on every SWR refresh. A thunk
    // that throws is treated as "no fallback": this runs on the rAF flush, and a
    // throw here would take the whole legend down mid-hover.
    let value = point ? point.value : undefined
    if (!Number.isFinite(value)) {
      const fb = e.lastValue
      if (typeof fb === 'function') { try { value = fb() } catch { value = undefined } }
      else value = fb
    }
    if (!Number.isFinite(value)) continue

    const inputs = (typeof inputsFor === 'function' ? inputsFor(e.defId, e.instanceId) : null) || {}
    // The colour a chip wears is the colour the LINE wears, so it is resolved the
    // same way the binder resolves it — through this lane's own inputs, never the
    // definition default alone.
    const resolved = resolvePlotColor(plot, inputs, def)
    const decimals = Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS
    const label = chipLabel(def, plot, inputs)

    out.push({
      defId: def.id,
      plotKey: plot.key,
      instanceId: e.instanceId || null,
      label,
      color: resolved,
      decimals,
      value,
      text: `${label} ${value.toFixed(decimals)}`,
    })
  }
  return out
}

/**
 * The legend chips for the series the ENGINE currently holds — a thin caller of
 * `chipsFrom` that maps bindings to entries and resolves inputs per INSTANCE.
 *
 * Its exported signature is unchanged, so every existing caller and case is
 * unaffected by the extraction.
 *
 * @param {object[]} bindings  `binder.bindings()` — each carries `lastValue`
 * @param {Map}      seriesData `crosshairMove` param's `seriesData` map
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list (for per-instance inputs)
 */
export function engineChips(bindings, seriesData, registry, instances) {
  const byId = new Map((Array.isArray(instances) ? instances : [])
    .filter(i => i && typeof i.instanceId === 'string')
    .map(i => [i.instanceId, i]))
  const entries = (Array.isArray(bindings) ? bindings : [])
    .filter(b => b && b.series)
    .map(b => ({ defId: b.defId, plotKey: b.plotKey, series: b.series, lastValue: b.lastValue, instanceId: b.instanceId }))
  // ⛔ PER INSTANCE, NEVER PER DEFINITION. `cs.indicators[defId]` is the LEGACY
  // lane's answer and is simply wrong here: two instances of one definition are
  // two different periods and two different colours on one chart.
  const inputsFor = (_defId, instanceId) => {
    const inst = byId.get(instanceId)
    return (inst && inst.inputs) || null
  }
  return chipsFrom(entries, seriesData, registry, inputsFor)
}
