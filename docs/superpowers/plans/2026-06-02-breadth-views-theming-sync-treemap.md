# Breadth Views — Theming, Cross-Device Sync, Treemap Weighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the three deferred Breadth Views enhancements so the tool is fully usable: (1) per-view color **palette + intensity** theming, (2) **cross-device preset sync** via server preferences with localStorage fallback, (3) **Treemap weight modes**.

**Architecture:** All three ride the infrastructure already built (per-view `options` schema in `viewMetricConfig.js`, the v2 `useBreadthViews` store, `usePreferences`). Palette/intensity become two more per-view options consumed by a new `resolveViewColors()` color resolver in `breadthViewShared.js`. Sync layers `usePreferences` onto `useBreadthViews` (injectable for tests). Treemap gains a `weightBy` option.

**Tech Stack:** React + Vite (JS, NO TypeScript), Vitest + @testing-library/react.

**Design (approved inline 2026-06-02):**
- Palettes: **Classic** (green/red — current look), **Colorblind** (blue/orange), **Mono** (gold), **Ocean** (cyan/rose). Each = 8-tier map + bull/bear accents. Intensity: subtle / normal (= current) / bold (opacity + glow).
- Theming applies to the 7 chart-style views (Rings, Tug, Meters, Timeline, Radar, Scoreboard, Levels). **Treemap keeps its dark heatmap identity** and gets `weightBy` instead.
- Sync: server wins for logged-in; localStorage for logged-out; one-time migrate-local-up on first login. No backend change (prefs endpoint already stores arbitrary JSON).

---

## File Structure

**Modified**
- `app/src/pages/breadth/useBreadthViews.js` — add server sync (injectable prefs hook), extract `serializeState`.
- `app/src/pages/breadth/useBreadthViews.test.js` — inject stub prefs hook in existing tests + add sync tests.
- `app/src/pages/breadth/views/breadthViewShared.js` — add `PALETTES`, `resolveViewColors`; widen `metricColor` signature.
- `app/src/pages/breadth/views/breadthViewShared.test.js` — palette/resolver tests.
- `app/src/pages/breadth/views/viewMetricConfig.js` — add `THEME_OPTIONS` (palette+intensity) to 7 views; `weightBy` to treemap.
- `app/src/pages/breadth/views/viewMetricConfig.test.js` — assert option presence.
- View renderers: `RingsView.jsx`, `MetersView.jsx`, `TimelineView.jsx`, `EqualizerView.jsx` (tier-color views); `TugView.jsx`, `RadarView.jsx`, `ScoreboardView.jsx` (accent views); `TreemapView.jsx` (weight).
- `app/src/pages/breadth/BreadthViews.jsx` — pass `options` into the explicit `TreemapView` render.
- New view test files as specified per task.

**Reference shape:** option schema entry = `{ name, label, type:'select', choices:[{value,label}], default }`. `useBreadthViews` resolved `options` already merges schema defaults under the active preset's overrides, and the Customize panel renders any view's options generically — so new options need NO panel changes.

---

## Task 1: Cross-device preset sync in `useBreadthViews`

**Files:**
- Modify: `app/src/pages/breadth/useBreadthViews.js`
- Modify: `app/src/pages/breadth/useBreadthViews.test.js`

The hook gains an injectable prefs dependency (default `usePreferences`) so sync is unit-testable without mocking `fetch`/SWR.

- [ ] **Step 1: Update the existing test file to inject a stub prefs hook, then add sync tests**

At the top of `useBreadthViews.test.js`, after the existing imports, add a default stub and update the `render` helper. Replace the existing line `const render = () => renderHook(() => useBreadthViews(ALL))` with:

```js
// Default: a logged-out-style stub (empty server, no-op writer) so existing
// behavioral tests stay hermetic and deterministic.
const stubPrefs = (over = {}) => () => ({ prefs: {}, setPref: () => {}, loading: false, ...over })
const render = (usePrefs = stubPrefs()) => renderHook(() => useBreadthViews(ALL, usePrefs))
```

Then append this describe block at the end of the file:

