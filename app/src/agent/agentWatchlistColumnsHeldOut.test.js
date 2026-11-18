// WATCHLIST EXECUTION, group C (columns) — pl-widget, agent/pl/exec-widget-actions. HELD-OUT phrasings, written as FAMILIES
// before the change and never used to tune it. C3-085 move a column (the header drag), C3-086 a column's width (the gridline).
// The default columns on the fixture list are Symbol, Price, Volume, % Change (flag first).
// args = what a correct plan carries (watchlist.arrangeColumns { column, before, after, width }); order = the stored column order after it
// (less the flag star).
const A = (column, before = null, after = null, width = null) => ({ column, before, after, width })
export const MOVE_HELD_OUT = [
  { row: 'C3-085', text: 'move % change before price on my watchlist', args: A('% change', 'price'), order: ['sym', 'chg', 'price', 'vol'] },
  { row: 'C3-085', text: 'put the volume column right after the symbol', args: A('volume', null, 'symbol'), order: ['sym', 'vol', 'price', 'chg'] },
  { row: 'C3-085', text: 'drag price over to after % change', args: A('price', null, '% change'), order: ['sym', 'vol', 'chg', 'price'] },
  { row: 'C3-085', text: 'swap the order so change comes ahead of volume', args: A('chg', 'vol'), order: ['sym', 'price', 'chg', 'vol'] },
]
export const WIDTH_HELD_OUT = [
  { row: 'C3-086', text: 'make the symbol column wider, 140 pixels', args: A('symbol', null, null, 140), key: 'sym', px: 140 },
  { row: 'C3-086', text: 'narrow the price column to 50', args: A('price', null, null, 50), key: 'price', px: 50 },
  { row: 'C3-086', text: 'set % change to 90px wide on the watchlist', args: A('% change', null, null, 90), key: 'chg', px: 90 },
]
export const COLUMNS_REFUSE_HELD_OUT = [
  { row: 'C3-086', text: 'shrink the price column to 5 pixels', args: A('price', null, null, 5), refuse: /from 44 to 600/ },
  { row: 'C3-086', text: 'make volume 2000 pixels wide', args: A('volume', null, null, 2000), refuse: /to 600/ },
  { row: 'C3-085', text: 'move RVOL before price', args: A('RVOL', 'price'), refuse: /isn't showing/ },
  { row: 'C3-085', text: 'move price before beta', args: A('price', 'Beta'), refuse: /isn't a column here/ },
]

import { describe, it, expect } from 'vitest'
describe('watchlist column held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...MOVE_HELD_OUT, ...WIDTH_HELD_OUT, ...COLUMNS_REFUSE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
