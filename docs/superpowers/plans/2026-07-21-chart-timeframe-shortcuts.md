# Chart Timeframe Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chart's timeframe key bindings with a TC2000-style digit layout (`Shift`+digit intraday, bare digit higher), make repeated presses of the same key walk the whole timeframe ladder, and stop digits from being swallowed by the ticker search box.

**Architecture:** All ladder logic lives in one pure, exported function (`resolveTfCycle`) in `keyboardShortcuts.js`, so it is fully unit-testable with no DOM. `StockChart` holds only a per-instance ref for cycle position and delegates. `ChartWidget` gains one early-return so a bound shortcut always beats ticker search.

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react. No new dependencies.

## Global Constraints

- **Worktree:** work ONLY in `C:\Users\Patrick\uct-worktrees\chart-shortcuts` on branch `chart-tf-shortcuts`. Never edit `C:\Users\Patrick\uct-dashboard` — that checkout is stale.
- **Never `git add -A`.** Every commit stages explicit paths with `--`.
- **Do not deploy.** No `git push`, no `railway up`. This branch ships only on the owner's explicit go-ahead.
- **Scope:** timeframe shortcuts only. Do NOT change drawing-tool, display-toggle, indicator-toggle or replay bindings.
- **Timeframe codes** are exactly `'1' '5' '15' '30' '60' 'D' 'W' 'M'` (minutes as strings, then Daily/Weekly/Monthly). This is the app-wide convention — do not invent `'1m'` or `'1D'` forms.
- **Ladder order** is `1 → 5 → 15 → 30 → 60 → D → W → M`, wrapping back to `1`.
- **Key map** (final, do not deviate): `Shift+1`=1m, `Shift+3`=5m, `Shift+4`=15m, `Shift+5`=30m, `Shift+6`=1h, `1`=Daily, `5`=Weekly, `9`=Monthly. `Shift+2` intentionally unbound.
- **Run tests from the `app/` directory:** `cd app && npx vitest run <path>`.
- Spec: `docs/superpowers/specs/2026-07-21-chart-timeframe-shortcuts-design.md`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/src/components/chart/keyboardShortcuts.js` | Single source of truth: the ladder (`TF_ORDER`), the cycle rules (`resolveTfCycle`), event→command matching (`matchShortcut`), and the help-overlay table (`SHORTCUTS`) | Modify |
| `app/src/components/chart/keyboardShortcuts.test.js` | Unit tests for the above | Modify |
| `app/src/components/StockChart.jsx` | Holds per-instance cycle position; calls `onTfChange` with the resolved timeframe | Modify (~line 2937 and ~line 2964) |
| `app/src/pages/charts/widgets/ChartWidget.jsx` | Shortcut-beats-search arbitration; derives its timeframe bar from `TF_ORDER` | Modify (lines 24–30, ~274–294) |
| `app/src/pages/charts/widgets/ChartWidget.test.jsx` | Arbitration tests | Modify |
| `app/src/components/chart/KeyboardHelpOverlay.jsx` | Renders the shortcut table; gains a repeat-to-cycle hint | Modify |
| `app/src/components/chart/KeyboardHelpOverlay.module.css` | Style for that hint | Modify |

Task order matters: Task 1 defines `TF_ORDER`/`resolveTfCycle` that Tasks 2–4 import.

---

### Task 1: The ladder and the cycle rules

Pure logic, no DOM. This is where every cycling decision lives.

**Files:**
- Modify: `app/src/components/chart/keyboardShortcuts.js` (add exports at top of file, after the opening comment on line 1)
- Test: `app/src/components/chart/keyboardShortcuts.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const TF_ORDER: string[]` — `['1','5','15','30','60','D','W','M']`
  - `export function resolveTfCycle({ command, currentTf, lastCommand, lastIndex }): { tf: string, index: number } | null`
    - `command` — a `'tf:<CODE>'` string from `matchShortcut`
    - `currentTf` — the chart's current timeframe code
    - `lastCommand` — the `command` from the previous keypress on this chart, or `null`
    - `lastIndex` — the `index` returned by the previous call on this chart, or `null`
    - Returns `null` if `command` names a timeframe not in `TF_ORDER`.

- [ ] **Step 1: Write the failing tests**

Add this block to `app/src/components/chart/keyboardShortcuts.test.js`, after the existing `import` on line 2 change it to also import the new names, then append the describe block at the end of the file (after the closing `});` of the `matchShortcut` describe).

Change line 2 from:

```js
import { matchShortcut, SHORTCUTS } from './keyboardShortcuts';
```

to:

```js
import { matchShortcut, SHORTCUTS, TF_ORDER, resolveTfCycle } from './keyboardShortcuts';
```

Append at the end of the file:

```js
describe('TF_ORDER', () => {
  it('is the eight-rung ladder in time order', () => {
    expect(TF_ORDER).toEqual(['1', '5', '15', '30', '60', 'D', 'W', 'M']);
  });
});


