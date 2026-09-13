// @vitest-environment jsdom
/* Normalisation inside the store — the four promises Phase 0 made about it.
 *
 * `drawingSchema.test.js` proves the FUNCTION is safe. This file proves the
 * WIRING is: that hooking it into the store's read boundaries did not turn a
 * page load into a write, a sync push, or an alert resync.
 *
 * ⛔ THE FAILURE MODES ARE ALL SILENT, WHICH IS WHY THEY ARE TESTED AND NOT
 * REASONED ABOUT:
 *   • a write on load rewrites every user's drawing library on refresh;
 *   • a `_changeSeq` bump makes `useTracingsSync` push that library to the
 *     server, for every user, on first load — LWW at whole-document level, so a
 *     device with a stale copy could overwrite a good one;
 *   • a changed `geometrySignature` PATCHes every bound drawing alert.
 * None of the three is visible on the chart. All three would be discovered by a
 * user, later, as data loss.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as store from './drawingsStore'
import { SCHEMA_VERSION } from './drawingSchema'
import { anchorsForDrawing, geometrySignature } from './drawingAlertAnchors'

const STORE_KEY = 'uct-chart-drawings'

// A v1 library exactly as a pre-Phase-0 client wrote it: no `sv` anywhere.
const legacyLibrary = () => ({
  SPY: [
    { id: 'a', type: 'trendline', points: [{ time: '2026-01-02', price: 100 }, { time: '2026-02-02', price: 120 }], color: '#c9a84c', lineWidth: 1 },
    { id: 'b', type: 'horizontal', points: [{ price: 55.25 }], color: '#1ae51a' },
  ],
  QQQ: [
    { id: 'c', type: 'rect', points: [{ time: '2026-01-02', price: 90 }, { time: '2026-02-02', price: 110 }] },
  ],
})

const raw = () => JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
const seed = (lib) => localStorage.setItem(STORE_KEY, JSON.stringify(lib))

beforeEach(() => {
  localStorage.clear()
  store._reset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalisation happens on READ', () => {
  it('a subscribed symbol’s snapshot carries sv, from a library that has none', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    const drawings = store.getSnapshot('SPY').drawings
    expect(drawings).toHaveLength(2)
    expect(drawings.every((d) => d.sv === SCHEMA_VERSION)).toBe(true)
  })

  it('peekDrawings normalises too, so a journal embed sees the same shape', () => {
    seed(legacyLibrary())
    expect(store.peekDrawings('QQQ')[0].sv).toBe(SCHEMA_VERSION)
  })

  it('leaves every other field exactly as stored', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    const [d] = store.getSnapshot('SPY').drawings
    const { sv, ...rest } = d
    expect(sv).toBe(SCHEMA_VERSION)
    expect(rest).toEqual(legacyLibrary().SPY[0])
  })
})

describe('⛔ PROMISE 1 — reading never writes', () => {
  it('subscribing does not touch localStorage at all', () => {
    seed(legacyLibrary())
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.subscribe('SPY', () => {})
    store.getSnapshot('SPY')
    store.getSnapshot('SPY')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('the stored bytes are IDENTICAL after a load', () => {
    seed(legacyLibrary())
    const before = localStorage.getItem(STORE_KEY)
    store.subscribe('SPY', () => {})
    store.subscribe('QQQ', () => {})
    store.getSnapshot('SPY'); store.getSnapshot('QQQ')
    expect(localStorage.getItem(STORE_KEY)).toBe(before)
    expect(raw().SPY[0].sv).toBeUndefined()   // still v1 on disk
  })

  it('peekDrawings does not write either', () => {
    seed(legacyLibrary())
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.peekDrawings('SPY')
    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('⛔ PROMISE 2 — sv reaches disk only via a real edit', () => {
  it('an unrelated symbol’s drawings are untouched by an edit elsewhere', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.addDrawing('SPY', { type: 'horizontal', points: [{ price: 1 }] })
    expect(raw().QQQ[0].sv).toBeUndefined()   // QQQ never loaded, never rewritten
  })

  it('editing a symbol persists sv for that symbol’s drawings', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.updateDrawing('SPY', 'b', { color: '#60a5fa' })
    const spy = raw().SPY
    expect(spy.every((d) => d.sv === SCHEMA_VERSION)).toBe(true)
    expect(spy.find((d) => d.id === 'b').color).toBe('#60a5fa')
  })

  it('a NEW drawing is born current', () => {
    store.subscribe('SPY', () => {})
    const id = store.addDrawing('SPY', { type: 'rect', points: [{ price: 1 }, { price: 2 }] })
    expect(raw().SPY.find((d) => d.id === id).sv).toBe(SCHEMA_VERSION)
  })

  it('adds nothing but sv — no speculative defaults reach the disk', () => {
    // ⛔ The bloat guard. Materialising ~15 forward-looking keys onto every
    // drawing would grow the stored library, and that library is what the
    // tracings sync layer uploads.
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.updateDrawing('SPY', 'b', { color: '#60a5fa' })
    const stored = raw().SPY.find((d) => d.id === 'a')
    expect(Object.keys(stored).sort()).toEqual(
      [...Object.keys(legacyLibrary().SPY[0]), 'sv'].sort(),
    )
  })
})

describe('⛔ PROMISE 3 — no sync push, no alert resync', () => {
  it('loading does not bump the tracings change counter', () => {
    // `useTracingsSync` debounces a full-document push on this counter. A bump
    // here means every user uploads their whole drawing library on first load.
    seed(legacyLibrary())
    const before = store.getChangeSeq()
    const seen = []
    const off = store.subscribeAnyChange(() => seen.push(1))
    store.subscribe('SPY', () => {})
    store.getSnapshot('SPY')
    store.peekDrawings('QQQ')
    expect(store.getChangeSeq()).toBe(before)
    expect(seen).toHaveLength(0)
    off()
  })

  it('⭐ every loaded drawing’s alert geometry signature is unchanged', () => {
    // The exact string `useBoundDrawingAlerts` diffs before it PATCHes.
    seed(legacyLibrary())
    const opts = { bars: [{ t: '2026-03-01' }], tf: 'D', etOffset: 0 }
    const sig = (d) => geometrySignature(anchorsForDrawing(d, opts))
    const before = legacyLibrary().SPY.map(sig)
    store.subscribe('SPY', () => {})
    expect(store.getSnapshot('SPY').drawings.map(sig)).toEqual(before)
    expect(before.filter(Boolean).length).toBeGreaterThan(0)   // guard the guard
  })

  it('the points arrays survive load by REFERENCE-EQUAL content', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    const loaded = store.getSnapshot('SPY').drawings
    expect(JSON.stringify(loaded.map((d) => d.points)))
      .toBe(JSON.stringify(legacyLibrary().SPY.map((d) => d.points)))
  })
})

describe('⛔ PROMISE 4 — undo/redo still work across the funnel', () => {
  it('undo restores the pre-edit state, sv and all', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.updateDrawing('SPY', 'b', { color: '#ff5b5b' })
    expect(store.getSnapshot('SPY').drawings.find((d) => d.id === 'b').color).toBe('#ff5b5b')
    store.undo('SPY')
    const back = store.getSnapshot('SPY').drawings.find((d) => d.id === 'b')
    expect(back.color).toBe('#1ae51a')
    expect(back.sv).toBe(SCHEMA_VERSION)
  })

  it('redo comes back correctly', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.updateDrawing('SPY', 'b', { color: '#ff5b5b' })
    store.undo('SPY')
    store.redo('SPY')
    expect(store.getSnapshot('SPY').drawings.find((d) => d.id === 'b').color).toBe('#ff5b5b')
  })

  it('a deleted drawing comes back with its geometry intact', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    store.removeDrawing('SPY', 'a')
    store.undo('SPY')
    const restored = store.getSnapshot('SPY').drawings.find((d) => d.id === 'a')
    expect(restored.points).toEqual(legacyLibrary().SPY[0].points)
  })
})

describe('the Tracings surfaces normalise too', () => {
  it('a sheet promoted to active arrives normalised', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    const id = store.createTracing({ name: 'Second' })
    store.setActiveTracing(id)                 // archives SPY's v1 sheet
    store.setActiveTracing(store.listTracings()[0].id)   // and brings it back
    expect(store.getSnapshot('SPY').drawings.every((d) => d.sv === SCHEMA_VERSION)).toBe(true)
  })

  it('peekTracingDrawings (the multi-sheet ghost render) normalises', () => {
    seed(legacyLibrary())
    store.subscribe('SPY', () => {})
    const active = store.getActiveTracingId()
    const ghosts = store.peekTracingDrawings(active, 'SPY')
    expect(ghosts).toHaveLength(2)
    expect(ghosts.every((d) => d.sv === SCHEMA_VERSION)).toBe(true)
  })

  it('a server document adopted by importTracings is not rewritten on disk', () => {
    // The sync layer's blob is the server's copy. Reading it must not mutate it.
    const blob = {
      v: 1,
      tracings: [{ id: 't1', name: 'Cloud', color: '#c9a84c', order: 0 }],
      activeId: 't1',
      visibleIds: ['t1'],
      byTracing: { t1: legacyLibrary() },
    }
    store.importTracings(blob)
    expect(raw().SPY[0].sv).toBeUndefined()          // disk stays v1
    store.subscribe('SPY', () => {})
    expect(store.getSnapshot('SPY').drawings[0].sv).toBe(SCHEMA_VERSION)   // memory is current
  })
})

describe('a Model Book / legacy drawing keeps every field the overlay reads', () => {
  it('carries advance, measure, text and callout extras through untouched', () => {
    const exotic = {
      MB: [
        { id: 'm1', type: 'advance', points: [{ time: '2026-01-02', price: 1 }], advPct: 308, advHigh: 9, advLow: 2, labelColor: '#ff5b5b', rightBoundTime: '2026-02-02' },
        { id: 'm2', type: 'measure', points: [{ price: 1 }, { price: 2 }], barCount: 25 },
        { id: 'm3', type: 'text', points: [{ price: 1 }], text: 'a\nb', fontSize: 20, boxWidth: 240, calloutId: 'c1', calloutRole: 'label', calloutAnchorTime: '2026-01-02' },
        { id: 'm4', type: 'trendline', points: [{ price: 1 }, { price: 2 }], locked: true, hidden: true },
      ],
    }
    seed(exotic)
    store.subscribe('MB', () => {})
    store.getSnapshot('MB').drawings.forEach((d, i) => {
      const { sv, ...rest } = d
      expect(sv).toBe(SCHEMA_VERSION)
      expect(rest).toEqual(exotic.MB[i])
    })
  })
})
