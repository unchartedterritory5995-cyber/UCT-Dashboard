// P1 GAPS: HELD-OUT phrasings (pl-exec, branch agent/pl/exec-p1-gaps). Written and committed BEFORE any change and never used to
// tune it. Evidence class: SIMULATED (scripted model).
// C1-025: auto-scale the price axis of ONE chart (the chart's own "A" / auto button; a dragged price scale back to auto)
export const AUTOSCALE_HELD_OUT = [
  { row: 'C1-025', text: 'auto scale this chart' },
  { row: 'C1-025', text: 'put the price axis back on auto' },
  { row: 'C1-025', text: 'fit the price scale to the candles again' },
  { row: 'C1-025', text: 'turn auto-scaling back on for this one' },
]
// C1-036 / C1-038: take comparison overlays off ONE chart (one symbol / all of them), through the Compare Symbols panel's writers
export const COMPARE_REMOVE_HELD_OUT = [
  { row: 'C1-036', text: 'take QQQ off this chart', remove: ['QQQ'] },
  { row: 'C1-036', text: 'stop comparing this one to SPY', remove: ['SPY'] },
  { row: 'C1-038', text: 'remove all the comparison overlays', clear: true },
  { row: 'C1-038', text: 'clear the compare symbols on this chart', clear: true },
]
// C1-080: one of UCT's chart themes on EVERY chart of the board at once (the theme gallery's "all charts")
export const THEME_ALL_HELD_OUT = [
  { row: 'C1-080', text: 'put every chart on the Nord theme', theme: 'nord' },
  { row: 'C1-080', text: 'make all my charts use the Midnight theme', theme: 'midnight' },
  { row: 'C1-080', text: 'switch the whole board to the Graphite chart theme', theme: 'graphite' },
]

import { describe, it, expect } from 'vitest'
describe('P1-gap held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...AUTOSCALE_HELD_OUT, ...COMPARE_REMOVE_HELD_OUT, ...THEME_ALL_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