```js
describe('useBreadthViews server sync', () => {
  it('adopts the server config on first load (server wins)', () => {
    const serverCfg = {
      viewStyle: 'radar',
      byView: { radar: { activePreset: 'Srv', presets: { Srv: { visible: ['breadth_score'], options: {} } } } },
    }
    const usePrefs = () => ({ prefs: { breadth_views_config: serverCfg }, setPref: () => {}, loading: false })
    const { result } = render(usePrefs)
    expect(result.current.viewStyle).toBe('radar')
    expect(result.current.presetNames).toContain('Srv')
  })

  it('does not adopt while prefs are still loading', () => {
    const usePrefs = () => ({ prefs: {}, setPref: () => {}, loading: true })
    const { result } = render(usePrefs)
    // stays on local default; no crash
    expect(result.current.viewStyle).toBe('treemap')
  })

  it('pushes local presets up to the server when the server is empty', () => {
    // seed a local custom preset first
    localStorage.setItem('uct.breadth.views.v2', JSON.stringify({
      viewStyle: 'meters',
      byView: { meters: { activePreset: 'Local', presets: { Local: { visible: ['vix'], options: {} } } } },
    }))
    const setPref = vi.fn()
    const usePrefs = () => ({ prefs: {}, setPref, loading: false })
    render(usePrefs)
    expect(setPref).toHaveBeenCalledWith('breadth_views_config', expect.objectContaining({ viewStyle: 'meters' }))
  })

  it('writes saves through to the server after hydration', async () => {
    const setPref = vi.fn()
    const usePrefs = () => ({ prefs: {}, setPref, loading: false })
    const { result } = render(usePrefs)
    setPref.mockClear()  // ignore any migrate-up call
    act(() => result.current.setViewStyle('radar'))
    act(() => result.current.savePreset('New'))
    await waitFor(() => expect(setPref).toHaveBeenCalledWith('breadth_views_config', expect.objectContaining({ viewStyle: 'radar' })))
  })
})
```

Add `vi` and `waitFor` to the imports at the top:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: the 4 new sync tests FAIL (hook takes only `allMetrics`, no prefs param / no server write); the 11 existing tests still PASS (stub injected).

- [ ] **Step 3: Implement sync in `useBreadthViews.js`**

Add the import near the top (after the viewMetricConfig import):
```js
import usePreferences from '../../hooks/usePreferences'
```
Add a constant near the other exports:
```js
export const PREF_KEY = 'breadth_views_config'
```

Extract serialization — replace the existing `writeToStorage` function with:
```js
function serializeState(state) {
  const byView = {}
  for (const s of STYLES) {
    const v = state.byView[s]
    const presets = {}
    for (const [name, p] of Object.entries(v.presets)) {
      const out = { options: p.options ?? {} }
      if (p.visible) out.visible = p.visible
      else if (p.hidden) out.hidden = p.hidden
      else out.visible = []
      presets[name] = out
    }
    byView[s] = { activePreset: v.activePreset, presets }
  }
  return { viewStyle: state.viewStyle, byView }
}

function writeToStorage(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state))) } catch { /* best-effort */ }
}
```

Change the hook signature and add the sync effects. Replace the signature line and the two existing persistence effects:
```js
export default function useBreadthViews(allMetrics = [], usePrefs = usePreferences) {
  const [state, setState] = useState(() => loadFromStorage())
  const { prefs, setPref, loading } = usePrefs()

  const stateRef = useRef(state)
  const hydratedRef = useRef(false)
  const writeTimer = useRef(null)

  // Persist on change: localStorage always; server once hydrated.
  useEffect(() => {
    stateRef.current = state
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      writeToStorage(stateRef.current)
      if (hydratedRef.current) {
        try { setPref(PREF_KEY, serializeState(stateRef.current)) } catch { /* best-effort */ }
      }
    }, 150)
  }, [state, setPref])

  // Flush local on unmount (server flush skipped to avoid post-unmount writes).
  useEffect(() => () => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeToStorage(stateRef.current)
  }, [])

  // Hydrate once from the server (server wins); else migrate local presets up.
  useEffect(() => {
    if (hydratedRef.current || loading) return
    hydratedRef.current = true
    const remote = prefs?.[PREF_KEY]
    if (remote && typeof remote === 'object' && remote.byView) {
      const viewStyle = isStyle(remote.viewStyle) ? remote.viewStyle : DEFAULT_STYLE
      setState({ viewStyle, byView: sanitizeByView(remote.byView) })
    } else {
      const serial = serializeState(stateRef.current)
      const hasCustom = STYLES.some(s => Object.keys(serial.byView[s].presets).length > 0)
      if (hasCustom) { try { setPref(PREF_KEY, serial) } catch { /* best-effort */ } }
    }
  }, [loading, prefs, setPref])
```

