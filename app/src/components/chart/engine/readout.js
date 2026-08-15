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
// EVERY USER.** Nine chips ship, and at B4 only three of them (RSI's line and
// MACD's line and signal) belonged to a FLIPPED definition, so only three came
// out of `engineChips`. The other six belonged to definitions that were NOT
// migrated, were drawn by hand-written legacy blocks, and had no bindings at all.
//
// ⭐ B5 TASK 5 MOVED THREE OF THOSE SIX ONTO THE ENGINE — Stochastic's %K and %D,
// and ATR — by MIGRATING their definitions, which is a change of SOURCE and not
// of text: the chips come off the same `plots[].legend` blocks, through this same
// pipeline, character for character.
//
// ⭐⭐ AND B5 TASK 6 MOVED THE LAST THREE — SAR, and Ichimoku's tenkan and kijun.
// **THE LEGACY LANE IS EMPTY, AND ITS MACHINERY IS DELETED**: `StockChart`'s
// `legacyChipEntriesRef`, `registerLegacyChip`, `csIndicatorsRef` and
// `LEGACY_CHIP_ORDER` have no callers and are gone. Every one of the nine chips
// now comes from `engineChips`, and the rendered text did not change by one
// character at either step — which is why the LANE is asserted separately and
// why **no pixel gate could ever have seen any of this** (a headless capture has
// no cursor).
//
// ⚠️ `chipsFrom`'S SECOND-SOURCE SHAPE STAYS, AND IT IS NOT VESTIGIAL. It takes
// an entry LIST and an `inputsFor` resolver rather than reading bindings itself,
// so `engineChips` is one caller of it and the next is Phase C's server lane —
// the same series-source-and-inputs seam, with the values arriving over the wire.
// Deleting the parameter would be deleting the reason the function was extracted.
//
// ⚠️ THE SURVIVORS ARE NAMED IN PROSE, NOT AS `<id>::<plotKey>` PAIRS, AND THE
// REASON HAS CHANGED — 🔴 THIS PARAGRAPH USED TO SAY THE DISCOVERY SCAN "does not
// strip comments", WHICH HAS BEEN FALSE SINCE B4 TASK 10 FIXED IT. It reads
// `stripComments(src)` now (`enumerationSites.test.js` → *"the scan reads CODE,
// not prose"*, whose own fixture is this file's old paragraph), so prose cannot
// flag a module however many ids it names. What survives is the HABIT and its
// reason: a comment that enumerates ids is the shape a reader mistakes for a
// list, and it is the shape the scan was once fooled by — so the words stay
// words. A premise that quietly stopped being true is exactly what this branch
// keeps finding, so it is corrected here rather than left to read as live.
//
// ⛔ AND "MIGRATE THOSE THREE THEN" WAS THE WRONG TURN FOR B4, AND IS THE RIGHT
// ONE FOR B5 — the difference is a decision, not an opinion. B4 shipped ZERO
// migrations because `docs/decisions/2026-08-03-engine-enabled-settings-migration.md`
// was OPEN and a migrated-but-un-flipped definition would have been engine-drawn
// for NOBODY. B5 Task 4 RESOLVED that record by deleting `engineEnabled`, and B5
// migrates and flips in ONE commit, so the intermediate state the objection was
// about is never created. `FLIPPED === MIGRATED` is still asserted both ways.
//
// THE ADJUDICATED DESIGN (A3), and it needed no migration at all: `engineChips`
// already turned *(series, definition, instance inputs)* into *(label, colour,
// decimals, text)*, and only the SERIES SOURCE was engine-specific. So the
// formatting half is extracted into `chipsFrom(entries, …)` and fed a SECOND
// series source — `StockChart`'s `legacyChipEntriesRef`, keyed `<defId>::<plotKey>`
// and registered at the legacy `addSeries` sites that were fated B5. One
// formatting pipeline, two lanes, and all six legacy chips were declared on their
// own definitions' `plots[].legend` instead of hand-written in the legend.
//
// ⭐ WHICH IS WHY B5'S MIGRATIONS COST THE LEGEND NOTHING. A definition that
// gains an engine binding starts producing its chip through `engineChips`, off
// the SAME declaration the legacy lane was already reading — so a flip retired
// its `registerLegacyChip` calls and changed not one character of the readout,
// six times over, until there were none left to retire.
// That is the property, and it is asserted rather than assumed: the nine chips
// are compared character for character at every flip, and the LANE each one comes
// from is a SEPARATE assertion, because a chip drawn twice is invisible in text.

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
 *        The engine lane maps its BINDINGS in (`engineChips` below). ⚠️ It is the
 *        only caller in the tree as of B5 Task 6 — the legacy lane that was the
 *        second one is deleted — and the parameter stays because a second SOURCE
 *        with its own inputs is the seam Phase C's server lane needs. A plot with
 *        NO `legend` block emits nothing, which is how the un-declared plots stay
 *        chip-less — Ichimoku's `spanA`/`spanB`/`chikou`, every `hlines` guide,
 *        `adx`'s two directional lines and Donchian's two edges.
 *        ⚠️ THIS SENTENCE USED TO END *"…and the eight definitions with no chip
 *        at all"*, and the count was WRONG IN BOTH DIRECTIONS IN TURN: it was
 *        TEN when it said eight (`bb`, `vwap`, `mfi`, `cci`, `williamsR`, `adx`,
 *        `obv`, `donchian`, `avwap`, `atrBands`), and Task 2 (`43efeff6`) made it
 *        ZERO — every definition that binds a data plot now declares at least one
 *        chip, a totality gated by `__tests__/legendFromDefinitions.test.jsx`.
 *        The chip-less things left are PLOTS, not definitions, which is why they
 *        are now named rather than counted.
 * @param {Map} seriesData `crosshairMove` param's `seriesData` map.
 * @param {object|Function} registry
 * @param {Function} inputsFor `(defId, instanceId) => inputs`. The INSTANCE's own
 *        inputs for the engine lane; it was `cs.indicators[defId]` for the legacy
 *        lane, which had no instances. ⛔ Reading `cs.indicators[defId]` for BOTH
 *        would have been wrong the moment a second instance of one definition
 *        exists: two RSI lines at different periods would print the same number
 *        twice. That is the reason this is a PARAMETER and not a lookup inside.
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,text}[]} in the
 *        order the entries were given.
 */
