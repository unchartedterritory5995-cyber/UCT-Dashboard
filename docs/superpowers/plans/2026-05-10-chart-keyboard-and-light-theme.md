# Chart Keyboard Shortcuts + Light Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two polish features that elevate the chart to S-tier:
1. **Keyboard shortcuts** — power-user velocity for switching timeframes, toggling indicators, drawing tools, and chart actions
2. **Light theme** — opt-in light variant for traders who prefer it (or who screenshot for reports)

**Architecture:**
- Keyboard shortcuts: global keydown listener inside StockChart when focused, with a small "?" overlay popup that shows all shortcuts (toggleable)
- Light theme: new `cs.theme: 'dark' | 'light'` setting that picks a color preset; existing `chartDefaults.js` palettes get a `lightTheme` variant; CSS variables conditionally swap on a wrapper class

**Tech Stack:** Existing `chartSettings` persistence, native keydown listener, CSS variables for theme.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `app/src/components/chart/keyboardShortcuts.js` | Pure utility: shortcut map + `matchShortcut(event)` returning command id |
| `app/src/components/chart/KeyboardHelpOverlay.jsx` | Modal showing all shortcuts; triggered by `?` key |
| `app/src/components/chart/KeyboardHelpOverlay.module.css` | Styles |
| `app/src/components/chart/lightThemePalette.js` | Pure constants: light-theme color presets |
| `tests/keyboardShortcuts.test.js` | Unit tests for matchShortcut |

### Modified files
| File | Change |
|---|---|
| `app/src/components/chart/chartDefaults.js` | Add `theme: 'dark'` field + light-theme color overrides |
| `app/src/components/StockChart.jsx` | Wire keyboard listener, theme application, help overlay |
| `app/src/components/chart/ChartToolbar.jsx` | Add "Theme" selector to Display section, "?" button to open help |

---

## Task 1: Keyboard shortcut utility + tests

**Files:**
- Create: `app/src/components/chart/keyboardShortcuts.js`
- Create: `app/src/components/chart/keyboardShortcuts.test.js`

- [ ] **Step 1: Failing tests**

