/* THE PLACEHOLDER THAT IS A PICTURE — and the ceiling on what it costs.
 *
 * ⛔ A snapshot store is a memory feature pretending to be a cosmetic one. It
 * exists so a bounded feed reads as continuous, and it would defeat its own
 * purpose the moment it held forty full-resolution data URLs — the heap the
 * window just saved, spent again on base64. Both halves are pinned here: the
 * capture degrades to nothing rather than throwing, and the store has a hard cap.
 */
import { describe, it, expect, vi } from 'vitest'
import { captureSnapshot, makeSnapshotStore, SNAP_KEEP, SNAP_MAX_W } from './feedSnapshot'

/** A canvas that reports a size and can be told whether it has a 2D context. */
function fakeCanvas(width, height, { ctx = true, url = 'data:image/webp;base64,AAA' } = {}) {
  const el = document.createElement('canvas')
  Object.defineProperty(el, 'width', { value: width, writable: true })
  Object.defineProperty(el, 'height', { value: height, writable: true })
  el.getContext = () => (ctx ? { drawImage: vi.fn() } : null)
  el.toDataURL = () => url
  return el
}

/** A card body holding the given canvases. */
function host(...canvases) {
  const el = document.createElement('div')
  for (const c of canvases) el.appendChild(c)
  return el
}

describe('capturing the last painted frame', () => {
  it('⭐ takes the BIGGEST canvas — the price area, not an axis strip', () => {
    // lightweight-charts renders several canvases per pane. Taking the first
    // would sometimes store a 40px-wide axis and call it a chart.
    //
    // ⚠️ THE ASSERTION IS ON WHAT WAS DRAWN, not on the returned URL: the URL
    // comes from the OUTPUT canvas, which is the same object whichever source
    // was copied — so a returned-value check could not tell the two apart
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    const axis = fakeCanvas(40, 300)
    const price = fakeCanvas(720, 300)
    const drawn = []
    const realCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'canvas') {
        el.getContext = () => ({ drawImage: (src) => drawn.push(src) })
        el.toDataURL = () => 'data:x'
      }
      return el
    })
    // Deliberately appended AFTER the axis, so "first" would be the wrong one.
    const url = captureSnapshot(host(axis, price))
    spy.mockRestore()
    expect(url).toBe('data:x')
    expect(drawn).toEqual([price])
  })

  it('⛔ DOWNSCALES — the stored frame is bounded, not a full-resolution copy', () => {
    const src = fakeCanvas(1280, 400)
    let out = null
    const realCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'canvas' && !out) { out = el; el.getContext = () => ({ drawImage: vi.fn() }); el.toDataURL = () => 'data:x' }
      return el
    })
    captureSnapshot(host(src))
    spy.mockRestore()
    expect(out.width).toBe(SNAP_MAX_W)
    expect(out.height).toBe(Math.round(400 * (SNAP_MAX_W / 1280)))
  })

  it('⛔ NO CONTEXT MEANS NO SNAPSHOT, never a throw', () => {
    // jsdom without the canvas package lands here, and so does any browser that
    // refuses the context. A placeholder is never load-bearing.
    const realCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'canvas') el.getContext = () => null
      return el
    })
    expect(captureSnapshot(host(fakeCanvas(720, 300)))).toBeNull()
    spy.mockRestore()
  })

  it('a card that never painted, or no card at all, yields nothing', () => {
    expect(captureSnapshot(host())).toBeNull()
    expect(captureSnapshot(host(fakeCanvas(0, 0)))).toBeNull()
    expect(captureSnapshot(null)).toBeNull()
    expect(captureSnapshot({})).toBeNull()
  })
})

describe('the store is a ceiling, not a cache', () => {
  it('⛔⛔ HOLDS AT MOST `SNAP_KEEP`, dropping the oldest', () => {
    const s = makeSnapshotStore()
    for (let i = 0; i < SNAP_KEEP + 5; i += 1) s.put(`S${i}`, `url${i}`)
    expect(s.size()).toBe(SNAP_KEEP)
    expect(s.get('S0')).toBeNull()                       // evicted
    expect(s.get(`S${SNAP_KEEP + 4}`)).toBe(`url${SNAP_KEEP + 4}`)
  })

  it('re-storing a symbol refreshes its place in the queue', () => {
    const s = makeSnapshotStore(3)
    s.put('A', '1'); s.put('B', '2'); s.put('C', '3')
    s.put('A', '1b')                                     // A is newest again
    s.put('D', '4')                                      // evicts B, not A
    expect(s.get('A')).toBe('1b')
    expect(s.get('B')).toBeNull()
  })

  it('CONTROL: below the cap nothing is dropped', () => {
    // Without this the eviction case could pass against a store that keeps one.
    const s = makeSnapshotStore(3)
    s.put('A', '1'); s.put('B', '2')
    expect(s.size()).toBe(2)
    expect(s.get('A')).toBe('1')
  })

  it('a missing snapshot and an empty one are both "no frame"', () => {
    const s = makeSnapshotStore()
    s.put('A', null)
    s.put(null, 'x')
    expect(s.size()).toBe(0)
    expect(s.get('nope')).toBeNull()
  })
})
