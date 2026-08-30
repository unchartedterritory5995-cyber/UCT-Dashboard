// ⛔⛔ A `widgetKey` WITHOUT AN `activeRef` IS A WIDGET THAT NEVER LOSES THE KEYBOARD.
//
// `Watchlists` and `ThemeTrackerPage` read the two as a PAIR:
//
//     const isActiveWidget   = () => !activeRef || activeRef.current == null
//                                    || activeRef.current === widgetKey
//     const markActiveWidget = () => { if (activeRef && widgetKey) activeRef.current = widgetKey }
//
// Pass the key alone and BOTH halves fail open: the widget is permanently
// "active" (it answers every Shift+F and every arrow, whichever widget you are
// really in) and it can never claim the lock, so it cannot hand it over either.
//
// ⚰️ MEASURED 2026-08-29: ScannerResults, PeriodSortResults and EtfHoldingsResults
// each passed `widgetKey` and no `activeRef`. With a scan widget open beside a
// watchlist widget, one Shift+F flagged the selected ticker in BOTH.
//
// This is a SOURCE rail on purpose. The defect is a missing prop — there is no
// runtime state to assert on, and mounting the workspace with two live widgets to
// catch a forgotten attribute is a far heavier test that fails for more reasons.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [HERE, join(HERE, '..', '..', '..', 'pages', 'charts', 'widgets')];

function widgetSources() {
  const seen = new Map();
  for (const dir of ROOTS) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsx') || n.includes('.test.')) continue;
      const p = join(dir, n);
      if (!seen.has(n)) seen.set(n, readFileSync(p, 'utf8'));
    }
  }
  return seen;
}

describe('keyboard-ownership props travel together', () => {
  const sources = widgetSources();

  it('finds widget sources to inspect (guards against a vacuous pass)', () => {
    expect(sources.size).toBeGreaterThan(3);
  });

  it('every widget passing widgetKey= also passes activeRef=', () => {
    const offenders = [];
    for (const [name, src] of sources) {
      if (/\bwidgetKey=\{/.test(src) && !/\bactiveRef=\{/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('the three scan widgets specifically pass both', () => {
    for (const n of ['ScannerResults.jsx', 'PeriodSortResults.jsx', 'EtfHoldingsResults.jsx']) {
      const src = sources.get(n);
      expect(src, `${n} not found`).toBeTruthy();
      expect(src, `${n} lost activeRef`).toMatch(/activeRef=\{activeWatchlistRef\}/);
      expect(src, `${n} lost widgetKey`).toMatch(/widgetKey=\{widgetId\}/);
    }
  });
});
