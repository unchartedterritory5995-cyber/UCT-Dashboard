// app/src/components/chart/engine/eligibility.js
//
// ─── MAY THIS INSTANCE RENDER HERE, RIGHT NOW — AND WITH WHAT? ──────────────
//
// Everything the definition schema can say is authored ONCE and is true on every
// surface. Four things about VWAP are not:
//
//   1. it does not exist above 60-minute bars (was `VWAP_TFS` in `StockChart.jsx`;
//      that constant is DELETED as of Flip B and this module is the only copy)
//   2. the Model Book intraday popup forces it ON and forces it WHITE
//      (`vwapOverride`, `:1024` / `:3962` / `:6001`)
//   3. its colour is TWO inputs composed at render time — `color` × `opacity`
//      through `_withVwapOpacity` (also DELETED at Flip B). `plots[].opacity` cannot express
//      it: `SUBSTITUTABLE_PLOT_FIELDS` has no `opacity` entry, so `$opacity` has
//      nowhere to land, and B2's fix wave established that wiring `opacity` onto
//      the plot does NOT close this (finding #4) — the plot-level `opacity` DIMS
//      a declared colour, it does not compose a user's two inputs into one.
//   4. an unset width becomes 0.5 on the bold / Model Book look and 1 elsewhere
//      (`:6006-6008`)
//
// None of those is a fact about the INDICATOR; they are facts about the CHART
// that is drawing it. Adding schema for each would be schema serving one native.
// So this module is a pure pre-pass: instances in, instances out, with the
// render context folded into `inputs` — after which the binder, the pool and the
// placement adapter go on knowing nothing about any of it.
//
// ⛔ PURE, AND IT NEVER MUTATES ITS ARGUMENT. It runs inside `updateChart`, and
// the list it is handed is the one `normalizeInstances` produced from the user's
// stored blob. Writing a composed colour back into that would persist a derived
// value as if the user had chosen it.
//
// ⛔ IT MAY ONLY EVER *NARROW*. It can hide an instance and it can fold render
// context into that instance's inputs. It may not ADD an instance: `vwapOverride`
// forcing VWAP on is handled where instances are BUILT (`StockChart`'s
// `engineInstances`), because manufacturing an instance here would give the
// binder something the settings blob never contained and `engineOwnedDefIds`
// never saw.
//
// ⛔ AND IT IS NOT WHERE `lineStyle` LIVES. The user's line style IS expressible
// in the schema — it is a plain per-instance input the plot reads as
// `lineStyle: '$lineStyle'` — so it is declared on the definition, not folded
// here. The rule this file follows is "fold ONLY what the schema cannot say";
// everything folded below is unreachable from `plots[]` and is commented with the
// reason it is.

import { parseColor } from '../../../utils/dividerColor'
import { isVisibleOnTimeframe } from './instanceTimeframe'
import { resolveInstanceFrames } from './calcTimeframeCapability'
import { orderByDependency } from './sourceRef'

/** `VWAP_TFS`, verbatim and in order — from `StockChart.jsx`, which no longer
 *  has it: VWAP is FLIPPED (B3 Task 11) and this is the only copy left.
 *
 *  ⚠️ This is the mirror, not the authority. The gate the hook ENFORCES is
 *  `def.meta.timeframes`, declared on the definition — that is what lets the
 *  Style tab say "intraday only" without a hardcoded list, and what makes the
 *  rule apply to the next session indicator without editing this file.
 *  `eligibility.test.js` asserts the two agree. */
export const VWAP_TIMEFRAMES = Object.freeze(['1', '5', '15', '30', '60'])

/** The width an unset `lineWidth` takes — from the legacy VWAP block, deleted at
 *  Flip B. */
const BOLD_WIDTH = 0.5
const NORMAL_WIDTH = 1

/** `_vwapCfg.color || '#26C6DA'` — the colour a blob that names none draws with. */
const DEFAULT_VWAP_COLOR = '#26C6DA'

