// @vitest-environment jsdom
// Phase 0 tests for the TRACINGS layer on drawingsStore — the data model behind
// the future "Tracings" feature (named, transparent overlay sheets that span every
// ticker). Phase 0's contract: a single implicit default tracing owns all existing
// drawings, existing drawings never move or change, reads never persist a new key,
// and the safe meta CRUD (create/rename/recolor/reorder/visibility) works and
// persists. Switching + delete + multi-sheet render are Phase 1 and NOT tested here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as drawingsStore from './drawingsStore'

const {
  tracingLabel, listTracings, getActiveTracingId, getVisibleTracingIds,
  getTracingsSnapshot, subscribeTracings,
  createTracing, renameTracing, recolorTracing, reorderTracings, setTracingVisible,
  setActiveTracing, deleteTracing, peekTracingDrawings,
  exportTracings, importTracings, subscribeAnyChange, hasLocalTracingContent,
  peekDrawings, addDrawing, subscribe, getSnapshot,
} = drawingsStore

const DRAWINGS_KEY = 'uct-chart-drawings'
const TRACINGS_KEY = 'uct-chart-tracings'
const hz = (price) => ({ type: 'horizontal', points: [{ price }] })

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tracings — migration + zero data loss', () => {
  it('a store with pre-existing drawings reports ONE default tracing that owns them', () => {
    // A member's saved drawings from before this feature existed.
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify({ NVDA: [{ id: 'd1', ...hz(100) }] }))

    const tracings = listTracings()
    expect(tracings).toHaveLength(1)
    expect(tracings[0].id).toBe('default')
    expect(tracings[0].name).toBe('')              // no baked-in name
    expect(tracingLabel(tracings[0])).toBe('Board 1')
    expect(getActiveTracingId()).toBe('default')
    expect(getVisibleTracingIds()).toEqual(['default'])

    // The drawings are untouched and belong to (are visible under) the active sheet.
    expect(peekDrawings('NVDA')).toHaveLength(1)
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(100)
    // The original drawings blob is byte-for-byte unchanged — nothing migrated it.
    expect(JSON.parse(localStorage.getItem(DRAWINGS_KEY))).toEqual({ NVDA: [{ id: 'd1', ...hz(100) }] })
  })

  it('READS never persist a tracings doc (a draw-only member writes no new key)', () => {
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify({ SPY: [{ id: 'x', ...hz(1) }] }))
    // Pure reads across the whole read API…
    getActiveTracingId(); listTracings(); getVisibleTracingIds(); getTracingsSnapshot()
    expect(localStorage.getItem(TRACINGS_KEY)).toBeNull()
  })

  it('the DRAWING path does not materialize the tracings doc', () => {
    subscribe('SPY', () => {})
    addDrawing('SPY', hz(1))
    addDrawing('SPY', hz(2))
    expect(JSON.parse(localStorage.getItem(DRAWINGS_KEY)).SPY).toHaveLength(2)
    expect(localStorage.getItem(TRACINGS_KEY)).toBeNull()   // still no tracings key
  })

  it('an empty store reports the default tracing with no drawings anywhere', () => {
    expect(getActiveTracingId()).toBe('default')
    expect(listTracings()).toHaveLength(1)
    expect(peekDrawings('AAPL')).toEqual([])
    expect(localStorage.getItem(TRACINGS_KEY)).toBeNull()
  })
})

describe('tracings — tracingLabel (single display-name authority)', () => {
  it('falls back to a numbered placeholder by order when unnamed', () => {
    expect(tracingLabel({ id: 'a', name: '', order: 0 })).toBe('Board 1')
    expect(tracingLabel({ id: 'b', name: '   ', order: 2 })).toBe('Board 3')
    expect(tracingLabel({ id: 'c', order: 4 })).toBe('Board 5')
    expect(tracingLabel(null)).toBe('Board 1')
  })
  it('uses the trimmed user name when set', () => {
    expect(tracingLabel({ id: 'a', name: '  Levels  ', order: 0 })).toBe('Levels')
  })
})

