import { useState, useEffect, useCallback } from 'react';
import usePreferences from '../hooks/usePreferences';
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