/**
 * `_withVwapOpacity`, transcribed from `StockChart.jsx` before Flip B deleted it.
 * This is now the only implementation.
 *
 * 100 returns the base UNTOUCHED — so a user who has never opened the opacity
 * setting sees the exact string the legacy path produced, and Flip A parity does
 * not hinge on `rgba(38, 198, 218, 1)` rendering identically to `#26C6DA`.
 * An unparseable colour falls through unchanged rather than guessing.
 *
 * A non-finite percent also returns the base, which is the legacy `Number.isFinite`
 * ternary read from the other side: an unreadable opacity means "full strength",
 * never "invisible".
 */
function withOpacity(color, opacityPct) {
  const pct = Number(opacityPct)
  if (!Number.isFinite(pct) || pct >= 100) return color
  const rgb = parseColor(color)
  if (!rgb) return color
  const a = Math.max(0, Math.min(1, pct / 100))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
}

/** The per-definition folds. Keyed by defId, because these ARE per-indicator
 *  special cases and pretending otherwise would spread them across the engine. */
const FOLDS = {
  vwap(inst, ctx) {
    const inputs = { ...(inst.inputs || {}) }
    // The override wins on COLOUR ONLY — the user's opacity, style and width all
    // still apply. `StockChart.jsx:5999-6003` calls that out explicitly, and the
    // `||` chain is transcribed rather than paraphrased: an override object with
    // no `color` falls through to the user's, then to the shipped default.
    const base = (ctx.vwapOverride && ctx.vwapOverride.color) || inputs.color || DEFAULT_VWAP_COLOR
    inputs.color = withOpacity(base, inputs.opacity === undefined ? 100 : inputs.opacity)
    // `Number(x) > 0`, not `!= null`: a stored 0 would render an invisible line,
    // so it counts as UNSET and takes the surface's fallback.
    if (!(Number(inputs.lineWidth) > 0)) {
      inputs.lineWidth = (ctx.boldCandles || ctx.modelBookLook) ? BOLD_WIDTH : NORMAL_WIDTH
    }
    return { ...inst, inputs }
  },
}

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/**
 * Split an instance list into what may render here and what may not.
 *
 * @param {object[]} instances normalised instances
 * @param {object|Function} registry
 * @param {{tf?: string, vwapOverride?: {color?: string}|null,
 *          boldCandles?: boolean, modelBookLook?: boolean}} ctx
 * @returns {{kept: object[], hidden: {inst: object, reason: string}[]}}
 *
 * `hidden` carries a REASON so state 8 of the UX contract's instance inventory
 * ("Hidden-on-this-TF — grayed + tooltip, NOT absent") has something to render.
 * Nothing consumes it yet; dropping an instance with no explanation is how "my
 * VWAP disappeared" becomes unanswerable, and this is the one chance to record it.
 *
 * ⚠️ AN ABSENT `ctx.tf` GATES NOTHING. A caller that forgot to thread the
 * timeframe would otherwise look exactly like a daily chart and silently delete
 * every session indicator. Fail-open here, because the CALLER is `updateChart`
 * and it always has a `resolvedTf` — an undefined one is a bug in the caller,
 * and a bug that draws is findable where a bug that hides is not.
 */
