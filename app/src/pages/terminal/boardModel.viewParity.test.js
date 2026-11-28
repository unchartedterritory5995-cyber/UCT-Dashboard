// The board's `normalizeView` (boardModel.js) and the panel kit's (components/terminal/panelView.js)
// are two copies ON PURPOSE (one shared module would be a chunk of its own on the Notebook's first
// open). This holds them equal on every shape and bound, so one cannot drift from the other.
import { describe, it, expect } from 'vitest'
import { normalizeView as boardView } from './boardModel'
import { VIEW_MAX_BYTES, VIEW_MAX_FILTERS, VIEW_MAX_HIDDEN, VIEW_MAX_STR, normalizeView as kitView } from '../../components/terminal/panelView'

const key = (i) => `k${String(i).padStart(2, '0')}${'x'.repeat(36)}`
const CASES = [
  undefined, null, 'x', 7, [], {},
  { sort: { key: 'pct', dir: 'desc' } },
  { sort: { key: 'pct', dir: 'up' } },
  { sort: { key: '<x>', dir: 'asc' } },
  { sort: { key: 'pct', dir: 'asc', extra: 1 }, junk: 1 },
  { cols: { hidden: [] } },
  { cols: { hidden: ['a', 'a', 'b', 3, '9bad'] } },
  { cols: { hidden: 'volume' } },
  { cols: { hidden: Array.from({ length: 40 }, (_, i) => `c${i}`) } },
  { filters: { a: 1, b: 'x', c: true, d: null, e: { deep: 1 }, f: Infinity, g: [1] } },
  { filters: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i])) },
  { filters: { q: 'x'.repeat(VIEW_MAX_STR) } },
  { filters: { q: 'x'.repeat(VIEW_MAX_STR + 1) } },
  { filters: { 's.30D': 'pct|asc', 'c.grade': '' } },
  { filters: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [key(i), 'y'.repeat(40)])), cols: { hidden: Array.from({ length: 24 }, (_, i) => key(i)) } },
  { sort: { key: 'name', dir: 'asc' }, cols: { hidden: ['ah'] }, filters: { minPrice: 5 } },
]

describe('the board and the panel kit clean a view the same way', () => {
  it.each(CASES.map((c, i) => [i, c]))('case %i', (_, c) => {
    expect(boardView(c)).toEqual(kitView(c))
  })
  it('the bounds the board copy hard-codes are the kit\'s', () => {
    expect([VIEW_MAX_FILTERS, VIEW_MAX_HIDDEN, VIEW_MAX_STR, VIEW_MAX_BYTES]).toEqual([8, 24, 80, 1024])
  })
})