export function chipsFrom(entries, seriesData, registry, inputsFor) {
  const get = resolveRegistry(registry)
  const out = []
  // Kept BESIDE the chips rather than on them: a consumer that enumerates a
  // chip's keys must not start seeing a resolved-inputs blob it never had.
  const inputsByChip = new Map()

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
    inputsByChip.set(out.length - 1, inputs)
  }
  return disambiguateSiblings(out, inputsByChip)
}

/**
 * Suffix the chips of a plot that has MORE THAN ONE instance on the chart, so a
 * member can tell their two copies apart.
 *
 * ⚰️ MEASURED ON PRODUCTION 2026-08-14: "+ Add another" on MACD produced four
 * legend chips reading `MACD`, `SIG`, `MACD`, `SIG`, every one titled
 * `MACD — right-click for options`, with nothing on any surface saying which was
 * 12/26/9 and which was 15/26/9. Running one indicator at two settings is the
 * entire point of the feature.
 *
 * ⛔ THE SUFFIX NAMES WHAT ACTUALLY DIFFERS, NOT `meta.legendParams`. MACD
 * declares no `legendParams` on purpose (`nativeRegistry.js:345` — `SIG` is not
 * "MACD", and `shortName` cannot express two labels), so a disambiguator built on
 * that field would do nothing for the definition that surfaced this. Comparing
 * the siblings' resolved inputs works for every definition, user formulas
 * included, and naming only the keys that differ keeps `slow`/`signal` out of the
 * chip when only `fast` was changed.
 *
 * ⛔ AND A LONE CHIP IS RETURNED UNTOUCHED, BYTE FOR BYTE — the suffix appears
 * only when a second instance of the same plot is genuinely on the chart. That is
 * what keeps this out of the existing chart assertions, which are written against
 * single-instance legends.
 */
