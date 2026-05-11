# Multi-Chart Layouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated multi-chart page (`/multi-chart`) where users can view 2, 3, 4, or 6 independent charts side-by-side in selectable grid layouts (1×2, 2×1, 2×2, 3×1, 1×3, 2×3). Each cell is a full `StockChart` with its own symbol, timeframe, and settings. Optional synced crosshair + linked time range across cells. Preset "Watch Panel" loads QQQ/SPY/IWM/DIA in 2×2. Layout + per-cell state persists per user.

**Architecture:** Standalone React page rendered at `/multi-chart`. Top-level state tree:
```js
{
  layout: '2x2',  // one of LAYOUTS
  cells: [
    { id: 'a', sym: 'QQQ', tf: 'D', chartSettings: {...} },
    { id: 'b', sym: 'SPY', tf: 'D', chartSettings: {...} },
    ...
  ],
  syncCrosshair: false,
  syncTimeRange: false,
}
```

Sync features use lightweight context providers (`<MultiChartSyncContext>`) so cells can subscribe to global crosshair/time-range events without prop drilling. Each cell renders an existing `StockChart` with its own slice of state — full feature parity (indicators, comparison, screenshot, drawings) on every cell.

**Tech Stack:** React Router (existing), CSS Grid for layout, Lightweight Charts v5 (existing per-cell), `usePreferences` (existing) for persistence.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `app/src/pages/MultiChart.jsx` | Page component — top-level layout selector + grid of `MultiChartCell` |
| `app/src/pages/MultiChart.module.css` | Page styles + grid layout classes |
| `app/src/pages/multichart/MultiChartCell.jsx` | One grid cell — wraps `StockChart` with per-cell symbol/tf controls + remove button |
| `app/src/pages/multichart/LayoutPicker.jsx` | Layout selector dropdown/buttons (1×2, 2×1, 2×2, 3×1, 1×3, 2×3) |
| `app/src/pages/multichart/MultiChartSyncContext.jsx` | React Context for sync crosshair + time range |
| `app/src/pages/multichart/multiChartLayouts.js` | Pure constants/utils: layout definitions, default cell counts, preset Watch Panel |
| `app/src/pages/multichart/multiChartLayouts.test.js` | Vitest tests for layout utils |

### Modified files
| File | Change |
|---|---|
| `app/src/App.jsx` | Add `<Route path="/multi-chart" element={<MultiChart />} />` |
| `app/src/components/NavBar.jsx` | Add "Multi-Chart" nav item |
| `app/src/components/MobileNav.jsx` | Mirror nav addition |
| `app/src/components/StockChart.jsx` | Expose optional `onCrosshairMove`, `onTimeRangeChange`, `externalCrosshair`, `externalTimeRange` props for sync. ADDITIVE — no behavior change when props absent |

---

## Task 1: Layout utilities + tests

**Files:**
- Create: `app/src/pages/multichart/multiChartLayouts.js`
- Create: `app/src/pages/multichart/multiChartLayouts.test.js`

- [ ] **Step 1: Tests**

```javascript
import { describe, it, expect } from 'vitest';
import { LAYOUTS, getLayoutCellCount, makeDefaultCells, WATCH_PANEL_PRESET } from './multiChartLayouts';


describe('LAYOUTS', () => {
  it('contains expected entries', () => {
    expect(LAYOUTS.map(l => l.id).sort()).toEqual(
      ['1x1', '1x2', '1x3', '2x1', '2x2', '2x3', '3x1'].sort()
    );
  });

  it('each layout has rows + cols + cellCount', () => {
    for (const l of LAYOUTS) {
      expect(l.rows).toBeGreaterThan(0);
      expect(l.cols).toBeGreaterThan(0);
      expect(l.cellCount).toBe(l.rows * l.cols);
    }
  });
});


describe('getLayoutCellCount', () => {
  it('returns correct count per layout id', () => {
    expect(getLayoutCellCount('1x1')).toBe(1);
    expect(getLayoutCellCount('2x2')).toBe(4);
    expect(getLayoutCellCount('3x1')).toBe(3);
    expect(getLayoutCellCount('2x3')).toBe(6);
  });

  it('returns 1 for unknown id', () => {
    expect(getLayoutCellCount('unknown')).toBe(1);
  });
});


describe('makeDefaultCells', () => {
  it('produces N cells with default sym QQQ and tf D', () => {
    const cells = makeDefaultCells(4);
    expect(cells.length).toBe(4);
    for (const c of cells) {
      expect(c.sym).toBe('QQQ');
      expect(c.tf).toBe('D');
      expect(typeof c.id).toBe('string');
    }
  });

  it('produces unique ids', () => {
    const cells = makeDefaultCells(6);
    const ids = cells.map(c => c.id);
    expect(new Set(ids).size).toBe(6);
  });
});


describe('WATCH_PANEL_PRESET', () => {
  it('is a 2x2 layout with QQQ/SPY/IWM/DIA', () => {
    expect(WATCH_PANEL_PRESET.layout).toBe('2x2');
    expect(WATCH_PANEL_PRESET.cells.length).toBe(4);
    expect(WATCH_PANEL_PRESET.cells.map(c => c.sym).sort())
      .toEqual(['DIA', 'IWM', 'QQQ', 'SPY']);
  });
});
```

