// review #1061 F4: cache peeks outside StockChart read the CURRENT view's key.
import { describe, it, expect, afterEach } from 'vitest'
import { setViewShowExtended, viewCacheTf, resolveShowExtended } from './viewSession'
import fs from 'node:fs'
import path from 'node:path'
import { peekDisplayable } from '../hooks/useSymbolHandoff'
import { memPut, memClear } from './barsMemCache'

afterEach(() => { setViewShowExtended(false); memClear() })

describe('viewCacheTf', () => {
  it('60m follows the view; every other tf is itself', () => {
    expect(viewCacheTf('60')).toBe('60')
    setViewShowExtended(true)
    expect(viewCacheTf('60')).toBe('60e')
    expect(viewCacheTf('5')).toBe('5')
    expect(viewCacheTf('D')).toBe('D')
  })
  it('the symbol handoff fast path finds the ETH 60m series under 60e', () => {
    const now = Math.floor(Date.now() / 1000)
    const t = now - (now % 3600)
    memPut('HAND', '60e', [{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    setViewShowExtended(false)
    const rth = peekDisplayable('HAND', '60')
    setViewShowExtended(true)
    expect(rth).toBe(false)                    // RTH view: nothing under '60'
    // ETH view reads '60e' (displayable iff current-enough; at least it LOOKS there)
    memPut('HAND2', '60', [{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(peekDisplayable('HAND2', '60')).toBe(false)   // the '60' entry is not this view's
  })
})

// P3-S2 review (c): ONE derivation of a chart's extended-hours view. ChartWidget names the pane's
// series key with it (the handoff), StockChart renders with it; two copies of the rule could drift
// (e.g. forceExtendedHours), so every surface calls this one function.
describe('resolveShowExtended — the one showExtended rule', () => {
  it('forceExtendedHours (not null/undefined) wins; else extendedHoursShading, default ON', () => {
    for (const shading of [true, false, undefined, null]) {
      for (const force of [true, false, null, undefined, 1, 0]) {
        const want = (force !== null && force !== undefined) ? !!force : (shading ?? true)
        expect(resolveShowExtended({ extendedHoursShading: shading }, force), `shading=${shading} force=${force}`).toBe(want)
      }
    }
    expect(resolveShowExtended(null)).toBe(true)
    expect(resolveShowExtended(undefined, false)).toBe(false)
  })
  it('no surface re-derives it inline (StockChart, ChartWidget, ChartPane, GridChartCell)', () => {
    const SRC = path.resolve(globalThis.process.cwd(), 'src')
    for (const rel of ['components/StockChart.jsx', 'pages/charts/widgets/ChartWidget.jsx',
      'components/chart/pane/ChartPane.jsx', 'pages/charts/grid/GridChartCell.jsx']) {
      const code = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
      expect(code, rel).not.toMatch(/extendedHoursShading \?\? true/)
      expect(code, rel).toMatch(/resolveShowExtended\(/)
    }
  })
})