describe('resolveTfCycle', () => {
  const cold = { lastCommand: null, lastIndex: null };

  it('goes to the key home on a cold press', () => {
    expect(resolveTfCycle({ command: 'tf:1', currentTf: 'D', ...cold }))
      .toEqual({ tf: '1', index: 0 });
    expect(resolveTfCycle({ command: 'tf:D', currentTf: '5', ...cold }))
      .toEqual({ tf: 'D', index: 5 });
    expect(resolveTfCycle({ command: 'tf:M', currentTf: '5', ...cold }))
      .toEqual({ tf: 'M', index: 7 });
  });

  it('advances one rung when the same key repeats', () => {
    // Shift+1 pressed twice: home 1m, then 5m.
    const first = resolveTfCycle({ command: 'tf:1', currentTf: 'D', ...cold });
    const second = resolveTfCycle({
      command: 'tf:1', currentTf: first.tf,
      lastCommand: 'tf:1', lastIndex: first.index,
    });
    expect(second).toEqual({ tf: '5', index: 1 });
  });

  it('walks the entire ladder and wraps', () => {
    const seen = [];
    let last = { command: null, index: null };
    let currentTf = 'D';
    for (let i = 0; i < 9; i++) {
      const next = resolveTfCycle({
        command: 'tf:1', currentTf,
        lastCommand: last.command, lastIndex: last.index,
      });
      seen.push(next.tf);
      currentTf = next.tf;
      last = { command: 'tf:1', index: next.index };
    }
    expect(seen).toEqual(['1', '5', '15', '30', '60', 'D', 'W', 'M', '1']);
  });

  it('advances instead of no-opping when already sitting on the key home', () => {
    // Chart is already Daily (clicked in the TF bar); pressing 1 must move.
    expect(resolveTfCycle({ command: 'tf:D', currentTf: 'D', ...cold }))
      .toEqual({ tf: 'W', index: 6 });
  });

  it('resets to home when a different timeframe key is pressed', () => {
    // Mid-walk at Monthly via tf:1, then press 5 (home Weekly).
    expect(resolveTfCycle({
      command: 'tf:W', currentTf: 'M',
      lastCommand: 'tf:1', lastIndex: 7,
    })).toEqual({ tf: 'W', index: 6 });
  });

  it('breaks the chain when the timeframe changed by other means', () => {
    // Last keypress landed on 15m (index 2) but the TF bar moved us to 60.
    expect(resolveTfCycle({
      command: 'tf:1', currentTf: '60',
      lastCommand: 'tf:1', lastIndex: 2,
    })).toEqual({ tf: '1', index: 0 });
  });

  it('returns null for a command outside the ladder', () => {
    expect(resolveTfCycle({ command: 'tf:ZZ', currentTf: 'D', ...cold })).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js`
Expected: FAIL — `TF_ORDER` and `resolveTfCycle` are undefined (`TypeError: resolveTfCycle is not a function`).

- [ ] **Step 3: Implement**

In `app/src/components/chart/keyboardShortcuts.js`, insert directly after line 1 (`// app/src/components/chart/keyboardShortcuts.js`) and before `export const SHORTCUTS`:

```js
/**
 * The timeframe ladder, in time order. Single source of truth — the ChartWidget
 * timeframe bar and the repeat-press cycle both read it.
 */
export const TF_ORDER = ['1', '5', '15', '30', '60', 'D', 'W', 'M'];


/**
 * Resolve where a timeframe keypress lands.
 *
 * Rules, evaluated in order:
 *  1. Same key pressed again with the chain intact -> advance one rung.
 *  2. Chart already sits on this key's home -> advance one rung (so no press
 *     is ever a silent no-op).
 *  3. Otherwise -> jump to this key's home.
 * The walk wraps at the end of TF_ORDER. The chain is considered broken when
 * the chart's current timeframe is not the rung the last keypress landed on
 * (i.e. the TF bar, a saved layout or a grid restore moved it).
 *
 * Pure: callers own the {command, index} they pass back in next time.
 */
export function resolveTfCycle({ command, currentTf, lastCommand, lastIndex }) {
  const home = String(command || '').slice(3);
  const homeIndex = TF_ORDER.indexOf(home);
  if (homeIndex === -1) return null;

  const chainIntact = command === lastCommand
    && Number.isInteger(lastIndex)
    && TF_ORDER[lastIndex] === currentTf;

  let index;
  if (chainIntact) index = (lastIndex + 1) % TF_ORDER.length;
  else if (currentTf === home) index = (homeIndex + 1) % TF_ORDER.length;
  else index = homeIndex;

  return { tf: TF_ORDER[index], index };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js`
Expected: PASS — all tests green, including the pre-existing `matchShortcut` tests (untouched so far).

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/chart/keyboardShortcuts.js app/src/components/chart/keyboardShortcuts.test.js
git commit -m "Charts: add TF_ORDER ladder + pure resolveTfCycle"
```

---

### Task 2: The new key map

Rebinds timeframes to digits and retires the `D`/`W`/`M` letters.

**Files:**
- Modify: `app/src/components/chart/keyboardShortcuts.js` (the `SHORTCUTS` table and `matchShortcut`)
- Test: `app/src/components/chart/keyboardShortcuts.test.js`

**Interfaces:**
- Consumes: `TF_ORDER` from Task 1 (indirectly — the commands must name codes in it).
- Produces: `matchShortcut(event)` now reads `event.code` for `Shift`+digit. Commands emitted are unchanged strings (`'tf:1'`, `'tf:5'`, `'tf:15'`, `'tf:30'`, `'tf:60'`, `'tf:D'`, `'tf:W'`, `'tf:M'`) — only which key produces them changes.

- [ ] **Step 1: Write the failing tests**

The existing `evt()` helper on lines 5–7 does not carry `event.code`. Replace lines 5–7 of `app/src/components/chart/keyboardShortcuts.test.js`:

```js
function evt(key, opts = {}) {
  return { key, ctrlKey: opts.ctrl, shiftKey: opts.shift, altKey: opts.alt, metaKey: opts.meta };
}
```

with:

```js
function evt(key, opts = {}) {
  return {
    key,
    code: opts.code,
    ctrlKey: opts.ctrl,
    shiftKey: opts.shift,
    altKey: opts.alt,
    metaKey: opts.meta,
  };
}
```

Then update the four now-wrong existing tests. Replace this test (currently lines 11–13):

```js
  it('returns "tf:1" for "1" key', () => {
    expect(matchShortcut(evt('1'))).toBe('tf:1');
  });
```

with:

```js
  it('returns "tf:D" for bare "1"', () => {
    expect(matchShortcut(evt('1'))).toBe('tf:D');
  });
```

Replace this test (currently lines 15–17):

```js
  it('returns "tf:5" for "5"', () => {
    expect(matchShortcut(evt('5'))).toBe('tf:5');
  });
```

with:

```js
  it('returns "tf:W" for bare "5"', () => {
    expect(matchShortcut(evt('5'))).toBe('tf:W');
  });
```

Replace these two tests (currently lines 19–25):

```js
  it('returns "tf:D" for "d"', () => {
    expect(matchShortcut(evt('d'))).toBe('tf:D');
  });

  it('returns "tf:W" for "w"', () => {
    expect(matchShortcut(evt('w'))).toBe('tf:W');
  });
```

with:

```js
  it('bare "d"/"w" no longer switch timeframe (freed for ticker search)', () => {
    expect(matchShortcut(evt('d'))).toBe(null);
    expect(matchShortcut(evt('w'))).toBe(null);
  });
```

Replace this test (near the end, `plain m stays Monthly, plain v stays vertical-line tool`):

```js
  it('plain m stays Monthly, plain v stays vertical-line tool', () => {
    expect(matchShortcut(evt('m'))).toBe('tf:M');
    expect(matchShortcut(evt('v'))).toBe('tool:vertical');
  });
```

with:

```js
  it('plain m is now unbound; plain v stays the vertical-line tool', () => {
    expect(matchShortcut(evt('m'))).toBe(null);
    expect(matchShortcut(evt('v'))).toBe('tool:vertical');
  });
```

Finally append these new tests inside the `describe('matchShortcut', ...)` block, just before its closing `});`:

```js
  it('maps Shift+digit to the intraday timeframes by physical key', () => {
    // Shift+1 produces "!" on a US layout — the code is what identifies the key.
    expect(matchShortcut(evt('!', { shift: true, code: 'Digit1' }))).toBe('tf:1');
    expect(matchShortcut(evt('#', { shift: true, code: 'Digit3' }))).toBe('tf:5');
    expect(matchShortcut(evt('$', { shift: true, code: 'Digit4' }))).toBe('tf:15');
    expect(matchShortcut(evt('%', { shift: true, code: 'Digit5' }))).toBe('tf:30');
    expect(matchShortcut(evt('^', { shift: true, code: 'Digit6' }))).toBe('tf:60');
  });

  it('accepts the numpad for Shift+digit timeframes', () => {
    expect(matchShortcut(evt('1', { shift: true, code: 'Numpad1' }))).toBe('tf:1');
    expect(matchShortcut(evt('6', { shift: true, code: 'Numpad6' }))).toBe('tf:60');
  });

  it('leaves Shift+2 unbound (reserved for a future 2-minute timeframe)', () => {
    expect(matchShortcut(evt('@', { shift: true, code: 'Digit2' }))).toBe(null);
  });

  it('returns "tf:M" for bare "9"', () => {
    expect(matchShortcut(evt('9'))).toBe('tf:M');
  });

  it('leaves unassigned bare digits unbound', () => {
    expect(matchShortcut(evt('2'))).toBe(null);
    expect(matchShortcut(evt('3'))).toBe(null);
    expect(matchShortcut(evt('4'))).toBe(null);
    expect(matchShortcut(evt('7'))).toBe(null);
    expect(matchShortcut(evt('0'))).toBe(null);
  });

  it('keeps the Shift letter toggles working alongside Shift+digit', () => {
    expect(matchShortcut(evt('H', { shift: true, code: 'KeyH' }))).toBe('toggle:ha');
    expect(matchShortcut(evt('C', { shift: true, code: 'KeyC' }))).toBe('toggle:countdown');
  });

  it('every SHORTCUTS timeframe command names a real rung', () => {
    for (const s of SHORTCUTS) {
      if (s.command.startsWith('tf:')) {
        expect(TF_ORDER).toContain(s.command.slice(3));
      }
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js`
Expected: FAIL — e.g. `expected 'tf:1' to be 'tf:D'` for bare `1`, and `expected null to be 'tf:1'` for the Shift+Digit1 case.

- [ ] **Step 3: Implement the key map**

In `app/src/components/chart/keyboardShortcuts.js`, replace the eight timeframe entries at the top of `SHORTCUTS` (currently lines 6–13, the block under `// Timeframes`):

```js
  // Timeframes
  { keys: '1', command: 'tf:1', description: 'Switch to 1-minute' },
  { keys: '5', command: 'tf:5', description: 'Switch to 5-minute' },
  { keys: '2', command: 'tf:15', description: 'Switch to 15-minute' },
  { keys: '3', command: 'tf:30', description: 'Switch to 30-minute' },
  { keys: '4', command: 'tf:60', description: 'Switch to 1-hour' },
  { keys: 'D', command: 'tf:D', description: 'Daily' },
  { keys: 'W', command: 'tf:W', description: 'Weekly' },
  { keys: 'M', command: 'tf:M', description: 'Monthly' },
```

with:

```js
  // Timeframes — Shift+digit intraday, bare digit daily and up.
  // (Ctrl+digit is browser-reserved for tab switching, so Shift carries these.)
  { keys: 'Shift+1', command: 'tf:1', description: '1-minute' },
  { keys: 'Shift+3', command: 'tf:5', description: '5-minute' },
  { keys: 'Shift+4', command: 'tf:15', description: '15-minute' },
  { keys: 'Shift+5', command: 'tf:30', description: '30-minute' },
  { keys: 'Shift+6', command: 'tf:60', description: '1-hour' },
  { keys: '1', command: 'tf:D', description: 'Daily' },
  { keys: '5', command: 'tf:W', description: 'Weekly' },
  { keys: '9', command: 'tf:M', description: 'Monthly' },
```

Then add these two lookup tables immediately above the `/** Match a KeyboardEvent ... */` JSDoc comment (currently line 49):

```js
// Physical-key lookup for the Shift+digit intraday set. Keyed on event.code
// because Shift+1 yields "!" on a US layout and other symbols elsewhere;
// the code is layout-independent and picks up the numpad for free.
const SHIFT_CODE_TF = {
  Digit1: 'tf:1', Numpad1: 'tf:1',
  Digit3: 'tf:5', Numpad3: 'tf:5',
  Digit4: 'tf:15', Numpad4: 'tf:15',
  Digit5: 'tf:30', Numpad5: 'tf:30',
  Digit6: 'tf:60', Numpad6: 'tf:60',
};

// Bare digits — the higher timeframes. Letters are deliberately NOT bound to
// timeframes so DELL / WMT / MU can be typed straight into ticker search.
const BARE_DIGIT_TF = { '1': 'tf:D', '5': 'tf:W', '9': 'tf:M' };
```

Now edit `matchShortcut`. Replace the bare-digit block (currently lines 75–78):

```js
    if (/^[1-5]$/.test(key)) {
      const tfMap = { '1': 'tf:1', '2': 'tf:15', '3': 'tf:30', '4': 'tf:60', '5': 'tf:5' };
      return tfMap[key] || null;
    }
```

with:

```js
    if (/^[0-9]$/.test(key)) return BARE_DIGIT_TF[key] || null;
```

And delete these three lines (currently lines 79–81):

```js
    if (key === 'd' || key === 'D') return 'tf:D';
    if (key === 'w' || key === 'W') return 'tf:W';
    if (key === 'm' || key === 'M') return 'tf:M';
```

Finally, in the `else` branch (`// Shift held`, currently line 96), insert the code lookup as the FIRST check, before the `toggle:ha` line:

```js
    // Shift held
    if (event.code && SHIFT_CODE_TF[event.code]) return SHIFT_CODE_TF[event.code];
    if (key === 'H') return 'toggle:ha';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js`
Expected: PASS — every test green, including all Task 1 cycle tests.

- [ ] **Step 5: Commit**

```bash
git add -- app/src/components/chart/keyboardShortcuts.js app/src/components/chart/keyboardShortcuts.test.js
git commit -m "Charts: TC2000-style digit timeframe keys, retire D/W/M letters"
```

---

### Task 3: Wire cycling into the chart

**Files:**
- Modify: `app/src/components/StockChart.jsx` (import line 111; ref near line 2937; `tf:` branch near line 2964; effect deps near line 3051)

**Interfaces:**
- Consumes: `resolveTfCycle` from Task 1.
- Produces: no new exports. `StockChart` continues to call the existing `onTfChange(tfCode)` prop — consumers need no change.

**Why a ref, not state:** the cycle position must not trigger a re-render, and it must be per chart instance so two widgets walk independently. The existing `hotkeysActiveRef` right above it is the same pattern.

- [ ] **Step 1: Add the import**

In `app/src/components/StockChart.jsx`, line 111 currently reads:

```js
import { matchShortcut } from './chart/keyboardShortcuts'
```

Change it to:

```js
import { matchShortcut, resolveTfCycle } from './chart/keyboardShortcuts'
```

- [ ] **Step 2: Add the per-instance cycle ref**

Find lines 2937–2938:

```js
  const hotkeysActiveRef = useRef(hotkeysActive)
  hotkeysActiveRef.current = hotkeysActive
```

Insert immediately after them:

```js
  // Repeat-press timeframe cycling: remembers which timeframe key was pressed
  // last and which rung of TF_ORDER it landed on. Per-instance (a ref, not
  // module state) so two chart widgets walk the ladder independently, and not
  // state because a cycle position must never trigger a re-render.
  const tfCycleRef = useRef({ command: null, index: null })
```

- [ ] **Step 3: Replace the timeframe branch**

Find the `tf:` branch (currently lines 2964–2971):

```js
      if (cmd.startsWith('tf:')) {
        const tf = cmd.slice(3)
        if (typeof onTfChange === 'function') {
          e.preventDefault()
          onTfChange(tf)
        }
        return
      }
```

Replace it with:

```js
      if (cmd.startsWith('tf:')) {
        if (typeof onTfChange !== 'function') return
        const next = resolveTfCycle({
          command: cmd,
          currentTf: resolvedTf,
          lastCommand: tfCycleRef.current.command,
          lastIndex: tfCycleRef.current.index,
        })
        if (!next) return
        e.preventDefault()
        tfCycleRef.current = { command: cmd, index: next.index }
        onTfChange(next.tf)
        return
      }
```

- [ ] **Step 4: Add `resolvedTf` to the effect dependencies**

The handler now closes over `resolvedTf` (defined at line 936). Find the effect's dependency array (currently line 3051):

```js
  }, [cs, onTfChange, showDrawingTools, replayMode, sessionBars?.length, handleUpdateChartSettings])
```

Replace it with:

```js
  }, [cs, onTfChange, showDrawingTools, replayMode, sessionBars?.length, handleUpdateChartSettings, resolvedTf])
```

- [ ] **Step 5: Verify nothing regressed**

Run: `cd app && npx vitest run src/components/chart src/pages/charts`
Expected: PASS — no failures. (This is a regression check; the cycle logic itself is already covered by Task 1's unit tests.)

- [ ] **Step 6: Commit**

```bash
git add -- app/src/components/StockChart.jsx
git commit -m "Charts: repeat a timeframe key to step through the ladder"
```

---

### Task 4: Shortcut beats ticker search

Fixes the reported bug: typing `1` on a focused chart widget puts "1" in the symbol box and the timeframe never fires.

**Files:**
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx` (imports and `TFS` at lines 22–30; `handleChartKeyDown` at lines 274–294)
- Test: `app/src/pages/charts/widgets/ChartWidget.test.jsx`

**Interfaces:**
- Consumes: `matchShortcut` and `TF_ORDER` from Tasks 1–2.
- Produces: no new exports.

**Why:** `handleChartKeyDown` calls `e.stopPropagation()` (line 292) so a typed ticker can never trigger a tool or timeframe. That guard is correct, but it currently fires for digits too. Consulting `matchShortcut` first makes the rule explicit — a bound key is let through to the chart's own document-level handler; everything else opens search.

- [ ] **Step 1: Write the failing tests**

`SymbolSearch` is currently mocked as a plain span with no ref, so `openWith` calls vanish silently. Replace the mock on line 17 of `app/src/pages/charts/widgets/ChartWidget.test.jsx`:

```js
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
```

with a forwardRef mock that records `openWith` calls:

```js
const openWithSpy = vi.fn()
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ openWith: (...a) => openWithSpy(...a) }))
      return <span>search</span>
    }),
  }
})
```

Add `fireEvent` to the testing-library import on line 1:

```js
import { render, screen, act, fireEvent } from '@testing-library/react'
```

Append these tests at the end of the file:

```js
// The chart container is the focusable element that owns type-to-search.
// It is the only element in the widget with tabIndex=0.
function chartSurface(container) {
  const el = container.querySelector('[tabindex="0"]')
  if (!el) throw new Error('chart surface not found')
  return el
}

