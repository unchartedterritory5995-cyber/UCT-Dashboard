# Chart Symbol Comparison Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay up to 5 comparison tickers on any StockChart as normalized % change lines, so traders can see relative performance (e.g., AAPL vs QQQ, MSFT vs SPY, SOXX vs NVDA). Persistent per chart, with live-tick updates.

**Architecture:** Each comparison is a `{sym, color, enabled}` entry stored in `chartSettings.comparisonSymbols`. StockChart fetches the comparison symbol's bars via existing `/api/bars` endpoint, normalizes by % change from the first visible bar (`100 × (close[i] - close[0]) / close[0]`), and renders on the LEFT price scale as a `LineSeries`. The main price stays on the RIGHT scale. A "Compare" button in the toolbar opens a popover with symbol search + active-comparison list (add/toggle/remove). Tick updates flow through `realtimeCandle` registry for live updates.

**Tech Stack:** React + Lightweight Charts v5 (LineSeries with `priceScaleId: 'left'`), existing `SymbolSearch` component, existing `chartDefaults` + `usePreferences` persistence, existing `/api/bars` endpoint, `realtimeCandle.js` registry from Plan 4.

**Spec:** docs/superpowers/specs/ (no separate spec — this plan IS the spec; user approved scope verbally as part of elite-tier roadmap on 2026-05-10).

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `app/src/components/chart/ComparisonPicker.jsx` | Popover UI: search input + active-comparison list + add/remove/toggle |
| `app/src/components/chart/ComparisonPicker.module.css` | Popover styles |
| `app/src/components/chart/comparisonUtils.js` | Pure functions: `normalizeToPctChange(bars)`, `pickComparisonColor(idx)` |
| `tests/test_comparison_utils.js` | Vitest tests for normalize + color picker |

### Modified files
| File | Change |
|---|---|
| `app/src/components/chart/chartDefaults.js` | Add `comparisonSymbols: []` array + extend `mergeChartSettings` |
| `app/src/components/StockChart.jsx` | Fetch comparison bars per active sym (SWR), normalize via `comparisonUtils`, render as left-scale LineSeries, subscribe to `realtimeCandle` for live updates, render legend with toggle/remove |
| `app/src/components/chart/ChartToolbar.jsx` | Add "Compare" button that opens `ComparisonPicker` popover |

---

## Task 1: Pure utilities + tests

**Files:**
- Create: `app/src/components/chart/comparisonUtils.js`
- Create: `app/src/components/chart/comparisonUtils.test.js`

- [ ] **Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { normalizeToPctChange, pickComparisonColor, COMPARISON_PALETTE } from './comparisonUtils';


describe('normalizeToPctChange', () => {
  it('returns array same length as input', () => {
    const bars = [
      { t: 1, c: 100 },
      { t: 2, c: 105 },
      { t: 3, c: 110 },
    ];
    const result = normalizeToPctChange(bars);
    expect(result.length).toBe(3);
  });

  it('first point is 0%', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: 110 }];
    const result = normalizeToPctChange(bars);
    expect(result[0].value).toBe(0);
  });

  it('computes % change correctly', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: 110 }, { t: 3, c: 90 }];
    const result = normalizeToPctChange(bars);
    expect(result[1].value).toBeCloseTo(10, 5);
    expect(result[2].value).toBeCloseTo(-10, 5);
  });

  it('handles empty input', () => {
    expect(normalizeToPctChange([])).toEqual([]);
  });

  it('handles single bar', () => {
    const bars = [{ t: 1, c: 100 }];
    expect(normalizeToPctChange(bars)).toEqual([{ time: 1, value: 0 }]);
  });

  it('skips bars with missing close', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: null }, { t: 3, c: 110 }];
    const result = normalizeToPctChange(bars);
    expect(result.length).toBe(2);
    expect(result[1].value).toBeCloseTo(10, 5);
  });

  it('handles zero base close gracefully', () => {
    const bars = [{ t: 1, c: 0 }, { t: 2, c: 100 }];
    const result = normalizeToPctChange(bars);
    // Should not produce Infinity — skip first or treat as 0
    expect(result.every(p => Number.isFinite(p.value))).toBe(true);
  });
});


