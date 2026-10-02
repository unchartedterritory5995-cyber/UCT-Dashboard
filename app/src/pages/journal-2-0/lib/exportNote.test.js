// exportNote.js's PNG door: before rasterizing, it asks THIS browser what
// canvas size it can actually render (never a fixed, browser-agnostic
// limit -- see the file's own header comment for why a fixed number
// regresses ordinary mid-length notes on desktop Chromium) and refuses --
// or steps the scale down -- rather than handing the member an empty
// file. The bug this guards: a very tall note asked modern-screenshot for
// a canvas past the browser's own ceiling and got back a 54-byte "PNG"
// with no warning (traced by lane TY3).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vitest hoists vi.mock factories above top-level declarations; only a
// `mock`-prefixed binding is guaranteed initialized by the time the factory
// runs, so the spy the factory forwards to is named that way on purpose.
const mockDomToBlob = vi.fn()
vi.mock('modern-screenshot', () => ({ domToBlob: (...args) => mockDomToBlob(...args) }))

import {
  exportNoteAsPng,
  canvasFitsFallbackLimit,
  canvasCanRender,
  pickSafeScale,
  blobLooksLikeFailedRender,
  TOO_LONG_FOR_PNG_MESSAGE,
  HARD_MAX_CANVAS_DIM_PX,
  FALLBACK_MAX_CANVAS_DIM_PX,
  FALLBACK_MAX_CANVAS_AREA_PX,
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

// Three fixed-answer probes for driving pickSafeScale/exportNoteAsPng
// without a real canvas backend (this project's jsdom has none --
// getContext('2d') returns null, verified against the installed jsdom).
const acceptEverything = () => true
const rejectEverything = () => false
/** Accepts a canvas up to 15,000px tall, rejects anything past it -- so a
 *  note whose scale-2 canvas clears 15,000px but whose scale-1 canvas
 *  does not steps down to scale 1. */
function acceptUpTo15000Tall(_w, h) {
  return h <= 15000
}

describe('canvasFitsFallbackLimit (the deterministic answer when no real canvas backend exists)', () => {
  it('fits well under both the per-side and area caps', () => {
    expect(canvasFitsFallbackLimit(1000, 1000)).toBe(true)
  })

  it('refuses a canvas past the per-side dimension cap', () => {
    expect(canvasFitsFallbackLimit(FALLBACK_MAX_CANVAS_DIM_PX + 1, 100)).toBe(false)
  })

  it('refuses a canvas past the area cap even though both sides are under the dimension cap', () => {
    const side = Math.floor(Math.sqrt(FALLBACK_MAX_CANVAS_AREA_PX)) + 2000
    expect(side).toBeLessThan(FALLBACK_MAX_CANVAS_DIM_PX) // proves this is the AREA check firing, not the dimension one
    expect(canvasFitsFallbackLimit(side, side)).toBe(false)
  })

  it('refuses a zero or negative size -- nothing to measure is not a pass', () => {
    expect(canvasFitsFallbackLimit(0, 1000)).toBe(false)
    expect(canvasFitsFallbackLimit(1000, 0)).toBe(false)
  })
})

describe('canvasCanRender (the real per-engine probe)', () => {
  it('falls back to canvasFitsFallbackLimit in this test environment', () => {
    // Raw jsdom has NO canvas implementation (getContext('2d') -> null),
    // but THIS repo's app/src/test-setup.js installs a non-null stub 2D
    // context (fillRect/drawImage are no-ops, getImageData always returns
    // zeroed pixels) so ECharts/zrender can mount in every test file. A
    // probe that only checked for a null context would miss that stub,
    // call its no-op draw methods believing they worked, and read back an
    // always-transparent pixel -- reporting EVERY size as unrenderable.
    // canvasCanRender's self-test (draw-and-check a trivial 4x4 control
    // canvas first) catches this stub the same way it would catch a truly
    // absent context, and both land on the same deterministic fallback.
    const big = 20000 // past FALLBACK_MAX_CANVAS_DIM_PX(16384), well under HARD_MAX_CANVAS_DIM_PX(32767)
    expect(canvasCanRender(big, 100)).toBe(canvasFitsFallbackLimit(big, 100))
    expect(canvasCanRender(1000, 1000)).toBe(canvasFitsFallbackLimit(1000, 1000))
  })

  it('caches its answer per (width, height)', () => {
    // Same (w, h) twice -- the second call must not re-probe. Proven
    // indirectly: the answer is identical and deterministic across calls,
    // which is the externally-observable contract (the probe allocates
    // real canvases, so this is what protects a repeated export from
    // paying for the allocation twice).
    const a = canvasCanRender(1234, 5678)
    const b = canvasCanRender(1234, 5678)
    expect(a).toBe(b)
  })
})

describe('pickSafeScale -- no probe given (the fallback path, deterministic in this jsdom environment)', () => {
  it('picks scale 2 for an ordinary note', () => {
    expect(pickSafeScale(800, 2000)).toBe(2)
  })

  it('a too-tall element at scale 2 that fits at scale 1 steps down to scale 1', () => {
    // 1,732 CSS px wide (the traced note column) x 9,000 tall: 2x needs a
    // 3,464 x 18,000 canvas (height alone clears the fallback dimension
    // cap); 1x needs 1,732 x 9,000, which fits both fallback caps.
    expect(pickSafeScale(1732, 9000)).toBe(1)
  })

  it('an element too tall even at scale 1 returns null -- nothing renders', () => {
    // the ~1,732 x 164,000 shape TY3 traced for a 2,000-paragraph note --
    // both scales clear even HARD_MAX_CANVAS_DIM_PX, so this refuses at
    // the sanity-ceiling stage, before any probe/fallback is consulted.
    expect(pickSafeScale(1732, 164000)).toBeNull()
  })

  it('does not block an unmeasurable (0x0) element -- the blob-size guard is the backstop for that case', () => {
    expect(pickSafeScale(0, 0)).toBe(2)
  })
})

describe('pickSafeScale -- a real per-browser probe (fixed-answer probes, no canvas needed)', () => {
  it('a note of about 10,000 CSS px height with an accepting probe exports at scale 2 (the regression case)', () => {
    // 866 CSS px wide (a typical note column) x 10,000 tall -- at scale 2
    // that is 1,732 x 20,000px, which FALLBACK_MAX_CANVAS_DIM_PX (16,384)
    // would have refused outright. A browser that can actually render it
    // (the accepting probe) must get scale 2, not be downgraded to fit a
    // number picked for a different, more constrained engine.
    expect(pickSafeScale(866, 10000, acceptEverything)).toBe(2)
  })

  it('a probe that rejects scale 2 but accepts scale 1 steps down to scale 1', () => {
    // scale 2 asks the probe about (1732, 20000) -> rejected (> 15000 tall);
    // scale 1 asks about (866, 10000) -> accepted.
    expect(pickSafeScale(866, 10000, acceptUpTo15000Tall)).toBe(1)
  })

  it('a probe that rejects both scales returns null -- nothing renders', () => {
    expect(pickSafeScale(866, 10000, rejectEverything)).toBeNull()
  })

  it('the hard per-side ceiling refuses even an accepting probe, and never calls it', () => {
    // HARD_MAX_CANVAS_DIM_PX is a sanity bound checked BEFORE the probe --
    // no engine allows a canvas this large, so nothing should even ask.
    const probe = vi.fn(acceptEverything)
    const tooTall = HARD_MAX_CANVAS_DIM_PX + 1 // past the ceiling even at scale 1
    expect(pickSafeScale(100, tooTall, probe)).toBeNull()
    expect(probe).not.toHaveBeenCalled()
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

describe('exportNoteAsPng -- no probe given (the fallback path)', () => {
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

describe('exportNoteAsPng -- a real per-browser probe injected', () => {
  beforeEach(() => {
    mockDomToBlob.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('a note of about 10,000 CSS px height with an accepting probe exports at scale 2 (the regression case)', async () => {
    mockDomToBlob.mockResolvedValue(new Blob(['x'.repeat(50000)]))
    const { created } = stubDownload()
    const el = elementOfSize(866, 10000)

    const result = await exportNoteAsPng(el, 'Mid Length Note', acceptEverything)

    expect(result).toEqual({ ok: true })
    expect(mockDomToBlob.mock.calls[0][1].scale).toBe(2) // the fixed-limit version of this file would have forced scale 1
    expect(created).toEqual(['Mid Length Note.png'])
  })

  it('a probe that rejects scale 2 but accepts scale 1 renders at scale 1', async () => {
    mockDomToBlob.mockResolvedValue(new Blob(['x'.repeat(50000)]))
    const { created } = stubDownload()
    const el = elementOfSize(866, 10000)

    const result = await exportNoteAsPng(el, 'Stepped Down', acceptUpTo15000Tall)

    expect(result).toEqual({ ok: true })
    expect(mockDomToBlob.mock.calls[0][1].scale).toBe(1)
    expect(created).toEqual(['Stepped Down.png'])
  })

  it('a probe that rejects both scales downloads nothing and returns the member-facing message', async () => {
    const { created, click } = stubDownload()
    const el = elementOfSize(866, 10000)

    const result = await exportNoteAsPng(el, 'Refused', rejectEverything)

    expect(result).toEqual({ ok: false, reason: TOO_LONG_FOR_PNG_MESSAGE })
    expect(mockDomToBlob).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })
})