- [ ] **Step 2: Failing test run**

```bash
cd app && npx vitest run src/pages/multichart/multiChartLayouts.test.js
```

- [ ] **Step 3: Implement**

```javascript
// app/src/pages/multichart/multiChartLayouts.js


export const LAYOUTS = [
  { id: '1x1', rows: 1, cols: 1, cellCount: 1, label: '1 chart' },
  { id: '1x2', rows: 1, cols: 2, cellCount: 2, label: 'Side by side' },
  { id: '2x1', rows: 2, cols: 1, cellCount: 2, label: 'Stacked' },
  { id: '2x2', rows: 2, cols: 2, cellCount: 4, label: '2×2 grid' },
  { id: '3x1', rows: 3, cols: 1, cellCount: 3, label: '3 stacked' },
  { id: '1x3', rows: 1, cols: 3, cellCount: 3, label: '3 side-by-side' },
  { id: '2x3', rows: 2, cols: 3, cellCount: 6, label: '6 grid' },
];


export function getLayoutCellCount(layoutId) {
  const l = LAYOUTS.find(x => x.id === layoutId);
  return l?.cellCount ?? 1;
}


function genId() {
  return Math.random().toString(36).slice(2, 8);
}


export function makeDefaultCells(count) {
  return Array.from({ length: count }, () => ({
    id: genId(),
    sym: 'QQQ',
    tf: 'D',
    chartSettings: null,  // null = inherit from user prefs
  }));
}


export const WATCH_PANEL_PRESET = {
  layout: '2x2',
  cells: [
    { id: 'wp-qqq', sym: 'QQQ', tf: 'D', chartSettings: null },
    { id: 'wp-spy', sym: 'SPY', tf: 'D', chartSettings: null },
    { id: 'wp-iwm', sym: 'IWM', tf: 'D', chartSettings: null },
    { id: 'wp-dia', sym: 'DIA', tf: 'D', chartSettings: null },
  ],
  syncCrosshair: true,
  syncTimeRange: true,
};
```

- [ ] **Step 4: Tests pass**

```bash
cd app && npx vitest run src/pages/multichart/multiChartLayouts.test.js
```

11/11 should pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/multichart/multiChartLayouts.js app/src/pages/multichart/multiChartLayouts.test.js
git commit -m "feat(multichart): layout definitions + Watch Panel preset"
```

---

## Task 2: LayoutPicker component

**Files:**
- Create: `app/src/pages/multichart/LayoutPicker.jsx`

- [ ] **Step 1: Component**

```jsx
import styles from '../MultiChart.module.css';
import { LAYOUTS } from './multiChartLayouts';


export default function LayoutPicker({ currentLayout, onChange }) {
  return (
    <div className={styles.layoutPicker}>
      {LAYOUTS.map(l => (
        <button
          key={l.id}
          className={`${styles.layoutBtn} ${currentLayout === l.id ? styles.layoutBtnActive : ''}`}
          onClick={() => onChange(l.id)}
          title={l.label}
        >
          <LayoutIcon rows={l.rows} cols={l.cols} />
          <span className={styles.layoutBtnLabel}>{l.id}</span>
        </button>
      ))}
    </div>
  );
}


function LayoutIcon({ rows, cols }) {
  const size = 18;
  const gap = 1;
  const cellW = (size - gap * (cols - 1)) / cols;
  const cellH = (size - gap * (rows - 1)) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (cellW + gap)}
          y={r * (cellH + gap)}
          width={cellW}
          height={cellH}
          fill="currentColor"
          opacity="0.7"
        />
      );
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {cells}
    </svg>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/pages/multichart/LayoutPicker.jsx
