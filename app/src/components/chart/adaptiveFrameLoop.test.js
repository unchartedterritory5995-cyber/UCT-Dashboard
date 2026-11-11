import { describe, it, expect, vi } from 'vitest'
import { createAdaptiveFrameLoop, IDLE_AFTER_FRAMES, IDLE_INTERVAL_MS } from './adaptiveFrameLoop'

// A fake clock with separate frame and timer queues, so "every frame" and "slow pass" are countable.
function harness(tick) {
  let now = 0
  let id = 0
  const frames = new Map()
  const timers = new Map()
  const loop = createAdaptiveFrameLoop({
    tick,
    raf: (fn) => { frames.set(++id, fn); return id },
    caf: (i) => frames.delete(i),
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id },
    clearTimer: (i) => timers.delete(i),
  })
  const frame = () => { // run one display frame
    now += 16
    const due = [...frames.entries()]
    frames.clear()
    for (const [, fn] of due) fn()
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn() }
  }
  const frames$ = (n) => { for (let i = 0; i < n; i++) frame() }
  return { loop, frame, frames: frames$, pendingFrames: () => frames.size, pendingTimers: () => timers.size }
}

describe('createAdaptiveFrameLoop', () => {
  it('runs every frame while the measurement keeps changing', () => {
    let n = 0
    const tick = vi.fn(() => String(n++))
    const h = harness(tick)
    h.loop.start()
    h.frames(60)
    expect(tick).toHaveBeenCalledTimes(61)
    expect(h.loop.isIdle()).toBe(false)
  })

  it(`drops to a slow pass after ${IDLE_AFTER_FRAMES} identical frames`, () => {
    const tick = vi.fn(() => 'still')
    const h = harness(tick)
    h.loop.start()
    h.frames(IDLE_AFTER_FRAMES + 1)
    expect(h.loop.isIdle()).toBe(true)
    const before = tick.mock.calls.length
    h.frames(60) // ~1 s of frames
    const perSecond = tick.mock.calls.length - before
    expect(perSecond).toBeLessThanOrEqual(Math.ceil(1000 / IDLE_INTERVAL_MS))
    expect(perSecond).toBeGreaterThanOrEqual(3) // the safety pass still runs
  })

  it('a null signature (still settling) never counts as idle', () => {
    const tick = vi.fn(() => null)
    const h = harness(tick)
    h.loop.start()
    h.frames(100)
    expect(h.loop.isIdle()).toBe(false)
    expect(tick).toHaveBeenCalledTimes(101)
  })

  it('wake() returns to every-frame mode on the very next frame', () => {
    const tick = vi.fn(() => 'still')
    const h = harness(tick)
    h.loop.start()
    h.frames(IDLE_AFTER_FRAMES + 2)
    expect(h.loop.isIdle()).toBe(true)
    h.loop.wake()
    expect(h.loop.isIdle()).toBe(false)
    const before = tick.mock.calls.length
    h.frame()
    expect(tick.mock.calls.length).toBe(before + 1)
    expect(h.pendingTimers()).toBe(0) // the slow timer was cancelled, not doubled
  })

  it('wake() while already fast does not double-schedule', () => {
    let n = 0
    const tick = vi.fn(() => String(n++))
    const h = harness(tick)
    h.loop.start()
    h.loop.wake()
    h.loop.wake()
    expect(h.pendingFrames()).toBe(1)
  })

  it('a change caught by the slow pass returns to every frame', () => {
    let sig = 'a'
    const tick = vi.fn(() => sig)
    const h = harness(tick)
    h.loop.start()
    h.frames(IDLE_AFTER_FRAMES + 2)
    expect(h.loop.isIdle()).toBe(true)
    sig = 'b' // something moved that no trigger reported
    h.frames(20) // let the slow pass see it
    expect(h.loop.isIdle()).toBe(false)
  })

  it('stop() cancels everything, and a throwing tick does not kill the loop', () => {
    let calls = 0
    const tick = vi.fn(() => { calls++; if (calls === 2) throw new Error('boom'); return 'x' })
    const h = harness(tick)
    h.loop.start()
    h.frames(5)
    expect(tick.mock.calls.length).toBeGreaterThan(2)
    h.loop.stop()
    expect(h.pendingFrames()).toBe(0)
    expect(h.pendingTimers()).toBe(0)
    const after = tick.mock.calls.length
    h.frames(30)
    h.loop.wake()
    h.frames(5)
    expect(tick.mock.calls.length).toBe(after)
  })
})

describe('StockChart uses the adaptive loop for its chrome placement', () => {
  it('no unconditional per-frame re-arm of the placement tick remains', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    // Chrome placement, the extended-hours chip glue and the chip placement: all adaptive.
    expect((src.match(/createAdaptiveFrameLoop\(\{ tick \}\)/g) || []).length).toBeGreaterThanOrEqual(3)
    // No loop re-arms itself every frame unconditionally. (The price-fade loop is finite: it
    // re-arms only `if (p < 1)` into `fadeRafRef`, and this pattern deliberately does not match it.)
    expect(src).not.toMatch(/\braf\s*=\s*requestAnimationFrame\(tick\)/)
    // the wakes that keep a divider drag frame-accurate
    for (const w of ["'pointermove'", 'subscribeVisibleLogicalRangeChange(wake)', 'new ResizeObserver(wake)', 'subscribeDataChanged(wake)']) {
      expect(src).toContain(w)
    }
    // ...and never a crosshair subscription: the chart keeps exactly two (legendFromDefinitions).
    expect(src).not.toContain('subscribeCrosshairMove(wake)')
  })
})
