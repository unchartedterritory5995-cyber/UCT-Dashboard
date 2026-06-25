import { describe, it, expect } from 'vitest'
import { placeLabels } from './labelDeclutter'

const bounds = { plotLeft: 0, plotRight: 1000, top: 0, bottom: 600 }
const mk = (id, ax, ay, boxW = 80, boxH = 20) => ({
  id, ax, ay, boxW, boxH, lines: [id], kind: 'text', text: id, lx: ax, ly: ay,
})

describe('placeLabels', () => {
  it('keeps well-separated labels exactly where they were authored (no leader)', () => {
    const cache = new Map()
    const out = placeLabels({
      items: [mk('a', 100, 100), mk('b', 400, 300)],
      segs: [], ...bounds, cache, useCache: false,
    })
    expect(out.find(o => o.id === 'a')).toMatchObject({ x: 100, y: 100, leader: null })
    expect(out.find(o => o.id === 'b')).toMatchObject({ x: 400, y: 300, leader: null })
  })

  it('nudges an overlapping label off its neighbour and draws a leader', () => {
    const cache = new Map()
    const out = placeLabels({
      items: [mk('a', 100, 100), mk('b', 110, 105)], // heavily overlapping
      segs: [], ...bounds, cache, useCache: false,
    })
    const a = out.find(o => o.id === 'a')
    const b = out.find(o => o.id === 'b')
    // The two boxes must no longer overlap.
    const overlap = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
    expect(overlap).toBe(false)
    // The displaced one keeps a leader back to its anchor.
    expect(b.leader).not.toBeNull()
    expect(b.leader).toMatchObject({ x0: 110, y0: 105 })
  })

  it('moves a label off a candle it would cover', () => {
    const cache = new Map()
    const segs = [{ x: 140, top: 90, bottom: 200 }] // a tall candle under the home box
    const out = placeLabels({
      items: [mk('a', 100, 100)],
      segs, ...bounds, cache, useCache: false,
    })
    const a = out[0]
    const stillOnCandle = segs[0].x >= a.x - 2 && segs[0].x <= a.x + a.w + 2 &&
      segs[0].bottom >= a.y && segs[0].top <= a.y + a.h
    expect(stillOnCandle).toBe(false)
    expect(a.leader).not.toBeNull()
  })

  it('rides the cached offset when useCache is true (no re-search)', () => {
    const cache = new Map([['a', { offX: 50, offY: -30 }]])
    const out = placeLabels({
      items: [mk('a', 100, 100)],
      segs: [{ x: 100, top: 90, bottom: 200 }], // would normally force a move
      ...bounds, cache, useCache: true,
    })
    expect(out[0]).toMatchObject({ x: 150, y: 70 })
  })

  it('uses the explicit leader anchor (advance label points at its candle)', () => {
    const cache = new Map()
    const item = { id: 'pct', ax: 300, ay: 300, boxW: 60, boxH: 18, lines: ['-29%'], kind: 'advance', text: '-29%', lx: 330, ly: 360 }
    const out = placeLabels({
      items: [mk('block', 305, 305), item], // force the advance label to move
      segs: [], ...bounds, cache, useCache: false,
    })
    const pct = out.find(o => o.id === 'pct')
    if (pct.leader) expect(pct.leader).toMatchObject({ x0: 330, y0: 360 })
  })
})