git commit -m "feat(multichart): LayoutPicker component with SVG icons"
```

---

## Task 3: Sync context (crosshair + time range)

**Files:**
- Create: `app/src/pages/multichart/MultiChartSyncContext.jsx`

- [ ] **Step 1: Context provider**

```jsx
import { createContext, useContext, useState, useCallback } from 'react';

const MultiChartSyncContext = createContext(null);


export function MultiChartSyncProvider({ children, syncCrosshair, syncTimeRange }) {
  const [crosshair, setCrosshair] = useState(null);  // { time, price } | null
  const [timeRange, setTimeRange] = useState(null);  // { from, to } | null

  // Each chart cell reports its crosshair when it moves; if sync is enabled, all
  // other cells render an external crosshair at that time.
  const reportCrosshair = useCallback((payload) => {
    if (!syncCrosshair) return;
    setCrosshair(payload);
  }, [syncCrosshair]);

  const reportTimeRange = useCallback((payload) => {
    if (!syncTimeRange) return;
    setTimeRange(payload);
  }, [syncTimeRange]);

  const value = {
    crosshair: syncCrosshair ? crosshair : null,
    timeRange: syncTimeRange ? timeRange : null,
    reportCrosshair,
    reportTimeRange,
  };

  return (
    <MultiChartSyncContext.Provider value={value}>
      {children}
    </MultiChartSyncContext.Provider>
  );
}


export function useMultiChartSync() {
  return useContext(MultiChartSyncContext);
}
```

- [ ] **Step 2: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/pages/multichart/MultiChartSyncContext.jsx
git commit -m "feat(multichart): sync context for crosshair + time range"
```

---

## Task 4: MultiChartCell component

**Files:**
- Create: `app/src/pages/multichart/MultiChartCell.jsx`

- [ ] **Step 1: Component**

```jsx
import { useCallback } from 'react';
import StockChart from '../../components/StockChart';
import SymbolSearch from '../../components/chart/SymbolSearch';
import { useMultiChartSync } from './MultiChartSyncContext';
import styles from '../MultiChart.module.css';


const TFS = ['1', '5', '15', '30', '60', 'D', 'W', 'M'];
const TF_LABELS = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', D: 'D', W: 'W', M: 'M' };


export default function MultiChartCell({ cell, onChange, onRemove, canRemove }) {
  const sync = useMultiChartSync();

  const handleSymbolChange = useCallback((sym) => {
    onChange({ ...cell, sym });
  }, [cell, onChange]);

  const handleTfChange = useCallback((tf) => {
    onChange({ ...cell, tf });
  }, [cell, onChange]);

  const handleCrosshairMove = useCallback((payload) => {
    sync?.reportCrosshair(payload);
  }, [sync]);

  const handleTimeRangeChange = useCallback((payload) => {
    sync?.reportTimeRange(payload);
  }, [sync]);

  return (
    <div className={styles.cell}>
      <div className={styles.cellHeader}>
        <SymbolSearch
          symbol={cell.sym}
          onChange={handleSymbolChange}
          className={styles.cellSymbol}
        />
        <select
          value={cell.tf}
          onChange={(e) => handleTfChange(e.target.value)}
          className={styles.cellTfSelect}
        >
          {TFS.map(tf => (
            <option key={tf} value={tf}>{TF_LABELS[tf]}</option>
          ))}
        </select>
        {canRemove && (
          <button
            onClick={onRemove}
            className={styles.cellRemove}
            title="Remove cell"
            aria-label="Remove cell"
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.cellChart}>
        <StockChart
          sym={cell.sym}
          tf={cell.tf}
          onSymbolChange={handleSymbolChange}
          onTfChange={handleTfChange}
          onCrosshairMove={handleCrosshairMove}
          onTimeRangeChange={handleTimeRangeChange}
          externalCrosshair={sync?.crosshair}
          externalTimeRange={sync?.timeRange}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/pages/multichart/MultiChartCell.jsx
git commit -m "feat(multichart): MultiChartCell wraps StockChart with per-cell controls"
```

---

## Task 5: Optional StockChart sync hooks (additive props)

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Accept new optional props**

In StockChart's prop destructuring, add:

```jsx
onCrosshairMove,       // (payload: {time, price}) => void
onTimeRangeChange,     // (payload: {from, to}) => void
externalCrosshair,     // {time, price} | null  — render external crosshair from sync
externalTimeRange,     // {from, to} | null  — apply external time range from sync
```

These are ALL optional. If absent, behavior is unchanged.

- [ ] **Step 2: Wire crosshair report**