describe('pickComparisonColor', () => {
  it('cycles through palette', () => {
    expect(pickComparisonColor(0)).toBe(COMPARISON_PALETTE[0]);
    expect(pickComparisonColor(1)).toBe(COMPARISON_PALETTE[1]);
    expect(pickComparisonColor(COMPARISON_PALETTE.length)).toBe(COMPARISON_PALETTE[0]);
  });

  it('handles negative idx', () => {
    expect(pickComparisonColor(-1)).toBe(COMPARISON_PALETTE[0]);
  });
});
```

- [ ] **Step 2: Run, verify fails**

```bash
cd app && npx vitest run src/components/chart/comparisonUtils.test.js
```

Expected: import error or test failures.

- [ ] **Step 3: Implement utilities**

```javascript
// app/src/components/chart/comparisonUtils.js

export const COMPARISON_PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
  '#c084fc', // purple
];

/**
 * Convert OHLCV bars into a {time, value} series normalized to % change from the
 * first valid bar. Skips bars with null/undefined close.
 *
 * @param {Array<{t: number, c: number}>} bars
 * @returns {Array<{time: number, value: number}>}
 */
export function normalizeToPctChange(bars) {
  if (!bars || bars.length === 0) return [];
  let baseClose = null;
  const result = [];
  for (const bar of bars) {
    const c = bar?.c;
    if (c == null || !Number.isFinite(c)) continue;
    if (baseClose === null) {
      baseClose = c;
    }
    if (baseClose === 0) {
      result.push({ time: bar.t, value: 0 });
      continue;
    }
    const pct = ((c - baseClose) / baseClose) * 100;
    result.push({ time: bar.t, value: pct });
  }
  return result;
}

/**
 * Pick a color from the comparison palette for a given index (cycles).
 */
export function pickComparisonColor(idx) {
  const n = COMPARISON_PALETTE.length;
  const safe = Math.max(0, idx | 0);
  return COMPARISON_PALETTE[safe % n];
}
```

- [ ] **Step 4: Tests pass**

```bash
cd app && npx vitest run src/components/chart/comparisonUtils.test.js
```

8/8 should pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/comparisonUtils.js app/src/components/chart/comparisonUtils.test.js
git commit -m "feat(charts): add comparison overlay utilities (normalize + color)"
```

---

## Task 2: chartDefaults schema

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js`

- [ ] **Step 1: Add field to defaults**

In `CHART_DEFAULTS`, add at the same level as `indicators` / `heikinAshi` / `logScale`:

```javascript
comparisonSymbols: [], // Array<{ sym: string, color: string, enabled: boolean }>
```

- [ ] **Step 2: Extend mergeChartSettings**

In the merge function, ensure `comparisonSymbols` is correctly carried over:

```javascript
comparisonSymbols: Array.isArray(userSettings?.comparisonSymbols)
  ? userSettings.comparisonSymbols
  : CHART_DEFAULTS.comparisonSymbols,
```

This guards against malformed user data — if the saved value isn't an array (e.g., from corrupted localStorage), fall back to default empty array.

- [ ] **Step 3: Build**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/chartDefaults.js
git commit -m "feat(charts): add comparisonSymbols to chartDefaults schema"
```

---

## Task 3: ComparisonPicker popover

**Files:**
- Create: `app/src/components/chart/ComparisonPicker.jsx`
- Create: `app/src/components/chart/ComparisonPicker.module.css`

- [ ] **Step 1: Build the picker component**

