# Breadth Views Per-View Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each of the 8 Breadth Views styles independently customizable — its own metric selection, named presets, smart defaults, and view-specific options — surfaced through a view-scoped Customize panel and a quick preset switcher on the bar.

**Architecture:** A per-view registry (`viewMetricConfig.js`) defines each style's eligible metrics, curated default set, and options schema. `useBreadthViews` is rewritten to a v2 storage model keyed by view (`byView[style] = { activePreset, presets: { [name]: { visible[], options{} } } }`), resolving the active view's visible-key Set and options object. A new view-scoped panel and a bar dropdown drive it. Views gain optional knobs (Radar spoke cap, Scoreboard/Levels/Meters sort, Timeline window, Scoreboard density/sparkline window).

**Tech Stack:** React (Vite SPA, no TypeScript), Vitest + @testing-library/react, CSS modules, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md`

---

## File Structure

**New files**
- `app/src/pages/breadth/views/viewMetricConfig.js` — per-view registry + option schemas + `isPairMetric`.
- `app/src/pages/breadth/views/viewMetricConfig.test.js` — registry invariants.
- `app/src/pages/breadth/BreadthViewsCustomizePanel.jsx` — view-scoped Customize panel.
- `app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx` — panel behavior.
- `app/src/pages/breadth/QuickPresetSwitcher.jsx` — compact bar preset dropdown.
- `app/src/pages/breadth/QuickPresetSwitcher.test.jsx` — switcher behavior.

**Modified files**
- `app/src/pages/breadth/useBreadthViews.js` — v2 per-view model + migration.
- `app/src/pages/breadth/useBreadthViews.test.js` — rewritten for v2 API.
- `app/src/pages/breadth/BreadthViews.jsx` — wire switcher + panel + resolved options + 30-bar window.
- `app/src/pages/breadth/views/breadthViewShared.js` — add `sortVisibleMetrics` helper.
- `app/src/pages/breadth/views/RadarView.jsx` — consume `options.maxSpokes` / `spokeSelect`.
- `app/src/pages/breadth/views/ScoreboardView.jsx` — consume `options.sort/density/sparkWindow`.
- `app/src/pages/breadth/views/EqualizerView.jsx` — consume `options.sort`.
- `app/src/pages/breadth/views/MetersView.jsx` — consume `options.sort`.
- `app/src/pages/breadth/views/TimelineView.jsx` — consume `options.windowDays`.

**Reference (do not modify):** `app/src/pages/breadth/CustomizePanel.jsx`, `useBreadthCustomize.js` (Monitor sheet keeps its model), `BreadthViewSwitcher.jsx`, `app/src/pages/Breadth.jsx` (exports `HM_METRICS`, `PCTILE_KEYS`, `FFILL_KEYS`).

**Metric object shape (from `HM_METRICS` in `Breadth.jsx`):** `{ key, label, group, getFmt(row), getTier(row), drillKey?, polarity: 'bull'|'bear', pair?: {side,partnerKey}, isHeader?, type? }`. The pair key universe is the flattened `PAIRS` array in `breadthViewShared.js`.

---

## Task 1: Per-view metric registry (`viewMetricConfig.js`)

**Files:**
- Create: `app/src/pages/breadth/views/viewMetricConfig.js`
- Test: `app/src/pages/breadth/views/viewMetricConfig.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/breadth/views/viewMetricConfig.test.js
import { describe, it, expect } from 'vitest'
import {
  VIEW_CONFIG, STYLES, isPairMetric, resolveDefaultVisible, optionDefaults,
} from './viewMetricConfig'
import { PAIRS } from './breadthViewShared'

// Minimal stand-in metric universe covering keys the configs reference.
const ALL = [
  'breadth_score','uct_exposure','up_4pct_today','down_4pct_today','up_25pct_quarter',
  'down_25pct_quarter','up_50pct_month','down_50pct_month','magna_up','magna_down',
  'stage2_count','stage4_count','new_52w_highs','new_52w_lows','new_20d_highs','new_20d_lows',
  'pct_above_5sma','pct_above_10sma','pct_above_20ema','pct_above_40sma','pct_above_50sma',
  'pct_above_100sma','pct_above_200sma','sp500_close','qqq_close','vix','mcclellan_osc',
  'cnn_fear_greed','spy_ma_stack','qqq_ma_stack','new_ath','hvc_52w','ratio_5day','ratio_10day',
].map(k => ({ key: k, label: k, group: 'G', polarity: 'bull' }))

