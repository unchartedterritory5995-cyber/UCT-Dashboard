// createAfterPaintSlot: at most one run waiting per owner, the latest request is what runs, after the frame.
//   S1 nothing runs before the frame; after it, the scheduled fn runs once
//   S2 several requests before one frame run ONCE, and it is the LATEST that runs
//   S3 a request after a run waits for the next frame again (a held key keeps scrolling, once per frame)
//   S4 cancel drops what waits; the slot works again afterwards
//   S5 a hidden document runs at once, EVERY time (a run that happened at once leaves nothing waiting)
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAfterPaintSlot, createNextFrameSlot } from './afterPaintSlot'
import { MAX_WAIT_MS } from './afterPaint'

let frames
const runFrames = () => { const q = frames; frames = []; for (const cb of q) if (cb) cb(0) }
const setHidden = (v) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })

beforeEach(() => {
  vi.useFakeTimers()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', (id) => { frames[id - 1] = null })
  setHidden(false)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete document.hidden })

/** The frame comes and is painted: its animation frame callbacks, then the zero timer after it. */
const paint = () => { runFrames(); vi.advanceTimersByTime(0) }

test('S1 nothing runs before the frame; after it, once', () => {
  const slot = createAfterPaintSlot()
  const fn = vi.fn()
  slot.schedule(fn)
  expect(fn).not.toHaveBeenCalled()
  expect(slot.waiting()).toBe(true)
  paint()
  expect(fn).toHaveBeenCalledTimes(1)
  expect(slot.waiting()).toBe(false)
  vi.advanceTimersByTime(MAX_WAIT_MS + 10)          // the backstop adds no second run
  expect(fn).toHaveBeenCalledTimes(1)
})

test('S2 several requests before one frame run once, and the latest is what runs', () => {
  const slot = createAfterPaintSlot()
  const ran = []
  slot.schedule(() => ran.push('a'))
  slot.schedule(() => ran.push('b'))
  slot.schedule(() => ran.push('c'))
  expect(frames.filter(Boolean)).toHaveLength(1)     // one frame asked for, not three
  paint()
  vi.advanceTimersByTime(MAX_WAIT_MS + 10)
  expect(ran).toEqual(['c'])
})

test('S3 a request after a run waits for the next frame again', () => {
  const slot = createAfterPaintSlot()
  const ran = []
  slot.schedule(() => ran.push(1))
  paint()
  slot.schedule(() => ran.push(2))
  expect(ran).toEqual([1])
  paint()
  expect(ran).toEqual([1, 2])
})

test('S3b with no frame coming on a visible page, the backstop still runs it (it never stops)', () => {
  const slot = createAfterPaintSlot()
  const fn = vi.fn()
  slot.schedule(fn)
  vi.advanceTimersByTime(MAX_WAIT_MS)
  expect(fn).toHaveBeenCalledTimes(1)
})

test('S4 cancel drops what waits, and the slot works again afterwards', () => {
  const slot = createAfterPaintSlot()
  const dropped = vi.fn()
  slot.schedule(dropped)
  slot.cancel()
  expect(slot.waiting()).toBe(false)
  paint()
  vi.advanceTimersByTime(MAX_WAIT_MS + 10)
  expect(dropped).not.toHaveBeenCalled()
  const later = vi.fn()
  slot.schedule(later)
  paint()
  expect(later).toHaveBeenCalledTimes(1)
})

test('S5 a hidden document runs at once, every time', () => {
  setHidden(true)
  const slot = createAfterPaintSlot()
  const ran = []
  slot.schedule(() => ran.push(1))
  expect(ran).toEqual([1])
  expect(slot.waiting()).toBe(false)
  slot.schedule(() => ran.push(2))
  expect(ran).toEqual([1, 2])
})

// ── createNextFrameSlot: the same contract, IN the next animation frame callback (no timer after it) ──
//   N1 nothing runs before the frame; the run happens INSIDE the frame callback, not in a timer after it
//   N2 several requests before one frame run once, the latest
//   N3 cancel drops what waits; a hidden document runs at once every time; the backstop runs it with no frame

test('N1 the run happens inside the next frame callback itself', () => {
  const slot = createNextFrameSlot()
  const fn = vi.fn()
  slot.schedule(fn)
  expect(fn).not.toHaveBeenCalled()
  expect(slot.waiting()).toBe(true)
  runFrames()                                        // the frame's callbacks, and NO timer
  expect(fn).toHaveBeenCalledTimes(1)
  expect(slot.waiting()).toBe(false)
  vi.advanceTimersByTime(MAX_WAIT_MS + 10)           // the backstop adds no second run
  expect(fn).toHaveBeenCalledTimes(1)
})

test('N2 several requests before one frame run once, the latest', () => {
  const slot = createNextFrameSlot()
  const ran = []
  slot.schedule(() => ran.push('a'))
  slot.schedule(() => ran.push('b'))
  slot.schedule(() => ran.push('c'))
  expect(frames.filter(Boolean)).toHaveLength(1)
  runFrames()
  expect(ran).toEqual(['c'])
  slot.schedule(() => ran.push('d'))                 // the next request waits for the next frame
  expect(ran).toEqual(['c'])
  runFrames()
  expect(ran).toEqual(['c', 'd'])
})

test('N3 cancel, a hidden document, and the backstop', () => {
  const slot = createNextFrameSlot()
  const dropped = vi.fn()
  slot.schedule(dropped)
  slot.cancel()
  runFrames()
  vi.advanceTimersByTime(MAX_WAIT_MS + 10)
  expect(dropped).not.toHaveBeenCalled()
  const noFrame = vi.fn()
  slot.schedule(noFrame)
  vi.advanceTimersByTime(MAX_WAIT_MS)                // no frame came: the timer runs it
  expect(noFrame).toHaveBeenCalledTimes(1)
  setHidden(true)
  const ran = []
  slot.schedule(() => ran.push(1))
  slot.schedule(() => ran.push(2))
  expect(ran).toEqual([1, 2])
  expect(slot.waiting()).toBe(false)
})