test('typing a letter opens ticker search', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  fireEvent.keyDown(chartSurface(container), { key: 'n' })
  expect(openWithSpy).toHaveBeenCalledWith('n')
})

test('typing a digit does NOT open ticker search (digits are timeframes)', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  const surface = chartSurface(container)
  fireEvent.keyDown(surface, { key: '1' })
  fireEvent.keyDown(surface, { key: '5' })
  fireEvent.keyDown(surface, { key: '9' })
  expect(openWithSpy).not.toHaveBeenCalled()
})

test('a bound shortcut key does NOT open ticker search', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  // Shift+H is the Heikin Ashi toggle — it must not type "H" into the box.
  fireEvent.keyDown(chartSurface(container), { key: 'H', code: 'KeyH', shiftKey: true })
  expect(openWithSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/pages/charts/widgets/ChartWidget.test.jsx`
Expected: FAIL — the digit test fails with `expected "spy" to not be called at all, but actually been called 3 times`, and the Shift+H test fails the same way. The letter test should already PASS (that behavior is unchanged and the new mock now records it).

- [ ] **Step 3: Update the imports and the timeframe bar**

In `app/src/pages/charts/widgets/ChartWidget.jsx`, add this import next to the other component imports (after line 22, `import styles from '../ChartsWorkspace.module.css'`):

```js
import { matchShortcut, TF_ORDER } from '../../../components/chart/keyboardShortcuts'
```

Replace the hardcoded ladder and the ticker regex (lines 24–30):

```js
const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/
```

with:

```js
// Labels for the timeframe bar. Order comes from TF_ORDER so the bar and the
// keyboard ladder can never drift apart.
const TF_LABELS = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', 'D': '1D', 'W': '1W', 'M': '1M',
}
const TFS = TF_ORDER.map(code => [code, TF_LABELS[code]])

// Letters only, no modifier combos. Period allowed for class-share tickers
// (BRK.B). Digits are deliberately EXCLUDED — they are timeframe shortcuts,
// and no US ticker starts with a digit. Once the search box has focus it
// accepts digits normally; this regex only decides what OPENS it.
const TICKER_KEY_RE = /^[A-Za-z.]$/
```

- [ ] **Step 4: Add the arbitration early-return**

In `handleChartKeyDown`, find these two lines (currently 287–288, immediately after the `Shift+F` flag branch closes):

```js
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
```

Replace them with:

```js
    // A bound chart shortcut always beats ticker search. Without this, digits
    // (timeframes) and Shift+letter (display toggles) would be swallowed by
    // the symbol box below, which stopPropagation()s them. Returning here lets
    // the event keep bubbling to StockChart's document-level handler.
    if (matchShortcut(e)) return
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/pages/charts/widgets/ChartWidget.test.jsx`
Expected: PASS — all three new tests plus every pre-existing ChartWidget test.

- [ ] **Step 6: Run the full charts suite**

Run: `cd app && npx vitest run src/pages/charts src/components/chart`
Expected: PASS — no regressions in the widget, grid, or shortcut suites.

- [ ] **Step 7: Commit**

```bash
git add -- app/src/pages/charts/widgets/ChartWidget.jsx app/src/pages/charts/widgets/ChartWidget.test.jsx
git commit -m "Charts: bound shortcuts beat ticker search; digits no longer type"
```

---

### Task 5: Document the cycle in the help overlay

The `?` overlay regenerates its key list from `SHORTCUTS` automatically, so it already shows the new bindings after Task 2. Repeat-to-cycle is invisible behavior and needs one line of prose.

**Files:**
- Modify: `app/src/components/chart/KeyboardHelpOverlay.jsx` (the group render, lines ~50–63)
- Modify: `app/src/components/chart/KeyboardHelpOverlay.module.css` (after `.groupTitle`, line 65)

**Interfaces:**
- Consumes: `SHORTCUTS` from Task 2. No code interface changes.

- [ ] **Step 1: Add the hint to the Timeframe group**

In `app/src/components/chart/KeyboardHelpOverlay.jsx`, find the group body:

```jsx
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
```

Replace it with:

```jsx
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
                {groupName === 'Timeframe' && (
                  <p className={styles.groupNote}>
                    Press the same key again to step through every timeframe.
                  </p>
                )}
              </div>
```

- [ ] **Step 2: Style the hint**

In `app/src/components/chart/KeyboardHelpOverlay.module.css`, insert after the `.groupTitle` rule (which ends on line 65) and before `.list`:

```css
.groupNote {
  margin: 6px 0 0 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-text-muted, #8a8a8a);
  font-style: italic;
}
```

- [ ] **Step 3: Verify the overlay still renders**

Run: `cd app && npx vitest run src/components/chart`
Expected: PASS — no failures.

- [ ] **Step 4: Commit**

```bash
git add -- app/src/components/chart/KeyboardHelpOverlay.jsx app/src/components/chart/KeyboardHelpOverlay.module.css
git commit -m "Charts: note repeat-to-cycle in the keyboard help overlay"
```

---

### Task 6: Verify in the real app

jsdom cannot express focus ownership across two mounted charts, and it does not run the real bundle. This task is a hands-on smoke test — do not skip it, and report exactly what you observed rather than assuming.

**Files:** none (verification only).

- [ ] **Step 1: Build and start the app locally**

```bash
cd app && npm run build
```

Then from the repo root, with heavy background jobs off:

```bash
WORKER_ENABLED=0 CATALYST_ENGINE_ENABLED=0 TWITTERAPI_IO_ENABLED=0 \
BARS_PREWARM_DISABLED=1 TICKER_NAMES_PREWARM_DISABLED=1 \
python -m uvicorn api.main:app --port 8077
```

Open `http://localhost:8077/charts` and log in.

- [ ] **Step 2: Walk the checklist**

On a single chart widget, click the chart once to focus it, then confirm each line:

- [ ] `Shift+1` → 1m. `Shift+3` → 5m. `Shift+4` → 15m. `Shift+5` → 30m. `Shift+6` → 1h.
- [ ] `1` → Daily. `5` → Weekly. `9` → Monthly.
- [ ] The timeframe bar highlight follows every one of the above.
- [ ] Tapping `Shift+1` nine times walks 1m → 5m → 15m → 30m → 1h → Daily → Weekly → Monthly → 1m.
- [ ] Tapping `1` four times walks Daily → Weekly → Monthly → 1m.
- [ ] After clicking `1D` in the timeframe bar, pressing `1` moves to Weekly (not a dead press).
- [ ] Typing `d`, `e`, `l`, `l` opens the symbol box reading "DELL" — no timeframe change.
- [ ] Typing `w`, `m`, `t` opens the symbol box reading "WMT".
- [ ] With the symbol box open, typing digits enters them into the box (does not change timeframe). `Esc` closes it.
- [ ] `Shift+H` toggles Heikin Ashi and does NOT open the symbol box.
- [ ] `Shift+F` still flags the ticker.
- [ ] `?` opens the help overlay, the Timeframe group lists the new keys, and the repeat-to-cycle note is visible.
- [ ] `Ctrl+1` switches BROWSER TABS and the chart does not react. This is expected and is why Shift carries the intraday set.

- [ ] **Step 3: Verify multi-chart isolation**

Open a second chart widget (Open Layout → a two-chart arrangement, or Multi Chart).

- [ ] Click chart A, press `Shift+1` twice → chart A shows 5m, chart B is unchanged.
- [ ] Click chart B, press `1` → chart B shows Daily, chart A stays on 5m.
- [ ] Return to chart A and press `Shift+1` → it goes to 1m (home), confirming each chart owns its own cycle position.

- [ ] **Step 4: Report**

Write up what passed and what did not, quoting the actual behavior for anything that failed. Do not claim the task is complete on the strength of the unit tests alone.

---

## Done

All five code tasks committed on `chart-tf-shortcuts` and the smoke test walked. **Do not push or deploy** — hand the branch back to the owner for the ship decision.

## Out of scope

Drawing tools, display toggles, indicator toggles and replay keep their current bindings. A Settings walkthrough / shortcut legend is a separate project.