(The rest of the hook — `viewStyle`, `view`, resolvers, mutators, return — is unchanged.)

- [ ] **Step 4: Run to verify all pass**

Run: `cd app && npx vitest run src/pages/breadth/useBreadthViews.test.js`
Expected: PASS — 11 existing + 4 sync = 15.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/useBreadthViews.js app/src/pages/breadth/useBreadthViews.test.js
git commit -m "feat(breadth): cross-device sync for Views presets (server + local fallback)"
```

---

## Task 2: Palette + intensity core (`breadthViewShared.js` + schema options)

**Files:**
- Modify: `app/src/pages/breadth/views/breadthViewShared.js`
- Modify: `app/src/pages/breadth/views/breadthViewShared.test.js`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.test.js`

- [ ] **Step 1: Write failing tests (shared color resolver)**

Append to `breadthViewShared.test.js`:
```js
import { PALETTES, resolveViewColors, metricColor as metricColorFn } from './breadthViewShared'

describe('palettes + resolveViewColors', () => {
  it('exposes the four palettes each with a full tier map + accents', () => {
    for (const key of ['classic', 'colorblind', 'mono', 'ocean']) {
      const p = PALETTES[key]
      expect(p, key).toBeTruthy()
      for (const tier of ['g3','g2','g1','a','r1','r2','r3','']) expect(typeof p.tier[tier]).toBe('string')
      expect(typeof p.bull).toBe('string')
      expect(typeof p.bear).toBe('string')
    }
  })
  it('classic palette preserves the current look (bull #34d399 / bear #f87171)', () => {
    expect(PALETTES.classic.bull).toBe('#34d399')
    expect(PALETTES.classic.bear).toBe('#f87171')
  })
  it('resolveViewColors merges palette + intensity', () => {
    const subtle = resolveViewColors('ocean', 'subtle')
    expect(subtle.bull).toBe(PALETTES.ocean.bull)
    expect(subtle.fillOpacity).toBeLessThan(1)
    expect(subtle.dim).toBe(true)
    const bold = resolveViewColors('classic', 'bold')
    expect(bold.fillOpacity).toBe(1)
    expect(bold.glow).toBe(true)
    const normal = resolveViewColors()  // defaults
    expect(normal.tier).toBe(PALETTES.classic.tier)
    expect(normal.fillOpacity).toBe(1)
    expect(normal.glow).toBe(false)
  })
  it('metricColor honors a passed tier map', () => {
    const m = { getTier: () => 'g3' }
    expect(metricColorFn(m, {}, PALETTES.ocean.tier)).toBe(PALETTES.ocean.tier.g3)
    expect(metricColorFn(m, {})).toBe(PALETTES.classic.tier.g3)  // default
  })
})
```

Append to `viewMetricConfig.test.js`:
```js
import { optionsSchema as optsSchema } from './viewMetricConfig'

describe('theming + treemap options', () => {
  const names = (style) => optsSchema(style).map(o => o.name)
  it('the 7 chart views expose palette + intensity', () => {
    for (const s of ['rings','tug','meters','timeline','radar','scoreboard','equalizer']) {
      expect(names(s), s).toEqual(expect.arrayContaining(['palette', 'intensity']))
    }
  })
  it('treemap exposes weightBy but not palette', () => {
    expect(names('treemap')).toContain('weightBy')
    expect(names('treemap')).not.toContain('palette')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js src/pages/breadth/views/viewMetricConfig.test.js`
Expected: FAIL — `PALETTES`/`resolveViewColors` undefined; options missing.

- [ ] **Step 3a: Add palettes + resolver to `breadthViewShared.js`**

