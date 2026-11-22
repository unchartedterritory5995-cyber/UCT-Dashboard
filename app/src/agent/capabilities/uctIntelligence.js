// ── UCT INTELLIGENCE: the chart INDICATOR's own controls (Charts execution family, 2026-11-12) ────────────────────────────
//
// "UCT Intelligence" here is the chart indicator (components/chart/uctIntelligence.js): ONE row in the Indicators library
// that groups the chart's automatic analysis layers, plus the small panel it shows once added. NOT the indicator AUTHORING
// flow ("Modify with UCT Intelligence", "create an indicator with UCT Intelligence": capabilities/indicatorAuthoring.js).
//
//   uctIntelligence.set  op add     = the library row's add (addUctIntelligence — toggledRow's own branch for this row):
//                                     Auto patterns + Pattern labels on, the other layers as the member last chose them
//                        op remove  = the row's remove / the panel's × (removeUctIntelligence): every layer off, Auto
//                                     patterns included; the sub-choices are KEPT for the next add (the receipt says no more)
//                        op on/off  = one panel toggle (setUctIntelligenceLayer); `autoPatterns` writes `showPatterns`, the
//                                     key the toolbar's Patterns button writes. A sub-layer turned ON on a chart without the
//                                     indicator adds it in the SAME write (one Undo), as a tab does for the Company panel.
//
// ⛔ GATES ARE THE PRODUCT'S, NEVER A COPY: StockChart publishes { available, known, availability } through the chart's
// adapter (ChartPane → ChartWidget agent.uctIntelligence → snap.uctIntel). `available` is the library row being offered
// (the pattern layer exists for this viewer, and not on a Multi Chart cell); `availability` is layerAvailability() itself.
// A gated layer (support & resistance, candlestick patterns, setups, caution) is turned on only while the panel shows its
// switch; a released S/R layer with nothing to draw (its switch quiet) is refused with the panel's own hint. Admin-only
// switches (learned lines, all tiers, key levels) are not here at all. `known` false (the patterns response has not
// answered) never reads as "not released": it says so instead of guessing.
//
// State is the chart's own settings blob (showPatterns + uctIntelligence): ONE settings write through the chart kind
// (chartKind.commit → the widget's onOptsChange), read back by chartKind.landed (the stored blob, exactly), and an exact
// Undo of both keys (chartKind.undoPatch / undoPatchNow). Targeting is the chart kind's (clicked / named / every / except).

import { registerCapability, getCapability } from '../capabilities'
import {
  readUctIntelligence, isUctIntelligenceAdded, addUctIntelligence, removeUctIntelligence, setUctIntelligenceLayer, effectiveLayers,
} from '../../components/chart/uctIntelligence'

export const UCT_INTELLIGENCE_ACTION = 'uctIntelligence.set'
const onCharts = (ctx) => ctx.surface === 'charts'
const OPS = ['add', 'remove', 'on', 'off']
// the panel's switches, in its order, with its labels (UctIntelligencePanel.jsx)
export const UCT_LAYERS = Object.freeze({
  autoPatterns: 'Auto patterns', labels: 'Pattern labels', supportResistance: 'Support & resistance',
  candles: 'Candlestick patterns', setups: 'Setups', caution: 'Caution',
})
const LAYER_IDS = Object.keys(UCT_LAYERS)
const GATED = ['supportResistance', 'candles', 'setups', 'caution']

const NOT_HERE = 'UCT Intelligence isn’t available on that chart here — it belongs to a chart on the Charts board (a Multi Chart cell has no pattern layer).'
const NOT_READY = 'That chart hasn’t finished loading, so I can’t tell what UCT Intelligence offers on it yet. Try again in a moment.'
const NOT_FOR_YOU = 'UCT Intelligence isn’t offered on this chart for your account (the Indicators library doesn’t list it), so I can’t add it or change its layers.'
const ASK = 'Add or remove UCT Intelligence, or which of its layers should I turn on or off — Auto patterns, Pattern labels, Support & resistance, Candlestick patterns, Setups or Caution?'
const plural = (k) => k === 'candles' || k === 'labels'
const isAre = (k) => (plural(k) ? 'are' : 'is')
const itThem = (k) => (plural(k) ? 'them' : 'it')
const notReleased = (k) => `${UCT_LAYERS[k]} ${plural(k) ? 'aren’t' : 'isn’t'} released to your account on this chart, so the UCT Intelligence panel has no switch for ${itThem(k)} — I can’t turn ${itThem(k)} on.`
const SR_EMPTY = 'Support & resistance has no clear levels on this chart (the UCT Intelligence panel shows that switch greyed out), so there is nothing to turn on.'
// gates not known yet (AUDIT #1172): "still loading" ONLY while StockChart reports the patterns request in flight (`loading`); a
// chart WITH the indicator and no request in flight (it never fetched, or the request ended without the gates) says so and how to
// get them — the Patterns button, whose title reads "Patterns: OFF (click to show)"; WITHOUT the indicator, add it first
const unknownGate = (k, added, loading) => (added && loading
  ? `I can’t tell yet whether ${UCT_LAYERS[k]} ${isAre(k)} available on this chart — UCT Intelligence’s pattern data is still loading. Try again in a moment.`
  : added
    ? `I can’t tell yet whether ${UCT_LAYERS[k]} ${isAre(k)} available on this chart — it has no pattern data for UCT Intelligence. Turn on Auto patterns (the chart’s Patterns button) so the chart fetches it, then ask again.`
    : `I can’t tell whether ${UCT_LAYERS[k]} ${isAre(k)} available on this chart until UCT Intelligence is on it (its pattern data loads once it is added). Add UCT Intelligence first, then ask again.`)
