// ── HELD-OUT (guide side): a chart named by its row and "middle" ("the bottom middle chart"), on 2×2, 3×1 and 3×2 boards ──
// The guide reads the SHARED resolver (deixis.js ordinalChart, via guide/namedChart.js); the row/column reading is pl-exec's
// fix (567fae456d, on r8-integration). ⛔ EXPECTED TO PASS ONCE r8 LANDS: until this tree's ordinalChart reads a row word, the
// block is skipped (the probe below), so it never fails a suite here. Checked locally against r8's deixis.js (LOCAL /
// SIMULATED): see the commit. Written in words of this file's own.
import { describe, it, expect } from 'vitest'
import { namedChart } from './guide/namedChart'
import { ordinalChart } from './deixis'

const at = (ref, sym, x, y) => ({ ref, symbol: sym, label: `${sym} chart`, cell: { x, y } })
// 3×2: three across, two down
const SIX = [at('tl', 'SPY', 0, 0), at('tm', 'QQQ', 1, 0), at('tr', 'IWM', 2, 0), at('bl', 'NVDA', 0, 1), at('bm', 'AMD', 1, 1), at('br', 'TSLA', 2, 1)]
// 3×1: three across, one row
const THREE = [at('l', 'SPY', 0, 0), at('m', 'QQQ', 1, 0), at('r', 'IWM', 2, 0)]
// 2×2
const FOUR = [at('tl', 'SPY', 0, 0), at('tr', 'QQQ', 1, 0), at('bl', 'NVDA', 0, 1), at('br', 'AMD', 1, 1)]

const reads = !!ordinalChart('the bottom middle chart', SIX)?.ref
describe.skipIf(!reads)('a chart by its row and "middle" (expected to pass once r8-integration lands)', () => {
  it.each([
    ['how do I change the timeframe on the bottom middle chart', 'bm'],
    ['how do I add RSI to the middle chart on the bottom row', 'bm'],
    ['show me how to make the top middle chart weekly', 'tm'],
    ['where do I change the symbol on the upper middle chart', 'tm'],
  ])('3×2 — %s → %s', (q, ref) => { expect(namedChart(q, SIX)?.chart?.ref).toBe(ref) })
  it.each([
    ['how do I change the timeframe on the bottom middle chart', 'm'],
    ['how do I add RSI to the top middle chart', 'm'],
  ])('3×1 — %s → %s (its one row holds three)', (q, ref) => { expect(namedChart(q, THREE)?.chart?.ref).toBe(ref) })
  it.each([
    'how do I change the timeframe on the bottom middle chart',
    'how do I add RSI to the top middle chart',
  ])('2×2 — %s → asked (a row of two has no middle)', (q) => {
    const got = namedChart(q, FOUR)
    expect(got?.chart).toBeUndefined()
    expect(got?.say).toMatch(/Which chart is the middle one here\?/)
  })
})
describe('the probe itself', () => {
  it('reads the shared resolver, never a copy of it', () => { expect(typeof ordinalChart).toBe('function') })
})
