# Breadth Views — Multi-Style Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Breadth "Heatmap" tab into a "Views" surface where users switch between four visualization styles (Treemap / Vitals Rings / Bull-Bear Tug / Tactical Meters) and customize which metrics appear, persisted per named preset.

**Architecture:** A `BreadthViews` container owns the date cursor, forward-fill, percentile computation, and the `useBreadthViews` persistence hook. It renders a style switcher plus one of four standalone view components, each receiving a uniform prop contract `{ currentRow, prevRow, metrics, normalize, onDrill }`. Pure helpers (normalizer, metric color, net posture, polarity/pair metadata) live in `breadthViewShared.js` so views never duplicate logic and a future drag-to-compose canvas can reuse them.

**Tech Stack:** React + Vite, ECharts (`echarts-for-react`) for the treemap, SVG for rings, plain divs for tug/meters, Vitest + `@testing-library/react`, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md`

---

## File Structure

**New files**
- `app/src/pages/breadth/views/breadthViewShared.js` — pure helpers + polarity/pair metadata.
- `app/src/pages/breadth/views/breadthViewShared.test.js` — unit tests for the helpers.
- `app/src/pages/breadth/useBreadthViews.js` — persistence hook (style + hidden set).
- `app/src/pages/breadth/useBreadthViews.test.js` — hook tests.
- `app/src/pages/breadth/views/RingsView.jsx`
- `app/src/pages/breadth/views/RingsView.test.jsx`
- `app/src/pages/breadth/views/TugView.jsx`
- `app/src/pages/breadth/views/TugView.test.jsx`
- `app/src/pages/breadth/views/MetersView.jsx`
- `app/src/pages/breadth/views/MetersView.test.jsx`
- `app/src/pages/breadth/views/TreemapView.jsx` — the existing treemap logic, moved.
- `app/src/pages/breadth/BreadthViewSwitcher.jsx` + `BreadthViewSwitcher.module.css`
- `app/src/pages/breadth/BreadthViews.jsx`

**Modified files**
- `app/src/pages/Breadth.jsx` — export the metric registry + treemap constants; replace the inline `BreadthHeatmap` render with `<BreadthViews>`; relabel the tab "Views"; extend the Customize trigger to the Views tab.
- `app/src/pages/breadth/CustomizePanel.jsx` — add optional `title` prop (default unchanged).

---

## Task 1: Shared helpers (`breadthViewShared.js`)

Pure, framework-free functions. Highest-value TDD target.

**Files:**
- Create: `app/src/pages/breadth/views/breadthViewShared.js`
- Test: `app/src/pages/breadth/views/breadthViewShared.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/breadth/views/breadthViewShared.test.js
import { describe, it, expect } from 'vitest'
import {
  clamp, metricValue, percentileRank, normalizeMetric,
  metricColor, polarityOf, netPosture, PAIRS,
} from './breadthViewShared'

const M = (key, getTier = () => '') => ({ key, getTier })

describe('clamp', () => {
  it('bounds to 0..100', () => {
    expect(clamp(-5)).toBe(0)
    expect(clamp(140)).toBe(100)
    expect(clamp(42)).toBe(42)
  })
})

describe('metricValue', () => {
  it('reads a plain numeric field', () => {
    expect(metricValue(M('pct_above_50sma'), { pct_above_50sma: 57.8 })).toBe(57.8)
  })
  it('counts MA-stack checkmarks out of 4', () => {
    const row = { spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 0 }
    expect(metricValue(M('spy_ma_stack'), row)).toBe(3)
  })
  it('maps is_ftd boolean to 1/0', () => {
    expect(metricValue(M('is_ftd'), { is_ftd: true })).toBe(1)
    expect(metricValue(M('is_ftd'), { is_ftd: false })).toBe(0)
  })
  it('returns null for missing/NaN', () => {
    expect(metricValue(M('vix'), {})).toBeNull()
    expect(metricValue(M('vix'), { vix: 'x' })).toBeNull()
  })
})

describe('percentileRank', () => {
  it('ranks a value within a sorted ascending array', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(75)
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(100)
  })
})

describe('normalizeMetric', () => {
  const pctile = { vix: [10, 12, 14, 16, 18, 20] }
  it('uses raw value for native percentages', () => {
    expect(normalizeMetric(M('pct_above_200sma'), { pct_above_200sma: 58.9 }, {})).toBe(58.9)
    expect(normalizeMetric(M('cnn_fear_greed'), { cnn_fear_greed: 59 }, {})).toBe(59)
  })
  it('scales MA stack to 0..100 out of 4', () => {
    const row = { spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1 }
    expect(normalizeMetric(M('spy_ma_stack'), row, {})).toBe(100)
  })
  it('scales mcclellan from -150..150 into 0..100', () => {
    expect(normalizeMetric(M('mcclellan_osc'), { mcclellan_osc: 0 }, {})).toBe(50)
  })
  it('falls back to percentile rank for counts', () => {
    expect(normalizeMetric(M('vix'), { vix: 16 }, pctile)).toBe(67)
  })
  it('returns null when no value and no percentile data', () => {
    expect(normalizeMetric(M('new_ath'), {}, {})).toBeNull()
  })
})

describe('metricColor', () => {
  it('maps the metric tier to a bright view color', () => {
    expect(metricColor(M('x', () => 'g3'), {})).toBe('#22c55e')
    expect(metricColor(M('x', () => 'r3'), {})).toBe('#ef4444')
    expect(metricColor(M('x', () => ''), {})).toBe('#475569')
  })
})

describe('polarityOf', () => {
  it('defaults to bull and overrides known bearish keys', () => {
    expect(polarityOf('pct_above_50sma')).toBe('bull')
    expect(polarityOf('vix')).toBe('bear')
    expect(polarityOf('new_52w_lows')).toBe('bear')
    expect(polarityOf('cnn_fear_greed')).toBe('bear')
  })
})

