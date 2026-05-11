# Chart Screenshot + Share — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing minimal screenshot to elite-tier: composite the chart with a branded header (sym + TF + price), UCT watermark, copy-to-clipboard, and a shareable URL system where any chart configuration can be embedded in a link.

**Architecture:** Frontend-only for screenshot composition (canvas operations via `chart.takeScreenshot()` returns `HTMLCanvasElement`; we composite onto a wrapper canvas with header + watermark drawn on top). Clipboard via standard `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`. Share URLs encode chart state into a compact JSON → base64 → query param; on chart mount, if `?state=...` is present, we decode and apply.

**Tech Stack:** Standard browser canvas APIs, Clipboard API, base64 encoding (built-in `btoa`/`atob`), React Router for URL handling.

**No backend changes required** — share URLs are pure client-side state encoding.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `app/src/components/chart/chartScreenshot.js` | Pure utility: `composeScreenshot(chart, opts)` returns Blob; `chartStateToUrl(state)` and `urlToChartState(url)` encode/decode chart state for share URLs |
| `app/src/components/chart/ScreenshotPopover.jsx` | Popover with Download / Copy / Share URL buttons + preview thumbnail |
| `app/src/components/chart/ScreenshotPopover.module.css` | Popover styles |
| `tests/test_chart_screenshot_utils.js` | Vitest tests for chartStateToUrl/urlToChartState round-trip |

### Modified files
| File | Change |
|---|---|
| `app/src/components/StockChart.jsx` | Replace `handleScreenshot` to use `composeScreenshot`; mount popover on click; on mount, read `?state=...` query param and apply chart state |
| `app/src/components/chart/ChartToolbar.jsx` | Replace direct screenshot trigger with popover open (similar to Compare button pattern) |
| `app/src/App.jsx` (optional) | Ensure URL state survives the existing route system |

---

## Task 1: Screenshot composition + share URL utilities

**Files:**
- Create: `app/src/components/chart/chartScreenshot.js`
- Create: `app/src/components/chart/chartScreenshot.test.js`

- [ ] **Step 1: Failing tests**

```javascript
import { describe, it, expect } from 'vitest';
import { chartStateToUrl, urlToChartState } from './chartScreenshot';


describe('chartStateToUrl / urlToChartState', () => {
  it('encodes and decodes a basic chart state', () => {
    const state = {
      sym: 'AAPL',
      tf: 'D',
      chartType: 'candles',
      heikinAshi: false,
      logScale: false,
      indicators: { rsi: { enabled: true, period: 14 } },
      comparisonSymbols: [{ sym: 'QQQ', color: '#60a5fa', enabled: true }],
    };
    const url = chartStateToUrl(state);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    const decoded = urlToChartState(url);
    expect(decoded).toEqual(state);
  });

  it('returns empty string for null state', () => {
    expect(chartStateToUrl(null)).toBe('');
    expect(chartStateToUrl(undefined)).toBe('');
  });

  it('returns null for invalid base64', () => {
    expect(urlToChartState('not-valid-base64-!@#$')).toBe(null);
  });

  it('returns null for valid base64 that is not valid JSON', () => {
    const garbage = btoa('not json');
    expect(urlToChartState(garbage)).toBe(null);
  });

  it('handles empty object', () => {
    const url = chartStateToUrl({});
    expect(urlToChartState(url)).toEqual({});
  });

  it('URL-safe encoding (no +/= chars)', () => {
    const state = { sym: 'AAPL', tf: 'D' };
    const url = chartStateToUrl(state);
    expect(url.includes('+')).toBe(false);
    expect(url.includes('/')).toBe(false);
    expect(url.includes('=')).toBe(false);
  });

  it('roundtrips with all 8 timeframes', () => {
    for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) {
      const state = { sym: 'AAPL', tf };
      expect(urlToChartState(chartStateToUrl(state)).tf).toBe(tf);
    }
  });

  it('preserves array order in comparisonSymbols', () => {
    const state = {
      comparisonSymbols: [
        { sym: 'QQQ', color: '#60a5fa', enabled: true },
        { sym: 'SPY', color: '#f472b6', enabled: false },
        { sym: 'IWM', color: '#34d399', enabled: true },
      ],
    };
    const decoded = urlToChartState(chartStateToUrl(state));
    expect(decoded.comparisonSymbols.map(c => c.sym)).toEqual(['QQQ', 'SPY', 'IWM']);
  });
});
```

