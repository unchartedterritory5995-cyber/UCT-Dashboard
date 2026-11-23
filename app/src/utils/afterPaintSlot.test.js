// createNextFrameSlot: at most one run waiting per owner, the latest request is what runs, IN the next animation
// frame callback (no timer after it).
//   N1 nothing runs before the frame; the run happens INSIDE the frame callback, not in a timer after it
//   N2 several requests before one frame run once, the latest; the next request waits for the next frame
//   N3 cancel drops what waits; the backstop runs it with no frame; a hidden document runs at once, every time
// ⚰️ S1-S5 tested the after-paint slot, deleted with it (review of e1fdb99975: no caller left).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createNextFrameSlot } from './afterPaintSlot'
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