Find the existing block:
```js
const VIEW_TIER_COLOR = {
  g3: '#22c55e', g2: '#4ade80', g1: '#86efac', a: '#fbbf24',
  r1: '#fca5a5', r2: '#f87171', r3: '#ef4444', '': '#475569',
}
export function metricColor(metric, row) {
  const tier = metric.getTier ? (metric.getTier(row) || '') : ''
  return VIEW_TIER_COLOR[tier] ?? VIEW_TIER_COLOR['']
}
```
Replace it with:
```js
const VIEW_TIER_COLOR = {
  g3: '#22c55e', g2: '#4ade80', g1: '#86efac', a: '#fbbf24',
  r1: '#fca5a5', r2: '#f87171', r3: '#ef4444', '': '#475569',
}

// Per-view selectable palettes. `classic` reproduces the historical look exactly
// (bull #34d399 / bear #f87171 match the pre-theming Radar/Scoreboard colors).
export const PALETTES = {
  classic: { tier: VIEW_TIER_COLOR, bull: '#34d399', bear: '#f87171' },
  colorblind: {
    tier: { g3: '#1d4ed8', g2: '#3b82f6', g1: '#93c5fd', a: '#facc15', r1: '#fdba74', r2: '#fb923c', r3: '#ea580c', '': '#475569' },
    bull: '#3b82f6', bear: '#f97316',
  },
  mono: {
    tier: { g3: '#d4af37', g2: '#c9a84c', g1: '#e8d8a0', a: '#9c8a4e', r1: '#9aa0a6', r2: '#6b7280', r3: '#4b5563', '': '#475569' },
    bull: '#d4af37', bear: '#6b7280',
  },
  ocean: {
    tier: { g3: '#0891b2', g2: '#22d3ee', g1: '#a5f3fc', a: '#fbbf24', r1: '#fecaca', r2: '#fb7185', r3: '#e11d48', '': '#475569' },
    bull: '#22d3ee', bear: '#fb7185',
  },
}

// Resolve a view's color context from its palette + intensity options.
// intensity: 'subtle' (lower opacity, no glow) | 'normal' (current look) | 'bold' (glow).
export function resolveViewColors(paletteKey = 'classic', intensityKey = 'normal') {
  const p = PALETTES[paletteKey] ?? PALETTES.classic
  return {
    tier: p.tier, bull: p.bull, bear: p.bear,
    fillOpacity: intensityKey === 'subtle' ? 0.6 : 1,
    glow: intensityKey === 'bold',
    dim: intensityKey === 'subtle',
  }
}

export function metricColor(metric, row, tierMap = VIEW_TIER_COLOR) {
  const tier = metric.getTier ? (metric.getTier(row) || '') : ''
  return tierMap[tier] ?? tierMap[''] ?? VIEW_TIER_COLOR['']
}
```

- [ ] **Step 3b: Add the option schemas to `viewMetricConfig.js`**

After the existing `*_OPTIONS` consts and before `VIEW_CONFIG`, add:
```js
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
```
Then update `VIEW_CONFIG` so the 7 chart views append `THEME_OPTIONS` and treemap uses `TREEMAP_OPTIONS`. Change each `options:` entry to:
```js
  treemap:    { label: 'Treemap',    eligibleKeys: all,       defaultVisible: [], options: TREEMAP_OPTIONS },
  rings:      { label: 'Rings',      eligibleKeys: all,       defaultVisible: HEADLINE, options: THEME_OPTIONS },
  tug:        { label: 'Tug',        eligibleKeys: pairsOnly, defaultVisible: TUG_DEFAULT, options: THEME_OPTIONS },
  meters:     { label: 'Meters',     eligibleKeys: all,       defaultVisible: HEADLINE, options: [...METERS_OPTIONS, ...THEME_OPTIONS] },
  timeline:   { label: 'Timeline',   eligibleKeys: all,       defaultVisible: TIMELINE_DEFAULT, options: [...TIMELINE_OPTIONS, ...THEME_OPTIONS] },
  radar:      { label: 'Radar',      eligibleKeys: all,       defaultVisible: RADAR_DEFAULT, options: [...RADAR_OPTIONS, ...THEME_OPTIONS] },
  scoreboard: { label: 'Scoreboard', eligibleKeys: all,       defaultVisible: [], options: [...SCOREBOARD_OPTIONS, ...THEME_OPTIONS] },
  equalizer:  { label: 'Levels',     eligibleKeys: all,       defaultVisible: LEVELS_DEFAULT, options: [...LEVELS_OPTIONS, ...THEME_OPTIONS] },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthViewShared.test.js src/pages/breadth/views/viewMetricConfig.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/breadthViewShared.js app/src/pages/breadth/views/breadthViewShared.test.js app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewMetricConfig.test.js
git commit -m "feat(breadth): palette + intensity color system + per-view theme options"
```