In the existing `chart.subscribeCrosshairMove(...)` handler, after computing the local crosshair state, call:

```jsx
if (typeof onCrosshairMove === 'function' && param.time) {
  onCrosshairMove({
    time: param.time,
    price: candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : null,
  });
}
```

- [ ] **Step 3: Wire time-range report**

Use Lightweight Charts' `chart.timeScale().subscribeVisibleTimeRangeChange((range) => ...)`:

```jsx
useEffect(() => {
  if (!chartRef.current || typeof onTimeRangeChange !== 'function') return;
  const ts = chartRef.current.timeScale();
  const handler = (range) => {
    if (range) onTimeRangeChange({ from: range.from, to: range.to });
  };
  ts.subscribeVisibleTimeRangeChange(handler);
  return () => {
    try { ts.unsubscribeVisibleTimeRangeChange(handler); } catch {}
  };
}, [onTimeRangeChange]);
```

- [ ] **Step 4: Apply external time range**

```jsx
useEffect(() => {
  if (!chartRef.current || !externalTimeRange) return;
  try {
    chartRef.current.timeScale().setVisibleRange({
      from: externalTimeRange.from,
      to: externalTimeRange.to,
    });
  } catch {}
}, [externalTimeRange]);
```

- [ ] **Step 5: External crosshair display (optional — can be Phase 2)**

Rendering an external crosshair line at a given time requires either:
- A custom canvas overlay (complex), OR
- Using Lightweight Charts' `setCrosshairPosition(price, time, series)` API (clean)

```jsx
useEffect(() => {
  if (!chartRef.current || !candleSeriesRef.current) return;
  if (!externalCrosshair?.time) {
    try { chartRef.current.clearCrosshairPosition(); } catch {}
    return;
  }
  try {
    chartRef.current.setCrosshairPosition(
      externalCrosshair.price?.value ?? externalCrosshair.price ?? 0,
      externalCrosshair.time,
      candleSeriesRef.current
    );
  } catch {}
}, [externalCrosshair]);
```

- [ ] **Step 6: Avoid infinite-loop with self-reports**

When cell A reports a crosshair → context updates → cell A receives `externalCrosshair` → cell A might re-fire its own `onCrosshairMove`. Guard against this:

- Track if the current crosshair came from external vs local
- Don't report crosshair moves originating from `setCrosshairPosition`

Simplest pattern: in the crosshair subscribe handler, only call `onCrosshairMove` when the chart is hovered:

```jsx
chart.subscribeCrosshairMove((param) => {
  if (!param.point || !param.time) return;  // mouse left chart
  // existing crosshair state update
  // ...
  if (typeof onCrosshairMove === 'function') {
    onCrosshairMove({ time: param.time, price: ... });
  }
});
```

