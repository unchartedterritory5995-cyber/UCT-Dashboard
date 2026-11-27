// The frame loop's PAUSE gate (2026-11-27, the board keep-alive's layer mode; boardVisibility.js `boardLoopGate`).
// A hidden layer board's chart keeps its loops (no effect re-runs at the show), and each loop parks while the gate says
// paused: nothing measured, nothing scheduled. The show runs it on the NEXT frame, never in the show's own task.
//   G1 (red first) a run that finds the gate paused measures nothing and schedules nothing
//   G2 (red first) the gate's change that un-pauses it runs the loop on the next frame (not synchronously), every frame
//      until it settles again
//   G3 a change that leaves it paused, or a wake() while parked, schedules nothing
//   G4 stop() drops the gate subscription; no gate is the loop exactly as before
import { describe, it, expect, vi } from 'vitest'
import { createAdaptiveFrameLoop } from './adaptiveFrameLoop'
import { createBoardVisibility, boardLoopGate } from './boardVisibility'

function harness(tick, gate) {
  let now = 0
  let id = 0
  const frames = new Map()
  const timers = new Map()
  const loop = createAdaptiveFrameLoop({
    tick,
    gate,
    raf: (fn) => { frames.set(++id, fn); return id },
    caf: (i) => frames.delete(i),
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id },
    clearTimer: (i) => timers.delete(i),
  })
  const frame = () => {
    now += 16
    const due = [...frames.entries()]
    frames.clear()
    for (const [, fn] of due) fn()
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn() }
  }
  const run = (n) => { for (let i = 0; i < n; i++) frame() }
  return { loop, frame, run, pending: () => frames.size + timers.size }
}

describe('the adaptive frame loop parks on a hidden layer board', () => {
  it('G1 (red first) a paused gate: nothing measured, nothing scheduled', () => {
    const vis = createBoardVisibility({ layer: true })
    let n = 0
    const tick = vi.fn(() => String(n++))
    const h = harness(tick, boardLoopGate(vis))
    h.loop.start()
    h.run(5)
    const before = tick.mock.calls.length
    expect(before, 'NON-VACUITY: the loop measured while visible').toBeGreaterThan(0)
    vis.set('hidden')
    h.run(120)   // two seconds of frames (and every slow pass in them)
    expect(tick.mock.calls.length - before, 'the loop measured on a hidden board').toBe(0)
    expect(h.pending(), 'a parked loop left a frame or timer scheduled').toBe(0)
  })

  it('G2 (red first) the show runs it on the next frame, not in its own task', () => {
    const vis = createBoardVisibility({ layer: true })
    let n = 0
    const tick = vi.fn(() => String(n++))
    const h = harness(tick, boardLoopGate(vis))
    h.loop.start()
    vis.set('hidden')
    h.run(3)
    const parkedAt = tick.mock.calls.length
    vis.set('visible')
    expect(tick.mock.calls.length, 'the show measured synchronously').toBe(parkedAt)
    h.frame()
    expect(tick.mock.calls.length, 'the frame after the show did not measure').toBe(parkedAt + 1)
    h.run(5)
    expect(tick.mock.calls.length, 'not every frame after the show').toBe(parkedAt + 6)
  })

  it('G3 a change that leaves it paused, or a wake() while parked, schedules nothing', () => {
    let paused = true
    let fire = null
    const tick = vi.fn(() => 'x')
    const h = harness(tick, { paused: () => paused, subscribe: (cb) => { fire = cb; return () => { fire = null } } })
    h.loop.start()
    expect(tick).not.toHaveBeenCalled()
    h.loop.wake()
    fire()            // the gate changed, and still says paused
    expect(h.pending()).toBe(0)
    h.run(30)
    expect(tick).not.toHaveBeenCalled()
    paused = false
    fire()
    h.frame()
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('G4 stop() lets go of the gate; no gate is the loop as before', () => {
    const vis = createBoardVisibility({ layer: true })
    const subscribe = vi.spyOn(vis, 'subscribe')
    const tick = vi.fn(() => 'x')
    const gate = boardLoopGate(vis)
    const h = harness(tick, { paused: gate.paused, subscribe: (cb) => vis.subscribe(cb) })
    vis.set('hidden')
    h.loop.start()
    h.loop.stop()
    vis.set('visible')
    h.run(10)
    expect(tick, 'a stopped loop ran at the show').not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)
    // the <Activity> mode's handle and no handle at all give no gate
    expect(boardLoopGate(createBoardVisibility())).toBeNull()
    expect(boardLoopGate(null)).toBeNull()
    const plain = harness(vi.fn(() => 'y'), null)
    plain.loop.start()
    plain.run(3)
    expect(plain.pending()).toBe(1)
  })
})