---

## Task 3: Wire palette/intensity into the tier-color views (Rings, Meters, Timeline, Levels)

**Files:**
- Modify: `RingsView.jsx`, `MetersView.jsx`, `TimelineView.jsx`, `EqualizerView.jsx`
- Test: `app/src/pages/breadth/views/themingTierViews.test.jsx` (create)

Each of these resolves `metricColor` via the palette tier map and applies intensity (opacity/glow).

- [ ] **Step 1: Write failing test**

```jsx
// app/src/pages/breadth/views/themingTierViews.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MetersView from './MetersView'
import EqualizerView from './EqualizerView'
import TimelineView from './TimelineView'
import { PALETTES } from './breadthViewShared'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null, getFmt: () => key, getTier: () => 'g3' })
const metrics = [mk('a')]
const row = { date: 'd' }
const normalize = () => 80

describe('tier views honor palette', () => {
  it('Meters marker uses the ocean palette g3 color', () => {
    const { container } = render(<MetersView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'normal' }} />)
    const marker = container.querySelector('[data-testid="marker-a"]')
    // ocean g3 = #0891b2; jsdom may keep hex or normalize to rgb(8,145,178)
    expect(marker.style.background.replace(/\s/g, '')).toMatch(/#0891b2|rgb\(8,145,178\)/i)
  })
  it('Levels bar uses palette color and subtle intensity lowers opacity', () => {
    const { container } = render(<EqualizerView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'subtle' }} />)
    const bar = container.querySelector('[data-testid="level-a"]')
    expect(bar).toBeTruthy()
    expect(Number(bar.style.opacity)).toBeLessThan(1)
  })
  it('Timeline cell uses palette color', () => {
    const rows = [row]
    const { container } = render(<TimelineView recentRows={rows} metrics={metrics}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', windowDays: 10 }} />)
    const cell = container.querySelector('[data-testid="cell-a-0"]')
    expect(cell.style.background.replace(/\s/g, '')).toMatch(/#0891b2|rgb\(8,145,178\)/i)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/breadth/views/themingTierViews.test.jsx`
Expected: FAIL — views ignore palette; `data-testid` hooks (`level-a`, `cell-a-0`) not present yet.

- [ ] **Step 3a: MetersView.jsx**

Change the import to include `resolveViewColors`, resolve colors, pass tier map to `metricColor`, and apply opacity:
```jsx
import { metricColor, sortVisibleMetrics, resolveViewColors } from './breadthViewShared'
```
After the `ordered` line add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
Change `const color = metricColor(m, currentRow)` → `const color = metricColor(m, currentRow, colors.tier)`.
On the marker div (the one with `data-testid={\`marker-${m.key}\`}`) add `opacity: colors.fillOpacity` to its style and make the box-shadow intensity-aware: replace `boxShadow: \`0 0 8px ${color}\`` with `boxShadow: colors.dim ? 'none' : \`0 0 ${colors.glow ? 14 : 8}px ${color}\``.

- [ ] **Step 3b: EqualizerView.jsx**

```jsx
import { metricColor, sortVisibleMetrics, resolveViewColors } from './breadthViewShared'
```
After `ordered`:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
Change `const color = metricColor(m, currentRow)` → `const color = metricColor(m, currentRow, colors.tier)`.
On the bar div (the one with `className={isNotable ? signalStyles.pulse : undefined}` and the gradient background) add `data-testid={\`level-${m.key}\`}`, add `opacity: colors.fillOpacity`, and make its boxShadow intensity-aware: keep the signal outline but add glow when `colors.glow` — replace `boxShadow: isSignal ? '0 0 0 1px #c9a84c, 0 0 10px rgba(201,168,76,.4)' : 'none'` with `boxShadow: isSignal ? '0 0 0 1px #c9a84c, 0 0 10px rgba(201,168,76,.4)' : (colors.glow ? \`0 0 10px ${color}\` : 'none')`.

