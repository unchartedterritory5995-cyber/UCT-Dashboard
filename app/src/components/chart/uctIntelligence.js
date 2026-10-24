// app/src/components/chart/uctIntelligence.js — the "UCT Intelligence" chart indicator: one entry in
// the Indicators library that groups the chart's automatic analysis layers under one switch.
//
// ⭐ ONE SOURCE OF TRUTH PER FACT, ALL IN THE CHART'S OWN SETTINGS BLOB (so a Chart widget persists it
// per widget through `onSettingsPersist`, exactly like every other chart setting):
//   `showPatterns`          — the Auto patterns layer. The SAME key the toolbar's Patterns button has
//                             always written. The button and the panel's toggle are two doors onto it;
//                             there is no second copy to drift.
//   `uctIntelligence.added` — the indicator is on the chart (its panel shows). Absent = never added.
//   `uctIntelligence.labels / .supportResistance / .candles / .setups / .caution` — the sub-layers.
//
// ⭐ A MEMBER WHO NEVER ADDS IT SEES EXACTLY WHAT THEY SAW BEFORE. Every reader here answers an absent
// `uctIntelligence` with today's behaviour: labels ON (the overlay always drew them), nothing else, and
// `showPatterns` keeps meaning what it meant.
//
// ⭐ A GATED LAYER'S TOGGLE EXISTS ONLY WHILE ITS LAYER IS RELEASED (`layerAvailability`). Hidden, never
// a dead switch. Each gate is ONE signal the server owns, so a release lights the toggle with no client
// edit:
//   supportResistance — the patterns payload carries `levels_sr` (the textbook support/resistance layer;
//                       present only while the server releases it to this viewer). A released block with
//                       nothing to draw (`withheld` "too_few_levels" / "out_of_frame" / any other reason, or
//                       empty zones and lines) shows the toggle QUIET: disabled, unchecked, hinted "No clear
//                       levels on this chart" (`supportResistanceEmpty`). The member's stored choice is kept.
//   candles           — the patterns payload carries `candle_marks` (no route serves it today).
//   setups            — the Research Technical tab's release (`research_technical_tab_enabled`): the
//                       confirmed-setup list the panel reads is that tab's list, so it ships with it.
//                       OR the patterns payload carries `setup_draws` (the setup-drawing lines; present
//                       only while the server releases them to this viewer). The toggle drives both; the
//                       list itself still shows only with the Technical tab's release.
//   caution           — the patterns payload carries `setup_draws` (owner decision 7, 2026-10-24). The bearish
//                       setups (server-marked `direction: "bearish"`, auto_structures.CAUTION_SETUP_IDS) are an
//                       opt-in layer, OFF by default: off, they are neither drawn nor listed; on, they draw in an
//                       amber risk style with exit wording (cautionLayer.js). Bullish setups never depend on it.

import { hasLevelsSr } from './patternShapes/srLevelsGeometry'

export const UCT_INTELLIGENCE_ID = 'uctIntelligence'

/** The library row. Not an engine definition and not a settings slice: `builtIn: 'uctIntelligence'`
 *  routes `isRowOn` / `toggledRow` here. Offered only by a host that passes it (the chart, while the
 *  pattern layer is available to this viewer), never part of the shipped catalogue manifest. */
export const UCT_INTELLIGENCE_ROW = Object.freeze({
  id: UCT_INTELLIGENCE_ID,
  builtIn: 'uctIntelligence',
  name: 'UCT Intelligence',
  shortName: 'UCT',
  category: 'UCT Intelligence',
  target: 'price',
  carvedOut: false,
  engineOwned: false,
  userDefined: false,
  description: 'Automatic chart patterns with their buy point and depth, plus the setups confirmed on this chart.',
  tags: Object.freeze(['uct', 'patterns', 'auto', 'setups', 'intelligence', 'support', 'resistance', 'candles', 'base']),
  repaint: null,
  measuredRepaint: null,
  repaintingPlots: Object.freeze([]),
  tier: 'free',
  sessionOnly: false,
  singleton: true,
})