describe('tracings — createTracing', () => {
  it('adds a new sheet with the next order, a palette color, and an empty name; persists', () => {
    const id = createTracing()
    expect(typeof id).toBe('string')
    const tracings = listTracings()
    expect(tracings).toHaveLength(2)
    const created = tracings.find((t) => t.id === id)
    expect(created.name).toBe('')                 // no default name
    expect(created.order).toBe(1)
    expect(tracingLabel(created)).toBe('Board 2')
    expect(created.color).toBeTruthy()
    // Active + existing drawings are untouched by creating a sheet.
    expect(getActiveTracingId()).toBe('default')
    // The mutation MATERIALIZED the doc on disk.
    expect(localStorage.getItem(TRACINGS_KEY)).not.toBeNull()
  })

  it('honors an explicit name and color', () => {
    const id = createTracing({ name: '  Key Levels  ', color: '#123456' })
    const t = listTracings().find((x) => x.id === id)
    expect(t.name).toBe('Key Levels')
    expect(t.color).toBe('#123456')
  })

  it('persists across an in-memory reset (reads back from localStorage)', () => {
    createTracing()
    drawingsStore._reset()                          // drop in-memory snapshot; disk persists
    expect(listTracings()).toHaveLength(2)
  })

  it('does not disturb existing drawings', () => {
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify({ NVDA: [{ id: 'd1', ...hz(100) }] }))
    createTracing()
    expect(peekDrawings('NVDA')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(DRAWINGS_KEY)).NVDA).toHaveLength(1)
  })
})

describe('tracings — rename / recolor', () => {
  it('renameTracing updates the name and thus the label', () => {
    renameTracing('default', 'My Sheet')
    expect(tracingLabel(listTracings()[0])).toBe('My Sheet')
  })
  it('renameTracing on an unknown id is a no-op', () => {
    renameTracing('nope', 'x')
    expect(listTracings()).toHaveLength(1)
    expect(listTracings()[0].name).toBe('')
  })
  it('recolorTracing updates the color; rejects empty/non-string; ignores unknown id', () => {
    recolorTracing('default', '#abcdef')
    expect(listTracings()[0].color).toBe('#abcdef')
    recolorTracing('default', '')
    expect(listTracings()[0].color).toBe('#abcdef')  // unchanged
    recolorTracing('missing', '#000000')
    expect(listTracings()[0].color).toBe('#abcdef')  // unchanged
  })
})

describe('tracings — reorder', () => {
  it('reorders sheets and renumbers order (placeholder labels follow position)', () => {
    const a = createTracing()   // order 1
    const b = createTracing()   // order 2
    reorderTracings([a, b, 'default'])
    const t = listTracings()
    expect(t.map((x) => x.id)).toEqual([a, b, 'default'])
    expect(t.map((x) => x.order)).toEqual([0, 1, 2])
    // 'default' is unnamed → its placeholder now reflects its new position.
    expect(tracingLabel(t[2])).toBe('Board 3')
  })
  it('appends any tracing omitted from the ordered list, keeping relative order', () => {
    const a = createTracing()
    const b = createTracing()
    reorderTracings([b])                 // omit 'default' and a
    const ids = listTracings().map((x) => x.id)
    expect(ids[0]).toBe(b)
    expect(ids).toContain('default')
    expect(ids).toContain(a)
    expect(ids).toHaveLength(3)
  })
})

describe('tracings — visibility', () => {
  it('toggles visibility while keeping the active sheet visible and order preserved', () => {
    const a = createTracing()
    setTracingVisible(a, true)
    expect(getVisibleTracingIds()).toEqual(['default', a])   // tracing order preserved
    setTracingVisible(a, false)
    expect(getVisibleTracingIds()).toEqual(['default'])
    setTracingVisible('default', false)                       // cannot hide the active sheet
    expect(getVisibleTracingIds()).toEqual(['default'])
  })
  it('unknown id is a no-op', () => {
    setTracingVisible('nope', true)
    expect(getVisibleTracingIds()).toEqual(['default'])
  })
})

describe('tracings — subscription + snapshot stability', () => {
  it('subscribers fire on meta mutation; unsubscribe stops delivery', () => {
    const cb = vi.fn()
    const unsub = subscribeTracings(cb)
    createTracing()
    expect(cb).toHaveBeenCalledTimes(1)
    renameTracing('default', 'x')
    expect(cb).toHaveBeenCalledTimes(2)
    unsub()
    createTracing()
    expect(cb).toHaveBeenCalledTimes(2)   // no more deliveries
  })

  it('snapshot is stable between changes and replaced on change', () => {
    const s1 = getTracingsSnapshot()
    expect(getTracingsSnapshot()).toBe(s1)
    createTracing()
    const s2 = getTracingsSnapshot()
    expect(s2).not.toBe(s1)
    expect(getTracingsSnapshot()).toBe(s2)
  })
})