```jsx
// app/src/components/chart/ComparisonPicker.jsx
import { useState, useRef, useEffect } from 'react';
import styles from './ComparisonPicker.module.css';
import { pickComparisonColor } from './comparisonUtils';


const MAX_COMPARISONS = 5;
const POPULAR_TICKERS = ['QQQ', 'SPY', 'IWM', 'DIA', 'NDX', 'VIX', 'BTC-USD'];


export default function ComparisonPicker({ comparisons, onUpdate, onClose }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function addComparison(sym) {
    const clean = String(sym || '').trim().toUpperCase();
    if (!clean) return;
    if (comparisons.length >= MAX_COMPARISONS) return;
    if (comparisons.some(c => c.sym === clean)) return; // dedup
    const color = pickComparisonColor(comparisons.length);
    onUpdate([...comparisons, { sym: clean, color, enabled: true }]);
    setSearch('');
  }

  function removeComparison(sym) {
    onUpdate(comparisons.filter(c => c.sym !== sym));
  }

  function toggleComparison(sym) {
    onUpdate(comparisons.map(c => c.sym === sym ? { ...c, enabled: !c.enabled } : c));
  }

  function updateColor(sym, color) {
    onUpdate(comparisons.map(c => c.sym === sym ? { ...c, color } : c));
  }

  function handleSubmit(e) {
    e.preventDefault();
    addComparison(search);
  }

  const remaining = MAX_COMPARISONS - comparisons.length;

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <span className={styles.title}>Compare Symbols</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          ref={inputRef}
          type="text"
          placeholder={remaining > 0 ? `Add ticker (${remaining} slots left)` : 'Max reached'}
          value={search}
          onChange={e => setSearch(e.target.value.toUpperCase())}
          disabled={remaining === 0}
          className={styles.input}
        />
        <button type="submit" disabled={remaining === 0 || !search.trim()} className={styles.addBtn}>
          Add
        </button>
      </form>

      {remaining > 0 && (
        <div className={styles.popular}>
          {POPULAR_TICKERS.filter(t => !comparisons.some(c => c.sym === t)).slice(0, 6).map(t => (
            <button key={t} className={styles.popularBtn} onClick={() => addComparison(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      <div className={styles.list}>
        {comparisons.length === 0 ? (
          <div className={styles.empty}>No comparisons yet. Add a ticker above.</div>
        ) : (
          comparisons.map(c => (
            <div key={c.sym} className={styles.row}>
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={() => toggleComparison(c.sym)}
              />
              <input
                type="color"
                value={c.color}
                onChange={e => updateColor(c.sym, e.target.value)}
                className={styles.colorPicker}
              />
              <span className={styles.sym}>{c.sym}</span>
              <button className={styles.remove} onClick={() => removeComparison(c.sym)} aria-label={`Remove ${c.sym}`}>
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
/* app/src/components/chart/ComparisonPicker.module.css */
.popover {
  position: absolute;
  top: 40px;
  right: 8px;
  width: 280px;
  background: var(--bg-elevated, #1f1f1f);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 1000;
  font-size: 13px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.title {
  font-weight: 600;
  color: var(--text-heading, #f0f0f0);
  letter-spacing: 0.5px;
}
.close {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.close:hover { color: var(--text-heading, #f0f0f0); }
.form {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.input {
  flex: 1;
  background: var(--bg-surface, #161616);
  color: var(--text, #e5e5e5);
  border: 1px solid var(--border, #2a2a2a);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
}
.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.addBtn {
  background: var(--ut-gold, #c9a84c);
  color: #000;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
}
.addBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.popular {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}
.popularBtn {
  background: var(--bg-surface, #161616);
  color: var(--text-muted, #888);
  border: 1px solid var(--border, #2a2a2a);
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.popularBtn:hover {
  background: var(--bg-elevated, #1f1f1f);
  color: var(--text, #e5e5e5);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}
.empty {
  color: var(--text-muted, #888);
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--bg-surface, #161616);
}
.colorPicker {
  width: 24px;
  height: 24px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.sym {
  flex: 1;
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 600;
  color: var(--text-heading, #f0f0f0);
}
.remove {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
}
.remove:hover {
  color: var(--loss, #f55);
}
```

- [ ] **Step 3: Build cleanly**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/ComparisonPicker.jsx app/src/components/chart/ComparisonPicker.module.css
git commit -m "feat(charts): ComparisonPicker popover component"
```

---

## Task 4: ChartToolbar — Compare button

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`
- Possibly modify: `app/src/components/chart/ChartToolbar.module.css` (add `.compareBtn` if needed)

