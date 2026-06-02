// app/src/pages/breadth/views/viewMetricConfig.js
/**
 * Per-view customization registry for the Breadth Views tab.
 * Each style declares: which metrics it can render (eligibleKeys), its curated
 * smart-default visible set (defaultVisible), and its view-specific options
 * schema. Spec: docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md
 */
import { PAIRS } from './breadthViewShared'

export const STYLES = ['treemap', 'rings', 'tug', 'meters', 'timeline', 'radar', 'scoreboard', 'equalizer']

const PAIR_KEYS = new Set(PAIRS.flat())
export const isPairMetric = (key) => PAIR_KEYS.has(key)

const all = (metrics) => metrics
const pairsOnly = (metrics) => metrics.filter(m => isPairMetric(m.key))

// Curated default visible sets (smart per-view defaults).
const HEADLINE = [
  'breadth_score', 'uct_exposure', 'pct_above_50sma', 'pct_above_200sma',
  'up_4pct_today', 'down_4pct_today', 'new_52w_highs', 'new_52w_lows',
  'mcclellan_osc', 'vix',
]
const RADAR_DEFAULT = [
  'breadth_score', 'uct_exposure', 'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma',
  'up_4pct_today', 'down_4pct_today', 'new_52w_highs', 'new_52w_lows', 'mcclellan_osc',
  'stage2_count', 'vix',
]
const TIMELINE_DEFAULT = [
  'breadth_score', 'uct_exposure', 'pct_above_50sma', 'pct_above_200sma',
  'up_4pct_today', 'down_4pct_today', 'new_52w_highs', 'new_52w_lows', 'mcclellan_osc', 'vix',
]
const LEVELS_DEFAULT = [
  'breadth_score', 'uct_exposure', 'pct_above_5sma', 'pct_above_10sma', 'pct_above_20ema',
  'pct_above_40sma', 'pct_above_50sma', 'pct_above_100sma', 'pct_above_200sma',
  'up_4pct_today', 'down_4pct_today', 'new_52w_highs', 'new_52w_lows',
  'mcclellan_osc', 'stage2_count', 'vix',
]
const TUG_DEFAULT = PAIRS.flat()

// Option schemas: ordered list of { name, label, type:'select', choices:[{value,label}], default }.
const RADAR_OPTIONS = [
  { name: 'maxSpokes', label: 'Max spokes', type: 'select', default: 14,
    choices: [8, 10, 12, 14].map(v => ({ value: v, label: String(v) })) },
  { name: 'spokeSelect', label: 'Spoke pick', type: 'select', default: 'auto',
    choices: [{ value: 'auto', label: 'Auto (most-defining)' }, { value: 'listed', label: 'As listed' }] },
]
const SCOREBOARD_OPTIONS = [
  { name: 'sort', label: 'Sort', type: 'select', default: 'group',
    choices: [{ value: 'group', label: 'Group order' }, { value: 'value', label: 'Value high→low' }, { value: 'bull', label: 'Bullishness' }] },
  { name: 'density', label: 'Density', type: 'select', default: 'comfortable',
    choices: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] },
  { name: 'sparkWindow', label: 'Sparkline window', type: 'select', default: 20,
    choices: [10, 20, 30].map(v => ({ value: v, label: `${v} days` })) },
]
const LEVELS_OPTIONS = [
  { name: 'sort', label: 'Sort', type: 'select', default: 'board',
    choices: [{ value: 'board', label: 'Board order' }, { value: 'value', label: 'Value' }, { value: 'tier', label: 'Tier' }] },
]
const METERS_OPTIONS = [
  { name: 'sort', label: 'Sort', type: 'select', default: 'group',
    choices: [{ value: 'group', label: 'Group order' }, { value: 'value', label: 'Value' }] },
]
const TIMELINE_OPTIONS = [
  { name: 'windowDays', label: 'Window', type: 'select', default: 20,
    choices: [10, 20, 30].map(v => ({ value: v, label: `${v} days` })) },
]

const THEME_OPTIONS = [
  { name: 'palette', label: 'Color palette', type: 'select', default: 'classic',
    choices: [
      { value: 'classic', label: 'Classic (green/red)' },
      { value: 'colorblind', label: 'Colorblind (blue/orange)' },
      { value: 'mono', label: 'Mono (gold)' },
      { value: 'ocean', label: 'Ocean (cyan/rose)' },
    ] },
  { name: 'intensity', label: 'Intensity', type: 'select', default: 'normal',
    choices: [{ value: 'subtle', label: 'Subtle' }, { value: 'normal', label: 'Normal' }, { value: 'bold', label: 'Bold' }] },
]
const TREEMAP_OPTIONS = [
  { name: 'weightBy', label: 'Size tiles by', type: 'select', default: 'curated',
    choices: [{ value: 'curated', label: 'Curated' }, { value: 'equal', label: 'Equal' }, { value: 'extremity', label: 'Extremity' }] },
]

export const VIEW_CONFIG = {
  treemap:    { label: 'Treemap',    eligibleKeys: all,       defaultVisible: [], options: TREEMAP_OPTIONS },
  rings:      { label: 'Rings',      eligibleKeys: all,       defaultVisible: HEADLINE, options: THEME_OPTIONS },
  tug:        { label: 'Tug',        eligibleKeys: pairsOnly, defaultVisible: TUG_DEFAULT, options: THEME_OPTIONS },
  meters:     { label: 'Meters',     eligibleKeys: all,       defaultVisible: HEADLINE, options: [...METERS_OPTIONS, ...THEME_OPTIONS] },
  timeline:   { label: 'Timeline',   eligibleKeys: all,       defaultVisible: TIMELINE_DEFAULT, options: [...TIMELINE_OPTIONS, ...THEME_OPTIONS] },
  radar:      { label: 'Radar',      eligibleKeys: all,       defaultVisible: RADAR_DEFAULT, options: [...RADAR_OPTIONS, ...THEME_OPTIONS] },
  scoreboard: { label: 'Scoreboard', eligibleKeys: all,       defaultVisible: [], options: [...SCOREBOARD_OPTIONS, ...THEME_OPTIONS] },
  equalizer:  { label: 'Levels',     eligibleKeys: all,       defaultVisible: LEVELS_DEFAULT, options: [...LEVELS_OPTIONS, ...THEME_OPTIONS] },
}

// `defaultVisible: []` means "the full eligible board" (Treemap, Scoreboard).
export function resolveDefaultVisible(style, allMetrics) {
  const cfg = VIEW_CONFIG[style] ?? VIEW_CONFIG.treemap
  const eligibleKeys = new Set(cfg.eligibleKeys(allMetrics).map(m => m.key))
  if (!cfg.defaultVisible.length) return eligibleKeys
  return new Set(cfg.defaultVisible.filter(k => eligibleKeys.has(k)))
}

export function optionsSchema(style) {
  return VIEW_CONFIG[style]?.options ?? []
}

export function optionDefaults(style) {
  const out = {}
  for (const opt of optionsSchema(style)) out[opt.name] = opt.default
  return out
}