// ⛔ the panel's ADMIN section (UctIntelligencePanel `admin`: learned lines, all tiers, key levels) is never a layer of this action —
// refused here by key, not only left out of the manifest's enum
export const ADMIN_LAYERS = Object.freeze(['admin-learned', 'admin-all', 'admin-levels', 'learned', 'learnedLines', 'showLearned', 'allTiers', 'showAll', 'all', 'keyLevels', 'levels', 'showLevels', 'showPatternLevels'])
const ADMIN_REFUSAL = 'That is one of the UCT Intelligence panel’s admin-only switches (learned lines, all tiers, key levels); UCT Agent doesn’t change those.'
const LABELS_NEED_PANEL = 'Pattern labels are switched in the UCT Intelligence panel, which isn’t on this chart. Say “add UCT Intelligence” first.'

const gates = (env) => env?.target?.uctIntel?.availability || {}

// ⛔ "PATTERNS" IS TWO FEATURES ON ONE CHART (AUDIT #1172): the toolbar's Chart IQ button (`showChartIq`, ChartIqToolbarButton,
// "Toggle Chart IQ pattern recognition") and UCT Intelligence's Patterns button (`showPatterns`, PatternToolbarButton, "Toggle chart
// patterns overlay" = Auto patterns). chart.setSetting's fast path reads a bare "patterns" as Chart IQ (its descriptor words). On a
// chart where UCT Intelligence is added or its Patterns button is on, that would be a silent wrong-feature write, so this whole-
// sentence phrase ASKS instead (no op, no model). Anywhere else the fast path is exactly master's.
export const WHICH_PATTERNS = 'Which patterns do you mean — UCT Intelligence’s Auto patterns (the chart’s Patterns button) or Chart IQ pattern recognition? Say “auto patterns” or “Chart IQ”.'
export function bareChartIqPatterns({ lower, host }) {
  if (!/\bpatterns\b/.test(lower || '') || /\b(?:chart ?iq|recognition)\b/.test(lower)) return false
  return getCapability('chart.setSetting')?.fast?.({ raw: lower, lower, core: lower, host })?.setting === 'showChartIq'
}
function patternsAmbiguous({ lower, host }) {
  if (!bareChartIqPatterns({ lower, host })) return false
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  let sel = null
  try { sel = host?.charts?.selected?.() || null } catch { sel = null }
  const scope = sel && charts.some(c => c.ref === sel) ? charts.filter(c => c.ref === sel) : charts
  return scope.some(c => { const u = readUctIntelligence(c.cs); return u.added || u.autoPatterns })
}

/** Why a gated layer may not be turned ON here, or null — the panel's own rule (the switch exists and is not quiet). */
export function layerOnRefusal(uci, layer, added = false) {
  if (!GATED.includes(layer)) return null
  const a = uci?.availability || {}
  if (a[layer] !== true) return uci?.known ? notReleased(layer) : unknownGate(layer, added, uci?.loading === true)
  if (layer === 'supportResistance' && a.supportResistanceEmpty === true) return SR_EMPTY
  return null
}

/** The settings after one op, through the product's own transforms (the SAME object when nothing changes). */
export function uctIntelligenceSettings(cs, { op, layer } = {}, availability = {}) {
  const added = isUctIntelligenceAdded(cs)
  const now = readUctIntelligence(cs)
  if (op === 'add') return added ? cs : addUctIntelligence(cs)
  if (op === 'remove') return added ? removeUctIntelligence(cs) : cs
  const on = op === 'on'
  if (layer === 'autoPatterns') return now.autoPatterns === on ? cs : setUctIntelligenceLayer(cs, 'autoPatterns', on)
  if (!added) {
    if (!on) return cs                                 // not on the chart: none of its sub-layers is showing
    const withIt = addUctIntelligence(cs)
    return readUctIntelligence(withIt)[layer] === true ? withIt : setUctIntelligenceLayer(withIt, layer, true)
  }
  // a gated layer the panel has no switch for is not showing: nothing to turn off (its stored choice is the member's)
  if (!on && GATED.includes(layer) && availability[layer] !== true) return cs
  return now[layer] === on ? cs : setUctIntelligenceLayer(cs, layer, on)
}