describe('viewMetricConfig', () => {
  it('defines a config for every style', () => {
    for (const s of STYLES) {
      expect(VIEW_CONFIG[s], `missing config for ${s}`).toBeTruthy()
      expect(typeof VIEW_CONFIG[s].label).toBe('string')
      expect(typeof VIEW_CONFIG[s].eligibleKeys).toBe('function')
      expect(Array.isArray(VIEW_CONFIG[s].defaultVisible)).toBe(true)
    }
  })

  it('every defaultVisible key is eligible for that view', () => {
    for (const s of STYLES) {
      const eligible = new Set(VIEW_CONFIG[s].eligibleKeys(ALL).map(m => m.key))
      for (const k of VIEW_CONFIG[s].defaultVisible) {
        expect(eligible.has(k), `${s} default ${k} not eligible`).toBe(true)
      }
    }
  })

  it('tug eligibility and default are limited to pair metrics', () => {
    const pairKeys = new Set(PAIRS.flat())
    const eligible = VIEW_CONFIG.tug.eligibleKeys(ALL).map(m => m.key)
    expect(eligible.every(k => pairKeys.has(k))).toBe(true)
    expect(VIEW_CONFIG.tug.defaultVisible.every(k => pairKeys.has(k))).toBe(true)
  })

  it('isPairMetric matches the PAIRS universe', () => {
    expect(isPairMetric('up_4pct_today')).toBe(true)
    expect(isPairMetric('vix')).toBe(false)
  })

  it('resolveDefaultVisible returns eligible default keys present in the universe', () => {
    const set = resolveDefaultVisible('radar', ALL)
    expect(set instanceof Set).toBe(true)
    expect(set.size).toBeGreaterThan(2)
  })

  it('optionDefaults merges schema defaults', () => {
    expect(optionDefaults('radar')).toEqual({ maxSpokes: 14, spokeSelect: 'auto' })
    expect(optionDefaults('treemap')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/viewMetricConfig.test.js`
Expected: FAIL — `Cannot find module './viewMetricConfig'`.

- [ ] **Step 3: Write the implementation**

```js
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

export const VIEW_CONFIG = {
  treemap:    { label: 'Treemap',    eligibleKeys: all,       defaultVisible: [], options: [] },
  rings:      { label: 'Rings',      eligibleKeys: all,       defaultVisible: HEADLINE, options: [] },
  tug:        { label: 'Tug',        eligibleKeys: pairsOnly, defaultVisible: TUG_DEFAULT, options: [] },
  meters:     { label: 'Meters',     eligibleKeys: all,       defaultVisible: HEADLINE, options: METERS_OPTIONS },
  timeline:   { label: 'Timeline',   eligibleKeys: all,       defaultVisible: TIMELINE_DEFAULT, options: TIMELINE_OPTIONS },
  radar:      { label: 'Radar',      eligibleKeys: all,       defaultVisible: RADAR_DEFAULT, options: RADAR_OPTIONS },
  scoreboard: { label: 'Scoreboard', eligibleKeys: all,       defaultVisible: [], options: SCOREBOARD_OPTIONS },
  equalizer:  { label: 'Levels',     eligibleKeys: all,       defaultVisible: LEVELS_DEFAULT, options: LEVELS_OPTIONS },
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/viewMetricConfig.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewMetricConfig.test.js
git commit -m "feat(breadth): per-view metric registry + option schemas"
```

---

## Task 2: Rewrite `useBreadthViews` to v2 per-view model

**Files:**
- Modify: `app/src/pages/breadth/useBreadthViews.js` (full rewrite)
- Modify: `app/src/pages/breadth/useBreadthViews.test.js` (full rewrite)

The hook now needs the metric universe to resolve Default visible sets and the
eligible intersection. `BreadthViews.jsx` will pass `allMetrics`.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/breadth/useBreadthViews.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthViews, { STORAGE_KEY, DEFAULT_PRESET, DEFAULT_STYLE, STYLES } from './useBreadthViews'

const ALL = [
  'breadth_score','uct_exposure','up_4pct_today','down_4pct_today','pct_above_50sma',
  'pct_above_200sma','new_52w_highs','new_52w_lows','mcclellan_osc','stage2_count',
  'pct_above_20ema','vix',
].map(k => ({ key: k, label: k, group: 'G', polarity: 'bull' }))

const render = () => renderHook(() => useBreadthViews(ALL))

beforeEach(() => localStorage.clear())

describe('useBreadthViews v2', () => {
  it('starts on Default with the default style and a non-empty resolved visible set', () => {
    const { result } = render()
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    expect(result.current.isDefaultActive).toBe(true)
    expect(result.current.visibleKeys.size).toBeGreaterThan(0)
  })

  it('exposes per-view storage key v2', () => {
    expect(STORAGE_KEY).toBe('uct.breadth.views.v2')
  })

  it('setViewStyle switches the active style and its Default resolves independently', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.viewStyle).toBe('radar')
    const radarDefault = new Set(result.current.visibleKeys)
    act(() => result.current.setViewStyle('tug'))
    // tug default is pairs-only; radar default includes non-pair keys → different sets
    expect(result.current.visibleKeys).not.toEqual(radarDefault)
  })

  it('savePreset on a view captures resolved visible + options and is per-view', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    act(() => result.current.savePreset('Tight'))
    expect(result.current.activePreset).toBe('Tight')
    // toggle a metric off in the saved preset
    const someKey = [...result.current.visibleKeys][0]
    act(() => result.current.toggleVisible(someKey))
    expect(result.current.visibleKeys.has(someKey)).toBe(false)
    // switching views does not carry the radar preset over
    act(() => result.current.setViewStyle('scoreboard'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.activePreset).toBe('Tight')
    expect(result.current.visibleKeys.has(someKey)).toBe(false)
  })

  it('toggleVisible / setOption are no-ops on Default (immutable)', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    const before = new Set(result.current.visibleKeys)
    act(() => result.current.toggleVisible([...before][0]))
    expect(result.current.visibleKeys).toEqual(before)
    act(() => result.current.setOption('maxSpokes', 8))
    expect(result.current.options.maxSpokes).toBe(14)
  })

  it('options resolve schema defaults then preset overrides', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    expect(result.current.options).toEqual({ maxSpokes: 14, spokeSelect: 'auto' })
    act(() => result.current.savePreset('Eight'))
    act(() => result.current.setOption('maxSpokes', 8))
    expect(result.current.options.maxSpokes).toBe(8)
    expect(result.current.options.spokeSelect).toBe('auto')
  })

  it('resetActive restores the view default visible + default options', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('radar'))
    act(() => result.current.savePreset('Edited'))
    const k = [...result.current.visibleKeys][0]
    act(() => result.current.toggleVisible(k))
    act(() => result.current.setOption('maxSpokes', 8))
    act(() => result.current.resetActive())
    expect(result.current.visibleKeys.has(k)).toBe(true)
    expect(result.current.options.maxSpokes).toBe(14)
  })

  it('rename and delete are scoped to the active view', () => {
    const { result } = render()
    act(() => result.current.setViewStyle('meters'))
    act(() => result.current.savePreset('A'))
    act(() => result.current.renamePreset('A', 'B'))
    expect(result.current.presetNames).toContain('B')
    expect(result.current.presetNames).not.toContain('A')
    act(() => result.current.deletePreset('B'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('persists across remount', () => {
    const first = render()
    act(() => first.result.current.setViewStyle('radar'))
    act(() => first.result.current.savePreset('Persisted'))
    first.unmount()
    const second = render()
    expect(second.result.current.viewStyle).toBe('radar')
    expect(second.result.current.activePreset).toBe('Persisted')
  })

  it('migrates a v1 blob into per-view presets', () => {
    localStorage.setItem('uct.breadth.views.v1', JSON.stringify({
      activePreset: 'Old', viewStyle: 'radar',
      presets: { Old: { viewStyle: 'radar', hidden: ['vix'] } },
    }))
    const { result } = render()
    expect(result.current.viewStyle).toBe('radar')
    act(() => result.current.switchPreset('Old'))
    expect(result.current.activePreset).toBe('Old')
    // migrated preset = all eligible minus hidden 'vix'
    expect(result.current.visibleKeys.has('vix')).toBe(false)
    expect(result.current.visibleKeys.has('breadth_score')).toBe(true)
  })

  it('falls back to clean state on a corrupt blob', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = render()
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(STYLES.length).toBe(8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: FAIL — `STORAGE_KEY` is still `v1`; hook signature/API mismatch.

- [ ] **Step 3: Write the implementation**

```js
// app/src/pages/breadth/useBreadthViews.js
/**
 * Breadth Views customization — v2 per-view model. Each style keeps its own
 * active preset + named presets; each preset stores an explicit `visible` key
 * list and a view-specific `options` object. "Default" is implicit per view
 * (resolved from viewMetricConfig). Migrates the v1 global-hidden blob forward.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STYLES, VIEW_CONFIG, resolveDefaultVisible, optionDefaults,
} from './views/viewMetricConfig'

export const STORAGE_KEY = 'uct.breadth.views.v2'
export const V1_KEY = 'uct.breadth.views.v1'
export const DEFAULT_PRESET = 'Default'
export const DEFAULT_STYLE = 'treemap'
export const NAME_MAX = 40
export { STYLES }

const isStyle = (s) => STYLES.includes(s)
const emptyByView = () => Object.fromEntries(STYLES.map(s => [s, { activePreset: DEFAULT_PRESET, presets: {} }]))
const emptyState = () => ({ viewStyle: DEFAULT_STYLE, byView: emptyByView() })

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (trimmed === DEFAULT_PRESET) return `"${DEFAULT_PRESET}" is reserved.`
  if (existingNames.includes(trimmed)) return 'A preset with that name already exists.'
  return null
}

// A preset is either materialized (`{ visible, options }`) or migrated-from-v1
// (`{ hidden, options }`, resolved against the eligible set at read time). The
// dual shape survives write→reload because both fields are preserved here.
function sanitizeByView(raw) {
  const out = emptyByView()
  if (!raw || typeof raw !== 'object') return out
  for (const s of STYLES) {
    const v = raw[s]
    if (!v || typeof v !== 'object') continue
    const presets = {}
    if (v.presets && typeof v.presets === 'object') {
      for (const [name, p] of Object.entries(v.presets)) {
        if (name === DEFAULT_PRESET || !p || typeof p !== 'object') continue
        const out2 = { options: (p.options && typeof p.options === 'object') ? { ...p.options } : {} }
        if (Array.isArray(p.visible)) out2.visible = p.visible.filter(k => typeof k === 'string')
        if (Array.isArray(p.hidden)) out2.hidden = p.hidden.filter(k => typeof k === 'string')
        if (!out2.visible && !out2.hidden) out2.visible = []
        presets[name] = out2
      }
    }
    const active = typeof v.activePreset === 'string' && (v.activePreset === DEFAULT_PRESET || presets[v.activePreset])
      ? v.activePreset : DEFAULT_PRESET
    out[s] = { activePreset: active, presets }
  }
  return out
}

function migrateV1() {
  try {
    const raw = localStorage.getItem(V1_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const byView = emptyByView()
    const viewStyle = isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE
    if (parsed?.presets && typeof parsed.presets === 'object') {
      for (const [name, p] of Object.entries(parsed.presets)) {
        if (name === DEFAULT_PRESET || !p) continue
        const vs = isStyle(p.viewStyle) ? p.viewStyle : DEFAULT_STYLE
        const hidden = Array.isArray(p.hidden) ? p.hidden.filter(k => typeof k === 'string') : []
        // Stored as a `hidden` preset; the eligible-set intersection is applied
        // at read time (so the metric universe need not be known at load).
        byView[vs].presets[name] = { hidden, options: {} }
      }
    }
    return { viewStyle, byView }
  } catch {
    return null
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const viewStyle = isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE
      return { viewStyle, byView: sanitizeByView(parsed?.byView) }
    }
    const migrated = migrateV1()
    if (migrated) return migrated
    return emptyState()
  } catch {
    return emptyState()
  }
}

function writeToStorage(state) {
  try {
    const byView = {}
    for (const s of STYLES) {
      const v = state.byView[s]
      const presets = {}
      for (const [name, p] of Object.entries(v.presets)) {
        const out = { options: p.options ?? {} }
        if (p.visible) out.visible = p.visible           // materialized preset
        else if (p.hidden) out.hidden = p.hidden          // migrated, not yet edited
        else out.visible = []
        presets[name] = out
      }
      byView[s] = { activePreset: v.activePreset, presets }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewStyle: state.viewStyle, byView }))
  } catch { /* best-effort */ }
}

export default function useBreadthViews(allMetrics = []) {
  const [state, setState] = useState(() => loadFromStorage())

  const stateRef = useRef(state)
  const writeTimer = useRef(null)
  useEffect(() => {
    stateRef.current = state
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => writeToStorage(stateRef.current), 150)
  }, [state])
  useEffect(() => () => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeToStorage(stateRef.current)
  }, [])

  const viewStyle = state.viewStyle
  const view = state.byView[viewStyle] ?? { activePreset: DEFAULT_PRESET, presets: {} }
  const activePreset = view.activePreset
  const isDefaultActive = activePreset === DEFAULT_PRESET

  const defaultVisible = useMemo(() => resolveDefaultVisible(viewStyle, allMetrics), [viewStyle, allMetrics])

  // Resolve the active preset's visible set. Migrated presets carry `hidden`
  // (eligible minus hidden); materialized presets carry an explicit `visible`.
  const visibleKeys = useMemo(() => {
    if (isDefaultActive) return defaultVisible
    const preset = view.presets[activePreset]
    if (!preset) return defaultVisible
    const eligible = new Set(VIEW_CONFIG[viewStyle].eligibleKeys(allMetrics).map(m => m.key))
    if (preset.visible) return new Set(preset.visible.filter(k => eligible.has(k)))
    const hidden = new Set(preset.hidden ?? [])
    return new Set([...eligible].filter(k => !hidden.has(k)))
  }, [isDefaultActive, view, activePreset, viewStyle, allMetrics, defaultVisible])

  const options = useMemo(() => {
    const base = optionDefaults(viewStyle)
    if (isDefaultActive) return base
    return { ...base, ...(view.presets[activePreset]?.options ?? {}) }
  }, [viewStyle, isDefaultActive, view, activePreset])

  const presetNames = useMemo(
    () => [DEFAULT_PRESET, ...Object.keys(view.presets).sort((a, b) => a.localeCompare(b))],
    [view.presets],
  )

  const eligibleMetrics = useCallback(
    () => VIEW_CONFIG[viewStyle].eligibleKeys(allMetrics).filter(m => !m.isHeader),
    [viewStyle, allMetrics],
  )

  // --- mutators (all operate on the ACTIVE view) ---
  const patchView = (prev, fn) => ({
    ...prev,
    byView: { ...prev.byView, [prev.viewStyle]: fn(prev.byView[prev.viewStyle]) },
  })

  const setViewStyle = useCallback((style) => {
    if (!isStyle(style)) return
    setState(prev => ({ ...prev, viewStyle: style }))
  }, [])

  // Resolve a preset's current visible array (used when an edit materializes a
  // migrated `hidden` preset into an explicit `visible` one). Editing Default is
  // blocked by the callers, so this only runs for custom presets.
  const materializeActive = (prev) => {
    const v = prev.byView[prev.viewStyle]
    // Saving / editing from Default starts from the view's curated default set,
    // not the full eligible board.
    if (v.activePreset === DEFAULT_PRESET) return [...resolveDefaultVisible(prev.viewStyle, allMetrics)]
    const eligible = new Set(VIEW_CONFIG[prev.viewStyle].eligibleKeys(allMetrics).map(m => m.key))
    const p = v.presets[v.activePreset]
    if (!p) return [...eligible]
    if (p.visible) return p.visible.filter(k => eligible.has(k))
    const hidden = new Set(p.hidden ?? [])
    return [...eligible].filter(k => !hidden.has(k))
  }

  const toggleVisible = useCallback((key) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev  // immutable
      return patchView(prev, (vv) => {
        const cur = new Set(materializeActive(prev))
        cur.has(key) ? cur.delete(key) : cur.add(key)
        const p = vv.presets[vv.activePreset]
        return {
          ...vv,
          presets: { ...vv.presets, [vv.activePreset]: { visible: [...cur], options: p.options ?? {} } },
        }
      })
    })
  }, [allMetrics])

  const setOption = useCallback((name, value) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev
      return patchView(prev, (vv) => {
        const p = vv.presets[vv.activePreset]
        return {
          ...vv,
          presets: { ...vv.presets, [vv.activePreset]: { visible: materializeActive(prev), options: { ...(p.options ?? {}), [name]: value } } },
        }
      })
    })
  }, [allMetrics])

  const savePreset = useCallback((name) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (validatePresetName(trimmed, Object.keys(v.presets))) return prev
      const visible = materializeActive(prev)
      const options = v.activePreset === DEFAULT_PRESET ? {} : { ...(v.presets[v.activePreset]?.options ?? {}) }
      return patchView(prev, (vv) => ({
        activePreset: trimmed,
        presets: { ...vv.presets, [trimmed]: { visible, options } },
      }))
    })
  }, [allMetrics])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (!v.presets[oldName]) return prev
      if (validatePresetName(trimmed, Object.keys(v.presets).filter(n => n !== oldName))) return prev
      return patchView(prev, (vv) => {
        const next = { ...vv.presets }
        next[trimmed] = next[oldName]; delete next[oldName]
        return { activePreset: vv.activePreset === oldName ? trimmed : vv.activePreset, presets: next }
      })
    })
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (!v.presets[name]) return prev
      return patchView(prev, (vv) => {
        const next = { ...vv.presets }; delete next[name]
        return { activePreset: vv.activePreset === name ? DEFAULT_PRESET : vv.activePreset, presets: next }
      })
    })
  }, [])

  const switchPreset = useCallback((name) => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (name !== DEFAULT_PRESET && !v.presets[name]) return prev
      return patchView(prev, (vv) => ({ ...vv, activePreset: name }))
    })
  }, [])

  const resetActive = useCallback(() => {
    setState(prev => {
      const v = prev.byView[prev.viewStyle]
      if (v.activePreset === DEFAULT_PRESET) return prev
      const visible = [...resolveDefaultVisible(prev.viewStyle, allMetrics)]
      return patchView(prev, (vv) => ({
        ...vv,
        presets: { ...vv.presets, [vv.activePreset]: { visible, options: {} } },
      }))
    })
  }, [allMetrics])

  return {
    viewStyle, activePreset, isDefaultActive, visibleKeys, options, presetNames,
    eligibleMetrics, setViewStyle, toggleVisible, setOption, savePreset,
    renamePreset, deletePreset, switchPreset, resetActive,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: PASS (all v2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/useBreadthViews.js app/src/pages/breadth/useBreadthViews.test.js
git commit -m "feat(breadth): useBreadthViews v2 per-view presets + options + v1 migration"
```

---

## Task 3: View-scoped Customize panel

**Files:**
- Create: `app/src/pages/breadth/BreadthViewsCustomizePanel.jsx`
- Test: `app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`
- Reference (reuse classes, do not modify): `app/src/pages/breadth/CustomizePanel.module.css`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'

const metrics = [
  { key: 'breadth_score', label: 'Health', group: 'Score' },
  { key: 'vix', label: 'VIX', group: 'Regime' },
]
const optionsSchema = [
  { name: 'maxSpokes', label: 'Max spokes', type: 'select', default: 14,
    choices: [{ value: 8, label: '8' }, { value: 14, label: '14' }] },
]

function setup(over = {}) {
  const props = {
    viewLabel: 'Radar',
    metrics,
    optionsSchema,
    options: { maxSpokes: 14 },
    activePreset: 'Default',
    visibleKeys: new Set(['breadth_score', 'vix']),
    presetNames: ['Default'],
    isDefaultActive: true,
    onToggleVisible: vi.fn(),
    onSetOption: vi.fn(),
    onSavePreset: vi.fn(),
    onRenamePreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onSwitchPreset: vi.fn(),
    onResetActive: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<BreadthViewsCustomizePanel {...props} />)
  return props
}

describe('BreadthViewsCustomizePanel', () => {
  it('shows the view label in the header', () => {
    setup()
    expect(screen.getByText('Customize Radar')).toBeTruthy()
  })

  it('renders an option control from the schema', () => {
    setup()
    expect(screen.getByLabelText('Max spokes')).toBeTruthy()
  })

  it('editing a metric on Default prompts a Save-as instead of toggling', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Health'))
    expect(props.onToggleVisible).not.toHaveBeenCalled()
    expect(screen.getByText(/Save changes as a new preset/i)).toBeTruthy()
  })

  it('toggles directly when a custom preset is active', () => {
    const props = setup({ isDefaultActive: false, activePreset: 'Mine', presetNames: ['Default', 'Mine'] })
    fireEvent.click(screen.getByLabelText('Health'))
    expect(props.onToggleVisible).toHaveBeenCalledWith('breadth_score')
  })

  it('changing an option on a custom preset calls onSetOption', () => {
    const props = setup({ isDefaultActive: false, activePreset: 'Mine', presetNames: ['Default', 'Mine'] })
    fireEvent.change(screen.getByLabelText('Max spokes'), { target: { value: '8' } })
    expect(props.onSetOption).toHaveBeenCalledWith('maxSpokes', 8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```jsx
// app/src/pages/breadth/BreadthViewsCustomizePanel.jsx
/**
 * View-scoped Customize panel for the Breadth Views tab. Always reflects the
 * ACTIVE view: its presets, its view-specific options, and only the metrics that
 * view can render. Editing while on "Default" prompts a Save-as (Default is
 * immutable). Reuses CustomizePanel.module.css classes.
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md
 */
import { useEffect, useRef, useState } from 'react'
import styles from './CustomizePanel.module.css'
import { DEFAULT_PRESET, validatePresetName } from './useBreadthViews'

function groupMetrics(metrics) {
  const seen = new Map()
  for (const m of metrics) {
    if (!seen.has(m.group)) seen.set(m.group, [])
    seen.get(m.group).push(m)
  }
  return [...seen.entries()].map(([group, list]) => ({ group, list }))
}

// Option values may be numbers; <select> values are strings. Coerce back using the schema.
function coerceOptionValue(opt, raw) {
  const match = opt.choices.find(c => String(c.value) === raw)
  return match ? match.value : raw
}

export default function BreadthViewsCustomizePanel({
  viewLabel, metrics, optionsSchema, options, activePreset, visibleKeys, presetNames,
  isDefaultActive, onToggleVisible, onSetOption, onSavePreset, onRenamePreset,
  onDeletePreset, onSwitchPreset, onResetActive, onClose,
}) {
  // Modes: null | 'saveAs' | 'rename' | 'delete' | 'savePromptFromDefault'
  const [mode, setMode] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState(null)

  const panelRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [onClose])

  useEffect(() => {
    if (mode === 'saveAs' || mode === 'rename' || mode === 'savePromptFromDefault') {
      inputRef.current?.focus(); inputRef.current?.select()
    }
  }, [mode])

  const closeInline = () => { setMode(null); setDraftName(''); setError(null) }
  const customs = presetNames.filter(n => n !== DEFAULT_PRESET)

  const guardDefault = (proceed) => {
    if (isDefaultActive) { setDraftName(''); setError(null); setMode('savePromptFromDefault'); return }
    proceed()
  }

  const submitSaveAs = () => {
    const err = validatePresetName(draftName, customs)
    if (err) { setError(err); return }
    onSavePreset(draftName.trim()); closeInline()
  }
  const submitSaveFromDefault = () => {
    const err = validatePresetName(draftName, customs)
    if (err) { setError(err); return }
    onSavePreset(draftName.trim()); closeInline()
  }
  const submitRename = () => {
    const err = validatePresetName(draftName, customs.filter(n => n !== activePreset))
    if (err) { setError(err); return }
    onRenamePreset(activePreset, draftName.trim()); closeInline()
  }
  const submitDelete = () => { onDeletePreset(activePreset); closeInline() }

  const grouped = groupMetrics(metrics)

  return (
    <div className={styles.panel} ref={panelRef} role="dialog" aria-label={`Customize ${viewLabel}`}>
      <div className={styles.header}>
        <h2 className={styles.title}>Customize {viewLabel}</h2>
        <button className={styles.xBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className={styles.presetRow}>
        <select className={styles.presetSelect} value={activePreset}
                onChange={(e) => onSwitchPreset(e.target.value)} aria-label="Active preset">
          {presetNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className={styles.presetActions}>
          <button className={styles.smallBtn}
                  onClick={() => { setMode('saveAs'); setDraftName(''); setError(null) }}
                  title="Save current view as a new preset">Save as…</button>
          <button className={styles.smallBtn} disabled={isDefaultActive}
                  onClick={() => { setMode('rename'); setDraftName(activePreset); setError(null) }}
                  title={isDefaultActive ? 'Default cannot be renamed' : 'Rename this preset'}>Rename</button>
          <button className={`${styles.smallBtn} ${styles.smallBtnDanger}`} disabled={isDefaultActive}
                  onClick={() => { setMode('delete'); setError(null) }}
                  title={isDefaultActive ? 'Default cannot be deleted' : 'Delete this preset'}>Delete</button>
        </div>
      </div>

      {mode === 'saveAs' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Save current {viewLabel} as:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName} placeholder="e.g. Tight"
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitSaveAs() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitSaveAs}>Save</button>
          </div>
        </div>
      )}
      {mode === 'rename' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Rename "{activePreset}" to:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName}
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitRename() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitRename}>Rename</button>
          </div>
        </div>
      )}
      {mode === 'delete' && (
        <div className={styles.inlineForm}>
          <p className={styles.confirmText}>Delete preset "{activePreset}"?</p>
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitDelete}>Delete</button>
          </div>
        </div>
      )}
      {mode === 'savePromptFromDefault' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Default cannot be edited. Save changes as a new preset:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName} placeholder="e.g. My View"
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitSaveFromDefault() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitSaveFromDefault}>Save</button>
          </div>
        </div>
      )}

      {optionsSchema.length > 0 && (
        <div className={styles.body} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>View options</div>
            {optionsSchema.map(opt => (
              <label key={opt.name} className={styles.checkRow} style={{ justifyContent: 'space-between' }}>
                <span className={styles.checkLabel}>{opt.label}</span>
                <select aria-label={opt.label} value={String(options[opt.name])}
                        onChange={(e) => guardDefault(() => onSetOption(opt.name, coerceOptionValue(opt, e.target.value)))}>
                  {opt.choices.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className={styles.body}>
        {grouped.map(({ group, list }) => (
          <div key={group} className={styles.section}>
            <div className={styles.sectionHeader}>{group}</div>
            {list.map(col => (
              <label key={col.key} className={styles.checkRow}>
                <input type="checkbox" className={styles.checkbox} checked={visibleKeys.has(col.key)}
                       onChange={() => guardDefault(() => onToggleVisible(col.key))} />
                <span className={styles.checkLabel}>{col.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.activeLabel}>
          {isDefaultActive ? `Default — ${viewLabel} preset` : `${visibleKeys.size} of ${metrics.length} visible`}
        </span>
        <button className={styles.resetLink} onClick={onResetActive} disabled={isDefaultActive}
                title={isDefaultActive ? 'Default has nothing to reset' : 'Restore this view’s defaults'}>
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/BreadthViewsCustomizePanel.jsx app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx
git commit -m "feat(breadth): view-scoped Customize panel with per-view options"
```

---

## Task 4: Quick preset switcher (bar dropdown)

**Files:**
- Create: `app/src/pages/breadth/QuickPresetSwitcher.jsx`
- Test: `app/src/pages/breadth/QuickPresetSwitcher.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/QuickPresetSwitcher.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuickPresetSwitcher from './QuickPresetSwitcher'

describe('QuickPresetSwitcher', () => {
  it('lists the presets and reflects the active one', () => {
    render(<QuickPresetSwitcher presetNames={['Default', 'Tight']} activePreset="Tight" onSwitch={() => {}} />)
    const sel = screen.getByLabelText('Switch preset')
    expect(sel.value).toBe('Tight')
    expect(screen.getByRole('option', { name: 'Default' })).toBeTruthy()
  })

  it('calls onSwitch when a preset is chosen', () => {
    const onSwitch = vi.fn()
    render(<QuickPresetSwitcher presetNames={['Default', 'Tight']} activePreset="Default" onSwitch={onSwitch} />)
    fireEvent.change(screen.getByLabelText('Switch preset'), { target: { value: 'Tight' } })
    expect(onSwitch).toHaveBeenCalledWith('Tight')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/QuickPresetSwitcher.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```jsx
// app/src/pages/breadth/QuickPresetSwitcher.jsx
/** Compact preset dropdown for the Breadth Views bar — flips the active view's
 *  preset without opening the Customize panel. */
export default function QuickPresetSwitcher({ presetNames, activePreset, onSwitch }) {
  return (
    <select aria-label="Switch preset" value={activePreset}
            onChange={(e) => onSwitch(e.target.value)}
            style={{ font: '600 11px Instrument Sans, sans-serif', color: '#cbd5e1',
                     background: '#0e131a', border: '1px solid rgba(255,255,255,0.1)',
                     borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>
      {presetNames.map(n => <option key={n} value={n}>{n === 'Default' ? 'Default preset' : n}</option>)}
    </select>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/QuickPresetSwitcher.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/QuickPresetSwitcher.jsx app/src/pages/breadth/QuickPresetSwitcher.test.jsx
git commit -m "feat(breadth): quick preset switcher for the Views bar"
```

---

## Task 5: Wire `BreadthViews.jsx` to the v2 hook, panel, switcher, options

**Files:**
- Modify: `app/src/pages/breadth/BreadthViews.jsx`
- Test: `app/src/pages/breadth/BreadthViews.test.jsx` (check existing; adjust to v2 API)

- [ ] **Step 1: Inspect the existing BreadthViews test for v1 assumptions**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViews.test.jsx`
Expected: PASS currently (records the baseline). Note any assertion that references `views.hidden` or the old `CustomizePanel` so Step 3 can update it.

- [ ] **Step 2: Rewrite the relevant parts of `BreadthViews.jsx`**

Replace the import of `CustomizePanel` and the customize/visible-metric wiring. Full new top section and render of the bar + panel:

Change imports (top of file) — replace the `CustomizePanel` import line:
```jsx
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'
import QuickPresetSwitcher from './QuickPresetSwitcher'
import { VIEW_CONFIG, optionsSchema } from './views/viewMetricConfig'
import customizeStyles from './CustomizePanel.module.css'
```

Replace the hook call and the `visibleMetrics`/`visibleKeys` block:
```jsx
  const ALL_METRICS = useMemo(() => HM_METRICS.filter(m => !m.isHeader), [])
  const views = useBreadthViews(ALL_METRICS)
  const [rowIdx, setRowIdx] = useState(0)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const viewLabel = VIEW_CONFIG[views.viewStyle]?.label ?? views.viewStyle
  const panelMetrics = useMemo(() => views.eligibleMetrics(), [views])

  const visibleMetrics = useMemo(
    () => ALL_METRICS.filter(m => views.visibleKeys.has(m.key)),
    [ALL_METRICS, views.visibleKeys],
  )
  const visibleKeys = useMemo(() => new Set(visibleMetrics.map(m => m.key)), [visibleMetrics])
```

Extend the `recentRows` window to 30 (max option window):
```jsx
  const recentRows = useMemo(() => filledRows.slice(rowIdx, rowIdx + 30), [filledRows, rowIdx])
```

Add the resolved options to `common`:
```jsx
  const common = {
    currentRow, prevRow, recentRows, metrics: visibleMetrics, normalize, onDrill: drill,
    signalKey: signals.signalKey, notableKey: signals.notableKey, options: views.options,
  }
```

Replace the bar's right-hand cluster (switcher button + CustomizePanel) with the quick switcher + new panel:
```jsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <QuickPresetSwitcher presetNames={views.presetNames}
                               activePreset={views.activePreset} onSwitch={views.switchPreset} />
          <div className={customizeStyles.anchor}>
            <button className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                    onClick={() => setCustomizeOpen(o => !o)} title="Customize this view">
              <span className={customizeStyles.triggerIcon}>⚙</span> {viewLabel}
              {!views.isDefaultActive ? ` · ${views.activePreset}` : ''}
            </button>
            {customizeOpen && (
              <BreadthViewsCustomizePanel
                viewLabel={viewLabel}
                metrics={panelMetrics}
                optionsSchema={optionsSchema(views.viewStyle)}
                options={views.options}
                activePreset={views.activePreset}
                visibleKeys={views.visibleKeys}
                presetNames={views.presetNames}
                isDefaultActive={views.isDefaultActive}
                onToggleVisible={views.toggleVisible}
                onSetOption={views.setOption}
                onSavePreset={views.savePreset}
                onRenamePreset={views.renamePreset}
                onDeletePreset={views.deletePreset}
                onSwitchPreset={views.switchPreset}
                onResetActive={views.resetActive}
                onClose={() => setCustomizeOpen(false)}
              />
            )}
          </div>
        </div>
```

(The `BreadthViewSwitcher` and date-cursor controls earlier in the bar are unchanged; remove the old `marginLeft: 'auto'` from the old anchor div since the new wrapper now owns it.)

- [ ] **Step 3: Update `BreadthViews.test.jsx` for the v2 API**

If Step 1 showed assertions referencing the old `CustomizePanel` title ("Customize Breadth Views") or `views.hidden`, update them: the trigger button now reads the view label (e.g. "Treemap"); the panel title is "Customize Treemap". Replace any such assertions accordingly. If the existing test only renders a view and checks metric tiles, no change is needed beyond confirming it still passes.

- [ ] **Step 4: Run BreadthViews + full breadth folder tests**

Run: `cd app && npx vitest run src/pages/breadth/`
Expected: PASS across the folder (existing view tests + new ones). Fix any v1→v2 fallout surfaced here.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/BreadthViews.jsx app/src/pages/breadth/BreadthViews.test.jsx
git commit -m "feat(breadth): wire Views to per-view presets, panel, quick switcher, options"
```

---

## Task 6: Radar consumes `maxSpokes` + `spokeSelect`

**Files:**
- Modify: `app/src/pages/breadth/views/RadarView.jsx`
- Test: `app/src/pages/breadth/views/RadarView.test.jsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/RadarView.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RadarView from './RadarView'

const mk = (key) => ({ key, label: key, drillKey: `${key}_list`, polarity: 'bull' })
const metrics = Array.from({ length: 16 }, (_, i) => mk(`m${i}`))
const currentRow = { date: '2026-06-01' }
const normalize = (m) => 50 + (Number(m.key.slice(1)) % 5) * 8  // deterministic spread

describe('RadarView spoke cap', () => {
  it('renders at most maxSpokes axis labels', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={metrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 8, spokeSelect: 'auto' }} />,
    )
    // axis labels are <text> nodes
    expect(container.querySelectorAll('text').length).toBe(8)
  })

  it('as-listed pick keeps the first N metrics in order', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={metrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 10, spokeSelect: 'listed' }} />,
    )
    const labels = [...container.querySelectorAll('text')].map(t => t.textContent.replace('★ ', ''))
    expect(labels).toEqual(['m0','m1','m2','m3','m4','m5','m6','m7','m8','m9'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/RadarView.test.jsx`
Expected: FAIL — current code hardcodes `MAX_SPOKES = 14` and ignores `options`.

- [ ] **Step 3: Edit RadarView to read options**

Change the function signature to accept `options` and replace the cap/selection block:
```jsx
export default function RadarView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || (metrics?.length ?? 0) < 3) {
    return (
      <div style={{ padding: 24, color: '#94a3b8', font: '600 12px Instrument Sans, sans-serif' }}>
        Radar needs at least 3 visible metrics — enable more in Customize.
      </div>
    )
  }
  const MAX_SPOKES = options.maxSpokes ?? 14
  const asListed = options.spokeSelect === 'listed'
  const ext = (m) => Math.abs((normalize(m, currentRow) ?? 50) - 50)
  const capped = metrics.length > MAX_SPOKES
  let shown = metrics
  if (capped) {
    if (asListed) {
      shown = metrics.slice(0, MAX_SPOKES)
    } else {
      const top = [...metrics].sort((a, b) => ext(b) - ext(a)).slice(0, MAX_SPOKES)
      for (const key of [signalKey, notableKey]) {
        if (key && !top.some(m => m.key === key)) {
          const m = metrics.find(x => x.key === key)
          if (m) { top.pop(); top.push(m) }
        }
      }
      shown = top
    }
  }
```
(The rest of the component — `N`, `pt`, polygon, labels, capped footnote — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/RadarView.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/RadarView.jsx app/src/pages/breadth/views/RadarView.test.jsx
git commit -m "feat(breadth): Radar honors maxSpokes + spokeSelect options"
```

---

## Task 7: Scoreboard sort/density/sparkline-window + shared sort helper

**Files:**
- Modify: `app/src/pages/breadth/views/breadthViewShared.js` (add `sortVisibleMetrics`)
- Modify: `app/src/pages/breadth/views/ScoreboardView.jsx`
- Test: `app/src/pages/breadth/views/breadthViewShared.test.js` (extend), `app/src/pages/breadth/views/ScoreboardView.test.jsx` (create)

- [ ] **Step 1: Write the failing helper test**

Append to `app/src/pages/breadth/views/breadthViewShared.test.js`:
```js
import { sortVisibleMetrics } from './breadthViewShared'

describe('sortVisibleMetrics', () => {
  const row = {}
  const metrics = [
    { key: 'a', polarity: 'bull', getTier: () => 'r3' },
    { key: 'b', polarity: 'bull', getTier: () => 'g3' },
    { key: 'c', polarity: 'bear', getTier: () => 'a' },
  ]
  const norm = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

  it('group/board mode preserves original order', () => {
    expect(sortVisibleMetrics(metrics, 'group', norm, row).map(m => m.key)).toEqual(['a','b','c'])
    expect(sortVisibleMetrics(metrics, 'board', norm, row).map(m => m.key)).toEqual(['a','b','c'])
  })
  it('value mode sorts by normalized value desc', () => {
    expect(sortVisibleMetrics(metrics, 'value', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
  it('bull mode inverts bearish metrics', () => {
    // bullishness: a=20, b=90, c=100-40=60 → b,c,a
    expect(sortVisibleMetrics(metrics, 'bull', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
  it('tier mode ranks bullish tiers first', () => {
    expect(sortVisibleMetrics(metrics, 'tier', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js`
Expected: FAIL — `sortVisibleMetrics` not exported.

- [ ] **Step 3: Add the helper to `breadthViewShared.js`**

Append:
```js
const TIER_RANK = { g3: 0, g2: 1, g1: 2, a: 3, r1: 4, r2: 5, r3: 6, '': 7 }

/**
 * Order visible metrics for the value/tier/bullishness sorts shared by Scoreboard,
 * Levels, and Meters. Unknown/`group`/`board` modes preserve the incoming order.
 *   normalize(metric,row) → 0..100 or null.
 */
export function sortVisibleMetrics(metrics, mode, normalize, row) {
  if (mode === 'value' || mode === 'bull') {
    const score = (m) => {
      const n = normalize(m, row)
      if (n == null) return -1
      return mode === 'bull' && m.polarity === 'bear' ? 100 - n : n
    }
    return [...metrics].sort((a, b) => score(b) - score(a))
  }
  if (mode === 'tier') {
    const rank = (m) => TIER_RANK[(m.getTier ? m.getTier(row) : '') || ''] ?? 7
    return [...metrics].sort((a, b) => rank(a) - rank(b))
  }
  return metrics  // group / board / undefined → original order
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing Scoreboard test**

```jsx
// app/src/pages/breadth/views/ScoreboardView.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ScoreboardView from './ScoreboardView'

const mk = (key, val) => ({ key, label: key, polarity: 'bull', drillKey: null,
  getFmt: () => String(val), getTier: () => 'g1' })
const metrics = [mk('a', 1), mk('b', 2), mk('c', 3)]
const currentRow = { a: 20, b: 90, c: 40, date: 'd' }
const recentRows = [currentRow, { a: 10, b: 80, c: 30, date: 'd0' }]
const normalize = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

describe('ScoreboardView options', () => {
  it('value sort orders cards by normalized value desc', () => {
    render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} normalize={normalize}
      options={{ sort: 'value', density: 'comfortable', sparkWindow: 20 }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    expect(labels).toEqual(['b', 'c', 'a'])
  })

  it('renders without crashing in compact density', () => {
    const { container } = render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} normalize={normalize}
      options={{ sort: 'group', density: 'compact', sparkWindow: 10 }} />)
    expect(container.querySelectorAll('svg').length).toBe(3)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/ScoreboardView.test.jsx`
Expected: FAIL — Scoreboard ignores `options` (no sort applied; `normalize` prop unused).

- [ ] **Step 7: Edit ScoreboardView to consume options**

Update the import and signature, sort the metrics, and apply density + spark window:
```jsx
import { metricValue, sortVisibleMetrics } from './breadthViewShared'
import signalStyles from './signals.module.css'

// ...buildSpark unchanged...

export default function ScoreboardView({ currentRow, recentRows = [], metrics, onDrill, signalKey, notableKey, normalize, options = {} }) {
  if (!currentRow || !metrics?.length) return null
  const sort = options.sort ?? 'group'
  const compact = options.density === 'compact'
  const win = options.sparkWindow ?? 20
  const ordered = normalize ? sortVisibleMetrics(metrics, sort, normalize, currentRow) : metrics
  const asc = [...recentRows].slice(0, win).reverse()  // oldest → newest, windowed
  const pad = compact ? 7 : 10
  const minW = compact ? 96 : 120
  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '14px 18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))`, gap: 10 }}>
        {ordered.map(m => {
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          const sp = buildSpark(asc.map(r => metricValue(m, r)), m.polarity)
          return (
            <div key={m.key} onClick={clickable ? () => onDrill(m) : undefined}
                 role={clickable ? 'button' : undefined}
                 aria-label={clickable ? `${m.label} details` : undefined}
                 className={isNotable ? signalStyles.pulse : undefined}
                 style={{ background: '#0e131a', borderRadius: 8, padding: pad,
                          border: isSignal ? '1px solid #c9a84c' : '1px solid rgba(255,255,255,0.05)',
                          cursor: clickable ? 'pointer' : 'default' }}>
              <div style={{ font: '700 8px Instrument Sans, sans-serif', letterSpacing: '.5px',
                            textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8' }}>
                {isSignal ? '★ ' : ''}{m.label}
              </div>
              <div style={{ font: `800 ${compact ? 18 : 22}px Instrument Sans, sans-serif`, color: '#e8e8ea',
                            lineHeight: 1.15, marginTop: 2 }}>
                {m.getFmt(currentRow)}
              </div>
              <svg width="100%" height="16" viewBox="0 0 60 16" preserveAspectRatio="none" style={{ marginTop: 2 }}>
                {sp
                  ? <polyline points={sp.pts} fill="none" stroke={sp.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  : <line x1="0" y1="8" x2="60" y2="8" stroke="#334155" strokeDasharray="2 2" />}
              </svg>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run Scoreboard test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/ScoreboardView.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/breadth/views/breadthViewShared.js app/src/pages/breadth/views/breadthViewShared.test.js app/src/pages/breadth/views/ScoreboardView.jsx app/src/pages/breadth/views/ScoreboardView.test.jsx
git commit -m "feat(breadth): Scoreboard sort/density/spark-window + shared sort helper"
```

---

## Task 8: Levels + Meters consume `sort`

**Files:**
- Modify: `app/src/pages/breadth/views/EqualizerView.jsx`
- Modify: `app/src/pages/breadth/views/MetersView.jsx`
- Test: `app/src/pages/breadth/views/LevelsMetersSort.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/LevelsMetersSort.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EqualizerView from './EqualizerView'
import MetersView from './MetersView'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null,
  getFmt: () => key, getTier: () => 'g1' })
const metrics = [mk('a'), mk('b'), mk('c')]
const currentRow = { date: 'd' }
const normalize = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

describe('Levels + Meters sort', () => {
  it('Levels value sort orders columns by value desc', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ sort: 'value' }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    // label text appears twice per column (value + name); take unique order of first occurrence
    const order = labels.filter((v, i) => labels.indexOf(v) === i)
    expect(order).toEqual(['b', 'c', 'a'])
  })

  it('Meters value sort orders rows by value desc', () => {
    render(<MetersView currentRow={currentRow} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ sort: 'value' }} />)
    const labels = screen.getAllByText(/^[abc]$/).map(n => n.textContent)
    const order = labels.filter((v, i) => labels.indexOf(v) === i)
    expect(order).toEqual(['b', 'c', 'a'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/LevelsMetersSort.test.jsx`
Expected: FAIL — neither view sorts.

- [ ] **Step 3a: Edit EqualizerView**

Update the import and signature, sort before mapping:
```jsx
import { metricColor, sortVisibleMetrics } from './breadthViewShared'
import signalStyles from './signals.module.css'

export default function EqualizerView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || !metrics?.length) return null
  const ordered = sortVisibleMetrics(metrics, options.sort ?? 'board', normalize, currentRow)
  return (
    <div style={{ height: '100%', overflowX: 'auto', overflowY: 'hidden', padding: '18px 18px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%', minHeight: 160 }}>
        {ordered.map(m => {
```
(Rest of the body unchanged — only the mapped list source changes from `metrics` to `ordered`.)

- [ ] **Step 3b: Edit MetersView**

```jsx
import { metricColor, sortVisibleMetrics } from './breadthViewShared'
import signalStyles from './signals.module.css'

export default function MetersView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || metrics.length === 0) return null
  const ordered = sortVisibleMetrics(metrics, options.sort ?? 'group', normalize, currentRow)
  return (
    <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ font: '600 10px Instrument Sans, sans-serif', color: '#64748b',
                    textAlign: 'right', marginBottom: 2 }}>oversold ◄ ► overbought</div>
      {ordered.map(m => {
```
(Rest unchanged — only the mapped source changes from `metrics` to `ordered`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/LevelsMetersSort.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/EqualizerView.jsx app/src/pages/breadth/views/MetersView.jsx app/src/pages/breadth/views/LevelsMetersSort.test.jsx
git commit -m "feat(breadth): Levels + Meters honor sort option"
```

---

## Task 9: Timeline consumes `windowDays`

**Files:**
- Modify: `app/src/pages/breadth/views/TimelineView.jsx`
- Test: `app/src/pages/breadth/views/TimelineView.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/TimelineView.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TimelineView from './TimelineView'

const metrics = [{ key: 'a', label: 'a', drillKey: null, getFmt: () => 'x', getTier: () => 'g1' }]
const rows = Array.from({ length: 25 }, (_, i) => ({ date: `d${i}` }))

describe('TimelineView windowDays', () => {
  it('renders windowDays day-cells (plus the label cell)', () => {
    const { container } = render(
      <TimelineView recentRows={rows} metrics={metrics} onDrill={() => {}}
                    signalKey={null} notableKey={null} options={{ windowDays: 10 }} />,
    )
    // grid children = 1 label + N day cells for the single metric row
    const grid = container.querySelector('div[style*="grid-template-columns"]')
    expect(grid.children.length).toBe(1 + 10)
  })

  it('defaults to 20 when no option given', () => {
    const { container } = render(
      <TimelineView recentRows={rows} metrics={metrics} onDrill={() => {}}
                    signalKey={null} notableKey={null} />,
    )
    const grid = container.querySelector('div[style*="grid-template-columns"]')
    expect(grid.children.length).toBe(1 + 20)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/TimelineView.test.jsx`
Expected: FAIL — current code hardcodes `.slice(0, 12)`.

- [ ] **Step 3: Edit TimelineView**

Change the signature and the slice:
```jsx
export default function TimelineView({ recentRows = [], metrics, onDrill, signalKey, notableKey, options = {} }) {
  if (!metrics?.length || !recentRows.length) return null
  const win = options.windowDays ?? 20
  const days = [...recentRows].slice(0, win).reverse()  // oldest → newest, up to `win`
  const cols = days.length
```
(Rest unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/TimelineView.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/TimelineView.jsx app/src/pages/breadth/views/TimelineView.test.jsx
git commit -m "feat(breadth): Timeline honors windowDays option"
```

---

## Task 10: Full-suite verification + production build

**Files:** none (verification only)

- [ ] **Step 1: Run the full breadth test folder**

Run: `cd app && npx vitest run src/pages/breadth/`
Expected: PASS — all existing + new tests (target: the prior 98 breadth tests still green plus the new ~25).

- [ ] **Step 2: Run the entire frontend suite to catch cross-imports**

Run: `cd app && npx vitest run`
Expected: PASS. Investigate any failure that references `useBreadthViews`, `hidden`, or `CustomizePanel`.

- [ ] **Step 3: Production build (verifies no broken imports + Vite chunking)**

Run: `cd app && npm run build`
Expected: build succeeds. (Per project rule: always `npm run build` locally before pushing.)

- [ ] **Step 4: Manual smoke checklist (browser)**

Start dev (`cd app && npm run dev`), open Breadth → Views, and verify:
- Switching styles re-scopes the ⚙ button label and the Customize panel header.
- Tug's Customize panel shows only paired metrics; Radar/Scoreboard show the full board.
- Save as… on Radar, toggle metrics + change Max spokes → preset persists; switch to Scoreboard and back → Radar preset intact, Scoreboard independent.
- Quick preset dropdown flips presets without opening Customize.
- Scoreboard sort/density/window, Levels/Meters sort, Timeline window visibly change output.
- Reload page → presets + active view persist; an existing v1 user keeps their old preset (now under its view).

- [ ] **Step 5: Commit any fixes, then push (triggers Railway deploy)**

```bash
git add -A
git commit -m "test(breadth): per-view customization suite green + build verified"
git push
```

---

## Notes for the implementer

- **No TypeScript** — this is a Vite JS SPA. Don't add type annotations.
- **Follow existing idioms** — the v2 hook mirrors `useBreadthCustomize` debounce/flush patterns; the panel reuses `CustomizePanel.module.css` classes verbatim.
- **Do not touch** `CustomizePanel.jsx` or `useBreadthCustomize.js` (Monitor sheet).
- **Vite manualChunks** must stay object-form; you aren't editing `vite.config.js`, but if a build error implicates chunking, do not switch it to function form.
- **Push** only at Task 10 Step 5 — pushing deploys to Railway.
- **Preset dual-shape:** a v1-migrated preset stores `{ hidden, options }` and is resolved as *eligible-minus-hidden* at read time (so the metric universe need not be known at load). The first edit (toggleVisible/setOption/resetActive/savePreset) materializes it into an explicit `{ visible, options }`. Both shapes round-trip through `sanitizeByView`/`writeToStorage`, so a migrated preset that's never edited still survives reloads.
```