describe('netPosture', () => {
  const up = (key, partnerKey) => ({ key, pair: { partnerKey, side: 'up' } })
  const down = (key) => ({ key })
  const metrics = [
    up('up_4pct_today', 'down_4pct_today'), down('down_4pct_today'),
    up('new_52w_highs', 'new_52w_lows'), down('new_52w_lows'),
  ]
  it('returns a signed -100..100 net bull share', () => {
    const row = { up_4pct_today: 383, down_4pct_today: 208, new_52w_highs: 159, new_52w_lows: 48 }
    // pair1 share = (383-208)/591 = .296 ; pair2 = (159-48)/207 = .536 ; avg ≈ .416 → 42
    expect(netPosture(metrics, row)).toBe(42)
  })
  it('returns null when no usable pairs', () => {
    expect(netPosture(metrics, {})).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js`
Expected: FAIL — `Cannot find module './breadthViewShared'`.

- [ ] **Step 3: Implement the helpers**

```js
// app/src/pages/breadth/views/breadthViewShared.js
/**
 * Shared, framework-free helpers for the Breadth Views (Rings / Tug / Meters /
 * Treemap). Keeping these pure means every view renders from one source of
 * truth and a future compose-canvas can reuse them.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */

export const clamp = (v) => Math.max(0, Math.min(100, v))

// MA-stack metrics are a count of 4 boolean columns; expose the count.
const MA_STACK_COLS = {
  spy_ma_stack: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
  qqq_ma_stack: ['qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma'],
}

export function metricValue(metric, row) {
  const k = metric.key
  if (MA_STACK_COLS[k]) return MA_STACK_COLS[k].filter(c => row[c] === 1).length
  if (k === 'is_ftd') return row.is_ftd ? 1 : 0
  const v = row[k]
  if (v == null || isNaN(Number(v))) return null
  return Number(v)
}

// Percent of the sorted ascending array <= v.
export function percentileRank(sorted, v) {
  if (!sorted || sorted.length < 1) return null
  return Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
}

// Keys whose raw value is already on a 0..100 scale.
const NATIVE_PCT = (k) => k.startsWith('pct_above_') || k === 'cnn_fear_greed'

export function normalizeMetric(metric, row, pctileByKey) {
  const k = metric.key
  const v = metricValue(metric, row)
  if (v == null) return null
  if (MA_STACK_COLS[k]) return clamp(v / 4 * 100)
  if (k === 'mcclellan_osc') return clamp((v + 150) / 300 * 100)
  if (NATIVE_PCT(k)) return clamp(v)
  return percentileRank(pctileByKey?.[k], v)  // null if no series
}

// Bright, saturated colors for rings/bars (the treemap keeps its own dark fills).
const VIEW_TIER_COLOR = {
  g3: '#22c55e', g2: '#4ade80', g1: '#86efac', a: '#fbbf24',
  r1: '#fca5a5', r2: '#f87171', r3: '#ef4444', '': '#475569',
}
export function metricColor(metric, row) {
  const tier = metric.getTier ? (metric.getTier(row) || '') : ''
  return VIEW_TIER_COLOR[tier] ?? VIEW_TIER_COLOR['']
}

// Metrics where a HIGH reading is bearish (everything else is bullish).
const BEARISH_KEYS = new Set([
  'down_4pct_today', 'down_25pct_quarter', 'down_50pct_month', 'magna_down',
  'stage4_count', 'new_52w_lows', 'new_20d_lows', 'vix', 'cnn_fear_greed',
])
export function polarityOf(key) {
  return BEARISH_KEYS.has(key) ? 'bear' : 'bull'
}

// Up/down metric pairs for the tug-of-war. side 'up' = bull side.
export const PAIRS = [
  ['up_4pct_today', 'down_4pct_today'],
  ['up_25pct_quarter', 'down_25pct_quarter'],
  ['up_50pct_month', 'down_50pct_month'],
  ['magna_up', 'magna_down'],
  ['stage2_count', 'stage4_count'],
  ['new_52w_highs', 'new_52w_lows'],
  ['new_20d_highs', 'new_20d_lows'],
]

// Signed net bull share across visible pairs, -100..100. null if none usable.
export function netPosture(metrics, row) {
  const ups = metrics.filter(m => m.pair && m.pair.side === 'up')
  let acc = 0, n = 0
  for (const up of ups) {
    const down = metrics.find(m => m.key === up.pair.partnerKey)
    const u = metricValue(up, row)
    const d = down ? metricValue(down, row) : null
    if (u == null || d == null || (u + d) === 0) continue
    acc += (u - d) / (u + d)
    n++
  }
  if (!n) return null
  return Math.round(acc / n * 100)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/breadthViewShared.js app/src/pages/breadth/views/breadthViewShared.test.js
git commit -m "feat(breadth): shared helpers for multi-style breadth views"
```

---

## Task 2: Persistence hook (`useBreadthViews`)

A clone of `useBreadthCustomize` that also stores the active `viewStyle`, on its own storage key.

**Files:**
- Create: `app/src/pages/breadth/useBreadthViews.js`
- Test: `app/src/pages/breadth/useBreadthViews.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/breadth/useBreadthViews.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthViews, {
  STORAGE_KEY, DEFAULT_PRESET, DEFAULT_STYLE, STYLES,
} from './useBreadthViews'

beforeEach(() => localStorage.clear())

describe('useBreadthViews', () => {
  it('starts on Default preset with the default style', () => {
    const { result } = renderHook(() => useBreadthViews())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    expect(result.current.hidden.size).toBe(0)
  })

  it('setViewStyle changes the live style even on Default', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('rings'))
    expect(result.current.viewStyle).toBe('rings')
  })

  it('ignores an unknown style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('bogus'))
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
  })

  it('savePreset stores style + hidden and switches to it', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('tug'))
    act(() => result.current.savePreset('My Tug', ['vix']))
    expect(result.current.activePreset).toBe('My Tug')
    expect(result.current.viewStyle).toBe('tug')
    expect(result.current.hidden.has('vix')).toBe(true)
  })

  it('switching to a saved preset restores its style', () => {
    const { result } = renderHook(() => useBreadthViews())
    act(() => result.current.setViewStyle('meters'))
    act(() => result.current.savePreset('Meters View', []))
    act(() => result.current.switchPreset(DEFAULT_PRESET))
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
    act(() => result.current.switchPreset('Meters View'))
    expect(result.current.viewStyle).toBe('meters')
  })

  it('persists across remount', () => {
    const first = renderHook(() => useBreadthViews())
    act(() => first.result.current.setViewStyle('rings'))
    act(() => first.result.current.savePreset('Persisted', ['vix']))
    first.unmount()
    const second = renderHook(() => useBreadthViews())
    expect(second.result.current.activePreset).toBe('Persisted')
    expect(second.result.current.viewStyle).toBe('rings')
    expect(second.result.current.hidden.has('vix')).toBe(true)
  })

  it('uses a distinct storage key from the Monitor sheet', () => {
    expect(STORAGE_KEY).toBe('uct.breadth.views.v1')
    expect(STYLES).toContain('treemap')
  })

  it('recovers from corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{ bad json')
    const { result } = renderHook(() => useBreadthViews())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.viewStyle).toBe(DEFAULT_STYLE)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```js
// app/src/pages/breadth/useBreadthViews.js
/**
 * Breadth Views customization — localStorage-backed presets that store BOTH the
 * chosen visualization style and which metrics are hidden.
 *
 * Storage shape (key: `uct.breadth.views.v1`):
 *   { activePreset, viewStyle, presets: { [name]: { viewStyle, hidden: string[] } } }
 *
 * Separate storage key from the Monitor sheet (`uct.breadth.customize.v1`) because
 * the metric universe differs. Mirrors useBreadthCustomize idioms.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const STORAGE_KEY = 'uct.breadth.views.v1'
export const DEFAULT_PRESET = 'Default'
export const STYLES = ['treemap', 'rings', 'tug', 'meters']
export const DEFAULT_STYLE = 'treemap'
export const NAME_MAX = 40

const EMPTY_STATE = { activePreset: DEFAULT_PRESET, viewStyle: DEFAULT_STYLE, presets: {} }
const isStyle = (s) => STYLES.includes(s)

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw)
    const presets = {}
    if (parsed && typeof parsed.presets === 'object' && parsed.presets) {
      for (const [name, val] of Object.entries(parsed.presets)) {
        if (name === DEFAULT_PRESET) continue
        if (val && Array.isArray(val.hidden)) {
          presets[name] = {
            viewStyle: isStyle(val.viewStyle) ? val.viewStyle : DEFAULT_STYLE,
            hidden: val.hidden.filter(k => typeof k === 'string'),
          }
        }
      }
    }
    const active = typeof parsed?.activePreset === 'string' ? parsed.activePreset : DEFAULT_PRESET
    const validActive = active === DEFAULT_PRESET || presets[active] ? active : DEFAULT_PRESET
    const viewStyle = validActive === DEFAULT_PRESET
      ? (isStyle(parsed?.viewStyle) ? parsed.viewStyle : DEFAULT_STYLE)
      : presets[validActive].viewStyle
    return { activePreset: validActive, viewStyle, presets }
  } catch {
    return EMPTY_STATE
  }
}

function writeToStorage(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* best-effort */ }
}

export function validatePresetName(name, existingNames) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'Name cannot be empty.'
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer.`
  if (trimmed === DEFAULT_PRESET) return `"${DEFAULT_PRESET}" is reserved.`
  if (existingNames.includes(trimmed)) return 'A preset with that name already exists.'
  return null
}