- [ ] **Step 3c: TimelineView.jsx**

```jsx
import { metricColor, resolveViewColors } from './breadthViewShared'
```
Add `options = {}` to the signature (it already has `options` from Task 9 windowDays — confirm; if present, reuse). After computing `days`, add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
On the day-cell div, add a testid and use the palette map + opacity:
```jsx
                <div key={i} data-testid={`cell-${m.key}-${i}`} title={`${m.label} · ${row.date}: ${m.getFmt(row)}`}
                     style={{ height: 16, borderRadius: 2, background: metricColor(m, row, colors.tier), opacity: colors.fillOpacity }} />
```

- [ ] **Step 3d: RingsView.jsx**

```jsx
import { metricColor, resolveViewColors } from './breadthViewShared'
```
Thread colors from the view into `Ring`. In `RingsView`, after the guard add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
Add `options = {}` to `RingsView`'s signature. Pass `colors` into `ringFor`/`Ring`:
```jsx
  const ringFor = (m, size) => (
    <Ring key={m.key} metric={m} row={currentRow} norm={normalize(m, currentRow)} size={size}
          onDrill={onDrill} isSignal={m.key === signalKey} isNotable={m.key === notableKey} colors={colors} />
  )
```
In `Ring`, add `colors` to its props and change `const color = metricColor(metric, row)` → `const color = metricColor(metric, row, colors.tier)`. Apply intensity to the arc circle: add `opacity={colors.fillOpacity}` to the value-arc `<circle>` and make its drop-shadow glow-aware (`filter: colors.dim ? 'none' : \`drop-shadow(0 0 ${colors.glow ? 9 : 5}px ${color}66)\``).

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/breadth/views/themingTierViews.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/RingsView.jsx app/src/pages/breadth/views/MetersView.jsx app/src/pages/breadth/views/TimelineView.jsx app/src/pages/breadth/views/EqualizerView.jsx app/src/pages/breadth/views/themingTierViews.test.jsx
git commit -m "feat(breadth): palette + intensity in Rings/Meters/Timeline/Levels"
```

---

## Task 4: Wire palette/intensity into the accent views (Tug, Radar, Scoreboard)

**Files:**
- Modify: `TugView.jsx`, `RadarView.jsx`, `ScoreboardView.jsx`
- Test: `app/src/pages/breadth/views/themingAccentViews.test.jsx` (create)

These use bull/bear accents rather than the tier map.

- [ ] **Step 1: Write failing test**

```jsx
// app/src/pages/breadth/views/themingAccentViews.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RadarView from './RadarView'
import { PALETTES } from './breadthViewShared'

const mk = (key) => ({ key, label: key, polarity: 'bull', drillKey: null, getFmt: () => key, getTier: () => 'g3' })
const metrics = Array.from({ length: 4 }, (_, i) => mk(`m${i}`))
const row = { date: 'd' }
const normalize = () => 70