```javascript
import { describe, it, expect } from 'vitest';
import { matchShortcut, SHORTCUTS } from './keyboardShortcuts';


function evt(key, opts = {}) {
  return { key, ctrlKey: opts.ctrl, shiftKey: opts.shift, altKey: opts.alt, metaKey: opts.meta };
}


describe('matchShortcut', () => {
  it('returns "tf:1" for "1" key', () => {
    expect(matchShortcut(evt('1'))).toBe('tf:1');
  });

  it('returns "tf:5" for "5"', () => {
    expect(matchShortcut(evt('5'))).toBe('tf:5');
  });

  it('returns "tf:D" for "d"', () => {
    expect(matchShortcut(evt('d'))).toBe('tf:D');
  });

  it('returns "tf:W" for "w"', () => {
    expect(matchShortcut(evt('w'))).toBe('tf:W');
  });

  it('returns "tool:trendline" for "t"', () => {
    expect(matchShortcut(evt('t'))).toBe('tool:trendline');
  });

  it('returns "tool:horizontal" for "h"', () => {
    expect(matchShortcut(evt('h'))).toBe('tool:horizontal');
  });

  it('returns "tool:cursor" for "Escape"', () => {
    expect(matchShortcut(evt('Escape'))).toBe('tool:cursor');
  });

  it('returns "toggle:ha" for shift+H', () => {
    expect(matchShortcut(evt('H', { shift: true }))).toBe('toggle:ha');
  });

  it('returns "toggle:log" for shift+L', () => {
    expect(matchShortcut(evt('L', { shift: true }))).toBe('toggle:log');
  });

  it('returns "help" for "?"', () => {
    expect(matchShortcut(evt('?'))).toBe('help');
  });

  it('returns null for unknown key', () => {
    expect(matchShortcut(evt('x'))).toBe(null);
  });

  it('ignores when ctrl is held (preserve browser shortcuts)', () => {
    expect(matchShortcut(evt('t', { ctrl: true }))).toBe(null);
  });

  it('ignores when meta is held', () => {
    expect(matchShortcut(evt('t', { meta: true }))).toBe(null);
  });

  it('SHORTCUTS array structure', () => {
    expect(Array.isArray(SHORTCUTS)).toBe(true);
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const s of SHORTCUTS) {
      expect(typeof s.keys).toBe('string');
      expect(typeof s.command).toBe('string');
      expect(typeof s.description).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// app/src/components/chart/keyboardShortcuts.js


export const SHORTCUTS = [
  // Timeframes
  { keys: '1', command: 'tf:1', description: 'Switch to 1-minute' },
  { keys: '5', command: 'tf:5', description: 'Switch to 5-minute' },
  { keys: '2', command: 'tf:15', description: 'Switch to 15-minute' },
  { keys: '3', command: 'tf:30', description: 'Switch to 30-minute' },
  { keys: '4', command: 'tf:60', description: 'Switch to 1-hour' },
  { keys: 'D', command: 'tf:D', description: 'Daily' },
  { keys: 'W', command: 'tf:W', description: 'Weekly' },
  { keys: 'M', command: 'tf:M', description: 'Monthly' },

  // Drawing tools
  { keys: 'Esc', command: 'tool:cursor', description: 'Cursor / cancel' },
  { keys: 'T', command: 'tool:trendline', description: 'Trendline' },
  { keys: 'H', command: 'tool:horizontal', description: 'Horizontal line' },
  { keys: 'V', command: 'tool:vertical', description: 'Vertical line' },
  { keys: 'R', command: 'tool:rect', description: 'Rectangle' },
  { keys: 'C', command: 'tool:circle', description: 'Circle' },
  { keys: 'A', command: 'tool:arrow', description: 'Arrow' },
  { keys: 'F', command: 'tool:fib', description: 'Fibonacci retracement' },
  { keys: 'X', command: 'tool:text', description: 'Text annotation' },

  // Display toggles
  { keys: 'Shift+H', command: 'toggle:ha', description: 'Toggle Heikin Ashi' },
  { keys: 'Shift+L', command: 'toggle:log', description: 'Toggle log scale' },
  { keys: 'Shift+T', command: 'toggle:theme', description: 'Toggle light/dark theme' },
  { keys: 'Shift+C', command: 'toggle:countdown', description: 'Toggle bar-close countdown' },

  // Indicator toggles
  { keys: 'I', command: 'toggle:rsi', description: 'Toggle RSI' },
  { keys: 'O', command: 'toggle:macd', description: 'Toggle MACD' },
  { keys: 'B', command: 'toggle:bb', description: 'Toggle Bollinger Bands' },

  // Replay
  { keys: 'Space', command: 'replay:playpause', description: 'Replay play/pause' },
  { keys: '←', command: 'replay:back', description: 'Replay step back' },
  { keys: '→', command: 'replay:forward', description: 'Replay step forward' },

  // Help
  { keys: '?', command: 'help', description: 'Show this help overlay' },
];


/**
 * Match a KeyboardEvent to a command id. Returns null on no match.
 * Ignores events with ctrl/meta held (so browser shortcuts like Ctrl+F work).
 */
export function matchShortcut(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  const shift = event.shiftKey;

  // Direct key match
  if (!shift) {
    if (/^[1-5]$/.test(key)) {
      const tfMap = { '1': 'tf:1', '2': 'tf:15', '3': 'tf:30', '4': 'tf:60', '5': 'tf:5' };
      return tfMap[key] || null;
    }
    if (key === 'd' || key === 'D') return 'tf:D';
    if (key === 'w' || key === 'W') return 'tf:W';
    if (key === 'm' || key === 'M') return 'tf:M';
    if (key === 't' || key === 'T') return 'tool:trendline';
    if (key === 'h' || key === 'H') return 'tool:horizontal';
    if (key === 'v' || key === 'V') return 'tool:vertical';
    if (key === 'r' || key === 'R') return 'tool:rect';
    if (key === 'c' || key === 'C') return 'tool:circle';
    if (key === 'a' || key === 'A') return 'tool:arrow';
    if (key === 'f' || key === 'F') return 'tool:fib';
    if (key === 'x' || key === 'X') return 'tool:text';
    if (key === 'i' || key === 'I') return 'toggle:rsi';
    if (key === 'o' || key === 'O') return 'toggle:macd';
    if (key === 'b' || key === 'B') return 'toggle:bb';
    if (key === 'Escape') return 'tool:cursor';
    if (key === ' ' || key === 'Spacebar') return 'replay:playpause';
    if (key === 'ArrowLeft') return 'replay:back';
    if (key === 'ArrowRight') return 'replay:forward';
    if (key === '?' || (key === '/' && shift)) return 'help';
  } else {
    // Shift held
    if (key === 'H') return 'toggle:ha';
    if (key === 'L') return 'toggle:log';
    if (key === 'T') return 'toggle:theme';
    if (key === 'C') return 'toggle:countdown';
    if (key === '?' || key === '/') return 'help';
  }
  return null;
}
```

- [ ] **Step 3: Tests pass**

```bash
cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js
```