describe('tracings — doc self-repair', () => {
  it('repairs an activeId that is not among the tracings', () => {
    localStorage.setItem(TRACINGS_KEY, JSON.stringify({
      v: 1,
      tracings: [{ id: 'real', name: '', color: '#c9a84c', order: 0 }],
      activeId: 'ghost',
      visibleIds: ['ghost'],
      archive: {},
    }))
    expect(getActiveTracingId()).toBe('real')
    expect(getVisibleTracingIds()).toEqual(['real'])
  })

  it('falls back to the virtual default for a malformed doc', () => {
    localStorage.setItem(TRACINGS_KEY, 'not json{')
    expect(getActiveTracingId()).toBe('default')
    expect(listTracings()).toHaveLength(1)
  })

  it('treats an empty tracings array as no doc (virtual default)', () => {
    localStorage.setItem(TRACINGS_KEY, JSON.stringify({ v: 1, tracings: [], activeId: 'x' }))
    expect(getActiveTracingId()).toBe('default')
  })
})

describe('tracings — active switch holds independent drawings per sheet', () => {
  it('the SAME ticker carries different drawings on different sheets (the core behavior)', () => {
    addDrawing('NVDA', hz(100))                  // draw on the default (active) sheet A
    const b = createTracing()
    setActiveTracing(b)
    expect(peekDrawings('NVDA')).toEqual([])     // sheet B has no NVDA marks
    addDrawing('NVDA', hz(200))                  // draw on B
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(200)
    setActiveTracing('default')                  // back to A
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(100)  // A untouched by B
    setActiveTracing(b)
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(200)  // B untouched by A
  })

  it('switching invalidates mounted entries: subscribers notified, snapshot + history reset', () => {
    const cb = vi.fn()
    subscribe('SPY', cb)
    addDrawing('SPY', hz(1))
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    cb.mockClear()
    const b = createTracing()
    setActiveTracing(b)
    expect(cb).toHaveBeenCalled()                        // the mounted chart is told to repaint
    expect(getSnapshot('SPY').drawings).toEqual([])      // new sheet is empty for SPY
    expect(getSnapshot('SPY').canUndo).toBe(false)       // per-sym history dropped on switch
    setActiveTracing('default')
    expect(getSnapshot('SPY').drawings).toHaveLength(1)  // original sheet restored
  })

  it('setActiveTracing is a no-op for the current id and for an unknown id', () => {
    addDrawing('SPY', hz(1))
    setActiveTracing('default')                  // already active
    expect(peekDrawings('SPY')).toHaveLength(1)
    setActiveTracing('ghost')                    // unknown
    expect(getActiveTracingId()).toBe('default')
    expect(peekDrawings('SPY')).toHaveLength(1)
  })

  it('a switch persists: the outgoing sheet survives in the archive across a reset', () => {
    addDrawing('NVDA', hz(100))
    const b = createTracing()
    setActiveTracing(b)
    addDrawing('NVDA', hz(200))
    drawingsStore._reset()                       // drop in-memory; disk persists
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(200)          // active slot (B)
    expect(peekTracingDrawings('default', 'NVDA')[0].points[0].price).toBe(100)  // archived A
    expect(getActiveTracingId()).toBe(b)
  })
})

describe('tracings — delete', () => {
  it('deleting a NON-active sheet removes it + its data, leaving the active sheet intact', () => {
    addDrawing('NVDA', hz(100))                  // A (active)
    const b = createTracing()
    setActiveTracing(b)
    addDrawing('NVDA', hz(200))                  // B
    setActiveTracing('default')                  // A active again
    deleteTracing(b)
    expect(listTracings().map((t) => t.id)).toEqual(['default'])
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(100)   // A intact
    expect(peekTracingDrawings(b, 'NVDA')).toEqual([])          // B gone
  })

  it('deleting the ACTIVE sheet discards its drawings and promotes a fallback', () => {
    addDrawing('NVDA', hz(100))                  // A
    const b = createTracing()
    setActiveTracing(b)
    addDrawing('NVDA', hz(200))                  // B (active)
    deleteTracing(b)
    expect(getActiveTracingId()).toBe('default')
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(100)   // A promoted into the active slot
  })

  it('refuses to delete the last remaining sheet', () => {
    deleteTracing('default')
    expect(listTracings()).toHaveLength(1)
    expect(getActiveTracingId()).toBe('default')
  })

  it('deleting the active sheet notifies mounted charts to repaint on the fallback', () => {
    const cb = vi.fn()
    subscribe('SPY', cb)
    const b = createTracing()
    setActiveTracing(b)
    addDrawing('SPY', hz(9))
    expect(getSnapshot('SPY').drawings).toHaveLength(1)
    cb.mockClear()
    deleteTracing(b)
    expect(cb).toHaveBeenCalled()
    expect(getSnapshot('SPY').drawings).toEqual([])   // fallback (default) is empty for SPY
  })
})