- [ ] **Step 1: Read existing toolbar**

```bash
grep -n "Indicators\|Display\|update.*\\(\|cs\\." app/src/components/chart/ChartToolbar.jsx | head -30
```

Find:
- Where settings are accessed (`cs.something`)
- The `update(...)` callback signature
- Where existing toolbar buttons render (Settings gear is the main one)

- [ ] **Step 2: Add Compare button + popover state**

In ChartToolbar.jsx:

```jsx
import { useState, useRef, useEffect } from 'react';
import ComparisonPicker from './ComparisonPicker';

// Inside the component:
const [comparePopoverOpen, setComparePopoverOpen] = useState(false);
const compareRef = useRef(null);

// Click-outside handler:
useEffect(() => {
  if (!comparePopoverOpen) return;
  function onClickOutside(e) {
    if (compareRef.current && !compareRef.current.contains(e.target)) {
      setComparePopoverOpen(false);
    }
  }
  document.addEventListener('mousedown', onClickOutside);
  return () => document.removeEventListener('mousedown', onClickOutside);
}, [comparePopoverOpen]);

// Add button to the toolbar (near or alongside the settings gear):
<div ref={compareRef} className={styles.compareContainer}>
  <button
    className={styles.toolbarBtn}
    onClick={() => setComparePopoverOpen(o => !o)}
    title="Compare symbols"
    aria-label="Compare symbols"
  >
    ⇄
    {(cs.comparisonSymbols?.length > 0) && (
      <span className={styles.compareBadge}>{cs.comparisonSymbols.length}</span>
    )}
  </button>
  {comparePopoverOpen && (
    <ComparisonPicker
      comparisons={cs.comparisonSymbols || []}
      onUpdate={(arr) => update('comparisonSymbols', arr)}
      onClose={() => setComparePopoverOpen(false)}
    />
  )}
</div>
```

The `update(...)` callback is the existing pattern (likely passes `(key, value)` and merges into chartSettings). Match how other settings are saved.

- [ ] **Step 3: CSS for button + badge**

In `ChartToolbar.module.css` (or a new dedicated stylesheet):

```css
.compareContainer {
  position: relative;
  display: inline-block;
}
.compareBadge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--ut-gold, #c9a84c);
  color: #000;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 8px;
  line-height: 1;
}
```

- [ ] **Step 4: Build cleanly**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx app/src/components/chart/ChartToolbar.module.css
git commit -m "feat(charts): Compare button + popover in chart toolbar"
```

---

## Task 5: StockChart — fetch + render comparison overlays

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Add SWR fetch for comparison bars**

At the top of StockChart, add imports:

```jsx
import { normalizeToPctChange } from './chart/comparisonUtils';
```

Inside the component, add per-comparison data fetching. Since SWR hooks can't be conditionally called, we use a stable approach:

```jsx
// Build a single fetch URL per enabled comparison (parallel SWR hooks aren't allowed in a loop).
// Instead, fetch ONCE in a batched SWR call that returns all enabled comparison series.
const enabledComparisons = useMemo(
  () => (cs.comparisonSymbols || []).filter(c => c.enabled),
  [cs.comparisonSymbols]
);

// Build a single key out of all enabled syms + tf + barCount so SWR caches per-combo
const comparisonsKey = useMemo(
  () => enabledComparisons.map(c => c.sym).join(',') || null,
  [enabledComparisons]
);