- [ ] **Step 2: Run, fail (ImportError)**

```bash
cd app && npx vitest run src/components/chart/chartScreenshot.test.js
```

- [ ] **Step 3: Implement utilities**

```javascript
// app/src/components/chart/chartScreenshot.js


/**
 * URL-safe base64 encoding (no +, /, = chars).
 * Used to embed chart state in shareable URLs.
 */
function urlSafeEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}


function urlSafeDecode(encoded) {
  // Re-pad to multiple of 4
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return atob(padded);
}


/**
 * Encode a chart state object into a URL-safe string.
 * Returns empty string for null/undefined input.
 */
export function chartStateToUrl(state) {
  if (!state) return '';
  try {
    const json = JSON.stringify(state);
    return urlSafeEncode(json);
  } catch {
    return '';
  }
}


/**
 * Decode a URL-safe string back to a chart state object.
 * Returns null on any parse error.
 */
export function urlToChartState(encoded) {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const json = urlSafeDecode(encoded);
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}


/**
 * Compose a branded screenshot from a Lightweight Charts instance.
 * Returns a Blob (PNG).
 *
 * Layout:
 *   - 40px header strip at top with SYM • TF • Price • UCT logo
 *   - Chart canvas (from chart.takeScreenshot())
 *   - 20px footer strip with timestamp + uctintelligence.com
 *
 * @param {object} chart - Lightweight Charts instance
 * @param {object} opts - {sym, tf, price, change, changePct}
 * @returns {Promise<Blob>} PNG blob
 */
export async function composeScreenshot(chart, opts = {}) {
  if (!chart) throw new Error('No chart instance');
  // takeScreenshot returns an HTMLCanvasElement in v5, ImageData-like in older
  const chartCanvas = chart.takeScreenshot();
  const cw = chartCanvas.width || chartCanvas.canvas?.width || 1200;
  const ch = chartCanvas.height || chartCanvas.canvas?.height || 600;

  const HEADER_H = 40;
  const FOOTER_H = 20;
  const totalW = cw;
  const totalH = HEADER_H + ch + FOOTER_H;

  const out = document.createElement('canvas');
  out.width = totalW;
  out.height = totalH;
  const ctx = out.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, totalW, totalH);

  // Header
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, totalW, HEADER_H);
  ctx.fillStyle = '#c9a84c';  // UCT gold
  ctx.font = 'bold 18px "IBM Plex Mono", monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.sym || '', 16, HEADER_H / 2);
  ctx.fillStyle = '#888';
  ctx.font = '14px sans-serif';
  ctx.fillText(opts.tf || '', 100, HEADER_H / 2);
  if (Number.isFinite(opts.price)) {
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(`$${opts.price.toFixed(2)}`, 160, HEADER_H / 2);
  }
  if (Number.isFinite(opts.changePct)) {
    ctx.fillStyle = opts.changePct >= 0 ? '#22c55e' : '#ef4444';
    ctx.fillText(`${opts.changePct >= 0 ? '+' : ''}${opts.changePct.toFixed(2)}%`, 240, HEADER_H / 2);
  }
  // UCT brand on right
  ctx.fillStyle = '#c9a84c';
  ctx.font = 'bold 12px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('UCT INTELLIGENCE', totalW - 16, HEADER_H / 2);
  ctx.textAlign = 'left';

  // Chart canvas
  ctx.drawImage(chartCanvas, 0, HEADER_H);

  // Footer
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, HEADER_H + ch, totalW, FOOTER_H);
  ctx.fillStyle = '#666';
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', 16, HEADER_H + ch + FOOTER_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('uctintelligence.com', totalW - 16, HEADER_H + ch + FOOTER_H / 2);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      },
      'image/png'
    );
  });
}


/**
 * Download a Blob as a file.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/**
 * Copy a Blob (PNG) to the clipboard using the Clipboard API.
 * Returns true on success, false on failure.
 */
export async function copyBlobToClipboard(blob) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.write) return false;
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    return true;
  } catch (err) {
    console.warn('Clipboard write failed:', err);
    return false;
  }
}
```