describe('accent views honor palette', () => {
  it('Radar polygon uses the ocean bull accent', () => {
    const { container } = render(<RadarView currentRow={row} metrics={metrics} normalize={normalize}
      onDrill={() => {}} signalKey={null} notableKey={null} options={{ palette: 'ocean', intensity: 'normal' }} />)
    const poly = container.querySelector('polygon[stroke]:not([stroke="#1e293b"])')
    // ocean bull = #22d3ee → rgb(34, 211, 238)
    expect(poly.getAttribute('stroke').replace(/\s/g, '')).toMatch(/#22d3ee|rgb\(34,211,238\)/)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/breadth/views/themingAccentViews.test.jsx`
Expected: FAIL — Radar polygon hardcoded `#34d399`.

- [ ] **Step 3a: RadarView.jsx**

Add the import:
```jsx
import { resolveViewColors } from './breadthViewShared'
```
After the guard / `MAX_SPOKES` block, add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
Replace the value polygon + dots colors: change the fill polygon `fill="rgba(52,211,153,.18)" stroke="#34d399"` to use the bull accent:
```jsx
        <polygon points={polyStr} fill={`${colors.bull}2e`} stroke={colors.bull} strokeWidth="2" />
        {valPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={colors.bull} />)}
```
(`2e` hex alpha ≈ 0.18.) RadarView already accepts `options` from Task 6; reuse it.

- [ ] **Step 3b: TugView.jsx**

Add the import + signature `options = {}`, resolve colors, replace the hardcoded bull/bear:
```jsx
import { metricValue, netPosture, resolveViewColors } from './breadthViewShared'
```
After `const posture = ...` add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
In the paired-row render, change `color="#b91c1c"` (down Side) to `color={colors.bear}` and `color="#16a34a"` (up Side) to `color={colors.bull}`. In `SingleBar`, accept a `colors` prop and change `const color = isBull ? '#16a34a' : '#b91c1c'` → `const color = isBull ? colors.bull : colors.bear`; pass `colors={colors}` where `<SingleBar .../>` is rendered. The NET POSTURE line keeps its existing `#34d399`/`#f87171`.

- [ ] **Step 3c: ScoreboardView.jsx**

Add `resolveViewColors` to the import, resolve colors, and feed accents into the sparkline. Change the import:
```jsx
import { metricValue, sortVisibleMetrics, resolveViewColors } from './breadthViewShared'
```
Change `buildSpark(values, polarity)` to take accents: `function buildSpark(values, polarity, bull, bear)` and inside replace `color: bullish ? '#34d399' : '#f87171'` with `color: bullish ? bull : bear`. In the component, after computing `ordered`, add:
```jsx
  const colors = resolveViewColors(options.palette, options.intensity)
```
and change the spark call `buildSpark(asc.map(r => metricValue(m, r)), m.polarity)` → `buildSpark(asc.map(r => metricValue(m, r)), m.polarity, colors.bull, colors.bear)`.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/breadth/views/themingAccentViews.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/RadarView.jsx app/src/pages/breadth/views/TugView.jsx app/src/pages/breadth/views/ScoreboardView.jsx app/src/pages/breadth/views/themingAccentViews.test.jsx
git commit -m "feat(breadth): palette + intensity in Tug/Radar/Scoreboard accents"
```

---

## Task 5: Treemap `weightBy` modes

**Files:**
- Modify: `app/src/pages/breadth/views/TreemapView.jsx`
- Modify: `app/src/pages/breadth/BreadthViews.jsx` (pass `options` into the explicit Treemap render)
- Test: `app/src/pages/breadth/views/TreemapView.test.jsx` (extend or create)

- [ ] **Step 1: Write failing test**

```jsx
// app/src/pages/breadth/views/TreemapView.weight.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Mock the Breadth.jsx re-exports the view consumes so the test stays isolated.
vi.mock('../../Breadth', () => ({
  HM_METRICS_BY_KEY: {
    a: { key: 'a', label: 'A', getTier: () => 'g3', getFmt: () => '1' },
    b: { key: 'b', label: 'B', getTier: () => 'r3', getFmt: () => '2' },
  },
  TREEMAP_DEF: [{ items: [{ metricKey: 'a', weight: 90 }, { metricKey: 'b', weight: 10 }] }],
  TIER_CELL_COLORS: { g3: '#063', r3: '#600', '': '#333' },
  TIER_SCORES: { g3: 0, r3: 6 }, TIER_LABELS: {}, TIER_TIP_COLORS: {},
}))

// Capture the echarts option object.
let captured = null
vi.mock('echarts-for-react', () => ({ default: (props) => { captured = props.option; return null } }))

import TreemapView from './TreemapView'

const base = {
  currentRow: { date: 'd', a: 1, b: 2 }, prevRow: null, pctileByKey: {},
  visibleKeys: new Set(['a', 'b']), signalKey: null, notableKey: null, onDrill: () => {},
}
const children = () => captured.series[0].data[0].children

describe('TreemapView weightBy', () => {
  it('curated (default) uses item.weight', () => {
    render(<TreemapView {...base} options={{ weightBy: 'curated' }} />)
    const c = children()
    expect(c.find(x => x.name === 'a').value).toBe(90)
    expect(c.find(x => x.name === 'b').value).toBe(10)
  })
  it('equal makes every tile the same size', () => {
    render(<TreemapView {...base} options={{ weightBy: 'equal' }} />)
    const c = children()
    expect(c.find(x => x.name === 'a').value).toBe(c.find(x => x.name === 'b').value)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && npx vitest run src/pages/breadth/views/TreemapView.weight.test.jsx`
Expected: FAIL — Treemap ignores `options.weightBy` (always uses `item.weight`).

- [ ] **Step 3a: TreemapView.jsx**

Add `options = {}` to the signature, and compute each child's `value` by mode. Replace the `value: item.weight` and the `items` derivation:

Change signature:
```jsx
export default function TreemapView({ currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, onDrill, options = {} }) {
```
Inside the `useMemo`, after `const items = ...filter(...)`, add a weight helper:
```jsx
    const weightBy = options.weightBy ?? 'curated'
    const tileWeight = (item, metric) => {
      if (weightBy === 'equal') return 1
      if (weightBy === 'extremity') {
        const sorted = pctileByKey[item.metricKey]
        const raw = currentRow[item.metricKey]
        if (sorted && raw != null && !isNaN(Number(raw))) {
          const v = Number(raw)
          const pct = sorted.filter(x => x <= v).length / sorted.length * 100
          return Math.max(1, Math.abs(pct - 50))
        }
        return 1
      }
      return item.weight  // curated
    }
```
Change `name: item.metricKey, value: item.weight,` → `name: item.metricKey, value: tileWeight(item, metric),`.
Add `options` to the `useMemo` dependency array: `[currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, options]`.

- [ ] **Step 3b: BreadthViews.jsx — pass options into Treemap**

The Treemap render currently passes explicit props (it is NOT in the `common` spread). Add `options={views.options}` to it:
```jsx
          <TreemapView currentRow={currentRow} prevRow={prevRow} pctileByKey={pctileByKey}
                       visibleKeys={visibleKeys} signalKey={signals.signalKey}
                       notableKey={signals.notableKey} onDrill={drill} options={views.options} />
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/breadth/views/TreemapView.weight.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/views/TreemapView.jsx app/src/pages/breadth/BreadthViews.jsx app/src/pages/breadth/views/TreemapView.weight.test.jsx
git commit -m "feat(breadth): Treemap weightBy modes (curated/equal/extremity)"
```

---

## Task 6: Full-suite verification + build

**Files:** none (verification only)

- [ ] **Step 1: Run the full breadth folder**

Run: `cd app && npx vitest run src/pages/breadth/`
Expected: PASS — prior 118 + new (~15 sync/theming/treemap) tests green.

- [ ] **Step 2: Run the entire frontend suite**

Run: `cd app && npx vitest run 2>&1 | tail -8`
Expected: only the 3 KNOWN pre-existing failures (`useWatermarkDrag.test.jsx` ×2, `NavBar.test.jsx` ×1) — no NEW failures. If any breadth/views test fails, fix before proceeding.

- [ ] **Step 3: Production build**

Run: `cd app && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (browser)** — open Breadth → Views and confirm:
- Each chart view's Customize panel now shows **Color palette** + **Intensity** under "View options"; switching palette recolors the view; Subtle/Bold change opacity/glow.
- Treemap's panel shows **Size tiles by**; Equal/Extremity visibly resize tiles.
- Save a preset with a non-default palette → it persists across reload; logged-in, it appears on another browser (sync).

- [ ] **Step 5: Commit any fixes (no push — see notes)**

```bash
git add -A
git commit -m "test(breadth): theming + sync + treemap suite green, build verified"
```

---

## Notes for the implementer

- **No TypeScript** — plain JS/JSX.
- **Do NOT `git push`.** This repo's `master` is shared with a concurrent session; the controller handles integration/push. Commit locally only.
- **classic palette must equal the current look** — bull `#34d399`, bear `#f87171`, tier map = the existing `VIEW_TIER_COLOR`. This keeps default presets visually unchanged.
- **`metricColor` third arg is optional** — existing callers without it still get classic. Only the views updated in Tasks 3–4 pass a palette map.
- **Treemap keeps `TIER_CELL_COLORS`** (its own dark heat) — palette does NOT apply to Treemap; it only gets `weightBy`.
- Some view components already accept an `options` prop (added in the prior per-view-options work — Radar/Scoreboard/Meters/Timeline/Levels). When a task says "add `options = {}` to the signature," check first: if it's already there, just use it.
- The Customize panel renders options generically from the schema, so palette/intensity/weightBy appear automatically — **no panel edits**.