const { data: comparisonData } = useSWR(
  comparisonsKey ? ['comparison-bars', comparisonsKey, resolvedTf, barCount] : null,
  async () => {
    // Parallel fetch each symbol's bars
    const results = await Promise.allSettled(
      enabledComparisons.map(c =>
        fetch(`/api/bars/${encodeURIComponent(c.sym)}?tf=${resolvedTf}&bars=${barCount}`)
          .then(r => r.ok ? r.json() : { bars: [] })
          .catch(() => ({ bars: [] }))
      )
    );
    const out = {};
    results.forEach((r, i) => {
      const sym = enabledComparisons[i].sym;
      out[sym] = r.status === 'fulfilled' ? (r.value?.bars || []) : [];
    });
    return out;
  },
  { revalidateOnFocus: false, dedupingInterval: 15_000 }
);
```

- [ ] **Step 2: Normalize and render series**

```jsx
// Compute normalized series per enabled comparison
const comparisonSeries = useMemo(() => {
  if (!comparisonData) return [];
  return enabledComparisons.map(c => ({
    sym: c.sym,
    color: c.color,
    points: normalizeToPctChange(
      (comparisonData[c.sym] || []).map(b => ({ t: adjustTime(b.t), c: b.c }))
    ),
  }));
}, [comparisonData, enabledComparisons, adjustTime]);

// Manage the series refs
const comparisonSeriesRefs = useRef(new Map());

useEffect(() => {
  const chart = chartRef.current;
  if (!chart) return;

  const map = comparisonSeriesRefs.current;
  const wanted = new Set(comparisonSeries.map(s => s.sym));

  // Remove series no longer wanted
  for (const [sym, series] of map.entries()) {
    if (!wanted.has(sym)) {
      try { chart.removeSeries(series); } catch {}
      map.delete(sym);
    }
  }

  // Add/update wanted series
  for (const cs of comparisonSeries) {
    let series = map.get(cs.sym);
    if (!series) {
      series = chart.addLineSeries({
        priceScaleId: 'left',
        color: cs.color,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
        title: cs.sym,
      });
      map.set(cs.sym, series);
    } else {
      series.applyOptions({ color: cs.color });
    }
    series.setData(cs.points);
  }

  // Configure left price scale to show % change
  if (wanted.size > 0) {
    chart.priceScale('left').applyOptions({
      visible: true,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });
  } else {
    chart.priceScale('left').applyOptions({ visible: false });
  }
}, [comparisonSeries]);

