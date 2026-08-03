// app/src/components/chart/engine/flipState.js
//
// ─── WHICH DEFINITIONS THE ENGINE IS CURRENTLY DRAWING ──────────────────────
//
// READ-ONLY, and deliberately so. Nothing here writes a settings blob or an
// instance: that is Task 9's `instanceControls.js`, and this module must not
// grow into it. What lives here is the one QUESTION two different readers ask —
// StockChart's render pass, and any control that needs to know whether it still
// controls anything.
//
// It exists at all because `ChartToolbar` is the second reader. The toolbar is
// rendered BY `StockChart`, so `StockChart` cannot export the answer to it
// without an import cycle, and a hand-copied second list of migrated ids is
// exactly the defect this branch has already fixed twice (`7b28e5d8`, and the
// legend slot rail in this same fix round). One list, two importers.

import { normalizeInstances } from './instances'

const EMPTY = Object.freeze(new Set())
const EMPTY_INPUTS = Object.freeze(new Map())

/**
 * THE DOUBLE-DRAW RAIL. The definition ids the engine is allowed to draw —
 * exactly those whose legacy block in `StockChart.jsx` carries
 * `&& !engineOwned.has('<id>')`.
 *
 * `engineOwnedDefIds` answers "which legacy blocks stand down", and the binder
 * separately draws whatever instances it is handed. Those are two decisions, and
 * before this they could disagree: an instance of a definition whose legacy block
 * has no guard meant the ENGINE drew it *and* the legacy block drew it, on the
 * same scale, in the same band — a silently double-drawn indicator, which reads
 * as a slightly bolder line and nothing else. The documented B3 obligation was
 * "add one line per migrated indicator", and nothing FAILED if B3 forgot one.
 *
 * Filtering the instance list through this set makes the pairing structural: a
 * definition that is not here is drawn by its legacy block only, exactly as it
 * always has been, and a definition that IS here has a test asserting that its
 * legacy block stands down (`stockChartWiring.test.jsx`). B3's step is now: add
 * the guard AND add the id — and the test fails if only the id lands.
 *
 * ⚠️ EXPORTED FOR THAT TEST, which iterates it, and re-exported by `StockChart`
 * so its importers do not have to move. Keep it a Set of definition ids.
 *
 * ⚠️ ORDER IS NOT FREE FOR A PRICE OVERLAY. The engine draws every series it owns
 * contiguously at ONE call site; legacy interleaves its blocks down
 * `updateChart`. For the five overlays that share the CANDLES' pane and scale —
 * `bb`, `vwap`, `sar`, `ichimoku`, `donchian`, in that order both in the registry
 * and in `StockChart.jsx` — LWC's insertion-order z-stacking makes that
 * difference visible: migrate a LATER one while an EARLIER one is still legacy
 * and the engine's copy is inserted ABOVE an overlay it currently sits below.
 * They must therefore migrate in registry order, which
 * `stockChartWiring.test.jsx` pins ("no price overlay is migrated ahead of an
 * earlier one").
 */
export const ENGINE_MIGRATED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb', 'macd']))

/**
 * The migrated definitions this settings blob hands to the engine.
 *
 * "Hands to the engine", not "paints this frame": a HIDDEN instance is still the
 * engine's, because the legacy block stays stood down for it and re-showing it
 * draws from the instance. A control asking "am I still connected to anything?"
 * wants that answer, not the paint one.
 *
 * Normalised, not read raw — an instance the validator drops (a tombstone, an
 * undeclared input, an unknown definition) owns nothing and is drawn by nobody,
 * so a control that greyed itself out for one would be lying in the other
 * direction. Same rule, same function, as the render pass.
 *
 * @param {object} cs        merged chart settings
 * @param {object} registry  the engine registry (`getDefinition`/`listDefinitions`)
 * @returns {Set<string>} frozen-empty when the engine is off or holds nothing
 */
export function engineDrawnDefIds(cs, registry) {
  const byId = engineDrawnInputs(cs, registry)
  return byId.size ? new Set(byId.keys()) : EMPTY
}

/**
 * …and WHAT each of them is drawing with.
 *
 * The second question the toolbar has to ask. Greying a control out was only
 * half the honesty fix: the greyed box still showed `cs.indicators.rsi.period`,
 * so a user on an `?instances=` chart could read a disabled **14** in the
 * settings panel while the legend printed **RSI(7)** in a colour the panel's
 * swatch did not show. Two numbers for one line, and the tooltip explaining that
 * the field is not the authority sat right next to the value that is not the
 * authority either.
 *
 * Same walk, same normalisation, same migrated-id filter as `engineDrawnDefIds`
 * — derived from this one so the two can never disagree about which definitions
 * the engine holds.
 *
 * **FIRST instance of a definition wins.** More than one instance of the same
 * definition is legal (that is the point of the engine), but a settings row is
 * per-DEFINITION and can only show one. First-in-list is the binder's own draw
 * order, so the row shows the first line the user sees. When B4 gives instances
 * their own rows this function stops being needed; until then it is strictly
 * better than showing a value nothing renders.
 *
 * @returns {Map<string, object>} defId → that instance's normalised `inputs`.
 *          Empty map when the engine is off or holds nothing.
 */
export function engineDrawnInputs(cs, registry) {
  if (!cs || cs.engineEnabled !== true) return EMPTY_INPUTS
  const raw = cs.indicatorInstances
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY_INPUTS
  const out = new Map()
  for (const inst of normalizeInstances(raw, registry).kept) {
    if (!ENGINE_MIGRATED_DEF_IDS.has(inst.defId)) continue
    if (out.has(inst.defId)) continue
    out.set(inst.defId, inst.inputs || {})
  }
  return out.size ? out : EMPTY_INPUTS
}