const onList = (cs, availability) => {
  const e = effectiveLayers(cs, availability)
  return LAYER_IDS.filter(k => e[k]).map(k => UCT_LAYERS[k])
}
const joinNames = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

function describe(b, a, { op, layer } = {}, env) {
  if (!b?.cs || !a?.cs || b.cs === a.cs) return null
  const av = gates(env)
  const was = readUctIntelligence(b.cs), now = readUctIntelligence(a.cs)
  const showing = onList(a.cs, av)
  if (!was.added && now.added) {
    const extra = op === 'on' && layer && layer !== 'labels' ? ` with ${UCT_LAYERS[layer]} on` : ''
    return `Added UCT Intelligence to this chart${extra} — showing ${joinNames(showing) || 'no layers'}`
  }
  if (was.added && !now.added) return 'Removed UCT Intelligence from this chart — its layers are off (its panel keeps your choices for the next time you add it)'
  if (layer && was[layer] !== now[layer]) return `Turned ${UCT_LAYERS[layer]} ${now[layer] ? 'on' : 'off'} (UCT Intelligence)${layer === 'autoPatterns' ? ' — the chart’s Patterns button shows it too' : ''}`
  return null
}

function noop(st, _a, { op, layer } = {}, env) {
  const s = readUctIntelligence(st.cs)
  if (op === 'add') return 'UCT Intelligence is already on this chart'
  if (op === 'remove') return `UCT Intelligence isn’t on this chart, so there is nothing to remove${s.autoPatterns ? ' (Auto patterns is on from the chart’s Patterns button: say “turn off auto patterns”)' : ''}`
  const name = UCT_LAYERS[layer] || 'That layer'
  if (op === 'off' && layer !== 'autoPatterns' && !s.added) return `UCT Intelligence isn’t on this chart, so ${name} ${plural(layer) ? 'aren’t' : 'isn’t'} showing`
  if (op === 'off' && GATED.includes(layer) && gates(env)[layer] !== true) return `${name} ${isAre(layer)} not available on this chart right now, so ${plural(layer) ? 'they aren’t' : 'it isn’t'} showing`
  return `${name} ${isAre(layer)} already ${op === 'on' ? 'on' : 'off'}`
}

let registered = false
export function registerUctIntelligenceCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    target: 'chart', surfaces: ['charts'], available: onCharts,
    name: UCT_INTELLIGENCE_ACTION,
    summary: 'ONE chart\'s UCT Intelligence INDICATOR (its Indicators library row and panel): add or remove it, or turn one of its layers on or off, as the member\'s own switches do. Layers not released to the member are refused. Undo restores it exactly.',
    hints: 'target = the chart. op add | remove (the indicator), or on | off with layer = autoPatterns (the Patterns button / auto chart patterns) | labels (pattern labels & numbers) | supportResistance | candles (candlestick patterns) | setups | caution. Creating or modifying an indicator WITH UCT Intelligence is indicator authoring, not this. Chart IQ is chart.setSetting.',
    args: { type: 'object', properties: { op: { type: 'string', enum: OPS }, layer: { type: ['string', 'null'], enum: [...LAYER_IDS, null] } }, required: ['op', 'layer'], additionalProperties: false },
    // whole-sentence only: a bare "patterns" toggle on a chart with UCT Intelligence's patterns asks which (WHICH_PATTERNS)
    fastWhole: true,
    fast: (q) => (patternsAmbiguous(q) ? { __say: WHICH_PATTERNS } : null),
    check(st, { op, layer } = {}, env) {
      const t = env?.target || {}
      if (!('uctIntel' in t)) return NOT_HERE
      const uci = t.uctIntel
      if (!uci) return NOT_READY
      if (!uci.available) return NOT_FOR_YOU
      if (!OPS.includes(op)) return ASK
      if (op === 'add' || op === 'remove') return null
      if (ADMIN_LAYERS.includes(layer)) return ADMIN_REFUSAL
      if (!layer || !LAYER_IDS.includes(layer)) return ASK
      const s = readUctIntelligence(st.cs)
      // `added` as the chart IS (the snapshot), never as an earlier op of this plan leaves it: a compound "add it with S/R" on a
      // chart whose gates have not loaded is refused whole, with the add-first wording
      if (op === 'on') return layerOnRefusal(uci, layer, readUctIntelligence(t.cs).added)
      if (layer === 'labels' && !s.added && s.autoPatterns && s.labels) return LABELS_NEED_PANEL
      return null
    },
    apply(st, args = {}, env) {
      const cs = uctIntelligenceSettings(st.cs, args, gates(env))
      return cs === st.cs ? st : { ...st, cs: { ...cs, preset: 'custom' } }
    },
    describe,
    noop,
  })
}