export default function useBreadthViews() {
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

  const { activePreset, viewStyle, presets } = state
  const isDefaultActive = activePreset === DEFAULT_PRESET

  const hidden = useMemo(() => {
    if (isDefaultActive) return new Set()
    return new Set(presets[activePreset]?.hidden ?? [])
  }, [isDefaultActive, presets, activePreset])

  const presetNames = useMemo(() => {
    const customs = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    return [DEFAULT_PRESET, ...customs]
  }, [presets])

  // Live style change. Persists onto the active custom preset; on Default it only
  // changes the live style (Default is immutable).
  const setViewStyle = useCallback((style) => {
    if (!isStyle(style)) return
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return { ...prev, viewStyle: style }
      return {
        ...prev,
        viewStyle: style,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], viewStyle: style },
        },
      }
    })
  }, [])

  const toggleHidden = useCallback((key) => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev
      const cur = new Set(prev.presets[prev.activePreset]?.hidden ?? [])
      cur.has(key) ? cur.delete(key) : cur.add(key)
      return {
        ...prev,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], hidden: [...cur] },
        },
      }
    })
  }, [])

  const savePreset = useCallback((name, hiddenKeys = []) => {
    const trimmed = (name ?? '').trim()
    setState(prev => {
      if (validatePresetName(trimmed, Object.keys(prev.presets))) return prev
      const arr = [...new Set(hiddenKeys)].filter(k => typeof k === 'string')
      return {
        activePreset: trimmed,
        viewStyle: prev.viewStyle,
        presets: { ...prev.presets, [trimmed]: { viewStyle: prev.viewStyle, hidden: arr } },
      }
    })
  }, [])

  const renamePreset = useCallback((oldName, newName) => {
    const trimmed = (newName ?? '').trim()
    setState(prev => {
      if (!prev.presets[oldName]) return prev
      const others = Object.keys(prev.presets).filter(n => n !== oldName)
      if (validatePresetName(trimmed, others)) return prev
      const next = { ...prev.presets }
      next[trimmed] = next[oldName]
      delete next[oldName]
      return {
        activePreset: prev.activePreset === oldName ? trimmed : prev.activePreset,
        viewStyle: prev.viewStyle,
        presets: next,
      }
    })
  }, [])

  const deletePreset = useCallback((name) => {
    setState(prev => {
      if (!prev.presets[name]) return prev
      const next = { ...prev.presets }
      delete next[name]
      const goingToDefault = prev.activePreset === name
      return {
        activePreset: goingToDefault ? DEFAULT_PRESET : prev.activePreset,
        viewStyle: goingToDefault ? DEFAULT_STYLE : prev.viewStyle,
        presets: next,
      }
    })
  }, [])

  const switchPreset = useCallback((name) => {
    setState(prev => {
      if (name !== DEFAULT_PRESET && !prev.presets[name]) return prev
      const style = name === DEFAULT_PRESET ? DEFAULT_STYLE : prev.presets[name].viewStyle
      return { ...prev, activePreset: name, viewStyle: style }
    })
  }, [])

  const resetActive = useCallback(() => {
    setState(prev => {
      if (prev.activePreset === DEFAULT_PRESET) return prev
      return {
        ...prev,
        presets: {
          ...prev.presets,
          [prev.activePreset]: { ...prev.presets[prev.activePreset], hidden: [] },
        },
      }
    })
  }, [])

  return {
    activePreset, viewStyle, hidden, presetNames, presets, isDefaultActive,
    setViewStyle, toggleHidden, savePreset, renamePreset, deletePreset,
    switchPreset, resetActive,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/useBreadthViews.js app/src/pages/breadth/useBreadthViews.test.js
git commit -m "feat(breadth): useBreadthViews persistence hook (style + hidden per preset)"
```

---

## Task 3: Export the metric registry + treemap constants from `Breadth.jsx`

The new components need `HM_METRICS`, `PCTILE_KEYS`, `FFILL_KEYS`, and the treemap-only constants. Add `export` to the existing declarations and attach `polarity`/`pair` metadata onto the in-memory registry once at module load (no per-entry edits).

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Test: `app/src/pages/breadth/views/registryExports.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/breadth/views/registryExports.test.js
import { describe, it, expect } from 'vitest'
import { HM_METRICS, PCTILE_KEYS, FFILL_KEYS } from '../../Breadth'

describe('Breadth registry exports', () => {
  it('exports the metric registry with pair + polarity metadata attached', () => {
    const byKey = Object.fromEntries(HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m]))
    expect(byKey.up_4pct_today.pair).toEqual({ partnerKey: 'down_4pct_today', side: 'up' })
    expect(byKey.down_4pct_today.pair).toEqual({ partnerKey: 'up_4pct_today', side: 'down' })
    expect(byKey.vix.polarity).toBe('bear')
    expect(byKey.pct_above_50sma.polarity).toBe('bull')
  })
  it('exports the percentile + forward-fill key sets', () => {
    expect(PCTILE_KEYS.has('vix')).toBe(true)
    expect(Array.isArray(FFILL_KEYS)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/registryExports.test.js`
Expected: FAIL — `HM_METRICS` not exported / `pair` undefined.

- [ ] **Step 3: Add exports + metadata in `Breadth.jsx`**

Change the declarations (currently `const HM_METRICS = [...]`, `const PCTILE_KEYS = ...`, `const FFILL_KEYS = ...`, and the treemap constants near line 578-797) to `export const`. Then, immediately after the `HM_METRICS_BY_KEY` definition (~line 762), attach metadata once:

```js
// Attach view metadata (polarity + tug pairing) to the registry once at load.
// Kept here so the metric definitions stay the single source of truth.
import { polarityOf, PAIRS } from './breadth/views/breadthViewShared'

for (const m of HM_METRICS) {
  if (m.isHeader) continue
  m.polarity = polarityOf(m.key)
}
for (const [up, down] of PAIRS) {
  if (HM_METRICS_BY_KEY[up])   HM_METRICS_BY_KEY[up].pair   = { partnerKey: down, side: 'up' }
  if (HM_METRICS_BY_KEY[down]) HM_METRICS_BY_KEY[down].pair = { partnerKey: up, side: 'down' }
}
```

Add `export` to: `HM_METRICS`, `HM_METRICS_BY_KEY`, `PCTILE_KEYS`, `FFILL_KEYS`, `TREEMAP_DEF`, `TIER_CELL_COLORS`, `TIER_SCORES`, `TIER_LABELS`, `TIER_TIP_COLORS`.

> Note: the `import` line must sit at the top of the file with the other imports — move it there; it is shown inline above only to indicate the dependency.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/registryExports.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/breadth/views/registryExports.test.js
git commit -m "feat(breadth): export metric registry + attach polarity/pair metadata"
```

---

## Task 4: RingsView

**Files:**
- Create: `app/src/pages/breadth/views/RingsView.jsx`
- Test: `app/src/pages/breadth/views/RingsView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/RingsView.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RingsView from './RingsView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const row = { breadth_score: 75, up_4pct_today: 383 }

describe('RingsView', () => {
  it('renders a ring per metric with its formatted value + label', () => {
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  })
  it('clicking a ring with a drillKey calls onDrill with the metric', () => {
    const onDrill = vi.fn()
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/RingsView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RingsView**

```jsx
// app/src/pages/breadth/views/RingsView.jsx
/**
 * Vitals Rings — the first visible metric renders as a large hero ring; the rest
 * orbit as smaller rings. Fill arc = normalize(metric,row); color = metricColor.
 */
import { metricColor } from './breadthViewShared'

function Ring({ metric, row, norm, size, onDrill }) {
  const stroke = size >= 110 ? 11 : 7
  const r = (size - stroke) / 2 - 2
  const c = 2 * Math.PI * r
  const pct = norm == null ? 0 : norm
  const offset = c * (1 - pct / 100)
  const color = metricColor(metric, row)
  const clickable = !!metric.drillKey
  const cx = size / 2
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
           role={clickable ? 'button' : undefined}
           aria-label={clickable ? `${metric.label} details` : undefined}
           style={{ cursor: clickable ? 'pointer' : 'default' }}
           onClick={clickable ? () => onDrill(metric) : undefined}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
                transform={`rotate(-90 ${cx} ${cx})`}
                style={{ filter: `drop-shadow(0 0 5px ${color}66)`, transition: 'stroke-dashoffset .4s ease' }} />
        <text x={cx} y={cx + (size >= 110 ? 4 : 4)} textAnchor="middle" fill="#e2e8f0"
              fontFamily="Instrument Sans, sans-serif" fontWeight="800"
              fontSize={size >= 110 ? 30 : 15}>{metric.getFmt(row)}</text>
      </svg>
      <div style={{ font: '700 9px Instrument Sans, sans-serif', letterSpacing: '.6px',
                    textTransform: 'uppercase', color: '#94a3b8', marginTop: 2 }}>
        {metric.label}
      </div>
    </div>
  )
}

export default function RingsView({ currentRow, metrics, normalize, onDrill }) {
  if (!currentRow || metrics.length === 0) return null
  const [hero, ...rest] = metrics
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center',
                  justifyContent: 'center', padding: '24px 18px' }}>
      <Ring metric={hero} row={currentRow} norm={normalize(hero, currentRow)} size={140} onDrill={onDrill} />
      {rest.map(m => (
        <Ring key={m.key} metric={m} row={currentRow} norm={normalize(m, currentRow)} size={84} onDrill={onDrill} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/RingsView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/RingsView.jsx app/src/pages/breadth/views/RingsView.test.jsx
git commit -m "feat(breadth): RingsView vitals gauges"
```

---

## Task 5: TugView

**Files:**
- Create: `app/src/pages/breadth/views/TugView.jsx`
- Test: `app/src/pages/breadth/views/TugView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/TugView.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TugView from './TugView'

const metrics = [
  { key: 'up_4pct_today', label: 'Up 4%+', getFmt: () => '383', drillKey: 'up_4pct_today_list',
    pair: { partnerKey: 'down_4pct_today', side: 'up' } },
  { key: 'down_4pct_today', label: 'Dn 4%+', getFmt: () => '208', drillKey: 'down_4pct_today_list',
    pair: { partnerKey: 'up_4pct_today', side: 'down' } },
]
const row = { up_4pct_today: 383, down_4pct_today: 208 }

describe('TugView', () => {
  it('renders one tug row per pair with both formatted values', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    expect(screen.getByText('383')).toBeInTheDocument()
    expect(screen.getByText('208')).toBeInTheDocument()
  })
  it('shows a net posture summary line', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    // (383-208)/591 = .296 → +30% BULLISH
    expect(screen.getByText(/BULLISH/)).toBeInTheDocument()
  })
  it('clicking a side with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/TugView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TugView**

```jsx
// app/src/pages/breadth/views/TugView.jsx
/**
 * Bull/Bear Tug — paired metrics oppose around a center spine; bar length is the
 * pair's share of the combined total. A net-posture line summarizes the board.
 */
import { metricValue, netPosture } from './breadthViewShared'

function Side({ metric, value, share, align, color, onDrill }) {
  const clickable = !!metric?.drillKey
  return (
    <div style={{ display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <div
        role={clickable ? 'button' : undefined}
        aria-label={clickable ? `${metric.label} details` : undefined}
        onClick={clickable ? () => onDrill(metric) : undefined}
        style={{ width: `${share}%`, minWidth: 28, height: 20, background: color,
                 borderRadius: 4, display: 'flex', alignItems: 'center',
                 justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
                 padding: '0 6px', color: '#fff', font: '800 11px Instrument Sans, sans-serif',
                 cursor: clickable ? 'pointer' : 'default' }}>
        {value}
      </div>
    </div>
  )
}

export default function TugView({ currentRow, metrics, onDrill }) {
  if (!currentRow || metrics.length === 0) return null
  const ups = metrics.filter(m => m.pair && m.pair.side === 'up')
  const posture = netPosture(metrics, currentRow)

  return (
    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ups.map(up => {
        const down = metrics.find(m => m.key === up.pair.partnerKey)
        const u = metricValue(up, currentRow) ?? 0
        const d = down ? (metricValue(down, currentRow) ?? 0) : 0
        const total = u + d || 1
        const uShare = u / total * 100
        const dShare = d / total * 100
        const label = up.label.replace(/^Up\s*/i, '').replace(/^Dn\s*/i, '')
        return (
          <div key={up.key} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 1fr',
                                      alignItems: 'center', gap: 6 }}>
            <Side metric={down} value={down ? down.getFmt(currentRow) : '—'} share={dShare}
                  align="right" color="#b91c1c" onDrill={onDrill} />
            <div style={{ textAlign: 'center', font: '700 8px Instrument Sans, sans-serif',
                          letterSpacing: '.5px', color: '#94a3b8', textTransform: 'uppercase' }}>
              {label}
            </div>
            <Side metric={up} value={up.getFmt(currentRow)} share={uShare}
                  align="left" color="#16a34a" onDrill={onDrill} />
          </div>
        )
      })}
      {posture != null && (
        <div style={{ textAlign: 'center', marginTop: 10,
                      font: '800 13px Instrument Sans, sans-serif',
                      color: posture >= 0 ? '#34d399' : '#f87171' }}>
          NET POSTURE: <span style={{ color: '#fff' }}>
            {posture >= 0 ? '+' : ''}{posture}% {posture >= 0 ? 'BULLISH' : 'BEARISH'}
          </span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/TugView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/TugView.jsx app/src/pages/breadth/views/TugView.test.jsx
git commit -m "feat(breadth): TugView bull/bear diverging bars + net posture"
```

---

## Task 6: MetersView

**Files:**
- Create: `app/src/pages/breadth/views/MetersView.jsx`
- Test: `app/src/pages/breadth/views/MetersView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/MetersView.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MetersView from './MetersView'

const metrics = [
  { key: 'pct_above_50sma', label: '>50 SMA', getTier: () => 'g2', getFmt: () => '57.8%',
    drillKey: null },
  { key: 'vix', label: 'VIX', getTier: () => 'a', getFmt: () => '16.0', drillKey: null },
]
const row = { pct_above_50sma: 57.8, vix: 16 }

describe('MetersView', () => {
  it('renders a labeled meter per metric with its value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 57.8} onDrill={() => {}} />)
    expect(screen.getByText('>50 SMA')).toBeInTheDocument()
    expect(screen.getByText('57.8%')).toBeInTheDocument()
  })
  it('positions the marker at the normalized value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 58} onDrill={() => {}} />)
    const marker = screen.getByTestId('marker-pct_above_50sma')
    expect(marker).toHaveStyle({ left: '58%' })
  })
  it('clicking a meter with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    const withDrill = [{ ...metrics[0], drillKey: 'x_list' }]
    render(<MetersView currentRow={row} metrics={withDrill} normalize={() => 58} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('>50 SMA details'))
    expect(onDrill).toHaveBeenCalledWith(withDrill[0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/MetersView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement MetersView**

```jsx
// app/src/pages/breadth/views/MetersView.jsx
/**
 * Tactical Readout — each metric as a marker on a shared oversold→overbought
 * track with 30/70 reference ticks. Marker color = metricColor (tier-driven).
 */
import { metricColor } from './breadthViewShared'

export default function MetersView({ currentRow, metrics, normalize, onDrill }) {
  if (!currentRow || metrics.length === 0) return null
  return (
    <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ font: '600 10px Instrument Sans, sans-serif', color: '#64748b',
                    textAlign: 'right', marginBottom: 2 }}>oversold ◄ ► overbought</div>
      {metrics.map(m => {
        const norm = normalize(m, currentRow)
        const color = metricColor(m, currentRow)
        const clickable = !!m.drillKey
        return (
          <div key={m.key}
               role={clickable ? 'button' : undefined}
               aria-label={clickable ? `${m.label} details` : undefined}
               onClick={clickable ? () => onDrill(m) : undefined}
               style={{ display: 'grid', gridTemplateColumns: '84px 1fr 52px',
                        alignItems: 'center', gap: 10, cursor: clickable ? 'pointer' : 'default' }}>
            <span style={{ font: '700 9px Instrument Sans, sans-serif', letterSpacing: '.5px',
                           textTransform: 'uppercase', color: '#94a3b8', textAlign: 'right' }}>
              {m.label}
            </span>
            <div style={{ height: 10, borderRadius: 6, position: 'relative',
                          background: 'linear-gradient(90deg,#14532d,#3f6212,#713f12,#7f1d1d)' }}>
              <div style={{ position: 'absolute', top: 0, left: '30%', width: 1, height: 10,
                            background: 'rgba(255,255,255,.25)' }} />
              <div style={{ position: 'absolute', top: 0, left: '70%', width: 1, height: 10,
                            background: 'rgba(255,255,255,.25)' }} />
              {norm != null && (
                <div data-testid={`marker-${m.key}`}
                     style={{ position: 'absolute', top: -3, left: `${norm}%`, width: 4, height: 16,
                              borderRadius: 2, background: color, transform: 'translateX(-2px)',
                              boxShadow: `0 0 8px ${color}`, transition: 'left .4s ease' }} />
              )}
            </div>
            <span style={{ font: '800 13px Instrument Sans, sans-serif', color: '#e2e8f0' }}>
              {m.getFmt(currentRow)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/MetersView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/MetersView.jsx app/src/pages/breadth/views/MetersView.test.jsx
git commit -m "feat(breadth): MetersView tactical oversold/overbought readout"
```

---

## Task 7: TreemapView (move existing treemap into a view component)

Lift the ECharts `option` builder out of `BreadthHeatmap` into a standalone component that receives `currentRow`, `prevRow`, `pctileByKey`, and the visible-metric list. Date navigation and forward-fill move to the container (Task 9).

**Files:**
- Create: `app/src/pages/breadth/views/TreemapView.jsx`
- Test: `app/src/pages/breadth/views/TreemapView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/views/TreemapView.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// echarts-for-react renders a canvas in jsdom; stub it to capture the option.
vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

import TreemapView from './TreemapView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75' },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]

describe('TreemapView', () => {
  it('renders an ECharts treemap for the visible metrics', () => {
    const { getByTestId } = render(
      <TreemapView currentRow={{ breadth_score: 75, up_4pct_today: 383, date: '2026-06-01' }}
                   prevRow={null} pctileByKey={{}} visibleKeys={new Set(['breadth_score', 'up_4pct_today'])}
                   onDrill={() => {}} />,
    )
    expect(getByTestId('echart')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/views/TreemapView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TreemapView**

Create the file with the treemap logic moved from `BreadthHeatmap` (Breadth.jsx lines ~856-1030). Key changes vs the original: (a) it receives `currentRow`/`prevRow`/`pctileByKey`/`visibleKeys`/`onDrill` as props instead of computing `rowIdx`/`filledRows` internally; (b) `TREEMAP_DEF` items are filtered by `visibleKeys`; (c) imports its constants from `Breadth.jsx`.

```jsx
// app/src/pages/breadth/views/TreemapView.jsx
/**
 * Treemap view — the original Breadth heatmap, extracted. Groups → metric tiles,
 * color = 8-tier bull/bear system, click → drill. Date cursor lives in the
 * container; this component is pure-render from props.
 */
import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  HM_METRICS_BY_KEY, TREEMAP_DEF, TIER_CELL_COLORS,
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS,
} from '../../Breadth'

export default function TreemapView({ currentRow, prevRow, pctileByKey, visibleKeys, onDrill }) {
  const option = useMemo(() => {
    if (!currentRow) return {}
    const items = TREEMAP_DEF[0].items.filter(it => visibleKeys.has(it.metricKey))
    const children = items.map(item => {
      const metric = HM_METRICS_BY_KEY[item.metricKey]
      if (!metric) return null
      const tier = metric.getTier(currentRow)
      const val = metric.getFmt(currentRow)
      const color = TIER_CELL_COLORS[tier] ?? TIER_CELL_COLORS['']
      let arrow = ''
      if (prevRow && tier) {
        const prevTier = metric.getTier(prevRow)
        const cur = TIER_SCORES[tier] ?? 3
        const prev = TIER_SCORES[prevTier] ?? 3
        if (cur > prev) arrow = ' ▲'; else if (cur < prev) arrow = ' ▼'
      }
      return {
        name: item.metricKey, value: item.weight, labelText: metric.label,
        valText: val + arrow, tier,
        itemStyle: { color, borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1 },
      }
    }).filter(Boolean)

    return {
      backgroundColor: 'transparent', animation: false,
      tooltip: {
        trigger: 'item', backgroundColor: 'rgba(8,8,8,0.96)', borderColor: '#c9a84c',
        borderWidth: 1, padding: [8, 12],
        textStyle: { color: '#e0e0e0', fontFamily: 'Instrument Sans, sans-serif', fontSize: 11 },
        formatter: params => {
          const d = params.data
          if (!d || !d.tier) return ''
          const metric = HM_METRICS_BY_KEY[d.name]
          if (!metric) return ''
          const score = TIER_SCORES[d.tier]
          const tierLabel = score != null ? (TIER_LABELS[score] ?? '') : 'No signal'
          const tierColor = score != null ? (TIER_TIP_COLORS[score] ?? '#666') : '#666'
          let pctileStr = ''
          const rawVal = currentRow[d.name]
          const sorted = pctileByKey[d.name]
          if (sorted && rawVal != null && !isNaN(Number(rawVal))) {
            const v = Number(rawVal)
            const pct = Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
            pctileStr = `p${pct} of ${sorted.length}d`
          }
          return (
            `<div style="min-width:145px;font-family:Instrument Sans,sans-serif">` +
            `<div style="color:#c9a84c;font-weight:700;margin-bottom:3px">${metric.label}</div>` +
            `<div style="color:#555;font-size:10px;margin-bottom:6px">${currentRow.date}</div>` +
            `<div style="font-size:16px;font-weight:700;margin-bottom:4px">${metric.getFmt(currentRow)}</div>` +
            `<div style="color:${tierColor};font-size:10px;letter-spacing:0.5px${pctileStr ? ';margin-bottom:3px' : ''}">${tierLabel}</div>` +
            (pctileStr ? `<div style="color:#555;font-size:10px">${pctileStr}</div>` : '') +
            `</div>`
          )
        },
      },
      label: {
        show: true,
        formatter: params => {
          if (!params.data.labelText) return ''
          return `{lbl|${params.data.labelText.toUpperCase()}}\n{val|${params.data.valText ?? '—'}}`
        },
        rich: {
          lbl: { fontSize: 11, fontFamily: 'Instrument Sans, sans-serif', fontWeight: 700, color: 'rgba(255,255,255,0.60)', lineHeight: 18 },
          val: { fontSize: 30, fontFamily: 'Instrument Sans, sans-serif', fontWeight: 700, color: '#ffffff', lineHeight: 40 },
        },
        position: 'inside', align: 'center', verticalAlign: 'middle', overflow: 'truncate',
      },
      upperLabel: { show: false },
      series: [{
        type: 'treemap', data: [{ name: 'main', value: 100, children, itemStyle: { color: 'transparent', borderWidth: 0 } }],
        width: '100%', height: '100%', top: 0, bottom: 0, left: 0, right: 0,
        roam: false, nodeClick: false, breadcrumb: { show: false }, visibleMin: 200,
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 1, borderColor: '#0a0f1a' }, upperLabel: { show: false }, label: { show: false } },
          { itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: '#0a0f1a' }, emphasis: { itemStyle: { borderColor: '#c9a84c', borderWidth: 2 } } },
        ],
      }],
    }
  }, [currentRow, prevRow, pctileByKey, visibleKeys])

  if (!currentRow) return null
  return (
    <div style={{ flex: 1, minHeight: 0, height: '100%' }}>
      <ReactECharts
        option={option} style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }} notMerge
        onEvents={{ click: params => {
          const metric = HM_METRICS_BY_KEY[params.data?.name]
          if (metric?.drillKey) onDrill(metric)
        } }}
      />
    </div>
  )
}
```

> When wiring the container (Task 9), confirm the import name for the ECharts wrapper matches the existing `Breadth.jsx` import (`echarts-for-react` default export, currently imported as `ReactECharts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/views/TreemapView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/TreemapView.jsx app/src/pages/breadth/views/TreemapView.test.jsx
git commit -m "feat(breadth): extract TreemapView from BreadthHeatmap"
```

---

## Task 8: BreadthViewSwitcher

**Files:**
- Create: `app/src/pages/breadth/BreadthViewSwitcher.jsx`
- Create: `app/src/pages/breadth/BreadthViewSwitcher.module.css`
- Test: `app/src/pages/breadth/BreadthViewSwitcher.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/BreadthViewSwitcher.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthViewSwitcher from './BreadthViewSwitcher'

describe('BreadthViewSwitcher', () => {
  it('renders a button per style and marks the active one pressed', () => {
    render(<BreadthViewSwitcher viewStyle="rings" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Treemap' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Rings' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('calls onSelect with the chosen style', () => {
    const onSelect = vi.fn()
    render(<BreadthViewSwitcher viewStyle="treemap" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tug' }))
    expect(onSelect).toHaveBeenCalledWith('tug')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewSwitcher.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the switcher + CSS**

```jsx
// app/src/pages/breadth/BreadthViewSwitcher.jsx
/** Style switcher for the Breadth Views tab. */
import styles from './BreadthViewSwitcher.module.css'

const OPTIONS = [
  { key: 'treemap', label: 'Treemap' },
  { key: 'rings',   label: 'Rings' },
  { key: 'tug',     label: 'Tug' },
  { key: 'meters',  label: 'Meters' },
]

export default function BreadthViewSwitcher({ viewStyle, onSelect }) {
  return (
    <div className={styles.switcher} role="group" aria-label="Visualization style">
      {OPTIONS.map(o => (
        <button key={o.key} type="button"
                className={`${styles.btn} ${viewStyle === o.key ? styles.btnActive : ''}`}
                aria-pressed={viewStyle === o.key}
                onClick={() => onSelect(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

```css
/* app/src/pages/breadth/BreadthViewSwitcher.module.css */
.switcher { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
.btn { padding: 5px 14px; border: none; background: transparent; color: #94a3b8;
  font: 700 11px 'Instrument Sans', sans-serif; letter-spacing: .4px; border-radius: 6px;
  cursor: pointer; transition: background .15s, color .15s; }
.btn:hover { color: #e2e8f0; }
.btnActive { background: rgba(201,168,76,0.18); color: #c9a84c; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewSwitcher.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/BreadthViewSwitcher.jsx app/src/pages/breadth/BreadthViewSwitcher.module.css app/src/pages/breadth/BreadthViewSwitcher.test.jsx
git commit -m "feat(breadth): BreadthViewSwitcher style toggle"
```

---

## Task 9: BreadthViews container

Owns date cursor, forward-fill, percentile computation, the `useBreadthViews` hook, the switcher, the Customize panel, and dispatch to the active view.

**Files:**
- Create: `app/src/pages/breadth/BreadthViews.jsx`
- Test: `app/src/pages/breadth/BreadthViews.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/breadth/BreadthViews.test.jsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'

const rows = [
  { date: '2026-06-01', breadth_score: 75, up_4pct_today: 383, down_4pct_today: 208, vix: 16, pct_above_50sma: 57.8 },
  { date: '2026-05-31', breadth_score: 70, up_4pct_today: 300, down_4pct_today: 250, vix: 17, pct_above_50sma: 55 },
]

beforeEach(() => localStorage.clear())

describe('BreadthViews', () => {
  it('defaults to the treemap view', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(screen.getByTestId('echart')).toBeInTheDocument()
  })
  it('switching to Rings swaps the rendered view', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rings' }))
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViews.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the container**

```jsx
// app/src/pages/breadth/BreadthViews.jsx
/**
 * Breadth Views container — owns the date cursor, forward-fill, percentile
 * computation, the useBreadthViews preset hook, and dispatch to the active
 * visualization style. Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useState, useEffect, useMemo } from 'react'
import {
  HM_METRICS, HM_METRICS_BY_KEY, PCTILE_KEYS, FFILL_KEYS,
} from '../Breadth'
import useBreadthViews from './useBreadthViews'
import { normalizeMetric } from './views/breadthViewShared'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import CustomizePanel from './CustomizePanel'
import customizeStyles from './CustomizePanel.module.css'
import TreemapView from './views/TreemapView'
import RingsView from './views/RingsView'
import TugView from './views/TugView'
import MetersView from './views/MetersView'

export default function BreadthViews({ rows, onDrill }) {
  // Computed inside the component (not module top-level) to dodge the
  // Breadth.jsx ⇆ BreadthViews circular-import TDZ: HM_METRICS is only
  // initialized by render time, not during module evaluation.
  const ALL_METRICS = useMemo(() => HM_METRICS.filter(m => !m.isHeader), [])
  const views = useBreadthViews()
  const [rowIdx, setRowIdx] = useState(0)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  useEffect(() => {
    const handler = e => {
      if (e.key === 'ArrowLeft')  setRowIdx(p => Math.min(p + 1, rows.length - 1))
      if (e.key === 'ArrowRight') setRowIdx(p => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows.length])

  const filledRows = useMemo(() => {
    const asc = [...rows].reverse()
    const carry = {}
    const result = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      result.push(filled)
    }
    return result.reverse()
  }, [rows])

  const currentRow = filledRows[rowIdx] ?? filledRows[0]
  const prevRow = filledRows[rowIdx + 3]

  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  const visibleMetrics = useMemo(
    () => ALL_METRICS.filter(m => !views.hidden.has(m.key)),
    [views.hidden],
  )
  const visibleKeys = useMemo(() => new Set(visibleMetrics.map(m => m.key)), [visibleMetrics])
  const normalize = useMemo(
    () => (metric, row) => normalizeMetric(metric, row, pctileByKey),
    [pctileByKey],
  )

  // Views call onDrill(metric); Breadth's openDrill expects (date, metric). Bridge
  // here so view components stay date-agnostic.
  const drill = useMemo(
    () => (metric) => onDrill(currentRow?.date, metric),
    [onDrill, currentRow],
  )

  if (!currentRow) return null

  const common = { currentRow, prevRow, metrics: visibleMetrics, normalize, onDrill: drill }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', flexWrap: 'wrap' }}>
        <BreadthViewSwitcher viewStyle={views.viewStyle} onSelect={views.setViewStyle} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setRowIdx(p => Math.min(p + 1, rows.length - 1))}
                  disabled={rowIdx >= rows.length - 1} aria-label="Previous day">←</button>
          <span style={{ font: '600 12px Instrument Sans, sans-serif', color: '#cbd5e1' }}>{currentRow.date}</span>
          <button onClick={() => setRowIdx(p => Math.max(p - 1, 0))}
                  disabled={rowIdx === 0} aria-label="Next day">→</button>
          {rowIdx > 0 && <button onClick={() => setRowIdx(0)}>LATEST</button>}
        </div>
        <div className={customizeStyles.anchor} style={{ marginLeft: 'auto' }}>
          <button className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                  onClick={() => setCustomizeOpen(o => !o)} title="Customize which metrics show">
            <span className={customizeStyles.triggerIcon}>⚙</span> Customize
          </button>
          {customizeOpen && (
            <CustomizePanel
              title="Customize Breadth Views"
              cols={ALL_METRICS}
              activePreset={views.activePreset}
              hidden={views.hidden}
              presetNames={views.presetNames}
              isDefaultActive={views.isDefaultActive}
              onToggleHidden={views.toggleHidden}
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

      <div style={{ flex: 1, minHeight: 0 }}>
        {views.viewStyle === 'treemap' && (
          <TreemapView currentRow={currentRow} prevRow={prevRow} pctileByKey={pctileByKey}
                       visibleKeys={visibleKeys} onDrill={drill} />
        )}
        {views.viewStyle === 'rings'  && <RingsView  {...common} />}
        {views.viewStyle === 'tug'    && <TugView    {...common} />}
        {views.viewStyle === 'meters' && <MetersView {...common} />}
      </div>
    </div>
  )
}
```

> `CustomizePanel` ignores the `title` prop until Task 10 adds it; the panel still renders. The test does not assert the title, so this task passes independently.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViews.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/BreadthViews.jsx app/src/pages/breadth/BreadthViews.test.jsx
git commit -m "feat(breadth): BreadthViews container wiring all four styles"
```

---

## Task 10: Wire into Breadth.jsx + CustomizePanel title

Replace the `BreadthHeatmap` render with `<BreadthViews>`, relabel the tab, and give `CustomizePanel` an optional title.

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Modify: `app/src/pages/breadth/CustomizePanel.jsx`

- [ ] **Step 1: Add optional `title` to CustomizePanel**

In `CustomizePanel.jsx`, add `title` to the destructured props (default keeps current copy) and use it in the header:

```jsx
export default function CustomizePanel({
  title = 'Customize Breadth Sheet',
  cols,
  /* …rest unchanged… */
}) {
  /* … */
  // In the header markup, replace the hard-coded <h2> text:
  //   <h2 className={styles.title}>Customize Breadth Sheet</h2>
  // with:
  //   <h2 className={styles.title}>{title}</h2>
```

Also update the `aria-label` on the panel root from `"Customize Breadth Sheet"` to `{title}`.

- [ ] **Step 2: Replace the heatmap render in Breadth.jsx**

At the top of `Breadth.jsx`, add the import:

```jsx
import BreadthViews from './breadth/BreadthViews'
```

Replace this block (~line 1422):

```jsx
{rows.length > 0 && activeTab === 'heatmap' && (
  <BreadthHeatmap rows={rows} onDrill={openDrill} />
)}
```

with:

```jsx
{rows.length > 0 && activeTab === 'heatmap' && (
  <BreadthViews rows={rows} onDrill={openDrill} />
)}
```

Delete the now-unused `BreadthHeatmap` function definition (the block starting `function BreadthHeatmap({ rows, onDrill }) {` near line 804 through its closing). The treemap-specific constants it used are now exported (Task 3) and consumed by `TreemapView`, so leave those constants in place.

- [ ] **Step 3: Relabel the tab to "Views"**

In all five tab-bar render blocks (lines ~1288, 1308, 1328, 1345 and any other), change the Heatmap button text from `Heatmap` to `Views`. Keep the internal value `'heatmap'` unchanged (`onClick={() => setActiveTab('heatmap')}` and the `activeTab === 'heatmap'` checks stay as-is).

- [ ] **Step 4: Verify the app builds and the suite is green**

Run: `cd app && npx vitest run src/pages/breadth/ && npm run build`
Expected: all breadth tests PASS; Vite build completes with no errors.

> Per project memory: `vite.config.js` `manualChunks` must stay object form, and a local `npm run build` is required before pushing. This step covers the build check.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/breadth/CustomizePanel.jsx
git commit -m "feat(breadth): mount BreadthViews on the Views tab; CustomizePanel title prop"
```

---

## Task 11: Full verification + push

- [ ] **Step 1: Run the entire breadth test suite**

Run: `cd app && npx vitest run src/pages/breadth src/pages/Breadth*`
Expected: PASS, including the pre-existing `useBreadthCustomize.test.js` (untouched).

- [ ] **Step 2: Production build**

Run: `cd app && npm run build`
Expected: clean build.

- [ ] **Step 3: Manual smoke (local dev)**

Run backend + `cd app && npm run dev`. On `/breadth` → **Views** tab:
- Treemap renders as before (default).
- Switch to Rings / Tug / Meters — each renders; ←/→ change the date across all.
- Open ⚙ Customize, Save as "Test", hide a metric, switch style — selection + style persist; reload page → preset + style restored.
- Click a tile/ring/bar/meter with a drill metric → DrillModal opens.

- [ ] **Step 4: Push (Railway deploy)**

```bash
git push
```

Per project memory (`feedback_always_push`): push to deploy after the build is green.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** four styles (Tasks 4-7), shared registry + `getValue`/`polarity`/`pair` (Tasks 1, 3), universal normalizer (Task 1), customization reuse via `useBreadthViews` + `CustomizePanel` (Tasks 2, 9, 10), drill-through (Tasks 4-7, 9), composable-ready uniform prop contract (`{ currentRow, prevRow, metrics, normalize, onDrill }`, Task 9), Monitor tab untouched (Task 10 leaves the `breadth` branch alone).
- **Type consistency:** the view prop contract, `normalize(metric,row)`, `onDrill(metric)`, and `metricColor(metric,row)` signatures match across all view components and the container.
- **Out of scope (per spec):** composable canvas, Dashboard tile, "Signal of the Day"/auto-notable callout, backend changes.
