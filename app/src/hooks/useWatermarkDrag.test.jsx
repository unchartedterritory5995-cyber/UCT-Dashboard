import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useWatermarkDrag from './useWatermarkDrag'

function makeEl() {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400 })
  document.body.appendChild(el)
  el.setPointerCapture = vi.fn()
  el.releasePointerCapture = vi.fn()
  return el
}
function pe(type, x, y) {
  return new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 })
}

describe('useWatermarkDrag', () => {
  let el, ctrl, commit, tool
  beforeEach(() => {
    el = makeEl()
    ctrl = { getRect: () => ({ x: 400, y: 170, w: 200, h: 120 }), setArmed: vi.fn(), setOptions: vi.fn() }
    commit = vi.fn()
    tool = 'cursor'
    // The hover-arm path is rAF-coalesced (commit 48319226: don't run
    // getBoundingClientRect+setArmed at the mouse's full polling rate). Run
    // rAF synchronously in tests so the deferred setArmed is observable right
    // after the pointermove. Drag-path tests don't use rAF, so this is inert
    // for them. The stub returns undefined (NOT an id): the hook stores the
    // return in `hoverRaf` AFTER flushHover has reset it to null, so returning
    // a truthy id would leave the guard `if (hoverRaf == null)` permanently
    // blocked and a second hover would never re-schedule. undefined == null.
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb() })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    if (el && el.parentNode) el.parentNode.removeChild(el)
    vi.unstubAllGlobals()
  })
  const setup = () => renderHook(() => useWatermarkDrag({
    containerRef: { current: el }, controllerRef: { current: ctrl },
    getActiveTool: () => tool, onCommit: commit, mediaSize: { width: 1000, height: 400 },
  }))

  it('arms on hover inside rect, disarms outside', () => {
    setup()
    el.dispatchEvent(pe('pointermove', 500, 230))
    expect(ctrl.setArmed).toHaveBeenLastCalledWith(true)
    el.dispatchEvent(pe('pointermove', 10, 10))
    expect(ctrl.setArmed).toHaveBeenLastCalledWith(false)
  })

  it('drag inside rect updates position and commits once on up', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointermove', 600, 270))
    el.dispatchEvent(pe('pointerup', 600, 270))
    expect(ctrl.setOptions).toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
    const arg = commit.mock.calls[0][0]
    expect(arg.x).toBeCloseTo(0.6, 1)
    expect(arg.y).toBeCloseTo(0.675, 2)
  })

  it('sub-threshold press = click, no commit', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointerup', 502, 231))
    expect(commit).not.toHaveBeenCalled()
  })

  it('defers when a drawing tool is active', () => {
    tool = 'trendline'
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointermove', 600, 270))
    el.dispatchEvent(pe('pointerup', 600, 270))
    expect(commit).not.toHaveBeenCalled()
    expect(ctrl.setArmed).not.toHaveBeenCalledWith(true)
  })

  it('press outside rect does nothing', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 10, 10))
    el.dispatchEvent(pe('pointermove', 20, 20))
    el.dispatchEvent(pe('pointerup', 20, 20))
    expect(commit).not.toHaveBeenCalled()
  })

  it('press outside rect never arms and never starts a drag', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 10, 10))
    el.dispatchEvent(pe('pointermove', 300, 300))
    el.dispatchEvent(pe('pointerup', 300, 300))
    expect(ctrl.setArmed).not.toHaveBeenCalledWith(true)
    expect(ctrl.setOptions).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('orphan pointerup (no prior pointerdown) does not throw or commit', () => {
    setup()
    expect(() => el.dispatchEvent(pe('pointerup', 10, 10))).not.toThrow()
    expect(commit).not.toHaveBeenCalled()
  })

  it('pointercancel aborts the drag without committing', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointermove', 600, 270))
    el.dispatchEvent(pe('pointercancel', 600, 270))
    expect(commit).not.toHaveBeenCalled()
  })

  // Regression: dragging the watermark must NOT also pan the chart.
  function spiedPe(type, x, y) {
    const e = pe(type, x, y)
    vi.spyOn(e, 'stopPropagation')
    vi.spyOn(e, 'preventDefault')
    return e
  }

  it('stops the event from reaching the chart while dragging the watermark', () => {
    setup()
    const down = spiedPe('pointerdown', 500, 230)
    el.dispatchEvent(down)
    expect(down.stopPropagation).toHaveBeenCalled()
    expect(down.preventDefault).toHaveBeenCalled()
    const move = spiedPe('pointermove', 600, 270)
    el.dispatchEvent(move)
    expect(move.stopPropagation).toHaveBeenCalled()
    const up = spiedPe('pointerup', 600, 270)
    el.dispatchEvent(up)
    expect(up.stopPropagation).toHaveBeenCalled()
  })

  it('does NOT suppress the event for a press outside the watermark (chart pan preserved)', () => {
    setup()
    const down = spiedPe('pointerdown', 10, 10)
    el.dispatchEvent(down)
    expect(down.stopPropagation).not.toHaveBeenCalled()
    const move = spiedPe('pointermove', 20, 20)
    el.dispatchEvent(move)
    expect(move.stopPropagation).not.toHaveBeenCalled()
  })

  it('does NOT suppress a plain hover over the watermark (crosshair preserved)', () => {
    setup()
    const hover = spiedPe('pointermove', 500, 230)
    el.dispatchEvent(hover)
    expect(hover.stopPropagation).not.toHaveBeenCalled()
    expect(ctrl.setArmed).toHaveBeenLastCalledWith(true)
  })
})