- [ ] **Step 4: Tests pass**

```bash
cd app && npx vitest run src/components/chart/chartScreenshot.test.js
```

8/8 should pass.

- [ ] **Step 5: Build**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/chartScreenshot.js app/src/components/chart/chartScreenshot.test.js
git commit -m "feat(charts): screenshot composition + share URL utilities"
```

---

## Task 2: ScreenshotPopover component

**Files:**
- Create: `app/src/components/chart/ScreenshotPopover.jsx`
- Create: `app/src/components/chart/ScreenshotPopover.module.css`

- [ ] **Step 1: Component**

```jsx
import { useState } from 'react';
import styles from './ScreenshotPopover.module.css';


export default function ScreenshotPopover({ onDownload, onCopy, onShare, onClose }) {
  const [status, setStatus] = useState('');  // 'copied', 'shared', 'copy-failed'

  async function handleCopy() {
    setStatus('copying');
    const ok = await onCopy();
    setStatus(ok ? 'copied' : 'copy-failed');
    setTimeout(() => setStatus(''), 2000);
  }

  function handleShare() {
    onShare();  // expected to copy URL to clipboard internally
    setStatus('shared');
    setTimeout(() => setStatus(''), 2000);
  }

  function handleDownload() {
    onDownload();
    setStatus('downloaded');
    setTimeout(() => setStatus(''), 2000);
  }

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <span className={styles.title}>Share Chart</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className={styles.actions}>
        <button className={styles.action} onClick={handleDownload}>
          <span className={styles.icon}>⬇</span>
          <span>Download PNG</span>
        </button>
        <button className={styles.action} onClick={handleCopy}>
          <span className={styles.icon}>⎘</span>
          <span>Copy to Clipboard</span>
        </button>
        <button className={styles.action} onClick={handleShare}>
          <span className={styles.icon}>🔗</span>
          <span>Copy Share URL</span>
        </button>
      </div>

      {status === 'copied' && <div className={styles.status}>Image copied ✓</div>}
      {status === 'shared' && <div className={styles.status}>URL copied ✓</div>}
      {status === 'downloaded' && <div className={styles.status}>Downloaded ✓</div>}
      {status === 'copy-failed' && <div className={styles.statusError}>Clipboard unavailable</div>}
      {status === 'copying' && <div className={styles.status}>Working...</div>}
    </div>
  );
}
```

- [ ] **Step 2: CSS**

```css
.popover {
  position: absolute;
  top: 40px;
  right: 8px;
  width: 240px;
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
}
.close:hover { color: var(--text-heading, #f0f0f0); }
.actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.action {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-surface, #161616);
  color: var(--text, #e5e5e5);
  border: 1px solid var(--border, #2a2a2a);
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 120ms;
}
.action:hover {
  background: var(--bg-elevated, #2a2a2a);
}
.icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}
.status {
  margin-top: 10px;
  color: var(--gain, #22c55e);
  font-size: 12px;
  text-align: center;
}
.statusError {
  margin-top: 10px;
  color: var(--loss, #ef4444);
  font-size: 12px;
  text-align: center;
}
```

- [ ] **Step 3: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/ScreenshotPopover.jsx app/src/components/chart/ScreenshotPopover.module.css
git commit -m "feat(charts): ScreenshotPopover component (download/copy/share)"
```

---

## Task 3: Wire StockChart's screenshot flow

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Update handleScreenshot to use composeScreenshot**

Find the existing `handleScreenshot` callback. Replace with one that uses the new utilities:

```jsx
import { composeScreenshot, downloadBlob, copyBlobToClipboard, chartStateToUrl } from './chart/chartScreenshot';

// Inside component:
const [screenshotPopoverOpen, setScreenshotPopoverOpen] = useState(false);

const handleDownload = useCallback(async () => {
  if (!chartRef.current) return;
  try {
    const blob = await composeScreenshot(chartRef.current, {
      sym, tf: resolvedTf, price: lastPriceRef.current, changePct: lastChangePctRef.current
    });
    const filename = `${sym || 'chart'}-${resolvedTf}-${new Date().toISOString().slice(0, 10)}.png`;
    downloadBlob(blob, filename);
  } catch (err) {
    console.warn('Screenshot failed:', err);
  }
}, [sym, resolvedTf]);


const handleCopyImage = useCallback(async () => {
  if (!chartRef.current) return false;
  try {
    const blob = await composeScreenshot(chartRef.current, {
      sym, tf: resolvedTf, price: lastPriceRef.current, changePct: lastChangePctRef.current
    });
    return await copyBlobToClipboard(blob);
  } catch (err) {
    console.warn('Copy failed:', err);
    return false;
  }
}, [sym, resolvedTf]);


const handleCopyShareUrl = useCallback(() => {
  const state = {
    sym,
    tf: resolvedTf,
    chartType: cs.chartType,
    heikinAshi: cs.heikinAshi,
    logScale: cs.logScale,
    indicators: {
      rsi: { enabled: cs.indicators?.rsi?.enabled },
      macd: { enabled: cs.indicators?.macd?.enabled },
      bb: { enabled: cs.indicators?.bb?.enabled },
      vwap: { enabled: cs.indicators?.vwap?.enabled },
    },
    comparisonSymbols: cs.comparisonSymbols || [],
    markers: cs.markers || {},
  };
  const encoded = chartStateToUrl(state);
  const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
  try {
    navigator.clipboard.writeText(url);
  } catch {}
}, [sym, resolvedTf, cs]);
```

- [ ] **Step 2: Replace any existing toolbar screenshot prop or handler invocation**

If `handleScreenshot` was passed to ChartToolbar, replace with `() => setScreenshotPopoverOpen(true)`.

- [ ] **Step 3: Render the popover**

Inside the chart wrapper JSX, near where ComparisonPicker is rendered:

```jsx
{screenshotPopoverOpen && (
  <ScreenshotPopover
    onDownload={handleDownload}
    onCopy={handleCopyImage}
    onShare={handleCopyShareUrl}
    onClose={() => setScreenshotPopoverOpen(false)}
  />
)}
```

Import the component:
```jsx
import ScreenshotPopover from './chart/ScreenshotPopover';
```

- [ ] **Step 4: Read share URL on mount + apply chart state**

Add a useEffect that runs once on mount:

```jsx
useEffect(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('state');
    if (!encoded) return;
    const decoded = urlToChartState(encoded);
    if (!decoded) return;
    // Apply: sym is controlled by parent so we can't change it directly,
    // but we CAN apply chart settings (chartType, heikinAshi, logScale, indicators, comparisonSymbols, markers)
    const next = {
      ...cs,
      ...(decoded.chartType ? { chartType: decoded.chartType } : {}),
      ...(typeof decoded.heikinAshi === 'boolean' ? { heikinAshi: decoded.heikinAshi } : {}),
      ...(typeof decoded.logScale === 'boolean' ? { logScale: decoded.logScale } : {}),
      ...(decoded.indicators ? { indicators: { ...cs.indicators, ...decoded.indicators } } : {}),
      ...(decoded.comparisonSymbols ? { comparisonSymbols: decoded.comparisonSymbols } : {}),
      ...(decoded.markers ? { markers: { ...cs.markers, ...decoded.markers } } : {}),
      preset: 'custom',
    };
    handleUpdateChartSettings(next);

    // Inform parent of sym + tf change via onSymbolChange/onTfChange if provided
    if (decoded.sym && decoded.sym !== sym && typeof onSymbolChange === 'function') {
      onSymbolChange(decoded.sym);
    }
    if (decoded.tf && decoded.tf !== resolvedTf && typeof onTfChange === 'function') {
      onTfChange(decoded.tf);
    }
  } catch (err) {
    console.warn('Failed to apply share URL state:', err);
  }
}, []);  // intentionally empty — only run once on mount
```

Adapt the callback prop names (`onSymbolChange`, `onTfChange`) to whatever StockChart already accepts.

- [ ] **Step 5: Build**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 6: Commit + push**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): screenshot composition + share URL applied on mount"
git push
```

---

## Task 4: ChartToolbar — Screenshot button opens popover

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`

- [ ] **Step 1: Replace existing screenshot button trigger**

Find the existing screenshot button (per earlier note, ChartToolbar already has one). Change its `onClick` to trigger the popover open state in StockChart instead of directly calling the download.

If the button is `<button onClick={onScreenshot}>📷</button>`, the prop `onScreenshot` should now be `() => setScreenshotPopoverOpen(true)` passed from StockChart.

If there's no direct prop wiring, the cleanest pattern is:
1. StockChart owns `screenshotPopoverOpen` state
2. StockChart passes `onScreenshot={() => setScreenshotPopoverOpen(true)}` to ChartToolbar
3. ChartToolbar's button calls `onScreenshot` on click

If there's already a different approach (e.g., ChartToolbar directly calls `chart.takeScreenshot()`), refactor minimally to lift the trigger up to StockChart.

- [ ] **Step 2: Build**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 3: Commit + push**

```bash
git add app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(charts): screenshot button opens popover instead of direct download"
git push
```

---

## Task 5: Smoke test + verification

- [ ] **Step 1: Build cleanly**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 2: App imports OK**

```bash
python -c "from api.main import app; print('OK')"
```

- [ ] **Step 3: Frontend tests pass**

```bash
cd app && npx vitest run src/components/chart/chartScreenshot.test.js && cd ..
```

- [ ] **Step 4: Manual smoke test**

```bash
cd app && npm run dev
```

1. Open any chart
2. Click the screenshot icon — popover opens with 3 options
3. Click Download PNG — file downloads, opens correctly, has header + chart + footer
4. Click Copy to Clipboard — status shows "Image copied ✓" — paste into a chat/email — image appears
5. Click Copy Share URL — status shows "URL copied ✓" — paste in browser → chart loads with the same configuration (indicators, comparisons, etc.)
6. Test share URL with 2+ comparison symbols + 2 indicators enabled — verify they all restore

- [ ] **Step 5: Final commit + push**

If smoke test exposed any issues:

```bash
git add <files>
git commit -m "fix(charts): screenshot/share polish from smoke test"
git push
```

---

## Done — what changed

After this plan ships:

1. **Screenshot is branded** — every download has the UCT header (sym + TF + price + change) and footer (timestamp + uctintelligence.com)
2. **One-click clipboard** — Copy to Clipboard puts the image directly in the user's clipboard for instant paste
3. **Shareable URLs** — `Copy Share URL` generates a link that, when opened, restores the exact chart configuration (sym, TF, chart type, indicators, comparisons, markers)
4. **Popover UX** — instead of direct-download on screenshot click, a clean 3-option popover

The share URL feature is the elite differentiator: traders can DM a chart to a colleague and they see the EXACT same setup with all overlays and indicators.

## Self-review

- Every task has explicit files + code + tests + commits
- Pure utilities (Task 1) have unit tests including edge cases (null, garbage base64, all 8 timeframes, array order preservation)
- Compose screenshot composes from native `chart.takeScreenshot()` output → wrapper canvas with branding
- Clipboard API gracefully degrades (returns false on unsupported, popover shows "Clipboard unavailable")
- Share URL handles edge cases (missing state param, invalid base64, missing fields)
- No backend changes required
- No placeholders