export function eligibleInstances(instances, registry, ctx) {
  const get = resolveRegistry(registry)
  const c = ctx || {}
  const kept = []
  const hidden = []

  // ⭐ THE CALCULATION FRAME OF EVERY INSTANCE ON THIS CHART, dependency-ordered so
  // a dependent inherits its source's answer (`resolveInstanceFrames`). Only its
  // GATED verdict is used here; the frame itself is the binder's to act on.
  const list = Array.isArray(instances) ? instances.filter((i) => i && typeof i === 'object') : []
  const frames = c.tf !== undefined && c.tf !== null
    ? resolveInstanceFrames(orderByDependency(list, get).ordered, get, String(c.tf))
    : new Map()

  for (const inst of list) {
    const def = get(inst.defId)
    if (!def) { kept.push(inst); continue }   // ownership rules decide; not our call

    const tfs = def.meta && def.meta.timeframes
    if (Array.isArray(tfs) && tfs.length && c.tf !== undefined && !tfs.includes(String(c.tf))) {
      hidden.push({ inst, reason: 'timeframe' })
      continue
    }

    const fold = FOLDS[def.id]
    let out = fold ? fold(inst, c) : inst
    if (def.meta && Array.isArray(def.meta.appearance)) out = averageLook(out, c)

    // ⭐⭐ HIDDEN HERE ≠ GONE. Visibility (the member's "Show on") and a gated
    // calculation frame (a 1h RSI on a Daily chart) both HIDE rather than DROP:
    // the instance stays in the list as an in-memory `hidden: true` copy, which is
    // exactly the state the whole engine already understands — no series
    // (`planBindings`), no pane unless a VISIBLE guest needs one (`paneLayout`),
    // and still COMPUTED when something visible reads it (`binder`'s
    // `dependedOn`), so `MA(RSI)` shown on a timeframe where RSI is hidden keeps
    // its source. `hiddenBy` is what stops the legend offering it as a greyed
    // "click to show" chip — the member did not hide it, the timeframe did.
    // ⛔ NOTHING IS WRITTEN. This is a copy for this render; the stored instance
    // keeps every setting and draws again the moment the chart allows it.
    if (inst.hidden !== true) {
      if (!isVisibleOnTimeframe(inst, c.tf)) {
        hidden.push({ inst, reason: 'visibility' })
        out = { ...out, hidden: true, hiddenBy: 'visibility' }
      } else {
        const fr = frames.get(inst.instanceId)
        if (fr && fr.gated) {
          hidden.push({ inst, reason: `frame:${fr.gated}` })
          out = { ...out, hidden: true, hiddenBy: 'frame' }
        }
      }
    }
    kept.push(out)
  }

  return { kept, hidden }
}

/**
 * ⭐⭐ THE LOOK A MOVING AVERAGE HAS ALWAYS HAD ON EACH SURFACE — folded here, the
 * same way VWAP's is, because these are facts about the CHART, not the average.
 *
 * `cs.overlays` averages were drawn by a renderer that read four surface props:
 * smooth curves on the bold Model Book look (`/charts` uses it), axis-stretching
 * unless `fitPriceToCandles`, value tags per `showMaLabels` (dropped while the last
 * bar is scrolled off), and the 9-EMA repainted in the candle up-colour while it
 * wears the stock default (`ema9MatchCandle`). Those averages are instances now
 * (`maAdoption.js`), and this is what keeps them drawing exactly as they did — and
 * gives an average added through + Add Indicator the same look.
 *
 * ⛔ ONLY ON PRICE. The overlay renderer only ever drew on the candles; an average
 * of RSI in RSI's pane keeps its pane's placement rules untouched.
 * ⛔ `renderLook` IS IN-MEMORY. `presentation.lineLookPatch` reads it; nothing
 * persists it — this runs on the render copy `updateChart` builds.
 */
function averageLook(inst, c) {
  const onPrice = typeof c.targetOf === 'function' ? c.targetOf(inst) === 'price' : false
  if (!onPrice) return inst
  const look = {
    curved: !!(c.boldCandles || c.modelBookLook),
    autoscale: c.fitPriceToCandles ? 'exclude' : 'default',
  }
  if (typeof c.showMaLabels === 'boolean') look.lastValue = c.showMaLabels && !c.lastBarOff
  let inputs = inst.inputs
  const stock = typeof inputs?.color === 'string' ? inputs.color.toLowerCase() : ''
  if (c.ema9Color && inputs && inputs.maType === 'ema' && Number(inputs.period) === 9
      && (!stock || stock === EMA9_STOCK_COLOR)) {
    inputs = { ...inputs, color: c.ema9Color }
  }
  return { ...inst, inputs, renderLook: look }
}

/** `CHART_DEFAULTS.overlays[0].color` — the 9-EMA's stock colour; only an average
 *  still wearing it takes the candle colour (a member's own pick always wins). */
const EMA9_STOCK_COLOR = '#4ade80'