The `if (!param.point)` guard means external `setCrosshairPosition` (which doesn't trigger the param.point on remote charts) won't re-fire.

- [ ] **Step 7: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): optional crosshair + time-range sync props (additive)"
git push
```

---

## Task 6: MultiChart page

**Files:**
- Create: `app/src/pages/MultiChart.jsx`
- Create: `app/src/pages/MultiChart.module.css`

- [ ] **Step 1: Page component**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { usePreferences } from '../hooks/usePreferences';
import LayoutPicker from './multichart/LayoutPicker';
import MultiChartCell from './multichart/MultiChartCell';
import { MultiChartSyncProvider } from './multichart/MultiChartSyncContext';
import { getLayoutCellCount, makeDefaultCells, WATCH_PANEL_PRESET, LAYOUTS } from './multichart/multiChartLayouts';
import styles from './MultiChart.module.css';


const STORAGE_KEY = 'multichart_state';


export default function MultiChart() {
  const { prefs, setPref } = usePreferences();

  // Load saved state or default
  const [state, setState] = useState(() => {
    try {
      const saved = prefs?.[STORAGE_KEY];
      if (saved) {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        if (parsed?.layout && Array.isArray(parsed.cells)) return parsed;
      }
    } catch {}
    return {
      layout: '1x2',
      cells: makeDefaultCells(2),
      syncCrosshair: false,
      syncTimeRange: false,
    };
  });

  // Persist on change (debounced via setTimeout in usePreferences)
  useEffect(() => {
    try { setPref(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state, setPref]);

  const setLayout = useCallback((layoutId) => {
    const count = getLayoutCellCount(layoutId);
    setState(prev => {
      const cells = [...prev.cells];
      // Resize cells array to match new count
      while (cells.length < count) {
        cells.push(...makeDefaultCells(count - cells.length));
      }
      while (cells.length > count) cells.pop();
      return { ...prev, layout: layoutId, cells };
    });
  }, []);

  const updateCell = useCallback((idx, nextCell) => {
    setState(prev => {
      const cells = [...prev.cells];
      cells[idx] = nextCell;
      return { ...prev, cells };
    });
  }, []);

  const removeCell = useCallback((idx) => {
    setState(prev => {
      if (prev.cells.length <= 1) return prev;  // never remove the last
      const cells = prev.cells.filter((_, i) => i !== idx);
      // Determine new layout based on remaining count
      const layouts = { 1: '1x1', 2: prev.layout === '2x1' ? '2x1' : '1x2', 3: prev.layout === '1x3' ? '1x3' : '3x1', 4: '2x2', 6: '2x3' };
      const layout = layouts[cells.length] || '1x1';
      return { ...prev, cells, layout };
    });
  }, []);

  const loadWatchPanel = useCallback(() => {
    setState(WATCH_PANEL_PRESET);
  }, []);

  const toggleSync = useCallback((key) => {
    setState(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const layout = LAYOUTS.find(l => l.id === state.layout) || LAYOUTS[0];

  return (
    <MultiChartSyncProvider
      syncCrosshair={state.syncCrosshair}
      syncTimeRange={state.syncTimeRange}
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Multi-Chart</h1>
          <LayoutPicker currentLayout={state.layout} onChange={setLayout} />
          <div className={styles.headerControls}>
            <label className={styles.syncToggle}>
              <input
                type="checkbox"
                checked={state.syncCrosshair}
                onChange={() => toggleSync('syncCrosshair')}
              />
              Sync crosshair
            </label>
            <label className={styles.syncToggle}>
              <input
                type="checkbox"
                checked={state.syncTimeRange}
                onChange={() => toggleSync('syncTimeRange')}
              />
              Sync time range
            </label>
            <button onClick={loadWatchPanel} className={styles.watchPanelBtn}>
              Watch Panel (QQQ/SPY/IWM/DIA)
            </button>
          </div>
        </div>
        <div
          className={styles.grid}
          style={{
            gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          }}
        >
          {state.cells.map((cell, idx) => (
            <MultiChartCell
              key={cell.id}
              cell={cell}
              onChange={(c) => updateCell(idx, c)}
              onRemove={() => removeCell(idx)}
              canRemove={state.cells.length > 1}
            />
          ))}
        </div>
      </div>
    </MultiChartSyncProvider>
  );
}
```

- [ ] **Step 2: CSS**

```css
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg, #0a0a0a);
  color: var(--text, #e5e5e5);
  overflow: hidden;
}
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border, #2a2a2a);
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-heading, #f0f0f0);
  margin: 0;
}
.layoutPicker {
  display: flex;
  gap: 4px;
}
.layoutBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-surface, #161616);
  color: var(--text-muted, #888);
  border: 1px solid var(--border, #2a2a2a);
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: 'IBM Plex Mono', monospace;
}
.layoutBtn:hover {
  color: var(--text, #e5e5e5);
}
.layoutBtnActive {
  background: var(--bg-elevated, #2a2a2a);
  color: var(--ut-gold, #c9a84c);
  border-color: var(--ut-gold, #c9a84c);
}
.layoutBtnLabel {
  font-weight: 600;
}
.headerControls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.syncToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.watchPanelBtn {
  background: var(--ut-gold, #c9a84c);
  color: #000;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
}
.grid {
  flex: 1;
  display: grid;
  gap: 4px;
  padding: 4px;
  min-height: 0;
  overflow: hidden;
}
.cell {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface, #161616);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 4px;
  overflow: hidden;
  min-height: 0;
}
.cellHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #2a2a2a);
  background: var(--bg-elevated, #1f1f1f);
}
.cellSymbol {
  flex: 1;
  font-weight: 600;
  color: var(--text-heading, #f0f0f0);
}
.cellTfSelect {
  background: var(--bg-surface, #161616);
  color: var(--text, #e5e5e5);
  border: 1px solid var(--border, #2a2a2a);
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 11px;
}
.cellRemove {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0 6px;
}
.cellRemove:hover {
  color: var(--loss, #ef4444);
}
.cellChart {
  flex: 1;
  position: relative;
  min-height: 0;
}
```

