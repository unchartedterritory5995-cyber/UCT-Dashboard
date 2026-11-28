// ⭐ (2026-11-28, cold-arch report section 3.3 item 7) A DAILY CHART ZOOMED ALL THE WAY OUT HOLDS 2014-2026.
// The library's default minBarSpacing (0.5 px) caps the bars on screen at plot width / 0.5: 787 bars on a 394 px
// plot (the production rig's chart cell), about three years of D. The chart's own floor (MIN_BAR_SPACING) must hold
// 2014-01-02 .. 2026-11-25 (3,250 sessions) on that plot, and every reader of the zoom limit (the Agent's
// zoomLimitsOf) must read the same floor, never the library's default.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_BAR_SPACING, maxVisibleBars } from './zoomOutLimit'

const here = dirname(fileURLToPath(import.meta.url))
const src = (p) => readFileSync(resolve(here, p), 'utf8').split('\r\n').join('\n')

// NYSE sessions 2014-01-02 .. 2026-11-25: ~252 a year for 12.9 years
const SESSIONS_2014_TO_NOW = 3250
const RIG_PLOT_PX = 394

describe('zoomed out, a daily chart holds 2014 to today', () => {
  it('the floor holds 2014-2026 D on the rig\'s 394 px plot (the library default holds 788)', () => {
    expect(maxVisibleBars(RIG_PLOT_PX, 0.5)).toBe(788)
    expect(maxVisibleBars(RIG_PLOT_PX)).toBeGreaterThanOrEqual(SESSIONS_2014_TO_NOW)
  })
  it('the floor stays a positive spacing the library accepts (not 0, which would let a wheel zoom to nothing)', () => {
    expect(MIN_BAR_SPACING).toBeGreaterThan(0)
    expect(MIN_BAR_SPACING).toBeLessThanOrEqual(0.12)
  })
  it('the chart is created with it, and zoomLimitsOf falls back to it, never to the library default', () => {
    const s = src('../StockChart.jsx')
    const from = s.indexOf('      timeScale: {\n        borderColor')
    expect(from).toBeGreaterThan(0)
    const ts = s.slice(from, s.indexOf('\n      },\n    }\n', from))
    expect(ts).toMatch(/minBarSpacing: MIN_BAR_SPACING,/)
    const at = s.indexOf('function zoomLimitsOf(')
    expect(at).toBeGreaterThan(0)
    const lim = s.slice(at, s.indexOf('\n}\n', at))
    expect(lim).toMatch(/o\.minBarSpacing > 0 \? o\.minBarSpacing : MIN_BAR_SPACING/)
    expect(lim).not.toMatch(/: 0\.5\b/)
  })
})