const SUB_KEYS = ['labels', 'supportResistance', 'candles', 'setups', 'caution']

/** The stored block, sanitised: booleans only, unknown keys dropped. null when absent or malformed
 *  (so `mergeChartSettings` can leave the key out entirely). */
export function sanitizeUctIntelligence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  if (typeof raw.added === 'boolean') out.added = raw.added
  for (const k of SUB_KEYS) if (typeof raw[k] === 'boolean') out[k] = raw[k]
  return Object.keys(out).length ? out : null
}

/** Is the indicator on this chart (its panel shown)? */
export function isUctIntelligenceAdded(settings) {
  return settings?.uctIntelligence?.added === true
}

/** Every layer's stored state, with today's defaults for anything never set. */
export function readUctIntelligence(settings) {
  const ui = settings?.uctIntelligence || {}
  return {
    added: ui.added === true,
    autoPatterns: settings?.showPatterns === true,
    labels: ui.labels !== false,
    supportResistance: ui.supportResistance === true,
    candles: ui.candles === true,
    setups: ui.setups === true,
    // OFF by default (decision 7): only an explicit true opts in
    caution: ui.caution === true,
  }
}

/** Add the indicator: Auto patterns and labels ON (the owner's defaults). The other sub-toggles keep
 *  whatever the member last chose. */
export function addUctIntelligence(settings) {
  const prev = settings?.uctIntelligence || {}
  return {
    ...settings,
    showPatterns: true,
    uctIntelligence: { ...prev, added: true, labels: typeof prev.labels === 'boolean' ? prev.labels : true },
  }
}

/** Remove the indicator: every layer off (Auto patterns included); sub-toggle choices are kept for the
 *  next add. */
export function removeUctIntelligence(settings) {
  return {
    ...settings,
    showPatterns: false,
    uctIntelligence: { ...(settings?.uctIntelligence || {}), added: false },
  }
}

/** One layer's toggle. `autoPatterns` writes `showPatterns` (the Patterns button's key); the rest
 *  write their sub-key. Unknown keys return `settings` BY IDENTITY (nothing to persist). */
export function setUctIntelligenceLayer(settings, key, value) {
  const v = value === true
  if (key === 'autoPatterns') return { ...settings, showPatterns: v }
  if (!SUB_KEYS.includes(key)) return settings
  return { ...settings, uctIntelligence: { ...(settings?.uctIntelligence || {}), [key]: v } }
}

/** Which gated layers exist for this viewer right now. `payload` is the patterns response's gate
 *  signals (`levelsSr`, `candleMarks`, `setupDraws`: undefined when the key is absent); `setupsReleased`
 *  the Technical tab's release flag. */
export function layerAvailability({ levelsSr, candleMarks, setupsReleased, setupDraws } = {}) {
  const srReleased = levelsSr !== undefined && levelsSr !== null
  return {
    supportResistance: srReleased,
    // Released, but this chart has nothing to draw (withheld "too_few_levels", "out_of_frame", ...): the toggle
    // shows quiet. ONE rule with the overlay: hasLevelsSr is what PatternOverlay draws from.
    supportResistanceEmpty: srReleased && !hasLevelsSr(levelsSr),
    candles: candleMarks !== undefined && candleMarks !== null,
    setups: setupsReleased === true || Array.isArray(setupDraws),
    caution: Array.isArray(setupDraws),
  }
}

/** What each layer actually does on the chart, after the gates: a stored ON for a layer that is not
 *  released is OFF. */
export function effectiveLayers(settings, availability) {
  const s = readUctIntelligence(settings)
  const a = availability || {}
  return {
    added: s.added,
    autoPatterns: s.autoPatterns,
    labels: s.labels,
    supportResistance: s.added && s.supportResistance && a.supportResistance === true
      && a.supportResistanceEmpty !== true,
    candles: s.added && s.candles && a.candles === true,
    setups: s.added && s.setups && a.setups === true,
    caution: s.added && s.caution && a.caution === true,
  }
}
