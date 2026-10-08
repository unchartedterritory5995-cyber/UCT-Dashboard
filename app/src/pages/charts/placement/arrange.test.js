import { describe, it, expect } from 'vitest'
import { boardProblems, fillGaps, tileWidgets } from './arrange'

const COLS = 24, ROWS = 20
const minOf = () => ({ minW: 2, minH: 3 })
const apply = (ws, rects) => ws.map(w => (rects[w.id] ? { ...w, ...rects[w.id] } : w))

describe('board arrangement helpers', () => {
  it('boardProblems finds outside, too-small and overlapping widgets — and nothing on a valid board', () => {
    expect(boardProblems([{ id: 'a', x: 0, y: 0, w: 12, h: 20 }, { id: 'b', x: 12, y: 0, w: 12, h: 20 }], COLS, ROWS, minOf)).toEqual([])
    expect(boardProblems([{ id: 'a', x: 20, y: 0, w: 6, h: 5 }], COLS, ROWS, minOf)[0].problem).toBe('outside')
    expect(boardProblems([{ id: 'a', x: 0, y: 0, w: 1, h: 5 }], COLS, ROWS, minOf)[0].problem).toBe('too-small')
    expect(boardProblems([{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 5, y: 5, w: 10, h: 10 }], COLS, ROWS, minOf)[0].problem).toBe('overlap')
  })
  it('fillGaps grows only the listed widgets into empty space and leaves the rest where they are', () => {
    const ws = [{ id: 'a', x: 0, y: 0, w: 12, h: 10 }, { id: 'b', x: 12, y: 0, w: 12, h: 10 }, { id: 'c', x: 0, y: 10, w: 12, h: 10 }]
    const r = fillGaps(ws, ['b'], COLS, ROWS)
    expect(r).toEqual({ b: { x: 12, y: 0, w: 12, h: 20 } })
    expect(boardProblems(apply(ws, r), COLS, ROWS, minOf)).toEqual([])
    expect(fillGaps(ws, ['a'], COLS, ROWS)).toEqual({})          // boxed in: nothing to grow into
  })
  it('tileWidgets: grid / columns / rows cover the area evenly with no overlap; others inside the area → null', () => {
    const ws = [{ id: 'a', x: 0, y: 0, w: 6, h: 6 }, { id: 'b', x: 8, y: 0, w: 6, h: 6 }, { id: 'c', x: 0, y: 8, w: 6, h: 6 }]
    for (const pattern of ['grid', 'columns', 'rows']) {
      const r = tileWidgets(ws, ['a', 'b', 'c'], pattern, COLS, ROWS)
      const out = apply(ws, r)
      expect(boardProblems(out, COLS, ROWS, minOf), pattern).toEqual([])
      expect(out.reduce((n, w) => n + w.w * w.h, 0), pattern).toBe(COLS * ROWS)
    }
    const blocked = [...ws, { id: 'x', x: 3, y: 3, w: 2, h: 3 }]
    expect(tileWidgets(blocked, ['a', 'b', 'c'], 'grid', COLS, ROWS)).toBe(null)
  })
})