// Cleanup on unmount
useEffect(() => {
  return () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of comparisonSeriesRefs.current.values()) {
      try { chart.removeSeries(series); } catch {}
    }
    comparisonSeriesRefs.current.clear();
  };
}, []);
```

- [ ] **Step 3: Hook live ticks for comparison symbols**

Use `realtimeCandle.subscribe` so the comparison line moves with live ticks. Inside the comparison-series management effect:

```jsx
// Subscribe to realtimeCandle for each enabled comparison sym
useEffect(() => {
  if (enabledComparisons.length === 0) return;
  const unsubs = enabledComparisons.map(c => {
    return realtimeCandle.subscribe(c.sym, () => {
      const candle = realtimeCandle.getCandle(c.sym, '1');
      if (!candle) return;
      const series = comparisonSeriesRefs.current.get(c.sym);
      if (!series) return;
      // Find the base close (first point of this comparison)
      const points = comparisonSeries.find(s => s.sym === c.sym)?.points || [];
      if (points.length === 0) return;
      const basePoints = comparisonData?.[c.sym] || [];
      const baseClose = basePoints.find(b => Number.isFinite(b.c))?.c;
      if (!baseClose) return;
      const pct = ((candle.c - baseClose) / baseClose) * 100;
      series.update({ time: adjustTime(candle.t), value: pct });
    });
  });
  return () => unsubs.forEach(u => u());
}, [enabledComparisons, comparisonData, comparisonSeries, adjustTime]);
```

- [ ] **Step 4: Legend display**

Render a small legend on the chart showing each comparison sym + current % value. Add to the chart wrapper:

```jsx
{enabledComparisons.length > 0 && (
  <div className={styles.comparisonLegend}>
    <span className={styles.legendLabel}>vs {sym}:</span>
    {comparisonSeries.map(s => {
      const last = s.points[s.points.length - 1];
      const pct = last?.value;
      return (
        <span key={s.sym} className={styles.legendItem} style={{ color: s.color }}>
          {s.sym} {Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
        </span>
      );
    })}
  </div>
)}
```

CSS for legend (add to StockChart.module.css):

```css
.comparisonLegend {
  position: absolute;
  top: 50px;
  left: 16px;
  z-index: 50;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  background: rgba(0,0,0,0.5);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'IBM Plex Mono', monospace;
}
.legendLabel {
  color: var(--text-muted, #888);
}
.legendItem {
  font-weight: 600;
}
```

- [ ] **Step 5: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/StockChart.jsx app/src/components/StockChart.module.css
git commit -m "feat(charts): render comparison symbols on left price scale with live updates"
git push
```

---

## Task 6: Smoke test + verification

- [ ] **Step 1: Manual smoke test**

Run `cd app && npm run dev` and:
1. Open any chart (e.g., AAPL Daily)
2. Click the Compare button (⇄) — popover opens
3. Type "QQQ" + Enter → comparison line appears on left scale
4. Add SPY from popular tickers → second line appears
5. Toggle SPY off via checkbox → line disappears; toggle back on → reappears
6. Change SPY color via color picker → line updates
7. Click × on QQQ row → comparison removed
8. Close popover → settings persist
9. Reload the page → comparisons restore from saved settings
10. Verify the legend at top-left shows current % values

If any step fails, fix before commit.

- [ ] **Step 2: Build smoke**

```bash
cd app && npm run build && cd ..
python -c "from api.main import app; print('OK')"
```

- [ ] **Step 3: Run frontend test suite**

```bash
cd app && npx vitest run src/components/chart/comparisonUtils.test.js && cd ..
```

8/8 should pass.

- [ ] **Step 4: Final commit + push**

If smoke test exposed any tweaks (edge cases, focus management, keyboard handling):

```bash
git add <changed files>
git commit -m "fix(charts): comparison overlay polish from smoke test"
git push
```

---

## Task 7: Edge-case hardening

- [ ] **Step 1: Same-symbol guard**

Verify that adding the chart's own symbol as a comparison is either:
- Silently blocked (cleaner UX), OR
- Allowed (user wants visual emphasis)

If blocking, add to `addComparison`:
```jsx
if (clean === currentSym?.toUpperCase()) return;
```

`currentSym` needs to be passed as a prop from StockChart.

- [ ] **Step 2: Cross-asset class handling**

When comparing equities to crypto or futures (different trading hours / weekends), ensure:
- Crypto bars (24/7) align correctly with equity bars (RTH) on the time axis
- Lightweight Charts handles mismatched time series gracefully (it does — gaps just appear)

No code change needed; just verify in smoke test by adding `BTC-USD` to an equity chart.

- [ ] **Step 3: Performance with 5 comparisons**

Test with 5 active comparisons + 5000-bar daily data. Should remain smooth.

If laggy, profile:
- Are we re-creating series on every render? (We shouldn't — `Map`-based ref preserves identity)
- Are we re-normalizing on every tick? (We shouldn't — `useMemo` gates on `comparisonData` change)

- [ ] **Step 4: Commit any hardening**

```bash
git add <files>
git commit -m "fix(charts): comparison overlay edge cases + perf"
git push
```

---

## Done — what changed

After this plan ships:

1. Any StockChart instance can show up to 5 comparison symbols overlaid as normalized %-change lines
2. Comparison persists per chart via existing `chartSettings`
3. Live ticks update comparison lines in real-time via `realtimeCandle` registry
4. Legend at top-left shows current % values
5. UI: Compare button (⇄) in toolbar with badge count, popover with search + popular tickers + active list with color/toggle/remove

Visual impact: institutional-grade. Lets a trader see at a glance "AAPL is +3% today but QQQ is +1.5% — AAPL is outperforming."

## Self-review

- Every task has explicit files, code, test steps, and a commit
- Pure utilities (Task 1) have unit tests
- The popover is keyboard-accessible (input auto-focuses)
- Click-outside closes the popover
- 5-comparison cap prevents visual clutter
- Live updates use the existing `realtimeCandle` registry — no new infrastructure
- Persistence uses existing `chartSettings` + `usePreferences`
- No backend changes needed — `/api/bars/{ticker}` already serves the comparison bars
- No placeholders
