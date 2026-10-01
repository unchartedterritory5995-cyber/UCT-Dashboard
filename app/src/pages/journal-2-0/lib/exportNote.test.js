// exportNote.js's PNG door: before rasterizing, it sizes the canvas the
// export would need and refuses -- or steps the scale down -- rather than
// handing the member an empty file. The bug this guards: a very tall note
// asked modern-screenshot for a canvas past the browser's own ceiling and
// got back a 54-byte "PNG" with no warning (traced by lane TY3).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vitest hoists vi.mock factories above top-level declarations; only a
// `mock`-prefixed binding is guaranteed initialized by the time the factory
// runs, so the spy the factory forwards to is named that way on purpose.
const mockDomToBlob = vi.fn()
vi.mock('modern-screenshot', () => ({ domToBlob: (...args) => mockDomToBlob(...args) }))

import {
  exportNoteAsPng,
  canvasFitsSafeLimit,
  pickSafeScale,
  blobLooksLikeFailedRender,
  TOO_LONG_FOR_PNG_MESSAGE,
  MAX_CANVAS_DIM_PX,
  MAX_CANVAS_AREA_PX,
} from './exportNote'

/** A note-column stand-in with a controllable rendered size -- jsdom has no
 *  layout engine (every real element reports 0x0), so the element under
 *  test overrides getBoundingClientRect the way a real browser's layout
 *  would answer it. */
function elementOfSize(widthPx, heightPx) {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({
    width: widthPx, height: heightPx, top: 0, left: 0, right: widthPx, bottom: heightPx, x: 0, y: 0, toJSON() {},
  })
  return el
}

/** Intercepts the anchor-click download the way noteBatch.test.js's
 *  stubDownload does, so a "download" in jsdom records a name instead of
 *  attempting real navigation. */
function stubDownload() {
  const created = []
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
    created.push(this.download)
  })
  return { created, click }
}

describe('canvasFitsSafeLimit', () => {
  it('fits well under both the per-side and area caps', () => {
    expect(canvasFitsSafeLimit(1000, 1000)).toBe(true)
  })

  it('refuses a canvas past the per-side dimension cap', () => {
    expect(canvasFitsSafeLimit(MAX_CANVAS_DIM_PX + 1, 100)).toBe(false)
  })

  it('refuses a canvas past the area cap even though both sides are under the dimension cap', () => {
    const side = Math.floor(Math.sqrt(MAX_CANVAS_AREA_PX)) + 2000
    expect(side).toBeLessThan(MAX_CANVAS_DIM_PX) // proves this is the AREA check firing, not the dimension one
    expect(canvasFitsSafeLimit(side, side)).toBe(false)
  })

  it('refuses a zero or negative size -- nothing to measure is not a pass', () => {
    expect(canvasFitsSafeLimit(0, 1000)).toBe(false)
    expect(canvasFitsSafeLimit(1000, 0)).toBe(false)
  })
})

describe('pickSafeScale', () => {
  it('picks scale 2 for an ordinary note', () => {
    expect(pickSafeScale(800, 2000)).toBe(2)
  })

  it('a too-tall element at scale 2 that fits at scale 1 steps down to scale 1', () => {
    // 1,732 CSS px wide (the traced note column) x 9,000 tall: 2x needs a
    // 3,464 x 18,000 canvas (height alone clears the dimension cap); 1x
    // needs 1,732 x 9,000, which fits both caps.
    expect(pickSafeScale(1732, 9000)).toBe(1)
  })

  it('an element too tall even at scale 1 returns null -- nothing renders', () => {
    // the ~1,732 x 164,000 shape TY3 traced for a 2,000-paragraph note
    expect(pickSafeScale(1732, 164000)).toBeNull()
  })

  it('does not block an unmeasurable (0x0) element -- the blob-size guard is the backstop for that case', () => {
    expect(pickSafeScale(0, 0)).toBe(2)
  })
})

describe('blobLooksLikeFailedRender', () => {
  it('flags the 54-byte signature on a non-trivial canvas', () => {
    expect(blobLooksLikeFailedRender(new Blob(['x'.repeat(54)]), 1600, 4000)).toBe(true)
  })

  it('does not flag a real screenshot-sized blob', () => {
    expect(blobLooksLikeFailedRender(new Blob(['x'.repeat(50000)]), 1600, 4000)).toBe(false)
  })

  it('exempts a near-empty canvas -- a tiny note is not a failure', () => {
    expect(blobLooksLikeFailedRender(new Blob(['x'.repeat(10)]), 40, 40)).toBe(false)
  })

  it('flags a missing or zero-byte blob regardless of canvas size', () => {
    expect(blobLooksLikeFailedRender(null, 1600, 4000)).toBe(true)
    expect(blobLooksLikeFailedRender(new Blob([]), 1600, 4000)).toBe(true)
  })
})

describe('exportNoteAsPng', () => {
  beforeEach(() => {
    mockDomToBlob.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('a normal note is unchanged: renders at scale 2 and downloads', async () => {
    mockDomToBlob.mockResolvedValue(new Blob(['x'.repeat(50000)]))
    const { created, click } = stubDownload()
    const el = elementOfSize(800, 2000)

    const result = await exportNoteAsPng(el, 'My Plan')

    expect(result).toEqual({ ok: true })
    expect(mockDomToBlob).toHaveBeenCalledTimes(1)
    expect(mockDomToBlob.mock.calls[0][1].scale).toBe(2)
    expect(created).toEqual(['My Plan.png'])
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('a too-tall element at scale 2 that fits at scale 1 exports at scale 1', async () => {
    mockDomToBlob.mockResolvedValue(new Blob(['x'.repeat(50000)]))
    const { created } = stubDownload()
    const el = elementOfSize(1732, 9000)

    const result = await exportNoteAsPng(el, 'Long Note')

    expect(result).toEqual({ ok: true })
    expect(mockDomToBlob).toHaveBeenCalledTimes(1)
    expect(mockDomToBlob.mock.calls[0][1].scale).toBe(1) // the scale actually handed to the renderer
    expect(created).toEqual(['Long Note.png'])
  })

  it('an element too tall even at scale 1 downloads nothing and returns the member-facing message', async () => {
    const { created, click } = stubDownload()
    const el = elementOfSize(1732, 164000) // the traced 2,000-paragraph note

    const result = await exportNoteAsPng(el, 'Huge Note')

    expect(result).toEqual({ ok: false, reason: TOO_LONG_FOR_PNG_MESSAGE })
    expect(mockDomToBlob).not.toHaveBeenCalled() // never asks the browser to allocate a canvas known to be past the ceiling
    expect(click).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })

  it('a tiny-blob result (the 54-byte case) is treated as a failure even though the size pre-check passed', async () => {
    mockDomToBlob.mockResolvedValue(new Blob(['x'.repeat(54)]))
    const { created, click } = stubDownload()
    const el = elementOfSize(800, 2000) // comfortably under the size limit, so the pre-check lets this through

    const result = await exportNoteAsPng(el, 'Plan')

    expect(result).toEqual({ ok: false, reason: TOO_LONG_FOR_PNG_MESSAGE })
    expect(click).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })

  it('no element: refuses without ever calling the renderer', async () => {
    const result = await exportNoteAsPng(null, 'x')
    expect(result).toEqual({ ok: false })
    expect(mockDomToBlob).not.toHaveBeenCalled()
  })
})
