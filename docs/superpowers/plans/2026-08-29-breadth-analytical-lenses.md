# Breadth Analytical Lenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Breadth Views tab from 8 cosmetic styles to 16 by adding 8 analytical lenses that answer questions the existing views cannot.

**Architecture:** `VIEW_CONFIG` grows a `kind` field. `board` views keep today's contract untouched; `lens` views receive the full forward-filled window instead of a metric list and get an options-only Customize panel. Three hardcoded style lists (switcher labels, dispatch chain, `STYLES`) collapse into one registry with a rail that fails when any style lacks a component.

**Tech Stack:** React 18 + Vite, CSS Modules, vitest + @testing-library/react (run from `app/`), FastAPI + SQLite on the backend, pytest from the repo root. No chart library on this tab — every view is hand-rolled SVG/CSS.

**Spec:** `docs/superpowers/specs/2026-08-29-breadth-analytical-lenses-design.md`

## Global Constraints

- **Worktree:** `C:\Users\Patrick\uct-worktrees\breadth-lenses`, branch `feat/breadth-lenses`. Run all commands from there. Never `cd` to `C:\Users\Patrick\uct-dashboard` — it is a stale/parked checkout.
- **Never `git add -A`.** Stage the exact paths each task names. `node_modules` is a junction shared with the main checkout — **never run `npm install`**.
- Vitest runs from `app/`: `cd app && npx vitest run <path>`. Pytest runs from the repo root.
- **No new magic numbers.** An event or threshold comes from a metric's existing `getTier`, a published formula, or a percentile-of-window that is labeled as such on screen.
- **A view that lacks the data it needs states that and renders nothing** — it never interpolates, zero-fills, or implies more history than it read.
- Every view label, order, and group comes from `VIEW_CONFIG`. No component may hold its own copy of the style list.
- Colors come from `resolveViewColors(options.palette, options.intensity)`. Never hardcode green/red in a new view.
- Font stack in inline styles matches existing views: `'Instrument Sans', sans-serif`.
- CSS: a bare `[data-tone]` selector loses to a later class at equal specificity — compound tone selectors with the wrapper class and keep them last in the module file.
- Commit after every task. Do not push until a wave is complete and verified.

---

# WAVE 1 — Foundation + 3 views

### Task 1: The `kind` contract, the registry, and the rail

**Files:**
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Create: `app/src/pages/breadth/views/viewRegistry.js`
- Modify: `app/src/pages/breadth/BreadthViewSwitcher.jsx`
- Modify: `app/src/pages/breadth/BreadthViewSwitcher.module.css`
- Modify: `app/src/pages/breadth/BreadthViews.jsx:150-210` (the dispatch block)
- Create: `app/src/pages/breadth/views/viewRegistry.test.jsx`
- Modify: `app/src/pages/breadth/BreadthViewSwitcher.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `VIEW_CONFIG[style].kind` → `'board' | 'lens'` (every entry, no exceptions)
  - `VIEW_COMPONENTS` — `{ [style]: ReactComponent }` from `viewRegistry.js`
  - `viewsByKind()` → `{ board: [{key,label}], lens: [{key,label}] }`, order preserved from `STYLES`
  - Board props bundle: `{ currentRow, prevRow, recentRows, rows, rowIdx, metrics, normalize, onDrill, signalKey, notableKey, options, pctileByKey, visibleKeys }`
  - Lens props bundle: `{ rows, currentRow, prevRow, rowIdx, onDrill, options }`

Note on the board bundle: it is the current `common` plus `pctileByKey`, `visibleKeys` (which Treemap alone reads today), plus `rows`/`rowIdx`. There are no name collisions, so one merged bundle serves every board and components ignore what they do not use. This is what lets the `&&` chain become a map.

- [ ] **Step 1: Write the failing rail test**

Create `app/src/pages/breadth/views/viewRegistry.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { STYLES, VIEW_CONFIG, optionDefaults } from './viewMetricConfig'
import { VIEW_COMPONENTS, viewsByKind } from './viewRegistry'
import { HM_METRICS } from '../heatmapMetrics'

const METRICS = HM_METRICS.filter(m => !m.isHeader)

// 60 synthetic sessions, newest first, with every numeric field the views read.
const mkRows = (n = 60) => Array.from({ length: n }, (_, i) => ({
  date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
  breadth_score: 50 + (i % 20), uct_exposure: 60, pct_above_5sma: 40 + (i % 30),
  pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_50sma: 40 + (i % 25),
  pct_above_100sma: 55, pct_above_200sma: 60, up_4pct_today: 30, down_4pct_today: 12,
  up_20pct_5d: 8, down_20pct_5d: 3, up_25pct_quarter: 40, down_25pct_quarter: 10,
  up_50pct_month: 5, down_50pct_month: 2, magna_up: 60, magna_down: 20,
  stage2_count: 300, stage4_count: 90, new_52w_highs: 40, new_52w_lows: 9,
  new_20d_highs: 120, new_20d_lows: 30, new_ath: 20, hvc_52w: 30, atr_ext_7: 12,
  advancing: 3000, declining: 1500, up_from_open: 2800, down_from_open: 1700,
  up_on_volume: 2000, down_on_volume: 1200, adv_decline: 1500, adv_decline_cum: 10000,
  up_vol_ratio: 1.8, ratio_5day: 1.4, ratio_10day: 1.2, hi_ratio: 1.2, lo_ratio: 0.3,
  sp500_close: 5000 + i * 3, qqq_close: 400 + i, spy_day_pct: 0.4, qqq_day_pct: 0.5,
  vix: 15 + (i % 6), vxn: 20, mcclellan_osc: 30 - i, cnn_fear_greed: 55,
  aaii_spread: 5, cboe_putcall: 0.8, universe_count: 5000, near_52w_high: 40,
  rsp_spy_ratio: 0.62, iwm_qqq_ratio: 0.55, is_ftd: 0,
  spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1,
  qqq_above_10sma: 1, qqq_above_20sma: 1, qqq_above_50sma: 1, qqq_above_200sma: 1,
}))

const rows = mkRows()

const propsFor = (style) => {
  const options = optionDefaults(style)
  if (VIEW_CONFIG[style].kind === 'lens') {
    return { rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0, onDrill: () => {}, options }
  }
  return {
    currentRow: rows[0], prevRow: rows[3], recentRows: rows.slice(0, 30), rows, rowIdx: 0,
    metrics: METRICS, normalize: () => 62, onDrill: () => {},
    signalKey: null, notableKey: null, options,
    pctileByKey: {}, visibleKeys: new Set(METRICS.map(m => m.key)),
  }
}