- [ ] **Step 3: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/pages/MultiChart.jsx app/src/pages/MultiChart.module.css
git commit -m "feat(multichart): MultiChart page with layout + sync controls"
git push
```

---

## Task 7: Routing + navigation

**Files:**
- Modify: `app/src/App.jsx`
- Modify: `app/src/components/NavBar.jsx`
- Possibly modify: `app/src/components/MobileNav.jsx`

- [ ] **Step 1: Read existing routes**

```bash
grep -n "Route path=\|lazy\|import.*pages" app/src/App.jsx | head -20
```

- [ ] **Step 2: Add `/multi-chart` route**

Follow the existing pattern (likely React Router v6 with lazy loading):

```jsx
const MultiChart = lazy(() => import('./pages/MultiChart'));

// Inside <Routes>:
<Route path="/multi-chart" element={
  <AuthGuard requireAdmin={false}>
    <MultiChart />
  </AuthGuard>
} />
```

Note: AuthGuard params — check existing patterns. Multi-chart should be available to all logged-in users (not admin-only). If your AuthGuard handles this differently, match.

- [ ] **Step 3: Add NavBar entry**

In `app/src/components/NavBar.jsx`, add a nav item alongside the existing ones (Dashboard, Morning Wire, UCT 20, etc.):

```jsx
{ path: '/multi-chart', label: 'Multi-Chart', icon: '⊞' },
```

Match the existing item shape.

- [ ] **Step 4: MobileNav mirror**

If `MobileNav.jsx` exists and has its own nav list, add the same entry.

- [ ] **Step 5: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/App.jsx app/src/components/NavBar.jsx app/src/components/MobileNav.jsx
git commit -m "feat(multichart): route + nav entry for /multi-chart page"
git push
```

---

## Task 8: Smoke test + edge cases

- [ ] **Step 1: Build cleanly**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 2: App imports**

```bash
python -c "from api.main import app; print('OK')"
```

- [ ] **Step 3: Frontend tests**

```bash
cd app && npx vitest run src/pages/multichart/multiChartLayouts.test.js && cd ..
```

- [ ] **Step 4: Manual smoke test**

```bash
cd app && npm run dev
```

1. Navigate to `/multi-chart` — page loads with 1×2 layout (default), 2 cells with QQQ/QQQ
2. Click 2×2 layout button — grid expands to 4 cells
3. Change first cell's symbol to AAPL — chart loads
4. Change first cell's TF to 5m — chart switches
5. Click × on cell 4 — cell removes, layout downsizes
6. Click "Watch Panel" — layout becomes 2×2 with QQQ/SPY/IWM/DIA, sync on
7. Hover on one chart — verify crosshair appears at same time on other 3 charts (sync crosshair on)
8. Zoom in on one chart — verify other 3 charts zoom to same range (sync time range on)
9. Toggle sync off — verify crosshairs go independent
10. Reload page — verify state persists

If any step fails, fix before committing.

- [ ] **Step 5: Edge-case hardening**

E1: Removing the last cell — block it (already guarded via `canRemove`).
E2: Adding a sym that doesn't exist — StockChart gracefully shows empty bars; no need for extra handling.
E3: Two cells with same sym — works fine, but sync crosshair might be confusing. No special handling needed.
E4: Very large layouts (2×3 = 6 charts) on a low-power device — performance: each chart is independent, ~100ms init each. 6 charts loading in parallel could spike CPU briefly. Acceptable.

- [ ] **Step 6: Final commit + push if any tweaks**

```bash
git add <files>
git commit -m "fix(multichart): smoke test polish"
git push
```

---

## Done — what changed

After this plan ships:

1. `/multi-chart` is a new page on the dashboard
2. 7 layout options (1×1, 1×2, 2×1, 2×2, 3×1, 1×3, 2×3)
3. Each cell is a full StockChart with all features (indicators, comparison, screenshot, drawings)
4. Synced crosshair across cells (optional toggle)
5. Synced time range across cells (optional toggle)
6. Watch Panel preset loads QQQ/SPY/IWM/DIA in 2×2 with sync on
7. State persists per user via existing `usePreferences`

Visual impact: **Bloomberg-tier cross-asset view**. Watch the indexes simultaneously, drill any single chart for detail.

## Self-review

- Layout utilities are pure functions, fully tested
- Sync context is opt-in (no behavior change when toggles off)
- StockChart sync props are additive — existing 14+ callers continue working
- No backend changes
- LayoutPicker uses inline SVG for icons (no asset dependency)
- MultiChartCell wraps existing StockChart; no chart logic duplicated
- Watch Panel preset is a clean one-click "demo" entry point
- No placeholders