function disambiguateSiblings(chips, inputsByChip) {
  const groups = new Map()
  for (let i = 0; i < chips.length; i++) {
    const k = `${chips[i].defId}::${chips[i].plotKey}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  }

  for (const idxs of groups.values()) {
    // One chip, or several rows for the SAME instance, is not an ambiguity.
    const distinct = new Set(idxs.map(i => chips[i].instanceId))
    if (idxs.length < 2 || distinct.size < 2) continue

    // ⛔ AND NEITHER IS A DEFINITION THAT ALREADY TELLS THEM APART. RSI declares
    // `legendParams: ['period']`, so two copies already print `RSI(14)` and
    // `RSI(7)`; suffixing those would read `RSI(14) (period 14)`. Only a group
    // whose labels COLLIDE needs help, which is exactly the MACD case — its plots
    // carry explicit `legend.label`s that short-circuit `legendParams` entirely.
    if (new Set(idxs.map(i => chips[i].label)).size === idxs.length) continue

    const inputsFor = idxs.map(i => inputsByChip.get(i) || {})
    const keys = [...new Set(inputsFor.flatMap(o => Object.keys(o)))].sort()
    const differing = keys.filter((k) => {
      const seen = new Set(inputsFor.map(o => JSON.stringify(o[k])))
      return seen.size > 1
    })

    idxs.forEach((chipIdx, n) => {
      const inputs = inputsFor[n]
      // Identical siblings draw on top of each other; an ordinal is thin but it
      // is not a lie, and it beats two chips claiming to be the same thing.
      const suffix = differing.length
        ? ` (${differing.map(k => `${k} ${inputs[k]}`).join(', ')})`
        : ` #${n + 1}`
      const label = `${chips[chipIdx].label}${suffix}`
      chips[chipIdx].label = label
      chips[chipIdx].text = `${label} ${chips[chipIdx].value.toFixed(chips[chipIdx].decimals)}`
    })
  }
  return chips
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

/**
 * The chips the LEGEND renders — one per *(live instance, chip-declaring plot)*.
 *
 * ⭐ IT IS NOT `engineChips`, AND THE DIFFERENCE IS THE HIDDEN INSTANCE.
 * `engineChips` walks BINDINGS, and `pool.planBindings` drops a hidden instance
 * (`pool.js`, the `inst.hidden === true` continue) so the binder can call
 * `removeSeries` and give the pane back (`__tests__/hiddenIsRemovedNotParked.test.js`).
 * That is right for the RENDERER and wrong for the READOUT: with no chip there is
 * no surface to un-hide from, and "Hide" becomes a one-way door reachable only
 * from the settings modal.
 *
 * So this walks the INSTANCE LIST and looks the formatted chip up per instance.
 * A bound, visible instance keeps the chip `engineChips` produced for it — value
 * and all; a hidden one gets `value: null`, `hidden: true` and the label alone.
 *
 * ⛔ ONE FORMATTING PIPELINE, AND THIS DID NOT ADD A SECOND ONE. The valued half
 * is `engineChips(…)` → `chipsFrom(…)`, called, not re-implemented — the same
 * function `IndicatorSettingsDialog`'s read-only Style-tab precision row reads
 * through. The label-only half cannot go through it (a chip with no series and no
 * value is exactly what `chipsFrom` is defined to emit NOTHING for), so it uses
 * the same two module-internal helpers `chipsFrom` uses — `chipLabel` and
 * `resolvePlotColor` — and the same `DEFAULT_DECIMALS`. Nothing here formats a
 * number a second way; a label-only chip formats no number at all.
 *
 * ⚠️ `hidden` IS TESTED BEFORE THE LOOKUP, NOT AFTER. Taking whatever binding
 * happened to be there would make the contract *"a hidden chip carries no value"*
 * an accident of `planBindings` dropping it, one refactor away from a hidden
 * indicator printing a live number it is not drawing.
 *
 * @param {object[]} bindings `binder.bindings()`
 * @param {Map|null} seriesData `crosshairMove`'s map, or null when off-cursor
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list, in stack order
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,hidden,text}[]}
 */
export function legendChips(bindings, seriesData, registry, instances) {
  const get = resolveRegistry(registry)
  const formatted = new Map()
  for (const c of engineChips(bindings, seriesData, registry, instances)) {
    formatted.set(`${c.instanceId}::${c.plotKey}`, c)
  }

  const out = []
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || typeof inst.instanceId !== 'string') continue
    // A tombstone has no defId by design; asking the registry about it would
    // only ever produce a misleading null.
    if (inst.deleted === true) continue
    const def = get(inst.defId)
    if (!def) continue
    const isHidden = inst.hidden === true
    const inputs = (inst.inputs && typeof inst.inputs === 'object') ? inst.inputs : {}

    for (const plot of (def.plots || [])) {
      if (!plot || !plot.legend || plot.legend.hide === true) continue
      const bound = isHidden ? null : formatted.get(`${inst.instanceId}::${plot.key}`)
      if (bound) { out.push({ ...bound, hidden: false }); continue }
      const label = chipLabel(def, plot, inputs)
      out.push({
        defId: def.id,
        plotKey: plot.key,
        instanceId: inst.instanceId,
        label,
        color: resolvePlotColor(plot, inputs, def),
        decimals: Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS,
        value: null,
        hidden: isHidden,
        text: label,
      })
    }
  }
  return out
}