describe('view registry', () => {
  it('every registered style has a component', () => {
    for (const s of STYLES) expect(VIEW_COMPONENTS[s], `missing component for "${s}"`).toBeTruthy()
  })

  it('every registered style declares a kind', () => {
    for (const s of STYLES) expect(['board', 'lens']).toContain(VIEW_CONFIG[s].kind)
  })

  it('every style renders with the props bundle its kind receives', () => {
    for (const s of STYLES) {
      const Component = VIEW_COMPONENTS[s]
      expect(() => render(<Component {...propsFor(s)} />), `"${s}" threw on render`).not.toThrow()
    }
  })

  it('groups styles by kind, preserving STYLES order', () => {
    const { board, lens } = viewsByKind()
    expect(board.length + lens.length).toBe(STYLES.length)
    const order = [...board, ...lens].map(v => v.key)
    expect(new Set(order)).toEqual(new Set(STYLES))
    const boardOrder = board.map(v => v.key)
    expect(boardOrder).toEqual(STYLES.filter(s => VIEW_CONFIG[s].kind === 'board'))
  })

  it('carries a label for every style so the switcher never needs its own list', () => {
    for (const s of STYLES) expect(typeof VIEW_CONFIG[s].label).toBe('string')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/viewRegistry.test.jsx`
Expected: FAIL — `Failed to resolve import "./viewRegistry"`.

- [ ] **Step 3: Add `kind` to every VIEW_CONFIG entry**

In `viewMetricConfig.js`, replace the `VIEW_CONFIG` object with the same entries each carrying a `kind`. The 8 existing entries are all `'board'`:

```js
export const VIEW_CONFIG = {
  treemap:    { kind: 'board', label: 'Treemap',    eligibleKeys: all,       defaultVisible: [], options: TREEMAP_OPTIONS },
  rings:      { kind: 'board', label: 'Rings',      eligibleKeys: all,       defaultVisible: HEADLINE, options: THEME_OPTIONS },
  tug:        { kind: 'board', label: 'Tug',        eligibleKeys: pairsOnly, defaultVisible: TUG_DEFAULT, options: THEME_OPTIONS },
  meters:     { kind: 'board', label: 'Meters',     eligibleKeys: all,       defaultVisible: HEADLINE, options: [...METERS_OPTIONS, ...THEME_OPTIONS] },
  timeline:   { kind: 'board', label: 'Timeline',   eligibleKeys: all,       defaultVisible: TIMELINE_DEFAULT, options: [...TIMELINE_OPTIONS, ...THEME_OPTIONS] },
  radar:      { kind: 'board', label: 'Radar',      eligibleKeys: all,       defaultVisible: RADAR_DEFAULT, options: [...RADAR_OPTIONS, ...THEME_OPTIONS] },
  scoreboard: { kind: 'board', label: 'Scoreboard', eligibleKeys: all,       defaultVisible: [], options: [...SCOREBOARD_OPTIONS, ...THEME_OPTIONS] },
  equalizer:  { kind: 'board', label: 'Levels',     eligibleKeys: all,       defaultVisible: LEVELS_DEFAULT, options: [...LEVELS_OPTIONS, ...THEME_OPTIONS] },
}
```

`STYLES` stays exactly as it is for now — later tasks append to it as each view lands. Add this helper below `optionDefaults`:

```js
// Grouped style list for the switcher, in STYLES order. The switcher renders
// what this returns and owns no list of its own.
export function viewsByKind() {
  const out = { board: [], lens: [] }
  for (const key of STYLES) {
    const cfg = VIEW_CONFIG[key]
    if (!cfg) continue
    out[cfg.kind === 'lens' ? 'lens' : 'board'].push({ key, label: cfg.label })
  }
  return out
}
```

- [ ] **Step 4: Create the component registry**

Create `app/src/pages/breadth/views/viewRegistry.js`:

```js
/**
 * The one place a style key maps to its component. `BreadthViews` dispatches
 * through this map instead of a chain of `&&`s, and `viewRegistry.test.jsx`
 * fails the moment a style is registered in STYLES without a component here.
 */
import TreemapView from './TreemapView'
import RingsView from './RingsView'
import TugView from './TugView'
import MetersView from './MetersView'
import TimelineView from './TimelineView'
import RadarView from './RadarView'
import ScoreboardView from './ScoreboardView'
import EqualizerView from './EqualizerView'

export { viewsByKind } from './viewMetricConfig'

export const VIEW_COMPONENTS = {
  treemap: TreemapView,
  rings: RingsView,
  tug: TugView,
  meters: MetersView,
  timeline: TimelineView,
  radar: RadarView,
  scoreboard: ScoreboardView,
  equalizer: EqualizerView,
}
```

- [ ] **Step 5: Replace the dispatch chain in BreadthViews.jsx**

Delete the eight `import …View from './views/…View'` lines and the whole `{views.viewStyle === '…' && <…View … />}` block. Add to the imports:

```jsx
import { VIEW_COMPONENTS } from './views/viewRegistry'
```

Replace the `const common = {…}` declaration and the render block that follows it with:

```jsx
  const ActiveView = VIEW_COMPONENTS[views.viewStyle]
  const activeKind = VIEW_CONFIG[views.viewStyle]?.kind ?? 'board'

  const viewProps = activeKind === 'lens'
    ? { rows: filledRows, currentRow, prevRow, rowIdx, onDrill: drill, options: views.options }
    : {
        currentRow, prevRow, recentRows, rows: filledRows, rowIdx,
        metrics: visibleMetrics, normalize, onDrill: drill,
        signalKey: signals.signalKey, notableKey: signals.notableKey,
        options: views.options, pctileByKey, visibleKeys,
      }
```

and in the JSX, replace the eight-line dispatch with:

```jsx
      <div style={{ flex: 1, minHeight: 0 }}>
        {ActiveView && <ActiveView {...viewProps} />}
      </div>
```

- [ ] **Step 6: Derive the switcher from the registry**

Replace the body of `BreadthViewSwitcher.jsx` entirely:

```jsx
/** Style switcher for the Breadth Views tab. Renders whatever the registry
 *  declares, grouped by kind — it owns no list of styles or labels. */
import { viewsByKind } from './views/viewRegistry'
import styles from './BreadthViewSwitcher.module.css'

const GROUP_LABELS = { board: 'Boards', lens: 'Lenses' }

export default function BreadthViewSwitcher({ viewStyle, onSelect }) {
  const groups = viewsByKind()
  return (
    <div className={styles.switcher} role="group" aria-label="Visualization style">
      {['board', 'lens'].map(kind => (
        groups[kind].length === 0 ? null : (
          <div key={kind} className={styles.group}>
            <span className={styles.groupLabel} aria-hidden="true">{GROUP_LABELS[kind]}</span>
            {groups[kind].map(o => (
              <button key={o.key} type="button"
                      className={`${styles.btn} ${viewStyle === o.key ? styles.btnActive : ''}`}
                      aria-pressed={viewStyle === o.key}
                      onClick={() => onSelect(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        )
      ))}
    </div>
  )
}
```

Append to `BreadthViewSwitcher.module.css` (after the existing `.btnActive` rule, before the media query):

```css
.group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.group + .group { margin-left: 8px; padding-left: 10px; border-left: 1px solid rgba(255,255,255,0.10); }
.groupLabel { font: 800 8px 'Instrument Sans', sans-serif; letter-spacing: .8px;
  text-transform: uppercase; color: var(--text-dim, #64748b); padding: 0 4px; user-select: none; }
```

and inside the existing `@media (max-width: 640px)` block add:

```css
  .group { flex-wrap: nowrap; }
  .group + .group { margin-left: 4px; padding-left: 6px; }
  .groupLabel { display: none; }
```

- [ ] **Step 7: Update the switcher test for the grouped markup**

`BreadthViewSwitcher.test.jsx` currently asserts against a flat button list. Add this test to it (keep whatever existing assertions still pass — buttons are still buttons with the same labels and `aria-pressed`):

```jsx
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'

it('renders a button for every registered style and no others', () => {
  const { getAllByRole } = render(<BreadthViewSwitcher viewStyle="treemap" onSelect={() => {}} />)
  const labels = getAllByRole('button').map(b => b.textContent)
  expect(labels.sort()).toEqual(STYLES.map(s => VIEW_CONFIG[s].label).sort())
})
```

- [ ] **Step 8: Run the full breadth suite**

Run: `cd app && npx vitest run src/pages/breadth`
Expected: PASS. `viewRegistry.test.jsx` passes all five cases; the existing view, drillguard, live, and theming tests stay green because board props are a superset of what they received before.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js app/src/pages/breadth/views/viewRegistry.test.jsx app/src/pages/breadth/BreadthViewSwitcher.jsx app/src/pages/breadth/BreadthViewSwitcher.module.css app/src/pages/breadth/BreadthViewSwitcher.test.jsx app/src/pages/breadth/BreadthViews.jsx
git commit -m "refactor(breadth): one registry for view styles, grouped by kind

Collapses three hardcoded style lists (switcher labels, dispatch chain,
STYLES) into VIEW_CONFIG. Adds kind:'board'|'lens' and a rail that fails
when a registered style has no component."
```

---

### Task 2: Customize panel — options only for lenses

**Files:**
- Modify: `app/src/pages/breadth/BreadthViewsCustomizePanel.jsx`
- Modify: `app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`

**Interfaces:**
- Consumes: `VIEW_CONFIG[style].kind` from Task 1.
- Produces: the panel accepts `metrics: []` and renders no checklist section and no "N of M visible" footer count.

A lens has no metric list. Today the panel would render an empty checklist body and a footer reading "0 of 0 visible" — a control that changes nothing, which is worse than no control.

- [ ] **Step 1: Write the failing test**

Add to `BreadthViewsCustomizePanel.test.jsx`:

```jsx
it('renders no metric checklist when the view has no eligible metrics', () => {
  const { queryByText, getByLabelText, container } = render(
    <BreadthViewsCustomizePanel
      viewLabel="Regime Clock" metrics={[]} visibleKeys={new Set()}
      optionsSchema={[{ name: 'rocWindow', label: 'Momentum window', type: 'select', default: 20,
                        choices: [{ value: 10, label: '10 days' }, { value: 20, label: '20 days' }] }]}
      options={{ rocWindow: 20 }} activePreset="Default" presetNames={['Default']} isDefaultActive
      onToggleVisible={() => {}} onSetOption={() => {}} onSavePreset={() => {}}
      onRenamePreset={() => {}} onDeletePreset={() => {}} onSwitchPreset={() => {}}
      onResetActive={() => {}} onClose={() => {}} />
  )
  expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0)
  expect(queryByText(/of 0 visible/)).toBeNull()
  expect(getByLabelText('Momentum window')).toBeTruthy()  // options still shown
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`
Expected: FAIL — the footer renders "0 of 0 visible".

- [ ] **Step 3: Gate the checklist and the footer count on having metrics**

In `BreadthViewsCustomizePanel.jsx`, add below `const grouped = groupMetrics(metrics)`:

```jsx
  const hasMetrics = metrics.length > 0
```

Wrap the checklist body:

```jsx
      {hasMetrics && (
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
      )}
```

and change the footer's active label to:

```jsx
        <span className={styles.activeLabel}>
          {isDefaultActive
            ? `Default — ${viewLabel} preset`
            : hasMetrics ? `${visibleKeys.size} of ${metrics.length} visible` : `${viewLabel} options`}
        </span>
```

- [ ] **Step 4: Run the test**

Run: `cd app && npx vitest run src/pages/breadth/BreadthViewsCustomizePanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/breadth/BreadthViewsCustomizePanel.jsx app/src/pages/breadth/BreadthViewsCustomizePanel.test.jsx
git commit -m "feat(breadth): customize panel shows options only for metric-less views"
```

---

### Task 3: Views-tab window control

**Files:**
- Modify: `app/src/pages/Breadth.jsx:841` (state), `:846-850` (SWR key), `:1004-1013` (pills)
- Create: `app/src/pages/breadth/breadthWindow.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `VIEWS_DAY_CHOICES = [90, 180, 365]` and `OTHER_DAY_CHOICES = [30, 60, 90]`, both exported from `Breadth.jsx`.

The Views tab is currently pinned to `days = 90` because the pills are gated behind `activeTab !== 'heatmap'`. Each tab keeps its own window in its own state variable, so switching tabs never silently changes the other tab's window.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/breadthWindow.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { VIEWS_DAY_CHOICES, OTHER_DAY_CHOICES } from '../Breadth'

describe('breadth window choices', () => {
  it('offers deeper windows on the Views tab than the monitor', () => {
    expect(VIEWS_DAY_CHOICES).toEqual([90, 180, 365])
    expect(OTHER_DAY_CHOICES).toEqual([30, 60, 90])
  })
  it('starts the Views tab at the shallowest of its own choices', () => {
    expect(Math.min(...VIEWS_DAY_CHOICES)).toBe(90)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/breadthWindow.test.jsx`
Expected: FAIL — the exports do not exist.

- [ ] **Step 3: Add the choices, the second state var, and the effective window**

In `Breadth.jsx`, near the other exports at the top of the file:

```js
// The Views tab reads windows the monitor never needs — a lens over 90 sessions
// can only ever say "not in the last 90", never "last fired in March". Each tab
// keeps its own window so switching tabs never moves the other one.
export const VIEWS_DAY_CHOICES = [90, 180, 365]
export const OTHER_DAY_CHOICES = [30, 60, 90]
```

Replace `const [days, setDays] = useState(90)` with:

```js
  const [days, setDays] = useState(90)
  const [viewsDays, setViewsDays] = useState(90)
  const isViewsTab = activeTab === 'heatmap'
  const effectiveDays = isViewsTab ? viewsDays : days
```

Change the SWR key from `` `/api/breadth-monitor?days=${days}` `` to:

```js
    `/api/breadth-monitor?days=${effectiveDays}`,
```

- [ ] **Step 4: Show the pills on every tab, with the right set per tab**

Replace the `{activeTab !== 'heatmap' && (<> … </>)}` block in the header so the pills sit outside the gate and the Customize/CSV controls stay inside it:

```jsx
        <div className={styles.daysPills}>
          {(isViewsTab ? VIEWS_DAY_CHOICES : OTHER_DAY_CHOICES).map(d => (
            <button
              key={d}
              className={`${styles.daysPill} ${effectiveDays === d ? styles.daysPillActive : ''}`}
              onClick={() => (isViewsTab ? setViewsDays(d) : setDays(d))}
            >
              {d}d
            </button>
          ))}
        </div>
        {activeTab !== 'heatmap' && (
          <>
            {activeTab === 'breadth' && (
              /* …the existing Customize anchor block, unchanged… */
            )}
            <button
              className={styles.exportBtn}
              onClick={() => exportCsv(rows, visibleCols)}
              title="Download as CSV"
            >
              ↓ CSV
            </button>
          </>
        )}
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx vitest run src/pages/breadth src/pages/Breadth.test.jsx`
Expected: PASS. If a Breadth page test asserts the pills are absent on the Views tab, update it — that assertion encoded the defect this task fixes.

- [ ] **Step 6: Measure the real payload before trusting 365**

Run the app (`cd app && npm run dev`), open the Views tab, click **365d**, and read the response size for `/api/breadth-monitor?days=365` in the browser Network panel. The spec estimates ~365KB from field count; this is the measurement that replaces the estimate.

If it exceeds ~600KB, drop 365 from `VIEWS_DAY_CHOICES`, leaving `[90, 180]`, and update the test in Step 1 to match. Record the measured number in the commit message either way.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/breadth/breadthWindow.test.jsx
git commit -m "feat(breadth): window control on the Views tab, 90/180/365

The pills were gated behind activeTab !== 'heatmap', pinning Views to 90
sessions with no control. Each tab now keeps its own window.
Measured payload at 365d: <FILL IN FROM STEP 6>."
```

---

### Task 4: Heat Ribbon (board)

**Files:**
- Create: `app/src/pages/breadth/views/HeatRibbonView.jsx`
- Create: `app/src/pages/breadth/views/HeatRibbonView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js` (STYLES, VIEW_CONFIG, options)
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: board props bundle (Task 1); `metricColor`, `resolveViewColors` from `breadthViewShared`.
- Produces: style key `'ribbon'`, label `Heat Ribbon`, `kind: 'board'`.

One row per visible metric, one cell per session across the whole window, tier-colored — regime change becomes a visible edge instead of a number you have to remember.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/views/HeatRibbonView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import HeatRibbonView from './HeatRibbonView'

const mk = (key, tierFn) => ({ key, label: key, group: 'G', polarity: 'bull',
                               getFmt: r => String(r[key]), getTier: tierFn })
// Tier flips at row 3 — the fixture can tell a correctly-wired ribbon from a
// constant one, which a single-tier fixture could not.
const metrics = [mk('a', r => (r.a >= 50 ? 'g3' : 'r3'))]
const rows = [70, 60, 55, 20, 10].map((a, i) => ({ date: `2026-08-0${i + 1}`, a }))

describe('HeatRibbonView', () => {
  it('draws one cell per session, oldest at the left', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = container.querySelectorAll('[data-testid^="ribbon-a-"]')
    expect(cells.length).toBe(5)
    expect(cells[0].getAttribute('title')).toContain('2026-08-05')  // oldest first
  })

  it('colors each cell from that session own tier, not today tier', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = [...container.querySelectorAll('[data-testid^="ribbon-a-"]')]
    const bg = el => el.style.background.replace(/\s/g, '')
    // ocean g3 = #0891b2, ocean r3 = #e11d48
    expect(bg(cells[cells.length - 1])).toMatch(/#0891b2|rgb\(8,145,178\)/i)  // newest, a=70
    expect(bg(cells[0])).toMatch(/#e11d48|rgb\(225,29,72\)/i)                 // oldest, a=10
  })

  it('states the basis it actually read', () => {
    const { getByText } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByText(/5 sessions · since 2026-08-05/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/HeatRibbonView.test.jsx`
Expected: FAIL — cannot resolve `./HeatRibbonView`.

- [ ] **Step 3: Implement the view**

Create `app/src/pages/breadth/views/HeatRibbonView.jsx`:

```jsx
/**
 * Heat Ribbon — one row per metric, one cell per session across the loaded
 * window, colored by that session's OWN tier. Answers "when did the regime
 * change?", which no snapshot view can.
 */
import { metricColor, resolveViewColors } from './breadthViewShared'

export default function HeatRibbonView({ rows = [], rowIdx = 0, metrics = [], onDrill, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const compact = options.density === 'compact'
  // rows are newest-first from the cursor; display oldest → newest (left → right).
  const window = rows.slice(rowIdx).reverse()
  if (!window.length || !metrics.length) return null

  const basis = `${window.length} sessions · since ${window[0].date}`
  const cellH = compact ? 10 : 16

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {basis}
      </div>
      {metrics.map(m => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div style={{ width: 104, flex: '0 0 104px', textAlign: 'right',
                        font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.4px',
                        textTransform: 'uppercase', color: '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: m.drillKey ? 'pointer' : 'default' }}
               role={m.drillKey ? 'button' : undefined}
               aria-label={m.drillKey ? `${m.label} details` : undefined}
               onClick={m.drillKey ? () => onDrill(m) : undefined}>
            {m.label}
          </div>
          <div style={{ display: 'grid', gap: 1, flex: 1,
                        gridTemplateColumns: `repeat(${window.length}, minmax(0, 1fr))` }}>
            {window.map((row, i) => (
              <div key={row.date ?? i} data-testid={`ribbon-${m.key}-${i}`}
                   title={`${row.date} · ${m.label} ${m.getFmt(row)}`}
                   style={{ height: cellH, borderRadius: 1,
                            opacity: colors.fillOpacity,
                            background: metricColor(m, row, colors.tier) }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Register the style**

In `viewMetricConfig.js` append `'ribbon'` to `STYLES`:

```js
export const STYLES = ['treemap', 'rings', 'tug', 'meters', 'timeline', 'radar', 'scoreboard', 'equalizer', 'ribbon']
```

Add the options schema beside the other schemas:

```js
const RIBBON_OPTIONS = [
  { name: 'density', label: 'Row height', type: 'select', default: 'comfortable',
    choices: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] },
]
```

and the entry in `VIEW_CONFIG`:

```js
  ribbon: { kind: 'board', label: 'Heat Ribbon', eligibleKeys: all, defaultVisible: HEADLINE, options: [...RIBBON_OPTIONS, ...THEME_OPTIONS] },
```

In `viewRegistry.js`, import `HeatRibbonView from './HeatRibbonView'` and add `ribbon: HeatRibbonView` to `VIEW_COMPONENTS`.

- [ ] **Step 5: Run the view test and the rail**

Run: `cd app && npx vitest run src/pages/breadth/views`
Expected: PASS — including `viewRegistry.test.jsx`, which now covers `ribbon` automatically.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/breadth/views/HeatRibbonView.jsx app/src/pages/breadth/views/HeatRibbonView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Heat Ribbon view - regime change across the window"
```

---

### Task 5: Percentile Ladder (board)

**Files:**
- Create: `app/src/pages/breadth/views/PercentileLadderView.jsx`
- Create: `app/src/pages/breadth/views/PercentileLadderView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: board props bundle; `metricValue`, `percentileRank`, `resolveViewColors` from `breadthViewShared`.
- Produces: style key `'ladder'`, label `Percentile Ladder`, `kind: 'board'`.

Every reading becomes self-contextualizing: a 10-bin histogram of the metric's own window values with today's position marked, so "62%" reads as "88th percentile — top decile since April".

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/views/PercentileLadderView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PercentileLadderView from './PercentileLadderView'

const mk = (key) => ({ key, label: key, group: 'G', polarity: 'bull',
                       getFmt: r => String(r[key]), getTier: () => 'g2' })
const metrics = [mk('a')]
// 24 rows because the view refuses to rank below MIN_READINGS (20). Today
// (row 0) is the max of the window → 100th percentile; a fixture where today
// sat mid-range could not tell a correct rank from a constant.
const rows = [90, ...Array.from({ length: 23 }, (_, k) => k * 3)]
  .map((a, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, a }))

describe('PercentileLadderView', () => {
  it('ranks today against its own window, not against other metrics', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('pctile-a').textContent).toBe('100')
  })

  it('places the marker at the percentile position', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(Number(getByTestId('marker-a').getAttribute('x'))).toBeCloseTo(100, 0)
  })

  it('refuses a metric with too few readings instead of inventing a rank', () => {
    const thin = [{ date: '2026-08-01', a: 5 }]
    const { getByTestId, queryByTestId } = render(<PercentileLadderView rows={thin} rowIdx={0}
      currentRow={thin[0]} metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(queryByTestId('pctile-a')).toBeNull()
    expect(getByTestId('insufficient-a').textContent).toMatch(/needs 20/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/PercentileLadderView.test.jsx`
Expected: FAIL — cannot resolve `./PercentileLadderView`.

- [ ] **Step 3: Implement the view**

Create `app/src/pages/breadth/views/PercentileLadderView.jsx`:

```jsx
/**
 * Percentile Ladder — each metric drawn against its OWN distribution over the
 * loaded window: a 10-bin histogram, today's marker, and the percentile rank.
 * A metric with too few readings says so rather than ranking against noise.
 */
import { metricValue, percentileRank, resolveViewColors } from './breadthViewShared'

const MIN_READINGS = 20
const BINS = 10

export default function PercentileLadderView({ rows = [], rowIdx = 0, currentRow, metrics = [], onDrill, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const window = rows.slice(rowIdx)
  if (!window.length || !metrics.length || !currentRow) return null

  const sortMode = options.sort ?? 'group'

  const entries = metrics.map(m => {
    const vals = window.map(r => metricValue(m, r)).filter(v => v != null)
    const today = metricValue(m, currentRow)
    if (vals.length < MIN_READINGS || today == null) {
      return { m, ok: false, have: vals.length }
    }
    const sorted = [...vals].sort((a, b) => a - b)
    const pct = percentileRank(sorted, today)
    const min = sorted[0], max = sorted[sorted.length - 1]
    const span = max - min || 1
    const hist = Array.from({ length: BINS }, () => 0)
    for (const v of vals) {
      const bin = Math.min(BINS - 1, Math.floor((v - min) / span * BINS))
      hist[bin] += 1
    }
    const peak = Math.max(...hist, 1)
    return { m, ok: true, pct, hist, peak, min, max, today, count: vals.length }
  })

  const ordered = sortMode === 'percentile'
    ? [...entries].sort((a, b) => (b.ok ? b.pct : -1) - (a.ok ? a.pct : -1))
    : entries

  const basis = `${window.length} sessions · since ${window[window.length - 1].date}`

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>{basis}</div>
      {ordered.map(({ m, ok, pct, hist, peak, today, have }) => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 104, flex: '0 0 104px', textAlign: 'right',
                        font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.4px',
                        textTransform: 'uppercase', color: '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: m.drillKey ? 'pointer' : 'default' }}
               role={m.drillKey ? 'button' : undefined}
               aria-label={m.drillKey ? `${m.label} details` : undefined}
               onClick={m.drillKey ? () => onDrill(m) : undefined}>
            {m.label}
          </div>

          {ok ? (
            <>
              <svg width="100%" height="26" viewBox="0 0 100 26" preserveAspectRatio="none"
                   style={{ flex: 1, minWidth: 0 }} role="img"
                   aria-label={`${m.label}: ${m.getFmt(currentRow)}, ${pct}th percentile of ${window.length} sessions`}>
                {hist.map((c, i) => {
                  const h = (c / peak) * 18
                  return <rect key={i} x={i * 10 + 0.6} y={20 - h} width={8.8} height={h}
                               fill={colors.tier.g1} opacity={0.35} />
                })}
                <line x1="0" y1="20.5" x2="100" y2="20.5" stroke="#334155" strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke" />
                <rect data-testid={`marker-${m.key}`} x={pct} y="1" width="1.4" height="21"
                      fill={colors.bull} opacity={colors.fillOpacity}>
                  <title>{`${m.getFmt(currentRow)} — ${pct}th percentile`}</title>
                </rect>
              </svg>
              <div style={{ width: 78, flex: '0 0 78px', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
                  {m.getFmt(currentRow)}
                </span>
                <span data-testid={`pctile-${m.key}`}
                      style={{ font: '700 10px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
                  {pct}
                </span>
              </div>
            </>
          ) : (
            <div data-testid={`insufficient-${m.key}`}
                 style={{ flex: 1, font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b' }}>
              Needs {MIN_READINGS} readings to rank — has {have}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Register the style**

Append `'ladder'` to `STYLES`. Add:

```js
const LADDER_OPTIONS = [
  { name: 'sort', label: 'Sort', type: 'select', default: 'group',
    choices: [{ value: 'group', label: 'Group order' }, { value: 'percentile', label: 'Percentile high→low' }] },
]
```

and:

```js
  ladder: { kind: 'board', label: 'Percentile Ladder', eligibleKeys: all, defaultVisible: HEADLINE, options: [...LADDER_OPTIONS, ...THEME_OPTIONS] },
```

In `viewRegistry.js` import and register `ladder: PercentileLadderView`.

- [ ] **Step 5: Run the tests**

Run: `cd app && npx vitest run src/pages/breadth/views`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/breadth/views/PercentileLadderView.jsx app/src/pages/breadth/views/PercentileLadderView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Percentile Ladder view - every reading in its own context"
```

---

### Task 6: Regime Clock (lens)

**Files:**
- Create: `app/src/pages/breadth/views/RegimeClockView.jsx`
- Create: `app/src/pages/breadth/views/RegimeClockView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: lens props bundle `{ rows, currentRow, rowIdx, onDrill, options }`; `resolveViewColors`.
- Produces: style key `'clock'`, label `Regime Clock`, `kind: 'lens'`. Exports `quadrantOf(level, momentum)` → `'Expansion' | 'Recovery' | 'Distribution' | 'Contraction'` for reuse by tests.

Level on x, its rate of change on y. Four quadrants name the regime; a fading trail shows the path into it. Nothing else on the page shows level and direction at once.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/views/RegimeClockView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RegimeClockView, { quadrantOf } from './RegimeClockView'

const mkRows = (levels) => levels.map((v, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, pct_above_50sma: v }))

describe('quadrantOf', () => {
  it('names each of the four regimes', () => {
    expect(quadrantOf(70, 5)).toBe('Expansion')
    expect(quadrantOf(30, 5)).toBe('Recovery')
    expect(quadrantOf(70, -5)).toBe('Distribution')
    expect(quadrantOf(30, -5)).toBe('Contraction')
  })
})

describe('RegimeClockView', () => {
  // rows are newest-first: today 70, 20 sessions ago 40 → momentum +30, level 70.
  const rows = mkRows([70, ...Array.from({ length: 19 }, () => 55), 40, 38, 36])

  it('reports the regime from level and momentum together', () => {
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('regime-name').textContent).toBe('Expansion')
    expect(getByTestId('regime-momentum').textContent).toBe('+30.0')
  })

  it('reads momentum from the option window, not a fixed one', () => {
    // 10 sessions ago is 55 → momentum +15, not +30.
    const { getByTestId } = render(<RegimeClockView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ rocWindow: 10, level: 'pct_above_50sma', trail: 10 }} />)
    expect(getByTestId('regime-momentum').textContent).toBe('+15.0')
  })

  it('refuses rather than guessing when the window is too short', () => {
    const { getByTestId, queryByTestId } = render(<RegimeClockView rows={mkRows([70, 60, 50])} rowIdx={0}
      currentRow={{ pct_above_50sma: 70 }} onDrill={() => {}}
      options={{ rocWindow: 20, level: 'pct_above_50sma', trail: 10 }} />)
    expect(queryByTestId('regime-name')).toBeNull()
    expect(getByTestId('clock-insufficient').textContent).toMatch(/needs 21 sessions/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/RegimeClockView.test.jsx`
Expected: FAIL — cannot resolve `./RegimeClockView`.

- [ ] **Step 3: Implement the view**

Create `app/src/pages/breadth/views/RegimeClockView.jsx`:

```jsx
/**
 * Regime Clock — participation level (x) against its rate of change (y), with
 * the four quadrants named and a fading trail showing the path in. Level says
 * where we are; momentum says which way we are going. No snapshot view can
 * show both, which is the whole reason this lens exists.
 */
import { resolveViewColors } from './breadthViewShared'

export function quadrantOf(level, momentum) {
  if (level >= 50) return momentum >= 0 ? 'Expansion' : 'Distribution'
  return momentum >= 0 ? 'Recovery' : 'Contraction'
}

const QUADRANT_NOTE = {
  Expansion:    'Broad and still broadening',
  Recovery:     'Narrow but repairing',
  Distribution: 'Broad but deteriorating',
  Contraction:  'Narrow and still narrowing',
}

export default function RegimeClockView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const roc = Number(options.rocWindow ?? 20)
  const trailLen = Number(options.trail ?? 30)
  const levelKey = options.level ?? 'pct_above_50sma'
  const window = rows.slice(rowIdx)
  const need = roc + 1

  const levelAt = (i) => {
    const v = window[i]?.[levelKey]
    return v == null || isNaN(Number(v)) ? null : Number(v)
  }

  if (window.length < need || levelAt(0) == null || levelAt(roc) == null) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="clock-insufficient">
          Needs {need} sessions of {levelKey} to measure momentum — has {window.length}.
        </div>
        <div style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
          Widen the window with the day pills above.
        </div>
      </div>
    )
  }

  // Trail points: newest-first index i → (level, level - level(i+roc)).
  const pts = []
  for (let i = 0; i < Math.min(trailLen, window.length - roc); i++) {
    const lv = levelAt(i), prior = levelAt(i + roc)
    if (lv == null || prior == null) continue
    pts.push({ i, date: window[i].date, level: lv, mom: lv - prior })
  }
  if (!pts.length) return null

  const today = pts[0]
  const regime = quadrantOf(today.level, today.mom)
  const maxMom = Math.max(10, ...pts.map(p => Math.abs(p.mom)))

  // viewBox 0..100 both axes; x = level, y inverted so positive momentum is up.
  const X = (level) => Math.max(0, Math.min(100, level))
  const Y = (mom) => 50 - (mom / maxMom) * 48

  const path = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${X(p.level).toFixed(2)},${Y(p.mom).toFixed(2)}`).join(' ')
  const label = (text, x, y, anchor) => (
    <text x={x} y={y} textAnchor={anchor} fill="#475569"
          fontFamily="Instrument Sans, sans-serif" fontWeight="800" fontSize="3.4"
          letterSpacing="0.4">{text}</text>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="regime-name"
              style={{ font: '800 20px \'Instrument Sans\', sans-serif', color: colors.bull }}>
          {regime}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
          {QUADRANT_NOTE[regime]}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          level <strong style={{ color: '#e2e8f0' }}>{today.level.toFixed(1)}</strong>
          {'  ·  '}{roc}d momentum{' '}
          <strong data-testid="regime-momentum" style={{ color: today.mom >= 0 ? colors.bull : colors.bear }}>
            {today.mom >= 0 ? '+' : ''}{today.mom.toFixed(1)}
          </strong>
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Regime clock: ${regime}, level ${today.level.toFixed(1)}, ${roc}-day momentum ${today.mom.toFixed(1)}`}
           style={{ flex: 1, minHeight: 0, marginTop: 10 }}>
        <line x1="50" y1="0" x2="50" y2="100" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {label('RECOVERY', 2, 6, 'start')}
        {label('EXPANSION', 98, 6, 'end')}
        {label('CONTRACTION', 2, 97, 'start')}
        {label('DISTRIBUTION', 98, 97, 'end')}

        <path d={path} fill="none" stroke={colors.bull} strokeWidth="1.1" opacity="0.35"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pts.map((p, k) => (
          <circle key={p.date ?? k} cx={X(p.level)} cy={Y(p.mom)} r={k === 0 ? 1.9 : 0.8}
                  fill={k === 0 ? colors.bull : '#475569'}
                  opacity={k === 0 ? 1 : Math.max(0.15, 1 - k / pts.length)}>
            <title>{`${p.date} · level ${p.level.toFixed(1)} · momentum ${p.mom.toFixed(1)}`}</title>
          </circle>
        ))}
      </svg>

      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {pts.length} sessions plotted · since {pts[pts.length - 1].date} · y-axis ±{maxMom.toFixed(0)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register the style**

Append `'clock'` to `STYLES`. Add:

```js
const CLOCK_OPTIONS = [
  { name: 'level', label: 'Level series', type: 'select', default: 'pct_above_50sma',
    choices: [
      { value: 'pct_above_50sma', label: '% above 50 SMA' },
      { value: 'pct_above_200sma', label: '% above 200 SMA' },
      { value: 'breadth_score', label: 'Health score' },
    ] },
  { name: 'rocWindow', label: 'Momentum window', type: 'select', default: 20,
    choices: [10, 20, 40].map(v => ({ value: v, label: `${v} days` })) },
  { name: 'trail', label: 'Trail length', type: 'select', default: 30,
    choices: [10, 30, 60].map(v => ({ value: v, label: `${v} days` })) },
]
```

and:

```js
  clock: { kind: 'lens', label: 'Regime Clock', eligibleKeys: () => [], defaultVisible: [], options: [...CLOCK_OPTIONS, ...THEME_OPTIONS] },
```

⚠️ `resolveDefaultVisible` treats `defaultVisible: []` as "the full eligible board". For a lens, `eligibleKeys` returns `[]`, so the resolved set is empty — which is correct and requires no change to that function. Verify with the rail before moving on.

In `viewRegistry.js` import and register `clock: RegimeClockView`.

- [ ] **Step 5: Run the tests**

Run: `cd app && npx vitest run src/pages/breadth`
Expected: PASS — including the rail, which now renders a lens through the lens props bundle for the first time.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/breadth/views/RegimeClockView.jsx app/src/pages/breadth/views/RegimeClockView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Regime Clock lens - level and momentum in one frame"
```

---

### Task 7: Wave 1 verification on the deployed artifact

**Files:** none — this is a verification gate, not a code task.

A green suite is not the standard on this page: both day-one defects in the 8/26 Breadth reshape shipped past ~5,700 green tests and were caught by screenshotting the deployed page.

- [ ] **Step 1: Run the whole frontend suite**

Run: `cd app && npx vitest run`
Expected: PASS. Note any pre-existing failures unrelated to this branch (`modalOpen.test.js` is known-red on master) and do not attribute them to this work.

- [ ] **Step 2: Push the wave**

```bash
git push origin feat/breadth-lenses
```

Then merge to master per repo convention: `git push origin feat/breadth-lenses:master`. Never force-push. If the push is rejected, `git fetch origin && git merge origin/master`, re-run the suite, and push again.

- [ ] **Step 3: Open the deployed page and count pixels**

Once Railway reports the deploy SUCCESS, open the Breadth → Views tab in a browser and confirm, by looking:
- The switcher shows two labeled groups, **BOARDS** (10) and **LENSES** (1) at this point in the plan.
- Day pills appear on the Views tab and read 90/180/365.
- **Heat Ribbon** draws cells that actually change color across the window — a ribbon of one flat color means it is reading today's tier for every session.
- **Percentile Ladder** shows a histogram and a marker whose position varies between metrics.
- **Regime Clock** plots a trail, not a single dot, and the quadrant label matches the plotted position.

- [ ] **Step 4: Record what you saw**

If any view is blank or flat, stop and fix before Wave 2 — a lens that renders nothing on real data is the exact failure mode the tests cannot catch.

---

# WAVE 2 — Divergence, Rotation, Event Ledger

### Task 8: Divergence Lens

**Files:**
- Create: `app/src/pages/breadth/views/divergence.js`
- Create: `app/src/pages/breadth/views/divergence.test.js`
- Create: `app/src/pages/breadth/views/DivergenceView.jsx`
- Create: `app/src/pages/breadth/views/DivergenceView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: lens props bundle.
- Produces:
  - `zscore(values)` → `number[]` (nulls preserved as `null`)
  - `divergenceRuns(zPrice, zPart, minGap)` → `[{ start, end, dir }]`, indices into the ascending arrays, `dir` is `'price-leads' | 'breadth-leads'`
  - style key `'divergence'`, label `Divergence`, `kind: 'lens'`

- [ ] **Step 1: Write the failing math test**

Create `app/src/pages/breadth/views/divergence.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { zscore, divergenceRuns } from './divergence'

describe('zscore', () => {
  it('centers on the mean and scales by the standard deviation', () => {
    expect(zscore([1, 2, 3])).toEqual([-1.224744871391589, 0, 1.224744871391589])
  })
  it('preserves gaps rather than zero-filling them', () => {
    expect(zscore([1, null, 3])[1]).toBeNull()
  })
  it('returns zeros when every value is identical (no spurious divergence)', () => {
    expect(zscore([5, 5, 5])).toEqual([0, 0, 0])
  })
})

describe('divergenceRuns', () => {
  it('flags a run only when the gap holds for minGap consecutive sessions', () => {
    const zPrice = [0, 0, 2, 2, 2, 0]
    const zPart  = [0, 0, 0, 0, 0, 0]
    expect(divergenceRuns(zPrice, zPart, 3)).toEqual([{ start: 2, end: 4, dir: 'price-leads' }])
  })
  it('does not flag a gap shorter than minGap', () => {
    expect(divergenceRuns([0, 2, 2, 0], [0, 0, 0, 0], 3)).toEqual([])
  })
  it('names the direction when breadth leads price', () => {
    const runs = divergenceRuns([0, 0, 0, 0], [2, 2, 2, 2], 3)
    expect(runs[0].dir).toBe('breadth-leads')
  })
  it('ignores sessions with a missing value instead of treating them as agreement', () => {
    expect(divergenceRuns([2, null, 2, 2], [0, 0, 0, 0], 3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/divergence.test.js`
Expected: FAIL — cannot resolve `./divergence`.

- [ ] **Step 3: Implement the math module**

Create `app/src/pages/breadth/views/divergence.js`:

```js
/**
 * Divergence math, kept framework-free so it can be tested without rendering.
 * A "divergence" here is a sustained gap between two z-scored series — one
 * session apart is noise, which is what `minGap` exists to refuse.
 */

// Minimum |z| gap before a session counts as divergent at all. One standard
// deviation apart is the conventional read; below it the two series are
// telling the same story with different units.
export const MIN_Z_GAP = 1.0

export function zscore(values) {
  const nums = values.filter(v => v != null && !isNaN(Number(v))).map(Number)
  if (nums.length < 2) return values.map(() => null)
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  const sd = Math.sqrt(variance)
  if (sd === 0) return values.map(v => (v == null ? null : 0))
  return values.map(v => (v == null || isNaN(Number(v)) ? null : (Number(v) - mean) / sd))
}

export function divergenceRuns(zPrice, zPart, minGap = 5) {
  const runs = []
  let start = null, dir = null
  const flush = (endExclusive) => {
    if (start != null && endExclusive - start >= minGap) {
      runs.push({ start, end: endExclusive - 1, dir })
    }
    start = null; dir = null
  }
  for (let i = 0; i < zPrice.length; i++) {
    const a = zPrice[i], b = zPart[i]
    const gap = (a == null || b == null) ? null : a - b
    const d = gap == null || Math.abs(gap) < MIN_Z_GAP
      ? null
      : (gap > 0 ? 'price-leads' : 'breadth-leads')
    if (d == null || d !== dir) { flush(i); }
    if (d != null && start == null) { start = i; dir = d }
  }
  flush(zPrice.length)
  return runs
}
```

- [ ] **Step 4: Run the math test**

Run: `cd app && npx vitest run src/pages/breadth/views/divergence.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing view test**

Create `app/src/pages/breadth/views/DivergenceView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DivergenceView from './DivergenceView'

// Newest-first. Price climbs while participation falls → price-leads divergence.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  sp500_close: 5000 + (40 - i) * 10,
  pct_above_50sma: 20 + i,
}))

describe('DivergenceView', () => {
  it('reports an active divergence and names its direction', () => {
    const { getByTestId } = render(<DivergenceView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/price leading/i)
  })

  it('says so plainly when the two series agree', () => {
    const agree = rows.map((r, i) => ({ ...r, pct_above_50sma: 20 + (40 - i) }))
    const { getByTestId } = render(<DivergenceView rows={agree} rowIdx={0} currentRow={agree[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/in step/i)
  })

  it('refuses a window too short to z-score', () => {
    const { getByTestId } = render(<DivergenceView rows={rows.slice(0, 4)} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-insufficient').textContent).toMatch(/needs 20 sessions/i)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/DivergenceView.test.jsx`
Expected: FAIL — cannot resolve `./DivergenceView`.

- [ ] **Step 7: Implement the view**

Create `app/src/pages/breadth/views/DivergenceView.jsx`:

```jsx
/**
 * Divergence Lens — price and participation z-scored onto one frame, with
 * sustained gaps shaded. Answers "is price outrunning the troops?", the
 * classic breadth read, which the table can only imply.
 */
import { resolveViewColors } from './breadthViewShared'
import { zscore, divergenceRuns } from './divergence'

const MIN_SESSIONS = 20

const PRICE_LABEL = { sp500_close: 'S&P 500', qqq_close: 'QQQ' }
const PART_LABEL = {
  pct_above_50sma: '% above 50 SMA',
  pct_above_200sma: '% above 200 SMA',
  breadth_score: 'Health score',
}

export default function DivergenceView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const priceKey = options.price ?? 'sp500_close'
  const partKey = options.participation ?? 'pct_above_50sma'
  const minGap = Number(options.minGap ?? 5)

  const asc = rows.slice(rowIdx).reverse()  // oldest → newest for plotting
  if (asc.length < MIN_SESSIONS) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="divergence-insufficient">
          Needs {MIN_SESSIONS} sessions to z-score both series — has {asc.length}.
        </div>
      </div>
    )
  }

  const zPrice = zscore(asc.map(r => r[priceKey]))
  const zPart = zscore(asc.map(r => r[partKey]))
  const runs = divergenceRuns(zPrice, zPart, minGap)
  const last = runs.length ? runs[runs.length - 1] : null
  const active = last && last.end === asc.length - 1 ? last : null

  const all = [...zPrice, ...zPart].filter(v => v != null)
  const bound = Math.max(1, ...all.map(Math.abs))
  const X = (i) => (i / Math.max(1, asc.length - 1)) * 100
  const Y = (z) => 50 - (z / bound) * 46

  const line = (zs) => zs.map((z, i) => (z == null ? null : `${X(i).toFixed(2)},${Y(z).toFixed(2)}`))
    .filter(Boolean).join(' ')

  const verdict = active
    ? (active.dir === 'price-leads'
        ? `Price leading breadth — ${active.end - active.start + 1} sessions and counting`
        : `Breadth leading price — ${active.end - active.start + 1} sessions and counting`)
    : 'In step — no sustained divergence'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="divergence-verdict"
              style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: active ? colors.bear : colors.bull }}>
          {verdict}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          <span style={{ color: '#e2e8f0' }}>■</span> {PRICE_LABEL[priceKey] ?? priceKey}
          {'   '}
          <span style={{ color: colors.bull }}>■</span> {PART_LABEL[partKey] ?? partKey}
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Divergence: ${verdict}`} style={{ flex: 1, minHeight: 0, marginTop: 10 }}>
        {runs.map((r, k) => (
          <rect key={k} x={X(r.start)} y="0" width={Math.max(0.4, X(r.end) - X(r.start))} height="100"
                fill={r.dir === 'price-leads' ? colors.bear : colors.bull} opacity="0.12" />
        ))}
        <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPrice)} fill="none" stroke="#e2e8f0" strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPart)} fill="none" stroke={colors.bull} strokeWidth="1.2"
                  opacity={colors.fillOpacity} vectorEffect="non-scaling-stroke" />
      </svg>

      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {asc.length} sessions · since {asc[0].date} · shaded where the gap held ≥{minGap} sessions
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Register the style**

Append `'divergence'` to `STYLES`. Add:

```js
const DIVERGENCE_OPTIONS = [
  { name: 'price', label: 'Price series', type: 'select', default: 'sp500_close',
    choices: [{ value: 'sp500_close', label: 'S&P 500' }, { value: 'qqq_close', label: 'QQQ' }] },
  { name: 'participation', label: 'Participation series', type: 'select', default: 'pct_above_50sma',
    choices: [
      { value: 'pct_above_50sma', label: '% above 50 SMA' },
      { value: 'pct_above_200sma', label: '% above 200 SMA' },
      { value: 'breadth_score', label: 'Health score' },
    ] },
  { name: 'minGap', label: 'Minimum run', type: 'select', default: 5,
    choices: [3, 5, 10].map(v => ({ value: v, label: `${v} sessions` })) },
]
```

and:

```js
  divergence: { kind: 'lens', label: 'Divergence', eligibleKeys: () => [], defaultVisible: [], options: [...DIVERGENCE_OPTIONS, ...THEME_OPTIONS] },
```

Register `divergence: DivergenceView` in `viewRegistry.js`.

- [ ] **Step 9: Run the tests and commit**

Run: `cd app && npx vitest run src/pages/breadth/views`
Expected: PASS.

```bash
git add app/src/pages/breadth/views/divergence.js app/src/pages/breadth/views/divergence.test.js app/src/pages/breadth/views/DivergenceView.jsx app/src/pages/breadth/views/DivergenceView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Divergence lens - price vs participation, z-scored"
```

---

### Task 9: Rotation Lens

**Files:**
- Create: `app/src/pages/breadth/views/RotationView.jsx`
- Create: `app/src/pages/breadth/views/RotationView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: lens props bundle.
- Produces: style key `'rotation'`, label `Rotation`, `kind: 'lens'`.

`rsp_spy_ratio`, `iwm_qqq_ratio` and `vxn` ride in every row today and appear nowhere on this tab. Equal-weight vs cap-weight and small vs large is the leadership question the metric board cannot ask.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/views/RotationView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RotationView from './RotationView'

// Newest-first: rsp/spy rising over the window = broadening.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  rsp_spy_ratio: 0.70 - i * 0.002,
  iwm_qqq_ratio: 0.50 + i * 0.002,
  vix: 16, vxn: 21,
}))

describe('RotationView', () => {
  it('calls a rising equal-weight ratio broadening', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
  })

  it('calls a falling ratio narrowing', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-iwm_qqq_ratio').textContent).toMatch(/narrowing/i)
  })

  it('marks a series absent rather than drawing it as zero', () => {
    const noVxn = rows.map(r => ({ ...r, vxn: null }))
    const { getByTestId } = render(<RotationView rows={noVxn} rowIdx={0} currentRow={noVxn[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-vol_spread').textContent).toMatch(/not reported/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/RotationView.test.jsx`
Expected: FAIL — cannot resolve `./RotationView`.

- [ ] **Step 3: Implement the view**

Create `app/src/pages/breadth/views/RotationView.jsx`:

```jsx
/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 */
import { resolveViewColors } from './breadthViewShared'

const PANELS = [
  { key: 'rsp_spy_ratio', label: 'Equal vs Cap', sub: 'RSP / SPY',
    up: 'Broadening — the average stock is gaining on the index',
    down: 'Narrowing — the index is carried by its largest names',
    read: r => r.rsp_spy_ratio },
  { key: 'iwm_qqq_ratio', label: 'Small vs Large', sub: 'IWM / QQQ',
    up: 'Broadening — small caps leading',
    down: 'Narrowing — large caps leading',
    read: r => r.iwm_qqq_ratio },
  { key: 'vol_spread', label: 'Vol Spread', sub: 'VXN − VIX',
    up: 'Narrowing — tech vol bid over the broad market',
    down: 'Broadening — tech vol easing toward the market',
    read: r => (r.vxn == null || r.vix == null ? null : Number(r.vxn) - Number(r.vix)) },
]

export default function RotationView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  const window = rows.slice(rowIdx)
  if (!window.length) return null

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px',
                  display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {PANELS.map(p => {
        const series = window.map(p.read)
        const vals = series.filter(v => v != null && !isNaN(Number(v))).map(Number)
        const now = series[0]
        const prior = series[Math.min(lookback, series.length - 1)]
        const usable = now != null && prior != null && vals.length >= 2

        const delta = usable ? Number(now) - Number(prior) : null
        // A ratio's own direction is the whole signal; `up`/`down` name what
        // that direction means for THIS pair rather than a generic bull/bear.
        const verdict = !usable
          ? `${p.sub} not reported over this window`
          : (delta >= 0 ? p.up : p.down)

        const min = vals.length ? Math.min(...vals) : 0
        const max = vals.length ? Math.max(...vals) : 1
        const span = (max - min) || 1
        const asc = [...series].reverse()
        const pts = asc.map((v, i) => (v == null ? null
          : `${(i / Math.max(1, asc.length - 1) * 100).toFixed(2)},${(28 - ((Number(v) - min) / span) * 26).toFixed(2)}`))
          .filter(Boolean).join(' ')

        return (
          <div key={p.key} style={{ background: '#0e131a', borderRadius: 10, padding: 12,
                                    border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: '700 10px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                             textTransform: 'uppercase', color: '#94a3b8' }}>{p.label}</span>
              <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>{p.sub}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span style={{ font: '800 22px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
                {usable ? Number(now).toFixed(3) : '—'}
              </span>
              {usable && (
                <span style={{ font: '700 11px \'Instrument Sans\', sans-serif',
                               color: delta >= 0 ? colors.bull : colors.bear }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(3)} / {lookback}d
                </span>
              )}
            </div>
            <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none"
                 style={{ marginTop: 6 }} aria-hidden="true">
              {pts
                ? <polyline points={pts} fill="none" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
                            opacity={colors.fillOpacity}
                            stroke={usable && delta >= 0 ? colors.bull : colors.bear} />
                : <line x1="0" y1="15" x2="100" y2="15" stroke="#334155" strokeDasharray="2 2" />}
            </svg>
            <div data-testid={`verdict-${p.key}`}
                 style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#94a3b8', marginTop: 4 }}>
              {verdict}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Register the style**

Append `'rotation'` to `STYLES`. Add:

```js
const ROTATION_OPTIONS = [
  { name: 'lookback', label: 'Change over', type: 'select', default: 20,
    choices: [10, 20, 60].map(v => ({ value: v, label: `${v} days` })) },
]
```

and:

```js
  rotation: { kind: 'lens', label: 'Rotation', eligibleKeys: () => [], defaultVisible: [], options: [...ROTATION_OPTIONS, ...THEME_OPTIONS] },
```

Register `rotation: RotationView` in `viewRegistry.js`.

- [ ] **Step 5: Run the tests and commit**

Run: `cd app && npx vitest run src/pages/breadth/views`
Expected: PASS.

```bash
git add app/src/pages/breadth/views/RotationView.jsx app/src/pages/breadth/views/RotationView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Rotation lens - equal vs cap, small vs large, vol spread"
```

---

### Task 10: Event Ledger

**Files:**
- Create: `app/src/pages/breadth/views/breadthEvents.js`
- Create: `app/src/pages/breadth/views/breadthEvents.test.js`
- Create: `app/src/pages/breadth/views/EventLedgerView.jsx`
- Create: `app/src/pages/breadth/views/EventLedgerView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: lens props bundle; `HM_METRICS_BY_KEY` from `../heatmapMetrics`.
- Produces:
  - `EVENT_DEFS` — array of `{ key, label, family, basis, note, detect(ctx, i) }`
  - `scanEvents(rows, opts)` → `[{ key, label, family, basis, note, firedToday, lastIdx, lastDate, sessionsAgo, unavailable }]`
  - style key `'events'`, label `Event Ledger`, `kind: 'lens'`

**The honesty rule this task exists to enforce:** a threshold is either a metric's own `getTier` verdict, a published formula, or a percentile-of-window that says so on screen. No new magic numbers.

⚠️ **`up_vol_ratio` is up volume ÷ DOWN volume**, not ÷ total (`api/services/breadth_collector.py:1178`). The share is `r/(1+r)`, so a 90% up day is `r ≥ 9`, not `r ≥ 0.9`. Reading it as a share would fire on ordinary sessions and never fire on a real 90% day.

- [ ] **Step 1: Write the failing detector test**

Create `app/src/pages/breadth/views/breadthEvents.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { scanEvents, zweigEma } from './breadthEvents'

const base = { date: '2026-08-01', advancing: 2000, declining: 2000, up_vol_ratio: 1.0,
               mcclellan_osc: 0, hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const mkRows = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ ...base, date: `2026-08-${String(n - i).padStart(2, '0')}`, ...over(i) }))

const find = (events, key) => events.find(e => e.key === key)

describe('90% volume days', () => {
  // The pair that makes this fixture discriminate: 9.5 is a real 90% up day
  // (share 0.905); 0.95 is an ordinary session (share 0.487). A detector that
  // read the ratio as a share would get both of these backwards.
  it('fires on a ratio of 9.5 and not on 0.95', () => {
    const hot = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 9.5 } : {})))
    expect(find(hot, 'vol90up').firedToday).toBe(true)

    const cold = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 0.95 } : {})))
    expect(find(cold, 'vol90up').firedToday).toBe(false)
  })

  it('fires the down side at a ratio of 0.1', () => {
    const dn = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 0.1 } : {})))
    expect(find(dn, 'vol90dn').firedToday).toBe(true)
  })
})

describe('follow-through day', () => {
  it('reads the collected flag rather than re-deriving it', () => {
    const rows = mkRows(30, i => (i === 4 ? { is_ftd: 1 } : {}))
    const ftd = find(scanEvents(rows), 'ftd')
    expect(ftd.firedToday).toBe(false)
    expect(ftd.sessionsAgo).toBe(4)
  })
})

describe('Zweig breadth thrust', () => {
  it('fires when the 10-day EMA climbs from below 0.40 to above 0.615', () => {
    // oldest 12 sessions deeply negative, then a sharp run of all-advancing days
    const rows = mkRows(40, i => (i < 12
      ? { advancing: 4500, declining: 500 }    // newest 12 = thrust
      : { advancing: 200, declining: 4800 }))  // older = washed out
    expect(find(scanEvents(rows), 'zweig').firedToday).toBe(true)
  })

  it('refuses when advance/decline coverage is missing rather than guessing', () => {
    const rows = mkRows(40, () => ({ advancing: null, declining: null }))
    const z = find(scanEvents(rows), 'zweig')
    expect(z.firedToday).toBe(false)
    expect(z.unavailable).toMatch(/advance\/decline/i)
  })
})

describe('tier-based events', () => {
  it('defers to the metric own getTier instead of a fresh threshold', () => {
    // atr_ext_7 getTier returns 'g3' above 50 — the registry owns that number.
    const rows = mkRows(30, i => (i === 0 ? { atr_ext_7: 60 } : {}))
    expect(find(scanEvents(rows), 'atrFroth').firedToday).toBe(true)
    const mild = mkRows(30, i => (i === 0 ? { atr_ext_7: 20 } : {}))
    expect(find(scanEvents(mild), 'atrFroth').firedToday).toBe(false)
  })
})

describe('percentile events', () => {
  // The window must VARY, or the 95th-percentile cut lands on the same value
  // every ordinary session carries and the event fires every day — a fixture
  // that cannot tell a washout from a Tuesday proves nothing.
  const varied = (spike) => mkRows(60, i => ({ new_52w_lows: i === 0 ? spike : 10 + (i % 40) }))

  it('fires on a spike above the window top 5%', () => {
    const w = find(scanEvents(varied(900)), 'lowWashout')
    expect(w.firedToday).toBe(true)
    expect(w.basis).toBe('percentile')
    expect(w.note).toMatch(/top 5%/i)
  })

  it('does not fire on an ordinary reading inside the same window', () => {
    expect(find(scanEvents(varied(12)), 'lowWashout').firedToday).toBe(false)
  })
})

describe('zweigEma', () => {
  it('returns null for sessions before the seed window', () => {
    expect(zweigEma([0.5, 0.5, 0.5])[0]).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthEvents.test.js`
Expected: FAIL — cannot resolve `./breadthEvents`.

- [ ] **Step 3: Implement the event engine**

Create `app/src/pages/breadth/views/breadthEvents.js`:

```js
/**
 * Named market events, derived — never invented.
 *
 * Every threshold here comes from one of three places and each event says
 * which: the metric's OWN `getTier` verdict (the registry owns the number), a
 * PUBLISHED formula (Zweig, 90% volume days, the collector's FTD flag), or a
 * PERCENTILE of the loaded window, which is labeled as such on screen. Adding
 * an event with a hand-picked threshold breaks that contract — the number would
 * have no author and no way to be checked.
 */
import { HM_METRICS_BY_KEY } from '../heatmapMetrics'

const ZWEIG_PERIOD = 10
const ZWEIG_LOW = 0.40
const ZWEIG_HIGH = 0.615
const ZWEIG_WINDOW = 10
// 90% up/down volume day: the share of volume in advancing names.
const VOL_SHARE = 0.9
const WASHOUT_PCTILE = 0.95

/** 10-day EMA of advancing/(advancing+declining), oldest→newest. null until seeded. */
export function zweigEma(ratios) {
  const k = 2 / (ZWEIG_PERIOD + 1)
  const out = []
  let ema = null, seen = 0
  for (const r of ratios) {
    if (r == null) { out.push(null); continue }
    seen++
    ema = ema == null ? r : r * k + ema * (1 - k)
    out.push(seen >= ZWEIG_PERIOD ? ema : null)
  }
  return out
}

const tierOf = (key, row) => {
  const m = HM_METRICS_BY_KEY[key]
  if (!m || !m.getTier) return ''
  try { return m.getTier(row) || '' } catch { return '' }
}

// `up_vol_ratio` is up volume / DOWN volume (breadth_collector.py:1178), so the
// share of advancing volume is r/(1+r). Reading the ratio itself as a share is
// the defect this conversion exists to prevent.
const upVolShare = (row) => {
  const r = row?.up_vol_ratio
  if (r == null || isNaN(Number(r)) || Number(r) < 0) return null
  return Number(r) / (1 + Number(r))
}

export const EVENT_DEFS = [
  { key: 'ftd', label: 'Follow-Through Day', family: 'thrust', basis: 'collected',
    note: 'The collector\'s own is_ftd flag',
    detect: (ctx, i) => { const v = ctx.rows[i]?.is_ftd; return v == null ? null : !!v } },

  { key: 'zweig', label: 'Zweig Breadth Thrust', family: 'thrust', basis: 'formula',
    note: `10-day EMA of advances/(advances+declines) from below ${ZWEIG_LOW} to above ${ZWEIG_HIGH} within ${ZWEIG_WINDOW} sessions`,
    detect: (ctx, i) => {
      const e = ctx.zweig  // ascending index space
      const a = ctx.ascIdx(i)
      if (e[a] == null) return null
      if (e[a] <= ZWEIG_HIGH) return false
      for (let k = Math.max(0, a - ZWEIG_WINDOW); k < a; k++) {
        if (e[k] != null && e[k] < ZWEIG_LOW) return true
      }
      return false
    } },

  { key: 'vol90up', label: '90% Up Volume Day', family: 'volume', basis: 'formula',
    note: 'Advancing volume ≥ 90% of up+down volume (ratio ≥ 9.0)',
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s >= VOL_SHARE } },

  { key: 'vol90dn', label: '90% Down Volume Day', family: 'volume', basis: 'formula',
    note: 'Declining volume ≥ 90% of up+down volume (ratio ≤ 0.111)',
    detect: (ctx, i) => { const s = upVolShare(ctx.rows[i]); return s == null ? null : s <= 1 - VOL_SHARE } },

  { key: 'mcclellanHot', label: 'McClellan Overbought', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bullish tier',
    detect: (ctx, i) => tierOf('mcclellan_osc', ctx.rows[i]) === 'g3' },

  { key: 'mcclellanCold', label: 'McClellan Oversold', family: 'oscillator', basis: 'tier',
    note: 'The McClellan metric\'s own extreme-bearish tier',
    detect: (ctx, i) => tierOf('mcclellan_osc', ctx.rows[i]) === 'r3' },

  { key: 'hvcSurge', label: 'HVC Surge', family: 'supply', basis: 'tier',
    note: 'High-volume-close count at its own top tier',
    detect: (ctx, i) => tierOf('hvc_52w', ctx.rows[i]) === 'g3' },

  { key: 'atrFroth', label: 'ATR Extension Froth', family: 'supply', basis: 'tier',
    note: 'Names >7× ATR extended at their own top tier',
    detect: (ctx, i) => tierOf('atr_ext_7', ctx.rows[i]) === 'g3' },

  { key: 'lowWashout', label: 'New-Low Washout', family: 'washout', basis: 'percentile',
    note: `New 52-week lows in the top 5% of the loaded window`,
    detect: (ctx, i) => {
      const cut = ctx.pctileCut('new_52w_lows', WASHOUT_PCTILE)
      const v = ctx.rows[i]?.new_52w_lows
      return (cut == null || v == null) ? null : Number(v) >= cut
    } },
]

/**
 * Scan the window for every event. Returns one row per event with whether it
 * fired today, when it last fired, or why it could not be evaluated.
 * `rows` is newest-first (the lens bundle's order).
 */
export function scanEvents(rows = [], { families = null } = {}) {
  const n = rows.length
  const asc = [...rows].reverse()
  const ascIdx = (i) => n - 1 - i

  const ratios = asc.map(r => {
    const a = r?.advancing, d = r?.declining
    if (a == null || d == null || (Number(a) + Number(d)) === 0) return null
    return Number(a) / (Number(a) + Number(d))
  })
  const zweig = zweigEma(ratios)
  const adCoverage = ratios.filter(v => v != null).length

  const cuts = {}
  const pctileCut = (key, q) => {
    if (!(key in cuts)) {
      const vals = rows.map(r => r?.[key]).filter(v => v != null && !isNaN(Number(v))).map(Number)
      cuts[key] = vals.length < 20 ? null : [...vals].sort((a, b) => a - b)[Math.floor(vals.length * q)]
    }
    return cuts[key]
  }

  const ctx = { rows, asc, ascIdx, zweig, pctileCut }

  return EVENT_DEFS
    .filter(d => !families || families.includes(d.family))
    .map(d => {
      let unavailable = null
      if (d.key === 'zweig' && adCoverage < ZWEIG_PERIOD + 1) {
        unavailable = `Advance/decline counts cover ${adCoverage} of ${n} sessions — needs ${ZWEIG_PERIOD + 1}`
      }
      if (d.basis === 'percentile' && pctileCut('new_52w_lows', WASHOUT_PCTILE) == null) {
        unavailable = 'Needs 20 readings to rank a percentile'
      }

      let firedToday = false, lastIdx = null
      if (!unavailable) {
        for (let i = 0; i < n; i++) {
          const hit = d.detect(ctx, i)
          if (hit === true) { lastIdx = i; break }
        }
        firedToday = lastIdx === 0
      }

      return {
        key: d.key, label: d.label, family: d.family, basis: d.basis, note: d.note,
        firedToday, lastIdx,
        lastDate: lastIdx == null ? null : rows[lastIdx]?.date ?? null,
        sessionsAgo: lastIdx,
        unavailable,
        windowLength: n,
      }
    })
}
```

- [ ] **Step 4: Run the detector test**

Run: `cd app && npx vitest run src/pages/breadth/views/breadthEvents.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing view test**

Create `app/src/pages/breadth/views/EventLedgerView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import EventLedgerView from './EventLedgerView'

const base = { advancing: 2000, declining: 2000, up_vol_ratio: 1.0, mcclellan_osc: 0,
               hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const rows = Array.from({ length: 40 }, (_, i) => ({
  ...base, date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  ...(i === 0 ? { up_vol_ratio: 9.5 } : {}),
}))

describe('EventLedgerView', () => {
  it('shows an event that fired today', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-vol90up').textContent).toMatch(/today/i)
  })

  it('says how far back it looked when an event never fired', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-ftd').textContent).toMatch(/not in the last 40 sessions/i)
  })

  it('shows the reason an event could not be evaluated', () => {
    const blind = rows.map(r => ({ ...r, advancing: null, declining: null }))
    const { getByTestId } = render(<EventLedgerView rows={blind} rowIdx={0} currentRow={blind[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-zweig').textContent).toMatch(/advance\/decline counts cover 0/i)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/EventLedgerView.test.jsx`
Expected: FAIL — cannot resolve `./EventLedgerView`.

- [ ] **Step 7: Implement the view**

Create `app/src/pages/breadth/views/EventLedgerView.jsx`:

```jsx
/**
 * Event Ledger — the named things a trader can say out loud, and whether they
 * happened. Every threshold is sourced (tier / formula / percentile) and shown,
 * so a reader can check the claim rather than trust it.
 */
import { resolveViewColors } from './breadthViewShared'
import { scanEvents } from './breadthEvents'

const BASIS_LABEL = {
  tier: 'metric tier', formula: 'published formula',
  percentile: 'percentile of window', collected: 'collected flag',
}

export default function EventLedgerView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const window = rows.slice(rowIdx)
  const families = options.families && options.families !== 'all' ? [options.families] : null
  const events = scanEvents(window, { families })
  if (!window.length) return null

  const firedCount = events.filter(e => e.firedToday).length

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: firedCount ? colors.bull : '#94a3b8' }}>
          {firedCount ? `${firedCount} event${firedCount > 1 ? 's' : ''} today` : 'No named event today'}
        </span>
        <span style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          {window.length} sessions · since {window[window.length - 1].date}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {events.map(e => {
          const status = e.unavailable
            ? e.unavailable
            : e.firedToday
              ? 'Fired today'
              : e.lastDate
                ? `Last fired ${e.lastDate} · ${e.sessionsAgo} session${e.sessionsAgo === 1 ? '' : 's'} ago`
                : `Not in the last ${e.windowLength} sessions`

          return (
            <div key={e.key} data-testid={`event-${e.key}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: e.firedToday ? `1px solid ${colors.bull}` : '1px solid rgba(255,255,255,0.05)',
                          opacity: e.unavailable ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, flex: '0 0 7px',
                               background: e.firedToday ? colors.bull : '#334155' }} />
                <span style={{ font: '700 11px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>
                  {e.label}
                </span>
              </div>
              <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', marginTop: 4,
                            color: e.firedToday ? colors.bull : '#94a3b8' }}>
                {status}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569', marginTop: 4 }}>
                {e.note} · {BASIS_LABEL[e.basis]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Register the style**

Append `'events'` to `STYLES`. Add:

```js
const EVENTS_OPTIONS = [
  { name: 'families', label: 'Event family', type: 'select', default: 'all',
    choices: [
      { value: 'all', label: 'All families' },
      { value: 'thrust', label: 'Thrust' },
      { value: 'volume', label: 'Volume' },
      { value: 'oscillator', label: 'Oscillator' },
      { value: 'supply', label: 'Supply' },
      { value: 'washout', label: 'Washout' },
    ] },
]
```

and:

```js
  events: { kind: 'lens', label: 'Event Ledger', eligibleKeys: () => [], defaultVisible: [], options: [...EVENTS_OPTIONS, ...THEME_OPTIONS] },
```

Register `events: EventLedgerView` in `viewRegistry.js`.

- [ ] **Step 9: Run the tests and commit**

Run: `cd app && npx vitest run src/pages/breadth`
Expected: PASS.

```bash
git add app/src/pages/breadth/views/breadthEvents.js app/src/pages/breadth/views/breadthEvents.test.js app/src/pages/breadth/views/EventLedgerView.jsx app/src/pages/breadth/views/EventLedgerView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js
git commit -m "feat(breadth): Event Ledger lens - named events with sourced thresholds

up_vol_ratio is up/DOWN volume, so a 90% up day is ratio >= 9.0, not >= 0.9."
```

---

### Task 11: Wave 2 verification, plus the Zweig coverage measurement

**Files:** none — verification gate.

- [ ] **Step 1: Run the full suite, push, deploy**

Run: `cd app && npx vitest run`, then push as in Task 7 Step 2.

- [ ] **Step 2: Measure advance/decline coverage on real data**

This is the spec's open item #1 and the plan cannot claim Zweig works without it. On the deployed Views tab, open **Event Ledger** and read the Zweig card:
- If it shows a fired/last-fired status, coverage is adequate — record the number of covered sessions from the card's reason text if shown.
- If it shows "Advance/decline counts cover N of M sessions", the refusal path is the common case. **That is a correct outcome, not a bug** — record N and M and leave it. Do not loosen the requirement to make the card look better.

- [ ] **Step 3: Count pixels on the three new lenses**

- **Divergence** — two lines that actually differ; a single visible line means both series resolved to the same values.
- **Rotation** — three panels with real numbers; "not reported" on all three means the ratio fields are absent from the payload and needs investigating.
- **Event Ledger** — every card names its basis; any card without a source line is a bug.

---

# WAVE 3 — Analogue Deck + Score Attribution

### Task 12: Backend — score components from a single pass

**Files:**
- Modify: `api/services/breadth_monitor.py:107-160` (`_compute_breadth_score`)
- Modify: `api/routers/breadth_monitor.py` (new endpoint beside `/analogues`)
- Create: `tests/test_breadth_score_components.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `_score_breakdown(row: dict) -> tuple[Optional[float], list[dict]]` — components are `{key, label, weight, points, max_points, present, value}`
  - `score_components(date: str) -> dict` in the service
  - `GET /api/breadth-monitor/score-components/{date}` → `{ok, date, total, components, prev}`

The score and its attribution must come from one pass. Serving `_SCORE_WEIGHTS` and re-deriving points in the browser would put a second authority over the score — the exact defect shape this repo repeats most.

- [ ] **Step 1: Write the failing test**

Create `tests/test_breadth_score_components.py`:

```python
from api.services.breadth_monitor import _score_breakdown, _compute_breadth_score

FULL_ROW = {
    "pct_above_50sma": 65, "ratio_5day": 1.5, "magna_up": 70, "magna_down": 30,
    "hi_ratio": 5.0, "cboe_putcall": 0.85, "aaii_spread": -30, "vix": 18,
    "stage2_count": 1250, "universe_count": 5000, "adv_decline": 900,
}


def test_breakdown_total_matches_the_score_function():
    total, _ = _score_breakdown(FULL_ROW)
    assert total == _compute_breadth_score(FULL_ROW)


def test_points_renormalize_to_the_reported_total():
    total, comps = _score_breakdown(FULL_ROW)
    have = sum(c["weight"] for c in comps if c["present"])
    earned = sum(c["points"] for c in comps if c["present"])
    assert round(min(100, max(0, earned / have * 100)), 1) == total


def test_a_missing_input_is_dropped_from_both_sides_not_scored_zero():
    row = dict(FULL_ROW)
    row["cboe_putcall"] = None
    total, comps = _score_breakdown(row)
    pc = next(c for c in comps if c["key"] == "cboe_putcall")
    assert pc["present"] is False
    assert pc["points"] == 0
    # Renormalization means dropping a maxed component must NOT lower the score
    # the way scoring it zero would have.
    assert total == _compute_breadth_score(row)
    have = sum(c["weight"] for c in comps if c["present"])
    assert have == 100 - pc["weight"]


def test_returns_none_below_the_minimum_available_weight():
    total, comps = _score_breakdown({"vix": 18})
    assert total is None
    assert sum(c["weight"] for c in comps if c["present"]) < 60


def test_every_component_reports_its_ceiling():
    _, comps = _score_breakdown(FULL_ROW)
    for c in comps:
        assert c["max_points"] == c["weight"]
        assert c["points"] <= c["max_points"] + 1e-9
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_breadth_score_components.py -v`
Expected: FAIL — `ImportError: cannot import name '_score_breakdown'`.

- [ ] **Step 3: Refactor the scoring function to emit its breakdown**

In `api/services/breadth_monitor.py`, add labels beside the weights and replace `_compute_breadth_score` with a delegating pair. Keep the existing docstring on `_score_breakdown` — it documents the renormalization rule and must travel with the code that implements it.

```python
_SCORE_LABELS = {
    "pct_above_50sma": "% above 50 SMA", "ratio_5day": "5-day up/down ratio",
    "magna": "13%/34d up share", "hi_ratio": "52w highs / universe",
    "cboe_putcall": "CBOE put/call (contrarian)", "aaii_spread": "AAII spread (contrarian)",
    "vix": "VIX (inverted)", "stage2": "Stage 2 share", "adv_decline": "Advance/decline",
}


def _score_breakdown(row: dict) -> tuple[Optional[float], list[dict]]:
    """Composite breadth score 0-100 AND the per-component attribution, from one
    pass. The total and the breakdown can never disagree because there is only
    one calculation.

    ⚠️ RENORMALIZED over the inputs that are actually present. `_lerp(None)`
    returns 0, so before 2026-08-07 a MISSING component scored the same as a
    maximally bearish one: absence was indistinguishable from the worst possible
    reading. A component that cannot be measured is dropped from BOTH sides of
    the ratio, and the score reports what the available inputs actually say.
    """
    earned = 0.0
    have = 0
    components: list[dict] = []

    def take(key, val, lo, hi):
        nonlocal earned, have
        present = val is not None
        pts = 0.0
        if present:
            have += _SCORE_WEIGHTS[key]
            pts = _lerp(val, lo, hi, _SCORE_WEIGHTS[key])
            earned += pts
        components.append({
            "key": key, "label": _SCORE_LABELS[key], "weight": _SCORE_WEIGHTS[key],
            "points": pts, "max_points": _SCORE_WEIGHTS[key],
            "present": present, "value": val,
        })

    take("pct_above_50sma", row.get("pct_above_50sma"), 30, 65)
    take("ratio_5day", row.get("ratio_5day"), 0.7, 1.5)

    mu, md = row.get("magna_up"), row.get("magna_down")
    take("magna", (mu / (mu + md) * 100) if (mu is not None and md is not None
                                             and (mu + md) > 0) else None, 40, 70)

    take("hi_ratio", row.get("hi_ratio"), 0.5, 5.0)
    # Contrarian: a higher put/call is more fearful, which is a better setup.
    take("cboe_putcall", row.get("cboe_putcall"), 0.65, 0.85)
    # Contrarian: invert, so a -30 spread (very bearish) earns full points.
    spread = row.get("aaii_spread")
    take("aaii_spread", (-spread) if spread is not None else None, -30, 20)
    vix = row.get("vix")
    take("vix", (30 - vix) if vix is not None else None, 0, 12)

    s2, uni = row.get("stage2_count"), row.get("universe_count")
    take("stage2", (s2 / uni * 100) if (s2 is not None and uni and uni > 0) else None, 5, 25)

    # Binary, not interpolated: the advance/decline component is a coin flip on
    # the sign, which is why it cannot go through `take`'s lerp.
    ad = row.get("adv_decline")
    ad_pts = 0.0
    if ad is not None:
        have += _SCORE_WEIGHTS["adv_decline"]
        if ad > 0:
            ad_pts = float(_SCORE_WEIGHTS["adv_decline"])
            earned += ad_pts
    components.append({
        "key": "adv_decline", "label": _SCORE_LABELS["adv_decline"],
        "weight": _SCORE_WEIGHTS["adv_decline"], "points": ad_pts,
        "max_points": _SCORE_WEIGHTS["adv_decline"],
        "present": ad is not None, "value": ad,
    })

    if have < _SCORE_MIN_WEIGHT:
        return None, components
    return round(min(100, max(0, earned / have * 100)), 1), components


def _compute_breadth_score(row: dict) -> Optional[float]:
    """Composite market breadth health score 0-100. See `_score_breakdown`."""
    return _score_breakdown(row)[0]
```

- [ ] **Step 4: Add the service reader**

Append to `api/services/breadth_monitor.py`:

```python
def score_components(date: str) -> dict:
    """The score attribution for `date`, plus the prior session's, so a caller
    can draw the delta in one request. An unrecorded date answers ok:false —
    absence is not an error, same as `session_path`."""
    hist = get_history(400)
    idx = next((i for i, r in enumerate(hist) if r.get("date") == date), None)
    if idx is None:
        return {"ok": False, "date": date, "reason": "no stored session for that date"}

    total, components = _score_breakdown(hist[idx])
    prev = None
    if idx + 1 < len(hist):
        p_total, p_components = _score_breakdown(hist[idx + 1])
        prev = {"date": hist[idx + 1].get("date"), "total": p_total, "components": p_components}

    return {
        "ok": True, "date": date, "total": total,
        "min_weight_met": total is not None,
        "components": components, "prev": prev,
    }
```

- [ ] **Step 5: Add the endpoint**

In `api/routers/breadth_monitor.py`, beside `get_breadth_analogues`:

```python
@router.get("/api/breadth-monitor/score-components/{date}")
def get_breadth_score_components(date: str, _user: dict = Depends(require_paid)):
    """Per-component attribution behind `breadth_score` for one session.

    The client MUST NOT re-derive these from `_SCORE_WEIGHTS`: the score
    renormalizes over present inputs, so the weights alone do not reproduce the
    points. Server-side is the only place the two can be guaranteed to agree.
    """
    try:
        return svc.score_components(date)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

- [ ] **Step 6: Run the tests**

Run: `python -m pytest tests/test_breadth_score_components.py tests/test_breadth_history_window.py -v`
Expected: PASS. Then run the wider breadth backend set: `python -m pytest tests/ -k breadth -q`.

- [ ] **Step 7: Commit**

```bash
git add api/services/breadth_monitor.py api/routers/breadth_monitor.py tests/test_breadth_score_components.py
git commit -m "feat(breadth): serve score attribution from the scoring pass itself

The score renormalizes over present inputs, so weights alone cannot reproduce
per-component points. One pass emits both, and the endpoint serves it, so no
client can become a second authority over the score."
```

---

### Task 13: Score Attribution lens

**Files:**
- Create: `app/src/pages/breadth/views/ScoreAttributionView.jsx`
- Create: `app/src/pages/breadth/views/ScoreAttributionView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`

**Interfaces:**
- Consumes: `GET /api/breadth-monitor/score-components/{date}` (Task 12); lens props bundle; `useSWR` + `fetcher` following `Breadth.jsx`'s import.
- Produces: style key `'attribution'`, label `Score Attribution`, `kind: 'lens'`.

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/breadth/views/ScoreAttributionView.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
vi.mock('swr', () => ({ default: () => ({ data: mockData.current, isLoading: false, error: null }) }))

const { default: ScoreAttributionView } = await import('./ScoreAttributionView')

const row = { date: '2026-08-28' }

describe('ScoreAttributionView', () => {
  it('draws a bar per component with its share of the total', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'vix', label: 'VIX (inverted)', weight: 10, points: 10, max_points: 10, present: true, value: 18 },
        { key: 'ratio_5day', label: '5-day up/down ratio', weight: 15, points: 6, max_points: 15, present: true, value: 1.0 },
      ],
      prev: { date: '2026-08-27', total: 70,
              components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 4, max_points: 10, present: true, value: 24 }] },
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('component-vix').textContent).toMatch(/10 \/ 10/)
    expect(getByTestId('delta-vix').textContent).toMatch(/\+6/)
  })

  it('marks an absent component as dropped from the ratio, not as zero', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'cboe_putcall', label: 'CBOE put/call (contrarian)', weight: 10, points: 0, max_points: 10, present: false, value: null },
      ],
      prev: null,
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('component-cboe_putcall').textContent).toMatch(/not reported/i)
  })

  it('says so when the session was never recorded', () => {
    mockData.current = { ok: false, date: '2026-08-28', reason: 'no stored session for that date' }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-unavailable').textContent).toMatch(/no stored session/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/ScoreAttributionView.test.jsx`
Expected: FAIL — cannot resolve `./ScoreAttributionView`.

- [ ] **Step 3: Implement the view**

Create `app/src/pages/breadth/views/ScoreAttributionView.jsx`.

⚠️ There is **no shared fetcher module** in this app — `Breadth.jsx:47` declares
`const fetcher = url => fetch(url).then(r => r.json())` inline, and so does
`useCommunity.js`. Follow that idiom: declare it at module top. Importing
`../../../lib/fetcher` would fail at module load; that path does not exist.

```jsx
/**
 * Score Attribution — the nine weighted components behind `breadth_score`,
 * each showing points earned of points available, and the change vs the prior
 * session. The numbers come from the server's own scoring pass; this view
 * never re-derives them, because a renormalized score cannot be reconstructed
 * from its weights alone.
 */
import useSWR from 'swr'
import { resolveViewColors } from './breadthViewShared'

// Declared inline to match Breadth.jsx:47 — this app has no shared fetcher module.
const fetcher = url => fetch(url).then(r => r.json())

export default function ScoreAttributionView({ currentRow, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const date = currentRow?.date
  const { data, isLoading, error } = useSWR(
    date ? `/api/breadth-monitor/score-components/${date}` : null,
    fetcher,
  )

  if (isLoading) {
    return <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#64748b' }}>Loading attribution…</div>
  }
  if (error || !data || data.ok === false) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="attribution-unavailable">
          {error ? `Could not load attribution — ${error.message ?? 'network error'}`
                 : (data?.reason ?? 'No attribution for this session')}
        </div>
      </div>
    )
  }

  const prevByKey = Object.fromEntries((data.prev?.components ?? []).map(c => [c.key, c]))
  const totalDelta = (data.total != null && data.prev?.total != null) ? data.total - data.prev.total : null
  const dropped = data.components.filter(c => !c.present)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ font: '800 26px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
          {data.total == null ? '—' : data.total}
        </span>
        {totalDelta != null && (
          <span style={{ font: '700 12px \'Instrument Sans\', sans-serif',
                         color: totalDelta >= 0 ? colors.bull : colors.bear }}>
            {totalDelta >= 0 ? '+' : ''}{totalDelta.toFixed(1)} vs {data.prev.date}
          </span>
        )}
        <span style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          {data.min_weight_met
            ? `renormalized over ${data.components.filter(c => c.present).length} of ${data.components.length} inputs`
            : 'below the minimum available weight — no score reported'}
        </span>
      </div>

      {data.components.map(c => {
        const prev = prevByKey[c.key]
        const delta = (prev && c.present && prev.present) ? c.points - prev.points : null
        const fill = c.max_points ? (c.points / c.max_points) * 100 : 0
        return (
          <div key={c.key} data-testid={`component-${c.key}`}
               style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 150, flex: '0 0 150px', textAlign: 'right',
                          font: '700 10px \'Instrument Sans\', sans-serif', color: '#94a3b8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.label}
            </div>
            <div style={{ flex: 1, minWidth: 0, height: 16, borderRadius: 3,
                          background: 'rgba(255,255,255,0.04)', position: 'relative' }}>
              {c.present && (
                <div style={{ width: `${fill}%`, height: '100%', borderRadius: 3,
                              opacity: colors.fillOpacity,
                              background: fill >= 50 ? colors.bull : colors.bear }} />
              )}
            </div>
            <div style={{ width: 130, flex: '0 0 130px', font: '700 10px \'Instrument Sans\', sans-serif',
                          color: c.present ? '#e2e8f0' : '#64748b' }}>
              {c.present ? `${Number(c.points).toFixed(0)} / ${c.max_points}` : 'Not reported'}
              {delta != null && (
                <span data-testid={`delta-${c.key}`}
                      style={{ marginLeft: 6, color: delta >= 0 ? colors.bull : colors.bear }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {dropped.length > 0 && (
        <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 10 }}>
          {dropped.length} component{dropped.length > 1 ? 's' : ''} dropped from both sides of the ratio —
          an input that cannot be measured is not scored zero.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Register the style**

Append `'attribution'` to `STYLES` and add:

```js
  attribution: { kind: 'lens', label: 'Score Attribution', eligibleKeys: () => [], defaultVisible: [], options: THEME_OPTIONS },
```

Register `attribution: ScoreAttributionView` in `viewRegistry.js`.

⚠️ The rail in `viewRegistry.test.jsx` renders every style. This view calls `useSWR`, which will run unmocked there. Add to the top of `viewRegistry.test.jsx`:

```jsx
vi.mock('swr', () => ({ default: () => ({ data: null, isLoading: false, error: null }) }))
```

and import `vi` from vitest. The view's error branch renders fine with null data, which is exactly the "renders without throwing" property the rail checks.

- [ ] **Step 5: Run the tests and commit**

Run: `cd app && npx vitest run src/pages/breadth`
Expected: PASS.

```bash
git add app/src/pages/breadth/views/ScoreAttributionView.jsx app/src/pages/breadth/views/ScoreAttributionView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js app/src/pages/breadth/views/viewRegistry.test.jsx
git commit -m "feat(breadth): Score Attribution lens - what is holding the score up"
```

---

### Task 14: Analogue Deck lens

**Files:**
- Modify: `api/routers/breadth_monitor.py` (`top_n` query param on `/analogues`)
- Create: `app/src/pages/breadth/views/AnalogueDeckView.jsx`
- Create: `app/src/pages/breadth/views/AnalogueDeckView.test.jsx`
- Modify: `app/src/pages/breadth/views/viewMetricConfig.js`
- Modify: `app/src/pages/breadth/views/viewRegistry.js`
- Create: `tests/test_breadth_analogues_router.py`

**Interfaces:**
- Consumes: `GET /api/breadth-monitor/analogues?top_n=N`.
- Produces: style key `'analogues'`, label `Analogue Deck`, `kind: 'lens'`.

The endpoint's payload shape (`api/services/breadth_analogues.py:229-241`) is:
`{ reference_date, reference_metrics, analogues: [{ date, similarity, distance, metrics_then, forward_returns: { fwd_5d, fwd_10d, fwd_20d, fwd_60d } }] }`.
`forward_returns` is `{}` when `sp500_close` was missing, and individual horizons are absent when the future rows do not exist yet.

**Known, deliberate duplication:** `Breadth.jsx` already renders this endpoint in an admin-only `analogues` tab (`activeTab === 'analogues'`, gated at `Breadth.jsx:843`). This lens brings the same data to paid users on the Views tab. Both read the one endpoint, so there is no second authority over the numbers — but the two renderings are duplicated presentation. Leave the admin tab untouched; consolidating it is a separate change and out of scope here.

- [ ] **Step 1: Write the failing backend test**

Create `tests/test_breadth_analogues_router.py`:

```python
import inspect
from api.services.breadth_analogues import find_analogues


def test_find_analogues_accepts_a_match_count():
    sig = inspect.signature(find_analogues)
    assert "top_n" in sig.parameters
    assert sig.parameters["top_n"].default == 5


def test_router_exposes_top_n_as_a_bounded_query_param():
    from api.routers import breadth_monitor as r
    sig = inspect.signature(r.get_breadth_analogues)
    assert "top_n" in sig.parameters, "the endpoint must let the caller pick the match count"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_breadth_analogues_router.py -v`
Expected: FAIL on the second test — the endpoint takes no `top_n`.

- [ ] **Step 3: Add the bounded query param**

In `api/routers/breadth_monitor.py` replace the analogues endpoint:

```python
@router.get("/api/breadth-monitor/analogues")
def get_breadth_analogues(top_n: int = Query(default=5, ge=3, le=10),
                          _user: dict = Depends(require_paid)):
    """Return the top_n historical dates most similar to the current breadth regime."""
    try:
        return find_analogues(top_n=top_n)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

⚠️ `find_analogues` caches its result in a module-level `_cache` keyed by nothing. With `top_n` now variable, a request for 10 can be served a cached 5. Change the cache key in `api/services/breadth_analogues.py` to include `top_n` — store `_cache["top_n"]` alongside `ts`/`data` and treat a differing `top_n` as a miss.

- [ ] **Step 4: Run the backend test**

Run: `python -m pytest tests/test_breadth_analogues_router.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing view test**

Create `app/src/pages/breadth/views/AnalogueDeckView.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
vi.mock('swr', () => ({ default: () => ({ data: mockData.current, isLoading: false, error: null }) }))

const { default: AnalogueDeckView } = await import('./AnalogueDeckView')

describe('AnalogueDeckView', () => {
  it('ranks matches and shows what happened next', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [
        { date: '2025-03-11', similarity: 92.4, forward_returns: { fwd_5d: 1.2, fwd_20d: 4.5 } },
        { date: '2024-11-02', similarity: 88.1, forward_returns: { fwd_5d: -0.8, fwd_20d: -2.1 } },
      ],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-2025-03-11').textContent).toMatch(/92\.4/)
    expect(getByTestId('analogue-2025-03-11').textContent).toMatch(/\+4\.5/)
  })

  it('summarizes the forward distribution rather than only the top match', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [
        { date: 'a', similarity: 90, forward_returns: { fwd_20d: 4 } },
        { date: 'b', similarity: 80, forward_returns: { fwd_20d: 2 } },
        { date: 'c', similarity: 70, forward_returns: { fwd_20d: -3 } },
      ],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-summary').textContent).toMatch(/2 of 3 higher/i)
  })

  it('does not invent a return for a horizon the history cannot reach', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [{ date: 'a', similarity: 90, forward_returns: {} }],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-a').textContent).toMatch(/not yet/i)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/breadth/views/AnalogueDeckView.test.jsx`
Expected: FAIL — cannot resolve `./AnalogueDeckView`.

- [ ] **Step 7: Implement the view**

Create `app/src/pages/breadth/views/AnalogueDeckView.jsx`:

```jsx
/**
 * Analogue Deck — the sessions in history whose breadth vector most resembles
 * today's, and what SPY did next. The similarity search and the forward returns
 * are the server's (`breadth_analogues.py`); this view ranks and reads them.
 */
import useSWR from 'swr'
import { resolveViewColors } from './breadthViewShared'

// Declared inline to match Breadth.jsx:47 — this app has no shared fetcher module.
const fetcher = url => fetch(url).then(r => r.json())

const HORIZON_LABEL = { fwd_5d: '5 days', fwd_10d: '10 days', fwd_20d: '20 days', fwd_60d: '60 days' }

export default function AnalogueDeckView({ options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const horizon = options.horizon ?? 'fwd_20d'
  const topN = Number(options.matches ?? 5)

  const { data, isLoading, error } = useSWR(
    `/api/breadth-monitor/analogues?top_n=${topN}`, fetcher,
    { refreshInterval: 6 * 60 * 60 * 1000 },
  )

  if (isLoading) {
    return <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#64748b' }}>Finding analogues…</div>
  }
  const analogues = data?.analogues ?? []
  if (error || !analogues.length) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {error ? `Could not load analogues — ${error.message ?? 'network error'}`
               : 'No historical session resembles today closely enough to report.'}
      </div>
    )
  }

  const withReturn = analogues.filter(a => a.forward_returns?.[horizon] != null)
  const higher = withReturn.filter(a => a.forward_returns[horizon] > 0).length
  const median = withReturn.length
    ? [...withReturn.map(a => a.forward_returns[horizon])].sort((x, y) => x - y)[Math.floor(withReturn.length / 2)]
    : null

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div data-testid="analogue-summary"
           style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea', marginBottom: 4 }}>
        {withReturn.length
          ? `${higher} of ${withReturn.length} higher ${HORIZON_LABEL[horizon]} later`
          : `No match has ${HORIZON_LABEL[horizon]} of history after it yet`}
        {median != null && (
          <span style={{ marginLeft: 8, font: '700 12px \'Instrument Sans\', sans-serif',
                         color: median >= 0 ? colors.bull : colors.bear }}>
            median {median >= 0 ? '+' : ''}{median.toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginBottom: 10 }}>
        Matched against {data.reference_date} · similarity over 16 weighted breadth metrics
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {analogues.map(a => {
          const fwd = a.forward_returns?.[horizon]
          return (
            <div key={a.date} data-testid={`analogue-${a.date}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ font: '700 12px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>{a.date}</span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
                  {Number(a.similarity).toFixed(1)}% match
                </span>
              </div>
              <div style={{ font: `800 20px 'Instrument Sans', sans-serif`, marginTop: 4,
                            color: fwd == null ? '#64748b' : (fwd >= 0 ? colors.bull : colors.bear) }}>
                {fwd == null ? 'Not yet' : `${fwd >= 0 ? '+' : ''}${Number(fwd).toFixed(1)}%`}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>
                {fwd == null ? `less than ${HORIZON_LABEL[horizon]} of history after it`
                             : `SPY, ${HORIZON_LABEL[horizon]} later`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Register the style**

Append `'analogues'` to `STYLES`. Add:

```js
const ANALOGUE_OPTIONS = [
  { name: 'horizon', label: 'Forward horizon', type: 'select', default: 'fwd_20d',
    choices: [
      { value: 'fwd_5d', label: '5 days' }, { value: 'fwd_10d', label: '10 days' },
      { value: 'fwd_20d', label: '20 days' }, { value: 'fwd_60d', label: '60 days' },
    ] },
  { name: 'matches', label: 'Matches shown', type: 'select', default: 5,
    choices: [3, 5, 10].map(v => ({ value: v, label: String(v) })) },
]
```

and:

```js
  analogues: { kind: 'lens', label: 'Analogue Deck', eligibleKeys: () => [], defaultVisible: [], options: [...ANALOGUE_OPTIONS, ...THEME_OPTIONS] },
```

Register `analogues: AnalogueDeckView` in `viewRegistry.js`. The `swr` mock added to the rail in Task 13 Step 4 already covers this view.

- [ ] **Step 9: Run everything and commit**

Run: `cd app && npx vitest run src/pages/breadth` and `python -m pytest tests/ -k breadth -q`
Expected: PASS.

```bash
git add app/src/pages/breadth/views/AnalogueDeckView.jsx app/src/pages/breadth/views/AnalogueDeckView.test.jsx app/src/pages/breadth/views/viewMetricConfig.js app/src/pages/breadth/views/viewRegistry.js api/routers/breadth_monitor.py api/services/breadth_analogues.py tests/test_breadth_analogues_router.py
git commit -m "feat(breadth): Analogue Deck lens - days like today and what followed

Adds a bounded top_n to the analogues endpoint and keys its cache on it, so a
request for 10 matches is not served a cached 5."
```

---

### Task 15: Final verification — all 16 on the deployed page

**Files:** none — verification gate.

- [ ] **Step 1: Full suite, both sides**

Run: `cd app && npx vitest run` and `python -m pytest tests/ -q`
Expected: PASS apart from failures that reproduce on clean `origin/master`. Read the summary line — its absence means the run did not finish.

- [ ] **Step 2: Push and deploy**

```bash
git push origin feat/breadth-lenses
git push origin feat/breadth-lenses:master
```

- [ ] **Step 3: Confirm the served bundle**

Uptime-based deploy polling false-triggers when concurrent pushes stack deploys. Grep the entry-referenced chunk for a string unique to this work (`Regime Clock`) to prove the bundle in production is this one.

- [ ] **Step 4: Open every one of the 16 and look**

Click through all 16 styles on the deployed Views tab. For each: it renders, its Customize panel shows the right controls (checklist for boards, options only for lenses), and switching palette actually changes its colors.

Specifically confirm:
- The switcher reads **10 BOARDS · 6 LENSES**.
- **Score Attribution** components sum visibly toward the headline score, and an absent input reads "Not reported" rather than a zero bar.
- **Analogue Deck** shows real past dates with forward returns.
- No lens shows a chart when it lacks data — it shows its stated reason.

- [ ] **Step 5: Record the outcome**

Note any view that needed a fix after looking, and what the tests missed about it. That list is the honest measure of whether the rails in this plan were worth what they cost.
