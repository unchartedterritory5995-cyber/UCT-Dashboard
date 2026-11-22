// app/src/components/chart/legend/legendPointerHold.test.js
//
// The hover-only legend must not unmount under a pointer that is resting on it.
// Measured before this rule: 132 mount/unmount flips in 181 frames (production, 2026-11-16).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLegendPointerHold, LEGEND_RELEASE_MS } from './legendPointerHold'

function rig({ hoverOnly = true, pending = false, hovered = true } = {}) {
  const state = { hoverOnly, pending, hovered, cleared: 0 }
  const hold = createLegendPointerHold({
    isHoverOnly: () => state.hoverOnly,
    clearReadout: () => { state.cleared += 1 },
    crosshairPending: () => state.pending,
    legendHovered: () => state.hovered,
  })
  return { hold, state }
}

describe('legendPointerHold', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('keeps the readout when the crosshair clears because the mouse moved onto the hover-only legend', () => {
    const { hold } = rig()
    hold.enter({ pointerType: 'mouse' })
    expect(hold.keepsReadout()).toBe(true)
    expect(hold.isHolding()).toBe(true)
  })

  it('the control: with the pointer NOT on the legend, a crosshair-clear clears as it always did', () => {
    const { hold } = rig()
    expect(hold.keepsReadout()).toBe(false)
    expect(hold.isHolding()).toBe(false)
  })

  it('never holds a persistent legend: its off-cursor readout is the latest bar', () => {
    const { hold } = rig({ hoverOnly: false })
    hold.enter({ pointerType: 'mouse' })
    expect(hold.keepsReadout()).toBe(false)
    expect(hold.isHolding()).toBe(false)
  })

  it('a stale "inside" (the legend unmounted under the pointer, no leave arrived) does not hold', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    state.hovered = false // the browser no longer sees the pointer on a legend
    expect(hold.keepsReadout()).toBe(false)
    // …and the flag is dropped, so it cannot hold later either without a fresh enter
    state.hovered = true
    expect(hold.keepsReadout()).toBe(false)
  })

  it('a touch never arms a hold', () => {
    const { hold } = rig()
    hold.enter({ pointerType: 'touch' })
    expect(hold.keepsReadout()).toBe(false)
  })

  it('leaving the legend for somewhere that is not the chart gives the readout back, once', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    hold.keepsReadout()
    hold.leave()
    expect(state.cleared).toBe(0) // one beat first
    vi.advanceTimersByTime(LEGEND_RELEASE_MS)
    expect(state.cleared).toBe(1)
    expect(hold.isHolding()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(state.cleared).toBe(1)
  })

  it('leaving the legend onto the chart: the crosshair settles it and nothing is cleared', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    hold.keepsReadout()
    hold.leave()
    hold.settle() // the chart's crosshair event arrived inside the beat
    vi.advanceTimersByTime(1000)
    expect(state.cleared).toBe(0)
    expect(hold.isHolding()).toBe(false)
  })

  it('a queued crosshair frame is left to settle the readout', () => {
    const { hold, state } = rig({ pending: true })
    hold.enter({ pointerType: 'mouse' })
    hold.keepsReadout()
    hold.leave()
    vi.advanceTimersByTime(LEGEND_RELEASE_MS)
    expect(state.cleared).toBe(0)
  })

  it('combing row to row (leave, then enter inside the beat) never clears', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    hold.keepsReadout()
    for (let i = 0; i < 5; i++) {
      hold.leave()
      vi.advanceTimersByTime(10)
      hold.enter({ pointerType: 'mouse' })
      expect(hold.keepsReadout()).toBe(true)
    }
    vi.advanceTimersByTime(1000)
    expect(state.cleared).toBe(0)
    expect(hold.isHolding()).toBe(true)
  })

  it('a leave with nothing held clears nothing', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    hold.leave()
    vi.advanceTimersByTime(1000)
    expect(state.cleared).toBe(0)
  })

  it('dispose cancels a pending release', () => {
    const { hold, state } = rig()
    hold.enter({ pointerType: 'mouse' })
    hold.keepsReadout()
    hold.leave()
    hold.dispose()
    vi.advanceTimersByTime(1000)
    expect(state.cleared).toBe(0)
  })
})