14/14 should pass. Adjust the test expectations if any are off (e.g., the "tf:15" mapping for "2" — confirm shortcut intent).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/keyboardShortcuts.js app/src/components/chart/keyboardShortcuts.test.js
git commit -m "feat(charts): keyboard shortcut map + matcher with tests"
```

---

## Task 2: KeyboardHelpOverlay component

**Files:**
- Create: `app/src/components/chart/KeyboardHelpOverlay.jsx`
- Create: `app/src/components/chart/KeyboardHelpOverlay.module.css`

- [ ] **Step 1: Component**

```jsx
import { useEffect } from 'react';
import styles from './KeyboardHelpOverlay.module.css';
import { SHORTCUTS } from './keyboardShortcuts';


export default function KeyboardHelpOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Group shortcuts by prefix for layout
  const groups = {
    'Timeframe': SHORTCUTS.filter(s => s.command.startsWith('tf:')),
    'Drawing tools': SHORTCUTS.filter(s => s.command.startsWith('tool:')),
    'Toggles': SHORTCUTS.filter(s => s.command.startsWith('toggle:')),
    'Replay': SHORTCUTS.filter(s => s.command.startsWith('replay:')),
    'Other': SHORTCUTS.filter(s => !s.command.includes(':')),
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.groups}>
          {Object.entries(groups).map(([groupName, items]) => (
            items.length > 0 && (
              <div key={groupName} className={styles.group}>
                <h3 className={styles.groupTitle}>{groupName}</h3>
                <ul className={styles.list}>
                  {items.map(s => (
                    <li key={s.command} className={styles.item}>
                      <kbd className={styles.kbd}>{s.keys}</kbd>
                      <span className={styles.desc}>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ))}
        </div>
        <div className={styles.footer}>
          <span>Press <kbd className={styles.kbd}>?</kbd> any time to show this</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal {
  background: var(--bg-elevated, #1f1f1f);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 0;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, #2a2a2a);
  background: var(--bg-surface, #161616);
  position: sticky;
  top: 0;
}
.title {
  margin: 0;
  font-size: 16px;
  color: var(--text-heading, #f0f0f0);
}
.close {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 6px;
}
.close:hover { color: var(--text-heading, #f0f0f0); }
.groups {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 20px;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.groupTitle {
  margin: 0 0 4px 0;
  font-size: 11px;
  color: var(--ut-gold, #c9a84c);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text, #e5e5e5);
}
.kbd {
  display: inline-block;
  background: var(--bg-surface, #161616);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 3px;
  padding: 2px 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--ut-gold, #c9a84c);
  min-width: 40px;
  text-align: center;
}
.desc {
  color: var(--text-muted, #888);
  flex: 1;
}
.footer {
  padding: 10px 20px;
  border-top: 1px solid var(--border, #2a2a2a);
  text-align: center;
  font-size: 11px;
  color: var(--text-muted, #888);
}

@media (max-width: 500px) {
  .groups { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/KeyboardHelpOverlay.jsx app/src/components/chart/KeyboardHelpOverlay.module.css
git commit -m "feat(charts): keyboard shortcut help overlay (? key)"
```

---

## Task 3: Light theme palette + chartDefaults

**Files:**
- Create: `app/src/components/chart/lightThemePalette.js`
- Modify: `app/src/components/chart/chartDefaults.js`

- [ ] **Step 1: Light palette**

```javascript
// app/src/components/chart/lightThemePalette.js


export const LIGHT_THEME_OVERRIDES = {
  candles: {
    upColor: '#10b981',     // emerald
    downColor: '#ef4444',   // red
    upBorderColor: '#10b981',
    downBorderColor: '#ef4444',
    upWickColor: '#10b981',
    downWickColor: '#ef4444',
  },
  volume: {
    upColor: 'rgba(16, 185, 129, 0.35)',
    downColor: 'rgba(239, 68, 68, 0.35)',
  },
  background: '#ffffff',
  textColor: '#1f2937',
  gridColor: '#e5e7eb',
  borderColor: '#d1d5db',
  crosshairColor: '#6b7280',
  watermarkColor: 'rgba(0,0,0,0.05)',
};


export const DARK_THEME_OVERRIDES = {
  // Inherits from CHART_DEFAULTS — used when explicitly switching back to dark
  background: '#0a0a0a',
  textColor: '#e5e5e5',
  gridColor: '#1f1f1f',
  borderColor: '#2a2a2a',
  crosshairColor: '#888888',
  watermarkColor: 'rgba(201, 168, 76, 0.04)',
};


export function applyTheme(baseSettings, theme) {
  if (theme === 'light') {
    return {
      ...baseSettings,
      candles: { ...baseSettings.candles, ...LIGHT_THEME_OVERRIDES.candles },
      volume: { ...baseSettings.volume, ...LIGHT_THEME_OVERRIDES.volume },
      _themeColors: {
        background: LIGHT_THEME_OVERRIDES.background,
        textColor: LIGHT_THEME_OVERRIDES.textColor,
        gridColor: LIGHT_THEME_OVERRIDES.gridColor,
        borderColor: LIGHT_THEME_OVERRIDES.borderColor,
        crosshairColor: LIGHT_THEME_OVERRIDES.crosshairColor,
        watermarkColor: LIGHT_THEME_OVERRIDES.watermarkColor,
      },
    };
  }
  return {
    ...baseSettings,
    _themeColors: {
      background: DARK_THEME_OVERRIDES.background,
      textColor: DARK_THEME_OVERRIDES.textColor,
      gridColor: DARK_THEME_OVERRIDES.gridColor,
      borderColor: DARK_THEME_OVERRIDES.borderColor,
      crosshairColor: DARK_THEME_OVERRIDES.crosshairColor,
      watermarkColor: DARK_THEME_OVERRIDES.watermarkColor,
    },
  };
}
```

- [ ] **Step 2: chartDefaults additions**

In `app/src/components/chart/chartDefaults.js`, add:

```javascript
theme: 'dark',  // 'dark' | 'light'
```

In `mergeChartSettings`:

```javascript
theme: userSettings?.theme === 'light' ? 'light' : 'dark',
```

- [ ] **Step 3: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/lightThemePalette.js app/src/components/chart/chartDefaults.js
git commit -m "feat(charts): light theme palette + theme field in chartDefaults"
```

---

## Task 4: StockChart — wire shortcuts + theme + help

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Add imports**

```jsx
import { matchShortcut } from './chart/keyboardShortcuts';
import { applyTheme } from './chart/lightThemePalette';
import KeyboardHelpOverlay from './chart/KeyboardHelpOverlay';
```

- [ ] **Step 2: Apply theme to chart settings**

Find where `cs` (chart settings) is resolved. Apply theme:

```jsx
const themedCs = useMemo(() => applyTheme(cs, cs.theme), [cs]);
// Use `themedCs` everywhere `cs` was used for VISUAL props (colors, background)
// Keep `cs` for control values (indicators, comparison, etc.) — non-visual
```

Actually simpler: just compute the theme colors separately:

```jsx
const themeColors = useMemo(() => {
  if (cs.theme === 'light') {
    return {
      background: '#ffffff',
      textColor: '#1f2937',
      gridColor: '#e5e7eb',
      borderColor: '#d1d5db',
      crosshairColor: '#6b7280',
      candleUp: '#10b981',
      candleDown: '#ef4444',
    };
  }
  return {
    background: '#0a0a0a',
    textColor: '#e5e5e5',
    gridColor: '#1f1f1f',
    borderColor: '#2a2a2a',
    crosshairColor: '#888888',
    candleUp: cs.candles?.upColor,
    candleDown: cs.candles?.downColor,
  };
}, [cs.theme, cs.candles?.upColor, cs.candles?.downColor]);
```

In the existing chart `applyOptions` / `createChart` config, use `themeColors`:

```jsx
chart.applyOptions({
  layout: { background: { color: themeColors.background }, textColor: themeColors.textColor },
  grid: {
    vertLines: { color: themeColors.gridColor },
    horzLines: { color: themeColors.gridColor },
  },
  crosshair: {
    vertLine: { color: themeColors.crosshairColor },
    horzLine: { color: themeColors.crosshairColor },
  },
});
```

Re-apply on theme change via useEffect dep.

- [ ] **Step 3: Keyboard listener**

```jsx
const [helpOpen, setHelpOpen] = useState(false);

useEffect(() => {
  const onKey = (e) => {
    // Ignore when typing in inputs/textareas
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    const cmd = matchShortcut(e);
    if (!cmd) return;

    if (cmd === 'help') {
      setHelpOpen(true);
      e.preventDefault();
      return;
    }

    if (cmd.startsWith('tf:')) {
      const tf = cmd.slice(3);
      if (typeof onTfChange === 'function') {
        onTfChange(tf);
        e.preventDefault();
      }
      return;
    }

    if (cmd.startsWith('tool:')) {
      const tool = cmd.slice(5);
      setActiveTool?.(tool);
      e.preventDefault();
      return;
    }

    if (cmd.startsWith('toggle:')) {
      const target = cmd.slice(7);
      const update = (key, value) => {
        handleUpdateChartSettings({ ...cs, [key]: value, preset: 'custom' });
      };
      const updateIndicator = (key) => {
        const next = { ...cs.indicators, [key]: { ...cs.indicators[key], enabled: !cs.indicators[key]?.enabled } };
        handleUpdateChartSettings({ ...cs, indicators: next, preset: 'custom' });
      };
      switch (target) {
        case 'ha': update('heikinAshi', !cs.heikinAshi); break;
        case 'log': update('logScale', !cs.logScale); break;
        case 'theme': update('theme', cs.theme === 'light' ? 'dark' : 'light'); break;
        case 'countdown': update('countdown', !cs.countdown); break;
        case 'rsi': updateIndicator('rsi'); break;
        case 'macd': updateIndicator('macd'); break;
        case 'bb': updateIndicator('bb'); break;
      }
      e.preventDefault();
      return;
    }

    if (cmd.startsWith('replay:')) {
      const action = cmd.slice(7);
      switch (action) {
        case 'playpause': setReplayPlaying(p => !p); break;
        case 'back': setReplayIndex(idx => Math.max(0, (idx || 0) - 1)); break;
        case 'forward': setReplayIndex(idx => Math.min(sessionBars.length - 1, (idx || 0) + 1)); break;
      }
      e.preventDefault();
      return;
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [cs, onTfChange, sessionBars?.length, handleUpdateChartSettings]);
```

Adjust variable names to match actual StockChart code (`setActiveTool`, `setReplayPlaying`, `setReplayIndex`, etc.).

- [ ] **Step 4: Render the help overlay**

In JSX:

```jsx
<KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
```

- [ ] **Step 5: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): keyboard shortcuts + light theme + help overlay"
git push
```

---

## Task 5: ChartToolbar — Theme selector + Help button

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`

- [ ] **Step 1: Theme selector in Display section**

In the Display section (alongside Heikin Ashi / log scale toggles), add:

```jsx
<label>
  <span>Theme</span>
  <select
    value={cs.theme || 'dark'}
    onChange={e => onUpdateSettings({ ...cs, theme: e.target.value, preset: 'custom' })}
  >
    <option value="dark">Dark</option>
    <option value="light">Light</option>
  </select>
</label>
```

- [ ] **Step 2: Help button**

Near other toolbar buttons (or in the Display section), add a "?" button:

```jsx
<button
  className={styles.toolbarBtn}
  onClick={() => onShowHelp?.()}
  title="Keyboard shortcuts (press ?)"
  aria-label="Show keyboard shortcuts"
>
  ?
</button>
```

In StockChart, pass `onShowHelp={() => setHelpOpen(true)}` to ChartToolbar.

- [ ] **Step 3: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(charts): toolbar Theme selector + Help button"
git push
```

---

## Task 6: Smoke + verification

- [ ] **Step 1: Build + tests**

```bash
cd app && npm run build && cd ..
cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js && cd ..
```

- [ ] **Step 2: Manual smoke**

1. Open any chart, press `?` — help overlay shows; press `Esc` to close
2. Press `5` — switches to 5-minute
3. Press `D` — switches to Daily
4. Press `T` — activates trendline tool
5. Press `Esc` — back to cursor
6. Press `Shift+H` — toggles Heikin Ashi
7. Press `Shift+L` — toggles log scale
8. Press `Shift+T` — switches to light theme — chart palette swaps
9. Press `Shift+T` again — back to dark
10. Press `I` — toggles RSI sub-pane
11. Press `O` — toggles MACD
12. Type in symbol search input → keys 1/2/3 don't trigger TF switches (input guard works)

- [ ] **Step 3: Final commit + push**

If polish needed:

```bash
git add <files>
git commit -m "fix(charts): keyboard/theme polish from smoke test"
git push
```

---

## Done — what changed

After this plan ships:

1. **25+ keyboard shortcuts** — full power-user navigation:
   - Number keys for timeframes
   - Letter keys for drawing tools
   - Shift+letter for display toggles
   - Letter keys for indicator toggles
   - Space + arrows for replay control
2. **Help overlay** — press `?` to see all shortcuts grouped by category
3. **Light theme** — opt-in via Settings → Display → Theme dropdown, or Shift+T shortcut
4. **Toolbar Help button** — discoverable click target

Visual impact: power-users get TradingView-Pro velocity. Light theme expands the audience and produces better-looking screenshots for reports.

## Self-review

- Keyboard listener guards on inputs/textareas/contentEditable so search boxes don't trigger
- ctrl/meta/alt held → no shortcut fires (preserves browser shortcuts)
- Theme is a single field; full color swap via `themeColors` memo
- Help overlay closes on Escape and backdrop click
- All settings persist via existing `chartSettings`
- No backend changes
- No placeholders