describe('tracings — peekTracingDrawings', () => {
  it('reads the active sheet from the active slot and other sheets from the archive', () => {
    addDrawing('NVDA', hz(1))                    // active default
    const b = createTracing()
    expect(peekTracingDrawings('default', 'NVDA')[0].points[0].price).toBe(1)
    expect(peekTracingDrawings(b, 'NVDA')).toEqual([])          // b empty
    setActiveTracing(b)
    addDrawing('NVDA', hz(2))
    expect(peekTracingDrawings(b, 'NVDA')[0].points[0].price).toBe(2)        // b now active
    expect(peekTracingDrawings('default', 'NVDA')[0].points[0].price).toBe(1) // default now archived
  })

  it('returns a deep copy and empty for unknown sheet/sym', () => {
    addDrawing('NVDA', hz(7))
    const out = peekTracingDrawings('default', 'NVDA')
    out[0].points[0].price = 999
    expect(peekTracingDrawings('default', 'NVDA')[0].points[0].price).toBe(7)
    expect(peekTracingDrawings('nope', 'NVDA')).toEqual([])
    expect(peekTracingDrawings('default', '')).toEqual([])
  })
})

describe('tracings — sync surface (export/import/change signal)', () => {
  it('exportTracings → importTracings round-trips the full multi-sheet state', () => {
    addDrawing('NVDA', hz(100))          // sheet A
    const b = createTracing()
    renameTracing(b, 'Bravo')
    setActiveTracing(b)
    addDrawing('NVDA', hz(200))          // sheet B
    addDrawing('SPY', hz(5))             // sheet B
    const blob = exportTracings()

    drawingsStore._reset()
    localStorage.clear()
    importTracings(blob)

    // sheets restored, active preserved, per-sheet drawings intact
    expect(drawingsStore.getActiveTracingId()).toBe(b)
    expect(drawingsStore.listTracings().find((t) => t.id === b).name).toBe('Bravo')
    expect(peekDrawings('NVDA')[0].points[0].price).toBe(200)               // active (B)
    expect(peekTracingDrawings('default', 'NVDA')[0].points[0].price).toBe(100)  // archived A
    expect(peekTracingDrawings(b, 'SPY')[0].points[0].price).toBe(5)
  })

  it('importTracings does NOT fire the change signal (a sync-IN never echoes a push)', () => {
    const cb = vi.fn()
    subscribeAnyChange(cb)
    const blob = { v: 1, tracings: [{ id: 'x', name: '', color: '#c9a84c', order: 0 }], activeId: 'x', visibleIds: ['x'], byTracing: { x: { NVDA: [{ id: 'd', ...hz(1) }] } } }
    importTracings(blob)
    expect(cb).not.toHaveBeenCalled()
    expect(peekDrawings('NVDA')).toHaveLength(1)   // but it DID apply
  })

  it('subscribeAnyChange fires on a drawing add and on a sheet mutation', () => {
    const cb = vi.fn()
    const unsub = subscribeAnyChange(cb)
    addDrawing('NVDA', hz(1))
    expect(cb).toHaveBeenCalledTimes(1)
    createTracing()
    expect(cb).toHaveBeenCalledTimes(2)
    unsub()
    addDrawing('NVDA', hz(2))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('importTracings replaces existing local state wholesale', () => {
    addDrawing('NVDA', hz(999))          // local content
    importTracings({ v: 1, tracings: [{ id: 'y', name: 'Only', color: '#fff', order: 0 }], activeId: 'y', visibleIds: ['y'], byTracing: { y: {} } })
    expect(drawingsStore.listTracings().map((t) => t.id)).toEqual(['y'])
    expect(peekDrawings('NVDA')).toEqual([])   // prior local drawings gone
  })

  it('importTracings no-ops on a malformed blob', () => {
    addDrawing('NVDA', hz(1))
    importTracings(null)
    importTracings({ tracings: [] })
    importTracings({ tracings: [{ id: 'z' }] })   // no byTracing
    expect(peekDrawings('NVDA')).toHaveLength(1)  // untouched
  })

  it('hasLocalTracingContent reflects real content', () => {
    expect(hasLocalTracingContent()).toBe(false)
    addDrawing('NVDA', hz(1))
    expect(hasLocalTracingContent()).toBe(true)
  })

  it('hasLocalTracingContent is true when there is more than one sheet even with no drawings', () => {
    expect(hasLocalTracingContent()).toBe(false)
    createTracing()
    expect(hasLocalTracingContent()).toBe(true)
  })
})
