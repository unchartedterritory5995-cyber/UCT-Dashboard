// @vitest-environment jsdom
/* afterPaint(fn): `fn` runs in the first slot AFTER the next frame, never inside the task that asked,
 * never more than MAX_WAIT_MS late on a visible page, and at once where no frame is coming. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { afterPaint, MAX_WAIT_MS } from './afterPaint'

let frames
const runFrames = () => { const q = frames; frames = []; for (const cb of q) if (cb) cb(0) }
const setHidden = (v) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', (id) => { frames[id - 1] = null })
  setHidden(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete document.hidden   // back to jsdom's own answer
})

describe('afterPaint', () => {
  it('does not run in the asking task, nor in the frame callback: it runs in the timer slot after the frame', () => {
    const fn = vi.fn()
    afterPaint(fn)
    expect(fn).not.toHaveBeenCalled()
    runFrames()                          // the frame's own callbacks (the chart draws here)
    expect(fn).not.toHaveBeenCalled()    // still before the paint
    vi.advanceTimersByTime(0)            // the first task after the frame
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MAX_WAIT_MS * 2)
    runFrames()
    expect(fn).toHaveBeenCalledTimes(1)  // the backstop does not run it a second time
  })

  it('cancel before the frame stops it for good and says it was still waiting', () => {
    const fn = vi.fn()
    const cancel = afterPaint(fn)
    expect(cancel()).toBe(true)
    runFrames()
    vi.advanceTimersByTime(MAX_WAIT_MS * 2)
    expect(fn).not.toHaveBeenCalled()
    expect(cancel()).toBe(false)         // nothing left to stop
  })

  it('cancel between the frame and its timer also stops it', () => {
    const fn = vi.fn()
    const cancel = afterPaint(fn)
    runFrames()
    expect(cancel()).toBe(true)
    vi.advanceTimersByTime(MAX_WAIT_MS * 2)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel after it ran says it was not waiting', () => {
    const fn = vi.fn()
    const cancel = afterPaint(fn)
    runFrames()
    vi.advanceTimersByTime(0)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(cancel()).toBe(false)
  })

  it('no frame arrives on a visible page: it runs at MAX_WAIT_MS, once, and a late frame adds nothing', () => {
    const fn = vi.fn()
    afterPaint(fn)
    vi.advanceTimersByTime(MAX_WAIT_MS - 1)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    runFrames()
    vi.advanceTimersByTime(MAX_WAIT_MS)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a hidden document draws no frames: it runs at once, and there is nothing to cancel', () => {
    setHidden(true)
    const fn = vi.fn()
    const cancel = afterPaint(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(frames.length).toBe(0)        // no frame was asked for
    expect(cancel()).toBe(false)
    vi.advanceTimersByTime(MAX_WAIT_MS * 2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('no requestAnimationFrame at all: it runs at once', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const fn = vi.fn()
    const cancel = afterPaint(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(cancel()).toBe(false)
  })
})
